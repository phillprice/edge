import { useState, useEffect } from 'react'
import { X, Save, Check, Ban, Link, Copy, Trash2 } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'
import { shortYear } from '../utils/cricket'

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
      <div
        style={{
          fontWeight: 600,
          fontSize: '0.9rem',
          marginBottom: '0.15rem',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {displayName}
      </div>
      {/* Email + flags row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: '0.4rem'
        }}
      >
        <span
          style={{
            fontSize: '0.75rem',
            color: 'var(--text3)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            minWidth: 0
          }}
        >
          {user.email}
        </span>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: '0.78rem',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0
          }}
        >
          <input
            type="checkbox"
            checked={user.canUpload}
            onChange={(e) => saveFlag({ canUpload: e.target.checked })}
          />
          Upload
        </label>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: '0.78rem',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flexShrink: 0
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

      {/* Team access — two-column grid, one team per row */}
      {teamGroups.length === 0 ? (
        <span style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>
          No teams — add via Scheduler.
        </span>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px' }}>
          {teamGroups.map((team) => (
            <div
              key={team.team_id}
              style={{ display: 'flex', alignItems: 'center', gap: 3, minWidth: 0 }}
            >
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text3)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flexShrink: 1
                }}
              >
                {team.label}
              </span>
              <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
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
                        {s.year ? `'${shortYear(s.year)}` : `s${s.season_id}`}
                      </button>
                    )
                  })}
              </div>
            </div>
          ))}
        </div>
      )}

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
            ? `${t.label} '${shortYear(t.year)}`
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

function ActiveInviteCard({ inv, copied, onCopy, onRevoke }) {
  const url = `${window.location.origin}/invite?token=${inv.token}`
  const expires = new Date(inv.expiresAt)
  const daysLeft = Math.ceil((expires - Date.now()) / 86400_000)
  return (
    <div
      className="card"
      style={{ padding: '0.5rem 0.75rem', display: 'flex', alignItems: 'center', gap: 8 }}
    >
      <span
        style={{
          fontFamily: 'monospace',
          fontSize: '0.75rem',
          color: 'var(--text3)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {url}
      </span>
      <span style={{ fontSize: '0.72rem', color: 'var(--text3)', whiteSpace: 'nowrap' }}>
        {daysLeft}d left
      </span>
      <button
        onClick={() => onCopy(inv.token)}
        style={{
          fontSize: '0.78rem',
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          padding: '2px 8px',
          whiteSpace: 'nowrap'
        }}
      >
        <Copy size={12} />
        {copied === inv.token ? 'Copied!' : 'Copy'}
      </button>
      <button
        onClick={() => onRevoke(inv.token)}
        className="secondary"
        style={{
          fontSize: '0.78rem',
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          padding: '2px 8px',
          color: 'var(--red)',
          borderColor: 'var(--red)'
        }}
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}

function InvitesPanel() {
  const apiFetch = useApiFetch()
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(null)

  async function load() {
    setLoading(true)
    const r = await apiFetch('/api/admin/invites')
    if (r.ok) setInvites(await r.json())
    setLoading(false)
  }

  async function generate() {
    setGenerating(true)
    const r = await apiFetch('/api/admin/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    })
    if (r.ok) await load()
    setGenerating(false)
  }

  async function revoke(token) {
    await apiFetch(`/api/admin/invites/${token}`, { method: 'DELETE' })
    await load()
  }

  function copyLink(token) {
    const url = `${window.location.origin}/invite?token=${token}`
    navigator.clipboard.writeText(url).then(() => {
      setCopied(token)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  useEffect(() => {
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const active = invites.filter((i) => !i.usedAt && new Date(i.expiresAt) > new Date())
  const used = invites.filter((i) => i.usedAt)
  const usedSection = used.length > 0 ? (
    <div>
      <p style={{ fontSize: '0.78rem', color: 'var(--text3)', marginBottom: 4 }}>Used</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {used.map((inv) => (
          <div key={inv.token} style={{ fontSize: '0.78rem', color: 'var(--text3)', padding: '2px 0' }}>
            Used {new Date(inv.usedAt).toLocaleDateString()} by {inv.usedBy ?? 'unknown'}
          </div>
        ))}
      </div>
    </div>
  ) : null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem' }}>
        <p style={{ color: 'var(--text2)', fontSize: '0.85rem', margin: 0, flex: 1 }}>
          Each link is single-use and expires in 7 days. Share it with the person joining your club.
        </p>
        <button
          onClick={generate}
          disabled={generating}
          style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}
        >
          <Link size={13} />
          {generating ? 'Generating…' : 'New invite link'}
        </button>
      </div>
      {loading && <p style={{ color: 'var(--text2)', fontSize: '0.85rem' }}>Loading…</p>}
      {active.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: '1rem' }}>
          {active.map((inv) => (
            <ActiveInviteCard key={inv.token} inv={inv} copied={copied} onCopy={copyLink} onRevoke={revoke} />
          ))}
        </div>
      )}
      {!loading && active.length === 0 && (
        <p style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>No active invite links.</p>
      )}
      {usedSection}
    </div>
  )
}

function UsersTab({ users, teams, onSaved }) {
  return (
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
          <UserRow key={u.id} user={u} teams={teams} onSaved={onSaved} />
        ))}
      </div>
    </>
  )
}

function renderInvitesTab() {
  return <InvitesPanel />
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
        <button
          className={tab === 'invites' ? '' : 'secondary'}
          onClick={() => setTab('invites')}
          style={{ fontSize: '0.82rem', padding: '3px 12px' }}
        >
          Invite links
        </button>
      </div>

      {error && <p style={{ color: 'var(--red)', marginBottom: '1rem' }}>{error}</p>}
      {loading && <p style={{ color: 'var(--text2)' }}>Loading…</p>}

      {tab === 'requests' && !loading && <RequestsPanel teams={teams} onApproved={load} />}
      {tab === 'invites' && renderInvitesTab()}

      {tab === 'users' && !loading && (
        <UsersTab users={users} teams={teams} onSaved={load} />
      )}
    </div>
  )
}
