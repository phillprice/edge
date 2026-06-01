import { useState, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { Trash2, Plus, Save } from 'lucide-react'

const TEAM_OPTIONS = ['whirlwind', 'hurricane']

function yearRange() {
  const y = new Date().getFullYear()
  return Array.from({ length: 6 }, (_, i) => String(y - 2 + i))
}

export default function UserAdmin() {
  const { getToken } = useAuth()
  const [users, setUsers]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(null)
  const [error, setError]       = useState(null)
  const [editGroups, setEditGroups] = useState({})  // userId -> [{team, year}]

  async function load() {
    setLoading(true)
    try {
      const token = await getToken()
      const r = await fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } })
      if (!r.ok) throw new Error(await r.text())
      const data = await r.json()
      setUsers(data)
      const eg = {}
      for (const u of data) eg[u.id] = u.accessGroups ?? []
      setEditGroups(eg)
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function saveUser(userId, updates) {
    setSaving(userId)
    setError(null)
    try {
      const token = await getToken()
      const r = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!r.ok) throw new Error(await r.text())
      await load()
    } catch (e) {
      setError(e.message)
    }
    setSaving(null)
  }

  function addGroup(userId) {
    setEditGroups(prev => ({
      ...prev,
      [userId]: [...(prev[userId] ?? []), { team: TEAM_OPTIONS[0], year: String(new Date().getFullYear()) }],
    }))
  }

  function removeGroup(userId, idx) {
    setEditGroups(prev => ({
      ...prev,
      [userId]: prev[userId].filter((_, i) => i !== idx),
    }))
  }

  function updateGroup(userId, idx, field, value) {
    setEditGroups(prev => {
      const groups = prev[userId].map((g, i) => i === idx ? { ...g, [field]: value } : g)
      return { ...prev, [userId]: groups }
    })
  }

  const years = yearRange()

  if (loading) return <div className="container"><p>Loading users…</p></div>
  if (error)   return <div className="container"><p style={{ color: 'var(--danger)' }}>Error: {error}</p></div>

  return (
    <div className="container" style={{ maxWidth: 860 }}>
      <h2 style={{ marginBottom: '1.5rem' }}>User Access</h2>
      <p style={{ color: 'var(--text2)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
        Assign team/year access groups to users. Super admins see all data regardless of groups.
        Users with no groups set also see all data (legacy behaviour).
      </p>
      {users.map(u => {
        const groups = editGroups[u.id] ?? []
        const displayName = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email
        const hasChanges = JSON.stringify(groups) !== JSON.stringify(u.accessGroups ?? [])
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

            <div style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--text2)', marginBottom: '0.4rem' }}>Access groups</div>
            {groups.length === 0 && (
              <p style={{ fontSize: '0.82rem', color: 'var(--text3)', marginBottom: '0.4rem' }}>
                No groups — user sees all data
              </p>
            )}
            {groups.map((g, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                <select value={g.team} onChange={e => updateGroup(u.id, i, 'team', e.target.value)}
                  style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}>
                  {TEAM_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <select value={g.year} onChange={e => updateGroup(u.id, i, 'year', e.target.value)}
                  style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}>
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
                <button className="icon-btn" onClick={() => removeGroup(u.id, i)} title="Remove group">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: '0.5rem' }}>
              <button className="btn-secondary" style={{ fontSize: '0.82rem', padding: '4px 10px' }}
                onClick={() => addGroup(u.id)}>
                <Plus size={12} style={{ marginRight: 4 }} />Add group
              </button>
              {hasChanges && (
                <button className="btn-primary" style={{ fontSize: '0.82rem', padding: '4px 10px' }}
                  disabled={saving === u.id}
                  onClick={() => saveUser(u.id, { accessGroups: groups })}>
                  <Save size={12} style={{ marginRight: 4 }} />
                  {saving === u.id ? 'Saving…' : 'Save groups'}
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
