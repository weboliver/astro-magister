import React from 'react'

/**
 * ErrorMessage - Displays a styled error message to the user
 * @component
 * @param {Object} props - Component props
 * @param {string} props.message - Error message to display
 * @param {string} [props.variant='default'] - Visual variant of the error (currently unused)
 * @param {Object} [props.style={}] - Additional inline styles to apply
 * @returns {JSX.Element|null} Rendered error message, or null if message is empty
 */
export function ErrorMessage({ message, variant = 'default', style = {} }) {
  if (!message) return null

  const baseStyle = {
    display: 'block',
    padding: '12px 14px',
    borderRadius: '12px',
    background: '#fde9e7',
    color: '#a12f2f',
    fontWeight: 500,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    margin: '0 0 8px 0',
    ...style,
  }

  return (
    <div role="alert" aria-live="assertive" style={baseStyle}>
      {message}
    </div>
  )
}

/**
 * InlineError - Displays an inline error message within text
 * @component
 * @param {Object} props - Component props
 * @param {string} props.message - Error message to display inline
 * @param {Object} [props.style={}] - Additional inline styles to apply
 * @returns {JSX.Element|null} Rendered inline error, or null if message is empty
 */
export function InlineError({ message, style = {} }) {
  if (!message) return null
  return (
    <span role="alert" style={{ color: '#a12f2f', ...style }}>
      {message}
    </span>
  )
}