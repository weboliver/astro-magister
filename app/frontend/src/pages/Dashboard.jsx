import React, { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import PersonSelector from '../components/PersonSelector'
import { usePersonSelection } from '../contexts/PersonSelectionContext'
import { useAuth } from '../contexts/AuthContext'
import { get } from '../services/api'

const quickLinks = [
  { title: 'Horoskop', page: 'horoscope', description: 'Erkunde dein Geburtshoroskop mit Häusern und Aspekten.' },
  { title: 'Planeten', page: 'planets', description: 'Die Positionen der Planeten und ihre Bewegungen.' },
  { title: 'Häuser', page: 'houses', description: 'Ein Blick auf die Hausverteilungen.' },
  { title: 'Transite', page: 'transits', description: 'Transite zur Deutung aktueller Einflüsse.' },
  { title: 'Solar Jahr', page: 'solar', description: 'Sonnenrückkehr-Chart für das nächste Lebensjahr.' },
  { title: 'Alterspunkte', page: 'agepoints', description: 'Zeitliche Punkte und Lebensabschnitte.' },
]

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
  code: ({ inline, node, ...props }) =>
    inline
      ? <code style={{ background: '#eef3f8', padding: '1px 5px', borderRadius: 4, fontSize: '0.92em' }} {...props} />
      : <code style={{ display: 'block', background: '#eef3f8', padding: 12, borderRadius: 8, overflowX: 'auto' }} {...props} />,
}

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
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {entry.entry_content || ''}
              </ReactMarkdown>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
