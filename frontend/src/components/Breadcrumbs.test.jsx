import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Breadcrumbs from './Breadcrumbs'

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('Breadcrumbs', () => {
  it('renders nothing for null items', () => {
    const { container } = renderWithRouter(<Breadcrumbs items={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for empty array', () => {
    const { container } = renderWithRouter(<Breadcrumbs items={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a navigation landmark', () => {
    renderWithRouter(<Breadcrumbs items={[{ label: 'Home' }]} />)
    expect(screen.getByRole('navigation')).toBeTruthy()
  })

  it('renders item labels', () => {
    renderWithRouter(
      <Breadcrumbs items={[{ label: 'Players', href: '/players' }, { label: 'Leo Brown' }]} />
    )
    expect(screen.getByText('Players')).toBeTruthy()
    expect(screen.getByText('Leo Brown')).toBeTruthy()
  })

  it('renders item with href as a link', () => {
    renderWithRouter(<Breadcrumbs items={[{ label: 'Players', href: '/players' }]} />)
    const link = screen.getByRole('link', { name: 'Players' })
    expect(link).toBeTruthy()
  })

  it('renders item without href as plain text (no link)', () => {
    renderWithRouter(<Breadcrumbs items={[{ label: 'Leo Brown' }]} />)
    expect(screen.queryByRole('link', { name: 'Leo Brown' })).toBeNull()
    expect(screen.getByText('Leo Brown')).toBeTruthy()
  })

  it('does not render separator after the last item', () => {
    const { container } = renderWithRouter(
      <Breadcrumbs items={[{ label: 'Players', href: '/players' }, { label: 'Leo Brown' }]} />
    )
    // There should be exactly 1 chevron separator (between the 2 items)
    const svgs = container.querySelectorAll('svg')
    expect(svgs.length).toBe(1)
  })
})
