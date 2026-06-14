'use strict'

// extras_type codes: 0=bye, 1=leg_bye, 2=no_ball, 3=wide

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
  if (t === 'R') return { runs_bat: 0, runs_extra: 0, extras_type: null, is_wicket: false, retired: true }

  let m = t.match(/^(\d+)$/)
  if (m) return { runs_bat: parseInt(m[1]), runs_extra: 0, extras_type: null, is_wicket: false }

  m = t.match(/^(\d+)wd$/)
  if (m) return { runs_bat: 0, runs_extra: parseInt(m[1]), extras_type: 3, is_wicket: false }

  m = t.match(/^(\d+)nb\+(\d+)$/)
  if (m) return { runs_bat: parseInt(m[2]), runs_extra: parseInt(m[1]), extras_type: 2, is_wicket: false }

  m = t.match(/^(\d+)nb$/)
  if (m) return { runs_bat: 0, runs_extra: parseInt(m[1]), extras_type: 2, is_wicket: false }

  m = t.match(/^(\d*)lb$/)
  if (m) return { runs_bat: 0, runs_extra: m[1] ? parseInt(m[1]) : 1, extras_type: 1, is_wicket: false }

  m = t.match(/^(\d*)b$/)
  if (m) return { runs_bat: 0, runs_extra: m[1] ? parseInt(m[1]) : 1, extras_type: 0, is_wicket: false }

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
    if (foundBalls) { balls.push(w); continue }
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
    bowlers: nameParts.join(' ').split(', ').map(s => s.trim()).filter(Boolean),
    balls: balls.map(parseBall).filter(Boolean)
  }
}

function parseOverLine(line, expectedOver) {
  const overStr = String(expectedOver)
  if (!line.startsWith(overStr)) return null
  let rest = line.slice(overStr.length)
  rest = rest.replace(/^\d+/, '') // strip summary runs+wickets digits
  const { bowlers, balls } = splitNameAndBalls(rest)
  return { over_no: expectedOver, bowlers, balls }
}

// Parse batting stats from trailing "{digits}-{SR}" using SR to resolve ambiguity
function parseBattingStatsStr(digits, sr) {
  const n = digits.length
  if (n < 2) return null

  if (sr === 0) {
    const B = parseInt(digits[1]) || 1
    return { runs: 0, balls: B, fours: n > 2 ? parseInt(digits[2]) : 0, sixes: n > 3 ? parseInt(digits[3]) : 0 }
  }

  for (let rb_end = n - 2; rb_end >= 2; rb_end--) {
    const fours = parseInt(digits[rb_end])
    const sixes = parseInt(digits.slice(rb_end + 1))
    const rbStr = digits.slice(0, rb_end)
    for (let r_len = 1; r_len < rbStr.length; r_len++) {
      const R = parseInt(rbStr.slice(0, r_len))
      const B = parseInt(rbStr.slice(r_len))
      if (!B) continue
      if (Math.abs((R / B) * 100 - sr) < 0.2) {
        return { runs: R, balls: B, fours: isNaN(fours) ? 0 : fours, sixes: isNaN(sixes) ? 0 : sixes }
      }
    }
  }
  return null
}

function parseBattingLine(line) {
  if (line.endsWith('did not bat')) {
    // Name may be directly glued to "did not bat" without a space (e.g. "D Cottrelldid not bat")
    const name = line.replace(/did not bat$/, '').trim()
    return { name, did_not_bat: true }
  }

  const statsMatch = line.match(/(\d+)-?(\d+\.\d{2})$/)
  if (!statsMatch) return null

  const digits = statsMatch[1]
  const sr = parseFloat(statsMatch[2])
  const before = line.slice(0, line.length - statsMatch[0].length)

  let not_out = false
  let how_out = 'unknown'
  if (before.endsWith('not out')) { not_out = true; how_out = 'not out' }
  else if (before.includes('retired n.o.')) { not_out = true; how_out = 'retired' }
  else if (before.includes('run out')) { how_out = 'run out' }
  else if (before.match(/c .+ b [A-Z]/)) { how_out = 'caught' }
  else if (before.match(/b [A-Z]/)) { how_out = 'bowled' }
  else if (before.includes('lbw')) { how_out = 'lbw' }

  // Extract name: "A Surname" — single uppercase initial + space + Capitalized surname
  // Using [A-Z][a-z]+ stops at the first uppercase letter that follows (i.e. inline ball "W")
  const nameMatch = before.match(/^([A-Z] [A-Z][a-z']+)/)
  const name = nameMatch ? nameMatch[1].trim() : before.split(/[^A-Za-z .'-]/)[0].trim()

  const stats = parseBattingStatsStr(digits, sr)

  return {
    name,
    not_out,
    how_out,
    runs: stats?.runs ?? 0,
    balls: stats?.balls ?? 0,
    fours: stats?.fours ?? 0,
    sixes: stats?.sixes ?? 0
  }
}

// Parse bowling totals line: e.g. "302026.672wd" → O=3,M=0,R=20,W=2
// Format: {O}{M}{R}{W}{ECO_int}.{ECO_dec}{extras}
function parseBowlingTotals(str) {
  const dotIdx = str.indexOf('.')
  if (dotIdx < 1) return null

  const decPart = str.slice(dotIdx + 1, dotIdx + 3)
  if (decPart.length < 2 || !/^\d{2}$/.test(decPart)) return null
  const afterDec = str.slice(dotIdx + 3)

  // Try largest ECO integer part first (2 digits, then 1) to avoid ambiguous smaller matches
  for (let ecoIntLen = Math.min(2, dotIdx); ecoIntLen >= 1; ecoIntLen--) {
    const ecoInt = str.slice(dotIdx - ecoIntLen, dotIdx)
    if (!/^\d+$/.test(ecoInt)) continue
    const eco = parseFloat(ecoInt + '.' + decPart)
    const omrwStr = str.slice(0, dotIdx - ecoIntLen)
    if (!omrwStr) continue

    const n = omrwStr.length
    for (let oLen = 1; oLen <= 2; oLen++) {
      for (let mLen = 1; mLen <= 2; mLen++) {
        for (let rLen = 1; rLen <= 3; rLen++) {
          const wStart = oLen + mLen + rLen
          if (wStart >= n) continue  // need at least 1 char for W
          const O = parseInt(omrwStr.slice(0, oLen))
          const M = parseInt(omrwStr.slice(oLen, oLen + mLen))
          const R = parseInt(omrwStr.slice(oLen + mLen, wStart))
          const W = parseInt(omrwStr.slice(wStart))
          if (!O || isNaN(W) || O > 30 || M > O) continue
          if (Math.abs(R / O - eco) < 0.15) {
            let wides = 0, no_balls = 0
            const wdM = afterDec.match(/(\d+)wd/)
            const nbM = afterDec.match(/(\d+)nb/)
            if (wdM) wides = parseInt(wdM[1])
            if (nbM) no_balls = parseInt(nbM[1])
            return { overs: O, maidens: M, runs: R, wickets: W, wides, no_balls }
          }
        }
      }
    }
  }
  return null
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
      over_no: Math.floor(overs) + 1,
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
    if (parsed) { overs.push(parsed); expectedOver++ }
  }
  return overs
}

// Split raw text into named sections
function extractSections(text) {
  const sections = {}
  const re = /([A-Za-z ]+) - 1st Innings \((Batting|Bowling|Over-by-over)\)/g
  const matches = []
  let m
  while ((m = re.exec(text)) !== null) {
    matches.push({ team: m[1].trim(), type: m[2], start: m.index, contentStart: m.index + m[0].length })
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
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  let inFow = false

  for (const line of lines) {
    if (line.startsWith('Name') || line.startsWith('Extras') || line.startsWith('Total')) { inFow = false; continue }
    if (line.startsWith('Fall of Wickets')) { inFow = true; continue }
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
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  let currentBowler = null

  for (const line of lines) {
    if (line.startsWith('Name') || line === 'R' || line === 'W' || line === 'NB' || line === 'WD') continue
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
  // Find team section headers
  const inningHeaders = [...text.matchAll(/^([A-Za-z ]+) - 1st Innings \(Batting\)/gm)]
  const teams = inningHeaders.map(m => m[1].trim())

  if (teams.length < 2) throw new Error('Could not identify two team innings')

  const [team1, team2] = teams

  const dateMatch = text.match(/(\d{1,2}\s+\w+\s+\d{4})/)
  const match_date = dateMatch ? dateMatch[1] : ''

  const sections = extractSections(text)

  const { batting: bat1, fallOfWickets: fow1 } = parseBattingSection(sections[`${team1}::Batting`] || '')
  const { bowling: bowl1 } = parseBowlingSection(sections[`${team1}::Bowling`] || '')
  const overs1 = parseOvers((sections[`${team1}::Over-by-over`] || '').split('\n'))

  const { batting: bat2, fallOfWickets: fow2 } = parseBattingSection(sections[`${team2}::Batting`] || '')
  const { bowling: bowl2 } = parseBowlingSection(sections[`${team2}::Bowling`] || '')
  const overs2 = parseOvers((sections[`${team2}::Over-by-over`] || '').split('\n'))

  const whcc_team = team1.toLowerCase().includes('woking') ? team1 : team2

  return {
    match_date,
    home_team: team1,
    away_team: team2,
    whcc_team,
    innings: [
      { batting_team: team1, bowling_team: team2, batting: bat1, bowling: bowl1, fallOfWickets: fow1, overs: overs1 },
      { batting_team: team2, bowling_team: team1, batting: bat2, bowling: bowl2, fallOfWickets: fow2, overs: overs2 }
    ]
  }
}

module.exports = { parseScorecard, parseBall, parseBattingLine, parseBowlingTotals }
