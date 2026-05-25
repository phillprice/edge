# Technical Plan: Performance, Refactoring & Data Model

_Last updated: 2026-05-25 (current: v3.3.0)_

## Context

The app is a ball-by-ball cricket stats platform for WHCC. Key outstanding technical debt and performance work after v3.3.0:

**Already done:**
- `utils/db.js` created with `whccFixtureWhere` and `yearExpr` helpers — imported in both route files ✅
- `classifyDismissal` moved to `utils/cricket.js` and exported ✅
- `match_date_iso` column added and backfilled in schema migrations ✅
- `match_stats_cache`, `match_detail_cache`, `mvp_cache` cache tables in schema ✅
- Coverage: 89 backend unit tests (cricket, matchSummary, getPartnerships, parseHowOut, buildMatchFlow) + 58 frontend unit tests + 30+ E2E API contract tests ✅

**Still outstanding:**
- Missing indexes on frequently-joined tables
- `/api/players/stats` runs 20 CTEs on every page load
- All `db.prepare()` calls inside route handlers (recompiled on every request)
- Coverage scope still limited to `utils/cricket.js` only — `matchSummary`, route-level logic excluded from threshold
- E2E test infrastructure not CI-gated (runs in a separate job that can be skipped)

---

## 1. Add missing indexes  *(highest ROI, low risk)*

`backend/db/schema.js` has only 4 indexes (`idx_del_result`, `idx_del_batter`, `idx_del_bowler`, `idx_inn_fixture`). All of the following are absent and hit on every stats query:

```sql
CREATE INDEX IF NOT EXISTS idx_del_batter_ns  ON deliveries(batter_id_ns);
CREATE INDEX IF NOT EXISTS idx_dis_batter     ON dismissals(batter_id);
CREATE INDEX IF NOT EXISTS idx_dis_bowler     ON dismissals(bowler_id);
CREATE INDEX IF NOT EXISTS idx_dis_fielder    ON dismissals(fielder_id);
CREATE INDEX IF NOT EXISTS idx_dis_fixture    ON dismissals(fixture_id);
CREATE INDEX IF NOT EXISTS idx_mb_player      ON manual_batting(player_id);
CREATE INDEX IF NOT EXISTS idx_mb_fixture     ON manual_batting(fixture_id);
CREATE INDEX IF NOT EXISTS idx_mbw_player     ON manual_bowling(player_id);
CREATE INDEX IF NOT EXISTS idx_mbw_fixture    ON manual_bowling(fixture_id);
CREATE INDEX IF NOT EXISTS idx_pf_player      ON player_flags(player_id);
CREATE INDEX IF NOT EXISTS idx_wka_player     ON wk_assignments(player_id);
CREATE INDEX IF NOT EXISTS idx_fix_date_iso   ON fixtures(match_date_iso);
```

Add all to `initSchema()` — `IF NOT EXISTS` is safe on existing databases.

**Effort:** 30min. **Risk:** zero — read-only schema change.

---

## 2. Split `/api/players/stats` into batting + bowling  *(API / UX)*

The current single endpoint runs **20 CTEs** in one query on every Players page load. This is the most expensive request in the app.

**Proposal:**
- `GET /api/players/stats/batting` — batting CTEs only
- `GET /api/players/stats/bowling` — bowling CTEs only
- Keep `GET /api/players/stats` for backwards compatibility (calls both, merges)

The frontend can then fetch both in parallel (`Promise.all`) and render the batting table as soon as batting data arrives, cutting perceived latency roughly in half.

**Effort:** 3h — SQL split + frontend parallel fetch.

---

## 3. Add response caching headers  *(performance)*

Player stats only change after an ingest. Add to stats responses:

```js
res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=600');
```

A lightweight ETag based on `SELECT MAX(ingested_at) FROM ingests` lets clients skip the response body on cache hits. One cheap query per request vs. re-running 20 CTEs.

**Effort:** 30min. **Impact:** repeat visits (browser/CDN) are free.

---

## 4. Cache prepared statements at module level  *(minor)*

`better-sqlite3` compiles SQL every time `db.prepare()` is called. Currently all calls happen inside route handlers. For fixed queries (player names, year lists, partnerships with no dynamic WHERE), prepare at module level using a lazy singleton pattern:

```js
let _stmtNames;
function stmtNames() {
  return _stmtNames ??= getDb().prepare(`SELECT ...`);
}
```

Only worth doing for the handful of hot-path queries without dynamic clauses.

**Effort:** 1h. **Impact:** low at current scale, noticeable if DB row count grows.

---

## 5. Expand test coverage scope  *(testing)*

Currently `collectCoverageFrom` in `backend/package.json` only includes `utils/cricket.js`. The coverage report misses:
- `utils/matchSummary.js` — has tests but excluded from threshold
- `routes/matches.js` — `parseHowOut`, `buildMatchFlow`, `getPartnerships` have tests but coverage not measured
- `routes/players.js` — route handler logic untested
- `db/ingestMatch.js` — ingest pipeline untested

**Actions:**
1. Add `utils/matchSummary.js` to `collectCoverageFrom` and lower threshold to 60% initially (pure functions are covered but DB-coupled functions are not)
2. Add route-level integration tests using the test DB that test the HTTP response shape (not just raw SQL), covering the `GET /api/matches/:id`, `GET /api/players/stats`, `PATCH /delivery/:id` handlers
3. Raise threshold to 75% as coverage improves

**Effort:** M ��� 1 day per route tested.

---

## 6. Make E2E tests a CI gate  *(CI / quality)*

Currently the `e2e` job in `ci.yml` runs after `test` but is not a required status check — a failing E2E test doesn't block merging. Fix:

1. In GitHub repo settings → Branches → Protection rules for `main`: add the `e2e` job to required status checks.
2. Add `fail-fast: false` to the E2E job so Playwright's detailed HTML report is always uploaded even on failure.
3. Add `--reporter=html` to the Playwright run and `actions/upload-artifact` to capture the test report.

**Effort:** S — 1h config change + repo settings click.

---

## 7. Playwright test parallelism  *(CI speed)*

Currently all E2E tests run sequentially (single worker). The test database is shared and modified by PATCH tests (delivery editing, result editing). To enable parallel tests:

1. Use `beforeEach` to reset modified rows in tests that write to the DB, or
2. Seed a fresh `test.sqlite` per worker using Playwright's `--shard` feature

For now, tests are fast enough (~30s) that sequential is fine. Revisit if the suite grows past 60s.

---

## 8. Telegram notification resilience  *(ops)*

`notifyMatchIngested` in `matchSummary.js` calls `sendTelegram` — if the Telegram API is unreachable, the error is swallowed with `console.error` and the ingest still succeeds. This is correct behaviour, but there is no retry or dead-letter tracking.

**Improvement:** Add a `notifications_failed` table (fixture_id, failed_at, error) that logs Telegram failures for admin review. On the next successful run for the same fixture, attempt re-notify.

**Effort:** S — 2h schema + logic.

---

## 9. `resultsvault.js` error handling  *(reliability)*

`fetchFixtureList` in `resultsvault.js` is called by the scheduler to discover new fixtures. If the Play Cricket HTML structure changes, the scraper throws silently and no fixtures are discovered for that team. There is currently no alerting.

**Improvement:** If `fetchFixtureList` throws for all teams in the same discovery run, send a Telegram alert with the error message. This gives visibility without spamming on individual team failures.

**Effort:** XS — 30min.

---

## 10. `schema.js` migration versioning  *(ops)*

Currently all `ALTER TABLE` migrations are guarded by `try/catch` (column already exists) — there is no migration version table. This makes it hard to reason about which migrations have run on the production database.

**Improvement:** Add a `schema_migrations` table and track applied migrations by name. Use a simple `if (!columnExists(...)) { ALTER TABLE ... }` pattern to make migrations idempotent without relying on error swallowing.

**Effort:** S — 2h.

---

## Priority order

| # | Change | Effort | Impact |
|---|--------|--------|--------|
| 1 | Add indexes | 30min | **High** — eliminates full-table scans, zero risk |
| 3 | Cache headers | 30min | **Medium** — repeat visits free |
| 6 | E2E as CI gate | 1h | **High** — catches regressions before merge |
| 2 | Split stats endpoint | 3h | **Medium** — faster perceived load |
| 5 | Expand coverage scope | 1d/route | **Medium** — builds confidence in complex logic |
| 4 | Prepared statement cache | 1h | Low — marginal at current scale |
| 8 | Telegram retry/dead-letter | 2h | Medium — ops visibility |
| 9 | resultsvault alerting | 30min | Low — ops visibility |
| 10 | Schema migration versioning | 2h | Low — maintenance |
| 7 | Playwright parallelism | 1h | Low — only needed if suite slows |

**Do 1 + 6 first** — both are standalone, low-risk, and high value. Then **2 + 3** together. **5** is ongoing across multiple PRs as new route tests are added.
