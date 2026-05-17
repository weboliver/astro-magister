import React, { useEffect, useMemo, useState } from 'react'
import { del, get, post, put } from '../../services/api'

const emptyCategoryForm = {
  category_name: '',
  category_description: '',
  category_sort: 0,
  category_active: true,
  section_id: '',
  parent_category_id: '',
}

/**
 * AdminCategoriesTab - Admin panel tab for managing wiki categories with section hierarchy
 * @component
 * @returns {JSX.Element} Rendered category management interface with parent-child relationships
 */
export default function AdminCategoriesTab(){
  const [sections, setSections] = useState([])
  const [categories, setCategories] = useState([])
  const [categoryQuery, setCategoryQuery] = useState('')
  const [categoryLoading, setCategoryLoading] = useState(false)
  const [categoryError, setCategoryError] = useState('')
  const [categorySuccess, setCategorySuccess] = useState('')
  const [selectedCategory, setSelectedCategory] = useState(null)

  async function loadSections(){
    try{
      const resp = await get('/wiki/sections')
      if (!resp.ok) throw new Error(`Bereiche konnten nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      setSections(Array.isArray(data) ? data : [])
    }catch(_){
      setSections([])
    }
  }

  async function loadCategories(){
    setCategoryLoading(true)
    setCategoryError('')
    try{
      const resp = await get('/wiki/categories')
      if (!resp.ok) throw new Error(`Kategorien konnten nicht geladen werden (${resp.status})`)
      const data = await resp.json()
      setCategories(Array.isArray(data) ? data : [])
    }catch(err){
      setCategoryError(err?.message || 'Kategorien konnten nicht geladen werden')
    }finally{
      setCategoryLoading(false)
    }
  }

  function resetCategoryForm(){
    setSelectedCategory({ ...emptyCategoryForm })
    setCategoryError('')
    setCategorySuccess('')
  }

  function editCategory(category){
    setSelectedCategory({
      category_id: category.category_id,
      category_name: category.category_name || '',
      category_description: category.category_description || '',
      category_sort: Number(category.category_sort) || 0,
      category_active: category.category_active !== false,
      section_id: category.section_id ?? '',
      parent_category_id: category.parent_category_id ?? '',
    })
    setCategoryError('')
    setCategorySuccess('')
  }

  async function saveCategory(){
    if (!selectedCategory?.category_name?.trim()){
      setCategoryError('Bitte einen Kategorien-Namen eingeben')
      return
    }
    if (!selectedCategory?.section_id && selectedCategory?.section_id !== 0){
      setCategoryError('Bitte einen Bereich auswählen')
      return
    }
    setCategoryLoading(true)
    setCategoryError('')
    setCategorySuccess('')
    try{
      const payload = {
        category_name: selectedCategory.category_name.trim(),
        category_description: selectedCategory.category_description || null,
        category_sort: Number(selectedCategory.category_sort) || 0,
        category_active: !!selectedCategory.category_active,
        section_id: Number(selectedCategory.section_id),
        parent_category_id: selectedCategory.parent_category_id === '' ? null : Number(selectedCategory.parent_category_id),
      }
      const isUpdate = !!selectedCategory.category_id
      const resp = isUpdate
        ? await put(`/wiki/categories/${selectedCategory.category_id}`, payload)
        : await post('/wiki/categories', payload)
      if (!resp.ok) throw new Error(`${isUpdate ? 'Speichern' : 'Anlegen'} fehlgeschlagen (${resp.status})`)
      const saved = await resp.json()
      await loadCategories()
      editCategory(saved)
      setCategorySuccess(isUpdate ? 'Kategorie aktualisiert' : 'Kategorie angelegt')
    }catch(err){
      setCategoryError(err?.message || 'Kategorie konnte nicht gespeichert werden')
    }finally{
      setCategoryLoading(false)
    }
  }

  async function deleteCategory(categoryId){
    if (!window.confirm('Kategorie wirklich löschen?')) return
    setCategoryLoading(true)
    setCategoryError('')
    setCategorySuccess('')
    try{
      const resp = await del(`/wiki/categories/${categoryId}`)
      if (!resp.ok) throw new Error(`Löschen fehlgeschlagen (${resp.status})`)
      await loadCategories()
      if (selectedCategory?.category_id === categoryId) setSelectedCategory(null)
      setCategorySuccess('Kategorie gelöscht')
    }catch(err){
      setCategoryError(err?.message || 'Kategorie konnte nicht gelöscht werden')
    }finally{
      setCategoryLoading(false)
    }
  }

  useEffect(() => {
    loadSections()
    loadCategories()
  }, [])

  const filteredCategories = useMemo(() => {
    const needle = categoryQuery.trim().toLowerCase()
    if (!needle) return categories
    return categories.filter((category) => {
      const haystack = [
        category.category_name,
        category.category_description,
        sections.find((section) => Number(section.section_id) === Number(category.section_id))?.section_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [categoryQuery, categories, sections])

  const parentCategoryOptions = useMemo(() => {
    if (!selectedCategory?.section_id) return categories
    return categories.filter((category) => Number(category.section_id) === Number(selectedCategory.section_id))
  }, [categories, selectedCategory])

  return (
    <section className="admin-panel" aria-label="Kategorien verwalten">
      <div className="admin-panel-header">
        <div>
          <h3>Kategorien verwalten</h3>
          <p>Kategorien anlegen, suchen, bearbeiten und löschen.</p>
        </div>
        <div className="admin-action-group">
          <button type="button" className="admin-secondary-button" onClick={resetCategoryForm}>
            Neue Kategorie
          </button>
          <button type="button" className="admin-primary-button" onClick={loadCategories} disabled={categoryLoading}>
            {categoryLoading ? 'Lade...' : 'Aktualisieren'}
          </button>
        </div>
      </div>

      <div className="admin-toolbar">
        <label className="admin-field">
          <span>Suche</span>
          <input value={categoryQuery} onChange={(event) => setCategoryQuery(event.target.value)} placeholder="Name, Beschreibung oder Section" />
        </label>
      </div>

      {categoryError ? <div className="admin-message admin-error">{categoryError}</div> : null}
      {categorySuccess ? <div className="admin-message admin-success">{categorySuccess}</div> : null}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 320px' }}>
          {!filteredCategories.length && !categoryLoading ? (
            <div className="admin-message">Keine Kategorien gefunden.</div>
          ) : null}
          <div className="admin-cache-grid">
            {filteredCategories.map((category) => {
              const sectionName = sections.find((section) => Number(section.section_id) === Number(category.section_id))?.section_name || `Bereich ${category.section_id}`
              const parentName = categories.find((entry) => Number(entry.category_id) === Number(category.parent_category_id))?.category_name
              return (
                <article key={`category-${category.category_id}`} className="admin-cache-card">
                  <header className="admin-cache-card-header">
                    <strong>{category.category_name}</strong>
                    <span>{category.category_active ? 'Aktiv' : 'Inaktiv'}</span>
                  </header>
                  <p style={{ margin: '0 0 8px 0', color: '#4b5d71' }}>
                    {category.category_description || 'Keine Beschreibung'}
                  </p>
                  <p style={{ margin: '0 0 4px 0', color: '#4b5d71' }}>
                    Section: {sectionName}
                  </p>
                  <p style={{ margin: '0 0 4px 0', color: '#4b5d71' }}>
                    Parent: {parentName || 'Keine'}
                  </p>
                  <p style={{ margin: '0 0 12px 0', color: '#4b5d71' }}>
                    Sortierung: {category.category_sort ?? 0}
                  </p>
                  <div style={{ padding: 8 }}>
                    <button type="button" className="admin-primary-button" onClick={() => editCategory(category)}>
                      Bearbeiten
                    </button>
                    <button type="button" className="admin-secondary-button" onClick={() => deleteCategory(category.category_id)} style={{ marginLeft: 8 }}>
                      Löschen
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </div>

        <div style={{ width: 420, maxWidth: '100%' }}>
          <div className="admin-panel" style={{ padding: 12 }}>
            <h4>{selectedCategory?.category_id ? 'Kategorie bearbeiten' : 'Kategorie anlegen'}</h4>
            <label className="admin-field">
              <span>Name</span>
              <input
                value={selectedCategory?.category_name || ''}
                onChange={(event) => setSelectedCategory((current) => ({ ...(current || emptyCategoryForm), category_name: event.target.value }))}
              />
            </label>
            <label className="admin-field">
              <span>Beschreibung</span>
              <textarea
                value={selectedCategory?.category_description || ''}
                onChange={(event) => setSelectedCategory((current) => ({ ...(current || emptyCategoryForm), category_description: event.target.value }))}
                rows={6}
              />
            </label>
            <label className="admin-field">
              <span>Bereich</span>
              <select
                value={selectedCategory?.section_id ?? ''}
                onChange={(event) => setSelectedCategory((current) => ({ ...(current || emptyCategoryForm), section_id: event.target.value, parent_category_id: '' }))}
              >
                <option value="">Bitte wählen</option>
                {sections.map((section) => (
                  <option key={`category-section-${section.section_id}`} value={section.section_id}>{section.section_name}</option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>Übergeordnete Kategorie</span>
              <select
                value={selectedCategory?.parent_category_id ?? ''}
                onChange={(event) => setSelectedCategory((current) => ({ ...(current || emptyCategoryForm), parent_category_id: event.target.value }))}
              >
                <option value="">Keine</option>
                {parentCategoryOptions
                  .filter((category) => Number(category.category_id) !== Number(selectedCategory?.category_id))
                  .map((category) => (
                    <option key={`parent-category-${category.category_id}`} value={category.category_id}>{category.category_name}</option>
                  ))}
              </select>
            </label>
            <label className="admin-field">
              <span>Sortierung</span>
              <input
                type="number"
                value={selectedCategory?.category_sort ?? 0}
                onChange={(event) => setSelectedCategory((current) => ({ ...(current || emptyCategoryForm), category_sort: Number(event.target.value) || 0 }))}
              />
            </label>
            <label className="admin-checkbox" style={{ marginLeft: 4, marginTop: 8 }}>
              <input
                type="checkbox"
                checked={selectedCategory?.category_active !== false}
                onChange={(event) => setSelectedCategory((current) => ({ ...(current || emptyCategoryForm), category_active: event.target.checked }))}
              />
              <span>Aktiv</span>
            </label>
            <div style={{ marginTop: 12 }}>
              <button className="admin-primary-button" onClick={saveCategory} disabled={categoryLoading}>
                {selectedCategory?.category_id ? 'Änderungen speichern' : 'Category anlegen'}
              </button>
              <button className="admin-secondary-button" onClick={resetCategoryForm} style={{ marginLeft: 8 }}>
                Zurücksetzen
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}