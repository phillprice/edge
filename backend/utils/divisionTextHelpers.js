'use strict'

// Small text/HTML helpers shared by divisionStandingsParser.js and divisionFixturesParser.js.

const HTML_NAMED_ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }

// Single-pass decode — numeric refs and named entities replaced in one call
// so the output of one substitution is never re-scanned as input.
function decodeHtmlEntities(str) {
  return str.replace(/&(#(\d+)|[a-z]+);/gi, (match, ref, code) => {
    if (code) return String.fromCharCode(parseInt(code, 10))
    return HTML_NAMED_ENTITIES[ref.toLowerCase()] ?? match
  })
}

// "25 May 2026" + "10:00" → "2026-05-25T10:00:00"
function fixtureToIso(rawDate, startTime) {
  const monthMap = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12
  }
  const [day, mon, year] = rawDate.trim().split(/\s+/)
  const mm = String(monthMap[mon.toLowerCase().slice(0, 3)]).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}T${startTime}:00`
}

// Strip tags from a single-cell fragment and collapse whitespace.
function cellText(raw) {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

module.exports = { decodeHtmlEntities, fixtureToIso, cellText }
