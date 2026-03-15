import React, { useRef, useState } from 'react'
import InvisibleTurnstile from '../components/InvisibleTurnstile'
import { useAuth } from '../contexts/AuthContext'
import { storeAuthTokens } from '../services/api'

export default function Register({ onRegistered, onCancel }){
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const { refreshProfile } = useAuth()
  const turnstileRef = useRef(null)

  async function requestCaptchaToken(){
    let nextCaptchaToken = captchaToken
    if (turnstileRef.current?.isEnabled()){
      nextCaptchaToken = await turnstileRef.current.execute()
    }
    return nextCaptchaToken || null
  }

  async function submit(e){
    e.preventDefault()
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
          <label>Benutzer</label><br/>
          <input value={username} onChange={e=>setUsername(e.target.value)} />
        </div>
        <div>
          <label>Passwort</label><br/>
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} />
        </div>
        <div style={{marginTop:8}}>
          <button type="submit">Erstellen</button>
          <button type="button" style={{marginLeft:8}} onClick={onCancel}>Abbrechen</button>
        </div>
        <InvisibleTurnstile ref={turnstileRef} action="register" onTokenChange={setCaptchaToken} />
      </form>
      <div style={{marginTop:8,color:'green'}}>{msg}</div>
    </div>
  )
}
