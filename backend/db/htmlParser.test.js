'use strict'
const fs = require('fs')
const path = require('path')
const { parseHtmlScorecard } = require('./htmlParser')

// Characterization test against a real Play-Cricket print-HTML page (a 2025 U13 fixture).
// Locks in the parser's extracted output so the ReDoS-hardening regex rewrites can't
// silently change behaviour.
const html = fs.readFileSync(path.join(__dirname, '__fixtures__', 'print-sample.html'), 'utf8')

describe('parseHtmlScorecard — real print HTML', () => {
  const r = parseHtmlScorecard(html)

  it('extracts the teams', () => {
    expect(r.homeTeam).toBe('Woking & Horsell CC - U13 Hurricanes')
    expect(r.awayTeam).toBe('Valley End CC - Under 13')
  })
  it('extracts ground and date', () => {
    expect(r.ground).toBe('Westfield CC')
    expect(r.matchDate).toBe('Thursday 22nd May 2025')
  })
  it('extracts competition', () => {
    expect(r.competition).toBe('Surrey Junior Cricket Championship - Under 13 Tier 2 West 2025')
  })
  it('extracts toss and result', () => {
    expect(r.tossWinner).toBe('Valley End CC - Under 13')
    expect(r.tossDecision).toBe('bat')
    expect(r.matchResult).toBe('Valley End CC - Under 13 - Won')
  })
  it('defaults format/startingScore for a standard match', () => {
    expect(r.format).toBe('standard')
    expect(r.startingScore).toBe(0)
  })
  it('parses all players with names', () => {
    expect(Object.keys(r.players).length).toBe(22)
    for (const p of Object.values(r.players)) {
      expect(typeof p.name).toBe('string')
      expect(p.name.length).toBeGreaterThan(1)
    }
  })

  it('completes quickly on a large adversarial input (ReDoS guard)', () => {
    // A pathological string that would trigger catastrophic backtracking in an
    // unbounded-quantifier regex should still parse fast.
    const evil = '<h2>' + ' '.repeat(80000) + '</h2>' + html
    const start = Date.now()
    parseHtmlScorecard(evil)
    expect(Date.now() - start).toBeLessThan(2000)
  })
})
