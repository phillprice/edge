# Plan: Automated Fixture Discovery + Scheduled Ingestion

## HTML structure (confirmed by fetching the live page)

Play Cricket fixture pages using `view_by=month` (`/Matches?tab=Fixture&view_by=month&fixture_month=5&team_id=35533&season_id=259`) contain:

```
Monday 25 May 2026                          ← plain text date header (day-of-week + DD Month YYYY)
<p class='time'>10:00</p>                   ← start time, just before the match block
href="/match_details?id=7686993"            ← fixture ID, appears ~4× per match (mobile/desktop/comments)

Friday 29 May 2026                          ← next date header
<p class='time'>18:00</p>
href="/match_details?id=7448947"
```

**Key observations:**
- `match_details?id=N` is the play-cricket fixture ID (same as `play_cricket_id` used in `fetchMatchData`)
- Each ID appears ~4 times per match — parse in order, skip seen IDs with a Set
- **`view_by=month` is the correct URL parameter** — it properly filters to the specified team's fixtures. `view_by=year` leaks other teams' matches and must not be used.
- Each match has its own `<p class='time'>HH:MM</p>` element just before the first ID occurrence
- No `website/results/` URL on fixture pages — `match_details?id=` is the only source of the ID
- **Discovery strategy: scrape current month + next 5 months** using individual `view_by=month&fixture_month=N` requests. Newly-added fixtures are picked up on the next daily run.

**URL param extraction** (for adding a team from a pasted URL):
The Play Cricket fixtures URL contains `team_id=35533` and `season_id=259` as query params. Parse with `new URL(str).searchParams`. The team name can be extracted from the fetched page: `<option selected="selected" value="35533">U11 Whirlwinds </option>`.

**Parse algorithm for fixture discovery:**
1. Scan for three token types with their byte position:
   - Date: `/(?:Monday|Tuesday|...) (\d{1,2} (?:Jan|Feb|...) \d{4})/`
   - Time: `/class='time'>(\d{2}:\d{2})/`
   - ID: `/href="\/match_details\?id=(\d+)"/`
2. Sort all tokens by position
3. Walk in order: when date seen → update `curDate`; when time seen → update `curTime`; when ID seen and not in Set → emit `{ playCricketId, matchDateIso }` and add to Set

---

## 1. New DB tables

Add both to `backend/db/schema.js` inside the existing `initDb()` function:

### `watched_teams` — teams whose fixtures are monitored
```sql
CREATE TABLE IF NOT EXISTS watched_teams (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id     INTEGER NOT NULL,
  season_id   INTEGER NOT NULL,
  label       TEXT NOT NULL,     -- e.g. "U11 Whirlwinds" extracted from page
  added_at    TEXT NOT NULL,
  UNIQUE(team_id, season_id)
)
```

### `scheduled_fixtures` — per-fixture ingest queue
```sql
CREATE TABLE IF NOT EXISTS scheduled_fixtures (
  play_cricket_id  INTEGER PRIMARY KEY,
  team_id          INTEGER NOT NULL,
  season_id        INTEGER NOT NULL,
  match_date_iso   TEXT NOT NULL,   -- e.g. 2026-05-25T10:00:00
  ingest_after     TEXT NOT NULL,   -- match_date_iso + AUTO_INGEST_DELAY_HOURS
  discovered_at    TEXT NOT NULL,
  ingested_at      TEXT,            -- null until successfully ingested
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending | done | failed
  error_msg        TEXT
)
```

**Important:** `scheduled_fixtures` is a queue only. Nothing in `scheduled_fixtures` is ever shown in the frontend. Rows from the actual `fixtures` table (populated only on successful ingest) drive all frontend views.

---

## 2. New function in `backend/utils/resultsvault.js` — `fetchFixtureList`

```js
// Scrapes current month + next 5 months to catch all upcoming fixtures.
// Returns deduplicated array of { playCricketId, matchDateIso }.
async function fetchFixtureList(teamId, seasonId) {
  const seen = new Set()
  const results = []
  const now = new Date()
  const dayNames = 'Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday'
  const monthNames = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?'

  for (let offset = 0; offset <= 5; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const month = d.getMonth() + 1
    const url = `https://whcc.play-cricket.com/Matches?tab=Fixture&view_by=month&fixture_month=${month}&team_id=${teamId}&season_id=${seasonId}`
    const html = await fetchHtml(url)

    const tokens = []
    const dateRe = new RegExp(`(?:${dayNames})\\s+(\\d{1,2}\\s+(?:${monthNames})\\s+\\d{4})`, 'gi')
    const timeRe = /class='time'>(\d{2}:\d{2})/g
    const idRe   = /href="\/match_details\?id=(\d+)"/g

    let m
    while ((m = dateRe.exec(html)) !== null) tokens.push({ type: 'date', val: m[1], pos: m.index })
    while ((m = timeRe.exec(html)) !== null) tokens.push({ type: 'time', val: m[1], pos: m.index })
    while ((m = idRe.exec(html))   !== null) tokens.push({ type: 'id',   val: m[1], pos: m.index })
    tokens.sort((a, b) => a.pos - b.pos)

    let curDate = null
    let curTime = '12:00'
    for (const t of tokens) {
      if      (t.type === 'date') { curDate = t.val; curTime = '12:00' }
      else if (t.type === 'time') { curTime = t.val }
      else if (t.type === 'id' && curDate && !seen.has(t.val)) {
        seen.add(t.val)
        results.push({ playCricketId: parseInt(t.val), matchDateIso: fixtureToIso(curDate.trim(), curTime) })
      }
    }
  }
  return results
}
```

### Also add `fetchTeamLabel(teamId, seasonId)` — extract team name from the page
```js
async function fetchTeamLabel(teamId, seasonId) {
  const url = `https://whcc.play-cricket.com/Matches?tab=Fixture&view_by=month&fixture_month=5&team_id=${teamId}&season_id=${seasonId}`
  const html = await fetchHtml(url)
  const m = html.match(new RegExp(`<option selected[^>]*value="${teamId}"[^>]*>([^<]+)<`))
  return m ? m[1].trim() : `Team ${teamId}`
}
```

### Date conversion helper
```js
// "25 May 2026" + "10:00" → "2026-05-25T10:00:00"
function fixtureToIso(rawDate, startTime) {
  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 }
  const [day, mon, year] = rawDate.trim().split(/\s+/)
  const mm = String(months[mon.toLowerCase().slice(0,3)]).padStart(2,'0')
  const dd = day.padStart(2,'0')
  return `${year}-${mm}-${dd}T${startTime}:00`
}
```

Export: `module.exports = { fetchMatchData, fetchFixtureList, fetchTeamLabel }`

---

## 3. New file — `backend/scheduler.js`

Teams are read from the `watched_teams` DB table, not env vars.

```js
const cron = require('node-cron')
const { fetchFixtureList } = require('./utils/resultsvault')
const { ingestMatch }      = require('./db/ingest')   // shared helper — see §4
const { getDb }            = require('./db/schema')

const DELAY_H = parseFloat(process.env.AUTO_INGEST_DELAY_HOURS || '4')

function addHours(isoStr, h) {
  const d = new Date(isoStr)
  d.setTime(d.getTime() + h * 3600000)
  return d.toISOString()
}

async function discoverFixtures() {
  const db = getDb()
  const teams = db.prepare('SELECT team_id, season_id FROM watched_teams').all()
  if (!teams.length) return
  let total = 0
  const insert = db.prepare(`
    INSERT OR IGNORE INTO scheduled_fixtures
      (play_cricket_id, team_id, season_id, match_date_iso, ingest_after, discovered_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const now = new Date().toISOString()
  for (const { team_id, season_id } of teams) {
    const fixtures = await fetchFixtureList(team_id, season_id)
    for (const f of fixtures) {
      const info = insert.run(f.playCricketId, team_id, season_id, f.matchDateIso, addHours(f.matchDateIso, DELAY_H), now)
      if (info.changes) total++
    }
  }
  console.log(`[scheduler] discoverFixtures: ${total} new fixture(s) queued`)
  return total
}

async function processPendingIngests() {
  const db = getDb()
  const pending = db.prepare(`
    SELECT * FROM scheduled_fixtures
    WHERE status = 'pending'
      AND ingest_after <= datetime('now')
      AND attempt_count < 5
    ORDER BY ingest_after
  `).all()

  for (const row of pending) {
    db.prepare('UPDATE scheduled_fixtures SET attempt_count = attempt_count + 1 WHERE play_cricket_id = ?')
      .run(row.play_cricket_id)
    try {
      await ingestMatch(row.play_cricket_id)
      db.prepare(`UPDATE scheduled_fixtures SET status='done', ingested_at=? WHERE play_cricket_id=?`)
        .run(new Date().toISOString(), row.play_cricket_id)
      console.log(`[scheduler] ingested fixture ${row.play_cricket_id}`)
    } catch (e) {
      const exhausted = (row.attempt_count + 1) >= 5
      db.prepare(`UPDATE scheduled_fixtures SET status=?, error_msg=? WHERE play_cricket_id=?`)
        .run(exhausted ? 'failed' : 'pending', e.message, row.play_cricket_id)
      console.error(`[scheduler] failed fixture ${row.play_cricket_id}: ${e.message}`)
    }
  }
}

// Daily 06:00 — discover new fixtures
cron.schedule('0 6 * * *', () => discoverFixtures().catch(e => console.error('[scheduler] discover error', e)))

// Every 30 minutes — ingest any past-threshold matches
cron.schedule('*/30 * * * *', () => processPendingIngests().catch(e => console.error('[scheduler] ingest error', e)))

// Run both once on startup
discoverFixtures().catch(console.error)
processPendingIngests().catch(console.error)

module.exports = { discoverFixtures, processPendingIngests }
```

---

## 4. Extract shared `ingestMatch` helper — transactional

Currently `POST /api/admin/fetch-match` inlines fetch + parse + ingest. Extract into a shared function and **wrap all DB writes in a single SQLite transaction** so a partial failure leaves no trace in the `fixtures` table.

```js
// In backend/routes/admin.js (or backend/db/ingest.js)
async function ingestMatch(playCricketId) {
  const db = getDb()
  const { fetchMatchData }    = require('../utils/resultsvault')
  const { parseHtmlScorecard } = require('../utils/scorecardParser')
  const { ingestDeliveries, autoPopulateRoles } = require('../db/ingest')

  const { dbFixtureId, innings, printHtml } = await fetchMatchData(playCricketId)
  const meta = parseHtmlScorecard(printHtml)

  // All DB writes inside one transaction — fixture only appears in frontend if this completes
  const run = db.transaction(() => {
    for (const inning of innings) {
      ingestDeliveries(inning, meta, { playCricketId })
    }
    autoPopulateRoles(dbFixtureId)
  })
  run()
}
```

The exact lift from the existing handler depends on how it's structured — may need minor untangling from `req`/`res`, but the logic is the same.

---

## 5. Admin API endpoints — add to `backend/routes/admin.js`

All gated by existing `requireUpload` middleware.

### Watched teams (new)
```
POST   /api/admin/scheduler/teams         body: { url }  → parse URL, fetch label, insert row, run discoverFixtures(), return { id, label, added }
GET    /api/admin/scheduler/teams         → list all watched_teams rows
DELETE /api/admin/scheduler/teams/:id     → remove row (does not delete already-queued scheduled_fixtures)
```

**URL parsing on the POST:**
```js
const u = new URL(body.url)
const teamId   = u.searchParams.get('team_id')
const seasonId = u.searchParams.get('season_id')
if (!teamId || !seasonId) return res.status(400).json({ error: 'URL must contain team_id and season_id' })
const label = await fetchTeamLabel(teamId, seasonId)
db.prepare('INSERT OR IGNORE INTO watched_teams (team_id, season_id, label, added_at) VALUES (?,?,?,?)')
  .run(teamId, seasonId, label, new Date().toISOString())
await discoverFixtures()
```

### Scheduler control (existing from earlier plan, unchanged)
```
GET  /api/admin/scheduler/status   → { teams: [...], queue: { pending, done, failed }, recent: [...last 20] }
POST /api/admin/scheduler/discover → trigger discoverFixtures() now, return { added }
POST /api/admin/scheduler/retry    → reset status='failed' rows to 'pending', return { reset }
```

---

## 6. Config via env vars (reduced — teams now in DB)

| Var | Default | Purpose |
|-----|---------|---------|
| `AUTO_INGEST_DELAY_HOURS` | `4` | Hours after match start before ingesting |
| `AUTO_INGEST_ENABLED` | `true` | Set to `false` to disable scheduler entirely |

`AUTO_INGEST_TEAMS` is removed — teams are managed through the UI.

---

## 7. `backend/server.js` change

```js
if (process.env.AUTO_INGEST_ENABLED !== 'false') require('./scheduler')
```

---

## 8. `backend/package.json`

Add to `dependencies`:
```json
"node-cron": "^3.0.3"
```

---

## 9. Frontend UI — Ingest page scheduler panel

Add a new "Auto-ingest" section to `frontend/src/pages/Ingest.jsx` (requires `canUpload`):

### Add team subsection
- Text input: "Paste a Play Cricket fixtures URL"  
  e.g. `https://whcc.play-cricket.com/Matches?tab=Fixture&...&team_id=35533&season_id=259&...`
- "Add team" button → `POST /api/admin/scheduler/teams` with the URL
- On success: shows extracted label (e.g. "U11 Whirlwinds 2026"), clears input
- On error: shows validation message (missing params, network error)

### Watched teams list
- Table of current `watched_teams` rows: label, team ID, season ID, added date, delete button
- Empty state: "No teams configured — paste a fixtures URL above to get started"

### Queue status subsection
- Summary: `N pending · N done · N failed` 
- "Discover now" button → `POST /api/admin/scheduler/discover`
- "Retry failed" button (shown only if failed > 0) → `POST /api/admin/scheduler/retry`
- Table of most recent 20 rows from `scheduled_fixtures`: match date, status badge, ingested-at, error if failed

All data from `GET /api/admin/scheduler/status` on mount; refreshes after button actions.

---

## Files to create / modify

| File | Action |
|------|--------|
| `backend/db/schema.js` | Add `watched_teams` + `scheduled_fixtures` tables |
| `backend/utils/resultsvault.js` | Add `fetchFixtureList`, `fetchTeamLabel`, `fixtureToIso`; update exports |
| `backend/scheduler.js` | **Create** — reads teams from DB; cron jobs + startup run |
| `backend/routes/admin.js` | Extract `ingestMatch` (transactional); add 5 scheduler endpoints |
| `backend/server.js` | Start scheduler on boot |
| `backend/package.json` | Add `node-cron` |
| `frontend/src/pages/Ingest.jsx` | Add auto-ingest panel (URL input, teams list, queue status) |

---

## Verification

1. Paste a valid Play Cricket URL in the UI → team appears in watched list, queue populates
2. Paste an invalid URL (missing `team_id`) → error message shown, nothing inserted
3. Manually set `ingest_after` to a past timestamp → `processPendingIngests()` ingests it, match appears in frontend
4. Kill ingest mid-way (e.g. bad fixture ID) → `fixtures` table unchanged, `status='pending'` (or `failed` after 5 attempts)
5. Delete a team → future discoveries skip it; already-queued rows are unaffected
6. `AUTO_INGEST_ENABLED=false` → server starts without cron
