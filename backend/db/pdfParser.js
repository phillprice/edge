// Parses a play-cricket scorecard PDF and returns structured match data + player map

function parsePdfText(text) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const result = {
    homeTeam: null,
    awayTeam: null,
    ground: null,
    matchDate: null,
    competition: null,
    tossWinner: null,
    tossDecision: null,
    matchResult: null,
    homeScore: null,
    awayScore: null,
    homeOvers: null,
    awayOvers: null,
    homeWickets: null,
    awayWickets: null,
    players: {},
    innings: [],
  }

  // Title line: "Team A Vs Team B"
  const vsLine = lines.find((l) => /\sVs\s/i.test(l))
  if (vsLine) {
    const [home, away] = vsLine.split(/\s+Vs\s+/i)
    result.homeTeam = home?.trim()
    result.awayTeam = away?.trim()
  }

  for (const line of lines) {
    const groundMatch = line.match(/Ground\s*(.+?)\s*Date\s*(.+)/i)
    if (groundMatch) {
      result.ground = groundMatch[1].trim()
      result.matchDate = groundMatch[2].trim()
    }
    const tossMatch = line.match(
      /Toss\s*(.+?)\s+(?:won the toss and elected to|elected to)\s+(bat|field|bowl)/i
    )
    if (tossMatch) {
      result.tossWinner = tossMatch[1].trim()
      result.tossDecision = tossMatch[2].trim()
    }
    const compMatch = line.match(/Type\s*League:\s*(.+?)(?:\s*Rules\s*Type.*)?$/i)
    if (compMatch) result.competition = compMatch[1].trim()
    const resultMatch = line.match(/Result\s*:\s*(.+)/i)
    if (resultMatch) result.matchResult = resultMatch[1].trim()
  }

  const scorePattern = /(\d+)(-(\d+))?\s+(?:all out\s+)?\((\d+\.?\d*)\s+overs?\)/gi
  const scoreMatches = [...text.matchAll(scorePattern)]
  if (scoreMatches[0]) {
    result.awayScore = scoreMatches[0][1]
    result.awayWickets = scoreMatches[0][3] ?? null
    result.awayOvers = scoreMatches[0][4]
  }
  if (scoreMatches[1]) {
    result.homeScore = scoreMatches[1][1]
    result.homeWickets = scoreMatches[1][3] ?? null
    result.homeOvers = scoreMatches[1][4]
  }

  const { players, innings } = extractInningsData(text, result.homeTeam, result.awayTeam)
  result.players = players
  result.innings = innings
  return result
}

// PDF section headers use shortened team names; match as long as one is a prefix of the other
function partialTeamMatch(sectionName, teamName) {
  if (!sectionName || !teamName) return false
  const s = sectionName.toLowerCase()
  const t = teamName.toLowerCase()
  return s === t || t.startsWith(s + ' ') || t.startsWith(s + '-') || s.startsWith(t + ' ')
}

function extractInningsData(text, homeTeam, awayTeam) {
  const players = {}
  const innings = []
  if (!homeTeam && !awayTeam) return { players, innings }

  const lines = text.split('\n')
  let homeStart = -1,
    awayStart = -1

  let charPos = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const nextLine = (lines[i + 1] || '').trim()
    if (nextLine === 'Batting') {
      if (homeTeam && homeStart === -1 && partialTeamMatch(line, homeTeam)) homeStart = charPos
      else if (awayTeam && awayStart === -1 && partialTeamMatch(line, awayTeam)) awayStart = charPos
    }
    charPos += lines[i].length + 1
  }

  const sections = []
  if (homeStart !== -1 && awayStart !== -1) {
    if (homeStart < awayStart) {
      sections.push({
        battingTeam: homeTeam,
        bowlingTeam: awayTeam,
        section: text.slice(homeStart, awayStart),
      })
      sections.push({
        battingTeam: awayTeam,
        bowlingTeam: homeTeam,
        section: text.slice(awayStart),
      })
    } else {
      sections.push({
        battingTeam: awayTeam,
        bowlingTeam: homeTeam,
        section: text.slice(awayStart, homeStart),
      })
      sections.push({
        battingTeam: homeTeam,
        bowlingTeam: awayTeam,
        section: text.slice(homeStart),
      })
    }
  } else if (homeStart !== -1) {
    sections.push({ battingTeam: homeTeam, bowlingTeam: awayTeam, section: text.slice(homeStart) })
  } else if (awayStart !== -1) {
    sections.push({ battingTeam: awayTeam, bowlingTeam: homeTeam, section: text.slice(awayStart) })
  }

  for (const { battingTeam, bowlingTeam, section } of sections) {
    const { batters } = parseTeamSection(section, battingTeam, bowlingTeam, players)
    innings.push({ battingTeam, batters })
  }

  return { players, innings }
}

function parseTeamSection(section, battingTeam, bowlingTeam, players) {
  const batters = []
  const battingStart = section.search(/Name\s*How Out\s*Bowler\s*Runs/i)
  const bowlingStart = section.search(/Bowler\s*Overs\s*Maidens\s*Runs\s*Wickets/i)

  if (battingStart !== -1) {
    const battingSection =
      bowlingStart !== -1 ? section.slice(battingStart, bowlingStart) : section.slice(battingStart)

    for (const line of battingSection.split('\n').slice(1)) {
      const t = line.trim()
      if (!t || /^(Extras|Total|Wickets|Overs|\*|†|Fall)/i.test(t)) continue

      const bl = parseBattingLine(t)
      if (bl) {
        batters.push(bl)
        storePlayer(players, bl.name, battingTeam)
        if (bl.bowler) storePlayer(players, bl.bowler, bowlingTeam)
        if (bl.fielder) storePlayer(players, bl.fielder, null)
      } else {
        // Fallback name extraction for lines parseBattingLine didn't match
        const m = t.match(
          /^([A-Za-z][A-Za-z\s\-'.]*?)\s*(?:[*†])*\s*(?:b\s|ct\s|lbw|run out|retired|not out|did not bat)/i
        )
        if (m) {
          const name = m[1]
            .trim()
            .replace(/[*†\s]+$/, '')
            .trim()
          if (name.length >= 3 && name.split(' ').length >= 2)
            storePlayer(players, name, battingTeam)
        }
      }
    }
  }

  if (bowlingStart !== -1) {
    for (const line of section.slice(bowlingStart).split('\n').slice(1)) {
      const t = line.trim()
      if (!t || /^(Bowler|Total|Fielding)/i.test(t)) continue
      const m = t.match(/^([A-Za-z][A-Za-z\s\-'.]+?)\s*\d/)
      if (m) {
        const name = m[1].trim()
        if (name.length >= 3 && name.split(' ').length >= 2) storePlayer(players, name, bowlingTeam)
      }
    }
  }

  return { batters }
}

// Parse a single batting line and return structured dismissal/flag data.
// Returns null if the line doesn't match a recognisable batting entry.
function parseBattingLine(line) {
  const t = line.trim()
  if (!t) return null
  if (/^(Extras|Total|Wickets|Overs|Fall|Name|Bowling|Fielding|Page|\d)/i.test(t)) return null

  // Strip trailing stats (runs balls 4s 6s — four integers) if present
  // Also normalise missing space before 'ct' — PDF extraction sometimes omits it
  const body = t
    .replace(/\s+\d+\s+\d+\s+\d+\s+\d+\s*$/, '')
    .replace(/([a-zA-Z])(ct\s+[A-Z])/g, '$1 $2')
    .trim()

  // Player name: two or more capitalised words (stops naturally before digits / markers)
  // Markers: * (captain) and † (wicket keeper) appear directly after the name
  const N = "[A-Z][A-Za-z'\\-\\.]+(?:\\s+[A-Za-z'\\-\\.]+)+" // 2+ word name
  const SN = "[A-Z][A-Za-z'\\-\\.]+(?:\\s+[A-Za-z'\\-\\.]+)*" // 1+ word name (fielder/bowler)

  let m

  // (1) caught and bowled: ct & b BowlerName
  // nosemgrep: N/SN are hardcoded patterns, not HTTP user input
  m = body.match(new RegExp(`^(${N})\\s*([*†]*)\\s*ct\\s*&\\s*b\\s+(${SN})`, 'i'))
  if (m) return mk(m[1], m[2], 'CaughtAndBowled', null, m[3])

  // (2) caught: ct FielderName b BowlerName
  //     lowercase 'b' as separator avoids matching uppercase 'B' in surnames
  // nosemgrep: N/SN are hardcoded patterns, not HTTP user input
  m = body.match(new RegExp(`^(${N})\\s*([*†]*)\\s*ct\\s+(.+?)\\s+b\\s+(${SN})`))
  if (m) return mk(m[1], m[2], 'Caught', m[3].trim(), m[4])

  // (3) lbw: lbw b? BowlerName
  // nosemgrep: N/SN are hardcoded patterns, not HTTP user input
  m = body.match(new RegExp(`^(${N})\\s*([*†]*)\\s*lbw\\s+b?\\s*(${SN})`, 'i'))
  if (m) return mk(m[1], m[2], 'LBW', null, m[3])

  // (4) bowled: b BowlerName
  //     Using greedy name + capitalised bowler start to avoid false matches mid-name
  // nosemgrep: N/SN are hardcoded patterns, not HTTP user input
  m = body.match(new RegExp(`^(${N})\\s*([*†]*)\\s*b\\s+(${SN})`))
  if (m) return mk(m[1], m[2], 'Bowled', null, m[3])

  // (5a) run out (FielderName)
  // nosemgrep: N/SN are hardcoded patterns, not HTTP user input
  m = body.match(new RegExp(`^(${N})\\s*([*†]*)\\s*run\\s+out\\s*\\(([^)]*)\\)`, 'i'))
  if (m) return mk(m[1], m[2], 'RunOut', m[3].trim() || null, null)

  // (5b) run out FielderName  (no parens)
  // nosemgrep: N/SN are hardcoded patterns, not HTTP user input
  m = body.match(new RegExp(`^(${N})\\s*([*†]*)\\s*run\\s+out\\s+(${SN})`, 'i'))
  if (m) return mk(m[1], m[2], 'RunOut', m[3].trim() || null, null)

  // (5c) run out — no fielder info
  // nosemgrep: N/SN are hardcoded patterns, not HTTP user input
  m = body.match(new RegExp(`^(${N})\\s*([*†]*)\\s*run\\s+out`, 'i'))
  if (m) return mk(m[1], m[2], 'RunOut', null, null)

  // (6) stumped: st / stumped FielderName b BowlerName
  // nosemgrep: N/SN are hardcoded patterns, not HTTP user input
  m = body.match(new RegExp(`^(${N})\\s*([*†]*)\\s*(?:stumped|st)\\s+(.+?)\\s+b\\s+(${SN})`, 'i'))
  if (m) return mk(m[1], m[2], 'Stumped', m[3].trim(), m[4])

  // (7) not out
  // nosemgrep: N/SN are hardcoded patterns, not HTTP user input
  m = body.match(new RegExp(`^(${N})\\s*([*†]*)\\s*not\\s+out`, 'i'))
  if (m) return mk(m[1], m[2], 'NotOut', null, null)

  // (8) retired
  // nosemgrep: N/SN are hardcoded patterns, not HTTP user input
  m = body.match(new RegExp(`^(${N})\\s*([*†]*)\\s*retired`, 'i'))
  if (m) return mk(m[1], m[2], 'Retired', null, null)

  // (9) did not bat
  // nosemgrep: N/SN are hardcoded patterns, not HTTP user input
  m = body.match(new RegExp(`^(${N})\\s*([*†]*)\\s*did\\s+not\\s+bat`, 'i'))
  if (m) return mk(m[1], m[2], 'DidNotBat', null, null)

  return null
}

function mk(rawName, markers, method, fielder, bowler) {
  const name = rawName
    .trim()
    .replace(/[*†\s]+$/, '')
    .trim()
  if (name.length < 3 || name.split(/\s+/).length < 2) return null
  return {
    name,
    isCapt: (markers || '').includes('*'),
    isWK: (markers || '').includes('†'),
    method,
    fielder: fielder ? fielder.trim().replace(/\s+$/, '') : null,
    bowler: bowler ? bowler.trim().replace(/\s+$/, '') : null,
    dismissed: !['NotOut', 'Retired', 'DidNotBat'].includes(method),
  }
}

function storePlayer(players, name, team) {
  const key = name.toLowerCase().replace(/\s+/g, '_')
  if (!players[key]) players[key] = { name, team, nameKey: key }
  else if (team && !players[key].team) players[key].team = team
}

module.exports = { parsePdfText }
