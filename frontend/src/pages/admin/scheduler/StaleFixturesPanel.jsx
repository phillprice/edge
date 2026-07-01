import { useState, useEffect } from 'react'
import { useApiFetch } from '../../../hooks/useApiFetch'
import { shortTeam, formatDateShort } from '../../../utils/cricket'

function StaleFixtureRow({ r, checked, onToggle }) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: '0.82rem',
        cursor: 'pointer'
      }}
    >
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span style={{ color: 'var(--text3)', minWidth: 70 }}>{r.play_cricket_id}</span>
      <span style={{ flex: 1 }}>
        {shortTeam(r.home_team)} vs {shortTeam(r.away_team)}
        {r.match_date_iso ? ' · ' + formatDateShort(r.match_date_iso) : ''}
      </span>
      <span
        className={'tag tag-' + (r.status === 'failed' ? 'red' : 'orange')}
        style={{ fontSize: '0.7rem' }}
      >
        {r.status}
        {r.attempt_count > 0 ? ' (' + r.attempt_count + ')' : ''}
      </span>
      {r.error_msg && (
        <span
          style={{
            color: 'var(--red)',
            fontSize: '0.7rem',
            maxWidth: 180,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap'
          }}
          title={r.error_msg}
        >
          {r.error_msg}
        </span>
      )}
    </label>
  )
}

async function doIgnoreSelected(sel, apiFetch, setSaving, setMsg, setRows, setSel) {
  if (!sel.size) return
  setSaving(true)
  setMsg(null)
  try {
    const res = await apiFetch('/api/admin/scheduler/ignore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...sel] })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed')
    setRows((r) => r.filter((x) => !sel.has(x.play_cricket_id)))
    setSel(new Set())
    setMsg({
      error: false,
      text: data.ignored + ' fixture' + (data.ignored === 1 ? '' : 's') + ' ignored.'
    })
  } catch (e) {
    setMsg({ error: true, text: e.message })
  }
  setSaving(false)
}

function StaleActionsBar({ sel, rowCount, saving, msg, onToggleAll, onIgnore }) {
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: '0.75rem', alignItems: 'center' }}>
        <button className="secondary btn-sm" onClick={onToggleAll}>
          {sel.size === rowCount ? 'Deselect all' : 'Select all'}
        </button>
        <button disabled={!sel.size || saving} onClick={onIgnore} className="btn-sm">
          {saving ? 'Saving…' : 'Ignore ' + (sel.size || '') + ' selected'}
        </button>
      </div>
      {msg && (
        <p
          style={{
            fontSize: '0.82rem',
            color: msg.error ? 'var(--red)' : 'var(--green)',
            marginBottom: '0.5rem'
          }}
        >
          {msg.text}
        </p>
      )}
    </>
  )
}

export default function StaleFixturesPanel() {
  const [rows, setRows] = useState(null)
  const [sel, setSel] = useState(new Set())
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)
  const apiFetch = useApiFetch()

  useEffect(() => {
    apiFetch('/api/admin/scheduler/stale')
      .then((r) => r.json())
      .then((d) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!rows?.length) return null

  const toggleAll = () =>
    setSel((s) =>
      s.size === rows.length ? new Set() : new Set(rows.map((r) => r.play_cricket_id))
    )
  const toggleRow = (id) =>
    setSel((s) => {
      const n = new Set(s)
      s.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Stale / failed fixtures</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
        Pending fixtures older than 7 days, and fixtures that failed all retries. Mark as ignored to
        stop them appearing in the queue.
      </p>
      <StaleActionsBar
        sel={sel}
        rowCount={rows.length}
        saving={saving}
        msg={msg}
        onToggleAll={toggleAll}
        onIgnore={() => doIgnoreSelected(sel, apiFetch, setSaving, setMsg, setRows, setSel)}
      />
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.4rem',
          maxHeight: 300,
          overflowY: 'auto'
        }}
      >
        {rows.map((r) => (
          <StaleFixtureRow
            key={r.play_cricket_id}
            r={r}
            checked={sel.has(r.play_cricket_id)}
            onToggle={() => toggleRow(r.play_cricket_id)}
          />
        ))}
      </div>
    </div>
  )
}
