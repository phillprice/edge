'use strict'

const VALID_COMPS = ['cup', 'friendly', 'league']
const VALID_TYPE_TAGS = ['league', 'cup', 'friendly', 'indoor', 'internal']

function parseComp(raw) {
  const v = (raw || '').toLowerCase()
  return VALID_COMPS.includes(v) ? v : null
}

function compClause(comp) {
  if (comp === 'cup') return { clause: `AND lower(f.competition) LIKE '%cup%'`, params: [] }
  if (comp === 'friendly') return { clause: `AND lower(f.competition) = 'friendly'`, params: [] }
  if (comp === 'league')
    return {
      clause: `AND (f.competition IS NULL OR (lower(f.competition) NOT LIKE '%cup%' AND lower(f.competition) != 'friendly'))`,
      params: []
    }
  return { clause: '', params: [] }
}

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

module.exports = { parseComp, compClause, VALID_COMPS, parseTypes, typesClause, VALID_TYPE_TAGS }
