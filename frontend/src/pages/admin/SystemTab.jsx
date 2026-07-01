import { useState, useRef } from 'react'
import { useApiFetch } from '../../hooks/useApiFetch'

// ── System tab ────────────────────────────────────────────────────────────────

export default function SystemTab() {
  return <BackupPanel />
}

function BackupPanel() {
  const [importing, setImporting] = useState(false)
  const [msg, setMsg] = useState(null)
  const fileRef = useRef()
  const apiFetch = useApiFetch()

  async function doExport() {
    const res = await apiFetch('/api/admin/export')
    if (!res.ok) {
      setMsg({ error: true, text: 'Export failed' })
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const date = new Date().toISOString().slice(0, 10)
    a.href = url
    a.download = `cricket-${date}.db`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function doImport(e) {
    const file = e.target.files[0]
    if (!file) return
    if (!confirm(`Replace ALL data with "${file.name}"? This cannot be undone.`)) return
    setImporting(true)
    setMsg(null)
    const form = new FormData()
    form.append('db', file)
    try {
      const res = await apiFetch('/api/admin/import', { method: 'POST', body: form })
      const data = await res.json()
      setMsg(
        res.ok
          ? { error: false, text: 'Import successful — page will reload' }
          : { error: true, text: data.error }
      )
      if (res.ok) setTimeout(() => window.location.reload(), 1500)
    } catch {
      setMsg({ error: true, text: 'Import failed' })
    } finally {
      setImporting(false)
      fileRef.current.value = ''
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginBottom: '0.75rem' }}>Backup &amp; restore</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
        Export downloads a complete copy of the database. Import replaces all data — use with care.
      </p>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={doExport}>Export database</button>
        <button className="secondary" onClick={() => fileRef.current.click()} disabled={importing}>
          {importing ? 'Importing…' : 'Import database'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".db"
          style={{ display: 'none' }}
          onChange={doImport}
        />
      </div>
      {msg && (
        <div
          className={`alert ${msg.error ? 'alert-error' : 'alert-success'}`}
          style={{ marginTop: '0.75rem' }}
        >
          {msg.text}
        </div>
      )}
    </div>
  )
}
