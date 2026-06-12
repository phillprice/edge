const fs = require('fs')
const path = require('path')

// Runs once after the whole jest suite — removes the test SQLite DB (and its WAL/SHM
// sidecars) so no stray test.sqlite* files are left behind between runs.
module.exports = async () => {
  // Sweep the backend directory for test SQLite DBs and their WAL/SHM sidecars. We scan a
  // fixed directory (relative to this script) and match filenames against a strict pattern —
  // no externally-controlled path ever reaches fs.unlinkSync.
  const dir = path.join(__dirname, '..')
  for (const name of fs.readdirSync(dir)) {
    if (/^test[\w.-]*\.sqlite(-shm|-wal)?$/.test(name)) {
      try {
        fs.unlinkSync(path.join(dir, name))
      } catch (_) {
        /* gone already — fine */
      }
    }
  }
}
