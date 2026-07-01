'use strict'

const express = require('express')
const router = express.Router()
const fs = require('fs')
const os = require('os')
const path = require('path')
const { getDb, closeDb, DB_PATH } = require('../../db/schema')
const { requireSuperAdmin } = require('../../middleware/auth')
const { upload } = require('./shared')

// GET /api/admin/export
router.get('/export', requireSuperAdmin, async (req, res, next) => {
  const tmpPath = path.join(os.tmpdir(), `cricket-backup-${Date.now()}.db`)
  try {
    await getDb().backup(tmpPath)
    const date = new Date().toISOString().slice(0, 10)
    res.download(tmpPath, `cricket-${date}.db`, () => fs.unlink(tmpPath, () => {})) // nosemgrep: tmpPath is os.tmpdir()+timestamp, not user input
  } catch (err) {
    next(err)
  }
})

// POST /api/admin/import
router.post('/import', requireSuperAdmin, upload.single('db'), (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  const magic = req.file.buffer.slice(0, 16).toString('utf8')
  if (!magic.startsWith('SQLite format 3')) {
    return res.status(400).json({ error: 'Not a valid SQLite database file' })
  }

  const tmpPath = path.join(os.tmpdir(), `cricket-import-${Date.now()}.db`)
  try {
    fs.writeFileSync(tmpPath, req.file.buffer) // nosemgrep: tmpPath is os.tmpdir()+timestamp
    closeDb()
    for (const suffix of ['-wal', '-shm']) {
      try {
        fs.unlinkSync(DB_PATH + suffix)
      } catch (_) {}
    }
    fs.copyFileSync(tmpPath, DB_PATH)
    fs.unlinkSync(tmpPath) // nosemgrep: tmpPath is os.tmpdir()+timestamp
    getDb()
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

module.exports = router
