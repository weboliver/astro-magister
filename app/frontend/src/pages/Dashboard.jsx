/**
 * Dashboard - Main landing page with quick links to all astrological modules and profile/person selection.
 * @component
 * @param {Object} props - Component props
 * @param {Object} [props.user=null] - Current authenticated user object
 * @returns {JSX.Element} Rendered dashboard page
 * @hook useState - Manages public login entries, loading state, errors
 * @hook useEffect - Loads public login text for unauthenticated users
 * @hook useAuth - Accesses profile from authentication context
 * @hook usePersonSelection - Accesses selected person for calculations
 */
import React, { useEffect, useState } from 'react'
import { MarkdownRenderer } from '../components/MarkdownRenderer'
import PersonSelector from '../components/PersonSelector'
import { usePersonSelection } from '../contexts/PersonSelectionContext'
import { useAuth } from '../contexts/AuthContext'
import { get } from '../services/api'

const quickLinks = [
  { title: 'Horoskop', page: 'horoscope', description: 'Erkunde dein Geburtshoroskop mit Häusern und Aspekten.' },
  { title: 'Mondknoten', page: 'mondknoten', description: 'Mondknoten-Horoskop und ihre Bewegungen.' },
  { title: 'Synastrie', page: 'synastrie', description: 'Partnervergleich — zwei Horoskope im Vergleich.' },
  { title: 'Häuser', page: 'houses', description: 'Ein Blick auf die Hausverteilungen.' },
  { title: 'Transite', page: 'transits', description: 'Transite zur Deutung aktueller Einflüsse.' },
  { title: 'Solar Jahr', page: 'solar', description: 'Sonnenrückkehr-Chart für das nächste Lebensjahr.' },
  { title: 'Alterspunkte', page: 'agepoints', description: 'Zeitliche Punkte und Lebensabschnitte.' },
]

export default function Dashboard({ user }){
  const { profile } = useAuth()
  const { selectedPerson } = usePersonSelection()
  const [publicLoginEntries, setPublicLoginEntries] = useState([])
  const [publicLoginLoading, setPublicLoginLoading] = useState(false)
  const [publicLoginError, setPublicLoginError] = useState('')
  const activeName = selectedPerson ? selectedPerson.name : user?.username
  const needsProfileSetup = !profile?.birth_year

  const handleNavigate = (page) => {
    window.dispatchEvent(new CustomEvent('astronexNavigate', { detail: { page } }))
  }

  useEffect(() => {
    let active = true

    async function loadPublicLoginText(){
      if (user) {
        if (active) {
          setPublicLoginEntries([])
          setPublicLoginError('')
          setPublicLoginLoading(false)
        }
        return
      }

      setPublicLoginLoading(true)
      setPublicLoginError('')
      try{
        const params = new URLSearchParams({ page_name: 'Login' })
        const resp = await get(`/wiki/page-entries?${params.toString()}`, false)
        if (!resp.ok) throw new Error(`Login-Text konnte nicht geladen werden (${resp.status})`)
        const data = await resp.json()
        if (active) setPublicLoginEntries(Array.isArray(data) ? data : [])
      }catch(err){
        if (active) {
          setPublicLoginEntries([])
          setPublicLoginError(err?.message || 'Login-Text konnte nicht geladen werden')
        }
      }finally{
        if (active) setPublicLoginLoading(false)
      }
    }

    loadPublicLoginText()
    return () => {
      active = false
    }
  }, [user])

  return (
    <div>
      <h2>Startseite</h2>
      {user ? (
        needsProfileSetup ? (
          <p>
            Bitte gehen Sie nun zum <button
              type="button"
              onClick={() => handleNavigate('settings')}
              style={{ border: 'none', background: 'none', padding: 0, color: '#0b57d0', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
            >
              Profil
            </button> und geben Sie Ihren Wohnort, Geburtsort, Geburtstag und Geburtstunde an.
          </p>
        ) : (
          <>
            <PersonSelector label="Person für Berechnungen" helperText="Wähle eine gespeicherte Person oder nutze dein Profil" />
            <p>Person: <b>{activeName?` ${activeName}`:''}</b> wurde ausgewählt für Berechnungen.</p>
            <section aria-label="Schnellzugriff auf Module">
              <div className="dashboard-grid-header">
                <h3>Schnellzugriff</h3>
              </div>
              <div className="dashboard-grid">
                {quickLinks.map((link)=> (
                  <button key={link.page} type="button" className="dashboard-card" onClick={()=>handleNavigate(link.page)}>
                    <span className="dashboard-card-title">{link.title}</span>
                    <p>{link.description}</p>
                  </button>
                ))}
              </div>
            </section>
          </>
        )
      ) : (
        <div style={{ display: 'grid', gap: 18 }}>
          <p>
            Du musst dich <button
              type="button"
              onClick={() => handleNavigate('login')}
              style={{ border: 'none', background: 'none', padding: 0, color: '#0b57d0', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
            >
              einloggen
            </button>, um gespeicherte Personen auswählen zu können.
            <h2>Astro-Magister ist eine spezialisierte Astrologie-Plattform für die Huber-Astrologie.</h2>
            <h3>Entdecke die Welt der Astrologie mit unseren umfassenden Tools und Ressourcen.</h3>
          </p>
          {publicLoginError ? <div className="admin-message admin-error">{publicLoginError}</div> : null}
          {publicLoginLoading ? <p>Lade Einstiegstext ...</p> : null}
          {publicLoginEntries.map((entry) => (
            <section key={`dashboard-login-entry-${entry.entry_id}`} className="admin-cache-card" style={{ padding: 20 }}>
              <MarkdownRenderer>{entry.entry_content || ''}</MarkdownRenderer>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
