/**
 * routes - Routen-Array für `createBrowserRouter` (kein Router-Objekt)
 * @module routes
 * @description Diese Datei leitet die react-router-Routen aus der Tabelle in
 *              `src/routing/pages.js` ab. Der Router selbst entsteht genau einmal in `main.jsx`.
 *              Die Tabelle in `pages.js` ist die **einzige** Quelle für Pfad, Loader, Meta und
 *              Zugriffsstufe.
 *
 *              Ein Route-Objekt bekommt hier nie gleichzeitig `path` am inneren Objekt und eine
 *              Index-Route: der Pfad sitzt immer am äußeren Objekt, die Seite als `index`-Kind.
 */
import React from 'react'
import { Navigate, Outlet } from 'react-router'
import AppShell from './App'
import NotFound from './pages/NotFound'
import { RequireAccess } from './auth/guards'
import ChunkErrorBoundary from './routing/ChunkErrorBoundary'
import { ChunkLoadError, clearChunkReloadMark, isChunkLoadError } from './routing/chunkRecovery'
import { SynastrySelectionProvider } from './contexts/SynastrySelectionContext'
import { pages } from './routing/pages'

export { pages } from './routing/pages'

/**
 * Baut aus einem Tabelleneintrag ein react-router-Route-Objekt.
 *
 * Der `lazy`-Block übersetzt einen fehlenden Chunk in einen `ChunkLoadError` mit dem
 * **Routen-Pfad** (`page.path`) als Schlüssel und löscht den Merker erst nach bestandener
 * Modulprüfung — nie unter der aktuellen Adresse. Den Reload startet er **nicht**
 * selbst: einziger Reload-Eigentümer ist `ChunkErrorBoundary`.
 * @param {Object} page - Eintrag aus `pages`
 * @param {Object} [extra={}] - Zusätzliche Route-Properties (z. B. `index`)
 * @returns {{handle: Object, lazy: function(): Promise<Object>}} Route ohne `path`
 */
export function toRoute(page, extra = {}) {
  return {
    handle: {
      title: page.meta.title,
      description: page.meta.description,
      // Seiten mit eigenem Titel (z. B. `/wiki/:slug`) setzen ihn selbst; die Hülle hält sich
      // dann zurück, damit ihr Effekt den Seitentitel nicht überschreibt.
      dynamicTitle: page.meta.dynamicTitle === true,
      shell: page.shell,
      // Nur Rechtstexte tragen `pageName`; `LegalPage` liest ihn aus dem `handle`.
      pageName: page.pageName,
    },
    // Kein statisches `Component` daneben: der Router ignoriert es mit einer Warnung, wenn
    // `lazy` dieselbe Property liefert. Die Promise wird pro Route gecacht.
    //
    // Reihenfolge: erst laden, dann das Modul prüfen, erst danach den Schleifenschutz-Merker
    // löschen. Im Produktions-Bundle löst Vites `__vitePreload` nach einem
    // `event.preventDefault()` mit `undefined` auf; ein zu frühes Löschen erlaubte bei dauerhaft
    // fehlendem Chunk eine weitere Reload-Runde.
    //
    // Der Merker-Schlüssel ist der **Routen-Pfad** (`page.path`), nicht die aktuelle Adresse:
    // react-router schreibt die Adresse erst nach dieser Promise — während einer client-seitigen
    // Navigation stünde in `window.location.pathname` noch der alte Pfad, und die erfolgreiche
    // neue Seite löschte den Merker der kaputten alten.
    lazy: async () => {
      const chunkKey = page.path
      let mod
      try {
        mod = await page.load()
      } catch (error) {
        // Nur ein echter Chunk-Fehler wird als solcher gedeutet; ein Syntax-/Render-Fehler im
        // Modul läuft unverändert weiter und löst keinen Reload aus.
        if (!isChunkLoadError(error)) throw error
        // Nur werfen: die Boundary liest `chunkKey` aus dem Fehler und startet den einen Reload —
        // ein zweiter Eigentümer hier machte ihren Ladehinweis unerreichbar.
        throw new ChunkLoadError(chunkKey, error)
      }
      // Modulprüfung vor jedem Storage-Zugriff: `__vitePreload` löst bei `event.preventDefault()`
      // mit `undefined` auf. Bewusst kein Test auf `typeof mod.default === 'function'` — ein per
      // `memo()`/`forwardRef()` umwickelter Default-Export ist ein Objekt und kein fehlender Chunk.
      if (mod == null || mod.default == null) {
        throw new ChunkLoadError(chunkKey)
      }
      // Erst nach bestandener Modulprüfung fällt der Merker: der Chunk ist nachweislich
      // aufgelöst. Eager gerenderte Routen (404) haben keinen Chunk und brauchen den Aufruf nicht.
      // Der Helfer kapselt seine Storage-Fehler selbst und wirft nie.
      clearChunkReloadMark(chunkKey)
      return { Component: mod.default }
    },
    ...extra,
  }
}

/**
 * Pfad ohne Parameter-Segmente — für Navigationsziele, die eine konkrete Seite brauchen.
 * `/admin/:tab?` → `/admin`, `/wiki/:slug` → `/wiki`.
 * @param {Object} page - Eintrag aus `pages`
 * @returns {string} Konkreter Pfad
 */
function navigablePath(page) {
  return page.path.replace(/\/:.*$/, '')
}

/** Zugriffsstufen aus `pages.*.access`, die einen `RequireAccess`-Guard bekommen. */
const GUARDED_ACCESS = new Set(['auth', 'profile', 'admin'])

/**
 * Guard-Stufe einer Seite — ausschließlich aus `page.access`. Eine Seite ohne geschützte
 * Stufe als geschützt einzuhängen ist ein Programmierfehler und bricht den Modul-Import ab.
 * @param {Object} page - Eintrag aus `pages`
 * @returns {'auth'|'profile'|'admin'} Stufe für `RequireAccess`
 */
function guardLevel(page) {
  if (GUARDED_ACCESS.has(page.access)) return page.access
  throw new Error(`routes: ${page.path} hat access='${page.access}' und ist keine geschützte Seite`)
}

/**
 * Stellt sicher, dass eine ohne Guard eingehängte Seite in `pages` auch als `public` deklariert ist.
 * Sonst wäre eine Seite mit `access: 'admin'` still öffentlich erreichbar.
 * @param {Object} page - Eintrag aus `pages`
 * @returns {Object} Derselbe Eintrag
 */
function assertPublic(page) {
  if (page.access === 'public') return page
  throw new Error(`routes: ${page.path} hat access='${page.access}' und darf nicht ohne Guard eingehängt werden`)
}

/** Öffentliche Seite; `access` muss `public` sein. */
function publicRoute(page) {
  return { path: page.path.slice(1), ...toRoute(assertPublic(page)) }
}

/** Geschützte Seite mit Guard als Layout-Route über der Seite; die Stufe kommt aus `page.access`. */
function guarded(page) {
  return {
    path: page.path.slice(1),
    element: <RequireAccess level={guardLevel(page)} />,
    children: [{ index: true, ...toRoute(page) }],
  }
}

/**
 * Routentabelle als Array. Eine Layout-Route (AppShell) hält Nav, `<main>` und Footer; alle
 * Seiten sind ihre Kinder — auch die 404-Route, damit unbekannte Adressen die Hülle behalten.
 * @type {Array<Object>}
 */
export const routes = [
  {
    path: '/',
    Component: AppShell,
    // Fallback für Fehler der Hülle selbst (Menü/Footer können dann nicht bleiben).
    ErrorBoundary: ChunkErrorBoundary,
    children: [
      {
        // Pfadlose Kind-Route über **allen** Seiten: ein fehlgeschlagenes Seiten-`lazy`
        // blubbert zur nächsten Boundary. Sitzt sie nur an der Layout-Route, ersetzt die
        // Fehleransicht die ganze Hülle — Menü und Footer sollen aber auch im Fehlerfall
        // bleiben (wie bei der 404-Seite).
        ErrorBoundary: ChunkErrorBoundary,
        children: [
          { index: true, ...toRoute(assertPublic(pages.home)) },
          publicRoute(pages.wiki),
          publicRoute(pages.wikiEntry),
          guarded(pages.horoscope),
          guarded(pages.mondknoten),
          {
            // Der Synastrie-Auswahlkontext bleibt beim Seitenwechsel bestehen (heutiges Verhalten).
            path: pages.synastrie.path.slice(1),
            element: <RequireAccess level={guardLevel(pages.synastrie)} />,
            children: [
              {
                element: (
                  <SynastrySelectionProvider>
                    <Outlet />
                  </SynastrySelectionProvider>
                ),
                children: [{ index: true, ...toRoute(pages.synastrie) }],
              },
            ],
          },
          guarded(pages.transits),
          guarded(pages.solar),
          guarded(pages.agepoints),
          guarded(pages.settings),
          guarded(pages.admin),
          publicRoute(pages.login),
          publicRoute(pages.register),
          // Rechtstexte als eigene Adressen: '/impressum', '/datenschutz' und '/kontakt'.
          // Die Pfade und der Seitennamen-Literal stehen in `routing/pages.js` (eine Quelle).
          publicRoute(pages.impressum),
          publicRoute(pages.datenschutz),
          publicRoute(pages.kontakt),
          // Altpfade ohne eigene Seite: Umleitung per `replace`, damit kein Verlaufseintrag entsteht.
          // Keine Zwischen- oder „Seite entfernt"-Hinweisziele.
          { path: 'dashboard', element: <Navigate to="/" replace /> },
          { path: 'houses', element: <Navigate to="/" replace /> },
          // Auffangpunkt für jede unbekannte Adresse — innerhalb der Layout-Route, damit Menü und
          // Footer bleiben. Der `handle` setzt den Tab-Titel („Seite nicht gefunden").
          {
            path: '*',
            element: <NotFound />,
            handle: {
              title: 'Seite nicht gefunden',
              description: 'Diese Adresse existiert nicht. Zurück zur Startseite von Astro-Magister.',
            },
          },
        ],
      },
    ],
  },
]

export default routes
