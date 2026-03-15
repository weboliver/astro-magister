import React, { useEffect, useState } from 'react'
import { get } from '../services/api'

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
        const resp = await get(`/auth/wiki/page-entries?${params.toString()}`)
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
        background: 'linear-gradient(135deg, #ecfeff 0%, #ccfbf1 100%)',
        border: '1px solid #5eead4',
        borderRadius: 999,
        padding: '8px 14px',
        cursor: 'pointer',
        color: '#115e59',
        fontSize: 15,
        fontWeight: 700,
        lineHeight: 1,
        boxShadow: '0 6px 18px rgba(15, 118, 110, 0.12)',
      }}
      title={`Wiki-Eintrag für ${pageName} öffnen`}
      aria-label={`Wiki-Eintrag für ${pageName} öffnen`}
    >
      <span>Wiki</span>
      <span style={{ fontSize: 24, lineHeight: 1, fontWeight: 800 }}>→</span>
    </button>
  )
}