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
    email: 'kempton-admin+clerk_test@test.edgexi.uk',
    password: 'TestKempton1!',
    metadata: { clubId: CLUB_ID, isClubAdmin: true, canUpload: true }
  },
  {
    firstName: 'Kempton',
    lastName: 'Member',
    email: 'kempton-member+clerk_test@test.edgexi.uk',
    password: 'TestKempton1!',
    metadata: { clubId: CLUB_ID, canUpload: false }
  }
]

const STALE_EMAILS = ['kempton-admin@test.edgexi.uk', 'kempton-member@test.edgexi.uk']

async function main() {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })

  for (const email of STALE_EMAILS) {
    const existing = await clerk.users.getUserList({ emailAddress: [email] })
    if (existing.data.length) {
      await clerk.users.deleteUser(existing.data[0].id)
      console.log(`  deleted stale user ${email}`)
    }
  }

  for (const u of TEST_USERS) {
    // Check if already exists
    const existing = await clerk.users.getUserList({ emailAddress: [u.email] })
    if (existing.data.length) {
      console.log(`  exists  ${u.email} (${existing.data[0].id}) — updating metadata`)
      await clerk.users.updateUserMetadata(existing.data[0].id, { publicMetadata: u.metadata })
      continue
    }

    const { id: createdId } = await clerk.users.createUser({
      firstName: u.firstName,
      lastName: u.lastName,
      emailAddress: [u.email],
      password: u.password,
      publicMetadata: u.metadata,
      skipPasswordChecks: false
    })
    console.log(`  created ${u.email} (${createdId})`)
  }

  process.stderr.write('\nDone. Test user emails:\n')
  for (const u of TEST_USERS) {
    const role = u.metadata.isClubAdmin ? 'club admin' : 'member'
    process.stderr.write(`  ${u.email}  [${role}]  (see TEST_USERS in script for password)\n`)
  }
}

main().catch((e) => {
  console.error(e.message ?? e)
  process.exit(1)
})
