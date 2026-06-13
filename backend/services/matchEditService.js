'use strict'

const { getDb } = require('../db/schema')
const { invalidateFixtureCaches } = require('../utils/cacheInvalidation')

function invalidateMatchCaches(db, fixtureId) {
  invalidateFixtureCaches(db, fixtureId)
  try {
    require('../utils/matchSummary').computeAndCacheStats(db, fixtureId)
  } catch (e) {
    console.error('[cache] update failed for', fixtureId, e.message)
  }
}

// PUT /:fixtureId/captain  { innings_order, player_id }
function handleCaptainPut(req, res) {
  const db = getDb()
  const { fixtureId } = req.params
  const { innings_order, player_id } = req.body
  if (!innings_order || !player_id)
    return res.status(400).json({ error: 'innings_order and player_id required' })
  db.prepare(
    `INSERT INTO match_captains (fixture_id, innings_order, player_id)
    VALUES (?, ?, ?)
    ON CONFLICT(fixture_id, innings_order) DO UPDATE SET player_id = excluded.player_id`
  ).run(fixtureId, innings_order, player_id)
  res.json({ ok: true })
}

// POST /:fixtureId/wk  { innings_order, player_id, from_over, to_over }
function handleWkPost(req, res) {
  const db = getDb()
  const { fixtureId } = req.params
  const { innings_order, player_id, from_over, to_over } = req.body
  if (!innings_order || !player_id || from_over === null || from_over < 1)
    return res.status(400).json({ error: 'innings_order, player_id and from_over required' })
  if (to_over !== null && to_over < from_over)
    return res.status(400).json({ error: 'End over must be ≥ start over' })

  const existing = db
    .prepare(
      `SELECT id, from_over, to_over FROM wk_assignments WHERE fixture_id = ? AND innings_order = ?`
    )
    .all(fixtureId, innings_order)
  for (const e of existing) {
    const eTo = e.to_over ?? null
    const overlaps = from_over >= e.from_over && (eTo === null || from_over <= eTo)
    if (!overlaps) continue
    if (eTo === null) {
      db.prepare('UPDATE wk_assignments SET to_over = ? WHERE id = ?').run(from_over - 1, e.id)
    } else {
      return res
        .status(400)
        .json({ error: `Overlaps with existing stint (overs ${e.from_over - 1}–${e.to_over - 1})` })
    }
  }

  try {
    const row = db
      .prepare(
        `INSERT INTO wk_assignments (fixture_id, innings_order, player_id, from_over, to_over) VALUES (?, ?, ?, ?, ?)`
      )
      .run(fixtureId, innings_order, player_id, from_over, to_over ?? null)
    res.json({ ok: true, id: row.lastInsertRowid })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}

// PATCH /:fixtureId/wk/:wkId  { to_over }
function handleWkPatch(req, res) {
  const db = getDb()
  const { fixtureId, wkId } = req.params
  const { to_over } = req.body
  const stint = db
    .prepare('SELECT * FROM wk_assignments WHERE id = ? AND fixture_id = ?')
    .get(wkId, fixtureId)
  if (!stint) return res.status(404).json({ error: 'Stint not found' })
  if (to_over !== null && to_over < stint.from_over)
    return res.status(400).json({ error: 'End over must be ≥ start over' })
  db.prepare('UPDATE wk_assignments SET to_over = ? WHERE id = ?').run(to_over ?? null, wkId)
  res.json({ ok: true })
}

// DELETE /:fixtureId/wk/:wkId
function handleWkDelete(req, res) {
  getDb()
    .prepare(`DELETE FROM wk_assignments WHERE id = ? AND fixture_id = ?`)
    .run(req.params.wkId, req.params.fixtureId)
  res.json({ ok: true })
}

// POST /:fixtureId/wk-error  { innings_order, player_id, error_type }
function handleWkErrorPost(req, res) {
  const db = getDb()
  const { fixtureId } = req.params
  const { innings_order, player_id, error_type } = req.body
  if (!innings_order || !player_id || !error_type)
    return res.status(400).json({ error: 'innings_order, player_id and error_type required' })
  try {
    const row = db
      .prepare(
        `INSERT INTO wk_errors (fixture_id, innings_order, player_id, error_type) VALUES (?, ?, ?, ?)`
      )
      .run(fixtureId, innings_order, player_id, error_type)
    res.json({ ok: true, id: row.lastInsertRowid })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}

// DELETE /:fixtureId/wk-error/:errorId
function handleWkErrorDelete(req, res) {
  getDb()
    .prepare(`DELETE FROM wk_errors WHERE id = ? AND fixture_id = ?`)
    .run(req.params.errorId, req.params.fixtureId)
  res.json({ ok: true })
}

// PATCH /:fixtureId/delivery/:deliveryId
function handleDeliveryPatch(req, res) {
  const db = getDb()
  const { fixtureId, deliveryId } = req.params

  const existing = db
    .prepare(
      `SELECT d.*, i.innings_order FROM deliveries d
    JOIN innings i ON i.result_id = d.result_id
    WHERE d.id = ? AND i.fixture_id = ?`
    )
    .get(deliveryId, fixtureId)
  if (!existing) return res.status(404).json({ error: 'Delivery not found' })

  const {
    batter_id,
    batter_id_ns,
    bowler_id,
    runs_bat,
    runs_extra,
    extras_type,
    dismissed_batter_id,
    dismissal_method,
    dismissal_fielder_id,
    dismissal_bowler_id
  } = req.body

  db.transaction(() => {
    const sets = []
    const vals = []
    const maybe = (key, val) => {
      if (val !== undefined) {
        sets.push(`${key} = ?`)
        vals.push(val)
      }
    }
    maybe('batter_id', batter_id)
    maybe(
      'batter_id_ns',
      batter_id_ns !== undefined ? (batter_id_ns === null ? null : batter_id_ns) : undefined
    )
    maybe('bowler_id', bowler_id)
    maybe('runs_bat', runs_bat)
    maybe('runs_extra', runs_extra)
    maybe(
      'extras_type',
      extras_type !== undefined ? (extras_type === null ? null : Number(extras_type)) : undefined
    )
    maybe(
      'dismissed_batter_id',
      dismissed_batter_id !== undefined
        ? dismissed_batter_id === null
          ? null
          : dismissed_batter_id
        : undefined
    )

    if (sets.length) {
      db.prepare(`UPDATE deliveries SET ${sets.join(', ')} WHERE id = ?`).run(...vals, deliveryId)
    }

    const prevDismissedId = existing.dismissed_batter_id
    if (dismissed_batter_id !== undefined) {
      if (prevDismissedId) {
        db.prepare(
          `DELETE FROM dismissals WHERE fixture_id = ? AND innings_order = ? AND batter_id = ?`
        ).run(fixtureId, existing.innings_order, prevDismissedId)
      }
      if (dismissed_batter_id !== null && dismissal_method) {
        db.prepare(
          `INSERT INTO dismissals (fixture_id, innings_order, batter_id, bowler_id, fielder_id, method)
          VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
          fixtureId,
          existing.innings_order,
          dismissed_batter_id,
          dismissal_bowler_id ?? null,
          dismissal_fielder_id ?? null,
          dismissal_method
        )
      }
    } else if (
      (dismissal_method ||
        dismissal_fielder_id !== undefined ||
        dismissal_bowler_id !== undefined) &&
      existing.dismissed_batter_id
    ) {
      db.prepare(
        `UPDATE dismissals SET
          method     = COALESCE(?, method),
          bowler_id  = ?,
          fielder_id = ?
        WHERE fixture_id = ? AND innings_order = ? AND batter_id = ?`
      ).run(
        dismissal_method ?? null,
        dismissal_bowler_id ?? null,
        dismissal_fielder_id ?? null,
        fixtureId,
        existing.innings_order,
        existing.dismissed_batter_id
      )
    }
  })()

  invalidateMatchCaches(db, fixtureId)
  res.json({ ok: true })
}

// PATCH /:fixtureId/pair-block
function handlePairBlockPatch(req, res) {
  const db = getDb()
  const { fixtureId } = req.params
  const { innings_order, over_start, over_end, batter1_id, batter2_id } = req.body

  if (!innings_order || !over_start || !over_end || !batter1_id || !batter2_id) {
    return res.status(400).json({
      error: 'innings_order, over_start, over_end, batter1_id and batter2_id are required'
    })
  }

  const inn = db
    .prepare(`SELECT result_id FROM innings WHERE fixture_id = ? AND innings_order = ?`)
    .get(fixtureId, innings_order)
  if (!inn) return res.status(404).json({ error: 'Innings not found' })

  const overNoStart = Number(over_start) - 1
  const overNoEnd = Number(over_end) - 1

  const deliveries = db
    .prepare(
      `SELECT id, batter_id, batter_id_ns FROM deliveries
      WHERE result_id = ? AND over_no BETWEEN ? AND ?`
    )
    .all(inn.result_id, overNoStart, overNoEnd)

  if (!deliveries.length)
    return res.status(404).json({ error: 'No deliveries found in that over range' })

  const oldIds = [
    ...new Set(deliveries.flatMap((d) => [d.batter_id, d.batter_id_ns].filter(Boolean)))
  ]

  const b1 = Number(batter1_id)
  const b2 = Number(batter2_id)

  const remap = {}
  for (let i = 0; i < oldIds.length; i++) {
    remap[oldIds[i]] = i % 2 === 0 ? b1 : b2
  }
  const fallback1 = b1,
    fallback2 = b2

  const updStmt = db.prepare(`UPDATE deliveries SET batter_id = ?, batter_id_ns = ? WHERE id = ?`)

  db.transaction(() => {
    for (const d of deliveries) {
      const newBatter = remap[d.batter_id] ?? (d.batter_id ? fallback1 : null)
      const newBatterNs = remap[d.batter_id_ns] ?? (d.batter_id_ns ? fallback2 : null)
      updStmt.run(newBatter, newBatterNs, d.id)
    }
  })()

  invalidateMatchCaches(db, fixtureId)
  res.json({ ok: true })
}

// PATCH /:fixtureId/result
function handleResultPatch(req, res) {
  const db = getDb()
  const { fixtureId } = req.params
  const fixture = db.prepare('SELECT fixture_id FROM fixtures WHERE fixture_id = ?').get(fixtureId)
  if (!fixture) return res.status(404).json({ error: 'Fixture not found' })

  const allowed = [
    'result',
    'home_score',
    'away_score',
    'home_overs',
    'away_overs',
    'home_wickets',
    'away_wickets',
    'toss_winner',
    'toss_decision'
  ]
  const sets = [],
    vals = []
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      sets.push(`${key} = ?`)
      vals.push(req.body[key] ?? null)
    }
  }
  if (!sets.length) return res.status(400).json({ error: 'No fields to update' })

  db.prepare(`UPDATE fixtures SET ${sets.join(', ')} WHERE fixture_id = ?`).run(...vals, fixtureId)
  invalidateMatchCaches(db, fixtureId)
  res.json({ ok: true })
}

// POST /:fixtureId/innings  { innings_order }
function handleInningsPost(req, res) {
  const db = getDb()
  const { fixtureId } = req.params
  const { innings_order } = req.body
  if (!fixtureId.startsWith('manual-'))
    return res.status(403).json({ error: 'Only allowed on manual fixtures' })
  if (![1, 2].includes(Number(innings_order)))
    return res.status(400).json({ error: 'innings_order must be 1 or 2' })

  const fixture = db.prepare('SELECT fixture_id FROM fixtures WHERE fixture_id = ?').get(fixtureId)
  if (!fixture) return res.status(404).json({ error: 'Fixture not found' })

  const order = Number(innings_order)
  let row = db
    .prepare(
      'SELECT result_id, innings_order FROM innings WHERE fixture_id = ? AND innings_order = ?'
    )
    .get(fixtureId, order)
  let created = false
  if (!row) {
    const r = db
      .prepare('INSERT INTO innings (fixture_id, innings_order) VALUES (?, ?)')
      .run(fixtureId, order)
    row = { result_id: r.lastInsertRowid, innings_order: order }
    created = true
  }
  res.json({ result_id: row.result_id, innings_order: row.innings_order, created })
}

// POST /:fixtureId/innings/:inningsOrder/delivery
function handleDeliveryPost(req, res) {
  const db = getDb()
  const { fixtureId, inningsOrder } = req.params
  if (!fixtureId.startsWith('manual-'))
    return res.status(403).json({ error: 'Only allowed on manual fixtures' })

  const order = Number(inningsOrder)
  if (![1, 2].includes(order)) return res.status(400).json({ error: 'inningsOrder must be 1 or 2' })

  const inn = db
    .prepare('SELECT result_id FROM innings WHERE fixture_id = ? AND innings_order = ?')
    .get(fixtureId, order)
  if (!inn)
    return res.status(404).json({ error: 'Innings not found — create it first via POST /innings' })

  const {
    batter_id,
    batter_id_ns,
    bowler_id,
    runs_bat = 0,
    runs_extra = 0,
    extras_type = null,
    dismissed_batter_id,
    dismissal_method,
    dismissal_fielder_id,
    dismissal_bowler_id
  } = req.body

  if (!batter_id || !bowler_id)
    return res.status(400).json({ error: 'batter_id and bowler_id are required' })

  const resultId = inn.result_id
  const extType = extras_type === null || extras_type === '' ? null : Number(extras_type)
  const isLegal = extType === null || extType === 3 || extType === 4

  const FIELDER_METHODS = ['Caught', 'CaughtAndBowled', 'Stumped', 'RunOut']

  let newId, over_no, ball_no
  db.transaction(() => {
    const last = db
      .prepare(
        'SELECT over_no, ball_no FROM deliveries WHERE result_id = ? ORDER BY over_no DESC, ball_no DESC LIMIT 1'
      )
      .get(resultId)

    if (!last) {
      over_no = 0
      ball_no = 1
    } else {
      const legalInOver = db
        .prepare(
          'SELECT COUNT(*) AS cnt FROM deliveries WHERE result_id = ? AND over_no = ? AND (extras_type IS NULL OR extras_type IN (3,4))'
        )
        .get(resultId, last.over_no).cnt

      if (legalInOver >= 6) {
        over_no = last.over_no + 1
        ball_no = 1
      } else {
        over_no = last.over_no
        ball_no = last.ball_no + 1
      }
    }

    const r = db
      .prepare(
        `INSERT INTO deliveries
          (result_id, innings_number, over_no, ball_no, ball_no_disp,
           batter_id, batter_id_ns, bowler_id,
           runs_bat, runs_extra, extras_type, dismissed_batter_id)
        VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        resultId,
        order,
        over_no,
        ball_no,
        Number(batter_id),
        batter_id_ns ? Number(batter_id_ns) : null,
        Number(bowler_id),
        Number(runs_bat),
        Number(runs_extra),
        extType,
        dismissed_batter_id ? Number(dismissed_batter_id) : null
      )
    newId = r.lastInsertRowid

    if (dismissed_batter_id && dismissal_method) {
      db.prepare(
        `INSERT OR IGNORE INTO dismissals (fixture_id, innings_order, batter_id, bowler_id, fielder_id, method)
        VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        fixtureId,
        order,
        Number(dismissed_batter_id),
        dismissal_method !== 'RunOut' && dismissal_bowler_id ? Number(dismissal_bowler_id) : null,
        FIELDER_METHODS.includes(dismissal_method) && dismissal_fielder_id
          ? Number(dismissal_fielder_id)
          : null,
        dismissal_method
      )
    }
  })()

  invalidateMatchCaches(db, fixtureId)
  res.json({ id: newId, over_no, ball_no, legal: isLegal })
}

// DELETE /:fixtureId/delivery/:deliveryId
function handleDeliveryDelete(req, res) {
  const db = getDb()
  const { fixtureId, deliveryId } = req.params
  if (!fixtureId.startsWith('manual-'))
    return res.status(403).json({ error: 'Only allowed on manual fixtures' })

  const existing = db
    .prepare(
      `SELECT d.*, i.innings_order FROM deliveries d
      JOIN innings i ON i.result_id = d.result_id
      WHERE d.id = ? AND i.fixture_id = ?`
    )
    .get(deliveryId, fixtureId)
  if (!existing) return res.status(404).json({ error: 'Delivery not found' })

  db.transaction(() => {
    if (existing.dismissed_batter_id) {
      db.prepare(
        'DELETE FROM dismissals WHERE fixture_id = ? AND innings_order = ? AND batter_id = ?'
      ).run(fixtureId, existing.innings_order, existing.dismissed_batter_id)
    }
    db.prepare('DELETE FROM deliveries WHERE id = ?').run(deliveryId)
  })()

  invalidateMatchCaches(db, fixtureId)
  res.json({ ok: true })
}

module.exports = {
  invalidateMatchCaches,
  handleCaptainPut,
  handleWkPost,
  handleWkPatch,
  handleWkDelete,
  handleWkErrorPost,
  handleWkErrorDelete,
  handleDeliveryPatch,
  handlePairBlockPatch,
  handleResultPatch,
  handleInningsPost,
  handleDeliveryPost,
  handleDeliveryDelete
}
