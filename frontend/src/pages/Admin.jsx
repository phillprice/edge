import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import {
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
import { shortTeam, formatDateShort, shortYear } from '../utils/cricket'
import UserAdmin from './UserAdmin'
import ClubAdmin from './ClubAdmin'
import TeamDropdown from '../components/TeamDropdown'
import DataTab from './admin/DataTab'
import PlayersTab from './admin/PlayersTab'
import SystemTab from './admin/SystemTab'
import ChangelogTab from './admin/ChangelogTab'
import IngestTab from './admin/IngestTab'
import ManualTab from './admin/ManualTab'

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
