import { useAuth } from '@clerk/clerk-react'
import { useCallback } from 'react'

export function useApiFetch() {
  const { getToken } = useAuth()
  return useCallback(async (url, options = {}) => {
    const token = await getToken()
    const headers = { ...options.headers }
    if (token) headers.Authorization = `Bearer ${token}`
    return fetch(url, { ...options, headers }) // nosemgrep: url comes from our own components, not external user input
  }, [getToken])
}
