import React, { createContext, useContext, useState, useEffect, useRef } from 'react'
import { clearStoredSession, get, refreshSessionForActivity } from '../services/api'

/**
 * AuthContext.jsx - Authentication context provider
 * @module AuthContext
 * @description React context for managing user authentication state, profile, and session
 */

/**
 * Authentication context - provides user profile and auth methods to consuming components
 * @type {React.Context}
 */
const AuthContext = createContext(null)

export function AuthProvider({ children }){
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [initializedState, setInitializedState] = useState(false)
  const initialized = useRef(false)

  function handleUnauthenticated(){
    if (typeof window !== 'undefined'){
      clearStoredSession()
      window.localStorage.removeItem('username')
      window.dispatchEvent(new CustomEvent('astronexLogout'))
    }
    setProfile(null)
  }

  async function loadProfile(){
    if (initialized.current) return
    initialized.current = true
    setLoading(true)
    try{
      const resp = await get('/auth/profile')
      if (resp.ok){
        const data = await resp.json()
        setProfile(data)
      } else if (resp.status === 401){
        handleUnauthenticated()
      }
    }catch(e){
      // ignore - profile stays null
    }finally{
      setLoading(false)
      setInitializedState(true)
    }
  }

  useEffect(()=>{ loadProfile() }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const handleUserActivity = () => {
      if (!window.localStorage.getItem('username')) return
      refreshSessionForActivity()
    }

    const activityEvents = ['pointerdown', 'keydown', 'focus']
    activityEvents.forEach(eventName => window.addEventListener(eventName, handleUserActivity))
    if (typeof document !== 'undefined'){
      document.addEventListener('visibilitychange', handleUserActivity)
    }
    return () => {
      activityEvents.forEach(eventName => window.removeEventListener(eventName, handleUserActivity))
      if (typeof document !== 'undefined'){
        document.removeEventListener('visibilitychange', handleUserActivity)
      }
    }
  }, [])

  async function refreshProfile(){
    // force re-fetch regardless of initialized flag
    setLoading(true)
    try{
      const resp = await get('/auth/profile')
      if (resp.ok){
        const data = await resp.json()
        setProfile(data)
      } else if (resp.status === 401){
        handleUnauthenticated()
      }
    }catch(e){}
    setLoading(false)
  }

  return (
    <AuthContext.Provider value={{ profile, setProfile, loading, initialized: initializedState, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(){
  return useContext(AuthContext)
}

export default AuthContext
