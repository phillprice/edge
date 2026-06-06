import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ChevronLeft, Trash2, X } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'
import { ballsToOvers } from '../utils/cricket'

const WHCC_TEAMS = ['WHCC Whirlwinds', 'WHCC Hurricanes']

const COMP_OPTIONS = [
  { value: 'League', label: 'League' },
  { value: 'Cup',    label: 'Cup' },
  { value: 'Friendly', label: 'Friendly' },
]

const emptyBat   = () => ({ player_name: '', how_out: '', runs: '', balls: '', fours: '', sixes: '', not_out: false, did_not_bat: false, times_out: '' })
const emptyBowl  = () => ({ player_name: '', overs: '', maidens: '', wicket_maidens: '', runs: '', wickets: '', wides: '', no_balls: '' })
const emptyField = () => ({ player_name: '', catches: '', stumpings: '', run_outs: '' })

// "team_id:season_id" → { team_id, season_id } for the request body (or {} when unset).
const seasonFields = key => key
  ? { team_id: Number(key.split(':')[0]), season_id: Number(key.split(':')[1]) }
  : {}

export default function ManualEntry() {
  const apiFetch = useApiFetch()
  const navigate = useNavigate()
  const { fixtureId: paramFixtureId } = useParams()

  const [fixtures,  setFixtures]  = useState([])
  const [players,   setPlayers]   = useState([])
  const [teams,     setTeams]     = useState([])  // watched team+season options for access assignment
  const [fixtureId, setFixtureId] = useState(null)
  const [tab,       setTab]       = useState('batting')
  const [batting,   setBatting]   = useState([emptyBat()])
  const [bowling,   setBowling]   = useState([emptyBowl()])
  const [fielding,  setFielding]  = useState([emptyField()])
  const [newMatch,  setNewMatch]  = useState(false)
  const [matchForm, setMatchForm] = useState({
    date: '', whcc_team: WHCC_TEAMS[0], is_home: true, team_season: '',
    opponent: '', ground: '', format: 'standard', competition: 'League',
  })
  const [extras,     setExtras]    = useState(0)
  const [bowlByes,   setBowlByes]  = useState(0)
  const [bowlLb,     setBowlLb]    = useState(0)
  const [whccOvers,  setWhccOvers]   = useState('')
  const [oppOvers,   setOppOvers]    = useState('')
  const [captainName, setCaptainName] = useState('')
  const [wkName,      setWkName]      = useState('')
  const [entrySeason, setEntrySeason] = useState('')  // "team_id:season_id" for the loaded fixture
  const [saving,    setSaving]    = useState(false)
  const [deleting,  setDeleting]  = useState(false)
  const [msg,       setMsg]       = useState(null)
  const [error,     setError]     = useState(null)

  useEffect(() => {
    apiFetch('/api/manual/fixtures').then(r => r.json()).then(setFixtures)
    apiFetch('/api/manual/players').then(r => r.json()).then(setPlayers)
    apiFetch('/api/access-requests/teams').then(r => r.ok ? r.json() : []).then(ts => setTeams(Array.isArray(ts) ? ts : []))
    if (paramFixtureId) selectFixture(paramFixtureId)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function selectFixture(id) {
    setFixtureId(id); setMsg(null); setError(null)
    const data = await apiFetch(`/api/manual/entry/${id}`).then(r => r.json())
    setExtras(data.batting_extras ?? 0)
    setBowlByes(data.bowling_byes ?? 0)
    setBowlLb(data.bowling_leg_byes ?? 0)
    setWhccOvers(data.whcc_overs ?? '')
    setOppOvers(data.opp_overs ?? '')
    setCaptainName(data.captain_name ?? '')
    setWkName(data.wk_name ?? '')
    setEntrySeason(data.association ? `${data.association.team_id}:${data.association.season_id}` : '')
    setBatting(data.batting.length
      ? data.batting.map(r => ({ player_name: r.name, how_out: r.how_out || '', runs: r.runs, balls: r.balls, fours: r.fours, sixes: r.sixes, not_out: !!r.not_out, did_not_bat: !!r.did_not_bat, times_out: r.times_out ?? '' }))
      : [emptyBat()])
    setBowling(data.bowling.length
      ? data.bowling.map(r => ({ player_name: r.name, overs: ballsToOvers(r.balls), maidens: r.maidens, wicket_maidens: r.wicket_maidens, runs: r.runs, wickets: r.wickets, wides: r.wides, no_balls: r.no_balls }))
      : [emptyBowl()])
    setFielding(data.fielding?.length
      ? data.fielding.map(r => ({ player_name: r.name, catches: r.catches, stumpings: r.stumpings, run_outs: r.run_outs }))
      : [emptyField()])
  }

  async function createFixture() {
    if (!matchForm.date || !matchForm.opponent) { setError('Date and opponent are required'); return }
    const home = matchForm.is_home ? matchForm.whcc_team : matchForm.opponent
    const away = matchForm.is_home ? matchForm.opponent  : matchForm.whcc_team
    const fixturePayload = {
      match_date: matchForm.date,
      home_team: home,
      away_team: away,
      ground: matchForm.ground,
      format: matchForm.format,
      competition: matchForm.competition,
      ...seasonFields(matchForm.team_season),
    }
    const res  = await apiFetch('/api/manual/fixture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fixturePayload),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); return }
    setFixtures(await apiFetch('/api/manual/fixtures').then(r => r.json()))
    setNewMatch(false)
    selectFixture(data.fixture_id)
  }

  async function save() {
    setSaving(true); setMsg(null); setError(null)
    try {
      const entryPayload = {
        batting: batting.filter(r => r.player_name.trim()),
        bowling: bowling.filter(r => r.player_name.trim()),
        fielding: fielding.filter(r => r.player_name.trim()),
        batting_extras:   Number(extras)   || 0,
        bowling_byes:     Number(bowlByes) || 0,
        bowling_leg_byes: Number(bowlLb)   || 0,
        whcc_overs:       whccOvers.trim()   || null,
        opp_overs:        oppOvers.trim()    || null,
        captain_name:     captainName.trim() || null,
        wk_name:          wkName.trim()      || null,
        competition:      matchForm.competition || null,
        format:           matchForm.format || null,
        ground:           matchForm.ground || null,
        ...seasonFields(entrySeason),
      }
      const res = await apiFetch(`/api/manual/entry/${fixtureId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entryPayload),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      setMsg('Stats saved.')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteFixture() {
    if (!window.confirm('Delete this match and all its data? This cannot be undone.')) return
    setDeleting(true)
    try {
      const res = await apiFetch(`/api/admin/match/${fixtureId}`, { method: 'DELETE' })
      if (!res.ok) { const j = await res.json(); throw new Error(j.error || 'Delete failed') }
      navigate('/')
    } catch (e) {
      alert(e.message)
      setDeleting(false)
    }
  }

  const mf = (field, val) => setMatchForm(f => ({ ...f, [field]: val }))
  const playerNames = players.map(p => p.name)
  const selectedFixture = fixtures.find(f => f.fixture_id === fixtureId)

  const calcWhccOvers = (() => {
    const balls = batting.filter(r => !r.did_not_bat && r.player_name.trim()).reduce((s, r) => s + (parseInt(r.balls) || 0), 0)
    return balls > 0 ? ballsToOvers(balls) : null
  })()
  const calcOppOvers = (() => {
    const balls = bowling.filter(r => r.player_name.trim()).reduce((s, r) => {
      const parts = String(r.overs || '0').split('.')
      return s + (parseInt(parts[0]) || 0) * 6 + Math.min(parseInt(parts[1]) || 0, 5)
    }, 0)
    return balls > 0 ? ballsToOvers(balls) : null
  })()

  return (
    <div className="page">
      <h1>Manual stat entry</h1>

      {/* ── Fixture list ── */}
      {!fixtureId && !newMatch && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
            <h2 style={{ margin: 0 }}>Select match</h2>
            <button onClick={() => { setNewMatch(true); setError(null) }}>+ New match</button>
          </div>

          {fixtures.length === 0 && <p className="empty">No matches found.</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {fixtures.map(f => {
              const locked    = f.delivery_count > 0
              const hasBatting = f.manual_bat_count > 0
              const hasBowling = f.manual_bowl_count > 0
              const hasManual = hasBatting || hasBowling
              const isComplete = hasBatting && hasBowling
              const status = !hasManual ? 'not-started' : isComplete ? 'complete' : 'partial'
              const statusColor = status === 'complete' ? '#2e7d32' : status === 'partial' ? '#b04800' : 'var(--text3)'
              const statusLabel = status === 'complete' ? 'Complete ✓' : status === 'partial' ? 'Partial' : 'Not started'
              return (
                <div key={f.fixture_id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg3)', position: 'relative' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {f.home_team} vs {f.away_team}
                    </div>
                    <div style={{ marginTop: '3px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>{f.match_date}</span>
                      {f.format === 'pairs' && <span className="tag" style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}>Pairs</span>}
                      {hasManual && <span className="tag tag-green">manual</span>}
                      {locked    && <span className="tag tag-blue">scorecard</span>}
                      <span className="tag" style={{ background: 'transparent', color: statusColor, borderLeft: `2px solid ${statusColor}`, paddingLeft: '6px' }}>
                        {statusLabel}
                      </span>
                      {hasManual && (
                        <span style={{ fontSize: '0.72rem', color: 'var(--text3)', marginLeft: '4px' }}>
                          ({hasBatting ? '✓' : '✗'} Bat, {hasBowling ? '✓' : '✗'} Bowl)
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    className={locked ? 'secondary' : ''}
                    disabled={locked}
                    title={locked ? 'Scorecard data exists — manual entry blocked' : ''}
                    onClick={() => selectFixture(f.fixture_id)}
                    style={{ flexShrink: 0 }}
                  >
                    {hasManual ? 'Edit' : 'Enter stats'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── New match form ── */}
      {newMatch && (
        <div className="card">
          <h2 style={{ marginTop: 0, marginBottom: '1.5rem' }}>New match</h2>

          <div className="form-grid">
            <label className="full">
              <span className="form-label">Date</span>
              <input type="date" value={matchForm.date} onChange={e => mf('date', e.target.value)} />
            </label>
            <label>
              <span className="form-label">WHCC team</span>
              <select value={matchForm.whcc_team} onChange={e => mf('whcc_team', e.target.value)}>
                {WHCC_TEAMS.map(t => <option key={t}>{t}</option>)}
              </select>
            </label>
            {teams.length > 0 && (
              <label>
                <span className="form-label">Season (access)</span>
                <select value={matchForm.team_season} onChange={e => mf('team_season', e.target.value)}>
                  <option value="">— none (admins only) —</option>
                  {teams.map(t => (
                    <option key={`${t.team_id}:${t.season_id}`} value={`${t.team_id}:${t.season_id}`}>
                      {t.year ? `${t.label} ${t.year}` : t.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <span className="form-label">Opponent</span>
              <input value={matchForm.opponent} onChange={e => mf('opponent', e.target.value)} placeholder="Opposition CC" />
            </label>
            <label>
              <span className="form-label">Home / Away</span>
              <select value={matchForm.is_home ? 'home' : 'away'} onChange={e => mf('is_home', e.target.value === 'home')}>
                <option value="home">WHCC at home</option>
                <option value="away">WHCC away</option>
              </select>
            </label>
            <label>
              <span className="form-label">Ground</span>
              <input value={matchForm.ground} onChange={e => mf('ground', e.target.value)} placeholder="Ground name" />
            </label>
            <label>
              <span className="form-label">Format</span>
              <select value={matchForm.format} onChange={e => mf('format', e.target.value)}>
                <option value="standard">Standard</option>
                <option value="pairs">Pairs</option>
              </select>
            </label>
            <label>
              <span className="form-label">Competition</span>
              <select value={matchForm.competition} onChange={e => mf('competition', e.target.value)}>
                {COMP_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>

          {error && <div className="alert alert-error" style={{ marginTop: '1rem' }}>{error}</div>}

          <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border)', display: 'flex', gap: '8px' }}>
            <button onClick={createFixture}>Create match</button>
            <button className="secondary" onClick={() => { setNewMatch(false); setError(null) }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Stats entry ── */}
      {fixtureId && selectedFixture && (
        <>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{selectedFixture.home_team} vs {selectedFixture.away_team}</div>
              <div style={{ marginTop: '3px', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.82rem', color: 'var(--text3)' }}>{selectedFixture.match_date}</span>
                {selectedFixture.format === 'pairs' && <span className="tag" style={{ background: 'var(--blue-bg)', color: 'var(--blue)' }}>Pairs</span>}
              </div>
              {teams.length > 0 && (
                <label style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem', color: 'var(--text2)' }}>
                  Season (access):
                  <select value={entrySeason} onChange={e => setEntrySeason(e.target.value)} style={{ fontSize: '0.82rem' }}>
                    <option value="">— none (admins only) —</option>
                    {teams.map(t => (
                      <option key={`${t.team_id}:${t.season_id}`} value={`${t.team_id}:${t.season_id}`}>
                        {t.year ? `${t.label} ${t.year}` : t.label}
                      </option>
                    ))}
                  </select>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text3)' }}>(saved with stats)</span>
                </label>
              )}
            </div>
            <Link to={`/ball-entry/${fixtureId}`} className="secondary" style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, fontSize: '0.82rem', textDecoration: 'none', padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', color: 'inherit' }}>
              Ball-by-ball
            </Link>
            <button className="secondary" style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }} onClick={() => { setFixtureId(null); setMsg(null); setError(null) }}>
              <ChevronLeft size={14} /> Back
            </button>
            <button className="secondary" style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, color: 'var(--red)', borderColor: 'var(--red)' }} onClick={deleteFixture} disabled={deleting}>
              <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>

          <div className="card">
            <div className="tabs">
              <button className={`tab${tab === 'batting' ? ' active' : ''}`} onClick={() => setTab('batting')}>Batting</button>
              <button className={`tab${tab === 'bowling' ? ' active' : ''}`} onClick={() => setTab('bowling')}>Bowling</button>
              <button className={`tab${tab === 'fielding' ? ' active' : ''}`} onClick={() => setTab('fielding')}>Fielding</button>
            </div>

            {tab === 'batting' && (
              <>
                <BattingTable
                  rows={batting}
                  onChange={(i, f, v) => setBatting(rows => rows.map((r, idx) => idx === i ? { ...r, [f]: v } : r))}
                  onAdd={() => setBatting(r => [...r, emptyBat()])}
                  onRemove={i => setBatting(r => r.filter((_, idx) => idx !== i))}
                  playerNames={playerNames}
                  isPairs={selectedFixture?.format === 'pairs'}
                />
                <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 0', borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                      <span className="form-label" style={{ margin: 0 }}>Extras (opp. bowlers)</span>
                      <input type="number" min="0" value={extras} onChange={e => setExtras(e.target.value)} style={{ width: '80px' }} />
                    </label>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>wides, no-balls, byes, leg byes</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                      <span className="form-label" style={{ margin: 0 }}>WHCC overs</span>
                      <input value={whccOvers} onChange={e => setWhccOvers(e.target.value)} placeholder={calcWhccOvers ?? 'e.g. 20.0'} style={{ width: '90px' }} />
                    </label>
                    {calcWhccOvers && <span style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>calculated: {calcWhccOvers} — override if needed</span>}
                  </div>
                </div>
              </>
            )}

            {tab === 'bowling' && (
              <>
                <BowlingTable
                  rows={bowling}
                  onChange={(i, f, v) => setBowling(rows => rows.map((r, idx) => idx === i ? { ...r, [f]: v } : r))}
                  onAdd={() => setBowling(r => [...r, emptyBowl()])}
                  onRemove={i => setBowling(r => r.filter((_, idx) => idx !== i))}
                  playerNames={playerNames}
                />
                <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '8px', padding: '12px 0', borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                      <span className="form-label" style={{ margin: 0 }}>Byes (b)</span>
                      <input type="number" min="0" value={bowlByes} onChange={e => setBowlByes(e.target.value)} style={{ width: '72px' }} />
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                      <span className="form-label" style={{ margin: 0 }}>Leg byes (lb)</span>
                      <input type="number" min="0" value={bowlLb} onChange={e => setBowlLb(e.target.value)} style={{ width: '72px' }} />
                    </label>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>not credited to any bowler</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                      <span className="form-label" style={{ margin: 0 }}>Opposition overs</span>
                      <input value={oppOvers} onChange={e => setOppOvers(e.target.value)} placeholder={calcOppOvers ?? 'e.g. 20.0'} style={{ width: '90px' }} />
                    </label>
                    {calcOppOvers && <span style={{ fontSize: '0.8rem', color: 'var(--text3)' }}>calculated: {calcOppOvers} — override if needed</span>}
                  </div>
                </div>
              </>
            )}

            {tab === 'fielding' && (
              <FieldingTable
                rows={fielding}
                onChange={(i, f, v) => setFielding(rows => rows.map((r, idx) => idx === i ? { ...r, [f]: v } : r))}
                onAdd={() => setFielding(r => [...r, emptyField()])}
                onRemove={i => setFielding(r => r.filter((_, idx) => idx !== i))}
                playerNames={playerNames}
              />
            )}

            <div style={{ paddingTop: '1rem', borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>Match roles</div>
              <div className="form-grid">
                <label style={{ display: 'block' }}>
                  <span className="form-label">Captain</span>
                  <select value={captainName} onChange={e => setCaptainName(e.target.value)}>
                    <option value="">— none —</option>
                    {batting.filter(r => r.player_name.trim() && !r.did_not_bat).map(r => (
                      <option key={r.player_name} value={r.player_name}>{r.player_name}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'block' }}>
                  <span className="form-label">Wicket-keeper</span>
                  <select value={wkName} onChange={e => setWkName(e.target.value)}>
                    <option value="">— none —</option>
                    {bowling.filter(r => r.player_name.trim()).map(r => (
                      <option key={r.player_name} value={r.player_name}>{r.player_name}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {msg   && <div className="alert alert-success" style={{ marginTop: '1rem' }}>{msg}</div>}
            {error && <div className="alert alert-error"   style={{ marginTop: '1rem' }}>{error}</div>}

            <div style={{ marginTop: '1.25rem' }}>
              <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save stats'}</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function BattingTable({ rows, onChange, onAdd, onRemove, playerNames, isPairs }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <datalist id="player-list">{playerNames.map(n => <option key={n} value={n} />)}</datalist>
      <table className="entry-table" style={{ minWidth: isPairs ? '780px' : '790px' }}>
        <thead>
          <tr>
            <th style={{ width: '180px' }}>Player</th>
            <th>How out</th>
            <th style={{ width: '64px' }}>R</th>
            <th style={{ width: '64px' }}>B</th>
            <th style={{ width: '64px' }}>4s</th>
            <th style={{ width: '64px' }}>6s</th>
            {isPairs
              ? <th style={{ width: '56px' }}>Out</th>
              : <><th style={{ width: '48px' }}>NO</th><th style={{ width: '52px' }} title="Times out (retired/re-batted)">×Out</th></>
            }
            <th style={{ width: '52px' }}>DNB</th>
            <th style={{ width: '40px' }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const dnb = !!row.did_not_bat
            return (
              <tr key={i} style={dnb ? { opacity: 0.5 } : {}}>
                <td><input list="player-list" value={row.player_name} onChange={e => onChange(i, 'player_name', e.target.value)} placeholder="Name" /></td>
                <td><input value={row.how_out} onChange={e => onChange(i, 'how_out', e.target.value)} placeholder="b Smith / ct Jones b Smith" disabled={dnb} /></td>
                <td><input type="number" min="0" value={dnb ? '' : row.runs}  onChange={e => onChange(i, 'runs',  e.target.value)} disabled={dnb} /></td>
                <td><input type="number" min="0" value={dnb ? '' : row.balls} onChange={e => onChange(i, 'balls', e.target.value)} disabled={dnb} /></td>
                <td><input type="number" min="0" value={dnb ? '' : row.fours} onChange={e => onChange(i, 'fours', e.target.value)} disabled={dnb} /></td>
                <td><input type="number" min="0" value={dnb ? '' : row.sixes} onChange={e => onChange(i, 'sixes', e.target.value)} disabled={dnb} /></td>
                {isPairs
                  ? <td><input type="number" min="0" max="10" value={dnb ? '' : row.times_out} onChange={e => onChange(i, 'times_out', e.target.value)} disabled={dnb} /></td>
                  : <><td style={{ textAlign: 'center' }}><input type="checkbox" checked={!dnb && !!row.not_out} onChange={e => onChange(i, 'not_out', e.target.checked)} disabled={dnb} /></td>
                    <td><input type="number" min="0" max="10" value={dnb ? '' : (row.times_out || '')} onChange={e => onChange(i, 'times_out', e.target.value)} disabled={dnb} placeholder="0" /></td></>
                }
                <td style={{ textAlign: 'center' }}><input type="checkbox" checked={dnb} onChange={e => onChange(i, 'did_not_bat', e.target.checked)} /></td>
                <td><button className="icon-btn danger" onClick={() => onRemove(i)}><X size={12} /></button></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <button className="secondary" style={{ marginTop: '10px', fontSize: '0.85rem', padding: '6px 14px' }} onClick={onAdd}>+ Add batter</button>
    </div>
  )
}

function BowlingTable({ rows, onChange, onAdd, onRemove, playerNames }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <datalist id="player-list">{playerNames.map(n => <option key={n} value={n} />)}</datalist>
      <table className="entry-table" style={{ minWidth: '680px' }}>
        <thead>
          <tr>
            <th style={{ width: '180px' }}>Player</th>
            <th style={{ width: '70px' }}>Overs</th>
            <th style={{ width: '64px' }}>M</th>
            <th style={{ width: '64px' }}>WM</th>
            <th style={{ width: '64px' }}>R</th>
            <th style={{ width: '64px' }}>W</th>
            <th style={{ width: '64px' }}>Wd</th>
            <th style={{ width: '64px' }}>NB</th>
            <th style={{ width: '40px' }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td><input list="player-list" value={row.player_name} onChange={e => onChange(i, 'player_name', e.target.value)} placeholder="Name" /></td>
              <td><input value={row.overs} onChange={e => onChange(i, 'overs', e.target.value)} placeholder="4.3" /></td>
              <td><input type="number" min="0" value={row.maidens}        onChange={e => onChange(i, 'maidens',        e.target.value)} /></td>
              <td><input type="number" min="0" value={row.wicket_maidens} onChange={e => onChange(i, 'wicket_maidens', e.target.value)} /></td>
              <td><input type="number" min="0" value={row.runs}           onChange={e => onChange(i, 'runs',           e.target.value)} /></td>
              <td><input type="number" min="0" value={row.wickets}        onChange={e => onChange(i, 'wickets',        e.target.value)} /></td>
              <td><input type="number" min="0" value={row.wides}          onChange={e => onChange(i, 'wides',          e.target.value)} /></td>
              <td><input type="number" min="0" value={row.no_balls}       onChange={e => onChange(i, 'no_balls',       e.target.value)} /></td>
              <td><button className="icon-btn danger" onClick={() => onRemove(i)}><X size={12} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="secondary" style={{ marginTop: '10px', fontSize: '0.85rem', padding: '6px 14px' }} onClick={onAdd}>+ Add bowler</button>
    </div>
  )
}

function FieldingTable({ rows, onChange, onAdd, onRemove, playerNames }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <p style={{ fontSize: '0.82rem', color: 'var(--text2)', marginBottom: '0.75rem' }}>
        Record fielding contributions when WHCC bowls — catches, stumpings, and run outs credited to individual players.
      </p>
      <datalist id="player-list-field">{playerNames.map(n => <option key={n} value={n} />)}</datalist>
      <table className="entry-table" style={{ minWidth: '420px' }}>
        <thead>
          <tr>
            <th style={{ width: '180px' }}>Player</th>
            <th style={{ width: '80px' }}>Catches</th>
            <th style={{ width: '80px' }}>Stumpings</th>
            <th style={{ width: '80px' }}>Run outs</th>
            <th style={{ width: '40px' }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td><input list="player-list-field" value={row.player_name} onChange={e => onChange(i, 'player_name', e.target.value)} placeholder="Name" /></td>
              <td><input type="number" min="0" value={row.catches}   onChange={e => onChange(i, 'catches',   e.target.value)} /></td>
              <td><input type="number" min="0" value={row.stumpings} onChange={e => onChange(i, 'stumpings', e.target.value)} /></td>
              <td><input type="number" min="0" value={row.run_outs}  onChange={e => onChange(i, 'run_outs',  e.target.value)} /></td>
              <td><button className="icon-btn danger" onClick={() => onRemove(i)}><X size={12} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="secondary" style={{ marginTop: '10px', fontSize: '0.85rem', padding: '6px 14px' }} onClick={onAdd}>+ Add fielder</button>
    </div>
  )
}
