import { useEffect } from 'react'

const SITE_NAME = 'Astro-Magister'
const DEFAULT_DESCRIPTION = 'Astro-Magister ist ein Portal für astrologische Selbsterfahrung. Erforsche dein Horoskop, Planeten, Häuser, Transite, Alterspunkte und das astrologische Wiki.'

function setMetaDescription(content) {
  if (typeof document === 'undefined') return
  const el = document.querySelector('meta[name="description"]')
  if (el) el.setAttribute('content', content || DEFAULT_DESCRIPTION)
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
 */
export function useSeoMeta(pageTitle, description) {
  useEffect(() => {
    const fullTitle = pageTitle ? `${pageTitle} | ${SITE_NAME}` : `${SITE_NAME} – Portal für astrologische Selbsterfahrung`
    document.title = fullTitle
    setMetaDescription(description)
    setOgMeta(fullTitle, description)
  }, [pageTitle, description])
}
