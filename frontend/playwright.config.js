import { defineConfig } from '@playwright/test'

// Isolated e2e ports so a running dev server (5173 → 3001) is never reused or clobbered.
// The e2e backend runs with CLERK_SECRET_KEY unset so auth is disabled and the API tests
// can hit endpoints unauthenticated — independent of whether backend/.env has Clerk keys.
const API_PORT = process.env.E2E_API_PORT || '3099'
const WEB_PORT = process.env.E2E_WEB_PORT || '5174'

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: process.env.E2E_BASE_URL || `http://localhost:${WEB_PORT}`,
    headless: true,
  },
  webServer: [
    {
      command: `VITE_API_PROXY=http://localhost:${API_PORT} npm run dev -- --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
    {
      // CLERK_SECRET_KEY= (empty) disables auth; dotenv won't override an already-set key.
      command: `CLERK_SECRET_KEY= PORT=${API_PORT} DB_PATH=../backend/test.sqlite node ../backend/server.js`,
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 15000,
    },
  ],
})
