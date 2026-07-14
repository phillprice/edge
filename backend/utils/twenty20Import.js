'use strict'

const { isOurTeam } = require('./db')

// twenty20cricketcompany.com is a white-label front end for CricHeroes. These
// credentials were reverse-engineered from real browser traffic (they're the
// site's own public web-app key, not a secret belonging to any account).
const CRICHEROES_BASE = 'https://cricheroes.in/api/your-web'
const CRICHEROES_HEADERS = {
  'app-name': 'twenty20',
  'app-id': '280',
  'device-type': 'your-web',
  'api-key': 'cr!CkH3r0s',
  'app-version': '0.1.0',
  'app-version-code': '0.1.0',
  udid: '01280720501015753736149078275553736072012801',
  referer: 'https://www.twenty20cricketcompany.com/',
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'content-type': 'application/json'
}

// CricHeroes appends role markers to names in the batting/bowling scorecard arrays —
// "Leo Price  (c & wk)", "Jonny Martin  (c)", "Tyler Blake  (wk)" — but NOT in
// captain_info/wicket_keeper_info or commentary text. Left unstripped, these break every
// name match between batting rows, bowling rows, the player-id map, and commentary-derived
// bowler names (e.g. a captain's overs would silently vanish from ball-by-ball reconstruction
// because "Jonny Martin" from commentary never matches "Jonny Martin  (c)" from the bowling list).
function stripNameSuffix(name) {
  return (name || '').replace(/\s*\((c|wk|c\s*&\s*wk)\)\s*$/i, '').trim()
}

function extractMatchId(input) {
  const s = (input || '').trim()
  if (/^\d+$/.test(s)) return s
  const m = s.match(/\/scorecard\/(\d+)\//)
  return m ? m[1] : null
}

// `path` is always a hardcoded literal from call sites below (never user input) and `matchId`
// is re-validated as a plain non-negative integer here — this guarantees the constructed URL
// always targets CRICHEROES_BASE with a numeric path segment, never an attacker-controlled host
// or path, regardless of what the caller passes through from the user-supplied match URL.
async function fetchCricHeroes(path, matchId, query = '') {
  const id = String(Number(matchId))
  if (!/^\d+$/.test(id)) throw new Error('Invalid CricHeroes match id')
  const res = await fetch(`${CRICHEROES_BASE}${path}${id}${query}`, {
    headers: CRICHEROES_HEADERS
  })
  if (!res.ok) throw new Error(`CricHeroes API ${path} returned HTTP ${res.status}`)
  const json = await res.json()
  if (!json.status) throw new Error(`CricHeroes API ${path}: ${json.error?.message || 'failed'}`)
  return json.data
}

async function fetchCricHeroesMatch(matchId) {
  const [scorecard, commentary1, commentary2] = await Promise.all([
    fetchCricHeroes('/match/get-scorecard/', matchId),
    fetchCricHeroes('/match/get-commentary/', matchId, '?inning=1'),
    fetchCricHeroes('/match/get-commentary/', matchId, '?inning=2')
  ])
  return {
    scorecard,
    commentaryByInning: {
      1: commentary1.commentary || [],
      2: commentary2.commentary || []
    }
  }
}

// "not out" / missing -> not out; "retired" -> retired-not-out (scorecard.js:283 renders
// this as "retired not out" whenever not_out is true and how_out starts with "retired");
// anything else is already full dismissal text ("c X b Y", "b Y", "lbw b Y", "run out (X)")
// in exactly the format backend/utils/scorecard.js's parseHowOut() expects.
function classifyBatting(howToOut) {
  const t = (howToOut || '').trim().toLowerCase()
  if (!t || t === 'not out') return { not_out: true, how_out: null }
  if (t === 'retired') return { not_out: true, how_out: 'retired' }
  return { not_out: false, how_out: howToOut.trim() }
}

// extras_type codes used across this codebase: 1=no_ball, 2=wide, 3=bye, 4=leg_bye
// (see comment at top of backend/utils/pdfScorecard.js). CricHeroes combo codes like
// "NB-B-L" (no ball + bye) collapse to no_ball — the rarer/more consequential event.
function mapExtraType(code) {
  const c = code || ''
  if (!c) return null
  if (c.includes('NB')) return 1
  if (c.includes('WD')) return 2
  if (c === 'B') return 3
  if (c === 'LB') return 4
  return null
}

// Commentary text is "<bowler> to <batter>, <description>" — only the bowler prefix is
// needed here (one bowler per over always, by cricket's laws).
function bowlerNameFromCommentary(commentary) {
  const idx = (commentary || '').indexOf(' to ')
  return idx > 0 ? commentary.slice(0, idx).trim() : null
}

// Build the {over_no, bowlers, balls} shape backend/routes/admin/pdfScorecard.js's
// insertDeliveries() already consumes (parseOverLine's convention: over_no is 0-indexed).
// Also returns fallOfWickets in the shape insertDeliveries matches against
// ({over_no, ball_no, batter_name}) so no changes are needed to that existing code.
function buildOversAndFallOfWickets(commentaryBalls, playerNameById) {
  const sorted = [...commentaryBalls].sort((a, b) => {
    if (a.current_over !== b.current_over) return a.current_over - b.current_over
    return parseFloat(a.ball) - parseFloat(b.ball)
  })

  const oversByNo = new Map()
  const fallOfWickets = []
  let score = 0
  let wicketNo = 0

  for (const b of sorted) {
    const overNo = b.current_over - 1
    if (!oversByNo.has(overNo)) oversByNo.set(overNo, { over_no: overNo, bowlers: [], balls: [] })
    const over = oversByNo.get(overNo)
    if (!over.bowlers.length) {
      const bowler = bowlerNameFromCommentary(b.commentary)
      if (bowler) over.bowlers.push(bowler)
    }

    // "Retired" is a phantom zero-run announcement ball layered on top of the batter's real
    // final delivery, not a delivery of its own (their official ball/run tally already excludes
    // it). Skip it entirely — insertDeliveries' own ball-count-based retirement detection
    // (backend/routes/admin/pdfScorecard.js) already retires the batter correctly on their
    // real last ball; keeping this phantom ball would double-trigger that swap and desync
    // the batting order for the rest of the innings.
    if (b.dismiss_type === 'Retired') continue

    const extras_type = mapExtraType(b.extra_type_code)
    const isWideOrNoBall = extras_type === 1 || extras_type === 2
    const runs_bat = b.run || 0
    const runs_extra = extras_type ? (b.extra_run || 0) + (isWideOrNoBall ? 1 : 0) : 0
    score += runs_bat + runs_extra

    over.balls.push({
      runs_bat,
      runs_extra,
      extras_type,
      is_wicket: !!b.is_out
    })

    if (b.is_out) {
      wicketNo++
      const legalBallNo = over.balls.filter((ball) => ball.extras_type !== 2).length
      fallOfWickets.push({
        score,
        wicket_no: wicketNo,
        batter_name: playerNameById[b.dismiss_player_id] || null,
        over_no: overNo,
        ball_no: legalBallNo
      })
    }
  }

  return {
    overs: [...oversByNo.values()],
    fallOfWickets: fallOfWickets.filter((f) => f.batter_name)
  }
}

function buildPlayerNameMap(scorecard) {
  const map = {}
  for (const team of [scorecard.team_a, scorecard.team_b]) {
    for (const inn of team.scorecard || []) {
      for (const b of inn.batting || []) map[b.player_id] = stripNameSuffix(b.name)
      for (const b of inn.bowling || []) map[b.player_id] = stripNameSuffix(b.name)
    }
  }
  return map
}

function buildBattingRows(inningBatting = []) {
  return inningBatting.map((b) => ({
    name: stripNameSuffix(b.name),
    runs: b.runs || 0,
    balls: b.balls || 0,
    fours: b['4s'] || 0,
    sixes: b['6s'] || 0,
    ...classifyBatting(b.how_to_out)
  }))
}

function buildBowlingRows(inningBowling = []) {
  return inningBowling.map((b) => ({
    name: stripNameSuffix(b.name),
    overs: `${b.overs || 0}.${b.balls || 0}`,
    maidens: b.maidens || 0,
    runs: b.runs || 0,
    wickets: b.wickets || 0,
    wides: b.wide || 0,
    no_balls: b.noball || 0
  }))
}

// CricHeroes precomputes a human-readable breakdown, e.g. "(wd 29, nb 10, b 13, lb 1)" —
// parse that directly rather than re-deriving from the raw per-type-code `data` array,
// whose extra_type_run/extra_run split doesn't cleanly separate into wd/nb/b/lb totals.
// Fixed literal pattern (no dynamically-constructed RegExp) — captures each "<label> <n>"
// pair from CricHeroes' precomputed breakdown, e.g. "(wd 29, nb 10, b 13, lb 1)".
const EXTRAS_SUMMARY_RE = /\b(wd|nb|b|lb) (\d+)/g

function parseExtrasSummary(extras) {
  const summary = extras?.summary || ''
  const counts = { wd: 0, nb: 0, b: 0, lb: 0 }
  for (const [, label, n] of summary.matchAll(EXTRAS_SUMMARY_RE)) {
    counts[label] = parseInt(n, 10)
  }
  return {
    total: extras?.total || 0,
    wides: counts.wd,
    noBalls: counts.nb,
    byes: counts.b,
    legByes: counts.lb
  }
}

function formatDate(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  if (Number.isNaN(d.getTime())) return ''
  const day = String(d.getUTCDate()).padStart(2, '0')
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December'
  ]
  return `${day} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

// Assemble the scorecard-commit-compatible shape (matches parseScorecard()'s output in
// backend/utils/pdfScorecard.js), plus the additive `extras`/`captains`/`keepers` fields
// consumed by the extended commitScorecardTx.
// Both teams bat exactly once in this match type; sort by CricHeroes' own `inning`
// number (1 or 2) to get chronological batting order.
function orderedEntries(teamA, teamB, aIsOurs, bIsOurs) {
  return [
    { team: teamA, isOurs: aIsOurs, sc: teamA.scorecard[0] },
    { team: teamB, isOurs: bIsOurs, sc: teamB.scorecard[0] }
  ].sort((x, y) => x.sc.inning - y.sc.inning)
}

function buildInnings(entries, teamA, teamB, commentaryByInning, playerNameById) {
  return entries.map(({ team, sc }) => {
    const battingTeam = team
    const bowlingTeam = battingTeam === teamA ? teamB : teamA
    const { overs, fallOfWickets } = buildOversAndFallOfWickets(
      commentaryByInning[sc.inning] || [],
      playerNameById
    )
    return {
      batting_team: battingTeam.name,
      bowling_team: bowlingTeam.name,
      batting: buildBattingRows(sc.batting),
      bowling: buildBowlingRows(sc.bowling),
      fallOfWickets,
      overs
    }
  })
}

const oversPlayed = (team) => team.innings?.[0]?.overs_played || null

function buildExtras(entries) {
  const ourIdx = entries.findIndex((e) => e.isOurs)
  const oppIdx = entries.findIndex((e) => !e.isOurs)
  if (ourIdx === -1 || oppIdx === -1) return null
  const ourExtras = parseExtrasSummary(entries[ourIdx].sc.extras)
  const oppExtras = parseExtrasSummary(entries[oppIdx].sc.extras)
  return {
    batting_extras: ourExtras.total,
    bowling_byes: oppExtras.byes,
    bowling_leg_byes: oppExtras.legByes,
    our_overs: oversPlayed(entries[ourIdx].team),
    opp_overs: oversPlayed(entries[oppIdx].team)
  }
}

// Captain/wicket-keeper info is per-TEAM in CricHeroes' data, not per-innings — map each
// team's captain onto their own batting innings, and their keeper onto their fielding innings
// (the innings where the other team bats).
function buildCaptainsAndKeepers(teamA, teamB, innings) {
  const captains = []
  const keepers = []
  for (const team of [teamA, teamB]) {
    const battingInningsOrder = innings.findIndex((i) => i.batting_team === team.name) + 1
    const fieldingInningsOrder = innings.findIndex((i) => i.bowling_team === team.name) + 1
    if (team.captain_info?.player_name && battingInningsOrder) {
      captains.push({ innings_order: battingInningsOrder, name: team.captain_info.player_name })
    }
    if (team.wicket_keeper_info?.player_name && fieldingInningsOrder) {
      keepers.push({
        innings_order: fieldingInningsOrder,
        name: team.wicket_keeper_info.player_name,
        from_over: 1,
        to_over: null
      })
    }
  }
  return { captains, keepers }
}

function mapCricHeroesToScorecard({ scorecard, commentaryByInning }) {
  const playerNameById = buildPlayerNameMap(scorecard)

  const teamA = scorecard.team_a
  const teamB = scorecard.team_b
  const aIsOurs = isOurTeam(teamA.name)
  const bIsOurs = isOurTeam(teamB.name)
  const our_team = aIsOurs ? teamA.name : bIsOurs ? teamB.name : teamA.name

  const entries = orderedEntries(teamA, teamB, aIsOurs, bIsOurs)
  const innings = buildInnings(entries, teamA, teamB, commentaryByInning, playerNameById)
  const extras = buildExtras(entries)
  const { captains, keepers } = buildCaptainsAndKeepers(teamA, teamB, innings)

  return {
    match_date: formatDate(scorecard.start_datetime),
    match_date_iso: (scorecard.start_datetime || '').slice(0, 10) || null,
    home_team: teamA.name,
    away_team: teamB.name,
    our_team,
    ground: scorecard.ground_name || '',
    competition: scorecard.tournament_name || '',
    innings,
    extras,
    captains,
    keepers
  }
}

module.exports = {
  extractMatchId,
  fetchCricHeroesMatch,
  mapCricHeroesToScorecard,
  classifyBatting,
  mapExtraType,
  buildOversAndFallOfWickets
}
