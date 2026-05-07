# Cricket Stats App

Ball-by-ball cricket statistics — backend API + SQLite + React frontend.

## Project structure

```
cricket-app/
├── backend/
│   ├── server.js          # Express entry point (port 3001)
│   ├── package.json
│   ├── db/
│   │   ├── schema.js      # SQLite init (better-sqlite3)
│   │   ├── ingest.js      # Parse & store innings JSON
│   │   └── pdfParser.js   # Extract match metadata from play-cricket PDF
│   └── routes/
│       ├── ingest.js      # POST /api/ingest
│       ├── matches.js     # GET /api/matches, /api/matches/:id
│       └── players.js     # GET /api/players, /api/players/:id/batting|bowling
└── frontend/
    ├── vite.config.js     # Proxies /api → localhost:3001
    ├── package.json
    └── src/
        ├── App.jsx
        ├── index.css
        ├── main.jsx
        └── pages/
            ├── Ingest.jsx      # Drag-and-drop upload
            ├── MatchList.jsx   # All matches
            ├── MatchDetail.jsx # Scorecard: batting / bowling / overs tabs
            ├── PlayerList.jsx
            └── PlayerDetail.jsx # Career batting + bowling stats
```

## Setup

### Backend

```bash
cd backend
npm install
npm run dev     # starts on http://localhost:3001
```

### Frontend

```bash
cd frontend
npm install
npm run dev     # starts on http://localhost:5173
```

## Uploading data

1. Open http://localhost:5173/ingest (or click "Upload" in the nav)
2. Drop in:
   - **PDF scorecard** from play-cricket (e.g. `https://whcc.play-cricket.com/website/results/6933990/print`)
   - **One or more innings JSON files** (the ball-by-ball data — one file per innings)
3. Click "Import data"

The PDF is optional but recommended — it adds team names, ground, date, competition, and result.

## Database

SQLite file is created at `backend/cricket.db` on first run. Tables:

| Table | Purpose |
|-------|---------|
| `matches` | One row per match — metadata from PDF |
| `players` | Player IDs and names (extracted from `l_desc`) |
| `deliveries` | Every ball: over, ball, batter, bowler, runs, extras, wicket |

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ingest` | Upload PDF + JSON files |
| GET | `/api/matches` | List all matches |
| GET | `/api/matches/:id` | Scorecard for one match |
| GET | `/api/players` | List all players |
| GET | `/api/players/:id/batting` | Career batting stats |
| GET | `/api/players/:id/bowling` | Career bowling stats |
| GET | `/api/health` | Health check |

## Extras type codes

| Code | Type |
|------|------|
| 1 | No ball |
| 2 | Wide |
| 3 | Bye |
| 4 | Leg bye |
