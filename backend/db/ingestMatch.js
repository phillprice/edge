'use strict'
const { getDb } = require('./schema')
const { fetchMatchData } = require('../utils/resultsvault')
const { parseHtmlScorecard } = require('./htmlParser')
const { ingestDeliveries, autoPopulateRoles } = require('./ingest')
const { backfillFixtureSummary } = require('../utils/matchSummary')
const { isWhccTeam } = require('../utils/db')

// Pick the best season_id from watched_teams for a given team_id + fixture year.
function bestSeasonId(db, teamId, fixtureYear, fallbackSeasonId) {
  const seasons = db
    .prepare('SELECT season_id, year FROM watched_teams WHERE team_id = ?')
    .all(teamId)
  const yearMatch = seasons.find((s) => s.year && fixtureYear && String(s.year) === fixtureYear)
  return (yearMatch ?? seasons[0])?.season_id ?? fallbackSeasonId
}

// Write the fixture_seasons row and keep scheduled_fixtures.season_id in sync.
function writeAssociation(db, fixtureId, playCricketIdInt, teamId, seasonId) {
  db.prepare('DELETE FROM fixture_seasons WHERE fixture_id = ?').run(fixtureId)
  db.prepare(
    'INSERT OR IGNORE INTO fixture_seasons (fixture_id, team_id, season_id) VALUES (?, ?, ?)'
  ).run(fixtureId, teamId, seasonId)
  if (playCricketIdInt != null) {
    db.prepare(
      'UPDATE scheduled_fixtures SET team_id = ?, season_id = ? WHERE play_cricket_id = ?'
    ).run(teamId, seasonId, playCricketIdInt)
  }
}

// Ensure a scheduled_fixtures row exists for a PC-ingested fixture so that future
// re-ingests hit Priority 1 without needing to re-derive the team association.
function ensureScheduledFixture(db, pcIdInt, teamId, seasonId, fixture) {
  const nowIso = new Date().toISOString()
  db.prepare(
    `INSERT OR IGNORE INTO scheduled_fixtures
      (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, home_team, away_team, status, ingested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'done', ?)`
  ).run(
    pcIdInt,
    teamId,
    seasonId,
    fixture.match_date_iso,
    fixture.match_date_iso,
    nowIso,
    fixture.home_team,
    fixture.away_team,
    nowIso
  )
}

// Priority 1: scheduled_fixtures already has the authoritative Play Cricket team_id.
function assocViaSF(db, pcIdInt, fixtureId, fixture) {
  const sfRow = db
    .prepare('SELECT team_id, season_id FROM scheduled_fixtures WHERE play_cricket_id = ?')
    .get(pcIdInt)
  if (!sfRow?.team_id) return null
  const fixtureYear = (fixture.match_date_iso || '').slice(0, 4) || null
  const seasonId = bestSeasonId(db, sfRow.team_id, fixtureYear, sfRow.season_id)
  writeAssociation(db, fixtureId, pcIdInt, sfRow.team_id, seasonId)
  console.log(
    `[ingestMatch] fixture ${pcIdInt} → team ${sfRow.team_id} / season ${seasonId} (scheduled_fixtures)`
  )
  return { team_id: sfRow.team_id, season_id: seasonId }
}

// Priority 2: Play Cricket team IDs extracted from the /website/results/{id} page.
// Looked up directly in watched_teams — no label/string matching.
function assocViaHtmlIds(db, pcIdInt, fixtureId, fixture, htmlTeamIds) {
  if (!htmlTeamIds.length) return null
  const fixtureYear = (fixture.match_date_iso || '').slice(0, 4) || null
  const placeholders = htmlTeamIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT team_id, season_id, year FROM watched_teams WHERE team_id IN (${placeholders})`
    )
    .all(...htmlTeamIds)
  if (!rows.length) return null
  const best = rows.find((r) => r.year && fixtureYear && String(r.year) === fixtureYear) ?? rows[0]
  const seasonId = bestSeasonId(db, best.team_id, fixtureYear, best.season_id)
  writeAssociation(db, fixtureId, pcIdInt || null, best.team_id, seasonId)
  if (pcIdInt) ensureScheduledFixture(db, pcIdInt, best.team_id, seasonId, fixture)
  console.log(
    `[ingestMatch] fixture ${pcIdInt} → team ${best.team_id} / season ${seasonId} (HTML team IDs)`
  )
  return { team_id: best.team_id, season_id: seasonId }
}

// Return the WHCC side of a fixture as a lowercase string for label matching.
function whccSideOf(fixture) {
  return isWhccTeam(fixture.home_team)
    ? (fixture.home_team || '').toLowerCase()
    : (fixture.away_team || '').toLowerCase()
}

// Find the best label-matched watched team for a fixture.
// Returns the year-exact entry if one exists, otherwise the first match.
function pickBestLabelMatch(all, whccSide, fixtureYear) {
  const lbl = (t) => (t.label || '').toLowerCase()
  const matches = all.filter((t) => lbl(t) && whccSide.includes(lbl(t)))
  if (!matches.length) return null
  return matches.find((t) => t.year && fixtureYear && String(t.year) === fixtureYear) ?? matches[0]
}

// Priority 3: label substring match against the WHCC side of the fixture only.
// Fallback for PDF scorecard imports that never go through fetchMatchData.
function assocViaLabel(db, pcIdInt, fixtureId, fixture) {
  const fixtureYear = (fixture.match_date_iso || '').slice(0, 4) || null
  const all = db
    .prepare('SELECT team_id, season_id, label, year FROM watched_teams WHERE label IS NOT NULL')
    .all()
  const chosen = pickBestLabelMatch(all, whccSideOf(fixture), fixtureYear)
  if (!chosen) return null
  writeAssociation(db, fixtureId, pcIdInt || null, chosen.team_id, chosen.season_id)
  if (pcIdInt) ensureScheduledFixture(db, pcIdInt, chosen.team_id, chosen.season_id, fixture)
  console.log(
    `[ingestMatch] fixture ${pcIdInt} → team ${chosen.team_id} / season ${chosen.season_id} (label: "${chosen.label}")`
  )
  return { team_id: chosen.team_id, season_id: chosen.season_id }
}

// Associate a fixture with the correct watched team and season, trying three sources in order.
function autoAssociateTeam(db, playCricketId, fixtureId, htmlTeamIds = []) {
  const fixture = db
    .prepare('SELECT home_team, away_team, match_date_iso FROM fixtures WHERE fixture_id = ?')
    .get(fixtureId)
  if (!fixture) return null
  const pcIdInt = parseInt(playCricketId, 10)
  return (
    assocViaSF(db, pcIdInt, fixtureId, fixture) ??
    assocViaHtmlIds(db, pcIdInt, fixtureId, fixture, htmlTeamIds) ??
    assocViaLabel(db, pcIdInt, fixtureId, fixture)
  )
}

// Re-associate all existing PC-ingested fixtures using the corrected logic.
// Runs at startup to repair any historically mis-associated fixture_seasons rows.
// Pure DB — no network calls.
function reAssociateAllFixtures(db) {
  // Find every PC-ingested fixture that has a scheduled_fixtures row with a known team.
  // fixtures.play_cricket_id is TEXT; scheduled_fixtures.play_cricket_id is INTEGER — cast to match.
  const rows = db
    .prepare(
      `SELECT f.fixture_id, f.play_cricket_id, f.match_date_iso,
              sf.team_id AS sf_team_id, sf.season_id AS sf_season_id
       FROM fixtures f
       JOIN scheduled_fixtures sf ON sf.play_cricket_id = CAST(f.play_cricket_id AS INTEGER)
       WHERE f.play_cricket_id IS NOT NULL AND sf.team_id IS NOT NULL`
    )
    .all()

  let fixed = 0
  for (const row of rows) {
    const fixtureYear = (row.match_date_iso || '').slice(0, 4) || null
    const seasonId = bestSeasonId(db, row.sf_team_id, fixtureYear, row.sf_season_id)

    const current = db
      .prepare('SELECT team_id, season_id FROM fixture_seasons WHERE fixture_id = ?')
      .get(row.fixture_id)

    if (current?.team_id !== row.sf_team_id || current?.season_id !== seasonId) {
      db.prepare('DELETE FROM fixture_seasons WHERE fixture_id = ?').run(row.fixture_id)
      db.prepare(
        'INSERT OR IGNORE INTO fixture_seasons (fixture_id, team_id, season_id) VALUES (?, ?, ?)'
      ).run(row.fixture_id, row.sf_team_id, seasonId)
      // Keep scheduled_fixtures.season_id in sync too
      db.prepare('UPDATE scheduled_fixtures SET season_id = ? WHERE play_cricket_id = ?').run(
        seasonId,
        parseInt(row.play_cricket_id, 10)
      )
      fixed++
      console.log(
        `[reAssociate] fixture ${row.fixture_id} (PC:${row.play_cricket_id}): ` +
          `team ${current?.team_id ?? 'none'}/${current?.season_id ?? 'none'} → ${row.sf_team_id}/${seasonId}`
      )
    }
  }
  if (fixed > 0) console.log(`[reAssociate] corrected ${fixed} fixture association(s)`)
  else console.log('[reAssociate] all fixture associations already correct')
}

// Fetch and ingest a play-cricket match. All DB writes happen inside a single transaction
// so a partial failure leaves no trace in the fixtures table (and thus the frontend).
async function ingestMatch(playCricketId, opts = {}) {
  const { userId = null, userName = null } = opts
  const db = getDb()

  const data = await fetchMatchData(playCricketId)
  const matchMeta = parseHtmlScorecard(data.printHtml)

  // If Play Cricket has not yet published any scorecard data (no matchMeta and no innings JSON),
  // return without touching the DB. The scheduler keeps the row pending and retries later
  // rather than creating an empty-shell fixture row.
  const hasData = matchMeta || data.innings.some((i) => Array.isArray(i.json) && i.json.length)
  if (!hasData) return { fixtureId: null }

  const results = []
  let associated = null
  db.transaction(() => {
    // Ensure the fixture row exists before any FK-referencing inserts, even when
    // there are no innings to process yet (e.g. result not yet published on RV).
    db.prepare(`INSERT OR IGNORE INTO fixtures (fixture_id) VALUES (?)`).run(data.dbFixtureId)
    for (const inn of data.innings) {
      if (!Array.isArray(inn.json) || !inn.json.length) continue
      const stats = ingestDeliveries(
        data.dbFixtureId,
        inn.inningsOrder,
        inn.resultId,
        inn.json,
        matchMeta
      )
      results.push({ resultId: inn.resultId, inningsOrder: inn.inningsOrder, ...stats })
    }
    if (matchMeta && results.length) autoPopulateRoles(data.dbFixtureId)
    // No scraped metadata (result not yet published) → derive the fixture summary
    // from the ingested deliveries so the match list/season views match the detail page.
    if (!matchMeta && results.length) backfillFixtureSummary(db, data.dbFixtureId)
    db.prepare(`UPDATE fixtures SET play_cricket_id = ? WHERE fixture_id = ?`).run(
      String(playCricketId),
      data.dbFixtureId
    )
    if (data.maxOvers)
      db.prepare(`UPDATE fixtures SET max_overs = ? WHERE fixture_id = ?`).run(
        data.maxOvers,
        data.dbFixtureId
      )
    db.prepare(`DELETE FROM mvp_cache          WHERE fixture_id = ?`).run(data.dbFixtureId)
    db.prepare(`DELETE FROM match_stats_cache  WHERE fixture_id = ?`).run(data.dbFixtureId)
    db.prepare(`DELETE FROM match_detail_cache WHERE fixture_id = ?`).run(data.dbFixtureId)
    db.prepare(
      `INSERT INTO ingests (fixture_id, clerk_user_id, clerk_user_name, ingested_at, source_files, row_counts) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      data.dbFixtureId,
      userId,
      userName,
      Date.now(),
      JSON.stringify(['play-cricket']),
      JSON.stringify({ innings: results.length })
    )
    associated = autoAssociateTeam(db, playCricketId, data.dbFixtureId, data.teamIds ?? [])
  })()

  return {
    fixtureId: data.dbFixtureId,
    rvMatchId: data.rvMatchId,
    results,
    matchMeta,
    maxOvers: data.maxOvers ?? null,
    associated
  }
}

module.exports = { ingestMatch, reAssociateAllFixtures, _test: { autoAssociateTeam } }
