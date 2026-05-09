import { useState, useRef } from 'react'
import { X } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'

export default function Ingest() {
  const [files, setFiles]     = useState([])
  const [loading, setLoading] = useState(false)
  const [result, setResult]   = useState(null)
  const [error, setError]     = useState(null)
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
  }

  function onDrop(e) {
    e.preventDefault()
    handleFiles([...e.dataTransfer.files])
  }

  function removeFile(name) {
    setFiles(f => f.filter(x => x.name !== name))
  }

  async function submit() {
    if (!files.length) return
    setLoading(true); setError(null); setResult(null)
    try {
      const fd = new FormData()
      files.forEach(f => fd.append('files', f))
      const res = await apiFetch('/api/ingest', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
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
