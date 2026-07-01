import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import {
  X,
  Download,
  PenTool,
  Clock,
  Database,
  Settings,
  Users,
  Shirt,
  ScrollText
} from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'
import { useGroups } from '../GroupContext'
import { shortTeam, formatDateShort, shortYear } from '../utils/cricket'
import TagPicker from '../components/TagPicker'
import UserAdmin from './UserAdmin'
import ClubAdmin from './ClubAdmin'
import TeamDropdown from '../components/TeamDropdown'
import DataTab from './admin/DataTab'
import PlayersTab from './admin/PlayersTab'
import SystemTab from './admin/SystemTab'
import ChangelogTab from './admin/ChangelogTab'

// ── Tab bar ───────────────────────────────────────────────────────────────────

const UPLOAD_TABS = [
  { id: 'scheduler', label: 'Scheduler', icon: Clock },
  { id: 'ingest', label: 'Ingest', icon: Download },
  { id: 'manual', label: 'Manual', icon: PenTool }
]
const BASE_TABS = [
  ...UPLOAD_TABS,
  { id: 'data', label: 'Data', icon: Database },
  { id: 'system', label: 'System', icon: Settings }
]

export default function Admin() {
  const { user } = useUser()
  const navigate = useNavigate()
  const { hash } = useLocation()
  const isSuperAdmin = user?.publicMetadata?.isSuperAdmin === true
  const isClubAdmin = user?.publicMetadata?.isClubAdmin === true
  const canAdmin = isSuperAdmin || isClubAdmin
  const ADMIN_TABS = [
    { id: 'users', label: 'Users', icon: Users },
    { id: 'players', label: 'Players', icon: Shirt },
    { id: 'club', label: 'Club', icon: Settings },
    { id: 'changelog', label: 'Changelog', icon: ScrollText }
  ]
  const TABS = isSuperAdmin
    ? [...BASE_TABS, ...ADMIN_TABS]
    : isClubAdmin
      ? [...UPLOAD_TABS, ...ADMIN_TABS]
      : BASE_TABS

  const tabFromHash = hash.replace(/^#/, '')
  const activeTab = TABS.some((t) => t.id === tabFromHash)
    ? tabFromHash
    : (TABS[0]?.id ?? 'scheduler')

  function setTab(id) {
    navigate(`#${id}`, { replace: true })
  }

  return (
    <div className="page">
      <h1 style={{ marginBottom: '1rem' }}>Admin</h1>

      {/* Mobile: select dropdown */}
      <select
        className="tab-select-mobile"
        value={activeTab}
        onChange={(e) => setTab(e.target.value)}
      >
        {TABS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>

      {/* Desktop: scrolling tab bar */}
      <div
        className="tab-bar"
        style={{
          gap: 0,
          borderBottom: '2px solid var(--border)',
          marginBottom: '1.5rem',
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch'
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
                borderBottom:
                  activeTab === t.id ? '2px solid var(--hotpink)' : '2px solid transparent',
                marginBottom: -2,
                fontWeight: activeTab === t.id ? 600 : 400,
                color: activeTab === t.id ? 'var(--hotpink)' : 'var(--text2)',
                padding: '0.5rem 1.1rem',
                background: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}
            >
              <IconComponent size={16} />
              {t.label}
            </button>
          )
        })}
      </div>

      {activeTab === 'ingest' && <IngestTab />}
      {activeTab === 'manual' && <ManualTab />}
      {activeTab === 'scheduler' && <SchedulerTab />}
      {activeTab === 'data' && <DataTab />}
      {activeTab === 'system' && <SystemTab />}
      {activeTab === 'users' && canAdmin && <UserAdmin />}
      {activeTab === 'players' && canAdmin && <PlayersTab />}
      {activeTab === 'club' && canAdmin && <ClubAdmin />}
      {activeTab === 'changelog' && canAdmin && <ChangelogTab />}
    </div>
  )
}

// ── Ingest tab ────────────────────────────────────────────────────────────────

const INGEST_TABS = [
  { id: 'fetch', label: 'Fetch from URL' },
  { id: 'pdf', label: 'Upload App PDF' },
  { id: 'export', label: 'Upload Play-Cricket export' }
]

function IngestTab() {
  const [mode, setMode] = useState('fetch')
  return (
    <>
      <div
        style={{
          display: 'flex',
          gap: 4,
          flexWrap: 'wrap',
          marginBottom: '1.25rem',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '0.75rem'
        }}
      >
        {INGEST_TABS.map((t) => (
          <button
            key={t.id}
            className={mode === t.id ? '' : 'secondary'}
            onClick={() => setMode(t.id)}
            style={{ fontSize: '0.82rem', padding: '3px 12px' }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {mode === 'fetch' && <FetchPanel />}
      {mode === 'pdf' && <ScorecardImportTab />}
      {mode === 'export' && <UploadPanel />}
    </>
  )
}

function FetchPanel() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const apiFetch = useApiFetch()
  const { playCricketDomain } = useGroups()

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
        body: JSON.stringify({ url: url.trim() })
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
          placeholder={`https://${playCricketDomain ?? 'yourclub.play-cricket.com'}/website/results/7449428`}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            setResult(null)
            setError(null)
          }}
          style={{ flex: '1 1 200px', minWidth: 0, width: '100%' }}
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

  async function setTags(fixtureId, tags) {
    const res = await apiFetch(`/api/admin/match/${fixtureId}/type`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags })
    })
    if (res.ok) {
      setMatches((prev) => prev.map((m) => (m.fixture_id === fixtureId ? { ...m, tags } : m)))
    }
  }

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
          flexWrap: 'wrap',
          gap: '0.5rem'
        }}
      >
        <p style={{ color: 'var(--text2)', fontSize: '0.88rem', margin: 0 }}>
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
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Type</th>
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
                  <td style={{ padding: '7px 12px' }}>
                    <TagPicker
                      value={m.tags ?? (m.match_type ? [m.match_type] : ['league'])}
                      onChange={(tags) => setTags(m.fixture_id, tags)}
                    />
                  </td>
                  <td style={{ padding: '7px 12px', textAlign: 'center' }}>{m.bat_rows}</td>
                  <td style={{ padding: '7px 12px', textAlign: 'center' }}>{m.bowl_rows}</td>
                  <td style={{ padding: '7px 12px', display: 'flex', gap: 6 }}>
                    <button
                      className="secondary btn-sm"
                      onClick={() => navigate(`/match/${m.fixture_id}`)}
                    >
                      View
                    </button>
                    <button
                      className="secondary btn-sm"
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

function BattingPreviewRow({ b, innIdx, ri, onUpdate }) {
  const dnb = b.did_not_bat
  return (
    <tr style={{ borderBottom: '1px solid var(--border-light)' }}>
      <td style={{ padding: '3px 6px' }}>
        <input
          value={b.name || ''}
          onChange={(e) => onUpdate(innIdx, 'batting', ri, 'name', e.target.value)}
          style={{ width: 180, fontSize: '0.82rem' }}
        />
        {b.matched && (
          <span style={{ color: 'var(--green)', marginLeft: 4, fontSize: '0.75rem' }}>
            ✓ matched
          </span>
        )}
        {!b.matched && !dnb && (
          <span style={{ color: 'var(--text3)', marginLeft: 4, fontSize: '0.75rem' }}>new</span>
        )}
      </td>
      <td style={{ textAlign: 'center', padding: '3px 6px' }}>{dnb ? '—' : b.runs}</td>
      <td style={{ textAlign: 'center', padding: '3px 6px' }}>{dnb ? '—' : b.balls}</td>
      <td style={{ textAlign: 'center', padding: '3px 6px' }}>{dnb ? '—' : b.fours}</td>
      <td style={{ textAlign: 'center', padding: '3px 6px' }}>{dnb ? '—' : b.sixes}</td>
      <td style={{ padding: '3px 6px' }}>{dnb ? 'did not bat' : b.how_out}</td>
      <td style={{ padding: '3px 6px', fontSize: '0.75rem', color: 'var(--text3)' }}>
        {dnb ? 'dnb' : b.not_out ? 'not out' : 'out'}
      </td>
    </tr>
  )
}

function BowlingPreviewRow({ b, innIdx, ri, onUpdate }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--border-light)' }}>
      <td style={{ padding: '3px 6px' }}>
        <input
          value={b.name || ''}
          onChange={(e) => onUpdate(innIdx, 'bowling', ri, 'name', e.target.value)}
          style={{ width: 180, fontSize: '0.82rem' }}
        />
        {b.matched && (
          <span style={{ color: 'var(--green)', marginLeft: 4, fontSize: '0.75rem' }}>✓</span>
        )}
        {!b.matched && (
          <span style={{ color: 'var(--text3)', marginLeft: 4, fontSize: '0.75rem' }}>new</span>
        )}
      </td>
      <td style={{ textAlign: 'center', padding: '3px 6px' }}>{b.overs}</td>
      <td style={{ textAlign: 'center', padding: '3px 6px' }}>{b.maidens}</td>
      <td style={{ textAlign: 'center', padding: '3px 6px' }}>{b.runs}</td>
      <td style={{ textAlign: 'center', padding: '3px 6px' }}>{b.wickets}</td>
      <td style={{ textAlign: 'center', padding: '3px 6px' }}>{b.wides}</td>
      <td style={{ textAlign: 'center', padding: '3px 6px' }}>{b.no_balls}</td>
      <td style={{ padding: '3px 6px', fontSize: '0.75rem', color: 'var(--text3)' }}>
        {b.matched ? 'db match' : 'will create'}
      </td>
    </tr>
  )
}

// ── Scorecard import tab ──────────────────────────────────────────────────────

function useScorecardImport() {
  const apiFetch = useApiFetch()
  const navigate = useNavigate()
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState(null)
  const [tags, setTags] = useState(['friendly'])
  const [competition, setCompetition] = useState('')
  const [ground, setGround] = useState('')
  const [format, setFormat] = useState('t20')
  const [teams, setTeams] = useState([])
  const [teamSeason, setTeamSeason] = useState('')

  useEffect(() => {
    apiFetch('/api/access-requests/teams')
      .then((r) => (r.ok ? r.json() : []))
      .then((ts) => setTeams(Array.isArray(ts) ? ts : []))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setError(null)
    setPreview(null)
    try {
      const fd = new FormData()
      fd.append('pdf', file)
      const res = await apiFetch('/api/admin/import/scorecard-parse', { method: 'POST', body: fd })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Parse failed')
      }
      setPreview(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function updatePlayerName(innIdx, type, rowIdx, field, value) {
    setPreview((prev) => {
      const copy = structuredClone(prev)
      copy.innings[innIdx][type][rowIdx][field] = value
      if (field === 'name') copy.innings[innIdx][type][rowIdx].player_id = null
      return copy
    })
  }

  function updateTeamName(field, value) {
    setPreview((prev) => {
      const oldVal = prev[field]
      return {
        ...prev,
        [field]: value,
        innings: prev.innings.map((inn) => ({
          ...inn,
          batting_team: inn.batting_team === oldVal ? value : inn.batting_team,
          bowling_team: inn.bowling_team === oldVal ? value : inn.bowling_team
        }))
      }
    })
  }

  async function handleCommit() {
    setCommitting(true)
    setError(null)
    try {
      const tsFields = teamSeason
        ? { team_id: Number(teamSeason.split(':')[0]), season_id: Number(teamSeason.split(':')[1]) }
        : {}
      const res = await apiFetch('/api/admin/import/scorecard-commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...preview,
          tags,
          competition,
          ground,
          format,
          ...tsFields
        })
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Commit failed')
      }
      const { fixture_id } = await res.json()
      navigate(`/match/${fixture_id}`)
    } catch (err) {
      setError(err.message)
      setCommitting(false)
    }
  }

  return {
    preview,
    loading,
    committing,
    error,
    tags,
    setTags,
    competition,
    setCompetition,
    ground,
    setGround,
    format,
    setFormat,
    teams,
    teamSeason,
    setTeamSeason,
    handleFile,
    updatePlayerName,
    updateTeamName,
    handleCommit
  }
}

function ScorecardImportControls({ fileRef, imp }) {
  const {
    loading,
    preview,
    tags,
    setTags,
    format,
    setFormat,
    competition,
    setCompetition,
    ground,
    setGround,
    teams,
    teamSeason,
    setTeamSeason,
    committing,
    handleFile,
    handleCommit
  } = imp
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'center',
        marginBottom: '1rem',
        flexWrap: 'wrap'
      }}
    >
      <input
        type="file"
        accept=".pdf"
        ref={fileRef}
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      <button onClick={() => fileRef.current?.click()} disabled={loading}>
        {loading ? 'Parsing…' : 'Choose PDF'}
      </button>
      {preview && (
        <>
          <TagPicker value={tags} onChange={setTags} />
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            style={{ width: 'auto' }}
          >
            {[
              ['t20', 'T20'],
              ['standard', 'Standard'],
              ['declaration', 'Declaration']
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <input
            placeholder="Competition"
            value={competition}
            onChange={(e) => setCompetition(e.target.value)}
            style={{ width: 150 }}
          />
          <input
            placeholder="Ground"
            value={ground}
            onChange={(e) => setGround(e.target.value)}
            style={{ width: 150 }}
          />
          {teams.length > 0 && (
            <select
              value={teamSeason}
              onChange={(e) => setTeamSeason(e.target.value)}
              style={{ maxWidth: 200 }}
              title="Associate with team/season so it appears in the match list"
            >
              <option value="">— Season (access) —</option>
              {teams.map((t) => (
                <option key={`${t.team_id}:${t.season_id}`} value={`${t.team_id}:${t.season_id}`}>
                  {t.year ? `${t.label} '${shortYear(t.year)}` : t.label}
                </option>
              ))}
            </select>
          )}
          <button onClick={handleCommit} disabled={committing} className="primary">
            {committing ? 'Importing…' : 'Import Match'}
          </button>
        </>
      )}
    </div>
  )
}

function ScorecardInningsSection({ inn, innIdx, updatePlayerName }) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <h4 style={{ marginBottom: '0.5rem' }}>
        Innings {innIdx + 1}: {inn.batting_team} batting
      </h4>
      <p style={{ fontSize: '0.82rem', color: 'var(--text2)', marginBottom: '0.4rem' }}>
        Batting ({inn.batting?.length} rows)
      </p>
      <table style={{ fontSize: '0.82rem', width: '100%', marginBottom: '1rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '2px 6px' }}>Name</th>
            <th style={{ padding: '2px 6px' }}>R</th>
            <th style={{ padding: '2px 6px' }}>B</th>
            <th style={{ padding: '2px 6px' }}>4s</th>
            <th style={{ padding: '2px 6px' }}>6s</th>
            <th style={{ textAlign: 'left', padding: '2px 6px' }}>How out</th>
            <th style={{ textAlign: 'left', padding: '2px 6px' }}>Match status</th>
          </tr>
        </thead>
        <tbody>
          {inn.batting?.map((b, ri) => (
            <BattingPreviewRow key={ri} b={b} innIdx={innIdx} ri={ri} onUpdate={updatePlayerName} />
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: '0.82rem', color: 'var(--text2)', marginBottom: '0.4rem' }}>
        Bowling ({inn.bowling?.length} rows)
      </p>
      <table style={{ fontSize: '0.82rem', width: '100%', marginBottom: '0.75rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '2px 6px' }}>Name</th>
            <th style={{ padding: '2px 6px' }}>O</th>
            <th style={{ padding: '2px 6px' }}>M</th>
            <th style={{ padding: '2px 6px' }}>R</th>
            <th style={{ padding: '2px 6px' }}>W</th>
            <th style={{ padding: '2px 6px' }}>Wd</th>
            <th style={{ padding: '2px 6px' }}>Nb</th>
            <th style={{ textAlign: 'left', padding: '2px 6px' }}>Match status</th>
          </tr>
        </thead>
        <tbody>
          {inn.bowling?.map((b, ri) => (
            <BowlingPreviewRow key={ri} b={b} innIdx={innIdx} ri={ri} onUpdate={updatePlayerName} />
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>
        {inn.overs?.length} overs parsed · {inn.fallOfWickets?.length} fall of wickets
      </p>
    </div>
  )
}

function ScorecardPreviewPanel({ preview, updateTeamName, updatePlayerName }) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          flexWrap: 'wrap',
          marginBottom: '1rem',
          fontSize: '0.9rem',
          color: 'var(--text2)'
        }}
      >
        <input
          value={preview.home_team || ''}
          onChange={(e) => updateTeamName('home_team', e.target.value)}
          style={{ width: 180, fontWeight: 600 }}
          title="Home team — edit if the scorecard name differs from your team list"
        />
        <span>vs</span>
        <input
          value={preview.away_team || ''}
          onChange={(e) => updateTeamName('away_team', e.target.value)}
          style={{ width: 180, fontWeight: 600 }}
          title="Away team — edit if the scorecard name differs from your team list"
        />
        <span style={{ color: 'var(--text3)' }}>— {preview.match_date}</span>
      </div>
      {preview.innings.map((inn, innIdx) => (
        <ScorecardInningsSection
          key={innIdx}
          inn={inn}
          innIdx={innIdx}
          updatePlayerName={updatePlayerName}
        />
      ))}
    </div>
  )
}

function ScorecardImportTab() {
  const fileRef = useRef(null)
  const imp = useScorecardImport()
  return (
    <div>
      <h3 style={{ marginBottom: '0.75rem' }}>Import Custom Match Scorecard (PDF)</h3>
      <ScorecardImportControls fileRef={fileRef} imp={imp} />
      {imp.error && <p style={{ color: 'var(--red)', marginBottom: '1rem' }}>{imp.error}</p>}
      {imp.preview && (
        <ScorecardPreviewPanel
          preview={imp.preview}
          updateTeamName={imp.updateTeamName}
          updatePlayerName={imp.updatePlayerName}
        />
      )}
    </div>
  )
}

// ── Scheduler tab ─────────────────────────────────────────────────────────────

function SchedulerTab() {
  const { user } = useUser()
  const isSuperAdmin = user?.publicMetadata?.isSuperAdmin === true
  return (
    <>
      <AutoIngestPanel />
      {isSuperAdmin && <CronJobsPanel />}
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

function SortTh({ col, label, sortCol, sortDir, onSort, style }) {
  const active = sortCol === col
  return (
    <th onClick={() => onSort(col)} style={{ cursor: 'pointer', userSelect: 'none', ...style }}>
      {label}
      {active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
    </th>
  )
}

function TeamCard({ t, watchingId, onWatch }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '4px 8px',
        borderRadius: 4,
        background: t.watched ? 'var(--bg2)' : 'transparent',
        border: '1px solid',
        borderColor: t.watched ? 'transparent' : 'var(--border)',
        opacity: t.watched ? 0.55 : 1
      }}
    >
      <span style={{ fontSize: '0.78rem' }}>{t.name}</span>
      {t.watched ? (
        <span
          style={{
            fontSize: '0.7rem',
            color: 'var(--text2)',
            marginLeft: 6,
            whiteSpace: 'nowrap'
          }}
        >
          ✓ Watching
        </span>
      ) : (
        <button
          className="secondary"
          style={{
            fontSize: '0.7rem',
            padding: '1px 8px',
            marginLeft: 6,
            whiteSpace: 'nowrap'
          }}
          disabled={watchingId === t.team_id}
          onClick={() => onWatch(t.team_id)}
        >
          {watchingId === t.team_id ? '…' : 'Watch'}
        </button>
      )}
    </div>
  )
}

async function doLoadBrowseTeams(apiFetch, setBrowsing, setBrowseMsg, setBrowseTeams) {
  setBrowsing(true)
  setBrowseMsg(null)
  try {
    const res = await apiFetch('/api/admin/scheduler/browse-teams')
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to load teams')
    setBrowseTeams(data)
  } catch (e) {
    setBrowseMsg({ ok: false, text: e.message })
  }
  setBrowsing(false)
}

async function doWatchTeam(
  teamId,
  apiFetch,
  setWatchingId,
  setBrowseMsg,
  setBrowseTeams,
  onTeamAdded
) {
  setWatchingId(teamId)
  setBrowseMsg(null)
  try {
    const teamBody = '{"team_id":' + Number(teamId) + '}'
    const res = await apiFetch('/api/admin/scheduler/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: teamBody
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed')
    const label = data.resolved?.[0]?.label || 'Team ' + teamId
    setBrowseMsg({ ok: true, text: 'Now watching ' + label })
    setBrowseTeams((prev) => prev?.map((t) => (t.team_id === teamId ? { ...t, watched: true } : t)))
    onTeamAdded()
  } catch (e) {
    setBrowseMsg({ ok: false, text: e.message })
  }
  setWatchingId(null)
}

const GRID_STYLE = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: '4px',
  marginTop: '0.5rem'
}

function BrowseStatusMsg({ msg }) {
  if (!msg) return null
  return (
    <p
      style={{
        fontSize: '0.82rem',
        color: msg.ok ? 'var(--green)' : 'var(--red)',
        margin: '0 0 0.5rem'
      }}
    >
      {msg.text}
    </p>
  )
}

function browseButtonLabel(browsing, browseTeams) {
  if (browsing) return 'Loading…'
  return browseTeams ? 'Hide' : 'Browse Play Cricket teams'
}

function TeamBrowserGrid({
  teams,
  watchingId,
  onWatch,
  showWatched,
  onToggleWatched,
  showArchived,
  onToggleArchived
}) {
  const unwatched = teams.filter((t) => !t.watched && !t.archived)
  const watched = teams.filter((t) => t.watched && !t.archived)
  const archivedTeams = teams.filter((t) => t.archived)
  return (
    <>
      {unwatched.length === 0 ? (
        <p style={{ fontSize: '0.82rem', color: 'var(--text2)', marginTop: '0.5rem' }}>
          All teams are already being watched.
        </p>
      ) : (
        <div style={GRID_STYLE}>
          {unwatched.map((t) => (
            <TeamCard key={t.team_id} t={t} watchingId={watchingId} onWatch={onWatch} />
          ))}
        </div>
      )}
      {watched.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <button className="secondary btn-xs" onClick={onToggleWatched}>
            {showWatched ? 'Hide already watching' : 'Show ' + watched.length + ' already watching'}
          </button>
          {showWatched && (
            <div style={GRID_STYLE}>
              {watched.map((t) => (
                <TeamCard key={t.team_id} t={t} watchingId={watchingId} onWatch={onWatch} />
              ))}
            </div>
          )}
        </div>
      )}
      {archivedTeams.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <button
            className="secondary btn-xs"
            style={{ color: 'var(--text2)' }}
            onClick={onToggleArchived}
          >
            {showArchived ? 'Hide archived' : 'Show ' + archivedTeams.length + ' archived'}
          </button>
          {showArchived && (
            <div style={GRID_STYLE}>
              {archivedTeams.map((t) => (
                <TeamCard key={t.team_id} t={t} watchingId={watchingId} onWatch={onWatch} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  )
}

function BrowseTeamsPanel({ onTeamAdded }) {
  const [browseTeams, setBrowseTeams] = useState(null)
  const [browsing, setBrowsing] = useState(false)
  const [browseMsg, setBrowseMsg] = useState(null)
  const [watchingId, setWatchingId] = useState(null)
  const [showWatched, setShowWatched] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const apiFetch = useApiFetch()

  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '0.85rem', fontWeight: 500 }}>Watched teams</span>
        <button
          className="secondary btn-sm"
          disabled={browsing}
          onClick={() =>
            browseTeams
              ? setBrowseTeams(null)
              : doLoadBrowseTeams(apiFetch, setBrowsing, setBrowseMsg, setBrowseTeams)
          }
        >
          {browseButtonLabel(browsing, browseTeams)}
        </button>
      </div>
      <BrowseStatusMsg msg={browseMsg} />
      {browseTeams && (
        <TeamBrowserGrid
          teams={browseTeams}
          watchingId={watchingId}
          onWatch={(id) =>
            doWatchTeam(id, apiFetch, setWatchingId, setBrowseMsg, setBrowseTeams, onTeamAdded)
          }
          showWatched={showWatched}
          onToggleWatched={() => setShowWatched((v) => !v)}
          showArchived={showArchived}
          onToggleArchived={() => setShowArchived((v) => !v)}
        />
      )}
    </div>
  )
}

function buildEnrichedTeams(status) {
  const statsMap = {}
  for (const b of status.byTeam || []) {
    const key = b.team_id + ':' + b.season_id
    if (!statsMap[key]) statsMap[key] = { pending: 0, done: 0, failed: 0, last_match_date: null }
    statsMap[key][b.status] = (statsMap[key][b.status] || 0) + b.n
    if (b.last_match_date && b.last_match_date > (statsMap[key].last_match_date || '')) {
      statsMap[key].last_match_date = b.last_match_date
    }
  }
  return status.teams.map((t) => ({ ...t, ...statsMap[t.team_id + ':' + t.season_id] }))
}

function cmpStr(a, b, asc) {
  return asc ? a.localeCompare(b) : b.localeCompare(a)
}

function cmpNum(a, b, asc) {
  return asc ? a - b : b - a
}

function sortWatchedSeasons(seasons, sortCol, sortDir) {
  const asc = sortDir === 'asc'
  const copy = [...seasons]
  if (sortCol === 'date')
    return copy.sort((a, b) => cmpStr(a.last_match_date || '', b.last_match_date || '', asc))
  if (sortCol === 'pending') return copy.sort((a, b) => cmpNum(a.pending || 0, b.pending || 0, asc))
  if (sortCol === 'done') return copy.sort((a, b) => cmpNum(a.done || 0, b.done || 0, asc))
  return copy
}

function WatchedTeamRow({ t, removeTeam }) {
  return (
    <tr style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '5px 10px' }}>
        {shortTeam(t.label) || t.label} '{shortYear(t.year)}
      </td>
      <td style={{ padding: '5px 10px', color: 'var(--text2)' }}>
        {formatDateShort(t.last_match_date) ?? '—'}
      </td>
      <td style={{ padding: '5px 10px', textAlign: 'right' }}>{t.pending ?? 0}</td>
      <td style={{ padding: '5px 10px', textAlign: 'right' }}>{t.done ?? 0}</td>
      <td style={{ padding: '5px 10px' }}>
        <button
          className="secondary"
          style={{
            fontSize: '0.72rem',
            padding: '1px 7px',
            color: 'var(--red)',
            borderColor: 'var(--red)'
          }}
          onClick={() => {
            if (window.confirm(`Remove ${t.label} '${shortYear(t.year)}?`)) removeTeam(t.id)
          }}
        >
          Remove
        </button>
      </td>
    </tr>
  )
}

function WatchedTeamsHeader({ sortCol, sortDir, onSort }) {
  const thStyle = (align) => ({ textAlign: align || 'left', padding: '6px 10px' })
  return (
    <thead>
      <tr>
        <th style={thStyle()}>Team / season</th>
        <SortTh
          col="date"
          label="Last match"
          sortCol={sortCol}
          sortDir={sortDir}
          onSort={onSort}
          style={thStyle()}
        />
        <SortTh
          col="pending"
          label="Pending"
          sortCol={sortCol}
          sortDir={sortDir}
          onSort={onSort}
          style={thStyle('right')}
        />
        <SortTh
          col="done"
          label="Done"
          sortCol={sortCol}
          sortDir={sortDir}
          onSort={onSort}
          style={thStyle('right')}
        />
        <th style={{ padding: '6px 10px' }}></th>
      </tr>
    </thead>
  )
}

function WatchedTeamsTable({
  status,
  filterGroups,
  setFilterGroups,
  sortCol,
  sortDir,
  onSort,
  removeTeam
}) {
  if (!status || status.teams.length === 0) {
    return (
      <span style={{ fontSize: '0.82rem', color: 'var(--text3)' }}>
        No teams in system yet — add via the URL field above.
      </span>
    )
  }
  const enrichedTeams = buildEnrichedTeams(status)
  const myGroups = enrichedTeams.map((t) => ({
    team_id: t.team_id,
    season_id: t.season_id,
    label: `${shortTeam(t.label) || t.label} '${shortYear(t.year)}`
  }))
  const pillValue = filterGroups ?? myGroups
  const visible =
    filterGroups == null
      ? enrichedTeams
      : filterGroups.length === 0
        ? []
        : enrichedTeams.filter((t) =>
            filterGroups.some((g) => g.team_id === t.team_id && g.season_id === t.season_id)
          )
  const sorted = sortWatchedSeasons(visible, sortCol, sortDir)
  return (
    <>
      {myGroups.length > 1 && (
        <div style={{ marginBottom: '0.75rem' }}>
          <TeamDropdown
            myGroups={myGroups}
            value={pillValue}
            onChange={setFilterGroups}
            isExplicit={filterGroups != null}
          />
        </div>
      )}
      <div
        className="card"
        style={{ padding: 0, overflowX: 'auto', border: '1px solid var(--border2)' }}
      >
        <table style={{ fontSize: '0.8rem', width: '100%' }}>
          <WatchedTeamsHeader sortCol={sortCol} sortDir={sortDir} onSort={onSort} />
          <tbody>
            {sorted.map((t) => (
              <WatchedTeamRow key={t.team_id + ':' + t.season_id} t={t} removeTeam={removeTeam} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function IngestControls({ running, rescanning, runMsg, rescanMsg, onDiscover, onRescan }) {
  const msgStyle = (ok) => ({
    fontSize: '0.82rem',
    color: ok ? 'var(--green)' : 'var(--red)',
    marginBottom: '0.5rem'
  })
  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 8,
          marginBottom: '1rem'
        }}
      >
        <h3 style={{ margin: 0 }}>Auto-ingest</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            className="secondary"
            style={{ fontSize: '0.82rem' }}
            disabled={running}
            onClick={onDiscover}
          >
            {running ? 'Running…' : 'Discover fixtures'}
          </button>
          <button
            className="secondary"
            style={{ fontSize: '0.82rem' }}
            disabled={rescanning}
            onClick={onRescan}
          >
            {rescanning ? 'Rescanning…' : 'Re-scan past seasons'}
          </button>
          <IngestNowButton />
        </div>
      </div>
      {runMsg && <p style={msgStyle(runMsg.ok)}>{runMsg.text}</p>}
      {rescanMsg && <p style={msgStyle(rescanMsg.ok)}>{rescanMsg.text}</p>}
    </>
  )
}

function AutoIngestPanel() {
  const [status, setStatus] = useState(null)
  const [runMsg, setRunMsg] = useState(null)
  const [running, setRunning] = useState(false)
  const [rescanning, setRescanning] = useState(false)
  const [rescanMsg, setRescanMsg] = useState(null)
  const [filterGroups, setFilterGroups] = useState(null)
  const [sortCol, setSortCol] = useState('date')
  const [sortDir, setSortDir] = useState('desc')
  const [removeMsg, setRemoveMsg] = useState(null)
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

  async function removeTeam(id) {
    setRemoveMsg(null)
    try {
      const res = await apiFetch('/api/admin/scheduler/teams/' + id, { method: 'DELETE' })
      if (!res.ok) throw new Error('Delete failed')
      loadStatus()
    } catch (e) {
      setRemoveMsg({ ok: false, text: e.message })
    }
  }

  async function run(endpoint) {
    setRunning(true)
    setRunMsg(null)
    try {
      await apiFetch('/api/admin/scheduler/' + endpoint, { method: 'POST' })
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
      setRescanMsg({ ok: true, text: 'Queued ' + (data.queued ?? 0) + ' new fixture(s).' })
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
      <IngestControls
        running={running}
        rescanning={rescanning}
        runMsg={runMsg}
        rescanMsg={rescanMsg}
        onDiscover={() => run('discover')}
        onRescan={rescan}
      />
      <BrowseTeamsPanel onTeamAdded={loadStatus} />
      {removeMsg && (
        <p style={{ fontSize: '0.82rem', color: 'var(--red)', marginBottom: '0.5rem' }}>
          {removeMsg.text}
        </p>
      )}
      <WatchedTeamsTable
        status={status}
        filterGroups={filterGroups}
        setFilterGroups={setFilterGroups}
        sortCol={sortCol}
        sortDir={sortDir}
        onSort={onSort}
        removeTeam={removeTeam}
      />
    </div>
  )
}

function matchTitle(f, pcId) {
  if (f.home_team && f.away_team) return `${shortTeam(f.home_team)} v ${shortTeam(f.away_team)}`
  return pcId
}

function ingestButtonLabel(state) {
  if (state === 'running') return 'Ingesting…'
  if (state === 'done') return 'Done'
  return 'Ingest'
}

function IngestBtn({ state, msg, onIngest, pcId }) {
  return (
    <td style={{ padding: '5px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
      {msg && (
        <span
          style={{
            fontSize: '0.75rem',
            marginRight: 8,
            color: state === 'error' ? 'var(--red)' : 'var(--green)'
          }}
        >
          {msg}
        </span>
      )}
      <button
        className="secondary btn-xs"
        disabled={state === 'running' || state === 'done'}
        onClick={() => onIngest(pcId)}
      >
        {ingestButtonLabel(state)}
      </button>
    </td>
  )
}

function PastPendingRow({ f, state, msg, onIngest }) {
  const pcId = String(f.play_cricket_id)
  return (
    <tr key={pcId} style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '5px 10px' }}>
        <a
          href={`https://${f.pcDomain ?? 'play-cricket.com'}/website/results/${pcId}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {pcId}
        </a>
      </td>
      <td style={{ padding: '5px 10px' }}>{matchTitle(f, pcId)}</td>
      <td style={{ padding: '5px 10px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
        {formatDateShort(f.match_date_iso) ?? '—'}
      </td>
      <td style={{ padding: '5px 10px', color: 'var(--text2)', whiteSpace: 'nowrap' }}>
        {f.ingest_after?.slice(0, 16).replace('T', ' ') ?? '—'}
      </td>
      <IngestBtn state={state} msg={msg} onIngest={onIngest} pcId={pcId} />
    </tr>
  )
}

function UpcomingFixtureRow({ j }) {
  return (
    <tr key={j.play_cricket_id} style={{ borderTop: '1px solid var(--border)' }}>
      <td style={{ padding: '5px 10px' }}>
        <a
          href={`https://${j.pcDomain ?? 'play-cricket.com'}/website/results/${j.play_cricket_id}`}
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
    </tr>
  )
}

function PastPendingSection({ past, ingesting, msgs, onIngest }) {
  return (
    <>
      <h3 style={{ marginBottom: '0.5rem' }}>Past matches — pending ingest</h3>
      <p style={{ fontSize: '0.82rem', color: 'var(--text2)', marginBottom: '0.75rem' }}>
        These matches have passed their scheduled ingest time but have not been ingested yet. Click{' '}
        <strong>Ingest</strong> to fetch each one now.
      </p>
      <div
        className="card"
        style={{
          padding: 0,
          overflowX: 'auto',
          border: '1px solid var(--border2)',
          marginBottom: '1.25rem'
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
                onIngest={onIngest}
              />
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function JobStatusTag({ job }) {
  if (!job.exists)
    return (
      <span className="tag tag-orange" style={{ fontSize: '0.72rem' }}>
        missing
      </span>
    )
  if (job.enabled === false)
    return (
      <span className="tag tag-orange" style={{ fontSize: '0.72rem' }}>
        disabled
      </span>
    )
  return (
    <span className="tag tag-green" style={{ fontSize: '0.72rem' }}>
      active
    </span>
  )
}

function ScheduleSection({ fixedJobs, hasUpcoming, syncing, syncMsg, onSync }) {
  const missingJobs = fixedJobs.filter((j) => !j.exists)
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '0.5rem' }}>
        <h3 style={{ margin: 0 }}>Ingest schedule</h3>
        <button className="secondary btn-xs" disabled={syncing} onClick={onSync}>
          {syncing ? 'Syncing…' : 'Sync cron jobs'}
        </button>
        {syncMsg && (
          <span
            style={{
              fontSize: '0.75rem',
              color: syncMsg.startsWith('Error') ? 'var(--red)' : 'var(--green)'
            }}
          >
            {syncMsg}
          </span>
        )}
      </div>
      {missingJobs.length > 0 && (
        <p style={{ fontSize: '0.82rem', color: 'var(--orange)', marginBottom: '0.75rem' }}>
          ⚠ Ingest cron job is missing from cron-job.org. Click <strong>Sync cron jobs</strong> to
          recreate it.
        </p>
      )}
      <div
        className="card"
        style={{
          padding: 0,
          overflowX: 'auto',
          border: '1px solid var(--border2)',
          marginBottom: hasUpcoming ? '1.25rem' : 0
        }}
      >
        <table style={{ fontSize: '0.8rem', width: '100%' }}>
          <thead>
            <tr>
              {['Schedule', 'Next run', 'Status'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '6px 10px' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fixedJobs.map((j) => (
              <tr key={j.key} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '5px 10px', fontVariantNumeric: 'tabular-nums' }}>
                  {j.label}
                </td>
                <td style={{ padding: '5px 10px', color: 'var(--text2)' }}>
                  {j.next_execution?.slice(0, 16).replace('T', ' ') ?? '—'}
                </td>
                <td style={{ padding: '5px 10px' }}>
                  <JobStatusTag job={j} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function UpcomingSection({ upcoming }) {
  return (
    <>
      <h3 style={{ marginBottom: '0.5rem' }}>Upcoming fixtures</h3>
      <div
        className="card"
        style={{ padding: 0, overflowX: 'auto', border: '1px solid var(--border2)' }}
      >
        <table style={{ fontSize: '0.8rem', width: '100%' }}>
          <thead>
            <tr>
              {['Fixture', 'Match', 'Match date', 'Ingest after'].map((h) => (
                <th key={h} style={{ textAlign: 'left', padding: '6px 10px' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {upcoming.map((j) => (
              <UpcomingFixtureRow key={j.play_cricket_id} j={j} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

async function doIngestOne(pcId, apiFetch, setIngesting, setMsgs, setPast) {
  setIngesting((s) => ({ ...s, [pcId]: 'running' }))
  setMsgs((m) => ({ ...m, [pcId]: null }))
  try {
    const res = await apiFetch('/api/admin/scheduler/ingest-one/' + pcId, { method: 'POST' })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed')
    setIngesting((s) => ({ ...s, [pcId]: 'done' }))
    setMsgs((m) => ({
      ...m,
      [pcId]: data.alreadyDone ? 'Already ingested — marked done' : 'Ingested ✓'
    }))
    setPast((p) => (p || []).filter((f) => String(f.play_cricket_id) !== String(pcId)))
  } catch (e) {
    setIngesting((s) => ({ ...s, [pcId]: 'error' }))
    setMsgs((m) => ({ ...m, [pcId]: e.message }))
  }
}

async function doSyncCronJobs(apiFetch, setSyncing, setSyncMsg, load) {
  if (!window.confirm('Delete all cron-job.org jobs and recreate the every-3-hours ingest job?'))
    return
  setSyncing(true)
  setSyncMsg(null)
  try {
    const res = await apiFetch('/api/admin/scheduler/sync-cron-jobs', { method: 'POST' })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed')
    setSyncMsg(
      'Done — deleted ' + data.deleted + ' old job(s), created ' + data.created + ' new job(s)'
    )
    load()
  } catch (e) {
    setSyncMsg('Error: ' + e.message)
  } finally {
    setSyncing(false)
  }
}

function CronJobsDisplay({
  past,
  fixedJobs,
  upcoming,
  ingesting,
  msgs,
  schedState,
  onIngest,
  onSync
}) {
  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      {past?.length > 0 && (
        <PastPendingSection past={past} ingesting={ingesting} msgs={msgs} onIngest={onIngest} />
      )}
      {fixedJobs?.length > 0 && (
        <ScheduleSection
          fixedJobs={fixedJobs}
          hasUpcoming={upcoming?.length > 0}
          syncing={schedState.syncing}
          syncMsg={schedState.syncMsg}
          onSync={onSync}
        />
      )}
      {upcoming?.length > 0 && <UpcomingSection upcoming={upcoming} />}
    </div>
  )
}

function CronJobsPanel() {
  const [fixedJobs, setFixedJobs] = useState(null)
  const [upcoming, setUpcoming] = useState(null)
  const [past, setPast] = useState(null)
  const [ingesting, setIngesting] = useState({})
  const [msgs, setMsgs] = useState({})
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState(null)
  const apiFetch = useApiFetch()

  function load() {
    apiFetch('/api/admin/scheduler/cron-jobs')
      .then((r) => r.json())
      .then((d) => {
        setFixedJobs(Array.isArray(d?.fixedJobs) ? d.fixedJobs : [])
        setUpcoming(Array.isArray(d?.upcomingFixtures) ? d.upcomingFixtures : [])
      })
      .catch(() => {
        setFixedJobs([])
        setUpcoming([])
      })
    apiFetch('/api/admin/scheduler/past-pending')
      .then((r) => r.json())
      .then((d) => setPast(Array.isArray(d) ? d : []))
      .catch(() => setPast([]))
  }
  useEffect(() => {
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!past?.length && !upcoming?.length && !fixedJobs?.length) return null

  return (
    <CronJobsDisplay
      past={past}
      fixedJobs={fixedJobs}
      upcoming={upcoming}
      ingesting={ingesting}
      msgs={msgs}
      schedState={{ syncing, syncMsg }}
      onIngest={(id) => doIngestOne(id, apiFetch, setIngesting, setMsgs, setPast)}
      onSync={() => doSyncCronJobs(apiFetch, setSyncing, setSyncMsg, load)}
    />
  )
}

function StaleFixtureRow({ r, checked, onToggle }) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: '0.82rem',
        cursor: 'pointer'
      }}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span style={{ color: 'var(--text3)', minWidth: 70 }}>{r.play_cricket_id}</span>
      <span style={{ flex: 1 }}>
        {shortTeam(r.home_team)} vs {shortTeam(r.away_team)}
        {r.match_date_iso ? ' · ' + formatDateShort(r.match_date_iso) : ''}
      </span>
      <span
        className={'tag tag-' + (r.status === 'failed' ? 'red' : 'orange')}
        style={{ fontSize: '0.7rem' }}
      >
        {r.status}
        {r.attempt_count > 0 ? ' (' + r.attempt_count + ')' : ''}
      </span>
      {r.error_msg && (
        <span
          style={{
            color: 'var(--red)',
            fontSize: '0.7rem',
            maxWidth: 180,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
          title={r.error_msg}
        >
          {r.error_msg}
        </span>
      )}
    </label>
  )
}

async function doIgnoreSelected(sel, apiFetch, setSaving, setMsg, setRows, setSel) {
  if (!sel.size) return
  setSaving(true)
  setMsg(null)
  try {
    const res = await apiFetch('/api/admin/scheduler/ignore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...sel] })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed')
    setRows((r) => r.filter((x) => !sel.has(x.play_cricket_id)))
    setSel(new Set())
    setMsg({
      error: false,
      text: data.ignored + ' fixture' + (data.ignored === 1 ? '' : 's') + ' ignored.'
    })
  } catch (e) {
    setMsg({ error: true, text: e.message })
  }
  setSaving(false)
}

function StaleActionsBar({ sel, rowCount, saving, msg, onToggleAll, onIgnore }) {
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: '0.75rem', alignItems: 'center' }}>
        <button className="secondary btn-sm" onClick={onToggleAll}>
          {sel.size === rowCount ? 'Deselect all' : 'Select all'}
        </button>
        <button disabled={!sel.size || saving} onClick={onIgnore} className="btn-sm">
          {saving ? 'Saving…' : 'Ignore ' + (sel.size || '') + ' selected'}
        </button>
      </div>
      {msg && (
        <p
          style={{
            fontSize: '0.82rem',
            color: msg.error ? 'var(--red)' : 'var(--green)',
            marginBottom: '0.5rem'
          }}
        >
          {msg.text}
        </p>
      )}
    </>
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

  if (!rows?.length) return null

  const toggleAll = () =>
    setSel((s) =>
      s.size === rows.length ? new Set() : new Set(rows.map((r) => r.play_cricket_id))
    )
  const toggleRow = (id) =>
    setSel((s) => {
      const n = new Set(s)
      s.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Stale / failed fixtures</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
        Pending fixtures older than 7 days, and fixtures that failed all retries. Mark as ignored to
        stop them appearing in the queue.
      </p>
      <StaleActionsBar
        sel={sel}
        rowCount={rows.length}
        saving={saving}
        msg={msg}
        onToggleAll={toggleAll}
        onIgnore={() => doIgnoreSelected(sel, apiFetch, setSaving, setMsg, setRows, setSel)}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.4rem',
          maxHeight: 300,
          overflowY: 'auto'
        }}
      >
        {rows.map((r) => (
          <StaleFixtureRow
            key={r.play_cricket_id}
            r={r}
            checked={sel.has(r.play_cricket_id)}
            onToggle={() => toggleRow(r.play_cricket_id)}
          />
        ))}
      </div>
    </div>
  )
}
