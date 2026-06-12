import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { X, Download, PenTool, Clock, Database, Settings, Users } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'
import { shortTeam, formatDateShort } from '../utils/cricket'
import UserAdmin from './UserAdmin'

// ── Tab bar ───────────────────────────────────────────────────────────────────

const BASE_TABS = [
  { id: 'ingest', label: 'Ingest', icon: Download },
  { id: 'manual', label: 'Manual', icon: PenTool },
  { id: 'scheduler', label: 'Scheduler', icon: Clock },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'system', label: 'System', icon: Settings },
]

export default function Admin() {
  const [tab, setTab] = useState('ingest')
  const { user } = useUser()
  const canAdmin =
    user?.publicMetadata?.isSuperAdmin === true || user?.publicMetadata?.isClubAdmin === true
  const TABS = canAdmin ? [...BASE_TABS, { id: 'users', label: 'Users', icon: Users }] : BASE_TABS

  return (
    <div className="page">
      <h1 style={{ marginBottom: '1rem' }}>Admin</h1>

      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '2px solid var(--border)',
          marginBottom: '1.5rem',
        }}
      >
        {TABS.map((t) => {
          const IconComponent = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="secondary"
              style={{
                borderRadius: 0,
                border: 'none',
                borderBottom: tab === t.id ? '2px solid var(--hotpink)' : '2px solid transparent',
                marginBottom: -2,
                fontWeight: tab === t.id ? 600 : 400,
                color: tab === t.id ? 'var(--hotpink)' : 'var(--text2)',
                padding: '0.5rem 1.1rem',
                background: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <IconComponent size={16} />
              {t.label}
            </button>
          )
        })}
      </div>

      {tab === 'ingest' && <IngestTab />}
      {tab === 'manual' && <ManualTab />}
      {tab === 'scheduler' && <SchedulerTab />}
      {tab === 'data' && <DataTab />}
      {tab === 'system' && <SystemTab />}
      {tab === 'users' && canAdmin && <UserAdmin />}
    </div>
  )
}

// ── Ingest tab ────────────────────────────────────────────────────────────────

function IngestTab() {
  return (
    <>
      <FetchPanel />
      <UploadPanel />
    </>
  )
}

function FetchPanel() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const apiFetch = useApiFetch()

  async function submit(e) {
    e.preventDefault()
    if (!url.trim()) return
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const res = await apiFetch('/api/admin/fetch-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Fetch failed')
      setResult(data)
      setUrl('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Fetch from play-cricket</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '0.75rem' }}>
        Paste a play-cricket results URL — the match will be fetched and imported automatically.
      </p>
      <form onSubmit={submit} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <input
          type="url"
          placeholder="https://whcc.play-cricket.com/website/results/7449428"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            setResult(null)
            setError(null)
          }}
          style={{ flex: 1, minWidth: '280px' }}
        />
        <button type="submit" disabled={loading || !url.trim()}>
          {loading ? 'Fetching…' : 'Import'}
        </button>
      </form>
      {result && (
        <div className="alert alert-success" style={{ marginTop: '0.75rem' }}>
          <strong>Imported!</strong>
          {result.matchMeta && (
            <span style={{ marginLeft: 6 }}>
              {result.matchMeta.homeTeam} vs {result.matchMeta.awayTeam} —{' '}
              {result.matchMeta.matchDate}
            </span>
          )}
          {result.results.map((r) => (
            <div key={r.resultId} style={{ fontSize: '0.83rem', marginTop: 3 }}>
              Innings {r.inningsOrder}: {r.deliveries} deliveries · {r.players} players
            </div>
          ))}
          <div style={{ marginTop: 6 }}>
            <a href="/" style={{ color: '#2e7d32', fontWeight: 500, fontSize: '0.85rem' }}>
              View matches →
            </a>
          </div>
        </div>
      )}
      {error && (
        <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  )
}

function UploadPanel() {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [duplicate, setDuplicate] = useState(null)
  const inputRef = useRef()
  const apiFetch = useApiFetch()

  function handleFiles(incoming) {
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name))
      const next = [...prev]
      for (const f of incoming) if (!names.has(f.name)) next.push(f)
      return next
    })
    setResult(null)
    setError(null)
    setDuplicate(null)
  }

  function onDrop(e) {
    e.preventDefault()
    handleFiles([...e.dataTransfer.files])
  }
  function removeFile(name) {
    setFiles((f) => f.filter((x) => x.name !== name))
  }

  async function submit(overwrite = false) {
    if (!files.length) return
    setLoading(true)
    setError(null)
    setResult(null)
    setDuplicate(null)
    try {
      const fd = new FormData()
      files.forEach((f) => fd.append('files', f))
      const url = overwrite ? '/api/ingest?overwrite=true' : '/api/ingest'
      const res = await apiFetch(url, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      if (data.alreadyExists) {
        setDuplicate(data)
        return
      }
      setResult(data)
      setFiles([])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const htmls = files.filter((f) => f.name.toLowerCase().endsWith('.html'))
  const jsons = files.filter((f) => f.name.toLowerCase().endsWith('.json'))

  return (
    <div className="card">
      <p style={{ marginBottom: '1rem', color: 'var(--text2)', fontSize: '0.9rem' }}>
        Upload the <strong>print.html scorecard</strong> and one or more{' '}
        <strong>innings JSON files</strong>. Re-uploading the same match is safe — it updates
        without creating duplicates.
      </p>
      <div
        className={`drop-zone ${files.length ? 'active' : ''}`}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => inputRef.current.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".html,.json"
          onChange={(e) => handleFiles([...e.target.files])}
        />
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📂</div>
        <div>Drag & drop files here, or click to browse</div>
        <div style={{ fontSize: '0.8rem', marginTop: '4px' }}>
          print.html scorecard + innings JSON files
        </div>
      </div>

      {files.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {htmls.map((f) => (
              <FileRow key={f.name} file={f} type="HTML" onRemove={removeFile} />
            ))}
            {jsons.map((f) => (
              <FileRow key={f.name} file={f} type="JSON" onRemove={removeFile} />
            ))}
          </div>
          {jsons.length === 0 && (
            <p style={{ color: 'var(--orange)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
              Add at least one innings JSON file.
            </p>
          )}
          <button
            disabled={loading || jsons.length === 0}
            onClick={() => submit(false)}
            style={{ marginTop: '1rem' }}
          >
            {loading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      )}

      {duplicate && (
        <div className="alert alert-error" style={{ marginTop: '1rem' }}>
          <strong>Already exists.</strong> This match has already been ingested.
          <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
            <button onClick={() => submit(true)}>Overwrite</button>
            <button className="secondary" onClick={() => setDuplicate(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="alert alert-success" style={{ marginTop: '1rem' }}>
          <strong>Uploaded!</strong>
          {result.matchMeta && (
            <div style={{ marginTop: '6px', fontSize: '0.85rem' }}>
              Match: {result.matchMeta.homeTeam} vs {result.matchMeta.awayTeam} —{' '}
              {result.matchMeta.matchDate}
            </div>
          )}
          <div style={{ marginTop: '8px' }}>
            <a href="/" style={{ color: '#2e7d32', fontWeight: 500, fontSize: '0.85rem' }}>
              View matches →
            </a>
          </div>
        </div>
      )}

      {error && (
        <div className="alert alert-error" style={{ marginTop: '1rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  )
}

// ── Manual tab ────────────────────────────────────────────────────────────────

function ManualTab() {
  const [matches, setMatches] = useState(null)
  const navigate = useNavigate()
  const apiFetch = useApiFetch()

  useEffect(() => {
    apiFetch('/api/admin/manual-matches')
      .then((r) => r.json())
      .then(setMatches)
      .catch(() => setMatches([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
        }}
      >
        <p style={{ color: 'var(--text2)', fontSize: '0.88rem' }}>
          Manually-entered match scorecards.
        </p>
        <button onClick={() => navigate('/manual')}>+ New match</button>
      </div>

      {!matches && <div className="loading">Loading…</div>}
      {matches && matches.length === 0 && <div className="empty">No manual matches yet.</div>}
      {matches && matches.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ fontSize: '0.85rem', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Date</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Match</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Competition</th>
                <th style={{ textAlign: 'center', padding: '8px 12px' }}>Batting rows</th>
                <th style={{ textAlign: 'center', padding: '8px 12px' }}>Bowling rows</th>
                <th style={{ padding: '8px 12px' }}></th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.fixture_id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '7px 12px', whiteSpace: 'nowrap', color: 'var(--text2)' }}>
                    {formatDateShort(m.match_date_iso) ?? '—'}
                  </td>
                  <td style={{ padding: '7px 12px' }}>
                    {shortTeam(m.home_team)} vs {shortTeam(m.away_team)}
                  </td>
                  <td style={{ padding: '7px 12px', color: 'var(--text2)' }}>
                    {m.competition || '—'}
                  </td>
                  <td style={{ padding: '7px 12px', textAlign: 'center' }}>{m.bat_rows}</td>
                  <td style={{ padding: '7px 12px', textAlign: 'center' }}>{m.bowl_rows}</td>
                  <td style={{ padding: '7px 12px', display: 'flex', gap: 6 }}>
                    <button
                      className="secondary"
                      style={{ fontSize: '0.78rem', padding: '2px 10px' }}
                      onClick={() => navigate(`/match/${m.fixture_id}`)}
                    >
                      View
                    </button>
                    <button
                      className="secondary"
                      style={{ fontSize: '0.78rem', padding: '2px 10px' }}
                      onClick={() => navigate(`/manual/${m.fixture_id}`)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Scheduler tab ─────────────────────────────────────────────────────────────

function SchedulerTab() {
  return (
    <>
      <AutoIngestPanel />
      <CronJobsPanel />
      <StaleFixturesPanel />
    </>
  )
}

function IngestNowButton() {
  const [state, setState] = useState('idle') // idle | running | done | error
  const apiFetch = useApiFetch()

  async function run() {
    setState('running')
    try {
      const res = await apiFetch('/api/admin/scheduler/process-now', { method: 'POST' })
      if (!res.ok) throw new Error('Failed')
      setState('done')
      setTimeout(() => setState('idle'), 4000)
    } catch {
      setState('error')
      setTimeout(() => setState('idle'), 4000)
    }
  }

  return (
    <button
      className="secondary"
      style={{ fontSize: '0.82rem' }}
      disabled={state === 'running'}
      onClick={run}
    >
      {state === 'running'
        ? 'Starting…'
        : state === 'done'
          ? 'Ingesting ✓'
          : state === 'error'
            ? 'Error'
            : 'Ingest now'}
    </button>
  )
}

// ── Data tab ──────────────────────────────────────────────────────────────────

function DataTab() {
  return (
    <>
      <ReIngestRetiredPanel />
      <UnnamedPanel />
      <MissingTeamPanel />
      <MissingRolesPanel />
      <MergePanel />
    </>
  )
}

function ReIngestRetiredPanel() {
  const [candidates, setCandidates] = useState(null)
  const [sel, setSel] = useState(new Set())
  const [state, setState] = useState('idle') // idle | running | done | error
  const [msg, setMsg] = useState(null)
  const apiFetch = useApiFetch()

  useEffect(() => {
    apiFetch('/api/admin/scheduler/reingest-candidates')
      .then((r) => r.json())
      .then((d) => {
        setCandidates(Array.isArray(d) ? d : [])
        setSel(new Set((Array.isArray(d) ? d : []).map((c) => c.fixture_id)))
      })
      .catch(() => setCandidates([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!candidates || candidates.length === 0) return null

  async function reingest() {
    setState('running')
    setMsg(null)
    try {
      const res = await apiFetch('/api/admin/scheduler/reingest-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...sel] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setMsg({
        ok: true,
        text: `${data.queued} fixture${data.queued === 1 ? '' : 's'} queued for re-ingest. Ingesting now…`,
      })
      setState('done')
      setCandidates((c) => c.filter((x) => !sel.has(x.fixture_id)))
      setSel(new Set())
    } catch (e) {
      setMsg({ ok: false, text: e.message })
      setState('idle')
    }
  }

  function toggleAll() {
    setSel((s) =>
      s.size === candidates.length ? new Set() : new Set(candidates.map((c) => c.fixture_id))
    )
  }

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Re-ingest for retired-not-out fix</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
        These {candidates.length} matches were ingested before the retired-not-out fix (v5.6.4) and
        may have missed retirement data. Re-ingesting will fetch the latest PDF scorecard and update
        the scorecard and match flow if any batter retired not out.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: '0.75rem', alignItems: 'center' }}>
        <button
          className="secondary"
          style={{ fontSize: '0.78rem', padding: '2px 10px' }}
          onClick={toggleAll}
        >
          {sel.size === candidates.length ? 'Deselect all' : 'Select all'}
        </button>
        <button
          disabled={!sel.size || state === 'running'}
          onClick={reingest}
          style={{ fontSize: '0.78rem', padding: '2px 10px' }}
        >
          {state === 'running' ? 'Queueing…' : `Re-ingest ${sel.size} selected`}
        </button>
      </div>
      {msg && (
        <p
          style={{
            fontSize: '0.82rem',
            color: msg.ok ? 'var(--green)' : 'var(--red)',
            marginBottom: '0.5rem',
          }}
        >
          {msg.text}
        </p>
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.35rem',
          maxHeight: 280,
          overflowY: 'auto',
        }}
      >
        {candidates.map((c) => {
          const checked = sel.has(c.fixture_id)
          return (
            <label
              key={c.fixture_id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '0.82rem',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  setSel((s) => {
                    const n = new Set(s)
                    checked ? n.delete(c.fixture_id) : n.add(c.fixture_id)
                    return n
                  })
                }
              />
              <span style={{ color: 'var(--text3)', minWidth: 70 }}>{c.fixture_id}</span>
              <span style={{ flex: 1 }}>
                {shortTeam(c.home_team)} vs {shortTeam(c.away_team)}
              </span>
              <span style={{ color: 'var(--text3)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                {formatDateShort(c.match_date_iso)}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

// ── System tab ────────────────────────────────────────────────────────────────

function SystemTab() {
  return <BackupPanel />
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function FileRow({ file, type, onRemove }) {
  const colours = { HTML: 'tag-green', JSON: 'tag-blue' }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.88rem' }}>
      <span className={`tag ${colours[type] || 'tag-blue'}`}>{type}</span>
      <span style={{ flex: 1 }}>{file.name}</span>
      <span className="muted">{(file.size / 1024).toFixed(0)} KB</span>
      <button
        className="secondary"
        style={{ padding: '2px 8px', fontSize: '0.8rem' }}
        onClick={() => onRemove(file.name)}
      >
        <X size={12} />
      </button>
    </div>
  )
}

function PlayerSearch({ label, players, selected, onSelect, exclude }) {
  const [query, setQuery] = useState('')
  const selectedPlayer = selected != null ? players.find((p) => p.player_id === selected) : null
  const filtered =
    query.length < 2
      ? []
      : players
          .filter((p) => p.player_id !== exclude)
          .filter((p) => {
            const q = query.toLowerCase()
            const name = (p.display_name || p.name || '').toLowerCase()
            return name.includes(q) || String(p.player_id).includes(q)
          })
          .slice(0, 8)

  return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: 4, color: 'var(--text2)' }}>
        {label}
      </div>
      {selectedPlayer ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 8px',
            background: 'var(--bg2)',
            borderRadius: 4,
            border: '1px solid var(--border)',
          }}
        >
          <span style={{ flex: 1, fontSize: '0.88rem' }}>
            {selectedPlayer.display_name || selectedPlayer.name}
            <span style={{ color: 'var(--text3)', fontSize: '0.78rem' }}>
              {' '}
              #{selectedPlayer.player_id}
            </span>
          </span>
          <button
            className="secondary"
            style={{ padding: '1px 7px', fontSize: '0.8rem' }}
            onClick={() => onSelect(null)}
          >
            ×
          </button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            placeholder="Search name or ID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: '100%' }}
          />
          {filtered.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                zIndex: 10,
                maxHeight: 200,
                overflowY: 'auto',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              }}
            >
              {filtered.map((p) => (
                <div
                  key={p.player_id}
                  onClick={() => {
                    onSelect(p.player_id)
                    setQuery('')
                  }}
                  style={{ padding: '6px 10px', cursor: 'pointer', fontSize: '0.85rem' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg2)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                >
                  {p.display_name || p.name}
                  <span style={{ color: 'var(--text3)', fontSize: '0.78rem' }}>
                    {' '}
                    #{p.player_id} · {p.team || '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Panel components (Scheduler tab) ─────────────────────────────────────────

function FilterPills({ label, options, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.78rem', color: 'var(--text2)', marginRight: 2 }}>{label}</span>
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? 'pill active' : 'pill'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function SortTh({ col, label, sortCol, sortDir, onSort, style }) {
  const active = sortCol === col
  return (
    <th onClick={() => onSort(col)} style={{ cursor: 'pointer', userSelect: 'none', ...style }}>
      {label}
      {active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  )
}

function AutoIngestPanel() {
  const [status, setStatus] = useState(null)
  const [urlInput, setUrlInput] = useState('')
  const [adding, setAdding] = useState(false)
  const [addMsg, setAddMsg] = useState(null)
  const [runMsg, setRunMsg] = useState(null)
  const [running, setRunning] = useState(false)
  const [rescanning, setRescanning] = useState(false)
  const [rescanMsg, setRescanMsg] = useState(null)
  const [filterTeam, setFilterTeam] = useState('all')
  const [sortCol, setSortCol] = useState('date')
  const [sortDir, setSortDir] = useState('desc')
  const apiFetch = useApiFetch()

  function loadStatus() {
    apiFetch('/api/admin/scheduler/status')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {})
  }

  useEffect(() => {
    loadStatus()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function addTeam(e) {
    e.preventDefault()
    if (!urlInput.trim()) return
    setAdding(true)
    setAddMsg(null)
    try {
      const res = await apiFetch('/api/admin/scheduler/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add team')
      const label = data.resolved?.[0]?.label || 'team'
      setAddMsg({ ok: true, text: `Added ${label}` })
      setUrlInput('')
      loadStatus()
    } catch (e) {
      setAddMsg({ ok: false, text: e.message })
    }
    setAdding(false)
  }

  async function removeTeam(id) {
    try {
      const res = await apiFetch(`/api/admin/scheduler/teams/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      loadStatus()
    } catch (e) {
      setAddMsg({ ok: false, text: e.message })
    }
  }

  async function run(endpoint) {
    setRunning(true)
    setRunMsg(null)
    try {
      await apiFetch(`/api/admin/scheduler/${endpoint}`, { method: 'POST' })
      setRunMsg({ ok: true, text: 'Done — check results in the cron jobs panel.' })
      loadStatus()
    } catch {
      setRunMsg({ ok: false, text: 'Failed' })
    }
    setRunning(false)
  }

  async function rescan() {
    setRescanning(true)
    setRescanMsg(null)
    try {
      const res = await apiFetch('/api/admin/scheduler/rescan', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setRescanMsg({ ok: true, text: `Queued ${data.queued ?? 0} new fixture(s).` })
      loadStatus()
    } catch (e) {
      setRescanMsg({ ok: false, text: e.message })
    }
    setRescanning(false)
  }

  function onSort(col) {
    setSortDir((d) => (sortCol === col ? (d === 'asc' ? 'desc' : 'asc') : 'desc'))
    setSortCol(col)
  }

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: '1rem',
        }}
      >
        <h3 style={{ margin: 0 }}>Auto-ingest</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="secondary"
            style={{ fontSize: '0.82rem' }}
            disabled={running}
            onClick={() => run('discover')}
          >
            {running ? 'Running…' : 'Discover fixtures'}
          </button>
          <button
            className="secondary"
            style={{ fontSize: '0.82rem' }}
            disabled={rescanning}
            onClick={rescan}
          >
            {rescanning ? 'Rescanning…' : 'Re-scan past seasons'}
          </button>
          <IngestNowButton />
        </div>
      </div>

      {runMsg && (
        <p
          style={{
            fontSize: '0.82rem',
            color: runMsg.ok ? 'var(--green)' : 'var(--red)',
            marginBottom: '0.5rem',
          }}
        >
          {runMsg.text}
        </p>
      )}
      {rescanMsg && (
        <p
          style={{
            fontSize: '0.82rem',
            color: rescanMsg.ok ? 'var(--green)' : 'var(--red)',
            marginBottom: '0.5rem',
          }}
        >
          {rescanMsg.text}
        </p>
      )}

      <form
        onSubmit={addTeam}
        style={{ display: 'flex', gap: '8px', marginBottom: '1.25rem', flexWrap: 'wrap' }}
      >
        <input
          type="url"
          placeholder="https://whcc.play-cricket.com/Matches?…&team_id=35533&…"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          style={{ flex: 1, minWidth: '280px' }}
        />
        <button
          type="submit"
          disabled={adding || !urlInput.trim()}
          style={{ whiteSpace: 'nowrap' }}
        >
          {adding ? 'Adding…' : 'Add team'}
        </button>
      </form>
      {addMsg && (
        <p
          style={{
            fontSize: '0.82rem',
            color: addMsg.ok ? 'var(--green)' : 'var(--red)',
            marginBottom: '0.75rem',
          }}
        >
          {addMsg.text}
        </p>
      )}

      {status &&
        status.teams.length > 0 &&
        (() => {
          // Build per-team stats lookup from byTeam (status counts + last_match_date per team/season/status)
          const statsMap = {}
          for (const b of status.byTeam || []) {
            const key = `${b.team_id}:${b.season_id}`
            if (!statsMap[key])
              statsMap[key] = { pending: 0, done: 0, failed: 0, last_match_date: null }
            statsMap[key][b.status] = (statsMap[key][b.status] || 0) + b.n
            if (
              b.last_match_date &&
              (!statsMap[key].last_match_date || b.last_match_date > statsMap[key].last_match_date)
            ) {
              statsMap[key].last_match_date = b.last_match_date
            }
          }
          const enrichedTeams = status.teams.map((t) => ({
            ...t,
            ...statsMap[`${t.team_id}:${t.season_id}`],
          }))

          const grouped = {}
          for (const t of enrichedTeams) {
            if (!grouped[t.team_id])
              grouped[t.team_id] = { label: t.label, team_id: t.team_id, seasons: [] }
            grouped[t.team_id].seasons.push(t)
          }
          const teams = Object.values(grouped)
          const teamOpts = [
            { value: 'all', label: 'All' },
            ...teams.map((t) => ({
              value: String(t.team_id),
              label: shortTeam(t.label) || t.label,
            })),
          ]
          const visibleSeasons =
            filterTeam === 'all'
              ? enrichedTeams
              : enrichedTeams.filter((t) => String(t.team_id) === filterTeam)

          const sorted = [...visibleSeasons].sort((a, b) => {
            if (sortCol === 'date')
              return sortDir === 'asc'
                ? (a.last_match_date || '').localeCompare(b.last_match_date || '')
                : (b.last_match_date || '').localeCompare(a.last_match_date || '')
            if (sortCol === 'pending')
              return sortDir === 'asc'
                ? (a.pending || 0) - (b.pending || 0)
                : (b.pending || 0) - (a.pending || 0)
            if (sortCol === 'done')
              return sortDir === 'asc'
                ? (a.done || 0) - (b.done || 0)
                : (b.done || 0) - (a.done || 0)
            return 0
          })

          return (
            <>
              <div
                style={{
                  display: 'flex',
                  gap: '1rem',
                  marginBottom: '0.75rem',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                {teams.length > 1 && (
                  <FilterPills
                    label="Team"
                    options={teamOpts}
                    value={filterTeam}
                    onChange={setFilterTeam}
                  />
                )}
              </div>
              <div
                className="card"
                style={{ padding: 0, overflowX: 'auto', border: '1px solid var(--border2)' }}
              >
                <table style={{ fontSize: '0.8rem', width: '100%' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '6px 10px' }}>Team / season</th>
                      <SortTh
                        col="date"
                        label="Last match"
                        sortCol={sortCol}
                        sortDir={sortDir}
                        onSort={onSort}
                        style={{ textAlign: 'left', padding: '6px 10px' }}
                      />
                      <SortTh
                        col="pending"
                        label="Pending"
                        sortCol={sortCol}
                        sortDir={sortDir}
                        onSort={onSort}
                        style={{ textAlign: 'right', padding: '6px 10px' }}
                      />
                      <SortTh
                        col="done"
                        label="Done"
                        sortCol={sortCol}
                        sortDir={sortDir}
                        onSort={onSort}
                        style={{ textAlign: 'right', padding: '6px 10px' }}
                      />
                      <th style={{ padding: '6px 10px' }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((t) => (
                      <tr
                        key={`${t.team_id}:${t.season_id}`}
                        style={{ borderTop: '1px solid var(--border)' }}
                      >
                        <td style={{ padding: '5px 10px' }}>
                          {shortTeam(t.label) || t.label} {t.year}
                        </td>
                        <td style={{ padding: '5px 10px', color: 'var(--text2)' }}>
                          {formatDateShort(t.last_match_date) ?? '—'}
                        </td>
                        <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                          {t.pending ?? 0}
                        </td>
                        <td style={{ padding: '5px 10px', textAlign: 'right' }}>{t.done ?? 0}</td>
                        <td style={{ padding: '5px 10px' }}>
                          <button
                            className="secondary"
                            style={{
                              fontSize: '0.72rem',
                              padding: '1px 7px',
                              color: 'var(--red)',
                              borderColor: 'var(--red)',
                            }}
                            onClick={() => {
                              if (window.confirm(`Remove ${t.label} ${t.year}?`)) removeTeam(t.id)
                            }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        })()}

      {status && status.teams.length === 0 && (
        <span style={{ fontSize: '0.82rem', color: 'var(--text3)' }}>
          No teams in system yet — add via the URL field above.
        </span>
      )}
    </div>
  )
}

function PastPendingRow({ f, state, msg, onIngest }) {
  const pcId = String(f.play_cricket_id)
  return (
    <tr key={pcId} style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '5px 10px' }}>
        <a
          href={`https://whcc.play-cricket.com/website/results/${pcId}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {pcId}
        </a>
      </td>
      <td style={{ padding: '5px 10px' }}>
        {f.home_team && f.away_team
          ? `${shortTeam(f.home_team)} v ${shortTeam(f.away_team)}`
          : pcId}
      </td>
      <td style={{ padding: '5px 10px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
        {formatDateShort(f.match_date_iso) ?? '—'}
      </td>
      <td style={{ padding: '5px 10px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
        {f.ingest_after?.slice(0, 16).replace('T', ' ') ?? '—'}
      </td>
      <td style={{ padding: '5px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
        {msg && (
          <span
            style={{
              fontSize: '0.75rem',
              marginRight: 8,
              color: state === 'error' ? 'var(--red)' : 'var(--green)',
            }}
          >
            {msg}
          </span>
        )}
        <button
          className="secondary"
          style={{ fontSize: '0.75rem', padding: '2px 10px' }}
          disabled={state === 'running' || state === 'done'}
          onClick={() => onIngest(pcId)}
        >
          {state === 'running' ? 'Ingesting…' : state === 'done' ? 'Done' : 'Ingest'}
        </button>
      </td>
    </tr>
  )
}

function UpcomingFixtureRow({ j }) {
  return (
    <tr key={j.play_cricket_id} style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '5px 10px' }}>
        <a
          href={`https://whcc.play-cricket.com/website/results/${j.play_cricket_id}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {j.play_cricket_id}
        </a>
      </td>
      <td style={{ padding: '5px 10px' }}>
        {j.home_team && j.away_team
          ? `${shortTeam(j.home_team)} v ${shortTeam(j.away_team)}`
          : j.play_cricket_id}
      </td>
      <td style={{ padding: '5px 10px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
        {formatDateShort(j.match_date_iso) ?? '—'}
      </td>
      <td style={{ padding: '5px 10px', color: 'var(--text2)' }}>
        {j.ingest_after?.slice(0, 16).replace('T', ' ') ?? '—'}
      </td>
      <td style={{ padding: '5px 10px', color: 'var(--text2)' }}>
        {j.next_execution?.slice(0, 16).replace('T', ' ') ?? '—'}
      </td>
      <td style={{ padding: '5px 10px' }}>
        {j.job_missing ? (
          <span className="tag tag-orange" style={{ fontSize: '0.72rem' }}>
            no webhook
          </span>
        ) : j.enabled === false ? (
          <span className="tag tag-orange" style={{ fontSize: '0.72rem' }}>
            disabled
          </span>
        ) : (
          <span className="tag tag-green" style={{ fontSize: '0.72rem' }}>
            scheduled
          </span>
        )}
      </td>
    </tr>
  )
}

function CronJobsPanel() {
  const [jobs, setJobs] = useState(null)
  const [past, setPast] = useState(null)
  const [ingesting, setIngesting] = useState({}) // playCricketId → 'running'|'done'|'error'
  const [msgs, setMsgs] = useState({})
  const [resetting, setResetting] = useState(false)
  const [resetMsg, setResetMsg] = useState(null)
  const apiFetch = useApiFetch()

  function load() {
    apiFetch('/api/admin/scheduler/cron-jobs')
      .then((r) => r.json())
      .then((d) => setJobs(Array.isArray(d) ? d : []))
      .catch(() => setJobs([]))
    apiFetch('/api/admin/scheduler/past-pending')
      .then((r) => r.json())
      .then((d) => setPast(Array.isArray(d) ? d : []))
      .catch(() => setPast([]))
  }

  useEffect(() => {
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function ingestOne(pcId) {
    setIngesting((s) => ({ ...s, [pcId]: 'running' }))
    setMsgs((m) => ({ ...m, [pcId]: null }))
    try {
      const res = await apiFetch(`/api/admin/scheduler/ingest-one/${pcId}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setIngesting((s) => ({ ...s, [pcId]: 'done' }))
      setMsgs((m) => ({
        ...m,
        [pcId]: data.alreadyDone ? 'Already ingested — marked done' : `Ingested ✓`,
      }))
      // Remove from past list
      setPast((p) => (p || []).filter((f) => String(f.play_cricket_id) !== String(pcId)))
    } catch (e) {
      setIngesting((s) => ({ ...s, [pcId]: 'error' }))
      setMsgs((m) => ({ ...m, [pcId]: e.message }))
    }
  }

  async function resetWindow() {
    if (
      !window.confirm(
        'Delete all future cron-job.org webhooks and recreate only the next 5. Continue?'
      )
    )
      return
    setResetting(true)
    setResetMsg(null)
    try {
      const res = await apiFetch('/api/admin/scheduler/reset-window', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setResetMsg(`Done — deleted ${data.deleted} old job(s), created ${data.created} new job(s)`)
      load()
    } catch (e) {
      setResetMsg(`Error: ${e.message}`)
    } finally {
      setResetting(false)
    }
  }

  const hasPast = past && past.length > 0
  const hasJobs = jobs && jobs.length > 0
  if (!hasPast && !hasJobs) return null

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      {hasPast && (
        <>
          <h3 style={{ marginBottom: '0.5rem' }}>Past matches — pending ingest</h3>
          <p style={{ fontSize: '0.82rem', color: 'var(--text2)', marginBottom: '0.75rem' }}>
            These matches have passed their scheduled ingest time but have not been ingested yet.
            Click <strong>Ingest</strong> to fetch each one now.
          </p>
          <div
            className="card"
            style={{
              padding: 0,
              overflowX: 'auto',
              border: '1px solid var(--border2)',
              marginBottom: hasJobs ? '1.25rem' : 0,
            }}
          >
            <table style={{ fontSize: '0.8rem', width: '100%' }}>
              <thead>
                <tr>
                  {['Fixture', 'Match', 'Match date', 'Ingest after', ''].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 10px' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {past.map((f) => (
                  <PastPendingRow
                    key={f.play_cricket_id}
                    f={f}
                    state={ingesting[String(f.play_cricket_id)]}
                    msg={msgs[String(f.play_cricket_id)]}
                    onIngest={ingestOne}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {hasJobs && (
        <>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}
          >
            <h3 style={{ margin: 0 }}>Upcoming fixtures</h3>
            <button
              className="secondary"
              style={{ fontSize: '0.75rem', padding: '2px 10px' }}
              disabled={resetting}
              onClick={resetWindow}
            >
              {resetting ? 'Resetting…' : 'Reset window'}
            </button>
            {resetMsg && (
              <span
                style={{
                  fontSize: '0.75rem',
                  color: resetMsg.startsWith('Error') ? 'var(--red)' : 'var(--green)',
                }}
              >
                {resetMsg}
              </span>
            )}
          </div>
          {jobs.some((j) => j.job_missing) && (
            <p style={{ fontSize: '0.82rem', color: 'var(--orange)', marginBottom: '0.75rem' }}>
              ⚠ Some fixtures have no cron-job.org webhook — likely the account job limit was hit.
              They will still be ingested by the server&apos;s own 30-minute polling loop, but
              won&apos;t be triggered by webhook.
            </p>
          )}
          <div
            className="card"
            style={{ padding: 0, overflowX: 'auto', border: '1px solid var(--border2)' }}
          >
            <table style={{ fontSize: '0.8rem', width: '100%' }}>
              <thead>
                <tr>
                  {['Fixture', 'Match', 'Match date', 'Ingest after', 'Next run', 'Status'].map(
                    (h) => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 10px' }}>
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <UpcomingFixtureRow key={j.play_cricket_id} j={j} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function StaleFixturesPanel() {
  const [rows, setRows] = useState(null)
  const [sel, setSel] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const apiFetch = useApiFetch()

  useEffect(() => {
    apiFetch('/api/admin/scheduler/stale')
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!rows || rows.length === 0) return null

  async function ignoreSelected() {
    if (!sel.size) return
    setSaving(true)
    setMsg(null)
    try {
      const res = await apiFetch('/api/admin/scheduler/ignore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...sel] }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setRows((r) => r.filter((x) => !sel.has(x.play_cricket_id)))
      setSel(new Set())
      setMsg({
        error: false,
        text: `${data.ignored} fixture${data.ignored === 1 ? '' : 's'} ignored.`,
      })
    } catch (e) {
      setMsg({ error: true, text: e.message })
    }
    setSaving(false)
  }

  function toggleAll() {
    setSel((s) =>
      s.size === rows.length ? new Set() : new Set(rows.map((r) => r.play_cricket_id))
    )
  }

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Stale / failed fixtures</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
        Pending fixtures older than 7 days, and fixtures that failed all retries. Mark as ignored to
        stop them appearing in the queue.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: '0.75rem', alignItems: 'center' }}>
        <button
          className="secondary"
          style={{ fontSize: '0.78rem', padding: '2px 10px' }}
          onClick={toggleAll}
        >
          {sel.size === rows.length ? 'Deselect all' : 'Select all'}
        </button>
        <button
          disabled={!sel.size || saving}
          onClick={ignoreSelected}
          style={{ fontSize: '0.78rem', padding: '2px 10px' }}
        >
          {saving ? 'Saving…' : `Ignore ${sel.size || ''} selected`}
        </button>
      </div>
      {msg && (
        <p
          style={{
            fontSize: '0.82rem',
            color: msg.error ? 'var(--red)' : 'var(--green)',
            marginBottom: '0.5rem',
          }}
        >
          {msg.text}
        </p>
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.4rem',
          maxHeight: 300,
          overflowY: 'auto',
        }}
      >
        {rows.map((r) => {
          const checked = sel.has(r.play_cricket_id)
          return (
            <label
              key={r.play_cricket_id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '0.82rem',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  setSel((s) => {
                    const n = new Set(s)
                    checked ? n.delete(r.play_cricket_id) : n.add(r.play_cricket_id)
                    return n
                  })
                }
              />
              <span style={{ color: 'var(--text3)', minWidth: 70 }}>{r.play_cricket_id}</span>
              <span style={{ flex: 1 }}>
                {shortTeam(r.home_team)} vs {shortTeam(r.away_team)}
                {r.match_date_iso ? ` · ${formatDateShort(r.match_date_iso)}` : ''}
              </span>
              <span
                className={`tag tag-${r.status === 'failed' ? 'red' : 'orange'}`}
                style={{ fontSize: '0.7rem' }}
              >
                {r.status}
                {r.attempt_count > 0 ? ` (${r.attempt_count})` : ''}
              </span>
              {r.error_msg && (
                <span
                  style={{
                    color: 'var(--red)',
                    fontSize: '0.7rem',
                    maxWidth: 180,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={r.error_msg}
                >
                  {r.error_msg}
                </span>
              )}
            </label>
          )
        })}
      </div>
    </div>
  )
}

// ── Panel components (Data tab) ───────────────────────────────────────────────

function UnnamedPanel() {
  const [players, setPlayers] = useState(null)
  const [names, setNames] = useState({})
  const [saving, setSaving] = useState({})
  const [saved, setSaved] = useState({})
  const [ignoring, setIgnoring] = useState({})
  const apiFetch = useApiFetch()

  useEffect(() => {
    apiFetch('/api/players/unnamed')
      .then((r) => r.json())
      .then((d) => {
        setPlayers(d)
        const initial = {}
        d.forEach((p) => {
          initial[p.player_id] = p.display_name || ''
        })
        setNames(initial)
      })
      .catch(() => setPlayers([]))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!players || players.length === 0) return null

  async function saveName(playerId) {
    setSaving((s) => ({ ...s, [playerId]: true }))
    const name = names[playerId]?.trim() || null
    try {
      await apiFetch(`/api/admin/player/${playerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: name }),
      })
      setSaved((s) => ({ ...s, [playerId]: true }))
      setPlayers((ps) => ps.filter((p) => p.player_id !== playerId))
    } catch {
      /* ignore */
    }
    setSaving((s) => ({ ...s, [playerId]: false }))
  }

  async function ignorePlayer(playerId) {
    setIgnoring((s) => ({ ...s, [playerId]: true }))
    try {
      await apiFetch(`/api/admin/player/${playerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ignore: true }),
      })
      setPlayers((ps) => ps.filter((p) => p.player_id !== playerId))
    } catch {
      /* ignore */
    }
    setIgnoring((s) => ({ ...s, [playerId]: false }))
  }

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Unnamed players</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
        Players with missing or placeholder names. Assign a display name or ignore.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {players.map((p) => (
          <div
            key={p.player_id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
              fontSize: '0.85rem',
            }}
          >
            <span style={{ color: 'var(--text3)', minWidth: 60 }}>#{p.player_id}</span>
            <span style={{ color: 'var(--text2)', minWidth: 120 }}>{p.name || '(no name)'}</span>
            <span style={{ color: 'var(--text3)', fontSize: '0.78rem', flex: 1 }}>
              {p.fixture_count} match{p.fixture_count !== 1 ? 'es' : ''}
            </span>
            <input
              type="text"
              placeholder="Display name…"
              value={names[p.player_id] || ''}
              onChange={(e) => setNames((n) => ({ ...n, [p.player_id]: e.target.value }))}
              style={{ width: 180, fontSize: '0.82rem' }}
              onKeyDown={(e) => e.key === 'Enter' && saveName(p.player_id)}
            />
            <button
              disabled={!names[p.player_id]?.trim() || saving[p.player_id]}
              onClick={() => saveName(p.player_id)}
              style={{ fontSize: '0.78rem', padding: '2px 10px' }}
            >
              {saving[p.player_id] ? '…' : saved[p.player_id] ? '✓' : 'Save'}
            </button>
            <button
              className="secondary"
              disabled={ignoring[p.player_id]}
              onClick={() => ignorePlayer(p.player_id)}
              style={{ fontSize: '0.78rem', padding: '2px 8px' }}
            >
              Ignore
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function MissingTeamPanel() {
  const [matches, setMatches] = useState(null)
  const [teams, setTeams] = useState([])
  const [sel, setSel] = useState({})
  const [saving, setSaving] = useState({})
  const [saved, setSaved] = useState({})
  const apiFetch = useApiFetch()

  useEffect(() => {
    Promise.all([
      apiFetch('/api/admin/matches-missing-team').then((r) => r.json()),
      apiFetch('/api/admin/teams').then((r) => r.json()),
    ])
      .then(([m, t]) => {
        setMatches(Array.isArray(m) ? m : [])
        setTeams(Array.isArray(t) ? t : [])
      })
      .catch(() => {
        setMatches([])
        setTeams([])
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!matches || matches.length === 0) return null

  async function associate(fixture_id) {
    const key = sel[fixture_id]
    if (!key) return
    const [team_id, season_id] = key.split(':').map(Number)
    setSaving((s) => ({ ...s, [fixture_id]: true }))
    try {
      const res = await apiFetch('/api/admin/associate-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixture_id, team_id, season_id }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      setSaved((s) => ({ ...s, [fixture_id]: true }))
      setMatches((m) => m.filter((x) => x.fixture_id !== fixture_id))
    } catch {
      /* ignore */
    }
    setSaving((s) => ({ ...s, [fixture_id]: false }))
  }

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Matches missing team/season</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
        These matches have no team/season association — invisible to all scoped users.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {matches.map((m) => {
          const fid = m.fixture_id
          return (
            <div
              key={fid}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
                fontSize: '0.85rem',
              }}
            >
              <a
                href={`/match/${fid}`}
                style={{ color: 'var(--accent)', fontWeight: 500, minWidth: 80 }}
              >
                #{fid}
              </a>
              <span style={{ color: 'var(--text2)', flex: 1 }}>
                {shortTeam(m.home_team)} vs {shortTeam(m.away_team)}
                {m.match_date_iso ? ` · ${formatDateShort(m.match_date_iso)}` : ''}
              </span>
              {saved[fid] ? (
                <span style={{ color: 'var(--green)', fontSize: '0.78rem' }}>Linked ✓</span>
              ) : (
                <>
                  <select
                    value={sel[fid] || ''}
                    onChange={(e) => setSel((s) => ({ ...s, [fid]: e.target.value }))}
                    style={{ fontSize: '0.8rem' }}
                  >
                    <option value="">— select team/season —</option>
                    {teams.map((t) => (
                      <option
                        key={`${t.team_id}:${t.season_id}`}
                        value={`${t.team_id}:${t.season_id}`}
                      >
                        {t.label} {t.year}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={!sel[fid] || saving[fid]}
                    onClick={() => associate(fid)}
                    style={{ fontSize: '0.78rem', padding: '2px 10px' }}
                  >
                    {saving[fid] ? 'Saving…' : 'Link'}
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MissingRolesPanel() {
  const [matches, setMatches] = useState(null)
  const apiFetch = useApiFetch()

  useEffect(() => {
    apiFetch('/api/admin/matches-missing-roles')
      .then((r) => r.json())
      .then(setMatches)
      .catch(() => setMatches([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!matches || matches.length === 0) return null

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Matches missing roles</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
        These matches have no captain or wicket keeper assigned. Open the match to set them.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
        {matches.map((m) => (
          <div
            key={m.fixture_id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
              fontSize: '0.85rem',
            }}
          >
            <a
              href={`/match/${m.fixture_id}`}
              style={{ color: 'var(--accent)', fontWeight: 500, minWidth: 80 }}
            >
              #{m.fixture_id}
            </a>
            <span style={{ color: 'var(--text2)', flex: 1 }}>
              {shortTeam(m.home_team)} vs {shortTeam(m.away_team)}
            </span>
            {!m.has_captain && (
              <span className="tag tag-orange" style={{ fontSize: '0.72rem' }}>
                No captain
              </span>
            )}
            {!m.has_wk && (
              <span className="tag tag-orange" style={{ fontSize: '0.72rem' }}>
                No WK
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function MergePanel() {
  const [players, setPlayers] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [keepId, setKeepId] = useState(null)
  const [dropId, setDropId] = useState(null)
  const [merging, setMerging] = useState(false)
  const [msg, setMsg] = useState(null)
  const apiFetch = useApiFetch()

  useEffect(() => {
    apiFetch('/api/players')
      .then((r) => r.json())
      .then(setPlayers)
      .catch(() => {})
    apiFetch('/api/admin/duplicate-players')
      .then((r) => r.json())
      .then(setSuggestions)
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function doMerge() {
    if (
      !confirm(
        `Merge player #${dropId} into #${keepId}? All their deliveries, stats, and dismissals will be reassigned. This cannot be undone.`
      )
    )
      return
    setMerging(true)
    setMsg(null)
    try {
      const res = await apiFetch('/api/admin/merge-players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepId, dropId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Merge failed')
      setMsg({ error: false, text: `Player #${dropId} merged into #${keepId} successfully.` })
      setKeepId(null)
      setDropId(null)
      apiFetch('/api/admin/duplicate-players')
        .then((r) => r.json())
        .then(setSuggestions)
        .catch(() => {})
    } catch (e) {
      setMsg({ error: true, text: e.message })
    }
    setMerging(false)
  }

  return (
    <div className="card">
      <h3 style={{ marginBottom: '0.5rem' }}>Merge players</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
        Combine two player records into one. All deliveries and stats from the dropped player are
        reassigned to the kept player, then the duplicate is deleted.
      </p>

      {suggestions.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text3)', marginBottom: 6 }}>
            Suggested duplicates
          </div>
          {suggestions.map((g) => (
            <div key={g.name} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>{g.name}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {g.players.map((p) => (
                  <button
                    key={p.player_id}
                    className="secondary"
                    style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                    onClick={() => {
                      if (!keepId) setKeepId(p.player_id)
                      else setDropId(p.player_id)
                    }}
                  >
                    #{p.player_id} · {p.appearances} app{p.team ? ` · ${shortTeam(p.team)}` : ''}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <PlayerSearch
          label="Keep (target)"
          players={players}
          selected={keepId}
          onSelect={setKeepId}
          exclude={dropId}
        />
        <PlayerSearch
          label="Drop (source)"
          players={players}
          selected={dropId}
          onSelect={setDropId}
          exclude={keepId}
        />
      </div>

      {msg && (
        <p
          style={{
            fontSize: '0.85rem',
            color: msg.error ? 'var(--red)' : 'var(--green)',
            marginBottom: '0.5rem',
          }}
        >
          {msg.text}
        </p>
      )}

      <button onClick={doMerge} disabled={merging || !keepId || !dropId}>
        {merging ? 'Merging…' : 'Merge players'}
      </button>
    </div>
  )
}

// ── System tab ────────────────────────────────────────────────────────────────

function BackupPanel() {
  const [importing, setImporting] = useState(false)
  const [msg, setMsg] = useState(null)
  const fileRef = useRef()
  const apiFetch = useApiFetch()

  async function doExport() {
    const res = await apiFetch('/api/admin/export')
    if (!res.ok) {
      setMsg({ error: true, text: 'Export failed' })
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const date = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `cricket-${date}.db`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function doImport(e) {
    const file = e.target.files[0]
    if (!file) return
    if (!confirm(`Replace ALL data with "${file.name}"? This cannot be undone.`)) return
    setImporting(true)
    setMsg(null)
    const form = new FormData()
    form.append('db', file)
    try {
      const res = await apiFetch('/api/admin/import', { method: 'POST', body: form })
      const data = await res.json()
      setMsg(
        res.ok
          ? { error: false, text: 'Import successful — page will reload' }
          : { error: true, text: data.error }
      )
      if (res.ok) setTimeout(() => window.location.reload(), 1500)
    } catch {
      setMsg({ error: true, text: 'Import failed' })
    } finally {
      setImporting(false)
      fileRef.current.value = ''
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginBottom: '0.75rem' }}>Backup &amp; restore</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
        Export downloads a complete copy of the database. Import replaces all data — use with care.
      </p>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={doExport}>Export database</button>
        <button className="secondary" onClick={() => fileRef.current.click()} disabled={importing}>
          {importing ? 'Importing…' : 'Import database'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".db"
          style={{ display: 'none' }}
          onChange={doImport}
        />
      </div>
      {msg && (
        <div
          className={`alert ${msg.error ? 'alert-error' : 'alert-success'}`}
          style={{ marginTop: '0.75rem' }}
        >
          {msg.text}
        </div>
      )}
    </div>
  )
}
