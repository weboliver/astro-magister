import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { get } from '../services/api'
import { useAuth } from './AuthContext'

/**
 * SynastrySelectionContext.jsx - Isolated dual-person selection context for Synastry pages
 * @module SynastrySelectionContext
 * @description React context managing TWO independent person selections (Person A and Person B)
 *              with dedicated localStorage keys. Completely isolated from the global PersonSelectionContext
 *              to prevent state collision when two PersonSelector components coexist on the same page.
 *
 *              localStorage keys:
 *                - Person A: 'astronex_synastry_person_a_id'
 *                - Person B: 'astronex_synastry_person_b_id'
 *              NEVER touches 'astronex_selected_person_id' (the global context's key).
 */

const LOCAL_STORAGE_KEY_A = 'astronex_synastry_person_a_id'
const LOCAL_STORAGE_KEY_B = 'astronex_synastry_person_b_id'

/**
 * Synastry selection context — provides dual person selections to consuming components
 * @type {React.Context}
 */
const SynastrySelectionContext = createContext(null)

export function SynastrySelectionProvider({ children }){
  const { profile } = useAuth()
  const [persons, setPersons] = useState([])
  const [selectedPersonAId, setSelectedPersonAId] = useState(() => {
    if (typeof window === 'undefined') return null
    const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY_A)
    if (!stored) return null
    const parsed = Number(stored)
    return Number.isNaN(parsed) ? null : parsed
  })
  const [selectedPersonBId, setSelectedPersonBId] = useState(() => {
    if (typeof window === 'undefined') return null
    const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY_B)
    if (!stored) return null
    const parsed = Number(stored)
    return Number.isNaN(parsed) ? null : parsed
  })
  const [loading, setLoading] = useState(false)
  const hasAuthenticatedRef = useRef(false)

  const loadPersons = useCallback(async () => {
    setLoading(true)
    try{
      const resp = await get('/auth/persons')
      if (!resp.ok){
        setPersons([])
        return
      }
      const list = await resp.json()
      setPersons(list)
      // Validate person A still exists in the list
      setSelectedPersonAId(prev => {
        if (prev === null) return prev
        if (!list.some(person => person.id === prev)){
          if (typeof window !== 'undefined'){
            window.localStorage.removeItem(LOCAL_STORAGE_KEY_A)
          }
          return null
        }
        return prev
      })
      // Validate person B still exists in the list
      setSelectedPersonBId(prev => {
        if (prev === null) return prev
        if (!list.some(person => person.id === prev)){
          if (typeof window !== 'undefined'){
            window.localStorage.removeItem(LOCAL_STORAGE_KEY_B)
          }
          return null
        }
        return prev
      })
    }catch(_){
      setPersons([])
    }finally{
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!profile){
      if (hasAuthenticatedRef.current){
        setPersons([])
        setSelectedPersonAId(null)
        setSelectedPersonBId(null)
        if (typeof window !== 'undefined'){
          window.localStorage.removeItem(LOCAL_STORAGE_KEY_A)
          window.localStorage.removeItem(LOCAL_STORAGE_KEY_B)
        }
        hasAuthenticatedRef.current = false
      }
      return
    }
    hasAuthenticatedRef.current = true
    loadPersons()
  }, [profile, loadPersons])

  const storeSelectionA = useCallback((id) => {
    setSelectedPersonAId(id)
    if (typeof window === 'undefined') return
    if (id === null){
      window.localStorage.removeItem(LOCAL_STORAGE_KEY_A)
    } else {
      window.localStorage.setItem(LOCAL_STORAGE_KEY_A, String(id))
    }
  }, [])

  const storeSelectionB = useCallback((id) => {
    setSelectedPersonBId(id)
    if (typeof window === 'undefined') return
    if (id === null){
      window.localStorage.removeItem(LOCAL_STORAGE_KEY_B)
    } else {
      window.localStorage.setItem(LOCAL_STORAGE_KEY_B, String(id))
    }
  }, [])

  const selectedPersonA = useMemo(() => {
    if (selectedPersonAId === null) return null
    return persons.find(person => person.id === selectedPersonAId) || null
  }, [persons, selectedPersonAId])

  const selectedPersonB = useMemo(() => {
    if (selectedPersonBId === null) return null
    return persons.find(person => person.id === selectedPersonBId) || null
  }, [persons, selectedPersonBId])

  return (
    <SynastrySelectionContext.Provider value={{
      persons,
      loading,
      refreshPersons: loadPersons,
      // Person A
      selectedPersonAId,
      selectedPersonA,
      selectPersonAId: storeSelectionA,
      // Person B
      selectedPersonBId,
      selectedPersonB,
      selectPersonBId: storeSelectionB,
    }}>
      {children}
    </SynastrySelectionContext.Provider>
  )
}

/**
 * Hook to access synastry selection state for a specific person slot.
 * Returns an interface compatible with PersonSelector's expectations:
 *   { selectedPersonId, selectedPerson, selectPersonId, persons, loading, refreshPersons }
 *
 * @param {'A'|'B'} index - Which person slot to access ('A' or 'B')
 * @returns {Object} Mapped context values for the specified person slot
 * @throws {Error} If used outside SynastrySelectionProvider or index is invalid
 */
export function useSynastrySelection(index){
  const ctx = useContext(SynastrySelectionContext)
  if (!ctx){
    throw new Error('useSynastrySelection must be used within SynastrySelectionProvider')
  }
  if (index !== 'A' && index !== 'B'){
    throw new Error('useSynastrySelection index must be "A" or "B"')
  }

  if (index === 'A'){
    return {
      persons: ctx.persons,
      loading: ctx.loading,
      selectedPersonId: ctx.selectedPersonAId,
      selectedPerson: ctx.selectedPersonA,
      selectPersonId: ctx.selectPersonAId,
      refreshPersons: ctx.refreshPersons,
    }
  }
  // index === 'B'
  return {
    persons: ctx.persons,
    loading: ctx.loading,
    selectedPersonId: ctx.selectedPersonBId,
    selectedPerson: ctx.selectedPersonB,
    selectPersonId: ctx.selectPersonBId,
    refreshPersons: ctx.refreshPersons,
  }
}
