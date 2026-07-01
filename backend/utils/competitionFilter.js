'use strict'

const VALID_TYPE_TAGS = ['league', 'cup', 'friendly', 'indoor', 'internal']

/**
 * Parses a comma-separated `types` query-string value into an array of valid tag names.
 * @param {string|undefined} raw - req.query.types
 * @returns {string[]|null}
 */
function parseTypes(raw) {
  if (!raw) return null
  const vals = raw
    .split(',')
    .map((v) => v.toLowerCase().trim())
    .filter((v) => VALID_TYPE_TAGS.includes(v))
  return vals.length > 0 ? vals : null
}

/**
 * Returns an AND SQL fragment + params for filtering fixtures by tag(s) via fixture_tags.
 * Assumes the fixtures table is aliased as `f` with a `fixture_id` column.
 * @param {string[]|null} types - output of parseTypes()
 * @returns {{ clause: string, params: unknown[] }}
 */
function typesClause(types) {
  if (!types || types.length === 0) return { clause: '', params: [] }
  const placeholders = types.map(() => '?').join(', ')
  return {
    clause: `AND EXISTS (SELECT 1 FROM fixture_tags WHERE fixture_id = f.fixture_id AND tag IN (${placeholders}))`,
    params: types
  }
}

module.exports = { parseTypes, typesClause, VALID_TYPE_TAGS }
