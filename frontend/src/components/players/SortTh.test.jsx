import { render, screen, fireEvent } from '@testing-library/react'
import { SortTh } from './SortTh'

describe('SortTh', () => {
  const inactiveSort = { key: 'other', dir: 1 }

  it('renders the label with no arrow when not the active sort', () => {
    render(<SortTh label="Runs" sortKey="runs" activeSort={inactiveSort} onSort={() => {}} />)
    expect(screen.getByText('Runs')).toBeInTheDocument()
    expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('none')
  })

  it('shows an ascending arrow when active with dir 1', () => {
    render(
      <SortTh label="Runs" sortKey="runs" activeSort={{ key: 'runs', dir: 1 }} onSort={() => {}} />
    )
    expect(screen.getByText('Runs ↑')).toBeInTheDocument()
    expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('ascending')
  })

  it('shows a descending arrow when active with dir -1', () => {
    render(
      <SortTh label="Runs" sortKey="runs" activeSort={{ key: 'runs', dir: -1 }} onSort={() => {}} />
    )
    expect(screen.getByText('Runs ↓')).toBeInTheDocument()
    expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('descending')
  })

  it('calls onSort with the sortKey when clicked', () => {
    const onSort = vi.fn()
    render(<SortTh label="Runs" sortKey="runs" activeSort={inactiveSort} onSort={onSort} />)
    fireEvent.click(screen.getByText('Runs'))
    expect(onSort).toHaveBeenCalledWith('runs')
  })

  it('calls onSort when Enter is pressed', () => {
    const onSort = vi.fn()
    render(<SortTh label="Runs" sortKey="runs" activeSort={inactiveSort} onSort={onSort} />)
    fireEvent.keyDown(screen.getByText('Runs'), { key: 'Enter' })
    expect(onSort).toHaveBeenCalledWith('runs')
  })

  it('calls onSort when Space is pressed', () => {
    const onSort = vi.fn()
    render(<SortTh label="Runs" sortKey="runs" activeSort={inactiveSort} onSort={onSort} />)
    fireEvent.keyDown(screen.getByText('Runs'), { key: ' ' })
    expect(onSort).toHaveBeenCalledWith('runs')
  })
})
