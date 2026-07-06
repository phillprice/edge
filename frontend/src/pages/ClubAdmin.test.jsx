import { render, screen, waitFor } from '@testing-library/react'
import ClubAdmin from './ClubAdmin'

const mockGetToken = vi.fn().mockResolvedValue('test-token')
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
  useUser: () => ({ user: { publicMetadata: {} } })
}))

describe('ClubAdmin', () => {
  it('shows a loading state, then the club settings for a non-super-admin', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1, name: 'Woking & Horsell CC' })
    })
    render(<ClubAdmin />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument())
  })

  it('shows an error message when the club fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Nope' }) })
    render(<ClubAdmin />)
    await waitFor(() => expect(screen.getByText('Nope')).toBeInTheDocument())
  })
})
