/**
 * Login - User login page with username/password form, password visibility toggle, and Turnstile captcha.
 *
 * When the invisible security check cannot be completed (blocked script, Private Relay, timeout),
 * the page shows the German hint from the Turnstile component instead of an endless "Lade..." and
 * stays usable: the Anmelden button becomes enabled again and no login request is sent.
 *
 * Together with that hint the shared component offers a visible fallback challenge. Solving it
 * continues the login automatically with the already entered credentials (one request, one click).
 * A login that fails afterwards is never re-sent automatically: the page re-arms the visible
 * challenge with an honest instruction ("confirm again, then submit again"), and the next Anmelden
 * click sends the fresh token once.
 *
 * Ein gültiger `?next=`-Wert wird beim Wechsel zur Registrierung weitergegeben: der Rückweg gilt
 * auch für den Umweg „Login → Registrierung“ und darf dort nicht auf `/` enden.
 *
 * @component
 * @param {Object} props - Component props (keine: die Seite liest `?next=` aus der Adresszeile)
 * @returns {JSX.Element} Rendered login page
 * @hook useNavigate - Navigation zum validierten Rückweg nach dem Login
 * @hook useSearchParams - Liest den `?next=`-Parameter (Rückweg und Registrierungs-Link)
 * @hook useState - Manages username, password, password visibility, messages, message tone, busy flag, captcha token
 * @hook useRef - References Turnstile widget for captcha execution and guards concurrent submits
 * @hook useAuth - Accesses refreshProfile function
 */
import React, { useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import InvisibleTurnstile, { isTurnstileFallbackError } from '../components/InvisibleTurnstile'
import { useAuth } from '../contexts/AuthContext'
import { isValidNext, safeNext } from '../routing/nextParam'
import { storeAuthTokens, apiUrl } from '../services/api'

/**
 * Appended to the failure message when the visible challenge could not be refreshed after a failed
 * login that was sent through the fallback: nothing can be confirmed below, so the next
 * Anmelden click is the way forward.
 */
const LOGIN_RETRY_MESSAGE = 'Die Sicherheitsprüfung kann gerade nicht erneut angezeigt werden – bitte erneut auf „Anmelden“ klicken.'

export default function Login(){
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgTone, setMsgTone] = useState('info')
  const [busy, setBusy] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const { refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Der Rückweg gilt auch für den Weg über die Registrierung: ein mitgereistes, gültiges
  // `next` wird an /register weitergegeben, damit der Ablauf „Login → Registrierung“ nicht
  // stillschweigend auf `/` endet. Weitergegeben wird ausschließlich ein bereits von
  // `isValidNext` akzeptiertes Ziel — ein roher Query-Wert würde den Open-Redirect-Schutz über
  // den Umweg aushebeln —, und zwar genau einmal prozent-encodiert. Register validiert den Wert
  // zusätzlich selbst über `safeNext`.
  const rawNext = searchParams.get('next')
  const registerHref = isValidNext(rawNext)
    ? '/register?next=' + encodeURIComponent(rawNext)
    : '/register'
  const turnstileRef = useRef(null)
  const busyRef = useRef(false)
  const autoContinueRef = useRef(false)
  const handleShowPress = () => setShowPassword(true)
  const handleShowRelease = () => setShowPassword(false)

  function setBusyState(value){
    busyRef.current = value
    setBusy(value)
  }

  /**
   * Disarms a pending automatic continue once the credentials change: the armed login must
   * never be sent with values the user typed after the hint. The visible challenge switches to the
   * manual instruction, so the next Anmelden click is the explicit decision to send.
   *
   * Only the mode changes: a refreshFallback() here would reset the widget and
   * throw away a half-solved challenge on the first keystroke. No token is discarded, so the user
   * confirms once and the next click sends it.
   */
  function disarmAutoContinue(){
    if (!autoContinueRef.current) return
    autoContinueRef.current = false
    turnstileRef.current?.switchFallbackMode?.('manual')
  }

  /**
   * Re-arms the visible challenge after a failed request that was sent through it.
   * The fresh challenge is only sent by the next click. When it cannot be requested (refreshFallback
   * is not true) the message says so honestly instead of leaving only the server error.
   */
  function rearmFallbackManually(){
    if (turnstileRef.current?.refreshFallback({ autoContinue: false }) === true) return
    setMsgTone('error')
    setMsg((current) => (current ? current + ' ' : '') + LOGIN_RETRY_MESSAGE)
  }

  /**
   * Sends the login request with a given captcha token.
   * Shared by the normal submit and the automatic continue after a solved fallback challenge.
   * @param {string} nextCaptchaToken - Turnstile token, or empty when the widget is disabled
   * @returns {Promise<boolean>} True when the login succeeded
   */
  async function loginWithToken(nextCaptchaToken){
    const resp = await fetch(apiUrl('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password, captcha_token: nextCaptchaToken || null })
    })
    if (!resp.ok){
      const errorPayload = await resp.json().catch(() => null)
      setMsgTone('error')
      setMsg(errorPayload?.detail || 'Login fehlgeschlagen')
      turnstileRef.current?.reset()
      return false
    }
    const data = await resp.json()
    storeAuthTokens(data)
    // Nur noch Anzeige-/Refresh-Hilfe, kein Login-Beweis.
    localStorage.setItem('username', username)
    // Erst die Server-Session abwarten, dann navigieren: sonst sieht der Guard noch
    // `profile === null` und schickt zurück auf /login.
    await refreshProfile()
    setMsg('Erfolgreich')
    navigate(safeNext(searchParams.get('next'), '/'), { replace: true })
    return true
  }

  async function submit(e){
    e.preventDefault()
    if (busyRef.current) return
    // A fresh click always retries the invisible check first; no auto-continue is pending.
    autoContinueRef.current = false
    setBusyState(true)
    setMsgTone('info')
    setMsg('Lade...')
    let rearmFallbackAfter = false
    // A challenge that was solved after an earlier failure is sent by this click, once.
    const fallbackToken = turnstileRef.current?.takeFallbackToken() || ''
    try{
      let nextCaptchaToken = captchaToken
      if (fallbackToken){
        // The visible challenge stays on screen; no second invisible wait.
        nextCaptchaToken = fallbackToken
      }else if (turnstileRef.current?.isEnabled()){
        nextCaptchaToken = await turnstileRef.current.execute()
      }
      const ok = await loginWithToken(nextCaptchaToken)
      if (!ok && fallbackToken) rearmFallbackAfter = true
    }catch(err){
      setMsgTone('error')
      // A failed security check never sends a login request; it only explains why.
      setMsg(isTurnstileFallbackError(err) ? err.message : 'Fehler: ' + err.message)
      if (isTurnstileFallbackError(err) && err.code !== 'cancelled'){
        // The login intent now waits on the visible challenge shown right below the hint. A
        // cancelled check (the component was left) is no challenge failure and must not arm a
        // login that can never be sent.
        autoContinueRef.current = true
      }else if (fallbackToken){
        rearmFallbackAfter = true
      }
      turnstileRef.current?.reset()
    }finally{
      setBusyState(false)
      if (rearmFallbackAfter) rearmFallbackManually()
    }
  }

  /**
   * Continues the pending login after the visible fallback challenge was solved.
   * One-shot: it sends at most one request per armed click, so a failed login is never retried
   * automatically. It uses the username and password of the current render.
   * @param {string} token - Token issued by the visible fallback challenge
   */
  async function handleFallbackToken(token){
    if (!token) return
    if (!autoContinueRef.current) return
    if (busyRef.current) return
    // The component stores the token before notifying, so this is the one allowed hand-out.
    const fallbackToken = turnstileRef.current?.takeFallbackToken() || ''
    if (!fallbackToken) return
    autoContinueRef.current = false
    setBusyState(true)
    setMsgTone('info')
    setMsg('Lade...')
    let rearmFallbackAfter = false
    try{
      const ok = await loginWithToken(fallbackToken)
      if (!ok) rearmFallbackAfter = true
    }catch(err){
      setMsgTone('error')
      setMsg('Fehler: ' + err.message)
      rearmFallbackAfter = true
    }finally{
      setBusyState(false)
      if (rearmFallbackAfter) rearmFallbackManually()
    }
  }

  return (
    <div style={{maxWidth:420}}>
      <form onSubmit={submit}>
        <div>
          <label htmlFor="login-username">Benutzer</label><br/>
          <input id="login-username" value={username} onChange={e=>{ setUsername(e.target.value); disarmAutoContinue() }} />
        </div>
        <div>
          <label htmlFor="login-password">Passwort</label><br/>
          <div style={{display:'flex',alignItems:'center'}}>
            <input id="login-password" type={showPassword ? 'text' : 'password'} value={password} onChange={e=>{ setPassword(e.target.value); disarmAutoContinue() }} />
            <button
              type="button"
              onMouseDown={handleShowPress}
              onMouseUp={handleShowRelease}
              onMouseLeave={handleShowRelease}
              onTouchStart={(e)=>{ e.preventDefault(); handleShowPress() }}
              onTouchEnd={handleShowRelease}
              style={{marginLeft:8, padding: '5px 5px', cursor: 'pointer'}}
              aria-label={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
            >
              {showPassword ? '🙈' : '👁️'}
            </button>
          </div>
        </div>
        <div style={{marginTop:8}}>
          <button type="submit" disabled={busy}>Anmelden</button>
        </div>
        <div style={{marginTop:8}}>
          <Link to={registerHref}>Neuen Benutzer erstellen</Link>
        </div>
      </form>
      <div data-testid="login-message" role="status" aria-live="polite" style={{marginTop:8,color: msgTone === 'error' ? 'crimson' : 'green'}}>{msg}</div>
      {/* Directly below the hint, so a failed invisible check offers the visible challenge there. */}
      <InvisibleTurnstile
        ref={turnstileRef}
        action="login"
        onTokenChange={setCaptchaToken}
        onFallbackToken={handleFallbackToken}
      />
    </div>
  )
}
