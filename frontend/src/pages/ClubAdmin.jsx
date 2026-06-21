import { useState, useEffect } from 'react'
import { Plus, Save, ChevronDown, ChevronUp, AlertTriangle, Link, Copy, Trash2 } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'
import { useUser } from '@clerk/clerk-react'

// Swatch palette — dark enough to contrast with white text
const SWATCHES = [
  { label: 'Claret', value: '#690028' },
  { label: 'Navy', value: '#003087' },
  { label: 'Forest', value: '#1a5c2a' },
  { label: 'Black', value: '#1a1a1a' },
  { label: 'Maroon', value: '#6b0000' },
  { label: 'Teal', value: '#005f6e' },
  { label: 'Purple', value: '#4b0082' },
  { label: 'Slate', value: '#2e4057' },
  { label: 'Bronze', value: '#7a4f00' },
  { label: 'Burgundy', value: '#800020' }
]

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function relativeLuminance(hex) {
  return hexToRgb(hex)
    .map((c) => {
      const s = c / 255
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    })
    .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0)
}

function contrastRatio(hex) {
  const L = relativeLuminance(hex)
  // contrast against white (L=1)
  return (1 + 0.05) / (L + 0.05)
}

const EMPTY_FORM = {
  name: '',
  slug: '',
  appName: '',
  primaryColour: '#690028',
  secondaryColour: '#a00040',
  nameMarkers: '',
  playCricketDomain: ''
}

function colourPreview(primary, secondary) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, verticalAlign: 'middle' }}>
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: 3,
          background: primary,
          display: 'inline-block',
          border: '1px solid var(--border)'
        }}
      />
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: 3,
          background: secondary,
          display: 'inline-block',
          border: '1px solid var(--border)'
        }}
      />
    </span>
  )
}

function ColourField({ label, value, onChange }) {
  const isValid = /^#[0-9a-fA-F]{6}$/.test(value)
  const ratio = isValid ? contrastRatio(value) : null
  const lowContrast = ratio !== null && ratio < 3

  return (
    <div>
      <label
        style={{ fontSize: '0.78rem', color: 'var(--text2)', marginBottom: 4, display: 'block' }}
      >
        {label}
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="color"
          value={isValid ? value : '#000000'}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: 36,
            height: 28,
            padding: 1,
            border: '1px solid var(--border)',
            borderRadius: 3,
            cursor: 'pointer',
            flexShrink: 0
          }}
        />
        <input
          style={{
            width: 90,
            fontSize: '0.85rem',
            padding: '4px 7px',
            fontFamily: 'monospace',
            border: lowContrast ? '1px solid var(--orange, #f90)' : '1px solid var(--border)',
            borderRadius: 4
          }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={7}
        />
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {SWATCHES.map((s) => (
            <button
              key={s.value}
              title={s.label}
              onClick={() => onChange(s.value)}
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                background: s.value,
                border: value === s.value ? '2px solid var(--hotpink)' : '1px solid var(--border)',
                padding: 0,
                cursor: 'pointer',
                flexShrink: 0
              }}
            />
          ))}
        </div>
      </div>
      {lowContrast && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            marginTop: 4,
            fontSize: '0.75rem',
            color: 'var(--orange, #c77700)'
          }}
        >
          <AlertTriangle size={12} />
          Low contrast with white nav text ({ratio.toFixed(1)}:1 — min 3:1). Text may be hard to
          read.
        </div>
      )}
      {isValid && !lowContrast && ratio !== null && (
        <div style={{ fontSize: '0.72rem', color: 'var(--text3)', marginTop: 2 }}>
          Contrast with white: {ratio.toFixed(1)}:1 ✓
        </div>
      )}
    </div>
  )
}

function buildClubFormBody(form, isNew) {
  const markers = form.nameMarkers
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const body = {
    appName: form.appName,
    primaryColour: form.primaryColour,
    secondaryColour: form.secondaryColour,
    nameMarkers: markers,
    playCricketDomain: form.playCricketDomain || undefined
  }
  if (isNew) {
    body.name = form.name
    body.slug = form.slug
  }
  return body
}

function buildClubFormRequest(isNew, clubId) {
  const url = isNew
    ? '/api/club/all'
    : clubId
      ? `/api/club/all/${clubId}`
      : '/api/club/settings'
  const method = isNew ? 'POST' : 'PATCH'
  return { url, method }
}

async function loadSuperAdmin(apiFetch, setClubs) {
  const r = await apiFetch('/api/club/all')
  if (!r.ok) throw new Error((await r.json()).error ?? 'Failed to load clubs')
  setClubs(await r.json())
}

async function loadMyClub(apiFetch, setMyClub) {
  const r = await apiFetch('/api/club/settings')
  if (!r.ok) throw new Error((await r.json()).error ?? 'Failed to load club')
  setMyClub(await r.json())
}

function ClubForm({ club, isNew, onSaved, onCancel }) {
  const apiFetch = useApiFetch()
  const [form, setForm] = useState(
    club
      ? {
          name: club.name ?? '',
          slug: club.slug ?? '',
          appName: club.appName ?? '',
          primaryColour: club.primaryColour ?? '#690028',
          secondaryColour: club.secondaryColour ?? '#a00040',
          nameMarkers: (club.nameMarkers ?? []).join(', '),
          playCricketDomain: club.playCricketDomain ?? ''
        }
      : EMPTY_FORM
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function set(key, val) {
    setForm((f) => ({ ...f, [key]: val }))
  }

  async function save() {
    setSaving(true)
    setError(null)
    const body = buildClubFormBody(form, isNew)
    const { url, method } = buildClubFormRequest(isNew, club?.clubId)
    try {
      const r = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.error ?? 'Save failed')
      }
      onSaved()
      window.dispatchEvent(new CustomEvent('club-config-updated'))
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  const fieldStyle = {
    width: '100%',
    fontSize: '0.85rem',
    padding: '4px 7px',
    boxSizing: 'border-box'
  }
  const labelStyle = {
    fontSize: '0.78rem',
    color: 'var(--text2)',
    marginBottom: 2,
    display: 'block'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      {isNew && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <div>
            <label style={labelStyle}>Club name</label>
            <input
              style={fieldStyle}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Kempton CC"
            />
          </div>
          <div>
            <label style={labelStyle}>Slug (URL-safe, unique)</label>
            <input
              style={fieldStyle}
              value={form.slug}
              onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="kempton"
            />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <div>
          <label style={labelStyle}>App name (shown in nav + browser tab)</label>
          <input
            style={fieldStyle}
            value={form.appName}
            onChange={(e) => set('appName', e.target.value)}
            placeholder="Edge XI"
          />
        </div>
        <div>
          <label style={labelStyle}>Play-cricket domain</label>
          <input
            style={fieldStyle}
            value={form.playCricketDomain}
            onChange={(e) => set('playCricketDomain', e.target.value)}
            placeholder="kemptoncc.play-cricket.com"
          />
        </div>
      </div>

      <ColourField
        label="Primary colour (nav background)"
        value={form.primaryColour}
        onChange={(v) => set('primaryColour', v)}
      />
      <ColourField
        label="Secondary colour (accents)"
        value={form.secondaryColour}
        onChange={(v) => set('secondaryColour', v)}
      />

      <div>
        <label style={labelStyle}>
          Name markers (comma-separated — used to identify your players)
        </label>
        <input
          style={fieldStyle}
          value={form.nameMarkers}
          onChange={(e) => set('nameMarkers', e.target.value)}
          placeholder="kempton, kemptonians"
        />
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: '0.82rem', margin: 0 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={save}
          disabled={saving}
          style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <Save size={13} />
          {saving ? 'Saving…' : isNew ? 'Create club' : 'Save'}
        </button>
        {onCancel && (
          <button className="secondary" onClick={onCancel} style={{ fontSize: '0.82rem' }}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

function InviteRow({ inv, copied, onCopy, onRevoke }) {
  const url = `${window.location.origin}/invite?token=${inv.token}`
  const daysLeft = Math.ceil((new Date(inv.expiresAt) - Date.now()) / 86400_000)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
      <code
        style={{
          fontSize: '0.75rem',
          color: 'var(--text3)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}
      >
        {url}
      </code>
      <span style={{ fontSize: '0.72rem', color: 'var(--text3)', whiteSpace: 'nowrap' }}>
        {daysLeft}d
      </span>
      <button
        onClick={() => onCopy(inv.token)}
        style={{
          fontSize: '0.75rem',
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          padding: '1px 7px'
        }}
      >
        <Copy size={11} />
        {copied === inv.token ? 'Copied!' : 'Copy'}
      </button>
      <button
        onClick={() => onRevoke(inv.token)}
        className="secondary"
        style={{
          fontSize: '0.75rem',
          padding: '1px 6px',
          color: 'var(--red)',
          borderColor: 'var(--red)'
        }}
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}

function ClubInvites({ clubId }) {
  const apiFetch = useApiFetch()
  const [invites, setInvites] = useState([])
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(null)

  async function load() {
    const r = await apiFetch(`/api/admin/invites?clubId=${clubId}`)
    if (r.ok)
      setInvites((await r.json()).filter((i) => !i.usedAt && new Date(i.expiresAt) > new Date()))
  }

  async function generate() {
    setGenerating(true)
    const r = await apiFetch('/api/admin/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clubId })
    })
    if (r.ok) await load()
    setGenerating(false)
  }

  async function revoke(token) {
    await apiFetch(`/api/admin/invites/${token}`, { method: 'DELETE' })
    await load()
  }

  function copyLink(token) {
    navigator.clipboard.writeText(`${window.location.origin}/invite?token=${token}`)
    setCopied(token)
    setTimeout(() => setCopied(null), 2000)
  }

  useEffect(() => {
    load()
  }, [clubId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: invites.length ? '0.5rem' : 0
        }}
      >
        <span style={{ fontSize: '0.78rem', color: 'var(--text2)', flex: 1 }}>Invite links</span>
        <button
          onClick={generate}
          disabled={generating}
          style={{
            fontSize: '0.78rem',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '2px 10px'
          }}
        >
          <Link size={12} />
          {generating ? 'Generating…' : 'New link'}
        </button>
      </div>
      {invites.map((inv) => (
        <InviteRow key={inv.token} inv={inv} copied={copied} onCopy={copyLink} onRevoke={revoke} />
      ))}
    </div>
  )
}

function ClubCard({ club, onSaved }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="card" style={{ padding: '0.75rem 1rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
          userSelect: 'none'
        }}
        onClick={() => setOpen((v) => !v)}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: club.primaryColour,
            border: '1px solid var(--border)',
            flexShrink: 0
          }}
        />
        <span style={{ fontWeight: 600, fontSize: '0.9rem', flex: 1 }}>
          {club.appName || club.name}
        </span>
        <span style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>{club.slug}</span>
        {colourPreview(club.primaryColour, club.secondaryColour)}
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </div>

      {!open && club.playCricketDomain && (
        <div style={{ fontSize: '0.75rem', color: 'var(--text3)', marginTop: 2, paddingLeft: 20 }}>
          {club.playCricketDomain}
        </div>
      )}

      {open && (
        <div
          style={{
            marginTop: '0.75rem',
            paddingTop: '0.75rem',
            borderTop: '1px solid var(--border)'
          }}
        >
          <ClubForm club={club} isNew={false} onSaved={onSaved} />
          <ClubInvites clubId={club.clubId} />
        </div>
      )}
    </div>
  )
}

export default function ClubAdmin() {
  const apiFetch = useApiFetch()
  const { user } = useUser()
  const isSuperAdmin = user?.publicMetadata?.isSuperAdmin === true
  const [clubs, setClubs] = useState(null)
  const [myClub, setMyClub] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      if (isSuperAdmin) {
        await loadSuperAdmin(apiFetch, setClubs)
      } else {
        await loadMyClub(apiFetch, setMyClub)
      }
    } catch (e) {
      setError(e.message)
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <p style={{ color: 'var(--text2)' }}>Loading…</p>
  if (error) return <p style={{ color: 'var(--red)' }}>{error}</p>

  if (!isSuperAdmin && myClub) {
    return (
      <div style={{ maxWidth: 600 }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '1rem' }}>
          {myClub.appName || myClub.name}
        </h3>
        <ClubForm club={myClub} isNew={false} onSaved={load} />
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem' }}>
        <span style={{ fontSize: '0.88rem', color: 'var(--text2)', flex: 1 }}>
          {clubs?.length ?? 0} club{clubs?.length !== 1 ? 's' : ''}
        </span>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Plus size={13} />
            Add club
          </button>
        )}
      </div>

      {adding && (
        <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '0.75rem' }}>
          <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.75rem' }}>
            New club
          </div>
          <ClubForm
            isNew
            onSaved={() => {
              setAdding(false)
              load()
            }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {(clubs ?? []).map((c) => (
          <ClubCard key={c.clubId} club={c} onSaved={load} />
        ))}
      </div>
    </div>
  )
}
