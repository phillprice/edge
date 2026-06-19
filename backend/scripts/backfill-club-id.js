'use strict'
/**
 * One-off: sets publicMetadata.clubId = 1 (WHCC) for all existing Clerk users
 * who don't already have a clubId set.
 *
 *   CLERK_SECRET_KEY=sk_live_... node backend/scripts/backfill-club-id.js
 */

require('dotenv').config()
const { createClerkClient } = require('@clerk/express')

const CLUB_ID = 1

async function main() {
  const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY })

  let offset = 0
  const limit = 100
  let total = 0
  let updated = 0
  let skipped = 0

  while (true) {
    const { data: users, totalCount } = await clerk.users.getUserList({ limit, offset })
    if (offset === 0) console.log(`Found ${totalCount} users total`)
    if (!users.length) break

    for (const user of users) {
      total++
      if (user.publicMetadata?.clubId != null) {
        console.log(`  skip ${user.id} (already has clubId=${user.publicMetadata.clubId})`)
        skipped++
        continue
      }
      await clerk.users.updateUserMetadata(user.id, {
        publicMetadata: { ...user.publicMetadata, clubId: CLUB_ID }
      })
      const email = user.emailAddresses?.[0]?.emailAddress ?? '(no email)'
      console.log(`  set  ${user.id} ${email} → clubId=${CLUB_ID}`)
      updated++
    }

    offset += users.length
    if (offset >= totalCount) break
  }

  console.log(`\nDone. ${total} users processed: ${updated} updated, ${skipped} skipped.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
