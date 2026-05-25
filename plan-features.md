# EDGE — Feature & Improvement Plan

_Last updated: 2026-05-25 (current: v3.3.0)_

---

## What exists (verified as of v3.3.0)

| Page / feature | Status |
|---|---|
| Match list with year / team / type filters | ✅ |
| Match detail — batting scorecard, bowling scorecard | ✅ |
| Match detail — over-by-over grid + table toggle | ✅ |
| Match detail — worm chart, manhattan chart, phase breakdown | ✅ |
| Match detail — match flow log (with WHCC-batting bowler_haul suppression) | ✅ |
| Match detail �� partnership chart (fixed: a===b skip, ✎ pair reassign) | ✅ |
| Match detail — MVP card | ✅ |
| Match detail — re-ingest + delete (admin) | ✅ |
| Match detail — delivery editor (runs, extras, batter, non-striker) | ✅ |
| Match detail — result editor (finalize result/scores when PC has no data) | ✅ |
| Player list — batting table, bowling table, heat maps, card view (mobile) | ✅ |
| Player list — sortable columns with keyboard nav | ✅ |
| Player list — sortable top partnerships table (by runs, avg, best, stands) | ✅ |
| Player detail — batting/bowling innings history with milestones | ✅ |
| Player detail — dismissal breakdown | ✅ |
| Player detail — head-to-head vs opponents | ✅ |
| Player detail — year + team filters | ✅ |
| Season page — record, batting/bowling aggregates, top 3 performers | ✅ |
| Season page — form bar chart, results table | ✅ |
| Season page — year / team / type filters | ��� |
| Manual entry for matches without ball-by-ball data | ✅ |
| Play Cricket PDF/JSON ingest | ✅ |
| Dark / light mode with WCAG-compliant chart colours | ✅ |
| Player display name editing, sub flagging, ignore flag | ✅ |
| Duplicate player detection + merge (admin) | ✅ |
| Auto-ingest scheduler — discover fixtures daily, ingest 4h after match start | ✅ |
| Scheduler — requeue 60 min later if match still in progress | ✅ |
| Scheduler — auto-cleanup when match manually ingested | ✅ |
| Ingest page — scheduler queue with next-fire time column | ✅ |
| Ingest page — live cron-job.org details panel | ✅ |
| Telegram match summary notifications | ✅ |

---

## 1  All-time records page  ★★★

**What:** A new `/records` route listing club all-time bests — highest individual score, best bowling figures, most career runs/wickets, highest partnership, best economy (min 20 overs), fastest 50 by balls. Filterable by team and format.

**Why it matters:** Single most requested stat type for club members. All derivable from existing data.

**Backend:** `GET /api/records?team=&format=` — ~8 targeted SQL queries returning top-5 rows. No schema changes.

**Frontend:** New `Records.jsx` page with ranked list cards per category. Add nav link.

**Effort:** M — 1 day backend, half day frontend.

---

## 2  Opponent breakdown on Season page  ★★★

**What:** Below the Season results table, add a "By opponent" section: win/loss record, average score, and average conceded, grouped by opponent team name.

**Why it matters:** Which teams WHCC consistently beats or loses to — club members ask this constantly.

**Backend:** Add `opponent_summary` array to `/api/matches/season` — group by `opp_team` in SQL with win/loss counts and run averages.

**Frontend:** Collapsible table in `Season.jsx`, sorted by games played desc.

**Effort:** S — half day backend, half day frontend.

---

## 3  Fall of wickets on match scorecard  ★★★

**What:** Below each innings batting table: `1-12 (Smith, 3.2)  2-34 (Jones, 8.1)` — cumulative score and over at each wicket.

**Why it matters:** Standard scorecard component that is currently absent. Data already exists in the scorecards response.

**Backend:** Derive `fow` array per innings in `routes/matches.js` from delivery/wicket data and add to each scorecard object.

**Frontend:** Compact row beneath the batting table in `MatchDetail.jsx`. Player names link to `/player/:id`.

**Effort:** M — half day backend, half day frontend.

---

## 4  Batting / bowling progression charts on player profile  ★★★

**What:** On the batting tab, a Recharts line chart of cumulative career runs over time. On the bowling tab, a bar chart of wickets per season.

**Why it matters:** Innings lists give raw history but no sense of trajectory. "Is this player improving?" answered visually.

**Backend:** No changes — data already in `/api/players/:id/batting` and `/api/players/:id/bowling`.

**Frontend:** Two `<ResponsiveContainer>` charts in `PlayerDetail.jsx`. Cumulative runs = `.reduce()` over sorted innings.

**Effort:** S — pure frontend, ~3h.

---

## 5  Year-on-year season comparison chart  ★★★

**What:** On the Season page with no year filter, a stacked bar chart showing wins/losses per calendar year — visual club performance history.

**Why it matters:** The aggregate view obscures multi-year trends.

**Backend:** Add `per_year` array to `/api/matches/season` when no year filter active.

**Frontend:** Recharts stacked `BarChart` with wins (green) / losses (red) / other (grey) per year, above the form chart.

**Effort:** M — half day backend SQL, half day frontend.

---

## 6  Player comparison page  ★★

**What:** A `/compare?a=<id>&b=<id>` page showing two players' career stats side by side: innings, runs, avg, SR, wickets, economy. Grouped bar chart of runs per season.

**Why it matters:** Club debates about relative performance are perennial.

**Backend:** No new endpoints — reuse `/api/players/stats`.

**Frontend:** New `Compare.jsx` page. PlayerList adds a "Compare" checkbox (select up to 2, then navigate).

**Effort:** M — 1 day.

---

## 7  Toss analysis on Season page  ★★

**What:** Stats block: toss win rate, win rate batting first, win rate chasing. `toss_winner` and `toss_decision` already stored.

**Backend:** Add `toss` object to `/api/matches/season` computed from filtered fixtures.

**Frontend:** 3–4 `StatCard`s in a new "Toss" row in `Season.jsx`.

**Effort:** S — 2–3h total.

---

## 8  Opposition scorecard on match detail  ★★

**What:** Expandable "Opposition batting" section below WHCC bowling scorecard showing the full opposition batting table and WHCC's bowling figures for that innings.

**Why it matters:** Ball-by-ball data exists for both innings but only WHCC-centric view is rendered.

**Backend:** No changes — data already returned in `scorecards`.

**Frontend:** Collapsible section in `MatchDetail.jsx`, gated on `scorecards.length > 1`.

**Effort:** M — 1 day.

---

## 9  Extras breakdown on scorecard  ★★

**What:** Surface full extras breakdown: byes, leg byes, wides, no balls, bowling byes, bowling leg byes — all stored in `manual_extras`. Verify sub-types are surfaced for ball-by-ball innings too.

**Backend:** Verify all sub-types included in scorecard response for both match types.

**Frontend:** Update the extras line in `MatchDetail.jsx` to render all six fields.

**Effort:** S — audit + fix, ~2h.

---

## 10  Fielding stats on player profile  ★★

**What:** "Fielding" sub-section on PlayerDetail: catches, stumpings, run outs. These fields are returned by `/api/players/:id/batting` in `totals` but not displayed.

**Backend:** No changes.

**Frontend:** Three stat boxes in the batting totals row, shown only when at least one is non-zero.

**Effort:** XS — 20min.

---

## 11  Dismissal type summary on match scorecard  ★

**What:** Below the batting table: `Caught 4 · Bowled 2 · LBW 1 · Run out 1`. Mirrors what PlayerDetail already shows for career stats.

**Backend:** No changes — dismissal data already in the scorecard response.

**Frontend:** Derive counts from `sc.batting` in `MatchDetail.jsx`. ~15 lines.

**Effort:** XS — 1h.

---

## 12  CSV export on Season page  ★

**What:** "Export CSV" button on the Season results table, consistent with exports already on PlayerList and PlayerDetail.

**Backend:** None.

**Frontend:** Reuse `downloadCsv` from `utils/csvExport.js`. One button, ~20 lines.

**Effort:** XS — 30min.

---

## 13  Player name similarity suggestions (admin)  ★★

**What:** In the admin duplicate player flow, flag name pairs with edit distance ≤ 2 or common abbreviation patterns (e.g. "P Smith" vs "Phil Smith").

**Backend:** Add `?fuzzy=1` mode to `/api/admin/duplicate-players`. Compute Levenshtein pairs in JS from all player names.

**Frontend:** "Name conflicts" card with "Merge" button (reusing `/api/admin/merge-players`).

**Effort:** M — 1 day.

---

## 14  Ingest history expansion  ★

**What:** Expand the admin ingest history from a count to a full table: date, match link, who ingested, rows inserted. Click to see full JSON.

**Backend:** Extend `GET /api/admin/ingests` with a JOIN on `fixtures`.

**Frontend:** Proper table in `Ingest.jsx`.

**Effort:** S — half day.

---

## 15  Match sharing / OG tags  ★

**What:** "Copy link" button on MatchDetail. Open Graph meta tags so shared links preview in WhatsApp/Slack with team names and score.

**Backend:** No new endpoints. OG tags need server-side rendering or a thin proxy.

**Frontend:** Copy-to-clipboard button. Meta tags via `react-helmet-async`.

**Effort:** S — 2h.

---

## 16  Pairs format fixes  ★★

**What:**
1. Manhattan chart bars should show net score (raw − penalty), not raw
2. Season form chart should use net score for pairs matches
3. Season top-scorer card should use net score for pairs innings

**Backend:** `starting_score` and `format` already returned in all relevant responses.

**Frontend:** Three targeted fixes in `MatchDetail.jsx` and `Season.jsx`.

**Effort:** S — half day.

---

## Priority order

| # | Feature | Effort | Impact |
|---|---------|--------|--------|
| 1 | All-time records page | M | ★★★ highest-visibility new page |
| 3 | Fall of wickets | M | ★★★ obvious scorecard gap |
| 4 | Batting/bowling progression charts | S | ★★★ pure frontend, existing data |
| 5 | Year-on-year season chart | M | ★★★ fills key analytical gap |
| 2 | Opponent breakdown (Season) | S | ★���★ tactical, small effort |
| 10 | Fielding stats on profile | XS | ★★ existing data, trivial |
| 11 | Dismissal summary on scorecard | XS | ★ pattern recognition |
| 12 | CSV export on Season page | XS | ★ consistency |
| 8 | Opposition scorecard | M | ★★ completes the match view |
| 6 | Player comparison | M | ★★ fun and shareable |
| 7 | Toss analysis | S | ★★ quick tactical win |
| 16 | Pairs format fixes | S | ★★ correctness |
| 9 | Extras breakdown | S | ★�� completeness |
| 13 | Player name similarity | M | ★★ data hygiene |
| 14 | Ingest history expansion | S | ★ admin QoL |
| 15 | Match sharing / OG tags | S | ★ social |

---

## Batching suggestions

**Sprint A — Analytics (new data, new pages):** Items 1, 5, 2 — one backend PR adding new endpoints, one frontend PR adding Records page + Season enhancements.

**Sprint B — Scorecard completeness:** Items 3, 9, 11, 10, 12 — all `MatchDetail` / `PlayerDetail` additions, one PR each.

**Sprint C — Player depth:** Items 4, 6, 7 — progression charts, comparison page, toss stats.

**Sprint D — Data quality + admin:** Items 13, 14 — admin tooling.
