'use strict'
/**
 * Async database abstraction over @libsql/client that mirrors the
 * better-sqlite3 synchronous interface used throughout this codebase.
 *
 * Drop-in replacement for the object returned by better-sqlite3:
 *   const db = require('./turso').getTursoDb()
 *   await db.prepare('SELECT ...').all(arg1, arg2)
 *   await db.prepare('INSERT ...').run(arg1, arg2)
 *   await db.exec('CREATE TABLE ...')
 *   await db.transaction(async () => { ... })()
 *
 * Argument format: positional (?) matches better-sqlite3 style.
 */

const { createClient } = require('@libsql/client')

let _client = null

function getClient() {
  if (!_client) {
    const url   = process.env.TURSO_DATABASE_URL
    const token = process.env.TURSO_AUTH_TOKEN
    if (!url) throw new Error('TURSO_DATABASE_URL not set')
    _client = createClient({ url, authToken: token })
  }
  return _client
}

// Convert positional args to the array format @libsql/client expects.
// better-sqlite3 accepts either .run(a, b) or .run([a, b]) or .run({name: val}).
function normaliseArgs(args) {
  if (!args || args.length === 0) return []
  if (args.length === 1) {
    if (Array.isArray(args[0])) return args[0]
    if (args[0] !== null && typeof args[0] === 'object' && !Buffer.isBuffer(args[0])) return args[0]
  }
  return args
}

class AsyncStatement {
  constructor(sql) { this.sql = sql }

  async get(...args) {
    const result = await getClient().execute({ sql: this.sql, args: normaliseArgs(args) })
    return result.rows[0] ?? null
  }

  async all(...args) {
    const result = await getClient().execute({ sql: this.sql, args: normaliseArgs(args) })
    return result.rows
  }

  async run(...args) {
    const result = await getClient().execute({ sql: this.sql, args: normaliseArgs(args) })
    return { changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid }
  }

  // Synchronous iterate() not supported on remote libSQL — use all() instead.
  iterate() { throw new Error('iterate() not supported with Turso; use all()') }
}

class AsyncDb {
  prepare(sql) { return new AsyncStatement(sql) }

  async exec(sql) {
    // exec() may contain multiple statements separated by ;
    const statements = sql.split(';')
      .map(s => s.trim())
      .filter(Boolean)
    for (const s of statements) {
      await getClient().execute(s)
    }
  }

  // Wraps an async function in a libSQL interactive transaction.
  // Usage: await db.transaction(async () => { ... })()
  transaction(fn) {
    return async (...outerArgs) => {
      const tx = await getClient().transaction('write')
      try {
        // Provide a scoped db-like object that uses the transaction connection
        const txDb = {
          prepare: (sql) => ({
            async get(...args)  { const r = await tx.execute({ sql, args: normaliseArgs(args) }); return r.rows[0] ?? null },
            async all(...args)  { const r = await tx.execute({ sql, args: normaliseArgs(args) }); return r.rows },
            async run(...args)  { const r = await tx.execute({ sql, args: normaliseArgs(args) }); return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid } },
          }),
          async exec(sql) { await tx.execute(sql) },
          transaction: (innerFn) => txDb.transaction(innerFn), // nested transaction re-uses same tx
        }
        const result = await fn.call(txDb, ...outerArgs)
        await tx.commit()
        return result
      } catch (e) {
        await tx.rollback()
        throw e
      }
    }
  }

  // Pragma is a no-op for remote libSQL (handled server-side)
  pragma() { return null }

  async backup() { throw new Error('backup() not supported with Turso; use the Turso dashboard') }
}

const _db = new AsyncDb()

function getTursoDb() { return _db }

module.exports = { getTursoDb, getClient }
