import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import IngestDetailPanel from './IngestDetailPanel'

const mockGetToken = vi.fn().mockResolvedValue('test-token')
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mockGetToken })
}))

const DETAIL = {
  fixture: {
    fixture_id: 42,
    play_cricket_id: 999,
    format: 'T20',
    competition: 'League',
    result: 'Won'
  },
  scheduled: [],
  associations: [],
  ingests: []
}

function mockDetailResponse(data) {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => data })
}

describe('IngestDetailPanel', () => {
  it('renders collapsed by default without fetching', () => {
    mockDetailResponse(DETAIL)
    render(<IngestDetailPanel fixtureId={42} />)
    expect(screen.getByText(/Admin: ingest detail/)).toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('fetches and shows fixture detail when opened', async () => {
    mockDetailResponse(DETAIL)
    render(<IngestDetailPanel fixtureId={42} />)
    fireEvent.click(screen.getByText(/Admin: ingest detail/))
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument())
    expect(screen.getByText('T20')).toBeInTheDocument()
    expect(screen.getAllByText('None').length).toBeGreaterThan(0) // scheduled fixtures / ingest log
  })

  it('shows a warning when there are no team/season associations', async () => {
    mockDetailResponse(DETAIL)
    render(<IngestDetailPanel fixtureId={42} />)
    fireEvent.click(screen.getByText(/Admin: ingest detail/))
    await waitFor(() =>
      expect(screen.getByText(/None — match is invisible to scoped users/)).toBeInTheDocument()
    )
  })

  it('lists associations when present', async () => {
    mockDetailResponse({
      ...DETAIL,
      associations: [{ team_label: 'WHCC 1st XI', season_year: 2024 }]
    })
    render(<IngestDetailPanel fixtureId={42} />)
    fireEvent.click(screen.getByText(/Admin: ingest detail/))
    await waitFor(() => expect(screen.getByText(/WHCC 1st XI · 2024/)).toBeInTheDocument())
  })

  it('shows an error message when the fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network down'))
    render(<IngestDetailPanel fixtureId={42} />)
    fireEvent.click(screen.getByText(/Admin: ingest detail/))
    await waitFor(() => expect(screen.getByText('Network down')).toBeInTheDocument())
  })
})
