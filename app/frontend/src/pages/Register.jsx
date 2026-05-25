/**
 * Register - User registration page with username, password confirmation, Turnstile captcha, and auto-login on success.
 * @component
 * @param {Object} props - Component props
 * @param {Function} [props.onRegistered] - Callback fired on successful registration and login
 * @param {Function} [props.onCancel] - Callback to cancel registration and return
 * @returns {JSX.Element} Rendered registration page
 * @hook useState - Manages username, passwords, visibility toggles, messages, captcha token
 * @hook useRef - References Turnstile widget for captcha execution
 * @hook useAuth - Accesses refreshProfile function
 */
import React, { useRef, useState } from 'react'
import InvisibleTurnstile from '../components/InvisibleTurnstile'
import { useAuth } from '../contexts/AuthContext'
import { storeAuthTokens } from '../services/api'

export default function Register({ onRegistered, onCancel }){
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
  const [captchaToken, setCaptchaToken] = useState('')
  const { refreshProfile } = useAuth()
  const turnstileRef = useRef(null)
  const passwordsDoNotMatch = confirmPassword.length > 0 && password !== confirmPassword

  async function requestCaptchaToken(){
    let nextCaptchaToken = captchaToken
    if (turnstileRef.current?.isEnabled()){
      nextCaptchaToken = await turnstileRef.current.execute()
    }
    return nextCaptchaToken || null
  }

  async function submit(e){
    e.preventDefault()

    if (passwordsDoNotMatch){
      setMsg('Die Passwörter stimmen nicht überein')
      return
    }

    setMsg('Erstelle Benutzer...')
    try{
      const registerCaptchaToken = await requestCaptchaToken()
      const resp = await fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password, captcha_token: registerCaptchaToken })
      })
      if (!resp.ok){
        const errorPayload = await resp.json().catch(() => null)
        setMsg(errorPayload?.detail || 'Registrierung fehlgeschlagen')
        turnstileRef.current?.reset()
        return
      }

      turnstileRef.current?.reset()
      const loginCaptchaToken = await requestCaptchaToken()

      // nach erfolgreicher Registrierung: automatisch einloggen
      const login = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password, captcha_token: loginCaptchaToken })
      })
      if (!login.ok){
        const errorPayload = await login.json().catch(() => null)
        setMsg(errorPayload?.detail || 'Registriert, aber Login fehlgeschlagen')
        turnstileRef.current?.reset()
        return
      }
      const data = await login.json()
      storeAuthTokens(data)
      localStorage.setItem('username', username)
      refreshProfile?.()
      if (onRegistered) onRegistered({ username })
    }catch(err){
      setMsg('Fehler: ' + err.message)
      turnstileRef.current?.reset()
    }
  }

  return (
    <div style={{maxWidth:420}}>
      <h3>Benutzer erstellen</h3>
      <form onSubmit={submit}>
        <div>
          <label htmlFor="register-username">Benutzer</label><br/>
          <input id="register-username" value={username} onChange={e=>setUsername(e.target.value)} />
        </div>
        <div>
          <label htmlFor="register-password">Passwort</label><br/>
          <div style={{display:'flex',alignItems:'center'}}>
            <input id="register-password" type={showPassword ? 'text' : 'password'} value={password} onChange={e=>setPassword(e.target.value)} />
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
            <input id="register-confirm-password" type={showConfirmPassword ? 'text' : 'password'} value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} />
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
          <button type="submit" disabled={passwordsDoNotMatch}>Erstellen</button>
          <button type="button" style={{marginLeft:8}} onClick={onCancel}>Abbrechen</button>
        </div>
        <p><b>Bitte beachten Sie die Informationen zum Datenschutz, bevor Sie fortfahren.</b></p>
        <InvisibleTurnstile ref={turnstileRef} action="register" onTokenChange={setCaptchaToken} />
      </form>
      <div style={{marginTop:8,color:'green'}}>{msg}</div>
    </div>
  )
}
