import { useState, useEffect } from 'react'
import { useApiFetch } from './useApiFetch'

const STORAGE_KEY = 'edge.favouriteGroups'

function readStorage() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') } catch { return [] }
}

export function useFavouriteGroups(myGroups = []) {
  const [favourites, setFavourites] = useState(readStorage)
  const apiFetch = useApiFetch()

  useEffect(() => {
    apiFetch('/api/players/preferences')
      .then(r => r.ok ? r.json() : {})
      .then(data => {
        // Only update if the API explicitly returned an array — ignore error/empty responses
        // so a failed save doesn't silently wipe what's already in localStorage.
        if (!Array.isArray(data.favourite_groups)) return
        setFavourites(data.favourite_groups)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data.favourite_groups))
      })
      .catch(() => {})
  }, [apiFetch])

  async function toggleFavourite(g) {
    const key = `${g.team_id}:${g.season_id}`
    const next = favourites.some(f => `${f.team_id}:${f.season_id}` === key)
      ? favourites.filter(f => `${f.team_id}:${f.season_id}` !== key)
      : [...favourites, { team_id: g.team_id, season_id: g.season_id }]
    setFavourites(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    await apiFetch('/api/players/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favourite_groups: next }),
    }).catch(() => {})
  }

  // Filter to groups the user still has access to
  const validFavourites = favourites.filter(f =>
    myGroups.some(g => g.team_id === f.team_id && g.season_id === f.season_id)
  )

  return { favourites: validFavourites, toggleFavourite }
}
