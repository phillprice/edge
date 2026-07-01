import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { useApiFetch } from '../../hooks/useApiFetch'
import { useGroups } from '../../GroupContext'
import { shortYear } from '../../utils/cricket'
import TagPicker from '../../components/TagPicker'

// ── Ingest tab ────────────────────────────────────────────────────────────────

const INGEST_TABS = [
  { id: 'fetch', label: 'Fetch from URL' },
  { id: 'pdf', label: 'Upload App PDF' },
  { id: 'export', label: 'Upload Play-Cricket export' }
]

export default function IngestTab() {
  const [mode, setMode] = useState('fetch')
  return (
    <>
      <div
        style={{
          display: 'flex',
          gap: 4,
          flexWrap: 'wrap',
          marginBottom: '1.25rem',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '0.75rem'
        }}
      >
        {INGEST_TABS.map((t) => (
          <button
            key={t.id}
            className={mode === t.id ? '' : 'secondary'}
            onClick={() => setMode(t.id)}
            style={{ fontSize: '0.82rem', padding: '3px 12px' }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {mode === 'fetch' && <FetchPanel />}
      {mode === 'pdf' && <ScorecardImportTab />}
      {mode === 'export' && <UploadPanel />}
    </>
  )
}

function FetchPanel() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const apiFetch = useApiFetch()
  const { playCricketDomain } = useGroups()

  async function submit(e) {
    e.preventDefault()
    if (!url.trim()) return
    setLoading(true)
    setResult(null)
    setError(null)
    try {
      const res = await apiFetch('/api/admin/fetch-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() })
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
          placeholder={`https://${playCricketDomain ?? 'yourclub.play-cricket.com'}/website/results/7449428`}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            setResult(null)
            setError(null)
          }}
          style={{ flex: '1 1 200px', minWidth: 0, width: '100%' }}
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
              {result.matchMeta.homeTeam} vs {result.matchMeta.awayTeam} —{' '}
              {result.matchMeta.matchDate}
            </span>
          )}
          {result.results.map((r) => (
            <div key={r.resultId} style={{ fontSize: '0.83rem', marginTop: 3 }}>
              Innings {r.inningsOrder}: {r.deliveries} deliveries · {r.players} players
            </div>
          ))}
          <div style={{ marginTop: 6 }}>
            <a href="/" style={{ color: '#2e7d32', fontWeight: 500, fontSize: '0.85rem' }}>
              View matches →
            </a>
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

function FileRow({ file, type, onRemove }) {
  const colours = { HTML: 'tag-green', JSON: 'tag-blue' }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.88rem' }}>
      <span className={`tag ${colours[type] || 'tag-blue'}`}>{type}</span>
      <span style={{ flex: 1 }}>{file.name}</span>
      <span className="muted">{(file.size / 1024).toFixed(0)} KB</span>
      <button
        className="secondary"
        style={{ padding: '2px 8px', fontSize: '0.8rem' }}
        onClick={() => onRemove(file.name)}
      >
        <X size={12} />
      </button>
    </div>
  )
}

function UploadPanel() {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [duplicate, setDuplicate] = useState(null)
  const inputRef = useRef()
  const apiFetch = useApiFetch()

  function handleFiles(incoming) {
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name))
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
    setFiles((f) => f.filter((x) => x.name !== name))
  }

  async function submit(overwrite = false) {
    if (!files.length) return
    setLoading(true)
    setError(null)
    setResult(null)
    setDuplicate(null)
    try {
      const fd = new FormData()
      files.forEach((f) => fd.append('files', f))
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

  const htmls = files.filter((f) => f.name.toLowerCase().endsWith('.html'))
  const jsons = files.filter((f) => f.name.toLowerCase().endsWith('.json'))

  return (
    <div className="card">
      <p style={{ marginBottom: '1rem', color: 'var(--text2)', fontSize: '0.9rem' }}>
        Upload the <strong>print.html scorecard</strong> and one or more{' '}
        <strong>innings JSON files</strong>. Re-uploading the same match is safe — it updates
        without creating duplicates.
      </p>
      <div
        className={`drop-zone ${files.length ? 'active' : ''}`}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => inputRef.current.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".html,.json"
          onChange={(e) => handleFiles([...e.target.files])}
        />
        <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📂</div>
        <div>Drag & drop files here, or click to browse</div>
        <div style={{ fontSize: '0.8rem', marginTop: '4px' }}>
          print.html scorecard + innings JSON files
        </div>
      </div>

      {files.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {htmls.map((f) => (
              <FileRow key={f.name} file={f} type="HTML" onRemove={removeFile} />
            ))}
            {jsons.map((f) => (
              <FileRow key={f.name} file={f} type="JSON" onRemove={removeFile} />
            ))}
          </div>
          {jsons.length === 0 && (
            <p style={{ color: 'var(--orange)', fontSize: '0.85rem', marginTop: '0.5rem' }}>
              Add at least one innings JSON file.
            </p>
          )}
          <button
            disabled={loading || jsons.length === 0}
            onClick={() => submit(false)}
            style={{ marginTop: '1rem' }}
          >
            {loading ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      )}

      {duplicate && (
        <div className="alert alert-error" style={{ marginTop: '1rem' }}>
          <strong>Already exists.</strong> This match has already been ingested.
          <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
            <button onClick={() => submit(true)}>Overwrite</button>
            <button className="secondary" onClick={() => setDuplicate(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="alert alert-success" style={{ marginTop: '1rem' }}>
          <strong>Uploaded!</strong>
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
        <div className="alert alert-error" style={{ marginTop: '1rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}
    </div>
  )
}

function BattingPreviewRow({ b, innIdx, ri, onUpdate }) {
  const dnb = b.did_not_bat
  return (
    <tr style={{ borderBottom: '1px solid var(--border-light)' }}>
      <td style={{ padding: '3px 6px' }}>
        <input
          value={b.name || ''}
          onChange={(e) => onUpdate(innIdx, 'batting', ri, 'name', e.target.value)}
          style={{ width: 180, fontSize: '0.82rem' }}
        />
        {b.matched && (
          <span style={{ color: 'var(--green)', marginLeft: 4, fontSize: '0.75rem' }}>
            ✓ matched
          </span>
        )}
        {!b.matched && !dnb && (
          <span style={{ color: 'var(--text3)', marginLeft: 4, fontSize: '0.75rem' }}>new</span>
        )}
      </td>
      <td style={{ textAlign: 'center', padding: '3px 6px' }}>{dnb ? '—' : b.runs}</td>
      <td style={{ textAlign: 'center', padding: '3px 6px' }}>{dnb ? '—' : b.balls}</td>
      <td style={{ textAlign: 'center', padding: '3px 6px' }}>{dnb ? '—' : b.fours}</td>
      <td style={{ textAlign: 'center', padding: '3px 6px' }}>{dnb ? '—' : b.sixes}</td>
      <td style={{ padding: '3px 6px' }}>{dnb ? 'did not bat' : b.how_out}</td>
      <td style={{ padding: '3px 6px', fontSize: '0.75rem', color: 'var(--text3)' }}>
        {dnb ? 'dnb' : b.not_out ? 'not out' : 'out'}
      </td>
    </tr>
  )
}

function BowlingPreviewRow({ b, innIdx, ri, onUpdate }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--border-light)' }}>
      <td style={{ padding: '3px 6px' }}>
        <input
          value={b.name || ''}
          onChange={(e) => onUpdate(innIdx, 'bowling', ri, 'name', e.target.value)}
          style={{ width: 180, fontSize: '0.82rem' }}
        />
        {b.matched && (
          <span style={{ color: 'var(--green)', marginLeft: 4, fontSize: '0.75rem' }}>✓</span>
        )}
        {!b.matched && (
          <span style={{ color: 'var(--text3)', marginLeft: 4, fontSize: '0.75rem' }}>new</span>
        )}
      </td>
      <td style={{ textAlign: 'center', padding: '3px 6px' }}>{b.overs}</td>
      <td style={{ textAlign: 'center', padding: '3px 6px' }}>{b.maidens}</td>
      <td style={{ textAlign: 'center', padding: '3px 6px' }}>{b.runs}</td>
      <td style={{ textAlign: 'center', padding: '3px 6px' }}>{b.wickets}</td>
      <td style={{ textAlign: 'center', padding: '3px 6px' }}>{b.wides}</td>
      <td style={{ textAlign: 'center', padding: '3px 6px' }}>{b.no_balls}</td>
      <td style={{ padding: '3px 6px', fontSize: '0.75rem', color: 'var(--text3)' }}>
        {b.matched ? 'db match' : 'will create'}
      </td>
    </tr>
  )
}

// ── Scorecard import tab ──────────────────────────────────────────────────────

function useScorecardImport() {
  const apiFetch = useApiFetch()
  const navigate = useNavigate()
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState(null)
  const [tags, setTags] = useState(['friendly'])
  const [competition, setCompetition] = useState('')
  const [ground, setGround] = useState('')
  const [format, setFormat] = useState('t20')
  const [teams, setTeams] = useState([])
  const [teamSeason, setTeamSeason] = useState('')

  useEffect(() => {
    apiFetch('/api/access-requests/teams')
      .then((r) => (r.ok ? r.json() : []))
      .then((ts) => setTeams(Array.isArray(ts) ? ts : []))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setLoading(true)
    setError(null)
    setPreview(null)
    try {
      const fd = new FormData()
      fd.append('pdf', file)
      const res = await apiFetch('/api/admin/import/scorecard-parse', { method: 'POST', body: fd })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Parse failed')
      }
      setPreview(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  function updatePlayerName(innIdx, type, rowIdx, field, value) {
    setPreview((prev) => {
      const copy = structuredClone(prev)
      copy.innings[innIdx][type][rowIdx][field] = value
      if (field === 'name') copy.innings[innIdx][type][rowIdx].player_id = null
      return copy
    })
  }

  function updateTeamName(field, value) {
    setPreview((prev) => {
      const oldVal = prev[field]
      return {
        ...prev,
        [field]: value,
        innings: prev.innings.map((inn) => ({
          ...inn,
          batting_team: inn.batting_team === oldVal ? value : inn.batting_team,
          bowling_team: inn.bowling_team === oldVal ? value : inn.bowling_team
        }))
      }
    })
  }

  async function handleCommit() {
    setCommitting(true)
    setError(null)
    try {
      const tsFields = teamSeason
        ? { team_id: Number(teamSeason.split(':')[0]), season_id: Number(teamSeason.split(':')[1]) }
        : {}
      const res = await apiFetch('/api/admin/import/scorecard-commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...preview,
          tags,
          competition,
          ground,
          format,
          ...tsFields
        })
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || 'Commit failed')
      }
      const { fixture_id } = await res.json()
      navigate(`/match/${fixture_id}`)
    } catch (err) {
      setError(err.message)
      setCommitting(false)
    }
  }

  return {
    preview,
    loading,
    committing,
    error,
    tags,
    setTags,
    competition,
    setCompetition,
    ground,
    setGround,
    format,
    setFormat,
    teams,
    teamSeason,
    setTeamSeason,
    handleFile,
    updatePlayerName,
    updateTeamName,
    handleCommit
  }
}

function ScorecardImportControls({ fileRef, imp }) {
  const {
    loading,
    preview,
    tags,
    setTags,
    format,
    setFormat,
    competition,
    setCompetition,
    ground,
    setGround,
    teams,
    teamSeason,
    setTeamSeason,
    committing,
    handleFile,
    handleCommit
  } = imp
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.75rem',
        alignItems: 'center',
        marginBottom: '1rem',
        flexWrap: 'wrap'
      }}
    >
      <input
        type="file"
        accept=".pdf"
        ref={fileRef}
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      <button onClick={() => fileRef.current?.click()} disabled={loading}>
        {loading ? 'Parsing…' : 'Choose PDF'}
      </button>
      {preview && (
        <>
          <TagPicker value={tags} onChange={setTags} />
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value)}
            style={{ width: 'auto' }}
          >
            {[
              ['t20', 'T20'],
              ['standard', 'Standard'],
              ['declaration', 'Declaration']
            ].map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <input
            placeholder="Competition"
            value={competition}
            onChange={(e) => setCompetition(e.target.value)}
            style={{ width: 150 }}
          />
          <input
            placeholder="Ground"
            value={ground}
            onChange={(e) => setGround(e.target.value)}
            style={{ width: 150 }}
          />
          {teams.length > 0 && (
            <select
              value={teamSeason}
              onChange={(e) => setTeamSeason(e.target.value)}
              style={{ maxWidth: 200 }}
              title="Associate with team/season so it appears in the match list"
            >
              <option value="">— Season (access) —</option>
              {teams.map((t) => (
                <option key={`${t.team_id}:${t.season_id}`} value={`${t.team_id}:${t.season_id}`}>
                  {t.year ? `${t.label} '${shortYear(t.year)}` : t.label}
                </option>
              ))}
            </select>
          )}
          <button onClick={handleCommit} disabled={committing} className="primary">
            {committing ? 'Importing…' : 'Import Match'}
          </button>
        </>
      )}
    </div>
  )
}

function ScorecardInningsSection({ inn, innIdx, updatePlayerName }) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <h4 style={{ marginBottom: '0.5rem' }}>
        Innings {innIdx + 1}: {inn.batting_team} batting
      </h4>
      <p style={{ fontSize: '0.82rem', color: 'var(--text2)', marginBottom: '0.4rem' }}>
        Batting ({inn.batting?.length} rows)
      </p>
      <table style={{ fontSize: '0.82rem', width: '100%', marginBottom: '1rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '2px 6px' }}>Name</th>
            <th style={{ padding: '2px 6px' }}>R</th>
            <th style={{ padding: '2px 6px' }}>B</th>
            <th style={{ padding: '2px 6px' }}>4s</th>
            <th style={{ padding: '2px 6px' }}>6s</th>
            <th style={{ textAlign: 'left', padding: '2px 6px' }}>How out</th>
            <th style={{ textAlign: 'left', padding: '2px 6px' }}>Match status</th>
          </tr>
        </thead>
        <tbody>
          {inn.batting?.map((b, ri) => (
            <BattingPreviewRow key={ri} b={b} innIdx={innIdx} ri={ri} onUpdate={updatePlayerName} />
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: '0.82rem', color: 'var(--text2)', marginBottom: '0.4rem' }}>
        Bowling ({inn.bowling?.length} rows)
      </p>
      <table style={{ fontSize: '0.82rem', width: '100%', marginBottom: '0.75rem' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <th style={{ textAlign: 'left', padding: '2px 6px' }}>Name</th>
            <th style={{ padding: '2px 6px' }}>O</th>
            <th style={{ padding: '2px 6px' }}>M</th>
            <th style={{ padding: '2px 6px' }}>R</th>
            <th style={{ padding: '2px 6px' }}>W</th>
            <th style={{ padding: '2px 6px' }}>Wd</th>
            <th style={{ padding: '2px 6px' }}>Nb</th>
            <th style={{ textAlign: 'left', padding: '2px 6px' }}>Match status</th>
          </tr>
        </thead>
        <tbody>
          {inn.bowling?.map((b, ri) => (
            <BowlingPreviewRow key={ri} b={b} innIdx={innIdx} ri={ri} onUpdate={updatePlayerName} />
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>
        {inn.overs?.length} overs parsed · {inn.fallOfWickets?.length} fall of wickets
      </p>
    </div>
  )
}

function ScorecardPreviewPanel({ preview, updateTeamName, updatePlayerName }) {
  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          flexWrap: 'wrap',
          marginBottom: '1rem',
          fontSize: '0.9rem',
          color: 'var(--text2)'
        }}
      >
        <input
          value={preview.home_team || ''}
          onChange={(e) => updateTeamName('home_team', e.target.value)}
          style={{ width: 180, fontWeight: 600 }}
          title="Home team — edit if the scorecard name differs from your team list"
        />
        <span>vs</span>
        <input
          value={preview.away_team || ''}
          onChange={(e) => updateTeamName('away_team', e.target.value)}
          style={{ width: 180, fontWeight: 600 }}
          title="Away team — edit if the scorecard name differs from your team list"
        />
        <span style={{ color: 'var(--text3)' }}>— {preview.match_date}</span>
      </div>
      {preview.innings.map((inn, innIdx) => (
        <ScorecardInningsSection
          key={innIdx}
          inn={inn}
          innIdx={innIdx}
          updatePlayerName={updatePlayerName}
        />
      ))}
    </div>
  )
}

function ScorecardImportTab() {
  const fileRef = useRef(null)
  const imp = useScorecardImport()
  return (
    <div>
      <h3 style={{ marginBottom: '0.75rem' }}>Import Custom Match Scorecard (PDF)</h3>
      <ScorecardImportControls fileRef={fileRef} imp={imp} />
      {imp.error && <p style={{ color: 'var(--red)', marginBottom: '1rem' }}>{imp.error}</p>}
      {imp.preview && (
        <ScorecardPreviewPanel
          preview={imp.preview}
          updateTeamName={imp.updateTeamName}
          updatePlayerName={imp.updatePlayerName}
        />
      )}
    </div>
  )
}
