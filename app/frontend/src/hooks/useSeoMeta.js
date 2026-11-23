import { useEffect } from 'react'
import { DEFAULT_CANONICAL } from '../services/canonical'

const SITE_NAME = 'Astro-Magister'
const DEFAULT_DESCRIPTION = 'Astro-Magister ist ein Portal für astrologische Selbsterfahrung. Erforsche dein Horoskop, Planeten, Häuser, Transite, Alterspunkte und das astrologische Wiki.'

function setMetaDescription(content) {
  if (typeof document === 'undefined') return
  const el = document.querySelector('meta[name="description"]')
  if (el) el.setAttribute('content', content || DEFAULT_DESCRIPTION)
}

function setCanonical(url) {
  if (typeof document === 'undefined') return
  const el = document.querySelector('link[rel="canonical"]')
  if (el) el.setAttribute('href', url || DEFAULT_CANONICAL)
}

function setOgMeta(title, description) {
  if (typeof document === 'undefined') return
  const ogTitle = document.querySelector('meta[property="og:title"]')
  const ogDesc = document.querySelector('meta[property="og:description"]')
  const twTitle = document.querySelector('meta[name="twitter:title"]')
  const twDesc = document.querySelector('meta[name="twitter:description"]')
  if (ogTitle) ogTitle.setAttribute('content', title)
  if (ogDesc) ogDesc.setAttribute('content', description || DEFAULT_DESCRIPTION)
  if (twTitle) twTitle.setAttribute('content', title)
  if (twDesc) twDesc.setAttribute('content', description || DEFAULT_DESCRIPTION)
}

/**
 * Updates document.title and all relevant meta tags.
 * @param {string} pageTitle  - The page-specific part of the title (without site name)
 * @param {string} [description] - Optional page description; falls back to default
 * @param {boolean} [enabled=true] - `false` lässt Titel und Meta unangetastet (Seiten mit
 *   eigenem, erst nach dem Laden bekannten Titel — `dynamicTitle` im Route-`handle`)
 * @param {string} [canonicalUrl] - Absolutes Canonical der Seite; ohne Wert wird auf
 *   `DEFAULT_CANONICAL` zurückgesetzt — derselbe Wert wie im statischen `index.html`
 */
export function useSeoMeta(pageTitle, description, enabled = true, canonicalUrl = null) {
  useEffect(() => {
    if (!enabled) return
    const fullTitle = pageTitle ? `${pageTitle} | ${SITE_NAME}` : `${SITE_NAME} – Portal für astrologische Selbsterfahrung`
    document.title = fullTitle
    setMetaDescription(description)
    setOgMeta(fullTitle, description)
    // In einer SPA ist das statische Canonical der ersten Dokumentladung nach einer Navigation
    // längst überschrieben. „Nichts tun" ließe deshalb das Canonical der Vorseite stehen
    // (z. B. `/horoscope`) — ohne URL wird auf die Wurzel zurückgesetzt.
    setCanonical(canonicalUrl)
  }, [pageTitle, description, enabled, canonicalUrl])
}
