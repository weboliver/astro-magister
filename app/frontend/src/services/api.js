/**
 * api.js - API client service for Astro-Magister frontend
 * @module api
 * @description HTTP client wrapper with JWT authentication, session management, and error handling
 */

import { THEME_SIGN_STORAGE_KEY } from '../theme/storageKeys'

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

/**
 * Vergisst alle Schlüssel der Sitzung — die gemeinsame Bereinigung für **jeden** Logout-Pfad
 * (`App.logout()`, `AuthContext.handleUnauthenticated()`).
 *
 * Der Theme-Merker gehört dazu: nach dem Logout gilt wieder das Tageszeichen, ein
 * übrig gebliebener Merker malte beim nächsten Start die Palette der zuvor gewählten Person.
 * Die Bereinigung steht deshalb hier und nicht nur im SPA-Logout, damit sie auch beim Ablauf der
 * Sitzung und beim Logout des statischen Wikis greift.
 */
export function clearStoredSession(){
  if (typeof window === 'undefined') return
  window.localStorage.removeItem('token')
  window.localStorage.removeItem('refresh_token')
  window.localStorage.removeItem(SESSION_LAST_REFRESH_AT_KEY)
  window.localStorage.removeItem(THEME_SIGN_STORAGE_KEY)
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

/**
 * Basis-Pfad der eigenen API. Wird ausschließlich hier gesetzt und an der Edge
 * (nginx `location /api/`, Vite-Proxy `'^/api/'`) wieder abgeschnitten; das Backend
 * bleibt präfixlos.
 */
export const API_BASE = '/api'

/**
 * Bildet aus einem backend-relativen Pfad den Browser-Pfad.
 * Idempotent: ein bereits präfixierter Pfad wird nicht verdoppelt (`/api/ascendant`
 * bleibt `/api/ascendant`), absolute URLs (`blob:`, `data:`, `https:`, `//host`) kommen
 * unverändert zurück. Query-Strings, Prozent-Escapes und ein abschließender Slash
 * bleiben unverändert.
 *
 * @param {string} path - Backend-relativer Pfad, muss mit `/` beginnen
 * @returns {string} Pfad unterhalb von `/api`
 * @throws {TypeError} Wenn der Pfad fehlt, kein String ist oder nicht mit `/` beginnt
 */
export function apiUrl(path){
  if (typeof path !== 'string' || path === '') throw new TypeError('apiUrl(): Pfad fehlt')
  // Absolute URLs (Blobs, Data-URLs, CDN-Hosts) dürfen nie präfixiert werden.
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) return path
  if (!path.startsWith('/')) throw new TypeError('apiUrl(): Pfad muss mit / beginnen: ' + path)
  // Das Lookahead verhindert, dass `/apiary` als `/api`-Präfix gilt.
  return API_BASE + path.replace(/^\/api(?=\/|$)/, '')
}

export async function post(path, payload, includeAuth = true){
  const url = apiUrl(path)
  const headers = { 'Content-Type': 'application/json' }
  let resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), credentials: 'include' })
  if (includeAuth && resp.status === 401){
    const ok = await refreshAccessToken()
    if (ok){
      resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), credentials: 'include' })
    }
  }
  return resp
}

export async function postStream(path, payload, includeAuth = true){
  const url = apiUrl(path)
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  }
  let resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), credentials: 'include' })
  if (includeAuth && resp.status === 401){
    const ok = await refreshAccessToken()
    if (ok){
      resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), credentials: 'include' })
    }
  }
  return resp
}

export async function postWithSignal(path, payload, signal, includeAuth = true){
  const url = apiUrl(path)
  const headers = { 'Content-Type': 'application/json' }
  let resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal, credentials: 'include' })
  if (includeAuth && resp.status === 401){
    const ok = await refreshAccessToken()
    if (ok){
      resp = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal, credentials: 'include' })
    }
  }
  return resp
}

export async function get(path, includeAuth = true){
  const url = apiUrl(path)
  const headers = {}
  let resp = await fetch(url, { method: 'GET', headers, credentials: 'include' })
  if (includeAuth && resp.status === 401){
    const ok = await refreshAccessToken()
    if (ok){
      resp = await fetch(url, { method: 'GET', headers, credentials: 'include' })
    }
  }
  return resp
}

export async function put(path, payload, includeAuth = true){
  const url = apiUrl(path)
  const headers = { 'Content-Type': 'application/json' }
  let resp = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(payload), credentials: 'include' })
  if (includeAuth && resp.status === 401){
    const ok = await refreshAccessToken()
    if (ok){
      resp = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(payload), credentials: 'include' })
    }
  }
  return resp
}

export async function del(path, includeAuth = true){
  const url = apiUrl(path)
  const headers = {}
  let resp = await fetch(url, { method: 'DELETE', headers, credentials: 'include' })
  if (includeAuth && resp.status === 401){
    const ok = await refreshAccessToken()
    if (ok){
      resp = await fetch(url, { method: 'DELETE', headers, credentials: 'include' })
    }
  }
  return resp
}

async function refreshAccessToken(){
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    try{
      const r = await fetch(apiUrl('/auth/refresh'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}), credentials: 'include' })
      // Antwortet der SPA-Fallback (200 text/html) statt der API, ist die Route nicht geproxyt.
      // Der Wurf allein wäre unsichtbar, weil der catch unten `false` zurückgibt — deshalb wird
      // er dort vor dem `return false` protokolliert.
      if ((r.headers.get('content-type') || '').includes('text/html')){
        throw new Error('API route not proxied (/auth/refresh)')
      }
      if (!r.ok) return false
      const data = await r.json()
      storeAuthTokens(data)
      return true
    }catch(e){
      console.error('[api] refreshAccessToken() fehlgeschlagen:', e)
      return false
    }finally{
      refreshPromise = null
    }
  })()
  return refreshPromise
}

export async function streamSynastry(personAId, personBId, comparisonMode, additionalQuestion, interpretationId) {
  const payload = {
    person_a_id: personAId,
    person_b_id: personBId,
    comparison_mode: comparisonMode,
  }
  if (additionalQuestion) payload.additional_question = additionalQuestion
  if (interpretationId) payload.interpretation_id = interpretationId

  return postStream('/synastry/stream', payload)
}

export async function fetchSynastryGraphic(personAId, personBId, comparisonMode, width = 750, height = 750) {
  const resp = await post(`/synastry/graphic?width=${width}&height=${height}`, {
    person_a_id: personAId,
    person_b_id: personBId,
    comparison_mode: comparisonMode,
  })
  if (!resp.ok) throw new Error('Graphic fetch failed')
  return resp.blob()
}

export async function listInterpretations(contextType, userPersonsId = null) {
  const params = new URLSearchParams()
  params.append('context_type', contextType)
  if (userPersonsId != null) params.append('user_persons_id', userPersonsId.toString())
  return get(`/interpretations?${params.toString()}`)
}
