/**
 * ============================================================================
 *  FUNNEL DASHBOARD — API (Google Apps Script)
 * ============================================================================
 *  Convierte un Google Spreadsheet en un endpoint JSON de solo lectura que el
 *  dashboard estatico (GitHub Pages) consume en tiempo real.
 *
 *  POR QUE ASI:
 *   - El script se ejecuta CON TU CUENTA, asi que la hoja puede quedar PRIVADA.
 *   - No hay API key de Google expuesta en el navegador.
 *   - Es gratis y no requiere servidor.
 *   - Para duplicar por cliente: copiar este archivo, cambiar SPREADSHEET_ID
 *     y TOKEN, y desplegar de nuevo. Nada mas.
 *
 *  OJO: este archivo va a un repo PUBLICO. La clave real se escribe solo en
 *  el editor de Apps Script, nunca aqui.
 *
 *  INSTALACION (5 min):
 *   1. script.google.com  ->  Nuevo proyecto  ->  pegar este codigo.
 *   2. Editar CONFIG abajo (SPREADSHEET_ID y TOKEN).
 *   3. Implementar > Nueva implementacion > Tipo: "Aplicacion web".
 *        - Ejecutar como:  Yo (tu cuenta)
 *        - Quien tiene acceso: Cualquier persona
 *   4. Copiar la URL /exec y pegarla en clients/<cliente>.json -> source.url
 *   5. Probar en el navegador:  <URL>?token=<TOKEN>
 *
 *  IMPORTANTE: cada vez que edites el codigo, debes crear una NUEVA VERSION
 *  de la implementacion (Implementar > Gestionar implementaciones > editar >
 *  Version: Nueva) para que los cambios salgan en vivo.
 * ============================================================================
 */

var CONFIG = {
  // Cambia esto cada vez que edites el archivo. La respuesta lo devuelve, asi
  // sabes si la implementacion esta sirviendo el codigo nuevo o uno viejo.
  VERSION: '2026-08-25a',

  // ID del spreadsheet. Esta en la URL entre /d/ y /edit
  // https://docs.google.com/spreadsheets/d/AQUI_VA_EL_ID/edit
  SPREADSHEET_ID: '1g20BHYXlPwgeSPDHV36OdWRxiB40Xb_7vSbPpZPiiFo',

  // Clave compartida. Cambiala por cliente. El dashboard la envia como ?token=
  // No es seguridad fuerte (viaja en el frontend); es para evitar que el
  // endpoint quede totalmente abierto a bots. Ver README > Seguridad.
  // NUNCA dejes la clave real en este archivo: el repo es publico.
  // La real vive solo en el editor de Apps Script y en el navegador de cada
  // persona autorizada (la escribe en la pantalla de acceso del dashboard).
  TOKEN: 'PON_AQUI_TU_CLAVE_EN_EL_EDITOR_DE_APPS_SCRIPT',

  // Pestanas a exponer. [] = todas las pestanas del spreadsheet.
  // Ej: ['Lead Magnets Tracker', 'Webinar Registrants', 'Webinar Attendees']
  TABS: [],

  // Pestanas a ignorar siempre (notas internas, hojas de calculo auxiliares).
  IGNORE_TABS: ['Notas', 'Config', 'Calculos'],

  // Cache en segundos. 30-60s es suficiente para "tiempo real" y protege
  // la cuota de Apps Script si varias personas abren el dashboard.
  CACHE_SECONDS: 45,

  // Limite de filas por pestana (protege contra hojas gigantes).
  MAX_ROWS: 5000
};

/** Punto de entrada HTTP GET. */
function doGet(e) {
  var params = (e && e.parameter) || {};
  var callback = params.callback || null;

  try {
    // Se recorta el espacio en blanco: copiar y pegar suele arrastrar un
    // espacio final que hace fallar la comparacion sin que se vea.
    var given = String(params.token == null ? '' : params.token).trim();
    var want = String(CONFIG.TOKEN || '').trim();

    if (want && given !== want) {
      return respond({
        ok: false,
        error: 'unauthorized',
        version: CONFIG.VERSION,
        // Solo longitudes: no se filtra el token, pero se ve al instante si el
        // problema es que no coinciden o que la implementacion es vieja.
        hint: 'token recibido: ' + given.length + ' caracteres; esperado: '
          + want.length + ' caracteres'
      }, callback);
    }

    var fresh = params.fresh === '1';
    var cache = CacheService.getScriptCache();
    var cacheKey = 'funnel_payload_' + CONFIG.VERSION;

    if (!fresh && CONFIG.CACHE_SECONDS > 0) {
      var hit = cache.get(cacheKey);
      if (hit) return respond(JSON.parse(hit), callback);
    }

    var payload = buildPayload_();

    if (CONFIG.CACHE_SECONDS > 0) {
      var asText = JSON.stringify(payload);
      // CacheService topa en 100KB por entrada; si no cabe, servimos sin cache.
      if (asText.length < 95000) cache.put(cacheKey, asText, CONFIG.CACHE_SECONDS);
    }

    return respond(payload, callback);
  } catch (err) {
    return respond({ ok: false, error: String(err && err.message || err) }, callback);
  }
}

/** Lee todas las pestanas configuradas y las devuelve como arrays de objetos. */
function buildPayload_() {
  var ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var wanted = CONFIG.TABS && CONFIG.TABS.length ? CONFIG.TABS : null;
  var ignore = {};
  (CONFIG.IGNORE_TABS || []).forEach(function (n) { ignore[String(n).toLowerCase()] = true; });

  var tabs = {};
  var meta = [];

  ss.getSheets().forEach(function (sheet) {
    var name = sheet.getName();
    if (ignore[name.toLowerCase()]) return;
    if (wanted && wanted.indexOf(name) === -1) return;

    var rows = readSheet_(sheet);
    tabs[name] = rows;
    meta.push({ tab: name, rows: rows.length });
  });

  return {
    ok: true,
    version: CONFIG.VERSION,
    spreadsheet: ss.getName(),
    updatedAt: new Date().toISOString(),
    timezone: ss.getSpreadsheetTimeZone(),
    tabs: tabs,
    meta: meta
  };
}

/** Convierte una pestana en array de objetos usando la fila 1 como cabecera. */
function readSheet_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];

  var take = Math.min(lastRow - 1, CONFIG.MAX_ROWS);
  var headerRaw = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  var values = sheet.getRange(2, 1, take, lastCol).getDisplayValues();

  // Varias cabeceras del sheet de RPA traen saltos de linea ("UTM Source\nLatest").
  // Se normalizan a un solo espacio para poder referenciarlas desde el config.
  var headers = headerRaw.map(function (h) {
    return String(h || '').replace(/\s+/g, ' ').trim();
  });

  var out = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var obj = {};
    var hasData = false;

    for (var c = 0; c < headers.length; c++) {
      var key = headers[c];
      if (!key) continue;
      var val = row[c];
      val = (val === null || val === undefined) ? '' : String(val).trim();
      obj[key] = val;
      if (val !== '') hasData = true;
    }

    if (hasData) out.push(obj);
  }
  return out;
}

/** Devuelve JSON (o JSONP si viene ?callback=). */
function respond(obj, callback) {
  var body = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + body + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(body)
    .setMimeType(ContentService.MimeType.JSON);
}

/** Utilidad: ejecutar manualmente en el editor para verificar la conexion.
 *  Imprime las filas y las columnas de CADA pestana, para poder mapearlas
 *  en clients/<cliente>.json sin adivinar nombres. */
function testConnection() {
  var p = buildPayload_();
  Logger.log('Spreadsheet: ' + p.spreadsheet);
  p.meta.forEach(function (m) { Logger.log('  ' + m.tab + ': ' + m.rows + ' filas'); });

  p.meta.forEach(function (m) {
    var rows = p.tabs[m.tab] || [];
    var cols = Object.create(null);
    // Se recorren varias filas: la primera puede tener celdas vacias y
    // entonces esa columna no aparece en el objeto.
    rows.slice(0, 25).forEach(function (r) {
      Object.keys(r).forEach(function (k) { cols[k] = 1; });
    });
    Logger.log('--- ' + m.tab + ' ---');
    Logger.log(Object.keys(cols).join(' | '));
    if (rows[0]) Logger.log('ejemplo: ' + JSON.stringify(rows[0]).slice(0, 600));
  });
}
