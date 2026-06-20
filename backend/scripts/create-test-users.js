'use strict'
/**
 * Creates test Clerk users for a given club and sets their publicMetadata.
 *
 * Usage:
 *   CLERK_SECRET_KEY=sk_... node backend/scripts/create-test-users.js
 *
 * Edit TEST_USERS below to adjust names/roles before running.
 * Passwords meet Clerk's default policy (12+ chars, mixed case, digit, symbol).
 */

require('dotenv').config()
const { createClerkClient } = require('@clerk/express')

const CLUB_ID = 2 // Kempton CC

const TEST_USERS = [
  {
    firstName: 'Kempton',
    lastName: 'Admin',
    email: 'kempton-admin@test.edgexi.uk',
    password: 'TestKempton1!',
    metadata: { clubId: CLUB_ID, isClubAdmin: true, canUpload: true }
  },
  {
    firstName: 'Kempton',
    lastName: 'Member',
    email: 'kempton-member@test.edgexi.uk',
    password: 'TestKempton1!',
    metadata: { clubId: CLUB_ID, canUpload: false }
  }
]

async function main() {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })

  for (const u of TEST_USERS) {
    // Check if already exists
    const existing = await clerk.users.getUserList({ emailAddress: [u.email] })
    if (existing.data.length) {
      console.log(`  exists  ${u.email} (${existing.data[0].id}) — updating metadata`)
      await clerk.users.updateUserMetadata(existing.data[0].id, { publicMetadata: u.metadata })
      continue
    }

    const created = await clerk.users.createUser({
      firstName: u.firstName,
      lastName: u.lastName,
      emailAddress: [u.email],
      password: u.password,
      publicMetadata: u.metadata,
      skipPasswordChecks: false
    })
    console.log(`  created ${u.email} (${created.id})`)
  }

  console.log('\nDone. Credentials:')
  for (const u of TEST_USERS) {
    const role = u.metadata.isClubAdmin ? 'club admin' : 'member'
    console.log(`  ${u.email}  /  ${u.password}  [${role}]`)
  }
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})
