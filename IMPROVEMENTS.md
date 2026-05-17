# EDGE — Improvement backlog

Rough priority order. Each item is self-contained enough to be its own PR.

---

## 1. Player profile enrichment

- **Batting position** — derive typical position (opener, middle order, tail) from historical delivery data; show on PlayerDetail
- **Head-to-head** — on PlayerDetail, show stats broken down by opponent
- **Recent form** — last 5 match sparkline (runs / wickets) on PlayerList cards

---

## 2. Match data quality signals

- **Data quality badge** on match cards when captain/WK is unset, or extras look anomalous (e.g. 80+ wides)
- **Innings completeness flag** — warn when ball count doesn't match overs (gaps in ingested delivery data)

---

## 3. Season / competition filtering

- Dropdown on match list to filter by season year or competition name
- Player stats page gains a season filter (e.g. "2025 season only")
- Competition field already stored in `fixtures.competition`; season derivable from `match_date`

---

## 4. Batting partnership network

- Across a season, which pairs have batted together most / scored most — ranked table or network graph on the Players page
- Data already available in the `partnerships` query used by the match detail chart

---

## 5. Team-level season summary page

- New `/season` route: win/loss, NRR, batting average, bowling average, top scorer, top wicket-taker, MVP leaderboard
- Could also expose a season comparison view (2024 vs 2025)

---

## 6. Fly.io → GitHub Deployments

- Add a `deploy` job to `.github/workflows/ci.yml` with `environment: production` and `url: https://edge-whcc.fly.dev`
- Run `flyctl deploy --remote-only` inside it using `FLY_API_TOKEN` secret
- Disable Fly's own auto-deploy so GitHub Actions drives it
- Every merge to main then gets a tracked deployment record visible on PRs and the repo Environments tab

---

## 7. Expanded test coverage

- **Backend route integration tests** — use an in-memory SQLite seed to test `/api/matches`, `/api/players`, `/api/admin` endpoints end-to-end; currently only `utils/cricket.js` is covered
- **E2E additions** — match detail smoke test covering: charts tab switching, WK assignment flow, manual entry round-trip, delete match confirmation
