import { render, screen } from '@testing-library/react'
import LeagueHeaderCard from './LeagueHeaderCard'

describe('LeagueHeaderCard', () => {
  it('renders the heading and description', () => {
    render(<LeagueHeaderCard tieBreakNote="Ties broken by net run rate." />)
    expect(screen.getByText('League Predictor')).toBeInTheDocument()
    expect(
      screen.getByText(/Exact odds computed across every possible combination/)
    ).toBeInTheDocument()
  })

  it('renders the tie-break note passed in', () => {
    render(<LeagueHeaderCard tieBreakNote="Ties broken by net run rate." />)
    expect(screen.getByText('Ties broken by net run rate.')).toBeInTheDocument()
  })
})
