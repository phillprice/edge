'use strict'

const { ourTeamClause, yearExpr, getClubFilters } = require('./db')
const { buildAccessFilter, buildGroupFilter } = require('./access')
const { getAuthContext } = require('../middleware/auth')
const { parseTypes, typesClause } = require('./competitionFilter')

function buildAccessClauses(req) {
  const accessFilter = buildAccessFilter(req)
  const groupFilter = buildGroupFilter(req)
  return {
    accessClause: accessFilter ? `AND (${accessFilter.sql})` : '',
    accessParams: accessFilter ? accessFilter.params : [],
    groupClause: groupFilter ? `AND (${groupFilter.sql})` : '',
    groupParams: groupFilter ? groupFilter.params : []
  }
}

function formatFilterClause(formatParam) {
  if (formatParam === 'pairs') return "AND f.format = 'pairs'"
  if (formatParam === 'no-pairs') return "AND COALESCE(f.format,'') != 'pairs'"
  return ''
}

function buildFilterClauses(db, req) {
  const year = /^\d{4}$/.test(req.query.year) ? req.query.year : null
  const VALID_TEAMS = ['whirlwind', 'hurricane', 'thunder', 'lightning']
  const team = VALID_TEAMS.includes((req.query.team || '').toLowerCase())
    ? req.query.team.toLowerCase()
    : null
  const types = parseTypes(req.query.types)
  const formatClause = formatFilterClause(req.query.format)

  const _yearExpr = yearExpr()
  const yearClause = year ? `AND ${_yearExpr} = ?` : ''
  const yearParams = year ? [year] : []
  const { clause: teamClause, params: teamParams } = ourTeamClause(team)
  const { clause: compFilter, params: compParams } = typesClause(types)

  const { accessClause, accessParams, groupClause, groupParams } = buildAccessClauses(req)

  const clubId = getAuthContext(req).clubId
  const clubFilters = getClubFilters(db, clubId != null ? clubId : null)

  return {
    yearClause,
    yearParams,
    teamClause,
    teamParams,
    compFilter,
    compParams,
    formatClause,
    accessClause,
    accessParams,
    groupClause,
    groupParams,
    clubFilters
  }
}

module.exports = { buildFilterClauses }
