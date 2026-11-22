import React from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import './styles/styles.css'
import './styles/shell.css'
import { AuthProvider } from './contexts/AuthContext'
import { PersonSelectionProvider } from './contexts/PersonSelectionContext'
import { routes } from './routes'

// Prod-Kanal der Chunk-Recovery: Vite meldet ein fehlgeschlagenes `__vitePreload` als
// `vite:preloadError`. Der Listener steht **vor** dem ersten Render, weil das Event schon beim
// ersten Seiten-Import feuern kann.
//
// Er startet bewusst **keinen** Reload und setzt **keinen** Merker: hier ist der Routen-Schlüssel
// unbekannt — bei einer client-seitigen Navigation steht in `window.location.pathname` noch der
// alte Pfad. Er verhindert nur, dass Vites `handlePreloadError` den Fehler ungefangen weiterwirft.
// Dadurch löst `__vitePreload` mit `undefined` auf, und `toRoute` übersetzt das in einen
// `ChunkLoadError` mit dem Routen-Schlüssel; den einen Reload startet danach die Route-
// `ErrorBoundary` (`ChunkErrorBoundary`, einziger Reload-Eigentümer).
// Im Dev-Server feuert das Event nie; dort führt derselbe Weg zur Boundary.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
})

// Der Router entsteht genau einmal auf Modulebene: zwei Instanzen hießen zwei History-Listener.
const router = createBrowserRouter(routes)

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Beide Provider liegen über dem Router, damit jede Route/Guard `useAuth()` sieht. */}
    <AuthProvider>
      <PersonSelectionProvider>
        <RouterProvider router={router} />
      </PersonSelectionProvider>
    </AuthProvider>
  </React.StrictMode>
)
