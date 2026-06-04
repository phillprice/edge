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

function buildMatchFlow(deliveries, isPairs, startingScore, dismissalMap, nullBatterByBowler = {}, wkAssignments = [], isWhccBatting = false, maxOvers = DEFAULT_OVERS) {
  if (!deliveries.length) return [];

  const { teamMilestones, batterMilestones } = getFormatConfig(maxOvers);

  const events = [];
  let teamRuns = 0;
  let dismissals = 0;
  let partnershipStart = 0;
  const batterRuns = {}, batterBalls = {}, batterNames = {}, batterLastOver = {};
  const bowlerWickets = {}, reportedBowlerHauls = {};
  const reportedTeamMilestones = new Set();
  const reportedBatterMilestones = {};
  const dismissalUsed = {};  // tracks how many dismissals we've consumed per batter_id

  // Keeper swaps: sorted by from_over; skip from_over=1 (initial keeper, not a swap)
  const keeperSwaps = [...wkAssignments].sort((a, b) => a.from_over - b.from_over).filter(w => w.from_over > 1);
  let keeperIdx = 0;
  let currentOver = -1;

  for (let i = 0; i < deliveries.length; i++) {
    const d = deliveries[i];
    const overDisplay = `${d.over_no + 1}.${d.ball_no_disp ?? d.ball_no}`;

    // Inject keeper_change events at the start of each new over
    if (d.over_no !== currentOver) {
      currentOver = d.over_no;
      while (keeperIdx < keeperSwaps.length && keeperSwaps[keeperIdx].from_over === d.over_no + 1) {
        events.push({ type: 'keeper_change', over: `${d.over_no}.0`, player: keeperSwaps[keeperIdx].keeper_name });
        keeperIdx++;
      }
    }

    teamRuns += d.runs_bat + d.runs_extra;
    if (!batterNames[d.batter_id]) batterNames[d.batter_id] = d.batter_name || `#${Math.abs(d.batter_id)}`;
    batterRuns[d.batter_id] = (batterRuns[d.batter_id] || 0) + d.runs_bat;
    batterBalls[d.batter_id] = (batterBalls[d.batter_id] || 0) + 1;
    batterLastOver[d.batter_id] = overDisplay;

    // Team milestones — thresholds vary by format
    for (const m of teamMilestones) {
      if (teamRuns >= m && !reportedTeamMilestones.has(m)) {
        reportedTeamMilestones.add(m);
        events.push({ type: 'team_milestone', over: overDisplay, runs: m, wickets: dismissals });
      }
    }

    // Batter milestones — thresholds vary by format (T20: 15/20/25/30; longer: 25/50/75/100)
    const br = batterRuns[d.batter_id];
    const prevM = reportedBatterMilestones[d.batter_id] || 0;
    for (const m of batterMilestones) {
      if (br >= m && prevM < m) {
        reportedBatterMilestones[d.batter_id] = m;
        events.push({ type: 'batter_milestone', over: overDisplay, player: batterNames[d.batter_id], player_id: d.batter_id, runs: m, balls: batterBalls[d.batter_id] });
      }
    }

    // Dismissal / wicket
    if (d.dismissed_batter_id) {
      dismissals++;
      const playerOut = batterNames[d.dismissed_batter_id] || `#${Math.abs(d.dismissed_batter_id)}`;

      // Look up dismissal detail (fielder/method) from pre-loaded map
      const used = dismissalUsed[d.dismissed_batter_id] || 0;
      const disInfo = dismissalMap?.[d.dismissed_batter_id]?.[used]
        ?? (d.bowler_id ? nullBatterByBowler[d.bowler_id] : null)
        ?? null;
      dismissalUsed[d.dismissed_batter_id] = used + 1;

      if (isPairs) {
        events.push({
          type: 'pairs_out', over: overDisplay, wickets: dismissals, score: teamRuns, player: playerOut, player_id: d.dismissed_batter_id,
          bowler: d.bowler_name || null,
          fielder: disInfo?.fielder ?? null,
          dismissalMethod: disInfo?.method ?? null,
        });
      } else {
        const batRuns  = batterRuns[d.dismissed_batter_id] || 0;
        const batBalls = batterBalls[d.batter_id] || 0;
        const partnership = teamRuns - partnershipStart;
        partnershipStart = teamRuns;
        events.push({
          type: 'wicket', over: overDisplay, wickets: dismissals, score: teamRuns,
          player: playerOut, player_id: d.dismissed_batter_id, runs: batRuns, balls: batBalls, partnership,
          bowler: d.bowler_name || null,
          fielder: disInfo?.fielder ?? null,
          dismissalMethod: disInfo?.method ?? null,
        });

        if (!isWhccBatting) {
          bowlerWickets[d.bowler_id] = (bowlerWickets[d.bowler_id] || 0) + 1;
          const bw = bowlerWickets[d.bowler_id];
          if (bw >= 3 && bw > (reportedBowlerHauls[d.bowler_id] || 2)) {
            reportedBowlerHauls[d.bowler_id] = bw;
            events.push({ type: 'bowler_haul', over: overDisplay, player: d.bowler_name || `#${Math.abs(d.bowler_id)}`, player_id: d.bowler_id, wickets: bw });
          }
        }
      }
    }
  }

  // Retirement events — batters who retired not out (present in dismissalMap as 'Retired'
  // but never appeared as dismissed_batter_id in deliveries). Injected at the over they
  // last faced a ball, so they appear at the right point in the flow.
  if (dismissalMap && !isPairs) {
    for (const [batterId, dList] of Object.entries(dismissalMap)) {
      for (const dis of dList) {
        if (dis.method !== 'Retired') continue;
        const id = Number(batterId);
        if (!batterNames[id]) continue; // batter never faced a ball — skip
        events.push({
          type: 'retirement',
          over: batterLastOver[id] || oversStr,
          player: batterNames[id],
          player_id: id,
          runs: batterRuns[id] || 0,
          balls: batterBalls[id] || 0,
        });
      }
    }
    // Sort so retirements appear at their over position rather than all at the end
    events.sort((a, b) => {
      const toFloat = o => { const [ov, bl] = String(o || '0').split('.'); return Number(ov) * 100 + Number(bl || 0); };
      return toFloat(a.over) - toFloat(b.over);
    });
  }

  // Innings end
  const lastDel = deliveries[deliveries.length - 1];
  const lastLegal = deliveries.filter(d => d.over_no === lastDel.over_no && d.extras_type !== 1 && d.extras_type !== 2).length;
  const oversStr = lastLegal === 6 ? String(lastDel.over_no + 1) : `${lastDel.over_no}.${lastLegal}`;
  events.push({
    type: 'innings_end', score: teamRuns, wickets: dismissals, overs: oversStr,
    ...(isPairs ? { netScore: (startingScore || 0) + teamRuns - dismissals * 5 } : {}),
  });

  return events;
}

module.exports = { getFormatConfig, buildMatchFlow };
