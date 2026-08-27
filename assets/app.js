/* ==========================================================================
   Funnel Dashboard — motor
   Sin dependencias externas. Todo el comportamiento es config-driven:
   para un cliente nuevo solo se crea clients/<id>.json y se abre
   index.html?client=<id>

   Vistas: Resumen · Ventas · Personas · Webinars
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var VIEWS = ['resumen', 'ventas', 'personas', 'webinars'];

  // ------------------------------------------------------------------ estado
  var S = {
    clientId: new URLSearchParams(location.search).get('client') || 'rpa',
    config: null,
    raw: null,
    people: [],
    byKey: Object.create(null),

    view: 'resumen',
    mode: 'simple',   // 'simple' para el cliente | 'detailed' para el equipo
    range: 30,           // numero de dias | 'all' | 'custom'
    from: null,          // Date | null
    to: null,            // Date | null
    compare: false,

    stageFilter: null,
    webinar: '',
    facets: Object.create(null),
    search: '',
    page: 0,
    pageSize: 25,
    sort: { key: 'lastSeen', dir: -1 },

    token: '',
    lastFetch: null,
    demo: false,
    error: null,
    timer: null,
    clock: null
  };

  var BAR = 'var(--s1)';   // el color no codifica nada: longitud + etiqueta directa

  // ------------------------------------------------------------- utilidades

  function loc() { return (S.config && S.config.client.locale) || 'es-CO'; }
  function nfmt(n) { return new Intl.NumberFormat(loc()).format(n); }
  function cfmt(n) {
    return new Intl.NumberFormat(loc(), {
      style: 'currency',
      currency: (S.config && S.config.client.currency) || 'USD',
      maximumFractionDigits: 0
    }).format(n || 0);
  }
  function pct(a, b) { return b > 0 ? (a / b) * 100 : 0; }
  function pfmt(v, d) { var m = Math.pow(10, d || 0); return (Math.round(v * m) / m) + '%'; }
  function xfmt(v) { return (Math.round(v * 100) / 100).toFixed(2) + '×'; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Acepta MM/DD/YYYY, MM/DD/YYYY HH:mm, ISO 8601 y YYYY-MM-DD. */
  function parseDate(v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    var s = String(v).trim();
    if (!s) return null;
    var m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[3], +m[1] - 1, +m[2], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
    var d = new Date(s);
    return isNaN(d) ? null : d;
  }

  function dfmt(d, withTime) {
    if (!d) return '—';
    var o = { day: '2-digit', month: 'short', year: 'numeric' };
    if (withTime) { o.hour = '2-digit'; o.minute = '2-digit'; }
    return d.toLocaleDateString(loc(), o);
  }
  function iso(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      + '-' + String(d.getDate()).padStart(2, '0');
  }
  function daysBetween(a, b) { return Math.round((b - a) / 86400000); }

  function normKey(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
  function digits(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }

  function getPath(obj, path) {
    var parts = String(path).split('.'), cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  /** "$3,998.00" -> 3998 ; "63.16%" -> 63.16 ; "" -> null */
  function num(v) {
    if (v == null) return null;
    var s = String(v).replace(/[^0-9.\-]/g, '');
    if (s === '' || s === '-' || s === '.') return null;
    var n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  /** map.name acepta una columna o un array ("First Name" + "Last Name"). */
  function readName(row, spec) {
    if (!spec) return '';
    var cols = Array.isArray(spec) ? spec : [spec];
    return cols.map(function (c) { return String(row[c] || '').trim(); })
      .filter(Boolean).join(' ').trim();
  }

  /** Ultimos 10 digitos: 61427511451 y 0427511451 son la misma persona. */
  function phoneKey(v) {
    var d = digits(v);
    return d.length < 9 ? '' : d.slice(-10);
  }

  // ------------------------------------------------------------------ carga

  function loadConfig() {
    return fetch('clients/' + encodeURIComponent(S.clientId) + '.json', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('No se encontro clients/' + S.clientId + '.json');
        return r.json();
      });
  }

  /** La clave vive solo en este navegador. No va en el repo ni en la pagina
   *  publicada: sin ella el endpoint responde 'unauthorized' y no hay datos. */
  var LS_KEY = 'fd-key-';
  function storedKey() {
    try { return localStorage.getItem(LS_KEY + S.clientId) || ''; } catch (e) { return ''; }
  }
  function storeKey(k) {
    try { localStorage.setItem(LS_KEY + S.clientId, k); } catch (e) { }
  }
  function clearKey() {
    try { localStorage.removeItem(LS_KEY + S.clientId); } catch (e) { }
  }
  function activeToken() { return S.token || storedKey() || (S.config.source || {}).token || ''; }

  function fetchData() {
    var src = S.config.source || {};

    if (src.type === 'apps-script' && src.url) {
      var u = src.url + (src.url.indexOf('?') === -1 ? '?' : '&')
        + 'token=' + encodeURIComponent(activeToken()) + '&_=' + Date.now();
      return fetch(u, { redirect: 'follow', cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status + ' al consultar el Apps Script');
          return r.json();
        })
        .then(function (j) {
          if (!j || j.ok === false) {
            if (j && j.error === 'unauthorized') {
              var e401 = new Error('That access key is not valid.');
              e401.unauthorized = true;
              throw e401;
            }
            throw new Error((j && j.error) || 'Unexpected response from Apps Script');
          }
          return j;
        });
    }
    if (src.type === 'gviz' && src.spreadsheetId) return fetchGviz(src.spreadsheetId);
    return Promise.reject(new Error('no-source'));
  }

  /** Alternativa sin Apps Script: leer cada pestana via el endpoint gviz. */
  function fetchGviz(id) {
    var tabs = {};
    (S.config.stages || []).forEach(function (st) { tabs[st.tab] = 1; });
    if (S.config.events) tabs[S.config.events.tab] = 1;
    var names = Object.keys(tabs);

    return Promise.all(names.map(function (name) {
      var u = 'https://docs.google.com/spreadsheets/d/' + id
        + '/gviz/tq?tqx=out:json&sheet=' + encodeURIComponent(name) + '&_=' + Date.now();
      return fetch(u, { cache: 'no-store' })
        .then(function (r) { return r.text(); })
        .then(function (t) {
          var m = t.match(/setResponse\(([\s\S]*)\);?\s*$/);
          if (!m) throw new Error('La hoja "' + name + '" no esta publicada o no existe');
          var j = JSON.parse(m[1]);
          var cols = (j.table.cols || []).map(function (c) {
            return String(c.label || c.id || '').replace(/\s+/g, ' ').trim();
          });
          var rows = (j.table.rows || []).map(function (r) {
            var o = {};
            (r.c || []).forEach(function (cell, i) {
              if (!cols[i]) return;
              o[cols[i]] = cell ? (cell.f != null ? String(cell.f) : (cell.v != null ? String(cell.v) : '')) : '';
            });
            return o;
          });
          return { name: name, rows: rows };
        });
    })).then(function (parts) {
      var out = {};
      parts.forEach(function (p) { out[p.name] = p.rows; });
      return {
        ok: true, spreadsheet: 'Google Sheet', updatedAt: new Date().toISOString(),
        tabs: out, meta: parts.map(function (p) { return { tab: p.name, rows: p.rows.length }; })
      };
    });
  }

  function loadDemo() {
    var path = (S.config.source && S.config.source.demoFallback) || 'data/demo.json';
    return fetch(path, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('No se pudo cargar el dataset de demostracion');
      return r.json();
    });
  }

  // ------------------------------------------------------------ normalizado

  function matchesWhen(row, when) {
    if (!when) return true;
    var v = String(row[when.field] == null ? '' : row[when.field]).trim();
    if (when.in) return when.in.some(function (x) { return String(x).toLowerCase() === v.toLowerCase(); });
    if (when.notIn) return !when.notIn.some(function (x) { return String(x).toLowerCase() === v.toLowerCase(); });
    if (when.equals != null) return String(when.equals).toLowerCase() === v.toLowerCase();
    if (when.notEmpty) return v !== '';
    return true;
  }

  /** Lee la fecha de una fila probando map.date y luego map.dateFallback.
   *  Necesario porque columnas como "Closed" mezclan formatos: traen "Yes"
   *  en los registros viejos y fechas ISO en los nuevos. Sin respaldo, esos
   *  cierres quedarian fuera del reporte de ventas. */
  function rowDate(row, st) {
    var d = parseDate(row[st.map.date]);
    if (d) return d;
    var fb = st.map.dateFallback;
    if (!fb) return null;
    var cols = Array.isArray(fb) ? fb : [fb];
    for (var i = 0; i < cols.length; i++) {
      d = parseDate(row[cols[i]]);
      if (d) return d;
    }
    return null;
  }

  // --- Resolucion de identidad (union-find) --------------------------------
  // Una misma persona aparece con emails distintos entre pestanas
  // (sounnesschiropractic1@ vs sounnesschiro@) y con erratas de tipeo
  // (cat@edrut.org vs cat@edrut.oeg). Se unen los registros que comparten
  // CUALQUIER identificador: email, GHL ID o telefono.
  function makeUF() {
    var parent = Object.create(null);
    function find(x) {
      if (parent[x] === undefined) { parent[x] = x; return x; }
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    }
    return {
      find: find,
      union: function (a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }
    };
  }

  function normalize(payload) {
    var tabs = payload.tabs || {};
    var stages = S.config.stages || [];
    var ident = S.config.identity || {};
    var mergePhone = ident.mergeOnPhone !== false;
    var idField = ident.idField || 'GHL ID';

    var records = [];
    stages.forEach(function (st, idx) {
      (tabs[st.tab] || []).forEach(function (row) {
        if (!matchesWhen(row, st.when)) return;

        var email = normKey(row[st.map.email]);
        var ghl = String(row[st.map.id || idField] || '').trim();
        var phone = phoneKey(row[st.map.phone]);
        var name = readName(row, st.map.name);

        var ids = [];
        if (email) ids.push('e:' + email);
        if (ghl) ids.push('g:' + ghl);
        if (mergePhone && phone) ids.push('p:' + phone);
        if (!ids.length && name) ids.push('n:' + normKey(name));
        if (!ids.length) return;

        records.push({
          st: st, idx: idx, row: row, ids: ids,
          email: email, ghl: ghl, phone: digits(row[st.map.phone]), name: name
        });
      });
    });

    var uf = makeUF();
    records.forEach(function (r) {
      for (var i = 1; i < r.ids.length; i++) uf.union(r.ids[0], r.ids[i]);
    });

    var groups = Object.create(null);
    records.forEach(function (r) {
      var root = uf.find(r.ids[0]);
      (groups[root] || (groups[root] = [])).push(r);
    });

    return Object.keys(groups).map(function (root) {
      var p = {
        key: root, email: '', phone: '', name: '', emails: [],
        stages: Object.create(null), dates: Object.create(null),
        raw: Object.create(null), rows: Object.create(null),
        values: Object.create(null), value: 0,
        firstSeen: null, lastSeen: null
      };

      groups[root].forEach(function (r) {
        var st = r.st;
        if (!p.name && r.name) p.name = r.name;
        if (!p.email && r.email) p.email = r.email;
        if (!p.phone && r.phone) p.phone = r.phone;
        if (r.email && p.emails.indexOf(r.email) === -1) p.emails.push(r.email);

        p.stages[st.id] = true;
        if (!p.raw[st.id]) p.raw[st.id] = r.row;
        (p.rows[st.id] || (p.rows[st.id] = [])).push(r.row);

        var d = rowDate(r.row, st);
        if (d && (!p.dates[st.id] || d < p.dates[st.id])) p.dates[st.id] = d;
        if (d) {
          if (!p.firstSeen || d < p.firstSeen) p.firstSeen = d;
          if (!p.lastSeen || d > p.lastSeen) p.lastSeen = d;
        }

        if (st.map.value) {
          var n = num(r.row[st.map.value]);
          if (n != null) {
            p.values[st.id] = (p.values[st.id] || 0) + n;
            p.value += n;
          }
        }
      });

      if (!p.name) p.name = p.email || p.phone || '(sin nombre)';
      return p;
    });
  }

  // ------------------------------------------------------- ventanas de fecha

  function refDate() {
    var now = new Date(), latest = null;
    S.people.forEach(function (p) { if (p.lastSeen && (!latest || p.lastSeen > latest)) latest = p.lastSeen; });
    return (latest && latest > now) ? latest : now;
  }

  function monthWindow(offset) {
    var ref = refDate();
    var y = ref.getFullYear(), m = ref.getMonth() + (offset || 0);
    var from = new Date(y, m, 1, 0, 0, 0, 0);
    var to = new Date(y, m + 1, 0, 23, 59, 59, 999);
    if (!offset && to > ref) to = ref;      // el mes en curso corta hoy
    return { from: from, to: to };
  }

  function currentWindow() {
    if (S.range === 'mtd') return monthWindow(0);
    if (S.range === 'lastmonth') return monthWindow(-1);
    if (S.range === 'custom' && (S.from || S.to)) {
      var f = S.from ? new Date(S.from) : null;
      var t = S.to ? new Date(S.to) : refDate();
      if (t) { t = new Date(t); t.setHours(23, 59, 59, 999); }
      return { from: f, to: t };
    }
    if (S.range === 'all') return { from: null, to: null };
    var end = refDate();
    return { from: new Date(end.getTime() - Number(S.range) * 86400000), to: end };
  }

  function prevWindow() {
    if (S.range === 'mtd') return monthWindow(-1);
    if (S.range === 'lastmonth') return monthWindow(-2);
    var w = currentWindow();
    if (!w.from || !w.to) return null;
    var len = w.to - w.from;
    return { from: new Date(w.from.getTime() - len), to: new Date(w.from.getTime() - 1) };
  }

  function inWindow(d, w) {
    if (!d) return false;
    if (w.from && d < w.from) return false;
    if (w.to && d > w.to) return false;
    return true;
  }

  function windowLabel(w) {
    if (S.range === 'mtd' || S.range === 'lastmonth') {
      var name = w.from.toLocaleDateString(loc(), { month: 'long', year: 'numeric' });
      return name.charAt(0).toUpperCase() + name.slice(1)
        + (S.range === 'mtd' ? ' (month to date)' : '');
    }
    if (!w.from && !w.to) return 'all time';
    if (!w.from) return 'through ' + dfmt(w.to);
    return dfmt(w.from) + ' — ' + dfmt(w.to);
  }


  // ------------------------------------------------------ motor de pagos
  // Program Buyers es un LIBRO DE MOVIMIENTOS, no una lista de clientes:
  // una misma persona genera varias filas (entrada $29 + deposito $500 +
  // saldo $4.000) y las cuotas del split ($1.665 x3) reaparecen cada mes.
  // Contar filas seria contar tres clientes donde hay uno.
  //
  // Precios reales (sacados de los checkouts del proyecto):
  //   REVIVE Blueprint  $4.998 lista · $4.500 con cupon · 3 x $1.665 split
  //   Deposito $500 -> saldo $4.000 (PIF) o cuotas de $1.165 (split)
  //   REVIVE Roadmap (downsell) $497 · Entradas $29 / $44 / $88

  function txConfig() { return S.config.transactions || null; }

  function classifyTx(amount) {
    var cfg = txConfig();
    if (!cfg) return 'programa';
    var classes = cfg.classes || [];
    for (var i = 0; i < classes.length; i++) {
      var k = classes[i];
      if (k.amounts && k.amounts.some(function (a) { return Math.abs(a - amount) < 0.01; })) return k.id;
    }
    var def = classes.filter(function (k) { return k.default; })[0];
    return def ? def.id : 'programa';
  }

  function classLabel(id) {
    var k = ((txConfig() || {}).classes || []).filter(function (x) { return x.id === id; })[0];
    return k ? k.label : id;
  }

  function isExcludedPerson(p) {
    var ex = ((txConfig() || {}).exclude) || {};
    var mails = (ex.emails || []).map(normKey);
    if (!mails.length) return false;
    return p.emails.some(function (e) { return mails.indexOf(e) !== -1; });
  }

  /** Convierte el libro de movimientos en datos por persona. */
  function applyTransactions(people) {
    var cfg = txConfig();
    if (!cfg) return people;

    var st = stageById(cfg.stage);
    var ex = cfg.exclude || {};
    var markers = (ex.refundMarkers || []).map(function (m) { return String(m).toUpperCase(); });
    var custom = cfg.customerClasses || [];

    people.forEach(function (p) {
      p.tx = [];
      p.cash = 0;
      p.cashByClass = Object.create(null);
      p.customerAt = null;
      p.refunds = 0;
      p.excluded = isExcludedPerson(p);

      var rows = (st && p.rows[st.id]) || [];
      var seen = Object.create(null);

      rows.forEach(function (row) {
        var raw = String(row[cfg.amountField] == null ? '' : row[cfg.amountField]).trim();

        // Reembolsos: la hoja los escribe como texto en la columna del monto.
        if (markers.indexOf(raw.toUpperCase()) !== -1) { p.refunds++; return; }

        var amount = num(raw);
        if (amount == null || amount <= 0) return;
        if (ex.maxTestAmount != null && amount <= ex.maxTestAmount) return;

        var d = rowDate(row, st);

        // Filas duplicadas: mismo monto, misma persona, dentro de N minutos.
        // El caso real que lo motivo: US$988 cobrado dos veces con 3 minutos
        // de diferencia, mismo GHL ID y misma nota.
        var win = cfg.dedupeWindowMinutes || (cfg.dedupeSameMinute ? 1 : 0);
        if (win && d) {
          var slot = Math.round(d.getTime() / 60000);
          var dup = false;
          for (var off = -win; off <= win && !dup; off++) {
            if (seen[amount + '@' + (slot + off)]) dup = true;
          }
          if (dup) { p.dupes = (p.dupes || 0) + 1; return; }
          seen[amount + '@' + slot] = 1;
        }

        var cls = classifyTx(amount);
        p.tx.push({ date: d, amount: amount, cls: cls, row: row });
        p.cash += amount;
        p.cashByClass[cls] = (p.cashByClass[cls] || 0) + amount;

        // La fecha de adquisicion es el PRIMER pago de programa o deposito.
        // Las cuotas siguientes suman caja pero no crean otro cliente.
        if (d && custom.indexOf(cls) !== -1 && (!p.customerAt || d < p.customerAt)) {
          p.customerAt = d;
        }
      });

      p.tx.sort(function (a, b) {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return b.date - a.date;
      });

      // Valor de contrato: lo que se firmo, no lo que ya entro en caja.
      // Una persona puede tener VARIAS filas de ticket (compro en abril y otra
      // vez en junio). El Program Revenue suele estar en la ultima, no en la
      // primera, asi que se recorren todas en vez de mirar solo p.raw.
      var field = S.config.contractField || 'Program Revenue';
      var rawContract = 0;
      [cfg.contractStage || 'closed', S.config.contractStage || 'ticket'].forEach(function (sid) {
        if (rawContract) return;
        (p.rows[sid] || []).forEach(function (row) {
          if (rawContract) return;
          var v = num(row[field]);
          if (v) rawContract = v;
        });
      });
      // Un "contrato" de $497 es el downsell, no el programa: no infla el valor.
      p.contract = ((cfg.customerClasses || []).indexOf(classifyTx(rawContract)) !== -1)
        ? rawContract : 0;
      p.programCash = 0;
    });

    // --- Etapa derivada "cliente del programa" -----------------------------
    // Hay DOS fuentes y ninguna sola alcanza:
    //   · Program Buyers (libro de movimientos) arranca el 2026-07-07.
    //   · Ticket Buyers, columna "Closed", cubre desde abril pero mezcla
    //     formatos ("Yes" en los viejos, fecha ISO en los nuevos).
    // Usar solo el libro perderia los 32 cierres anteriores a julio.
    // Cliente = tiene pago de programa O tiene "Closed"; la fecha de
    // adquisicion es la mas temprana de las dos.
    (S.config.stages || []).forEach(function (sd) {
      if (sd.derived !== 'customer') return;

      people.forEach(function (p) {
        // La columna "Closed" de Ticket Buyers es la fuente autoritativa: es
        // lo que el equipo marca a mano cuando alguien cierra de verdad.
        //
        // El libro NO puede usarse para fechar la adquisicion: empieza el
        // 2026-07-07, asi que la cuota de agosto de alguien que cerro en mayo
        // parecia su "primer pago" e inflaba los clientes nuevos del mes.
        //
        // Y "Closed" por si sola tampoco basta: marca cerrado a quien solo
        // compro el Roadmap de $497. Tiene que ser un monto del programa.
        var fromColumn = null;
        if (p.dates[sd.id]) {
          var contractCls = classifyTx(num((p.raw[sd.id] || {})['Program Revenue']) || 0);
          if ((cfg.customerClasses || []).indexOf(contractCls) !== -1) fromColumn = p.dates[sd.id];
        }

        // Pago real del programa sin cierre marcado: no se cuenta como cliente,
        // pero tampoco se descarta en silencio. Se reporta aparte.
        var ledgerAt = null;
        (p.tx || []).forEach(function (x) {
          if (!x.date) return;
          if ((cfg.customerClasses || []).indexOf(x.cls) === -1) return;
          if (!ledgerAt || x.date < ledgerAt) ledgerAt = x.date;
        });

        if (!fromColumn) {
          delete p.stages[sd.id];
          delete p.dates[sd.id];
          delete p.values[sd.id];
          p.customerAt = null;
          if (ledgerAt) {
            p.pendingClose = true;
            p.pendingCloseAt = ledgerAt;
            p.pendingCloseAmount = p.programCash;
          }
          return;
        }

        var when = fromColumn;
        p.stages[sd.id] = true;
        p.customerAt = when;
        p.dates[sd.id] = when;
        if (!p.raw[sd.id] && p.raw.ticket) p.raw[sd.id] = p.raw.ticket;
        p.values[sd.id] = p.contract;   // ya viene filtrado por clase de pago

        p.customerSource = ledgerAt ? 'Sheet + ledger' : 'Sheet only';

        p.programCash = (cfg.programClasses || cfg.customerClasses || []).reduce(function (a, cl) {
          return a + (p.cashByClass[cl] || 0);
        }, 0);
        // Cerro segun la hoja pero no hay ni un cobro en el libro. Casi todos
        // son anteriores a julio de 2026, cuando el libro no existia: su caja
        // no esta auditada y se marca en vez de darla por buena.
        p.unverifiedCash = !p.programCash;
        p.value = (p.values.ticket || 0) + Math.max(p.programCash, 0);
        if (when && (!p.lastSeen || when > p.lastSeen)) p.lastSeen = when;
      });
    });

    return people.filter(function (p) { return !p.excluded; });
  }

  // ----------------------------------------------------------------- filtros


  function facetValue(p, f) {
    var row = p.raw[f.stage];
    return row ? String(row[f.field] == null ? '' : row[f.field]).trim() : '';
  }

  /** Cohorte: personas cuyo primer contacto cae dentro de la ventana. */
  function poolFor(w, opts) {
    opts = opts || {};
    var q = S.search.trim().toLowerCase();
    var fields = (S.config.table && S.config.table.searchFields) || ['name', 'email', 'phone'];
    var facets = S.config.facets || [];

    return S.people.filter(function (p) {
      if ((w.from || w.to) && !inWindow(p.firstSeen, w)) return false;
      if (S.webinar && webinarOfPerson(p) !== S.webinar) return false;
      if (opts.applyStage && S.stageFilter && !p.stages[S.stageFilter]) return false;

      for (var i = 0; i < facets.length; i++) {
        var sel = S.facets[facets[i].id];
        if (sel && facetValue(p, facets[i]) !== sel) return false;
      }
      if (q) {
        var hit = fields.some(function (f) {
          return String(getPath(p, f) || '').toLowerCase().indexOf(q) !== -1;
        });
        if (!hit) return false;
      }
      return true;
    });
  }

  // ------------------------------------------------------- etapas del embudo

  /** Solo las etapas con funnel !== false forman la cadena de conversion.
   *  Las demas (lead magnet, ledger de transacciones) alimentan el expediente
   *  y los segmentos, pero no el embudo. */
  function funnelStages() {
    return (S.config.stages || []).filter(function (st) { return st.funnel !== false; });
  }
  function stageById(id) {
    return (S.config.stages || []).filter(function (s) { return s.id === id; })[0] || null;
  }
  function funnelDepth(p) {
    var fs = funnelStages();
    for (var i = fs.length - 1; i >= 0; i--) if (p.stages[fs[i].id]) return i + 1;
    return 0;
  }
  function stageOf(p) {
    var d = funnelDepth(p);
    return d > 0 ? funnelStages()[d - 1] : null;
  }

  /** Dos formas de contar una etapa, y hay que ser explicito sobre cual:
   *
   *  'activity' — cuantas personas ENTRARON a esa etapa dentro del periodo.
   *      Responde "cuantos clientes nuevos hubo en agosto" = 7.
   *
   *  'cohort'   — de las personas que aparecieron por primera vez en el
   *      periodo, cuantas llegaron hasta esa etapa. Responde "de los leads
   *      de agosto, cuantos ya compraron" = 1, porque los otros 6 clientes
   *      de agosto habian comprado su ticket en junio o julio.
   *
   *  Mezclarlas hacia que la misma frase diera dos numeros distintos.
   */
  function stageCounts(pool, basis, w) {
    var out = {};
    (S.config.stages || []).forEach(function (st) {
      var reached = pool.filter(function (p) {
        if (!p.stages[st.id]) return false;
        if (basis !== 'activity' || !w || (!w.from && !w.to)) return true;
        return inWindow(p.dates[st.id], w);
      });
      out[st.id] = {
        id: st.id, label: st.label, short: st.short || st.label,
        count: reached.length,
        value: reached.reduce(function (a, p) { return a + (p.values[st.id] || 0); }, 0)
      };
    });
    return out;
  }

  function funnelData(pool) {
    var counts = stageCounts(pool, 'cohort');
    return funnelStages().map(function (st, i) {
      return Object.assign({ index: i }, counts[st.id]);
    });
  }

  // ------------------------------------------------------ eventos de dinero
  // El ingreso pertenece a la fecha del PAGO, no a la fecha de captacion:
  // alguien que compro el ticket en marzo y cerro en julio suma en julio.

  function revenueEvents(w, ignoreWebinarFilter) {
    var out = [];
    var cfg = txConfig();
    // Las entradas se cuentan desde Ticket Buyers (806 filas), no desde el
    // libro de movimientos (266): ahi solo esta un subconjunto. Contar las dos
    // duplicaria el ingreso de los tickets.
    var skip = (cfg && cfg.revenueSkipClasses) || ['entrada'];

    var entryStage = stageById((S.config.sales || {}).entryStage || 'ticket');
    if (entryStage && entryStage.map.value) {
      S.people.forEach(function (p) {
        (p.rows[entryStage.id] || []).forEach(function (row) {
          var amount = num(row[entryStage.map.value]);
          if (amount == null || amount <= 0) return;
          var d = rowDate(row, entryStage);
          if (!d || !inWindow(d, w)) return;
          out.push({
            date: d, amount: amount, cls: 'entrada',
            label: 'Entrada (webinar / workshop)',
            stage: entryStage, row: row, person: p
          });
        });
      });
    }

    if (cfg) {
      var txStage = stageById(cfg.stage);
      S.people.forEach(function (p) {
        (p.tx || []).forEach(function (t) {
          if (skip.indexOf(t.cls) !== -1) return;
          if (!t.date || !inWindow(t.date, w)) return;
          out.push({
            date: t.date, amount: t.amount, cls: t.cls,
            label: classLabel(t.cls), stage: txStage, row: t.row, person: p
          });
        });
      });
    }

    if (S.webinar && !ignoreWebinarFilter) {
      out = out.filter(function (e) { return webinarOfEvent(e) === S.webinar; });
    }
    return out.sort(function (a, b) { return b.date - a.date; });
  }

  /** Clientes nuevos: personas cuyo PRIMER pago de programa cae en la ventana. */
  function newCustomers(w) {
    return S.people.filter(function (p) {
      if (!p.customerAt || !inWindow(p.customerAt, w)) return false;
      if (S.webinar && webinarOfPerson(p) !== S.webinar) return false;
      return true;
    });
  }

  function sumBy(evs, classes) {
    return evs.reduce(function (a, e) {
      if (classes && classes.indexOf(e.cls) === -1) return a;
      return a + e.amount;
    }, 0);
  }
  function countBy(evs, classes) {
    return evs.filter(function (e) { return !classes || classes.indexOf(e.cls) !== -1; }).length;
  }


  // ------------------------------------------------------- dimension webinar
  // "Webinar Cycle Closed" solo esta lleno en los cierres (44 de 806 filas).
  // Para que el filtro por webinar cubra TAMBIEN las ventas de ticket, se
  // deduce el evento por fecha: un ticket pertenece al primer webinar que
  // ocurre en o despues de la compra, dentro de una ventana razonable.
  // Cada webinar "posee" el periodo que va desde el dia siguiente al webinar
  // anterior hasta el dia del webinar. Es como lo cuenta el equipo: todo el
  // que pago entre un webinar y el siguiente pertenece al siguiente.
  var FIRST_WINDOW_DAYS = 21;   // el primer webinar no tiene anterior

  function eventDates() {
    if (S._events) return S._events;
    var cfg = S.config.events;
    var rows = (cfg && S.raw && (S.raw.tabs || {})[cfg.tab]) || [];
    S._events = rows.map(function (r) { return parseDate(r[cfg.dateField]); })
      .filter(Boolean)
      .sort(function (a, b) { return a - b; });
    return S._events;
  }

  /** [{ date, from, to }] — un tramo por webinar, sin huecos ni solapes. */
  function webinarWindows() {
    if (S._winCache) return S._winCache;
    var evs = eventDates();
    S._winCache = evs.map(function (d, i) {
      var from = i === 0
        ? new Date(d.getTime() - FIRST_WINDOW_DAYS * 86400000)
        : new Date(evs[i - 1].getTime() + 86400000);
      var to = new Date(d.getTime());
      to.setHours(23, 59, 59, 999);
      return { date: d, key: iso(d), from: from, to: to };
    });
    return S._winCache;
  }

  function webinarFor(date) {
    if (!date) return '';
    var ws = webinarWindows();
    for (var i = 0; i < ws.length; i++) {
      if (date >= ws[i].from && date <= ws[i].to) return ws[i].key;
    }
    return '';   // pagado despues del ultimo webinar registrado
  }

  /** Webinar al que se atribuye una persona. */
  function webinarOfPerson(p) {
    if (p._webinar !== undefined) return p._webinar;
    var declared = (p.raw.closed && String(p.raw.closed['Webinar Cycle Closed'] || '').trim())
      || (p.raw.ticket && String(p.raw.ticket['Webinar Cycle Closed'] || '').trim()) || '';
    p._webinar = declared || webinarFor(p.dates.ticket || p.firstSeen) || '';
    return p._webinar;
  }

  /** Webinar al que se atribuye un pago concreto. */
  function webinarOfEvent(e) {
    if (e.cls === 'entrada') return webinarFor(e.date) || webinarOfPerson(e.person);
    var declared = e.person.raw.closed
      && String(e.person.raw.closed['Webinar Cycle Closed'] || '').trim();
    return declared || webinarOfPerson(e.person) || '';
  }

  function webinarLabel(v) {
    if (!v) return 'Unassigned';
    var d = parseDate(v);
    return d ? dfmt(d) : v;
  }

  function allWebinars() {
    return eventDates().map(function (d) { return iso(d); });
  }

  /** Inversion en ads de los webinars que caen en la ventana. */
  function adSpendIn(w) {
    var cfgS = (S.config.sales || {}).adSpendFrom;
    if (!cfgS || !S.raw) return null;
    var rows = (S.raw.tabs || {})[cfgS.tab] || [];
    var total = 0, found = false;
    rows.forEach(function (r) {
      var d = parseDate(r[cfgS.dateField]);
      if (!d || !inWindow(d, w)) return;
      if (S.webinar && iso(d) !== S.webinar) return;
      var v = num(r[cfgS.field]);
      if (v != null) { total += v; found = true; }
    });
    return found ? total : null;
  }

  // ------------------------------------------------------------------ charts

  var tipEl;
  function showTip(html, x, y) {
    tipEl = tipEl || $('#tooltip');
    tipEl.innerHTML = html;
    tipEl.setAttribute('data-show', '1');
    var r = tipEl.getBoundingClientRect();
    var left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    tipEl.style.left = Math.max(8, left) + 'px';
    tipEl.style.top = Math.max(8, top) + 'px';
  }
  function hideTip() {
    tipEl = tipEl || $('#tooltip');
    tipEl.setAttribute('data-show', '0');
  }

  /** Serie temporal compacta. Una escala propia por grafico: nunca dos ejes. */
  function drawSpark(host, series, buckets, bucketDays, fmt) {
    fmt = fmt || nfmt;
    var W = 300, H = 86, PL = 34, PR = 6, PT = 8, PB = 18;
    var vals = series.values;
    var max = Math.max.apply(null, vals.concat([1]));
    var n = vals.length;
    var x = function (i) { return PL + (n === 1 ? 0 : (i / (n - 1)) * (W - PL - PR)); };
    var y = function (v) { return PT + (1 - v / max) * (H - PT - PB); };

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'chart');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', series.label + ': ' + fmt(series.total) + ' en el periodo');
    svg.style.height = H + 'px';
    svg.style.width = '100%';

    var parts = [];
    [0, max].forEach(function (v) {
      parts.push('<line class="gridline" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>');
      parts.push('<text class="tick" x="' + (PL - 5) + '" y="' + (y(v) + 3.5) + '" text-anchor="end">'
        + esc(fmt(v)) + '</text>');
    });

    var d = vals.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' ');
    parts.push('<path d="' + d + ' L' + x(n - 1).toFixed(1) + ' ' + y(0) + ' L' + x(0).toFixed(1) + ' ' + y(0)
      + ' Z" fill="' + BAR + '" opacity="0.12"/>');
    parts.push('<path class="series-line" d="' + d + '" stroke="' + BAR + '"/>');
    parts.push('<circle class="dot" cx="' + x(n - 1).toFixed(1) + '" cy="' + y(vals[n - 1]).toFixed(1)
      + '" r="3.5" fill="' + BAR + '"/>');
    parts.push('<line class="axisline" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + (H - PB) + '" y2="' + (H - PB) + '"/>');
    parts.push('<text class="tick" x="' + PL + '" y="' + (H - 5) + '">' + esc(buckets[0].label) + '</text>');
    parts.push('<text class="tick" x="' + (W - PR) + '" y="' + (H - 5) + '" text-anchor="end">'
      + esc(buckets[n - 1].label) + '</text>');
    parts.push('<line class="crosshair" x1="0" x2="0" y1="' + PT + '" y2="' + (H - PB) + '" opacity="0" data-cross="1"/>');
    parts.push('<rect class="hitrect" x="' + PL + '" y="0" width="' + (W - PL - PR) + '" height="' + H + '"/>');

    svg.innerHTML = parts.join('');
    host.appendChild(svg);

    var cross = svg.querySelector('[data-cross]');
    svg.querySelector('.hitrect').addEventListener('mousemove', function (e) {
      var box = svg.getBoundingClientRect();
      var rel = ((e.clientX - box.left) / box.width) * W;
      var i = Math.max(0, Math.min(n - 1, Math.round(((rel - PL) / (W - PL - PR)) * (n - 1))));
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', '1');
      showTip('<div class="tt-title">' + esc(series.label) + '</div>'
        + '<div class="tt-row"><span>' + (bucketDays === 1 ? '' : 'Semana al ') + esc(buckets[i].label)
        + '</span><b>' + esc(fmt(vals[i])) + '</b></div>', e.clientX, e.clientY);
    });
    svg.querySelector('.hitrect').addEventListener('mouseleave', function () {
      cross.setAttribute('opacity', '0'); hideTip();
    });
  }

  /** Barras horizontales de una sola serie. items: [{key, count, n?}] */
  function drawBars(host, items, denom, title, opts) {
    opts = opts || {};
    var fmtVal = opts.fmt || nfmt;
    var showPct = opts.showPct !== false;
    var valueLabel = opts.valueLabel || 'People';

    var rowH = 30, PT = 6, PB = 2;
    var W = 520, PL = opts.labelWidth || 190, PR = 62;
    var H = PT + PB + items.length * rowH;
    var max = Math.max.apply(null, items.map(function (i) { return i.count; }).concat([1]));

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'chart');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', title);
    svg.style.width = '100%';
    svg.style.height = H + 'px';

    var parts = [];
    items.forEach(function (it, i) {
      var y = PT + i * rowH, bh = 15;
      var bw = Math.max((it.count / max) * (W - PL - PR), it.count > 0 ? 2 : 0);
      var label = it.key.length > 30 ? it.key.slice(0, 29) + '…' : it.key;
      var color = it.isOther ? 'var(--ink-muted)' : BAR;

      parts.push('<text class="lbl" x="' + (PL - 10) + '" y="' + (y + bh / 2 + 4.5) + '" text-anchor="end">'
        + esc(label) + '<title>' + esc(it.key) + '</title></text>');
      parts.push('<rect class="hbar" x="' + PL + '" y="' + y + '" width="' + bw.toFixed(1) + '" height="' + bh
        + '" rx="4" fill="' + color + '"/>');
      parts.push('<text class="val" x="' + (PL + bw + 8).toFixed(1) + '" y="' + (y + bh / 2 + 4.5) + '">'
        + esc(fmtVal(it.count)) + '</text>');
      parts.push('<rect class="hbar-hit" x="0" y="' + (y - 5) + '" width="' + W + '" height="' + (bh + 10)
        + '" data-i="' + i + '"/>');
    });
    parts.push('<line class="axisline" x1="' + PL + '" x2="' + PL + '" y1="' + PT + '" y2="' + (H - PB) + '"/>');

    svg.innerHTML = parts.join('');
    host.appendChild(svg);

    svg.querySelectorAll('.hbar-hit').forEach(function (r) {
      r.addEventListener('mousemove', function (e) {
        var it = items[+r.getAttribute('data-i')];
        showTip('<div class="tt-title">' + esc(it.key) + '</div>'
          + '<div class="tt-row"><span>' + esc(valueLabel) + '</span><b>' + esc(fmtVal(it.count)) + '</b></div>'
          + (it.n != null ? '<div class="tt-row"><span>People</span><b>' + nfmt(it.n) + '</b></div>' : '')
          + (showPct && denom ? '<div class="tt-row"><span>Of total</span><b>'
            + pfmt(pct(it.count, denom), 1) + '</b></div>' : ''),
          e.clientX, e.clientY);
      });
      r.addEventListener('mouseleave', hideTip);
    });

    if (opts.table !== false) {
      var det = document.createElement('details');
      det.className = 'table-toggle';
      det.innerHTML = '<summary>View as table</summary>'
        + '<table class="datatable"><thead><tr><th>Category</th><th>' + esc(valueLabel) + '</th>'
        + (items[0] && items[0].n != null ? '<th>People</th>' : '')
        + (showPct && denom ? '<th>%</th>' : '') + '</tr></thead><tbody>'
        + items.map(function (it) {
          return '<tr><td>' + esc(it.key) + '</td><td>' + esc(fmtVal(it.count)) + '</td>'
            + (it.n != null ? '<td>' + nfmt(it.n) + '</td>' : '')
            + (showPct && denom ? '<td>' + pfmt(pct(it.count, denom), 1) + '</td>' : '') + '</tr>';
        }).join('') + '</tbody></table>';
      host.appendChild(det);
    }
  }

  /** Agrupa una categoria con cola larga sin inventar colores nuevos. */
  /** Agrupa valores que solo difieren en mayusculas o espacios.
   *  La hoja trae "Direct" y "direct", "RPA - Alienation..." y "Rpa - alienation...":
   *  sin esto una misma categoria se parte en dos y ambas quedan subestimadas.
   *  Se conserva la grafia mas frecuente como etiqueta visible. */
  function makeGrouper() {
    var buckets = Object.create(null);
    return {
      add: function (raw, amount) {
        var v = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
        if (!v) return null;
        var k = v.toLowerCase();
        var b = buckets[k] || (buckets[k] = { total: 0, variants: Object.create(null) });
        b.variants[v] = (b.variants[v] || 0) + 1;
        b.total += (amount == null ? 1 : amount);
        return k;
      },
      label: function (k) {
        var vs = buckets[k].variants;
        return Object.keys(vs).sort(function (a, b) { return vs[b] - vs[a]; })[0];
      },
      keys: function () { return Object.keys(buckets); }
    };
  }

  function foldTail(items, keep) {
    keep = keep || 10;
    if (items.length <= keep + 1) return items;
    var head = items.slice(0, keep);
    var rest = items.slice(keep);
    var sum = rest.reduce(function (a, i) { return a + i.count; }, 0);
    var n = rest.reduce(function (a, i) { return a + (i.n || 0); }, 0);
    head.push({ key: 'Other (' + rest.length + ')', count: sum, n: n || null, isOther: true });
    return head;
  }

  function buckets(w, maxDays) {
    var end = w.to || refDate();
    var start = w.from || new Date(end.getTime() - (maxDays || 180) * 86400000);
    var span = Math.max(1, daysBetween(start, end));
    var bd = span <= 31 ? 1 : (span <= 200 ? 7 : 30);
    var n = Math.max(2, Math.ceil(span / bd));
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var to = new Date(end.getTime() - i * bd * 86400000);
      out.push({ from: new Date(to.getTime() - bd * 86400000), to: to, label: dfmt(to) });
    }
    return { list: out, bucketDays: bd };
  }

  function bucketize(bk, items, dateOf, valueOf) {
    var vals = bk.list.map(function () { return 0; });
    items.forEach(function (it) {
      var d = dateOf(it);
      if (!d) return;
      for (var b = 0; b < bk.list.length; b++) {
        if (d > bk.list[b].from && d <= bk.list[b].to) { vals[b] += valueOf ? valueOf(it) : 1; break; }
      }
    });
    return vals;
  }


  // ------------------------------------------------- modo simple / detallado
  // El cliente no es marketero: por defecto ve lenguaje llano y solo lo que
  // necesita para decidir. Lo tecnico (UTMs, tiers, datos crudos) sigue ahi,
  // a un clic, sin duplicar codigo ni configuracion.

  function simpleMode() { return S.mode === 'simple'; }

  /** Etiqueta segun el modo: usa `simple` si existe y estamos en modo simple. */
  function lbl(o) {
    if (!o) return '';
    return (simpleMode() && o.simple) ? o.simple : (o.label || o.short || '');
  }

  /** Oculta los bloques marcados detailOnly cuando el modo es simple. */
  function visible(list) {
    if (!list) return [];
    return simpleMode() ? list.filter(function (x) { return !x.detailOnly; }) : list;
  }

  /** Icono de ayuda: una frase explicando el numero, sin jerga. */
  function helpIcon(text) {
    if (!text) return '';
    return '<span class="help" tabindex="0" role="button" aria-label="What this means: '
      + esc(text) + '" data-help="' + esc(text) + '">?</span>';
  }

  function wireHelp(root) {
    $$('[data-help]', root || document).forEach(function (el) {
      var show = function (e) {
        var r = el.getBoundingClientRect();
        showTip('<div class="tt-title">What this means</div><div>' + esc(el.getAttribute('data-help')) + '</div>',
          e.clientX || r.left + r.width / 2, e.clientY || r.bottom);
      };
      el.addEventListener('mouseenter', show);
      el.addEventListener('focus', show);
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('blur', hideTip);
    });
  }

  /** Frase de portada: lo mismo que dicen los KPI, en una oracion. */
  function headline(text) {
    return '<p class="headline">' + text + '</p>';
  }

  function money(n) { return '<strong>' + esc(cfmt(n)) + '</strong>'; }
  function count(n) { return '<strong>' + esc(nfmt(n)) + '</strong>'; }

  // ------------------------------------------------------------- componentes

  function kpiCard(label, value, sub, delta, help) {
    var d = '';
    if (delta && delta.show) {
      var dir = delta.pct > 1 ? 'up' : (delta.pct < -1 ? 'down' : 'flat');
      var arrow = dir === 'up' ? '▲' : (dir === 'down' ? '▼' : '■');
      d = '<div class="delta" data-dir="' + dir + '"><span class="arrow">' + arrow + '</span>'
        + (delta.pct > 0 ? '+' : '') + (Math.round(delta.pct * 10) / 10) + '%'
        + '<span class="base">vs ' + esc(delta.baseLabel) + '</span></div>';
    }
    return '<div class="kpi">'
      + '<div class="kpi-label">' + esc(label) + helpIcon(help) + '</div>'
      + '<div class="kpi-value">' + value + '</div>'
      + (sub ? '<div class="kpi-sub">' + esc(sub) + '</div>' : '')
      + d + '</div>';
  }

  function delta(cur, prev) {
    if (!S.compare || prev == null || !prev) return null;
    return { show: true, pct: pct(cur - prev, prev), baseLabel: 'previous period' };
  }

  function card(title, note, bodyHtml, desc) {
    return '<section class="card">'
      + '<div class="card-head"><div class="card-title">' + esc(title) + '</div>'
      + (note ? '<div class="card-note">' + esc(note) + '</div>' : '') + '</div>'
      + (desc ? '<p class="card-desc">' + esc(desc) + '</p>' : '')
      + bodyHtml + '</section>';
  }

  // ------------------------------------------------------------------ RENDER

  function syncWebinarPicker() {
    var sel = $('#webinarPick');
    if (!sel) return;
    var opts = ['<option value="">All webinars</option>'].concat(
      allWebinars().slice().reverse().map(function (v) {
        return '<option value="' + esc(v) + '"' + (S.webinar === v ? ' selected' : '') + '>'
          + esc(webinarLabel(v)) + '</option>';
      }));
    sel.innerHTML = opts.join('');
    sel.parentNode.setAttribute('data-active', S.webinar ? '1' : '0');
  }

  function render() {
    if (!S.config || !S.raw) return;
    syncWebinarPicker();
    $$('#tabs button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-view') === S.view));
    });
    $$('#modeSeg button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === S.mode));
    });
    $('#btnExportLabel').textContent =
      S.view === 'ventas' ? 'Revenue CSV' : (S.view === 'webinars' ? 'Webinar CSV' : 'People CSV');

    var w = currentWindow();
    var notes = {
      resumen: 'Cohort by first-contact date',
      personas: 'Cohort by first-contact date',
      ventas: 'Revenue by payment date',
      webinars: 'Events by webinar date'
    };
    $('#periodNote').textContent = notes[S.view] + ' · ' + windowLabel(w)
      + (S.compare && prevWindow() ? ' · compared to ' + windowLabel(prevWindow()) : '');

    var host = $('#view');
    host.innerHTML = '';
    if (S.view === 'resumen') renderResumen(host, w);
    else if (S.view === 'ventas') renderVentas(host, w);
    else if (S.view === 'personas') renderPersonas(host, w);
    else renderWebinars(host, w);

    wireHelp(host);
    renderFooter();
  }

  // --- Vista: Resumen -------------------------------------------------------

  function renderResumen(host, w) {
    // Los KPI cuentan lo que PASO en el periodo (coincide con la vista Revenue).
    var everyone = poolFor({ from: null, to: null });
    var counts = stageCounts(everyone, 'activity', w);
    var pw = prevWindow();
    var prevCounts = (S.compare && pw) ? stageCounts(everyone, 'activity', pw) : null;

    // El embudo es una cohorte: solo la gente que entro en el periodo.
    var pool = poolFor(w);
    var fd = funnelData(pool);

    // --- KPIs
    var kpis = visible(S.config.kpis || []).map(function (k) {
      var value = '—', sub = '', dl = null;

      if (k.type === 'stageCount') {
        var f = counts[k.stage];
        value = nfmt(f ? f.count : 0);
        var base = counts[funnelStages()[0].id];
        if (f && base && base.id !== f.id && base.count) {
          sub = pfmt(pct(f.count, base.count), 1)
            + (simpleMode() ? ' of ticket buyers' : ' of \u201c' + base.short + '\u201d');
        }
        dl = prevCounts ? delta(f ? f.count : 0, prevCounts[k.stage] ? prevCounts[k.stage].count : 0) : null;

      } else if (k.type === 'stageValue') {
        var fv = counts[k.stage], total = fv ? fv.value : 0;
        value = k.format === 'currency' ? cfmt(total) : nfmt(total);
        if (fv && fv.count) sub = 'Avg ' + cfmt(total / fv.count);
        dl = prevCounts ? delta(total, prevCounts[k.stage] ? prevCounts[k.stage].value : 0) : null;

      } else if (k.type === 'rate') {
        var cohort = stageCounts(pool, 'cohort');
        var a = cohort[k.from], b = cohort[k.to];
        var r = a && b ? pct(b.count, a.count) : 0;
        value = '<span>' + (Math.round(r * 10) / 10) + '</span><span class="unit">%</span>';
        sub = (b ? nfmt(b.count) : 0) + ' of ' + (a ? nfmt(a.count) : 0);
        if (S.compare && pw) {
          var pc = stageCounts(poolFor(pw), 'cohort');
          var pa = pc[k.from], pb = pc[k.to];
          dl = delta(r, pa && pb ? pct(pb.count, pa.count) : 0);
        }
        sub += ' \u00b7 of this period\u2019s new people';
      }
      return kpiCard(lbl(k), value, sub, dl, k.help);
    }).join('');

    // Una frase antes de los numeros: el cliente entiende el mes de un vistazo.
    var fs = funnelStages();
    var entry = counts[fs[0].id], last = counts[fs[fs.length - 1].id];
    if (simpleMode() && entry) {
      host.insertAdjacentHTML('beforeend', headline(
        count(entry.count) + ' people bought a webinar ticket in this period, and '
        + count(last.count) + ' ' + (last.count === 1 ? 'person' : 'people')
        + ' joined the program.'));
    }
    host.insertAdjacentHTML('beforeend', '<section class="kpis">' + kpis + '</section>');

    // --- Embudo
    var max = Math.max.apply(null, fd.map(function (f) { return f.count; }).concat([1]));
    var top = fd[0] ? fd[0].count : 0;
    var rows = fd.map(function (f, i) {
      var wd = Math.max((f.count / max) * 88, f.count > 0 ? 1.5 : 0);
      var prev = i > 0 ? fd[i - 1].count : null;
      var step = prev == null ? null : pct(f.count, prev);
      var lost = prev == null ? 0 : prev - f.count;
      var bad = step != null && step < 40 && prev > 0;
      return '<div class="funnel-row" role="button" tabindex="0" data-stage="' + esc(f.id) + '">'
        + '<div class="funnel-name">' + esc(lbl(stageById(f.id)) || f.label)
        + (i === 0 ? '<small>funnel entry</small>'
          : '<small>' + (lost > 0 ? '\u2212' + nfmt(lost) + ' people' : 'no drop') + '</small>') + '</div>'
        + '<div class="funnel-track">'
        + '<div class="funnel-bar" style="width:' + wd.toFixed(2) + '%;background:' + BAR + '"></div>'
        + '<div class="funnel-inline" style="left:' + wd.toFixed(2) + '%">' + nfmt(f.count) + '</div></div>'
        + '<div class="funnel-metrics">'
        + '<div class="funnel-step">' + (step == null ? '100%' : pfmt(step, 1)) + '</div>'
        + '<div class="funnel-total">' + pfmt(pct(f.count, top), 1) + ' of total</div>'
        + (bad ? '<div class="funnel-drop bad">\u25be High drop-off</div>' : '')
        + '</div></div>';
    }).join('');

    var fTable = '<details class="table-toggle"><summary>View as table</summary>'
      + '<table class="datatable"><thead><tr><th>Stage</th><th>People</th>'
      + '<th>Conv. from previous</th><th>Conv. from top</th></tr></thead><tbody>'
      + fd.map(function (f, i) {
        var prev = i > 0 ? fd[i - 1].count : null;
        return '<tr><td>' + esc(f.label) + '</td><td>' + nfmt(f.count) + '</td><td>'
          + (prev == null ? '100%' : pfmt(pct(f.count, prev), 1)) + '</td><td>'
          + pfmt(pct(f.count, top), 1) + '</td></tr>';
      }).join('') + '</tbody></table></details>';

    host.insertAdjacentHTML('beforeend', card(
      simpleMode() ? 'How this period\u2019s new people are progressing' : 'Conversion funnel (cohort)',
      nfmt(pool.length) + ' people first seen in this period',
      '<div class="funnel">' + rows + '</div>' + fTable,
      'This follows ONLY the people who first appeared in this period, and shows how far they have got so far. '
      + 'It is a different question from the numbers above: someone who joined the program this month but bought '
      + 'their ticket in June counts in the cards above, not here. Click a step to see exactly who they are.'));

    $$('#view .funnel-row').forEach(function (row) {
      var go = function () {
        S.stageFilter = row.getAttribute('data-stage');
        S.view = 'personas'; S.page = 0;
        syncHash(); render();
      };
      row.addEventListener('click', go);
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    });

    // --- Evolución (small multiples: una escala por etapa, nunca dos ejes)
    var bk = buckets(w);
    host.insertAdjacentHTML('beforeend', card(
      simpleMode() ? 'Day by day' : 'Trend over time',
      bk.bucketDays === 1 ? 'by day' : (bk.bucketDays === 7 ? 'by week' : 'by month'),
      '<div class="grid-2" id="trendGrid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px"></div>',
      simpleMode()
        ? 'How many people reached each step, day by day.'
        : 'How many people entered each stage over the selected period.'));

    var grid = $('#trendGrid');
    funnelStages().forEach(function (st) {
      var vals = bucketize(bk, pool, function (p) { return p.dates[st.id]; });
      var total = vals.reduce(function (a, v) { return a + v; }, 0);
      var box = document.createElement('div');
      box.style.minWidth = '0';
      box.innerHTML = '<div style="font-size:12.5px;font-weight:600;color:var(--ink);margin-bottom:1px">'
        + esc(lbl(st)) + '</div>'
        + '<div style="font-size:11.5px;color:var(--ink-muted);margin-bottom:6px;font-variant-numeric:tabular-nums">'
        + nfmt(total) + ' in period</div>';
      grid.appendChild(box);
      drawSpark(box, { label: lbl(st), values: vals, total: total }, bk.list, bk.bucketDays);
    });

    // --- Segmentos
    renderSegments(host, pool);
  }

  function renderSegments(host, pool) {
    var wrap = document.createElement('section');
    wrap.className = 'grid-2';
    wrap.style.marginTop = '20px';
    host.appendChild(wrap);

    visible(S.config.segments || []).forEach(function (seg) {
      var g = makeGrouper(), counts = Object.create(null), withData = 0;
      pool.forEach(function (p) {
        var row = p.raw[seg.stage];
        if (!row) return;
        var v = String(row[seg.field] == null ? '' : row[seg.field]).trim();
        if (!v) return;
        withData++;
        (seg.multi ? v.split(/\s*,\s*/) : [v]).forEach(function (x) {
          var k = g.add(x, 1);
          if (k) counts[k] = (counts[k] || 0) + 1;
        });
      });

      var items = Object.keys(counts).map(function (k) { return { key: g.label(k), count: counts[k] }; });
      if (seg.sort === 'key') items.sort(function (a, b) { return a.key.localeCompare(b.key, undefined, { numeric: true }); });
      else items.sort(function (a, b) { return b.count - a.count; });
      items = foldTail(items, 10);

      var el = document.createElement('div');
      el.className = 'card';
      el.style.marginBottom = '0';
      el.innerHTML = '<div class="card-head"><div class="card-title">' + esc(seg.label) + '</div>'
        + '<div class="card-note">' + nfmt(withData) + ' responses</div></div><div class="slot"></div>';
      wrap.appendChild(el);

      var slot = el.querySelector('.slot');
      if (!items.length) { slot.innerHTML = '<div class="empty">No data in this period</div>'; return; }
      drawBars(slot, items, withData, seg.label, {});
    });
  }

  // --- Vista: Ventas --------------------------------------------------------

  function renderVentas(host, w) {
    var sales = S.config.sales || {};
    var cfg = txConfig() || {};
    var evs = revenueEvents(w);
    var pw = prevWindow();
    var prevEvs = (S.compare && pw) ? revenueEvents(pw) : null;

    var progClasses = cfg.programClasses || cfg.customerClasses || ['programa', 'deposito'];
    var clients = newCustomers(w);
    var prevClients = (S.compare && pw) ? newCustomers(pw) : null;

    var total = sumBy(evs);
    var prog = sumBy(evs, progClasses);
    var entradas = sumBy(evs, ['entrada']);
    var down = sumBy(evs, ['roadmap']);
    var contract = clients.reduce(function (a, p) { return a + (p.contract || 0); }, 0);

    function prevOf(fn) { return prevEvs ? fn(prevEvs) : null; }

    var simple = simpleMode();
    var kpis = [
      kpiCard(simple ? 'Money received' : 'Cash collected', cfmt(total),
        nfmt(evs.length) + ' payments in period',
        delta(total, prevOf(function (e) { return sumBy(e); })),
        'Every payment that actually landed in this period \u2014 tickets, deposits and program payments. Monthly instalments count in the month they are charged.'),

      kpiCard(simple ? 'From the program' : 'Program cash', cfmt(prog),
        'deposits, instalments and full payments',
        delta(prog, prevOf(function (e) { return sumBy(e, progClasses); })),
        'The part of the money that came from REVIVE, not from webinar tickets.'),

      kpiCard(simple ? 'People who joined' : 'New customers', nfmt(clients.length),
        'first program payment in period',
        prevClients ? delta(clients.length, prevClients.length) : null,
        'People whose FIRST program payment happened in this period. Someone paying their second instalment is not counted again.'),

      kpiCard(simple ? 'Total value of new sales' : 'Contract value signed', cfmt(contract),
        'from new customers in period',
        prevClients ? delta(contract, prevClients.reduce(function (a, p) {
          return a + (p.contract || 0);
        }, 0)) : null,
        'The full agreed price of what was sold, even if the customer pays it over three months.'),

      kpiCard(simple ? 'Average sale' : 'Average deal size',
        clients.length ? cfmt(contract / clients.length) : '\u2014',
        'contract value \u00f7 new customers', null,
        'On average, how much each new customer agreed to pay in total.'),

      kpiCard(simple ? 'From webinar tickets' : 'Ticket sales', cfmt(entradas),
        nfmt(countBy(evs, ['entrada'])) + ' tickets'
          + (down ? ' \u00b7 downsell ' + cfmt(down) : ''),
        delta(entradas, prevOf(function (e) { return sumBy(e, ['entrada']); })),
        'Money from the $29 webinar seats and the workshop tickets.')
    ];

    // Rentabilidad: la caja sola no dice si el mes fue bueno.
    var spend = adSpendIn(w);
    var prevSpend = (S.compare && pw) ? adSpendIn(pw) : null;
    if (spend != null && spend > 0) {
      var net = total - spend;
      var prevNet = (prevEvs && prevSpend) ? sumBy(prevEvs) - prevSpend : null;
      kpis.splice(1, 0,
        kpiCard(simple ? 'Money kept after ads' : 'Net after ad spend', cfmt(net),
          cfmt(total) + ' in \u2212 ' + cfmt(spend) + ' on ads',
          delta(net, prevNet),
          'What is left after paying for advertising. It does not subtract salaries, software or other costs.'),
        kpiCard(simple ? 'Back per $1 of ads' : 'ROAS',
          simple ? '$' + (Math.round((total / spend) * 100) / 100).toFixed(2) : xfmt(total / spend),
          simple ? 'for every $1 spent on ads' : 'cash collected \u00f7 ad spend',
          delta(total / spend, (prevEvs && prevSpend) ? sumBy(prevEvs) / prevSpend : null),
          'For every dollar spent on ads, this is how many dollars came back. Above 1 means the advertising paid for itself.'));
    }
    kpis = kpis.join('');

    if (simple) {
      var line = money(total) + ' came in during this period';
      if (spend != null && spend > 0) {
        line += ', and after ' + money(spend) + ' spent on ads you kept ' + money(total - spend);
      }
      line += '. ' + count(clients.length) + ' '
        + (clients.length === 1 ? 'person' : 'people') + ' joined the program';
      if (contract) line += ', worth ' + money(contract) + ' in total sales';
      line += '.';
      host.insertAdjacentHTML('beforeend', headline(line));
    }

    host.insertAdjacentHTML('beforeend', '<section class="kpis">' + kpis + '</section>');

    host.insertAdjacentHTML('beforeend',
      '<p class="card-desc" style="margin:-8px 0 18px">'
      + (spend == null ? '<strong>Ad spend:</strong> no webinar falls inside this period, '
        + 'so net and ROAS are not shown. Ad spend is only recorded per webinar in the Event Tracker. ' : '')
      + (simple ? '' : '<strong>Cash collected</strong> is money that actually came in \u2014 split-pay instalments land every month. '
      + '<strong>Contract value</strong> is what was signed, in full, on the day of the close. '
      + 'A 3 \u00d7 $1,665 customer counts as one customer and $4,995 of contract, '
      + 'but their cash arrives across three months.') + '</p>');

    // --- Ingresos en el tiempo (una escala por serie)
    var bk = buckets(w);
    host.insertAdjacentHTML('beforeend', card('Cash collected over time',
      bk.bucketDays === 1 ? 'by day' : (bk.bucketDays === 7 ? 'by week' : 'by month'),
      '<div class="grid-2" id="revGrid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px"></div>',
      'Every payment counts on the date it was charged, not the date the person entered the funnel.'));

    var rg = $('#revGrid');
    var series = [
      { cls: null, label: 'Total cash' },
      { cls: progClasses, label: 'Program' },
      { cls: ['entrada'], label: 'Tickets' }
    ];
    if (down) series.push({ cls: ['roadmap'], label: 'Roadmap downsell' });

    series.forEach(function (sr) {
      var subset = sr.cls ? evs.filter(function (e) { return sr.cls.indexOf(e.cls) !== -1; }) : evs;
      var vals = bucketize(bk, subset, function (e) { return e.date; }, function (e) { return e.amount; });
      var tot = vals.reduce(function (a, v) { return a + v; }, 0);
      var box = document.createElement('div');
      box.style.minWidth = '0';
      box.innerHTML = '<div style="font-size:12.5px;font-weight:600;color:var(--ink);margin-bottom:1px">'
        + esc(sr.label) + '</div>'
        + '<div style="font-size:11.5px;color:var(--ink-muted);margin-bottom:6px;font-variant-numeric:tabular-nums">'
        + cfmt(tot) + ' in period</div>';
      rg.appendChild(box);
      drawSpark(box, { label: sr.label, values: vals, total: tot }, bk.list, bk.bucketDays, cfmt);
    });

    // --- Desgloses
    var brk = document.createElement('section');
    brk.className = 'grid-2';
    brk.style.marginTop = '20px';
    host.appendChild(brk);

    visible(sales.breakdowns || []).forEach(function (b) {
      var g = makeGrouper(), acc = Object.create(null), people = Object.create(null);
      evs.forEach(function (e) {
        if (b.only && b.only.indexOf(e.cls) === -1 && b.only.indexOf(e.stage && e.stage.id) === -1) return;
        var raw;
        if (b.attr.stage === '$webinar') raw = webinarLabel(webinarOfEvent(e));
        else if (b.attr.stage === '$class') raw = classLabel(e.cls);
        else if (b.attr.stage === '$self') raw = e.row[b.attr.field];
        else {
          var row = e.person.raw[b.attr.stage];
          raw = row ? row[b.attr.field] : '';
        }
        var k = g.add(raw, e.amount) || '(no data)';
        acc[k] = (acc[k] || 0) + e.amount;
        (people[k] || (people[k] = Object.create(null)))[e.person.key] = 1;
      });

      var items = Object.keys(acc).map(function (k) {
        return { key: k === '(no data)' ? k : g.label(k), count: acc[k], n: Object.keys(people[k]).length };
      }).sort(function (x, y) { return y.count - x.count; });
      items = foldTail(items, 10);

      var sum = items.reduce(function (a, i) { return a + i.count; }, 0);
      var el = document.createElement('div');
      el.className = 'card';
      el.style.marginBottom = '0';
      el.innerHTML = '<div class="card-head"><div class="card-title">' + esc(b.label) + '</div>'
        + '<div class="card-note">' + cfmt(sum) + '</div></div>'
        + (b.desc ? '<p class="card-desc">' + esc(b.desc) + '</p>' : '')
        + '<div class="slot"></div>';
      brk.appendChild(el);
      var slot = el.querySelector('.slot');
      if (!items.length) { slot.innerHTML = '<div class="empty">No revenue in this period</div>'; return; }
      drawBars(slot, items, sum, b.label, { fmt: cfmt, valueLabel: 'Revenue' });
    });

    // --- Clientes nuevos del periodo
    if (clients.length) {
      var cbody = clients.slice().sort(function (a, b) { return b.customerAt - a.customerAt; })
        .map(function (p) {
          return '<tr class="clickable" data-key="' + esc(p.key) + '">'
            + '<td>' + esc(dfmt(p.customerAt)) + '</td>'
            + '<td class="strong">' + esc(p.name) + '</td>'
            + '<td>' + esc(p.email || '—') + '</td>'
            + '<td class="num">' + esc(p.contract ? cfmt(p.contract) : '—') + '</td>'
            + '<td class="num strong">' + esc(p.programCash ? cfmt(p.programCash) : '—') + '</td>'
            + '<td>' + esc((p.raw.closed && p.raw.closed['Webinar Cycle Closed']) || '—') + '</td></tr>';
        }).join('');

      host.insertAdjacentHTML('beforeend', card('New customers in period',
        nfmt(clients.length) + ' \u00b7 ' + cfmt(contract) + ' in contracts',
        '<div class="table-scroll"><table class="report-table"><thead><tr>'
        + '<th>Date</th><th>Person</th><th>Email</th><th class="num">Contract</th>'
        + '<th class="num">Collected</th><th>Webinar</th></tr></thead><tbody>' + cbody
        + '</tbody></table></div>',
        'The date is their first program payment or deposit. If Collected is lower than Contract, they still owe instalments.'));
    }

    // --- Pagos del programa sin cierre marcado en la hoja
    var pend = S.people.filter(function (x) {
      if (!x.pendingClose || !x.pendingCloseAt) return false;
      if (!inWindow(x.pendingCloseAt, w)) return false;
      return !S.webinar || webinarOfPerson(x) === S.webinar;
    });
    if (pend.length) {
      var pendTotal = pend.reduce(function (a, x) { return a + (x.pendingCloseAmount || 0); }, 0);
      host.insertAdjacentHTML('beforeend', card(
        'Program payments with no close recorded',
        nfmt(pend.length) + ' \u00b7 ' + cfmt(pendTotal),
        '<div class="table-scroll"><table class="report-table"><thead><tr>'
        + '<th>Date</th><th>Person</th><th>Email</th><th class="num">Paid</th></tr></thead><tbody>'
        + pend.sort(function (a, b) { return b.pendingCloseAt - a.pendingCloseAt; })
          .map(function (x) {
            return '<tr class="clickable" data-key="' + esc(x.key) + '">'
              + '<td>' + esc(dfmt(x.pendingCloseAt)) + '</td>'
              + '<td class="strong">' + esc(x.name) + '</td>'
              + '<td>' + esc(x.email || '\u2014') + '</td>'
              + '<td class="num strong">' + esc(cfmt(x.pendingCloseAmount || 0)) + '</td></tr>';
          }).join('')
        + '</tbody></table></div>',
        'These people paid for REVIVE but the Closed column in the spreadsheet is still empty, '
        + 'so they are NOT counted as customers above. Mark them as closed in the sheet and they '
        + 'will appear automatically.'));
      $$('#view .report-table tr.clickable').forEach(function (tr) {
        tr.addEventListener('click', function () { openProfile(tr.getAttribute('data-key')); });
      });
    }

    // --- Ledger
    var LIMIT = 150;
    var body = evs.slice(0, LIMIT).map(function (e) {
      return '<tr class="clickable" data-key="' + esc(e.person.key) + '">'
        + '<td>' + esc(dfmt(e.date, true)) + '</td>'
        + '<td class="strong">' + esc(e.person.name) + '</td>'
        + '<td>' + esc(e.person.email || '—') + '</td>'
        + '<td>' + esc(e.label) + '</td>'
        + '<td class="num strong">' + esc(cfmt(e.amount)) + '</td></tr>';
    }).join('');

    host.insertAdjacentHTML('beforeend', card('All payments in period',
      nfmt(evs.length) + ' payments \u00b7 ' + cfmt(total),
      '<div class="table-scroll"><table class="report-table"><thead><tr>'
      + '<th>Date</th><th>Person</th><th>Email</th><th>Type</th><th class="num">Amount</th>'
      + '</tr></thead><tbody>' + (body || '<tr><td colspan="5" class="empty">No payments in this period.</td></tr>')
      + '</tbody><tfoot><tr><td colspan="4">Total</td><td class="num">' + esc(cfmt(total))
      + '</td></tr></tfoot></table></div>'
      + (evs.length > LIMIT ? '<p class="card-desc" style="margin:12px 0 0">Showing the '
        + LIMIT + ' most recent of ' + nfmt(evs.length) + '. The CSV includes all of them.</p>' : ''),
      'Each row is one charge. Split-pay instalments appear once a month.'));

    $$('#view .report-table tr.clickable').forEach(function (tr) {
      tr.addEventListener('click', function () { openProfile(tr.getAttribute('data-key')); });
    });
  }

  // --- Vista: Personas ------------------------------------------------------

  function renderPersonas(host, w) {
    var pool = poolFor(w, { applyStage: true });
    var cols = visible((S.config.table && S.config.table.columns) || []);

    // barra de herramientas: etapa + facetas
    var chips = '<button data-stage="" aria-pressed="' + (!S.stageFilter) + '">All</button>'
      + (S.config.stages || []).filter(function (s) { return !simpleMode() || s.funnel !== false; })
        .map(function (s) {
          return '<button data-stage="' + esc(s.id) + '" aria-pressed="'
            + (S.stageFilter === s.id) + '">' + esc(s.short || lbl(s)) + '</button>';
        }).join('');

    var facets = visible(S.config.facets || []).map(function (f) {
      var vals = Object.create(null);
      S.people.forEach(function (p) {
        var v = facetValue(p, f);
        if (v) vals[v] = (vals[v] || 0) + 1;
      });   // los select no se agrupan: filtran por el valor exacto de la hoja
      var opts = Object.keys(vals).sort(function (a, b) { return vals[b] - vals[a]; })
        .map(function (v) {
          return '<option value="' + esc(v) + '"' + (S.facets[f.id] === v ? ' selected' : '') + '>'
            + esc(v) + ' (' + vals[v] + ')</option>';
        }).join('');
      return '<div class="facet" data-active="' + (S.facets[f.id] ? '1' : '0') + '">'
        + '<label for="fc_' + esc(f.id) + '">' + esc(f.label) + '</label>'
        + '<select id="fc_' + esc(f.id) + '" data-facet="' + esc(f.id) + '">'
        + '<option value="">All</option>' + opts + '</select></div>';
    }).join('');

    host.insertAdjacentHTML('beforeend',
      '<section class="filters" style="margin-top:0">'
      + '<span class="filter-label">Stage</span><div class="seg" id="stageSeg">' + chips + '</div>'
      + '<div class="facets" style="margin-left:8px">' + facets + '</div>'
      + (S.stageFilter || Object.keys(S.facets).some(function (k) { return S.facets[k]; })
        ? '<button class="btn" id="clearFilters" style="margin-left:auto">Clear filters</button>' : '')
      + '</section>');

    // orden
    var sorted = pool.slice().sort(function (a, b) {
      var col = cols.filter(function (c) { return c.key === S.sort.key; })[0] || { key: S.sort.key };
      var av = cellSort(a, col), bv = cellSort(b, col);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * S.sort.dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * S.sort.dir;
    });

    var pages = Math.max(1, Math.ceil(sorted.length / S.pageSize));
    if (S.page >= pages) S.page = pages - 1;
    var slice = sorted.slice(S.page * S.pageSize, (S.page + 1) * S.pageSize);

    var head = '<tr>' + cols.map(function (c) {
      var active = S.sort.key === c.key;
      return '<th data-key="' + esc(c.key) + '"' + (active ? ' aria-sort="'
        + (S.sort.dir === 1 ? 'ascending' : 'descending') + '"' : '') + '>' + esc(c.label)
        + (active ? '<span class="sort-arrow">' + (S.sort.dir === 1 ? '▲' : '▼') + '</span>' : '') + '</th>';
    }).join('') + '</tr>';

    var body = slice.map(function (p) {
      return '<tr tabindex="0" data-key="' + esc(p.key) + '">'
        + cols.map(function (c) { return cellHtml(p, c); }).join('') + '</tr>';
    }).join('');

    var totalRev = sorted.reduce(function (a, p) { return a + p.value; }, 0);

    host.insertAdjacentHTML('beforeend', card('People',
      nfmt(sorted.length) + ' people \u00b7 ' + cfmt(totalRev) + ' total',
      '<div class="table-scroll"><table class="people"><thead>' + head + '</thead><tbody>'
      + body + '</tbody></table></div>'
      + (sorted.length ? '' : '<div class="empty">No one matches the current filters.</div>')
      + '<div class="pager"><div class="pager-info">'
      + (sorted.length ? (S.page * S.pageSize + 1) + '–' + Math.min((S.page + 1) * S.pageSize, sorted.length)
        + ' of ' + nfmt(sorted.length) : 'No results')
      + '</div><div style="display:flex;gap:8px">'
      + '<button class="btn" id="pagePrev"' + (S.page === 0 ? ' disabled' : '') + '>Previous</button>'
      + '<button class="btn" id="pageNext"' + (S.page >= pages - 1 ? ' disabled' : '') + '>Next</button>'
      + '</div></div>',
      'One record per person, unified by email, CRM ID or phone across every tab. Click a row to open the full profile.'));

    // eventos
    $$('#stageSeg button').forEach(function (b) {
      b.addEventListener('click', function () {
        S.stageFilter = b.getAttribute('data-stage') || null;
        S.page = 0; render();
      });
    });
    $$('#view select[data-facet]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        S.facets[sel.getAttribute('data-facet')] = sel.value || '';
        S.page = 0; render();
      });
    });
    var clear = $('#clearFilters');
    if (clear) clear.addEventListener('click', function () {
      S.stageFilter = null; S.facets = Object.create(null); S.page = 0; render();
    });
    $$('#view .people thead th').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-key');
        if (S.sort.key === k) S.sort.dir *= -1; else { S.sort.key = k; S.sort.dir = -1; }
        render();
      });
    });
    $$('#view .people tbody tr').forEach(function (tr) {
      var open = function () { openProfile(tr.getAttribute('data-key')); };
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); open(); } });
    });
    $('#pagePrev').addEventListener('click', function () { if (S.page > 0) { S.page--; render(); } });
    $('#pageNext').addEventListener('click', function () { S.page++; render(); });
  }

  function cellSort(p, col) {
    if (col.key === 'stage') return funnelDepth(p);
    if (col.key === 'firstSeen') return p.firstSeen ? p.firstSeen.getTime() : 0;
    if (col.key === 'lastSeen') return p.lastSeen ? p.lastSeen.getTime() : 0;
    if (col.key === 'value') return p.value || 0;
    if (col.key === 'cash') return p.cash || 0;
    if (col.key === 'contract') return p.contract || 0;
    if (col.type === 'cashStatus') return p.customerAt ? (p.unverifiedCash ? 0 : 1) : -1;
    var v = getPath(p, col.key);
    if (col.type === 'number' || col.type === 'currency') { var n = num(v); return n == null ? -1 : n; }
    return v == null ? '' : v;
  }

  function cellHtml(p, c) {
    var cls = (c.align === 'right' || c.type === 'number' || c.type === 'currency') ? ' class="num"'
      : (c.key === 'name' ? ' class="name"' : '');
    var out;
    if (c.type === 'stage') {
      var st = stageOf(p), total = funnelStages().length, depth = funnelDepth(p);
      out = st ? '<span class="pill">' + esc(st.short || st.label)
        + '<span class="pill-step">' + depth + '/' + total + '</span></span>'
        : '<span style="color:var(--ink-muted)">not in funnel</span>';
    } else if (c.type === 'date') {
      out = esc(dfmt(c.key === 'lastSeen' ? p.lastSeen : p.firstSeen));
    } else if (c.type === 'cashStatus') {
      out = !p.customerAt ? '\u2014'
        : (p.unverifiedCash
          ? '<span class="tag" title="Closed per the sheet, but no charge in the ledger">unverified</span>'
          : '<span class="tag" title="At least one charge recorded in the ledger">in ledger</span>');
    } else if (c.type === 'currency') {
      var cv = c.key === 'value' ? p.value
        : (c.key === 'cash' ? p.cash : (c.key === 'contract' ? p.contract : num(getPath(p, c.key))));
      out = cv ? esc(cfmt(cv)) : '—';
    } else {
      var v = getPath(p, c.key);
      out = esc(v == null || v === '' ? '—' : v);
    }
    return '<td' + cls + '>' + out + '</td>';
  }

  // --- Vista: Webinars ------------------------------------------------------

  function fmtBy(kind) {
    if (kind === 'currency') return cfmt;
    if (kind === 'percent') return function (v) { return pfmt(v, 1); };
    if (kind === 'x') return xfmt;
    return function (v) { return nfmt(Math.round(v * 100) / 100); };
  }

  function eventRows(w) {
    var cfg = S.config.events;
    if (!cfg || !S.raw) return [];
    return ((S.raw.tabs || {})[cfg.tab] || [])
      .map(function (r) { return { row: r, date: parseDate(r[cfg.dateField]) }; })
      .filter(function (e) { return e.date && inWindow(e.date, w); })
      .filter(function (e) { return !S.webinar || iso(e.date) === S.webinar; })
      .sort(function (a, b) { return b.date - a.date; });
  }

  function aggEvents(evs, k) {
    if (k.agg === 'ratio') {
      var n = 0, d = 0;
      evs.forEach(function (e) { n += num(e.row[k.num]) || 0; d += num(e.row[k.den]) || 0; });
      if (!d) return null;
      return k.format === 'percent' ? (n / d) * 100 : n / d;
    }
    var vals = evs.map(function (e) { return num(e.row[k.field]); })
      .filter(function (v) { return v != null; });
    if (!vals.length) return null;
    var tot = vals.reduce(function (a, v) { return a + v; }, 0);
    return k.agg === 'avg' ? tot / vals.length : tot;
  }

  /** Primer pago registrado en el libro. Antes de esa fecha el libro no
   *  existe, asi que su suma no es "cero ingresos" sino "sin datos". */
  function ledgerStart() {
    if (S._ledgerStart !== undefined) return S._ledgerStart;
    var st = stageById((txConfig() || {}).stage);
    var min = null;
    if (st) {
      S.people.forEach(function (p) {
        (p.rows[st.id] || []).forEach(function (row) {
          var d = rowDate(row, st);
          if (d && (!min || d < min)) min = d;
        });
      });
    }
    S._ledgerStart = min;
    return min;
  }

  function sheetRowFor(key) {
    var cfg = S.config.events;
    var rows = (S.raw && (S.raw.tabs || {})[cfg.tab]) || [];
    for (var i = 0; i < rows.length; i++) {
      var d = parseDate(rows[i][cfg.dateField]);
      if (d && iso(d) === key) return rows[i];
    }
    return {};
  }

  /** Una fila por webinar, calculada desde las hojas de origen por fecha.
   *  Antes se leian las columnas del Event Tracker, que se llenan a mano y no
   *  cuadran con el libro (para los webinars anteriores a julio el libro ni
   *  existia). Lo unico que sigue viniendo de la hoja es la ASISTENCIA, que no
   *  se puede calcular: nadie registra quien entro al webinar. */
  function webinarRows(w) {
    var ticketStage = stageById((S.config.sales || {}).entryStage || 'ticket');

    return webinarWindows().filter(function (win) {
      if (!inWindow(win.date, w)) return false;
      return !S.webinar || win.key === S.webinar;
    }).map(function (win) {
      var sheet = sheetRowFor(win.key);
      var evs = revenueEvents({ from: win.from, to: win.to }, true);

      var tickets = 0;
      S.people.forEach(function (p) {
        (p.rows[ticketStage.id] || []).forEach(function (row) {
          var d = rowDate(row, ticketStage);
          if (d && d >= win.from && d <= win.to) tickets++;
        });
      });

      var customers = S.people.filter(function (p) {
        return p.customerAt && p.customerAt >= win.from && p.customerAt <= win.to;
      });

      var ledgerCash = evs.reduce(function (a, e) { return a + e.amount; }, 0);
      var sheetCash = num(sheet['Total Cash']);
      var ls = ledgerStart();

      // Antes del 7-jul-2026 el libro no existe: su suma solo trae los tickets
      // y perderia todo el dinero del programa. Ahi manda la cifra de la hoja.
      var cashSource = 'ledger', cash = ledgerCash;
      if (ls && win.to < ls) {
        cashSource = 'sheet';
        cash = sheetCash != null ? sheetCash : ledgerCash;
      } else if (ls && win.from < ls) {
        cashSource = 'partial';
      }

      var spend = num(sheet['Ad Spend']);
      var attendees = num(sheet['Attendees']);

      return {
        key: win.key, date: win.date, from: win.from, to: win.to,
        cashSource: cashSource, ledgerCash: ledgerCash,
        tickets: tickets,
        attendees: attendees,
        showUp: (attendees != null && tickets) ? (attendees / tickets) * 100 : null,
        closes: customers.length,
        contract: customers.reduce(function (a, p) { return a + (p.contract || 0); }, 0),
        cash: cash,
        spend: spend,
        roas: (spend && spend > 0) ? cash / spend : null,
        cac: (spend && customers.length) ? spend / customers.length : null,
        sheetTickets: num(sheet['Total Buyers']),
        sheetCash: sheetCash
      };
    }).sort(function (a, b) { return b.date - a.date; });
  }

  function renderWebinars(host, w) {
    var cfg = S.config.events;
    if (!cfg) { host.innerHTML = '<div class="empty">No per-event metrics configured for this client.</div>'; return; }

    var rows = webinarRows(w);
    if (!rows.length) {
      host.insertAdjacentHTML('beforeend', card(cfg.label, '', '<div class="empty">No webinars in the selected period.</div>'));
      return;
    }
    var simple = simpleMode();
    var sum = function (f) { return rows.reduce(function (a, r) { return a + (r[f] || 0); }, 0); };
    var spend = sum('spend'), cash = sum('cash'), closes = sum('closes');
    var tickets = sum('tickets'), att = sum('attendees');

    var kpis = [
      kpiCard(simple ? 'Tickets sold' : 'Tickets', nfmt(tickets),
        'people who paid for a seat', null,
        'Counted from the Ticket Buyers tab: everyone who paid between the previous webinar and this one.'),
      kpiCard('Attendees', att ? nfmt(att) : '—',
        tickets ? pfmt(pct(att, tickets), 1) + ' show-up' : '', null,
        'Taken from the Event Tracker. This is the only number nobody can calculate — attendance is typed in by hand.'),
      kpiCard(simple ? 'Money received' : 'Cash collected', cfmt(cash),
        'tickets plus program payments', null,
        'Every payment charged between the previous webinar and this one, taken from the payment ledger.'),
      kpiCard(simple ? 'People who joined' : 'Closes', nfmt(closes),
        cfmt(sum('contract')) + ' in contracts', null,
        'People who became program customers in this webinar’s window.'),
      kpiCard(simple ? 'Spent on ads' : 'Ad spend', spend ? cfmt(spend) : '—',
        'from the Event Tracker', null,
        'Ad spend is recorded per webinar in the spreadsheet.'),
      kpiCard(simple ? 'Back per $1 of ads' : 'ROAS',
        spend ? (simple ? '$' + (Math.round((cash / spend) * 100) / 100).toFixed(2) : xfmt(cash / spend)) : '—',
        spend ? cfmt(cash) + ' ÷ ' + cfmt(spend) : '', null,
        'Money received divided by what was spent on ads for that webinar.')
    ].join('');
    host.insertAdjacentHTML('beforeend', '<section class="kpis">' + kpis + '</section>');

    var cols = [
      { k: 'date',      h: 'Webinar',   f: function (r) { return dfmt(r.date); }, left: true },
      { k: 'window',    h: 'Sales window', f: function (r) { return dfmt(r.from) + ' – ' + dfmt(r.to); }, left: true, detail: true },
      { k: 'tickets',   h: 'Tickets',   f: function (r) { return nfmt(r.tickets); } },
      { k: 'attendees', h: 'Attendees', f: function (r) { return r.attendees == null ? '—' : nfmt(r.attendees); } },
      { k: 'showUp',    h: 'Show-up',   f: function (r) { return r.showUp == null ? '—' : pfmt(r.showUp, 1); } },
      { k: 'closes',    h: 'Joined',    f: function (r) { return nfmt(r.closes); } },
      { k: 'cash', h: 'Cash', f: function (r) {
          return cfmt(r.cash) + (r.cashSource === 'ledger' ? ''
            : (r.cashSource === 'sheet' ? '  \u00b7 from sheet' : '  \u00b7 partial')); } },
      { k: 'spend',     h: 'Ad spend',  f: function (r) { return r.spend == null ? '—' : cfmt(r.spend); }, detail: true },
      { k: 'roas',      h: 'ROAS',      f: function (r) { return r.roas == null ? '—' : xfmt(r.roas); }, detail: true },
      { k: 'cac',       h: 'CAC',       f: function (r) { return r.cac == null ? '—' : cfmt(r.cac); }, detail: true },
      { k: 'sheetCash', h: 'Cash (sheet)', f: function (r) { return r.sheetCash == null ? '—' : cfmt(r.sheetCash); }, detail: true }
    ].filter(function (col) { return !simple || !col.detail; });

    var head = '<tr>' + cols.map(function (col) {
      return '<th' + (col.left ? '' : ' class="num"') + '>' + esc(col.h) + '</th>';
    }).join('') + '</tr>';
    var body = rows.map(function (r) {
      return '<tr>' + cols.map(function (col) {
        return '<td' + (col.left ? '' : ' class="num"') + '>' + esc(col.f(r)) + '</td>';
      }).join('') + '</tr>';
    }).join('');

    var mismatch = rows.filter(function (r) {
      return r.sheetCash != null && Math.abs(r.sheetCash - r.cash) > Math.max(500, r.cash * 0.1);
    });

    host.insertAdjacentHTML('beforeend', card(cfg.label,
      nfmt(rows.length) + (rows.length === 1 ? ' webinar' : ' webinars'),
      '<div class="table-scroll"><table class="report-table"><thead>' + head
      + '</thead><tbody>' + body + '</tbody></table></div>'
      + (rows.some(function (r) { return r.cashSource !== 'ledger'; })
        ? '<p class="card-desc" style="margin:14px 0 0"><strong>Where the cash figure comes from:</strong> '
          + 'the payment ledger starts on ' + esc(dfmt(ledgerStart()))
          + '. Webinars before that show the Total Cash typed into the Event Tracker, marked '
          + '\u201cfrom sheet\u201d, because the ledger has no payments to add up for them.</p>' : ''),
      'Tickets, cash and joins are counted from the source tabs by date — everyone who paid '
      + 'between the previous webinar and this one. Attendance comes from the Event Tracker, '
      + 'because nobody records who actually showed up.'));

    var grid = document.createElement('section');
    grid.className = 'grid-2';
    grid.style.marginTop = '20px';
    host.appendChild(grid);

    [{ f: 'cash', label: 'Money received per webinar', fmt: cfmt },
     { f: 'tickets', label: 'Tickets sold per webinar', fmt: nfmt },
     { f: 'closes', label: 'People who joined per webinar', fmt: nfmt },
     { f: 'attendees', label: 'Attendees per webinar', fmt: nfmt }].forEach(function (ch) {
      var items = rows.slice().reverse()
        .map(function (r) { return { key: dfmt(r.date), count: r[ch.f] }; })
        .filter(function (i) { return i.count != null; });
      if (!items.length) return;
      var box = document.createElement('div');
      box.innerHTML = '<div class="card-title" style="font-size:13.5px;margin-bottom:10px">'
        + esc(ch.label) + '</div><div class="slot"></div>';
      grid.appendChild(box);
      drawBars(box.querySelector('.slot'), items, 0, ch.label,
        { fmt: ch.fmt, showPct: false, valueLabel: ch.label, labelWidth: 130 });
    });
  }

  // ------------------------------------------------------- Perfil de persona

  var lastFocus = null;
  var _multi = null;

  function multiFields() {
    if (_multi) return _multi;
    _multi = Object.create(null);
    (S.config.segments || []).forEach(function (sg) { if (sg.multi) _multi[sg.field] = true; });
    ((S.config.detail && S.config.detail.multiFields) || []).forEach(function (f) { _multi[f] = true; });
    return _multi;
  }

  /** Feed cronologico con TODO lo que hizo la persona, con montos. */
  function activityOf(p) {
    var out = [];
    var txCfg = txConfig();
    (S.config.stages || []).forEach(function (st) {
      var act = st.activity || {};

      // El libro de movimientos se recorre ya clasificado: cada pago dice si
      // fue entrada, deposito, cuota o pago completo.
      if (txCfg && st.id === txCfg.stage) {
        // BUG: la compra del ticket esta en DOS pestanas (Ticket Buyers y el
        // libro), con un minuto de diferencia. 220 de 225 pagos <=$100 son el
        // mismo hecho duplicado. Se muestra solo el de Ticket Buyers, igual
        // que en el calculo de ingresos.
        var skipCls = txCfg.revenueSkipClasses || ['entrada'];
        (p.tx || []).forEach(function (t) {
          if (skipCls.indexOf(t.cls) !== -1) return;
          out.push({
            date: t.date, stage: st, label: classLabel(t.cls),
            amount: t.amount, meta: ''
          });
        });
        return;
      }

      // BUG: la etapa derivada tambien tiene filas en su pestana de origen.
      // Se emite una sola vez, mas abajo, a partir de p.customerAt.
      if (st.derived) return;

      var amountField = act.amountField || st.map.value;
      (p.rows[st.id] || []).forEach(function (row) {
        var d = rowDate(row, st);
        var amt = amountField ? num(row[amountField]) : null;
        out.push({
          date: d, stage: st,
          label: act.label || st.label,
          amount: amt,
          meta: (act.metaFields || []).map(function (f) {
            var v = String(row[f] == null ? '' : row[f]).trim();
            return v ? f + ': ' + v : '';
          }).filter(Boolean).join(' · ')
        });
      });
    });
    (S.config.stages || []).forEach(function (st) {
      if (st.derived !== 'customer' || !p.customerAt) return;
      out.push({
        date: p.customerAt, stage: st,
        label: (st.activity && st.activity.label) || st.label,
        amount: null, meta: 'first program payment'
      });
    });

    return out.sort(function (a, b) {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return b.date - a.date;
    });
  }

  function openProfile(key) {
    var p = S.byKey[key];
    if (!p) return;
    lastFocus = document.activeElement;

    var st = stageOf(p);
    $('#drawerStage').textContent = st
      ? (st.short || st.label) + ' \u00b7 stage ' + funnelDepth(p) + ' of ' + funnelStages().length
      : 'Not in the main funnel';
    $('#drawerName').textContent = p.name;

    var meta = [];
    if (p.email) meta.push('<a href="mailto:' + esc(p.email) + '">' + esc(p.email) + '</a>');
    if (p.phone) meta.push('<a href="tel:+' + esc(p.phone) + '">+' + esc(p.phone) + '</a>');
    var alts = p.emails.filter(function (e) { return e !== p.email; });
    if (alts.length) {
      meta.push('<span title="Records merged by phone or CRM ID">+' + alts.length
        + ' email' + (alts.length > 1 ? 's' : '') + ': ' + esc(alts.join(', ')) + '</span>');
    }
    $('#drawerMeta').innerHTML = meta.join(' · ') || '—';

    var prof = S.config.profile || {};

    // --- hechos clave
    var facts = visible(prof.facts || []).map(function (f) {
      var v;
      if (f.type === 'value') v = cfmt(p.value);
      else if (f.type === 'firstSeen') v = dfmt(p.firstSeen);
      else if (f.type === 'lastSeen') v = dfmt(p.lastSeen);
      else if (f.type === 'cash') v = cfmt(p.cash || 0);
      else if (f.type === 'contract') v = p.contract ? cfmt(p.contract) : null;
      else if (f.type === 'pending') {
        var pend = (p.contract || 0) - (p.programCash || 0);
        // Antes de julio no hay libro de movimientos, asi que no se puede
        // saber cuanto se cobro; se dice en vez de mostrar un saldo falso.
        v = !p.contract ? null
          : (!p.programCash ? 'No ledger entries'
            : (pend > 1 ? cfmt(pend) : 'Paid in full'));
      }
      else if (f.type === 'customerSource') v = p.customerSource || null;
      else if (f.type === 'cashStatus') {
        v = !p.customerAt ? null
          : (p.unverifiedCash ? 'Unverified \u2014 no ledger record' : 'Recorded in ledger');
      }
      else if (f.type === 'customerAt') v = p.customerAt ? dfmt(p.customerAt) : null;
      else if (f.type === 'age') {
        v = p.firstSeen ? nfmt(daysBetween(p.firstSeen, p.lastSeen || p.firstSeen)) + ' days' : '\u2014';
      } else {
        var raw = getPath(p, f.path);
        v = (raw == null || String(raw).trim() === '') ? null : String(raw);
        if (v && f.format === 'currency') v = cfmt(num(v));
      }
      var empty = (v == null || v === '—');
      return '<div class="fact"><div class="fact-label">' + esc(f.label) + '</div>'
        + '<div class="fact-value' + (f.big ? ' big' : '') + (empty ? ' muted' : '') + '">'
        + esc(empty ? '—' : v) + '</div></div>';
    }).join('');

    // --- acciones
    var actions = '<div class="drawer-actions">'
      + (p.email ? '<button class="btn" data-copy="' + esc(p.email) + '">Copy email</button>' : '')
      + (p.email ? '<a class="btn" href="mailto:' + esc(p.email) + '">Email</a>' : '')
      + (p.phone ? '<a class="btn" href="tel:+' + esc(p.phone) + '">Call</a>' : '')
      + '<button class="btn" data-copy="' + esc(location.origin + location.pathname
        + '?client=' + S.clientId + '#personas/' + encodeURIComponent(p.key)) + '">Copy link</button>'
      + '</div>';

    // --- feed de actividad + etapas pendientes
    var acts = activityOf(p);
    var feed = acts.map(function (a) {
      return '<li><div class="feed-row"><span class="feed-label">' + esc(a.label) + '</span>'
        + (a.amount != null && a.amount !== 0
          ? '<span class="feed-amount">' + esc(cfmt(a.amount)) + '</span>' : '') + '</div>'
        + '<div class="feed-date">' + esc(a.date ? dfmt(a.date, true) : 'no date') + '</div>'
        + (a.meta ? '<div class="feed-meta">' + esc(a.meta) + '</div>' : '') + '</li>';
    }).join('');

    var pending = funnelStages().filter(function (s) { return !p.stages[s.id]; })
      .map(function (s) {
        return '<li class="pending"><div class="feed-row"><span class="feed-label">' + esc(s.label)
          + '</span></div><div class="feed-date">not reached</div></li>';
      }).join('');

    // --- notas
    var notes = (prof.notes || []).map(function (nf) {
      var v = getPath(p, nf.path);
      if (v == null || String(v).trim() === '') return '';
      return '<div class="note-box"><div class="note-label">' + esc(nf.label) + '</div>' + esc(v) + '</div>';
    }).join('');

    // --- secciones crudas
    var sections = visible((S.config.detail && S.config.detail.sections) || []).map(function (sec) {
      var rows = p.rows[sec.stage] || [];
      if (!rows.length) return '';
      var html = rows.map(function (row) {
        var keys = sec.fields === '*' ? Object.keys(row) : sec.fields;
        var pairs = keys.map(function (k) {
          var v = row[k];
          if (v == null || String(v).trim() === '') return '';
          var val = String(v);
          var bodyv = multiFields()[k]
            ? '<div class="tag-row">' + val.split(/\s*,\s*/).map(function (t) {
              return '<span class="tag">' + esc(t) + '</span>';
            }).join('') + '</div>'
            : esc(val);
          return '<dt>' + esc(k) + '</dt><dd>' + bodyv + '</dd>';
        }).join('');
        return pairs ? '<dl class="dl">' + pairs + '</dl>' : '';
      }).join('');
      if (!html) return '';
      return '<div class="detail-section"><h3>' + esc(sec.title)
        + (rows.length > 1 ? ' (' + rows.length + ' records)' : '') + '</h3>' + html + '</div>';
    }).join('');

    $('#drawerBody').innerHTML =
      (facts ? '<div class="facts">' + facts + '</div>' : '')
      + actions
      + '<div style="height:20px"></div>'
      + (notes ? '<div class="detail-section"><h3>Notes</h3>' + notes + '</div>' : '')
      + '<div class="detail-section"><h3>Activity</h3><ul class="feed">' + feed + pending + '</ul></div>'
      + sections;

    $$('#drawerBody [data-copy]').forEach(function (b) {
      b.addEventListener('click', function () {
        navigator.clipboard && navigator.clipboard.writeText(b.getAttribute('data-copy'));
        var t = b.textContent; b.textContent = 'Copied';
        setTimeout(function () { b.textContent = t; }, 1200);
      });
    });

    $('#drawer').setAttribute('data-open', '1');
    $('#scrim').setAttribute('data-open', '1');
    $('#drawer').focus();
    syncHash(p.key);
  }

  function closeProfile() {
    $('#drawer').setAttribute('data-open', '0');
    $('#scrim').setAttribute('data-open', '0');
    syncHash();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }


  // -------------------------------------------------------- pantalla de acceso

  function needsKey() {
    var src = (S.config && S.config.source) || {};
    return src.type === 'apps-script' && !!src.url && !activeToken();
  }

  function showLock(message) {
    var name = (S.config && S.config.client.name) || 'Dashboard';
    var ll = $('#lockLogo');
    if (ll) ll.alt = name;
    $('#lockSub').textContent = 'Enter the access key to load live data for ' + name + '.';
    $('#lock').hidden = false;
    if (message) {
      $('#lockErrorText').textContent = message;
      $('#lockError').hidden = false;
      $('#lockKey').setAttribute('aria-invalid', 'true');
    }
    setTimeout(function () { $('#lockKey').focus(); }, 30);
  }

  function hideLock() {
    $('#lock').hidden = true;
    $('#lockError').hidden = true;
    $('#lockKey').removeAttribute('aria-invalid');
  }

  function wireLock() {
    $('#lockForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var key = $('#lockKey').value.trim();
      if (!key) return;

      var btn = $('#lockSubmit');
      btn.disabled = true;
      btn.textContent = 'Checking…';
      $('#lockError').hidden = true;
      S.token = key;

      fetchData()
        .then(function (payload) {
          storeKey(key);
          hideLock();
          applyPayload(payload, false);
          startTimers();
        })
        .catch(function (err) {
          S.token = '';
          $('#lockKey').value = '';
          showLock(err && err.unauthorized ? 'That access key is not valid.'
            : 'Could not reach the data source. ' + (err ? err.message : ''));
        })
        .then(function () {
          btn.disabled = false;
          btn.textContent = 'Unlock';
        });
    });
  }

  function signOut() {
    clearKey();
    S.token = '';
    location.reload();
  }

  // ------------------------------------------------------------------ export

  function csvBlob(lines, filename) {
    var csv = '﻿' + lines.map(function (r) {
      return r.map(function (c) {
        var v = String(c == null ? '' : c);
        return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    }).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function exportCurrent() {
    var w = currentWindow();
    var stamp = iso(new Date());

    if (S.view === 'ventas') {
      var evs = revenueEvents(w);
      var lines = [['Date', 'Person', 'Email', 'Phone', 'Payment type', 'Amount',
        'Contract value', 'Customer since']];
      evs.forEach(function (e) {
        lines.push([dfmt(e.date, true), e.person.name, e.person.email, e.person.phone,
          e.label, e.amount, e.person.contract || '',
          e.person.customerAt ? dfmt(e.person.customerAt) : '']);
      });
      return csvBlob(lines, S.clientId + '-revenue-' + stamp + '.csv');
    }

    if (S.view === 'webinars') {
      var cfg = S.config.events, evs2 = eventRows(w);
      var cols = (cfg.columns || []).map(function (c) { return c.label; });
      var l2 = [['Date'].concat(cols.slice(1))];
      evs2.forEach(function (e) {
        l2.push([dfmt(e.date)].concat((cfg.columns || []).slice(1).map(function (c) {
          return e.row[c.field] || '';
        })));
      });
      return csvBlob(l2, S.clientId + '-webinars-' + stamp + '.csv');
    }

    // personas (y resumen)
    var pool = poolFor(w, { applyStage: S.view === 'personas' });
    var stages = S.config.stages || [];
    var extraStage = stages[0];
    var extraKeys = [];
    pool.forEach(function (p) {
      var row = p.raw[extraStage.id];
      if (!row) return;
      Object.keys(row).forEach(function (k) { if (extraKeys.indexOf(k) === -1) extraKeys.push(k); });
    });

    var header = ['Name', 'Email', 'Alternate emails', 'Phone', 'Stage reached',
      'Total value', 'First contact', 'Last activity']
      .concat(stages.map(function (s) { return 'Date: ' + s.label; }))
      .concat(extraKeys);

    var lines3 = [header];
    pool.forEach(function (p) {
      var st = stageOf(p);
      lines3.push([p.name, p.email, p.emails.filter(function (e) { return e !== p.email; }).join(' | '),
        p.phone, st ? st.label : '', p.value,
        p.firstSeen ? dfmt(p.firstSeen) : '', p.lastSeen ? dfmt(p.lastSeen) : '']
        .concat(stages.map(function (s) { return p.dates[s.id] ? dfmt(p.dates[s.id], true) : ''; }))
        .concat(extraKeys.map(function (k) { return (p.raw[extraStage.id] || {})[k] || ''; })));
    });
    csvBlob(lines3, S.clientId + '-people-' + stamp + '.csv');
  }

  // ------------------------------------------------------------------- estado

  function renderFooter() {
    var src = S.demo ? 'demo data'
      : (S.config.source.type === 'apps-script' ? 'Google Sheets via Apps Script' : 'Google Sheets (gviz)');
    $('#footerLeft').textContent = 'Source: ' + src
      + (S.raw && S.raw.spreadsheet ? ' — ' + S.raw.spreadsheet : '');
    $('#footerRight').textContent = S.demo ? 'Not connected to live data'
      : 'Auto-refreshes every ' + (S.config.source.refreshSeconds || 60) + 's';
  }

  function setLive(state, text) {
    $('#live').setAttribute('data-state', state);
    $('#liveText').textContent = text;
  }

  function tickClock() {
    if (S.demo || S.error || !S.lastFetch) return;
    var s = Math.round((Date.now() - S.lastFetch) / 1000);
    var txt = s < 60 ? s + 's ago' : Math.round(s / 60) + ' min ago';
    setLive(s > (S.config.source.refreshSeconds || 60) * 3 ? 'stale' : 'live', 'Live \u00b7 ' + txt);
  }

  // ----------------------------------------------------------------- routing

  function syncHash(profileKey) {
    var h = '#' + S.view + (profileKey ? '/' + encodeURIComponent(profileKey) : '');
    if (location.hash !== h) history.replaceState(null, '', h);
  }

  function readHash() {
    var h = (location.hash || '').replace(/^#/, '');
    if (!h) return null;
    var parts = h.split('/');
    var view = VIEWS.indexOf(parts[0]) !== -1 ? parts[0] : null;
    return { view: view, key: parts[1] ? decodeURIComponent(parts[1]) : null };
  }

  // ---------------------------------------------------------------- UI wiring

  function syncDateInputs() {
    var w = currentWindow();
    $$('#rangeSeg button').forEach(function (b) {
      var r = b.getAttribute('data-range');
      var mine = String(S.range) === r;
      b.setAttribute('aria-pressed', String(!!mine));
    });
    $('#dateFrom').value = w.from ? iso(w.from) : '';
    $('#dateTo').value = w.to ? iso(w.to) : '';
    $('#compare').disabled = !prevWindow();
    $('#compareWrap').style.opacity = prevWindow() ? '1' : '.45';
  }

  function wireUI() {
    $$('#modeSeg button').forEach(function (b) {
      b.addEventListener('click', function () {
        S.mode = b.getAttribute('data-mode');
        try { localStorage.setItem('fd-mode', S.mode); } catch (e) { }
        $$('#modeSeg button').forEach(function (x) {
          x.setAttribute('aria-pressed', String(x === b));
        });
        render();
      });
    });

    $$('#tabs button').forEach(function (b) {
      b.addEventListener('click', function () {
        S.view = b.getAttribute('data-view');
        S.page = 0;
        syncHash(); render();
      });
    });

    $$('#rangeSeg button').forEach(function (b) {
      b.addEventListener('click', function () {
        var r = b.getAttribute('data-range');
        S.range = (r === 'all' || r === 'mtd' || r === 'lastmonth') ? r : Number(r);
        S.from = S.to = null;
        S.page = 0;
        $$('#rangeSeg button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        syncDateInputs(); render();
      });
    });

    ['#dateFrom', '#dateTo'].forEach(function (sel) {
      $(sel).addEventListener('change', function () {
        var f = $('#dateFrom').value, t = $('#dateTo').value;
        if (!f && !t) return;
        S.range = 'custom';
        S.from = f ? parseDate(f) : null;
        S.to = t ? parseDate(t) : null;
        S.page = 0;
        $$('#rangeSeg button').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); });
        $('#compare').disabled = !prevWindow();
        render();
      });
    });

    $('#compare').addEventListener('change', function (e) { S.compare = e.target.checked; render(); });

    $('#webinarPick').addEventListener('change', function (e) {
      S.webinar = e.target.value || '';
      S.page = 0;
      render();
    });

    var t;
    $('#search').addEventListener('input', function (e) {
      clearTimeout(t);
      t = setTimeout(function () { S.search = e.target.value; S.page = 0; render(); }, 180);
    });

    $('#btnRefresh').addEventListener('click', function () { refresh(true); });
    $('#btnExport').addEventListener('click', exportCurrent);
    $('#btnPrint').addEventListener('click', function () { window.print(); });
    var so = $('#btnSignOut');
    if (so) so.addEventListener('click', signOut);

    $('#btnTheme').addEventListener('click', function () {
      var cur = document.documentElement.getAttribute('data-theme');
      var next = cur === 'dark' ? 'light' : (cur === 'light' ? 'dark'
        : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark'));
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('fd-theme', next); } catch (e) { }
      render();
    });

    $('#scrim').addEventListener('click', closeProfile);
    $('#drawerClose').addEventListener('click', closeProfile);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeProfile(); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(false); });
    window.addEventListener('hashchange', function () {
      var h = readHash();
      if (h && h.view && h.view !== S.view) { S.view = h.view; render(); }
    });
  }

  // ------------------------------------------------------------- ciclo carga

  function applyPayload(payload, isDemo) {
    S.raw = payload;
    S.demo = !!isDemo || !!payload.demo;
    S._events = null;
    S._winCache = null;
    S._ledgerStart = undefined;
    S.people = applyTransactions(normalize(payload));
    S.byKey = Object.create(null);
    S.people.forEach(function (p) { S.byKey[p.key] = p; });
    S.lastFetch = Date.now();
    S.error = null;

    if (S.demo) {
      setLive('demo', 'Demo data');
      $('#banner').innerHTML = '<div class="banner"><span class="banner-icon">●</span><div>'
        + '<strong>You are looking at demo data.</strong> Synthetic records using the same tab and '
        + 'column schema as the real Google Sheet \u2014 nobody here is a real person. '
        + 'To connect live data, fill in <code>source.url</code> and <code>source.token</code> in '
        + '<code>clients/' + esc(S.clientId) + '.json</code> (see the README).</div></div>';
    } else {
      $('#banner').innerHTML = '';
      tickClock();
    }

    syncDateInputs();
    render();

    var h = readHash();
    if (h && h.key && S.byKey[h.key]) openProfile(h.key);
  }

  function refresh() {
    if (!S.config) return;
    var src = S.config.source;
    var has = (src.type === 'apps-script' && src.url) || (src.type === 'gviz' && src.spreadsheetId);
    if (!has) return;

    fetchData()
      .then(function (payload) { applyPayload(payload, false); })
      .catch(function (err) {
        if (err && err.unauthorized) { clearKey(); S.token = ''; showLock('Your access key was rejected. Enter it again.'); return; }
        S.error = err;
        setLive('error', 'Disconnected: ' + err.message);
        $('#banner').innerHTML = '<div class="banner" style="border-left-color:var(--critical)">'
          + '<span class="banner-icon" style="color:var(--critical)">●</span><div>'
          + '<strong>Could not read the spreadsheet.</strong> ' + esc(err.message) + '</div></div>';
      });
  }

  function startTimers() {
    if (S.timer) clearInterval(S.timer);
    if (S.clock) clearInterval(S.clock);
    if (!S.demo) S.timer = setInterval(refresh, (S.config.source.refreshSeconds || 60) * 1000);
    S.clock = setInterval(tickClock, 5000);
  }

  function boot() {
    try {
      var th = localStorage.getItem('fd-theme');
      if (th) document.documentElement.setAttribute('data-theme', th);
      var md = localStorage.getItem('fd-mode');
      if (md === 'simple' || md === 'detailed') S.mode = md;
    } catch (e) { }

    var h = readHash();
    if (h && h.view) S.view = h.view;

    loadConfig().then(function (cfg) {
      S.config = cfg;
      document.title = cfg.client.name + ' \u2014 Dashboard';
      $('#brandTitle').textContent = cfg.client.name;
      $('#brandSub').textContent = cfg.client.subtitle || '';
      var bl = $('#brandLogo');
      if (bl) bl.alt = cfg.client.name;
      if (cfg.defaultRange) S.range = cfg.defaultRange;

      wireUI();
      wireLock();

      // Sin clave no se pide nada: se muestra la pantalla de acceso.
      if (needsKey()) { showLock(); return 'locked'; }

      return fetchData().then(function (p) { applyPayload(p, false); })
        .catch(function (err) {
          if (err.message !== 'no-source') S.error = err;
          return loadDemo().then(function (p) {
            applyPayload(p, true);
            if (err.message !== 'no-source') {
              $('#banner').insertAdjacentHTML('beforeend',
                '<div class="banner" style="border-left-color:var(--critical)">'
                + '<span class="banner-icon" style="color:var(--critical)">●</span><div>'
                + '<strong>Live source failed, showing demo data.</strong> '
                + esc(err.message) + '</div></div>');
            }
          });
        });
    }).then(function (state) {
      if (state === 'locked') return;
      startTimers();
    }).catch(function (err) {
      setLive('error', 'Configuration error');
      $('#banner').innerHTML = '<div class="banner" style="border-left-color:var(--critical)">'
        + '<span class="banner-icon" style="color:var(--critical)">●</span><div><strong>Error:</strong> '
        + esc(err.message) + '</div></div>';
    });
  }

  // Modo diagnostico: index.html?debug=1 expone el estado para auditar los
  // numeros desde la consola sin tocar el codigo de produccion.
  if (new URLSearchParams(location.search).get('debug') === '1') {
    window.__fd = {
      state: S,
      revenueEvents: revenueEvents,
      currentWindow: currentWindow,
      newCustomers: newCustomers,
      classifyTx: classifyTx,
      audit: function () {
        var w = currentWindow();
        var evs = revenueEvents(w);
        var byCls = {};
        evs.forEach(function (e) { byCls[e.cls] = (byCls[e.cls] || 0) + e.amount; });
        var txAll = 0, txN = 0;
        S.people.forEach(function (p) {
          (p.tx || []).forEach(function (x) { txAll += x.amount; txN++; });
        });
        return {
          window: [w.from && w.from.toDateString(), w.to && w.to.toDateString()],
          people: S.people.length,
          txRowsTotal: txN, txCashTotal: Math.round(txAll),
          eventsInWindow: evs.length,
          totalInWindow: Math.round(evs.reduce(function (a, e) { return a + e.amount; }, 0)),
          byClass: byCls
        };
      }
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
