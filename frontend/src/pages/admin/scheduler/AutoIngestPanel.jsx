import { useState, useEffect } from 'react'
import { useApiFetch } from '../../../hooks/useApiFetch'
import { shortTeam, formatDateShort, shortYear } from '../../../utils/cricket'
import TeamDropdown from '../../../components/TeamDropdown'

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

export default function AutoIngestPanel() {
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
