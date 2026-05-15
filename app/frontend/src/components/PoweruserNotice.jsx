import React from 'react'

const BMC_LINK = 'https://buymeacoffee.com/shinengakic'

export function PoweruserNotice({ children }) {
  return (
    <div style={{ marginTop: 12, color: '#c00', fontSize: 13 }}>
      {children}{' '}
      <a href={BMC_LINK} target="_blank" rel="noopener noreferrer">Buy me a coffee</a>.
    </div>
  )
}

export function PoweruserNoticeLink() {
  return (
    <div style={{ marginTop: 12, color: '#c00', fontSize: 13 }}>
      Diese Funktion ist nur für zahlende Mitglieder verfügbar. Bitte unterstützen Sie uns über{' '}
      <a href={BMC_LINK} target="_blank" rel="noopener noreferrer">Buy me a coffee</a>.
    </div>
  )
}