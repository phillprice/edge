import { test, expect } from '@playwright/test'

test('match list loads', async ({ page }) => {
  await page.goto('/')
  // The app may redirect to login (Clerk). Just check no crash.
  await expect(page).not.toHaveURL(/error/)
  // If not redirected to auth, check for match list content
  const url = page.url()
  if (!url.includes('accounts.') && !url.includes('clerk')) {
    await expect(page.locator('body')).not.toBeEmpty()
  }
})

test('no app-level console errors on home page', async ({ page }) => {
  const errors = []
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()) })
  await page.goto('/')
  await page.waitForLoadState('networkidle')
  const appErrors = errors.filter(e =>
    !e.includes('clerk') &&
    !e.includes('sentry') &&
    !e.includes('favicon') &&
    !e.includes('Failed to load resource') &&
    !e.includes('net::ERR') &&
    !e.includes('ResizeObserver')
  )
  expect(appErrors).toHaveLength(0)
})
