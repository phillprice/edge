import { useState, useEffect } from 'react'
import { useApiFetch } from './useApiFetch'

// Loads a player's batting + bowling stats, re-fetching when the year/team filter
// changes. Keeps the (fairly involved) fetch effect out of the PlayerDetail component.
// Returns { batting, bowling, loading, allYears, refresh }.
export function usePlayerStats(id, year, team) {
  const apiFetch = useApiFetch()
  const [data, setData] = useState({ batting: null, bowling: null })
  const [loading, setLoading] = useState(true)
  const [allYears, setAllYears] = useState([])

  const fetchBoth = (qs = '') =>
    Promise.all([
      apiFetch(`/api/players/${id}/batting${qs}`).then((r) => r.json()),
      apiFetch(`/api/players/${id}/bowling${qs}`).then((r) => r.json())
    ])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (year) params.set('year', year)
    if (team) params.set('team', team)
    fetchBoth(params.toString() ? `?${params}` : '')
      .then(([batting, bowling]) => {
        setData({ batting, bowling })
        setLoading(false)
        if (!year && !team) {
          setAllYears(
            [...new Set([...(batting.years || []), ...(bowling.years || [])])].sort((a, b) => b - a)
          )
        }
      })
      .catch(() => setLoading(false))
  }, [id, year, team]) // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch unfiltered (after a mutation such as rename or sub toggle).
  const refresh = () => fetchBoth().then(([batting, bowling]) => setData({ batting, bowling }))

  return { batting: data.batting, bowling: data.bowling, loading, allYears, refresh }
}
