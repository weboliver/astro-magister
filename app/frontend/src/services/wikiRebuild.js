/**
 * wikiRebuild.js - client half of the CMS rebuild hint.
 *
 * The server owns the truth: `GET /wiki/content-stamp` answers the newest change stamp of
 * the wiki content. The CMS only remembers the stamp the admin already acknowledged in
 * `localStorage` and compares **values** — a boolean flag would stay silent forever after
 * the first acknowledgement, because a later cover change could not raise it again.
 *
 * This module is plain JavaScript and has no JSX on purpose: it must stay importable without
 * a bundler.
 *
 * @module wikiRebuild
 */

import { get } from './api'

/** `localStorage` key holding the stamp the admin already acknowledged. */
export const REBUILD_ACK_KEY = 'astronex-wiki-rebuild-ack'

/** `window` event fired after a successful change report, so the hint can update without reload. */
export const WIKI_CONTENT_CHANGED_EVENT = 'astronex:wiki-content-changed'

/**
 * Reads the acknowledged stamp.
 *
 * @returns {string} The stored stamp, `''` when nothing was acknowledged yet
 */
export function readAckedStamp(){
  if (typeof window === 'undefined') return ''
  try{
    return window.localStorage.getItem(REBUILD_ACK_KEY) || ''
  }catch(_){
    return ''
  }
}

/**
 * Stores the stamp the admin just acknowledged.
 *
 * @param {(string|null|undefined)} stamp - Stamp to store; `null`/empty is a no-op
 * @returns {void}
 */
export function acknowledgeRebuild(stamp){
  if (!stamp) return
  if (typeof window === 'undefined') return
  try{
    window.localStorage.setItem(REBUILD_ACK_KEY, String(stamp))
  }catch(_){
    // Ein nicht beschreibbarer Speicher darf die Quittung nicht in einen Fehler verwandeln.
  }
}

/**
 * Announces a new content stamp to every listener in this tab.
 *
 * @param {(string|null|undefined)} stamp - New server stamp; empty values are not announced
 * @returns {void}
 */
export function notifyWikiContentChanged(stamp){
  if (!stamp) return
  if (typeof window === 'undefined') return
  window.dispatchEvent(new window.CustomEvent(WIKI_CONTENT_CHANGED_EVENT, { detail: { stamp } }))
}

/**
 * Fetches the current server stamp and announces it.
 *
 * A failure is logged and swallowed: it must never turn a successful save into an error
 * (the hint simply appears on the next successful fetch).
 *
 * @returns {Promise<(string|null)>} The stamp, or `null` when the request failed
 */
export async function refreshRebuildStamp(){
  try{
    const resp = await get('/wiki/content-stamp')
    if (!resp.ok){
      console.warn(`[wikiRebuild] Änderungsstempel konnte nicht geladen werden (${resp.status})`)
      return null
    }
    const data = await resp.json()
    const stamp = data?.stamp || null
    notifyWikiContentChanged(stamp)
    return stamp
  }catch(err){
    console.warn('[wikiRebuild] Änderungsstempel konnte nicht geladen werden:', err)
    return null
  }
}
