<div align="center">
  <img src="frontend/public/icon.svg" width="80" alt="EDGE logo" />
  <h1>EDGE</h1>
  <p><strong>Enhanced Data for Game Evolution</strong></p>
  <p>Ball-by-ball cricket statistics for Woking &amp; Horsell CC</p>
</div>

---

## Features

- **Match list** — results, top bat/bowl/MVP at a glance with icons and pairs net scores
- **Scorecard** — batting and bowling breakdown per innings with extras detail
- **Charts** — manhattan, worm, run rate, partnerships, and phase analysis (powerplay/middle/death) in a tab strip; net/raw toggle for pairs format
- **Toss & result** — coloured pill with coin/bat/ball icons; result tag per innings
- **Match flow** — ball-by-ball event log with milestones, wickets, and hauls
- **Player stats** — career batting and bowling aggregates with back-button navigation
- **Pairs format** — net score (starting score + runs − wickets×5) throughout, including match list and phase chart
- **CricHeroes MVP** — batting SR bonus, wicket value by match type, haul and maiden bonuses
- **Dark mode** — automatic via system preference, overridable

## Admin tools

- **Ingest** — drop in play-cricket PDFs and innings JSON, or re-ingest from the match detail page
- **Auto-ingest** — add a team by pasting its Play Cricket fixtures URL; fixtures are discovered daily and ingested automatically 4 hours after match start
- **Telegram notifications** — sends a match summary (teams, score, top bat, top bowl, MVP) to a Telegram chat after each auto-ingest
- **Manual entry** — full scorecard entry for matches without ball-by-ball data (standard and pairs)
- **Player merge** — detect and merge duplicate player records in one transaction
- **Ignore flag** — hide opposition players mis-attributed as WHCC from the unnamed-player panel
- **Matches missing roles** — list of ingested fixtures with no captain or wicket-keeper set
- **Delete match** — remove a fixture and all associated data (admin only, with confirmation)

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 · Vite · Recharts · Clerk |
| Backend | Express · SQLite (better-sqlite3) · Clerk |
| Auth | Clerk (upload/admin gated by `canUpload` metadata) |
| Deploy | Fly.io (`edge-whcc`, London region) |
| CI | GitHub Actions — lint + tests + coverage on every PR |

## Project structure

```
cricket-app/
├── backend/
│   ├── server.js           # Express entry point (port 3001)
│   ├── scheduler.js        # node-cron: daily fixture discovery + 30-min ingest
│   ├── .env                # Local config (gitignored — see Setup)
│   ├── db/
│   │   ├── schema.js       # SQLite schema + migrations (includes cache tables)
│   │   ├── ingest.js       # Ball-by-ball delivery ingestion
│   │   ├── ingestMatch.js  # Fetch + ingest a play-cricket match
│   │   └── htmlParser.js   # play-cricket HTML scorecard parser
│   ├── routes/
│   │   ├── matches.js      # GET /api/matches, /api/matches/:id, roles, captain, WK
│   │   ├── players.js      # GET /api/players, /api/players/:id/batting|bowling
│   │   ├── manual.js       # POST /api/manual — create/update manual fixtures
│   │   ├── ingest.js       # POST /api/ingest — PDF + JSON upload
│   │   └── admin.js        # Admin: merge players, delete match, scheduler endpoints
│   └── utils/
│       ├── cricket.js      # Shared helpers (overs↔balls conversion)
│       ├── resultsvault.js # Results Vault / play-cricket API client
│       ├── matchSummary.js # Post-ingest stat caching + Telegram message builder
│       └── notify.js       # Telegram Bot API sender
└── frontend/
    ├── vite.config.js      # Proxies /api → localhost:3001
    ├── vitest.config.js    # Coverage config (≥75% threshold)
    └── src/
        ├── pages/
        │   ├── MatchList.jsx     # Home — fixture list with scores and performers
        │   ├── MatchDetail.jsx   # Scorecard, charts, match flow, roles, MVP
        │   ├── PlayerList.jsx    # All WHCC players with career aggregates
        │   ├── PlayerDetail.jsx  # Single player batting + bowling history
        │   ├── ManualEntry.jsx   # Manual match creation and score entry
        │   └── Ingest.jsx        # Admin panel (upload, merge, unnamed players)
        ├── hooks/
        │   └── useApiFetch.js    # Clerk-authenticated fetch wrapper
        └── utils/
            └── cricket.js        # Date, score, result-phrase, display-name helpers
```

## Setup

Requires **Node 22+**.

### Backend

```bash
cd backend
npm ci
npm run dev     # http://localhost:3001
```

### Frontend

```bash
cd frontend
npm ci
npm run dev     # http://localhost:5173
```

Set your Clerk publishable key in `frontend/.env.local`:

```
VITE_CLERK_PUBLISHABLE_KEY=pk_...
```

Backend environment variables live in `backend/.env` (gitignored). Copy the template and fill in values:

```
PORT=3001
CLERK_SECRET_KEY=sk_...

# Auto-ingest scheduler
AUTO_INGEST_ENABLED=true
AUTO_INGEST_DELAY_HOURS=4

# Telegram notifications (leave blank to disable)
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=-100123456789
```

To get Telegram credentials: message **@BotFather** → `/newbot` to get the token; add the bot to your group/channel then call `https://api.telegram.org/bot<TOKEN>/getUpdates` to get the chat ID. On Fly.io use `fly secrets set TELEGRAM_BOT_TOKEN=... TELEGRAM_CHAT_ID=...` instead of the `.env` file.

## Running tests

```bash
# Frontend (Vitest — covers src/utils/cricket.js)
cd frontend
npm test                # run once
npm run test:coverage   # with coverage report (≥75% enforced)

# Backend (Jest — covers utils/cricket.js)
cd backend
npm test
npm run test:coverage
```

## Uploading data

**Ball-by-ball (play-cricket):**
1. Go to `/ingest` in the app
2. Paste a play-cricket result URL and click **Fetch from play-cricket**, or drop in a PDF scorecard and innings JSON files
3. Review and set captain / wicket-keeper on the match detail page

**Manual entry (no ball-by-ball):**
1. Go to `/ingest` → **Manual entry**
2. Fill in match details (format: Standard or Pairs)
3. Enter batting and bowling scorecards

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/matches` | All fixtures with MVP/top performers |
| GET | `/api/matches/:id` | Scorecard, flow, phases, roles, MVP for one match |
| GET | `/api/matches/:id/roles` | Captain, WK stints, and player lists |
| PUT | `/api/matches/:id/captain` | Set/update captain for an innings |
| POST | `/api/matches/:id/wk` | Add a WK stint |
| PATCH | `/api/matches/:id/wk/:id` | Update WK stint end over |
| DELETE | `/api/matches/:id/wk/:id` | Remove a WK stint |
| GET | `/api/players` | All WHCC players with career aggregates |
| GET | `/api/players/:id/batting` | Career batting breakdown |
| GET | `/api/players/:id/bowling` | Career bowling breakdown |
| POST | `/api/ingest` | Ingest PDF + innings JSON files |
| POST | `/api/admin/fetch-match` | Re-ingest a match from play-cricket by URL |
| DELETE | `/api/admin/match/:id` | Delete a fixture and all associated data |
| POST | `/api/admin/merge-players` | Merge two player records |
| GET | `/api/admin/duplicate-players` | Groups of players sharing the same name |
| GET | `/api/admin/matches-missing-roles` | Fixtures missing captain or WK |
| POST | `/api/manual/fixture` | Create a manual fixture |
| GET | `/api/manual/entry/:id` | Fetch manual entry data |
| POST | `/api/manual/entry/:id` | Save manual batting/bowling/extras |
| GET | `/api/health` | Health check |

---

<sub>Bat icon by <a href="https://www.flaticon.com/free-icons/bat">Kiranshastry – Flaticon</a></sub>
