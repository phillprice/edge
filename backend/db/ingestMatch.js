const { getDb } = require('./schema')
const { fetchMatchData } = require('../utils/resultsvault')
const { parseHtmlScorecard } = require('./htmlParser')
const { ingestDeliveries, autoPopulateRoles } = require('./ingest')
const { backfillFixtureSummary } = require('../utils/matchSummary')

// Thrown when the match's competition string identifies it as a non-senior (age-group) fixture.
// The scheduler catches this and marks the row 'skipped' rather than retrying.
class ExcludedCompetitionError extends Error {
  constructor(competition) {
    super(`age-group competition excluded: "${competition}"`)
    this.name = 'ExcludedCompetitionError'
  }
}

// Matches competition names for age-group (non-senior) fixtures.
// Examples: "Surrey Junior Cricket Championship - Girls Under 12/13 Tier 3 West 2026",
// "Surrey Under 13 T20", "Boys U11 West". Used to skip auto-ingest during scheduled runs.
const AGE_GROUP_COMP_RE = /\b(?:junior|girls?|boys?|under\s+\d{1,2}|u\d{1,2})\b/i

// After ingesting a match, try to link it to a watched_team entry by fuzzy-matching
// the fixture's home/away team names against watched_teams labels.
// If a match is found and we can infer the season_id, upsert a scheduled_fixtures row
// so the access filter can find it.
function autoAssociateTeam(db, playCricketId, fixtureId) {
  const fixture = db
    .prepare('SELECT home_team, away_team, match_date_iso FROM fixtures WHERE fixture_id = ?')
    .get(fixtureId)
  if (!fixture) return null

  const teams = db
    .prepare('SELECT team_id, season_id, label, year FROM watched_teams WHERE label IS NOT NULL')
    .all()
  const home = (fixture.home_team || '').toLowerCase()
  const away = (fixture.away_team || '').toLowerCase()
  const fixtureYear = (fixture.match_date_iso || '').slice(0, 4) || null

  // Collect every watched team whose label appears in either side's name.
  const labelMatches = teams.filter((t) => {
    const lbl = (t.label || '').toLowerCase()
    return lbl && (home.includes(lbl) || away.includes(lbl))
  })
  if (!labelMatches.length) return null

  // A team can be watched across multiple seasons (same label, different season_id/year).
  // Pick the season whose year matches the fixture's match year; otherwise fall back to the
  // first label match (and warn, since the association may be wrong).
  let chosen = labelMatches.find((t) => t.year && fixtureYear && String(t.year) === fixtureYear)
  if (!chosen) {
    chosen = labelMatches[0]
    if (
      labelMatches.length > 1 ||
      (chosen.year && fixtureYear && String(chosen.year) !== fixtureYear)
    ) {
      console.warn(
        `[ingestMatch] no exact season-year match for fixture ${playCricketId} (match year ${fixtureYear}); ` +
          `falling back to team ${chosen.team_id} / season ${chosen.season_id} (year ${chosen.year})`
      )
    }
  }

  // Record the access mapping (the table the access filter joins on). One mapping per fixture;
  // re-association replaces it so a repaired season is reflected here too.
  db.prepare('DELETE FROM fixture_seasons WHERE fixture_id = ?').run(fixtureId)
  db.prepare(
    'INSERT OR IGNORE INTO fixture_seasons (fixture_id, team_id, season_id) VALUES (?, ?, ?)'
  ).run(fixtureId, chosen.team_id, chosen.season_id)

  const existing = db
    .prepare('SELECT team_id, season_id FROM scheduled_fixtures WHERE play_cricket_id = ?')
    .get(parseInt(playCricketId, 10))
  if (existing) {
    // Repair a previously mis-associated season: if our year-matched choice differs, update it.
    if (existing.team_id !== chosen.team_id || existing.season_id !== chosen.season_id) {
      db.prepare(
        'UPDATE scheduled_fixtures SET team_id = ?, season_id = ? WHERE play_cricket_id = ?'
      ).run(chosen.team_id, chosen.season_id, parseInt(playCricketId, 10))
      console.log(
        `[ingestMatch] repaired association for fixture ${playCricketId}: ${existing.team_id}/${existing.season_id} → ${chosen.team_id}/${chosen.season_id}`
      )
    }
    return { team_id: chosen.team_id, season_id: chosen.season_id }
  }

  // No existing row (handled above) — insert it already marked done with ingested_at set.
  const nowIso = new Date().toISOString()
  db.prepare(
    `
    INSERT INTO scheduled_fixtures
      (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at, home_team, away_team, status, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'done', ?)
  `
  ).run(
    parseInt(playCricketId, 10),
    chosen.team_id,
    chosen.season_id,
    fixture.match_date_iso,
    fixture.match_date_iso, // ingest_after = match date (already past)
    nowIso,
    fixture.home_team,
    fixture.away_team,
    nowIso
  )

  console.log(
    `[ingestMatch] auto-associated fixture ${playCricketId} → team ${chosen.team_id} / season ${chosen.season_id} (label: ${chosen.label}, year: ${chosen.year})`
  )
  return { team_id: chosen.team_id, season_id: chosen.season_id }
}

// Fetch and ingest a play-cricket match. All DB writes happen inside a single transaction
// so a partial failure leaves no trace in the fixtures table (and thus the frontend).
async function ingestMatch(playCricketId, opts = {}) {
  const { userId = null, userName = null } = opts
  const db = getDb()

  const data = await fetchMatchData(playCricketId)
  const matchMeta = parseHtmlScorecard(data.printHtml)

  const comp = matchMeta?.competition || ''
  if (comp && AGE_GROUP_COMP_RE.test(comp)) throw new ExcludedCompetitionError(comp)

  // If Play Cricket has not yet published any scorecard data (no matchMeta and no innings JSON),
  // return without touching the DB. The scheduler keeps the row pending and retries later
  // rather than creating an empty-shell fixture row.
  const hasData = matchMeta || data.innings.some((i) => Array.isArray(i.json) && i.json.length)
  if (!hasData) return { fixtureId: null }

  const results = []
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
  })()

  const associated = autoAssociateTeam(db, playCricketId, data.dbFixtureId)
  return {
    fixtureId: data.dbFixtureId,
    rvMatchId: data.rvMatchId,
    results,
    matchMeta,
    maxOvers: data.maxOvers ?? null,
    associated
  }
}

module.exports = { ingestMatch, ExcludedCompetitionError, _test: { autoAssociateTeam } }
