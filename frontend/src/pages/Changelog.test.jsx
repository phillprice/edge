import { render, screen, waitFor } from '@testing-library/react'
import Changelog from './Changelog'

describe('Changelog page', () => {
  it('shows a loading state, then renders entries', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 1,
          version: 'v1.2.0',
          title: 'New feature',
          html: '<p>Details</p>',
          published_at: '2024-05-01'
        }
      ]
    })
    render(<Changelog />)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('What’s new')).toBeInTheDocument())
    expect(screen.getByText('New feature')).toBeInTheDocument()
    expect(screen.getByText('v1.2.0')).toBeInTheDocument()
  })

  it('shows an error message when the fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    render(<Changelog />)
    await waitFor(() => expect(screen.getByText('Failed to load changelog.')).toBeInTheDocument())
  })

  it('shows an empty state when there are no entries', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    render(<Changelog />)
    await waitFor(() => expect(screen.getByText('No entries yet.')).toBeInTheDocument())
  })
})
