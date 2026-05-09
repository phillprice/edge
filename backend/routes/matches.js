const express = require('express');
const router = express.Router();
const { getDb } = require('../db/schema');

// GET /api/matches
router.get('/', (req, res) => {
  const db = getDb();
  const fixtures = db.prepare(`
    SELECT f.*,
      COUNT(DISTINCT i.result_id) as innings_count,
      COUNT(d.id) as total_deliveries,
      (SELECT COALESCE(SUM(mb.runs), 0) + COALESCE((SELECT me.batting_extras FROM manual_extras me WHERE me.fixture_id = f.fixture_id), 0)
       FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id) as manual_runs,
      (SELECT me.batting_extras FROM manual_extras me WHERE me.fixture_id = f.fixture_id) as manual_extras,
      (SELECT COUNT(*)      FROM manual_batting mb  WHERE mb.fixture_id = f.fixture_id AND mb.not_out = 0) as manual_wkts,
      (SELECT SUM(mbw.wickets) FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id) as manual_bowl_wkts,
      (SELECT p.name FROM manual_batting mb JOIN players p ON p.player_id = mb.player_id
       WHERE mb.fixture_id = f.fixture_id ORDER BY mb.runs DESC LIMIT 1) as manual_top_bat,
      (SELECT mb.runs FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id ORDER BY mb.runs DESC LIMIT 1) as manual_top_bat_runs,
      (SELECT p.name FROM manual_bowling mbw JOIN players p ON p.player_id = mbw.player_id
       WHERE mbw.fixture_id = f.fixture_id ORDER BY mbw.wickets DESC, mbw.runs ASC LIMIT 1) as manual_top_bowl,
      (SELECT mbw.wickets FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id ORDER BY mbw.wickets DESC LIMIT 1) as manual_top_bowl_wkts
    FROM fixtures f
    LEFT JOIN innings i ON i.fixture_id = f.fixture_id
    LEFT JOIN deliveries d ON d.result_id = i.result_id
    GROUP BY f.fixture_id
    ORDER BY f.match_date DESC, f.fixture_id DESC
  `).all();
  res.json(fixtures);
});

// GET /api/matches/:fixtureId
router.get('/:fixtureId', (req, res) => {
  const db = getDb();
  const fixtureId = req.params.fixtureId;

  const fixture = db.prepare(`SELECT * FROM fixtures WHERE fixture_id = ?`).get(fixtureId);
  if (!fixture) return res.status(404).json({ error: 'Match not found' });

  const inningsList = db.prepare(`
    SELECT * FROM innings WHERE fixture_id = ? ORDER BY innings_order
  `).all(fixtureId);

  const scorecards = inningsList.map(inn => buildScorecard(db, inn.result_id, inn.innings_order, fixture.format, fixture.starting_score));

  res.json({ fixture, scorecards });
});

function buildScorecard(db, resultId, inningsOrder, format, startingScore) {
  const isPairs = format === 'pairs';
  const deliveries = db.prepare(`
    SELECT d.*, p_bat.name as batter_name, p_bow.name as bowler_name
    FROM deliveries d
    LEFT JOIN players p_bat ON p_bat.player_id = d.batter_id
    LEFT JOIN players p_bow ON p_bow.player_id = d.bowler_id
    WHERE d.result_id = ?
    ORDER BY d.over_no, d.ball_no_disp
  `).all(resultId);

  if (!deliveries.length) return { inningsOrder, isPairs, batting: [], bowling: [], overs: [], totals: {} };

  // Pre-compute over list (needed by both bowler overs and totals sections)
  const overNos = [...new Set(deliveries.map(d => d.over_no))].sort((a, b) => a - b);

  // ---- Batting ----
  const batters = {};
  for (const d of deliveries) {
    const id = d.batter_id;
    if (!batters[id]) batters[id] = {
      player_id: id, name: d.batter_name || `#${id}`,
      runs: 0, balls: 0, fours: 0, sixes: 0,
      dismissed: false, dismissalDesc: null, dismissalType: null, timesOut: 0
    };
    const b = batters[id];
    b.runs  += d.runs_bat;
    b.balls += 1;
    if (d.runs_bat === 4) b.fours++;
    if (d.runs_bat === 6) b.sixes++;
    if (d.dismissed_batter_id === id) {
      if (isPairs) {
        b.timesOut++;
      } else {
        b.dismissed = true;
        b.dismissalDesc = d.l_desc?.trim() || 'out';
        b.dismissalType = classifyDismissal(d.l_desc, d.s_desc);
      }
    }
  }

  if (isPairs) {
    for (const b of Object.values(batters)) {
      b.netScore = b.runs - b.timesOut * 5;
    }
  }

  // Override dismissal info from PDF-sourced dismissals table (more reliable than ball descriptions)
  const pdfDismissals = db.prepare(`
    SELECT dis.batter_id, dis.method, pf.name as fielder_name, pb.name as bowler_name
    FROM dismissals dis
    LEFT JOIN players pf ON pf.player_id = dis.fielder_id
    LEFT JOIN players pb ON pb.player_id = dis.bowler_id
    JOIN innings i ON i.fixture_id = dis.fixture_id AND i.innings_order = dis.innings_order
    WHERE i.result_id = ?
  `).all(resultId);
  for (const pd of pdfDismissals) {
    if (!pd.batter_id || !batters[pd.batter_id]) continue;
    const b = batters[pd.batter_id];
    b.dismissalType = pd.method;
    b.dismissalDesc = formatDismissal(pd.method, pd.fielder_name, pd.bowler_name);
  }

  // ---- Bowling ----
  const bowlers = {};
  for (const d of deliveries) {
    const id = d.bowler_id;
    if (!bowlers[id]) bowlers[id] = {
      player_id: id, name: d.bowler_name || `#${id}`,
      balls: 0, runs: 0, wickets: 0, wides: 0, noBalls: 0, maidens: 0
    };
    const b = bowlers[id];
    const isExtra = d.extras_type === 1 || d.extras_type === 2;
    if (!isExtra) b.balls++;
    b.runs += (d.runs_bat + d.runs_extra);
    if (d.dismissed_batter_id) b.wickets++;
    if (d.extras_type === 2) b.wides++;
    if (d.extras_type === 1) b.noBalls++;
  }

  // Maiden overs: group by over+bowler, maiden if 0 runs conceded
  const overGroups = {};
  for (const d of deliveries) {
    const key = `${d.over_no}:${d.bowler_id}`;
    if (!overGroups[key]) overGroups[key] = { bowler_id: d.bowler_id, runs: 0 };
    overGroups[key].runs += d.runs_bat + d.runs_extra;
  }
  for (const g of Object.values(overGroups)) {
    if (g.runs === 0 && bowlers[g.bowler_id]) bowlers[g.bowler_id].maidens++;
  }
  // Bowler overs: count distinct over_no values (API often has missing balls in middle overs)
  // Only the last over of the innings might be genuinely incomplete
  const inningsLastOver = overNos.length ? overNos[overNos.length - 1] : -1;
  for (const b of Object.values(bowlers)) {
    const bOvers = [...new Set(deliveries.filter(d => d.bowler_id === b.player_id).map(d => d.over_no))].sort((a, x) => a - x);
    if (!bOvers.length) { b.overs = '0'; b.economy = null; continue; }
    const bLast = bOvers[bOvers.length - 1];
    const lastBalls = bLast === inningsLastOver
      ? deliveries.filter(d => d.bowler_id === b.player_id && d.over_no === bLast && d.extras_type !== 1 && d.extras_type !== 2).length
      : 6;
    const complete = bOvers.length - (lastBalls < 6 ? 1 : 0);
    b.overs = lastBalls < 6 ? `${complete}.${lastBalls}` : String(complete);
    const effOvers = complete + (lastBalls < 6 ? lastBalls / 6 : 0);
    b.economy = effOvers > 0 ? (b.runs / effOvers).toFixed(2) : null;
  }

  // ---- Dismissal method stats — built from batters (already PDF-corrected above) ----
  const dismissalMethods = {};
  for (const b of Object.values(batters)) {
    if (!b.dismissed) continue;
    const t = b.dismissalType || 'out';
    dismissalMethods[t] = (dismissalMethods[t] || 0) + 1;
  }

  // ---- Catches ----
  const catches = {};  // player_id -> count
  for (const d of deliveries) {
    if (!d.dismissed_batter_id) continue;
    const catcher = parseCatcher(d.l_desc);
    if (catcher) catches[catcher] = (catches[catcher] || 0) + 1;
  }

  // ---- Over-by-over ----
  const overs = overNos.map(ov => {
    const balls = deliveries.filter(d => d.over_no === ov).sort((a,b)=>a.ball_no_disp-b.ball_no_disp);
    const runs  = balls.reduce((s, d) => s + d.runs_bat + d.runs_extra, 0);
    const wkts  = balls.filter(d => d.dismissed_batter_id).length;
    return {
      over: ov + 1,
      runs,
      wickets: wkts,
      bowler: balls[0]?.bowler_name || '?',
      balls: balls.map(d => ({
        s_desc: d.s_desc?.trim() || '.',
        runs_bat: d.runs_bat,
        runs_extra: d.runs_extra,
        extras_type: d.extras_type,
        wicket: !!d.dismissed_batter_id,
      }))
    };
  });

  // ---- Totals ----
  const totalRuns  = deliveries.reduce((s, d) => s + d.runs_bat + d.runs_extra, 0);
  const totalWkts  = deliveries.filter(d => d.dismissed_batter_id).length;
  const extras = { byes: 0, legByes: 0, wides: 0, noBalls: 0 };
  for (const d of deliveries) {
    if (d.extras_type === 3) extras.byes    += d.runs_extra;
    if (d.extras_type === 4) extras.legByes += d.runs_extra;
    if (d.extras_type === 2) extras.wides   += d.runs_extra;
    if (d.extras_type === 1) extras.noBalls += d.runs_extra;
  }

  // Use MAX(over_no) rather than total legal balls — API data often has missing deliveries in middle overs
  const maxOverNo = overNos.length ? overNos[overNos.length - 1] : -1;
  const ballsInLastOver = maxOverNo >= 0
    ? deliveries.filter(d => d.over_no === maxOverNo && d.extras_type !== 1 && d.extras_type !== 2).length
    : 0;
  const oversStr = maxOverNo < 0 ? '0'
    : ballsInLastOver === 6 ? String(maxOverNo + 1)
    : `${maxOverNo}.${ballsInLastOver}`;

  return {
    inningsOrder,
    resultId,
    isPairs,
    batting: Object.values(batters),
    bowling: Object.values(bowlers),
    overs,
    dismissalMethods,
    catches,
    totals: {
      runs: totalRuns, wickets: totalWkts,
      overs: oversStr,
      extras,
      netTotal: isPairs ? totalRuns + (startingScore || 0) - totalWkts * 5 : null,
    }
  };
}

function formatDismissal(method, fielder, bowler) {
  const f = fielder, b = bowler;
  switch (method) {
    case 'Caught':          return (f && b) ? `ct ${f} b ${b}` : (b ? `caught b ${b}` : 'caught');
    case 'CaughtAndBowled': return b ? `c&b ${b}` : 'c&b';
    case 'Bowled':          return b ? `b ${b}` : 'bowled';
    case 'LBW':             return b ? `lbw b ${b}` : 'lbw';
    case 'Stumped':         return (f && b) ? `st ${f} b ${b}` : 'stumped';
    case 'RunOut':
    case 'Run out':         return f ? `run out (${f})` : 'run out';
    default:                return method || 'out';
  }
}

function classifyDismissal(lDesc, sDesc) {
  const s = (lDesc || sDesc || '').toLowerCase();
  if (s.includes('run out'))                       return 'Run out';
  if (s.includes('lbw'))                           return 'LBW';
  if (s.includes('ct ') || s.includes('caught'))   return 'Caught';
  if (s.includes('stumped') || s.includes('st '))  return 'Stumped';
  if (s.includes('bowled') || /\bb\s+[A-Z]/.test(lDesc || '')) return 'Bowled';
  return 'out';
}

function parseCatcher(lDesc) {
  if (!lDesc) return null;
  // "ct Zayd Akhtar b Sebastian Mills" -> extract catcher name
  const m = (lDesc || '').match(/\bct\s+([A-Za-z\s]+?)\s+b\s/i);
  return m ? m[1].trim() : null;
}

// ── Roles endpoints ─────────────────────────────────────────────────────────

// GET /api/matches/:fixtureId/roles
router.get('/:fixtureId/roles', (req, res) => {
  const db = getDb();
  const { fixtureId } = req.params;

  const inningsList = db.prepare(
    `SELECT i.result_id, i.innings_order FROM innings i WHERE i.fixture_id = ? ORDER BY i.innings_order`
  ).all(fixtureId);

  if (!inningsList.length) return res.json({});

  const captains = db.prepare(
    `SELECT innings_order, player_id FROM match_captains WHERE fixture_id = ?`
  ).all(fixtureId);
  const captainMap = Object.fromEntries(captains.map(c => [c.innings_order, c.player_id]));

  const wkRows = db.prepare(
    `SELECT id, innings_order, player_id, from_over, to_over FROM wk_assignments WHERE fixture_id = ? ORDER BY innings_order, from_over`
  ).all(fixtureId);

  const errorRows = db.prepare(
    `SELECT id, innings_order, player_id, error_type FROM wk_errors WHERE fixture_id = ?`
  ).all(fixtureId);

  // Use fixture's canonical team names to filter player_flags — avoids stale U10/U11 mismatches
  // in individual player.team fields when the same players cross age groups between seasons.
  const fixtureTeams = db.prepare('SELECT home_team, away_team FROM fixtures WHERE fixture_id = ?').get(fixtureId);
  const WHCC_KW = ['woking', 'horsell', 'whcc', 'whirlwind'];
  const isWhccName = t => WHCC_KW.some(k => (t || '').toLowerCase().includes(k));
  const whccFixtureTeam = fixtureTeams
    ? [fixtureTeams.home_team, fixtureTeams.away_team].find(isWhccName) ?? null
    : null;
  const oppFixtureTeam = fixtureTeams
    ? [fixtureTeams.home_team, fixtureTeams.away_team].find(t => !isWhccName(t)) ?? null
    : null;

  const result = {};

  for (const inn of inningsList) {
    const order = inn.innings_order;

    // Batting team: team of the first batter in this innings
    const btRow = db.prepare(
      `SELECT p.team FROM deliveries d JOIN players p ON p.player_id = d.batter_id WHERE d.result_id = ? ORDER BY d.over_no, d.ball_no LIMIT 1`
    ).get(inn.result_id);
    const batting_team = btRow?.team ?? null;

    // Canonical team name from fixture (not from stale player.team) used for player_flags filter
    const pfTeam = isWhccName(batting_team) ? whccFixtureTeam : oppFixtureTeam;

    // Full squad: batters + bowlers from deliveries, plus HTML-registered players (DNB etc.) from player_flags
    const otherResultId = inningsList.find(i => i.innings_order !== order)?.result_id ?? inn.result_id;
    const players = db.prepare(`
      SELECT DISTINCT p.player_id, p.name FROM players p
      WHERE p.player_id IN (
        SELECT batter_id FROM deliveries WHERE result_id = ?
        UNION
        SELECT bowler_id FROM deliveries WHERE result_id = ?
        UNION
        SELECT pf.player_id FROM player_flags pf
        JOIN players p_flag ON p_flag.player_id = pf.player_id
        WHERE pf.fixture_id = ? AND (? IS NULL OR p_flag.team = ?)
      )
      ORDER BY p.name
    `).all(inn.result_id, otherResultId, fixtureId, pfTeam, pfTeam);

    const stints = wkRows.filter(r => r.innings_order === order);
    const errors = errorRows.filter(r => r.innings_order === order);

    // Compute byes per WK stint using to_over when set, else next stint's from_over
    const wk_stints = stints.map((stint, idx) => {
      let byesQuery;
      if (stint.to_over != null) {
        byesQuery = db.prepare(
          `SELECT COALESCE(SUM(runs_extra),0) as byes FROM deliveries WHERE result_id = ? AND extras_type = 3 AND over_no >= ? AND over_no <= ?`
        ).get(inn.result_id, stint.from_over - 1, stint.to_over - 1);
      } else {
        const nextFrom = stints[idx + 1]?.from_over ?? null;
        byesQuery = nextFrom != null
          ? db.prepare(`SELECT COALESCE(SUM(runs_extra),0) as byes FROM deliveries WHERE result_id = ? AND extras_type = 3 AND over_no >= ? AND over_no < ?`)
              .get(inn.result_id, stint.from_over - 1, nextFrom - 1)
          : db.prepare(`SELECT COALESCE(SUM(runs_extra),0) as byes FROM deliveries WHERE result_id = ? AND extras_type = 3 AND over_no >= ?`)
              .get(inn.result_id, stint.from_over - 1);
      }
      return { id: stint.id, player_id: stint.player_id, from_over: stint.from_over, to_over: stint.to_over ?? null, byes: byesQuery.byes };
    });

    result[order] = {
      captain_player_id: captainMap[order] ?? null,
      batting_team,
      wk_stints,
      wk_errors: errors,
      players,
    };
  }

  res.json(result);
});

// PUT /api/matches/:fixtureId/captain  { innings_order, player_id }
router.put('/:fixtureId/captain', (req, res) => {
  const db = getDb();
  const { fixtureId } = req.params;
  const { innings_order, player_id } = req.body;
  if (!innings_order || !player_id) return res.status(400).json({ error: 'innings_order and player_id required' });

  db.prepare(`
    INSERT INTO match_captains (fixture_id, innings_order, player_id)
    VALUES (?, ?, ?)
    ON CONFLICT(fixture_id, innings_order) DO UPDATE SET player_id = excluded.player_id
  `).run(fixtureId, innings_order, player_id);
  res.json({ ok: true });
});

// POST /api/matches/:fixtureId/wk  { innings_order, player_id, from_over, to_over }
router.post('/:fixtureId/wk', (req, res) => {
  const db = getDb();
  const { fixtureId } = req.params;
  const { innings_order, player_id, from_over, to_over } = req.body;
  if (!innings_order || !player_id || !from_over) return res.status(400).json({ error: 'innings_order, player_id and from_over required' });
  if (to_over != null && to_over < from_over) return res.status(400).json({ error: 'End over must be ≥ start over' });

  // Overlap check against existing stints
  const existing = db.prepare(
    `SELECT from_over, to_over FROM wk_assignments WHERE fixture_id = ? AND innings_order = ?`
  ).all(fixtureId, innings_order);
  const newTo = to_over ?? 9999;
  for (const e of existing) {
    const eTo = e.to_over ?? 9999;
    if (from_over <= eTo && e.from_over <= newTo) {
      return res.status(400).json({ error: `Overlaps with existing stint (overs ${e.from_over}–${e.to_over ?? 'end'})` });
    }
  }

  try {
    const row = db.prepare(`
      INSERT INTO wk_assignments (fixture_id, innings_order, player_id, from_over, to_over) VALUES (?, ?, ?, ?, ?)
    `).run(fixtureId, innings_order, player_id, from_over, to_over ?? null);
    res.json({ ok: true, id: row.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PATCH /api/matches/:fixtureId/wk/:wkId  { to_over }
router.patch('/:fixtureId/wk/:wkId', (req, res) => {
  const db = getDb();
  const { fixtureId, wkId } = req.params;
  const { to_over } = req.body;
  const stint = db.prepare('SELECT * FROM wk_assignments WHERE id = ? AND fixture_id = ?').get(wkId, fixtureId);
  if (!stint) return res.status(404).json({ error: 'Stint not found' });
  if (to_over != null && to_over < stint.from_over) return res.status(400).json({ error: 'End over must be ≥ start over' });
  db.prepare('UPDATE wk_assignments SET to_over = ? WHERE id = ?').run(to_over ?? null, wkId);
  res.json({ ok: true });
});

// DELETE /api/matches/:fixtureId/wk/:wkId
router.delete('/:fixtureId/wk/:wkId', (req, res) => {
  const db = getDb();
  db.prepare(`DELETE FROM wk_assignments WHERE id = ? AND fixture_id = ?`)
    .run(req.params.wkId, req.params.fixtureId);
  res.json({ ok: true });
});

// POST /api/matches/:fixtureId/wk-error  { innings_order, player_id, error_type }
router.post('/:fixtureId/wk-error', (req, res) => {
  const db = getDb();
  const { fixtureId } = req.params;
  const { innings_order, player_id, error_type } = req.body;
  if (!innings_order || !player_id || !error_type) return res.status(400).json({ error: 'innings_order, player_id and error_type required' });

  try {
    const row = db.prepare(`
      INSERT INTO wk_errors (fixture_id, innings_order, player_id, error_type) VALUES (?, ?, ?, ?)
    `).run(fixtureId, innings_order, player_id, error_type);
    res.json({ ok: true, id: row.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /api/matches/:fixtureId/wk-error/:errorId
router.delete('/:fixtureId/wk-error/:errorId', (req, res) => {
  const db = getDb();
  db.prepare(`DELETE FROM wk_errors WHERE id = ? AND fixture_id = ?`)
    .run(req.params.errorId, req.params.fixtureId);
  res.json({ ok: true });
});

module.exports = router;
