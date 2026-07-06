import { render, screen, waitFor } from '@testing-library/react'
import ClubInvites from './ClubInvites'

const mockGetToken = vi.fn().mockResolvedValue('test-token')
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mockGetToken })
}))

describe('ClubInvites', () => {
  it('renders the invite-links header and loads existing invites', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { token: 'abc123', expiresAt: new Date(Date.now() + 86400000).toISOString(), usedAt: null }
      ]
    })
    render(<ClubInvites clubId={1} />)
    expect(screen.getByText('Invite links')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('New link')).toBeInTheDocument())
    expect(await screen.findByText(/\/invite\?token=abc123/)).toBeInTheDocument()
  })
})
