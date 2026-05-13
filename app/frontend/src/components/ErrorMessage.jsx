import React from 'react'

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

export function InlineError({ message, style = {} }) {
  if (!message) return null
  return (
    <span role="alert" style={{ color: '#a12f2f', ...style }}>
      {message}
    </span>
  )
}