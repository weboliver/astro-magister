import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { get } from '../services/api'

/**
 * WikiPageShortcut - Button zum passenden Wiki-Eintrag, wenn es ihn gibt
 * @component
 * @description Die Existenzprüfung läuft weiter über `page-entries`; der Button bleibt ein
 *              `<button>`, weil das Prüfen keine Navigation ist. Der Klick navigiert aber echt auf
 *              `/wiki/<slug>` statt ein Custom-Event zu senden; Einträge ohne Slug (nullable)
 *              fallen auf `/wiki?artikel=<id>` zurück, statt den Button zu verlieren. `originPage`
 *              und `originLabel` bleiben im Prop-Vertrag (Aufrufer in `InterpretationPage.jsx`),
 *              tragen aber keinen Navigationszustand mehr — der steckt jetzt in der Adresse.
 * @param {Object} props - Component props
 * @param {string} props.pageName - Name of the wiki page to check and navigate to
 * @param {string} [props.originPage=''] - Origin page name (Vertrag bleibt, ungenutzt)
 * @param {string} [props.originLabel=''] - Origin label (Vertrag bleibt, ungenutzt)
 * @returns {JSX.Element|null} Button to navigate to wiki page, or null if page doesn't exist
 */
export default function WikiPageShortcut({ pageName }){
  const navigate = useNavigate()
  // Ziel des Sprungs: Slug, wenn vorhanden; sonst die ID (Slug ist in der DB nullable).
  const [target, setTarget] = useState({ slug: '', entryId: 0 })

  useEffect(() => {
    let active = true

    async function checkLink(){
      const normalizedPageName = String(pageName || '').trim()
      if (!normalizedPageName) {
        if (active) setTarget({ slug: '', entryId: 0 })
        return
      }

      try{
        const params = new URLSearchParams({ page_name: normalizedPageName })
        const resp = await get(`/wiki/page-entries?${params.toString()}`)
        if (!resp.ok) throw new Error('Link nicht verfügbar')
        const data = await resp.json()
        if (!active) return
        // Der erste Treffer ist das Navigationsziel: `/wiki/:slug`, ohne Slug `/wiki?artikel=<id>`.
        const first = Array.isArray(data) ? data[0] : null
        const entryId = Number(first?.entry_id)
        setTarget({
          slug: String(first?.slug || ''),
          entryId: Number.isInteger(entryId) && entryId > 0 ? entryId : 0,
        })
      }catch(_){
        if (active) setTarget({ slug: '', entryId: 0 })
      }
    }

    checkLink()
    return () => {
      active = false
    }
  }, [pageName])

  const { slug, entryId } = target
  if (!slug && !entryId) return null

  return (
    <button
      type="button"
      onClick={() => navigate(slug ? '/wiki/' + encodeURIComponent(slug) : '/wiki?artikel=' + entryId)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        background: 'rgba(var(--admin-accent-r), var(--admin-accent-g), var(--admin-accent-b), 0.12)',
        border: '1px solid var(--admin-accent)',
        borderRadius: 999,
        padding: '8px 14px',
        cursor: 'pointer',
        color: 'var(--admin-accent)',
        fontSize: 15,
        fontWeight: 700,
        lineHeight: 1,
        boxShadow: 'var(--admin-shadow)',
      }}
      title={`Erläuterung zu ${pageName} öffnen`}
      aria-label={`Erläuterung zu ${pageName} öffnen`}
    >
      {/* „Erläuterung" statt „Wiki": das Ziel ist eine Seiten-Erläuterung, kein Wiki-Artikel. */}
      <span>Erläuterung</span>
      <span style={{ fontSize: 24, lineHeight: 1, fontWeight: 800 }}>→</span>
    </button>
  )
}
