import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { usePlayerStats } from './usePlayerStats'

const mockApiFetch = vi.fn()

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue('tok') })
}))

vi.mock('./useApiFetch', () => ({
  useApiFetch: () => mockApiFetch
}))

function setupFetch(batting, bowling) {
  mockApiFetch.mockImplementation((url) => {
    if (url.includes('/batting')) return Promise.resolve({ json: () => Promise.resolve(batting) })
    if (url.includes('/bowling')) return Promise.resolve({ json: () => Promise.resolve(bowling) })
    return Promise.resolve({ json: () => Promise.resolve({}) })
  })
}

describe('usePlayerStats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts in loading state', () => {
    setupFetch({ years: [] }, { years: [] })
    const { result } = renderHook(() => usePlayerStats(1, null, null))
    expect(result.current.loading).toBe(true)
  })

  it('resolves batting and bowling data and clears loading', async () => {
    const batting = { runs: 100, years: [2024, 2025] }
    const bowling = { wickets: 10, years: [2024] }
    setupFetch(batting, bowling)

    const { result } = renderHook(() => usePlayerStats(1, null, null))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.batting).toEqual(batting)
    expect(result.current.bowling).toEqual(bowling)
  })

  it('merges and deduplicates years from both innings, sorted descending', async () => {
    setupFetch({ years: [2023, 2025] }, { years: [2024, 2025] })
    const { result } = renderHook(() => usePlayerStats(1, null, null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.allYears).toEqual([2025, 2024, 2023])
  })

  it('does not populate allYears when a year filter is active', async () => {
    setupFetch({ years: [2024] }, { years: [2024] })
    const { result } = renderHook(() => usePlayerStats(1, '2024', null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.allYears).toEqual([])
  })

  it('appends year and team as query params', async () => {
    setupFetch({}, {})
    const { result } = renderHook(() => usePlayerStats(42, '2024', 'Whirlwinds'))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('year=2024'))
    expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('team=Whirlwinds'))
  })

  it('fetches the correct player id in the URL', async () => {
    setupFetch({}, {})
    const { result } = renderHook(() => usePlayerStats(99, null, null))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('/api/players/99/batting'))
    expect(mockApiFetch).toHaveBeenCalledWith(expect.stringContaining('/api/players/99/bowling'))
  })

  it('clears loading on fetch error', async () => {
    mockApiFetch.mockRejectedValue(new Error('network'))
    const { result } = renderHook(() => usePlayerStats(1, null, null))
    await waitFor(() => expect(result.current.loading).toBe(false))
  })
})
