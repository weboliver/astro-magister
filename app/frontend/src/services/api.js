const SESSION_REFRESH_WINDOW_MS = 15 * 60 * 1000
const SESSION_ACTIVITY_REFRESH_INTERVAL_MS = 15 * 60 * 1000
const SESSION_ACTIVITY_DEBOUNCE_MS = 30 * 1000
const SESSION_LAST_REFRESH_AT_KEY = 'astronex_last_refresh_at'
const SESSION_USERNAME_KEY = 'username'

let refreshPromise = null
let lastActivityRefreshAttemptAt = 0

function getStoredRefreshTimestamp(){
  if (typeof window === 'undefined') return 0
  const raw = window.localStorage.getItem(SESSION_LAST_REFRESH_AT_KEY)
  const parsed = Number.parseInt(raw || '', 10)
  if (!Number.isNaN(parsed) && parsed > 0) return parsed
  return window.localStorage.getItem(SESSION_USERNAME_KEY) ? Date.now() : 0
}

let lastRefreshAt = getStoredRefreshTimestamp()

function setLastRefreshAt(timestamp = Date.now()){
  lastRefreshAt = timestamp
  if (typeof window !== 'undefined'){
    window.localStorage.setItem(SESSION_LAST_REFRESH_AT_KEY, String(timestamp))
  }
}

function decodeBase64Url(value){
  try{
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    return atob(padded)
  }catch(_){
    return null
  }
}

function getTokenExpiry(token){
  if (!token) return null
  const parts = token.split('.')
  if (parts.length < 2) return null
  const payloadText = decodeBase64Url(parts[1])
  if (!payloadText) return null
  try{
    const payload = JSON.parse(payloadText)
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  }catch(_){
    return null
  }
}

function shouldRefreshBeforeRequest(){
  return false
}

function shouldRefreshFromActivity(){
  if (typeof window === 'undefined') return false
  if (!window.localStorage.getItem(SESSION_USERNAME_KEY)) return false
  if (Date.now() - lastRefreshAt >= SESSION_ACTIVITY_REFRESH_INTERVAL_MS) return true
  return shouldRefreshBeforeRequest()
}

export function storeAuthTokens(data){
  if (typeof window === 'undefined') return
  window.localStorage.removeItem('token')
  window.localStorage.removeItem('refresh_token')
  if (data){
    setLastRefreshAt()
  }
}

export function clearStoredSession(){
  if (typeof window === 'undefined') return
  window.localStorage.removeItem('token')
  window.localStorage.removeItem('refresh_token')
  window.localStorage.removeItem(SESSION_LAST_REFRESH_AT_KEY)
  lastRefreshAt = 0
}

export async function refreshSessionForActivity(){
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false
  const now = Date.now()
  if (now - lastActivityRefreshAttemptAt < SESSION_ACTIVITY_DEBOUNCE_MS) return false
  if (!shouldRefreshFromActivity()) return false
  lastActivityRefreshAttemptAt = now
  return refreshAccessToken()
}

async function ensureFreshAccessToken(){
  if (!shouldRefreshBeforeRequest()) return true
  return refreshAccessToken()
}

export async function post(path, payload, includeAuth = true){
  const headers = { 'Content-Type': 'application/json' }
  let resp = await fetch(path, { method: 'POST', headers, body: JSON.stringify(payload), credentials: 'include' })
  if (includeAuth && resp.status === 401){
    const ok = await refreshAccessToken()
    if (ok){
      resp = await fetch(path, { method: 'POST', headers, body: JSON.stringify(payload), credentials: 'include' })
    }
  }
  return resp
}

export async function postStream(path, payload, includeAuth = true){
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  }
  let resp = await fetch(path, { method: 'POST', headers, body: JSON.stringify(payload), credentials: 'include' })
  if (includeAuth && resp.status === 401){
    const ok = await refreshAccessToken()
    if (ok){
      resp = await fetch(path, { method: 'POST', headers, body: JSON.stringify(payload), credentials: 'include' })
    }
  }
  return resp
}

export async function postWithSignal(path, payload, signal, includeAuth = true){
  const headers = { 'Content-Type': 'application/json' }
  let resp = await fetch(path, { method: 'POST', headers, body: JSON.stringify(payload), signal, credentials: 'include' })
  if (includeAuth && resp.status === 401){
    const ok = await refreshAccessToken()
    if (ok){
      resp = await fetch(path, { method: 'POST', headers, body: JSON.stringify(payload), signal, credentials: 'include' })
    }
  }
  return resp
}

export async function get(path, includeAuth = true){
  const headers = {}
  let resp = await fetch(path, { method: 'GET', headers, credentials: 'include' })
  if (includeAuth && resp.status === 401){
    const ok = await refreshAccessToken()
    if (ok){
      resp = await fetch(path, { method: 'GET', headers, credentials: 'include' })
    }
  }
  return resp
}

export async function put(path, payload, includeAuth = true){
  const headers = { 'Content-Type': 'application/json' }
  let resp = await fetch(path, { method: 'PUT', headers, body: JSON.stringify(payload), credentials: 'include' })
  if (includeAuth && resp.status === 401){
    const ok = await refreshAccessToken()
    if (ok){
      resp = await fetch(path, { method: 'PUT', headers, body: JSON.stringify(payload), credentials: 'include' })
    }
  }
  return resp
}

export async function del(path, includeAuth = true){
  const headers = {}
  let resp = await fetch(path, { method: 'DELETE', headers, credentials: 'include' })
  if (includeAuth && resp.status === 401){
    const ok = await refreshAccessToken()
    if (ok){
      resp = await fetch(path, { method: 'DELETE', headers, credentials: 'include' })
    }
  }
  return resp
}

async function refreshAccessToken(){
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    try{
      const r = await fetch('/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}), credentials: 'include' })
      if (!r.ok) return false
      const data = await r.json()
      storeAuthTokens(data)
      return true
    }catch(_){
      return false
    }finally{
      refreshPromise = null
    }
  })()
  return refreshPromise
}
