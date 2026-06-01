import { useState, useEffect } from 'react'
import { X, Save, Check, Ban } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'

function teamKey(t) { return `${t.team_id}:${t.season_id}` }
function teamLabel(t) { return t.year ? `${t.label} ${t.year}` : t.label }

function RegisterTeamForm({ onRegistered }) {
  const apiFetch = useApiFetch()
  const [url,  setUrl]  = useState('')
  const [year, setYear] = useState('')
  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState(null)

  async function submit(e) {
    e.preventDefault()
    if (!url.trim()) return
    setBusy(true); setErr(null)
    try {
      const r = await apiFetch('/api/admin/teams/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), year: year.trim() || undefined }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      setUrl(''); setYear('')
      onRegistered()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div style={{ marginTop: '0.5rem', padding: '0.75rem', background: 'var(--surface-alt)', borderRadius: 8 }}>
      <div style={{ fontSize: '0.82rem', color: 'var(--text2)', marginBottom: 6 }}>
        Register a past season — paste its Play Cricket URL to make it available in the team list
      </div>
      <form onSubmit={submit} style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input value={url} onChange={e => setUrl(e.target.value)}
          placeholder="https://whcc.play-cricket.com/Matches?…&team_id=…&season_id=…"
          style={{ flex: 1, minWidth: 220, fontSize: '0.82rem' }} />
        <input value={year} onChange={e => setYear(e.target.value)}
          placeholder="Year (e.g. 2025)" style={{ width: 110, fontSize: '0.82rem' }} />
        <button type="submit" disabled={busy || !url.trim()} style={{ fontSize: '0.82rem' }}>
          {busy ? 'Adding…' : 'Register'}
        </button>
      </form>
      {err && <div style={{ color: 'var(--red)', fontSize: '0.78rem', marginTop: 4 }}>{err}</div>}
    </div>
  )
}

function UserRow({ user, teams, onSaved }) {
  const apiFetch  = useApiFetch()
  const [saving,  setSaving]  = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [groups,  setGroups]  = useState(
    (user.accessGroups ?? []).map(g => ({ team_id: g.team_id, season_id: g.season_id }))
  )
  const [hasChanges, setHasChanges] = useState(false)

  function toggle(t) {
    setGroups(prev => {
      const exists = prev.some(g => g.team_id === t.team_id && g.season_id === t.season_id)
      const next = exists
        ? prev.filter(g => !(g.team_id === t.team_id && g.season_id === t.season_id))
        : [...prev, { team_id: t.team_id, season_id: t.season_id }]
      setHasChanges(JSON.stringify(next) !== JSON.stringify(
        (user.accessGroups ?? []).map(g => ({ team_id: g.team_id, season_id: g.season_id }))
      ))
      return next
    })
  }

  async function save() {
    setSaving(true)
    try {
      const r = await apiFetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessGroups: groups }),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? 'Save failed')
      setHasChanges(false)
      onSaved()
    } catch (e) { alert(e.message) }
    setSaving(false)
  }

  async function saveFlag(updates) {
    await apiFetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    onSaved()
  }

  const available = teams.filter(t => !groups.some(g => g.team_id === t.team_id && g.season_id === t.season_id))
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email

  return (
    <div className="card" style={{ marginBottom: '1rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '0.75rem', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, flex: 1 }}>{displayName}</span>
        <span style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>{user.email}</span>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={user.canUpload} onChange={e => saveFlag({ canUpload: e.target.checked })} />
          Can upload
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={user.isSuperAdmin} onChange={e => saveFlag({ isSuperAdmin: e.target.checked })} />
          Super admin
        </label>
      </div>

      {/* Team access */}
      <div style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text2)', marginBottom: '0.4rem' }}>Team access</div>

      {/* Current access tags */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: '0.5rem', minHeight: 28 }}>
        {groups.length === 0 && <span style={{ fontSize: '0.82rem', color: 'var(--text3)' }}>No teams — user sees nothing</span>}
        {groups.map(g => {
          const t = teams.find(t => t.team_id === g.team_id && t.season_id === g.season_id)
          return (
            <span key={teamKey(g)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: 'var(--surface-alt)', borderRadius: 4, padding: '2px 8px',
              fontSize: '0.82rem',
            }}>
              {t ? teamLabel(t) : `team ${g.team_id} / season ${g.season_id}`}
              <button onClick={() => toggle(t ?? g)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: 'var(--dim)' }}>
                <X size={11} />
              </button>
            </span>
          )
        })}
      </div>

      {/* Add team dropdown */}
      {available.length > 0 && (
        <div style={{ position: 'relative', display: 'inline-block', marginBottom: '0.5rem' }}>
          <select
            value=""
            onChange={e => {
              const [tid, sid] = e.target.value.split(':')
              const t = teams.find(t => t.team_id === Number(tid) && t.season_id === Number(sid))
              if (t) toggle(t)
            }}
            style={{ fontSize: '0.82rem', paddingRight: 24 }}>
            <option value="">+ Add team…</option>
            {available.map(t => <option key={teamKey(t)} value={teamKey(t)}>{teamLabel(t)}</option>)}
          </select>
        </div>
      )}

      {hasChanges && (
        <button onClick={save} disabled={saving}
          style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Save size={12} />{saving ? 'Saving…' : 'Save'}
        </button>
      )}
    </div>
  )
}

function RequestsPanel({ teams, onApproved }) {
  const apiFetch  = useApiFetch()
  const [requests, setRequests] = useState([])
  const [acting,   setActing]   = useState(null)

  async function loadRequests() {
    const r = await apiFetch('/api/access-requests?status=pending')
    if (r.ok) setRequests(await r.json())
  }

  useEffect(() => { loadRequests() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function act(id, action) {
    setActing(id)
    await apiFetch(`/api/access-requests/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    await loadRequests()
    if (action === 'approve') onApproved()
    setActing(null)
  }

  if (!requests.length) return <p style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>No pending requests.</p>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {requests.map(r => {
        const t = teams.find(t => t.team_id === r.team_id && t.season_id === r.season_id)
        const teamLbl = t ? (t.year ? `${t.label} ${t.year}` : t.label) : (r.team_label ? `${r.team_label}${r.team_year ? ' ' + r.team_year : ''}` : `team ${r.team_id}`)
        return (
          <div key={r.id} className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{r.user_name || r.user_email || r.clerk_user_id}</div>
              {r.user_name && r.user_email && <div style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>{r.user_email}</div>}
              <div style={{ fontSize: '0.82rem', color: 'var(--text2)', marginTop: 2 }}>requesting: {teamLbl}</div>
            </div>
            <button onClick={() => act(r.id, 'approve')} disabled={acting === r.id}
              style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Check size={13} />Approve
            </button>
            <button className="secondary" onClick={() => act(r.id, 'deny')} disabled={acting === r.id}
              style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 4, color: 'var(--red)', borderColor: 'var(--red)' }}>
              <Ban size={13} />Deny
            </button>
          </div>
        )
      })}
    </div>
  )
}

export default function UserAdmin() {
  const apiFetch = useApiFetch()
  const [users,   setUsers]   = useState([])
  const [teams,   setTeams]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [tab,     setTab]     = useState('requests')
  const [showRegister, setShowRegister] = useState(false)

  async function load() {
    setLoading(true); setError(null)
    try {
      const [ur, tr] = await Promise.all([apiFetch('/api/admin/users'), apiFetch('/api/admin/teams')])
      if (!ur.ok) throw new Error((await ur.json()).error ?? 'Failed to load users')
      const [ud, td] = await Promise.all([ur.json(), tr.json()])
      setUsers(ud)
      setTeams(Array.isArray(td) ? td : [])
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem', flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Admin</h1>
        {tab === 'users' && (
          <button className="secondary" style={{ fontSize: '0.82rem', marginLeft: 'auto' }}
            onClick={() => setShowRegister(s => !s)}>
            {showRegister ? 'Hide' : '+ Register past season'}
          </button>
        )}
      </div>

      <div className="tabs" style={{ marginBottom: '1.5rem' }}>
        <button className={`tab${tab === 'requests' ? ' active' : ''}`} onClick={() => setTab('requests')}>Access requests</button>
        <button className={`tab${tab === 'users'    ? ' active' : ''}`} onClick={() => setTab('users')}>Users</button>
      </div>

      {error   && <p style={{ color: 'var(--red)', marginBottom: '1rem' }}>{error}</p>}
      {loading && <p style={{ color: 'var(--text2)' }}>Loading…</p>}

      {tab === 'requests' && !loading && (
        <RequestsPanel teams={teams} onApproved={load} />
      )}

      {tab === 'users' && !loading && (
        <>
          {showRegister && <RegisterTeamForm onRegistered={() => { load(); setShowRegister(false) }} />}
          <p style={{ color: 'var(--text2)', margin: '0 0 1rem', fontSize: '0.88rem' }}>
            Super admins see everything. Users with no teams see nothing.
          </p>
          {teams.length === 0 && (
            <p style={{ color: 'var(--text2)', fontSize: '0.85rem' }}>No teams in system yet — add via Upload → Auto-ingest or register a past season above.</p>
          )}
          {users.map(u => <UserRow key={u.id} user={u} teams={teams} onSaved={load} />)}
        </>
      )}
    </div>
  )
}
