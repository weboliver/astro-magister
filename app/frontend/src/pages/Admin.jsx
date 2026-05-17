/**
 * Admin - Multi-tab admin dashboard for managing users, sections, categories, entries, relations, pages, audit logs, and Redis cache/overview.
 * @component
 * @param {Object} props - Component props
 * @param {string} [props.initialActiveTab='users'] - Initial active tab ID
 * @param {Object} [props.initialEntryEditRequest=null] - Initial request to edit an entry
 * @returns {JSX.Element} Rendered admin page component
 * @hook useState - Manages active tab, entry edit request
 * @hook useEffect - Initializes active tab from props
 */
import React, { useEffect, useState } from 'react'
import AdminAuditLogTab from '../components/admin/AdminAuditLogTab'
import AdminCacheTab from '../components/admin/AdminCacheTab'
import AdminCategoriesTab from '../components/admin/AdminCategoriesTab'
import AdminEntriesTab from '../components/admin/AdminEntriesTab'
import AdminOverviewTab from '../components/admin/AdminOverviewTab'
import AdminPagesTab from '../components/admin/AdminPagesTab'
import AdminRelationsTab from '../components/admin/AdminRelationsTab'
import AdminSectionsTab from '../components/admin/AdminSectionsTab'
import AdminUsersTab from '../components/admin/AdminUsersTab'

const tabs = [
  { id: 'users', label: 'Benutzer' },
  { id: 'sections', label: 'Bereiche' },
  { id: 'categories', label: 'Kategorien' },
  { id: 'entries', label: 'Beiträge' },
  { id: 'relations', label: 'Relationen' },
  { id: 'pages', label: 'Seiten' },
  { id: 'audit', label: 'Audit Log' },
  { id: 'overview', label: 'Redis Übersicht' },
  { id: 'cache', label: 'Redis Cache' }
]

export default function Admin({ initialActiveTab = 'users', initialEntryEditRequest = null }){
  const [activeTab, setActiveTab] = useState(initialEntryEditRequest ? 'entries' : initialActiveTab)
  const [entryEditRequest, setEntryEditRequest] = useState(initialEntryEditRequest)

  useEffect(() => {
    if (initialEntryEditRequest) {
      setEntryEditRequest(initialEntryEditRequest)
      setActiveTab('entries')
      return
    }
    if (initialActiveTab) {
      setActiveTab(initialActiveTab)
    }
  }, [initialActiveTab, initialEntryEditRequest])

  function openEntryEditor(entry){
    setEntryEditRequest({
      entry,
      requestedAt: Date.now(),
    })
    setActiveTab('entries')
  }

  const activeTabContent = (() => {
    if (activeTab === 'users') return <AdminUsersTab />
    if (activeTab === 'sections') return <AdminSectionsTab />
    if (activeTab === 'categories') return <AdminCategoriesTab />
    if (activeTab === 'entries') return <AdminEntriesTab entryEditRequest={entryEditRequest} />
    if (activeTab === 'relations') return <AdminRelationsTab onEditEntry={openEntryEditor} />
    if (activeTab === 'pages') return <AdminPagesTab onEditEntry={openEntryEditor} />
    if (activeTab === 'audit') return <AdminAuditLogTab />
    if (activeTab === 'cache') return <AdminCacheTab />
    return <AdminOverviewTab />
  })()

  return (
    <div className="admin-page">
      <div className="admin-tabs" role="tablist" aria-label="Admin Bereiche">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'admin-tab admin-tab-active' : 'admin-tab'}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {activeTabContent}
    </div>
  )
}