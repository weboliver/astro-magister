import React from 'react'

/**
 * LoadingSpinner - Displays an animated spinner with an optional loading message
 * @component
 * @param {Object} props - Component props
 * @param {string} [props.message='Lade...'] - Message to display next to the spinner
 * @param {string} [props.size='1.4em'] - Size of the spinner (CSS value)
 * @returns {JSX.Element} Rendered loading spinner with message
 */
export function LoadingSpinner({ message = 'Lade...', size = '1.4em' }) {
  return (
    <span role="status" aria-live="polite" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: '#4b5d71' }}>
      <span style={{
        display: 'inline-block',
        width: size,
        height: size,
        border: '2px solid #d8cfc0',
        borderTopColor: '#0f766e',
        borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
        boxSizing: 'border-box',
      }} />
      {message}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  )
}

/**
 * LoadingText - Displays a styled loading message
 * @component
 * @param {Object} props - Component props
 * @param {string} [props.message='Wird geladen…'] - Message to display
 * @returns {JSX.Element} Rendered loading text
 */
export function LoadingText({ message = 'Wird geladen…' }) {
  return (
    <span role="status" aria-live="polite" style={{ color: '#4b5d71', fontStyle: 'italic' }}>
      {message}
    </span>
  )
}