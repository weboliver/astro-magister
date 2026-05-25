/**
 * App - Main application component for Astro-Magister
 * @component
 * @description Root component that handles routing, authentication state, layout, and mobile navigation.
 *              Manages page routing, navbar visibility, and user session persistence across the application.
 */
import React, { useState, useEffect, lazy, Suspense } from 'react'
const Login = lazy(() => import('./pages/Login'))
const Register = lazy(() => import('./pages/Register'))
const Dashboard = lazy(() => import('./pages/Dashboard'))
const Settings = lazy(() => import('./pages/Settings'))
const Mondknoten = lazy(() => import('./pages/Mondknoten'))
const SolarReturn = lazy(() => import('./pages/SolarReturn'))
const AgePoints = lazy(() => import('./pages/AgePoints'))
const Horoscope = lazy(() => import('./pages/Horoscope'))
const Synastrie = lazy(() => import('./pages/Synastrie'))
const Transits = lazy(() => import('./pages/Transits'))
const Houses = lazy(() => import('./pages/Houses'))
const Admin = lazy(() => import('./pages/Admin'))
const Wiki = lazy(() => import('./pages/Wiki'))
import { useAuth } from './contexts/AuthContext'
import { SynastrySelectionProvider } from './contexts/SynastrySelectionContext'
import { clearStoredSession } from './services/api'
import { useSeoMeta } from './hooks/useSeoMeta'
import { applyTheme, getSignIndex, loadSavedTheme } from './theme/ThemeApplier'

const MOBILE_MENU_BREAKPOINT = 850
const TOP_NAV_MIN_WIDTH = 200
const RESTRICTED_PROFILE_PAGES = new Set(['horoscope', 'mondknoten', 'houses', 'transits', 'solar', 'agepoints', 'synastrie'])
const SELF_STYLED_PAGES = new Set(['admin', 'settings'])
const PAGE_META = {
  dashboard: { title: 'Startseite', description: 'Astro-Magister – dein Portal für astrologische Selbsterfahrung. Horoskop, Planeten, Häuser, Transite und mehr.' },
  horoscope: { title: 'Horoskop', description: 'Dein persönliches Horoskop auf einen Blick – Planetenstellungen und astrologische Deutungen.' },
  mondknoten: { title: 'Mondknoten', description: 'Das Mondknoten Horoskop nach Huber — Rahu und Ketu in Zeichen und Häusern.' },
  synastrie: { title: 'Synastrie', description: 'Partnervergleich und Beziehungsanalyse nach Huber-Astrologie – Synastrie mit zwei individuellen Horoskopen.' },
  houses: { title: 'Häuser', description: 'Die astrologischen Häuser und ihre Deutungen in deinem Horoskop.' },
  transits: { title: 'Transite', description: 'Aktuelle Transite und ihre astrologische Wirkung auf dein Geburtshoroskop.' },
  solar: { title: 'Solar Jahr', description: 'Das solare Rückkehrhoroskop für dein aktuelles Lebensjahr.' },
  agepoints: { title: 'Alterspunkte', description: 'Die Alterspunkt-Methode nach Bruno Huber – deine persönliche Jahressteuerung.' },
  wiki: { title: 'Wiki', description: 'Das astrologische Wiki von Astro-Magister – Begriffe, Planeten, Aspekte und mehr erklärt.' },
  settings: { title: 'Profil', description: 'Deine Profileinstellungen auf Astro-Magister.' },
  admin: { title: 'Admin', description: 'Administrationsoberfläche von Astro-Magister.' },
  login: { title: 'Login', description: 'Melde dich bei Astro-Magister an.' },
  register: { title: 'Registrierung', description: 'Erstelle ein kostenloses Konto bei Astro-Magister.' },
}
const HISTORY_STATE_MARKER = 'astronex-navigation'
const PAGE_LABELS = {
  dashboard: 'Startseite',
  login: 'Login',
  register: 'Registrierung',
  horoscope: 'Horoskop',
  mondknoten: 'Mondknoten',
  synastrie: 'Synastrie',
  houses: 'Häuser',
  transits: 'Transite',
  solar: 'Solar Jahr',
  agepoints: 'Alterspunkte',
  wiki: 'Wiki',
  settings: 'Profil',
  admin: 'Admin',
}
const FOOTER_LINKS = [
  { label: 'Impressum', pageName: 'Impressum' },
  { label: 'Datenschutz', pageName: 'Datenschutz' },
  { label: 'Kontakt', pageName: 'Kontakt' },
]
const EXTERNAL_FOOTER_LINKS = [
  { label: 'Buy me a coffee', href: 'https://buymeacoffee.com/shinengakic' },
]
/*
const FOOTER_LINKS = [
  { label: 'Impressum', pageName: 'Impressum' },
  { label: 'Kontakt', pageName: 'Kontakt' },
  { label: 'Datenschutz', pageName: 'Datenschutz' },
]
*/

const PATH_TO_PAGE = {
  '/': 'dashboard',
  '/dashboard': 'dashboard',
  '/mondknoten': 'mondknoten',
  '/synastrie': 'synastrie',
  '/horoscope': 'horoscope',
  '/transits': 'transits',
  '/houses': 'houses',
  '/solar': 'solar',
  '/agepoints': 'agepoints',
  '/wiki': 'wiki',
  '/settings': 'settings',
  '/admin': 'admin',
  '/login': 'login',
  '/register': 'register',
}

function _pathToPage(pathname) {
  return PATH_TO_PAGE[pathname] || PATH_TO_PAGE[pathname.replace(/\/$/, '')] || null
}

export default function App(){
  const initialHistoryState = typeof window !== 'undefined' && window.history.state?.marker === HISTORY_STATE_MARKER
    ? window.history.state
    : null
  const { profile } = useAuth()
  const [user, setUser] = useState(null)
  const [page, setPage] = useState(initialHistoryState?.page || 'dashboard')
  const [pageState, setPageState] = useState(initialHistoryState?.pageState && typeof initialHistoryState.pageState === 'object' ? initialHistoryState.pageState : {})
  const [isNarrow, setIsNarrow] = useState(typeof window !== 'undefined' ? window.innerWidth < MOBILE_MENU_BREAKPOINT : false)
  const [menuOpen, setMenuOpen] = useState(false)
  const needsProfileSetup = !!user && !profile?.birth_year
  const isAdmin = profile?.isadmin === true
  const [signIndex, setSignIndex] = useState(() => getSignIndex())

  const currentPageMeta = PAGE_META[page] || PAGE_META.dashboard
  useSeoMeta(currentPageMeta.title, currentPageMeta.description)

  useEffect(() => {
    if (!initialHistoryState && typeof window !== 'undefined') {
      const path = window.location.pathname
      const pageName = _pathToPage(path)
      if (pageName && pageName !== page) {
        setPage(pageName)
        syncHistory(pageName, {}, true)
      }
    }
  }, [])

  function normalizePageState(nextState){
    return nextState && typeof nextState === 'object' ? nextState : {}
  }

  function buildHistoryState(nextPage, nextState = {}){
    return {
      marker: HISTORY_STATE_MARKER,
      page: nextPage,
      pageState: normalizePageState(nextState),
    }
  }

  function syncHistory(nextPage, nextState = {}, replace = false){
    if (typeof window === 'undefined') return
    const method = replace ? 'replaceState' : 'pushState'
    window.history[method](buildHistoryState(nextPage, nextState), '')
  }

  function applyNavigation(nextPage, nextState = {}, options = {}){
    const { replaceHistory = false, syncBrowserHistory = true } = options
    if (!canAccessPage(nextPage)) {
      setPage('dashboard')
      setPageState({})
      if (syncBrowserHistory) syncHistory('dashboard', {}, true)
      if (isNarrow) setMenuOpen(false)
      return false
    }
    const normalizedState = normalizePageState(nextState)
    setPage(nextPage)
    setPageState(normalizedState)
    if (syncBrowserHistory) syncHistory(nextPage, normalizedState, replaceHistory)
    if (isNarrow) setMenuOpen(false)
    return true
  }

  function canAccessPage(nextPage){
    if (!nextPage || typeof nextPage !== 'string') return false
    if (nextPage === 'admin') return isAdmin
    if (!needsProfileSetup) return true
    return !RESTRICTED_PROFILE_PAGES.has(nextPage)
  }

  useEffect(()=>{
    // restore simple auth state from localStorage (username only, auth itself uses HttpOnly cookies)
    const username = localStorage.getItem('username')
    if (username){
      setUser({ username })
    }
  }, [])

  useEffect(()=>{
    const handleLogout = () => {
      setUser(null)
      applyNavigation('dashboard', {}, { replaceHistory: true })
    }
    window.addEventListener('astronexLogout', handleLogout)
    return () => window.removeEventListener('astronexLogout', handleLogout)
  }, [needsProfileSetup, isAdmin, isNarrow])

  useEffect(() => {
    const handleNavigation = (event) => {
      const nextPage = event?.detail?.page
      if (typeof nextPage !== 'string') return
      applyNavigation(nextPage, event?.detail?.state || {})
    }

    const handlePopState = (event) => {
      const historyState = event?.state
      if (historyState?.marker !== HISTORY_STATE_MARKER || typeof historyState?.page !== 'string') {
        applyNavigation('dashboard', {}, { replaceHistory: true, syncBrowserHistory: false })
        return
      }
      applyNavigation(historyState.page, historyState.pageState || {}, { syncBrowserHistory: false })
    }

    window.addEventListener('astronexNavigate', handleNavigation)
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('astronexNavigate', handleNavigation)
      window.removeEventListener('popstate', handlePopState)
    }
  }, [needsProfileSetup, isAdmin])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const currentState = window.history.state
    if (currentState?.marker === HISTORY_STATE_MARKER) return
    syncHistory(page, pageState, true)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = () => setIsNarrow(window.innerWidth < MOBILE_MENU_BREAKPOINT)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!isNarrow) {
      setMenuOpen(false)
    }
  }, [isNarrow])

  useEffect(() => {
    if (canAccessPage(page)) return
    applyNavigation('dashboard', {}, { replaceHistory: true })
  }, [page, needsProfileSetup])

  useEffect(() => {
    loadSavedTheme().then(() => {
      const signIndex = getSignIndex()
      applyTheme(signIndex)
    })
  }, [])

  // Refresh sign index for glyph display when component mounts
  useEffect(() => {
    setSignIndex(getSignIndex())
  }, [])

  function navigateTo(nextPage, nextState = {}){
    applyNavigation(nextPage, nextState)
  }

  async function logout(){
    try{
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
    }catch(_){
      // Ignore network issues during logout cleanup.
    }
    clearStoredSession()
    localStorage.removeItem('username')
    window.dispatchEvent(new Event('astronexLogout'))
    setUser(null)
    syncHistory('dashboard', {}, true)
    window.location.reload()
  }

  function renderCurrentPage(){
    if (page === 'login') return <Login onLogin={(u)=>{ setUser(u); navigateTo('dashboard') }} onShowRegister={()=>navigateTo('register')} />
    if (page === 'register') return <Register onRegistered={(u)=>{ setUser(u); navigateTo('dashboard') }} onCancel={()=>navigateTo('login')} />
    if (page === 'dashboard') return <Dashboard user={user} />
    if (page === 'mondknoten') return <Mondknoten />
    if (page === 'synastrie') return <SynastrySelectionProvider><Synastrie /></SynastrySelectionProvider>
    if (page === 'horoscope') return <Horoscope />
    if (page === 'transits') return <Transits />
    if (page === 'houses') return <Houses />
    if (page === 'solar') return <SolarReturn />
    if (page === 'agepoints') return <AgePoints />
    if (page === 'wiki') {
      return (
        <Wiki
          directPageName={pageState.directPageName || ''}
          directOriginPage={pageState.directOriginPage || ''}
          directOriginLabel={pageState.directOriginLabel || ''}
          targetSectionId={pageState.targetSectionId || ''}
          targetCategoryId={pageState.targetCategoryId || ''}
          targetEntryId={pageState.targetEntryId || ''}
        />
      )
    }
    if (page === 'settings') return <Settings />
    if (page === 'admin' && isAdmin) {
      return (
        <Admin
          initialActiveTab={pageState.activeTab || 'users'}
          initialEntryEditRequest={pageState.entryEditRequest || null}
        />
      )
    }
    return null
  }

  const pageContent = (
    <Suspense fallback={<div className="app-page-loading">Laden…</div>}>
      {renderCurrentPage()}
    </Suspense>
  )
  const selfStyledPage = SELF_STYLED_PAGES.has(page)
  const navItemClassName = 'app-nav-link'
  const navItemActiveClassName = 'app-nav-link app-nav-link-active'

  function getNavItemClassName(targetPage){
    return page === targetPage ? navItemActiveClassName : navItemClassName
  }

  function getFooterOrigin(){
    if (page === 'wiki' && pageState.directOriginPage) {
      return {
        page: pageState.directOriginPage,
        label: pageState.directOriginLabel || PAGE_LABELS[pageState.directOriginPage] || '',
      }
    }
    return { page, label: PAGE_LABELS[page] || '' }
  }

  const footerOrigin = getFooterOrigin()

  return (
    <div>
      <div className="app-nav-wrap">
      <nav className="app-nav" style={{minWidth: TOP_NAV_MIN_WIDTH}}>
        {isNarrow ? (
          <>
            <div className="app-nav-mobile-bar">
              <span className={getNavItemClassName('dashboard')} onClick={()=>navigateTo('dashboard')}>Startseite</span>
              <button
                className="app-nav-menu-button"
                type="button"
                onClick={() => setMenuOpen(open => !open)}
                aria-expanded={menuOpen}
                aria-label="Menü öffnen"
              >
                ☰
              </button>
            </div>
            {menuOpen && (
              <div className="app-nav-mobile-menu">
                <span className={getNavItemClassName('wiki')} onClick={()=>navigateTo('wiki')}>Wiki</span>
                {user ? (
                  <>
                    {!needsProfileSetup && <span className={getNavItemClassName('horoscope')} onClick={()=>navigateTo('horoscope')}>Horoskop</span>}
                    {!needsProfileSetup && <span className={getNavItemClassName('mondknoten')} onClick={()=>navigateTo('mondknoten')}>Mondknoten</span>}
                    {!needsProfileSetup && <span className={getNavItemClassName('houses')} onClick={()=>navigateTo('houses')}>Häuser</span>}
                    {!needsProfileSetup && <span className={getNavItemClassName('transits')} onClick={()=>navigateTo('transits')}>Transite</span>}
                    {!needsProfileSetup && <span className={getNavItemClassName('solar')} onClick={()=>navigateTo('solar')}>Solar Jahr</span>}
                    {!needsProfileSetup && <span className={getNavItemClassName('agepoints')} onClick={()=>navigateTo('agepoints')}>Alterspunkte</span>}
                    {!needsProfileSetup && <span className={getNavItemClassName('synastrie')} onClick={()=>navigateTo('synastrie')}>Synastrie</span>}
                    <span className={getNavItemClassName('settings')} onClick={()=>navigateTo('settings')}>Profil</span>
                    {isAdmin && <span className={getNavItemClassName('admin')} onClick={()=>navigateTo('admin')}>Admin</span>}
                    <span className="app-nav-link app-nav-link-logout" onClick={logout}>Logout</span>
                  </>
                ) : (
                  <span className={getNavItemClassName('login')} onClick={()=>navigateTo('login')}>Login</span>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="app-nav-desktop">
            <div className="app-nav-group">
            <span className={getNavItemClassName('dashboard')} onClick={()=>navigateTo('dashboard')}>Startseite</span>
            <span className={getNavItemClassName('wiki')} onClick={()=>navigateTo('wiki')}>Wiki</span>
            {user ? (
              <>
                {!needsProfileSetup && <span className={getNavItemClassName('horoscope')} onClick={()=>navigateTo('horoscope')}>Horoskop</span>}
                {!needsProfileSetup && <span className={getNavItemClassName('mondknoten')} onClick={()=>navigateTo('mondknoten')}>Mondknoten</span>}
                {!needsProfileSetup && <span className={getNavItemClassName('houses')} onClick={()=>navigateTo('houses')}>Häuser</span>}
                {!needsProfileSetup && <span className={getNavItemClassName('transits')} onClick={()=>navigateTo('transits')}>Transite</span>}
                {!needsProfileSetup && <span className={getNavItemClassName('solar')} onClick={()=>navigateTo('solar')}>Solar Jahr</span>}
                {!needsProfileSetup && <span className={getNavItemClassName('agepoints')} onClick={()=>navigateTo('agepoints')}>Alterspunkte</span>}
                {!needsProfileSetup && <span className={getNavItemClassName('synastrie')} onClick={()=>navigateTo('synastrie')}>Synastrie</span>}
                <span className={getNavItemClassName('settings')} onClick={()=>navigateTo('settings')}>Profil</span>
                {isAdmin && <span className={getNavItemClassName('admin')} onClick={()=>navigateTo('admin')}>Admin</span>}
              </>
            ) : null}
            </div>
            {user ? (
              <span className="app-nav-link app-nav-link-logout" onClick={logout}>Logout</span>
            ) : (
              <span className={getNavItemClassName('login')} onClick={()=>navigateTo('login')}>Login</span>
            )}
          </div>
        )}
      </nav>
      </div>
      <div className="app-content-stage">
        <div className={selfStyledPage ? 'app-page-shell app-page-shell-wide' : 'app-page-shell'}>
          {selfStyledPage ? pageContent : <section className="app-page-panel">{pageContent}</section>}
          <div className="app-footer-links" aria-label="Rechtliche Links">
            {FOOTER_LINKS.map((link) => (
              <button
                key={link.pageName}
                type="button"
                className="app-footer-link"
                onClick={() => navigateTo('wiki', {
                  directPageName: link.pageName,
                  directOriginPage: footerOrigin.page,
                  directOriginLabel: footerOrigin.label,
                })}
              >
                {link.label}
              </button>
            ))}
            {EXTERNAL_FOOTER_LINKS.map((link) => (
              <a
                key={link.href}
                className="app-footer-link"
                href={link.href}
                target="_blank"
                rel="noreferrer"
                style={{marginTop:"-1px"}}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
