import { defineConfig } from '@playwright/test'

// Isolated e2e ports so a running dev server (5173 → 3001) is never reused or clobbered.
const API_PORT      = process.env.E2E_API_PORT  || '3099'
const AUTH_API_PORT = process.env.E2E_AUTH_API_PORT || '3098'
const WEB_PORT      = process.env.E2E_WEB_PORT  || '5174'

const hasClerk = !!process.env.CLERK_SECRET_KEY

export default defineConfig({
  testDir: './e2e',
  testIgnore: '**/global.setup.js',
  // clerkSetup must run before any test that uses setupClerkTestingToken
  globalSetup: hasClerk ? './e2e/global.setup.js' : undefined,
  use: {
    baseURL: process.env.E2E_BASE_URL || `http://localhost:${WEB_PORT}`,
    headless: true,
  },

  projects: [
    // ── Smoke: API contract tests — auth disabled, fastest ────────────────────
    {
      name: 'smoke',
      testMatch: '**/smoke.spec.js',
      use: { baseURL: `http://localhost:${WEB_PORT}` },
    },

    // ── Auth: access-control tests — requires CLERK_SECRET_KEY ────────────────
    // Skipped automatically when the secret is not set.
    ...(hasClerk ? [{
      name: 'auth',
      testMatch: '**/auth.spec.js',
      use: {
        baseURL: `http://localhost:${WEB_PORT}`,
      },
      timeout: 60000, // Clerk sign-in involves network round-trips to Clerk's servers
    }] : []),
  ],

  webServer: [
    // Frontend dev server (shared by both projects)
    {
      command: `VITE_API_PROXY=http://localhost:${API_PORT} npm run dev -- --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    // Smoke backend — auth disabled
    {
      // CLERK_SECRET_KEY= (empty) disables auth; dotenv won't override an already-set key.
      command: `CLERK_SECRET_KEY= PORT=${API_PORT} DB_PATH=../backend/test.sqlite node ../backend/server.js`,
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 15000,
    },
    // Auth backend — Clerk enabled, same test DB
    ...(hasClerk ? [{
      command: `PORT=${AUTH_API_PORT} DB_PATH=../backend/test.sqlite node ../backend/server.js`,
      url: `http://localhost:${AUTH_API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 15000,
    }] : []),
  ],
})
