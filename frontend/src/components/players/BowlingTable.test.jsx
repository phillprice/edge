import { render, screen, fireEvent } from '@testing-library/react'
import { BowlingTable } from './BowlingTable'
import { setNameFormat } from '../../utils/cricket'

const PLAYERS = [
  {
    player_id: 1,
    name: 'Jo Bowler',
    jerseyNumber: 11,
    games_attended: 10,
    games_bowled: 8,
    balls_bowled: 480,
    overs: '80.0',
    runs_conceded: 300,
    wickets: 15,
    bowl_avg: 20,
    bowl_econ: 3.75,
    wkts_per_over: 0.19,
    wides: 4,
    no_balls: 1
  }
]

const BASE_PROPS = {
  players: PLAYERS,
  sort: { key: 'wickets', dir: -1 },
  onSort: () => {},
  show: {},
  ranges: {},
  navigate: () => {},
  bowlHaulCount: 0,
  bowlWktCount: 0,
  bowlFieldCount: 0,
  bowlFirstHaul: null,
  bowlFirstWkt: null,
  bowlFirstFld: null,
  showAllCols: false,
  selectedKey: null,
  comp: null
}

describe('BowlingTable (players)', () => {
  beforeEach(() => {
    setNameFormat('full')
  })

  it('shows an empty-state message when there are no players', () => {
    render(<BowlingTable {...BASE_PROPS} players={[]} />)
    expect(screen.getByText('No bowling data yet.')).toBeInTheDocument()
  })

  it('shows a filter-specific empty message when filters are active', () => {
    render(<BowlingTable {...BASE_PROPS} players={[]} selectedKey="2024" />)
    expect(screen.getByText('No bowling data — try adjusting the filters.')).toBeInTheDocument()
  })

  it('renders player name and bowling figures', () => {
    render(<BowlingTable {...BASE_PROPS} />)
    expect(screen.getByText('Jo Bowler')).toBeInTheDocument()
    expect(screen.getByText('15')).toBeInTheDocument()
    expect(screen.getByText('3.75')).toBeInTheDocument()
  })

  it('navigates to the player page when a row is clicked', () => {
    const navigate = vi.fn()
    render(<BowlingTable {...BASE_PROPS} navigate={navigate} />)
    fireEvent.click(screen.getByText('Jo Bowler'))
    expect(navigate).toHaveBeenCalledWith('/player/1')
  })

  it('shows optional haul columns only when enabled via show', () => {
    const { rerender } = render(<BowlingTable {...BASE_PROPS} />)
    expect(screen.queryByText('5W')).not.toBeInTheDocument()
    rerender(<BowlingTable {...BASE_PROPS} show={{ five_fers: true }} bowlHaulCount={1} />)
    expect(screen.getByText('5W')).toBeInTheDocument()
  })
})
