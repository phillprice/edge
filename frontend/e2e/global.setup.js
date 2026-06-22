import { createRequire } from 'module'
const require = createRequire(import.meta.url)

export default async function globalSetup() {
  const { seed } = require('../../backend/scripts/seed-test-db.js')
  seed()
  console.log('[e2e] test.sqlite seeded')
}
