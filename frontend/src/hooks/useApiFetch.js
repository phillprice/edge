import { useAuth } from '@clerk/clerk-react'
import { useCallback } from 'react'

// Module-level circuit breaker — shared across all hook instances.
// When the backend returns 429 we stop all requests until the backoff expires.
let rateLimitedUntil = 0

function getRateLimitBackoffMs(response) {
  const retryAfter = response.headers.get('Retry-After')
  if (retryAfter) {
    const secs = Number(retryAfter)
    if (!isNaN(secs) && secs > 0) return secs * 1000
  }
  return 30_000 // default 30 s
}

export function useApiFetch() {
  const { getToken } = useAuth()
  return useCallback(
    async (url, options = {}) => {
      if (Date.now() < rateLimitedUntil) {
        const wait = Math.ceil((rateLimitedUntil - Date.now()) / 1000)
        throw new Error(`Rate limited — retry in ${wait}s`)
      }
      const token = await getToken()
      const headers = { ...options.headers }
      if (token) headers.Authorization = `Bearer ${token}`
      const response = await fetch(url, { ...options, headers }) // nosemgrep: url comes from our own components, not external user input
      if (response.status === 429) {
        rateLimitedUntil = Date.now() + getRateLimitBackoffMs(response)
        console.warn(
          `[apiFetch] 429 on ${url} — backing off ${Math.ceil((rateLimitedUntil - Date.now()) / 1000)}s`
        )
      }
      return response
    },
    [getToken]
  )
}
