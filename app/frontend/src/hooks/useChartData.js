/**
 * useChartData.js - Datenkästchen zu einem Chart (CHART-01, D-11…D-16)
 * @module useChartData
 * @description Lädt die einem gerenderten Chart zugrundeliegenden Daten erst beim ersten
 *              Öffnen und hält sie in einer modulweiten In-Memory-Map. `open`, `data`,
 *              `error` und `loading` sind aus dem aktuellen `cacheKey` **abgeleitet** (kein
 *              `useState`), damit beim Payload-Wechsel nie — auch nicht für ein gemaltes
 *              Frame — ein offener Kasten mit alten Daten neben einem neuen Chart steht (D-06).
 *              Die Abruf-Wirkung hängt ausschließlich am abgeleiteten `cacheKey`; den Payload
 *              liest sie über `payloadRef`, damit die Objekt-Identität des Aufrufers
 *              (Inline-Objekt statt `useMemo`) keinen Abort-Zyklus auslösen kann (WR-03).
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { postWithSignal } from '../services/api'
import { useLogoutCleanup } from '../utils/logoutCache'

/** Modulweiter Cache: ein Chart-Payload, ein Eintrag. Kein `sessionStorage`, kein `localStorage` (T-43.1-04). */
const _chartDataCache = new Map()

// Modulweit, nicht im Hook: `useLogoutCleanup` lauscht nur, solange eine Auswertungsseite
// gemountet ist, und `AuthContext.handleUnauthenticated` meldet sich ohne Seiten-Reload ab (D-13).
if (typeof window !== 'undefined') {
  window.addEventListener('astronexLogout', () => _chartDataCache.clear())
}

/**
 * @param {object} options
 * @param {string} [options.chartType] - Chart-Art für `/chart-data/{chart_type}`
 * @param {object} [options.payload] - Payload des gerenderten Charts
 * @returns {{open: boolean, toggle: Function, close: Function, data: object|null,
 *            loading: boolean, error: boolean, retry: Function}}
 */
export function useChartData({ chartType, payload }) {
  const cacheKey = chartType && payload ? JSON.stringify({ type: chartType, payload }) : null
  const [openKey, setOpenKey] = useState(null)
  const [failedKey, setFailedKey] = useState(null)
  const [, setLoadedCount] = useState(0)

  // Der Payload wird über eine Ref gelesen: `cacheKey` serialisiert `{ type, payload }`
  // bereits vollständig, also ist die Objekt-Identität des Payloads für den Abruf irrelevant.
  const payloadRef = useRef(payload)
  payloadRef.current = payload

  const open = cacheKey !== null && openKey === cacheKey
  const data = open ? (_chartDataCache.get(cacheKey) ?? null) : null
  const error = open && failedKey === cacheKey
  const loading = open && !data && !error

  // Ohne dieses Zurücksetzen öffnete die Rückkehr zum vorigen Payload den Kasten wieder.
  useEffect(() => {
    setOpenKey(null)
    setFailedKey(null)
  }, [cacheKey])

  useEffect(() => {
    if (!loading) return undefined
    const controller = new AbortController()
    postWithSignal(`/chart-data/${chartType}`, payloadRef.current, controller.signal)
      .then(async (resp) => {
        if (!resp.ok) throw new Error(`Chart-Daten: ${resp.status}`)
        _chartDataCache.set(cacheKey, await resp.json())
        setLoadedCount((count) => count + 1)
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setFailedKey(cacheKey)
      })
    return () => controller.abort()
    // `chartType` und `payload` stecken bereits im `cacheKey` (Zeile 32) — sie hier erneut
    // zu listen, hinge die Wirkung wieder an der Objekt-Identität des Payloads (WR-03).
  }, [loading, cacheKey])

  const close = useCallback(() => setOpenKey(null), [])
  const toggle = useCallback(() => {
    setFailedKey(null)
    setOpenKey((current) => (current === cacheKey ? null : cacheKey))
  }, [cacheKey])
  const retry = useCallback(() => setFailedKey(null), [])

  useLogoutCleanup(close)

  return { open, toggle, close, data, loading, error, retry }
}
