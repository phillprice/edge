import { screen, waitFor } from '@testing-library/react'
import { renderPage, mockFetchJson } from '../test-utils'
import ManualEntry from './ManualEntry'

const mockGetToken = vi.fn().mockResolvedValue('test-token')
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mockGetToken })
}))

describe('ManualEntry page', () => {
  it('renders the heading and the match selector', async () => {
    mockFetchJson([])
    renderPage(<ManualEntry />, { route: '/manual' })
    expect(screen.getByText('Manual stat entry')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Select match')).toBeInTheDocument())
  })
})
