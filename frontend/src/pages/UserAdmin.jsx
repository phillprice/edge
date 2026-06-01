import { useState, useEffect } from 'react'
import { Trash2, Plus, Save } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'

function teamKey(g) { return `${g.team_id}:${g.season_id}` }
function groupKey(g) { return `${g.team_id}:${g.season_id}` }

export default function UserAdmin() {
  const apiFetch = useApiFetch()
  const [users,      setUsers]      = useState([])
  const [teams,      setTeams]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(null)
  const [error,      setError]      = useState(null)
  const [editGroups, setEditGroups] = useState({})

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [ur, tr] = await Promise.all([
        apiFetch('/api/admin/users'),
        apiFetch('/api/admin/teams'),
      ])
      if (!ur.ok) throw new Error((await ur.json()).error ?? 'Failed to load users')
      const [userData, teamData] = await Promise.all([ur.json(), tr.json()])
      setUsers(userData)
      setTeams(Array.isArray(teamData) ? teamData : [])
      const eg = {}
      for (const u of userData) eg[u.id] = (u.accessGroups ?? []).map(g => ({ team_id: g.team_id, season_id: g.season_id }))
      setEditGroups(eg)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveUser(userId, updates) {
    setSaving(userId)
    setError(null)
    try {
      const r = await apiFetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!r.ok) throw new Error((await r.json()).error ?? 'Save failed')
      await load()
    } catch (e) {
      setError(e.message)
    }
    setSaving(null)
  }

  function addGroup(userId) {
    const first = teams[0]
    if (!first) return
    const g = { team_id: first.team_id, season_id: first.season_id }
    setEditGroups(prev => ({ ...prev, [userId]: [...(prev[userId] ?? []), g] }))
  }

  function removeGroup(userId, idx) {
    setEditGroups(prev => ({ ...prev, [userId]: prev[userId].filter((_, i) => i !== idx) }))
  }

  function setGroupValue(userId, idx, team_id, season_id) {
    setEditGroups(prev => ({
      ...prev,
      [userId]: prev[userId].map((g, i) => i === idx ? { team_id: Number(team_id), season_id: Number(season_id) } : g),
    }))
  }

  function teamLabel(t) {
    return `${t.label}${t.year ? ` (${t.year})` : ''}`
  }

  function resolveLabel(g) {
    const t = teams.find(t => t.team_id === g.team_id && t.season_id === g.season_id)
    return t ? teamLabel(t) : `team ${g.team_id} / season ${g.season_id}`
  }

  return (
    <div className="page">
      <h1>User access</h1>
      <p style={{ color: 'var(--text2)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        Assign teams to users. Super admins see everything. Users with no groups see nothing.
      </p>

      {error   && <p style={{ color: 'var(--red)', marginBottom: '1rem' }}>{error}</p>}
      {loading && <p style={{ color: 'var(--text2)' }}>Loading…</p>}

      {!loading && teams.length === 0 && (
        <p style={{ color: 'var(--text2)', fontSize: '0.85rem' }}>
          No watched teams configured. Add teams via the Upload → Auto-ingest section first.
        </p>
      )}

      {users.map(u => {
        const groups      = editGroups[u.id] ?? []
        const displayName = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email
        const hasChanges  = JSON.stringify(groups) !== JSON.stringify(
          (u.accessGroups ?? []).map(g => ({ team_id: g.team_id, season_id: g.season_id }))
        )

        return (
          <div key={u.id} className="card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, flex: 1 }}>{displayName}</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>{u.email}</span>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={u.canUpload}
                  onChange={e => saveUser(u.id, { canUpload: e.target.checked })} />
                Can upload
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={u.isSuperAdmin}
                  onChange={e => saveUser(u.id, { isSuperAdmin: e.target.checked })} />
                Super admin
              </label>
            </div>

            <div style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text2)', marginBottom: '0.4rem' }}>
              Team access
            </div>
            {groups.length === 0 && (
              <p style={{ fontSize: '0.82rem', color: 'var(--text3)', marginBottom: '0.4rem' }}>
                No teams — user sees nothing
              </p>
            )}
            {groups.map((g, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <select
                  value={groupKey(g)}
                  onChange={e => {
                    const [tid, sid] = e.target.value.split(':')
                    setGroupValue(u.id, i, tid, sid)
                  }}>
                  {/* Show current value even if it's no longer a watched team */}
                  {!teams.find(t => teamKey(t) === groupKey(g)) && (
                    <option value={groupKey(g)}>{resolveLabel(g)}</option>
                  )}
                  {teams.map(t => (
                    <option key={teamKey(t)} value={teamKey(t)}>{teamLabel(t)}</option>
                  ))}
                </select>
                <button className="icon-btn" onClick={() => removeGroup(u.id, i)} title="Remove">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}

            <div style={{ display: 'flex', gap: 8, marginTop: '0.5rem' }}>
              {teams.length > 0 && (
                <button className="secondary"
                  style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 4 }}
                  onClick={() => addGroup(u.id)}>
                  <Plus size={12} />Add team
                </button>
              )}
              {hasChanges && (
                <button
                  style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 4 }}
                  disabled={saving === u.id}
                  onClick={() => saveUser(u.id, { accessGroups: groups })}>
                  <Save size={12} />
                  {saving === u.id ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
