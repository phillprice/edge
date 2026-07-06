import { screen, waitFor } from '@testing-library/react'
import { renderPage } from '../test-utils'
import PlayerList from './PlayerList'

const mockGetToken = vi.fn().mockResolvedValue('test-token')
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
  useUser: () => ({ user: { publicMetadata: {} } })
}))

function mockPlayerListResponses() {
  global.fetch = vi.fn((url) => {
    if (url.includes('/api/players/partnerships')) {
      return Promise.resolve({ ok: true, json: async () => [] })
    }
    if (url.includes('/api/players/stats')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          players: [
            {
              player_id: 1,
              name: 'Sam Smith',
              games_attended: 10,
              innings: 9,
              runs: 350,
              bat_avg_per_game: 35
            }
          ]
        })
      })
    }
    // /api/players/preferences and anything else
    return Promise.resolve({
      ok: true,
      json: async () => ({ columns: ['MAT', 'INN', 'RUNS', 'AVG'] })
    })
  })
}

describe('PlayerList page', () => {
  it('renders the players heading and loaded player rows', async () => {
    mockPlayerListResponses()
    renderPage(<PlayerList />, { route: '/players' })
    await waitFor(() => expect(screen.getByText(/Player/)).toBeInTheDocument())
    // Player names render via dn(), which defaults to first-name-only display.
    await waitFor(() => expect(screen.getAllByText('Sam').length).toBeGreaterThan(0))
    expect(screen.getAllByText('350').length).toBeGreaterThan(0)
  })
})
