import { clerkSetup } from '@clerk/testing/playwright'
import { test as setup } from '@playwright/test'

setup('clerk global setup', async () => {
  await clerkSetup()
})
