import React from 'react'

const BMC_LINK = 'https://buymeacoffee.com/shinengakic'

/**
 * PoweruserNotice - Displays a message with a link to support the project via Buy Me a Coffee
 * @component
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Content to display before the support link
 * @returns {JSX.Element} Rendered notice with support link
 */
export function PoweruserNotice({ children }) {
  return (
    <div style={{ marginTop: 12, color: '#c00', fontSize: 13 }}>
      {children}{' '}
      <a href={BMC_LINK} target="_blank" rel="noopener noreferrer">Buy me a coffee</a>.
    </div>
  )
}

/**
 * PoweruserNoticeLink - Displays a notice that a feature is only available for paying members with a link to support
 * @component
 * @returns {JSX.Element} Rendered notice for non-paying users
 */
export function PoweruserNoticeLink() {
  return (
    <div style={{ marginTop: 12, color: '#c00', fontSize: 13 }}>
      Diese Funktion ist nur für zahlende Mitglieder verfügbar. Bitte unterstützen Sie uns über{' '}
      <a href={BMC_LINK} target="_blank" rel="noopener noreferrer">Buy me a coffee</a>.
    </div>
  )
}