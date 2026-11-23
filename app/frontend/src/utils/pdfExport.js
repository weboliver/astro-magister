import { apiUrl } from '../services/api.js'

/**
 * Öffnet ein neues Browserfenster mit der gerenderten Auswertung und
 * löst den Druckdialog aus (→ "Als PDF speichern").
 *
 * @param {string}      title                   Titel der Auswertung
 * @param {HTMLElement} element                 Das gerenderte Markdown-Element
 * @param {object}      [opts]
 * @param {string}      [opts.personName]        Name der Person
 * @param {string}      [opts.birthDate]         Geburtsdatum (formatiert, z.B. "15.3.1990")
 * @param {string}      [opts.birthCity]         Geburtsstadt
 * @param {string}      [opts.birthRegionCode]   Bundesland-Code (z.B. "06")
 * @param {string}      [opts.birthCountryCode]  Länder-Code (z.B. "GM" oder "DE")
 * @param {string}      [opts.additionalQuestion] Erste Zusatzfrage
 * @param {string}      [opts.imageUrl]          Blob-URL oder reguläre URL der Chart-Grafik
 */
export async function printInterpretationAsPdf(title, element, { personName, birthDate, birthCity, birthRegionCode, birthCountryCode, additionalQuestion, imageUrl } = {}) {
  if (!element) return

  // Das Fenster wird ZUERST geöffnet, noch im Gesten-Kontext des Klicks (IN-08). Vorher stand
  // `window.open` hinter zwei Netzwerk-Requests und einem FileReader: bei langsamem
  // `/locations/countries` oder großem Chart-Blob fiel der Aufruf aus der transienten
  // Nutzeraktivierung und der Popup-Blocker schlug zu — der Nutzer sah nur den `alert` unten.
  // Der Inhalt wird in dasselbe Fenster geschrieben, sobald die Daten da sind.
  const win = window.open('', '_blank')
  if (!win) {
    alert('Popup wurde blockiert. Bitte Popup-Blocker für diese Seite deaktivieren.')
    return
  }

  // Der gerenderte Markdown-Baum wird ROH übernommen (IN-10): diese Zeile ist nur deshalb sicher,
  // weil der Inhalt aus zwei Zusagen stammt, die hier nicht lokal prüfbar sind —
  //   1. `MarkdownRenderer` rendert ohne `rehype-raw`, d. h. Quell-HTML im Markdown wird escaped
  //      (kein `innerHTML` aus Fremdquellen in diesem Baum), und
  //   2. das Popup erbt die strenge CSP des Openers (Begründung unten am `write`), sodass ein
  //      eingeschmuggeltes `<script>`/`on…`-Attribut nicht ausgeführt würde.
  // Wer eine dieser beiden Zusagen ändert, muss diese Zeile entschärfen (sanitizen) — nicht
  // umgekehrt. Der Wert landet unten in `${htmlContent}` im Popup-Body.
  const htmlContent = element.innerHTML

  // Länder- und Bundesland-Codes in Namen auflösen
  let birthPlace = ''
  try {
    const [countriesRes, regionsRes] = await Promise.all([
      birthCountryCode ? fetch(apiUrl('/locations/countries'), { credentials: 'include' }) : Promise.resolve(null),
      birthCountryCode && birthRegionCode ? fetch(apiUrl(`/locations/regions?country=${encodeURIComponent(birthCountryCode)}`), { credentials: 'include' }) : Promise.resolve(null),
    ])
    let countryName = birthCountryCode || ''
    let regionName = birthRegionCode || ''
    if (countriesRes?.ok) {
      const countries = await countriesRes.json()
      const found = countries.find(c => c.code?.toUpperCase() === birthCountryCode?.toUpperCase())
      if (found) countryName = found.name
    }
    if (regionsRes?.ok) {
      const regions = await regionsRes.json()
      const found = regions.find(r => r.code === birthRegionCode)
      if (found) regionName = found.name
    }
    birthPlace = [birthCity, regionName, countryName].filter(Boolean).join(', ')
  } catch {
    birthPlace = [birthCity, birthRegionCode, birthCountryCode].filter(Boolean).join(', ')
  }

  // Blob-URL → base64 Data-URL konvertieren, damit das Popup die Grafik unabhängig von der
  // Lebensdauer der Blob-URL einbettet (useChartCache widerruft alte URLs).
  //
  // Bewusst KEIN fetch(): seit Phase 47 gilt `connect-src 'self'`, und `blob:` fällt nicht unter
  // 'self' — fetch(blobUrl) wurde blockiert, der catch verschluckte den Fehler und das PDF kam
  // ohne Grafik. Ein <img> lädt über `img-src 'self' data: blob:` und ist damit erlaubt; das
  // Canvas einer same-origin Blob-Grafik ist nicht "tainted", toDataURL funktioniert.
  let imageDataUrl = null
  if (imageUrl) {
    try {
      imageDataUrl = await imageUrlToDataUrl(imageUrl)
    } catch {
      // Grafik konnte nicht geladen werden – trotzdem weitermachen
    }
  }

  const displayName = personName ? personName.charAt(0).toUpperCase() + personName.slice(1) : ''
  const metaHasContent = personName || birthDate || birthPlace || additionalQuestion
  const metaBlock = metaHasContent ? `
    <div class="pdf-meta-block">
      ${displayName  ? `<div class="pdf-meta-row"><span class="pdf-meta-label">Person:</span> <span>${escapeHtml(displayName)}</span></div>` : ''}
      ${birthDate    ? `<div class="pdf-meta-row"><span class="pdf-meta-label">Geburtsdatum:</span> <span>${escapeHtml(birthDate)}</span></div>` : ''}
      ${birthPlace   ? `<div class="pdf-meta-row"><span class="pdf-meta-label">Geburtsort:</span> <span>${escapeHtml(birthPlace)}</span></div>` : ''}
      ${additionalQuestion ? `<div class="pdf-meta-row"><span class="pdf-meta-label">Zusatzfrage:</span> <span>${escapeHtml(additionalQuestion)}</span></div>` : ''}
    </div>
    <hr>` : ''

  const imageBlock = imageDataUrl
    ? `<div class="pdf-chart"><img src="${escapeHtml(imageDataUrl)}" alt="Chart" /></div><hr>`
    : ''

  win.document.write(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: Georgia, 'Times New Roman', serif;
      max-width: 720px;
      margin: 48px auto;
      padding: 0 24px;
      color: #1a1a2e;
      line-height: 1.7;
      font-size: 15px;
    }
    h1.pdf-title {
      font-size: 1.5em;
      color: #0f766e;
      border-bottom: 2px solid #0f766e;
      padding-bottom: 8px;
      margin-bottom: 16px;
    }
    .pdf-meta-block { margin-bottom: 4px; font-family: Inter, Arial, sans-serif; font-size: 0.95em; }
    .pdf-meta-row { margin: 3px 0; }
    .pdf-meta-label { font-weight: 700; min-width: 130px; display: inline-block; }
    .pdf-chart { text-align: center; margin: 20px 0; }
    .pdf-chart img { max-width: 100%; max-height: 480px; object-fit: contain; border-radius: 8px; }
    h1, h2, h3 { color: #11243d; margin-top: 1.4em; }
    h1 { font-size: 1.3em; }
    h2 { font-size: 1.15em; }
    h3 { font-size: 1.05em; }
    p { margin: 0.5em 0 0.8em; }
    ul, ol { padding-left: 1.5em; margin: 0.4em 0 0.8em; }
    li { margin-bottom: 0.25em; }
    strong { font-weight: 700; }
    em { font-style: italic; }
    code { font-family: 'Courier New', monospace; background: #f0f0f0; padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }
    pre { background: #f5f5f5; padding: 12px; border-radius: 6px; overflow-x: auto; }
    hr { border: none; border-top: 1px solid #c8c0b0; margin: 1.6em 0; }
    table { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
    th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
    th { background: #f0ece4; }
    @media print {
      body { margin: 20px; max-width: 100%; }
      h1.pdf-title { color: #000; border-color: #000; }
      h1, h2, h3 { color: #000; }
    }
  </style>
</head>
<body>
  <h1 class="pdf-title">${escapeHtml(title)}</h1>
  ${metaBlock}
  ${imageBlock}
  ${htmlContent}
</body>
</html>`)

  // Phase 47 (R-02): the popup document must not carry an inline script block. An about:blank
  // window inherits the opener's CSP (CSP3 / HTML policy container), and the enforced policy in
  // the nginx templates only allows scripts carrying the per-request nonce — which this
  // browser-written document never gets, so an inline script here would simply be blocked.
  // The print dialog is therefore triggered from the OPENER (ordinary code, not subject to the
  // popup document's CSP). The listener is registered AFTER document.write because
  // document.open() discards the window's listeners, and close() is needed for load to fire.
  win.addEventListener('load', () => { win.focus(); win.print(); }, { once: true })
  win.document.close()
}

/** Lädt eine Bild-URL über ein <img> (CSP img-src) und liefert sie als PNG-Data-URL. */
function imageUrlToDataUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        canvas.getContext('2d').drawImage(img, 0, 0)
        resolve(canvas.toDataURL('image/png'))
      } catch (err) {
        reject(err)
      }
    }
    img.onerror = reject
    img.src = url
  })
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

