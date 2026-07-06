import { render, screen } from '@testing-library/react'
import FixtureExplanations from './FixtureExplanations'

const BASE_FIXTURE = {
  homeTeam: 'Woking & Horsell CC 1st XI',
  awayTeam: 'Guildford CC',
  homeSeasonWinPct: 60,
  homeRecentWinPct: 70,
  awaySeasonWinPct: 40,
  awayRecentWinPct: null,
  h2hNudge: null,
  homeWinProbability: 55,
  awayWinProbability: 35,
  tieProbability: 10
}

describe('FixtureExplanations', () => {
  it('renders nothing when there are no fixtures', () => {
    const { container } = render(<FixtureExplanations fixtures={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when fixtures is null', () => {
    const { container } = render(<FixtureExplanations fixtures={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the heading and a row per fixture', () => {
    render(<FixtureExplanations fixtures={[BASE_FIXTURE]} />)
    expect(screen.getByText('How these odds were calculated')).toBeInTheDocument()
    expect(screen.getByText('WHCC 1st XI vs Guildford CC')).toBeInTheDocument()
  })

  it('shows season and recent win rates, omitting recent when null', () => {
    render(<FixtureExplanations fixtures={[BASE_FIXTURE]} />)
    expect(screen.getByText(/WHCC 1st XI season win rate: 60%, last 10: 70%/)).toBeInTheDocument()
    expect(screen.getByText(/Guildford CC season win rate: 40%/)).toBeInTheDocument()
  })

  it('shows "no data" when a win pct is null', () => {
    render(<FixtureExplanations fixtures={[{ ...BASE_FIXTURE, awaySeasonWinPct: null }]} />)
    expect(screen.getByText(/Guildford CC season win rate: no data/)).toBeInTheDocument()
  })

  it('renders the head-to-head nudge text when present', () => {
    render(<FixtureExplanations fixtures={[{ ...BASE_FIXTURE, h2hNudge: 'homeWin' }]} />)
    expect(screen.getByText(/WHCC 1st XI won their last meeting/)).toBeInTheDocument()
  })

  it('renders tie h2h nudge text', () => {
    render(<FixtureExplanations fixtures={[{ ...BASE_FIXTURE, h2hNudge: 'tie' }]} />)
    expect(screen.getByText(/their last meeting was a tie/)).toBeInTheDocument()
  })

  it('renders the estimated odds line', () => {
    render(<FixtureExplanations fixtures={[BASE_FIXTURE]} />)
    expect(
      screen.getByText(/Estimated odds: WHCC 1st XI 55% · Guildford CC 35% · tie 10%/)
    ).toBeInTheDocument()
  })
})
