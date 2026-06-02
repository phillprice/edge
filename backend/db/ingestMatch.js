const { getDb } = require('./schema')
const { fetchMatchData } = require('../utils/resultsvault')
const { parseHtmlScorecard } = require('./htmlParser')
const { ingestDeliveries, autoPopulateRoles } = require('./ingest')

// After ingesting a match, try to link it to a watched_team entry by fuzzy-matching
// the fixture's home/away team names against watched_teams labels.
// If a match is found and we can infer the season_id, upsert a scheduled_fixtures row
// so the access filter can find it.
function autoAssociateTeam(db, playCricketId, fixtureId) {
  const fixture = db.prepare('SELECT home_team, away_team, match_date_iso FROM fixtures WHERE fixture_id = ?').get(fixtureId)
  if (!fixture) return null

  const teams = db.prepare('SELECT team_id, season_id, label FROM watched_teams WHERE label IS NOT NULL').all()
  const home  = (fixture.home_team || '').toLowerCase()
  const away  = (fixture.away_team || '').toLowerCase()

  for (const t of teams) {
    const lbl = (t.label || '').toLowerCase()
    if (!lbl || (!home.includes(lbl) && !away.includes(lbl))) continue

    // Found a label match — check if there's already a scheduled_fixtures entry
    const existing = db.prepare('SELECT play_cricket_id FROM scheduled_fixtures WHERE play_cricket_id = ?').get(parseInt(playCricketId))
    if (existing) return { team_id: t.team_id, season_id: t.season_id }

    // Upsert a scheduled_fixtures entry so the access filter can find this match
    db.prepare(`
      INSERT OR IGNORE INTO scheduled_fixtures
        (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, home_team, away_team, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'done')
    `).run(
      parseInt(playCricketId),
      t.team_id, t.season_id,
      fixture.match_date_iso,
      fixture.match_date_iso,   // ingest_after = match date (already past)
      new Date().toISOString(),
      fixture.home_team,
      fixture.away_team,
    )
    // Mark done since it's already ingested
    db.prepare(`UPDATE scheduled_fixtures SET status = 'done', ingested_at = ? WHERE play_cricket_id = ?`)
      .run(new Date().toISOString(), parseInt(playCricketId))

    console.log(`[ingestMatch] auto-associated fixture ${playCricketId} → team ${t.team_id} / season ${t.season_id} (label: ${t.label})`)
    return { team_id: t.team_id, season_id: t.season_id }
  }
  return null
}

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
    if (data.maxOvers) db.prepare(`UPDATE fixtures SET max_overs = ? WHERE fixture_id = ?`).run(data.maxOvers, data.dbFixtureId)
    db.prepare(`DELETE FROM mvp_cache          WHERE fixture_id = ?`).run(data.dbFixtureId)
    db.prepare(`DELETE FROM match_stats_cache  WHERE fixture_id = ?`).run(data.dbFixtureId)
    db.prepare(`DELETE FROM match_detail_cache WHERE fixture_id = ?`).run(data.dbFixtureId)
    db.prepare(
      `INSERT INTO ingests (fixture_id, clerk_user_id, clerk_user_name, ingested_at, source_files, row_counts) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(data.dbFixtureId, userId, userName, Date.now(), JSON.stringify(['play-cricket']), JSON.stringify({ innings: results.length }))
  })()

  const associated = autoAssociateTeam(db, playCricketId, data.dbFixtureId)
  return { fixtureId: data.dbFixtureId, rvMatchId: data.rvMatchId, results, matchMeta, maxOvers: data.maxOvers ?? null, associated }
}

module.exports = { ingestMatch }
