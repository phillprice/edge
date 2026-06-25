'use strict'

// extras_type codes match the system schema: 1=no_ball, 2=wide, 3=bye, 4=leg_bye

function isBallToken(s) {
  if (!s) return false
  if (s === '•' || s === 'W' || s === 'R') return true
  if (/^\d+$/.test(s)) return true
  if (/^\d+wd$/.test(s)) return true
  if (/^\d+nb\+\d+$/.test(s)) return true
  if (/^\d+nb$/.test(s)) return true
  if (/^\d*lb$/.test(s)) return true
  if (/^\d*b$/.test(s)) return true
  return false
}

function parseBall(token) {
  const t = (token || '').trim()
  if (!t) return null
  if (t === '•') return { runs_bat: 0, runs_extra: 0, extras_type: null, is_wicket: false }
  if (t === 'W') return { runs_bat: 0, runs_extra: 0, extras_type: null, is_wicket: true }
  if (t === 'R')
    return { runs_bat: 0, runs_extra: 0, extras_type: null, is_wicket: false, retired: true }

  let m = t.match(/^(\d+)$/)
  if (m) return { runs_bat: parseInt(m[1], 10), runs_extra: 0, extras_type: null, is_wicket: false }

  m = t.match(/^(\d+)wd$/)
  if (m) return { runs_bat: 0, runs_extra: parseInt(m[1], 10), extras_type: 2, is_wicket: false }

  m = t.match(/^(\d+)nb\+(\d+)$/)
  if (m)
    return {
      runs_bat: parseInt(m[2], 10),
      runs_extra: parseInt(m[1], 10),
      extras_type: 1,
      is_wicket: false
    }

  m = t.match(/^(\d+)nb$/)
  if (m) return { runs_bat: 0, runs_extra: parseInt(m[1], 10), extras_type: 1, is_wicket: false }

  m = t.match(/^(\d*)lb$/)
  if (m)
    return {
      runs_bat: 0,
      runs_extra: m[1] ? parseInt(m[1], 10) : 1,
      extras_type: 4,
      is_wicket: false
    }

  m = t.match(/^(\d*)b$/)
  if (m)
    return {
      runs_bat: 0,
      runs_extra: m[1] ? parseInt(m[1], 10) : 1,
      extras_type: 3,
      is_wicket: false
    }

  return null
}

function findLongestBallSuffix(word) {
  if (isBallToken(word)) return word
  for (let i = 1; i < word.length; i++) {
    const suffix = word.slice(i)
    if (isBallToken(suffix)) return suffix
  }
  return null
}

// Given "BowlerNameXxx ball1 ball2..." where name may be glued to first ball token
function splitNameAndBalls(str) {
  const words = str.split(' ')
  const nameParts = []
  const balls = []
  let foundBalls = false

  for (const w of words) {
    if (!w) continue
    if (foundBalls) {
      balls.push(w)
      continue
    }
    const suffix = findLongestBallSuffix(w)
    if (suffix !== null) {
      const prefix = w.slice(0, w.length - suffix.length)
      if (prefix) nameParts.push(prefix)
      balls.push(suffix)
      foundBalls = true
    } else {
      nameParts.push(w)
    }
  }

  return {
    bowlers: nameParts
      .join(' ')
      .split(', ')
      .map((s) => s.trim())
      .filter(Boolean),
    balls: balls.map(parseBall).filter(Boolean)
  }
}

// Over-by-over lines from pdf-parse are space-separated: "1 4 1 Rory Davies W • • 1 1 2wd"
// (over_no, runs_total, wickets_total, bowler(s), ball tokens)
function parseOverLine(line, expectedOver) {
  const overStr = String(expectedOver)
  if (!line.startsWith(overStr)) return null
  let rest = line.slice(overStr.length).trimStart()
  rest = rest.replace(/^\d+/, '').trimStart() // strip runs total
  rest = rest.replace(/^\d+/, '').trimStart() // strip wickets total
  const { bowlers, balls } = splitNameAndBalls(rest)
  return { over_no: expectedOver - 1, bowlers, balls }
}

function parseBattingLine(line) {
  if (line.endsWith('did not bat')) {
    // Name may be directly glued to "did not bat" without a space (e.g. "D Cottrelldid not bat")
    const name = line.replace(/did not bat$/, '').trim()
    return { name, did_not_bat: true }
  }

  // PDF columns are space-separated: "R B 4s 6s MINS SR" where MINS is "-" or a digit string
  const statsMatch = line.match(/(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+[-\d]+\s+(\d+\.\d{2})$/)
  if (!statsMatch) return null

  const before = line.slice(0, line.length - statsMatch[0].length).trimEnd()

  let not_out = false
  let how_out = 'unknown'
  if (before.endsWith('not out')) {
    not_out = true
    how_out = 'not out'
  } else if (before.includes('retired n.o.')) {
    not_out = true
    how_out = 'retired'
  } else if (before.includes('run out')) {
    how_out = 'run out'
  } else if (before.match(/c .+ b [A-Z]/)) {
    how_out = 'caught'
  } else if (before.match(/b [A-Z]/)) {
    how_out = 'bowled'
  } else if (before.includes('lbw')) {
    how_out = 'lbw'
  }

  // Extract name: "A Surname" — single uppercase initial + space + Capitalized surname
  const nameMatch = before.match(/^([A-Z] [A-Z][a-z']+)/)
  const name = nameMatch ? nameMatch[1].trim() : before.split(/[^A-Za-z .'-]/)[0].trim()

  return {
    name,
    not_out,
    how_out,
    runs: parseInt(statsMatch[1], 10),
    balls: parseInt(statsMatch[2], 10),
    fours: parseInt(statsMatch[3], 10),
    sixes: parseInt(statsMatch[4], 10)
  }
}

// Parse bowling totals from a space-separated line: "O M R W ECON [extras]"
// The line may have extra leading per-over values (column data from the bowling table),
// so we anchor on the LAST decimal value as the ECON and read the 4 values before it.
function parseBowlingTotals(str) {
  const parts = str.trim().split(/\s+/)
  // Find the last part that looks like a decimal (the economy rate).
  // Regex matches only simple "digits.digits" — no backtracking risk.
  const isDecimal = (p) => /^\d+[.]\d+$/.test(p)
  const econIdx = parts
    .map((p, i) => (isDecimal(p) ? i : -1))
    .filter((i) => i >= 0)
    .pop()
  if (econIdx === undefined || econIdx < 4) return null

  const W = parseInt(parts[econIdx - 1], 10)
  const R = parseInt(parts[econIdx - 2], 10)
  const M = parseInt(parts[econIdx - 3], 10)
  const O = parts[econIdx - 4] // keep as string to support "1.4" fractional overs

  if (isNaN(parseInt(O, 10)) || isNaN(M) || isNaN(R) || isNaN(W)) return null

  const extras = parts.slice(econIdx + 1).join('')
  const wdM = extras.match(/(\d+)wd/)
  const nbM = extras.match(/(\d+)nb/)
  return {
    overs: parseFloat(O),
    maidens: M,
    runs: R,
    wickets: W,
    wides: wdM ? parseInt(wdM[1], 10) : 0,
    no_balls: nbM ? parseInt(nbM[1], 10) : 0
  }
}

function parseFoW(fowStr) {
  const entries = []
  const re = /(\d+)\/(\d+)\s*\(([^,]+),\s*([\d.]+)\s*overs\)/g
  let m
  while ((m = re.exec(fowStr)) !== null) {
    const overs = parseFloat(m[4])
    entries.push({
      score: parseInt(m[1]),
      wicket_no: parseInt(m[2]),
      batter_name: m[3].trim(),
      over_no: Math.floor(overs),
      ball_no: Math.round((overs % 1) * 10)
    })
  }
  return entries
}

function parseOvers(lines) {
  const overs = []
  let expectedOver = 1
  for (const line of lines) {
    const t = line.trim()
    if (!t || t.startsWith('Over') || t.startsWith('Ball')) continue
    const parsed = parseOverLine(t, expectedOver)
    if (parsed) {
      overs.push(parsed)
      expectedOver++
    }
  }
  return overs
}

// Split raw text into named sections
function extractSections(text) {
  const sections = {}
  // Match any innings ordinal: "1st", "2nd", "First", "Second", etc.
  const re = /([A-Za-z ]+) - \S+ Innings \((Batting|Bowling|Over-by-over)\)/g
  const matches = []
  let m
  while ((m = re.exec(text)) !== null) {
    matches.push({
      team: m[1].trim(),
      type: m[2],
      start: m.index,
      contentStart: m.index + m[0].length
    })
  }
  for (let i = 0; i < matches.length; i++) {
    const { team, type, contentStart } = matches[i]
    const end = i + 1 < matches.length ? matches[i + 1].start : text.length
    const content = text.slice(contentStart, end)
    sections[`${team}::${type}`] = content
  }
  return sections
}

function parseBattingSection(text) {
  const batting = []
  const fallOfWickets = []
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  let inFow = false

  for (const line of lines) {
    if (line.startsWith('Name') || line.startsWith('Extras') || line.startsWith('Total')) {
      inFow = false
      continue
    }
    if (line.startsWith('Fall of Wickets')) {
      inFow = true
      continue
    }
    if (inFow || line.match(/^\d+\/\d+/)) {
      fallOfWickets.push(...parseFoW(line))
      continue
    }
    const parsed = parseBattingLine(line)
    if (parsed) batting.push(parsed)
  }
  return { batting, fallOfWickets }
}

function parseBowlingSection(text) {
  const bowling = []
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
  let currentBowler = null

  for (const line of lines) {
    if (line.startsWith('Name') || line === 'R' || line === 'W' || line === 'NB' || line === 'WD')
      continue
    if (/^\d+$/.test(line) || line === '') continue

    if (line.match(/\d+\.\d+/)) {
      const totals = parseBowlingTotals(line)
      if (totals && currentBowler) {
        bowling.push({ name: currentBowler, ...totals })
      }
      currentBowler = null
      continue
    }

    if (/^[A-Z][a-z]/.test(line)) {
      currentBowler = line
    }
  }
  return { bowling }
}

function parseScorecard(text) {
  // Find team section headers — accept any innings ordinal ("1st", "2nd", "First", etc.)
  const inningHeaders = [...text.matchAll(/^([A-Za-z ]+) - \S+ Innings \(Batting\)/gm)]
  // Deduplicate so a two-innings PDF with the same team twice still yields two distinct teams
  const teams = [...new Set(inningHeaders.map((m) => m[1].trim()))]

  if (teams.length < 2) throw new Error('Could not identify two team innings')

  const [team1, team2] = teams

  const dateMatch = text.match(/(\d{1,2}\s+\w+\s+\d{4})/)
  const match_date = dateMatch ? dateMatch[1] : ''

  const sections = extractSections(text)

  const { batting: bat1, fallOfWickets: fow1 } = parseBattingSection(
    sections[`${team1}::Batting`] || ''
  )
  const { bowling: bowl1 } = parseBowlingSection(sections[`${team1}::Bowling`] || '')
  const overs1 = parseOvers((sections[`${team1}::Over-by-over`] || '').split('\n'))

  const { batting: bat2, fallOfWickets: fow2 } = parseBattingSection(
    sections[`${team2}::Batting`] || ''
  )
  const { bowling: bowl2 } = parseBowlingSection(sections[`${team2}::Bowling`] || '')
  const overs2 = parseOvers((sections[`${team2}::Over-by-over`] || '').split('\n'))

  const our_team = team1.toLowerCase().includes('woking') ? team1 : team2

  return {
    match_date,
    home_team: team1,
    away_team: team2,
    our_team,
    innings: [
      {
        batting_team: team1,
        bowling_team: team2,
        batting: bat1,
        bowling: bowl1,
        fallOfWickets: fow1,
        overs: overs1
      },
      {
        batting_team: team2,
        bowling_team: team1,
        batting: bat2,
        bowling: bowl2,
        fallOfWickets: fow2,
        overs: overs2
      }
    ]
  }
}

module.exports = { parseScorecard, parseBall, parseBattingLine, parseBowlingTotals }
