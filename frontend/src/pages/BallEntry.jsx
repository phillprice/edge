import { useState, useEffect, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ChevronLeft, Undo2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'
import { formatDateShort } from '../utils/cricket'

const DISMISSAL_METHODS = [
  'Bowled',
  'Caught',
  'CaughtAndBowled',
  'LBW',
  'Stumped',
  'RunOut',
  'HitWicket',
  'Handled',
  'Obstructing'
]
const FIELDER_METHODS = ['Caught', 'CaughtAndBowled', 'Stumped', 'RunOut']
const EXTRAS_LABELS = [
  { value: null, label: 'Normal' },
  { value: 2, label: 'Wide' },
  { value: 1, label: 'No-ball' },
  { value: 3, label: 'Bye' },
  { value: 4, label: 'Leg-bye' },
  { value: 5, label: 'Penalty' }
]

function ballDot(d) {
  if (d.dismissed_batter_id) return 'W'
  const et = d.extras_type
  if (et === 2) return 'Wd'
  if (et === 1) return 'Nb'
  if (et === 3 || et === 4) return `+${d.runs_extra}`
  if (et === 5) return `P${d.runs_extra}`
  return d.runs_bat === 0 ? '•' : String(d.runs_bat)
}

const FORMAT_DEFAULTS = {
  format: 'standard',
  balls_per_over: 6,
  wide_runs: 1,
  wide_rebowl: 'always',
  no_ball_runs: 1,
  no_ball_rebowl: 'always',
  overs_per_pair: null,
  pairs_wicket_penalty: 5,
  starting_score: 0
}

function deriveFormatConfig(fixture) {
  const f = fixture ?? FORMAT_DEFAULTS
  return {
    format: f.format,
    ballsPerOver: f.balls_per_over,
    wideRuns: f.wide_runs,
    wideRebowl: f.wide_rebowl,
    noBallRuns: f.no_ball_runs,
    noBallRebowl: f.no_ball_rebowl,
    oversPerPair: f.overs_per_pair,
    pairsWicketPenalty: f.pairs_wicket_penalty,
    startingScore: f.starting_score
  }
}

function ballColour(d) {
  if (d.dismissed_batter_id) return 'var(--hotpink)'
  if (d.extras_type === 2) return 'var(--surface-alt)'
  if (d.extras_type === 1) return 'var(--amber)'
  if (d.extras_type === 5) return 'var(--purple, #7c3aed)'
  return 'var(--surface)'
}

function initBatterSlot(stats, id) {
  if (id && !stats[id]) stats[id] = { runs: 0, balls: 0, out: false }
}

function batterRunsFromDelivery(d) {
  return d.extras_type === 2 ? 0 : d.runs_bat || 0
}

// Compute per-batter stats from deliveries array (client-side, no API call)
function computeBatterStats(deliveries) {
  const stats = {}
  for (const d of deliveries) {
    initBatterSlot(stats, d.batter_id)
    initBatterSlot(stats, d.batter_id_ns)
    if (stats[d.batter_id]) {
      stats[d.batter_id].runs += batterRunsFromDelivery(d)
      if (d.extras_type !== 2) stats[d.batter_id].balls++
    }
    if (stats[d.dismissed_batter_id]) {
      stats[d.dismissed_batter_id].out = true
    }
  }
  return stats
}

export default function BallEntry() {
  const apiFetch = useApiFetch()
  const { fixtureId: paramFixtureId } = useParams()

  // Fixture / innings selection
  const [fixtures, setFixtures] = useState([])
  const [fixtureId, setFixtureId] = useState(paramFixtureId || '')
  const [fixture, setFixture] = useState(null)
  const [inningsOrder, setInningsOrder] = useState(1)
  const [resultId, setResultId] = useState(null)

  // Delivery history for current innings
  const [deliveries, setDeliveries] = useState([])

  // Known players
  const [players, setPlayers] = useState([])

  // Current delivery state
  const [striker, setStriker] = useState('')
  const [nonStriker, setNonStriker] = useState('')
  const [bowler, setBowler] = useState('')
  const [runsBat, setRunsBat] = useState(0)
  const [runsExtra, setRunsExtra] = useState(0)
  const [extrasType, setExtrasType] = useState(null)
  const [hasWicket, setHasWicket] = useState(false)
  const [dismissedId, setDismissedId] = useState('')
  const [method, setMethod] = useState('Caught')
  const [fielderId, setFielderId] = useState('')
  const [fielder2Id, setFielder2Id] = useState('')
  const [disBowlerId, setDisBowlerId] = useState('')
  const [newPlayerName, setNewPlayerName] = useState('')

  // UI state
  const [saving, setSaving] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [err, setErr] = useState(null)
  const [msg, setMsg] = useState(null)
  const [overSummary, setOverSummary] = useState(null) // { over_no, runs }
  const [showPenaltyPopover, setShowPenaltyPopover] = useState(false)
  const [penaltyRuns, setPenaltyRuns] = useState(5)
  const [pairChangePrompt, setPairChangePrompt] = useState(false)

  useEffect(() => {
    apiFetch('/api/manual/fixtures')
      .then((r) => r.json())
      .then(setFixtures)
    apiFetch('/api/manual/players')
      .then((r) => r.json())
      .then(setPlayers)
  }, [apiFetch])

  // Sync fixture config from the already-loaded list whenever fixtureId changes
  useEffect(() => {
    if (!fixtureId) {
      setFixture(null)
      return
    }
    const f = fixtures.find((x) => String(x.fixture_id) === String(fixtureId))
    setFixture(f || null)
  }, [fixtureId, fixtures])

  const formatConfig = useMemo(() => deriveFormatConfig(fixture), [fixture])

  const isPairs = formatConfig.format === 'pairs'

  async function ensureInnings(fid, order) {
    const r = await apiFetch(`/api/matches/${fid}/innings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ innings_order: order })
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
    setOverSummary(null)
    if (!fixtureId) return
    try {
      await ensureInnings(fixtureId, order)
      const detail = await apiFetch(`/api/matches/${fixtureId}`).then((x) => x.json())
      const inn = detail?.innings?.find((i) => i.innings_order === order)
      if (inn) {
        const dels = []
        for (const ov of inn.overs || []) {
          for (const b of ov.balls || []) dels.push(b)
        }
        setDeliveries(dels)
        if (dels.length) {
          const last = dels[dels.length - 1]
          setBowler(String(last.bowler_id || ''))
          setStriker(String(last.batter_id || ''))
          setNonStriker(String(last.batter_id_ns || ''))
        }
      }
    } catch (e) {
      setErr(e.message)
    }
  }

  async function addPlayer() {
    const name = newPlayerName.trim()
    if (!name) return
    const found = players.find((p) => p.name.toLowerCase() === name.toLowerCase())
    if (found) {
      setNewPlayerName('')
      return found.player_id
    }
    const r = await apiFetch('/api/manual/player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    })
    if (!r.ok) {
      const j = await r.json()
      setErr(j.error || 'Failed to add player')
      return null
    }
    const data = await r.json()
    setPlayers((prev) =>
      [...prev, { player_id: data.player_id, name }].sort((a, b) => a.name.localeCompare(b.name))
    )
    setNewPlayerName('')
    return data.player_id
  }

  async function submitBall() {
    if (!striker || !bowler) {
      setErr('Striker and bowler are required')
      return
    }
    setSaving(true)
    setErr(null)
    setMsg(null)
    setOverSummary(null)
    try {
      let rid = resultId
      if (!rid) rid = await ensureInnings(fixtureId, inningsOrder)

      const isWide = extrasType === 2
      const isNoBall = extrasType === 1

      const body = {
        batter_id: Number(striker),
        batter_id_ns: nonStriker ? Number(nonStriker) : null,
        bowler_id: Number(bowler),
        runs_bat: isWide ? 0 : Number(runsBat),
        runs_extra: isNoBall
          ? Math.max(Number(runsExtra), formatConfig.noBallRuns)
          : extrasType !== null
            ? Number(runsExtra)
            : 0,
        extras_type: extrasType
      }
      if (isNoBall) {
        body.runs_bat = Number(runsBat)
      }
      if (hasWicket && dismissedId && method) {
        body.dismissed_batter_id = Number(dismissedId)
        body.dismissal_method = method
        if (FIELDER_METHODS.includes(method) && method !== 'CaughtAndBowled' && fielderId)
          body.dismissal_fielder_id = Number(fielderId)
        if (method === 'RunOut' && fielder2Id) body.dismissal_fielder2_id = Number(fielder2Id)
        if (method !== 'RunOut' && method !== 'CaughtAndBowled' && disBowlerId)
          body.dismissal_bowler_id = Number(disBowlerId)
      }

      const r = await apiFetch(`/api/matches/${fixtureId}/innings/${inningsOrder}/delivery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed to add delivery')

      const newDel = { ...body, id: data.id, over_no: data.over_no, ball_no: data.ball_no }
      const updated = [...deliveries, newDel]
      setDeliveries(updated)

      // Detect over boundary
      const prevOverNo = deliveries.length
        ? deliveries[deliveries.length - 1].over_no
        : data.over_no
      const overEnded = data.over_no > prevOverNo

      // Strike rotation
      if (!isWide) {
        const totalRuns = isNoBall
          ? Number(runsExtra) + Number(runsBat)
          : extrasType === null
            ? Number(runsBat)
            : Number(runsExtra)
        const isOdd = totalRuns % 2 === 1

        if (overEnded) {
          if (!hasWicket || isPairs) {
            const tmp = nonStriker
            setNonStriker(striker)
            setStriker(tmp)
          }
          const overBalls = updated.filter((d) => d.over_no === prevOverNo)
          const ovRuns = overBalls.reduce((s, d) => s + (d.runs_bat || 0) + (d.runs_extra || 0), 0)
          setOverSummary({ over_no: prevOverNo, runs: ovRuns })

          if (isPairs && formatConfig.oversPerPair) {
            const newOverNo = data.over_no
            if (newOverNo > 0 && newOverNo % formatConfig.oversPerPair === 0) {
              setPairChangePrompt(true)
            }
          }
        } else if (isOdd && !hasWicket) {
          const tmp = nonStriker
          setNonStriker(striker)
          setStriker(tmp)
        }
      }

      if (hasWicket) {
        if (isPairs) {
          const tmp = nonStriker
          setNonStriker(striker)
          setStriker(tmp)
        } else {
          setStriker('')
        }
      }

      setRunsBat(0)
      setRunsExtra(0)
      setExtrasType(null)
      setHasWicket(false)
      setDismissedId('')
      setFielderId('')
      setFielder2Id('')
      setDisBowlerId('')
      setMsg(`Ball ${data.over_no + 1}.${data.ball_no} added`)
    } catch (e) {
      setErr(e.message)
    }
    setSaving(false)
  }

  async function submitPenalty() {
    if (!striker || !bowler) {
      setErr('Select batter and bowler before adding a penalty')
      setShowPenaltyPopover(false)
      return
    }
    setSaving(true)
    setErr(null)
    try {
      let rid = resultId
      if (!rid) rid = await ensureInnings(fixtureId, inningsOrder)
      const body = {
        batter_id: Number(striker),
        batter_id_ns: nonStriker ? Number(nonStriker) : null,
        bowler_id: Number(bowler),
        runs_bat: 0,
        runs_extra: Number(penaltyRuns),
        extras_type: 5
      }
      const r = await apiFetch(`/api/matches/${fixtureId}/innings/${inningsOrder}/delivery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed to add penalty')
      setDeliveries((prev) => [
        ...prev,
        { ...body, id: data.id, over_no: data.over_no, ball_no: data.ball_no }
      ])
      setShowPenaltyPopover(false)
      setPenaltyRuns(5)
      setMsg(`Penalty +${penaltyRuns} added`)
    } catch (e) {
      setErr(e.message)
    }
    setSaving(false)
  }

  async function undoLast() {
    if (!deliveries.length) return
    const last = deliveries[deliveries.length - 1]
    setUndoing(true)
    setErr(null)
    setMsg(null)
    setOverSummary(null)
    try {
      const r = await apiFetch(`/api/matches/${fixtureId}/delivery/${last.id}`, {
        method: 'DELETE'
      })
      if (!r.ok) {
        const j = await r.json()
        throw new Error(j.error || 'Undo failed')
      }
      const remaining = deliveries.slice(0, -1)
      setDeliveries(remaining)
      // Restore player state from the new last delivery
      if (remaining.length) {
        const prev = remaining[remaining.length - 1]
        setStriker(String(prev.batter_id || ''))
        setNonStriker(String(prev.batter_id_ns || ''))
        setBowler(String(prev.bowler_id || ''))
      }
      setMsg('Last ball removed')
    } catch (e) {
      setErr(e.message)
    }
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

  // Score computation
  const legalBalls = deliveries.filter(
    (d) => d.extras_type === null || d.extras_type === 3 || d.extras_type === 4
  ).length
  const overs = Math.floor(legalBalls / formatConfig.ballsPerOver)
  const ballsInOver = legalBalls % formatConfig.ballsPerOver
  const wickets = deliveries.filter((d) => d.dismissed_batter_id).length
  const rawRuns = deliveries.reduce((s, d) => s + (d.runs_bat || 0) + (d.runs_extra || 0), 0)
  const totalRuns = isPairs
    ? formatConfig.startingScore + rawRuns - wickets * formatConfig.pairsWicketPenalty
    : rawRuns

  const batterStats = useMemo(() => computeBatterStats(deliveries), [deliveries])

  const isPenalty = extrasType === 5
  const isWide = extrasType === 2
  const isNoBall = extrasType === 1

  const playerName = (id) => players.find((p) => String(p.player_id) === String(id))?.name ?? '?'

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
          <select
            value={fixtureId}
            onChange={(e) => {
              setFixtureId(e.target.value)
              setDeliveries([])
              setResultId(null)
              setOverSummary(null)
            }}
          >
            <option value="">— select —</option>
            {fixtures.map((f) => (
              <option key={f.fixture_id} value={f.fixture_id}>
                {formatDateShort(f.match_date) || f.match_date} · {f.home_team} vs {f.away_team}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!fixtureId && (
        <div
          style={{
            background: 'var(--bg3)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: '1.5rem',
            textAlign: 'center'
          }}
        >
          {!fixtures.length ? (
            <>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>No fixtures available</h3>
              <p style={{ fontSize: '0.85rem', color: 'var(--text2)', marginBottom: '1rem' }}>
                Create a fixture in the manual entry page first, then you can enter ball-by-ball
                data here.
              </p>
              <Link to="/manual" style={{ display: 'inline-block', marginTop: '0.5rem' }}>
                <button style={{ fontSize: '0.85rem' }}>Go to Manual Entry</button>
              </Link>
            </>
          ) : (
            <>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Select a fixture</h3>
              <p
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--text2)',
                  marginBottom: '1rem',
                  lineHeight: '1.6'
                }}
              >
                Choose a fixture above to start entering deliveries.
              </p>
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text3)',
                  paddingTop: '0.75rem',
                  borderTop: '1px solid var(--border)'
                }}
              >
                <strong>How it works:</strong>
                <br />
                1. Select a fixture
                <br />
                2. Choose an innings (1 or 2)
                <br />
                3. Enter each ball&rsquo;s details (striker, bowler, runs, wickets)
                <br />
                4. Use Undo if you make a mistake
              </div>
            </>
          )}
        </div>
      )}

      {fixtureId && (
        <>
          {/* Innings tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: '0.75rem' }}>
            {[1, 2].map((n) => (
              <button
                key={n}
                className={inningsOrder === n ? '' : 'secondary'}
                onClick={() => selectInnings(n)}
                style={{ fontSize: '0.85rem' }}
              >
                Innings {n}
              </button>
            ))}
          </div>

          {/* Format config pill row */}
          {fixture && (
            <div
              style={{
                fontSize: '0.72rem',
                color: 'var(--dim)',
                display: 'flex',
                flexWrap: 'wrap',
                gap: 6,
                marginBottom: '0.75rem'
              }}
            >
              <span style={{ background: 'var(--surface)', borderRadius: 4, padding: '2px 6px' }}>
                {formatConfig.ballsPerOver} balls/over
              </span>
              <span style={{ background: 'var(--surface)', borderRadius: 4, padding: '2px 6px' }}>
                Wide +{formatConfig.wideRuns} ({formatConfig.wideRebowl})
              </span>
              <span style={{ background: 'var(--surface)', borderRadius: 4, padding: '2px 6px' }}>
                NB +{formatConfig.noBallRuns} ({formatConfig.noBallRebowl})
              </span>
              {isPairs && (
                <>
                  {formatConfig.oversPerPair && (
                    <span
                      style={{ background: 'var(--surface)', borderRadius: 4, padding: '2px 6px' }}
                    >
                      {formatConfig.oversPerPair} ov/pair
                    </span>
                  )}
                  <span
                    style={{ background: 'var(--surface)', borderRadius: 4, padding: '2px 6px' }}
                  >
                    −{formatConfig.pairsWicketPenalty} per wicket
                  </span>
                </>
              )}
            </div>
          )}

          {/* Scoreline */}
          <div
            style={{
              background: 'var(--surface)',
              borderRadius: 8,
              padding: '0.75rem 1rem',
              marginBottom: '0.75rem',
              display: 'flex',
              gap: '1.5rem',
              alignItems: 'center',
              flexWrap: 'wrap'
            }}
          >
            <span style={{ fontWeight: 700, fontSize: '1.2rem' }}>
              {totalRuns}/{wickets}
            </span>
            <span style={{ color: 'var(--dim)', fontSize: '0.85rem' }}>
              ({overs}.{ballsInOver} overs)
            </span>
            {isPairs && formatConfig.startingScore > 0 && (
              <span style={{ fontSize: '0.75rem', color: 'var(--dim)' }}>
                Start {formatConfig.startingScore}
                {wickets > 0 && ` −${wickets * formatConfig.pairsWicketPenalty} pen`}
              </span>
            )}
            {/* Penalty button */}
            <div style={{ position: 'relative', marginLeft: 'auto' }}>
              <button
                className="secondary"
                onClick={() => setShowPenaltyPopover((v) => !v)}
                style={{ fontSize: '0.75rem', padding: '3px 8px' }}
                title="Add penalty runs"
              >
                + Penalty
              </button>
              {showPenaltyPopover && (
                <div
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: '100%',
                    marginTop: 4,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '0.75rem',
                    zIndex: 10,
                    minWidth: 180,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                  }}
                >
                  <div style={{ fontSize: '0.82rem', marginBottom: 6, fontWeight: 600 }}>
                    Penalty runs
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                    {[5, 10].map((n) => (
                      <button
                        key={n}
                        className={penaltyRuns === n ? '' : 'secondary'}
                        style={{ fontSize: '0.78rem', padding: '3px 10px' }}
                        onClick={() => setPenaltyRuns(n)}
                      >
                        {n}
                      </button>
                    ))}
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={penaltyRuns}
                      onChange={(e) => setPenaltyRuns(Number(e.target.value))}
                      style={{ width: 52, fontSize: '0.82rem' }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={submitPenalty}
                      disabled={saving}
                      style={{ fontSize: '0.78rem', flex: 1 }}
                    >
                      Add +{penaltyRuns}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setShowPenaltyPopover(false)}
                      style={{ fontSize: '0.78rem' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              className="secondary"
              onClick={undoLast}
              disabled={!deliveries.length || undoing}
              style={{
                fontSize: '0.78rem',
                display: 'flex',
                alignItems: 'center',
                gap: 4
              }}
            >
              <Undo2 size={13} /> Undo
            </button>
          </div>

          {/* End-of-over summary banner */}
          {overSummary && (
            <div
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '0.6rem 1rem',
                marginBottom: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.85rem'
              }}
            >
              <span>
                <strong>Over {overSummary.over_no + 1} complete</strong> — {overSummary.runs} runs.
                Change bowler?
              </span>
              <button
                className="secondary"
                onClick={() => setOverSummary(null)}
                style={{ fontSize: '0.75rem', padding: '2px 8px' }}
              >
                OK
              </button>
            </div>
          )}

          {/* Pair change prompt */}
          {pairChangePrompt && (
            <div
              style={{
                background: 'var(--amber, #f59e0b)',
                borderRadius: 8,
                padding: '0.75rem 1rem',
                marginBottom: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: '0.85rem'
              }}
            >
              <AlertTriangle size={16} />
              <span>
                <strong>Pair change</strong> — select the new batting pair below.
              </span>
              <button
                className="secondary"
                onClick={() => setPairChangePrompt(false)}
                style={{ marginLeft: 'auto', fontSize: '0.75rem', padding: '2px 8px' }}
              >
                Set
              </button>
            </div>
          )}

          {/* Live batter scores */}
          {(striker || nonStriker) && deliveries.length > 0 && (
            <div
              style={{
                background: 'var(--surface)',
                borderRadius: 8,
                padding: '0.5rem 1rem',
                marginBottom: '0.75rem',
                fontSize: '0.82rem'
              }}
            >
              <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                {[striker, nonStriker].filter(Boolean).map((id) => {
                  const s = batterStats[Number(id)]
                  if (!s) return null
                  const isOnStrike = String(id) === String(striker)
                  return (
                    <span key={id}>
                      <strong>{playerName(id)}</strong>
                      {isOnStrike ? ' *' : ''} — {s.runs || 0} ({s.balls || 0}b)
                      {s.out ? ' †' : ''}
                    </span>
                  )
                })}
              </div>
            </div>
          )}

          {/* Over history */}
          {overGroups.length > 0 && (
            <div style={{ marginBottom: '0.75rem', fontSize: '0.82rem' }}>
              {overGroups.map((ov) => {
                const ovRuns = ov.balls.reduce(
                  (s, d) => s + (d.runs_bat || 0) + (d.runs_extra || 0),
                  0
                )
                return (
                  <div
                    key={ov.over_no}
                    style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}
                  >
                    <span style={{ color: 'var(--dim)', minWidth: 48 }}>Ov {ov.over_no + 1}</span>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {ov.balls.map((b, i) => (
                        <span
                          key={i}
                          style={{
                            background: ballColour(b),
                            color: b.dismissed_batter_id ? '#fff' : 'inherit',
                            borderRadius: 4,
                            padding: '2px 6px',
                            fontSize: '0.78rem'
                          }}
                        >
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
          <details style={{ marginBottom: '0.75rem', fontSize: '0.82rem' }}>
            <summary style={{ cursor: 'pointer', color: 'var(--dim)' }}>
              Add player to roster
            </summary>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <input
                value={newPlayerName}
                onChange={(e) => setNewPlayerName(e.target.value)}
                placeholder="Player name"
                style={{ flex: 1 }}
                onKeyDown={(e) => e.key === 'Enter' && addPlayer()}
              />
              <button className="secondary" onClick={addPlayer} style={{ fontSize: '0.82rem' }}>
                Add
              </button>
            </div>
          </details>

          {/* Delivery entry */}
          <div
            style={{
              background: 'var(--surface)',
              borderRadius: 8,
              padding: '1rem',
              display: 'grid',
              gap: '0.75rem'
            }}
          >
            <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--dim)' }}>
              Next ball
            </div>

            {/* Batter / Bowler */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label
                style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}
              >
                Striker *
                <select value={striker} onChange={(e) => setStriker(e.target.value)}>
                  <option value="">— select —</option>
                  {players.map((p) => (
                    <option key={p.player_id} value={p.player_id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label
                style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}
              >
                Bowler *
                <select value={bowler} onChange={(e) => setBowler(e.target.value)}>
                  <option value="">— select —</option>
                  {players.map((p) => (
                    <option key={p.player_id} value={p.player_id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label
              style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: '0.82rem' }}
            >
              Non-striker
              <select value={nonStriker} onChange={(e) => setNonStriker(e.target.value)}>
                <option value="">— unknown —</option>
                {players.map((p) => (
                  <option key={p.player_id} value={p.player_id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            {/* Delivery type */}
            <div>
              <div style={{ fontSize: '0.82rem', marginBottom: 4 }}>Type</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {EXTRAS_LABELS.map(({ value, label }) => (
                  <button
                    key={String(value)}
                    className={extrasType === value ? '' : 'secondary'}
                    style={{ fontSize: '0.78rem', padding: '3px 10px' }}
                    onClick={() => {
                      setExtrasType(value)
                      setRunsBat(0)
                      if (value === 2) setRunsExtra(formatConfig.wideRuns)
                      else if (value === 1) setRunsExtra(formatConfig.noBallRuns)
                      else setRunsExtra(0)
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Runs — hidden when Penalty type selected (use popover instead) */}
            {!isPenalty && (
              <div>
                {!isWide && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: '0.82rem', marginBottom: 4 }}>
                      {isNoBall ? 'Bat runs (off no-ball)' : 'Bat runs'}
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                        <button
                          key={n}
                          className={runsBat === n ? '' : 'secondary'}
                          style={{ fontSize: '0.85rem', padding: '4px 10px', minWidth: 36 }}
                          onClick={() => setRunsBat(n)}
                        >
                          {n}
                        </button>
                      ))}
                      <input
                        type="number"
                        min={0}
                        max={99}
                        value={runsBat}
                        onChange={(e) => setRunsBat(Number(e.target.value))}
                        style={{ width: 52, fontSize: '0.85rem' }}
                      />
                    </div>
                  </div>
                )}
                {(isWide || isNoBall || extrasType === 3 || extrasType === 4) && (
                  <label
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
                      fontSize: '0.82rem'
                    }}
                  >
                    {isNoBall
                      ? `Penalty runs (default ${formatConfig.noBallRuns})`
                      : isWide
                        ? `Extra runs (default ${formatConfig.wideRuns})`
                        : 'Extra runs'}
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={runsExtra}
                      onChange={(e) => setRunsExtra(Number(e.target.value))}
                      style={{ width: 64 }}
                    />
                  </label>
                )}
              </div>
            )}

            {/* Wicket */}
            {!isPenalty && (
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: '0.82rem',
                  cursor: 'pointer'
                }}
              >
                <input
                  type="checkbox"
                  checked={hasWicket}
                  onChange={(e) => {
                    setHasWicket(e.target.checked)
                    if (e.target.checked && striker) setDismissedId(striker)
                    else setDismissedId('')
                  }}
                />
                Wicket
                {isPairs && hasWicket && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--dim)' }}>
                    (−{formatConfig.pairsWicketPenalty} runs penalty)
                  </span>
                )}
              </label>
            )}

            {hasWicket && (
              <div
                style={{
                  display: 'grid',
                  gap: '0.6rem',
                  paddingLeft: '0.75rem',
                  borderLeft: '2px solid var(--hotpink)'
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    fontSize: '0.82rem'
                  }}
                >
                  Dismissed batter
                  <select value={dismissedId} onChange={(e) => setDismissedId(e.target.value)}>
                    <option value="">— select —</option>
                    {players.map((p) => (
                      <option key={p.player_id} value={p.player_id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                    fontSize: '0.82rem'
                  }}
                >
                  Method
                  <select value={method} onChange={(e) => setMethod(e.target.value)}>
                    {DISMISSAL_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                {FIELDER_METHODS.includes(method) && method !== 'CaughtAndBowled' && (
                  <label
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
                      fontSize: '0.82rem'
                    }}
                  >
                    Fielder
                    <select value={fielderId} onChange={(e) => setFielderId(e.target.value)}>
                      <option value="">— none —</option>
                      {players.map((p) => (
                        <option key={p.player_id} value={p.player_id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {method === 'RunOut' && (
                  <label
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
                      fontSize: '0.82rem'
                    }}
                  >
                    Second fielder (optional)
                    <select value={fielder2Id} onChange={(e) => setFielder2Id(e.target.value)}>
                      <option value="">— none —</option>
                      {players.map((p) => (
                        <option key={p.player_id} value={p.player_id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {method !== 'RunOut' && method !== 'CaughtAndBowled' && (
                  <label
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 3,
                      fontSize: '0.82rem'
                    }}
                  >
                    Bowler (if different)
                    <select value={disBowlerId} onChange={(e) => setDisBowlerId(e.target.value)}>
                      <option value="">— same as delivery bowler —</option>
                      {players.map((p) => (
                        <option key={p.player_id} value={p.player_id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}

            {err && (
              <div
                style={{
                  color: 'var(--red)',
                  fontSize: '0.82rem',
                  display: 'flex',
                  gap: 4,
                  alignItems: 'flex-start'
                }}
              >
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                {err}
              </div>
            )}
            {msg && (
              <div
                style={{
                  color: 'var(--green)',
                  fontSize: '0.82rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4
                }}
              >
                <CheckCircle2 size={14} />
                {msg}
              </div>
            )}

            <button
              onClick={submitBall}
              disabled={saving || !striker || !bowler || isPenalty}
              style={{ fontWeight: 600 }}
            >
              {saving ? 'Adding…' : 'Add ball'}
            </button>
            {isPenalty && (
              <p style={{ fontSize: '0.78rem', color: 'var(--dim)', margin: 0 }}>
                Use the &ldquo;+ Penalty&rdquo; button in the scoreline to add penalty runs.
              </p>
            )}
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
