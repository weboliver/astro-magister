/**
 * Login - User login page with username/password form, password visibility toggle, and Turnstile captcha.
 * @component
 * @param {Object} props - Component props
 * @param {Function} props.onLogin - Callback fired on successful login
 * @param {Function} [props.onShowRegister] - Callback to switch to registration view
 * @returns {JSX.Element} Rendered login page
 * @hook useState - Manages username, password, password visibility, messages, captcha token
 * @hook useRef - References Turnstile widget for captcha execution
 * @hook useAuth - Accesses refreshProfile function
 */
import React, { useRef, useState } from 'react'
import InvisibleTurnstile from '../components/InvisibleTurnstile'
import { useAuth } from '../contexts/AuthContext'
import { storeAuthTokens } from '../services/api'

export default function Login({ onLogin, onShowRegister }){
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [msg, setMsg] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const { refreshProfile } = useAuth()
  const turnstileRef = useRef(null)
  const handleShowPress = () => setShowPassword(true)
  const handleShowRelease = () => setShowPassword(false)

  async function submit(e){
    e.preventDefault()
    setMsg('Lade...')
    try{
      let nextCaptchaToken = captchaToken
      if (turnstileRef.current?.isEnabled()){
        nextCaptchaToken = await turnstileRef.current.execute()
      }
      const resp = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password, captcha_token: nextCaptchaToken || null })
      })
      if (!resp.ok){
        const errorPayload = await resp.json().catch(() => null)
        setMsg(errorPayload?.detail || 'Login fehlgeschlagen')
        turnstileRef.current?.reset()
        return
      }
      const data = await resp.json()
      storeAuthTokens(data)
      localStorage.setItem('username', username)
      onLogin({ username })
      refreshProfile?.()
      setMsg('Erfolgreich')
    }catch(err){
      setMsg('Fehler: ' + err.message)
      turnstileRef.current?.reset()
    }

  }

  return (
    <div style={{maxWidth:420}}>
      <h3>Login</h3>
      <form onSubmit={submit}>
        <div>
          <label>Benutzer</label><br/>
          <input value={username} onChange={e=>setUsername(e.target.value)} />
        </div>
        <div>
          <label>Passwort</label><br/>
          <div style={{display:'flex',alignItems:'center'}}>
            <input type={showPassword ? 'text' : 'password'} value={password} onChange={e=>setPassword(e.target.value)} />
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
          <button type="submit">Anmelden</button>
        </div>
        <InvisibleTurnstile ref={turnstileRef} action="login" onTokenChange={setCaptchaToken} />
        <div style={{marginTop:8}}>
          <a href="#" onClick={(e)=>{ e.preventDefault(); if (onShowRegister) onShowRegister() }}>Neuen Benutzer erstellen</a>
        </div>
      </form>
      <div style={{marginTop:8,color:'green'}}>{msg}</div>
    </div>
  )
}
