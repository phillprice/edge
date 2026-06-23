const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 })
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  page.on('pageerror', (err) => console.log('[PAGE ERROR]', err.message))

  // ── Sign in via Clerk hosted page ─────────────────────────────────────────────
  console.log('navigating to app...')
  await page.goto('http://localhost:5173')

  // Wait for redirect to Clerk sign-in
  await page.waitForURL(/accounts\.dev|sign-in/, { timeout: 15000 }).catch(() => {})
  console.log('at:', page.url())

  // Wait for email input on Clerk's hosted sign-in page
  const emailInput = page.locator('input[name="identifier"], input[type="email"]')
  await emailInput.waitFor({ timeout: 15000 })
  await emailInput.fill('whcc-admin+clerk_test@test.edgexi.uk')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1500)

  // Password step
  const pwInput = page.locator('input[type="password"]')
  if (await pwInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    console.log('entering password...')
    await pwInput.fill('TestWhcc1!')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(2000)
  }

  // 2FA if shown
  const otpInput = page.locator('input[inputmode="numeric"], input[autocomplete="one-time-code"]')
  if (await otpInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    console.log('2FA — entering 424242')
    await otpInput.fill('424242')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(2000)
  }

  // Wait to land back at the app
  await page.waitForURL('http://localhost:5173/**', { timeout: 20000 }).catch(() => {})
  console.log('signed in, at:', page.url())

  // ── Navigate to player list ──────────────────────────────────────────────────
  await page.goto('http://localhost:5173/players')
  await page.waitForTimeout(2000)
  await page.screenshot({ path: '/tmp/pw-1-initial.png' })
  console.log('[1] initial player list:', await page.locator('table tbody tr').count(), 'rows')

  // ── Test: Teams button visible ────────────────────────────────────────────────
  const teamsBtn = page.locator('button', { hasText: /^Teams/ })
  console.log('[2] Teams button visible:', await teamsBtn.isVisible())
  await page.screenshot({ path: '/tmp/pw-2-before-open.png' })

  // ── Test: Open dropdown ───────────────────────────────────────────────────────
  await teamsBtn.click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: '/tmp/pw-3-open.png' })
  console.log('[3] dropdown open')

  // ── Test: Click-away closes it ────────────────────────────────────────────────
  await page.mouse.click(10, 10)
  await page.waitForTimeout(400)
  await page.screenshot({ path: '/tmp/pw-4-closed.png' })
  // Check if the inner content is gone
  const dropdownContent = page.locator('[style*="position: absolute"][style*="zIndex: 200"]')
  console.log('[4] click-away closed dropdown:', !await dropdownContent.isVisible().catch(() => true))

  // ── Test: Deselect all → empty results ───────────────────────────────────────
  await teamsBtn.click()
  await page.waitForTimeout(600)

  // Find checkboxes in the dropdown
  const checkboxes = await page.locator('input[type="checkbox"]').all()
  console.log('[5] team checkboxes found:', checkboxes.length)

  if (checkboxes.length > 0) {
    // Note current state
    for (let i = 0; i < Math.min(checkboxes.length, 6); i++) {
      const checked = await checkboxes[i].isChecked()
      const label = await checkboxes[i].locator('..').textContent().catch(() => '?')
      console.log(`  checkbox[${i}]: checked=${checked} label=${label.trim().substring(0,40)}`)
    }

    // Deselect all that are checked
    for (const cb of checkboxes) {
      if (await cb.isChecked()) {
        await cb.click()
        await page.waitForTimeout(200)
      }
    }

    await page.waitForTimeout(800)
    await page.screenshot({ path: '/tmp/pw-5-all-deselected.png' })
    const rows = await page.locator('table tbody tr').count()
    console.log('[6] rows after deselecting all:', rows, rows === 0 ? '✓ EMPTY (correct)' : '✗ STILL SHOWING DATA')

    const url = page.url()
    console.log('[7] URL after deselect:', url.includes('groups=none') ? '✓ groups=none in URL' : '✗ URL: ' + url)
  }

  await page.waitForTimeout(1000)
  await browser.close()
  console.log('\nAll screenshots saved to /tmp/pw-*.png')
})()
