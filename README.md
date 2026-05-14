<div align="center">
  <img src="frontend/public/icon.svg" width="80" alt="EDGE logo" />
  <h1>EDGE</h1>
  <p><strong>Enhanced Data for Game Evolution</strong></p>
  <p>Ball-by-ball cricket statistics for Woking &amp; Horsell CC</p>
</div>

---

## Features

- **Match list** — results, top bat/bowl/MVP at a glance with icons
- **Scorecard** — batting and bowling breakdown per innings
- **Worm chart** — run progression by over; net/raw toggle for pairs format
- **Match flow** — ball-by-ball event log with milestones, wickets, and hauls
- **Player stats** — career batting and bowling aggregates
- **Pairs format** — net score (runs − wickets×5) throughout
- **CricHeroes MVP** — batting SR bonus, wicket value by match type, haul and maiden bonuses
- **Dark mode** — automatic via system preference

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 · Vite · Recharts · Clerk |
| Backend | Express · SQLite (better-sqlite3) · Clerk |
| Auth | Clerk (signed-in only) |
| CI | GitHub Actions — tests + coverage (≥70%) on every PR |

## Project structure

```
cricket-app/
├── backend/
│   ├── server.js           # Express entry point (port 3001)
│   ├── routes/
│   │   ├── matches.js      # GET /api/matches, /api/matches/:id
│   │   ├── players.js      # GET /api/players, /api/players/:id
│   │   ├── ingest.js       # POST /api/ingest
│   │   ├── manual.js       # POST /api/manual
│   │   └── admin.js        # Admin utilities
│   └── utils/
│       ├── cricket.js      # Shared helpers (overs, balls)
│       └── resultsvault.js # Results Vault API client
└── frontend/
    ├── vite.config.js      # Proxies /api → localhost:3001
    ├── vitest.config.js    # Coverage config (≥70% threshold)
    └── src/
        ├── pages/
        │   ├── MatchList.jsx
        │   ├── MatchDetail.jsx
        │   ├── PlayerList.jsx
        │   └── PlayerDetail.jsx
        └── utils/
            └── cricket.js  # Date, score, result-phrase helpers
```

## Setup

Requires Node 22+.

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

Set your Clerk key in `frontend/.env.local`:

```
VITE_CLERK_PUBLISHABLE_KEY=pk_...
```

## Uploading data

1. Go to `/ingest` in the app
2. Drop in a **PDF scorecard** from play-cricket and **innings JSON files** (one per innings)
3. Click **Import**

Or use **Manual entry** for matches without ball-by-ball data.

## Running tests

```bash
# Frontend (Vitest)
cd frontend
npm test                # run once
npm run test:coverage   # with coverage report (≥70% enforced)

# Backend (Jest)
cd backend
npm test
npm run test:coverage
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/matches` | All fixtures with MVP/top performers |
| GET | `/api/matches/:id` | Scorecard, flow, roles, MVP for one match |
| GET | `/api/players` | All WHCC players |
| GET | `/api/players/:id/batting` | Career batting stats |
| GET | `/api/players/:id/bowling` | Career bowling stats |
| POST | `/api/ingest` | Ingest PDF + JSON innings files |
| POST | `/api/manual` | Create/update a manual match entry |
| GET | `/api/health` | Health check |

---

<sub>Bat icon by <a href="https://www.flaticon.com/free-icons/bat">Kiranshastry – Flaticon</a></sub>
