import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MvpCard from './MvpCard'
import { GroupContext } from '../../GroupContext'

const dn = (x) => x

const MVP = [
  {
    playerId: 1,
    name: 'Sam Smith',
    total: 25,
    bat: 20,
    bowl: 5,
    field: 0,
    batBase: 20,
    batSR: 130,
    batSRBonus: 2,
    bowlHaulBonus: 0,
    bowlMaidenBonus: 0
  },
  {
    playerId: 2,
    name: 'Leo Brown',
    total: 18,
    bat: 0,
    bowl: 18,
    field: 0,
    batBase: 0,
    batSR: 0,
    batSRBonus: 0,
    bowlHaulBonus: 1,
    bowlMaidenBonus: 0.5
  },
  {
    playerId: 3,
    name: 'Ash Grey',
    total: 10,
    bat: 5,
    bowl: 0,
    field: 5,
    batBase: 5,
    batSR: 90,
    batSRBonus: 0,
    bowlHaulBonus: 0,
    bowlMaidenBonus: 0
  }
]

function renderWithRouter(ui, { showMvp = true } = {}) {
  return render(
    <GroupContext.Provider value={{ showMvp }}>
      <MemoryRouter>{ui}</MemoryRouter>
    </GroupContext.Provider>
  )
}

describe('MvpCard', () => {
  it('renders nothing when mvp list is empty', () => {
    const { container } = renderWithRouter(<MvpCard mvp={[]} meta={{}} dn={dn} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when showMvp is false', () => {
    const { container } = renderWithRouter(<MvpCard mvp={MVP} meta={{}} dn={dn} />, {
      showMvp: false
    })
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the top 3 MVP rows with points', () => {
    renderWithRouter(<MvpCard mvp={MVP} meta={{}} dn={dn} />)
    expect(screen.getByText('Match MVP')).toBeInTheDocument()
    expect(screen.getByText('Sam Smith')).toBeInTheDocument()
    expect(screen.getByText('25 pts')).toBeInTheDocument()
    expect(screen.getByText('Leo Brown')).toBeInTheDocument()
    expect(screen.getByText('Ash Grey')).toBeInTheDocument()
  })

  it('toggles the formula breakdown panel', () => {
    renderWithRouter(<MvpCard mvp={MVP} meta={{}} dn={dn} />)
    expect(screen.queryByText(/CricHeroes MVP algorithm/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(/How is this calculated/))
    expect(screen.getByText(/CricHeroes MVP algorithm/)).toBeInTheDocument()
  })
})
