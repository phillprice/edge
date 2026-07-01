'use strict'

const { ourCol, getClubShowMvp } = require('../utils/db')
const { buildManualMvp, buildMvp } = require('../utils/mvp')

function buildManualMvpForFixture(db, fixtureId, useCache) {
  const cachedMvp = useCache
    ? db.prepare('SELECT players_json FROM mvp_cache WHERE fixture_id = ?').get(fixtureId)
    : null
  if (cachedMvp) return { mvp: JSON.parse(cachedMvp.players_json), mvpMeta: null }
  const mvp = buildManualMvp(db, fixtureId)
  if (mvp.length && useCache) {
    db.prepare(
      'INSERT OR REPLACE INTO mvp_cache (fixture_id, players_json, meta_json, computed_at) VALUES (?, ?, ?, ?)'
    ).run(fixtureId, JSON.stringify(mvp), JSON.stringify(null), Date.now())
  }
  return { mvp, mvpMeta: null }
}

function buildAndCacheMvp(db, fixtureId, scorecards, fixtureMaxOvers, colWhere) {
  const mvpResult = buildMvp(db, fixtureId, scorecards, fixtureMaxOvers, colWhere)
  const mvp = mvpResult?.players ?? []
  const mvpMeta = mvpResult?.meta ?? null
  if (mvpResult) {
    db.prepare(
      'INSERT OR REPLACE INTO mvp_cache (fixture_id, players_json, meta_json, computed_at) VALUES (?, ?, ?, ?)'
    ).run(fixtureId, JSON.stringify(mvp), JSON.stringify(mvpMeta), Date.now())
  }
  return { mvp, mvpMeta }
}

function buildDeliveryMvpForFixture(
  db,
  fixtureId,
  scorecards,
  fixtureMaxOvers,
  colWhere,
  useCache
) {
  const cached = useCache
    ? db
        .prepare('SELECT players_json, meta_json FROM mvp_cache WHERE fixture_id = ?')
        .get(fixtureId)
    : null
  if (cached) {
    return { mvp: JSON.parse(cached.players_json), mvpMeta: JSON.parse(cached.meta_json) }
  }
  if (useCache) {
    return buildAndCacheMvp(db, fixtureId, scorecards, fixtureMaxOvers, colWhere)
  }
  const mvpResult = buildMvp(db, fixtureId, scorecards, fixtureMaxOvers, colWhere)
  return { mvp: mvpResult?.players ?? [], mvpMeta: mvpResult?.meta ?? null }
}

function buildMvpForFixture(
  db,
  fixtureId,
  scorecards,
  hasDeliveries,
  fixtureMaxOvers,
  colWhere = ourCol,
  clubId = null
) {
  if (!getClubShowMvp(db, clubId)) return { mvp: [], mvpMeta: null }
  const isManualMatch = scorecards.some((sc) => sc.isManual)
  const useCache = clubId == null || clubId === 1
  if (isManualMatch) return buildManualMvpForFixture(db, fixtureId, useCache)
  if (!hasDeliveries) return { mvp: [], mvpMeta: null }
  return buildDeliveryMvpForFixture(db, fixtureId, scorecards, fixtureMaxOvers, colWhere, useCache)
}

module.exports = { buildMvpForFixture }
