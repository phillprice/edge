const { getDb } = require('./schema');
const { toIsoDate } = require('../utils/cricket');
const { isWhccTeam } = require('../utils/db');

function parseMsDate(raw) {
  if (!raw) return null;
  const m = raw.match(/\/Date\((\d+)/);
  return m ? new Date(Number(m[1])).toISOString() : null;
}

function syntheticPlayerId(name) {
  let h = 0;
  for (const c of name) h = ((h << 5) - h + c.charCodeAt(0)) | 0;
  return h >= 0 ? -(h + 1) : h; // always negative
}

// When a player gets a real play-cricket ID, retire any synthetic entry for the same name.
// All references in every table are remapped to the real ID, then the synthetic row is deleted.
function mergeSyntheticPlayer(db, realId, name) {
  const row = db.prepare(
    'SELECT player_id FROM players WHERE player_id < 0 AND LOWER(name) = LOWER(?)'
  ).get(name);
  if (!row) return;
  const synthId = row.player_id;

  db.transaction(() => {
    // dismissals — three FK columns
    for (const col of ['batter_id', 'bowler_id', 'fielder_id']) {
      db.prepare(`UPDATE dismissals SET ${col} = ? WHERE ${col} = ?`).run(realId, synthId);
    }

    // player_flags — PRIMARY KEY (fixture_id, player_id): upsert-merge then delete
    const pf = db.prepare('SELECT fixture_id, is_captain, is_wk FROM player_flags WHERE player_id = ?').all(synthId);
    for (const f of pf) {
      db.prepare(`
        INSERT INTO player_flags (fixture_id, player_id, is_captain, is_wk) VALUES (?, ?, ?, ?)
        ON CONFLICT(fixture_id, player_id) DO UPDATE SET
          is_captain = MAX(player_flags.is_captain, excluded.is_captain),
          is_wk      = MAX(player_flags.is_wk,      excluded.is_wk)
      `).run(f.fixture_id, realId, f.is_captain, f.is_wk);
    }
    db.prepare('DELETE FROM player_flags WHERE player_id = ?').run(synthId);

    // match_captains — PRIMARY KEY (fixture_id, innings_order)
    const mc = db.prepare('SELECT fixture_id, innings_order FROM match_captains WHERE player_id = ?').all(synthId);
    for (const c of mc) {
      db.prepare('INSERT OR REPLACE INTO match_captains (fixture_id, innings_order, player_id) VALUES (?, ?, ?)').run(c.fixture_id, c.innings_order, realId);
    }
    db.prepare('DELETE FROM match_captains WHERE player_id = ?').run(synthId);

    // wk_assignments — UNIQUE(fixture_id, innings_order, from_over)
    const wk = db.prepare('SELECT fixture_id, innings_order, from_over, to_over FROM wk_assignments WHERE player_id = ?').all(synthId);
    for (const w of wk) {
      db.prepare('INSERT OR IGNORE INTO wk_assignments (fixture_id, innings_order, player_id, from_over, to_over) VALUES (?, ?, ?, ?, ?)').run(w.fixture_id, w.innings_order, realId, w.from_over, w.to_over);
    }
    db.prepare('DELETE FROM wk_assignments WHERE player_id = ?').run(synthId);

    // wk_errors — no unique constraint
    db.prepare('UPDATE wk_errors SET player_id = ? WHERE player_id = ?').run(realId, synthId);

    // deliveries — synthetic players shouldn't appear here, but just in case
    for (const col of ['batter_id', 'bowler_id', 'dismissed_batter_id']) {
      db.prepare(`UPDATE deliveries SET ${col} = ? WHERE ${col} = ?`).run(realId, synthId);
    }

    // manual_batting / manual_bowling — both have UNIQUE(fixture_id, innings_order, player_id)
    // Update rows that won't conflict; delete any that would (real entry already exists)
    for (const tbl of ['manual_batting', 'manual_bowling']) {
      db.prepare(`
        UPDATE ${tbl} SET player_id = ? WHERE player_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM ${tbl} t2
          WHERE t2.fixture_id = ${tbl}.fixture_id
            AND t2.innings_order = ${tbl}.innings_order
            AND t2.player_id = ?
        )
      `).run(realId, synthId, realId);
      db.prepare(`DELETE FROM ${tbl} WHERE player_id = ?`).run(synthId);
    }

    db.prepare('DELETE FROM players WHERE player_id = ?').run(synthId);
  })();
}

function parseDesc(lDesc) {
  if (!lDesc) return {};
  // Single lazy group + greedy remainder (linear — avoids the polynomial backtracking of two
  // chained lazy quantifiers). The trailing ":…" / "dismissed …" suffix is stripped in JS.
  const match = lDesc.trim().match(/^(.+?)\s+to\s+(.+)$/);
  if (!match) return {};
  return {
    bowlerName: match[1].trim(),
    batterName: match[2].replace(/\s*:.*$/, '').replace(/\s+dismissed.*$/, '').trim()
  };
}

function resolveFullName(abbrev, fullNames) {
  if (!abbrev) return null;
  const parts = abbrev.trim().split(/\s+/);
  const surname = parts[parts.length - 1].toLowerCase();
  const initials = parts.slice(0, -1).map(p => p[0].toLowerCase());
  const candidates = fullNames.filter(full => {
    const fp = full.trim().split(/\s+/);
    if (fp[fp.length - 1].toLowerCase() !== surname) return false;
    const forenames = fp.slice(0, -1);
    if (initials.length > forenames.length) return false;
    return initials.every((init, i) => forenames[i]?.[0]?.toLowerCase() === init);
  });
  return candidates.length === 1 ? candidates[0] : null;
}

function ingestDeliveries(fixtureId, inningsOrder, resultId, inningsJson, matchMeta) {
  const db = getDb();

  // Upsert fixture
  if (matchMeta) {
    db.prepare(`
      INSERT INTO fixtures (fixture_id, home_team, away_team, ground, match_date, match_date_iso,
        competition, toss_winner, toss_decision, result, home_score, away_score, home_overs, away_overs,
        home_wickets, away_wickets, format, starting_score)
      VALUES (@fixture_id, @home_team, @away_team, @ground, @match_date, @match_date_iso,
        @competition, @toss_winner, @toss_decision, @result, @home_score, @away_score, @home_overs, @away_overs,
        @home_wickets, @away_wickets, @format, @starting_score)
      ON CONFLICT(fixture_id) DO UPDATE SET
        home_team=excluded.home_team, away_team=excluded.away_team,
        ground=excluded.ground, match_date=excluded.match_date, match_date_iso=excluded.match_date_iso,
        competition=excluded.competition, toss_winner=excluded.toss_winner,
        toss_decision=excluded.toss_decision, result=excluded.result, home_score=excluded.home_score,
        away_score=excluded.away_score, home_overs=excluded.home_overs,
        away_overs=excluded.away_overs,
        home_wickets=excluded.home_wickets, away_wickets=excluded.away_wickets,
        format=excluded.format, starting_score=excluded.starting_score
    `).run({
      fixture_id: fixtureId,
      home_team: matchMeta.homeTeam,
      away_team: matchMeta.awayTeam,
      ground: matchMeta.ground,
      match_date: matchMeta.matchDate,
      match_date_iso: toIsoDate(matchMeta.matchDate),
      competition: matchMeta.competition,
      toss_winner: matchMeta.tossWinner,
      toss_decision: matchMeta.tossDecision,
      result: matchMeta.matchResult,
      home_score: matchMeta.homeScore,
      away_score: matchMeta.awayScore,
      home_overs: matchMeta.homeOvers,
      away_overs: matchMeta.awayOvers,
      home_wickets: matchMeta.homeWickets,
      away_wickets: matchMeta.awayWickets,
      format: matchMeta.format || 'standard',
      starting_score: matchMeta.startingScore || 0,
    });
  } else {
    db.prepare(`INSERT OR IGNORE INTO fixtures (fixture_id) VALUES (?)`).run(fixtureId);
  }

  // Upsert innings row
  db.prepare(`
    INSERT INTO innings (result_id, fixture_id, innings_order)
    VALUES (?, ?, ?)
    ON CONFLICT(result_id) DO UPDATE SET innings_order=excluded.innings_order
  `).run(resultId, fixtureId, inningsOrder);

  // Build player name map from l_desc
  const playerNames = {};
  for (const ball of inningsJson) {
    const { bowlerName, batterName } = parseDesc(ball.l_desc);
    if (bowlerName && ball.bowler_id) playerNames[ball.bowler_id] = bowlerName;
    if (batterName && ball.batter_id) playerNames[ball.batter_id] = batterName;
  }

  // Build PDF full names list and team map
  const pdfPlayers = matchMeta ? Object.values(matchMeta.players) : [];
  const pdfFullNames = pdfPlayers.map(p => p.name);
  // Create a team lookup by full name
  const pdfTeamByName = {};
  for (const p of pdfPlayers) pdfTeamByName[p.name] = p.team;

  // Resolve abbreviated -> full names, and collect team info
  const playerTeams = {};
  if (pdfFullNames.length) {
    for (const [id, abbrev] of Object.entries(playerNames)) {
      const full = resolveFullName(abbrev, pdfFullNames);
      if (full) {
        playerNames[id] = full;
        if (pdfTeamByName[full]) playerTeams[id] = pdfTeamByName[full];
      }
    }
  }

  // Add HTML-only players (DNB etc.) who have no delivery ID.
  // First check if they already exist in the DB by name (from a previous match where they did play).
  // If so, reuse their existing ID to avoid duplicates. Otherwise assign a stable negative synthetic ID.
  const resolvedNamesLower = new Set(Object.values(playerNames).map(n => n.toLowerCase()));
  const lookupByName = db.prepare('SELECT player_id FROM players WHERE LOWER(name) = LOWER(?) LIMIT 1');
  const synthPlayers = [];
  for (const p of pdfPlayers) {
    if (!resolvedNamesLower.has(p.name.toLowerCase())) {
      const existing = lookupByName.get(p.name);
      const id = existing ? existing.player_id : syntheticPlayerId(p.name);
      synthPlayers.push({ id, name: p.name, team: p.team || null });
    }
  }

  // Upsert players — prefer longer names, also set team
  const upsertPlayer = db.prepare(`
    INSERT INTO players (player_id, name, team) VALUES (?, ?, ?)
    ON CONFLICT(player_id) DO UPDATE SET
      name = CASE WHEN length(excluded.name) > length(players.name) THEN excluded.name ELSE players.name END,
      team = CASE WHEN excluded.team IS NOT NULL AND excluded.team != '' THEN excluded.team ELSE players.team END
  `);
  for (const [id, name] of Object.entries(playerNames)) {
    upsertPlayer.run(Number(id), name, playerTeams[id] || null);
  }

  // Merge any synthetic entries now superseded by real play-cricket IDs
  for (const [id, name] of Object.entries(playerNames)) {
    mergeSyntheticPlayer(db, Number(id), name);
  }

  for (const { id, name, team } of synthPlayers) {
    upsertPlayer.run(id, name, team);
  }

  // Upsert deliveries
  const upsertDelivery = db.prepare(`
    INSERT INTO deliveries
      (result_id, innings_number, over_no, ball_no, ball_no_disp,
       batter_id, batter_id_ns, bowler_id, dismissed_batter_id,
       runs_bat, runs_extra, extras_type, l_desc, s_desc, last_update_time)
    VALUES
      (@result_id, @innings_number, @over_no, @ball_no, @ball_no_disp,
       @batter_id, @batter_id_ns, @bowler_id, @dismissed_batter_id,
       @runs_bat, @runs_extra, @extras_type, @l_desc, @s_desc, @last_update_time)
    ON CONFLICT(result_id, innings_number, over_no, ball_no, ball_no_disp) DO NOTHING
  `);

  const insertMany = db.transaction((balls) => {
    for (const b of balls) {
      upsertDelivery.run({
        result_id: resultId,
        innings_number: b.innings_number,
        over_no: b.over_no,
        ball_no: b.ball_no,
        ball_no_disp: b.ball_no_disp,
        batter_id: b.batter_id,
        batter_id_ns: b.batter_id_ns,
        bowler_id: b.bowler_id,
        dismissed_batter_id: b.dismissed_batter_id || null,
        runs_bat: b.runs_bat ?? 0,
        runs_extra: b.runs_extra ?? 0,
        extras_type: b.extras_type || null,
        l_desc: b.l_desc,
        s_desc: b.s_desc,
        last_update_time: parseMsDate(b.last_update_time),
      });
    }
  });

  insertMany(inningsJson);

  // Ensure every player referenced in these deliveries has a players row.
  // If l_desc parsing missed a player (e.g., wide with no batter in description), their
  // ID ends up in deliveries without a players entry. Insert a stub so they appear in stats.
  {
    const whccTeam = matchMeta
      ? (isWhccTeam(matchMeta.homeTeam) ? matchMeta.homeTeam : isWhccTeam(matchMeta.awayTeam) ? matchMeta.awayTeam : null)
      : null
    const missingIds = db.prepare(`
      SELECT DISTINCT p_id FROM (
        SELECT batter_id AS p_id FROM deliveries WHERE result_id = ? AND batter_id IS NOT NULL
        UNION SELECT bowler_id FROM deliveries WHERE result_id = ? AND bowler_id IS NOT NULL
      ) WHERE p_id NOT IN (SELECT player_id FROM players)
    `).all(resultId, resultId)
    for (const { p_id } of missingIds) {
      db.prepare(`INSERT OR IGNORE INTO players (player_id, name, team) VALUES (?, ?, ?)`)
        .run(p_id, `Unknown #${p_id}`, playerTeams[p_id] || whccTeam)
    }
  }

  // Store dismissals and captain/WK flags parsed from the PDF batting sections
  // On re-ingest of innings 1, wipe stale player_flags first so phantom players
  // from a previously buggy parse (e.g. extras rows parsed as batters) don't persist.
  if (matchMeta?.innings && inningsOrder === 1) {
    db.prepare('DELETE FROM player_flags WHERE fixture_id = ?').run(fixtureId);
  }
  if (matchMeta?.innings) {
    const inningsData = matchMeta.innings[inningsOrder - 1];
    if (inningsData?.batters?.length) {
      // Clear stale dismissal rows for this innings so old raw_batter strings don't persist
      db.prepare('DELETE FROM dismissals WHERE fixture_id = ? AND innings_order = ?').run(fixtureId, inningsOrder);

      // Build name → player_id lookup from the players table
      const allPlayers = db.prepare(`SELECT player_id, name FROM players`).all();
      const nameToId = {};
      for (const p of allPlayers) nameToId[p.name.toLowerCase()] = p.player_id;
      const findId = name => name ? (nameToId[name.toLowerCase()] ?? null) : null;

      const upsertDismissal = db.prepare(`
        INSERT INTO dismissals
          (fixture_id, innings_order, batter_id, bowler_id, fielder_id, method, raw_batter, raw_bowler, raw_fielder)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(fixture_id, innings_order, raw_batter) DO UPDATE SET
          batter_id  = excluded.batter_id,
          bowler_id  = excluded.bowler_id,
          fielder_id = excluded.fielder_id,
          method     = excluded.method,
          raw_bowler = excluded.raw_bowler,
          raw_fielder= excluded.raw_fielder
      `);
      const upsertFlag = db.prepare(`
        INSERT INTO player_flags (fixture_id, player_id, is_captain, is_wk)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(fixture_id, player_id) DO UPDATE SET
          is_captain = MAX(player_flags.is_captain, excluded.is_captain),
          is_wk      = MAX(player_flags.is_wk,      excluded.is_wk)
      `);

      const storeBatch = db.transaction(batters => {
        for (const b of batters) {
          const batterId  = findId(b.name);
          const bowlerId  = findId(b.bowler);
          const fielderId = findId(b.fielder);

          // Store ALL batters (including DNB) so they appear in squad dropdowns
          if (batterId) {
            upsertFlag.run(fixtureId, batterId, b.isCapt ? 1 : 0, b.isWK ? 1 : 0);
          }
          // Store dismissed AND retired batters so the scorecard can display the
          // correct description for each. Retired rows have dismissed=false in the
          // parser but we still need the method stored to show "retired not out".
          if (b.dismissed || b.method === 'Retired') {
            upsertDismissal.run(
              fixtureId, inningsOrder,
              batterId, bowlerId, fielderId,
              b.method, b.name, b.bowler, b.fielder
            );
          }
        }
      });
      storeBatch(inningsData.batters);
    }
  }

  return { deliveries: inningsJson.length, players: Object.keys(playerNames).length };
}

// Called after all innings for a fixture are ingested.
// Reads player_flags and populates match_captains + wk_assignments where not already set.
// Uses the fixture's canonical team names to avoid stale U10/U11 mismatches in player.team.
function autoPopulateRoles(fixtureId) {
  const db = getDb();

  const inningsList = db.prepare(
    'SELECT result_id, innings_order FROM innings WHERE fixture_id = ? ORDER BY innings_order'
  ).all(fixtureId);
  if (inningsList.length < 2) return;

  const fixture = db.prepare('SELECT home_team, away_team FROM fixtures WHERE fixture_id = ?').get(fixtureId);
  if (!fixture) return;



  // Determine which innings_order is WHCC's batting innings vs opponent's
  // by checking whether the first batter in each innings is WHCC (keyword match on their team)
  let whccBattingOrder = null, oppBattingOrder = null;
  for (const inn of inningsList) {
    const row = db.prepare(
      'SELECT p.team FROM deliveries d JOIN players p ON p.player_id = d.batter_id WHERE d.result_id = ? ORDER BY d.over_no, d.ball_no LIMIT 1'
    ).get(inn.result_id);
    if (isWhccTeam(row?.team)) whccBattingOrder = inn.innings_order;
    else oppBattingOrder = inn.innings_order;
  }
  if (whccBattingOrder === null || oppBattingOrder === null) return;

  const flags = db.prepare(
    'SELECT pf.player_id, pf.is_captain, pf.is_wk, p.team FROM player_flags pf JOIN players p ON p.player_id = pf.player_id WHERE pf.fixture_id = ? AND (pf.is_captain = 1 OR pf.is_wk = 1)'
  ).all(fixtureId);

  const insertCaptain = db.prepare(
    'INSERT OR IGNORE INTO match_captains (fixture_id, innings_order, player_id) VALUES (?, ?, ?)'
  );
  const insertWk = db.prepare(
    'INSERT OR REPLACE INTO wk_assignments (fixture_id, innings_order, player_id, from_over, to_over) VALUES (?, ?, ?, 1, NULL)'
  );

  db.transaction(() => {
    // Clear ALL keeper assignments for the WHCC fielding innings before re-populating.
    // Re-ingest must fully reflect the latest scorecard — stale entries from before
    // a scorecard correction would otherwise persist indefinitely.
    if (oppBattingOrder != null) {
      db.prepare(
        'DELETE FROM wk_assignments WHERE fixture_id = ? AND innings_order = ?'
      ).run(fixtureId, oppBattingOrder);
    }

    for (const flag of flags) {
      // Determine this player's side using WHCC keyword on their stored team name
      const isWhcc = isWhccTeam(flag.team);
      const battingOrder  = isWhcc ? whccBattingOrder : oppBattingOrder;
      const fieldingOrder = isWhcc ? oppBattingOrder  : whccBattingOrder;

      if (flag.is_captain) {
        insertCaptain.run(fixtureId, battingOrder, flag.player_id);
      }
      // Only auto-assign WHCC keepers (the coach only tracks their own side's WK)
      if (flag.is_wk && isWhcc) {
        insertWk.run(fixtureId, fieldingOrder, flag.player_id);
      }
    }
  })();
}

// Compute max_overs from actual delivery data and write it to the fixture.
// Called after all innings are ingested so both innings' over_no values are available.
// Uses the highest over_no across all innings (0-indexed) + 1, rounded up to the nearest
// standard format boundary. Reliable even when one team is bowled out early because the
// other team's innings typically reaches the actual format ceiling.
function updateMaxOvers(fixtureId) {
  const db = getDb();
  const row = db.prepare(`
    SELECT MAX(d.over_no) AS max_over
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    WHERE i.fixture_id = ?
  `).get(fixtureId);
  if (row?.max_over == null) return;
  const bowled = row.max_over + 1; // over_no is 0-indexed
  let max_overs;
  if (bowled > 45) max_overs = 50;
  else if (bowled > 35) max_overs = 40;
  else if (bowled > 22) max_overs = 35;
  else max_overs = 20;
  db.prepare('UPDATE fixtures SET max_overs = ? WHERE fixture_id = ?').run(max_overs, fixtureId);
}

module.exports = { ingestDeliveries, autoPopulateRoles, updateMaxOvers };
