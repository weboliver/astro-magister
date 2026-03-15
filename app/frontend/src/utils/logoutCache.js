import { useEffect } from 'react'

const LOGOUT_EVENT = 'astronexLogout'

export function useLogoutCleanup(handler) {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const listener = () => handler()
    window.addEventListener(LOGOUT_EVENT, listener)
    return () => window.removeEventListener(LOGOUT_EVENT, listener)
  }, [handler])
}
