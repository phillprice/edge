import { useAuth } from '@clerk/clerk-react'
import { useCallback } from 'react'

export function useApiFetch() {
  const { getToken } = useAuth()
  return useCallback(async (url, options = {}) => {
    const token = await getToken()
    return fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, ...options.headers },
    })
  }, [getToken])
}
