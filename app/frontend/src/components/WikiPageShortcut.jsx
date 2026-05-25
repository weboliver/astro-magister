import React, { useEffect, useState } from 'react'
import { get } from '../services/api'

/**
 * WikiPageShortcut - Displays a button to navigate to a wiki page if it exists
 * @component
 * @param {Object} props - Component props
 * @param {string} props.pageName - Name of the wiki page to check and navigate to
 * @param {string} [props.originPage=''] - Origin page name for tracking navigation context
 * @param {string} [props.originLabel=''] - Origin label for display purposes
 * @returns {JSX.Element|null} Button to navigate to wiki page, or null if page doesn't exist
 */
export default function WikiPageShortcut({ pageName, originPage = '', originLabel = '' }){
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let active = true

    async function checkLink(){
      const normalizedPageName = String(pageName || '').trim()
      if (!normalizedPageName) {
        if (active) setVisible(false)
        return
      }

      try{
        const params = new URLSearchParams({ page_name: normalizedPageName })
        const resp = await get(`/wiki/page-entries?${params.toString()}`)
        if (!resp.ok) throw new Error('Link nicht verfügbar')
        const data = await resp.json()
        if (active) setVisible(Array.isArray(data) && data.length > 0)
      }catch(_){
        if (active) setVisible(false)
      }
    }

    checkLink()
    return () => {
      active = false
    }
  }, [pageName])

  if (!visible) return null

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent('astronexNavigate', {
        detail: {
          page: 'wiki',
          state: {
            directPageName: pageName,
            directOriginPage: originPage,
            directOriginLabel: originLabel,
          },
        },
      }))}
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
      title={`Wiki-Eintrag für ${pageName} öffnen`}
      aria-label={`Wiki-Eintrag für ${pageName} öffnen`}
    >
      <span>Wiki</span>
      <span style={{ fontSize: 24, lineHeight: 1, fontWeight: 800 }}>→</span>
    </button>
  )
}