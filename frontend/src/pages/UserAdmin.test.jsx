import { render, screen, waitFor } from '@testing-library/react'
import UserAdmin from './UserAdmin'

const mockGetToken = vi.fn().mockResolvedValue('test-token')
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mockGetToken })
}))

describe('UserAdmin', () => {
  it('shows a loading state, then the requests tab content', async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes('/api/admin/users'))
        return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/api/admin/teams'))
        return Promise.resolve({ ok: true, json: async () => [] })
      if (url.includes('/api/access-requests'))
        return Promise.resolve({ ok: true, json: async () => [] })
      return Promise.resolve({ ok: true, json: async () => ({}) })
    })
    render(<UserAdmin />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())
  })

  it('shows an error message when the users fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Boom' }) })
    render(<UserAdmin />)
    await waitFor(() => expect(screen.getByText('Boom')).toBeInTheDocument())
  })
})
