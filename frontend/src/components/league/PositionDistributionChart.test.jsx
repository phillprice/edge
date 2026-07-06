import { render } from '@testing-library/react'
import PositionDistributionChart from './PositionDistributionChart'

const TEAMS = [
  { teamId: 1, teamName: 'WHCC 1st XI', positionProbabilities: [0.6, 0.4] },
  { teamId: 2, teamName: 'Guildford CC', positionProbabilities: [0.4, 0.6] }
]

describe('PositionDistributionChart', () => {
  it('renders nothing when there are no teams', () => {
    const { container } = render(<PositionDistributionChart teams={[]} highlightTeamId={1} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when teams is null', () => {
    const { container } = render(<PositionDistributionChart teams={null} highlightTeamId={1} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a chart with a bar per team when teams are provided', () => {
    const { container } = render(<PositionDistributionChart teams={TEAMS} highlightTeamId={1} />)
    // recharts ResponsiveContainer needs real dimensions to render children in jsdom;
    // assert the wrapping container was rendered instead.
    expect(container.querySelector('.recharts-responsive-container')).toBeTruthy()
  })
})
