import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BattingChart, BowlingChart, KeepingChart } from './PlayerCharts'

const mockGetToken = vi.fn().mockResolvedValue('test-token')
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mockGetToken })
}))

function mockSeriesResponse(matches) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ matches })
  })
}

const TWO_BATTING_MATCHES = [
  {
    fixture_id: 1,
    match_date_iso: '2024-05-01T00:00:00Z',
    home_team: 'WHCC 1st XI',
    away_team: 'Guildford CC',
    bat_runs: 40,
    bat_balls: 30,
    bat_dismissed: true,
    bowl_wickets: null,
    bowl_runs: null,
    bowl_legal_balls: null,
    keep_byes: null
  },
  {
    fixture_id: 2,
    match_date_iso: '2024-05-08T00:00:00Z',
    home_team: 'WHCC 1st XI',
    away_team: 'Farnham CC',
    bat_runs: 60,
    bat_balls: 45,
    bat_dismissed: false,
    bowl_wickets: null,
    bowl_runs: null,
    bowl_legal_balls: null,
    keep_byes: null
  }
]

describe('BattingChart', () => {
  it('renders nothing when fewer than two batting innings exist', async () => {
    mockSeriesResponse([TWO_BATTING_MATCHES[0]])
    const { container } = render(<BattingChart playerId={1} canAdmin={false} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('renders heading and mode picker once there are two or more innings', async () => {
    mockSeriesResponse(TWO_BATTING_MATCHES)
    render(<BattingChart playerId={1} canAdmin={false} />)
    expect(await screen.findByText('Batting over time')).toBeInTheDocument()
    expect(screen.getByText('Game-by-game')).toBeInTheDocument()
    expect(screen.getByText('Calendar')).toBeInTheDocument()
  })

  it('switches to calendar mode when clicked', async () => {
    mockSeriesResponse(TWO_BATTING_MATCHES)
    render(<BattingChart playerId={1} canAdmin={false} />)
    await screen.findByText('Batting over time')
    fireEvent.click(screen.getByText('Calendar'))
    expect(screen.getByText('Calendar').className).toContain('active')
  })

  it('does not show highlight management for non-admins', async () => {
    mockSeriesResponse(TWO_BATTING_MATCHES)
    render(<BattingChart playerId={1} canAdmin={false} />)
    await screen.findByText('Batting over time')
    expect(screen.queryByText('Manage highlights')).not.toBeInTheDocument()
  })

  it('shows highlight management toggle for admins', async () => {
    mockSeriesResponse(TWO_BATTING_MATCHES)
    render(<BattingChart playerId={1} canAdmin />)
    expect(await screen.findByText('Manage highlights')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Manage highlights'))
    expect(screen.getByText('Hide')).toBeInTheDocument()
  })
})

describe('BowlingChart', () => {
  it('renders nothing when fewer than two bowling innings exist', async () => {
    mockSeriesResponse([
      {
        ...TWO_BATTING_MATCHES[0],
        bat_runs: null,
        bowl_wickets: 2,
        bowl_runs: 30,
        bowl_legal_balls: 36
      }
    ])
    const { container } = render(<BowlingChart playerId={1} canAdmin={false} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('renders heading once there are two or more bowling innings', async () => {
    mockSeriesResponse([
      {
        ...TWO_BATTING_MATCHES[0],
        bat_runs: null,
        bowl_wickets: 2,
        bowl_runs: 30,
        bowl_legal_balls: 36
      },
      {
        ...TWO_BATTING_MATCHES[1],
        bat_runs: null,
        bowl_wickets: 1,
        bowl_runs: 25,
        bowl_legal_balls: 30
      }
    ])
    render(<BowlingChart playerId={1} canAdmin={false} />)
    expect(await screen.findByText('Bowling over time')).toBeInTheDocument()
  })
})

describe('KeepingChart', () => {
  it('renders nothing when fewer than two keeping innings exist', async () => {
    mockSeriesResponse([{ ...TWO_BATTING_MATCHES[0], bat_runs: null, keep_byes: 3 }])
    const { container } = render(<KeepingChart playerId={1} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('renders heading once there are two or more keeping innings', async () => {
    mockSeriesResponse([
      { ...TWO_BATTING_MATCHES[0], bat_runs: null, keep_byes: 3 },
      { ...TWO_BATTING_MATCHES[1], bat_runs: null, keep_byes: 1 }
    ])
    render(<KeepingChart playerId={1} />)
    expect(await screen.findByText('Keeping over time')).toBeInTheDocument()
  })
})
