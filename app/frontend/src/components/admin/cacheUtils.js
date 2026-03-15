export function formatTimestamp(timestamp){
  if (!timestamp) return 'Noch nicht geladen'
  try{
    return new Intl.DateTimeFormat('de-DE', {
      dateStyle: 'medium',
      timeStyle: 'medium',
    }).format(timestamp)
  }catch(_){
    return String(timestamp)
  }
}

export function formatTtl(ttlSeconds){
  if (typeof ttlSeconds !== 'number') return 'unbekannt'
  if (ttlSeconds < 0) return 'ohne Ablauf'
  if (ttlSeconds < 60) return `${ttlSeconds}s`
  const minutes = Math.floor(ttlSeconds / 60)
  const seconds = ttlSeconds % 60
  if (minutes < 60) return `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}