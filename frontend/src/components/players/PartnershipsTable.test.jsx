import { render, screen, fireEvent } from '@testing-library/react'
import { PartnershipsTable } from './PartnershipsTable'
import { setNameFormat } from '../../utils/cricket'

const PARTNERS = [
  {
    p1_id: 1,
    p1_name: 'Sam Smith',
    p2_id: 2,
    p2_name: 'Leo Brown',
    stands: 5,
    total_runs: 200,
    best_stand: 80,
    avg_stand: 40
  }
]

describe('PartnershipsTable', () => {
  beforeEach(() => {
    setNameFormat('full')
  })

  it('renders a row per partnership with both player names', () => {
    render(
      <PartnershipsTable
        sortedPartners={PARTNERS}
        sort={{ key: 'stands', dir: 1 }}
        onSort={() => {}}
        navigate={() => {}}
      />
    )
    expect(screen.getByText('Sam Smith')).toBeInTheDocument()
    expect(screen.getByText('Leo Brown')).toBeInTheDocument()
    expect(screen.getByText('200')).toBeInTheDocument()
  })

  it('navigates to the first player when their name is clicked', () => {
    const navigate = vi.fn()
    render(
      <PartnershipsTable
        sortedPartners={PARTNERS}
        sort={{ key: 'stands', dir: 1 }}
        onSort={() => {}}
        navigate={navigate}
      />
    )
    fireEvent.click(screen.getByText('Sam Smith'))
    expect(navigate).toHaveBeenCalledWith('/player/1')
  })

  it('navigates to the second player when their name is clicked', () => {
    const navigate = vi.fn()
    render(
      <PartnershipsTable
        sortedPartners={PARTNERS}
        sort={{ key: 'stands', dir: 1 }}
        onSort={() => {}}
        navigate={navigate}
      />
    )
    fireEvent.click(screen.getByText('Leo Brown'))
    expect(navigate).toHaveBeenCalledWith('/player/2')
  })

  it('renders an empty body with no rows when given no partners', () => {
    render(
      <PartnershipsTable
        sortedPartners={[]}
        sort={{ key: 'stands', dir: 1 }}
        onSort={() => {}}
        navigate={() => {}}
      />
    )
    expect(screen.getByText('Partnership')).toBeInTheDocument()
    expect(screen.queryByText('Sam Smith')).not.toBeInTheDocument()
  })
})
