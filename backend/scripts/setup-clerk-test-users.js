'use strict'
/**
 * Creates (or updates) the 5 Clerk test users needed for E2E auth tests.
 * Run once against the dev Clerk instance:
 *
 *   CLERK_SECRET_KEY=sk_test_... node backend/scripts/setup-clerk-test-users.js
 *
 * Outputs a .env.test snippet with the user IDs — add these as GitHub secrets.
 * Safe to run again: finds existing users by email and updates them.
 */

require('dotenv').config()
const { createClerkClient } = require('@clerk/express')

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })

// Team/season pairs from the production fixture_seasons table.
// Update these when new seasons are added.
const TEAM_ID_1  = 35534   // WHCC U11 Whirlwinds
const SEASON_ID  = 259     // 2026

// +clerk_test suffix is Clerk's supported format for test accounts — bypasses email
// verification and is guaranteed to be accepted in any Clerk dev instance.
const TEST_USERS = [
  {
    key:   'E2E_USER_SUPER',
    email: 'e2e-superadmin+clerk_test@phillprice.com',
    meta:  { isSuperAdmin: true },
  },
  {
    key:   'E2E_USER_UPLOAD',
    email: 'e2e-upload+clerk_test@phillprice.com',
    meta:  { canUpload: true, accessGroups: [{ team_id: TEAM_ID_1, season_id: SEASON_ID }] },
  },
  {
    key:   'E2E_USER_SCOPED',
    email: 'e2e-scoped+clerk_test@phillprice.com',
    meta:  { accessGroups: [{ team_id: TEAM_ID_1, season_id: SEASON_ID }] },
  },
  {
    key:   'E2E_USER_MULTI',
    email: 'e2e-multiteam+clerk_test@phillprice.com',
    meta:  { accessGroups: [
      { team_id: TEAM_ID_1, season_id: SEASON_ID },
      { team_id: 47317,     season_id: SEASON_ID },  // WHCC U11 Hurricanes
    ]},
  },
  {
    key:   'E2E_USER_NOACCESS',
    email: 'e2e-noaccess+clerk_test@phillprice.com',
    meta:  { accessGroups: [] },
  },
]

const PASSWORD = process.env.E2E_TEST_PASSWORD || 'E2eTestP@ss123!'

async function findByEmail(email) {
  const { data } = await clerk.users.getUserList({ emailAddress: [email] })
  return data[0] ?? null
}

async function main() {
  if (!process.env.CLERK_SECRET_KEY) {
    console.error('CLERK_SECRET_KEY is required')
    process.exit(1)
  }

  console.log('Setting up Clerk test users...\n')
  const results = {}

  for (const u of TEST_USERS) {
    let user = await findByEmail(u.email)

    if (!user) {
      user = await clerk.users.createUser({
        emailAddress: [u.email],
        password: PASSWORD,
        skipPasswordChecks: true,
        publicMetadata: u.meta,
      })
      console.log(`✓ Created  ${u.email}  (${user.id})`)
    } else {
      await clerk.users.updateUser(user.id, { password: PASSWORD, skipPasswordChecks: true })
      await clerk.users.updateUserMetadata(user.id, { publicMetadata: u.meta })
      console.log(`✓ Updated  ${u.email}  (${user.id})`)
    }

    results[u.key] = user.id
  }

  console.log('\n--- Add these as GitHub Actions secrets ---')
  for (const [key, id] of Object.entries(results)) {
    console.log(`${key}=${id}`)
  }
  console.log('E2E_TEST_PASSWORD=<the password you used above>')
  console.log('\nAlso ensure CLERK_SECRET_KEY and VITE_CLERK_PUBLISHABLE_KEY are set as secrets.')
}

main().catch(e => { console.error(e.message); process.exit(1) })
