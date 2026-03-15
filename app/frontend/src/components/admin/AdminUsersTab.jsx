import React, { useEffect, useState } from 'react'
import { del, get, post, put } from '../../services/api'

function formatTimestamp(value){
  if (!value) return 'Unbekannt'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export default function AdminUsersTab(){
  const [users, setUsers] = useState([])
  const [userQuery, setUserQuery] = useState('')
  const [selectedUser, setSelectedUser] = useState(null)
  const [userLoading, setUserLoading] = useState(false)
  const [userError, setUserError] = useState('')
  const [userSuccess, setUserSuccess] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [roles, setRoles] = useState([])
  const [cleanupLoading, setCleanupLoading] = useState(false)

  async function loadUsers(){
    setUserLoading(true)
    setUserError('')
    try{
      const params = new URLSearchParams()
      if (userQuery) params.set('query', String(userQuery))
      const resp = await get(`/auth/users?${params.toString()}`)
      if (!resp.ok) throw new Error(`Users konnten nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      setUsers(data)
    }catch(err){
      setUserError(err?.message || 'Users konnten nicht geladen werden')
    }finally{
      setUserLoading(false)
    }
  }

  async function loadRoles(){
    try{
      const resp = await get('/auth/roles')
      if (!resp.ok) throw new Error(`Rollen konnten nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      setRoles(Array.isArray(data) ? data : [])
    }catch(_){
      setRoles([])
    }
  }

  function getRoleLabel(roleId){
    const role = roles.find((entry) => Number(entry.role_id) === Number(roleId))
    if (role?.role_name) return role.role_name
    if (roleId === null || roleId === undefined || roleId === '') return 'Keine Rolle'
    return `Rolle ${roleId}`
  }

  function handleUserSearchKeyDown(event){
    if (event.key !== 'Enter') return
    event.preventDefault()
    loadUsers()
  }

  function selectUserForEdit(user){
    setSelectedUser(user)
    setUserSuccess('')
    setNewPassword('')
  }

  async function saveUser(){
    if (!selectedUser) return
    setUserLoading(true)
    setUserError('')
    setUserSuccess('')
    try{
      const payload = { username: selectedUser.username, role_id: selectedUser.role_id, isadmin: selectedUser.isadmin, is_poweruser: selectedUser.is_poweruser }
      const resp = await put(`/auth/users/${selectedUser.id}`, payload)
      if (!resp.ok) throw new Error(`Update fehlgeschlagen (${resp.status})`)
      await loadUsers()
      setUserSuccess('Benutzer aktualisiert')
    }catch(err){
      setUserError(err?.message || 'Benutzer konnte nicht aktualisiert werden')
    }finally{
      setUserLoading(false)
    }
  }

  async function setUserPassword(){
    if (!selectedUser || !newPassword) return
    setUserLoading(true)
    setUserError('')
    setUserSuccess('')
    try{
      const resp = await post(`/auth/users/${selectedUser.id}/password`, { new_password: newPassword })
      if (!resp.ok) throw new Error(`Passwort konnte nicht gesetzt werden (${resp.status})`)
      setUserSuccess('Passwort gesetzt')
      setNewPassword('')
    }catch(err){
      setUserError(err?.message || 'Passwort konnte nicht gesetzt werden')
    }finally{
      setUserLoading(false)
    }
  }

  async function deleteUser(userId){
    if (!window.confirm('Benutzer wirklich löschen?')) return
    setUserLoading(true)
    setUserError('')
    setUserSuccess('')
    try{
      const resp = await del(`/auth/users/${userId}`)
      if (!resp.ok) throw new Error(`Löschen fehlgeschlagen (${resp.status})`)
      await loadUsers()
      setUserSuccess('Benutzer gelöscht')
      if (selectedUser && selectedUser.id === userId) setSelectedUser(null)
    }catch(err){
      setUserError(err?.message || 'Benutzer konnte nicht gelöscht werden')
    }finally{
      setUserLoading(false)
    }
  }

  async function deleteOldUsersWithEmptyProfiles(){
    if (cleanupLoading) return
    const confirmed = window.confirm('Alle Benutzer loeschen, die aelter als 1 Monat sind und noch kein Geburtsjahr im Profil haben? Dieser Vorgang kann nicht rueckgaengig gemacht werden.')
    if (!confirmed) return

    setCleanupLoading(true)
    setUserError('')
    setUserSuccess('')
    try{
      const resp = await del('/auth/users/cleanup-empty-profile?older_than_months=1')
      if (!resp.ok) throw new Error(`Bereinigung fehlgeschlagen (${resp.status})`)
      const data = await resp.json()
      const deletedCount = Number.parseInt(data.deleted_count, 10) || 0
      await loadUsers()
      setSelectedUser(null)
      setUserSuccess(`${deletedCount} Benutzer ohne ausgefuelltes Profil wurden entfernt.`)
    }catch(err){
      setUserError(err?.message || 'Benutzer konnten nicht bereinigt werden')
    }finally{
      setCleanupLoading(false)
    }
  }

  useEffect(() => {
    loadRoles()
  }, [])

  return (
    <section className="admin-panel" aria-label="Benutzerverwaltung">
      <div className="admin-panel-header">
        <div>
          <h3>Benutzerverwaltung</h3>
          <p>Suchen, bearbeiten oder löschen von registrierten Benutzern.</p>
        </div>
        <div className="admin-action-group">
          <button type="button" className="admin-secondary-button settings-danger-button" onClick={deleteOldUsersWithEmptyProfiles} disabled={userLoading || cleanupLoading}>{cleanupLoading ? 'Lösche...' : 'Leere Profile > 1 Monat löschen'}</button>
          <button type="button" className="admin-secondary-button" onClick={loadUsers} disabled={userLoading}>{userLoading ? 'Lade...' : 'Suchen'}</button>
        </div>
      </div>

      <div className="admin-toolbar">
        <label className="admin-field">
          <span>Suche</span>
          <input value={userQuery} onChange={(event) => setUserQuery(event.target.value)} onKeyDown={handleUserSearchKeyDown} />
        </label>
      </div>

      {userError ? <div className="admin-message admin-error">{userError}</div> : null}
      {userSuccess ? <div className="admin-message admin-success">{userSuccess}</div> : null}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 320px' }}>
          <div className="admin-cache-grid">
            {users.map((user) => (
              <article key={`user-${user.id}`} className="admin-cache-card">
                <header className="admin-cache-card-header">
                  <strong>{user.username}</strong>
                  <span>{user.isadmin ? 'Admin' : user.is_poweruser ? 'Poweruser' : 'User'}</span>
                </header>
                <p style={{ margin: '0 0 8px 0', color: '#4b5d71' }}>{getRoleLabel(user.role_id)}</p>
                <p style={{ margin: '0 0 8px 0', color: '#4b5d71' }}>{user.is_poweruser ? 'Spenderstatus aktiv' : 'Kein Spenderstatus'}</p>
                <p style={{ margin: '0 0 8px 0', color: '#4b5d71' }}>Erstellt: {formatTimestamp(user.created)}</p>
                <div style={{ padding: 8 }}>
                  <button type="button" className="admin-primary-button" onClick={() => selectUserForEdit(user)}>Bearbeiten</button>
                  <button type="button" className="admin-secondary-button" onClick={() => deleteUser(user.id)} style={{ marginLeft: 8 }}>Löschen</button>
                </div>
              </article>
            ))}
          </div>
        </div>
        <div style={{ width: 400 }}>
          {selectedUser ? (
            <div className="admin-panel" style={{ padding: 12 }}>
              <h4>Bearbeite Benutzer</h4>
              <p style={{ margin: '0 0 12px 0', color: '#4b5d71' }}>Erstellt: {formatTimestamp(selectedUser.created)}</p>
              <label className="admin-field"><span>Benutzername</span><input value={selectedUser.username} onChange={(event) => setSelectedUser({ ...selectedUser, username: event.target.value })} /></label>
              <label className="admin-field">
                <span>Rolle</span>
                <select value={selectedUser.role_id ?? ''} onChange={(event) => setSelectedUser({ ...selectedUser, role_id: Number(event.target.value) || null })}>
                  <option value="">Bitte wählen</option>
                  {roles.map((role) => (
                    <option key={`role-${role.role_id}`} value={role.role_id}>{role.role_name || `Rolle ${role.role_id}`}</option>
                  ))}
                </select>
              </label>
              <label className="admin-checkbox" style={{ marginLeft: 4, marginTop: 8 }}><input type="checkbox" checked={!!selectedUser.isadmin} onChange={(event) => setSelectedUser({ ...selectedUser, isadmin: event.target.checked })} /> <span>Is Admin</span></label>
              <label className="admin-checkbox" style={{ marginLeft: 4, marginTop: 8 }}><input type="checkbox" checked={!!selectedUser.is_poweruser} onChange={(event) => setSelectedUser({ ...selectedUser, is_poweruser: event.target.checked })} /> <span>Is Poweruser</span></label>
              <div style={{ marginTop: 8 }}>
                <button className="admin-primary-button" onClick={saveUser} disabled={userLoading}>Speichern</button>
              </div>
              <hr />
              <h5>Passwort zurücksetzen</h5>
              <label className="admin-field"><span>Neues Passwort</span><input value={newPassword} onChange={(event) => setNewPassword(event.target.value)} type="password" /></label>
              <div style={{ marginTop: 8 }}>
                <button className="admin-secondary-button" onClick={setUserPassword} disabled={userLoading || !newPassword}>Passwort setzen</button>
              </div>
            </div>
          ) : (
            <div className="admin-message">Wähle einen Benutzer aus, um Details zu bearbeiten.</div>
          )}
        </div>
      </div>
    </section>
  )
}