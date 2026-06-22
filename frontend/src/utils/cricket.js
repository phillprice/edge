// Default markers for WHCC — overridden at runtime via setOurMarkers() when a club
// config is loaded. Keep in sync with backend/utils/db.js WHCC_MARKERS.
export const WHCC_KEYWORDS = ['whcc', 'horsell']

let _ourMarkers = WHCC_KEYWORDS
export function setOurMarkers(markers) {
  if (Array.isArray(markers) && markers.length) _ourMarkers = markers
}

// Module-level name cache — populated once at app start via setPlayerNames().
let _allNames = []
export function setPlayerNames(names) {
  _allNames = names
}

// Club-configured name display format — set at app start via setNameFormat().
// 'first' = smart first-name with disambiguation (default)
// 'full'  = full name as stored
// 'last'  = last name only
// 'initial_last' = "S. Lawrence"
// 'first_initial' = "Sam L."
let _nameFormat = 'first'
export function setNameFormat(fmt) {
  if (fmt) _nameFormat = fmt
}

// Returns display name according to the club's configured format.
export function dn(name) {
  if (!name) return name
  const parts = name.trim().split(/\s+/)
  const first = parts[0]
  const last = parts.length > 1 ? parts[parts.length - 1] : ''
  switch (_nameFormat) {
    case 'full':
      return name
    case 'last':
      return last || first
    case 'initial_last':
      return last ? `${first[0]}. ${last}` : first
    case 'first_initial':
      return last ? `${first} ${last[0]}.` : first
    default: {
      // 'first' — smart disambiguation using global name list
      if (last.length === 1) return `${first} ${last}`
      if (first.length <= 1) return last ? `${first} ${last}` : first
      const hasDupe = _allNames.some(
        (n) => n !== name && n.trim().split(/\s+/)[0].toLowerCase() === first.toLowerCase()
      )
      if (hasDupe && last) return `${first} ${last[0]}`
      return first
    }
  }
}

// Legacy: explicit allNames list (used internally; prefer dn() for new code)
export function displayName(name, allNames) {
  if (!name) return name
  const parts = name.trim().split(/\s+/)
  const first = parts[0]
  const last = parts.length > 1 ? parts[parts.length - 1] : ''
  if (first.length <= 1) return last ? `${first} ${last}` : first
  const hasDupe = allNames.some(
    (n) => n !== name && n.trim().split(/\s+/)[0].toLowerCase() === first.toLowerCase()
  )
  if (hasDupe && last) return `${first} ${last[0]}`
  return first
}
export function isWhccTeam(name) {
  return _ourMarkers.some((k) => (name || '').toLowerCase().includes(k))
}

export function shortTeam(name) {
  if (!name) return name
  return name
    .replace(/Woking\s*(?:&|and)?\s*Horsell\s*(?:Cricket\s*Club|CC)?\s*[-–]?\s*/gi, 'WHCC ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function netScore(rawScore, wickets, startingScore) {
  return Number(rawScore) + (startingScore || 0) - (Number(wickets) || 0) * 5
}

export function ballsToOvers(balls) {
  if (!balls) return '0.0'
  return `${Math.floor(balls / 6)}.${balls % 6}`
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function formatDate(d) {
  if (!d) return null
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) {
    const dt = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`)
    return `${DAYS[dt.getDay()]} ${parseInt(m[3])} ${MONTHS[parseInt(m[2]) - 1]} ${m[1]}`
  }
  return d
}

// Returns a short UK-style date like "10 Jun 2026" from a YYYY-MM-DD ISO string.
export function formatDateShort(d) {
  if (!d) return null
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${parseInt(m[3])} ${MONTHS[parseInt(m[2]) - 1]} ${m[1]}`
  return d
}

export function parseMatchDate(d) {
  if (!d) return 0
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(d + 'T12:00:00').getTime()
  const cleaned = d.replace(/^[A-Za-z]+\s+/, '').replace(/(\d+)(st|nd|rd|th)\b/, '$1')
  const t = new Date(cleaned).getTime()
  return isNaN(t) ? 0 : t
}

// "15.3" overs string → total balls (15*6 + 3 = 93)
function oversToBalls(overs) {
  if (!overs) return null
  const n = parseFloat(overs)
  if (isNaN(n)) return null
  return Math.floor(n) * 6 + Math.round((n % 1) * 10)
}

export function computeResultPhrase(m) {
  const {
    home_team,
    away_team,
    home_score,
    home_wickets,
    away_score,
    away_wickets,
    home_overs,
    away_overs,
    toss_winner,
    toss_decision,
    format,
    starting_score
  } = m
  const whccTeam = shortTeam(
    isWhccTeam(home_team) ? home_team : isWhccTeam(away_team) ? away_team : null
  )
  if (!whccTeam || !home_score || !away_score) return m.result

  const isWhccHome = isWhccTeam(home_team)

  if (format === 'pairs') {
    const wr = netScore(
      isWhccHome ? home_score : away_score,
      isWhccHome ? home_wickets : away_wickets,
      starting_score
    )
    const or = netScore(
      isWhccHome ? away_score : home_score,
      isWhccHome ? away_wickets : home_wickets,
      starting_score
    )
    if (isNaN(wr) || isNaN(or)) return m.result
    if (wr > or) return `${whccTeam} won by ${wr - or} runs (net)`
    if (wr < or) return `${whccTeam} lost by ${or - wr} runs (net)`
    return 'Tied'
  }

  if (!toss_winner || !toss_decision) return m.result
  const dec = toss_decision.toLowerCase()
  const batFirst = dec === 'bat' ? toss_winner : toss_winner === home_team ? away_team : home_team
  const whccFirst = isWhccTeam(batFirst)

  const wr = Number(isWhccHome ? home_score : away_score)
  const ww = isWhccHome ? home_wickets : away_wickets
  const or = Number(isWhccHome ? away_score : home_score)
  const ow = isWhccHome ? away_wickets : home_wickets
  if (isNaN(wr) || isNaN(or)) return m.result

  // balls remaining when chasing team wins before their allocation runs out
  // Use match allocation (max_overs * 6) not first-innings actual balls — first team may be all out early
  const whccBalls = oversToBalls(isWhccHome ? home_overs : away_overs)
  const oppBalls = oversToBalls(isWhccHome ? away_overs : home_overs)
  const secondBalls = whccFirst ? oppBalls : whccBalls
  const matchBalls = (m.max_overs || 20) * 6
  const ballsLeft =
    secondBalls !== null && matchBalls > secondBalls ? matchBalls - secondBalls : null
  const ballsSuffix = ballsLeft
    ? ` with ${ballsLeft} ball${ballsLeft === 1 ? '' : 's'} remaining`
    : ''

  // max wickets = team_size - 1. Derive team_size from inn1_batters, capping between 10 and 11:
  // if not all players batted (innings ended by overs) inn1_batters undercounts — assume 10
  // minimum. Cap at 11 (standard team size) to guard against bad data.
  const maxWickets = m.inn1_batters > 0 ? Math.min(Math.max(m.inn1_batters, 10), 11) - 1 : 10

  if (wr > or) {
    if (!whccFirst) {
      const n = maxWickets - (ww ? Number(ww) : maxWickets)
      return `${whccTeam} won by ${n} wicket${n === 1 ? '' : 's'}${ballsSuffix}`
    }
    const n = wr - or
    return `${whccTeam} won by ${n} run${n === 1 ? '' : 's'}`
  }
  if (wr < or) {
    if (!whccFirst) {
      const n = or - wr
      return `${whccTeam} lost by ${n} run${n === 1 ? '' : 's'}`
    }
    const n = maxWickets - (ow ? Number(ow) : maxWickets)
    return `${whccTeam} lost by ${n} wicket${n === 1 ? '' : 's'}${ballsSuffix}`
  }
  return 'Tied'
}

export function shortYear(year) {
  const s = String(year || '')
  return s.length === 4 ? s.slice(2) : s
}
