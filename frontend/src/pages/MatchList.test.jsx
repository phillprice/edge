import { screen, waitFor } from '@testing-library/react'
import { renderPage, mockFetchJson } from '../test-utils'
import MatchList from './MatchList'

const mockGetToken = vi.fn().mockResolvedValue('test-token')
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mockGetToken })
}))

describe('MatchList page', () => {
  it('renders the heading and loaded matches', async () => {
    mockFetchJson({
      matches: [
        {
          fixture_id: 1,
          home_team: 'WHCC 1st XI',
          away_team: 'Guildford CC',
          match_date: '2024-05-01',
          match_type: 'league'
        }
      ],
      total: 1
    })
    renderPage(<MatchList />, { route: '/' })
    await waitFor(() => expect(screen.getByText('Matches')).toBeInTheDocument())
    expect(await screen.findByText(/Guildford CC/)).toBeInTheDocument()
  })

  it('renders without throwing when there are no matches', async () => {
    mockFetchJson({ matches: [], total: 0 })
    renderPage(<MatchList />, { route: '/' })
    await waitFor(() => expect(screen.getByText('Matches')).toBeInTheDocument())
  })
})
