import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import InvitePage from './InvitePage'

const mockUseUser = vi.fn()
vi.mock('@clerk/clerk-react', () => ({
  useUser: () => mockUseUser()
}))

describe('InvitePage', () => {
  beforeEach(() => {
    mockUseUser.mockReturnValue({ isSignedIn: false, isLoaded: true })
  })

  it('shows an error when there is no invite token in the URL', async () => {
    render(
      <MemoryRouter initialEntries={['/invite']}>
        <InvitePage />
      </MemoryRouter>
    )
    expect(await screen.findByText('Invalid invite')).toBeInTheDocument()
    expect(screen.getByText('No invite token found in this link.')).toBeInTheDocument()
  })

  it('renders club invite details once validated', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ clubName: 'Woking & Horsell CC', appName: 'EDGE' })
    })
    render(
      <MemoryRouter initialEntries={['/invite?token=abc123']}>
        <InvitePage />
      </MemoryRouter>
    )
    expect(await screen.findByText("You've been invited")).toBeInTheDocument()
    expect(screen.getByText('Woking & Horsell CC')).toBeInTheDocument()
    expect(screen.getByText('Sign in / Create account')).toBeInTheDocument()
  })

  it('shows the server-provided error message when validation fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: 'This invite has expired.' })
    })
    render(
      <MemoryRouter initialEntries={['/invite?token=expired']}>
        <InvitePage />
      </MemoryRouter>
    )
    expect(await screen.findByText('This invite has expired.')).toBeInTheDocument()
  })
})
