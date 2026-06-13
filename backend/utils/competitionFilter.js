'use strict'

const VALID_COMPS = ['cup', 'friendly', 'league']

/**
 * Parses and validates the `comp` query-string value.
 * @param {string|undefined} raw - req.query.comp
 * @returns {string|null} normalised comp value or null
 */
function parseComp(raw) {
  const v = (raw || '').toLowerCase()
  return VALID_COMPS.includes(v) ? v : null
}

/**
 * Returns an AND SQL fragment + params array for filtering by competition type.
 * @param {string|null} comp - output of parseComp()
 * @returns {{ clause: string, params: unknown[] }}
 */
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

module.exports = { parseComp, compClause, VALID_COMPS }
