import { screen, waitFor } from '@testing-library/react'
import { renderPage, mockFetchJson } from '../test-utils'
import BallEntry from './BallEntry'

const mockGetToken = vi.fn().mockResolvedValue('test-token')
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mockGetToken })
}))

describe('BallEntry page', () => {
  it('renders the heading and fixture selector', async () => {
    mockFetchJson([])
    renderPage(<BallEntry />, { route: '/ball-entry' })
    expect(screen.getByText('Ball-by-ball entry')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Fixture')).toBeInTheDocument())
  })
})
