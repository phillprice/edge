import { render, screen, waitFor } from '@testing-library/react'
import RequestAccessPage from './RequestAccessPage'

const mockGetToken = vi.fn().mockResolvedValue('test-token')
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mockGetToken })
}))

describe('RequestAccessPage', () => {
  it('shows a loading state, then the list of teams', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ team_id: 1, season_id: 2024, team_label: 'WHCC 1st XI', year: 2024 }]
    })
    render(<RequestAccessPage />)
    expect(screen.getByText('Loading available teams…')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText('Loading available teams…')).not.toBeInTheDocument()
    )
  })

  it('renders without throwing when there are no teams', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    render(<RequestAccessPage />)
    await waitFor(() =>
      expect(screen.queryByText('Loading available teams…')).not.toBeInTheDocument()
    )
  })
})
