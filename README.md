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
│   │   ├── matches.js        # GET /api/matches, /api/matches/:id, roles, captain, WK
│   │   ├── players.js        # GET /api/players, /api/players/:id/batting|bowling
│   │   ├── manual.js         # POST /api/manual — create/update manual fixtures
│   │   ├── ingest.js         # POST /api/ingest — PDF + JSON upload
│   │   ├── admin.js          # Admin: merge, delete, scheduler, user management
│   │   └── accessRequests.js # Access-request flow for scoped (team) users
│   └── utils/
│       ├── cricket.js        # Shared helpers (overs↔balls conversion)
│       ├── scorecard.js      # Batting/bowling/flow scorecard builders
│       ├── matchFlow.js      # Ball-by-ball event stream builder
│       ├── mvp.js            # MVP point computation
│       ├── resultsvault.js   # ResultsVault / play-cricket API client
│       ├── matchSummary.js   # Post-ingest stat caching + Telegram message builder
│       ├── db.js             # WHCC identity helpers shared across routes
│       └── notify.js         # Telegram Bot API sender
└── frontend/
    ├── vite.config.js        # Proxies /api → localhost:3001; chunk splitting
    ├── vitest.config.js      # Coverage config (≥70% threshold)
    └── src/
        ├── pages/
        │   ├── MatchList.jsx     # Home — fixture list with scores and performers
        │   ├── MatchDetail.jsx   # Scorecard, charts, match flow, roles, MVP
        │   ├── PlayerList.jsx    # All WHCC players with career aggregates + partnerships
        │   ├── PlayerDetail.jsx  # Single player batting + bowling history
        │   ├── Season.jsx        # Season aggregate view
        │   ├── Admin.jsx         # Tabbed admin panel (Ingest/Manual/Scheduler/Data/System/Users)
        │   ├── ManualEntry.jsx   # Manual match creation and score entry
        │   ├── BallEntry.jsx     # Ball-by-ball entry for manual fixtures
        │   └── UserAdmin.jsx     # User access management (club admin / super-admin)
        ├── components/
        │   ├── MatchFlow.jsx     # Match flow event log component
        │   ├── InningsRoles.jsx  # Captain/WK stint editor
        │   ├── ScorecardTables.jsx # Batting, bowling, overs grid tables
        │   └── MatchEditors.jsx  # Result, delivery, and pair-block editors
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

Backend environment variables live in `backend/.env` (gitignored). Copy `backend/.env.example` and fill in values:

```
PORT=3001
NODE_ENV=development
CLERK_SECRET_KEY=sk_...

# ResultsVault / play-cricket API (required for auto-ingest)
RV_SHARED_SECRET=...
RV_ENTITY_ID=...
RV_API_ID=...

# cron-job.org (required for scheduled ingestion)
CRON_JOB_ORG_API_KEY=...
APP_BASE_URL=https://edge.phillprice.com   # used for cron-job.org callbacks

# CORS — comma-separated allowed origins (defaults to localhost:5173)
CORS_ORIGINS=http://localhost:5173,https://edge.phillprice.com

# Telegram notifications (leave blank to disable)
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=-100123456789
```

On Fly.io use `fly secrets set KEY=value` instead of `.env`. To get Telegram credentials: message **@BotFather** → `/newbot` for the token; add the bot to your group then call `https://api.telegram.org/bot<TOKEN>/getUpdates` for the chat ID.

## Auth model

Access is controlled by Clerk `publicMetadata` flags on each user:

| Flag | Role | Can do |
|------|------|--------|
| `isSuperAdmin: true` | Super-admin | Everything: export/import DB, delete matches, manage all users |
| `isClubAdmin: true` | Club admin | Manage user access requests for their teams |
| `canUpload: true` | Data entry | Ingest matches, manual entry, scheduler |
| `accessGroups: [{team_id, season_id}]` | Viewer | See matches/players for their specific team(s)/season(s) |

Users with no flags see nothing and are prompted to request access. Super-admins see everything regardless of `accessGroups`.

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
1. Go to **Admin → Ingest** in the app
2. Paste a play-cricket result URL and click **Fetch from play-cricket**, or drop in a PDF scorecard and innings JSON files
3. Review and set captain / wicket-keeper on the match detail page

**Auto-ingest (Admin → Scheduler):**
1. Paste a play-cricket fixtures URL for a team/season and click **Add**
2. Fixtures are discovered daily; past-due matches appear in **Past matches — pending ingest**
3. Click **Ingest** on individual matches, or **Ingest now** to process all pending

**Manual entry (no ball-by-ball):**
1. Go to **Admin → Manual**
2. Fill in match details (format: Standard or Pairs) and click **New match**
3. Enter batting and bowling scorecards, or use **Ball entry** for ball-by-ball data

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
