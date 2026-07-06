import { screen, waitFor } from '@testing-library/react'
import { renderPage } from '../test-utils'
import PlayerDetail from './PlayerDetail'

const mockGetToken = vi.fn().mockResolvedValue('test-token')
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
  useUser: () => ({ user: { publicMetadata: {} } })
}))

function mockPlayerDetailResponses() {
  global.fetch = vi.fn((url) => {
    if (url.includes('/batting')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          player: { player_id: 7, name: 'Sam Smith', team: 'WHCC 1st XI' },
          years: [2024],
          innings: [],
          totals: { innings: 10, runs: 350, highScore: 80, average: 35, strikeRate: 110 }
        })
      })
    }
    if (url.includes('/bowling')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          player: { player_id: 7, name: 'Sam Smith' },
          years: [2024],
          innings: [],
          totals: { innings: 5, wickets: 8, runs: 150, average: 18, economy: 4.2 }
        })
      })
    }
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

describe('PlayerDetail page', () => {
  it('shows a loading state, then the player name', async () => {
    mockPlayerDetailResponses()
    renderPage(<PlayerDetail />, { route: '/player/7', path: '/player/:id' })
    expect(screen.getByText('Loading player stats…')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText(/Sam/).length).toBeGreaterThan(0))
  })
})
