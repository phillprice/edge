import { render, screen, fireEvent } from '@testing-library/react'
import FilterPills from './FilterPills'

const OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'cup', label: 'Cup' },
  { value: 'league', label: 'League' }
]

describe('FilterPills', () => {
  it('renders label and all options', () => {
    render(<FilterPills label="Comp" options={OPTIONS} value="all" onChange={() => {}} />)
    expect(screen.getByText('Comp')).toBeInTheDocument()
    expect(screen.getByText('All')).toBeInTheDocument()
    expect(screen.getByText('Cup')).toBeInTheDocument()
    expect(screen.getByText('League')).toBeInTheDocument()
  })

  it('marks the active option', () => {
    render(<FilterPills label="Comp" options={OPTIONS} value="cup" onChange={() => {}} />)
    expect(screen.getByText('Cup').className).toContain('active')
    expect(screen.getByText('All').className).not.toContain('active')
  })

  it('calls onChange with the selected value', () => {
    const onChange = vi.fn()
    render(<FilterPills label="Comp" options={OPTIONS} value="all" onChange={onChange} />)
    fireEvent.click(screen.getByText('League'))
    expect(onChange).toHaveBeenCalledWith('league')
  })
})
