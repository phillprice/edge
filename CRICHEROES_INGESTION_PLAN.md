# Plan: one-off ingestion of twenty20cricketcompany.com scorecards (CricHeroes)

> Status: PLAN ONLY — nothing built yet. Untracked local file.
> Verified live against two matches:
> - `23656812` — T20 Academy U11 vs Cranleigh CC U11s (opponent example)
> - `23641340` — **Woking & Horsell CC U14s vs T20 Academy U14** (WHCC won by 47 runs)

## 1. How the site actually works

`www.twenty20cricketcompany.com` is a thin Next.js shell over the **CricHeroes API**.
Every scorecard is driven by JSON keyed by the match id that is already in the URL:

```
https://www.twenty20cricketcompany.com/scorecard/23641340/<tournament>/<teams>
                                                  ^^^^^^^^ matchId
```

### Endpoints (`https://cricheroes.in/api/your-web/match/<ep>/<matchId>`)

| Endpoint | Use |
|---|---|
| `get-scorecard` | Full per-player batting & bowling cards, extras breakdown, fall-of-wicket, toss, result, **captain & wicket-keeper** per team |
| `get-commentary` | **Ball-by-ball** — every delivery's runs/extras/wicket + prose naming bowler & batter (235 balls in the sample) |
| `get-match-playing-squad` | All 11 players/team with CricHeroes `player_id` + name (id↔name map) |
| `get-match-detailed-info` | date/time, ground, innings start/end times |
| `get-match-type` | team ids/names, overs, result summary |

### Required headers (the unlock)

Direct calls return `{"error":{"code":2327,"message":"this device type not supported"}}`.
The SPA sends a **fixed** header set that makes the API respond — confirmed working from a
plain server-side request, **no headless browser needed in production**:

```
api-key:          cr!CkH3r0s
app-id:           280
app-name:         twenty20
app-version:      0.1.0
app-version-code: 0.1.0
device-type:      your-web
udid:             <any stable non-empty string>
referer:          https://www.twenty20cricketcompany.com/
origin:           https://www.twenty20cricketcompany.com
content-type:     application/json
```

These are static values shipped in their public JS, so low maintenance — but it is an
undocumented private API: if they rotate the key the importer breaks. Plan for a graceful
error + "fall back to manual entry" path.

## 2. Decision: ingest **ball-by-ball** (native `deliveries`), not the manual path

Earlier hesitation was that per-ball batter/bowler ids aren't explicit fields. Verified they
are **100% recoverable**: splitting each `commentary` string on `" to "` and matching against
the squad name↔id map resolved **235/235 balls with 0 failures**. So we can populate the app's
native `innings` + `deliveries` tables exactly like the resultsvault/Play Cricket ingestion —
which means **match flow (manhattan/worm), partnerships, per-player ball-by-ball, MVP, WK/captain**
all light up, same as scraped matches. This is the requested outcome ("show match flow").

There is **no** dedicated graph endpoint (`get-match-graph`, `get-worm`, etc. all 404) — but we
don't need one; the app already derives those charts from `deliveries`.

## 3. Commentary → `deliveries` field mapping

Per ball, `get-commentary.data.commentary[]` gives:
`ball_id, team_id, inning, current_over, ball ("9.2"), run, extra_run, extra_type_code,
is_boundry, is_out, out_how, dismiss_type_code, dismiss_type, dismiss_player_id, commentary`.

| `deliveries` column | Source |
|---|---|
| `result_id` | synthetic per innings (e.g. `matchId*10 + inning`) |
| `innings_number` / `innings_order` | `inning` |
| `over_no`, `ball_no` | **reconstructed** by counting legal balls per innings (see §4) |
| `batter_id` | parse `commentary`: `text.split(' to ')[1].split(',')[0]` → squad name → id |
| `bowler_id` | parse `commentary`: `text.split(' to ')[0]` → squad name → id |
| `batter_id_ns` (non-striker) | inferred from crease tracking (see §4); nullable |
| `runs_bat` | `run` |
| `runs_extra` | `extra_run` |
| `extras_type` | map `extra_type_code` → app codes (see below) |
| `dismissed_batter_id` | `dismiss_player_id` when `!= 0` |
| `l_desc` / `s_desc` | `commentary` text + `dismiss_type` |

### extras_type mapping (app uses 1=bye, 2=leg-bye, 3=wide, 4=no-ball)
`B → 1`, `LB → 2`, `WD`/`WD-L → 3`, `NB`/`NB-L → 4`, `"" → null`.
Compound codes (`NB-L` = no-ball + leg-byes) map on the **primary** delivery type (NB).

### Gotchas confirmed in the data
- **`is_out` is always 0 — do NOT use it.** Detect wickets by `dismiss_player_id != 0`.
- **Dismissal types vary**: `dismiss_type` includes `Bowled`, `Caught`, `Run out`, `Retired`
  (code `OTH`), etc. Run-outs / retired must NOT credit the bowler a wicket. The existing
  delivery/dismissal logic already distinguishes; map `dismiss_type` → the app's method.
- **Wides/no-balls repeat the ball label** (`0.5` appears for the wide, then `0.5` again for the
  re-bowl). So trust our own legal-ball counter for `over_no`/`ball_no`, not the `ball` string.

## 4. Over/ball + non-striker reconstruction

- **over_no / ball_no**: iterate the innings chronologically (commentary is returned
  newest-first — reverse it). Maintain `legalBalls` counter; a ball is legal when
  `extra_type_code` is not WD*/NB*. `over_no = floor(legalBalls / 6)`,
  `ball_no = (legalBalls % 6) + 1`; wides/no-balls share the current ball_no and don't
  increment the counter.
- **non-striker (`batter_id_ns`)**: track the pair at the crease. Start innings with the first
  two distinct batters seen; after each ball, the striker is `batter_id`; the non-striker is the
  other crease occupant. Rotate on odd runs and at over end; replace a dismissed batter with the
  next new batter that appears. This is needed for partnerships; if it proves fiddly for edge
  cases (retired, byes) we can ship deliveries with `batter_id_ns = null` first (match flow,
  manhattan, worm still work) and refine partnerships later.

## 5. Match meta (fixtures row) from `get-scorecard` + `get-match-detailed-info`

| `fixtures` column | Source |
|---|---|
| `fixture_id` | new `cricheroes-<matchId>` (or `manual-`-style); store `cricheroes_match_id` too |
| `home_team` / `away_team` | `team_a.name` / `team_b.name` (respect `is_home_team`) |
| `match_date` / `match_date_iso` | `detailed-info.match_date_time` |
| `ground` | `detailed-info.location` (e.g. "Wonersh CC, Guildford") |
| `toss_winner` / `toss_decision` | parse `toss_details` ("Toss: T20 Academy U14 opt to field") |
| `result` | normalize `match_summary.summary` to the app's `"<winner> - Won"` format |
| `home_score`/`away_score`/wickets/overs | from innings totals (or let `backfillFixtureSummary` derive) |
| `max_overs` | `overs` (20) |
| captain / wicket-keeper | `team.captain_info` / `wicket_keeper_info` → `match_captains` / `wk_assignments` |

## 6. The "WHCC played instead of <team>" problem

Each scorecard names two clubs (e.g. `Woking & Horsell CC U14s` vs `T20 Academy U14`). For the
opponent example (`Cranleigh`), WHCC was actually the non-academy side. So the importer must
establish, before commit:

1. **Which CricHeroes team is us** — auto-guess via `isWhccTeam(team.name)`; if neither matches
   (e.g. WHCC entered under a generic name), operator picks the side. Map it to a WHCC
   `(team_id, season_id)` access group (reuse the existing team/season picker).
2. **Player identity** — WHCC players must resolve to **existing** player records so career stats
   merge; opposition players are created fresh. `findOrCreatePlayer` matches by name
   (`COLLATE NOCASE`). Risk: "Leo Ling" vs "Leo L". Show a **resolution table** (matched vs new)
   for operator confirmation before writing.

## 7. Proposed shape (operator-driven, one-off)

1. **`backend/utils/cricheroes.js`**
   - `parseMatchId(url)`
   - `fetchMatch(matchId)` → the 4–5 endpoint calls with the header set
   - `buildDeliveries(commentary, squad)` → per-innings delivery rows (§3–4)
   - `buildMatchMeta(scorecard, detailedInfo)` → fixtures row + captain/WK (§5)
2. **Ingest** through the existing native path (`ingestDeliveries` / innings + deliveries),
   reusing role auto-population, stats cache, MVP, and the new fixture-summary backfill.
   Store `cricheroes_match_id` so re-import updates in place (no duplicates).
3. **Admin UI** — add "Import from Twenty20/CricHeroes URL" to the existing ingest/admin area:
   paste URL → fetch → **preview** (both cards, which side is WHCC, player-resolution table,
   parsed toss/result) → operator confirms mappings → commit.
4. **Access control** — attach the imported fixture to the chosen `(team_id, season_id)` group
   (same model as the WIP two-level filter) so the right people see it.

## 8. Limitations / decisions to confirm

- **Non-striker / partnerships** — reconstructable but fiddly; OK to ship null-ns first
  (everything except precise partnership attribution works) and refine later? (recommend yes)
- **Dismissal fidelity** — map all `dismiss_type` values; retired/run-out/obstructing handled
  as non-bowler wickets.
- **Extras breakdown** — we keep full wd/lb/b/nb at the delivery level (better than the manual
  path, which only stores a single batting-extras int).
- **Private-API fragility** — header/key could change without notice; importer should fail
  gracefully with a clear message and the manual-entry fallback.
- **Identity matching** — confirm we want a mandatory human review step on player resolution
  (recommended) vs fully automatic.

## Appendix: reproducing the exploration

A throwaway Playwright script (chromium already installed) hitting the endpoints above with the
header set; reverse `commentary` for chronological order. All findings here were captured from
the two live match ids listed at the top.
