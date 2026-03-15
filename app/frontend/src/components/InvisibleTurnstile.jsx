import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'

const TURNSTILE_SCRIPT_ID = 'astronex-turnstile-script'
const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let scriptPromise = null

function buildTurnstileErrorMessage(errorCode){
  const host = typeof window !== 'undefined' ? window.location.host : 'unknown-host'
  if (!errorCode) return `Captcha-Pruefung fehlgeschlagen (Host: ${host})`
  return `Captcha-Pruefung fehlgeschlagen (${errorCode}, Host: ${host})`
}

function isPlaceholderSiteKey(value){
  const normalized = String(value || '').trim().toLowerCase()
  return !normalized || normalized.startsWith('replace-with-your-turnstile') || normalized === 'your-turnstile-site-key'
}

function loadTurnstileScript(){
  if (typeof window === 'undefined') return Promise.resolve(null)
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(TURNSTILE_SCRIPT_ID)
    if (existing){
      existing.addEventListener('load', () => resolve(window.turnstile), { once: true })
      existing.addEventListener('error', () => reject(new Error('Turnstile konnte nicht geladen werden')), { once: true })
      return
    }

    const script = document.createElement('script')
    script.id = TURNSTILE_SCRIPT_ID
    script.src = TURNSTILE_SCRIPT_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve(window.turnstile)
    script.onerror = () => reject(new Error('Turnstile konnte nicht geladen werden'))
    document.head.appendChild(script)
  })
  return scriptPromise
}

const InvisibleTurnstile = forwardRef(function InvisibleTurnstile({ action, onTokenChange }, ref){
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  const pendingResolverRef = useRef(null)
  const pendingRejectorRef = useRef(null)
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
  const enabled = !isPlaceholderSiteKey(siteKey)

  useEffect(() => {
    if (!enabled || !containerRef.current) return undefined
    let cancelled = false

    loadTurnstileScript()
      .then((turnstile) => {
        if (cancelled || !turnstile || widgetIdRef.current !== null) return
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          size: 'invisible',
          callback: (token) => {
            onTokenChange?.(token)
            if (pendingResolverRef.current){
              pendingResolverRef.current(token)
              pendingResolverRef.current = null
              pendingRejectorRef.current = null
            }
          },
          'error-callback': (errorCode) => {
            onTokenChange?.('')
            if (pendingRejectorRef.current){
              pendingRejectorRef.current(new Error(buildTurnstileErrorMessage(errorCode)))
              pendingResolverRef.current = null
              pendingRejectorRef.current = null
            }
          },
          'expired-callback': () => {
            onTokenChange?.('')
          },
        })
      })
      .catch(() => {
        onTokenChange?.('')
      })

    return () => {
      cancelled = true
      if (widgetIdRef.current !== null && window.turnstile){
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [action, enabled, onTokenChange, siteKey])

  useImperativeHandle(ref, () => ({
    async execute(){
      if (!enabled) return null
      const turnstile = await loadTurnstileScript()
      if (!turnstile || widgetIdRef.current === null){
        throw new Error('Captcha ist noch nicht bereit')
      }
      turnstile.reset(widgetIdRef.current)
      return await new Promise((resolve, reject) => {
        pendingResolverRef.current = resolve
        pendingRejectorRef.current = reject
        turnstile.execute(widgetIdRef.current)
      })
    },
    reset(){
      if (!enabled || widgetIdRef.current === null || !window.turnstile) return
      window.turnstile.reset(widgetIdRef.current)
      onTokenChange?.('')
    },
    isEnabled(){
      return enabled
    },
  }), [enabled, onTokenChange])

  if (!enabled) return null
  return <div ref={containerRef} style={{ minHeight: 1 }} />
})

export default InvisibleTurnstile