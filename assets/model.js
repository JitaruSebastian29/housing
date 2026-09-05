/* model.js · the weighted ranking and the runway calculator.
 * Reads window.RELOCATION_DATA (data.js), which tables.js may already have
 * amended with locally saved score overrides and added cities. */
(function () {
  'use strict';

  var D = window.RELOCATION_DATA;
  if (!D) { return; }

  var KEYS = Object.keys(D.criteria);
  var SHORT = { both: 'Both', savings: 'Savings', anna: 'Anna', climate: 'Climate',
                social: 'Social', safety: 'Safety', urban: 'Urban' };

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
    });
  }
  function fmt(n) { return Math.round(n).toLocaleString('en-GB'); }
  function cls(v) { return v >= 7 ? 'yes' : (v >= 4 ? 'maybe' : 'no'); }
  function byId(id) { return D.cities.filter(function (c) { return c.id === id; })[0]; }

  var weightsEl, rankBody, rankHead, totalEl, noteEl, scRemote, scHeat, scAnna;

  /* ---------------- weighted ranking ---------------- */
  function readWeights() {
    var w = {};
    KEYS.forEach(function (k) { w[k] = Number(document.getElementById('w-' + k).value); });
    if (scAnna.checked) { w.anna = w.anna * 2; }
    return w;
  }

  function vetoesFor(c, sc) {
    var v = [];
    if (c.work) { v.push('right to work · ' + c.work); }
    if (sc.heat && c.heat) { v.push('heat · ' + c.heat); }
    if (!sc.remote && c.floor === 'fails') {
      v.push("Sebi's EUR 3,500 net floor is not reachable at a realistic salary here");
    }
    return v;
  }

  function effectiveScore(c, k, sc) {
    var v = c.scores[k];
    if (sc.remote && k === 'savings' && c.remoteSavings != null) { v = Math.max(v, c.remoteSavings); }
    if (sc.remote && k === 'both' && c.remoteBoth != null) { v = Math.max(v, c.remoteBoth); }
    return v;
  }

  function scoreFor(c, w, sc) {
    var s = 0, tot = 0;
    KEYS.forEach(function (k) { s += effectiveScore(c, k, sc) * w[k]; tot += w[k]; });
    return tot ? s / tot : 0;
  }

  function renderRank() {
    var w = readWeights();
    var shown = KEYS.reduce(function (a, k) {
      return a + Number(document.getElementById('w-' + k).value);
    }, 0);
    totalEl.textContent = shown;
    totalEl.parentElement.classList.toggle('warn', shown !== 100);

    var sc = { remote: scRemote.checked, heat: scHeat.checked, anna: scAnna.checked };
    var rows = D.cities.map(function (c) {
      return { c: c, v: vetoesFor(c, sc), s: scoreFor(c, w, sc) };
    });
    rows.sort(function (a, b) {
      return (a.v.length ? 1 : 0) - (b.v.length ? 1 : 0) || b.s - a.s;
    });

    rankBody.innerHTML = '';
    var rank = 0;
    rows.forEach(function (r) {
      var tr = document.createElement('tr');
      if (r.v.length) {
        tr.className = 'vetoed';
      } else {
        rank++;
        if (rank <= 3) { tr.className = 'lead-row'; }
      }

      var cells = KEYS.map(function (k) {
        var v = effectiveScore(r.c, k, sc);
        return '<td class="num ' + cls(v) + '">' + v + '</td>';
      }).join('');

      var reasons = KEYS.map(function (k) {
        return '<p><b>' + esc(D.criteria[k].label) + '</b> ' + r.c.scores[k] + '/10 · ' +
               esc(r.c.why[k] || 'No reason recorded yet.') + '</p>';
      }).join('');
      if (r.c.floor === 'tight') {
        reasons += '<p class="maybe">Sebi&rsquo;s EUR 3,500 net floor is tight here and clears only at mid level or on a remote contract.</p>';
      }
      if (r.v.length) {
        reasons += '<p class="no">Veto: ' + esc(r.v.join(' · ')) + '</p>';
      }
      reasons += '<div class="score-edit" data-city="' + esc(r.c.id) + '">' +
        KEYS.map(function (k) {
          return '<label>' + esc(SHORT[k]) +
            '<input type="number" min="0" max="10" step="1" data-key="' + k + '" value="' + r.c.scores[k] + '"></label>';
        }).join('') + '</div>';

      tr.innerHTML =
        '<td class="num">' + (r.v.length ? '·' : rank) + '</td>' +
        '<td><details><summary>' + esc(r.c.name) + '</summary><div class="why">' + reasons + '</div></details></td>' +
        '<td class="num"><b>' + (r.v.length ? 'veto' : r.s.toFixed(1)) + '</b></td>' +
        cells;
      rankBody.appendChild(tr);
    });

    var parts = ['Vetoes first, then the weighted score.'];
    parts.push(sc.remote
      ? 'Scenario on: Sebi holds a remote or foreign-payer contract, so the net-floor veto is lifted and the savings score rises where local pay, not rent, was the constraint.'
      : 'The net-floor veto removes only cities where EUR 3,500 net is unreachable at a realistic salary. Cities marked tight in the expanded reasons clear it at mid level.');
    if (sc.heat) { parts.push('The 42.5 °C heat rule is on, and it removes Florence alone.'); }
    if (sc.anna) { parts.push("Anna's market is weighted at double, which is what taking the tied-mover evidence seriously looks like."); }
    noteEl.textContent = parts.join(' ');
  }

  /* ---------------- runway maths ---------------- */
  function runway(p) {
    var netMonth = p.gross * p.netPct / 100 / 12;
    var upfront = p.upfrontMonths * p.rent;
    var balance = netMonth + p.anna - p.rent - p.living - p.mand;
    var left = p.savings - upfront;
    var months;
    if (left <= 0) { months = 0; }
    else if (balance >= 0) { months = Infinity; }
    else { months = left / -balance; }
    return { netMonth: netMonth, upfront: upfront, balance: balance, left: left, months: months };
  }

  function label(m) {
    if (m === Infinity) { return 'covered'; }
    if (m >= 60) { return '5 yr+'; }
    return m.toFixed(0) + ' mo';
  }

  /* ---------------- calculator ---------------- */
  var sel, F;

  function withRw() { return D.cities.filter(function (c) { return c.rw; }); }

  function currentParams() {
    var c = byId(sel.value);
    return {
      cur: c ? c.cur : 'EUR',
      gross: Number(F.gross.value) || 0,
      netPct: Number(F.net.value) || 0,
      rent: Number(F.rent.value) || 0,
      living: Number(F.living.value) || 0,
      mand: Number(F.mand.value) || 0,
      upfrontMonths: Number(F.upfront.value) || 0,
      savings: Number(F.savings.value) || 0,
      anna: Number(F.anna.value) || 0
    };
  }

  function calc() {
    var p = currentParams();
    var r = runway(p);
    var cur = p.cur;
    var out = $('#rw-out');
    var rentPct = r.netMonth > 0 ? (p.rent / r.netMonth * 100) : 0;
    var stress = runway({
      gross: p.gross, netPct: p.netPct, rent: p.rent * 1.1, living: p.living * 1.1,
      mand: p.mand, upfrontMonths: p.upfrontMonths, savings: p.savings, anna: p.anna
    });
    var html;

    if (r.left <= 0) {
      html = '<p><b>The move-in cost alone exceeds the savings.</b> ' + cur + ' ' + fmt(r.upfront) +
        ' is needed before the first month, against ' + cur + ' ' + fmt(p.savings) + ' saved.</p>';
    } else if (r.balance >= 0) {
      html = '<p>Sebi&rsquo;s net of about <b>' + cur + ' ' + fmt(r.netMonth) +
        '</b> a month covers rent, living costs and mandatory extras with ' + cur + ' ' + fmt(r.balance) +
        ' to spare. The ' + cur + ' ' + fmt(r.left) +
        ' left after move-in stays intact as a buffer rather than a countdown. <b>Anna can stay unpaid indefinitely on this budget.</b></p>';
    } else {
      html = '<p>Sebi&rsquo;s net of about ' + cur + ' ' + fmt(r.netMonth) + ' a month falls ' +
        cur + ' ' + fmt(-r.balance) + ' short of rent, living costs and mandatory extras. After ' +
        cur + ' ' + fmt(r.upfront) + ' upfront, the remaining ' + cur + ' ' + fmt(r.left) +
        ' lasts <b>' + label(r.months) + '</b> with Anna unpaid.</p>' +
        '<div class="bar"><i style="width:' + Math.min(100, r.months / 24 * 100).toFixed(0) + '%"></i></div>' +
        '<p class="thin" style="font-size:12.5px">Bar is scaled to 24 months.</p>';
    }

    html += '<p class="thin" style="font-size:13px">Rent is <b>' + rentPct.toFixed(0) +
      '%</b> of Sebi&rsquo;s net. Net-to-gross is a planning estimate adjusted from the Eurostat ratio for the country; run a city calculator before signing anything.</p>';

    if (r.balance < 0 && r.months >= 36) {
      html += '<p class="no" style="font-size:13px">Treat that number as indefinite rather than exact. The monthly shortfall is only ' +
        cur + ' ' + fmt(-r.balance) + ', so the runway is extremely sensitive: put rent and living costs up by 10% and it becomes <b>' +
        label(stress.months) + '</b>.</p>';
    } else {
      html += '<p class="thin" style="font-size:13px">Stress test: with rent and living costs 10% higher it becomes <b>' +
        label(stress.months) + '</b>.</p>';
    }
    out.innerHTML = html;
  }

  function fillSelect() {
    var current = sel.value;
    sel.innerHTML = '';
    withRw().forEach(function (c) {
      var o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.name;
      sel.appendChild(o);
    });
    if (current && byId(current)) { sel.value = current; }
  }

  function loadCity() {
    var c = byId(sel.value);
    if (!c || !c.rw) { return; }
    F.gross.value = c.rw.gross;
    F.net.value = c.rw.netPct;
    F.rent.value = c.rw.rent;
    F.living.value = c.rw.living;
    F.mand.value = c.rw.mand;
    F.upfront.value = c.rw.upfront;
    $('#rw-src').textContent = c.rw.note || '';
    calc();
  }

  function renderRunwayTable() {
    var tbody = $('#rw-table');
    function base(c, mult) {
      return runway({
        gross: c.rw.gross, netPct: c.rw.netPct, rent: c.rw.rent * mult, living: c.rw.living * mult,
        mand: c.rw.mand, upfrontMonths: c.rw.upfront, savings: 35000, anna: 0
      });
    }
    var rows = withRw().map(function (c) { return { c: c, r: base(c, 1), s: base(c, 1.1) }; });
    /* Comparing Infinity with Infinity yields NaN and gives an inconsistent
       comparator, so map it to a finite sentinel before sorting. */
    function key(m) { return m === Infinity ? Number.MAX_VALUE : m; }
    rows.sort(function (a, b) { return key(a.r.months) - key(b.r.months); });

    tbody.innerHTML = rows.map(function (x) {
      var cur = x.c.cur;
      var pct = x.c.rw.rent / x.r.netMonth * 100;
      var m = x.r.months;
      var klass = (m === Infinity || m >= 14) ? 'yes' : (m >= 9 ? 'maybe' : 'no');
      var shown = (m !== Infinity && m >= 36) ? '5 yr+' : label(m);
      var flag = '';
      if (x.c.work) { flag = ' <span class="tag n">no permit</span>'; }
      else if (x.c.floor === 'fails') { flag = ' <span class="tag n">floor fails</span>'; }
      else if (x.c.floor === 'tight') { flag = ' <span class="tag m">floor tight</span>'; }

      return '<tr' + (x.c.work || x.c.floor === 'fails' ? ' class="vetoed"' : '') + '>' +
        '<td>' + esc(x.c.name) + flag + '</td>' +
        '<td class="num">' + cur + ' ' + fmt(x.r.netMonth) + '</td>' +
        '<td class="num">' + cur + ' ' + fmt(x.c.rw.rent) + '</td>' +
        '<td class="num ' + (pct <= 30 ? 'yes' : (pct <= 42 ? 'maybe' : 'no')) + '">' + pct.toFixed(0) + '%</td>' +
        '<td class="num">' + (x.r.balance >= 0 ? 'covered' : cur + ' ' + fmt(-x.r.balance)) + '</td>' +
        '<td class="num">' + cur + ' ' + fmt(x.r.upfront) + '</td>' +
        '<td class="num ' + klass + '"><b>' + shown + '</b><br>' +
          '<span class="thin" style="font-weight:400">' + label(x.s.months) + ' if costs rise 10%</span></td>' +
        '</tr>';
    }).join('');
  }

  function rerender() {
    renderRank();
    fillSelect();
    renderRunwayTable();
  }

  /* ---------------- boot ---------------- */
  function boot() {
    weightsEl = $('#weights'); rankBody = $('#rank-body'); rankHead = $('#rank-head');
    totalEl = $('#weight-total'); noteEl = $('#rank-note');
    scRemote = $('#sc-remote'); scHeat = $('#sc-heat'); scAnna = $('#sc-anna');
    if (!weightsEl) { return; }

    KEYS.forEach(function (k) {
      var cr = D.criteria[k], id = 'w-' + k;
      var wrap = document.createElement('div');
      wrap.className = 'w';
      wrap.innerHTML =
        '<label for="' + id + '">' + esc(cr.label) + ' <output for="' + id + '">' + cr.weight + '</output>%</label>' +
        '<input type="range" id="' + id + '" data-key="' + k + '" min="0" max="50" step="5" value="' + cr.weight + '">' +
        '<small>' + esc(cr.why) + '</small>';
      weightsEl.appendChild(wrap);
    });

    rankHead.innerHTML = '<th scope="col">#</th><th scope="col">City</th><th scope="col">Score</th>' +
      KEYS.map(function (k) {
        return '<th scope="col" class="num"><abbr title="' + esc(D.criteria[k].label) + '">' +
               esc(SHORT[k]) + '</abbr></th>';
      }).join('');

    weightsEl.addEventListener('input', function (e) {
      if (e.target.type === 'range') {
        var out = e.target.parentElement.querySelector('output');
        if (out) { out.value = e.target.value; }
        renderRank();
      }
    });
    [scRemote, scHeat, scAnna].forEach(function (el) { el.addEventListener('change', renderRank); });
    $('#w-reset').addEventListener('click', function () {
      KEYS.forEach(function (k) {
        var input = document.getElementById('w-' + k);
        input.value = D.criteria[k].weight;
        input.parentElement.querySelector('output').value = input.value;
      });
      scRemote.checked = false; scHeat.checked = true; scAnna.checked = false;
      renderRank();
    });

    /* score editing, delegated because rows are rebuilt on every render */
    rankBody.addEventListener('change', function (e) {
      var input = e.target.closest('.score-edit input');
      if (!input || !window.HOUSING_EDIT) { return; }
      var v = Math.max(0, Math.min(10, Math.round(Number(input.value) || 0)));
      input.value = v;
      var cityId = input.closest('.score-edit').dataset.city;
      window.HOUSING_EDIT.saveScore(cityId, input.dataset.key, v);
    });

    sel = $('#rw-city');
    F = {};
    ['gross', 'net', 'rent', 'living', 'mand', 'upfront', 'savings', 'anna'].forEach(function (k) {
      F[k] = document.getElementById('rw-' + k);
    });
    sel.addEventListener('change', loadCity);
    Object.keys(F).forEach(function (k) { F[k].addEventListener('input', calc); });

    var saveBtn = $('#rw-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        if (!window.HOUSING_EDIT) { return; }
        window.HOUSING_EDIT.saveRunway(sel.value, {
          gross: Number(F.gross.value) || 0,
          netPct: Number(F.net.value) || 0,
          rent: Number(F.rent.value) || 0,
          living: Number(F.living.value) || 0,
          mand: Number(F.mand.value) || 0,
          upfront: Number(F.upfront.value) || 0
        });
        saveBtn.textContent = 'Saved to ' + byId(sel.value).name;
        setTimeout(function () { saveBtn.textContent = 'Save these numbers to this city'; }, 2500);
      });
    }

    var addForm = $('#add-city-form');
    if (addForm) {
      addForm.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!window.HOUSING_EDIT) { return; }
        var name = $('#nc-name').value.trim();
        if (!name) { return; }
        var id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('city-' + Date.now());
        if (byId(id)) { alert('There is already a city with that name.'); return; }
        var scores = {}, why = {};
        KEYS.forEach(function (k) {
          scores[k] = Math.max(0, Math.min(10, Math.round(Number($('#nc-' + k).value) || 5)));
          why[k] = 'Added by hand, no reason recorded yet.';
        });
        var gross = Number($('#nc-gross').value) || 60000;
        var netPct = Number($('#nc-net').value) || 65;
        var rent = Number($('#nc-rent').value) || 1200;
        var net = gross * netPct / 100 / 12;
        window.HOUSING_EDIT.addCity({
          id: id, name: name, cur: ($('#nc-cur').value || 'EUR').toUpperCase(),
          floor: net >= 3500 ? 'clears' : (net >= 3100 ? 'tight' : 'fails'),
          scores: scores, why: why,
          rw: {
            gross: gross, netPct: netPct, rent: rent,
            living: Number($('#nc-living').value) || 1800,
            mand: Number($('#nc-mand').value) || 0,
            upfront: Number($('#nc-upfront').value) || 2,
            note: 'Added by hand. No source recorded, so treat every figure in this row as unverified.'
          }
        });
        addForm.reset();
        $('#nc-added').textContent = name + ' added. Its floor test was set automatically to "' +
          (net >= 3500 ? 'clears' : (net >= 3100 ? 'tight' : 'fails')) + '" from the pay and net share you gave.';
      });
    }

    rerender();
    loadCity();
  }

  window.HOUSING_MODEL = { rerender: rerender };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
