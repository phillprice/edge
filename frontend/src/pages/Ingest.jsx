import { useState, useRef, useEffect } from 'react'
import { X } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'

function BackupPanel() {
  const [importing, setImporting] = useState(false)
  const [msg, setMsg] = useState(null)
  const fileRef = useRef()
  const apiFetch = useApiFetch()

  async function doExport() {
    const res = await apiFetch('/api/admin/export')
    if (!res.ok) { setMsg({ error: true, text: 'Export failed' }); return }
    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    const date = new Date().toISOString().slice(0, 10)
    a.href = url; a.download = `cricket-${date}.db`; a.click()
    URL.revokeObjectURL(url)
  }

  async function doImport(e) {
    const file = e.target.files[0]
    if (!file) return
    if (!confirm(`Replace ALL data with "${file.name}"? This cannot be undone.`)) return
    setImporting(true); setMsg(null)
    const form = new FormData(); form.append('db', file)
    try {
      const res = await apiFetch('/api/admin/import', { method: 'POST', body: form })
      const data = await res.json()
      setMsg(res.ok ? { error: false, text: 'Import successful — page will reload' } : { error: true, text: data.error })
      if (res.ok) setTimeout(() => window.location.reload(), 1500)
    } catch {
      setMsg({ error: true, text: 'Import failed' })
    } finally {
      setImporting(false)
      fileRef.current.value = ''
    }
  }

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.75rem' }}>Backup &amp; restore</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
        Export downloads a complete copy of the database. Import replaces all data — use with care.
      </p>
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={doExport}>Export database</button>
        <button className="secondary" onClick={() => fileRef.current.click()} disabled={importing}>
          {importing ? 'Importing…' : 'Import database'}
        </button>
        <input ref={fileRef} type="file" accept=".db" style={{ display: 'none' }} onChange={doImport} />
      </div>
      {msg && (
        <div className={`alert ${msg.error ? 'alert-error' : 'alert-success'}`} style={{ marginTop: '0.75rem' }}>
          {msg.text}
        </div>
      )}
    </div>
  )
}

function FetchPanel() {
  const [url, setUrl]       = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState(null)
  const [error, setError]     = useState(null)
  const apiFetch = useApiFetch()

  async function submit(e) {
    e.preventDefault()
    if (!url.trim()) return
    setLoading(true); setResult(null); setError(null)
    try {
      const res  = await apiFetch('/api/admin/fetch-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Fetch failed')
      setResult(data)
      setUrl('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Fetch from play-cricket</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '0.75rem' }}>
        Paste a play-cricket results URL — the match will be fetched and imported automatically.
      </p>
      <form onSubmit={submit} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <input
          type="url"
          placeholder="https://whcc.play-cricket.com/website/results/7449428"
          value={url}
          onChange={e => { setUrl(e.target.value); setResult(null); setError(null) }}
          style={{ flex: 1, minWidth: '280px' }}
        />
        <button type="submit" disabled={loading || !url.trim()}>
          {loading ? 'Fetching…' : 'Import'}
        </button>
      </form>
      {result && (
        <div className="alert alert-success" style={{ marginTop: '0.75rem' }}>
          <strong>Imported!</strong>
          {result.matchMeta && (
            <span style={{ marginLeft: 6 }}>
              {result.matchMeta.homeTeam} vs {result.matchMeta.awayTeam} — {result.matchMeta.matchDate}
            </span>
          )}
          {result.results.map(r => (
            <div key={r.resultId} style={{ fontSize: '0.83rem', marginTop: 3 }}>
              Innings {r.inningsOrder}: {r.deliveries} deliveries · {r.players} players
            </div>
          ))}
          <div style={{ marginTop: 6 }}>
            <a href="/" style={{ color: '#2e7d32', fontWeight: 500, fontSize: '0.85rem' }}>View matches →</a>
          </div>
        </div>
      )}
      {error && (
        <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  )
}

function UnnamedPanel() {
  const [players, setPlayers] = useState(null)
  const [names,   setNames]   = useState({})
  const [saving,  setSaving]  = useState({})
  const [saved,   setSaved]   = useState({})
  const apiFetch = useApiFetch()

  useEffect(() => {
    apiFetch('/api/players/unnamed')
      .then(r => r.json())
      .then(d => {
        setPlayers(d)
        const initial = {}
        d.forEach(p => { initial[p.player_id] = p.display_name || '' })
        setNames(initial)
      })
      .catch(() => setPlayers([]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save(playerId) {
    const name = (names[playerId] || '').trim()
    if (!name) return
    setSaving(s => ({ ...s, [playerId]: true }))
    try {
      await apiFetch(`/api/players/${playerId}/name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      setSaved(s => ({ ...s, [playerId]: true }))
      setTimeout(() => setSaved(s => ({ ...s, [playerId]: false })), 2000)
    } finally {
      setSaving(s => ({ ...s, [playerId]: false }))
    }
  }

  if (!players || players.length === 0) return null

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Unnamed players</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
        These WHCC players were imported without a name. Enter their real name and save.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {players.map(p => (
          <div key={p.player_id} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '0.88rem' }}>
            <span style={{ color: 'var(--text3)', minWidth: 110 }}>{p.name}</span>
            <span style={{ color: 'var(--text2)', flex: 1, minWidth: 200 }}>
              {p.match_count} match{p.match_count !== 1 ? 'es' : ''} ·{' '}
              {p.fixture_ids.map((fid, i) => (
                <span key={fid}>
                  {i > 0 && ', '}
                  <a href={`/match/${fid}`} style={{ color: 'var(--accent)' }}>#{fid}</a>
                </span>
              ))}
            </span>
            <input
              type="text"
              placeholder="Real name…"
              value={names[p.player_id] || ''}
              onChange={e => setNames(n => ({ ...n, [p.player_id]: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && save(p.player_id)}
              style={{ width: 180 }}
            />
            <button
              onClick={() => save(p.player_id)}
              disabled={saving[p.player_id] || !names[p.player_id]?.trim()}
              style={{ minWidth: 60 }}
            >
              {saved[p.player_id] ? 'Saved!' : saving[p.player_id] ? '…' : 'Save'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Ingest() {
  const [files, setFiles]         = useState([])
  const [loading, setLoading]     = useState(false)
  const [result, setResult]       = useState(null)
  const [error, setError]         = useState(null)
  const [duplicate, setDuplicate] = useState(null)
  const inputRef = useRef()
  const apiFetch = useApiFetch()

  function handleFiles(incoming) {
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name))
      const next = [...prev]
      for (const f of incoming) if (!names.has(f.name)) next.push(f)
      return next
    })
    setResult(null)
    setError(null)
    setDuplicate(null)
  }

  function onDrop(e) {
    e.preventDefault()
    handleFiles([...e.dataTransfer.files])
  }

  function removeFile(name) {
    setFiles(f => f.filter(x => x.name !== name))
  }

  async function submit(overwrite = false) {
    if (!files.length) return
    setLoading(true); setError(null); setResult(null); setDuplicate(null)
    try {
      const fd = new FormData()
      files.forEach(f => fd.append('files', f))
      const url = overwrite ? '/api/ingest?overwrite=true' : '/api/ingest'
      const res = await apiFetch(url, { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      if (data.alreadyExists) {
        setDuplicate(data)
        return
      }
      setResult(data)
      setFiles([])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const htmls  = files.filter(f => f.name.toLowerCase().endsWith('.html'))
  const jsons  = files.filter(f => f.name.toLowerCase().endsWith('.json'))

  return (
    <div className="page">
      <h1>Upload match data</h1>

      <FetchPanel />

      <div className="card">
        <p style={{ marginBottom: '1rem', color: '#555', fontSize: '0.9rem' }}>
          Upload the <strong>print.html scorecard</strong> from play-cricket and one or more
          <strong> innings JSON files</strong> for the same match. Re-uploading the same match
          is safe — it will update existing data without creating duplicates.
        </p>

        <div
          className={`drop-zone ${files.length ? 'active' : ''}`}
          onDrop={onDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => inputRef.current.click()}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".html,.json"
            onChange={e => handleFiles([...e.target.files])}
          />
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📂</div>
          <div>Drag & drop files here, or click to browse</div>
          <div style={{ fontSize: '0.8rem', marginTop: '4px' }}>print.html scorecard + innings JSON files</div>
        </div>

        {files.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {htmls.map(f => (
                <FileRow key={f.name} file={f} type="HTML" onRemove={removeFile} />
              ))}
              {jsons.map(f => (
                <FileRow key={f.name} file={f} type="JSON" onRemove={removeFile} />
              ))}
            </div>
            <div style={{ marginTop: '1rem', display: 'flex', gap: '8px' }}>
              <button onClick={submit} disabled={loading || !jsons.length}>
                {loading ? 'Uploading…' : 'Import data'}
              </button>
              <button className="secondary" onClick={() => setFiles([])}>Clear</button>
            </div>
            {!jsons.length && (
              <p style={{ color: '#c0392b', fontSize: '0.82rem', marginTop: '6px' }}>
                Add at least one innings JSON file.
              </p>
            )}
          </div>
        )}
      </div>

      {duplicate && (
        <div className="alert alert-warning">
          <strong>Duplicate match detected.</strong>{' '}
          This match is already in the database (fixture #{duplicate.fixtureId}). Upload again to overwrite?
          <div style={{ marginTop: '0.6rem', display: 'flex', gap: '8px' }}>
            <button onClick={() => submit(true)} disabled={loading}>
              {loading ? 'Uploading…' : 'Confirm overwrite'}
            </button>
            <button className="secondary" onClick={() => setDuplicate(null)}>Cancel</button>
          </div>
        </div>
      )}

      {result && (
        <div className="alert alert-success">
          <strong>Imported successfully!</strong>
          {result.results.map(r => (
            <div key={r.file} style={{ marginTop: '4px', fontSize: '0.85rem' }}>
              {r.file}: {r.deliveries} deliveries · {r.players} players · fixture #{r.fixtureId}
            </div>
          ))}
          {result.matchMeta && (
            <div style={{ marginTop: '6px', fontSize: '0.85rem' }}>
              Match: {result.matchMeta.homeTeam} vs {result.matchMeta.awayTeam} —{' '}
              {result.matchMeta.matchDate}
            </div>
          )}
          <div style={{ marginTop: '8px' }}>
            <a href="/" style={{ color: '#2e7d32', fontWeight: 500, fontSize: '0.85rem' }}>
              View matches →
            </a>
          </div>
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          <strong>Error:</strong> {error}
        </div>
      )}

      <UnnamedPanel />
      <BackupPanel />
    </div>
  )
}

function FileRow({ file, type, onRemove }) {
  const colours = { HTML: 'tag-green', JSON: 'tag-blue' }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.88rem' }}>
      <span className={`tag ${colours[type] || 'tag-blue'}`}>{type}</span>
      <span style={{ flex: 1 }}>{file.name}</span>
      <span className="muted">{(file.size / 1024).toFixed(0)} KB</span>
      <button className="secondary" style={{ padding: '2px 8px', fontSize: '0.8rem' }} onClick={() => onRemove(file.name)}><X size={12} /></button>
    </div>
  )
}
