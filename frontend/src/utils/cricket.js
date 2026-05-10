export const WHCC_KEYWORDS = ['woking', 'horsell', 'whcc', 'whirlwind', 'hurricane']

// Returns shortened display name. Single-initial first tokens keep their last name ("S Law").
// When two players share a first name, adds last initial ("Sam A" / "Sam L").
export function displayName(name, allNames) {
  if (!name) return name
  const parts = name.trim().split(/\s+/)
  const first = parts[0]
  const last = parts.length > 1 ? parts[parts.length - 1] : ''
  if (first.length <= 1) return last ? `${first} ${last}` : first
  const hasDupe = allNames.some(n => n !== name && n.trim().split(/\s+/)[0].toLowerCase() === first.toLowerCase())
  if (hasDupe && last) return `${first} ${last[0]}`
  return first
}
export function isWhccTeam(name) {
  return WHCC_KEYWORDS.some(k => (name || '').toLowerCase().includes(k))
}

export function netScore(rawScore, wickets, startingScore) {
  return Number(rawScore) + (startingScore || 0) - (Number(wickets) || 0) * 5
}

export function ballsToOvers(balls) {
  if (!balls) return '0.0'
  return `${Math.floor(balls / 6)}.${balls % 6}`
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

export function formatDate(d) {
  if (!d) return null
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) {
    const dt = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`)
    return `${DAYS[dt.getDay()]} ${parseInt(m[3])} ${MONTHS[parseInt(m[2])-1]} ${m[1]}`
  }
  return d
}

export function parseMatchDate(d) {
  if (!d) return 0
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(d + 'T12:00:00').getTime()
  const cleaned = d.replace(/^[A-Za-z]+\s+/, '').replace(/(\d+)(st|nd|rd|th)\b/, '$1')
  const t = new Date(cleaned).getTime()
  return isNaN(t) ? 0 : t
}

export function computeResultPhrase(m) {
  const { home_team, away_team, home_score, home_wickets, away_score, away_wickets,
          toss_winner, toss_decision, format, starting_score } = m
  const whccTeam = isWhccTeam(home_team) ? home_team : isWhccTeam(away_team) ? away_team : null
  if (!whccTeam || !home_score || !away_score) return m.result

  const isWhccHome = isWhccTeam(home_team)

  if (format === 'pairs') {
    const wr = netScore(isWhccHome ? home_score : away_score, isWhccHome ? home_wickets : away_wickets, starting_score)
    const or = netScore(isWhccHome ? away_score : home_score, isWhccHome ? away_wickets : home_wickets, starting_score)
    if (isNaN(wr) || isNaN(or)) return m.result
    if (wr > or) return `${whccTeam} won by ${wr - or} runs (net)`
    if (wr < or) return `${whccTeam} lost by ${or - wr} runs (net)`
    return 'Tied'
  }

  if (!toss_winner || !toss_decision) return m.result
  const dec = toss_decision.toLowerCase()
  const batFirst = dec === 'bat' ? toss_winner : (toss_winner === home_team ? away_team : home_team)
  const whccFirst = isWhccTeam(batFirst)

  const wr = Number(isWhccHome ? home_score : away_score)
  const ww = isWhccHome ? home_wickets : away_wickets
  const or = Number(isWhccHome ? away_score : home_score)
  const ow = isWhccHome ? away_wickets : home_wickets
  if (isNaN(wr) || isNaN(or)) return m.result

  if (wr > or) {
    if (!whccFirst) {
      const n = 10 - (ww ? Number(ww) : 10)
      return `${whccTeam} won by ${n} wicket${n === 1 ? '' : 's'}`
    }
    const n = wr - or
    return `${whccTeam} won by ${n} run${n === 1 ? '' : 's'}`
  }
  if (wr < or) {
    if (!whccFirst) {
      const n = or - wr
      return `${whccTeam} lost by ${n} run${n === 1 ? '' : 's'}`
    }
    const n = 10 - (ow ? Number(ow) : 10)
    return `${whccTeam} lost by ${n} wicket${n === 1 ? '' : 's'}`
  }
  return 'Tied'
}
