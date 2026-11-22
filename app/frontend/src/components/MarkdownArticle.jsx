/**
 * MarkdownArticle - gemeinsame Markdown-Darstellung für Wiki- und Rechtstexte
 * @module MarkdownArticle
 * @description `markdownComponents` lag früher als lokale Kopie in `pages/Wiki.jsx`; hier ist
 *              die eine Stelle, die das Aussehen von `entry_content` bestimmt.
 * @component
 * @param {Object} props
 * @param {string} [props.content=''] - Markdown-Quelltext (z. B. `entry_content` eines Wiki-Eintrags)
 * @returns {JSX.Element} Gerenderter Artikel
 */
import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownComponents as baseMarkdownComponents, makeCodeComponent } from './MarkdownRenderer'

/**
 * Wiki-/Rechtstext-Variante: uebernimmt die gemeinsame Basis aus `MarkdownRenderer` und
 * ueberschreibt nur die Elemente, die die Theme-Variablen (`var(--admin-*)`) nutzen sollen.
 */
export const markdownComponents = {
  ...baseMarkdownComponents,
  strong: ({ node, ...props }) => <strong style={{ fontWeight: 700, color: 'var(--admin-ink)' }} {...props} />,
  em: ({ node, ...props }) => <em style={{ color: 'var(--admin-ink)' }} {...props} />,
  blockquote: ({ node, ...props }) => (
    <blockquote style={{ margin: '16px 0', padding: '8px 14px', borderLeft: '4px solid var(--admin-accent-soft)', background: 'var(--admin-panel-strong)', color: 'var(--admin-ink)' }} {...props} />
  ),
  code: makeCodeComponent('var(--admin-accent-soft)'),
}

/**
 * Rendert Markdown mit den Projekt-Komponenten.
 * @param {Object} props
 * @param {string} [props.content=''] - Markdown-Quelltext
 * @returns {JSX.Element} Markdown-Baum
 */
export default function MarkdownArticle({ content = '' }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content || ''}
    </ReactMarkdown>
  )
}
