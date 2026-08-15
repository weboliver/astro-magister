import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import { usePersonSelection } from './PersonSelectionContext'

/**
 * SynastrySelectionContext.jsx - Dual-person selection context for Synastry pages
 * @module SynastrySelectionContext
 * @description React context managing TWO person selections for the Synastry page:
 *              Person A mirrors the GLOBAL PersonSelectionContext selection — the same
 *              profile chosen everywhere else (Horoskop, Transite, ...). Changing Person A
 *              on the Synastry page updates the global selection and vice versa.
 *              Person B stays isolated with its own localStorage key
 *              ('astronex_synastry_person_b_id') as the partner slot.
 */

const LOCAL_STORAGE_KEY_B = 'astronex_synastry_person_b_id'

/**
 * Synastry selection context — provides dual person selections to consuming components
 * @type {React.Context}
 */
const SynastrySelectionContext = createContext(null)

export function SynastrySelectionProvider({ children }){
  const { profile } = useAuth()
  const {
    persons,
    loading,
    selectedPersonId: globalSelectedPersonId,
    selectedPerson: globalSelectedPerson,
    selectPersonId: globalSelectPersonId,
    refreshPersons,
  } = usePersonSelection()
  const [selectedPersonBId, setSelectedPersonBId] = useState(() => {
    if (typeof window === 'undefined') return null
    const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY_B)
    if (!stored) return null
    const parsed = Number(stored)
    return Number.isNaN(parsed) ? null : parsed
  })
  const hasAuthenticatedRef = useRef(false)

  useEffect(() => {
    // Validate person B still exists in the list (person A is validated by PersonSelectionContext)
    if (selectedPersonBId === null) return
    if (persons.length === 0) return
    if (!persons.some(person => person.id === selectedPersonBId)){
      setSelectedPersonBId(null)
      if (typeof window !== 'undefined'){
        window.localStorage.removeItem(LOCAL_STORAGE_KEY_B)
      }
    }
  }, [persons, selectedPersonBId])

  useEffect(() => {
    if (!profile){
      if (hasAuthenticatedRef.current){
        setSelectedPersonBId(null)
        if (typeof window !== 'undefined'){
          window.localStorage.removeItem(LOCAL_STORAGE_KEY_B)
        }
        hasAuthenticatedRef.current = false
      }
      return
    }
    hasAuthenticatedRef.current = true
  }, [profile])

  const storeSelectionB = useCallback((id) => {
    setSelectedPersonBId(id)
    if (typeof window === 'undefined') return
    if (id === null){
      window.localStorage.removeItem(LOCAL_STORAGE_KEY_B)
    } else {
      window.localStorage.setItem(LOCAL_STORAGE_KEY_B, String(id))
    }
  }, [])

  const selectedPersonB = useMemo(() => {
    if (selectedPersonBId === null) return null
    return persons.find(person => person.id === selectedPersonBId) || null
  }, [persons, selectedPersonBId])

  return (
    <SynastrySelectionContext.Provider value={{
      persons,
      loading,
      refreshPersons,
      // Person A mirrors the global selection (same profile on every page)
      selectedPersonAId: globalSelectedPersonId,
      selectedPersonA: globalSelectedPerson,
      selectPersonAId: globalSelectPersonId,
      // Person B is the isolated partner slot
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
