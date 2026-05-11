const express = require('express')
const router  = express.Router()
const multer  = require('multer')
const fs      = require('fs')
const os      = require('os')
const path    = require('path')
const { getDb, closeDb, DB_PATH } = require('../db/schema')

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } })

// GET /api/admin/export — hot backup of the SQLite database
router.get('/export', async (req, res) => {
  const tmpPath = path.join(os.tmpdir(), `cricket-backup-${Date.now()}.db`)
  try {
    await getDb().backup(tmpPath)
    const date = new Date().toISOString().slice(0, 10)
    res.download(tmpPath, `cricket-${date}.db`, () => fs.unlink(tmpPath, () => {}))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/admin/import — replace the database with an uploaded .db file
router.post('/import', upload.single('db'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  // Validate SQLite magic bytes
  const magic = req.file.buffer.slice(0, 16).toString('utf8')
  if (!magic.startsWith('SQLite format 3')) {
    return res.status(400).json({ error: 'Not a valid SQLite database file' })
  }

  const tmpPath = path.join(os.tmpdir(), `cricket-import-${Date.now()}.db`)
  try {
    fs.writeFileSync(tmpPath, req.file.buffer)
    closeDb()
    // Remove WAL and shared-memory files so the new DB starts clean
    for (const suffix of ['-wal', '-shm']) {
      try { fs.unlinkSync(DB_PATH + suffix) } catch (_) {}
    }
    fs.copyFileSync(tmpPath, DB_PATH)
    fs.unlinkSync(tmpPath)
    getDb() // reopen and run migrations
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PATCH /api/admin/player/:id — update display_name and/or is_sub flag
router.patch('/player/:id', (req, res) => {
  const db = getDb()
  const playerId = Number(req.params.id)
  if (!playerId) return res.status(400).json({ error: 'Invalid player id' })
  if ('display_name' in req.body) {
    const val = typeof req.body.display_name === 'string' ? req.body.display_name.trim() || null : null
    db.prepare(`UPDATE players SET display_name = ? WHERE player_id = ?`).run(val, playerId)
  }
  if ('is_sub' in req.body) {
    db.prepare(`UPDATE players SET is_sub = ? WHERE player_id = ?`).run(req.body.is_sub ? 1 : 0, playerId)
  }
  res.json({ ok: true })
})

module.exports = router
