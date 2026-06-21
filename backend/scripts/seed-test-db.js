'use strict'
const path = require('path')

// Seed the test database with a known fixture, players and deliveries. Exported as a function
// so test files can call it directly (no child-process exec needed). Also runnable as a script.
function seed(dbPathArg) {
  const dbPath = dbPathArg || process.env.DB_PATH || path.resolve(__dirname, '..', 'test.sqlite')
  process.env.DB_PATH = dbPath

  const { getDb, closeDb } = require('../db/schema')
  const db = getDb()

  db.prepare('DELETE FROM wk_assignments').run()
  db.prepare('DELETE FROM wk_errors').run()
  db.prepare('DELETE FROM match_captains').run()
  db.prepare('DELETE FROM player_flags').run()
  db.prepare('DELETE FROM dismissals').run()
  db.prepare('DELETE FROM deliveries').run()
  db.prepare('DELETE FROM innings').run()
  db.prepare('DELETE FROM manual_bowling').run()
  db.prepare('DELETE FROM manual_batting').run()
  db.prepare('DELETE FROM manual_extras').run()
  db.prepare('DELETE FROM ingests').run()
  // Cache + scheduler tables also FK-reference fixtures; clear them so DELETE FROM fixtures
  // succeeds even when a server/e2e run has populated them against this test DB.
  for (const t of [
    'match_stats_cache',
    'match_detail_cache',
    'mvp_cache',
    'scheduled_fixtures',
    'watched_teams',
    'fixture_seasons'
  ]) {
    try {
      db.prepare(`DELETE FROM ${t}`).run()
    } catch (_) {}
  }
  db.prepare('DELETE FROM fixtures').run()
  db.prepare('DELETE FROM players').run()

  const insertPlayer = db.prepare(
    'INSERT INTO players (player_id, name, display_name, team) VALUES (?, ?, ?, ?)'
  )
  const players = [
    // WHCC Whirlwinds
    [101, 'Samuel Lawrence', 'Sam L', 'WHCC U11 Whirlwinds'],
    [102, 'Zac Henderson', null, 'WHCC U11 Whirlwinds'],
    [103, 'Leo Brown', null, 'WHCC U11 Whirlwinds'],
    [104, 'Tom Wilson', null, 'WHCC U11 Whirlwinds'],
    [105, 'Jack Smith', null, 'WHCC U11 Whirlwinds'],
    [106, 'Archie Jones', null, 'WHCC U11 Whirlwinds'],
    // WHCC Hurricanes
    [201, 'James Carter', null, 'WHCC U10 Hurricanes'],
    [202, 'Oliver Davis', null, 'WHCC U10 Hurricanes'],
    [203, 'Harry Evans', null, 'WHCC U10 Hurricanes'],
    // Opposition
    [301, 'Alex Taylor', null, 'Weybridge CC'],
    [302, 'Ben Martin', null, 'Weybridge CC'],
    [303, 'Chris White', null, 'Sunbury CC']
  ]
  for (const [id, name, dn, team] of players) insertPlayer.run(id, name, dn, team)

  const kemptonPlayers = [
    [401, 'Aiden Shaw', null, 'Kempton CC'],
    [402, 'Ben Clarke', null, 'Kempton CC'],
    [403, 'Charlie Reed', null, 'Kempton CC']
  ]
  for (const [id, name, dn, team] of kemptonPlayers) insertPlayer.run(id, name, dn, team)

  const insertFixture = db.prepare(
    'INSERT INTO fixtures (fixture_id, home_team, away_team, match_date, competition) VALUES (?, ?, ?, ?, ?)'
  )
  const fixtures = [
    ['25577112', 'WHCC U11 Whirlwinds', 'Weybridge CC', '2026-04-29', 'Surrey U11 League'],
    ['TEST_001', 'WHCC U11 Whirlwinds', 'Sunbury CC', '2026-04-22', 'Surrey U11 League'],
    ['TEST_002', 'WHCC U11 Whirlwinds', 'Walton CC', '2026-04-15', 'Surrey U11 League'],
    ['TEST_003', 'WHCC U11 Whirlwinds', 'Esher CC', '2026-04-08', 'Surrey U11 League'],
    ['TEST_004', 'WHCC U10 Hurricanes', 'Woking CC', '2026-04-01', 'Surrey U10 League'],
    ['TEST_005', 'WHCC U10 Hurricanes', 'Guildford CC', '2026-03-25', 'Surrey U10 League']
  ]
  for (const [fid, ht, at, md, comp] of fixtures) insertFixture.run(fid, ht, at, md, comp)

  insertFixture.run(
    'CROSS_001',
    'WHCC U11 Whirlwinds',
    'Kempton CC',
    '2026-05-06',
    'Surrey U11 League'
  )

  // Innings for KNOWN_FIXTURE (25577112)
  db.prepare('INSERT INTO innings (result_id, fixture_id, innings_order) VALUES (1001, ?, 1)').run(
    '25577112'
  )
  db.prepare('INSERT INTO innings (result_id, fixture_id, innings_order) VALUES (1002, ?, 2)').run(
    '25577112'
  )

  // Deliveries: WHCC bat (result_id=1001)
  // Sam L (101) and Zac (102) attend but don't bat — in player_flags only
  // Leo (103) and Tom (104) open; Jack (105) comes in; Archie (106) is 12th man equivalent
  const d = db.prepare(`
  INSERT INTO deliveries
    (result_id, innings_number, over_no, ball_no, ball_no_disp,
     batter_id, batter_id_ns, bowler_id, runs_bat, dismissed_batter_id)
  VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
`)

  // Over 0 — Leo (103) striker, Tom (104) non-striker; Alex Taylor (301) bowls
  d.run(1001, 0, 1, 1, 103, 104, 301, 2, null)
  d.run(1001, 0, 2, 2, 104, 103, 301, 0, null)
  d.run(1001, 0, 3, 3, 104, 103, 301, 4, null)
  d.run(1001, 0, 4, 4, 103, 104, 301, 1, null)
  d.run(1001, 0, 5, 5, 103, 104, 301, 6, null)
  d.run(1001, 0, 6, 6, 104, 103, 301, 0, 104) // Tom out

  // Over 1 — Leo (103) striker, Jack (105) non-striker; Ben Martin (302) bowls
  d.run(1001, 1, 1, 1, 105, 103, 302, 3, null)
  d.run(1001, 1, 2, 2, 103, 105, 302, 1, null)
  d.run(1001, 1, 3, 3, 105, 103, 302, 0, null)
  d.run(1001, 1, 4, 4, 105, 103, 302, 2, null)
  d.run(1001, 1, 5, 5, 103, 105, 302, 4, null)
  d.run(1001, 1, 6, 6, 103, 105, 302, 0, 103) // Leo out

  // Deliveries: Opp bat (result_id=1002)
  // Alex (301) and Ben (302) bat; Jack (105) and Archie (106) bowl
  const d2 = db.prepare(`
  INSERT INTO deliveries
    (result_id, innings_number, over_no, ball_no, ball_no_disp,
     batter_id, batter_id_ns, bowler_id, runs_bat, dismissed_batter_id)
  VALUES (?, 2, ?, ?, ?, ?, ?, ?, ?, ?)
`)

  d2.run(1002, 0, 1, 1, 301, 302, 105, 4, null)
  d2.run(1002, 0, 2, 2, 302, 301, 105, 0, null)
  d2.run(1002, 0, 3, 3, 302, 301, 105, 1, null)
  d2.run(1002, 0, 4, 4, 301, 302, 105, 6, null)
  d2.run(1002, 0, 5, 5, 301, 302, 105, 0, null)
  d2.run(1002, 0, 6, 6, 302, 301, 105, 0, 302) // Ben out

  d2.run(1002, 1, 1, 1, 301, 303, 106, 2, null)
  d2.run(1002, 1, 2, 2, 303, 301, 106, 0, null)
  d2.run(1002, 1, 3, 3, 303, 301, 106, 1, null)
  d2.run(1002, 1, 4, 4, 301, 303, 106, 3, null)
  d2.run(1002, 1, 5, 5, 301, 303, 106, 0, null)
  d2.run(1002, 1, 6, 6, 303, 301, 106, 0, 303) // Chris out

  // player_flags — Sam L (101) and Zac (102) attended but didn't bat or bowl
  const insertFlag = db.prepare('INSERT INTO player_flags (fixture_id, player_id) VALUES (?, ?)')
  for (const pid of [101, 102, 103, 104, 105, 106]) insertFlag.run('25577112', pid)

  // fixture_seasons — scope matches to team/season so access-control tests work.
  // team_id and season_id match publicMetadata in setup-clerk-test-users.js.
  // TEAM_WHIRLWINDS = 35534 (U11 Whirlwinds), TEAM_HURRICANES = 47317 (U10 Hurricanes)
  // SEASON = 259 (2026)
  const insertSeason = db.prepare(
    'INSERT OR IGNORE INTO fixture_seasons (fixture_id, team_id, season_id) VALUES (?, ?, ?)'
  )
  const TEAM_WHIRLWINDS = 35534,
    TEAM_HURRICANES = 47317,
    TEAM_KEMPTON = 99001,
    SEASON = 259
  for (const fid of ['25577112', 'TEST_001', 'TEST_002', 'TEST_003']) {
    insertSeason.run(fid, TEAM_WHIRLWINDS, SEASON)
  }
  for (const fid of ['TEST_004', 'TEST_005']) {
    insertSeason.run(fid, TEAM_HURRICANES, SEASON)
  }

  // Cross-club fixture visible from both clubs' team perspectives
  insertSeason.run('CROSS_001', TEAM_WHIRLWINDS, SEASON)
  insertSeason.run('CROSS_001', TEAM_KEMPTON, SEASON)

  // Clubs — keep WHCC (club_id=1), add Kempton (club_id=2)
  try {
    db.prepare('DELETE FROM clubs WHERE club_id > 1').run()
    db.prepare(
      `INSERT OR IGNORE INTO clubs (club_id, name, slug, app_name, primary_colour, secondary_colour, name_markers, play_cricket_domain)
      VALUES (2, 'Kempton CC', 'kempton', 'Kempton', '#003087', '#c8a800', '["kempton"]', 'kempton.play-cricket.com')`
    ).run()
  } catch (_) {}

  // watched_teams — clear and repopulate
  db.prepare('DELETE FROM watched_teams').run()
  const insertWt = db.prepare(
    'INSERT OR IGNORE INTO watched_teams (team_id, season_id, label, added_at, year, club_id) VALUES (?, ?, ?, ?, ?, ?)'
  )
  const NOW = new Date().toISOString()
  insertWt.run(TEAM_WHIRLWINDS, SEASON, 'WHCC U11 Whirlwinds', NOW, 2026, 1)
  insertWt.run(TEAM_HURRICANES, SEASON, 'WHCC U10 Hurricanes', NOW, 2026, 1)
  insertWt.run(TEAM_KEMPTON, SEASON, 'Kempton CC', NOW, 2026, 2)

  closeDb()
  return dbPath
}

module.exports = { seed }

// Runnable as a script: `node seed-test-db.js [dbPath]`
if (require.main === module) {
  const out = seed(process.argv[2])
  console.log(`Seeded test DB: ${out}`)
}
