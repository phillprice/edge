import { useState, useEffect } from 'react'
import { Plus, Save, ChevronDown, ChevronUp } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'
import { useUser } from '@clerk/clerk-react'
import ClubInvites from './ClubInvites'
import { colourPreview, ColourField, ClubColourPreview } from '../components/ClubColourEditor'

const HEX_COLOUR_RE = /^#[\da-fA-F]{6}$/
const isHexColour = (s) => HEX_COLOUR_RE.test(s)

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

const CLUB_FIELD_STYLE = {
  width: '100%',
  fontSize: '0.85rem',
  padding: '4px 7px',
  boxSizing: 'border-box'
}
const CLUB_LABEL_STYLE = {
  fontSize: '0.78rem',
  color: 'var(--text2)',
  marginBottom: 2,
  display: 'block'
}

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
        <input
          style={CLUB_FIELD_STYLE}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Kempton CC"
        />
      </div>
      <div>
        <label style={CLUB_LABEL_STYLE}>Slug (URL-safe, unique)</label>
        <input
          style={CLUB_FIELD_STYLE}
          value={form.slug}
          onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          placeholder="kempton"
        />
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
        <button className="secondary" onClick={onCancel} style={{ fontSize: '0.82rem' }}>
          Cancel
        </button>
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
          <button
            onClick={() => setAdding(true)}
            style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <Plus size={13} />
            Add club
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
function buildClubFormBody(form, isNew) {
  const markers = form.nameMarkers
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  const body = {
    appName: form.appName.trim() ? `${form.appName.trim()} Edge XI` : 'Edge XI',
    primaryColour: form.primaryColour,
    secondaryColour: form.secondaryColour,
    kitColour: isHexColour(form.kitColour) ? form.kitColour : undefined,
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
    const { url, method } = buildClubFormRequest(
      isNew,
      club ? club.clubId : undefined,
      asSuperAdmin
    )
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
      <ClubFormFields form={form} set={set} isNew={isNew} />
      {error && <p style={{ color: 'var(--red)', fontSize: '0.82rem', margin: 0 }}>{error}</p>}
      <ClubFormButtons saving={saving} isNew={isNew} onCancel={onCancel} onSave={save} />
    </div>
  )
}

function ClubFormFields({ form, set, isNew }) {
  return (
    <>
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
            <span
              style={{
                padding: '4px 8px',
                background: 'var(--bg2)',
                border: '1px solid var(--border)',
                borderRadius: '0 4px 4px 0',
                fontSize: '0.85rem',
                color: 'var(--text3)',
                whiteSpace: 'nowrap',
                userSelect: 'none'
              }}
            >
              Edge XI
            </span>
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
        <label style={CLUB_LABEL_STYLE}>
          Name markers (comma-separated — used to identify your players)
        </label>
        <input
          style={CLUB_FIELD_STYLE}
          value={form.nameMarkers}
          onChange={(e) => set('nameMarkers', e.target.value)}
          placeholder="kempton, kemptonians"
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
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
        <ColourField
          label="Kit / jersey colour (optional)"
          value={form.kitColour || '#690028'}
          onChange={(v) => set('kitColour', v)}
        />
      </div>
      <ClubColourPreview
        primary={form.primaryColour}
        secondary={form.secondaryColour}
        kit={form.kitColour}
      />
    </>
  )
}

function ClubCardHeader({ club, open, onToggle }) {
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
          userSelect: 'none'
        }}
        onClick={onToggle}
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
    </>
  )
}

function ClubCard({ club, onSaved }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="card" style={{ padding: '0.75rem 1rem' }}>
      <ClubCardHeader club={club} open={open} onToggle={() => setOpen((v) => !v)} />
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
      <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: '0.75rem' }}>New club</div>
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
