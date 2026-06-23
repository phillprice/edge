# Things to investigate — unresolved PR review comments

Generated 2026-06-15 from last week's merged PRs. Not tracked in git.
Verified against main on 2026-06-15.

---

## Tasklist — confirmed still present on main

- [ ] **[HIGH]** `IngestDetailPanel.jsx:160` — `JSON.parse(ig.source_files)` has no try/catch; malformed record crashes component tree. Wrap: `safeParseJson(ig.source_files, []).join(', ')`.
- [ ] **[HIGH]** `admin/index.js:478` — `PATCH /match/:id/type` has no try/catch around `.run()`; any DB error gives no useful response body. Add try/catch → `{ error: err.message }`.
- [ ] **[MEDIUM]** `EntryTables.jsx:6,156` — Both `BattingTable` and `BowlingTable` render `<datalist id="player-list">`; browsers use whichever comes first. Rename to `id="player-list-batting"` / `id="player-list-bowling"` and update `list=` attributes.
- [ ] **[MEDIUM]** `admin/index.js:483` — `VALID_MATCH_TYPES.includes(match_type)` is case-sensitive; `'League'` or `'FRIENDLY'` return 400. Normalise with `match_type?.toLowerCase()`.
- [ ] **[MEDIUM]** `IngestDetailPanel.jsx:16` — `fixtureId` missing from useEffect deps (suppressed with eslint-disable); panel shows stale data if fixture changes without unmounting. Gate on both `open` and `fixtureId`, or reset data on `fixtureId` change.
- [ ] **[MEDIUM]** `pdfScorecard.js:272,351` — `/ - 1st Innings \(/` regex is hardcoded; 2nd innings or variant labels produce no data. Generalise to accept any ordinal or drop the ordinal requirement.
- [ ] **[MEDIUM]** `admin/index.js:716` — `scorecard-commit` POST is a single monolithic `db.transaction()` (CCN 93). Extract `createFixture()`, `insertManualBatting()`, `insertManualBowling()`, `insertDeliveries()`.
- [ ] **[MEDIUM]** `backend/package.json` — global coverage threshold pinned at 24%; target is 70%. Ratchet up by 2–3 pp after each significant test addition.
- [ ] **[MEDIUM]** `admin.route.test.js:23+` — tests mutate DB directly with raw SQL instead of calling route handlers; won't catch route-level regressions. Replace with HTTP calls where possible.
- [ ] **[LOW]** `scheduler.js:67,100` — `parseInt(teamId)` and `parseInt(s.season_id)` have no radix. Add `, 10` throughout scheduler.js.

---

## Resolved — no action needed

- ✅ `htmlParser.js:114` — prototype pollution: explicit guard blocks `__proto__` / `constructor` / `prototype` keys.
- ✅ `ingest.js` — ReDoS: comment confirms indexOf/slice used instead of regex for external JSON; remaining regex `/\/Date\((\d+)/` is not backtracking-prone.
- ✅ `server.js:67` — rate limiting: `app.use('/api/', apiLimiter)` covers all API routes; no gaps found.
- ✅ `scheduler.js` — `autoAssociateTeam` unique constraint: function does DELETE then `INSERT OR IGNORE`; no duplicate insert path.

---

## PR #299 — PDF scorecard import

### pdfScorecard.js: parser only handles '1st Innings' headers (MEDIUM)
`backend/utils/pdfScorecard.js:272,351`  
The regex `/ - 1st Innings \(/` is hardcoded. If a PDF labels innings as '2nd Innings', 'Second Innings', or any other variant, section extraction silently fails — no innings data at all.  
**Investigate:** What PDF formats are in use? Do any use '2nd Innings' labels? Generalise the regex to accept any ordinal or drop the ordinal requirement.

### scorecard-commit transaction: CCN 93 (MEDIUM)
`backend/routes/admin/index.js` — the `scorecard-commit` POST handler is one giant `db.transaction()` block handling fixture creation, manual batting/bowling insert, and the entire ball-by-ball delivery loop.  
**Investigate:** Extract into: `createFixture()`, `insertManualBatting()`, `insertManualBowling()`, `insertDeliveries()` — each independently testable. This also enables unit-testing the delivery loop (currently 0% covered).

---

## PR #296 — match_type admin endpoint

### PATCH /match/:id/type has no try/catch (HIGH)
`backend/routes/admin/index.js:478–492`  
Any DB error (locked, constraint) throws an unhandled exception — Express 5 will catch it but the response will be a generic 500 with no useful body.  
**Investigate:** Wrap the `.run()` in try/catch, return `{ error: err.message }` on failure.

### match_type validation is case-sensitive (MEDIUM)
`VALID_MATCH_TYPES.includes(match_type)` rejects `'League'` or `'FRIENDLY'`.  
**Investigate:** Normalise with `match_type?.toLowerCase()` before the includes check.

---

## PR #294 — scheduler

### parseInt without radix (LOW)
`backend/scheduler.js:67,100`  
`parseInt(teamId)` and `parseInt(s.season_id)` have no radix. Safe in practice (inputs are decimal strings from the play-cricket API) but best practice is `parseInt(x, 10)`.  
**Investigate:** Trivial — s/parseInt(x)/parseInt(x, 10)/g across scheduler.js and anywhere else in the codebase.

### Potential unique constraint in autoAssociateTeam (HIGH — needs verification)
`backend/scheduler.js:215`  
Codacy flagged that calling `autoAssociateTeam` after the scheduler has already inserted into `scheduled_fixtures` may trigger a unique constraint violation. Not reproduced.  
**Investigate:** Trace the call chain to confirm whether `INSERT OR IGNORE` / `INSERT OR REPLACE` is used, or whether a duplicate insert path exists.

---

## PR #289 — frontend component refactor

### IngestDetailPanel: JSON.parse without try/catch (HIGH)
`frontend/src/components/match/IngestDetailPanel.jsx:160`  
```js
{ig.source_files ? JSON.parse(ig.source_files).join(', ') : '—'}
```
If `source_files` is malformed JSON (e.g. truncated ingest record), this throws and crashes the component tree.  
**Investigate:** Wrap in a helper: `safeParseJson(ig.source_files, []).join(', ')`.

### IngestDetailPanel: fixtureId missing from useEffect deps (MEDIUM)
`frontend/src/components/match/IngestDetailPanel.jsx:10–17`  
The effect is intentionally suppressed (`// eslint-disable-next-line react-hooks/exhaustive-deps`) so `fixtureId` changes don't re-fetch while the panel is open. But if a user navigates from one fixture's detail panel to another in the same SPA session without closing it, the panel will show stale data.  
**Investigate:** Either reset `data` to null when `fixtureId` changes (add `fixtureId` to the `[open]` dependency and gate on both), or explicitly clear on unmount.

### Duplicate datalist id="player-list" (MEDIUM)
`frontend/src/components/manualEntry/EntryTables.jsx:6,156`  
Both `BattingTable` and `BowlingTable` render `<datalist id="player-list">`. When both are on the page, browsers use whichever one appears first — so batting suggestions may bleed into bowling autocomplete or vice versa.  
**Investigate:** Use unique ids: `id="player-list-batting"` / `id="player-list-bowling"` and update the corresponding `list=` attribute.

---

## PR #283 — characterization tests

### Coverage threshold still far below aspirational target (MEDIUM)
`backend/package.json:35–46`  
Global threshold is 24% (lines/statements/branches) / 27% (functions). The original PR description lowered this from the planned 70% target to match the actual baseline. The plan calls for raising it progressively to 70%.  
**Investigate:** After each significant test addition, nudge the thresholds up by 2–3pp so they ratchet rather than stay pinned at the 2026-06-13 baseline.

### admin.route.test.js duplicates SQL rather than calling app code (MEDIUM)
`backend/routes/admin.route.test.js:85–109`  
Tests insert/delete players directly with raw SQL instead of going through the route handlers. If the route logic changes (e.g. cascade deletes, cache invalidation) the tests won't catch regressions.  
**Investigate:** Replace direct DB setup/teardown with HTTP calls to the relevant admin endpoints where possible (same pattern as `manual.route.http.test.js`).

---

## PR #282 — quality tooling / CodeQL

### htmlParser.js: prototype pollution (HIGH — CodeQL)
`backend/db/htmlParser.js:117`  
A `__proto__` string injected from parsed HTML could pollute `Object.prototype` via an assignment.  
**Investigate:** Check whether the assignment uses a computed key (e.g. `obj[userKey] = val`) and guard with `Object.hasOwn` or `Object.create(null)` maps.

### ingest.js: ReDoS in regex patterns (MEDIUM — CodeQL)
`backend/db/ingest.js`  
CodeQL flagged two regexes applied to remote HTML input that could run in polynomial time on adversarial input.  
**Investigate:** Review the specific patterns CodeQL flagged (line numbers in GitHub Security tab). Replace with linear alternatives (indexOf loops, or constrained anchors) similar to the fix already applied in htmlParser.js.

### server.js: missing rate limiting on some routes (LOW — CodeQL)
`backend/server.js:130`  
CodeQL flagged that an auth-performing route and a file-access route lack rate limiting. `apiLimiter` and `spaLimiter` are already imported and applied to most routes, but CodeQL sees a gap.  
**Investigate:** Check which routes at/around line 130 are outside the limiter middleware chain and whether they need covering.

---

## PR #284 — Helmet / CSP

### CodeQL: CSP was previously disabled (resolved ✓)
`backend/server.js`  
CodeQL flagged `contentSecurityPolicy: false`. This was fixed — Helmet now has a full directive set. No action needed; recorded here for traceability.

---
