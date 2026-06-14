import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useFavouriteGroups } from './useFavouriteGroups'

const mockApiFetch = vi.fn()

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue('tok') })
}))

vi.mock('./useApiFetch', () => ({
  useApiFetch: () => mockApiFetch
}))

const STORAGE_KEY = 'edge.favouriteGroups'

describe('useFavouriteGroups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    // Default: API returns no favourite_groups (ignored by the hook)
    mockApiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
  })

  it('starts with empty favourites when localStorage is empty', () => {
    const { result } = renderHook(() => useFavouriteGroups([]))
    expect(result.current.favourites).toEqual([])
  })

  it('reads saved favourites from localStorage on mount', () => {
    const saved = [{ team_id: 1, season_id: 1 }]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
    const { result } = renderHook(() => useFavouriteGroups([{ team_id: 1, season_id: 1 }]))
    expect(result.current.favourites).toEqual(saved)
  })

  it('syncs favourites from API when it returns an array', async () => {
    const apiGroups = [{ team_id: 2, season_id: 3 }]
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ favourite_groups: apiGroups })
    })
    const myGroups = [{ team_id: 2, season_id: 3 }]
    const { result } = renderHook(() => useFavouriteGroups(myGroups))
    await waitFor(() => expect(result.current.favourites).toEqual(apiGroups))
  })

  it('ignores API response when favourite_groups is not an array', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ team_id: 1, season_id: 1 }]))
    mockApiFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ favourite_groups: null })
    })
    const myGroups = [{ team_id: 1, season_id: 1 }]
    const { result } = renderHook(() => useFavouriteGroups(myGroups))
    // localStorage value should be preserved since API returned null
    await waitFor(() => expect(result.current.favourites).toEqual([{ team_id: 1, season_id: 1 }]))
  })

  it('filters favourites to only groups the user has access to', () => {
    const saved = [
      { team_id: 1, season_id: 1 },
      { team_id: 2, season_id: 2 }
    ]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
    const { result } = renderHook(() => useFavouriteGroups([{ team_id: 1, season_id: 1 }]))
    expect(result.current.favourites).toEqual([{ team_id: 1, season_id: 1 }])
    expect(result.current.favourites).not.toContainEqual({ team_id: 2, season_id: 2 })
  })

  it('toggleFavourite adds a group that is not already favourited', async () => {
    const myGroups = [{ team_id: 1, season_id: 1 }]
    const { result } = renderHook(() => useFavouriteGroups(myGroups))
    await act(async () => {
      await result.current.toggleFavourite({ team_id: 1, season_id: 1 })
    })
    expect(result.current.favourites).toContainEqual({ team_id: 1, season_id: 1 })
  })

  it('toggleFavourite removes a group that is already favourited', async () => {
    const saved = [{ team_id: 1, season_id: 1 }]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
    const myGroups = [{ team_id: 1, season_id: 1 }]
    const { result } = renderHook(() => useFavouriteGroups(myGroups))
    await act(async () => {
      await result.current.toggleFavourite({ team_id: 1, season_id: 1 })
    })
    expect(result.current.favourites).not.toContainEqual({ team_id: 1, season_id: 1 })
  })

  it('persists toggled favourites to localStorage', async () => {
    const myGroups = [{ team_id: 5, season_id: 5 }]
    const { result } = renderHook(() => useFavouriteGroups(myGroups))
    await act(async () => {
      await result.current.toggleFavourite({ team_id: 5, season_id: 5 })
    })
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    expect(stored).toContainEqual({ team_id: 5, season_id: 5 })
  })

  it('calls the preferences API on toggle', async () => {
    const myGroups = [{ team_id: 3, season_id: 3 }]
    const { result } = renderHook(() => useFavouriteGroups(myGroups))
    await act(async () => {
      await result.current.toggleFavourite({ team_id: 3, season_id: 3 })
    })
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/api/players/preferences',
      expect.objectContaining({ method: 'POST' })
    )
  })
})
