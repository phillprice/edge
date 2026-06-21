'use strict'

// Weak ETag from the latest ingested_at timestamp + a per-route salt.
// Cache-Control: private because responses are filtered per Clerk user (buildAccessFilter).
// Vary: Authorization ensures proxies don't serve one user's data to another.

function makeEtag(db, salt, clubId = null) {
  const row = db.prepare('SELECT MAX(ingested_at) AS ts FROM ingests').get()
  const ts = row && row.ts != null ? String(row.ts) : '0'
  // Include clubId so each club gets its own cache entry — prevents stale WHCC-biased
  // data being served to other clubs after the club-scoped computation was added.
  const clubPart = clubId != null ? `-c${clubId}` : ''
  return `W/"${salt}${clubPart}-${ts}"`
}

function withEtag(salt) {
  return (req, res, next) => {
    const { getDb } = require('../db/schema')
    const db = getDb()

    const clubId = req.authCtx?.clubId ?? null
    const etag = makeEtag(db, salt, clubId)
    res.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=300')
    res.set('Vary', 'Authorization')
    res.set('ETag', etag)

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end()
    }

    next()
  }
}

module.exports = { withEtag }
