/**
 * Register - User registration page with username, password confirmation, Turnstile captcha, and auto-login on success.
 *
 * When the invisible security check cannot be completed (blocked script, Private Relay, timeout),
 * the page shows the German hint from the Turnstile component instead of an endless
 * "Erstelle Benutzer...", stays usable, and sends no request without a token.
 *
 * Together with that hint the shared component offers a visible fallback challenge. A request that
 * fails after being sent through the fallback is never re-sent automatically: the page re-arms a
 * fresh challenge in manual mode and the next Erstellen click sends its token once.
 *
 * @component
 * @param {Object} props - Component props (keine: die Seite liest `?next=` aus der Adresszeile)
 * @returns {JSX.Element} Rendered registration page
 * @hook useNavigate - Navigation zum validierten Rückweg nach Registrierung und Login
 * @hook useSearchParams - Liest den `?next=`-Parameter
 * @hook useState - Manages username, passwords, visibility toggles, messages, message tone, busy flag, captcha token
 * @hook useRef - References Turnstile widget for captcha execution and guards concurrent submits
 * @hook useAuth - Accesses refreshProfile function
 */
import React, { useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import InvisibleTurnstile, { isTurnstileFallbackError } from '../components/InvisibleTurnstile'
import { useAuth } from '../contexts/AuthContext'
import { isValidNext, safeNext } from '../routing/nextParam'
import { storeAuthTokens, apiUrl } from '../services/api'

/** Shown between the mocked registration and the automatic login that needs a second token */
const REGISTER_LOGIN_FALLBACK_MESSAGE = 'Benutzer erstellt. Bitte die Sicherheitsprüfung unten erneut bestätigen, um die Anmeldung abzuschließen.'

/**
 * Shown when the visible challenge could not be refreshed for the automatic login.
 * Nothing can be confirmed below in that case, so the message asks for the next Erstellen click,
 * which continues with the pending login instead of registering again.
 */
const REGISTER_LOGIN_RETRY_MESSAGE = 'Benutzer erstellt. Die Sicherheitsprüfung für die Anmeldung kann gerade nicht angezeigt werden – bitte erneut auf „Erstellen“ klicken, um die Anmeldung abzuschließen.'

/**
 * Shown when the same username is submitted with a different password after a successful
 * registration. The account exists with the password that was typed first, so repeating the
 * automatic login would only produce more 401 responses and count towards the login
 * lockout. A changed username is still treated as a new registration.
 */
const REGISTER_PASSWORD_CHANGED_MESSAGE = 'Das Konto wurde mit dem zuvor eingegebenen Passwort erstellt – bitte dieses Passwort verwenden.'

export default function Register(){
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const handleShowPasswordPress = () => setShowPassword(true)
  const handleShowPasswordRelease = () => setShowPassword(false)
  const handleShowConfirmPress = () => setShowConfirmPassword(true)
  const handleShowConfirmRelease = () => setShowConfirmPassword(false)
  const [msg, setMsg] = useState('')
  const [msgTone, setMsgTone] = useState('info')
  const [busy, setBusy] = useState(false)
  const [captchaToken, setCaptchaToken] = useState('')
  const { refreshProfile } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // Gegenrichtung zu `Login.jsx`: „Abbrechen“ führt zurück auf /login und behält dabei
  // ein gültiges `next`, sonst endete der Ablauf „Login → Registrierung → Abbrechen → Login“ auf
  // `/`. Weitergegeben wird nur ein von `isValidNext` akzeptiertes Ziel, genau einmal encodiert.
  const rawNext = searchParams.get('next')
  const loginHref = isValidNext(rawNext)
    ? '/login?next=' + encodeURIComponent(rawNext)
    : '/login'
  const turnstileRef = useRef(null)
  const busyRef = useRef(false)
  const autoContinueRef = useRef(false)
  const stageRef = useRef('register')
  /**
   * Credentials of the account this form already created ({ username, password }); null until a
   * registration succeeded. The password is kept so a changed password is recognised instead of
   * repeating a login that can only fail.
   */
  const registeredRef = useRef(null)
  const passwordsDoNotMatch = confirmPassword.length > 0 && password !== confirmPassword

  function setBusyState(value){
    busyRef.current = value
    setBusy(value)
  }

  async function requestCaptchaToken(){
    let nextCaptchaToken = captchaToken
    if (turnstileRef.current?.isEnabled()){
      nextCaptchaToken = await turnstileRef.current.execute()
    }
    return nextCaptchaToken || null
  }

  /**
   * Sends the registration request with a given captcha token.
   * @param {string|null} nextCaptchaToken - Turnstile token, or null when the widget is disabled
   * @returns {Promise<boolean>} True when the account was created
   */
  async function registerWithToken(nextCaptchaToken){
    const resp = await fetch(apiUrl('/auth/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password, captcha_token: nextCaptchaToken || null })
    })
    if (!resp.ok){
      const errorPayload = await resp.json().catch(() => null)
      setMsgTone('error')
      setMsg(errorPayload?.detail || 'Registrierung fehlgeschlagen')
      turnstileRef.current?.reset()
      return false
    }
    // Remember the account: a later click must complete the login, not register again.
    registeredRef.current = { username, password }
    return true
  }

  /**
   * Sends the login request that follows a successful registration.
   * @param {string|null} nextCaptchaToken - Turnstile token of the second, separate challenge
   * @returns {Promise<boolean>} True when the login succeeded
   */
  async function loginWithToken(nextCaptchaToken){
    const login = await fetch(apiUrl('/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password, captcha_token: nextCaptchaToken || null })
    })
    if (!login.ok){
      const errorPayload = await login.json().catch(() => null)
      setMsgTone('error')
      setMsg(errorPayload?.detail || 'Registriert, aber Login fehlgeschlagen')
      turnstileRef.current?.reset()
      return false
    }
    const data = await login.json()
    storeAuthTokens(data)
    // Nur noch Anzeige-/Refresh-Hilfe, kein Login-Beweis.
    localStorage.setItem('username', username)
    // Erst die Server-Session abwarten, dann navigieren.
    await refreshProfile()
    navigate(safeNext(searchParams.get('next'), '/'), { replace: true })
    return true
  }

  /**
   * Continues with the automatic login after the account was created.
   * Turnstile tokens are single-use, so the second request needs a fresh one: either the visible
   * fallback challenge is already active (then the caller refreshes it after releasing busy), or
   * the invisible widget issues a new token right away.
   *
   * A true result means the caller must request a fresh challenge after releasing busy. When that
   * request fails (refreshFallback() is not true) the caller shows REGISTER_LOGIN_RETRY_MESSAGE and
   * disarms the automatic continue, because there is no challenge left to confirm.
   * @returns {Promise<boolean>} True when the visible fallback must be refreshed for the next token
   */
  async function continueWithLogin(){
    stageRef.current = 'login'
    turnstileRef.current?.reset()

    if (turnstileRef.current?.isFallbackActive()){
      autoContinueRef.current = true
      setMsgTone('info')
      setMsg(REGISTER_LOGIN_FALLBACK_MESSAGE)
      return true
    }

    const loginCaptchaToken = await requestCaptchaToken()
    await loginWithToken(loginCaptchaToken)
    return false
  }

  /**
   * Disarms a pending automatic continue once the form values change: the armed request must
   * never be sent with values the user typed after the hint. The visible challenge switches to the
   * manual instruction, so the next Erstellen click is the explicit decision to send.
   *
   * Only the mode changes, same as in Login: a refreshFallback() here would
   * reset the widget and throw away a half-solved challenge on the first keystroke.
   */
  function disarmAutoContinue(){
    if (!autoContinueRef.current) return
    autoContinueRef.current = false
    turnstileRef.current?.switchFallbackMode?.('manual')
  }

  /**
   * Re-arms the visible fallback after a request was sent, keeping the order
   * arm -> release busy -> refresh.
   *
   * `refreshForLogin` requests the second token for the login that follows a successful
   * registration (auto mode). `rearmAfterFailure` offers a fresh challenge in manual mode
   * after a failed request: it is sent only by the next explicit Erstellen click, never on its own.
   * @param {boolean} refreshForLogin - True when the widget must issue the post-registration login token
   * @param {boolean} rearmAfterFailure - True when the previous request failed and needs a fresh challenge
   */
  function followUpFallback(refreshForLogin, rearmAfterFailure){
    if (refreshForLogin){
      // Anything but true means no challenge was requested at all (widget gone, API missing, or
      // the reset threw). An armed continue would wait for a token that never comes, so
      // disarm it and say honestly that the next Erstellen click completes the login.
      if (turnstileRef.current?.refreshFallback() !== true){
        autoContinueRef.current = false
        setMsgTone('error')
        setMsg(REGISTER_LOGIN_RETRY_MESSAGE)
      }
      return
    }
    if (rearmAfterFailure){
      turnstileRef.current?.refreshFallback({ autoContinue: false })
    }
  }

  async function submit(e){
    e.preventDefault()

    if (passwordsDoNotMatch){
      setMsgTone('error')
      setMsg('Die Passwörter stimmen nicht überein')
      return
    }
    if (busyRef.current) return

    // The account this form already created is not registered again: a second Erstellen click
    // completes the pending login instead. A changed username falls back to 'register'.
    const registered = registeredRef.current
    const sameAccount = registered !== null && registered.username === username
    // A changed password for the same account cannot log in: the account keeps the password it was
    // created with. Say so instead of sending another 401 that counts towards the lockout.
    // A changed username is still a new registration.
    if (sameAccount && registered.password !== password){
      setMsgTone('error')
      setMsg(REGISTER_PASSWORD_CHANGED_MESSAGE)
      return
    }
    stageRef.current = sameAccount ? 'login' : 'register'
    autoContinueRef.current = false
    setBusyState(true)
    setMsgTone('info')
    setMsg(stageRef.current === 'login' ? 'Lade...' : 'Erstelle Benutzer...')
    let refreshFallbackAfter = false
    let rearmFallbackAfter = false
    // A challenge solved after an earlier failure is sent by this click, once.
    const fallbackToken = turnstileRef.current?.takeFallbackToken() || ''
    try{
      // The stored token keeps the visible challenge on screen instead of retrying the invisible check.
      const nextCaptchaToken = fallbackToken || await requestCaptchaToken()
      if (stageRef.current === 'login'){
        // The account exists, so this click only sends the pending login.
        if (!await loginWithToken(nextCaptchaToken) && fallbackToken) rearmFallbackAfter = true
      }else if (await registerWithToken(nextCaptchaToken)){
        // nach erfolgreicher Registrierung: automatisch einloggen
        refreshFallbackAfter = await continueWithLogin()
      }else if (fallbackToken){
        rearmFallbackAfter = true
      }
    }catch(err){
      setMsgTone('error')
      if (isTurnstileFallbackError(err) && err.code !== 'cancelled'){
        // A failed security check never sends a request; it only explains why and arms the fallback.
        // A cancelled check (the component was left) arms nothing.
        setMsg(stageRef.current === 'login' ? 'Benutzer erstellt. ' + err.message : err.message)
        autoContinueRef.current = true
      }else{
        setMsg('Fehler: ' + err.message)
        if (fallbackToken) rearmFallbackAfter = true
      }
      turnstileRef.current?.reset()
    }finally{
      setBusyState(false)
      // Arm first, release busy, then request the next token from the visible challenge.
      followUpFallback(refreshFallbackAfter, rearmFallbackAfter)
    }
  }

  /**
   * Continues the pending registration or login after the visible fallback challenge was solved.
   * One-shot: it sends at most one stage per armed click, so a failed request is never re-sent
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
    let refreshFallbackAfter = false
    let rearmFallbackAfter = false
    try{
      if (stageRef.current === 'login'){
        setMsg('Lade...')
        if (!await loginWithToken(fallbackToken)) rearmFallbackAfter = true
      }else{
        setMsg('Erstelle Benutzer...')
        if (await registerWithToken(fallbackToken)){
          refreshFallbackAfter = await continueWithLogin()
        }else{
          rearmFallbackAfter = true
        }
      }
    }catch(err){
      setMsgTone('error')
      if (isTurnstileFallbackError(err) && err.code !== 'cancelled'){
        setMsg(stageRef.current === 'login' ? 'Benutzer erstellt. ' + err.message : err.message)
        // A cancelled check arms no automatic continue.
        autoContinueRef.current = true
      }else{
        setMsg('Fehler: ' + err.message)
        rearmFallbackAfter = true
      }
      turnstileRef.current?.reset()
    }finally{
      setBusyState(false)
      followUpFallback(refreshFallbackAfter, rearmFallbackAfter)
    }
  }

  return (
    <div style={{maxWidth:420}}>
      <h2>Benutzer erstellen</h2>
      <form onSubmit={submit}>
        <div>
          <label htmlFor="register-username">Benutzer</label><br/>
          <input id="register-username" value={username} onChange={e=>{ setUsername(e.target.value); disarmAutoContinue() }} />
        </div>
        <div>
          <label htmlFor="register-password">Passwort</label><br/>
          <div style={{display:'flex',alignItems:'center'}}>
            <input id="register-password" type={showPassword ? 'text' : 'password'} value={password} onChange={e=>{ setPassword(e.target.value); disarmAutoContinue() }} />
            <button
              type="button"
              onMouseDown={handleShowPasswordPress}
              onMouseUp={handleShowPasswordRelease}
              onMouseLeave={handleShowPasswordRelease}
              onTouchStart={(e)=>{ e.preventDefault(); handleShowPasswordPress() }}
              onTouchEnd={handleShowPasswordRelease}
              style={{marginLeft:8, cursor: 'pointer', padding: '5px 5px'}}
              aria-label={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
            >
              {showPassword ? '🙈' : '👁️'}
            </button>
          </div>
        </div>
        <div>
          <label htmlFor="register-confirm-password">Passwort erneut eingeben</label><br/>
          <div style={{display:'flex',alignItems:'center'}}>
            <input id="register-confirm-password" type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={e=>{ setConfirmPassword(e.target.value); disarmAutoContinue() }} />
            <button
              type="button"
              onMouseDown={handleShowConfirmPress}
              onMouseUp={handleShowConfirmRelease}
              onMouseLeave={handleShowConfirmRelease}
              onTouchStart={(e)=>{ e.preventDefault(); handleShowConfirmPress() }}
              onTouchEnd={handleShowConfirmRelease}
              style={{marginLeft:8, cursor: 'pointer', padding: '5px 5px'}}
              aria-label={showConfirmPassword ? 'Bestätigung verbergen' : 'Bestätigung anzeigen'}
            >
              {showConfirmPassword ? '🙈' : '👁️'}
            </button>
          </div>
        </div>
        {passwordsDoNotMatch && (
          <div style={{marginTop:6,color:'crimson'}}>
            Die Passwörter stimmen nicht überein.
          </div>
        )}
        <div>
          <small>Das Passwort muss mindestens 8 Zeichen lang sein und sollte Groß- und Kleinbuchstaben sowie Zahlen enthalten.</small>
        </div>
        <div style={{marginTop:8}}>
          <button type="submit" disabled={passwordsDoNotMatch || busy}>Erstellen</button>
          <Link to={loginHref} style={{marginLeft:8}}>Abbrechen</Link>
        </div>
        <p><b>Bitte beachten Sie die Informationen zum Datenschutz, bevor Sie fortfahren.</b></p>
      </form>
      <div data-testid="register-message" role="status" aria-live="polite" style={{marginTop:8,color: msgTone === 'error' ? 'crimson' : 'green'}}>{msg}</div>
      {/* Directly below the hint, so a failed invisible check offers the visible challenge there. */}
      <InvisibleTurnstile
        ref={turnstileRef}
        action="register"
        onTokenChange={setCaptchaToken}
        onFallbackToken={handleFallbackToken}
      />
    </div>
  )
}
