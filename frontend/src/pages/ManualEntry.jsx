import { useState, useEffect } from 'react'
import { useApiFetch } from '../hooks/useApiFetch'

const WHCC_TEAMS = ['WHCC Whirlwinds', 'WHCC Hurricanes']

const emptyBat  = () => ({ player_name: '', how_out: '', runs: '', balls: '', fours: '', sixes: '', not_out: false })
const emptyBowl = () => ({ player_name: '', overs: '', maidens: '', wicket_maidens: '', runs: '', wickets: '', wides: '', no_balls: '' })

function ballsToOvers(balls) {
  return `${Math.floor(balls / 6)}.${balls % 6}`
}

export default function ManualEntry() {
  const apiFetch = useApiFetch()

  const [fixtures,   setFixtures]   = useState([])
  const [players,    setPlayers]    = useState([])
  const [fixtureId,  setFixtureId]  = useState(null)
  const [tab,        setTab]        = useState('batting')
  const [batting,    setBatting]    = useState([emptyBat()])
  const [bowling,    setBowling]    = useState([emptyBowl()])
  const [newMatch,   setNewMatch]   = useState(false)
  const [matchForm,  setMatchForm]  = useState({ date: '', whcc_team: WHCC_TEAMS[0], is_home: true, opponent: '', ground: '', format: 'standard' })
  const [saving,     setSaving]     = useState(false)
  const [msg,        setMsg]        = useState(null)
  const [error,      setError]      = useState(null)

  useEffect(() => {
    apiFetch('/api/manual/fixtures').then(r => r.json()).then(setFixtures)
    apiFetch('/api/manual/players').then(r => r.json()).then(setPlayers)
  }, [])

  async function selectFixture(id) {
    setFixtureId(id)
    setMsg(null); setError(null)
    const res = await apiFetch(`/api/manual/entry/${id}`)
    const data = await res.json()
    setBatting(data.batting.length
      ? data.batting.map(r => ({ player_name: r.name, how_out: r.how_out || '', runs: r.runs, balls: r.balls, fours: r.fours, sixes: r.sixes, not_out: !!r.not_out }))
      : [emptyBat()])
    setBowling(data.bowling.length
      ? data.bowling.map(r => ({ player_name: r.name, overs: ballsToOvers(r.balls), maidens: r.maidens, wicket_maidens: r.wicket_maidens, runs: r.runs, wickets: r.wickets, wides: r.wides, no_balls: r.no_balls }))
      : [emptyBowl()])
  }

  async function createFixture() {
    if (!matchForm.date || !matchForm.opponent) { setError('Date and opponent are required'); return }
    const home = matchForm.is_home ? matchForm.whcc_team : matchForm.opponent
    const away = matchForm.is_home ? matchForm.opponent  : matchForm.whcc_team
    const res = await apiFetch('/api/manual/fixture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ match_date: matchForm.date, home_team: home, away_team: away, ground: matchForm.ground, format: matchForm.format })
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); return }
    const freshRes = await apiFetch('/api/manual/fixtures')
    setFixtures(await freshRes.json())
    setNewMatch(false)
    selectFixture(data.fixture_id)
  }

  async function save() {
    setSaving(true); setMsg(null); setError(null)
    try {
      const res = await apiFetch(`/api/manual/entry/${fixtureId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          batting: batting.filter(r => r.player_name.trim()),
          bowling: bowling.filter(r => r.player_name.trim()),
        })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      setMsg('Stats saved successfully.')
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function updateBat(i, field, val) {
    setBatting(rows => rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }
  function updateBowl(i, field, val) {
    setBowling(rows => rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }

  const playerNames = players.map(p => p.name)
  const selectedFixture = fixtures.find(f => f.fixture_id === fixtureId)

  return (
    <div className="page">
      <h1>Manual stat entry</h1>

      {/* Fixture picker */}
      {!fixtureId && !newMatch && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0 }}>Select match</h2>
            <button onClick={() => setNewMatch(true)}>+ New match</button>
          </div>
          {fixtures.length === 0 && <p className="muted">No matches found.</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {fixtures.map(f => {
              const hasData = f.delivery_count > 0
              const hasManual = f.manual_bat_count > 0 || f.manual_bowl_count > 0
              return (
                <div key={f.fixture_id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', border: '1px solid var(--border)', borderRadius: '6px' }}>
                  <div style={{ flex: 1, fontSize: '0.9rem' }}>
                    <strong>{f.home_team} vs {f.away_team}</strong>
                    <span className="muted" style={{ marginLeft: '8px' }}>{f.match_date}</span>
                    {hasManual && <span className="tag tag-green" style={{ marginLeft: '6px' }}>manual</span>}
                    {hasData   && <span className="tag tag-blue"  style={{ marginLeft: '6px' }}>scorecard</span>}
                  </div>
                  <button
                    className={hasData ? 'secondary' : ''}
                    disabled={hasData}
                    title={hasData ? 'Has scorecard data — manual entry blocked' : ''}
                    onClick={() => selectFixture(f.fixture_id)}
                  >
                    {hasManual ? 'Edit' : 'Enter stats'}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* New match form */}
      {newMatch && (
        <div className="card">
          <h2>New match</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <label style={{ gridColumn: '1/-1' }}>
              <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Date</span>
              <input type="date" value={matchForm.date} onChange={e => setMatchForm(f => ({ ...f, date: e.target.value }))} />
            </label>
            <label>
              <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>WHCC team</span>
              <select value={matchForm.whcc_team} onChange={e => setMatchForm(f => ({ ...f, whcc_team: e.target.value }))}>
                {WHCC_TEAMS.map(t => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label>
              <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Home / Away</span>
              <select value={matchForm.is_home ? 'home' : 'away'} onChange={e => setMatchForm(f => ({ ...f, is_home: e.target.value === 'home' }))}>
                <option value="home">WHCC at home</option>
                <option value="away">WHCC away</option>
              </select>
            </label>
            <label>
              <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Opponent</span>
              <input value={matchForm.opponent} onChange={e => setMatchForm(f => ({ ...f, opponent: e.target.value }))} placeholder="Opposition CC" />
            </label>
            <label>
              <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Ground</span>
              <input value={matchForm.ground} onChange={e => setMatchForm(f => ({ ...f, ground: e.target.value }))} placeholder="Ground name" />
            </label>
            <label>
              <span style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>Format</span>
              <select value={matchForm.format} onChange={e => setMatchForm(f => ({ ...f, format: e.target.value }))}>
                <option value="standard">Standard</option>
                <option value="pairs">Pairs</option>
              </select>
            </label>
          </div>
          {error && <div className="alert alert-error" style={{ marginTop: '12px' }}>{error}</div>}
          <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
            <button onClick={createFixture}>Create match</button>
            <button className="secondary" onClick={() => { setNewMatch(false); setError(null) }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Stats entry */}
      {fixtureId && selectedFixture && (
        <>
          <div className="card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div>
                <strong>{selectedFixture.home_team} vs {selectedFixture.away_team}</strong>
                <span className="muted" style={{ marginLeft: '8px' }}>{selectedFixture.match_date}</span>
              </div>
              <button className="secondary" style={{ marginLeft: 'auto' }} onClick={() => { setFixtureId(null); setMsg(null); setError(null) }}>
                ← Back
              </button>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem' }}>
              <button className={tab === 'batting' ? '' : 'secondary'} onClick={() => setTab('batting')}>Batting</button>
              <button className={tab === 'bowling' ? '' : 'secondary'} onClick={() => setTab('bowling')}>Bowling</button>
            </div>

            {tab === 'batting' && (
              <BattingTable rows={batting} onChange={updateBat} onAdd={() => setBatting(r => [...r, emptyBat()])} onRemove={i => setBatting(r => r.filter((_, idx) => idx !== i))} playerNames={playerNames} />
            )}

            {tab === 'bowling' && (
              <BowlingTable rows={bowling} onChange={updateBowl} onAdd={() => setBowling(r => [...r, emptyBowl()])} onRemove={i => setBowling(r => r.filter((_, idx) => idx !== i))} playerNames={playerNames} />
            )}

            {msg   && <div className="alert alert-success" style={{ marginTop: '12px' }}>{msg}</div>}
            {error && <div className="alert alert-error"   style={{ marginTop: '12px' }}>{error}</div>}

            <div style={{ marginTop: '1rem', display: 'flex', gap: '8px' }}>
              <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save stats'}</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function BattingTable({ rows, onChange, onAdd, onRemove, playerNames }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <datalist id="player-list">{playerNames.map(n => <option key={n} value={n} />)}</datalist>
      <table style={{ minWidth: '700px' }}>
        <thead>
          <tr>
            <th>Player</th><th>How out</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>NO</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td><input list="player-list" value={row.player_name} onChange={e => onChange(i, 'player_name', e.target.value)} placeholder="Player name" style={{ width: '160px' }} /></td>
              <td><input value={row.how_out} onChange={e => onChange(i, 'how_out', e.target.value)} placeholder="b Smith / ct Jones b Smith" style={{ width: '180px' }} /></td>
              <td><input type="number" min="0" value={row.runs}  onChange={e => onChange(i, 'runs',  e.target.value)} style={{ width: '52px' }} /></td>
              <td><input type="number" min="0" value={row.balls} onChange={e => onChange(i, 'balls', e.target.value)} style={{ width: '52px' }} /></td>
              <td><input type="number" min="0" value={row.fours} onChange={e => onChange(i, 'fours', e.target.value)} style={{ width: '52px' }} /></td>
              <td><input type="number" min="0" value={row.sixes} onChange={e => onChange(i, 'sixes', e.target.value)} style={{ width: '52px' }} /></td>
              <td style={{ textAlign: 'center' }}><input type="checkbox" checked={row.not_out} onChange={e => onChange(i, 'not_out', e.target.checked)} /></td>
              <td><button className="secondary" style={{ padding: '2px 8px' }} onClick={() => onRemove(i)}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="secondary" style={{ marginTop: '8px' }} onClick={onAdd}>+ Add batter</button>
    </div>
  )
}

function BowlingTable({ rows, onChange, onAdd, onRemove, playerNames }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <datalist id="player-list">{playerNames.map(n => <option key={n} value={n} />)}</datalist>
      <table style={{ minWidth: '700px' }}>
        <thead>
          <tr>
            <th>Player</th><th>Ov</th><th>M</th><th>WM</th><th>R</th><th>W</th><th>Wd</th><th>NB</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td><input list="player-list" value={row.player_name} onChange={e => onChange(i, 'player_name', e.target.value)} placeholder="Player name" style={{ width: '160px' }} /></td>
              <td><input value={row.overs}          onChange={e => onChange(i, 'overs',          e.target.value)} placeholder="4.3" style={{ width: '52px' }} /></td>
              <td><input type="number" min="0" value={row.maidens}        onChange={e => onChange(i, 'maidens',        e.target.value)} style={{ width: '52px' }} /></td>
              <td><input type="number" min="0" value={row.wicket_maidens} onChange={e => onChange(i, 'wicket_maidens', e.target.value)} style={{ width: '52px' }} /></td>
              <td><input type="number" min="0" value={row.runs}           onChange={e => onChange(i, 'runs',           e.target.value)} style={{ width: '52px' }} /></td>
              <td><input type="number" min="0" value={row.wickets}        onChange={e => onChange(i, 'wickets',        e.target.value)} style={{ width: '52px' }} /></td>
              <td><input type="number" min="0" value={row.wides}          onChange={e => onChange(i, 'wides',          e.target.value)} style={{ width: '52px' }} /></td>
              <td><input type="number" min="0" value={row.no_balls}       onChange={e => onChange(i, 'no_balls',       e.target.value)} style={{ width: '52px' }} /></td>
              <td><button className="secondary" style={{ padding: '2px 8px' }} onClick={() => onRemove(i)}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="secondary" style={{ marginTop: '8px' }} onClick={onAdd}>+ Add bowler</button>
    </div>
  )
}
