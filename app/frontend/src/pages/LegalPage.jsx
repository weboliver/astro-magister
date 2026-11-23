/**
 * LegalPage - Impressum, Datenschutz und Kontakt als eigene Adressen
 * @component
 * @description Der Inhalt kommt unverändert aus dem Wiki-`page-entries`-Mechanismus. Den
 *              Seitennamen liefert ausschließlich der `handle` der aktiven Route (`pageName`);
 *              damit bleibt `src/routing/pages.js` die einzige Quelle für Pfad und Seite.
 *              Der Endpunkt wird über `get()` aus `services/api.js` aufgerufen — kein `fetch`, kein
 *              `/api`-Literal im Aufrufer (Gate `scripts/check-api-urls.mjs`).
 * @hook useMatches - `handle.pageName` der aktiven Route
 * @hook useState - Einträge, Lade- und Fehlerzustand
 * @hook useEffect - Laden bei Seitennamen-Wechsel, Abbruch veralteter Antworten über `active`
 * @returns {JSX.Element} Artikel mit Überschrift und Markdown-Inhalt
 */
import React, { useEffect, useState } from 'react'
import { useMatches } from 'react-router'
import MarkdownArticle from '../components/MarkdownArticle'
import { get } from '../services/api'

const LOAD_ERROR_MESSAGE = 'Der Inhalt konnte nicht geladen werden. Bitte später erneut versuchen.'
const EMPTY_MESSAGE = 'Zu dieser Seite ist noch kein Inhalt hinterlegt.'

export default function LegalPage() {
  const matches = useMatches()
  const pageName = matches.at(-1)?.handle?.pageName || ''
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const normalizedPageName = String(pageName || '').trim()
    if (!normalizedPageName) {
      setEntries([])
      setLoading(false)
      setError('')
      return undefined
    }

    let active = true
    setLoading(true)
    setError('')

    ;(async () => {
      try {
        const params = new URLSearchParams({ page_name: normalizedPageName })
        const resp = await get(`/wiki/page-entries?${params.toString()}`)
        if (!resp.ok) throw new Error(`page-entries ${resp.status}`)
        const data = await resp.json()
        if (!active) return
        setEntries(Array.isArray(data) ? data : [])
      } catch (_) {
        if (!active) return
        setEntries([])
        setError(LOAD_ERROR_MESSAGE)
      } finally {
        if (active) setLoading(false)
      }
    })()

    return () => {
      active = false
    }
  }, [pageName])

  return (
    <article className="app-page-panel" data-testid="page-legal" data-page-name={pageName}>
      {loading ? <div className="app-page-loading">Laden…</div> : null}
      {!loading && error ? <p role="alert">{error}</p> : null}
      {!loading && !error && entries.length === 0 ? <p>{EMPTY_MESSAGE}</p> : null}
      {!loading && !error
        ? entries.map((entry) => (
          <MarkdownArticle key={entry.entry_id} content={entry.entry_content} />
        ))
        : null}
    </article>
  )
}
