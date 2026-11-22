import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { remarkWikiLinks } from '../utils/wikiLinkify'

/**
 * MarkdownRenderer - Renders Markdown content with custom styling and GitHub Flavored Markdown support
 * @component
 * @param {Object} props - Component props
 * @param {React.ReactNode|string} props.children - Markdown content to render
 * @param {Object} props.components - Optional custom component overrides
 * @param {Array<{name: string, slug: string}>|null} props.wikiLinks - Optional: Begriffe, die als
 *   Wiki-Link erscheinen sollen. Ohne Prop bleibt die Ausgabe unveraendert.
 * @returns {JSX.Element} Rendered Markdown content
 */

/**
 * Baut die `code`-Komponente mit der gewuenschten Hintergrundfarbe.
 * react-markdown@10 reicht kein `inline`-Flag mehr durch: Block-Code erkennt man an der
 * `language-*`-Klasse oder am Zeilenumbruch, den ein Codeblock immer am Ende traegt.
 * @param {string} background - CSS-Hintergrund fuer Inline- und Block-Code
 * @returns {Function} `code`-Komponente fuer `components` von react-markdown
 */
export function makeCodeComponent(background) {
  return function MarkdownCode({ node, className, children, ...props }) {
    const isBlock = /language-/.test(String(className || '')) || /\n/.test(String(children ?? ''))
    return isBlock
      ? <code className={className} style={{ display: 'block', background, padding: 12, borderRadius: 8, overflowX: 'auto' }} {...props}>{children}</code>
      : <code className={className} style={{ background, padding: '1px 5px', borderRadius: 4, fontSize: '0.92em' }} {...props}>{children}</code>
  }
}

/**
 * Gemeinsame Basis aller Markdown-Darstellungen. Abweichende Varianten (z. B. `MarkdownArticle`)
 * ueberschreiben nur die Elemente, die anders aussehen sollen, per Spread.
 */
const markdownComponents = {
  h1: ({ node, ...props }) => <h1 style={{ margin: '0 0 12px', fontSize: '1.5rem', lineHeight: 1.2 }} {...props} />,
  h2: ({ node, ...props }) => <h2 style={{ margin: '20px 0 10px', fontSize: '1.2rem', lineHeight: 1.25 }} {...props} />,
  h3: ({ node, ...props }) => <h3 style={{ margin: '16px 0 8px', fontSize: '1.05rem', lineHeight: 1.3 }} {...props} />,
  p: ({ node, ...props }) => <p style={{ margin: '0 0 12px', lineHeight: 1.65 }} {...props} />,
  ul: ({ node, ...props }) => <ul style={{ margin: '0 0 12px', paddingLeft: 22, lineHeight: 1.6 }} {...props} />,
  ol: ({ node, ...props }) => <ol style={{ margin: '0 0 12px', paddingLeft: 22, lineHeight: 1.6 }} {...props} />,
  li: ({ node, ...props }) => <li style={{ marginBottom: 6 }} {...props} />,
  strong: ({ node, ...props }) => <strong style={{ fontWeight: 700, color: '#132238' }} {...props} />,
  em: ({ node, ...props }) => <em style={{ color: '#38506b' }} {...props} />,
  blockquote: ({ node, ...props }) => (
    <blockquote style={{ margin: '16px 0', padding: '8px 14px', borderLeft: '4px solid #9fb4c7', background: '#f3f7fb', color: '#31485f' }} {...props} />
  ),
  code: makeCodeComponent('#eef3f8'),
}

export function MarkdownRenderer({ children, components = {}, wikiLinks = null }) {
  // SECURITY: Do NOT add rehype-raw here. Without it, react-markdown escapes
  // all HTML tags as plain text, preventing XSS from user-supplied content
  // (e.g. Zusatzfragen, AI responses). Adding rehype-raw would allow raw HTML
  // rendering and introduce an XSS vulnerability.
  // Die Begriffsliste kommt als Option zum Attacher (`[plugin, optionen]`) — genau die Form,
  // die `remarkPlugins`/unified akzeptiert. Ein fertiger Transformer in der Liste wuerde beim
  // Rendern werfen, sobald die Liste nicht leer ist (Gate `scripts/check-wiki-links.mjs`, Fall l).
  const remarkPlugins = wikiLinks && wikiLinks.length
    ? [remarkGfm, [remarkWikiLinks, wikiLinks]]
    : [remarkGfm]
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={{ ...markdownComponents, ...components }}>
      {children}
    </ReactMarkdown>
  )
}

export { markdownComponents }