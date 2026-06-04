import { clerkSetup } from '@clerk/testing/playwright'

// clerkSetup initialises the Clerk testing environment, deriving the
// Frontend API URL from VITE_CLERK_PUBLISHABLE_KEY. Required even when
// using the signInTokens approach (sets up the Clerk JS state used by
// page.waitForFunction(() => window.Clerk?.session?.id)).
export default async function globalSetup() {
  await clerkSetup()
}
