import { render, screen, fireEvent } from '@testing-library/react'
import { BattingTable, BowlingTable, OversGrid, OversTable } from './ScorecardTables'

describe('BattingTable', () => {
  it('shows an empty message when there is no batting data', () => {
    render(<BattingTable batting={[]} navigate={() => {}} isPairs={false} matchId={1} />)
    expect(screen.getByText('No batting data')).toBeInTheDocument()
  })

  it('renders batter rows with runs, balls, dismissal info', () => {
    const batting = [
      {
        player_id: 1,
        name: 'Sam Smith',
        runs: 45,
        balls: 30,
        fours: 5,
        sixes: 1,
        dismissed: true,
        dismissalDesc: 'b Jones',
        did_not_bat: false
      }
    ]
    render(<BattingTable batting={batting} navigate={() => {}} isPairs={false} matchId={1} />)
    expect(screen.getByText('Sam Smith')).toBeInTheDocument()
    expect(screen.getByText('45')).toBeInTheDocument()
    expect(screen.getByText('b Jones')).toBeInTheDocument()
  })

  it('navigates to the player page when a linked batter name is clicked', () => {
    const navigate = vi.fn()
    const batting = [
      { player_id: 7, name: 'Sam Smith', runs: 10, balls: 8, fours: 1, sixes: 0, dismissed: false }
    ]
    render(<BattingTable batting={batting} navigate={navigate} isPairs={false} matchId={3} />)
    fireEvent.click(screen.getByText('Sam Smith'))
    expect(navigate).toHaveBeenCalledWith('/player/7', { state: { from: '/match/3' } })
  })

  it('shows dashes for did-not-bat rows', () => {
    const batting = [{ player_id: 2, name: 'Bench Player', did_not_bat: true, runs: 0, balls: 0 }]
    render(<BattingTable batting={batting} navigate={() => {}} isPairs={false} matchId={1} />)
    expect(screen.getByText('not out')).toBeInTheDocument()
  })

  it('renders pairs-mode columns (R/Out/Net/B) instead of dismissal info', () => {
    const batting = [
      { player_id: 1, name: 'Pair A', runs: 40, timesOut: 1, netScore: 35, balls: 25 }
    ]
    render(<BattingTable batting={batting} navigate={() => {}} isPairs matchId={1} />)
    expect(screen.getByText('Out')).toBeInTheDocument()
    expect(screen.getByText('Net')).toBeInTheDocument()
    expect(screen.getByText('35')).toBeInTheDocument()
  })
})

describe('BowlingTable', () => {
  it('shows an empty message when there is no bowling data', () => {
    render(<BowlingTable bowling={[]} navigate={() => {}} />)
    expect(screen.getByText('No bowling data')).toBeInTheDocument()
  })

  it('renders bowler figures', () => {
    const bowling = [
      {
        player_id: 1,
        name: 'Jo Bowler',
        overs: '8.0',
        maidens: 1,
        runs: 30,
        wickets: 3,
        wides: 2,
        noBalls: 0,
        economy: '3.75'
      }
    ]
    render(<BowlingTable bowling={bowling} navigate={() => {}} />)
    expect(screen.getByText('Jo Bowler')).toBeInTheDocument()
    expect(screen.getByText('3.75')).toBeInTheDocument()
  })

  it('toggles spell breakdown when the expand button is clicked', () => {
    const bowling = [
      {
        player_id: 1,
        name: 'Jo Bowler',
        overs: '8.0',
        maidens: 1,
        runs: 30,
        wickets: 3,
        wides: 0,
        noBalls: 0,
        economy: '3.75',
        spells: [
          { from_over: 0, to_over: 3, balls: 24, maidens: 1, runs: 15, wickets: 2 },
          { from_over: 10, to_over: 13, balls: 24, maidens: 0, runs: 15, wickets: 1 }
        ]
      }
    ]
    render(<BowlingTable bowling={bowling} navigate={() => {}} />)
    expect(screen.queryByText(/Spell 1:/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Show spell breakdown'))
    expect(screen.getByText(/Spell 1:/)).toBeInTheDocument()
    expect(screen.getByText(/Spell 2:/)).toBeInTheDocument()
  })
})

describe('OversTable', () => {
  it('shows an empty message when there are no overs', () => {
    render(<OversTable overs={[]} />)
    expect(screen.getByText('No over data')).toBeInTheDocument()
  })

  it('renders an economy rate per over', () => {
    const overs = [
      {
        over: 1,
        bowler: 'Jo Bowler',
        runs: 6,
        wickets: 0,
        balls: [
          { extras_type: null },
          { extras_type: null },
          { extras_type: null },
          { extras_type: null },
          { extras_type: null },
          { extras_type: null }
        ]
      }
    ]
    render(<OversTable overs={overs} />)
    expect(screen.getByText('Jo Bowler')).toBeInTheDocument()
    expect(screen.getByText('6.0')).toBeInTheDocument()
  })
})

describe('OversGrid', () => {
  it('shows an empty message when there are no overs', () => {
    render(<OversGrid overs={[]} />)
    expect(screen.getByText('No over data')).toBeInTheDocument()
  })

  it('renders ball-by-ball circles for an over', () => {
    const overs = [
      {
        over: 1,
        bowler: 'Jo Bowler',
        runs: 10,
        wickets: 1,
        balls: [
          { runs_bat: 4, s_desc: '4', extras_type: null },
          { runs_bat: 6, s_desc: '6', extras_type: null },
          { wicket: true, s_desc: 'W', extras_type: null }
        ]
      }
    ]
    render(<OversGrid overs={overs} />)
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('W')).toBeInTheDocument()
    expect(screen.getByText('Jo Bowler')).toBeInTheDocument()
  })

  it('calls onEditBall when a ball is clicked', () => {
    const onEditBall = vi.fn()
    const ball = { runs_bat: 4, s_desc: '4', extras_type: null }
    const overs = [{ over: 1, bowler: 'Jo Bowler', runs: 4, wickets: 0, balls: [ball] }]
    render(<OversGrid overs={overs} onEditBall={onEditBall} />)
    fireEvent.click(screen.getByTitle('Edit delivery'))
    expect(onEditBall).toHaveBeenCalledWith(ball)
  })
})
