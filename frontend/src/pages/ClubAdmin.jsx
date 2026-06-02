import { useState, useEffect } from 'react'
import { X, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'

function ColorSwatch({ color }) {
  return <span style={{ display: 'inline-block', width: 16, height: 16, borderRadius: 3, background: color, border: '1px solid var(--border)', verticalAlign: 'middle', marginRight: 6 }} />
}

function PatternList({ clubId, patterns, onUpdate }) {
  const apiFetch = useApiFetch()
  const [input, setInput] = useState('')

  async function add() {
    const pat = input.trim().toLowerCase()
    if (!pat) return
    const r = await apiFetch(`/api/clubs/${clubId}/patterns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pattern: pat }),
    })
    if (r.ok) { const d = await r.json(); onUpdate(d.patterns); setInput('') }
  }

  async function remove(patternId) {
    const r = await apiFetch(`/api/clubs/${clubId}/patterns/${patternId}`, { method: 'DELETE' })
    if (r.ok) onUpdate(patterns.filter(p => p.id !== patternId))
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {patterns.map(p => (
          <span key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--surface-alt)', borderRadius: 4, padding: '2px 8px', fontSize: '0.82rem' }}>
            {p.pattern}
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--dim)', lineHeight: 1 }} onClick={() => remove(p.id)}>
              <X size={11} />
            </button>
          </span>
        ))}
        {!patterns.length && <span style={{ fontSize: '0.82rem', color: 'var(--dim)' }}>No patterns yet</span>}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="e.g. woking"
          style={{ flex: 1, fontSize: '0.82rem' }}
          onKeyDown={e => e.key === 'Enter' && add()} />
        <button className="secondary" onClick={add} style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 4 }}>
          <Plus size={13} /> Add
        </button>
      </div>
    </div>
  )
}

function ClubForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || { name: '', slug: '', primary_color: '#3b82f6', secondary_color: '#1e3a8a', show_opp_data: false })
  const [err, setErr] = useState(null)

  const mf = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function save() {
    if (!form.name || !form.slug) { setErr('Name and slug are required'); return }
    setErr(null)
    onSave({ ...form, show_opp_data: form.show_opp_data ? 1 : 0 })
  }

  return (
    <div style={{ display: 'grid', gap: '0.6rem', padding: '0.75rem', background: 'var(--surface-alt)', borderRadius: 8 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
          Club name *
          <input value={form.name} onChange={e => { mf('name', e.target.value); mf('slug', e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) }} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
          Slug * (URL-safe)
          <input value={form.slug} onChange={e => mf('slug', e.target.value)} placeholder="e.g. whcc" />
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
          Primary colour
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="color" value={form.primary_color} onChange={e => mf('primary_color', e.target.value)} style={{ width: 40, height: 32, padding: 2, cursor: 'pointer' }} />
            <input value={form.primary_color} onChange={e => mf('primary_color', e.target.value)} style={{ flex: 1, fontSize: '0.82rem' }} />
          </div>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
          Secondary colour
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="color" value={form.secondary_color} onChange={e => mf('secondary_color', e.target.value)} style={{ width: 40, height: 32, padding: 2, cursor: 'pointer' }} />
            <input value={form.secondary_color} onChange={e => mf('secondary_color', e.target.value)} style={{ flex: 1, fontSize: '0.82rem' }} />
          </div>
        </label>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer' }}>
        <input type="checkbox" checked={!!form.show_opp_data} onChange={e => mf('show_opp_data', e.target.checked)} />
        Show opposition match data
      </label>
      {err && <div style={{ color: 'var(--red)', fontSize: '0.82rem' }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button className="secondary" onClick={onCancel}>Cancel</button>
        <button onClick={save}>Save</button>
      </div>
    </div>
  )
}

function UserRow({ user, clubs, onSaved }) {
  const apiFetch  = useApiFetch()
  const [expanded, setExpanded] = useState(false)
  const [saving,   setSaving]   = useState(false)
  const meta = user.publicMetadata || {}
  const [clubId,     setClubId]     = useState(String(meta.club_id ?? ''))
  const [canUpload,  setCanUpload]  = useState(!!meta.canUpload)
  const [superAdmin, setSuperAdmin] = useState(!!meta.isSuperAdmin)

  async function save() {
    setSaving(true)
    const r = await apiFetch(`/api/clubs/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canUpload,
        isSuperAdmin: superAdmin,
        club_id: clubId ? Number(clubId) : null,
      }),
    })
    setSaving(false)
    if (r.ok) { setExpanded(false); onSaved() }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', background: 'var(--surface)' }}
        onClick={() => setExpanded(e => !e)}>
        <span style={{ flex: 1, fontSize: '0.85rem' }}>
          {user.name}
          {user.email && <span style={{ color: 'var(--dim)', marginLeft: 8, fontSize: '0.78rem' }}>{user.email}</span>}
        </span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {meta.isSuperAdmin && <span className="tag" style={{ background: 'var(--amber-bg)', color: 'var(--amber)' }}>super admin</span>}
          {meta.canUpload    && <span className="tag">upload</span>}
          {meta.club_id      && <span className="tag">{clubs.find(c => c.id === meta.club_id)?.name ?? `club ${meta.club_id}`}</span>}
        </div>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </div>
      {expanded && (
        <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border)', display: 'grid', gap: '0.6rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={canUpload} onChange={e => setCanUpload(e.target.checked)} />
              Can upload / enter data
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={superAdmin} onChange={e => setSuperAdmin(e.target.checked)} />
              Super admin
            </label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
            Club
            <select value={clubId} onChange={e => setClubId(e.target.value)}>
              <option value="">— no club (global access) —</option>
              {clubs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={save} disabled={saving} style={{ fontSize: '0.82rem' }}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ClubAdmin() {
  const apiFetch = useApiFetch()
  const [clubs,   setClubs]   = useState([])
  const [users,   setUsers]   = useState([])
  const [tab,     setTab]     = useState('clubs')
  const [adding,  setAdding]  = useState(false)
  const [editing, setEditing] = useState(null)
  const [expanded, setExpanded] = useState({})
  const [err,     setErr]     = useState(null)

  async function load() {
    const [cs, us] = await Promise.all([
      apiFetch('/api/clubs').then(r => r.json()),
      apiFetch('/api/clubs/users/list').then(r => r.json()),
    ])
    setClubs(Array.isArray(cs) ? cs : [])
    setUsers(Array.isArray(us) ? us : [])
  }

  useEffect(() => { load() }, [])

  async function createClub(form) {
    const r = await apiFetch('/api/clubs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!r.ok) { const j = await r.json(); setErr(j.error); return }
    setAdding(false)
    load()
  }

  async function updateClub(id, form) {
    const r = await apiFetch(`/api/clubs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    if (!r.ok) { const j = await r.json(); setErr(j.error); return }
    setEditing(null)
    load()
  }

  async function deleteClub(id) {
    if (!window.confirm('Delete this club? This cannot be undone.')) return
    await apiFetch(`/api/clubs/${id}`, { method: 'DELETE' })
    load()
  }

  const toggleExpand = id => setExpanded(e => ({ ...e, [id]: !e[id] }))

  return (
    <div className="page">
      <h1>Admin</h1>

      <div className="tabs" style={{ marginBottom: '1.5rem' }}>
        <button className={`tab${tab === 'clubs' ? ' active' : ''}`} onClick={() => setTab('clubs')}>Clubs</button>
        <button className={`tab${tab === 'users' ? ' active' : ''}`} onClick={() => setTab('users')}>Users</button>
      </div>

      {err && <div style={{ color: 'var(--red)', fontSize: '0.85rem', marginBottom: '1rem' }}>{err}</div>}

      {tab === 'clubs' && (
        <div style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => setAdding(true)} disabled={adding}>+ New club</button>
          </div>

          {adding && (
            <ClubForm onSave={createClub} onCancel={() => setAdding(false)} />
          )}

          {clubs.map(club => (
            <div key={club.id} style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'var(--surface)', cursor: 'pointer' }}
                onClick={() => toggleExpand(club.id)}>
                <ColorSwatch color={club.primary_color} />
                <span style={{ fontWeight: 600 }}>{club.name}</span>
                <span style={{ color: 'var(--dim)', fontSize: '0.82rem' }}>/{club.slug}</span>
                {club.show_opp_data ? <span className="tag">opp data on</span> : null}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="secondary" style={{ fontSize: '0.78rem', padding: '3px 8px' }}
                    onClick={e => { e.stopPropagation(); setEditing(club.id) }}>Edit</button>
                  <button className="secondary" style={{ fontSize: '0.78rem', padding: '3px 8px', color: 'var(--red)', borderColor: 'var(--red)' }}
                    onClick={e => { e.stopPropagation(); deleteClub(club.id) }}>
                    <Trash2 size={12} />
                  </button>
                  {expanded[club.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </div>
              </div>

              {editing === club.id && (
                <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border)' }}>
                  <ClubForm
                    initial={{ name: club.name, slug: club.slug, primary_color: club.primary_color, secondary_color: club.secondary_color, show_opp_data: !!club.show_opp_data }}
                    onSave={form => updateClub(club.id, form)}
                    onCancel={() => setEditing(null)}
                  />
                </div>
              )}

              {expanded[club.id] && editing !== club.id && (
                <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '0.82rem', color: 'var(--dim)', marginBottom: 4 }}>Team name patterns (substring match, lowercase)</div>
                  <PatternList
                    clubId={club.id}
                    patterns={club.patterns}
                    onUpdate={pts => setClubs(cs => cs.map(c => c.id === club.id ? { ...c, patterns: pts } : c))}
                  />
                </div>
              )}
            </div>
          ))}

          {!clubs.length && !adding && (
            <p style={{ color: 'var(--dim)', fontSize: '0.85rem' }}>No clubs yet. Create one to start managing multi-club access.</p>
          )}
        </div>
      )}

      {tab === 'users' && (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          {users.map(u => (
            <UserRow key={u.id} user={u} clubs={clubs} onSaved={load} />
          ))}
          {!users.length && <p style={{ color: 'var(--dim)', fontSize: '0.85rem' }}>No users found.</p>}
        </div>
      )}
    </div>
  )
}
