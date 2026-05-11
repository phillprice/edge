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
      (SELECT COUNT(*) FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id AND mb.not_out = 0 AND mb.did_not_bat = 0) as manual_wkts,
      (SELECT SUM(mbw.wickets) FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id) as manual_bowl_wkts,
      (SELECT COALESCE(SUM(mbw.runs), 0) + COALESCE((SELECT me.bowling_byes + me.bowling_leg_byes FROM manual_extras me WHERE me.fixture_id = f.fixture_id), 0)
       FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id) as manual_opp_runs,
      COALESCE(
        (SELECT me.whcc_overs FROM manual_extras me WHERE me.fixture_id = f.fixture_id AND me.whcc_overs IS NOT NULL AND me.whcc_overs != ''),
        (SELECT CASE WHEN SUM(mb.balls) > 0 THEN CAST(SUM(mb.balls)/6 AS TEXT)||'.'||CAST(SUM(mb.balls)%6 AS TEXT) ELSE NULL END
         FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id AND mb.did_not_bat = 0)
      ) as manual_whcc_overs,
      COALESCE(
        (SELECT me.opp_overs FROM manual_extras me WHERE me.fixture_id = f.fixture_id AND me.opp_overs IS NOT NULL AND me.opp_overs != ''),
        (SELECT CASE WHEN SUM(mbw.balls) > 0 THEN CAST(SUM(mbw.balls)/6 AS TEXT)||'.'||CAST(SUM(mbw.balls)%6 AS TEXT) ELSE NULL END
         FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id)
      ) as manual_opp_overs,
      (SELECT p.name FROM manual_batting mb JOIN players_dn p ON p.player_id = mb.player_id
       WHERE mb.fixture_id = f.fixture_id AND mb.did_not_bat = 0
       ORDER BY mb.runs DESC, CASE WHEN mb.balls > 0 THEN CAST(mb.runs AS REAL)/mb.balls ELSE 0 END DESC LIMIT 1) as manual_top_bat,
      (SELECT mb.runs FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id AND mb.did_not_bat = 0
       ORDER BY mb.runs DESC, CASE WHEN mb.balls > 0 THEN CAST(mb.runs AS REAL)/mb.balls ELSE 0 END DESC LIMIT 1) as manual_top_bat_runs,
      (SELECT mb.balls FROM manual_batting mb WHERE mb.fixture_id = f.fixture_id AND mb.did_not_bat = 0
       ORDER BY mb.runs DESC, CASE WHEN mb.balls > 0 THEN CAST(mb.runs AS REAL)/mb.balls ELSE 0 END DESC LIMIT 1) as manual_top_bat_balls,
      (SELECT p.name FROM manual_bowling mbw JOIN players_dn p ON p.player_id = mbw.player_id
       WHERE mbw.fixture_id = f.fixture_id
       ORDER BY mbw.wickets DESC, CASE WHEN mbw.balls > 0 THEN CAST(mbw.runs AS REAL)/mbw.balls ELSE 9999 END ASC LIMIT 1) as manual_top_bowl,
      (SELECT mbw.wickets FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id
       ORDER BY mbw.wickets DESC, CASE WHEN mbw.balls > 0 THEN CAST(mbw.runs AS REAL)/mbw.balls ELSE 9999 END ASC LIMIT 1) as manual_top_bowl_wkts,
      (SELECT mbw.runs FROM manual_bowling mbw WHERE mbw.fixture_id = f.fixture_id
       ORDER BY mbw.wickets DESC, CASE WHEN mbw.balls > 0 THEN CAST(mbw.runs AS REAL)/mbw.balls ELSE 9999 END ASC LIMIT 1) as manual_top_bowl_runs,
      (SELECT p.name FROM deliveries d2
       JOIN innings i2 ON i2.result_id = d2.result_id AND i2.fixture_id = f.fixture_id
       JOIN players_dn p ON p.player_id = d2.batter_id
       WHERE lower(p.team) LIKE '%woking%' OR lower(p.team) LIKE '%horsell%'
          OR lower(p.team) LIKE '%whirlwind%' OR lower(p.team) LIKE '%whcc%'
       GROUP BY d2.batter_id
       ORDER BY SUM(d2.runs_bat) DESC, CAST(SUM(d2.runs_bat) AS REAL)/COUNT(*) DESC LIMIT 1) as ing_top_bat,
      (SELECT SUM(d2.runs_bat) FROM deliveries d2
       JOIN innings i2 ON i2.result_id = d2.result_id AND i2.fixture_id = f.fixture_id
       JOIN players_dn p ON p.player_id = d2.batter_id
       WHERE lower(p.team) LIKE '%woking%' OR lower(p.team) LIKE '%horsell%'
          OR lower(p.team) LIKE '%whirlwind%' OR lower(p.team) LIKE '%whcc%'
       GROUP BY d2.batter_id
       ORDER BY SUM(d2.runs_bat) DESC, CAST(SUM(d2.runs_bat) AS REAL)/COUNT(*) DESC LIMIT 1) as ing_top_bat_runs,
      (SELECT COUNT(*) FROM deliveries d2
       JOIN innings i2 ON i2.result_id = d2.result_id AND i2.fixture_id = f.fixture_id
       JOIN players_dn p ON p.player_id = d2.batter_id
       WHERE lower(p.team) LIKE '%woking%' OR lower(p.team) LIKE '%horsell%'
          OR lower(p.team) LIKE '%whirlwind%' OR lower(p.team) LIKE '%whcc%'
       GROUP BY d2.batter_id
       ORDER BY SUM(d2.runs_bat) DESC, CAST(SUM(d2.runs_bat) AS REAL)/COUNT(*) DESC LIMIT 1) as ing_top_bat_balls,
      (SELECT p.name FROM deliveries d2
       JOIN innings i2 ON i2.result_id = d2.result_id AND i2.fixture_id = f.fixture_id
       JOIN players_dn p ON p.player_id = d2.bowler_id
       WHERE lower(p.team) LIKE '%woking%' OR lower(p.team) LIKE '%horsell%'
          OR lower(p.team) LIKE '%whirlwind%' OR lower(p.team) LIKE '%whcc%'
       GROUP BY d2.bowler_id
       ORDER BY COUNT(d2.dismissed_batter_id) DESC,
                CAST(SUM(d2.runs_bat + d2.runs_extra) AS REAL)/COUNT(*) ASC LIMIT 1) as ing_top_bowl,
      (SELECT COUNT(d2.dismissed_batter_id) FROM deliveries d2
       JOIN innings i2 ON i2.result_id = d2.result_id AND i2.fixture_id = f.fixture_id
       JOIN players_dn p ON p.player_id = d2.bowler_id
       WHERE lower(p.team) LIKE '%woking%' OR lower(p.team) LIKE '%horsell%'
          OR lower(p.team) LIKE '%whirlwind%' OR lower(p.team) LIKE '%whcc%'
       GROUP BY d2.bowler_id
       ORDER BY COUNT(d2.dismissed_batter_id) DESC,
                CAST(SUM(d2.runs_bat + d2.runs_extra) AS REAL)/COUNT(*) ASC LIMIT 1) as ing_top_bowl_wkts,
      (SELECT SUM(d2.runs_bat + d2.runs_extra) FROM deliveries d2
       JOIN innings i2 ON i2.result_id = d2.result_id AND i2.fixture_id = f.fixture_id
       JOIN players_dn p ON p.player_id = d2.bowler_id
       WHERE lower(p.team) LIKE '%woking%' OR lower(p.team) LIKE '%horsell%'
          OR lower(p.team) LIKE '%whirlwind%' OR lower(p.team) LIKE '%whcc%'
       GROUP BY d2.bowler_id
       ORDER BY COUNT(d2.dismissed_batter_id) DESC,
                CAST(SUM(d2.runs_bat + d2.runs_extra) AS REAL)/COUNT(*) ASC LIMIT 1) as ing_top_bowl_runs
    FROM fixtures f
    LEFT JOIN innings i ON i.fixture_id = f.fixture_id
    LEFT JOIN deliveries d ON d.result_id = i.result_id
    GROUP BY f.fixture_id
    ORDER BY f.match_date DESC, f.fixture_id DESC
  `).all();

  const ingested = fixtures.filter(f => f.total_deliveries > 0).map(f => f.fixture_id);
  const manual   = fixtures.filter(f => f.total_deliveries === 0 && f.manual_runs !== null).map(f => f.fixture_id);
  const mvpMap = {
    ...(ingested.length ? computeMvpForFixtures(db, ingested) : {}),
    ...(manual.length   ? computeManualMvpForFixtures(db, manual) : {}),
  };
  res.json(fixtures.map(f => ({ ...f, ing_top_mvp: mvpMap[f.fixture_id]?.name ?? null, ing_top_mvp_pts: mvpMap[f.fixture_id]?.pts ?? null })));
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

  const hasDeliveries = inningsList.some(inn =>
    db.prepare(`SELECT 1 FROM deliveries WHERE result_id = ? LIMIT 1`).get(inn.result_id)
  );
  const hasManual = db.prepare(`SELECT 1 FROM manual_batting WHERE fixture_id = ? LIMIT 1`).get(fixtureId) ||
                    db.prepare(`SELECT 1 FROM manual_bowling WHERE fixture_id = ? LIMIT 1`).get(fixtureId);

  const scorecards = (!hasDeliveries && hasManual)
    ? buildManualScorecard(db, fixtureId, fixture.format, fixture.starting_score)
    : inningsList.map(inn => buildScorecard(db, inn.result_id, inn.innings_order, fixture.format, fixture.starting_score));

  const whccNames = db.prepare(`
    SELECT COALESCE(display_name, name) AS name FROM players
    WHERE lower(team) LIKE '%woking%' OR lower(team) LIKE '%horsell%'
       OR lower(team) LIKE '%whirlwind%' OR lower(team) LIKE '%whcc%'
  `).all().map(r => r.name);

  const mvp = scorecards.some(sc => sc.isManual)
    ? buildManualMvp(db, fixtureId)
    : (hasDeliveries ? buildMvp(db, fixtureId, scorecards) : []);

  res.json({ fixture, scorecards, whccNames, mvp });
});

function ballsToOvers(balls) {
  if (!balls) return '0';
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

function buildManualScorecard(db, fixtureId, format, startingScore) {
  const isPairs = format === 'pairs';
  const extras      = db.prepare(`SELECT batting_extras, bowling_byes, bowling_leg_byes, whcc_overs, opp_overs FROM manual_extras WHERE fixture_id = ?`).get(fixtureId);
  const batting_extras  = extras?.batting_extras  ?? 0;
  const bowling_byes    = extras?.bowling_byes    ?? 0;
  const bowling_leg_byes = extras?.bowling_leg_byes ?? 0;
  const whcc_overs_stored = extras?.whcc_overs ?? null;
  const opp_overs_stored  = extras?.opp_overs  ?? null;

  // ── WHCC batting innings ──────────────────────────────────────────────────
  const batRows = db.prepare(`
    SELECT mb.*, p.name FROM manual_batting mb
    JOIN players_dn p ON p.player_id = mb.player_id
    WHERE mb.fixture_id = ? AND mb.innings_order = 1 ORDER BY mb.id
  `).all(fixtureId);

  const batting = batRows.map(b => ({
    player_id: b.player_id, name: b.name,
    runs: b.runs, balls: b.balls, fours: b.fours, sixes: b.sixes,
    dismissed: !b.not_out && !b.did_not_bat,
    dismissalDesc: b.did_not_bat ? 'did not bat' : (b.not_out ? 'not out' : (b.how_out || 'out')),
    dismissalType: null, timesOut: (!b.not_out && !b.did_not_bat) ? 1 : 0,
    did_not_bat: !!b.did_not_bat,
  }));

  const played    = batRows.filter(b => !b.did_not_bat);
  const batRuns   = played.reduce((s, b) => s + b.runs, 0);
  const batBalls  = played.reduce((s, b) => s + b.balls, 0);
  const batWkts   = played.filter(b => !b.not_out).length;
  const whccTotal = batRuns + batting_extras;
  const whcc_overs = whcc_overs_stored || (batBalls > 0 ? ballsToOvers(batBalls) : null);

  const whccSc = {
    inningsOrder: 1, isPairs, isManual: true,
    batting, bowling: [], overs: [],
    dismissalMethods: {}, catches: {},
    totals: {
      runs: whccTotal, wickets: batWkts, overs: whcc_overs,
      extras: { total: batting_extras },
      netTotal: isPairs ? whccTotal + (startingScore || 0) - batWkts * 5 : null,
    },
  };

  // ── Opposition batting (derived from WHCC bowling figures) ────────────────
  const bowlRows = db.prepare(`
    SELECT mbw.*, p.name FROM manual_bowling mbw
    JOIN players_dn p ON p.player_id = mbw.player_id
    WHERE mbw.fixture_id = ? AND mbw.innings_order = 2 ORDER BY mbw.id
  `).all(fixtureId);

  const bowling = bowlRows.map(b => ({
    player_id: b.player_id, name: b.name,
    balls: b.balls, overs: ballsToOvers(b.balls),
    runs: b.runs, wickets: b.wickets,
    wides: b.wides, noBalls: b.no_balls, maidens: b.maidens,
    economy: b.balls > 0 ? ((b.runs / b.balls) * 6).toFixed(2) : null,
  }));

  const oppRuns   = bowlRows.reduce((s, b) => s + b.runs, 0) + bowling_byes + bowling_leg_byes;
  const oppWkts   = bowlRows.reduce((s, b) => s + b.wickets, 0);
  const bowlBalls = bowlRows.reduce((s, b) => s + b.balls, 0);
  const opp_overs = opp_overs_stored || (bowlBalls > 0 ? ballsToOvers(bowlBalls) : null);

  const oppSc = {
    inningsOrder: 2, isPairs, isManual: true,
    batting: [], bowling, overs: [],
    dismissalMethods: {}, catches: {},
    totals: {
      runs: oppRuns, wickets: oppWkts, overs: opp_overs,
      extras: (bowling_byes || bowling_leg_byes) ? { byes: bowling_byes, legByes: bowling_leg_byes, wides: 0, noBalls: 0 } : null,
      netTotal: isPairs ? oppRuns + (startingScore || 0) - oppWkts * 5 : null,
    },
  };

  return [whccSc, oppSc];
}

function buildScorecard(db, resultId, inningsOrder, format, startingScore) {
  const isPairs = format === 'pairs';
  const deliveries = db.prepare(`
    SELECT d.*, p_bat.name as batter_name, p_bow.name as bowler_name
    FROM deliveries d
    LEFT JOIN players_dn p_bat ON p_bat.player_id = d.batter_id
    LEFT JOIN players_dn p_bow ON p_bow.player_id = d.bowler_id
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
      player_id: id, name: d.batter_name || (id < 0 ? nameFromDesc(d.l_desc, 'batter') : null) || `#${Math.abs(id)}`,
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
    LEFT JOIN players_dn pf ON pf.player_id = dis.fielder_id
    LEFT JOIN players_dn pb ON pb.player_id = dis.bowler_id
    JOIN innings i ON i.fixture_id = dis.fixture_id AND i.innings_order = dis.innings_order
    WHERE i.result_id = ?
  `).all(resultId);
  for (const pd of pdfDismissals) {
    if (!pd.batter_id || !batters[pd.batter_id]) continue;
    const b = batters[pd.batter_id];
    b.dismissalType    = pd.method;
    b.dismissalDesc    = formatDismissal(pd.method, pd.fielder_name, pd.bowler_name);
    b.dismissalFielder = pd.fielder_name ?? null;
    b.dismissalBowler  = pd.bowler_name  ?? null;
  }

  // Apply display_name overrides to any remaining l_desc fallback strings
  const nameOverrides = db.prepare(`SELECT name, display_name FROM players WHERE display_name IS NOT NULL`).all();
  if (nameOverrides.length) {
    for (const b of Object.values(batters)) {
      if (b.dismissalFielder === undefined && b.dismissalDesc && b.dismissalDesc !== 'out') {
        for (const { name, display_name } of nameOverrides) {
          b.dismissalDesc = b.dismissalDesc.replaceAll(name, display_name);
        }
      }
    }
  }

  // ---- Bowling ----
  const bowlers = {};
  for (const d of deliveries) {
    const id = d.bowler_id;
    if (!bowlers[id]) bowlers[id] = {
      player_id: id, name: d.bowler_name || (id < 0 ? nameFromDesc(d.l_desc, 'bowler') : null) || `#${Math.abs(id)}`,
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
      bowler: balls[0]?.bowler_name || (balls[0]?.bowler_id < 0 ? nameFromDesc(balls[0]?.l_desc, 'bowler') : null) || '?',
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
    flow: buildMatchFlow(deliveries, isPairs),
    totals: {
      runs: totalRuns, wickets: totalWkts,
      overs: oversStr,
      extras,
      netTotal: isPairs ? totalRuns + (startingScore || 0) - totalWkts * 5 : null,
    }
  };
}

function buildMatchFlow(deliveries, isPairs) {
  if (!deliveries.length) return [];

  const events = [];
  let teamRuns = 0;
  let dismissals = 0;
  let partnershipStart = 0;
  const batterRuns = {}, batterBalls = {}, batterNames = {};
  const bowlerWickets = {}, reportedBowlerHauls = {};
  const reportedTeamMilestones = new Set();
  const reportedBatterMilestones = {};

  for (let i = 0; i < deliveries.length; i++) {
    const d = deliveries[i];
    const overDisplay = d.over_no + 1;

    teamRuns += d.runs_bat + d.runs_extra;
    if (!batterNames[d.batter_id]) batterNames[d.batter_id] = d.batter_name || `#${Math.abs(d.batter_id)}`;
    batterRuns[d.batter_id] = (batterRuns[d.batter_id] || 0) + d.runs_bat;
    batterBalls[d.batter_id] = (batterBalls[d.batter_id] || 0) + 1;

    // Team milestones
    for (const m of [50, 100, 150, 200, 250]) {
      if (teamRuns >= m && !reportedTeamMilestones.has(m)) {
        reportedTeamMilestones.add(m);
        events.push({ type: 'team_milestone', over: overDisplay, runs: m, wickets: dismissals });
      }
    }

    // Batter milestones (25, 50, 75, 100)
    const br = batterRuns[d.batter_id];
    const prevM = reportedBatterMilestones[d.batter_id] || 0;
    for (const m of [25, 50, 75, 100]) {
      if (br >= m && prevM < m) {
        reportedBatterMilestones[d.batter_id] = m;
        events.push({ type: 'batter_milestone', over: overDisplay, player: batterNames[d.batter_id], runs: m, balls: batterBalls[d.batter_id] });
      }
    }

    // Dismissal / wicket
    if (d.dismissed_batter_id) {
      dismissals++;
      const playerOut = batterNames[d.dismissed_batter_id] || `#${Math.abs(d.dismissed_batter_id)}`;

      if (isPairs) {
        events.push({ type: 'pairs_out', over: overDisplay, wickets: dismissals, score: teamRuns, player: playerOut });
      } else {
        const batRuns = batterRuns[d.dismissed_batter_id] || 0;
        const partnership = teamRuns - partnershipStart;
        partnershipStart = teamRuns;
        events.push({ type: 'wicket', over: overDisplay, wickets: dismissals, score: teamRuns, player: playerOut, runs: batRuns, partnership, bowler: d.bowler_name || null });

        bowlerWickets[d.bowler_id] = (bowlerWickets[d.bowler_id] || 0) + 1;
        const bw = bowlerWickets[d.bowler_id];
        if (bw >= 3 && bw > (reportedBowlerHauls[d.bowler_id] || 2)) {
          reportedBowlerHauls[d.bowler_id] = bw;
          events.push({ type: 'bowler_haul', over: overDisplay, player: d.bowler_name || `#${Math.abs(d.bowler_id)}`, wickets: bw });
        }
      }
    }
  }

  // Innings end
  const lastDel = deliveries[deliveries.length - 1];
  const lastLegal = deliveries.filter(d => d.over_no === lastDel.over_no && d.extras_type !== 1 && d.extras_type !== 2).length;
  const oversStr = lastLegal === 6 ? String(lastDel.over_no + 1) : `${lastDel.over_no}.${lastLegal}`;
  events.push({
    type: 'innings_end', score: teamRuns, wickets: dismissals, overs: oversStr,
    ...(isPairs ? { netScore: teamRuns - dismissals * 5 } : {}),
  });

  return events;
}

function buildManualMvp(db, fixtureId) {
  const bat = db.prepare(`
    SELECT mb.player_id, COALESCE(p.display_name, p.name) AS name,
      mb.runs + (mb.fours + mb.sixes) * 1.5 AS bat_pts
    FROM manual_batting mb JOIN players p ON p.player_id = mb.player_id
    WHERE mb.fixture_id = ? AND mb.did_not_bat = 0
  `).all(fixtureId);

  const bowl = db.prepare(`
    SELECT mbw.player_id, COALESCE(p.display_name, p.name) AS name,
      mbw.wickets * 20.0
      + CASE WHEN mbw.balls >= 6
          THEN (12.0 - CAST(mbw.runs AS REAL) / mbw.balls * 6.0) * 4.0
          ELSE 0.0 END AS bowl_pts
    FROM manual_bowling mbw JOIN players p ON p.player_id = mbw.player_id
    WHERE mbw.fixture_id = ?
  `).all(fixtureId);

  const scores = {};
  const entry = (pid, name) => { if (!scores[pid]) scores[pid] = { playerId: pid, name, bat: 0, bowl: 0, field: 0 }; return scores[pid]; };
  for (const r of bat)  entry(r.player_id, r.name).bat  += r.bat_pts;
  for (const r of bowl) entry(r.player_id, r.name).bowl += r.bowl_pts;

  return Object.values(scores)
    .map(s => ({ ...s, bat: +s.bat.toFixed(1), bowl: +s.bowl.toFixed(1), total: +(s.bat + s.bowl).toFixed(1) }))
    .filter(s => s.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);
}

function computeManualMvpForFixtures(db, fixtureIds) {
  const ph = fixtureIds.map(() => '?').join(',');

  const bat = db.prepare(`
    SELECT mb.fixture_id, mb.player_id,
      mb.runs + (mb.fours + mb.sixes) * 1.5 AS pts
    FROM manual_batting mb WHERE mb.fixture_id IN (${ph}) AND mb.did_not_bat = 0
  `).all(...fixtureIds);

  const bowl = db.prepare(`
    SELECT mbw.fixture_id, mbw.player_id,
      mbw.wickets * 20.0
      + CASE WHEN mbw.balls >= 6
          THEN (12.0 - CAST(mbw.runs AS REAL) / mbw.balls * 6.0) * 4.0
          ELSE 0.0 END AS pts
    FROM manual_bowling mbw WHERE mbw.fixture_id IN (${ph})
  `).all(...fixtureIds);

  const totals = {};
  for (const row of [...bat, ...bowl]) {
    if (!totals[row.fixture_id]) totals[row.fixture_id] = {};
    totals[row.fixture_id][row.player_id] = (totals[row.fixture_id][row.player_id] || 0) + row.pts;
  }

  const allIds = [...new Set([...bat, ...bowl].map(r => r.player_id))];
  const names = {};
  if (allIds.length) {
    const np = allIds.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT player_id, COALESCE(display_name, name) AS name FROM players WHERE player_id IN (${np})`).all(...allIds))
      names[r.player_id] = r.name;
  }

  const result = {};
  for (const [fid, players] of Object.entries(totals)) {
    const [topId, topPts] = Object.entries(players).sort((a, b) => b[1] - a[1])[0];
    result[fid] = { name: names[topId] || `#${topId}`, pts: +topPts.toFixed(1) };
  }
  return result;
}

function computeMvpForFixtures(db, fixtureIds) {
  const ph = fixtureIds.map(() => '?').join(',');
  const WHCC = `(lower(wp.team) LIKE '%woking%' OR lower(wp.team) LIKE '%horsell%' OR lower(wp.team) LIKE '%whirlwind%' OR lower(wp.team) LIKE '%whcc%')`;

  const bat = db.prepare(`
    SELECT i.fixture_id, d.batter_id AS player_id,
      SUM(d.runs_bat) + SUM(CASE WHEN d.runs_bat >= 4 THEN 1.5 ELSE 0.0 END) AS pts
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    JOIN players wp ON wp.player_id = d.batter_id AND ${WHCC}
    WHERE i.fixture_id IN (${ph})
    GROUP BY i.fixture_id, d.batter_id
  `).all(...fixtureIds);

  const bowl = db.prepare(`
    SELECT i.fixture_id, d.bowler_id AS player_id,
      COUNT(d.dismissed_batter_id) * 20.0
      + CASE WHEN SUM(CASE WHEN d.extras_type NOT IN (1,2) THEN 1 ELSE 0 END) >= 6
          THEN (12.0 - CAST(SUM(d.runs_bat + d.runs_extra) AS REAL)
                / SUM(CASE WHEN d.extras_type NOT IN (1,2) THEN 1.0 ELSE 0.0 END) * 6.0) * 4.0
          ELSE 0.0 END AS pts
    FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    JOIN players wp ON wp.player_id = d.bowler_id AND ${WHCC}
    WHERE i.fixture_id IN (${ph})
    GROUP BY i.fixture_id, d.bowler_id
  `).all(...fixtureIds);

  const field = db.prepare(`
    SELECT dis.fixture_id, dis.fielder_id AS player_id, COUNT(*) * 5.0 AS pts
    FROM dismissals dis
    JOIN players wp ON wp.player_id = dis.fielder_id AND ${WHCC}
    WHERE dis.fixture_id IN (${ph}) AND dis.method IN ('Caught','CaughtAndBowled','Stumped')
    GROUP BY dis.fixture_id, dis.fielder_id
  `).all(...fixtureIds);

  // Aggregate per fixture per player
  const totals = {};
  for (const row of [...bat, ...bowl, ...field]) {
    if (!totals[row.fixture_id]) totals[row.fixture_id] = {};
    totals[row.fixture_id][row.player_id] = (totals[row.fixture_id][row.player_id] || 0) + row.pts;
  }

  // Resolve player names
  const allIds = [...new Set([...bat, ...bowl, ...field].map(r => r.player_id))];
  const names = {};
  if (allIds.length) {
    const np = allIds.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT player_id, COALESCE(display_name, name) AS name FROM players WHERE player_id IN (${np})`).all(...allIds)) {
      names[r.player_id] = r.name;
    }
  }

  const result = {};
  for (const [fid, players] of Object.entries(totals)) {
    const [topId, topPts] = Object.entries(players).sort((a, b) => b[1] - a[1])[0];
    result[fid] = { name: names[topId] || `#${topId}`, pts: +topPts.toFixed(1) };
  }
  return result;
}

function buildMvp(db, fixtureId, scorecards) {
  const whccPlayers = db.prepare(`
    SELECT player_id, COALESCE(display_name, name) AS name FROM players
    WHERE lower(team) LIKE '%woking%' OR lower(team) LIKE '%horsell%'
       OR lower(team) LIKE '%whirlwind%' OR lower(team) LIKE '%whcc%'
  `).all();
  const whccIds = new Set(whccPlayers.map(p => p.player_id));
  const nameMap = Object.fromEntries(whccPlayers.map(p => [p.player_id, p.name]));

  const scores = {};
  const entry = pid => {
    if (!scores[pid]) scores[pid] = { playerId: pid, name: nameMap[pid] || `#${pid}`, bat: 0, bowl: 0, field: 0 };
    return scores[pid];
  };

  for (const sc of scorecards) {
    if (sc.isManual) continue;
    for (const b of sc.batting) {
      if (!whccIds.has(b.player_id)) continue;
      entry(b.player_id).bat += b.runs + (b.fours + b.sixes) * 1.5;
    }
    for (const b of sc.bowling) {
      if (!whccIds.has(b.player_id)) continue;
      let pts = b.wickets * 20;
      if (b.economy != null && b.balls >= 6 && !sc.isPairs) pts += (12 - parseFloat(b.economy)) * 4;
      entry(b.player_id).bowl += pts;
    }
  }

  const dis = db.prepare(`SELECT method, fielder_id FROM dismissals WHERE fixture_id = ?`).all(fixtureId);
  for (const d of dis) {
    if (!d.fielder_id || !whccIds.has(d.fielder_id)) continue;
    if (d.method === 'Caught' || d.method === 'CaughtAndBowled' || d.method === 'Stumped') entry(d.fielder_id).field += 5;
  }

  return Object.values(scores)
    .map(s => ({ ...s, bat: +s.bat.toFixed(1), bowl: +s.bowl.toFixed(1), field: +s.field.toFixed(1), total: +(s.bat + s.bowl + s.field).toFixed(1) }))
    .filter(s => s.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);
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

function nameFromDesc(desc, role) {
  // " Bowler to Batter: description" — extract bowler or batter name
  const m = /^\s*(.+?)\s+to\s+(.+?)\s*:/.exec(desc || '');
  if (!m) return null;
  return role === 'bowler' ? m[1].trim() : m[2].trim();
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

  const isManualFixture = !!(
    db.prepare(`SELECT 1 FROM manual_batting WHERE fixture_id = ? LIMIT 1`).get(fixtureId) ||
    db.prepare(`SELECT 1 FROM manual_bowling WHERE fixture_id = ? LIMIT 1`).get(fixtureId)
  );

  const result = {};

  for (const inn of inningsList) {
    const order = inn.innings_order;

    // Batting team: team of the first batter in this innings
    const btRow = db.prepare(
      `SELECT p.team FROM deliveries d JOIN players_dn p ON p.player_id = d.batter_id WHERE d.result_id = ? ORDER BY d.over_no, d.ball_no LIMIT 1`
    ).get(inn.result_id);
    // For manual matches (no deliveries), infer batting team from innings order: 1=WHCC bat, 2=opp bat
    const batting_team = btRow?.team ?? (isManualFixture ? (order === 1 ? whccFixtureTeam : oppFixtureTeam) : null);

    // Canonical team name from fixture (not from stale player.team) used for player_flags filter
    const pfTeam = isWhccName(batting_team) ? whccFixtureTeam : oppFixtureTeam;

    // Full squad: batters + bowlers from deliveries (or manual tables for manual matches), plus player_flags
    const otherResultId = inningsList.find(i => i.innings_order !== order)?.result_id ?? inn.result_id;
    let players;
    if (isManualFixture) {
      // For manual matches, pull players from manual_batting (order 1) or manual_bowling (order 2)
      players = order === 1
        ? db.prepare(`SELECT DISTINCT p.player_id, p.name FROM players p JOIN manual_batting mb ON mb.player_id = p.player_id WHERE mb.fixture_id = ? ORDER BY p.name`).all(fixtureId)
        : db.prepare(`SELECT DISTINCT p.player_id, p.name FROM players p JOIN manual_bowling mbw ON mbw.player_id = p.player_id WHERE mbw.fixture_id = ? ORDER BY p.name`).all(fixtureId);
    } else {
      players = db.prepare(`
        SELECT DISTINCT p.player_id, p.name FROM players p
        WHERE p.player_id IN (
          SELECT batter_id FROM deliveries WHERE result_id = ?
          UNION
          SELECT bowler_id FROM deliveries WHERE result_id = ?
          UNION
          SELECT pf.player_id FROM player_flags pf
          JOIN players_dn p_flag ON p_flag.player_id = pf.player_id
          WHERE pf.fixture_id = ? AND (? IS NULL OR p_flag.team = ?)
        )
        ORDER BY p.name
      `).all(inn.result_id, otherResultId, fixtureId, pfTeam, pfTeam);
    }

    const stints = wkRows.filter(r => r.innings_order === order);
    const errors = errorRows.filter(r => r.innings_order === order);

    // Fetch all byes for this innings once, then slice per WK stint in memory
    const allByes = db.prepare(
      `SELECT over_no, runs_extra FROM deliveries WHERE result_id = ? AND extras_type = 3`
    ).all(inn.result_id);
    const byesInRange = (fromOver, toOver) => allByes
      .filter(r => r.over_no >= fromOver - 1 && (toOver == null || r.over_no <= toOver - 1))
      .reduce((s, r) => s + r.runs_extra, 0);

    const wk_stints = stints.map((stint, idx) => {
      const nextFrom = stints[idx + 1]?.from_over ?? null;
      const toOver   = stint.to_over ?? nextFrom ?? null;
      return { id: stint.id, player_id: stint.player_id, from_over: stint.from_over, to_over: stint.to_over ?? null, byes: byesInRange(stint.from_over, toOver) };
    });

    result[order] = {
      captain_player_id: captainMap[order] ?? null,
      batting_team: isWhccName(batting_team) ? (whccFixtureTeam ?? batting_team) : (oppFixtureTeam ?? batting_team),
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
