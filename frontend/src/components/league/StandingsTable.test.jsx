import { render, screen } from '@testing-library/react'
import StandingsTable from './StandingsTable'
import { setOurMarkers } from '../../utils/cricket'

const TEAMS = [
  {
    teamId: 1,
    teamName: 'Woking & Horsell CC 1st XI',
    currentPos: 1,
    currentPts: 240,
    pointsHistogram: { p10: 230, p90: 260 }
  },
  {
    teamId: 2,
    teamName: 'Guildford CC',
    currentPos: 2,
    currentPts: 220,
    pointsHistogram: { p10: 200, p90: 235 }
  }
]

describe('StandingsTable', () => {
  beforeEach(() => {
    setOurMarkers(['woking'])
  })

  it('renders a row per team with position, points and projected range', () => {
    render(<StandingsTable teams={TEAMS} />)
    expect(screen.getByText('240')).toBeInTheDocument()
    expect(screen.getByText('220')).toBeInTheDocument()
    expect(screen.getByText('230–260')).toBeInTheDocument()
    expect(screen.getByText('200–235')).toBeInTheDocument()
  })

  it('shortens team names via shortTeam', () => {
    render(<StandingsTable teams={TEAMS} />)
    expect(screen.getByText('WHCC 1st XI')).toBeInTheDocument()
    expect(screen.getByText('Guildford CC')).toBeInTheDocument()
  })

  it('highlights the row for our team', () => {
    render(<StandingsTable teams={TEAMS} />)
    const ourRow = screen.getByText('WHCC 1st XI').closest('tr')
    const theirRow = screen.getByText('Guildford CC').closest('tr')
    expect(ourRow.style.fontWeight).toBe('700')
    expect(theirRow.style.fontWeight).toBe('')
  })

  it('renders an empty table body when given no teams', () => {
    render(<StandingsTable teams={[]} />)
    expect(screen.getByText('Pos')).toBeInTheDocument()
    expect(screen.queryByRole('row')).toBeInTheDocument() // header row only
  })
})
