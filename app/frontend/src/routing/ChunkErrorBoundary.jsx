/**
 * ChunkErrorBoundary - Fehlerhülle für eine fehlgeschlagene Seite
 * @module ChunkErrorBoundary
 * @description Zwei Aufgaben:
 *              1. Einziger Reload-Eigentümer für Dev- **und** Prod-Kanal: fehlt der
 *                 Seiten-Chunk, wird **genau einmal** neu geladen und währenddessen ein
 *                 Ladehinweis gezeigt (keine weiße Seite). `toRoute().lazy` wirft nur den
 *                 `ChunkLoadError` mit Routen-Schlüssel und ruft den Helfer selbst nicht auf.
 *              2. Wiederholungsfall: Liefert der Helfer `false` (Merker schon gesetzt oder
 *                 kein `sessionStorage`), erscheint sofort eine Fehleransicht mit
 *                 „Neu laden“-Knopf statt eines dauerhaften Ladehinweises.
 *
 *              Die Fehleransicht rendert ausschließlich statischen Text — keine Interpolation
 *              von URLs oder Query-Parametern und kein `dangerouslySetInnerHTML`.
 */
import React, { useEffect, useRef, useState } from 'react'
import { useRouteError } from 'react-router'
import { isChunkLoadError, recoverFromChunkError } from './chunkRecovery'

/** Phase der Wiederherstellung: noch nicht versucht, Reload läuft, Reload nicht möglich. */
const PHASE_IDLE = 'idle'
const PHASE_RELOADING = 'reloading'
const PHASE_FAILED = 'failed'

/**
 * Statische Fehleransicht mit bewusstem Neuladen durch den Nutzer.
 *
 * Der Knopf setzt **keinen** Merker: eine bewusste Nutzerentscheidung ist keine Schleife, und
 * ein bereits gesetzter Merker bleibt bestehen.
 * @returns {React.ReactElement} Fehleransicht
 */
function ChunkErrorView() {
  return (
    <div className="app-page-panel">
      <h1>Diese Seite konnte nicht geladen werden.</h1>
      <p>
        Nach einer Aktualisierung der Anwendung fehlt möglicherweise eine Datei im
        Browser-Zwischenspeicher. Lade die Seite erneut — meist genügt das.
      </p>
      <button type="button" onClick={() => window.location.reload()}>
        Neu laden
      </button>
    </div>
  )
}

/**
 * Route-`ErrorBoundary`: fängt Fehler einer Seite (auch ein abgelehntes `lazy()`).
 * @returns {React.ReactElement} Ladehinweis oder Fehleransicht
 */
export default function ChunkErrorBoundary() {
  const error = useRouteError()
  const isChunkError = isChunkLoadError(error)
  // Der Routen-Schlüssel steckt im Fehler (`ChunkLoadError.chunkKey`, gesetzt von `toRoute`).
  // Bewusst **kein** Rückfall auf `window.location.pathname`: ein Chunk-Fehler ohne Schlüssel zeigt
  // die Fehleransicht ohne Reload — lieber kein Reload als ein Reload unter einem Schlüssel, den
  // niemand wieder löscht. Setzen und Löschen dürfen nie auseinanderlaufen.
  const chunkKey = typeof error?.chunkKey === 'string' ? error.chunkKey : null
  const [phase, setPhase] = useState(PHASE_IDLE)
  // Ref statt State als Wächter: StrictMode führt Effekte doppelt aus, der zweite Durchlauf
  // darf den Reload nicht als „schon versucht“ fehldeuten und die Fehleransicht aufblitzen lassen.
  const attempted = useRef(false)

  useEffect(() => {
    if (!isChunkError || attempted.current) return
    attempted.current = true
    // Rückgabe false = kein Reload gestartet → die Fehleransicht übernehmen.
    setPhase(chunkKey && recoverFromChunkError(chunkKey) ? PHASE_RELOADING : PHASE_FAILED)
  }, [isChunkError, chunkKey])

  // Kein Chunk-Fehler (z. B. Render-Fehler der Seite): sofort die Fehleransicht.
  if (!isChunkError) return <ChunkErrorView />

  // Chunk-Fehler: Ladehinweis, solange der Reload läuft oder noch nicht entschieden ist;
  // der `false`-Rückfall des Helfers schaltet auf die Fehleransicht.
  if (phase === PHASE_FAILED) return <ChunkErrorView />

  return <div className="app-page-loading">Lade die Seite neu …</div>
}
