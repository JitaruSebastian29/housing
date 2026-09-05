/* tables.js · edit mode for every table in the document.
 *
 * Scope. Static tables authored in the HTML are edited cell by cell and stored as
 * their own tbody markup. The two tables the model generates (the ranking and the
 * runway comparison) are NOT edited that way, because they are recomputed on every
 * render and any cell edit would be wiped. Those are edited through their data
 * instead: score inputs inside each city's details, an "add a city" form, and a
 * "save to this city" button on the calculator.
 *
 * Storage. localStorage, so edits stay in this browser and never reach anyone else.
 * On file:// some browsers hand back an opaque origin and throw on access, so every
 * read and write is wrapped and the page renders correctly with nothing stored.
 * Export and import move edits between machines, which is the reliable path.
 */
(function () {
  'use strict';

  var KEY = 'housing.v2';
  var GENERATED = ['rank-body', 'rw-table'];   // tbody ids owned by model.js

  /* ---------------- storage ---------------- */
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }
  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      return false;   // private window, blocked site data, or an opaque file:// origin
    }
  }
  var state = load();
  if (!state.tables) { state.tables = {}; }
  if (!state.cities) { state.cities = {}; }
  if (!state.added) { state.added = []; }

  function persist() {
    var ok = save(state);
    var el = document.getElementById('save-state');
    if (el) {
      el.textContent = ok
        ? 'Saved in this browser at ' + new Date().toLocaleTimeString('en-GB')
        : 'Could not save. Export instead.';
    }
    refreshCount();
    return ok;
  }

  function refreshCount() {
    var n = Object.keys(state.tables).length + Object.keys(state.cities).length + state.added.length;
    var el = document.getElementById('edit-count');
    if (el) { el.textContent = n; }
    var reset = document.getElementById('reset-all');
    if (reset) { reset.disabled = n === 0; }
  }

  /* ---------------- table identity ----------------
   * An index alone breaks the moment a table is added above. A caption slug is
   * stable across edits to the prose, so use it first and fall back to the index. */
  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  }
  function tableId(table, i) {
    if (table.dataset.tid) { return table.dataset.tid; }
    var cap = table.querySelector('caption');
    var head = Array.prototype.slice.call(table.querySelectorAll('thead th'))
      .map(function (th) { return th.textContent; }).join(' ');
    var id = slug(cap ? cap.textContent.slice(0, 60) : head.slice(0, 60)) || ('t' + i);
    table.dataset.tid = id + '-' + i;
    return table.dataset.tid;
  }

  /* ---------------- static tables ---------------- */
  var tables = [];

  function columnCount(table) {
    var head = table.querySelector('thead tr');
    if (!head) { return 2; }
    return Array.prototype.slice.call(head.children).reduce(function (n, th) {
      return n + (th.classList.contains('rowtools') ? 0 : (parseInt(th.colSpan, 10) || 1));
    }, 0);
  }

  /* isHeader must be passed explicitly: a freshly created row has no parentElement
     yet, and reading it here threw and silently killed the "add a row" handler. */
  function addRowTools(tr, isHeader) {
    if (tr.querySelector('.rowtools')) { return; }
    var td = document.createElement(isHeader ? 'th' : 'td');
    td.className = 'rowtools';
    if (td.tagName === 'TH') {
      td.innerHTML = '<span class="vh">Row actions</span>';
      td.setAttribute('scope', 'col');
    } else {
      td.innerHTML =
        '<button type="button" data-act="dup" title="Duplicate this row">+</button>' +
        '<button type="button" data-act="del" title="Delete this row">&times;</button>';
    }
    tr.insertBefore(td, tr.firstChild);
  }

  /* contenteditable and the row-tools column are added only while edit mode is on.
     Leaving them in place would let a reader retype a cell by accident, and the
     extra leading cell would take over the sticky first column on the wide board. */
  function setCellsEditable(table, on) {
    table.querySelectorAll('tbody td, tbody th, thead th').forEach(function (c) {
      if (c.classList.contains('rowtools')) { return; }
      if (on) { c.setAttribute('contenteditable', 'true'); }
      else { c.removeAttribute('contenteditable'); }
    });
  }

  function setRowTools(table, on) {
    if (on) {
      table.querySelectorAll('tr').forEach(function (tr) {
        addRowTools(tr, tr.closest('thead') !== null);
      });
    } else {
      table.querySelectorAll('.rowtools').forEach(function (n) { n.remove(); });
    }
  }

  function setEditing(on) {
    tables.forEach(function (t) {
      setRowTools(t, on);
      setCellsEditable(t, on);
    });
  }

  function blankRow(table) {
    var tr = document.createElement('tr');
    var n = columnCount(table);
    for (var i = 0; i < n; i++) {
      var td = document.createElement('td');
      td.innerHTML = '&nbsp;';
      td.setAttribute('contenteditable', 'true');
      tr.appendChild(td);
    }
    if (document.body.classList.contains('editing')) { addRowTools(tr, false); }
    return tr;
  }

  function markEdited(table) {
    var wrap = table.closest('.scroll');
    if (wrap) { wrap.classList.add('is-edited'); }
  }

  function snapshot(table) {
    var clone = table.querySelector('tbody').cloneNode(true);
    clone.querySelectorAll('.rowtools').forEach(function (n) { n.remove(); });
    clone.querySelectorAll('[contenteditable]').forEach(function (n) { n.removeAttribute('contenteditable'); });
    return clone.innerHTML;
  }

  function store(table) {
    state.tables[tableId(table)] = snapshot(table);
    markEdited(table);
    persist();
  }

  function restore(table, i) {
    var html = state.tables[tableId(table, i)];
    if (html == null) { return false; }
    table.querySelector('tbody').innerHTML = html;
    markEdited(table);
    return true;
  }

  function wire(table, i) {
    var id = tableId(table, i);
    var tbody = table.querySelector('tbody');
    if (!tbody) { return; }
    if (GENERATED.indexOf(tbody.id) !== -1) { return; }

    tables.push(table);
    restore(table, i);


    // caption gets an edited badge
    var wrap = table.closest('.scroll');
    var cap = table.querySelector('caption');
    if (cap && !cap.querySelector('.edited-badge')) {
      var b = document.createElement('span');
      b.className = 'edited-badge';
      b.textContent = 'edited locally';
      cap.appendChild(b);
    }

    tbody.addEventListener('input', function () { store(table); });
    tbody.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) { return; }
      var tr = btn.closest('tr');
      if (btn.dataset.act === 'del') {
        if (tr.parentElement.rows.length <= 1) { return; }
        tr.remove();
      } else {
        var copy = tr.cloneNode(true);
        copy.querySelectorAll('[contenteditable]').forEach(function (c) { c.innerHTML = '&nbsp;'; });
        tr.parentElement.insertBefore(copy, tr.nextSibling);
      }
      store(table);
    });

    // per-table action bar
    if (wrap && !wrap.querySelector('.tbl-actions')) {
      var bar = document.createElement('div');
      bar.className = 'tbl-actions';
      var add = document.createElement('button');
      add.type = 'button';
      add.textContent = 'Add a row';
      add.addEventListener('click', function () {
        tbody.appendChild(blankRow(table));
        store(table);
        var last = tbody.lastElementChild.querySelector('[contenteditable]');
        if (last) { last.focus(); }
      });
      var reset = document.createElement('button');
      reset.type = 'button';
      reset.textContent = 'Reset this table';
      reset.addEventListener('click', function () {
        if (!state.tables[id]) { return; }
        delete state.tables[id];
        persist();
        location.reload();
      });
      bar.appendChild(add);
      bar.appendChild(reset);
      wrap.appendChild(bar);
    }
  }

  /* ---------------- model-backed editing ---------------- */
  function applyCityOverrides() {
    var D = window.RELOCATION_DATA;
    if (!D) { return; }

    state.added.forEach(function (c) {
      if (!D.cities.some(function (x) { return x.id === c.id; })) { D.cities.push(c); }
    });

    Object.keys(state.cities).forEach(function (id) {
      var c = D.cities.filter(function (x) { return x.id === id; })[0];
      if (!c) { return; }
      var o = state.cities[id];
      if (o.scores) { Object.keys(o.scores).forEach(function (k) { c.scores[k] = o.scores[k]; }); }
      if (o.rw && c.rw) { Object.keys(o.rw).forEach(function (k) { c.rw[k] = o.rw[k]; }); }
      if (o.floor) { c.floor = o.floor; }
    });
  }

  function saveScore(cityId, key, value) {
    if (!state.cities[cityId]) { state.cities[cityId] = {}; }
    if (!state.cities[cityId].scores) { state.cities[cityId].scores = {}; }
    state.cities[cityId].scores[key] = value;
    var D = window.RELOCATION_DATA;
    var c = D.cities.filter(function (x) { return x.id === cityId; })[0];
    if (c) { c.scores[key] = value; }
    persist();
    if (window.HOUSING_MODEL) { window.HOUSING_MODEL.rerender(); }
  }

  function saveRunway(cityId, rw) {
    if (!state.cities[cityId]) { state.cities[cityId] = {}; }
    state.cities[cityId].rw = rw;
    var D = window.RELOCATION_DATA;
    var c = D.cities.filter(function (x) { return x.id === cityId; })[0];
    if (c && c.rw) { Object.keys(rw).forEach(function (k) { c.rw[k] = rw[k]; }); }
    persist();
    if (window.HOUSING_MODEL) { window.HOUSING_MODEL.rerender(); }
  }

  function addCity(city) {
    state.added.push(city);
    window.RELOCATION_DATA.cities.push(city);
    persist();
    if (window.HOUSING_MODEL) { window.HOUSING_MODEL.rerender(); }
  }

  /* ---------------- toolbar ---------------- */
  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function buildToolbar() {
    var bar = document.getElementById('toolbar');
    if (!bar) { return; }

    document.getElementById('edit-toggle').addEventListener('click', function () {
      var on = document.body.classList.toggle('editing');
      setEditing(on);
      this.textContent = on ? 'Done editing' : 'Edit tables';
      this.setAttribute('aria-pressed', on ? 'true' : 'false');
      document.getElementById('edit-help').hidden = !on;
    });

    document.getElementById('export-edits').addEventListener('click', function () {
      download('housing-edits.json', JSON.stringify(state, null, 2), 'application/json');
    });

    var file = document.getElementById('import-file');
    document.getElementById('import-edits').addEventListener('click', function () { file.click(); });
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      if (!f) { return; }
      var r = new FileReader();
      r.onload = function () {
        try {
          var incoming = JSON.parse(r.result);
          if (!incoming || typeof incoming !== 'object') { throw new Error('not an object'); }
          state = {
            tables: incoming.tables || {},
            cities: incoming.cities || {},
            added: incoming.added || []
          };
          persist();
          location.reload();
        } catch (err) {
          alert('That file could not be read as an edits file.');
        }
      };
      r.readAsText(f);
    });

    document.getElementById('reset-all').addEventListener('click', function () {
      if (!confirm('Discard every local edit and go back to the published document?')) { return; }
      state = { tables: {}, cities: {}, added: [] };
      persist();
      location.reload();
    });
  }

  /* ---------------- go ---------------- */
  applyCityOverrides();

  window.HOUSING_EDIT = {
    saveScore: saveScore,
    saveRunway: saveRunway,
    addCity: addCity,
    isEditing: function () { return document.body.classList.contains('editing'); }
  };

  document.addEventListener('DOMContentLoaded', function () {
    buildToolbar();
    document.querySelectorAll('table').forEach(wire);
    refreshCount();
    var n = Object.keys(state.tables).length + Object.keys(state.cities).length + state.added.length;
    if (n > 0) {
      var el = document.getElementById('save-state');
      if (el) { el.textContent = 'Local edits are being applied.'; }
    }
  });
})();
