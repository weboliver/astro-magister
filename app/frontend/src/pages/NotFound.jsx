/**
 * NotFound - 404-Seite innerhalb der Seitenhülle
 * @component
 * @description Unbekannte Adressen landen hier: Menü und Footer bleiben sichtbar, weil die
 *              Route ein Kind der Layout-Route ist. Ein 404 ist ein Normalzustand, kein Fehler —
 *              deshalb weder `role="alert"` noch die rote Fehlerfarbe aus `ErrorMessage`.
 *              Das Modul wird eager importiert: ein fehlender Seiten-Chunk darf
 *              nicht ausgerechnet die Fehlerseite verhindern.
 * @returns {JSX.Element} Hinweis mit Rückweg zur Startseite
 */
import React from 'react'
import { Link } from 'react-router'

export default function NotFound() {
  return (
    <article className="app-page-panel" data-testid="page-not-found">
      <p>Diese Adresse gibt es nicht. Vielleicht findest du das Gesuchte über die Startseite.</p>
      <Link to="/">Zur Startseite</Link>
    </article>
  )
}
