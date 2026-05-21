const { getDb } = require('./schema')
const { fetchMatchData } = require('../utils/resultsvault')
const { parseHtmlScorecard } = require('./htmlParser')
const { ingestDeliveries, autoPopulateRoles } = require('./ingest')

// Fetch and ingest a play-cricket match. All DB writes happen inside a single transaction
// so a partial failure leaves no trace in the fixtures table (and thus the frontend).
async function ingestMatch(playCricketId, opts = {}) {
  const { userId = null, userName = null } = opts
  const db = getDb()

  const data = await fetchMatchData(playCricketId)
  const matchMeta = parseHtmlScorecard(data.printHtml)

  const results = []
  db.transaction(() => {
    for (const inn of data.innings) {
      if (!Array.isArray(inn.json) || !inn.json.length) continue
      const stats = ingestDeliveries(data.dbFixtureId, inn.inningsOrder, inn.resultId, inn.json, matchMeta)
      results.push({ resultId: inn.resultId, inningsOrder: inn.inningsOrder, ...stats })
    }
    if (matchMeta && results.length) autoPopulateRoles(data.dbFixtureId)
    db.prepare(`UPDATE fixtures SET play_cricket_id = ? WHERE fixture_id = ?`).run(String(playCricketId), data.dbFixtureId)
    db.prepare(`DELETE FROM mvp_cache          WHERE fixture_id = ?`).run(data.dbFixtureId)
    db.prepare(`DELETE FROM match_stats_cache  WHERE fixture_id = ?`).run(data.dbFixtureId)
    db.prepare(`DELETE FROM match_detail_cache WHERE fixture_id = ?`).run(data.dbFixtureId)
    db.prepare(
      `INSERT INTO ingests (fixture_id, clerk_user_id, clerk_user_name, ingested_at, source_files, row_counts) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(data.dbFixtureId, userId, userName, Date.now(), JSON.stringify(['play-cricket']), JSON.stringify({ innings: results.length }))
  })()

  return { fixtureId: data.dbFixtureId, rvMatchId: data.rvMatchId, results, matchMeta }
}

module.exports = { ingestMatch }
