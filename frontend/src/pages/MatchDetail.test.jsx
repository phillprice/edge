import { screen, waitFor } from '@testing-library/react'
import { renderPage } from '../test-utils'
import MatchDetail from './MatchDetail'

const mockGetToken = vi.fn().mockResolvedValue('test-token')
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
  useUser: () => ({ user: { publicMetadata: {} } })
}))

describe('MatchDetail page', () => {
  it('shows a "not found" message when the match has no fixture data', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    renderPage(<MatchDetail />, { route: '/match/1', path: '/match/:id' })
    await waitFor(() => expect(screen.getByText('Match not found.')).toBeInTheDocument())
  })

  it('renders match breadcrumbs and team names once loaded', async () => {
    global.fetch = vi.fn((url) => {
      if (url.includes('/roles')) return Promise.resolve({ ok: true, json: async () => ({}) })
      return Promise.resolve({
        ok: true,
        json: async () => ({
          fixture: {
            fixture_id: 1,
            home_team: 'WHCC 1st XI',
            away_team: 'Guildford CC',
            match_date: '2024-05-01'
          },
          scorecards: []
        })
      })
    })
    renderPage(<MatchDetail />, { route: '/match/1', path: '/match/:id' })
    expect(await screen.findByText(/WHCC 1st XI vs Guildford CC/)).toBeInTheDocument()
  })
})
