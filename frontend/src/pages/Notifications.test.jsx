import { screen, waitFor } from '@testing-library/react'
import { renderPage } from '../test-utils'
import Notifications from './Notifications'

const mockGetToken = vi.fn().mockResolvedValue('test-token')
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({ getToken: mockGetToken })
}))

function mockNotificationsResponses() {
  global.fetch = vi.fn((url) => {
    if (url.includes('/api/notifications/prefs'))
      return Promise.resolve({ ok: true, json: async () => ({ prefs: {} }) })
    if (url.includes('/api/notifications/subscriptions'))
      return Promise.resolve({ ok: true, json: async () => [] })
    if (url.includes('/api/notifications/player-follows'))
      return Promise.resolve({ ok: true, json: async () => [] })
    if (url.includes('/api/notifications/telegram'))
      return Promise.resolve({ ok: true, json: async () => null })
    if (url.includes('/api/calendar/token'))
      return Promise.resolve({ ok: true, json: async () => ({ token: '', activeGroups: [] }) })
    return Promise.resolve({ ok: true, json: async () => ({}) })
  })
}

describe('Notifications page', () => {
  it('shows a loading state, then the preferences heading', async () => {
    mockNotificationsResponses()
    renderPage(<Notifications />, { route: '/notifications' })
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Notification preferences')).toBeInTheDocument())
  })

  it('shows an error message when loading preferences fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'))
    renderPage(<Notifications />, { route: '/notifications' })
    await waitFor(() =>
      expect(screen.getByText('Failed to load notification preferences.')).toBeInTheDocument()
    )
  })
})
