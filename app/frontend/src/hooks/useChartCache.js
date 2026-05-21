/**
 * useChartCache.js - Chart graphic cache, auto-fetch, blob URL lifecycle hook
 * @module useChartCache
 * @description Encapsulates the chart graphic cache and fetch logic shared by
 *              Horoscope.jsx and Mondknoten.jsx. Provides fetchGraphic as a
 *              building block; pages wire it into their own useEffect.
 *              The auto-fetch useEffect remains page-specific because the guard
 *              logic (checking payload sync with source person) is page-specific.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { postWithSignal } from '../services/api'

/** Module-level cache shared across all component instances using this hook. */
const _chartCache = new Map()

/**
 * React hook providing chart graphic cache management, auto-fetch capability,
 * and blob URL lifecycle management.
 *
 * @param {object} options
 * @param {string} options.graphicEndpointPath - API endpoint for graphic (e.g. '/horoscope/graphic')
 * @param {string} options.cacheKeyPrefix - Namespace prefix for cache key isolation (e.g. 'horoscope')
 * @returns {object} Full chart cache interface
 */
export function useChartCache({ graphicEndpointPath, cacheKeyPrefix }) {
  const [chartImage, setChartImage] = useState(null)
  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState('')

  const chartCacheRef = useRef(_chartCache)
  const graphicAbortRef = useRef(null)
  const activeChartCacheKeyRef = useRef(null)
  const imageUrlRef = useRef(null)

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Revokes a previous blob URL after a 500ms delay, skipping the revoke
   * if the URL is still the currently active one.
   */
  const revokeObjectUrlLater = useCallback((url) => {
    if (!url || typeof window === 'undefined') return
    const candidate = url
    window.setTimeout(() => {
      try {
        if (imageUrlRef.current === candidate) {
          console.debug('[useChartCache] skip revoke of active URL')
          return
        }
        URL.revokeObjectURL(candidate)
        console.debug('[useChartCache] revoked object URL')
      } catch (e) {
        console.debug('[useChartCache] revoke failed', e)
      }
    }, 500)
  }, [])

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Sets chartImage from a blob, manages blob URL lifecycle. */
  const displayChartBlob = useCallback((blob) => {
    const previousUrl = imageUrlRef.current
    const url = URL.createObjectURL(blob)
    imageUrlRef.current = url
    setChartImage(url)
    revokeObjectUrlLater(previousUrl)
  }, [revokeObjectUrlLater])

  /**
   * Computes the ideal graphic render size, capped at 1200px.
   * Scaled by devicePixelRatio for crisp rendering on HiDPI displays.
   */
  const computeGraphicSize = useCallback(() => {
    const ratio = (typeof window !== 'undefined' && window.devicePixelRatio)
      ? window.devicePixelRatio
      : 1
    return Math.min(1200, Math.round(750 * Math.max(1, ratio)))
  }, [])

  /**
   * Computes a deterministic cache key for a given payload and render size.
   */
  const computeCacheKey = useCallback((payload, size) => {
    const subjectId = payload.person_id || 'manual'
    return JSON.stringify({
      type: cacheKeyPrefix,
      subjectId,
      ...payload,
      width: size,
      height: size,
    })
  }, [cacheKeyPrefix])

  /**
   * Fetches the chart graphic from the backend, caching the result.
   * Handles abort, cache-hit, and stale-response detection.
   *
   * @param {object} payload - Request payload (person data, coordinates, etc.)
   */
  const fetchGraphic = useCallback(async (payload) => {
    // Abort any previous in-flight request
    try {
      if (graphicAbortRef.current) graphicAbortRef.current.abort()
    } catch (_) { /* ignore */ }

    const controller = new AbortController()
    graphicAbortRef.current = controller

    setImageLoading(true)
    setImageError('')

    try {
      const size = computeGraphicSize()
      const cacheKey = computeCacheKey(payload, size)

      // Cache hit
      const cached = chartCacheRef.current.get(cacheKey)
      if (cached) {
        displayChartBlob(cached.blob)
        activeChartCacheKeyRef.current = cacheKey
        graphicAbortRef.current = null
        return
      }

      // Cache miss — fetch from backend
      console.debug('[useChartCache] fetchGraphic start', {
        cacheKey,
        endpoint: graphicEndpointPath,
      })

      const graphicResp = await postWithSignal(
        `${graphicEndpointPath}?width=${size}&height=${size}`,
        payload,
        controller.signal,
      )

      if (!graphicResp.ok) {
        throw new Error(`Graphic request failed (${graphicResp.status})`)
      }

      const blob = await graphicResp.blob()
      chartCacheRef.current.set(cacheKey, { blob })

      // Only display if the request still matches current state (stale guard)
      const currentKey = computeCacheKey(payload, size)
      if (currentKey === cacheKey) {
        console.debug('[useChartCache] fetchGraphic display', { cacheKey })
        displayChartBlob(blob)
        activeChartCacheKeyRef.current = cacheKey
      } else {
        console.debug('[useChartCache] fetchGraphic dropped display (stale)', {
          cacheKey,
          currentKey,
        })
      }

      graphicAbortRef.current = null
    } catch (err) {
      if (err.name === 'AbortError') {
        console.debug('[useChartCache] fetchGraphic aborted')
      } else {
        setImageError(err.message || 'Graphic konnte nicht geladen werden')
      }
    } finally {
      setImageLoading(false)
    }
  }, [graphicEndpointPath, computeGraphicSize, computeCacheKey, displayChartBlob])

  /**
   * Clears the module-level cache, resets all state, revokes blob URLs.
   * Called on logout to prevent data leakage between sessions.
   */
  const handleLogoutCleanup = useCallback(() => {
    const previousUrl = imageUrlRef.current
    chartCacheRef.current.clear()
    setChartImage(null)
    setImageError('')
    activeChartCacheKeyRef.current = null
    imageUrlRef.current = null
    revokeObjectUrlLater(previousUrl)
  }, [revokeObjectUrlLater])

  // ---------------------------------------------------------------------------
  // Cleanup on unmount
  // ---------------------------------------------------------------------------

  useEffect(() => {
    return () => {
      if (imageUrlRef.current) {
        URL.revokeObjectURL(imageUrlRef.current)
      }
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Public interface
  // ---------------------------------------------------------------------------

  return {
    chartImage,
    setChartImage,
    imageLoading,
    setImageLoading,
    imageError,
    setImageError,
    displayChartBlob,
    computeGraphicSize,
    computeCacheKey,
    chartCacheRef,
    graphicAbortRef,
    activeChartCacheKeyRef,
    imageUrlRef,
    handleLogoutCleanup,
    fetchGraphic,
  }
}
