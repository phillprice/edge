import { useState, useEffect } from 'react'
import { X, Save, Check, Ban } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'

function teamKey(t) {
  return `${t.team_id}:${t.season_id}`
}

// Group flat (team_id, season_id) team rows into { team_id, label, seasons: [...] }, sorted A→Z.
function groupByTeam(teams) {
  const byId = {}
  for (const t of teams) {
    ;(byId[t.team_id] ??= { team_id: t.team_id, label: t.label, seasons: [] }).seasons.push(t)
  }
  return Object.values(byId).sort((a, b) => (a.label || '').localeCompare(b.label || ''))
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
    <div className="card" style={{ padding: '0.6rem 0.85rem' }}>
      {/* Name row */}
      <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {displayName}
      </div>
      {/* Email + flags row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: '0.4rem' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
          {user.email}
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
          <input type="checkbox" checked={user.canUpload} onChange={(e) => saveFlag({ canUpload: e.target.checked })} />
          Upload
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
          <input type="checkbox" checked={user.isSuperAdmin} onChange={(e) => saveFlag({ isSuperAdmin: e.target.checked })} />
          Super admin
        </label>
      </div>

      {/* Team access — all teams inline, separator between them */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 6px' }}>
        {teamGroups.length === 0 && (
          <span style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>
            No teams — add via Scheduler.
          </span>
        )}
        {teamGroups.map((team, i) => (
          <>
            {i > 0 && (
              <span key={`sep-${team.team_id}`} style={{ color: 'var(--border2)', fontSize: '0.75rem' }}>·</span>
            )}
            <span
              key={team.team_id}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}
            >
            <span style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>{team.label}</span>
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
                    style={{ fontSize: '0.72rem', padding: '1px 7px' }}
                  >
                    {s.year || `s${s.season_id}`}
                  </button>
                )
              })}
            </span>
          </>
        ))}
      </div>

      {/* Orphan groups */}
      {orphanGroups.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: '0.3rem' }}>
          {orphanGroups.map((g) => (
            <span
              key={teamKey(g)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: 'var(--surface-alt)',
                borderRadius: 4,
                padding: '1px 6px',
                fontSize: '0.75rem'
              }}
            >
              team {g.team_id} / s{g.season_id}
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
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {groups.length === 0 && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text3)', marginTop: '0.25rem' }}>
          No teams — user sees nothing.
        </div>
      )}

      {hasChanges && (
        <button
          onClick={save}
          disabled={saving}
          style={{
            marginTop: '0.4rem',
            fontSize: '0.78rem',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 10px'
          }}
        >
          <Save size={11} />
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
    <div>
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
        <button
          className={tab === 'requests' ? '' : 'secondary'}
          onClick={() => setTab('requests')}
          style={{ fontSize: '0.82rem', padding: '3px 12px' }}
        >
          Access requests
        </button>
        <button
          className={tab === 'users' ? '' : 'secondary'}
          onClick={() => setTab('users')}
          style={{ fontSize: '0.82rem', padding: '3px 12px' }}
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
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
              gap: '0.6rem'
            }}
          >
            {users.map((u) => (
              <UserRow key={u.id} user={u} teams={teams} onSaved={load} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
