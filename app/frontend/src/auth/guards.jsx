/**
 * guards - Routen-Guards auf Basis der Server-Session
 * @module guards
 * @description `RequireAccess` entscheidet erst, wenn die Server-Session bekannt ist
 *              (`AuthContext.initialized`), und zwar genau einmal: Ladehülle im Inhaltsbereich →
 *              Login-Umleitung mit validiertem Rückweg → Rollen-/Profilprüfung → `<Outlet/>`.
 *
 *              Der Guard liest keinen Browser-Speicher: die einzige Wahrheit ist
 *              `GET /api/auth/profile`. Öffentliche Routen laufen gar nicht durch diesen
 *              Guard.
 */
import React from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '../contexts/AuthContext'

/**
 * Baut den Rückweg aus der aktuellen Adresse (Pfad + Query + Hash).
 * @param {{pathname: string, search: string, hash: string}} location - Aktuelle Router-Location
 * @returns {string} Vollständiges Ziel für `?next=`
 */
function buildNext(location) {
  return `${location.pathname}${location.search}${location.hash}`
}

/**
 * Dreizustands-Guard für geschützte Routen.
 * @component
 * @param {Object} props
 * @param {'auth'|'profile'|'admin'} props.level - Benötigte Zugriffsstufe
 * @returns {JSX.Element} Ladehülle, Weiterleitung oder der Inhalt der Kind-Route
 */
export function RequireAccess({ level }) {
  const { profile, initialized } = useAuth()
  const location = useLocation()
  const next = buildNext(location)

  // Solange die erste /auth/profile-Antwort aussteht, wird nichts navigiert: keine Flackern,
  // kein doppelter History-Eintrag. Die Ladehülle sitzt nur im Inhaltsbereich.
  if (!initialized) return <div className="app-page-loading">Laden…</div>

  if (!profile) return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  if (level === 'admin' && profile.isadmin !== true) return <Navigate to="/" replace />
  if (level === 'profile' && !profile.birth_year) {
    return <Navigate to={`/settings?hinweis=profil&next=${encodeURIComponent(next)}`} replace />
  }

  return <Outlet />
}

export default RequireAccess
