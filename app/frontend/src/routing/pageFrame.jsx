/**
 * pageFrame - Titel, Untertitel und Aktions-Slot der Hülle
 * @module pageFrame
 * @description Seiten reichen ihren Titel, ihren Untertitel und ihre Aktionen in den Titelbereich
 *              der Hülle, statt einen zweiten Kopf zu bauen. Der Provider merkt sich den zum
 *              Aufrufzeitpunkt gültigen Pfad: ein Artikel-Titel oder eine Admin-Aktion kann den
 *              Routenwechsel damit nicht überleben, ohne dass der Provider neu
 *              gemountet wird — der Seitenzustand bleibt erhalten.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { useLocation } from 'react-router'

/** Kontextwert: `{ title, description, actions, setTitle, setDescription, setActions }`. */
const PageFrameContext = createContext(null)

/**
 * Hält den Rahmen des Titelbereichs für die Seiten darunter.
 * @param {Object} props
 * @param {string} [props.title] - Titel aus dem `handle` der aktiven Route
 * @param {string} [props.description] - Untertitel aus dem `handle`
 * @param {React.ReactNode} props.children - Seiteninhalt (das `<Outlet/>`)
 * @returns {JSX.Element} Provider
 */
export function PageFrameProvider({ title, description, children }) {
  const { pathname } = useLocation()
  const [override, setOverride] = useState(null)

  // Ein Setter erweitert nur die Angaben **derselben** Adresse. Übernähme er die einer anderen
  // (`{ ...prev }` ohne Pfadvergleich), wanderte z. B. das `title: null` aus dem Aufräumen eines
  // Wiki-Artikels mit, sobald die nächste Seite `setActions` ruft — und verdeckte deren
  // Routentitel (Titelbereich fehlte „manchmal", je nach Vorseite).
  const update = useCallback((key, value) => {
    setOverride((prev) => ({ ...(prev?.pathname === pathname ? prev : null), pathname, [key]: value }))
  }, [pathname])

  const setTitle = useCallback((value) => update('title', value), [update])
  const setDescription = useCallback((value) => update('description', value), [update])
  const setActions = useCallback((value) => update('actions', value), [update])

  const base = { title, description, actions: null }
  // Nur eine Angabe aus derselben Adresse zählt — sonst zeigte eine neue Seite den alten Titel.
  // `null`/`undefined` heißt „zurücknehmen", nicht „leer überschreiben": dann gilt der Wert aus
  // dem Routen-`handle`.
  const frame = { ...base }
  if (override && override.pathname === pathname) {
    for (const key of ['title', 'description', 'actions']) {
      if (override[key] != null) frame[key] = override[key]
    }
  }

  const value = useMemo(() => ({
    title: frame.title,
    description: frame.description,
    actions: frame.actions,
    setTitle,
    setDescription,
    setActions,
  }), [frame.title, frame.description, frame.actions, setTitle, setDescription, setActions])

  return (
    <PageFrameContext.Provider value={value}>
      {children}
    </PageFrameContext.Provider>
  )
}

/**
 * Zugriff auf den Titelbereich. Außerhalb des Providers `null` — Seiten dürfen deshalb
 * `usePageFrame()?.setActions(…)` schreiben.
 * @returns {Object|null} Kontextwert oder `null`
 */
export function usePageFrame() {
  return useContext(PageFrameContext)
}
