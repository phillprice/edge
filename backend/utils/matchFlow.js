'use strict'

const DEFAULT_OVERS = 20;

function getFormatConfig(maxOvers) {
  const mo = maxOvers || DEFAULT_OVERS;
  if (mo <= 22) return {
    name: 'T20',
    phaseBoundaries: [
      { phase: 'Powerplay', from: 1,  to: 6  },
      { phase: 'Middle',    from: 7,  to: 15 },
      { phase: 'Death',     from: 16, to: mo }
    ],
    batterMilestones: [15, 20, 25, 30],
    teamMilestones:   [50, 75, 100, 150, 200, 250, 300],
    wicketVal: 1.8, maidensPerWicket: 2, srPct: 0.08
  };
  if (mo <= 35) return {
    name: '30-over',
    phaseBoundaries: [
      { phase: 'Powerplay', from: 1,  to: 6  },
      { phase: 'Middle',    from: 7,  to: 24 },
      { phase: 'Death',     from: 25, to: mo }
    ],
    batterMilestones: [25, 50, 75, 100],
    teamMilestones:   [50, 100, 150, 200, 250, 300, 350],
    wicketVal: 2.0, maidensPerWicket: 2, srPct: 0.06
  };
  if (mo <= 45) return {
    name: '40-over',
    phaseBoundaries: [
      { phase: 'Powerplay', from: 1,  to: 8  },
      { phase: 'Middle',    from: 9,  to: 30 },
      { phase: 'Death',     from: 31, to: mo }
    ],
    batterMilestones: [25, 50, 75, 100],
    teamMilestones:   [50, 100, 150, 200, 250, 300, 350],
    wicketVal: 2.2, maidensPerWicket: 3, srPct: 0.05
  };
  return {
    name: '50-over',
    phaseBoundaries: [
      { phase: 'Powerplay', from: 1,  to: 10 },
      { phase: 'Middle',    from: 11, to: 40 },
      { phase: 'Death',     from: 41, to: mo }
    ],
    batterMilestones: [25, 50, 75, 100],
    teamMilestones:   [50, 100, 150, 200, 250, 300, 350],
    wicketVal: 2.5, maidensPerWicket: 3, srPct: 0.04
  };
}

// ── buildMatchFlow helpers ────────────────────────────────────────────────────

function checkMilestones(events, overDisplay, teamRuns, dismissals, teamMilestones, reportedTeamMilestones,
    batterRuns, batterBalls, batterNames, batterMilestones, reportedBatterMilestones, batterId) {
  for (const m of teamMilestones) {
    if (teamRuns >= m && !reportedTeamMilestones.has(m)) {
      reportedTeamMilestones.add(m);
      events.push({ type: 'team_milestone', over: overDisplay, runs: m, wickets: dismissals });
    }
  }
  const br = batterRuns[batterId];
  const prevM = reportedBatterMilestones[batterId] || 0;
  for (const m of batterMilestones) {
    if (br >= m && prevM < m) {
      reportedBatterMilestones[batterId] = m;
      events.push({ type: 'batter_milestone', over: overDisplay, player: batterNames[batterId], player_id: batterId, runs: m, balls: batterBalls[batterId] });
    }
  }
}

function buildWicketEvent(events, d, overDisplay, dismissals, teamRuns, isPairs, isWhccBatting,
    batterRuns, batterBalls, batterNames, partnershipStart, dismissalMap, nullBatterByBowler, dismissalUsed,
    bowlerWickets, reportedBowlerHauls) {
  const playerOut = batterNames[d.dismissed_batter_id] || `#${Math.abs(d.dismissed_batter_id)}`;
  const used = dismissalUsed[d.dismissed_batter_id] || 0;
  const disInfo = dismissalMap?.[d.dismissed_batter_id]?.[used]
    ?? (d.bowler_id ? nullBatterByBowler[d.bowler_id] : null) ?? null;
  dismissalUsed[d.dismissed_batter_id] = used + 1;

  if (isPairs) {
    events.push({ type: 'pairs_out', over: overDisplay, wickets: dismissals, score: teamRuns,
      player: playerOut, player_id: d.dismissed_batter_id,
      bowler: d.bowler_name || null, fielder: disInfo?.fielder ?? null, dismissalMethod: disInfo?.method ?? null });
  } else {
    const partnership = teamRuns - partnershipStart;
    events.push({ type: 'wicket', over: overDisplay, wickets: dismissals, score: teamRuns,
      player: playerOut, player_id: d.dismissed_batter_id,
      runs: batterRuns[d.dismissed_batter_id] || 0, balls: batterBalls[d.batter_id] || 0, partnership,
      bowler: d.bowler_name || null, fielder: disInfo?.fielder ?? null, dismissalMethod: disInfo?.method ?? null });
    if (!isWhccBatting) {
      bowlerWickets[d.bowler_id] = (bowlerWickets[d.bowler_id] || 0) + 1;
      const bw = bowlerWickets[d.bowler_id];
      if (bw >= 3 && bw > (reportedBowlerHauls[d.bowler_id] || 2)) {
        reportedBowlerHauls[d.bowler_id] = bw;
        events.push({ type: 'bowler_haul', over: overDisplay, player: d.bowler_name || `#${Math.abs(d.bowler_id)}`, player_id: d.bowler_id, wickets: bw });
      }
    }
    return teamRuns; // new partnershipStart for next wicket
  }
  return partnershipStart; // pairs: unchanged
}

function injectRetirementEvents(events, dismissalMap, batterNames, batterLastOver, batterRuns, batterBalls) {
  for (const [batterId, dList] of Object.entries(dismissalMap)) {
    for (const dis of dList) {
      if (dis.method !== 'Retired') continue;
      const id = Number(batterId);
      if (!batterNames[id]) continue;
      events.push({ type: 'retirement', over: batterLastOver[id], player: batterNames[id],
        player_id: id, runs: batterRuns[id] || 0, balls: batterBalls[id] || 0 });
    }
  }
  const toFloat = o => { const [ov, bl] = String(o || '0').split('.'); return Number(ov) * 100 + Number(bl || 0); };
  events.sort((a, b) => toFloat(a.over) - toFloat(b.over));
}

// ── buildMatchFlow ────────────────────────────────────────────────────────────

function emitMaidenEvent(events, overNo, overRuns, overLegalBalls, overWickets, overBowlerId, overBowlerName, isWhccBatting) {
  // Maidens are a WHCC-bowling achievement (like bowler_haul) — don't surface the
  // opposition's maidens when WHCC is batting.
  if (isWhccBatting) return;
  if (overLegalBalls !== 6 || overRuns !== 0 || !overBowlerId) return;
  const type = overWickets >= 2 ? 'double_wicket_maiden' : overWickets === 1 ? 'wicket_maiden' : 'maiden';
  // Use .7 so injectRetirementEvents sort places this after the 6th legal ball (x.6)
  events.push({ type, over: `${overNo + 1}.7`, player: overBowlerName, player_id: overBowlerId, wickets: overWickets });
}

function buildMatchFlow(deliveries, isPairs, startingScore, dismissalMap, nullBatterByBowler = {}, wkAssignments = [], isWhccBatting = false, maxOvers = DEFAULT_OVERS) {
  if (!deliveries.length) return [];

  const { teamMilestones, batterMilestones } = getFormatConfig(maxOvers);

  // When WHCC is bowling we highlight our bowling progress instead of the
  // opposition's scoring: a milestone when half the side is down. Half rounds
  // down for odd team sizes, stays exact for even (11→5, 9→4, 10→5, 8→4) =
  // floor(size/2). Team size = everyone who came to the crease this innings
  // (a completed innings has a delivery for each). Pairs has no "half down"
  // (batters stay in), so fire every 4 dismissals instead.
  const battingTeamSize = new Set(
    deliveries.flatMap(d => [d.batter_id, d.batter_id_ns, d.dismissed_batter_id].filter(Boolean))
  ).size || 11;
  const wicketMilestone = Math.floor(battingTeamSize / 2);

  const events = [];
  let teamRuns = 0, dismissals = 0, partnershipStart = 0;
  const batterRuns = {}, batterBalls = {}, batterNames = {}, batterLastOver = {};
  const bowlerWickets = {}, reportedBowlerHauls = {};
  const reportedTeamMilestones = new Set();
  const reportedBatterMilestones = {};
  const dismissalUsed = {};

  const keeperSwaps = [...wkAssignments].sort((a, b) => a.from_over - b.from_over).filter(w => w.from_over > 1);
  let keeperIdx = 0, currentOver = -1;
  let overRuns = 0, overLegalBalls = 0, overWickets = 0, overBowlerId = null, overBowlerName = null;

  for (const d of deliveries) {
    const overDisplay = `${d.over_no + 1}.${d.ball_no_disp ?? d.ball_no}`;

    if (d.over_no !== currentOver) {
      emitMaidenEvent(events, currentOver, overRuns, overLegalBalls, overWickets, overBowlerId, overBowlerName, isWhccBatting);
      overRuns = 0; overLegalBalls = 0; overWickets = 0; overBowlerId = null; overBowlerName = null;
      currentOver = d.over_no;
      while (keeperIdx < keeperSwaps.length && keeperSwaps[keeperIdx].from_over === d.over_no + 1) {
        events.push({ type: 'keeper_change', over: `${d.over_no}.0`, player: keeperSwaps[keeperIdx].keeper_name });
        keeperIdx++;
      }
    }

    // overRuns tracks runs charged to the bowler (for maiden detection). Byes (3) and
    // leg-byes (4) are NOT charged to the bowler, so they don't break a maiden; wides (2)
    // and no-balls (1) are charged and do.
    overRuns += d.runs_bat + (d.extras_type === 3 || d.extras_type === 4 ? 0 : d.runs_extra);
    // wides (extras_type 2) and no-balls (extras_type 1) are not legal deliveries
    if (d.extras_type !== 1 && d.extras_type !== 2) overLegalBalls++;
    if (!overBowlerId && d.bowler_id) { overBowlerId = d.bowler_id; overBowlerName = d.bowler_name; }

    teamRuns += d.runs_bat + d.runs_extra;
    if (!batterNames[d.batter_id]) batterNames[d.batter_id] = d.batter_name || `#${Math.abs(d.batter_id)}`;
    batterRuns[d.batter_id] = (batterRuns[d.batter_id] || 0) + d.runs_bat;
    batterBalls[d.batter_id] = (batterBalls[d.batter_id] || 0) + 1;
    batterLastOver[d.batter_id] = overDisplay;

    // Milestones celebrate the batting side's scoring — only show them when WHCC
    // is batting. When WHCC is bowling we surface a bowling milestone instead.
    if (isWhccBatting) {
      checkMilestones(events, overDisplay, teamRuns, dismissals, teamMilestones, reportedTeamMilestones,
        batterRuns, batterBalls, batterNames, batterMilestones, reportedBatterMilestones, d.batter_id);
    }

    if (d.dismissed_batter_id) {
      dismissals++;
      overWickets++;
      partnershipStart = buildWicketEvent(events, d, overDisplay, dismissals, teamRuns, isPairs, isWhccBatting,
        batterRuns, batterBalls, batterNames, partnershipStart, dismissalMap, nullBatterByBowler, dismissalUsed,
        bowlerWickets, reportedBowlerHauls);
      // "N down for R" — our bowling progress (half the side down, or every 4th in pairs).
      if (!isWhccBatting && (isPairs ? dismissals % 4 === 0 : dismissals === wicketMilestone)) {
        events.push({ type: 'bowling_milestone', over: overDisplay, wickets: dismissals, runs: teamRuns });
      }
    }
  }

  // Check the final over
  emitMaidenEvent(events, currentOver, overRuns, overLegalBalls, overWickets, overBowlerId, overBowlerName, isWhccBatting);

  if (dismissalMap && !isPairs) {
    injectRetirementEvents(events, dismissalMap, batterNames, batterLastOver, batterRuns, batterBalls);
  }

  const lastDel = deliveries[deliveries.length - 1];
  const lastLegal = deliveries.filter(d => d.over_no === lastDel.over_no && d.extras_type !== 1 && d.extras_type !== 2).length;
  const oversStr = lastLegal === 6 ? String(lastDel.over_no + 1) : `${lastDel.over_no}.${lastLegal}`;
  events.push({ type: 'innings_end', score: teamRuns, wickets: dismissals, overs: oversStr,
    ...(isPairs ? { netScore: (startingScore || 0) + teamRuns - dismissals * 5 } : {}) });

  return events;
}

module.exports = { getFormatConfig, buildMatchFlow };
