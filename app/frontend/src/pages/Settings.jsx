import React, { useEffect, useMemo, useState } from 'react'
import { post, get, put, del } from '../services/api'
import Flatpickr from 'react-flatpickr'
import 'flatpickr/dist/flatpickr.css'
import { usePersonSelection } from '../contexts/PersonSelectionContext'
import { useAuth } from '../contexts/AuthContext'

const DEFAULT_ROLE_OPTIONS = [
  { role_id: 1, role_name: 'Laie' },
  { role_id: 2, role_name: 'Fortgeschritten' },
  { role_id: 3, role_name: 'Experte' },
]

const pad2 = (value) => String(value ?? 0).padStart(2, '0')

const createEmptyPersonForm = () => ({
  role_id: 1,
  name: '',
  residence_country: 'GM',
  residence_region: '',
  residence_city: '',
  residence_latitude: null,
  residence_longitude: null,
  birth_year: null,
  birth_month: null,
  birth_day: null,
  birth_hour: null,
  birth_minute: null,
  birth_second: null,
  birth_country: '',
  birth_country: 'GM',
  birth_region: '',
  birth_city: '',
  birth_latitude: null,
  birth_longitude: null,
})

const buildDateTimeString = (record, prefix = 'birth') => {
  const year = record && record[`${prefix}_year`]
  if (!year) return ''
  const month = (record[`${prefix}_month`] || 1) - 1
  const day = record[`${prefix}_day`] || 1
  const hour = record[`${prefix}_hour`] || 0
  const minute = record[`${prefix}_minute`] || 0
  const second = record[`${prefix}_second`] || 0
  const date = new Date(year, month, day, hour, minute, second)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

const splitDateTimeValue = (value) => {
  if (!value) return ['', '']
  if (value.includes('T')) return value.split('T')
  const parts = value.split(' ')
  return [parts[0] || '', parts[1] || '']
}

const toNativeDateTimeValue = (value) => {
  if (!value) return ''
  const [datePart, timePart] = splitDateTimeValue(String(value).trim())
  if (!datePart) return ''
  const [hour = '00', minute = '00', second = '00'] = String(timePart || '00:00:00').split(':')
  return `${datePart}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}`
}

const fromNativeDateTimeValue = (value) => {
  if (!value) return ''
  const [datePart, timePart] = splitDateTimeValue(String(value).trim())
  if (!datePart) return ''
  const [hour = '00', minute = '00', second = '00'] = String(timePart || '00:00:00').split(':')
  return `${datePart} ${pad2(hour)}:${pad2(minute)}:${pad2(second)}`
}

const parseDateTimeToDate = (value) => {
  if (!value) return null
  const [datePart, timePart] = splitDateTimeValue(String(value).trim())
  if (!datePart) return null
  const [year, month, day] = datePart.split('-').map(part => parseInt(part, 10))
  const [hour, minute, second] = String(timePart || '00:00:00').split(':').map(part => parseInt(part || '0', 10))
  if ([year, month, day, hour, minute, second].some(part => Number.isNaN(part))) return null
  return new Date(year, month - 1, day, hour, minute, second)
}

const roundCoordinate = (value) => {
  if (value === undefined || value === null) return value
  const num = Number(value)
  if (Number.isNaN(num)) return value
  return Math.round(num * 100) / 100
}

const normalizeRoleId = (value) => {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isNaN(parsed) ? 1 : parsed
}

const PERSONS_PAGE_SIZE = 5
const MAX_PERSON_PAGES = 10
const MAX_PERSONS = PERSONS_PAGE_SIZE * MAX_PERSON_PAGES
const SETTINGS_FORM_MAX_WIDTH = 340
const SETTINGS_SEARCH_MAX_WIDTH = 640

const fetchCityPosition = async (city, countryCode, regionCode) => {
  if (!city) return null
  try {
    const url = `/getPosition?country=${encodeURIComponent(countryCode || '')}&city=${encodeURIComponent(city)}&district=${encodeURIComponent(regionCode || '')}`
    const resp = await get(url, false)
    if (!resp.ok) return null
    return await resp.json()
  } catch (err) {
    return null
  }
}

export default function Settings(){
  const TAB_PROFILE = 'profile'
  const TAB_PERSON_FORM = 'person-form'
  const TAB_PERSON_LIST = 'person-list'
  const TAB_PASSWORD = 'password'

  const { refreshPersons } = usePersonSelection()
  const { profile: authProfile, refreshProfile } = useAuth()
  const [msg, setMsg] = useState('')
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [profile, setProfile] = useState({ role_id: 1 })
  const [roles, setRoles] = useState(DEFAULT_ROLE_OPTIONS)
  const [datetimeLocal, setDatetimeLocal] = useState('')
  const [profileDatePickerSeed, setProfileDatePickerSeed] = useState(null)
  const [countries, setCountries] = useState([])
  const [regions, setRegions] = useState([])
  const [cities, setCities] = useState([])
  const [resRegions, setResRegions] = useState([])
  const [resCities, setResCities] = useState([])
  const [birthCityFilter, setBirthCityFilter] = useState('')
  const [residenceCityFilter, setResidenceCityFilter] = useState('')
  const [persons, setPersons] = useState([])
  const [personMsg, setPersonMsg] = useState('')
  const [personForm, setPersonForm] = useState(createEmptyPersonForm())
  const [personDatetimeLocal, setPersonDatetimeLocal] = useState('')
  const [personDatePickerSeed, setPersonDatePickerSeed] = useState(null)
  const [personSearch, setPersonSearch] = useState('')
  const [personRegions, setPersonRegions] = useState([])
  const [personCities, setPersonCities] = useState([])
  const [personResRegions, setPersonResRegions] = useState([])
  const [personResCities, setPersonResCities] = useState([])
  const [personBirthCityFilter, setPersonBirthCityFilter] = useState('')
  const [personResidenceCityFilter, setPersonResidenceCityFilter] = useState('')
  const [editingPersonId, setEditingPersonId] = useState(null)
  const [personPage, setPersonPage] = useState(0)
  const [activeTab, setActiveTab] = useState(TAB_PROFILE)
  const canAddPerson = editingPersonId !== null || persons.length < MAX_PERSONS
  const [isNarrow, setIsNarrow] = useState(typeof window !== 'undefined' ? window.innerWidth <= 480 : false)
  useEffect(() => {
    function onResize(){ setIsNarrow(window.innerWidth <= 480) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const fieldWrapperStyle = { maxWidth: isNarrow ? '100%' : SETTINGS_FORM_MAX_WIDTH, width: '100%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, alignSelf: 'stretch' }
  const fieldControlStyle = { width: '100%', minWidth: 0, boxSizing: 'border-box' }
  const selectControlStyle = { ...fieldControlStyle, padding: '4px 8px' }
  const columnFormStyle = { display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'stretch', width: '100%' }
  const labelStyle = { marginBottom: 2, display: 'block' }
  const tabPanelStyle = {
    width: '100%',
    maxWidth: '100%',
    border: 'none',
    borderRadius: '0 0 12px 12px',
    background: 'transparent',
    padding: 0,
    marginBottom: 12,
  }
  const tabItems = [
    { id: TAB_PROFILE, label: 'User' },
    { id: TAB_PERSON_FORM, label: 'Neue Person' },
    { id: TAB_PERSON_LIST, label: 'Person suchen' },
    { id: TAB_PASSWORD, label: 'Passwort' },
  ]
  const getCountryLabel = (country) => country?.name?.trim() ? country.name : country?.code || ''
  const getRoleLabel = (role) => role?.role_name?.trim() ? role.role_name : `Rolle ${role?.role_id ?? ''}`
  const filteredPersons = useMemo(() => {
    const term = personSearch.trim().toLowerCase()
    if (!term) return persons
    return persons.filter(person => person.name && person.name.toLowerCase().includes(term))
  }, [persons, personSearch])
  const displayablePersons = filteredPersons.slice(0, PERSONS_PAGE_SIZE * MAX_PERSON_PAGES)
  const displayableCount = displayablePersons.length
  const totalPages = displayableCount === 0 ? 1 : Math.ceil(displayableCount / PERSONS_PAGE_SIZE)
  const effectivePage = Math.min(personPage, Math.max(0, totalPages - 1))
  const pagedPersons = displayablePersons.slice(effectivePage * PERSONS_PAGE_SIZE, effectivePage * PERSONS_PAGE_SIZE + PERSONS_PAGE_SIZE)
  const showPagination = displayableCount > PERSONS_PAGE_SIZE
  const hasMoreResults = filteredPersons.length > displayablePersons.length
  const roleNameById = useMemo(() => new Map(roles.map(role => [role.role_id, getRoleLabel(role)])), [roles])
  const activeTabLabel = tabItems.find(tab => tab.id === activeTab)?.label || 'Einstellungen'
  const messageClassName = msg
    ? msg.toLowerCase().includes('fehler')
      ? 'admin-message admin-error'
      : 'admin-message admin-success'
    : ''
  const personMessageClassName = personMsg
    ? personMsg.toLowerCase().includes('fehler') || personMsg.toLowerCase().includes('maximal')
      ? 'admin-message admin-error'
      : 'admin-message admin-success'
    : ''
  const canManageRoleFields = authProfile?.isadmin === true || authProfile?.is_poweruser === true

  const filterCitiesByPrefix = (cityList, filterValue) => {
    const normalizedFilter = String(filterValue || '').trim().toLowerCase()
    if (!normalizedFilter) return cityList
    return cityList.filter(city => String(city?.city || '').toLowerCase().startsWith(normalizedFilter))
  }

  const filteredBirthCities = useMemo(() => filterCitiesByPrefix(cities, birthCityFilter), [cities, birthCityFilter])
  const filteredResidenceCities = useMemo(() => filterCitiesByPrefix(resCities, residenceCityFilter), [resCities, residenceCityFilter])
  const filteredPersonBirthCities = useMemo(() => filterCitiesByPrefix(personCities, personBirthCityFilter), [personCities, personBirthCityFilter])
  const filteredPersonResidenceCities = useMemo(() => filterCitiesByPrefix(personResCities, personResidenceCityFilter), [personResCities, personResidenceCityFilter])
  const datePickerBaseOptions = useMemo(() => ({
    enableTime: true,
    enableSeconds: true,
    time_24hr: true,
    dateFormat: 'Y-m-d H:i:S',
    closeOnSelect: false,
    disableMobile: true,
  }), [])
  const profileDatePickerOptions = useMemo(
    () => ({ ...datePickerBaseOptions, defaultDate: profileDatePickerSeed }),
    [datePickerBaseOptions, profileDatePickerSeed]
  )
  const personDatePickerOptions = useMemo(
    () => ({ ...datePickerBaseOptions, defaultDate: personDatePickerSeed }),
    [datePickerBaseOptions, personDatePickerSeed]
  )
  const personDatePickerKey = useMemo(
    () => `person-date-${editingPersonId ?? 'new'}`,
    [editingPersonId]
  )

  function setPersonField(key, value){
    setPersonForm(prev => ({ ...prev, [key]: value }))
  }

  function handlePersonSearchChange(value){
    setPersonSearch(value)
    setPersonPage(0)
  }

  async function loadPersons(){
    const resp = await get('/auth/persons')
    if (resp.ok){
      setPersons(await resp.json())
    }else{
      setPersons([])
    }
  }

  function resetPersonForm(){
    const form = createEmptyPersonForm()
    setPersonForm(form)
    setPersonDatetimeLocal('')
    setPersonDatePickerSeed(null)
    setEditingPersonId(null)
    setPersonRegions([])
    setPersonCities([])
    setPersonResRegions([])
    setPersonResCities([])
    setPersonBirthCityFilter('')
    setPersonResidenceCityFilter('')
    setPersonMsg('')
    // Lade Regions-/Cities-Listen für das Default-Land, falls vorhanden
    populatePersonLocationLists(form).catch(()=>{})
  }

  async function savePerson(e){
    e.preventDefault()
    if (!personForm.name?.trim()){
      setPersonMsg('Name ist erforderlich')
      return
    }
    if (!editingPersonId && persons.length >= MAX_PERSONS){
      setPersonMsg('Maximal 50 Personen erlaubt. Bitte bearbeite eine bestehende Person.')
      return
    }
    setPersonMsg(editingPersonId ? 'Aktualisiere Person...' : 'Speichere Person...')
    const payload = { ...personForm, name: personForm.name.trim() }
    payload.residence_latitude = roundCoordinate(payload.residence_latitude)
    payload.residence_longitude = roundCoordinate(payload.residence_longitude)
    payload.birth_latitude = roundCoordinate(payload.birth_latitude)
    payload.birth_longitude = roundCoordinate(payload.birth_longitude)
    const endpoint = editingPersonId ? `/auth/persons/${editingPersonId}` : '/auth/persons'
    const action = editingPersonId ? put : post
    const resp = await action(endpoint, payload)
    if (!resp.ok){
      setPersonMsg('Fehler beim Speichern der Person')
      return
    }
    setPersonMsg(editingPersonId ? 'Person aktualisiert' : 'Person gespeichert')
    resetPersonForm()
    await loadPersons()
    await refreshPersons()
  }

  async function populatePersonLocationLists(person){
    if (person?.birth_country){
      try{
        const rresp = await get(`/locations/regions?country=${person.birth_country}`)
        if (rresp.ok){
          const list = await rresp.json()
          setPersonRegions(list)
          if (person.birth_region){
            const cresp = await get(`/locations/cities?country=${person.birth_country}&region=${person.birth_region}`)
            if (cresp.ok){
              setPersonCities(await cresp.json())
            }
          }
        }
      }catch(err){
        setPersonRegions([])
        setPersonCities([])
      }
    }else{
      setPersonRegions([])
      setPersonCities([])
    }
    if (person?.residence_country){
      try{
        const rresp = await get(`/locations/regions?country=${person.residence_country}`)
        if (rresp.ok){
          const list = await rresp.json()
          setPersonResRegions(list)
          if (person.residence_region){
            const cresp = await get(`/locations/cities?country=${person.residence_country}&region=${person.residence_region}`)
            if (cresp.ok){
              setPersonResCities(await cresp.json())
            }
          }
        }
      }catch(err){
        setPersonResRegions([])
        setPersonResCities([])
      }
    }else{
      setPersonResRegions([])
      setPersonResCities([])
    }
  }

  async function editPerson(person){
    setActiveTab(TAB_PERSON_FORM)
    setEditingPersonId(person.id)
    setPersonForm({
      role_id: person.role_id ?? 1,
      name: person.name || '',
      residence_country: person.residence_country || '',
      residence_region: person.residence_region || '',
      residence_city: person.residence_city || '',
      residence_latitude: person.residence_latitude ?? null,
      residence_longitude: person.residence_longitude ?? null,
      birth_year: person.birth_year ?? null,
      birth_month: person.birth_month ?? null,
      birth_day: person.birth_day ?? null,
      birth_hour: person.birth_hour ?? null,
      birth_minute: person.birth_minute ?? null,
      birth_second: person.birth_second ?? null,
      birth_country: person.birth_country || '',
      birth_region: person.birth_region || '',
      birth_city: person.birth_city || '',
      birth_latitude: person.birth_latitude ?? null,
      birth_longitude: person.birth_longitude ?? null,
    })
    const personDateValue = buildDateTimeString(person, 'birth')
    setPersonDatetimeLocal(personDateValue)
    setPersonDatePickerSeed(parseDateTimeToDate(personDateValue))
    setPersonMsg('Bearbeite Person')
    await populatePersonLocationLists(person)
  }

  async function deletePerson(personId){
    if (!window.confirm('Person wirklich löschen?')) return
    setPersonMsg('Lösche Person...')
    const resp = await del(`/auth/persons/${personId}`)
    if (!resp.ok){
      setPersonMsg('Fehler beim Löschen')
      return
    }
    if (editingPersonId === personId){
      resetPersonForm()
    }
    setPersonMsg('Person gelöscht')
    await loadPersons()
    await refreshPersons()
  }

  async function onPersonCountryChange(code){
    setPersonField('birth_country', code)
    setPersonRegions([])
    setPersonCities([])
    setPersonBirthCityFilter('')
    setPersonField('birth_region', '')
    setPersonField('birth_city', '')
    if (!code) return
    try{
      const resp = await get(`/locations/regions?country=${code}`)
      if (resp.ok){
        setPersonRegions(await resp.json())
      }
    }catch(err){
      setPersonRegions([])
    }
  }

  async function onPersonRegionChange(code){
    setPersonField('birth_region', code)
    setPersonCities([])
    setPersonBirthCityFilter('')
    setPersonField('birth_city', '')
    if (!code) return
    try{
      const resp = await get(`/locations/cities?country=${personForm.birth_country || ''}&region=${code}`)
      if (resp.ok){
        setPersonCities(await resp.json())
      }
    }catch(err){
      setPersonCities([])
    }
  }

  async function onPersonResidenceCountryChange(code){
    setPersonField('residence_country', code)
    setPersonResRegions([])
    setPersonResCities([])
    setPersonResidenceCityFilter('')
    setPersonField('residence_region', '')
    setPersonField('residence_city', '')
    if (!code) return
    try{
      const resp = await get(`/locations/regions?country=${code}`)
      if (resp.ok){
        setPersonResRegions(await resp.json())
      }
    }catch(err){
      setPersonResRegions([])
    }
  }

  async function onPersonResidenceRegionChange(code){
    setPersonField('residence_region', code)
    setPersonResCities([])
    setPersonResidenceCityFilter('')
    setPersonField('residence_city', '')
    if (!code) return
    try{
      const resp = await get(`/locations/cities?country=${personForm.residence_country || ''}&region=${code}`)
      if (resp.ok){
        setPersonResCities(await resp.json())
      }
    }catch(err){
      setPersonResCities([])
    }
  }

  async function onPersonCitySelect(city){
    setPersonField('birth_city', city)
    const coords = await fetchCityPosition(city, personForm.birth_country || '', personForm.birth_region || '')
    if (coords){
      if (coords.latitude !== undefined) setPersonField('birth_latitude', roundCoordinate(coords.latitude))
      if (coords.longitude !== undefined) setPersonField('birth_longitude', roundCoordinate(coords.longitude))
    }
  }

  async function onPersonResidenceCitySelect(city){
    setPersonField('residence_city', city)
    const coords = await fetchCityPosition(city, personForm.residence_country || '', personForm.residence_region || '')
    if (coords){
      if (coords.latitude !== undefined) setPersonField('residence_latitude', roundCoordinate(coords.latitude))
      if (coords.longitude !== undefined) setPersonField('residence_longitude', roundCoordinate(coords.longitude))
    }
  }

  function onPersonDateTimeChange(val){
    setPersonDatetimeLocal(val)
    if (!val){
      setPersonField('birth_year', null)
      setPersonField('birth_month', null)
      setPersonField('birth_day', null)
      setPersonField('birth_hour', null)
      setPersonField('birth_minute', null)
      setPersonField('birth_second', null)
      return
    }
    const [datePart, timePart] = splitDateTimeValue(val)
    if (!datePart) return
    const [y,m,d] = datePart.split('-').map(x=>parseInt(x,10))
    const [hh,mm,ss] = (timePart? timePart.split(':') : [0,0,0]).map(x=>parseInt(x||'0',10))
    setPersonField('birth_year', y)
    setPersonField('birth_month', m)
    setPersonField('birth_day', d)
    setPersonField('birth_hour', hh)
    setPersonField('birth_minute', mm)
    setPersonField('birth_second', ss)
  }

  useEffect(()=>{
    async function load(){
      try{
        const rolesResp = await get('/auth/roles')
        if (rolesResp.ok){
          const roleList = await rolesResp.json()
          if (Array.isArray(roleList) && roleList.length){
            setRoles(roleList)
          }
        }
      }catch(err){}

      const resp = await get('/auth/profile')
      if (!resp.ok){
        await loadPersons()
        return
      }
      const data = await resp.json()
      setProfile({ role_id: data.role_id ?? 1, ...data })
      const profileDateValue = buildDateTimeString(data, 'birth')
      setDatetimeLocal(profileDateValue)
      setProfileDatePickerSeed(parseDateTimeToDate(profileDateValue))
      try{
        const cresp = await get('/locations/countries')
        if (cresp.ok){
          const clist = await cresp.json()
          setCountries(clist)
          // Wenn kein Land gesetzt ist, standardmäßig Deutschland (DE) wählen
          try{
            const hasResidence = data && data.residence_country
            const hasBirth = data && data.birth_country
            const germany = Array.isArray(clist) && clist.find(c => {
              const code = String(c.code || '').trim().toLowerCase()
              const name = String(c.name || '').toLowerCase()
              return ['de', 'gm'].includes(code) || name.includes('deutsch') || name.includes('germany')
            })
            if (!hasResidence && germany){
              setField('residence_country', germany.code)
              try{
                const rresp = await get(`/locations/regions?country=${germany.code}`)
                if (rresp.ok){ const rlist = await rresp.json(); setResRegions(rlist) }
              }catch(err){}
            }
            if (!hasBirth && germany){
              setField('birth_country', germany.code)
              try{
                const rresp2 = await get(`/locations/regions?country=${germany.code}`)
                if (rresp2.ok){ const rlist2 = await rresp2.json(); setRegions(rlist2) }
              }catch(err){}
            }
            if (data && data.residence_country){
              const rc = data.residence_country
              const rcNorm = String(rc || '').trim().toLowerCase()
              let foundr = clist.find(c=> String(c.code||'').trim().toLowerCase() === rcNorm)
              if (!foundr){ foundr = clist.find(c=> c.name && String(c.name).trim().toLowerCase() === rcNorm) }
              if (foundr){
                setField('residence_country', foundr.code)
                try{
                  const rresp = await get(`/locations/regions?country=${foundr.code}`)
                  if (rresp.ok){
                    const rlist = await rresp.json()
                    setResRegions(rlist)
                    if (data.residence_region){
                      const rrNorm = String(data.residence_region||'').trim().toLowerCase()
                      let rfound2 = rlist.find(r=> String(r.code||'').trim().toLowerCase() === rrNorm)
                      if (!rfound2){ rfound2 = rlist.find(r=> r.name && String(r.name).trim().toLowerCase() === rrNorm) }
                      if (rfound2){
                        setField('residence_region', rfound2.code)
                        try{
                          const cresp3 = await get(`/locations/cities?country=${foundr.code}&region=${rfound2.code}`)
                          if (cresp3.ok){
                            const clist3 = await cresp3.json()
                            setResCities(clist3)
                            if (data.residence_city){
                              const rcCity = String(data.residence_city||'').trim().toLowerCase()
                              const cf2 = clist3.find(ci=> ci.city && String(ci.city).trim().toLowerCase() === rcCity)
                              if (cf2){ await onResidenceCitySelect(cf2.city, foundr.code, rfound2.code) }
                            }
                          }
                        }catch(err){}
                      }
                    }
                  }
                }catch(err){}
              }
            }
          }catch(err){}
          if (data && data.birth_country){
            const bc = data.birth_country
            const bcNorm = String(bc || '').trim().toLowerCase()
            let found = clist.find(c=> String(c.code || '').trim().toLowerCase() === bcNorm)
            if (!found){
              found = clist.find(c=> c.name && String(c.name).trim().toLowerCase() === bcNorm)
            }
            if (found){
              setField('birth_country', found.code)
              try{
                const rresp = await get(`/locations/regions?country=${found.code}`)
                if (rresp.ok){
                  const rlist = await rresp.json()
                  setRegions(rlist)
                  if (data.birth_region){
                    const brNorm = String(data.birth_region || '').trim().toLowerCase()
                    let rfound = rlist.find(r=> String(r.code || '').trim().toLowerCase() === brNorm)
                    if (!rfound){ rfound = rlist.find(r=> r.name && String(r.name).trim().toLowerCase() === brNorm) }
                    if (rfound){
                      setField('birth_region', rfound.code)
                      try{
                        const cresp2 = await get(`/locations/cities?country=${found.code}&region=${rfound.code}`)
                        if (cresp2.ok){
                          const clist2 = await cresp2.json()
                          setCities(clist2)
                          if (data.birth_city){
                            const bcCity = String(data.birth_city || '').trim().toLowerCase()
                            const cf = clist2.find(ci=> ci.city && String(ci.city).trim().toLowerCase() === bcCity)
                            if (cf){
                              await onCitySelect(cf.city, found.code, rfound.code)
                            }
                          }
                        }
                      }catch(err){}
                    }
                  }
                }
              }catch(err){}
            }
          }
        }
      }catch(err){}
      try{
        await populatePersonLocationLists(createEmptyPersonForm())
      }catch(err){}
      await loadPersons()
    }
    load()
  }, [])

  async function changePassword(e){
    e.preventDefault()
    setMsg('Ändere Passwort...')
    if (newPwd !== confirmPwd){ setMsg('Neues Passwort stimmt nicht überein'); return }
    const resp = await post('/auth/change-password', { old_password: oldPwd, new_password: newPwd })
    if (!resp.ok){ setMsg('Fehler beim Ändern des Passworts'); return }
    setMsg('Passwort geändert')
    setOldPwd(''); setNewPwd(''); setConfirmPwd('')
  }

  async function saveProfile(e){
    e.preventDefault()
    setMsg('Speichere Profil...')
    const payload = {...profile}
    payload.birth_latitude = roundCoordinate(payload.birth_latitude)
    payload.birth_longitude = roundCoordinate(payload.birth_longitude)
    payload.residence_latitude = roundCoordinate(payload.residence_latitude)
    payload.residence_longitude = roundCoordinate(payload.residence_longitude)
    const resp = await put('/auth/profile', payload, true)
    if (!resp.ok){ setMsg('Fehler beim Speichern'); return }
    await refreshProfile()
    setMsg('Profil gespeichert')
  }

  async function onCountryChange(code){
    setField('birth_country', code)
    setRegions([])
    setCities([])
    setBirthCityFilter('')
    setField('birth_region', null)
    setField('birth_city', null)
    if (!code) return
    try{
      const resp = await get(`/locations/regions?country=${code}`)
      if (resp.ok){
        const data = await resp.json()
        setRegions(data)
      }
    }catch(err){ setRegions([]) }
  }

  async function onRegionChange(code){
    setField('birth_region', code)
    setCities([])
    setBirthCityFilter('')
    setField('birth_city', null)
    if (!code) return
    try{
      const resp = await get(`/locations/cities?country=${profile.birth_country || ''}&region=${code}`)
      if (resp.ok){
        const data = await resp.json()
        setCities(data)
      }
    }catch(err){ setCities([]) }
  }

  async function onResidenceRegionChange(code){
    setField('residence_region', code)
    setResCities([])
    setResidenceCityFilter('')
    setField('residence_city', null)
    if (!code) return
    try{
      const resp = await get(`/locations/cities?country=${profile.residence_country || ''}&region=${code}`)
      if (resp.ok){ const data = await resp.json(); setResCities(data) }
    }catch(err){ setResCities([]) }
  }

  async function onCitySelect(city, countryCode = null, regionCode = null){
    setField('birth_city', city)
    setField('birth_place', city)
    try{
      const countryParam = countryCode || profile.birth_country || ''
      const region = regionCode || profile.birth_region || ''
      const coords = await fetchCityPosition(city, countryParam, region)
      if (coords){
        if (coords.latitude !== undefined) setField('birth_latitude', roundCoordinate(coords.latitude))
        if (coords.longitude !== undefined) setField('birth_longitude', roundCoordinate(coords.longitude))
      }
    }catch(err){}
  }

  async function onResidenceCitySelect(city, countryCode = null, regionCode = null){
    setField('residence_city', city)
    setField('residence_place', city)
    try{
      const countryParam = countryCode || profile.residence_country || ''
      const region = regionCode || profile.residence_region || ''
      const coords = await fetchCityPosition(city, countryParam, region)
      if (coords){
        if (coords.latitude !== undefined) setField('residence_latitude', roundCoordinate(coords.latitude))
        if (coords.longitude !== undefined) setField('residence_longitude', roundCoordinate(coords.longitude))
      }
    }catch(err){}
  }

  function setField(k, v){ setProfile(prev => ({...prev, [k]: v})) }

  function onDateTimeChange(val){
    setDatetimeLocal(val)
    if (!val){
      setField('birth_year', null)
      setField('birth_month', null)
      setField('birth_day', null)
      setField('birth_hour', null)
      setField('birth_minute', null)
      setField('birth_second', null)
      return
    }
    const [datePart, timePart] = splitDateTimeValue(val)
    if (!datePart) return
    const [y,m,d] = datePart.split('-').map(x=>parseInt(x,10))
    const [hh,mm,ss] = (timePart? timePart.split(':') : [0,0,0]).map(x=>parseInt(x||'0',10))
    setField('birth_year', y)
    setField('birth_month', m)
    setField('birth_day', d)
    setField('birth_hour', hh)
    setField('birth_minute', mm)
    setField('birth_second', ss)
  }

  const formatPersonDate = (person) => {
    if (!person?.birth_year) return 'nicht gesetzt'
    const month = person.birth_month || 1
    const day = person.birth_day || 1
    const hour = person.birth_hour ?? 0
    const minute = person.birth_minute ?? 0
    return `${person.birth_year}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}`
  }

  const formatPersonLocation = (person, prefix) => {
    if (!person) return ''
    const parts = [person[`${prefix}_city`], person[`${prefix}_region`], person[`${prefix}_country`]].filter(Boolean)
    return parts.join(', ') || 'nicht gesetzt'
  }

  return (
    <div className="admin-page settings-page" style={{boxSizing: 'border-box', overflowX: 'hidden'}}>
      <div role="tablist" aria-label="Settings Tabs" className="admin-tabs settings-tabs">
        {tabItems.map(tab => {
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={isActive ? 'admin-tab admin-tab-active' : 'admin-tab'}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      <section className="admin-panel">
        <div className="admin-hero settings-hero">
          <div>
            <p className="admin-eyebrow">Profilverwaltung</p>
            <h2>Profil</h2>
            <p>
              Pflege dein eigenes Profil, verwalte weitere Personen und halte dein Konto aktuell.
            </p>
          </div>
          <div className="settings-hero-meta">
            <span className="settings-hero-chip">Aktiver Bereich: {activeTabLabel}</span>
            <span className="settings-hero-chip">Personen: {persons.length} / {MAX_PERSONS}</span>
          </div>
        </div>

        <div className="settings-tab-panel" style={tabPanelStyle}>

      {activeTab === TAB_PROFILE && (
        <div className="settings-panel-grid">
          <section className="settings-card" style={{margin:0}}>
            <form onSubmit={saveProfile} className="settings-form" style={columnFormStyle}>
              <div style={fieldWrapperStyle}>
                <label style={labelStyle}>Rolle</label>
                <select style={selectControlStyle} value={profile.role_id ?? 1} onChange={e=>setField('role_id', normalizeRoleId(e.target.value))} disabled={!canManageRoleFields}>
                  {roles.map(role => <option key={role.role_id} value={role.role_id}>{getRoleLabel(role)}</option>)}
                </select>
              </div>
              <h4 style={{marginTop:0, marginBottom:0}}>Wohnort (Ort für Transite)</h4>
              <div style={fieldWrapperStyle}>
                <label style={labelStyle}>Land</label>
                <select style={selectControlStyle} value={profile.residence_country || ''} 
                  onChange={e=>{ setField('residence_country', e.target.value); setResRegions([]); setResCities([]); setField('residence_region', null); setField('residence_city', null); if (e.target.value) { get(`/locations/regions?country=${e.target.value}`).then(r=>r.ok?r.json().then(j=>setResRegions(j)):null).catch(()=>{}) } }}>
                  <option value="">-- bitte wählen --</option>
                  {countries.map(c=> <option key={c.code} value={c.code}>{getCountryLabel(c)}</option>)}
                </select>
              </div>
              <div style={fieldWrapperStyle}>
                <label style={labelStyle}>Bundesland</label>
                <select style={selectControlStyle} value={profile.residence_region || ''} onChange={e=>onResidenceRegionChange(e.target.value)} disabled={!resRegions.length}>
                  <option value="">-- bitte wählen --</option>
                  {resRegions.map(r=> <option key={r.code} value={r.code}>{r.name}</option>)}
                </select>
              </div>
              <div style={fieldWrapperStyle}>
                <label style={labelStyle}>Stadt</label>
                <select style={selectControlStyle} value={profile.residence_city || ''} onChange={e=>onResidenceCitySelect(e.target.value)} disabled={!filteredResidenceCities.length}>
                  <option value="">-- bitte wählen --</option>
                  {filteredResidenceCities.map(c=> <option key={`${c.code}-${c.city}`} value={c.city}>{c.city}</option>)}
                </select>
                <input
                  style={fieldControlStyle}
                  value={residenceCityFilter}
                  onChange={e=>setResidenceCityFilter(e.target.value)}
                  placeholder="Städte nach Anfangsbuchstaben filtern"
                />
              </div>
              <div style={fieldWrapperStyle}>
                <label style={labelStyle}>Breitengrad</label>
                <input style={fieldControlStyle} value={profile.residence_latitude || ''} onChange={e=>setField('residence_latitude', e.target.value ? parseFloat(e.target.value) : null)} placeholder="Breitengrad wird nach Auswahl der Stadt gesetzt." />
              </div>
              <div style={fieldWrapperStyle}>
                <label style={labelStyle}>Längengrad</label>
                <input style={fieldControlStyle} value={profile.residence_longitude || ''} onChange={e=>setField('residence_longitude', e.target.value ? parseFloat(e.target.value) : null)} placeholder="Längengrad wird nach Auswahl der Stadt gesetzt." />
              </div>
              <div className="settings-actions" style={{marginTop:8}}><button className="admin-primary-button" type="submit">Speichern</button></div>
            </form>
          </section>
          <section className="settings-card" style={{margin:0}}>
            <h4>Geburtstag (Ort)</h4>
            <form onSubmit={saveProfile} className="settings-form" style={columnFormStyle}>
              <div style={fieldWrapperStyle}>
                <label style={labelStyle}>Datum & Uhrzeit</label>
                {isNarrow ? (
                  <input
                    type="datetime-local"
                    step="1"
                    style={fieldControlStyle}
                    value={toNativeDateTimeValue(datetimeLocal)}
                    onChange={e => onDateTimeChange(fromNativeDateTimeValue(e.target.value))}
                  />
                ) : (
                  <Flatpickr
                    value={datetimeLocal}
                    options={profileDatePickerOptions}
                    onChange={(dates) => {
                      const date = dates && dates[0]
                      if (!date) { onDateTimeChange(''); return }
                      const pad=(n)=>String(n).padStart(2,'0')
                      const str=`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
                      onDateTimeChange(str)
                    }}
                  />
                )}
              </div>
              <div style={fieldWrapperStyle}>
                <label style={labelStyle}>Land</label>
                <select style={selectControlStyle} value={profile.birth_country || ''} onChange={e=>onCountryChange(e.target.value)}>
                  <option value="">-- bitte wählen --</option>
                  {countries.map(c=> <option key={c.code} value={c.code}>{getCountryLabel(c)}</option>)}
                </select>
              </div>
              <div style={fieldWrapperStyle}>
                <label style={labelStyle}>Bundesland</label>
                <select style={selectControlStyle} value={profile.birth_region || ''} onChange={e=>onRegionChange(e.target.value)} disabled={!regions.length}>
                  <option value="">-- bitte wählen --</option>
                  {regions.map(r=> <option key={r.code} value={r.code}>{r.name}</option>)}
                </select>
              </div>
              <div style={fieldWrapperStyle}>
                <label style={labelStyle}>Stadt</label>
                <select style={selectControlStyle} value={profile.birth_city || ''} onChange={e=>onCitySelect(e.target.value)} disabled={!filteredBirthCities.length}>
                  <option value="">-- bitte wählen --</option>
                  {filteredBirthCities.map(c=> <option key={`${c.code}-${c.city}`} value={c.city}>{c.city}</option>)}
                </select>
                <input
                  style={fieldControlStyle}
                  value={birthCityFilter}
                  onChange={e=>setBirthCityFilter(e.target.value)}
                  placeholder="Städte nach Anfangsbuchstaben filtern"
                />
              </div>
              <div style={fieldWrapperStyle}>
                <label style={labelStyle}>Breitengrad</label>
                <input style={fieldControlStyle} value={profile.birth_latitude || ''} onChange={e=>setField('birth_latitude', e.target.value ? parseFloat(e.target.value) : null)} placeholder="Breitengrad wird nach Auswahl der Stadt gesetzt." />
              </div>
              <div style={fieldWrapperStyle}>
                <label style={labelStyle}>Längengrad</label>
                <input style={fieldControlStyle} value={profile.birth_longitude || ''} onChange={e=>setField('birth_longitude', e.target.value ? parseFloat(e.target.value) : null)} placeholder="Längengrad wird nach Auswahl der Stadt gesetzt." />
              </div>
              <div className="settings-actions" style={{marginTop:8}}><button className="admin-primary-button" type="submit">Speichern</button></div>
            </form>
          </section>
        </div>
      )}

      {activeTab === TAB_PERSON_FORM && (
        <section className="settings-card" style={{margin:0}}>
          <h4>{editingPersonId ? 'Person bearbeiten' : 'Weitere Person anlegen'}</h4>
          <div style={{width:'100%', maxWidth:SETTINGS_FORM_MAX_WIDTH}}>
            <form onSubmit={savePerson} className="settings-form" style={columnFormStyle}>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>Rolle</label>
                      <select style={selectControlStyle} value={personForm.role_id ?? 1} onChange={e=>setPersonField('role_id', normalizeRoleId(e.target.value))} disabled={!canManageRoleFields}>
                        {roles.map(role => <option key={role.role_id} value={role.role_id}>{getRoleLabel(role)}</option>)}
                      </select>
                    </div>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>Name</label>
                      <input style={fieldControlStyle} value={personForm.name} onChange={e=>setPersonField('name', e.target.value)} />
                    </div>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>Wohnort - Land</label>
                      <select style={selectControlStyle} value={personForm.residence_country || ''} onChange={e=>onPersonResidenceCountryChange(e.target.value)}>
                        <option value="">-- bitte wählen --</option>
                        {countries.map(c=> <option key={c.code} value={c.code}>{getCountryLabel(c)}</option>)}
                      </select>
                    </div>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>Wohnort - Bundesland</label>
                      <select style={selectControlStyle} value={personForm.residence_region || ''} onChange={e=>onPersonResidenceRegionChange(e.target.value)} disabled={!personResRegions.length}>
                        <option value="">-- bitte wählen --</option>
                        {personResRegions.map(r=> <option key={r.code} value={r.code}>{r.name}</option>)}
                      </select>
                    </div>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>Wohnort - Stadt</label>
                      <select style={selectControlStyle} value={personForm.residence_city || ''} onChange={e=>onPersonResidenceCitySelect(e.target.value)} disabled={!filteredPersonResidenceCities.length}>
                        <option value="">-- bitte wählen --</option>
                        {filteredPersonResidenceCities.map(c=> <option key={`${c.code}-${c.city}`} value={c.city}>{c.city}</option>)}
                      </select>
                      <input
                        style={fieldControlStyle}
                        value={personResidenceCityFilter}
                        onChange={e=>setPersonResidenceCityFilter(e.target.value)}
                        placeholder="Städte nach Anfangsbuchstaben filtern"
                      />
                    </div>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>Breitengrad</label>
                      <input style={fieldControlStyle} value={personForm.residence_latitude || ''} onChange={e=>setPersonField('residence_latitude', e.target.value ? parseFloat(e.target.value) : null)} placeholder="Breitengrad wird nach Auswahl der Stadt gesetzt." />
                    </div>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>Längengrad</label>
                      <input style={fieldControlStyle} value={personForm.residence_longitude || ''} onChange={e=>setPersonField('residence_longitude', e.target.value ? parseFloat(e.target.value) : null)} placeholder="Längengrad wird nach Auswahl der Stadt gesetzt." />
                    </div>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>Geburtstag (Datum & Uhrzeit)</label>
                      {isNarrow ? (
                        <input
                          type="datetime-local"
                          step="1"
                          style={fieldControlStyle}
                          value={toNativeDateTimeValue(personDatetimeLocal)}
                          onChange={e => onPersonDateTimeChange(fromNativeDateTimeValue(e.target.value))}
                        />
                      ) : (
                        <Flatpickr
                          key={personDatePickerKey}
                          value={personDatetimeLocal}
                          options={personDatePickerOptions}
                          onChange={(dates) => {
                            const date = dates && dates[0]
                            if (!date) { onPersonDateTimeChange(''); return }
                            const pad=(n)=>String(n).padStart(2,'0')
                            const str=`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
                            onPersonDateTimeChange(str)
                          }}
                        />
                      )}
                    </div>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>Geburtstag - Land</label>
                      <select style={selectControlStyle} value={personForm.birth_country || ''} onChange={e=>onPersonCountryChange(e.target.value)}>
                        <option value="">-- bitte wählen --</option>
                        {countries.map(c=> <option key={c.code} value={c.code}>{getCountryLabel(c)}</option>)}
                      </select>
                    </div>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>Geburtstag - Bundesland</label>
                      <select style={selectControlStyle} value={personForm.birth_region || ''} onChange={e=>onPersonRegionChange(e.target.value)} disabled={!personRegions.length}>
                        <option value="">-- bitte wählen --</option>
                        {personRegions.map(r=> <option key={r.code} value={r.code}>{r.name}</option>)}
                      </select>
                    </div>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>Geburtstag - Stadt</label>
                      <select style={selectControlStyle} value={personForm.birth_city || ''} onChange={e=>onPersonCitySelect(e.target.value)} disabled={!filteredPersonBirthCities.length}>
                        <option value="">-- bitte wählen --</option>
                        {filteredPersonBirthCities.map(c=> <option key={`${c.code}-${c.city}`} value={c.city}>{c.city}</option>)}
                      </select>
                      <input
                        style={fieldControlStyle}
                        value={personBirthCityFilter}
                        onChange={e=>setPersonBirthCityFilter(e.target.value)}
                        placeholder="Städte nach Anfangsbuchstaben filtern"
                      />
                    </div>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>Breitengrad</label>
                      <input style={fieldControlStyle} value={personForm.birth_latitude || ''} onChange={e=>setPersonField('birth_latitude', e.target.value ? parseFloat(e.target.value) : null)} placeholder="Längengrad wird nach Auswahl der Stadt gesetzt." />
                    </div>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>Längengrad</label>
                      <input style={fieldControlStyle} value={personForm.birth_longitude || ''} onChange={e=>setPersonField('birth_longitude', e.target.value ? parseFloat(e.target.value) : null)} placeholder="Breitengrad wird nach Auswahl der Stadt gesetzt." />
                    </div>
                    <div className="settings-actions" style={{marginTop:8}}>
                      <button className="admin-primary-button" type="submit" disabled={!canAddPerson}>{editingPersonId ? 'Aktualisieren' : 'Person speichern'}</button>
                      <button className="admin-secondary-button" type="button" style={{marginLeft:8}} onClick={resetPersonForm}>Neu</button>
                    </div>
                    {!canAddPerson && (
                      <div className="settings-inline-note" style={{fontSize:12, color:'#c00'}}>
                        Maximal 50 Personen gespeichert. Bitte bearbeite eine bestehende Person.
                      </div>
                    )}
                  </form>
                </div>
          {personMsg ? <div className={personMessageClassName} style={{marginTop:12}}>{personMsg}</div> : null}
        </section>
      )}

      {activeTab === TAB_PERSON_LIST && (
        <section className="settings-card" style={{margin:0}}>
          <h4>Personen suchen</h4>
          <div style={{display:'flex', flexDirection:'column', gap:12, maxWidth:SETTINGS_SEARCH_MAX_WIDTH}}>
            <div style={{display:'flex', flexDirection:'column', gap:4}}>
              <input
                value={personSearch}
                onChange={e => handlePersonSearchChange(e.target.value)}
                placeholder="Name eingeben"
                style={{...fieldControlStyle, maxWidth:SETTINGS_FORM_MAX_WIDTH}}
              />
            </div>
            {showPagination && (
              <div className="settings-actions" style={{display:'flex', alignItems:'center', gap:8}}>
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={effectivePage === 0}
                  onClick={() => setPersonPage(p => Math.max(0, p - 1))}
                >
                  Zurück
                </button>
                <span style={{fontSize:12}}>
                  Seite {effectivePage + 1} / {totalPages}
                </span>
                <button
                  className="admin-secondary-button"
                  type="button"
                  disabled={effectivePage >= totalPages - 1}
                  onClick={() => setPersonPage(p => Math.min(totalPages - 1, p + 1))}
                >
                  Weiter
                </button>
              </div>
            )}
            {hasMoreResults && (
              <div style={{fontSize:12, color:'#555'}}>
                Zeige nur die ersten {PERSONS_PAGE_SIZE * MAX_PERSON_PAGES} Personen.
              </div>
            )}
            {pagedPersons.length ? (
              pagedPersons.map(person => (
                <div key={person.id} className="settings-person-row" style={{marginBottom:6, paddingBottom:12, borderBottom:'1px solid #ddd'}}>
                  <strong>{person.name}</strong>
                  <div style={{fontSize:12, color:'#333', marginTop:6}}>
                    <div>Rolle: {roleNameById.get(person.role_id ?? 1) || `Rolle ${person.role_id ?? 1}`}</div>
                    <div>Geburt: {formatPersonDate(person)} · {formatPersonLocation(person, 'birth')}</div>
                    <div>Wohnort: {formatPersonLocation(person, 'residence')}</div>
                  </div>
                  <div className="settings-actions" style={{marginTop:6}}>
                    <button className="admin-secondary-button" type="button" onClick={()=>editPerson(person)}>Bearbeiten</button>
                    <button className="admin-secondary-button settings-danger-button" type="button" style={{marginLeft:8}} onClick={()=>deletePerson(person.id)}>Löschen</button>
                  </div>
                </div>
              ))
            ) : (
              <p>{personSearch ? 'Keine passenden Personen gefunden.' : 'Keine Personen gespeichert.'}</p>
            )}
          </div>
          {personMsg ? <div className={personMessageClassName} style={{marginTop:12}}>{personMsg}</div> : null}
        </section>
      )}

      {activeTab === TAB_PASSWORD && (
        <section className="settings-card" style={{marginBottom:24}}>
          <h4>Passwort ändern</h4>
          <form onSubmit={changePassword} className="settings-form" style={columnFormStyle}>
            <div style={fieldWrapperStyle}>
              <label style={labelStyle}>Altes Passwort</label>
              <input style={fieldControlStyle} type="password" value={oldPwd} onChange={e=>setOldPwd(e.target.value)} />
            </div>
            <div style={fieldWrapperStyle}>
              <label style={labelStyle}>Neues Passwort</label>
              <input style={fieldControlStyle} type="password" value={newPwd} onChange={e=>setNewPwd(e.target.value)} />
            </div>
            <div style={fieldWrapperStyle}>
              <label style={labelStyle}>Neues Passwort bestätigen</label>
              <input style={fieldControlStyle} type="password" value={confirmPwd} onChange={e=>setConfirmPwd(e.target.value)} />
            </div>
            <div className="settings-actions" style={{marginTop:8}}><button className="admin-primary-button" type="submit">Ändern</button></div>
          </form>
        </section>
      )}

        </div>

      {msg ? <div className={messageClassName} style={{marginTop:12}}>{msg}</div> : null}
  </section>
    </div>
  )
}