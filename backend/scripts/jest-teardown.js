const fs = require('fs')
const path = require('path')

// Runs once after the whole jest suite — removes the test SQLite DB (and its WAL/SHM
// sidecars) so no stray test.sqlite* files are left behind between runs.
module.exports = async () => {
  const base = process.env.DB_PATH || path.join(__dirname, '..', 'test.sqlite')
  // Safety: only ever remove a test SQLite DB and its sidecars — never an arbitrary path
  // (DB_PATH is environment-derived). Refuse anything not named like test*.sqlite.
  if (!/^test[\w.-]*\.sqlite$/.test(path.basename(base))) return
  for (const suffix of ['', '-shm', '-wal']) {
    try { fs.unlinkSync(base + suffix) } catch (_) { /* not present — fine */ }
  }
}
