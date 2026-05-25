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
import React, { useEffect, useMemo, useState } from 'react'
import { MarkdownRenderer } from '../components/MarkdownRenderer'
import PersonSelector from '../components/PersonSelector'
import { useAuth } from '../contexts/AuthContext'
import { getSignIndex } from '../theme/ThemeApplier'
import { zodiacNames } from '../theme/zodiacColors'
import { get } from '../services/api'

const quickLinks = [
  { title: 'Horoskop', page: 'horoscope', description: 'Erkunde dein Geburtshoroskop mit Häusern und Aspekten.' },
  { title: 'Mondknoten', page: 'mondknoten', description: 'Mondknoten-Horoskop und ihre Bewegungen.' },
  { title: 'Häuser', page: 'houses', description: 'Ein Blick auf die Hausverteilungen.' },
  { title: 'Transite', page: 'transits', description: 'Transite zur Deutung aktueller Einflüsse.' },
  { title: 'Solar Jahr', page: 'solar', description: 'Sonnenrückkehr-Chart für das nächste Lebensjahr.' },
  { title: 'Alterspunkte', page: 'agepoints', description: 'Zeitliche Punkte und Lebensabschnitte.' },
  { title: 'Synastrie', page: 'synastrie', description: 'Partnervergleich — zwei Horoskope im Vergleich.' },
]

export default function Dashboard({ user }){
  const { profile } = useAuth()
  const [publicLoginEntries, setPublicLoginEntries] = useState([])
  const [publicLoginLoading, setPublicLoginLoading] = useState(false)
  const [publicLoginError, setPublicLoginError] = useState('')
  const needsProfileSetup = !profile?.birth_year

  const todaySign = useMemo(() => {
    const now = new Date()
    const idx = getSignIndex(now)
    const d = now.getDate().toString().padStart(2, '0')
    const m = (now.getMonth() + 1).toString().padStart(2, '0')
    const y = now.getFullYear()
    return { date: `${d}.${m}.${y}`, signIndex: idx, signName: zodiacNames[idx] }
  }, [])

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
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        {user && !needsProfileSetup && (
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            background: 'rgba(var(--admin-accent-r), var(--admin-accent-g), var(--admin-accent-b), 0.1)',
            border: '1px solid rgba(var(--admin-accent-r), var(--admin-accent-g), var(--admin-accent-b), 0.2)',
            borderRadius: 16,
            padding: '8px 16px',
            whiteSpace: 'nowrap',
          }}>
            <img
              src={`/theme/glyph/sign/${todaySign.signIndex}`}
              alt={todaySign.signName}
              width={28}
              height={28}
              style={{ display: 'block', marginBottom: 4 }}
            />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--admin-ink)' }}>
              {todaySign.date} &mdash; {todaySign.signName}
            </span>
          </div>
        )}
      </div>
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
            <section aria-label="Schnellzugriff auf Module">
              <div className="dashboard-grid-header">
                <h3>Dashboard</h3>
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
