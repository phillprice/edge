import { useState, useEffect } from 'react'
import { useApiFetch } from '../../hooks/useApiFetch'
import { shortTeam, formatDateShort, shortYear } from '../../utils/cricket'

// ── Data tab ──────────────────────────────────────────────────────────────────

const DATA_SUBTABS = [
  { id: 'unnamed', label: 'Unnamed players' },
  { id: 'merge', label: 'Merge players' },
  { id: 'missing-team', label: 'Missing team' },
  { id: 'missing-roles', label: 'Missing roles' },
  { id: 'reingest', label: 'Re-ingest' }
]

export default function DataTab() {
  const [sub, setSub] = useState('unnamed')
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
        {DATA_SUBTABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            className={sub === t.id ? '' : 'secondary'}
            style={{ fontSize: '0.82rem', padding: '3px 12px' }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {sub === 'unnamed' && <UnnamedPanel />}
      {sub === 'merge' && <MergePanel />}
      {sub === 'missing-team' && <MissingTeamPanel />}
      {sub === 'missing-roles' && <MissingRolesPanel />}
      {sub === 'reingest' && <ReIngestRetiredPanel />}
    </>
  )
}

function ReIngestRetiredPanel() {
  const [candidates, setCandidates] = useState(null)
  const [sel, setSel] = useState(new Set())
  const [state, setState] = useState('idle') // idle | running | done | error
  const [msg, setMsg] = useState(null)
  const apiFetch = useApiFetch()

  useEffect(() => {
    apiFetch('/api/admin/scheduler/reingest-candidates')
      .then((r) => r.json())
      .then((d) => {
        setCandidates(Array.isArray(d) ? d : [])
        setSel(new Set((Array.isArray(d) ? d : []).map((c) => c.fixture_id)))
      })
      .catch(() => setCandidates([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!candidates || candidates.length === 0) return null

  async function reingest() {
    setState('running')
    setMsg(null)
    try {
      const res = await apiFetch('/api/admin/scheduler/reingest-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...sel] })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setMsg({
        ok: true,
        text: `${data.queued} fixture${data.queued === 1 ? '' : 's'} queued for re-ingest. Ingesting now…`
      })
      setState('done')
      setCandidates((c) => c.filter((x) => !sel.has(x.fixture_id)))
      setSel(new Set())
    } catch (e) {
      setMsg({ ok: false, text: e.message })
      setState('idle')
    }
  }

  function toggleAll() {
    setSel((s) =>
      s.size === candidates.length ? new Set() : new Set(candidates.map((c) => c.fixture_id))
    )
  }

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Re-ingest for retired-not-out fix</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
        These {candidates.length} matches were ingested before the retired-not-out fix (v5.6.4) and
        may have missed retirement data. Re-ingesting will fetch the latest PDF scorecard and update
        the scorecard and match flow if any batter retired not out.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: '0.75rem', alignItems: 'center' }}>
        <button className="secondary btn-sm" onClick={toggleAll}>
          {sel.size === candidates.length ? 'Deselect all' : 'Select all'}
        </button>
        <button disabled={!sel.size || state === 'running'} onClick={reingest} className="btn-sm">
          {state === 'running' ? 'Queueing…' : `Re-ingest ${sel.size} selected`}
        </button>
      </div>
      {msg && (
        <p
          style={{
            fontSize: '0.82rem',
            color: msg.ok ? 'var(--green)' : 'var(--red)',
            marginBottom: '0.5rem'
          }}
        >
          {msg.text}
        </p>
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.35rem',
          maxHeight: 280,
          overflowY: 'auto'
        }}
      >
        {candidates.map((c) => {
          const checked = sel.has(c.fixture_id)
          return (
            <label
              key={c.fixture_id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '0.82rem',
                cursor: 'pointer'
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  setSel((s) => {
                    const n = new Set(s)
                    checked ? n.delete(c.fixture_id) : n.add(c.fixture_id)
                    return n
                  })
                }
              />
              <span style={{ color: 'var(--text3)', minWidth: 70 }}>{c.fixture_id}</span>
              <span style={{ flex: 1 }}>
                {shortTeam(c.home_team)} vs {shortTeam(c.away_team)}
              </span>
              <span style={{ color: 'var(--text3)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                {formatDateShort(c.match_date_iso)}
              </span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function PlayerSearch({ label, players, selected, onSelect, exclude }) {
  const [query, setQuery] = useState('')
  const selectedPlayer = selected != null ? players.find((p) => p.player_id === selected) : null
  const filtered =
    query.length < 2
      ? []
      : players
          .filter((p) => p.player_id !== exclude)
          .filter((p) => {
            const q = query.toLowerCase()
            const name = (p.display_name || p.name || '').toLowerCase()
            return name.includes(q) || String(p.player_id).includes(q)
          })
          .slice(0, 8)

  return (
    <div style={{ flex: '1 1 200px', minWidth: 0 }}>
      <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: 4, color: 'var(--text2)' }}>
        {label}
      </div>
      {selectedPlayer ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 8px',
            background: 'var(--bg2)',
            borderRadius: 4,
            border: '1px solid var(--border)'
          }}
        >
          <span style={{ flex: 1, fontSize: '0.88rem' }}>
            {selectedPlayer.display_name || selectedPlayer.name}
            <span style={{ color: 'var(--text3)', fontSize: '0.78rem' }}>
              {' '}
              #{selectedPlayer.player_id}
            </span>
          </span>
          <button
            className="secondary"
            style={{ padding: '1px 7px', fontSize: '0.8rem' }}
            onClick={() => onSelect(null)}
          >
            ×
          </button>
        </div>
      ) : (
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            placeholder="Search name or ID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ width: '100%' }}
          />
          {filtered.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 4,
                zIndex: 10,
                maxHeight: 200,
                overflowY: 'auto',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
              }}
            >
              {filtered.map((p) => (
                <div
                  key={p.player_id}
                  onClick={() => {
                    onSelect(p.player_id)
                    setQuery('')
                  }}
                  style={{ padding: '6px 10px', cursor: 'pointer', fontSize: '0.85rem' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg2)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                >
                  {p.display_name || p.name}
                  <span style={{ color: 'var(--text3)', fontSize: '0.78rem' }}>
                    {' '}
                    #{p.player_id} · {p.team || '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function UnnamedPanel() {
  const [players, setPlayers] = useState(null)
  const [names, setNames] = useState({})
  const [saving, setSaving] = useState({})
  const [saved, setSaved] = useState({})
  const [ignoring, setIgnoring] = useState({})
  const apiFetch = useApiFetch()

  useEffect(() => {
    apiFetch('/api/players/unnamed')
      .then((r) => r.json())
      .then((d) => {
        setPlayers(d)
        const initial = {}
        d.forEach((p) => {
          initial[p.player_id] = p.display_name || ''
        })
        setNames(initial)
      })
      .catch(() => setPlayers([]))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!players || players.length === 0) return null

  async function saveName(playerId) {
    setSaving((s) => ({ ...s, [playerId]: true }))
    const name = names[playerId]?.trim() || null
    try {
      await apiFetch(`/api/admin/player/${playerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: name })
      })
      setSaved((s) => ({ ...s, [playerId]: true }))
      setPlayers((ps) => ps.filter((p) => p.player_id !== playerId))
    } catch {
      /* ignore */
    }
    setSaving((s) => ({ ...s, [playerId]: false }))
  }

  async function ignorePlayer(playerId) {
    setIgnoring((s) => ({ ...s, [playerId]: true }))
    try {
      await apiFetch(`/api/admin/player/${playerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ignore: true })
      })
      setPlayers((ps) => ps.filter((p) => p.player_id !== playerId))
    } catch {
      /* ignore */
    }
    setIgnoring((s) => ({ ...s, [playerId]: false }))
  }

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Unnamed players</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
        Players with missing or placeholder names. Assign a display name or ignore.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {players.map((p) => (
          <div
            key={p.player_id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
              fontSize: '0.85rem'
            }}
          >
            <span style={{ color: 'var(--text3)', minWidth: 60 }}>#{p.player_id}</span>
            <span style={{ color: 'var(--text2)', minWidth: 80 }}>{p.name || '(no name)'}</span>
            <span style={{ color: 'var(--text3)', fontSize: '0.78rem', flex: 1, minWidth: 60 }}>
              {p.fixture_count} match{p.fixture_count !== 1 ? 'es' : ''}
            </span>
            <input
              type="text"
              placeholder="Display name…"
              value={names[p.player_id] || ''}
              onChange={(e) => setNames((n) => ({ ...n, [p.player_id]: e.target.value }))}
              style={{ width: 160, minWidth: 0, flex: '1 1 160px', fontSize: '0.82rem' }}
              onKeyDown={(e) => e.key === 'Enter' && saveName(p.player_id)}
            />
            <button
              disabled={!names[p.player_id]?.trim() || saving[p.player_id]}
              onClick={() => saveName(p.player_id)}
              className="btn-sm"
            >
              {saving[p.player_id] ? '…' : saved[p.player_id] ? '✓' : 'Save'}
            </button>
            <button
              className="secondary"
              disabled={ignoring[p.player_id]}
              onClick={() => ignorePlayer(p.player_id)}
              style={{ fontSize: '0.78rem', padding: '2px 8px' }}
            >
              Ignore
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function MissingTeamPanel() {
  const [matches, setMatches] = useState(null)
  const [teams, setTeams] = useState([])
  const [sel, setSel] = useState({})
  const [saving, setSaving] = useState({})
  const [saved, setSaved] = useState({})
  const apiFetch = useApiFetch()

  useEffect(() => {
    Promise.all([
      apiFetch('/api/admin/matches-missing-team').then((r) => r.json()),
      apiFetch('/api/admin/teams').then((r) => r.json())
    ])
      .then(([m, t]) => {
        setMatches(Array.isArray(m) ? m : [])
        setTeams(Array.isArray(t) ? t : [])
      })
      .catch(() => {
        setMatches([])
        setTeams([])
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!matches || matches.length === 0) return null

  async function associate(fixture_id) {
    const key = sel[fixture_id]
    if (!key) return
    const [team_id, season_id] = key.split(':').map(Number)
    setSaving((s) => ({ ...s, [fixture_id]: true }))
    try {
      const res = await apiFetch('/api/admin/associate-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixture_id, team_id, season_id })
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Failed')
      setSaved((s) => ({ ...s, [fixture_id]: true }))
      setMatches((m) => m.filter((x) => x.fixture_id !== fixture_id))
    } catch {
      /* ignore */
    }
    setSaving((s) => ({ ...s, [fixture_id]: false }))
  }

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Matches missing team/season</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
        These matches have no team/season association — invisible to all scoped users.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        {matches.map((m) => {
          const fid = m.fixture_id
          return (
            <div
              key={fid}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap',
                fontSize: '0.85rem'
              }}
            >
              <a href={`/match/${fid}`} style={{ color: 'var(--accent)', fontWeight: 500 }}>
                #{fid}
              </a>
              <span style={{ color: 'var(--text2)', flex: 1, minWidth: 0 }}>
                {shortTeam(m.home_team)} vs {shortTeam(m.away_team)}
                {m.match_date_iso ? ` · ${formatDateShort(m.match_date_iso)}` : ''}
              </span>
              {saved[fid] ? (
                <span style={{ color: 'var(--green)', fontSize: '0.78rem' }}>Linked ✓</span>
              ) : (
                <>
                  <select
                    value={sel[fid] || ''}
                    onChange={(e) => setSel((s) => ({ ...s, [fid]: e.target.value }))}
                    style={{ fontSize: '0.8rem', width: 'auto', maxWidth: '100%' }}
                  >
                    <option value="">— select team/season —</option>
                    {teams.map((t) => (
                      <option
                        key={`${t.team_id}:${t.season_id}`}
                        value={`${t.team_id}:${t.season_id}`}
                      >
                        {t.label} '{shortYear(t.year)}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={!sel[fid] || saving[fid]}
                    onClick={() => associate(fid)}
                    className="btn-sm"
                  >
                    {saving[fid] ? 'Saving…' : 'Link'}
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MissingRolesPanel() {
  const [matches, setMatches] = useState(null)
  const apiFetch = useApiFetch()

  useEffect(() => {
    apiFetch('/api/admin/matches-missing-roles')
      .then((r) => r.json())
      .then(setMatches)
      .catch(() => setMatches([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!matches || matches.length === 0) return null

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>Matches missing roles</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
        These matches have no captain or wicket keeper assigned. Open the match to set them.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
        {matches.map((m) => (
          <div
            key={m.fixture_id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              flexWrap: 'wrap',
              fontSize: '0.85rem'
            }}
          >
            <a href={`/match/${m.fixture_id}`} style={{ color: 'var(--accent)', fontWeight: 500 }}>
              #{m.fixture_id}
            </a>
            <span style={{ color: 'var(--text2)', flex: 1, minWidth: 0 }}>
              {shortTeam(m.home_team)} vs {shortTeam(m.away_team)}
            </span>
            {!m.has_captain && (
              <span className="tag tag-orange" style={{ fontSize: '0.72rem' }}>
                No captain
              </span>
            )}
            {!m.has_wk && (
              <span className="tag tag-orange" style={{ fontSize: '0.72rem' }}>
                No WK
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function MergePanel() {
  const [players, setPlayers] = useState([])
  const [suggestions, setSuggestions] = useState([])
  const [keepId, setKeepId] = useState(null)
  const [dropId, setDropId] = useState(null)
  const [merging, setMerging] = useState(false)
  const [msg, setMsg] = useState(null)
  const apiFetch = useApiFetch()

  useEffect(() => {
    apiFetch('/api/players')
      .then((r) => r.json())
      .then(setPlayers)
      .catch(() => {})
    apiFetch('/api/admin/duplicate-players')
      .then((r) => r.json())
      .then(setSuggestions)
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function doMerge() {
    if (
      !confirm(
        `Merge player #${dropId} into #${keepId}? All their deliveries, stats, and dismissals will be reassigned. This cannot be undone.`
      )
    )
      return
    setMerging(true)
    setMsg(null)
    try {
      const res = await apiFetch('/api/admin/merge-players', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keepId, dropId })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Merge failed')
      setMsg({ error: false, text: `Player #${dropId} merged into #${keepId} successfully.` })
      setKeepId(null)
      setDropId(null)
      apiFetch('/api/admin/duplicate-players')
        .then((r) => r.json())
        .then(setSuggestions)
        .catch(() => {})
    } catch (e) {
      setMsg({ error: true, text: e.message })
    }
    setMerging(false)
  }

  return (
    <div className="card">
      <h3 style={{ marginBottom: '0.5rem' }}>Merge players</h3>
      <p style={{ fontSize: '0.88rem', color: 'var(--text2)', marginBottom: '1rem' }}>
        Combine two player records into one. All deliveries and stats from the dropped player are
        reassigned to the kept player, then the duplicate is deleted.
      </p>

      {suggestions.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text3)', marginBottom: 6 }}>
            Suggested duplicates
          </div>
          {suggestions.map((g) => (
            <div key={g.name} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>{g.name}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {g.players.map((p) => (
                  <button
                    key={p.player_id}
                    className="secondary"
                    style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                    onClick={() => {
                      if (!keepId) setKeepId(p.player_id)
                      else setDropId(p.player_id)
                    }}
                  >
                    #{p.player_id} · {p.appearances} app{p.team ? ` · ${shortTeam(p.team)}` : ''}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <PlayerSearch
          label="Keep (target)"
          players={players}
          selected={keepId}
          onSelect={setKeepId}
          exclude={dropId}
        />
        <PlayerSearch
          label="Drop (source)"
          players={players}
          selected={dropId}
          onSelect={setDropId}
          exclude={keepId}
        />
      </div>

      {msg && (
        <p
          style={{
            fontSize: '0.85rem',
            color: msg.error ? 'var(--red)' : 'var(--green)',
            marginBottom: '0.5rem'
          }}
        >
          {msg.text}
        </p>
      )}

      <button onClick={doMerge} disabled={merging || !keepId || !dropId}>
        {merging ? 'Merging…' : 'Merge players'}
      </button>
    </div>
  )
}
