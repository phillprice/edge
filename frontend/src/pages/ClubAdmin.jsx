import { useState, useEffect } from 'react'
import { Plus, Save, ChevronDown, ChevronUp, AlertTriangle, Trophy, Award, Flag } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'
import { useUser } from '@clerk/clerk-react'
import ClubInvites from './ClubInvites'
import { JerseyIcon, jerseyInitials } from '../components/JerseyIcon'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer } from 'recharts'

// Swatch palette — all pass 3:1 contrast against white; spread across hue wheel
const SWATCHES = [
  { label: 'Black',     value: '#1a1a1a' },  // neutral near-black
  { label: 'Slate',     value: '#2e4057' },  // blue-grey neutral (212°)
  { label: 'Brown',     value: '#4a2000' },  // chocolate brown (27°, very dark)
  { label: 'Claret',    value: '#690028' },  // purplish dark red (337°, 20%)
  { label: 'Maroon',    value: '#7a0000' },  // pure dark red (0°, 15%) — distinct from Claret
  { label: 'Red',       value: '#cc0000' },  // bright red (0°, 40%)
  { label: 'Raspberry', value: '#cc0055' },  // bright pink-red (350°, 40%)
  { label: 'Orange',    value: '#c85000' },  // dark orange (24°)
  { label: 'Amber',     value: '#b06000' },  // orange-gold (32°)
  { label: 'Bronze',    value: '#7a4a00' },  // dark gold-brown (46°) — fills amber→olive gap
  { label: 'Olive',     value: '#4a5c00' },  // yellow-green (75°)
  { label: 'Forest',    value: '#1a5c2a' },  // forest green (135°)
  { label: 'Teal',      value: '#005f6e' },  // blue-green (189°)
  { label: 'Sky',       value: '#0070c0' },  // medium blue (207°)
  { label: 'Royal',     value: '#1a52cc' },  // royal blue (220°)
  { label: 'Indigo',    value: '#1a0060' },  // dark blue-purple (252°)
  { label: 'Purple',    value: '#4b0082' },  // deep purple (277°)
  { label: 'Violet',    value: '#7800aa' },  // bright violet (291°) — fills purple→claret gap
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
  kitColour: '',
  nameMarkers: '',
  playCricketDomain: ''
}

const CLUB_FIELD_STYLE = { width: '100%', fontSize: '0.85rem', padding: '4px 7px', boxSizing: 'border-box' }
const CLUB_LABEL_STYLE = { fontSize: '0.78rem', color: 'var(--text2)', marginBottom: 2, display: 'block' }

function toClubForm(club) {
  if (!club) return EMPTY_FORM
  return {
    name: club.name || '',
    slug: club.slug || '',
    appName: (club.appName || '').replace(/\s*Edge XI$/i, '').trim(),
    primaryColour: club.primaryColour || '#690028',
    secondaryColour: club.secondaryColour || '#a00040',
    kitColour: club.kitColour || '',
    nameMarkers: (club.nameMarkers || []).join(', '),
    playCricketDomain: club.playCricketDomain || ''
  }
}

function NewClubNameFields({ form, set }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
      <div>
        <label style={CLUB_LABEL_STYLE}>Club name</label>
        <input style={CLUB_FIELD_STYLE} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Kempton CC" />
      </div>
      <div>
        <label style={CLUB_LABEL_STYLE}>Slug (URL-safe, unique)</label>
        <input style={CLUB_FIELD_STYLE} value={form.slug} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} placeholder="kempton" />
      </div>
    </div>
  )
}

function ClubFormButtons({ saving, isNew, onCancel, onSave }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      <button
        onClick={onSave}
        disabled={saving}
        style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 4 }}
      >
        <Save size={13} />
        {saving ? 'Saving…' : isNew ? 'Create club' : 'Save'}
      </button>
      {onCancel && (
        <button className="secondary" onClick={onCancel} style={{ fontSize: '0.82rem' }}>Cancel</button>
      )}
    </div>
  )
}

function MyClubView({ myClub, onSaved }) {
  return (
    <div style={{ maxWidth: 600 }}>
      <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '1rem' }}>
        {myClub.appName || myClub.name}
      </h3>
      <ClubForm club={myClub} isNew={false} onSaved={onSaved} />
    </div>
  )
}

function SuperAdminClubsList({ clubs, adding, setAdding, onSaved }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1rem' }}>
        <span style={{ fontSize: '0.88rem', color: 'var(--text2)', flex: 1 }}>
          {clubs ? clubs.length : 0} club{clubs && clubs.length !== 1 ? 's' : ''}
        </span>
        {!adding && (
          <button onClick={() => setAdding(true)} style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Plus size={13} />Add club
          </button>
        )}
      </div>
      <AddClubSection adding={adding} setAdding={setAdding} onSaved={onSaved} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {(clubs || []).map((c) => (
          <ClubCard key={c.clubId} club={c} onSaved={onSaved} />
        ))}
      </div>
    </div>
  )
}

function colourPreview(primary, secondary, kit) {
  const chips = [primary, secondary, kit].filter(Boolean)
  return (
    <span style={{ display: 'inline-flex', gap: 4, verticalAlign: 'middle' }}>
      {chips.map((c) => (
        <span
          key={c}
          title={c}
          style={{ width: 16, height: 16, borderRadius: 3, background: c, display: 'inline-block', border: '1px solid var(--border)' }}
        />
      ))}
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
    </div>
  )
}

function lightenForDark(hex) {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return hex
  let r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255
  let l = (max + min) / 2
  if (l >= 0.55) return hex
  const s = max === min ? 0 : l < 0.5 ? (max - min) / (max + min) : (max - min) / (2 - max - min)
  const h = max === min ? 0
    : max === r / 255 ? ((g - b) / 255 / (max - min) + (g < b ? 6 : 0)) / 6
    : max === g / 255 ? ((b - r) / 255 / (max - min) + 2) / 6
    : ((r - g) / 255 / (max - min) + 4) / 6
  l = 0.55
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  const h2r = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1
    return t < 1/6 ? p + (q-p)*6*t : t < 0.5 ? q : t < 2/3 ? p + (q-p)*(2/3-t)*6 : p }
  return `#${[h2r(h+1/3), h2r(h), h2r(h-1/3)].map((v) => Math.round(v*255).toString(16).padStart(2,'0')).join('')}`
}

const PREVIEW_MANHATTAN = [
  { over: 1, inn1: 8, inn2: 5 }, { over: 2, inn1: 4, inn2: 9 }, { over: 3, inn1: 11, inn2: 6 },
  { over: 4, inn1: 7, inn2: 12 }, { over: 5, inn1: 13, inn2: 4 }, { over: 6, inn1: 6, inn2: 8 },
  { over: 7, inn1: 9, inn2: 11 }, { over: 8, inn1: 5, inn2: 7 }, { over: 9, inn1: 14, inn2: 3 },
  { over: 10, inn1: 7, inn2: 6 }, { over: 11, inn1: 3, inn2: 10 }, { over: 12, inn1: 8, inn2: 2 }
]

function PreviewPanel({ nav, acc, kitColour, dark }) {
  const bg = dark ? '#0c0b18' : '#f4f3f8'
  const bg2 = dark ? '#1a1830' : '#fff'
  const border = dark ? '#2d2a4a' : '#e0ddf0'
  const text = dark ? '#f0eeff' : '#1a1830'
  const dim = dark ? '#a4a0cc' : '#706e86'
  const scope = { '--nav-bg': nav, '--secondary-colour': acc, '--kit-colour': kitColour || nav,
    '--bg': bg, '--bg2': bg2, '--border': border, '--text': text, '--text2': dim, '--text3': dim,
    '--nav-dim': 'rgba(255,255,255,0.65)' }
  const axisStyle = { fontSize: 9, fill: dim }
  const gridColor = border
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 6, overflow: 'hidden', background: bg, ...scope }}>
      <nav style={{ background: nav, padding: '5px 10px', display: 'flex', gap: 10, alignItems: 'center', fontSize: '0.72rem' }}>
        <span style={{ color: '#fff', fontWeight: 600 }}>App</span>
        <span style={{ color: 'rgba(255,255,255,0.65)' }}>Matches</span>
        <span style={{ color: 'rgba(255,255,255,0.65)' }}>Players</span>
        <span style={{ color: 'rgba(255,255,255,0.65)' }}>Season</span>
      </nav>
      <div style={{ padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div className="match-card" style={{ pointerEvents: 'none', cursor: 'default', fontSize: '0.78rem', background: bg2, borderColor: border, color: text }}>
          <div>
            <div className="match-teams" style={{ color: text }}>
              <span style={{ fontWeight: 700 }}>Your Club</span>
              <span style={{ color: dim }}> vs </span>
              <span>Opponents</span>
            </div>
            <div className="match-meta" style={{ fontSize: '0.72rem', color: dim }}>
              <span>14 Jun 2026 · Home</span>
            </div>
          </div>
          <div className="match-score">
            <span className="tag tag-green" style={{ fontSize: '0.68rem' }}>Won</span>
            <div style={{ fontSize: '0.78rem', color: dim }}>89/3 v 62/7</div>
          </div>
        </div>
        <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 6, padding: '5px 8px', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem' }}>
          <JerseyIcon size={22} initials={jerseyInitials('Leo Brown')} />
          <span style={{ fontWeight: 600, color: text, flex: 1 }}>Leo Brown</span>
          <span style={{ color: text }}>47<span style={{ color: dim }}>*</span></span>
          <span style={{ fontSize: '0.72rem', color: dim }}>32b · SR 146</span>
        </div>
        <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 6, padding: '6px 8px' }}>
          <div style={{ fontSize: '0.68rem', color: dim, marginBottom: 2 }}>Manhattan</div>
          <ResponsiveContainer width="100%" height={80}>
            <BarChart data={PREVIEW_MANHATTAN} margin={{ top: 2, right: 2, bottom: 0, left: -28 }} barCategoryGap="15%">
              <CartesianGrid vertical={false} stroke={gridColor} strokeDasharray="3 3" />
              <XAxis dataKey="over" tick={axisStyle} />
              <YAxis tick={axisStyle} />
              <Bar dataKey="inn1" fill={dark ? lightenForDark(nav) : nav} radius={[2, 2, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="inn2" fill={dark ? lightenForDark(acc) : acc} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ background: bg2, border: `1px solid ${border}`, borderRadius: 6, padding: '6px 8px' }}>
          <div style={{ fontSize: '0.68rem', color: dim, marginBottom: 4 }}>Match Flow</div>
          <div className="flow-list">
            <div className="flow-event flow-team-milestone">
              <span className="flow-icon"><Trophy size={13} /></span>
              <span className="flow-text" style={{ color: dim }}>50 up — 1 down — ov 5</span>
            </div>
            <div className="flow-event flow-batter">
              <span className="flow-icon">
                <img src="/cricket-bat.png" style={{ width: 13, height: 13, objectFit: 'contain' }} alt="" />
              </span>
              <span className="flow-text" style={{ color: dim }}>L Brown 25* (18b) — ov 6</span>
            </div>
            <div className="flow-event flow-wicket">
              <span className="flow-icon"><span className="flow-dot" /></span>
              <span className="flow-text" style={{ color: text, fontWeight: 500 }}>J Smith out caught 32(28) · 2nd wkt for 51 · ov 6.3</span>
            </div>
            <div className="flow-event flow-haul">
              <span className="flow-icon"><Award size={13} /></span>
              <span className="flow-text" style={{ color: dim }}>A Jones takes 2nd wicket — ov 8</span>
            </div>
            <div className="flow-event flow-maiden">
              <span className="flow-icon"><span className="flow-dot" style={{ width: 9, height: 9 }} /></span>
              <span className="flow-text" style={{ color: dim, fontWeight: 500 }}>Maiden — T Green — ov 9</span>
            </div>
            <div className="flow-event flow-end">
              <span className="flow-icon"><Flag size={13} /></span>
              <span className="flow-text" style={{ color: dim, fontStyle: 'italic' }}>Innings ends: 89/3 (12 overs)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ClubColourPreview({ primary, secondary, kit }) {
  const nav = primary || '#690028'
  const acc = secondary || '#a00040'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
      <PreviewPanel nav={nav} acc={acc} kitColour={kit} dark={false} />
      <PreviewPanel nav={nav} acc={acc} kitColour={kit} dark />
    </div>
  )
}

function buildClubFormBody(form, isNew) {
  const markers = form.nameMarkers
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const body = {
    appName: form.appName.trim() ? `${form.appName.trim()} Edge XI` : 'Edge XI',
    primaryColour: form.primaryColour,
    secondaryColour: form.secondaryColour,
    kitColour: /^#[0-9a-fA-F]{6}$/.test(form.kitColour) ? form.kitColour : undefined,
    nameMarkers: markers,
    playCricketDomain: form.playCricketDomain || undefined
  }
  if (isNew) {
    body.name = form.name
    body.slug = form.slug
  }
  return body
}

function buildClubFormRequest(isNew, clubId, asSuperAdmin) {
  const url = isNew
    ? '/api/club/all'
    : asSuperAdmin && clubId
      ? `/api/club/all/${clubId}`
      : '/api/club/settings'
  const method = isNew ? 'POST' : 'PATCH'
  return { url, method }
}

async function saveClub(apiFetch, url, method, body) {
  try {
    const r = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!r.ok) {
      const d = await r.json().catch(() => ({}))
      return { ok: false, error: d.error ?? 'Save failed' }
    }
    return { ok: true, error: null }
  } catch (e) {
    return { ok: false, error: e.message }
  }
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

function ClubForm({ club, isNew, onSaved, onCancel, asSuperAdmin }) {
  const apiFetch = useApiFetch()
  const [form, setForm] = useState(() => toClubForm(club))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }))

  async function save() {
    setSaving(true)
    setError(null)
    const body = buildClubFormBody(form, isNew)
    const { url, method } = buildClubFormRequest(isNew, club ? club.clubId : undefined, asSuperAdmin)
    const { ok, error: saveError } = await saveClub(apiFetch, url, method, body)
    if (ok) {
      onSaved()
      window.dispatchEvent(new CustomEvent('club-config-updated'))
    } else {
      setError(saveError)
    }
    setSaving(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
      {isNew && <NewClubNameFields form={form} set={set} />}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <div>
          <label style={CLUB_LABEL_STYLE}>App name (shown in nav + browser tab)</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            <input
              style={{ ...CLUB_FIELD_STYLE, borderRadius: '4px 0 0 4px', borderRight: 'none' }}
              value={form.appName}
              onChange={(e) => set('appName', e.target.value)}
              placeholder="Club name"
            />
            <span style={{ padding: '4px 8px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '0 4px 4px 0', fontSize: '0.85rem', color: 'var(--text3)', whiteSpace: 'nowrap', userSelect: 'none' }}>Edge XI</span>
          </div>
        </div>
        <div>
          <label style={CLUB_LABEL_STYLE}>Play-cricket domain</label>
          <input
            style={CLUB_FIELD_STYLE}
            value={form.playCricketDomain}
            onChange={(e) => set('playCricketDomain', e.target.value)}
            placeholder="kemptoncc.play-cricket.com"
          />
        </div>
      </div>

      <div>
        <label style={CLUB_LABEL_STYLE}>Name markers (comma-separated — used to identify your players)</label>
        <input
          style={CLUB_FIELD_STYLE}
          value={form.nameMarkers}
          onChange={(e) => set('nameMarkers', e.target.value)}
          placeholder="kempton, kemptonians"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
        <ColourField label="Primary colour (nav background)"
          value={form.primaryColour} onChange={(v) => set('primaryColour', v)} />
        <ColourField label="Secondary colour (accents)"
          value={form.secondaryColour} onChange={(v) => set('secondaryColour', v)} />
        <ColourField label="Kit / jersey colour (optional)"
          value={form.kitColour || '#690028'} onChange={(v) => set('kitColour', v)} />
      </div>
      <ClubColourPreview primary={form.primaryColour} secondary={form.secondaryColour} kit={form.kitColour} />

      {error && <p style={{ color: 'var(--red)', fontSize: '0.82rem', margin: 0 }}>{error}</p>}

      <ClubFormButtons saving={saving} isNew={isNew} onCancel={onCancel} onSave={save} />
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
        {colourPreview(club.primaryColour, club.secondaryColour, club.kitColour)}
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
          <ClubForm club={club} isNew={false} onSaved={onSaved} asSuperAdmin />
          <ClubInvites clubId={club.clubId} />
        </div>
      )}
    </div>
  )
}

function AddClubSection({ adding, setAdding, onSaved }) {
  if (!adding) return null
  return (
    <div className="card" style={{ padding: '0.75rem 1rem', marginBottom: '0.75rem' }}>
      <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.75rem' }}>
        New club
      </div>
      <ClubForm
        isNew
        onSaved={() => {
          setAdding(false)
          onSaved()
        }}
        onCancel={() => setAdding(false)}
      />
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

  if (!isSuperAdmin && myClub) return <MyClubView myClub={myClub} onSaved={load} />
  return <SuperAdminClubsList clubs={clubs} adding={adding} setAdding={setAdding} onSaved={load} />
}
