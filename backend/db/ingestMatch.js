const { getDbAsync } = require('./schema')
const { fetchMatchData } = require('../utils/resultsvault')
const { parseHtmlScorecard } = require('./htmlParser')
const { ingestDeliveries, autoPopulateRoles } = require('./ingest')
const { backfillFixtureSummary } = require('../utils/matchSummary')

async function autoAssociateTeam(db, playCricketId, fixtureId) {
  const fixture = await db.prepare('SELECT home_team, away_team, match_date_iso FROM fixtures WHERE fixture_id = ?').get(fixtureId)
  if (!fixture) return null

  const teams = await db.prepare('SELECT team_id, season_id, label, year FROM watched_teams WHERE label IS NOT NULL').all()
  const home  = (fixture.home_team || '').toLowerCase()
  const away  = (fixture.away_team || '').toLowerCase()
  const fixtureYear = (fixture.match_date_iso || '').slice(0, 4) || null

  const labelMatches = teams.filter(t => {
    const lbl = (t.label || '').toLowerCase()
    return lbl && (home.includes(lbl) || away.includes(lbl))
  })
  if (!labelMatches.length) return null

  let chosen = labelMatches.find(t => t.year && fixtureYear && String(t.year) === fixtureYear)
  if (!chosen) {
    chosen = labelMatches[0]
    if (labelMatches.length > 1 || (chosen.year && fixtureYear && String(chosen.year) !== fixtureYear)) {
      console.warn(`[ingestMatch] no exact season-year match for fixture ${playCricketId} (match year ${fixtureYear}); ` +
        `falling back to team ${chosen.team_id} / season ${chosen.season_id} (year ${chosen.year})`)
    }
  }

  await db.prepare('DELETE FROM fixture_seasons WHERE fixture_id = ?').run(fixtureId)
  await db.prepare('INSERT OR IGNORE INTO fixture_seasons (fixture_id, team_id, season_id) VALUES (?, ?, ?)')
    .run(fixtureId, chosen.team_id, chosen.season_id)

  const existing = await db.prepare('SELECT team_id, season_id FROM scheduled_fixtures WHERE play_cricket_id = ?').get(parseInt(playCricketId, 10))
  if (existing) {
    if (existing.team_id !== chosen.team_id || existing.season_id !== chosen.season_id) {
      await db.prepare('UPDATE scheduled_fixtures SET team_id = ?, season_id = ? WHERE play_cricket_id = ?')
        .run(chosen.team_id, chosen.season_id, parseInt(playCricketId, 10))
      console.log(`[ingestMatch] repaired association for fixture ${playCricketId}: ${existing.team_id}/${existing.season_id} → ${chosen.team_id}/${chosen.season_id}`)
    }
    return { team_id: chosen.team_id, season_id: chosen.season_id }
  }

  const nowIso = new Date().toISOString()
  await db.prepare(`
    INSERT INTO scheduled_fixtures
      (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, home_team, away_team, status, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'done', ?)
  `).run(
    parseInt(playCricketId, 10),
    chosen.team_id, chosen.season_id,
    fixture.match_date_iso,
    fixture.match_date_iso,
    nowIso,
    fixture.home_team,
    fixture.away_team,
    nowIso,
  )

  console.log(`[ingestMatch] auto-associated fixture ${playCricketId} → team ${chosen.team_id} / season ${chosen.season_id} (label: ${chosen.label}, year: ${chosen.year})`)
  return { team_id: chosen.team_id, season_id: chosen.season_id }
}

async function ingestMatch(playCricketId, opts = {}) {
  const { userId = null, userName = null } = opts
  const db = getDbAsync()

  const data = await fetchMatchData(playCricketId)
  const matchMeta = parseHtmlScorecard(data.printHtml)

  const results = []
  await db.transaction(async (txDb) => {
    await txDb.prepare(`INSERT OR IGNORE INTO fixtures (fixture_id) VALUES (?)`).run(data.dbFixtureId)
    for (const inn of data.innings) {
      if (!Array.isArray(inn.json) || !inn.json.length) continue
      // eslint-disable-next-line no-await-in-loop
      const stats = await ingestDeliveries(txDb, data.dbFixtureId, inn.inningsOrder, inn.resultId, inn.json, matchMeta)
      results.push({ resultId: inn.resultId, inningsOrder: inn.inningsOrder, ...stats })
    }
    if (matchMeta && results.length) await autoPopulateRoles(txDb, data.dbFixtureId)
    if (!matchMeta && results.length) await backfillFixtureSummary(txDb, data.dbFixtureId)
    await txDb.prepare(`UPDATE fixtures SET play_cricket_id = ? WHERE fixture_id = ?`).run(String(playCricketId), data.dbFixtureId)
    if (data.maxOvers) await txDb.prepare(`UPDATE fixtures SET max_overs = ? WHERE fixture_id = ?`).run(data.maxOvers, data.dbFixtureId)
    await txDb.prepare(`DELETE FROM mvp_cache          WHERE fixture_id = ?`).run(data.dbFixtureId)
    await txDb.prepare(`DELETE FROM match_stats_cache  WHERE fixture_id = ?`).run(data.dbFixtureId)
    await txDb.prepare(`DELETE FROM match_detail_cache WHERE fixture_id = ?`).run(data.dbFixtureId)
    await txDb.prepare(
      `INSERT INTO ingests (fixture_id, clerk_user_id, clerk_user_name, ingested_at, source_files, row_counts) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(data.dbFixtureId, userId, userName, Date.now(), JSON.stringify(['play-cricket']), JSON.stringify({ innings: results.length }))
  })()

  const associated = await autoAssociateTeam(db, playCricketId, data.dbFixtureId)
  return { fixtureId: data.dbFixtureId, rvMatchId: data.rvMatchId, results, matchMeta, maxOvers: data.maxOvers ?? null, associated }
}

module.exports = { ingestMatch, _test: { autoAssociateTeam } }
