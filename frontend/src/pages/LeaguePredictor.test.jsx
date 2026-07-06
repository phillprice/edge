import { screen, waitFor } from '@testing-library/react'
import { renderPage } from '../test-utils'
import LeaguePredictor from './LeaguePredictor'

const mockGetToken = vi.fn().mockResolvedValue('test-token')
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mockGetToken })
}))

describe('LeaguePredictor page', () => {
  it('renders standings once the prediction loads', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        tieBreakNote: 'Ties broken by net run rate.',
        teams: [
          {
            teamId: 1,
            teamName: 'WHCC 1st XI',
            currentPos: 1,
            currentPts: 240,
            pointsHistogram: { p10: 230, p90: 260 },
            positionProbabilities: [0.6, 0.4]
          },
          {
            teamId: 2,
            teamName: 'Guildford CC',
            currentPos: 2,
            currentPts: 220,
            pointsHistogram: { p10: 200, p90: 235 },
            positionProbabilities: [0.4, 0.6]
          }
        ],
        fixtureExplanations: []
      })
    })
    renderPage(<LeaguePredictor />, { route: '/league/42', path: '/league/:fixtureId' })
    expect(await screen.findByText('League Predictor')).toBeInTheDocument()
    expect(screen.getByText('WHCC 1st XI')).toBeInTheDocument()
    expect(screen.getByText('240')).toBeInTheDocument()
  })

  it('shows the error message when the fixture is not a league fixture', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 404, ok: false })
    renderPage(<LeaguePredictor />, { route: '/league/99', path: '/league/:fixtureId' })
    await waitFor(() =>
      expect(
        screen.getByText('This fixture is not a league fixture with a resolvable division.')
      ).toBeInTheDocument()
    )
  })
})
