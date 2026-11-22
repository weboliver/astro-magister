import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

const TURNSTILE_SCRIPT_ID = 'astronex-turnstile-script'
const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

/** Maximum time to wait for the invisible challenge before giving up, in milliseconds */
export const TURNSTILE_EXECUTE_TIMEOUT_MS = 10000

/**
 * Maximum time one request for the Turnstile script may stay unanswered before it is dropped,
 * in milliseconds
 */
export const TURNSTILE_SCRIPT_TIMEOUT_MS = 10000

/** German hint shown when the invisible security check cannot be completed */
export const TURNSTILE_FALLBACK_MESSAGE = 'Die Sicherheitsprüfung konnte nicht abgeschlossen werden. Bitte Inhaltsblocker/Privat-Relay prüfen oder erneut versuchen.'

/** Instruction shown above the visible fallback challenge */
export const TURNSTILE_FALLBACK_INSTRUCTION = 'Alternativ hier die Sicherheitsprüfung bestätigen – danach geht es automatisch weiter.'

/**
 * Instruction shown above a fresh visible challenge after a request that was already sent through
 * the fallback failed. The solved challenge is sent only by the next explicit submit, never
 * automatically, so the text has to ask for that submit instead of promising a continuation.
 */
export const TURNSTILE_FALLBACK_MANUAL_INSTRUCTION = 'Bitte die Eingaben prüfen, die Sicherheitsprüfung hier erneut bestätigen und das Formular dann erneut absenden.'

/** Shown inside the fallback area when the visible challenge itself cannot be loaded */
export const TURNSTILE_FALLBACK_UNAVAILABLE_TEXT = 'Die Sicherheitsprüfung kann gerade nicht geladen werden. Bitte Inhaltsblocker/Privat-Relay prüfen und es erneut versuchen.'

/** Shown inside the fallback area when a solved visible challenge expired before it was used */
export const TURNSTILE_FALLBACK_EXPIRED_TEXT = 'Die Sicherheitsprüfung ist abgelaufen. Bitte hier erneut bestätigen.'

/** Shown inside the fallback area while the visible challenge is still loading */
export const TURNSTILE_FALLBACK_LOADING_TEXT = 'Die Sicherheitsprüfung wird geladen...'

let scriptPromise = null

/**
 * The in-flight script request `{ script, timerId, fail }`, or null when no request is pending.
 * `fail()` rejects the pending promise, so every awaiter settles instead of waiting on a request
 * that was only forgotten.
 */
let scriptAttempt = null

/**
 * Number of real script downloads started in this page. The browser deduplicates an identical
 * script URL while an earlier fetch is still pending, so a retry after a stalled request would
 * never reach the network again; every attempt after the first therefore gets its own query
 * parameter. The URL itself stays the module constant TURNSTILE_SCRIPT_SRC and never derives from
 * input.
 */
let scriptAttemptCount = 0

/**
 * How long a new attempt waits for a dropped attempt's script before it starts another download,
 * in milliseconds. Removing a <script async> element does not abort its fetch: the aborted script
 * is executed as soon as it arrives.
 */
export const TURNSTILE_ADOPT_GRACE_MS = 1000

/**
 * The Turnstile API instance this page's widgets were rendered with. Pinned to the first instance a
 * successful load delivered: a later api.js execution replaces window.turnstile together with its
 * widget registry, while the ids rendered with this instance stay valid.
 */
let turnstileApi = null

/**
 * True once a script attempt was dropped while its fetch was still in flight: that script can still
 * execute and install window.turnstile at any later moment.
 */
let lateScriptMayLand = false

/**
 * Returns the Turnstile API instance the component works with.
 * @returns {object|null} The pinned instance, whatever is installed on window, or null
 */
function getTurnstileApi(){
  if (turnstileApi) return turnstileApi
  if (typeof window === 'undefined') return null
  return window.turnstile || null
}

/**
 * Pins the first API instance a script attempt delivered, so a later api.js execution cannot
 * invalidate widget ids that were rendered with it.
 * @param {object|null} api - The instance that just finished loading
 * @returns {object|null} The pinned instance
 */
function pinTurnstileApi(api){
  if (!turnstileApi && api) turnstileApi = api
  return turnstileApi
}

/**
 * Builds an error message for Turnstile CAPTCHA failures
 * @param {string} errorCode - The error code from Turnstile
 * @returns {string} Formatted error message with host information
 */
function buildTurnstileErrorMessage(errorCode){
  const host = typeof window !== 'undefined' ? window.location.host : 'unknown-host'
  if (!errorCode) return `Captcha-Pruefung fehlgeschlagen (Host: ${host})`
  return `Captcha-Pruefung fehlgeschlagen (${errorCode}, Host: ${host})`
}

/**
 * Checks if the given site key is a placeholder value (not a real key)
 * @param {string} value - The Turnstile site key to check
 * @returns {boolean} True if the key is a placeholder or empty
 */
function isPlaceholderSiteKey(value){
  const normalized = String(value || '').trim().toLowerCase()
  return !normalized || normalized.startsWith('replace-with-your-turnstile') || normalized === 'your-turnstile-site-key'
}

/**
 * Creates a recognized error for a security check that could not be completed.
 * The message is always the user-facing German hint; code and detail are for diagnostics.
 * @param {string} code - machine readable reason (timeout, script-unavailable, challenge-error, unsupported, superseded, cancelled)
 * @param {string} [detail] - optional technical detail
 * @returns {Error} Error with name 'TurnstileFallbackError'
 */
function createTurnstileFallbackError(code, detail){
  const error = new Error(TURNSTILE_FALLBACK_MESSAGE)
  error.name = 'TurnstileFallbackError'
  error.code = code
  error.detail = detail || ''
  return error
}

/**
 * Tells whether an error was raised because the security check could not be completed.
 * Callers use this to show a hint instead of a generic failure message.
 * @param {unknown} err - The caught error
 * @returns {boolean} True for errors created by createTurnstileFallbackError
 */
export function isTurnstileFallbackError(err){
  return err?.name === 'TurnstileFallbackError'
}

/**
 * Resolves the site key the widget is rendered with.
 *
 * A configured build-time key that is not a placeholder is always returned unchanged.
 * Only when the build-time key is empty or a placeholder is an optional page-level
 * override honoured, so Playwright can enable the widget in the BYPASS_CAPTCHA E2E
 * setup. That override cannot change a configured key, and server-side verification
 * is unaffected either way.
 *
 * @returns {string} The site key to render the widget with
 */
function resolveTurnstileSiteKey(){
  const buildKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
  if (!isPlaceholderSiteKey(buildKey)) return buildKey
  if (typeof window === 'undefined') return ''
  const overrideKey = window.__ASTRONEX_E2E_TURNSTILE_SITE_KEY__
  return typeof overrideKey === 'string' ? overrideKey : ''
}

/**
 * Warns once about a fallback error for support diagnostics. The UI text stays
 * TURNSTILE_FALLBACK_MESSAGE; code and detail only reach the console.
 * @param {Error} error - Error created by createTurnstileFallbackError
 */
function warnTurnstileFallback(error){
  if (typeof console === 'undefined') return
  console.warn('[Turnstile]', error.code, error.detail)
}

/**
 * Drops a failed or aborted script attempt so the next call can load it again.
 *
 * A pending attempt is rejected instead of only being forgotten: without that rejection every
 * awaiter (mount effect, fallback effect, execute()) would wait on a request nobody will answer.
 * Does nothing once the API is available.
 */
function resetTurnstileScript(){
  if (typeof window === 'undefined') return
  // A pinned instance keeps working even after window.turnstile was replaced.
  if (getTurnstileApi()) return
  if (scriptAttempt){
    // The dropped element is not an abort: its fetch continues and may still execute.
    lateScriptMayLand = true
    scriptAttempt.fail()
  }
  scriptPromise = null
  const existing = document.getElementById(TURNSTILE_SCRIPT_ID)
  if (existing) existing.remove()
}

/**
 * Loads the Cloudflare Turnstile script dynamically.
 *
 * A failed load is never cached: the script element is removed and the promise reset, so a
 * retry (for example a second click after a content blocker was resolved) requests the script
 * again instead of reusing the rejection. No load waits longer than
 * TURNSTILE_SCRIPT_TIMEOUT_MS, so a stalled request cannot leave the fallback loading forever.
 * A retry uses a fresh query parameter, because the browser would otherwise reuse the still
 * pending fetch of the identical URL and never ask the network again.
 *
 * A late api.js is adopted instead of answered with a second download: dropping
 * an attempt does not abort its fetch, so before a retry appends its own <script> element the
 * loader waits up to TURNSTILE_ADOPT_GRACE_MS for that script to arrive and takes it over. The
 * first delivered instance is pinned in turnstileApi.
 *
 * @returns {Promise<object|null>} Promise resolving to the Turnstile API (null only without a window,
 * i.e. outside a browser); a failed load rejects
 */
function loadTurnstileScript(){
  if (typeof window === 'undefined') return Promise.resolve(null)
  const known = getTurnstileApi()
  if (known) return Promise.resolve(known)
  if (scriptPromise) return scriptPromise

  // Without a pending promise, an element with our id is a stale, failed or aborted attempt.
  const stale = document.getElementById(TURNSTILE_SCRIPT_ID)
  if (stale) stale.remove()

  scriptPromise = new Promise((resolve, reject) => {
    let settled = false
    let attempt = null
    let adoptTimerId = null

    /**
     * Resolves this attempt with an API object: the first of onload, deadline, adoption and the
     * late-arrival poll wins.
     * @param {object|null} api - The Turnstile API to resolve with
     */
    const settleWithApi = (api) => {
      if (settled) return
      settled = true
      if (adoptTimerId !== null){
        window.clearTimeout(adoptTimerId)
        adoptTimerId = null
      }
      if (attempt){
        window.clearTimeout(attempt.timerId)
        attempt.script.onload = null
        attempt.script.onerror = null
        if (scriptAttempt === attempt) scriptAttempt = null
      }
      scriptPromise = null
      resolve(pinTurnstileApi(api))
    }

    const startAttempt = () => {
      if (settled) return
      adoptTimerId = null
      scriptAttemptCount += 1
      const script = document.createElement('script')
      script.id = TURNSTILE_SCRIPT_ID
      script.src = scriptAttemptCount === 1
        ? TURNSTILE_SCRIPT_SRC
        : `${TURNSTILE_SCRIPT_SRC}&attempt=${scriptAttemptCount}`
      script.async = true
      script.defer = true

      // One settle for the whole attempt: the first of load, error and deadline wins.
      const current = { script, timerId: null, fail: null }
      attempt = current
      const fail = () => {
        if (settled) return
        settled = true
        window.clearTimeout(current.timerId)
        script.onload = null
        script.onerror = null
        if (scriptAttempt === current){
          scriptAttempt = null
          scriptPromise = null
        }
        // Remove only this attempt's own element, never a newer attempt's element by id.
        if (script.parentNode) script.parentNode.removeChild(script)
        reject(new Error('Turnstile konnte nicht geladen werden'))
      }
      current.fail = fail
      scriptAttempt = current

      script.onload = () => {
        if (window.turnstile){
          settleWithApi(window.turnstile)
          return
        }
        // For example a content blocker answering with an empty response.
        fail()
      }
      script.onerror = () => {
        fail()
      }
      // A request that neither answers nor errors (stalled proxy, Private Relay) must still settle,
      // otherwise the visible fallback waits forever.
      current.timerId = window.setTimeout(() => {
        if (window.turnstile) settleWithApi(window.turnstile)
        else {
          // The fetch is still in flight: this script can still be executed.
          lateScriptMayLand = true
          fail()
        }
      }, TURNSTILE_SCRIPT_TIMEOUT_MS)

      document.head.appendChild(script)
    }

    // A dropped attempt's api.js may be executed by the browser at any moment.
    // Give it TURNSTILE_ADOPT_GRACE_MS to arrive and adopt it, instead of starting a second
    // download that would replace window.turnstile and the widget registry.
    const waitForLateApi = lateScriptMayLand
    lateScriptMayLand = false
    if (!waitForLateApi){
      startAttempt()
      return
    }
    const adoptDeadline = Date.now() + TURNSTILE_ADOPT_GRACE_MS
    // A bounded poll of setTimeout ticks: it ends with the adoption or with the new attempt, so no
    // interval keeps running.
    const pollForLateApi = () => {
      adoptTimerId = null
      if (settled) return
      if (window.turnstile){
        settleWithApi(window.turnstile)
        return
      }
      if (Date.now() >= adoptDeadline){
        startAttempt()
        return
      }
      adoptTimerId = window.setTimeout(pollForLateApi, 50)
    }
    adoptTimerId = window.setTimeout(pollForLateApi, 50)
  })
  return scriptPromise
}

/**
 * InvisibleTurnstile - Cloudflare Turnstile CAPTCHA component for bot detection.
 *
 * The script is loaded through a single-flight loader: one attempt per page, a bounded deadline
 * (TURNSTILE_SCRIPT_TIMEOUT_MS) and a retry with a fresh query parameter. A dropped attempt does not
 * abort its fetch, so a retry first waits TURNSTILE_ADOPT_GRACE_MS for a late api.js and adopts it
 * instead of downloading a second one; the first delivered instance is pinned, so a later api.js
 * execution cannot invalidate widget ids.
 *
 * execute() never waits indefinitely: after TURNSTILE_EXECUTE_TIMEOUT_MS it rejects with a
 * TurnstileFallbackError (see isTurnstileFallbackError), so callers can show the German hint
 * and keep the form usable. A challenge error rejects the same way.
 *
 * Every execute() promise settles: each call owns its own timer and result slot, a newer call
 * rejects an older pending one with code 'superseded', and an effect cleanup (unmount or changed
 * widget parameters) rejects a pending call with code 'cancelled'.
 *
 * Whenever the invisible check fails, a visible challenge is rendered automatically below the
 * caller's hint (no extra button). Solving it reports the token through onFallbackToken, so the
 * caller can continue the pending action with the already entered data.
 *
 * The solved token is also kept in the component: a consumer takes it with takeFallbackToken()
 * (single use). After a request that was sent through the fallback failed, the consumer re-arms the
 * challenge with refreshFallback({ autoContinue: false }): the fresh challenge then asks for an
 * explicit submit and never re-sends anything on its own.
 *
 * Ref API (via `ref`): execute(), reset(), isEnabled(), isFallbackActive(), takeFallbackToken(),
 * refreshFallback({ autoContinue }), switchFallbackMode(mode).
 *
 * @component
 * @param {Object} props - Component props
 * @param {string} props.action - Action name for the CAPTCHA challenge
 * @param {Function} props.onTokenChange - Callback when token changes (receives token or empty string)
 * @param {Function} [props.onFallbackToken] - Callback invoked with the token of a solved visible fallback challenge
 * @returns {JSX.Element|null} Rendered CAPTCHA container, or null if not enabled
 */
const InvisibleTurnstile = forwardRef(function InvisibleTurnstile({ action, onTokenChange, onFallbackToken }, ref){
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  /**
   * The record of the execute() call whose result is still open, or null:
   * `{ settled, challengeIssued, timerId, deliverToken, deliverError, cancel }`.
   */
  const pendingExecuteRef = useRef(null)
  const [fallbackVisible, setFallbackVisible] = useState(false)
  const [fallbackStatus, setFallbackStatus] = useState('loading')
  /**
   * 'auto' while solving the visible challenge continues the pending request by itself,
   * 'manual' after a request sent through the fallback failed: the fresh challenge is sent only by
   * the next explicit submit, so no token issues a request on its own.
   */
  const [fallbackMode, setFallbackModeState] = useState('auto')
  const fallbackActiveRef = useRef(false)
  /**
   * True when the fallback was opened because the script request itself already failed: the
   * fallback then shows the unavailable text right away instead of starting a second, equally long
   * script request. The next explicit attempt downloads the script again.
   */
  const fallbackScriptMissingRef = useRef(false)
  const fallbackContainerRef = useRef(null)
  const fallbackWidgetIdRef = useRef(null)
  /** The last solved, not yet handed out token of the visible challenge (single use). */
  const fallbackTokenRef = useRef('')
  const onFallbackTokenRef = useRef(onFallbackToken)
  const onTokenChangeRef = useRef(onTokenChange)
  const siteKey = resolveTurnstileSiteKey()
  const enabled = !isPlaceholderSiteKey(siteKey)

  // Keep the newest handlers without rendering the widgets again on every parent render: an inline
  // callback must neither tear down a healthy widget nor cancel a pending check.
  useEffect(() => {
    onFallbackTokenRef.current = onFallbackToken
    onTokenChangeRef.current = onTokenChange
  })

  /**
   * Turns the visible fallback challenge on. Only one challenge channel is active at a time.
   * @param {boolean} [scriptMissing] - True when the Turnstile script is known not to be loaded
   */
  function activateFallback(scriptMissing = false){
    fallbackActiveRef.current = true
    fallbackScriptMissingRef.current = scriptMissing
    fallbackTokenRef.current = ''
    setFallbackModeState('auto')
    setFallbackStatus(scriptMissing ? 'unavailable' : 'loading')
    setFallbackVisible(true)
  }

  /** Turns the visible fallback challenge off again (for example before a fresh invisible attempt). */
  function deactivateFallback(){
    fallbackActiveRef.current = false
    fallbackScriptMissingRef.current = false
    fallbackTokenRef.current = ''
    setFallbackVisible(false)
  }

  /**
   * Renders the invisible widget once and remembers its id.
   * Called from the mount effect and, after a failed mount-time load, from execute().
   * @param {object} turnstile - The Turnstile API object
   */
  function renderPrimaryWidget(turnstile){
    if (widgetIdRef.current !== null || !containerRef.current) return
    widgetIdRef.current = turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action,
      size: 'invisible',
      callback: (token) => {
        onTokenChangeRef.current?.(token)
        const call = pendingExecuteRef.current
        if (call && call.challengeIssued) call.deliverToken(token)
      },
      'error-callback': (errorCode) => {
        onTokenChangeRef.current?.('')
        const call = pendingExecuteRef.current
        if (!call || !call.challengeIssued || call.settled) return
        const error = createTurnstileFallbackError('challenge-error', buildTurnstileErrorMessage(errorCode))
        warnTurnstileFallback(error)
        call.deliverError(error)
      },
      'expired-callback': () => {
        onTokenChangeRef.current?.('')
      },
      'unsupported-callback': () => {
        onTokenChangeRef.current?.('')
        const call = pendingExecuteRef.current
        if (!call || !call.challengeIssued || call.settled) return
        const error = createTurnstileFallbackError('unsupported')
        warnTurnstileFallback(error)
        call.deliverError(error)
      },
    })
  }

  useEffect(() => {
    if (!enabled || !containerRef.current) return undefined
    let cancelled = false

    loadTurnstileScript()
      .then((turnstile) => {
        if (cancelled || !turnstile || widgetIdRef.current !== null) return
        renderPrimaryWidget(turnstile)
      })
      .catch(() => {
        onTokenChangeRef.current?.('')
      })

    return () => {
      cancelled = true
      // A pending check must not be orphaned by an unmount or changed widget parameters.
      pendingExecuteRef.current?.cancel('cancelled')
      const api = getTurnstileApi()
      if (widgetIdRef.current !== null && api){
        api.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [action, enabled, siteKey])

  // Visible fallback challenge: rendered as soon as the invisible check failed.
  useEffect(() => {
    if (!fallbackVisible || !enabled || !fallbackContainerRef.current) return undefined
    // The script request already failed: no second wait, the unavailable text is final.
    if (fallbackScriptMissingRef.current) return undefined
    let cancelled = false

    loadTurnstileScript()
      .then((turnstile) => {
        if (cancelled) return
        if (fallbackWidgetIdRef.current !== null) return
        fallbackWidgetIdRef.current = turnstile.render(fallbackContainerRef.current, {
          sitekey: siteKey,
          action,
          size: 'normal',
          callback: (token) => {
            // Store before notifying: exactly one consumer can take the token (takeFallbackToken).
            fallbackTokenRef.current = token || ''
            // A delivered token proves the challenge works again after an error or an expiry.
            if (token) setFallbackStatus('ready')
            onTokenChangeRef.current?.(token)
            onFallbackTokenRef.current?.(token)
          },
          'error-callback': (errorCode) => {
            fallbackTokenRef.current = ''
            onTokenChangeRef.current?.('')
            // Same diagnostics as the invisible path, and no promise of an automatic continuation
            // above a widget that just reported an error.
            warnTurnstileFallback(createTurnstileFallbackError('fallback-challenge-error', buildTurnstileErrorMessage(errorCode)))
            setFallbackStatus('unavailable')
          },
          'expired-callback': () => {
            fallbackTokenRef.current = ''
            onTokenChangeRef.current?.('')
            setFallbackStatus('expired')
          },
        })
        setFallbackStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        // The script loader already dropped the cached failure, so Anmelden retries the download.
        setFallbackStatus('unavailable')
        onTokenChangeRef.current?.('')
      })

    return () => {
      cancelled = true
      // A token of a challenge that is being removed must never be submitted later.
      fallbackTokenRef.current = ''
      const api = getTurnstileApi()
      if (fallbackWidgetIdRef.current !== null && api){
        api.remove(fallbackWidgetIdRef.current)
      }
      fallbackWidgetIdRef.current = null
    }
  }, [fallbackVisible, action, enabled, siteKey])

  useImperativeHandle(ref, () => ({
    async execute(){
      if (!enabled) return null
      // A new attempt always retries the invisible check first.
      if (fallbackActiveRef.current) deactivateFallback()
      return new Promise((resolve, reject) => {
        const call = {
          settled: false,
          challengeIssued: false,
          timerId: null,
          deliverToken: null,
          deliverError: null,
          cancel: null,
        }
        const settle = (fn, value) => {
          if (call.settled) return
          call.settled = true
          if (call.timerId !== null){
            window.clearTimeout(call.timerId)
            call.timerId = null
          }
          const isCurrent = pendingExecuteRef.current === call
          if (isCurrent) pendingExecuteRef.current = null
          // Any reason the invisible check could not finish opens the visible fallback — but a
          // superseded call never reopens the fallback that the newer call just closed, and a
          // cancelled one (effect cleanup on unmount) belongs to a component that is going away
          //. The rejection itself keeps its diagnostics.
          if (isCurrent && isTurnstileFallbackError(value) && value?.code !== 'cancelled') activateFallback(!getTurnstileApi())
          fn(value)
        }
        const failWith = (code, detail) => {
          const error = createTurnstileFallbackError(code, detail)
          warnTurnstileFallback(error)
          return error
        }

        call.deliverToken = (token) => settle(resolve, token)
        call.deliverError = (error) => settle(reject, error)
        call.cancel = (code) => {
          if (call.settled) return
          settle(reject, failWith(code))
        }

        // A newer call rejects an older pending one instead of orphaning it.
        const previous = pendingExecuteRef.current
        pendingExecuteRef.current = call
        if (previous && !previous.settled) previous.cancel('superseded')

        call.timerId = window.setTimeout(() => {
          if (call.settled) return
          // A script request that never answered must not be reused by the next attempt.
          if (!getTurnstileApi()) resetTurnstileScript()
          settle(reject, failWith('timeout'))
        }, TURNSTILE_EXECUTE_TIMEOUT_MS)

        loadTurnstileScript()
          .then((turnstile) => {
            if (call.settled) return
            try {
              if (widgetIdRef.current === null) renderPrimaryWidget(turnstile)
              if (widgetIdRef.current === null){
                settle(reject, failWith('script-unavailable'))
                return
              }
              // From here on the widget callbacks may deliver this call's result.
              call.challengeIssued = true
              turnstile.reset(widgetIdRef.current)
              turnstile.execute(widgetIdRef.current)
            }catch(error){
              settle(reject, failWith('script-unavailable', error?.message))
            }
          })
          .catch(() => {
            if (call.settled) return
            settle(reject, failWith('script-unavailable'))
          })
      })
    },
    reset(){
      const api = getTurnstileApi()
      if (!enabled || widgetIdRef.current === null || !api) return
      api.reset(widgetIdRef.current)
      onTokenChangeRef.current?.('')
    },
    isEnabled(){
      return enabled
    },
    /**
     * Tells whether the visible fallback challenge is currently offered.
     * @returns {boolean} True while the fallback area is shown
     */
    isFallbackActive(){
      return fallbackActiveRef.current
    },
    /**
     * Hands out the last solved token of the visible fallback challenge and clears it.
     * Single use: a Turnstile token is consumed by the request it is sent with, so the next caller
     * gets an empty string instead of a stale value.
     * @returns {string} The stored token, or '' when no fresh challenge was solved
     */
    takeFallbackToken(){
      const token = fallbackTokenRef.current
      fallbackTokenRef.current = ''
      return token
    },
    /**
     * Requests a fresh single-use token from the visible fallback challenge.
     *
     * `autoContinue` tells the component whether the caller continues the pending request
     * automatically on the next token ('auto', TURNSTILE_FALLBACK_INSTRUCTION) or waits for an
     * explicit submit ('manual', TURNSTILE_FALLBACK_MANUAL_INSTRUCTION). The result tells the
     * caller whether a fresh challenge was really requested; the method never throws.
     *
     * @param {{ autoContinue?: boolean }} [options] - autoContinue defaults to true
     * @returns {boolean} True when a fresh challenge was requested from a ready widget
     */
    refreshFallback({ autoContinue = true } = {}){
      if (!fallbackActiveRef.current) return false
      // Set even without a ready widget: a challenge that becomes ready later must not promise an
      // automatic continuation the caller has just given up.
      setFallbackModeState(autoContinue ? 'auto' : 'manual')
      const api = getTurnstileApi()
      if (fallbackWidgetIdRef.current === null || !api) return false
      fallbackTokenRef.current = ''
      try{
        api.reset(fallbackWidgetIdRef.current)
        // The reset challenge is fresh, so the text of the previous error or expiry must not stay
        // above it.
        setFallbackStatus('ready')
        return true
      }catch{
        // A widget that cannot be reset is unusable for the next attempt; say so instead of
        // promising a challenge that will not appear.
        setFallbackStatus('unavailable')
        return false
      }
    },
    /**
     * Switches the visible fallback between automatic continuation and an explicit submit without
     * requesting a new challenge: a half-solved challenge survives a keystroke, no token is thrown
     * away by a reset.
     *
     * @param {'auto'|'manual'} mode - Any other value falls back to 'auto'
     * @returns {boolean} True when a visible fallback was shown and its mode was switched
     */
    switchFallbackMode(mode){
      if (!fallbackActiveRef.current) return false
      setFallbackModeState(mode === 'manual' ? 'manual' : 'auto')
      return true
    },
  }), [enabled, action, siteKey])

  if (!enabled) return null
  return (
    <>
      <div ref={containerRef} style={{ minHeight: 1 }} />
      {fallbackVisible && (
        <div data-testid="turnstile-fallback" data-state={fallbackStatus} data-mode={fallbackMode} style={{ marginTop: 8 }}>
          <p aria-live="polite" style={{ margin: '4px 0' }}>
            {fallbackStatus === 'unavailable'
              ? TURNSTILE_FALLBACK_UNAVAILABLE_TEXT
              : fallbackStatus === 'expired'
                ? TURNSTILE_FALLBACK_EXPIRED_TEXT
                : fallbackStatus === 'loading'
                  ? TURNSTILE_FALLBACK_LOADING_TEXT
                  : fallbackMode === 'manual'
                    ? TURNSTILE_FALLBACK_MANUAL_INSTRUCTION
                    : TURNSTILE_FALLBACK_INSTRUCTION}
          </p>
          <div ref={fallbackContainerRef} />
        </div>
      )}
    </>
  )
})

export default InvisibleTurnstile
