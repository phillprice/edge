import { useState, useRef, useEffect } from 'react'
import { X } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'
import { shortTeam, isWhccTeam } from '../utils/cricket'

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

function PlayerSearch({ label, players, selected, onSelect, exclude }) {
  const [query, setQuery] = useState('')
  const selectedPlayer = selected != null ? players.find(p => p.player_id === selected) : null
  const filtered = query.length < 2 ? [] : players
    .filter(p => p.player_id !== exclude)
    .filter(p => {
      const q = query.toLowerCase()
      const name = (p.display_name || p.name || '').toLowerCase()
      return name.includes(q) || String(p.player_id).includes(q)
    })
    .slice(0, 8)

  return (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: 4, color: 'var(--text2)' }}>{label}</div>
      {selectedPlayer ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', background: 'var(--bg2)', borderRadius: 4, border: '1px solid var(--border)' }}>
          <span style={{ flex: 1, fontSize: '0.88rem' }}>
            {selectedPlayer.display_name || selectedPlayer.name}
            <span style={{ color: 'var(--text3)', fontSize: '0.78rem' }}> #{selectedPlayer.player_id}</span>
          </span>
          <button className="secondary" style={{ padding: '1px 7px', fontSize: '0.8rem' }} onClick={() => onSelect(null)}>×</button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <input type="text" placeholder="Search name or ID…" value={query} onChange={e => setQuery(e.target.value)} style={{ width: '100%' }} />
          {filtered.length > 0 && (
            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, zIndex: 10, maxHeight: 200, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
              {filtered.map(p => (
                <div key={p.player_id}
                  onClick={() => { onSelect(p.player_id); setQuery('') }}
                  style={{ padding: '6px 10px', cursor: 'pointer', fontSize: '0.85rem' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg2)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}>
                  {p.display_name || p.name}
                  <span style={{ color: 'var(--text3)', fontSize: '0.78rem' }}> #{p.player_id} · {p.team || '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MergePanel() {
  const [players,     setPlayers]     = useState(null)
  const [suggestions, setSuggestions] = useState([])
  const [keepId,  setKeepId]  = useState(null)
  const [dropId,  setDropId]  = useState(null)
  const [merging, setMerging] = useState(false)
  const [msg,     setMsg]     = useState(null)
  const apiFetch = useApiFetch()

  useEffect(() => {
    apiFetch('/api/players').then(r => r.json()).then(setPlayers).catch(() => setPlayers([]))
    apiFetch('/api/admin/duplicate-players').then(r => r.json()).then(setSuggestions).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function doMerge() {
    if (!keepId || !dropId) return
    if (!confirm(`Merge player #${dropId} into #${keepId}? All their deliveries, stats, and dismissals will be reassigned. This cannot be undone.`)) return
    setMerging(true); setMsg(null)
    try {
      const res = await apiFetch('/api/admin/merge-players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepId, dropId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Merge failed')
      setMsg({ error: false, text: `Player #${dropId} merged into #${keepId} successfully.` })
      setDropId(null)
      setSuggestions(s => s.filter(g => !g.players.some(p => p.player_id === dropId)))
    } catch (e) {
      setMsg({ error: true, text: e.message })
    } finally {
      setMerging(false)
    }
  }

  if (!players) return null

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Merge players</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: suggestions.length ? '0.75rem' : '1rem' }}>
        Combine two player records into one. All deliveries and stats from the dropped player are reassigned to the kept player, then the duplicate is deleted.
      </p>
      {suggestions.length > 0 && (
        <div style={{ marginBottom: '1rem', padding: '0.6rem 0.75rem', background: 'var(--bg2)', borderRadius: 6 }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text2)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Suggested duplicates
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {suggestions.map(group => {
              const sorted = [...group.players].sort((a, b) => b.appearances - a.appearances)
              return (
                <div key={group.name} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                  <span style={{ fontWeight: 500, minWidth: 120 }}>{group.name}</span>
                  <span style={{ color: 'var(--text3)', fontSize: '0.78rem', flex: 1 }}>
                    {sorted.map((p, i) => `${i > 0 ? ' · ' : ''}#${p.player_id} (${p.appearances} del)`).join('')}
                  </span>
                  <button
                    className="secondary"
                    style={{ padding: '2px 10px', fontSize: '0.78rem' }}
                    onClick={() => { setKeepId(sorted[0].player_id); setDropId(sorted[1].player_id); setMsg(null) }}
                  >
                    Prefill
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <PlayerSearch label="Keep" players={players} selected={keepId} onSelect={id => { setKeepId(id); setMsg(null) }} exclude={dropId} />
        <PlayerSearch label="Drop (delete)" players={players} selected={dropId} onSelect={id => { setDropId(id); setMsg(null) }} exclude={keepId} />
      </div>
      <div style={{ marginTop: '1rem' }}>
        <button onClick={doMerge} disabled={merging || !keepId || !dropId}>
          {merging ? 'Merging…' : 'Merge players'}
        </button>
      </div>
      {msg && (
        <div className={`alert ${msg.error ? 'alert-error' : 'alert-success'}`} style={{ marginTop: '0.75rem' }}>
          {msg.text}
        </div>
      )}
    </div>
  )
}

const STATUS_COLOURS = { pending: 'tag-blue', done: 'tag-green', failed: 'tag-orange' }

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function FilterPills({ label, options, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.78rem', color: 'var(--text2)', marginRight: 2 }}>{label}</span>
      {options.map(o => (
        <button key={o.value} className={value === o.value ? 'pill active' : 'pill'} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function SortTh({ col, label, sortCol, sortDir, onSort, style }) {
  const active = sortCol === col
  return (
    <th
      onClick={() => onSort(col)}
      style={{ paddingBottom: '0.35rem', fontWeight: 600, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...style }}
    >
      {label}{active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  )
}

function AutoIngestPanel() {
  const [status,    setStatus]    = useState(null)
  const [urlInput,  setUrlInput]  = useState('')
  const [adding,    setAdding]    = useState(false)
  const [addMsg,    setAddMsg]    = useState(null)
  const [acting,    setActing]    = useState(null)
  const [sortCol,     setSortCol]     = useState('match_date_iso')
  const [sortDir,     setSortDir]     = useState('asc')
  const [filterTeam,  setFilterTeam]  = useState('all')
  const [filterMonth, setFilterMonth] = useState('all')
  const [filterSide,  setFilterSide]  = useState('all')
  const [filterStatus,setFilterStatus]= useState('all')
  const apiFetch = useApiFetch()

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  async function load() {
    try {
      const res = await apiFetch('/api/admin/scheduler/status')
      if (res.ok) setStatus(await res.json())
    } catch (_) { /* ignore fetch errors — UI stays stale */ }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function addTeam(e) {
    e.preventDefault()
    if (!urlInput.trim()) return
    setAdding(true); setAddMsg(null)
    try {
      const res = await apiFetch('/api/admin/scheduler/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to add team')
      setAddMsg({ ok: true, text: `Added: ${data.team.label}` })
      setUrlInput('')
      await load()
    } catch (err) {
      setAddMsg({ ok: false, text: err.message })
    } finally {
      setAdding(false)
    }
  }

  async function removeTeam(id) {
    await apiFetch(`/api/admin/scheduler/teams/${id}`, { method: 'DELETE' })
    await load()
  }

  async function act(endpoint) {
    setActing(endpoint)
    try {
      await apiFetch(`/api/admin/scheduler/${endpoint}`, { method: 'POST' })
      await load()
    } catch (_) { /* ignore — acting state cleared in finally */ }
    finally { setActing(null) }
  }

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Auto-ingest</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
        Add a team by pasting its Play Cricket fixtures URL. Fixtures are discovered daily and ingested 4 hours after the match start time.
      </p>

      <form onSubmit={addTeam} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <input
          type="text"
          placeholder="https://whcc.play-cricket.com/Matches?tab=Fixture&…&team_id=35533&season_id=259&…"
          value={urlInput}
          onChange={e => { setUrlInput(e.target.value); setAddMsg(null) }}
          style={{ flex: 1, minWidth: '280px' }}
        />
        <button type="submit" disabled={adding || !urlInput.trim()}>
          {adding ? 'Adding…' : 'Add team'}
        </button>
      </form>
      {addMsg && (
        <div className={`alert ${addMsg.ok ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: '0.75rem' }}>
          {addMsg.text}
        </div>
      )}

      {status && status.teams.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          {status.teams.map(t => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
              <span style={{ flex: 1, fontWeight: 500 }}>{t.label}</span>
              <span style={{ color: 'var(--text3)' }}>team {t.team_id} · season {t.season_id}</span>
              <button className="secondary" style={{ padding: '2px 8px', fontSize: '0.78rem' }} onClick={() => removeTeam(t.id)}>Remove</button>
            </div>
          ))}
        </div>
      )}

      {status && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text2)' }}>
              Queue: <strong>{status.queue.pending}</strong> pending · <strong>{status.queue.done}</strong> done · <strong>{status.queue.failed}</strong> failed
            </span>
            <button className="secondary" style={{ padding: '3px 10px', fontSize: '0.82rem' }} onClick={() => act('discover')} disabled={!!acting}>
              {acting === 'discover' ? 'Discovering…' : 'Discover now'}
            </button>
            {status.queue.failed > 0 && (
              <button className="secondary" style={{ padding: '3px 10px', fontSize: '0.82rem' }} onClick={() => act('retry')} disabled={!!acting}>
                {acting === 'retry' ? 'Resetting…' : 'Retry failed'}
              </button>
            )}
          </div>

          {status.recent.length > 0 && (() => {
            const teamLabels = Object.fromEntries((status.teams || []).map(t => [t.team_id, t.label]))
            const months = [...new Set(status.recent.map(r => r.match_date_iso?.slice(0, 7)).filter(Boolean))].sort()

            let rows = status.recent
            if (filterTeam !== 'all')   rows = rows.filter(r => String(r.team_id) === filterTeam)
            if (filterMonth !== 'all')  rows = rows.filter(r => r.match_date_iso?.startsWith(filterMonth))
            if (filterSide === 'home')  rows = rows.filter(r => isWhccTeam(r.home_team))
            if (filterSide === 'away')  rows = rows.filter(r => !isWhccTeam(r.home_team))
            if (filterStatus !== 'all') rows = rows.filter(r => r.status === filterStatus)

            const sortVal = r => sortCol === 'team_label'
              ? (teamLabels[r.team_id] ?? '')
              : r[sortCol] ?? ''
            const sorted = [...rows].sort((a, b) => {
              const va = sortVal(a), vb = sortVal(b)
              return (va < vb ? -1 : va > vb ? 1 : 0) * (sortDir === 'asc' ? 1 : -1)
            })

            const monthOpts = [{ value: 'all', label: 'All' }, ...months.map(m => {
              const [y, mo] = m.split('-')
              return { value: m, label: `${MONTH_NAMES[parseInt(mo, 10) - 1]} '${y.slice(2)}` }
            })]
            const thProps = { sortCol, sortDir, onSort: toggleSort }
            return (
              <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '0.75rem' }}>
                {status.teams.length > 1 && (
                  <FilterPills
                    label="Team"
                    options={[{ value: 'all', label: 'All' }, ...status.teams.map(t => ({ value: String(t.team_id), label: shortTeam(t.label) }))]}
                    value={filterTeam}
                    onChange={setFilterTeam}
                  />
                )}
                <FilterPills
                  label="Month"
                  options={monthOpts}
                  value={filterMonth}
                  onChange={setFilterMonth}
                />
                <FilterPills
                  label="Venue"
                  options={[{ value: 'all', label: 'All' }, { value: 'home', label: 'Home' }, { value: 'away', label: 'Away' }]}
                  value={filterSide}
                  onChange={setFilterSide}
                />
                <FilterPills
                  label="Status"
                  options={[{ value: 'all', label: 'All' }, { value: 'pending', label: 'Pending' }, { value: 'done', label: 'Done' }, { value: 'failed', label: 'Failed' }]}
                  value={filterStatus}
                  onChange={setFilterStatus}
                />
                {sorted.length !== status.recent.length && (
                  <span style={{ fontSize: '0.76rem', color: 'var(--text3)' }}>{sorted.length} of {status.recent.length}</span>
                )}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: '0.82rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ color: 'var(--text2)', textAlign: 'left' }}>
                      <SortTh col="match_date_iso" label="Date"       {...thProps} style={{ paddingRight: 12 }} />
                      <SortTh col="team_label"     label="Team"       {...thProps} style={{ paddingRight: 12 }} />
                      <SortTh col="home_team"      label="Match"      {...thProps} style={{ paddingRight: 12 }} />
                      <SortTh col="ground"         label="Ground"     {...thProps} style={{ paddingRight: 12 }} />
                      <SortTh col="status"         label="Status"     {...thProps} style={{ paddingRight: 12 }} />
                      <SortTh col="ingest_after"   label="Next fire"  {...thProps} style={{ paddingRight: 12 }} />
                      <SortTh col="ingested_at"    label="Ingested"   {...thProps} style={{ paddingRight: 12 }} />
                      <th style={{ paddingBottom: '0.35rem', fontWeight: 600 }}>Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(r => (
                      <tr key={r.play_cricket_id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '4px 0', paddingRight: 12, whiteSpace: 'nowrap' }}>{r.match_date_iso?.slice(0, 10)}</td>
                        <td style={{ padding: '4px 0', paddingRight: 12, whiteSpace: 'nowrap' }}>{shortTeam(teamLabels[r.team_id] || '')}</td>
                        <td style={{ padding: '4px 0', paddingRight: 12 }}>
                          {r.home_team && r.away_team
                            ? `${shortTeam(r.home_team)} v ${shortTeam(r.away_team)}`
                            : r.play_cricket_id}
                        </td>
                        <td style={{ padding: '4px 0', paddingRight: 12, color: 'var(--text2)' }}>{r.ground || '—'}</td>
                        <td style={{ padding: '4px 0', paddingRight: 12 }}>
                          <span className={`tag ${STATUS_COLOURS[r.status] || 'tag-blue'}`} style={{ fontSize: '0.74rem' }}>{r.status}</span>
                        </td>
                        <td style={{ padding: '4px 0', paddingRight: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                          {r.status === 'pending' && r.ingest_after
                            ? (() => {
                                const d = new Date(r.ingest_after)
                                const now = new Date()
                                const diffMin = Math.round((d - now) / 60_000)
                                const label = d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                                const rel = diffMin < 0 ? 'overdue' : diffMin < 60 ? `in ${diffMin}m` : diffMin < 1440 ? `in ${Math.round(diffMin/60)}h` : label
                                return <span title={label}>{rel}</span>
                              })()
                            : '—'}
                        </td>
                        <td style={{ padding: '4px 0', paddingRight: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                          {r.ingested_at ? r.ingested_at.slice(0, 16).replace('T', ' ') : '—'}
                        </td>
                        <td style={{ padding: '4px 0', color: 'var(--text3)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.error_msg || ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )
          })()}
        </>
      )}
    </div>
  )
}

function CronJobsPanel() {
  const [jobs, setJobs] = useState(null)
  const [loading, setLoading] = useState(false)
  const apiFetch = useApiFetch()

  async function load() {
    setLoading(true)
    try {
      const res = await apiFetch('/api/admin/scheduler/cron-jobs')
      if (res.ok) setJobs(await res.json())
    } catch (_) {}
    setLoading(false)
  }

  if (!jobs) return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h3 style={{ margin: 0, flex: 1 }}>cron-job.org live state</h3>
        <button className="secondary" style={{ fontSize: '0.82rem', padding: '3px 10px' }} onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Fetch'}
        </button>
      </div>
      <p style={{ fontSize: '0.82rem', color: 'var(--text2)', marginTop: '0.5rem', marginBottom: 0 }}>
        Fetches real job URL and next execution from cron-job.org API for all pending fixtures.
        Useful to verify jobs target the production URL, not localhost.
      </p>
    </div>
  )

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0, flex: 1 }}>cron-job.org live state</h3>
        <button className="secondary" style={{ fontSize: '0.82rem', padding: '3px 10px' }} onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {jobs.length === 0
        ? <p style={{ fontSize: '0.85rem', color: 'var(--text2)', margin: 0 }}>No pending cron jobs found.</p>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ color: 'var(--text2)', textAlign: 'left' }}>
                  <th style={{ paddingBottom: '0.35rem', paddingRight: 12, fontWeight: 600 }}>Match</th>
                  <th style={{ paddingBottom: '0.35rem', paddingRight: 12, fontWeight: 600 }}>Next execution</th>
                  <th style={{ paddingBottom: '0.35rem', paddingRight: 12, fontWeight: 600 }}>Attempts</th>
                  <th style={{ paddingBottom: '0.35rem', fontWeight: 600 }}>URL</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(j => {
                  const nextExec = j.next_execution ? new Date(j.next_execution * 1000) : null
                  const isLocalhost = j.job_url?.includes('localhost') || j.job_url?.includes('127.0.0.1')
                  return (
                    <tr key={j.play_cricket_id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 0', paddingRight: 12, whiteSpace: 'nowrap' }}>
                        {j.home_team && j.away_team ? `${shortTeam(j.home_team)} v ${shortTeam(j.away_team)}` : j.play_cricket_id}
                        <span style={{ color: 'var(--text3)', marginLeft: 6, fontSize: '0.76rem' }}>{j.match_date_iso?.slice(0,10)}</span>
                      </td>
                      <td style={{ padding: '4px 0', paddingRight: 12, whiteSpace: 'nowrap', color: 'var(--text2)' }}>
                        {nextExec
                          ? nextExec.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </td>
                      <td style={{ padding: '4px 0', paddingRight: 12, color: 'var(--text2)' }}>{j.attempt_count}</td>
                      <td style={{ padding: '4px 0', fontSize: '0.75rem', color: isLocalhost ? 'var(--red)' : 'var(--text3)',
                                  maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={j.job_url || ''}>
                        {j.job_url || '—'}
                        {isLocalhost && <span style={{ marginLeft: 6, fontWeight: 600 }}>⚠ localhost</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  )
}

function MissingRolesPanel() {
  const [matches, setMatches] = useState(null)
  const apiFetch = useApiFetch()

  useEffect(() => {
    apiFetch('/api/admin/matches-missing-roles')
      .then(r => r.json())
      .then(setMatches)
      .catch(() => setMatches([]))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!matches || matches.length === 0) return null

  function matchLabel(m) {
    const home = shortTeam(m.home_team), away = shortTeam(m.away_team)
    return `${home} vs ${away}`
  }

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Matches missing roles</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
        These matches have no captain or wicket keeper assigned. Open the match to set them.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
        {matches.map(m => (
          <div key={m.fixture_id} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '0.85rem' }}>
            <a href={`/match/${m.fixture_id}`} style={{ color: 'var(--accent)', fontWeight: 500, minWidth: 80 }}>
              #{m.fixture_id}
            </a>
            <span style={{ color: 'var(--text2)', flex: 1 }}>{matchLabel(m)}</span>
            {!m.has_captain && <span className="tag tag-orange" style={{ fontSize: '0.72rem' }}>No captain</span>}
            {!m.has_wk    && <span className="tag tag-orange" style={{ fontSize: '0.72rem' }}>No WK</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

function UnnamedPanel() {
  const [players, setPlayers] = useState(null)
  const [names,   setNames]   = useState({})
  const [saving,   setSaving]   = useState({})
  const [saved,    setSaved]    = useState({})
  const [ignoring, setIgnoring] = useState({})
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

  async function ignore(playerId) {
    setIgnoring(s => ({ ...s, [playerId]: true }))
    try {
      await apiFetch(`/api/players/${playerId}/ignore`, { method: 'PATCH' })
      setPlayers(ps => ps.filter(p => p.player_id !== playerId))
    } finally {
      setIgnoring(s => ({ ...s, [playerId]: false }))
    }
  }

  if (!players || players.length === 0) return null

  return (
    <div className="card" style={{ marginTop: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Unnamed players</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
        These WHCC players were imported without a name. Enter their real name and save, or ignore if they are opposition players.
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
            <button
              className="secondary"
              onClick={() => ignore(p.player_id)}
              disabled={ignoring[p.player_id]}
              style={{ minWidth: 60 }}
              title="Mark as opposition / not a WHCC player"
            >
              {ignoring[p.player_id] ? '…' : 'Ignore'}
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

      <AutoIngestPanel />
      <CronJobsPanel />
      <UnnamedPanel />
      <MissingRolesPanel />
      <MergePanel />
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
