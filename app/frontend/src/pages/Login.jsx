import React, { useRef, useState } from 'react'
import InvisibleTurnstile from '../components/InvisibleTurnstile'
import { useAuth } from '../contexts/AuthContext'
import { storeAuthTokens } from '../services/api'

export default function Login({ onLogin, onShowRegister }){
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [captchaToken, setCaptchaToken] = useState('')
  const { refreshProfile } = useAuth()
  const turnstileRef = useRef(null)

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
          <input type="password" value={password} onChange={e=>setPassword(e.target.value)} />
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
