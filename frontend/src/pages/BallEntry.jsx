import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ChevronLeft, Undo2, CheckCircle2 } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'

const DISMISSAL_METHODS = ['Bowled','Caught','CaughtAndBowled','LBW','Stumped','RunOut','Handled','Obstructing']
const FIELDER_METHODS   = ['Caught','CaughtAndBowled','Stumped','RunOut']
const EXTRAS_LABELS     = [
  { value: null, label: 'Normal' },
  { value: 2,    label: 'Wide'   },
  { value: 1,    label: 'No-ball'},
  { value: 3,    label: 'Bye'    },
  { value: 4,    label: 'Leg-bye'},
]

function ballDot(d) {
  if (d.dismissed_batter_id) return 'W'
  const et = d.extras_type
  if (et === 2) return 'Wd'
  if (et === 1) return 'Nb'
  if (et === 3 || et === 4) return `+${d.runs_extra}`
  return String(d.runs_bat)
}

export default function BallEntry() {
  const apiFetch  = useApiFetch()
  const { fixtureId: paramFixtureId } = useParams()

  // Fixture / innings selection
  const [fixtures,    setFixtures]    = useState([])
  const [fixtureId,   setFixtureId]   = useState(paramFixtureId || '')
  const [inningsOrder, setInningsOrder] = useState(1)
  const [resultId,    setResultId]    = useState(null)

  // Delivery history for current innings
  const [deliveries,  setDeliveries]  = useState([])

  // Known players (WHCC + any already entered for this fixture)
  const [players,     setPlayers]     = useState([])

  // Current delivery state
  const [striker,     setStriker]     = useState('')
  const [nonStriker,  setNonStriker]  = useState('')
  const [bowler,      setBowler]      = useState('')
  const [runsBat,     setRunsBat]     = useState(0)
  const [runsExtra,   setRunsExtra]   = useState(0)
  const [extrasType,  setExtrasType]  = useState(null)
  const [hasWicket,   setHasWicket]   = useState(false)
  const [dismissedId, setDismissedId] = useState('')
  const [method,      setMethod]      = useState('Caught')
  const [fielderId,   setFielderId]   = useState('')
  const [disBowlerId, setDisBowlerId] = useState('')
  const [newPlayerName, setNewPlayerName] = useState('')

  const [saving,  setSaving]  = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [err,     setErr]     = useState(null)
  const [msg,     setMsg]     = useState(null)

  useEffect(() => {
    apiFetch('/api/manual/fixtures').then(r => r.json()).then(setFixtures)
    apiFetch('/api/manual/players').then(r => r.json()).then(setPlayers)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function ensureInnings(fid, order) {
    const r = await apiFetch(`/api/matches/${fid}/innings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ innings_order: order }),
    })
    const data = await r.json()
    if (!r.ok) throw new Error(data.error || 'Failed to create innings')
    setResultId(data.result_id)
    return data.result_id
  }

  async function selectInnings(order) {
    setInningsOrder(order)
    setDeliveries([])
    setErr(null)
    if (!fixtureId) return
    try {
      await ensureInnings(fixtureId, order)
      // Load existing deliveries
      const detail = await apiFetch(`/api/matches/${fixtureId}`).then(x => x.json())
      const inn = detail?.innings?.find(i => i.innings_order === order)
      if (inn) {
        const dels = []
        for (const ov of (inn.overs || [])) {
          for (const b of (ov.balls || [])) dels.push(b)
        }
        setDeliveries(dels)
        // Pre-set bowler from last over if any
        if (dels.length) {
          const last = dels[dels.length - 1]
          setBowler(String(last.bowler_id || ''))
          setStriker(String(last.batter_id || ''))
          setNonStriker(String(last.batter_id_ns || ''))
        }
      }
    } catch (e) { setErr(e.message) }
  }

  async function addPlayer() {
    const name = newPlayerName.trim()
    if (!name) return
    // Find existing player by name
    const found = players.find(p => p.name.toLowerCase() === name.toLowerCase())
    if (found) { setNewPlayerName(''); return found.player_id }
    // Create via manual players endpoint (just POST to /api/manual/players with name)
    const r = await apiFetch('/api/manual/player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!r.ok) { const j = await r.json(); setErr(j.error || 'Failed to add player'); return null }
    const data = await r.json()
    setPlayers(prev => [...prev, { player_id: data.player_id, name }].sort((a, b) => a.name.localeCompare(b.name)))
    setNewPlayerName('')
    return data.player_id
  }

  async function submitBall() {
    if (!striker || !bowler) { setErr('Striker and bowler are required'); return }
    setSaving(true); setErr(null); setMsg(null)
    try {
      let rid = resultId
      if (!rid) rid = await ensureInnings(fixtureId, inningsOrder)

      const body = {
        batter_id:   Number(striker),
        batter_id_ns: nonStriker ? Number(nonStriker) : null,
        bowler_id:   Number(bowler),
        runs_bat:    extrasType === 2 ? 0 : Number(runsBat),
        runs_extra:  extrasType !== null && extrasType !== 1 ? Number(runsExtra) : (extrasType === 1 ? Number(runsExtra) : 0),
        extras_type: extrasType,
      }
      // For no-balls: runs_bat is batting runs scored off the delivery
      if (extrasType === 1) {
        body.runs_bat   = Number(runsBat)
        body.runs_extra = Number(runsExtra) || 1  // 1 penalty run minimum
      }
      if (hasWicket && dismissedId && method) {
        body.dismissed_batter_id = Number(dismissedId)
        body.dismissal_method    = method
        if (FIELDER_METHODS.includes(method) && fielderId) body.dismissal_fielder_id = Number(fielderId)
        if (method !== 'RunOut' && method !== 'CaughtAndBowled' && disBowlerId) body.dismissal_bowler_id = Number(disBowlerId)
      }

      const r = await apiFetch(`/api/matches/${fixtureId}/innings/${inningsOrder}/delivery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed to add delivery')

      // Update local deliveries list
      const newDel = { ...body, id: data.id, over_no: data.over_no, ball_no: data.ball_no }
      const updated = [...deliveries, newDel]
      setDeliveries(updated)

      // Auto-rotate striker if legal ball (non-wide) and odd runs — swap striker/non-striker
      const isWide = extrasType === 2
      if (!isWide) {
        const totalRuns = (extrasType === null ? Number(runsBat) : Number(runsExtra) + (extrasType === 1 ? Number(runsBat) : 0))
        const isOdd = totalRuns % 2 === 1

        // End of legal over — swap ends (unless wicket)
        const newLegalInOver = updated.filter(d =>
          d.over_no === data.over_no && (d.extras_type === null || d.extras_type === 3 || d.extras_type === 4)
        ).length
        const overEnded = newLegalInOver >= 6

        if (overEnded) {
          // Swap ends: new over starts with non-striker as striker
          if (!hasWicket) {
            const tmp = nonStriker
            setNonStriker(striker)
            setStriker(tmp)
          }
        } else if (isOdd && !hasWicket) {
          const tmp = nonStriker
          setNonStriker(striker)
          setStriker(tmp)
        }
      }

      // Reset wicket / runs for next ball
      setRunsBat(0); setRunsExtra(0); setExtrasType(null)
      setHasWicket(false); setDismissedId(''); setFielderId(''); setDisBowlerId('')
      if (hasWicket) setStriker('') // new batter needed
      setMsg(`Ball ${data.over_no}.${data.ball_no} added`)
    } catch (e) { setErr(e.message) }
    setSaving(false)
  }

  async function undoLast() {
    if (!deliveries.length) return
    const last = deliveries[deliveries.length - 1]
    setUndoing(true); setErr(null); setMsg(null)
    try {
      const r = await apiFetch(`/api/matches/${fixtureId}/delivery/${last.id}`, { method: 'DELETE' })
      if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Undo failed') }
      setDeliveries(prev => prev.slice(0, -1))
      setMsg('Last ball removed')
    } catch (e) { setErr(e.message) }
    setUndoing(false)
  }

  // Group deliveries into overs for display
  const overGroups = []
  for (const d of deliveries) {
    if (!overGroups.length || overGroups[overGroups.length - 1].over_no !== d.over_no) {
      overGroups.push({ over_no: d.over_no, balls: [d] })
    } else {
      overGroups[overGroups.length - 1].balls.push(d)
    }
  }

  const legalBalls = deliveries.filter(d => d.extras_type === null || d.extras_type === 3 || d.extras_type === 4).length
  const overs = Math.floor(legalBalls / 6)
  const ballsInOver = legalBalls % 6

  const totalRuns = deliveries.reduce((s, d) => s + (d.runs_bat || 0) + (d.runs_extra || 0), 0)
  const wickets   = deliveries.filter(d => d.dismissed_batter_id).length

  const isWide = extrasType === 2
  const isNoBall = extrasType === 1

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem' }}>
        <Link to="/manual" style={{ display: 'flex', alignItems: 'center', color: 'var(--dim)' }}>
          <ChevronLeft size={18} />
        </Link>
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Ball-by-ball entry</h2>
      </div>

      {/* Fixture selector */}
      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem' }}>
          Fixture
          <select value={fixtureId} onChange={e => { setFixtureId(e.target.value); setDeliveries([]); setResultId(null) }}>
            <option value="">— select —</option>
            {fixtures.map(f => (
              <option key={f.fixture_id} value={f.fixture_id}>
                {f.match_date} · {f.home_team} vs {f.away_team}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!fixtureId && (
        <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.5rem', textAlign: 'center' }}>
          {!fixtures.length ? (
            <>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>No fixtures available</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text2)', marginBottom: '1rem' }}>
                Create a fixture in the manual entry page first, then you can enter ball-by-ball data here.
              </p>
              <Link to="/manual" style={{ display: 'inline-block', marginTop: '0.5rem' }}>
                <button style={{ fontSize: '0.85rem' }}>Go to Manual Entry</button>
              </Link>
            </>
          ) : (
            <>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Select a fixture</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text2)', marginBottom: '1rem', lineHeight: '1.6' }}>
                Choose a fixture above to start entering deliveries.
              </p>
              <div style={{ fontSize: '0.75rem', color: 'var(--text3)', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                <strong>How it works:</strong><br/>
                1. Select a fixture<br/>
                2. Choose an innings (1 or 2)<br/>
                3. Enter each ball&rsquo;s details (striker, bowler, runs, wickets)<br/>
                4. Use Undo if you make a mistake
              </div>
            </>
          )}
        </div>
      )}

      {fixtureId && (
        <>
          {/* Innings tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: '1rem' }}>
            {[1, 2].map(n => (
              <button key={n}
                className={inningsOrder === n ? '' : 'secondary'}
                onClick={() => selectInnings(n)}
                style={{ fontSize: '0.85rem' }}>
                Innings {n}
              </button>
            ))}
          </div>

          {/* Scoreline */}
          <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
            <span style={{ fontWeight: 700, fontSize: '1.2rem' }}>{totalRuns}/{wickets}</span>
            <span style={{ color: 'var(--dim)', fontSize: '0.85rem' }}>({overs}.{ballsInOver} overs)</span>
            <button className="secondary" onClick={undoLast} disabled={!deliveries.length || undoing}
              style={{ marginLeft: 'auto', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 4 }}>
              <Undo2 size={13} /> Undo last
            </button>
          </div>

          {/* Over history */}
          {overGroups.length > 0 && (
            <div style={{ marginBottom: '1rem', fontSize: '0.82rem' }}>
              {overGroups.map(ov => {
                const ovRuns = ov.balls.reduce((s, d) => s + (d.runs_bat || 0) + (d.runs_extra || 0), 0)
                return (
                  <div key={ov.over_no} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ color: 'var(--dim)', minWidth: 48 }}>Ov {ov.over_no + 1}</span>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {ov.balls.map((b, i) => (
                        <span key={i} style={{
                          background: b.dismissed_batter_id ? 'var(--hotpink)' :
                            b.extras_type === 2 ? 'var(--surface-alt)' :
                            b.extras_type === 1 ? 'var(--amber)' : 'var(--surface)',
                          color: b.dismissed_batter_id ? '#fff' : 'inherit',
                          borderRadius: 4, padding: '2px 6px', fontSize: '0.78rem',
                        }}>
                          {ballDot(b)}
                        </span>
                      ))}
                    </div>
                    <span style={{ color: 'var(--dim)', marginLeft: 4 }}>{ovRuns}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Add player */}
          <details style={{ marginBottom: '1rem', fontSize: '0.82rem' }}>
            <summary style={{ cursor: 'pointer', color: 'var(--dim)' }}>Add player to roster</summary>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input
                value={newPlayerName}
                onChange={e => setNewPlayerName(e.target.value)}
                placeholder="Player name"
                style={{ flex: 1 }}
                onKeyDown={e => e.key === 'Enter' && addPlayer()}
              />
              <button className="secondary" onClick={addPlayer} style={{ fontSize: '0.82rem' }}>Add</button>
            </div>
          </details>

          {/* Delivery entry */}
          <div style={{ background: 'var(--surface)', borderRadius: 8, padding: '1rem', display: 'grid', gap: '0.75rem' }}>
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--dim)' }}>
              Next ball
            </div>

            {/* Batter / Bowler */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
                Striker *
                <select value={striker} onChange={e => setStriker(e.target.value)}>
                  <option value="">— select —</option>
                  {players.map(p => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
                Bowler *
                <select value={bowler} onChange={e => setBowler(e.target.value)}>
                  <option value="">— select —</option>
                  {players.map(p => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
                </select>
              </label>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
              Non-striker
              <select value={nonStriker} onChange={e => setNonStriker(e.target.value)}>
                <option value="">— unknown —</option>
                {players.map(p => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
              </select>
            </label>

            {/* Delivery type */}
            <div>
              <div style={{ fontSize: '0.82rem', marginBottom: 4 }}>Type</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {EXTRAS_LABELS.map(({ value, label }) => (
                  <button key={String(value)}
                    className={extrasType === value ? '' : 'secondary'}
                    style={{ fontSize: '0.78rem', padding: '3px 10px' }}
                    onClick={() => { setExtrasType(value); setRunsBat(0); setRunsExtra(0) }}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Runs */}
            <div>
              {!isWide && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: '0.82rem', marginBottom: 4 }}>
                    {isNoBall ? 'Bat runs (off no-ball)' : 'Bat runs'}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {[0,1,2,3,4,6].map(n => (
                      <button key={n}
                        className={runsBat === n ? '' : 'secondary'}
                        style={{ fontSize: '0.85rem', padding: '4px 10px', minWidth: 36 }}
                        onClick={() => setRunsBat(n)}>
                        {n}
                      </button>
                    ))}
                    <input type="number" min={0} max={99} value={runsBat}
                      onChange={e => setRunsBat(Number(e.target.value))}
                      style={{ width: 52, fontSize: '0.85rem' }} />
                  </div>
                </div>
              )}
              {(isWide || isNoBall || extrasType === 3 || extrasType === 4) && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
                  {isNoBall ? 'Penalty runs (usually 1)' : 'Extra runs'}
                  <input type="number" min={isNoBall ? 1 : 1} max={10} value={runsExtra}
                    onChange={e => setRunsExtra(Number(e.target.value))}
                    style={{ width: 64 }} />
                </label>
              )}
            </div>

            {/* Wicket */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={hasWicket} onChange={e => setHasWicket(e.target.checked)} />
              Wicket
            </label>

            {hasWicket && (
              <div style={{ display: 'grid', gap: '0.6rem', paddingLeft: '0.75rem', borderLeft: '2px solid var(--hotpink)' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
                  Dismissed batter
                  <select value={dismissedId} onChange={e => setDismissedId(e.target.value)}>
                    <option value="">— select —</option>
                    {players.map(p => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
                  </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
                  Method
                  <select value={method} onChange={e => setMethod(e.target.value)}>
                    {DISMISSAL_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
                {FIELDER_METHODS.includes(method) && method !== 'CaughtAndBowled' && (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
                    Fielder
                    <select value={fielderId} onChange={e => setFielderId(e.target.value)}>
                      <option value="">— none —</option>
                      {players.map(p => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
                    </select>
                  </label>
                )}
                {method !== 'RunOut' && method !== 'CaughtAndBowled' && (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
                    Bowler (if different)
                    <select value={disBowlerId} onChange={e => setDisBowlerId(e.target.value)}>
                      <option value="">— same as delivery bowler —</option>
                      {players.map(p => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
                    </select>
                  </label>
                )}
              </div>
            )}

            {err && <div style={{ color: 'var(--red)', fontSize: '0.82rem' }}>{err}</div>}
            {msg && <div style={{ color: 'var(--green)', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={14} />{msg}</div>}

            <button onClick={submitBall} disabled={saving || !striker || !bowler}
              style={{ fontWeight: 600 }}>
              {saving ? 'Adding…' : 'Add ball'}
            </button>
          </div>

          {/* Link to full scorecard */}
          {deliveries.length > 0 && (
            <div style={{ marginTop: '1rem', textAlign: 'center' }}>
              <Link to={`/match/${fixtureId}`} style={{ fontSize: '0.85rem', color: 'var(--dim)' }}>
                View full match →
              </Link>
            </div>
          )}
        </>
      )}
    </main>
  )
}
