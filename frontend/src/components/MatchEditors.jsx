import { useState } from 'react'
import { X } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'
import { shortTeam } from '../utils/cricket'

function ResultEditor({ fixture, fixtureId, onClose, onSaved }) {
  const apiFetch = useApiFetch()
  const [result,       setResult]       = useState(fixture.result       ?? '')
  const [homeScore,    setHomeScore]    = useState(fixture.home_score    ?? '')
  const [awayScore,    setAwayScore]    = useState(fixture.away_score    ?? '')
  const [homeWickets,  setHomeWickets]  = useState(fixture.home_wickets  ?? '')
  const [awayWickets,  setAwayWickets]  = useState(fixture.away_wickets  ?? '')
  const [homeOvers,    setHomeOvers]    = useState(fixture.home_overs    ?? '')
  const [awayOvers,    setAwayOvers]    = useState(fixture.away_overs    ?? '')
  const [tossWinner,   setTossWinner]   = useState(fixture.toss_winner   ?? '')
  const [tossDec,      setTossDec]      = useState(fixture.toss_decision ?? '')
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState(null)

  const teams = [fixture.home_team, fixture.away_team].filter(Boolean)

  async function save() {
    setSaving(true); setErr(null)
    const body = {
      result:        result       || null,
      home_score:    homeScore    || null,
      away_score:    awayScore    || null,
      home_wickets:  homeWickets  || null,
      away_wickets:  awayWickets  || null,
      home_overs:    homeOvers    || null,
      away_overs:    awayOvers    || null,
      toss_winner:   tossWinner   || null,
      toss_decision: tossDec      || null,
    }
    try {
      const r = await apiFetch(`/api/matches/${fixtureId}/result`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Save failed') }
      onSaved()
    } catch (e) { setErr(e.message) }
    setSaving(false)
  }

  const field = (label, value, setter, placeholder = '') => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
      {label}
      <input value={value} onChange={e => setter(e.target.value)} placeholder={placeholder}
        style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text1)' }} />
    </label>
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-body" onClick={e => e.stopPropagation()} style={{ maxWidth: 440, width: '95vw' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Edit result</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ display: 'grid', gap: '0.75rem' }}>
          {field('Result text', result, setResult, 'e.g. WHCC won by 5 wickets')}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {field(`${shortTeam(fixture.home_team) || 'Home'} score`, homeScore, setHomeScore, '145')}
            {field(`${shortTeam(fixture.away_team) || 'Away'} score`, awayScore, setAwayScore, '140')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {field(`${shortTeam(fixture.home_team) || 'Home'} wickets`, homeWickets, setHomeWickets, '5')}
            {field(`${shortTeam(fixture.away_team) || 'Away'} wickets`, awayWickets, setAwayWickets, '7')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {field(`${shortTeam(fixture.home_team) || 'Home'} overs`, homeOvers, setHomeOvers, '20')}
            {field(`${shortTeam(fixture.away_team) || 'Away'} overs`, awayOvers, setAwayOvers, '19.3')}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
              Toss winner
              <select value={tossWinner} onChange={e => setTossWinner(e.target.value)}
                style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text1)' }}>
                <option value="">— unknown —</option>
                {teams.map(t => <option key={t} value={t}>{shortTeam(t)}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
              Toss decision
              <select value={tossDec} onChange={e => setTossDec(e.target.value)}
                style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text1)' }}>
                <option value="">— unknown —</option>
                <option value="bat">Bat</option>
                <option value="field">Field</option>
              </select>
            </label>
          </div>

          {err && <div style={{ color: 'var(--red)', fontSize: '0.82rem' }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="secondary" onClick={onClose}>Cancel</button>
            <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

const DISMISSAL_METHODS = ['Bowled', 'Caught', 'CaughtAndBowled', 'LBW', 'Stumped', 'RunOut']
const FIELDER_METHODS    = ['Caught', 'Stumped', 'RunOut']

function DeliveryEditor({ ball, fixtureId, matchPlayers, onClose, onSaved }) {
  const apiFetch = useApiFetch()
  const [batterId,      setBatterId]      = useState(String(ball.batter_id ?? ''))
  const [batterIdNs,   setBatterIdNs]    = useState(String(ball.batter_id_ns ?? ''))
  const [bowlerId,      setBowlerId]      = useState(String(ball.bowler_id ?? ''))
  const [extrasType,    setExtrasType]    = useState(ball.extras_type ?? 'normal')
  const [runsBat,       setRunsBat]       = useState(ball.runs_bat ?? 0)
  const [runsExtra,     setRunsExtra]     = useState(ball.runs_extra ?? 0)
  const [hasWicket,     setHasWicket]     = useState(!!ball.dismissed_batter_id)
  const [dismissedId,   setDismissedId]   = useState(String(ball.dismissed_batter_id ?? ball.batter_id ?? ''))
  const [method,        setMethod]        = useState(ball.dismissal_method || 'Bowled')
  const [fielderId,     setFielderId]     = useState(String(ball.dismissal_fielder_id ?? ''))
  const [disBowlerId,   setDisBowlerId]   = useState(String(ball.dismissal_bowler_id ?? ball.bowler_id ?? ''))
  const [saving,        setSaving]        = useState(false)
  const [err,           setErr]           = useState(null)

  async function save() {
    setSaving(true); setErr(null)
    const body = {
      batter_id:    Number(batterId)   || null,
      batter_id_ns: batterIdNs ? (Number(batterIdNs) || null) : null,
      bowler_id:    Number(bowlerId)   || null,
      runs_bat:    Number(runsBat),
      runs_extra:  Number(runsExtra),
      extras_type: extrasType === 'normal' ? null : Number(extrasType),
    }
    if (hasWicket) {
      body.dismissed_batter_id = Number(dismissedId) || Number(batterId) || null
      body.dismissal_method    = method
      if (FIELDER_METHODS.includes(method) && fielderId) body.dismissal_fielder_id = Number(fielderId)
      if (method !== 'RunOut' && disBowlerId) body.dismissal_bowler_id = Number(disBowlerId)
    } else {
      body.dismissed_batter_id = null
    }
    try {
      const r = await apiFetch(`/api/matches/${fixtureId}/delivery/${ball.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Save failed') }
      onSaved()
    } catch (e) { setErr(e.message) }
    setSaving(false)
  }

  const showBatRuns   = extrasType === 'normal' || extrasType === 1
  const showExtraRuns = extrasType !== 'normal'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-body" onClick={e => e.stopPropagation()} style={{ maxWidth: 420, width: '95vw' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Edit delivery</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ display: 'grid', gap: '0.75rem' }}>
          {/* Batter / Bowler */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
              Striker
              <select value={batterId} onChange={e => setBatterId(e.target.value)}>
                {matchPlayers.map(p => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
              Bowler
              <select value={bowlerId} onChange={e => setBowlerId(e.target.value)}>
                {matchPlayers.map(p => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
              </select>
            </label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
            Non-striker
            <select value={batterIdNs} onChange={e => setBatterIdNs(e.target.value)}>
              <option value="">— unknown —</option>
              {matchPlayers.map(p => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
            </select>
          </label>

          {/* Delivery type */}
          <div>
            <div style={{ fontSize: '0.82rem', marginBottom: 4 }}>Type</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {[['normal','Normal'],[2,'Wide'],[1,'No-ball'],[3,'Byes'],[4,'Leg-byes']].map(([v, label]) => (
                <button key={v} className={extrasType === v ? '' : 'secondary'}
                  style={{ fontSize: '0.78rem', padding: '3px 10px' }}
                  onClick={() => setExtrasType(v)}>{label}</button>
              ))}
            </div>
          </div>

          {/* Runs */}
          <div style={{ display: 'flex', gap: 12 }}>
            {showBatRuns && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
                Bat runs
                <input type="number" min={0} max={6} value={runsBat} onChange={e => setRunsBat(Number(e.target.value))}
                  style={{ width: 64 }} />
              </label>
            )}
            {showExtraRuns && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
                Extra runs (total incl. penalty)
                <input type="number" min={0} max={10} value={runsExtra} onChange={e => setRunsExtra(Number(e.target.value))}
                  style={{ width: 80 }} />
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
                  {matchPlayers.map(p => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
                Method
                <select value={method} onChange={e => setMethod(e.target.value)}>
                  {DISMISSAL_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              {FIELDER_METHODS.includes(method) && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
                  Fielder
                  <select value={fielderId} onChange={e => setFielderId(e.target.value)}>
                    <option value="">— none —</option>
                    {matchPlayers.map(p => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
                  </select>
                </label>
              )}
              {method !== 'RunOut' && method !== 'CaughtAndBowled' && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
                  Bowler (dismissal)
                  <select value={disBowlerId} onChange={e => setDisBowlerId(e.target.value)}>
                    <option value="">— same as delivery bowler —</option>
                    {matchPlayers.map(p => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
                  </select>
                </label>
              )}
            </div>
          )}
        </div>

        {err && <div style={{ color: 'var(--red)', fontSize: '0.82rem', marginTop: '0.5rem' }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: '1rem', justifyContent: 'flex-end' }}>
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

function PairBlockEditor({ fixtureId, inningsOrder, overStart, overEnd, currentPlayerIds, matchPlayers, onClose, onSaved }) {
  const apiFetch = useApiFetch()
  const defaultPlayers = matchPlayers.filter(p => currentPlayerIds.includes(p.player_id))
  const [batter1Id, setBatter1Id] = useState(String(defaultPlayers[0]?.player_id ?? ''))
  const [batter2Id, setBatter2Id] = useState(String(defaultPlayers[1]?.player_id ?? ''))
  const [ovrStart,  setOvrStart]  = useState(String(overStart))
  const [ovrEnd,    setOvrEnd]    = useState(String(overEnd))
  const [saving,    setSaving]    = useState(false)
  const [err,       setErr]       = useState(null)

  const currentNames = currentPlayerIds
    .map(id => matchPlayers.find(p => p.player_id === id)?.name ?? `#${id}`)
    .join(' & ')

  async function save() {
    if (!batter1Id || !batter2Id) { setErr('Select both players'); return }
    setSaving(true); setErr(null)
    try {
      const r = await apiFetch(`/api/matches/${fixtureId}/pair-block`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          innings_order: inningsOrder,
          over_start: Number(ovrStart),
          over_end:   Number(ovrEnd),
          batter1_id: Number(batter1Id),
          batter2_id: Number(batter2Id),
        }),
      })
      if (!r.ok) { const j = await r.json(); throw new Error(j.error || 'Save failed') }
      onSaved()
    } catch (e) { setErr(e.message) }
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-body" onClick={e => e.stopPropagation()} style={{ maxWidth: 380, width: '95vw' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Reassign pair</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        {currentNames && (
          <div style={{ fontSize: '0.8rem', color: 'var(--text3)', marginBottom: '0.75rem' }}>
            Current: {currentNames}{currentPlayerIds.length > 2 ? ` (+${currentPlayerIds.length - 2} extra)` : ''}
          </div>
        )}

        <div style={{ display: 'grid', gap: '0.65rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
              Over start
              <input type="number" min={1} value={ovrStart} onChange={e => setOvrStart(e.target.value)} style={{ width: '100%' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
              Over end
              <input type="number" min={1} value={ovrEnd} onChange={e => setOvrEnd(e.target.value)} style={{ width: '100%' }} />
            </label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
            Batter 1
            <select value={batter1Id} onChange={e => setBatter1Id(e.target.value)}>
              <option value="">— select —</option>
              {matchPlayers.map(p => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}>
            Batter 2
            <select value={batter2Id} onChange={e => setBatter2Id(e.target.value)}>
              <option value="">— select —</option>
              {matchPlayers.map(p => <option key={p.player_id} value={p.player_id}>{p.name}</option>)}
            </select>
          </label>
        </div>

        {err && <div style={{ color: 'var(--red)', fontSize: '0.82rem', marginTop: '0.5rem' }}>{err}</div>}

        <div style={{ display: 'flex', gap: 8, marginTop: '1rem', justifyContent: 'flex-end' }}>
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Reassign'}</button>
        </div>
      </div>
    </div>
  )
}


export { ResultEditor, DeliveryEditor, PairBlockEditor }
