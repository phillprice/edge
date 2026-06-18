'use strict'

const VALID_TAGS = ['league', 'cup', 'friendly', 'indoor', 'internal']

// Derive tags from a competition name string at ingest time.
// Mirrors the heuristics in competitionFilter.js (which queries by competition text).
function tagsFromCompetition(competition) {
  const l = (competition || '').toLowerCase().trim()
  if (l.includes('cup')) return ['cup']
  if (l === 'friendly')  return ['friendly']
  if (l.includes('indoor')) return ['indoor']
  return ['league']
}

// Atomically replace all tags for a fixture. Validates and deduplicates.
function syncFixtureTags(db, fixtureId, tags) {
  const valid = [...new Set(tags)].filter((t) => VALID_TAGS.includes(t))
  db.prepare('DELETE FROM fixture_tags WHERE fixture_id = ?').run(fixtureId)
  const insert = db.prepare('INSERT OR IGNORE INTO fixture_tags VALUES (?, ?)')
  for (const tag of valid) insert.run(fixtureId, tag)
  // Keep match_type in sync for backwards compat (first non-league tag wins, else 'league').
  const primary = valid.find((t) => t !== 'league') ?? 'league'
  db.prepare('UPDATE fixtures SET match_type = ? WHERE fixture_id = ?').run(primary, fixtureId)
}

// Return tags for a single fixture as a string array.
function getFixtureTags(db, fixtureId) {
  return db
    .prepare('SELECT tag FROM fixture_tags WHERE fixture_id = ?')
    .all(fixtureId)
    .map((r) => r.tag)
}

// Return a map of fixture_id → tags[] for a list of fixture ids (efficient bulk read).
function getFixtureTagsMap(db, fixtureIds) {
  if (!fixtureIds.length) return {}
  const placeholders = fixtureIds.map(() => '?').join(',')
  const rows = db
    .prepare(`SELECT fixture_id, tag FROM fixture_tags WHERE fixture_id IN (${placeholders})`)
    .all(...fixtureIds)
  const map = {}
  for (const r of rows) {
    ;(map[r.fixture_id] ??= []).push(r.tag)
  }
  return map
}

// Convenience: tags for a fixture as a CSV subquery string — use inline in SELECT.
// e.g. `(${tagsSubquery('f.fixture_id')}) AS tags_csv`
function tagsSubquery(fixtureIdExpr) {
  return `SELECT GROUP_CONCAT(tag) FROM fixture_tags WHERE fixture_id = ${fixtureIdExpr}`
}

module.exports = { VALID_TAGS, tagsFromCompetition, syncFixtureTags, getFixtureTags, getFixtureTagsMap, tagsSubquery }
