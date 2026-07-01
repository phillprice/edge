import { useState, useEffect } from 'react'
import { useApiFetch } from '../../hooks/useApiFetch'
import { formatDateShort } from '../../utils/cricket'

// ── Changelog tab ─────────────────────────────────────────────────────────────

export default function ChangelogTab() {
  const apiFetch = useApiFetch()
  const [entries, setEntries] = useState([])
  const [version, setVersion] = useState('')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function load() {
    apiFetch('/api/changelog')
      .then((r) => (r.ok ? r.json() : []))
      .then(setEntries)
      .catch(() => {})
  }

  useEffect(load, [apiFetch])

  async function submit(e) {
    e.preventDefault()
    if (!title.trim() || !body.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch('/api/changelog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: version.trim() || undefined,
          title: title.trim(),
          body: body.trim()
        })
      })
      if (!res.ok) throw new Error(await res.text())
      setVersion('')
      setTitle('')
      setBody('')
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function remove(id) {
    await apiFetch(`/api/changelog/${id}`, { method: 'DELETE' })
    load()
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          margin: '1.5rem 0 1rem'
        }}
      >
        <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>New entry</h2>
        <a
          href="/changelog"
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 13, color: 'var(--accent)' }}
        >
          View public page →
        </a>
      </div>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            placeholder="Version (e.g. v5.41.0)"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            style={{
              flex: '0 0 180px',
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--input-bg)',
              color: 'var(--fg)',
              fontSize: 14
            }}
          />
          <input
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            style={{
              flex: 1,
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--input-bg)',
              color: 'var(--fg)',
              fontSize: 14
            }}
          />
        </div>
        <textarea
          placeholder="Body (markdown supported)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          rows={10}
          style={{
            padding: '8px 10px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--input-bg)',
            color: 'var(--fg)',
            fontSize: 14,
            fontFamily: 'monospace',
            resize: 'vertical'
          }}
        />
        {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
        <div>
          <button
            type="submit"
            disabled={saving}
            style={{
              padding: '7px 18px',
              background: 'var(--accent)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 14
            }}
          >
            {saving ? 'Saving…' : 'Publish'}
          </button>
        </div>
      </form>

      <h2 style={{ fontSize: '1rem', fontWeight: 600, margin: '2rem 0 0.75rem' }}>
        Entries ({entries.length})
      </h2>
      {entries.map((e) => (
        <div
          key={e.id}
          style={{
            padding: '10px 12px',
            marginBottom: 8,
            borderRadius: 6,
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {e.version && (
              <span
                style={{ fontSize: 11, fontWeight: 700, color: 'var(--hotpink)', marginRight: 8 }}
              >
                {e.version}
              </span>
            )}
            <span style={{ fontSize: 14, fontWeight: 500 }}>{e.title}</span>
            <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--muted)' }}>
              {formatDateShort(e.published_at)}
            </span>
          </div>
          <button
            onClick={() => remove(e.id)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--muted)',
              fontSize: 18,
              lineHeight: 1,
              padding: '0 2px',
              flexShrink: 0
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
