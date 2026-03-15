import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { get } from '../services/api'
import { useAuth } from './AuthContext'

const LOCAL_STORAGE_KEY = 'astronex_selected_person_id'
const PersonSelectionContext = createContext(null)

export function PersonSelectionProvider({ children }){
  const { profile } = useAuth()
  const [persons, setPersons] = useState([])
  const [selectedPersonId, setSelectedPersonId] = useState(() => {
    if (typeof window === 'undefined') return null
    const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY)
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
      setSelectedPersonId(prev => {
        if (prev === null) return prev
        if (!list.some(person => person.id === prev)){
          if (typeof window !== 'undefined'){
            window.localStorage.removeItem(LOCAL_STORAGE_KEY)
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
        setSelectedPersonId(null)
        if (typeof window !== 'undefined'){
          window.localStorage.removeItem(LOCAL_STORAGE_KEY)
        }
        hasAuthenticatedRef.current = false
      }
      return
    }
    hasAuthenticatedRef.current = true
    loadPersons()
  }, [profile, loadPersons])

  const storeSelection = useCallback((id) => {
    setSelectedPersonId(id)
    if (typeof window === 'undefined') return
    if (id === null){
      window.localStorage.removeItem(LOCAL_STORAGE_KEY)
    } else {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, String(id))
    }
  }, [])

  const selectedPerson = useMemo(() => {
    if (selectedPersonId === null) return null
    return persons.find(person => person.id === selectedPersonId) || null
  }, [persons, selectedPersonId])

  return (
    <PersonSelectionContext.Provider value={{
      persons,
      selectedPerson,
      selectedPersonId,
      selectPersonId: storeSelection,
      loading,
      refreshPersons: loadPersons,
    }}>
      {children}
    </PersonSelectionContext.Provider>
  )
}

export function usePersonSelection(){
  const context = useContext(PersonSelectionContext)
  if (!context){
    throw new Error('usePersonSelection must be used within PersonSelectionProvider')
  }
  return context
}
