import { render, screen, fireEvent } from '@testing-library/react'
import { BattingTable } from './BattingTable'
import { setNameFormat } from '../../utils/cricket'

const PLAYERS = [
  {
    player_id: 1,
    name: 'Sam Smith',
    jerseyNumber: 7,
    games_attended: 10,
    innings: 9,
    not_outs: 2,
    runs: 350,
    high_score: 80,
    bat_avg_per_game: 35,
    bat_sr: 120,
    balls_faced: 290,
    fours: 30,
    sixes: 5,
    times_out: 7,
    dis_bowled: 2,
    dis_caught: 4,
    dis_lbw: 1,
    dis_runout: 0,
    dis_stumped: 0
  }
]

const RANGES = {}

// `sc` decides whether a "standard" column is visible; enable them all for this test.
const sc = () => true

const BASE_PROPS = {
  players: PLAYERS,
  sort: { key: 'runs', dir: -1 },
  onSort: () => {},
  show: {},
  ranges: RANGES,
  navigate: () => {},
  sc,
  appCols: 3,
  batCols: 4,
  ballCols: 1,
  bndCols: 2,
  batDisCount: 1,
  batFirstRole: null,
  showAllCols: false
}

describe('BattingTable (players)', () => {
  beforeEach(() => {
    setNameFormat('full')
  })

  it('renders player name, runs and other batting stats', () => {
    render(<BattingTable {...BASE_PROPS} />)
    expect(screen.getByText('Sam Smith')).toBeInTheDocument()
    expect(screen.getByText('350')).toBeInTheDocument()
    expect(screen.getByText('80')).toBeInTheDocument()
  })

  it('navigates to the player page when a row is clicked', () => {
    const navigate = vi.fn()
    render(<BattingTable {...BASE_PROPS} navigate={navigate} />)
    fireEvent.click(screen.getByText('Sam Smith'))
    expect(navigate).toHaveBeenCalledWith('/player/1')
  })

  it('reflects the active sort column with an arrow', () => {
    render(<BattingTable {...BASE_PROPS} sort={{ key: 'runs', dir: -1 }} />)
    expect(screen.getByText('Runs ↓')).toBeInTheDocument()
  })

  it('calls onSort when a header is clicked', () => {
    const onSort = vi.fn()
    render(<BattingTable {...BASE_PROPS} onSort={onSort} />)
    fireEvent.click(screen.getByText(/^Runs/))
    expect(onSort).toHaveBeenCalledWith('runs')
  })

  it('shows optional columns (captain/wk) only when enabled via show', () => {
    const { rerender } = render(<BattingTable {...BASE_PROPS} />)
    expect(screen.queryByText('Capt')).not.toBeInTheDocument()
    rerender(<BattingTable {...BASE_PROPS} show={{ captain_count: true }} />)
    expect(screen.getByText('Capt')).toBeInTheDocument()
  })
})
