import { useState, useEffect } from 'react'
import { X, Save, Check, Ban } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'

function teamKey(t) {
  return `${t.team_id}:${t.season_id}`
}

// Group flat (team_id, season_id) team rows into { team_id, label, seasons: [...] }.
function groupByTeam(teams) {
  const byId = {}
  for (const t of teams) {
    ;(byId[t.team_id] ??= { team_id: t.team_id, label: t.label, seasons: [] }).seasons.push(t)
  }
  return Object.values(byId)
}

function UserRow({ user, teams, onSaved }) {
  const apiFetch = useApiFetch()
  const [saving, setSaving] = useState(false)
  const [groups, setGroups] = useState(
    (user.accessGroups ?? []).map((g) => ({ team_id: g.team_id, season_id: g.season_id }))
  )
  const [hasChanges, setHasChanges] = useState(false)

  function toggle(t) {
    setGroups((prev) => {
      const exists = prev.some((g) => g.team_id === t.team_id && g.season_id === t.season_id)
      const next = exists
        ? prev.filter((g) => !(g.team_id === t.team_id && g.season_id === t.season_id))
        : [...prev, { team_id: t.team_id, season_id: t.season_id }]
      setHasChanges(
        JSON.stringify(next) !==
          JSON.stringify(
            (user.accessGroups ?? []).map((g) => ({ team_id: g.team_id, season_id: g.season_id }))
          )
      )
      return next
    })
  }

  async function save() {
    setSaving(true)
    try {
      const r = await apiFetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessGroups: groups })
      })
      if (!r.ok) throw new Error((await r.json()).error ?? 'Save failed')
      setHasChanges(false)
      onSaved()
    } catch (e) {
      alert(e.message)
    }
    setSaving(false)
  }

  async function saveFlag(updates) {
    await apiFetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    })
    onSaved()
  }

  const teamGroups = groupByTeam(teams)
  // Groups the user holds that no longer correspond to a known team (e.g. team removed).
  const orphanGroups = groups.filter(
    (g) => !teams.some((t) => t.team_id === g.team_id && t.season_id === g.season_id)
  )
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: '0.75rem',
          flexWrap: 'wrap'
        }}
      >
        <span style={{ fontWeight: 600, flex: 1 }}>{displayName}</span>
        <span style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>{user.email}</span>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.85rem',
            cursor: 'pointer'
          }}
        >
          <input
            type="checkbox"
            checked={user.canUpload}
            onChange={(e) => saveFlag({ canUpload: e.target.checked })}
          />
          Can upload
        </label>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: '0.85rem',
            cursor: 'pointer'
          }}
        >
          <input
            type="checkbox"
            checked={user.isSuperAdmin}
            onChange={(e) => saveFlag({ isSuperAdmin: e.target.checked })}
          />
          Super admin
        </label>
      </div>

      {/* Team access — grouped by team, years are toggle chips */}
      <div
        style={{
          fontSize: '0.82rem',
          fontWeight: 500,
          color: 'var(--text2)',
          marginBottom: '0.5rem'
        }}
      >
        Team access{' '}
        <span style={{ fontWeight: 400, color: 'var(--text3)' }}>
          — click a year to grant/revoke
        </span>
      </div>

      <div
        style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.5rem' }}
      >
        {teamGroups.length === 0 && (
          <span style={{ fontSize: '0.82rem', color: 'var(--text3)' }}>
            No teams in system yet — add via Admin → Scheduler.
          </span>
        )}
        {teamGroups.map((team) => (
          <div
            key={team.team_id}
            style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}
          >
            <span style={{ fontSize: '0.82rem', fontWeight: 500, minWidth: 0 }}>{team.label}</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {team.seasons
                .slice()
                .sort((a, b) => (a.year || '').localeCompare(b.year || ''))
                .map((s) => {
                  const active = groups.some(
                    (g) => g.team_id === s.team_id && g.season_id === s.season_id
                  )
                  return (
                    <button
                      key={teamKey(s)}
                      onClick={() => toggle(s)}
                      className={active ? 'pill active' : 'pill'}
                      style={{ fontSize: '0.78rem' }}
                    >
                      {s.year || `season ${s.season_id}`}
                    </button>
                  )
                })}
            </div>
          </div>
        ))}
      </div>

      {/* Orphan groups (team no longer in system) — show so they can be removed */}
      {orphanGroups.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: '0.5rem' }}>
          {orphanGroups.map((g) => (
            <span
              key={teamKey(g)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: 'var(--surface-alt)',
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: '0.82rem'
              }}
            >
              team {g.team_id} / season {g.season_id}
              <button
                onClick={() => toggle(g)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  lineHeight: 1,
                  color: 'var(--dim)'
                }}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {groups.length === 0 && (
        <div style={{ fontSize: '0.78rem', color: 'var(--text3)', marginBottom: '0.5rem' }}>
          No teams selected — user sees nothing.
        </div>
      )}

      {hasChanges && (
        <button
          onClick={save}
          disabled={saving}
          style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <Save size={12} />
          {saving ? 'Saving…' : 'Save'}
        </button>
      )}
    </div>
  )
}

function RequestsPanel({ teams, onApproved }) {
  const apiFetch = useApiFetch()
  const [requests, setRequests] = useState([])
  const [acting, setActing] = useState(null)

  async function loadRequests() {
    const r = await apiFetch('/api/access-requests?status=pending')
    if (r.ok) setRequests(await r.json())
  }

  useEffect(() => {
    loadRequests()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function act(id, action) {
    setActing(id)
    await apiFetch(`/api/access-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    })
    await loadRequests()
    if (action === 'approve') onApproved()
    setActing(null)
  }

  if (!requests.length)
    return <p style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>No pending requests.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {requests.map((r) => {
        const t = teams.find((t) => t.team_id === r.team_id && t.season_id === r.season_id)
        const teamLbl = t
          ? t.year
            ? `${t.label} ${t.year}`
            : t.label
          : r.team_label
            ? `${r.team_label}${r.team_year ? ' ' + r.team_year : ''}`
            : `team ${r.team_id}`
        return (
          <div
            key={r.id}
            className="card"
            style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>
                {r.user_name || r.user_email || r.clerk_user_id}
              </div>
              {r.user_name && r.user_email && (
                <div style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>{r.user_email}</div>
              )}
              <div style={{ fontSize: '0.82rem', color: 'var(--text2)', marginTop: 2 }}>
                requesting: {teamLbl}
              </div>
            </div>
            <button
              onClick={() => act(r.id, 'approve')}
              disabled={acting === r.id}
              style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 4 }}
            >
              <Check size={13} />
              Approve
            </button>
            <button
              className="secondary"
              onClick={() => act(r.id, 'deny')}
              disabled={acting === r.id}
              style={{
                fontSize: '0.82rem',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                color: 'var(--red)',
                borderColor: 'var(--red)'
              }}
            >
              <Ban size={13} />
              Deny
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default function UserAdmin() {
  const apiFetch = useApiFetch()
  const [users, setUsers] = useState([])
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('requests')

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [ur, tr] = await Promise.all([
        apiFetch('/api/admin/users'),
        apiFetch('/api/admin/teams')
      ])
      if (!ur.ok) throw new Error((await ur.json()).error ?? 'Failed to load users')
      const [ud, td] = await Promise.all([ur.json(), tr.json()])
      setUsers(ud)
      setTeams(Array.isArray(td) ? td : [])
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page">
      <h1 style={{ marginBottom: '1rem' }}>Admin</h1>

      <div className="tabs" style={{ marginBottom: '1.5rem' }}>
        <button
          className={`tab${tab === 'requests' ? ' active' : ''}`}
          onClick={() => setTab('requests')}
        >
          Access requests
        </button>
        <button
          className={`tab${tab === 'users' ? ' active' : ''}`}
          onClick={() => setTab('users')}
        >
          Users
        </button>
      </div>

      {error && <p style={{ color: 'var(--red)', marginBottom: '1rem' }}>{error}</p>}
      {loading && <p style={{ color: 'var(--text2)' }}>Loading…</p>}

      {tab === 'requests' && !loading && <RequestsPanel teams={teams} onApproved={load} />}

      {tab === 'users' && !loading && (
        <>
          <p style={{ color: 'var(--text2)', margin: '0 0 1rem', fontSize: '0.88rem' }}>
            Super admins see everything. Users with no teams see nothing. Teams are added under
            Admin → Scheduler.
          </p>
          {users.map((u) => (
            <UserRow key={u.id} user={u} teams={teams} onSaved={load} />
          ))}
        </>
      )}
    </div>
  )
}
