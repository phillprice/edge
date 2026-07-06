import { render, screen } from '@testing-library/react'
import MatchFlow, { InningsFlow } from './MatchFlow'

const dn = (name) => name

describe('InningsFlow', () => {
  it('renders nothing when flow is empty', () => {
    const { container } = render(<InningsFlow flow={[]} isOursBatting dn={dn} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when flow is null', () => {
    const { container } = render(<InningsFlow flow={null} isOursBatting dn={dn} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows batter_milestone and retirement events when our side is batting', () => {
    const flow = [
      { type: 'batter_milestone', player: 'Sam Smith', runs: 50, balls: 40, over: 12 },
      { type: 'retirement', player: 'Sam Smith', runs: 55, balls: 42, over: 12.4 }
    ]
    render(<InningsFlow flow={flow} isOursBatting dn={dn} />)
    expect(screen.getByText(/Sam Smith 50\*/)).toBeInTheDocument()
    expect(screen.getByText(/Sam Smith retired not out 55/)).toBeInTheDocument()
  })

  it('hides opposition batter_milestone and retirement events when fielding', () => {
    const flow = [
      { type: 'batter_milestone', player: 'Opp Player', runs: 50, balls: 40, over: 12 },
      { type: 'retirement', player: 'Opp Player', runs: 55, balls: 42, over: 12.4 },
      { type: 'innings_end', score: 200, wickets: 8, overs: 45 }
    ]
    render(<InningsFlow flow={flow} isOursBatting={false} dn={dn} />)
    expect(screen.queryByText(/Opp Player/)).not.toBeInTheDocument()
    expect(screen.getByText(/Innings ends: 200\/8/)).toBeInTheDocument()
  })
})

describe('MatchFlow', () => {
  const fixture = { toss_winner: 'Woking CC', toss_decision: 'bat' }
  const isOurs = (team) => team === 'WHCC'

  it('renders nothing when no scorecard has flow with more than one event', () => {
    const scorecards = [{ inningsOrder: 1, flow: [{ type: 'innings_end' }] }]
    const { container } = render(
      <MatchFlow scorecards={scorecards} roles={{}} dn={dn} isOurs={isOurs} fixture={fixture} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders toss info in the heading', () => {
    const scorecards = [
      {
        inningsOrder: 1,
        flow: [
          { type: 'wicket', player: 'A', runs: 10, balls: 8, wickets: 1, score: 20, over: 3 },
          { type: 'innings_end', score: 150, wickets: 5, overs: 40 }
        ]
      }
    ]
    render(
      <MatchFlow scorecards={scorecards} roles={{}} dn={dn} isOurs={isOurs} fixture={fixture} />
    )
    expect(screen.getByText(/Toss · Woking CC · bat/)).toBeInTheDocument()
  })

  it('hides opposition retirement events in our bowling innings (regression)', () => {
    const roles = { 1: { batting_team: 'Opposition CC' } }
    const scorecards = [
      {
        inningsOrder: 1,
        flow: [
          { type: 'retirement', player: 'Opp Batter', runs: 60, balls: 50, over: 15 },
          {
            type: 'wicket',
            player: 'Opp Batter 2',
            runs: 5,
            balls: 6,
            wickets: 1,
            score: 30,
            over: 8
          }
        ]
      }
    ]
    render(
      <MatchFlow scorecards={scorecards} roles={roles} dn={dn} isOurs={isOurs} fixture={fixture} />
    )
    expect(screen.queryByText(/Opp Batter retired/)).not.toBeInTheDocument()
  })

  it('shows retirement events in our own batting innings', () => {
    const roles = { 1: { batting_team: 'WHCC' } }
    const scorecards = [
      {
        inningsOrder: 1,
        flow: [
          { type: 'retirement', player: 'Our Batter', runs: 60, balls: 50, over: 15 },
          {
            type: 'wicket',
            player: 'Our Batter 2',
            runs: 5,
            balls: 6,
            wickets: 1,
            score: 30,
            over: 8
          }
        ]
      }
    ]
    render(
      <MatchFlow scorecards={scorecards} roles={roles} dn={dn} isOurs={isOurs} fixture={fixture} />
    )
    expect(screen.getByText(/Our Batter retired not out 60/)).toBeInTheDocument()
  })

  it('renders side-by-side team labels when there are two flowing innings', () => {
    const roles = { 1: { batting_team: 'WHCC' }, 2: { batting_team: 'Opposition CC' } }
    const scorecards = [
      {
        inningsOrder: 1,
        flow: [
          { type: 'wicket', player: 'A', runs: 10, balls: 8, wickets: 1, score: 20, over: 3 },
          { type: 'innings_end', score: 150, wickets: 5, overs: 40 }
        ]
      },
      {
        inningsOrder: 2,
        flow: [
          { type: 'wicket', player: 'B', runs: 10, balls: 8, wickets: 1, score: 20, over: 3 },
          { type: 'innings_end', score: 140, wickets: 6, overs: 40 }
        ]
      }
    ]
    render(
      <MatchFlow scorecards={scorecards} roles={roles} dn={dn} isOurs={isOurs} fixture={fixture} />
    )
    expect(screen.getByText(/WHCC batting/)).toBeInTheDocument()
    expect(screen.getByText(/Opposition CC batting/)).toBeInTheDocument()
  })
})
