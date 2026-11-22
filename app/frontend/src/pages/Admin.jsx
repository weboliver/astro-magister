/**
 * Admin - Multi-tab admin dashboard for managing users, sections, categories, entries, relations, pages, audit logs, and Redis cache/overview.
 *
 * Der aktive Tab ist keine Komponenten-Wahrheit mehr, sondern ein Pfadsegment (`/admin/:tab`).
 * Ein unbekannter Tab und der Einstieg ohne Tab landen per `replace` auf `/admin/users`, damit
 * pro Zustand genau eine Adresse existiert. Tab-Klicks sind normale
 * Navigationen (push), damit „Zurück" den Tab wechselt.
 *
 * Der Editor-Sprung aus dem Wiki ist ebenfalls URL-Zustand: `/admin/entries?entry=<id>`. Den
 * Eintrag lädt die Seite über `GET /wiki/entries/{id}` nach; die Anfrage an den Tab trägt den
 * Merker `requestedAt`, damit ein zweiter Sprung auf denselben Eintrag erneut öffnet.
 *
 * @component
 * @returns {JSX.Element} Rendered admin page component
 * @hook useParams - Tab-ID aus dem Pfad
 * @hook useSearchParams - optionale Eintrags-ID für den Editor-Sprung
 * @hook useNavigate - Tab-Wechsel und Editor-Sprung als Navigation
 * @hook useState - Editor-Anfrage, geladen aus dem `?entry=`-Parameter
 * @hook useEffect - lädt den Eintrag bei geändertem `?entry=` nach
 */
import React, { useEffect, useState } from 'react'
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router'
import { get } from '../services/api'
import AdminAuditLogTab from '../components/admin/AdminAuditLogTab'
import AdminCacheTab from '../components/admin/AdminCacheTab'
import AdminCategoriesTab from '../components/admin/AdminCategoriesTab'
import AdminEinstellungenTab from '../components/admin/AdminEinstellungenTab'
import AdminEntriesTab from '../components/admin/AdminEntriesTab'
import AdminHomeCurationTab from '../components/admin/AdminHomeCurationTab'
import AdminOverviewTab from '../components/admin/AdminOverviewTab'
import AdminPagesTab from '../components/admin/AdminPagesTab'
import AdminRebuildHint from '../components/admin/AdminRebuildHint'
import AdminRelationsTab from '../components/admin/AdminRelationsTab'
import AdminSectionsTab from '../components/admin/AdminSectionsTab'
import AdminUsersTab from '../components/admin/AdminUsersTab'

const tabs = [
  { id: 'users', label: 'Benutzer' },
  { id: 'sections', label: 'Bereiche' },
  { id: 'categories', label: 'Kategorien' },
  { id: 'entries', label: 'Beiträge' },
  { id: 'startseite', label: 'Startseite' },
  { id: 'relations', label: 'Relationen' },
  { id: 'pages', label: 'Seiten' },
  { id: 'audit', label: 'Audit Log' },
  { id: 'overview', label: 'Redis Übersicht' },
  { id: 'cache', label: 'Redis Cache' },
  { id: 'einstellungen', label: 'Einstellungen' }
]

// Whitelist gegen die elf bestehenden Tab-IDs: die Adresse wählt nur einen Namen aus
// dieser Liste, nie eine Komponente.
const TAB_IDS = new Set(tabs.map((tab) => tab.id))
const DEFAULT_TAB = 'users'

/**
 * Liest die Eintrags-ID aus `?entry=` und akzeptiert nur eine positive Ganzzahl.
 * @param {URLSearchParams} searchParams - Suchparameter der aktuellen Adresse
 * @returns {number} Eintrags-ID oder 0, wenn kein brauchbarer Parameter vorliegt
 */
function readEntryId(searchParams){
  const raw = searchParams.get('entry')
  if (!raw) return 0
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0
}

export default function Admin(){
  const { tab } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [entryEditRequest, setEntryEditRequest] = useState(null)
  const [entryLoadError, setEntryLoadError] = useState('')

  // Ein **fehlender** Tab ist ein eigener Zustand neben „unbekannter Tab": `tab ?? DEFAULT_TAB`
  // hätte `/admin` stillschweigend als Benutzer-Tab gerendert, ohne die Adresse zu korrigieren —
  // dann gäbe es zwei URLs für denselben Zustand. Beide Fälle laufen deshalb
  // durch dieselbe Weiterleitung weiter unten.
  const tabIsKnown = tab !== undefined && TAB_IDS.has(tab)
  const activeTab = tabIsKnown ? tab : DEFAULT_TAB
  const entryId = readEntryId(searchParams)

  // Der Editor-Sprung hängt an der Adresse, nicht an einem Event-Payload: ändert sich `?entry=`,
  // wird der Eintrag neu geladen. `active` bricht einen überholten Lauf ab (Muster aus
  // `WikiPageShortcut.jsx`). Der Admin-Guard (`access: 'admin'`) hat vorher schon durchgelassen;
  // die Datenhoheit bleibt beim Server.
  useEffect(() => {
    if (!tabIsKnown || activeTab !== 'entries' || entryId <= 0) {
      setEntryEditRequest(null)
      setEntryLoadError('')
      return undefined
    }

    let active = true
    setEntryLoadError('')

    async function loadEntry(){
      try{
        const resp = await get('/wiki/entries/' + entryId)
        if (!resp.ok) throw new Error(`Beitrag konnte nicht geladen werden (${resp.status})`)
        const data = await resp.json()
        if (!active) return
        setEntryEditRequest({ entry: data, requestedAt: Date.now() })
      }catch(err){
        if (!active) return
        setEntryEditRequest(null)
        setEntryLoadError(err?.message || 'Beitrag konnte nicht geladen werden')
      }
    }

    loadEntry()
    return () => {
      active = false
    }
  }, [entryId, activeTab, tabIsKnown])

  function openEntryEditor(entry){
    if (!entry?.entry_id) return
    navigate('/admin/entries?entry=' + entry.entry_id)
  }

  const activeTabContent = (() => {
    if (activeTab === 'users') return <AdminUsersTab />
    if (activeTab === 'sections') return <AdminSectionsTab />
    if (activeTab === 'categories') return <AdminCategoriesTab />
    if (activeTab === 'entries') {
      return (
        <>
          {entryLoadError ? <div className="admin-message admin-error" role="alert">{entryLoadError}</div> : null}
          <AdminEntriesTab entryEditRequest={entryEditRequest} />
        </>
      )
    }
    if (activeTab === 'einstellungen') return <AdminEinstellungenTab />
    if (activeTab === 'startseite') return <AdminHomeCurationTab />
    if (activeTab === 'relations') return <AdminRelationsTab onEditEntry={openEntryEditor} />
    if (activeTab === 'pages') return <AdminPagesTab onEditEntry={openEntryEditor} />
    if (activeTab === 'audit') return <AdminAuditLogTab />
    if (activeTab === 'cache') return <AdminCacheTab />
    return <AdminOverviewTab />
  })()

  // Unbekannter Tab und `/admin` ohne Tab führen an dieselbe Stelle: die Weiterleitung lebt genau
  // einmal hier, nicht zusätzlich als Route in `routes.jsx`.
  if (!tabIsKnown) return <Navigate to="/admin/users" replace />

  return (
    <div className="admin-page">
      <div className="admin-tabs" role="tablist" aria-label="Admin Bereiche">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            className={activeTab === t.id ? 'admin-tab admin-tab-active' : 'admin-tab'}
            onClick={() => navigate('/admin/' + t.id, { preventScrollReset: true, state: { keepFocus: true } })}
          >
            {t.label}
          </button>
        ))}
      </div>
      {/* Genau eine Mount-Stelle: der Hinweis steht zwischen Tab-Leiste und Inhalt und
          ist damit auf jedem Admin-Tab sichtbar, bis er quittiert oder gebaut wurde. */}
      <AdminRebuildHint />
      {activeTabContent}
    </div>
  )
}
