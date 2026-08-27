# Dashboard de embudo — motor multi-cliente

Dashboard estático (HTML + CSS + JS, cero dependencias) que lee un Google Sheet
en vivo y muestra cada etapa del embudo con sus números y el detalle persona por
persona. Se publica en GitHub Pages y se duplica por cliente cambiando **un solo
archivo JSON**.

---

## 1. Cómo funciona (arquitectura)

```
  GHL / Jotform / Zapier          Google Sheets            Apps Script            GitHub Pages
 ┌──────────────────────┐      ┌──────────────────┐     ┌────────────────┐     ┌──────────────┐
 │  Quiz, webinar,      │ ───► │  1 pestaña por   │ ──► │  Web App que   │ ──► │  index.html  │
 │  llamadas, compras   │      │  etapa del       │     │  devuelve JSON │     │  (dashboard) │
 └──────────────────────┘      │  embudo          │     │  con un token  │     └──────────────┘
                               └──────────────────┘     └────────────────┘
        (lo que ya hacen)         (sigue siendo la          (5 min de setup,      (lo que ve
                                   fuente de verdad)         una vez por cliente)   el cliente)
```

**Nada cambia en el flujo actual.** GHL sigue escribiendo en el spreadsheet; el
cliente sigue teniendo su hoja de Excel. Lo único que se agrega es una capa de
lectura que convierte esa hoja en un dashboard presentable.

### Por qué Apps Script y no la API de Google directamente

| Opción | Veredicto |
|---|---|
| **Apps Script Web App** ✅ | La hoja puede quedar **privada**; el script corre con tu cuenta. No hay API key en el navegador. Gratis. Tiempo real. Se duplica copiando el archivo. |
| Google Sheets API v4 | Requiere API key (visible en el frontend) **y** que la hoja sea pública. Peor seguridad, mismo resultado. |
| Publicar la hoja como CSV/gviz | Cero setup, pero obliga a publicar la hoja a la web. Soportado como plan B (`"type": "gviz"`). |
| Conectar GHL directo por API | El token de GHL no puede vivir en una página estática. Necesitaría un proxy (Cloudflare Worker). Innecesario: GHL ya escribe en Sheets. |
| GitHub Actions que hace commit de un `data.json` | Funciona, pero “tiempo real” pasa a ser “cada 5–10 min” y ensucia el historial de git. |

---

## 2. Estructura del repo

```
funnel-dashboard/
├── index.html              # la página (no se toca por cliente)
├── assets/
│   ├── app.js              # motor: normaliza, calcula el embudo, dibuja
│   └── styles.css          # tema claro/oscuro
├── clients/
│   ├── rpa.json            # ⬅ UN archivo por cliente. Aquí vive todo lo específico.
│   └── _template.json      # plantilla para el siguiente cliente
├── apps-script/
│   └── Code.gs             # el API. Se pega en script.google.com
├── data/
│   ├── demo.json           # dataset sintético (para demos y para probar sin conectar)
│   └── make-demo.py        # lo regenera
└── .nojekyll
```

Cada cliente es una URL:

```
https://<usuario>.github.io/funnel-dashboard/?client=rpa
https://<usuario>.github.io/funnel-dashboard/?client=otrocliente
```

---

## 3. Puesta en marcha (una vez por cliente, ~15 min)

### 3.1 El spreadsheet de RPA

Ya está mapeado. El config `clients/rpa.json` apunta al sheet
`1g20BHYXlPwgeSPDHV36OdWRxiB40Xb_7vSbPpZPiiFo` y a estas cinco pestañas:

| Pestaña | Qué es | Papel en el dashboard |
|---|---|---|
| `Ticket Buyers - UTM Tracking Sheet` | compradores del ticket de $29 + UTMs + cierre | **entrada del embudo** y **cierre** (columna `Closed` + `Program Revenue`) |
| `Webinar Ticket Purchase Quiz Responses` | quiz de intención post-compra | etapa 2 del embudo + tier (Hot Lead / Nurture / Low Intent / Exclude) |
| `Program Buyers` | ledger de transacciones con `GHL ID` | expediente de la persona + **llave de identidad** |
| `Event Tracker` | una fila por webinar: ad spend, asistentes, ROAS, CAC | sección "Rendimiento por webinar" |
| `Lead Magnets Tracker` | quiz de reconexión (lead magnet) | embudo aparte; alimenta segmentos y expediente |

**El embudo por persona es:**

```
Compró ticket ($29)  →  Completó el quiz de intención  →  Cerró el programa
```

`Hot Lead` **no** es un paso del embudo: es una calificación en paralelo (los
"Nurture" también cierran). Por eso aparece como KPI y como filtro, no como
barra del embudo — ponerlo en la cadena haría que la tasa de cierre se
calculara contra una base equivocada.

Igual pasa con el lead magnet: la mayoría de los compradores de ticket nunca
pasó por el quiz de reconexión, así que no es upstream. Va marcado como
`"funnel": false`.

#### El hueco: asistencia al webinar

**No hay asistencia por persona en ningún lado.** `Event Tracker` tiene el
total de `Attendees` por webinar, pero no quién asistió. Eso rompe el paso más
importante del embudo (ticket → asistió → cerró) y hace imposible responder
"¿de los que asistieron, cuántos cerraron?" persona por persona.

Arreglarlo es exportar la lista de asistentes de la plataforma del webinar
(Zoom / StreamYard / GHL) a una pestaña nueva con `Email` y `Attended At`.
Cuando exista, se agrega como etapa entre `ticket` y `closed` — son 12 líneas
de JSON, cero código.

### 3.2 Desplegar el API### 3.2 Desplegar el API

1. [script.google.com](https://script.google.com) → **Nuevo proyecto**.
2. Pegar el contenido de `apps-script/Code.gs`.
3. Editar `CONFIG`:
   ```js
   SPREADSHEET_ID: '1g20BHYXlPwgeSPDHV36OdWRxiB40Xb_7vSbPpZPiiFo'  // ya viene puesto
   TOKEN: 'rpa-8f3a91c2'       // inventa uno distinto por cliente
   ```
4. Ejecutar la función `testConnection` una vez (autoriza los permisos y
   muestra en el log las pestañas y columnas que detectó).
5. **Implementar → Nueva implementación → Aplicación web**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona**
6. Copiar la URL que termina en `/exec`.
7. Probar en el navegador: `https://script.google.com/.../exec?token=rpa-8f3a91c2`
   → debe devolver JSON.

> ⚠️ Cada vez que edites el código, hay que crear una **versión nueva** de la
> implementación. Si no, sigue corriendo la versión anterior.

### 3.3 Conectar el dashboard

En `clients/rpa.json`:

```json
"source": {
  "type": "apps-script",
  "url": "https://script.google.com/macros/s/AKfy.../exec",
  "token": "rpa-8f3a91c2",
  "refreshSeconds": 60
}
```

Listo. El dashboard se actualiza solo cada 60 s, al volver a la pestaña del
navegador, y con el botón **Actualizar**.

### 3.4 Publicar

```bash
git init && git add . && git commit -m "dashboard de embudo"
git remote add origin git@github.com:<usuario>/funnel-dashboard.git
git push -u origin main
```

GitHub → **Settings → Pages → Source: Deploy from branch → main / (root)**.

---

## 4. Duplicar para otro cliente

1. `cp clients/_template.json clients/nuevocliente.json`
2. Editar: nombre, etapas, KPIs, segmentos, columnas de la tabla.
3. Copiar `Code.gs` a un proyecto nuevo de Apps Script con el `SPREADSHEET_ID`
   y `TOKEN` de ese cliente; desplegar; pegar la URL en el JSON.
4. Enviar `...github.io/funnel-dashboard/?client=nuevocliente`.

No se toca `index.html`, `app.js` ni `styles.css`. Una mejora al motor mejora
todos los dashboards a la vez.

---

## 5. Referencia del archivo de cliente

| Bloque | Para qué sirve |
|---|---|
| `client` | Nombre, subtítulo, idioma (`locale`) y moneda que se muestran arriba. |
| `source` | De dónde salen los datos (ver §3.3). `demoFallback` es la ruta al dataset de prueba. |
| `identity` | `idField` = columna con el ID del CRM (`GHL ID`); `mergeOnPhone` = unir también por teléfono. |
| `stages[]` | **El embudo, en orden.** `tab` = pestaña; `map` = qué columna es el email/nombre/fecha (`name` acepta un array: `["First Name","Last Name"]`); `when` = condición opcional (`in`, `notIn`, `notEmpty`); `map.value` = columna de dinero; `"funnel": false` = la etapa alimenta el expediente y los segmentos pero no la cadena de conversión. |
| `events` | Sección de métricas por evento. `kpis` acepta `agg: sum \| avg \| ratio`; `format: currency \| percent \| x \| number`. |
| `kpis[]` | Tarjetas de arriba. Tipos: `stageCount`, `stageValue`, `rate` (`from` → `to`). |
| `segments[]` | Un gráfico de barras por campo. `multi: true` para campos con valores separados por coma. `sort: "key"` ordena por valor en vez de por frecuencia. |
| `table.columns[]` | Columnas de la lista de personas. `raw.<etapa>.<Columna>` accede a cualquier dato crudo. Tipos: `stage`, `date`, `number`. |
| `detail.sections[]` | Qué se ve en el panel lateral al hacer clic en una persona. `"fields": "*"` muestra todo. |

---

## 6. Qué hace el dashboard

Cuatro vistas, una barra de fechas compartida.

### Barra de fechas (aplica a todo)

Presets 7 d / 30 d / 90 d / 12 m / Todo, **rango personalizado** con dos campos de
fecha, y **comparación contra el periodo anterior** (misma duración, justo antes):
al activarla cada KPI muestra su variación ▲/▼ en %.

Ojo con qué fecha se usa en cada vista — está escrito bajo la barra:

| Vista | Qué fecha filtra |
|---|---|
| Resumen / Personas | **primer contacto** de la persona (cohorte) |
| Ventas | **fecha del pago** — quien compró el ticket en marzo y cerró en julio suma en julio |
| Webinars | fecha del evento |

### Resumen

KPIs del embudo, embudo de conversión con conversión etapa a etapa y marca de
**fuga alta** bajo 40 %, evolución en el tiempo (una mini-serie por etapa, cada
una con su propia escala) y los gráficos de segmentación. Al hacer clic en una
barra del embudo salta a Personas ya filtrado por esa etapa.

### Ventas — el reporte de dinero

- **KPIs**: ingresos totales, del programa, por tickets, ticket promedio del
  programa, **valor por comprador de ticket** (ingreso total ÷ tickets) y
  clientes nuevos — todos con su delta vs el periodo anterior.
- **Ingresos en el tiempo**, separados por concepto.
- **Desgloses de ingreso**: Ads vs Orgánico, fuente, **creativo**, campaña,
  audiencia, webinar de cierre y nivel de precio. Todo el ingreso de una persona
  (ticket + programa) se atribuye al creativo/campaña que la trajo, así que se ve
  qué anuncio genera plata, no solo qué anuncio genera tickets.
- **Pagos del periodo**: el ledger fila por fila, con total al pie. Clic en una
  fila abre el expediente de la persona.

### Personas

Directorio con filtros por **etapa**, **tier**, **origen**, **fuente** y
**webinar**, buscador, orden por cualquier columna y paginación. Doce columnas:
etapa alcanzada (con el paso `n/3`), tier, score, origen, fuente, creativo,
valor total, primer contacto y última actividad.

### Expediente de la persona

Se abre con clic en cualquier fila (de Personas o del ledger de Ventas) y tiene
URL propia — el botón **Copiar enlace** da un link directo a ese perfil.

- **Hechos clave** en una rejilla: valor total, tier, score, origen, fuente,
  creativo, campaña, audiencia, webinar de cierre, monto del programa, primer y
  último contacto, tiempo en el embudo e ID del CRM.
- **Acciones**: copiar email, escribir, llamar, copiar enlace.
- **Notas** de inscripción y del webinar, destacadas.
- **Actividad**: línea de tiempo con *todo* lo que hizo, con montos — cada pago,
  la compra del ticket, el quiz con su tier, el cierre — más las etapas que aún
  no alcanzó.
- **Datos crudos** de cada pestaña, por si hace falta el detalle completo.

### Webinars

Una fila por evento con ad spend, tickets, asistentes, show-up, cierres, cash,
ROAS y CAC, con KPIs agregados y gráficos de ROAS / CAC / asistentes / show-up.

### Reportes

- **CSV** contextual al botón: en Ventas exporta todos los pagos, en Personas el
  directorio completo con todas las columnas crudas, en Webinars la tabla de
  eventos. Siempre respeta los filtros y el rango de fechas activos.
- **Reporte** abre el diálogo de impresión con la vista limpia (sin barras ni
  botones) — sirve para guardar un PDF y mandárselo al cliente.

Todo es responsive, tiene tema claro/oscuro y cada gráfico trae su "Ver como
tabla" para lectores de pantalla.

## 7. Seguridad — leer antes de enviarlo al cliente

**GitHub Pages es público.** Cualquiera con la URL ve el dashboard, y el token
del Apps Script viaja dentro del JavaScript de la página. Para datos con nombres,
emails y teléfonos de padres en situación de alienación parental, eso **no es
suficiente**.

Opciones, de menos a más trabajo:

| Nivel | Cómo | Coste |
|---|---|---|
| **Mínimo aceptable** | Publicar en **Cloudflare Pages** en vez de GitHub Pages y activar **Cloudflare Access** con lista de emails autorizados. El cliente entra con un código a su correo. | Gratis hasta 50 usuarios |
| Alternativa | **Netlify** con protección por contraseña del sitio | Plan Pro |
| Nivel empresa | GitHub Pages privado | requiere GitHub Enterprise |
| **No hacer** | Confiar en que la URL sea difícil de adivinar | — |

El código es idéntico en las tres: solo cambia dónde se sube. Recomiendo
**Cloudflare Pages + Access** — se conecta al mismo repo de GitHub y el deploy
sigue siendo `git push`.

Aparte de eso: `Code.gs` **nunca** debe exponer pestañas con notas internas
(usar `IGNORE_TABS`), y el `TOKEN` debe ser distinto por cliente.

---

## 8. Probar en local

```bash
cd funnel-dashboard
python3 -m http.server 8777
# abrir http://localhost:8777/index.html?client=rpa
```

Sin `source.url` configurado, arranca con `data/demo.json` (340 registros
sintéticos, ninguna persona real) y lo avisa con un banner. Sirve para
enseñarle el producto al cliente antes de tocar su hoja.

Regenerar la demo: `python3 data/make-demo.py`

---

## 9. Problemas frecuentes

| Síntoma | Causa |
|---|---|
| `Token invalido` | `source.token` ≠ `CONFIG.TOKEN`, o se editó `Code.gs` sin crear versión nueva de la implementación. |
| Una etapa marca 0 | El nombre de la pestaña en `stages[].tab` no coincide **exacto** (mayúsculas y espacios cuentan). |
| Personas duplicadas | La misma persona con dos emails distintos entre pestañas. El email es la llave; hay que normalizarlo en el origen (GHL). |
| Fechas raras / todo fuera de rango | El motor acepta `MM/DD/YYYY`, `MM/DD/YYYY HH:mm` e ISO. Otros formatos hay que normalizarlos en la hoja. |
| Se ve todo vacío en "7 d" | No hay registros recientes. Probar con "Todo". |
| `CORS` en consola | Se usó la URL `/dev` del Apps Script en vez de la `/exec`. |

---

## 10. Calidad de datos — lo que encontré en el sheet real

Estos no rompen el dashboard (el motor los tolera), pero sí distorsionan los
números. Vale la pena arreglarlos en el origen:

| Problema | Ejemplo | Efecto |
|---|---|---|
| **Misma persona, emails distintos** | `sounnesschiropractic1@` / `sounnesschiro@`; `catherinbf@` / `catherinebf@`; `rrosenmalus@` / `ronarosen29@` | El dashboard las une por teléfono/GHL ID, pero cualquier tabla dinámica del sheet las cuenta dos veces. |
| **Emails con errata** | `irmajara739@gmial.com`, `cat@edrut.oeg`, `pmennillo@hotmail.vom`, `pal86@ail.com` | No llegan los correos y rompen el cruce entre pestañas. |
| **Columna `Closed` mezcla formatos** | `Yes` en marzo–abril, fechas ISO desde abril | Los cierres anteriores a abril no tienen fecha, así que no se pueden ubicar en el tiempo. |
| **Filas duplicadas en `Program Buyers`** | Sherry Jester `$988` dos veces con el mismo GHL ID y el mismo minuto; Tyra Swanson `$100` ×2 | Infla el cash cobrado. |
| **Reembolsos como texto** | `REFUNDED` en la columna `Amount` | No resta; queda como no-numérico. El monto original sigue sumando. |
| **Teléfono inválido** | Justin Bussinger: `` ` `` | Sin llave de respaldo si el email falla. |
| **UTMs sin resolver** | `{{site_source_name}}`, `{{campaign.name}}` | Aparecen como una categoría más en los gráficos de creativo/campaña. |
| **Mayúsculas inconsistentes en campañas** | `RPA - Alienation Webinar (Purchase) - ABO` vs `Rpa - Alienation Webinar (purchase) - Abo` | Se cuentan como dos campañas distintas. |

La corrección de mayor impacto sigue siendo la de §3.1: **volcar la lista de
asistentes al webinar**. Sin eso, el paso donde realmente se pierde la gente es
invisible por persona.

---

## 11. Diseño e idioma

**La interfaz está en inglés** (el cliente final es angloparlante). Esta
documentación queda en español.

Decisiones de diseño, aplicadas con el skill `ui-ux-pro-max`:

| Área | Qué se hizo |
|---|---|
| Estilo | Minimalism / Swiss — el que la base recomienda para dashboards |
| Tipografía | **Fira Sans** (Google Fonts) con fallback al sistema; escala modular 12/13/14/16/18/24/32, sin tamaños arbitrarios |
| Contraste | Se corrigió el texto secundario: pasaba **3.50:1** en modo claro (falla WCAG AA). Ahora **4.96:1** claro / **5.74:1** oscuro. El gris de los ejes de gráficos quedó separado en `--ink-axis`. |
| Color de series | Un solo tono (`--s1`), validado con el script de la skill de dataviz en claro y oscuro. La longitud de la barra y la etiqueta directa cargan el significado, no el color. |
| Táctil | 44×44 px mínimo en punteros gruesos |
| Responsive | Sin scroll horizontal, verificado por medición a 375, 390, 768 y 1024 px. Bajo 720 px los botones pasan a solo icono (conservan `aria-label`). |
| Foco | Anillo visible en todo lo interactivo |
| Movimiento | Sutil, y desactivado con `prefers-reduced-motion` |

**Agrupado insensible a mayúsculas**: la hoja trae `Direct` y `direct`,
`RPA - Alienation…` y `Rpa - alienation…`. Se agrupan y se muestra la grafía
más frecuente; sin eso una misma categoría se partía en dos y ambas quedaban
subestimadas.
