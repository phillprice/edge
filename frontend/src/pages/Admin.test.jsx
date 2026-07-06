import { screen, waitFor } from '@testing-library/react'
import { renderPage, mockFetchJson } from '../test-utils'
import Admin from './Admin'

const mockGetToken = vi.fn().mockResolvedValue('test-token')
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
  useUser: () => ({ user: { publicMetadata: { canUpload: true } } })
}))

describe('Admin page', () => {
  it('renders the heading and the default (Scheduler) tab without throwing', async () => {
    mockFetchJson({ teams: [] })
    renderPage(<Admin />, { route: '/admin' })
    expect(screen.getByText('Admin')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('Scheduler').length).toBeGreaterThan(0))
  })
})
