// Shared render helpers for page-level smoke tests.
// Pages rely on react-router context, Clerk auth (mocked per-test-file via
// vi.mock('@clerk/clerk-react', ...)), and GroupContext for club-scoped settings.
import { render } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { GroupContext } from './GroupContext'

const DEFAULT_GROUP_CTX = {
  myGroups: [],
  playCricketDomain: null,
  selectedGroups: null,
  setSelectedGroups: () => {},
  jerseyDisplay: 'both',
  showOppositionScorecard: false,
  showMvp: true
}

// Renders `ui` at `route` with routing + group context. Pass `path` when the
// page reads params via useParams (e.g. path="/match/:id", route="/match/1").
export function renderPage(
  ui,
  { route = '/', path = route, groupCtx = {}, ...renderOptions } = {}
) {
  return render(
    <GroupContext.Provider value={{ ...DEFAULT_GROUP_CTX, ...groupCtx }}>
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={path} element={ui} />
        </Routes>
      </MemoryRouter>
    </GroupContext.Provider>,
    renderOptions
  )
}

// Simple resolved-fetch mock: `fetch(url)` matches map keys as prefixes, else falls
// back to `{ ok: true, json: async () => defaultJson }`.
export function mockFetchJson(defaultJson = {}) {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => defaultJson })
  return global.fetch
}
