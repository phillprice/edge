// Parses a play-cricket print.html scorecard and returns structured match data + player map

// Strip HTML tags, repeating until stable so split tags like "<scr<x>ipt" can't survive
// one pass. [^<>] keeps each match attempt linear (no backtracking across nested '<').
function stripTags(s) {
  let prev
  do {
    prev = s
    s = s.replace(/<[^<>]*>/g, '')
  } while (s !== prev)
  return s
}

// Tags are stripped from the raw markup BEFORE entities are decoded, so an
// entity-encoded "&lt;b&gt;" stays literal text instead of being re-parsed as markup
function decode(s) {
  return stripTags(s)
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&dagger;/g, '†')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim()
}

// indexOf scan instead of regex: the scorecard HTML is remote input, so cell
// extraction must stay linear no matter how the input is shaped
function extractCells(row, tag) {
  const cells = []
  const lower = row.toLowerCase()
  const open = '<' + tag
  const close = '</' + tag + '>'
  let i = 0
  for (;;) {
    const start = lower.indexOf(open, i)
    if (start === -1) break
    const next = lower[start + open.length]
    if (next !== '>' && next !== ' ' && next !== '\t' && next !== '\n') {
      i = start + open.length
      continue
    }
    const gt = lower.indexOf('>', start)
    if (gt === -1) break
    const end = lower.indexOf(close, gt + 1)
    if (end === -1) break
    cells.push(decode(row.slice(gt + 1, end)))
    i = end + close.length
  }
  return cells
}

function extractTdCells(row) {
  return extractCells(row, 'td')
}

function extractThCells(row) {
  return extractCells(row, 'th')
}

// Text of every <h2>/<h3> heading, again via linear indexOf scan
function headingTexts(html) {
  const out = []
  const lower = html.toLowerCase()
  for (const tag of ['h2', 'h3']) {
    const close = '</' + tag + '>'
    let i = 0
    for (;;) {
      const start = lower.indexOf('<' + tag, i)
      if (start === -1) break
      const gt = lower.indexOf('>', start)
      if (gt === -1) break
      const end = lower.indexOf(close, gt + 1)
      if (end === -1) break
      out.push(decode(html.slice(gt + 1, end)))
      i = end + close.length
    }
  }
  return out
}

// Cell text following "<b>Label</b></td><td>…</td>" (whitespace allowed after the label)
function labelledCell(html, label) {
  const lower = html.toLowerCase()
  const marker = '<b>' + label.toLowerCase()
  let i = 0
  for (;;) {
    const at = lower.indexOf(marker, i)
    if (at === -1) return null
    const closeB = lower.indexOf('</b></td><td>', at)
    if (closeB === -1) return null
    if (html.slice(at + marker.length, closeB).trim() !== '') {
      i = at + marker.length
      continue
    }
    const start = closeB + '</b></td><td>'.length
    const end = lower.indexOf('</td>', start)
    if (end === -1) return null
    return decode(html.slice(start, end))
  }
}

function storePlayer(players, name, team) {
  if (!name || name.length < 2) return
  const key = name.toLowerCase().replace(/\s+/g, '_')
  // Player names are scraped from external HTML — refuse keys that would corrupt the
  // prototype chain (explicit comparisons so static analysis recognises the barrier)
  if (key === '__proto__' || key === 'constructor' || key === 'prototype') return
  if (!Object.prototype.hasOwnProperty.call(players, key))
    players[key] = { name, team, nameKey: key }
  else if (team && !players[key].team) players[key].team = team
}

function parseScoreStr(s) {
  // Handles: "225-6 (35.0 overs)", "146 for 16 (20.0 overs) Net Score 266 'b'", "225 all out (35.0 overs)"
  const m = s.match(/(\d+)(?:\s+for\s+(\d+)|-(\d+)|\s+all\s+out)?\s*\(([0-9.]+)\s+overs?\)/i)
  if (!m) return null
  return { runs: m[1], wickets: m[2] ?? m[3] ?? null, overs: m[4] }
}

function parseHtmlScorecard(html) {
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
    format: 'standard',
    startingScore: 0,
    players: {},
    innings: [],
  }

  // Team names from the h2/h3 heading "Team A Vs Team B"
  const vsHeader = headingTexts(html).find((t) => /\sVs\s/i.test(t))
  if (vsHeader) {
    const parts = vsHeader.split(/\s+Vs\s+/i)
    if (parts.length === 2) {
      result.homeTeam = parts[0].trim()
      result.awayTeam = parts[1].trim()
    }
  }

  // Ground and Date
  const groundMatch = html.match(/<b>Ground\s*<\/b><\/td><td>([^<]+)<\/td>/i)
  if (groundMatch) result.ground = decode(groundMatch[1])

  const dateMatch = html.match(/<b>Date\s*<\/b><\/td><td>([^<]+)<\/td>/i)
  if (dateMatch) result.matchDate = decode(dateMatch[1])

  // Toss
  const toss = labelledCell(html, 'Toss')
  if (toss) {
    const m = toss.match(/^(.+?)\s+(?:won the toss and elected to|elected to)\s+(bat|field|bowl)/i)
    if (m) {
      result.tossWinner = m[1].trim()
      result.tossDecision = m[2].trim()
    }
  }

  // Competition
  const type = labelledCell(html, 'Type')
  if (type) {
    result.competition = type.replace(/^(Cup:|League:)\s*/i, '').trim()
  }

  // Match format (e.g. Pairs)
  const rulesMatch = html.match(/<b>Rules\s*Type\s*<\/b><\/td><td>([^<]+)<\/td>/i)
  if (rulesMatch && decode(rulesMatch[1]).toLowerCase().includes('pairs')) {
    result.format = 'pairs'
    const startingMatch = html.match(/Starting\s+at\s+(\d+)/i)
    if (startingMatch) result.startingScore = Number(startingMatch[1])
  }

  // Result
  const resultMatch = html.match(
    /<b>Result\s*:<\/b>((?:[^<]|<(?!table|\/div|br))*)(?:<table|<\/div|<br)/i
  )
  if (resultMatch)
    result.matchResult = decode(resultMatch[1])
      .replace(/^[\s&;]+/, '')
      .trim()

  // Scores from points_details table
  const pdMatch = html.match(/<table class="points_details">((?:[^<]|<(?!\/table>))+)<\/table>/i)
  if (pdMatch) {
    const pdHtml = pdMatch[1]
    // Team names from th cells
    const thCells = extractThCells(pdHtml)
    const teamHeaders = thCells.filter((c) => c.length > 1)
    if (teamHeaders.length >= 2) {
      result.homeTeam = result.homeTeam || teamHeaders[0]
      result.awayTeam = result.awayTeam || teamHeaders[1]
    }

    // Score rows
    const trRe = /<tr>((?:[^<]|<(?!\/tr>))*)<\/tr>/gi
    let m
    while ((m = trRe.exec(pdHtml)) !== null) {
      const cells = extractTdCells(m[1])
      if (cells[0] === 'Score' && cells.length >= 3) {
        const home = parseScoreStr(cells[1])
        const away = parseScoreStr(cells[2])
        if (home) {
          result.homeScore = home.runs
          result.homeWickets = home.wickets
          result.homeOvers = home.overs
        }
        if (away) {
          result.awayScore = away.runs
          result.awayWickets = away.wickets
          result.awayOvers = away.overs
        }
      }
    }
  }

  // Parse innings sections by splitting on <div id="innings
  const parts = html.split(/<div id="innings/i)
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]
    const headerMatch = part.match(/<h1 class="printHeader">([^<]+)<\/h1>/i)
    if (!headerMatch) continue
    const battingTeamShort = decode(headerMatch[1]).trim()

    // Match shortened name to full team name
    const battingTeam = resolveTeamName(battingTeamShort, result.homeTeam, result.awayTeam)
    const bowlingTeam = battingTeam === result.homeTeam ? result.awayTeam : result.homeTeam

    const batters = parseBattingSection(
      part,
      battingTeam,
      bowlingTeam,
      result.players,
      result.format === 'pairs'
    )
    parseBowlingSection(part, bowlingTeam, result.players)

    result.innings.push({ battingTeam, batters })
  }

  return result
}

// Match a shortened section name (e.g. "Weybridge") to a full team name
function resolveTeamName(short, homeTeam, awayTeam) {
  const s = short.toLowerCase()
  if (homeTeam && homeTeam.toLowerCase().startsWith(s)) return homeTeam
  if (awayTeam && awayTeam.toLowerCase().startsWith(s)) return awayTeam
  if (homeTeam && s.startsWith(homeTeam.toLowerCase().slice(0, 8))) return homeTeam
  if (awayTeam && s.startsWith(awayTeam.toLowerCase().slice(0, 8))) return awayTeam
  return short
}

function parseBattingSection(sectionHtml, battingTeam, bowlingTeam, players, isPairs) {
  const batters = []

  const tableMatch = sectionHtml.match(
    /<table class="batting[^"]*">((?:[^<]|<(?!\/table>))*)<\/table>/i
  )
  if (!tableMatch) return batters

  if (isPairs) {
    // Pairs columns: Name | Runs | Times Out | Net Score | Balls
    // Only extract names and captain/WK flags — no dismissal methods
    const trRe = /<tr>((?:[^<]|<(?!\/tr>))*)<\/tr>/gi
    let m
    while ((m = trRe.exec(tableMatch[1])) !== null) {
      const cells = extractTdCells(m[1])
      if (cells.length < 2) continue
      const rawName = cells[0]
      if (!rawName || rawName.length < 2) continue
      if (/^(Extras|Total|Wickets|Overs|Fall|Name|\*\s*=|\d)/i.test(rawName)) continue
      if (/^Extras$/i.test(cells[1] || '')) continue // colspan extras row: cells[0]="b (6), lb (1)..."
      if (rawName.includes('=')) continue
      const isCapt = rawName.includes('*')
      const isWK = rawName.includes('†')
      const name = rawName.replace(/[*†]/g, '').trim()
      if (!name || name.split(/\s+/).length < 2) continue
      storePlayer(players, name, battingTeam)
      batters.push({
        name,
        isCapt,
        isWK,
        dismissed: false,
        method: null,
        fielder: null,
        bowler: null,
      })
    }
    return batters
  }

  const trRe = /<tr>((?:[^<]|<(?!\/tr>))*)<\/tr>/gi
  let m
  while ((m = trRe.exec(tableMatch[1])) !== null) {
    const cells = extractTdCells(m[1])
    if (cells.length < 3) continue

    const rawName = cells[0]
    const howOut = cells[1]
    const bowlerCell = cells[2]

    // Skip header/footer rows
    if (!rawName || rawName.length < 2) continue
    if (/^(Extras|Total|Wickets|Overs|Fall|Name|\*\s*=|\d)/i.test(rawName)) continue
    if (rawName.includes('=')) continue // legend row like "* = Captain"

    const isCapt = rawName.includes('*')
    const isWK = rawName.includes('†')
    const name = rawName.replace(/[*†]/g, '').trim()
    if (!name || name.split(/\s+/).length < 2) continue

    // Parse bowler name from the bowler cell ("b Name" or "ct & b Name")
    const bc = (bowlerCell || '').trim()
    const ctbInBowlerCell = /^ct\s*&\s*b\s+/i.test(bc)
    const bowler = ctbInBowlerCell
      ? bc.replace(/^ct\s*&\s*b\s+/i, '').trim() || null
      : bc
        ? bc.replace(/^b\s+/i, '').trim() || null
        : null

    // Determine dismissal method and fielder
    let method,
      fielder = null
    const ho = (howOut || '').trim()
    const hoL = ho.toLowerCase()

    if (ctbInBowlerCell || /^ct\s*&\s*b/i.test(ho)) {
      method = 'CaughtAndBowled'
    } else if (hoL === 'not out') {
      method = 'NotOut'
    } else if (hoL === 'did not bat') {
      method = 'DidNotBat'
    } else if (/^retired/i.test(ho)) {
      method = 'Retired'
    } else if (/^ct\s+/i.test(ho)) {
      method = 'Caught'
      fielder = ho.replace(/^ct\s+/i, '').trim()
    } else if (/^lbw/i.test(hoL)) {
      method = 'LBW'
    } else if (/^run\s+out/i.test(hoL)) {
      method = 'RunOut'
      const roM = ho.match(/\(([^)]+)\)/)
      fielder = roM ? roM[1].trim() : null
    } else if (/^(?:stumped|st)\s+/i.test(ho)) {
      method = 'Stumped'
      fielder = ho.replace(/^(?:stumped|st)\s+/i, '').trim()
    } else if (bowler) {
      method = 'Bowled'
    } else {
      method = 'DidNotBat'
    }

    const dismissed = !['NotOut', 'Retired', 'DidNotBat'].includes(method)

    storePlayer(players, name, battingTeam)
    if (bowler) storePlayer(players, bowler, bowlingTeam)
    if (fielder) storePlayer(players, fielder, bowlingTeam)

    batters.push({ name, isCapt, isWK, method, fielder, bowler, dismissed })
  }

  return batters
}

function parseBowlingSection(sectionHtml, bowlingTeam, players) {
  const tableMatch = sectionHtml.match(/<table class="bowling">((?:[^<]|<(?!\/table>))*)<\/table>/i)
  if (!tableMatch) return

  const trRe = /<tr>((?:[^<]|<(?!\/tr>))*)<\/tr>/gi
  let m
  while ((m = trRe.exec(tableMatch[1])) !== null) {
    const cells = extractTdCells(m[1])
    if (!cells.length) continue
    const name = cells[0]
    if (!name || name.length < 3 || /^(Bowler|Total|Fielding|Extras)/i.test(name)) continue
    if (name.split(/\s+/).length < 2) continue
    storePlayer(players, name, bowlingTeam)
  }
}

module.exports = { parseHtmlScorecard }
