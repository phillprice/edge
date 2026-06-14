import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useApiFetch } from './useApiFetch'

const mockGetToken = vi.fn()

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mockGetToken })
}))

describe('useApiFetch', () => {
  beforeEach(() => {
    mockGetToken.mockResolvedValue('test-token')
    global.fetch = vi.fn().mockResolvedValue({ ok: true })
  })

  it('returns a callable function', () => {
    const { result } = renderHook(() => useApiFetch())
    expect(typeof result.current).toBe('function')
  })

  it('attaches Authorization header when a token is available', async () => {
    const { result } = renderHook(() => useApiFetch())
    await result.current('/api/test')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' })
      })
    )
  })

  it('merges caller-supplied headers with the auth header', async () => {
    const { result } = renderHook(() => useApiFetch())
    await result.current('/api/test', { headers: { 'Content-Type': 'application/json' } })
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json'
        })
      })
    )
  })

  it('omits Authorization header when token is null', async () => {
    mockGetToken.mockResolvedValue(null)
    const { result } = renderHook(() => useApiFetch())
    await result.current('/api/test')
    const headers = global.fetch.mock.calls[0][1].headers
    expect(headers.Authorization).toBeUndefined()
  })

  it('passes through method and body options to fetch', async () => {
    const { result } = renderHook(() => useApiFetch())
    await result.current('/api/test', { method: 'POST', body: 'payload' })
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({ method: 'POST', body: 'payload' })
    )
  })
})
