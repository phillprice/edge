import { screen, waitFor } from '@testing-library/react'
import { renderPage, mockFetchJson } from '../test-utils'
import Season from './Season'

vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue('test-token') })
}))

describe('Season page', () => {
  it('renders the heading and loads season summary data', async () => {
    mockFetchJson({
      record: { played: 10, won: 6, lost: 4 },
      match_scores: [{ date: '2024-05-01', our_score: 180, result: 'won', fixture_id: 1 }],
      batting: { total_runs: 1000, bat_avg: 30, run_rate: 5.5 },
      bowling: { wickets: 50, bowl_avg: 20, econ: 4.5 }
    })
    renderPage(<Season />, { route: '/season' })
    expect(screen.getByText('Season summary')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByText('Loading season summary…')).not.toBeInTheDocument()
    )
  })

  it('shows an empty state when there is no data', async () => {
    mockFetchJson(null)
    renderPage(<Season />, { route: '/season' })
    await waitFor(() => expect(screen.getByText('No data available.')).toBeInTheDocument())
  })
})
