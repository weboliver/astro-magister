import React, { useState } from 'react'
import AdminProviderConfigTab from './AdminProviderConfigTab'
import AdminBuildWikiTab from './AdminBuildWikiTab'
import AdminThemeTab from './AdminThemeTab'

const subtabs = [
  { id: 'provider', label: 'Chat-Provider' },
  { id: 'wiki', label: 'Build Wiki' },
  { id: 'theme', label: 'Theme' }
]

export default function AdminEinstellungenTab(){
  const [activeSubtab, setActiveSubtab] = useState('provider')

  const activeSubtabContent = (() => {
    if (activeSubtab === 'provider') return <AdminProviderConfigTab />
    if (activeSubtab === 'wiki') return <AdminBuildWikiTab />
    if (activeSubtab === 'theme') return <AdminThemeTab />
    return null
  })()

  return (
    <div>
      <div className="admin-tabs" role="tablist" aria-label="Einstellungen Bereiche" style={{marginBottom: '16px'}}>
        {subtabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeSubtab === tab.id}
            className={activeSubtab === tab.id ? 'admin-tab admin-tab-active' : 'admin-tab'}
            onClick={() => setActiveSubtab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeSubtabContent}
    </div>
  )
}
