import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { Calendar, MapPin, Trophy, ChevronLeft, Pencil, X, Hand, HandCoins, ShieldAlert, Zap, Lock, HelpCircle } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'
import { displayName } from '../utils/cricket'

const WHCC_KEYWORDS = ['woking', 'horsell', 'whcc', 'whirlwind']
const isWhcc = s => WHCC_KEYWORDS.some(k => (s || '').toLowerCase().includes(k))

function computeManualResult(scorecards, fixture) {
  const whccSc = scorecards?.find(sc => sc.inningsOrder === 1 && sc.isManual)
  const oppSc  = scorecards?.find(sc => sc.inningsOrder === 2 && sc.isManual)
  if (!whccSc || !oppSc) return null
  const whccTeam = isWhcc(fixture.home_team) ? fixture.home_team : fixture.away_team
  const wr = whccSc.totals.runs, or = oppSc.totals.runs
  const diff = Math.abs(wr - or)
  if (wr > or) return { label: `${whccTeam} won by ${diff} run${diff === 1 ? '' : 's'}`, win: true }
  if (wr < or) return { label: `${whccTeam} lost by ${diff} run${diff === 1 ? '' : 's'}`, win: false }
  return { label: 'Tied', win: null }
}

// Returns { label, win } e.g. { label: 'Team won by 4 wickets', win: true }
function computeResult(scorecards, roles) {
  if (!scorecards?.length || !roles) return null
  const sc1 = scorecards[0], sc2 = scorecards[1]
  if (!sc2) return null
  const t1 = roles[sc1.inningsOrder]?.batting_team
  const t2 = roles[sc2.inningsOrder]?.batting_team
  const whccFirst = isWhcc(t1), whccSecond = isWhcc(t2)
  if (!whccFirst && !whccSecond) return null

  const whccTeam = whccFirst ? t1 : t2
  const whccSc = whccFirst ? sc1 : sc2
  const oppSc  = whccFirst ? sc2 : sc1

  if (sc1.isPairs) {
    const wr = whccSc.totals.netTotal ?? whccSc.totals.runs
    const or = oppSc.totals.netTotal ?? oppSc.totals.runs
    if (wr > or) return { label: `${whccTeam} won by ${wr - or} runs (net)`, win: true }
    if (wr < or) return { label: `${whccTeam} lost by ${or - wr} runs (net)`, win: false }
    return { label: 'Tied', win: null }
  }

  const wr = whccSc.totals.runs, or = oppSc.totals.runs
  const ww = whccSc.totals.wickets, ow = oppSc.totals.wickets

  if (wr > or) {
    if (!whccFirst) {
      const n = 10 - ww
      return { label: `${whccTeam} won by ${n} wicket${n === 1 ? '' : 's'}`, win: true }
    }
    const n = wr - or
    return { label: `${whccTeam} won by ${n} run${n === 1 ? '' : 's'}`, win: true }
  }
  if (wr < or) {
    if (!whccFirst) {
      const n = or - wr
      return { label: `${whccTeam} lost by ${n} run${n === 1 ? '' : 's'}`, win: false }
    }
    const n = 10 - ow
    return { label: `${whccTeam} lost by ${n} wicket${n === 1 ? '' : 's'}`, win: false }
  }
  return { label: 'Tied', win: null }
}

function parseBallSymbol(ball) {
  const s = (ball.s_desc || '').trim().toUpperCase()
  if (ball.wicket)              return { type: 'wicket', label: 'W' }
  if (s === '.' || s === '')    return { type: 'dot',    label: '·' }
  if (ball.extras_type === 2) {
    const r = ball.runs_extra > 1 ? ball.runs_extra : ''
    return { type: 'wide', label: r ? `${r}wd` : 'wd' }
  }
  if (ball.extras_type === 1) {
    const r = ball.runs_bat > 0 ? `${ball.runs_bat}nb` : 'nb'
    return { type: 'noball', label: r }
  }
  if (ball.extras_type === 3 || ball.extras_type === 4) {
    const prefix = ball.extras_type === 3 ? 'b' : 'lb'
    return { type: 'bye', label: ball.runs_extra > 1 ? `${ball.runs_extra}${prefix}` : prefix }
  }
  if (ball.runs_bat === 6) return { type: 'six',  label: '6' }
  if (ball.runs_bat === 4) return { type: 'four', label: '4' }
  if (ball.runs_bat > 0)   return { type: 'run',  label: String(ball.runs_bat) }
  return { type: 'dot', label: '·' }
}

function BallCircle({ ball }) {
  const { type, label } = parseBallSymbol(ball)
  return <span className={`ball ball-${type}`}>{label}</span>
}

export default function MatchDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useUser()
  const canUpload = user?.publicMetadata?.canUpload === true
  const [data, setData]         = useState(null)
  const [roles, setRoles]       = useState(null)
  const [loading, setLoading]   = useState(true)
  const [expandedOvers, setExpandedOvers] = useState({})
  const apiFetch = useApiFetch()

  useEffect(() => {
    apiFetch(`/api/matches/${id}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshRoles = useCallback(() => {
    apiFetch(`/api/matches/${id}/roles`)
      .then(r => r.json())
      .then(setRoles)
      .catch(() => {})
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refreshRoles() }, [refreshRoles])

  if (loading) return <div className="loading">Loading scorecard…</div>
  if (!data?.fixture) return <div className="loading">Match not found.</div>

  const { fixture, scorecards } = data
  const ordinals = ['1st', '2nd', '3rd', '4th']

  const allMatchNames = [...new Set([
    ...scorecards.flatMap(sc => [...sc.batting.map(b => b.name), ...sc.bowling.map(b => b.name)]),
    ...(data.whccNames || []),
  ])]
  const dn = name => displayName(name, allMatchNames)

  function toggleOvers(i) {
    setExpandedOvers(prev => ({ ...prev, [i]: !prev[i] }))
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem' }}>
        <button className="secondary" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 }}
          onClick={() => navigate('/')}><ChevronLeft size={14} /> Matches</button>
        {canUpload && scorecards.some(sc => sc.isManual) && (
          <button className="secondary" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => navigate(`/manual/${id}`)}><Pencil size={13} /> Edit</button>
        )}
      </div>

      {/* Match header */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ marginBottom: '0' }}>
          {fixture.home_team || 'Home'} <span style={{ fontWeight: 300, color: 'var(--text3)' }}>vs</span> {fixture.away_team || 'Away'}
        </h1>
        <div className="match-header-meta">
          {fixture.match_date && <span><Calendar size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />{fixture.match_date}</span>}
          {fixture.ground     && <span><MapPin   size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />{fixture.ground}</span>}
          {fixture.competition && <span><Trophy  size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />{fixture.competition}</span>}
        </div>
        <div className="match-result-line">
          {(() => {
            const r = computeManualResult(scorecards, fixture) || computeResult(scorecards, roles)
            if (r) return (
              <span className={`tag ${r.win === true ? 'tag-green' : r.win === false ? 'tag-red' : ''}`}>
                {r.label}
              </span>
            )
            if (fixture.result) return (
              <span className={`tag ${isWhcc(fixture.result) ? 'tag-green' : 'tag-red'}`}>
                {fixture.result}
              </span>
            )
            return null
          })()}
          {fixture.toss_winner && (
            <span className="toss-text">
              Toss: {fixture.toss_winner} · elected to {fixture.toss_decision}
            </span>
          )}
        </div>
        <div className="score-blocks">
          {(() => {
            const isManual = scorecards.some(sc => sc.isManual)
            if (isManual) {
              const whccTeam = isWhcc(fixture.home_team) ? fixture.home_team : fixture.away_team
              const oppTeam  = isWhcc(fixture.home_team) ? fixture.away_team : fixture.home_team
              return scorecards.map((sc, i) => {
                const label = sc.inningsOrder === 1 ? whccTeam : oppTeam
                const { runs, wickets, overs } = sc.totals
                return (
                  <div key={i} className="score-block">
                    <div className="score-label">{label}</div>
                    <div className="score-value">{runs}/{wickets}</div>
                    {overs && <div className="score-overs">({overs} ov)</div>}
                  </div>
                )
              })
            }
            return [
              { label: fixture.home_team, score: fixture.home_score, wkts: fixture.home_wickets, overs: fixture.home_overs },
              { label: fixture.away_team, score: fixture.away_score, wkts: fixture.away_wickets, overs: fixture.away_overs },
            ].filter(s => s.score).map((s, i) => (
              <div key={i} className="score-block">
                <div className="score-label">{s.label}</div>
                <div className="score-value">{s.score}{s.wkts ? `/${s.wkts}` : ' a/o'}</div>
                {s.overs && <div className="score-overs">({s.overs} ov)</div>}
              </div>
            ))
          })()}
        </div>

        {/* WHCC captain / WK for this match */}
        {(() => {
          const entries = Object.entries(roles || {})
          const battingEntry  = entries.find(([, v]) => isWhcc(v?.batting_team))
          const fieldingEntry = entries.find(([, v]) => !isWhcc(v?.batting_team))
          if (!battingEntry) return null
          return (
            <InningsRoles
              fixtureId={id}
              battingOrder={Number(battingEntry[0])}
              battingRolesData={battingEntry[1]}
              fieldingOrder={fieldingEntry ? Number(fieldingEntry[0]) : null}
              fieldingRolesData={fieldingEntry?.[1] ?? null}
              onRefresh={refreshRoles}
            />
          )
        })()}
      </div>

      {/* Innings — shown in sequence, traditional scorecard style */}
      {scorecards.map((sc, i) => {
        // Show only WHCC's table per innings: batting when WHCC batted, bowling when WHCC bowled
        const whccBatted = sc.isManual
          ? sc.inningsOrder === 1
          : roles != null ? isWhcc(roles[sc.inningsOrder]?.batting_team) : null
        const showBatting = whccBatted !== false
        const showBowling = whccBatted !== true

        return (
        <div key={i}>
          <h2 style={{ marginBottom: '0.75rem', paddingBottom: '0.4rem', borderBottom: '1px solid var(--border)' }}>
            {sc.isManual
              ? (sc.inningsOrder === 1 ? `${fixture.home_team || 'WHCC'} Batting` : 'WHCC Bowling')
              : (whccBatted ? 'WHCC Batting' : 'WHCC Bowling')}
          </h2>

          {/* Totals row */}
          <div className="stat-row" style={{ marginBottom: '0.75rem' }}>
            {(sc.isPairs ? [
              { label: 'Net Score', value: sc.totals.netTotal },
              { label: 'Raw',       value: sc.totals.runs },
              { label: 'Out',       value: sc.totals.wickets },
              { label: 'Overs',     value: sc.totals.overs },
            ] : [
              { label: 'Runs',    value: sc.totals.runs },
              { label: 'Wickets', value: sc.totals.wickets },
              { label: 'Overs',   value: sc.totals.overs },
              { label: 'Extras',  value: Object.values(sc.totals.extras||{}).reduce((a,b)=>a+b,0) },
            ]).map(s => (
              <div key={s.label} className="stat-box">
                <div className="label">{s.label}</div>
                <div className="value">{s.value}</div>
              </div>
            ))}
          </div>
          {sc.totals.extras && !sc.isManual && (
            <div style={{ fontSize: '0.82rem', color: 'var(--text2)', marginBottom: '1.25rem' }}>
              Extras: b {sc.totals.extras.byes} · lb {sc.totals.extras.legByes} · w {sc.totals.extras.wides} · nb {sc.totals.extras.noBalls}
            </div>
          )}
          {sc.isManual && sc.totals.extras && (sc.totals.extras.byes > 0 || sc.totals.extras.legByes > 0) && (
            <div style={{ fontSize: '0.82rem', color: 'var(--text2)', marginBottom: '1.25rem' }}>
              {sc.totals.extras.byes > 0 && `b ${sc.totals.extras.byes}`}
              {sc.totals.extras.byes > 0 && sc.totals.extras.legByes > 0 && ' · '}
              {sc.totals.extras.legByes > 0 && `lb ${sc.totals.extras.legByes}`}
            </div>
          )}

          {showBatting && <>
            <h3>Batting</h3>
            <BattingTable batting={sc.batting} navigate={navigate} isPairs={sc.isPairs} dn={dn} />
          </>}

          {showBowling && <>
            <h3 style={{ marginTop: showBatting ? '1.25rem' : 0 }}>Bowling</h3>
            <BowlingTable bowling={sc.bowling} navigate={navigate} isManual={sc.isManual} dn={dn} />
          </>}

          {/* Over-by-over — expandable, only for ingested matches */}
          {!sc.isManual && (
            <div style={{ marginTop: '1rem', marginBottom: '2rem' }}>
              <button className="secondary" style={{ fontSize: '0.82rem', padding: '4px 12px' }}
                onClick={() => toggleOvers(i)}>
                {expandedOvers[i] ? '▲ Hide overs' : '▼ Show over-by-over'}
              </button>
              {expandedOvers[i] && (
                <div style={{ marginTop: '1rem' }}>
                  <OversGrid overs={sc.overs} dn={dn} />
                </div>
              )}
            </div>
          )}
        </div>
        )
      })}

      {/* Dismissal analysis — across all innings */}
      {scorecards.some(sc => Object.keys(sc.dismissalMethods||{}).length > 0) && (
        <div>
          <h2 style={{ marginBottom: '1rem' }}>Dismissals</h2>
          {scorecards.map((sc, i) => (
            Object.keys(sc.dismissalMethods||{}).length > 0 && (
              <div key={i} className="card" style={{ marginBottom: '1rem' }}>
                <h3>{ordinals[i] || `${i+1}th`} Innings</h3>
                <DismissalSummary methods={sc.dismissalMethods} catches={sc.catches} dn={dn} />
              </div>
            )
          ))}
        </div>
      )}
    </div>
  )
}

function InningsRoles({ fixtureId, battingOrder, battingRolesData, fieldingOrder, fieldingRolesData, onRefresh }) {
  const [saving, setSaving]           = useState(false)
  const [addWkPlayer, setAddWkPlayer] = useState('')
  const [addWkFrom, setAddWkFrom]     = useState('')
  const [addWkTo, setAddWkTo]         = useState('')
  const [wkError, setWkError]         = useState('')
  const apiFetch = useApiFetch()

  if (!battingRolesData) return null

  // Captain from the WHCC batting innings; WK from the WHCC fielding innings
  const { captain_player_id, players } = battingRolesData
  const wk_stints = fieldingRolesData?.wk_stints ?? []
  const wk_errors = fieldingRolesData?.wk_errors ?? []

  const allRoleNames = players.map(p => p.name)
  const dn = name => displayName(name, allRoleNames)

  async function setCaptain(player_id) {
    if (!player_id) return
    setSaving(true)
    await apiFetch(`/api/matches/${fixtureId}/captain`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ innings_order: battingOrder, player_id: Number(player_id) })
    })
    onRefresh()
    setSaving(false)
  }

  async function addWk() {
    if (!addWkPlayer || !addWkFrom || fieldingOrder == null) return
    setWkError('')
    setSaving(true)
    const body = { innings_order: fieldingOrder, player_id: Number(addWkPlayer), from_over: Number(addWkFrom) }
    if (addWkTo) body.to_over = Number(addWkTo)
    const r = await apiFetch(`/api/matches/${fixtureId}/wk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (r.ok) {
      setAddWkPlayer(''); setAddWkFrom(''); setAddWkTo('')
      onRefresh()
    } else {
      const { error } = await r.json()
      setWkError(error || 'Failed to save')
    }
    setSaving(false)
  }

  async function deleteWk(wkId) {
    setSaving(true)
    await apiFetch(`/api/matches/${fixtureId}/wk/${wkId}`, { method: 'DELETE' })
    onRefresh()
    setSaving(false)
  }

  async function deleteError(errorId) {
    setSaving(true)
    await apiFetch(`/api/matches/${fixtureId}/wk-error/${errorId}`, { method: 'DELETE' })
    onRefresh()
    setSaving(false)
  }

  const playerName = (pid) => dn(players.find(p => p.player_id === pid)?.name ?? `#${pid}`)

  async function setEndOver(wkId, to_over) {
    setSaving(true)
    const r = await apiFetch(`/api/matches/${fixtureId}/wk/${wkId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_over: to_over ? Number(to_over) : null })
    })
    if (!r.ok) {
      const { error } = await r.json()
      setWkError(error || 'Failed to update')
    } else {
      onRefresh()
    }
    setSaving(false)
  }

  return (
    <div className="innings-roles">
      <div className="role-col">
        <div className="role-col-label">Captain</div>
        <select className="role-select" value={captain_player_id ?? ''} onChange={e => setCaptain(e.target.value)} disabled={saving}>
          <option value="">— unset —</option>
          {players.map(p => <option key={p.player_id} value={p.player_id}>{dn(p.name)}</option>)}
        </select>
      </div>

      <div className="role-col">
        <div className="role-col-label">Wicket keeper</div>
        {wk_stints.map(stint => (
          <div key={stint.id} className="wk-stint">
            <span className="wk-stint-name">{playerName(stint.player_id)}</span>
            <span className="dim wk-stint-meta">ov {stint.from_over}–<input
              type="number" min={stint.from_over} placeholder="end"
              className="role-input-over"
              defaultValue={stint.to_over ?? ''}
              onBlur={e => setEndOver(stint.id, e.target.value || null)}
              disabled={saving} title="End over"
            /></span>
            {stint.byes > 0 && <span className="dim wk-stint-meta">{stint.byes}b</span>}
            <button className="icon-btn danger" onClick={() => deleteWk(stint.id)} disabled={saving} title="Remove"><X size={12} /></button>
            {wk_errors.filter(e => e.player_id === stint.player_id).map(err => (
              <span key={err.id} className="error-tag">
                {err.error_type === 'dropped_catch' ? 'dropped' : 'missed stumping'}
                <button className="icon-btn" onClick={() => deleteError(err.id)} disabled={saving}><X size={12} /></button>
              </span>
            ))}
          </div>
        ))}
        <div className="wk-add-row">
          <select className="role-select" value={addWkPlayer} onChange={e => setAddWkPlayer(e.target.value)} disabled={saving}>
            <option value="">— player —</option>
            {players.map(p => <option key={p.player_id} value={p.player_id}>{dn(p.name)}</option>)}
          </select>
          <input type="number" min="1" placeholder="from ov" className="role-input-over" value={addWkFrom} onChange={e => { setAddWkFrom(e.target.value); setWkError('') }} disabled={saving} />
          <input type="number" min="1" placeholder="to ov"   className="role-input-over" value={addWkTo}   onChange={e => { setAddWkTo(e.target.value);   setWkError('') }} disabled={saving} />
          <button className="secondary" style={{ fontSize: '0.82rem', padding: '4px 10px' }} onClick={addWk} disabled={saving || !addWkPlayer || !addWkFrom}>Add</button>
        </div>
        {wkError && <div style={{ color: 'var(--red)', fontSize: '0.8rem', marginTop: 4 }}>{wkError}</div>}
      </div>
    </div>
  )
}

function formatDismissalDesc(type, fielder, bowler) {
  const f = fielder, b = bowler
  switch (type) {
    case 'Caught':          return (f && b) ? `ct ${f} b ${b}` : (b ? `caught b ${b}` : 'caught')
    case 'CaughtAndBowled': return b ? `c&b ${b}` : 'c&b'
    case 'Bowled':          return b ? `b ${b}` : 'bowled'
    case 'LBW':             return b ? `lbw b ${b}` : 'lbw'
    case 'Stumped':         return (f && b) ? `st ${f} b ${b}` : 'stumped'
    case 'RunOut':
    case 'Run out':         return f ? `run out (${f})` : 'run out'
    default:                return type || 'out'
  }
}

function BattingTable({ batting, navigate, isPairs, dn = x => x }) {
  if (!batting.length) return <div className="empty">No batting data</div>
  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>Batter</th>
            {isPairs ? <>
              <th className="num">R</th>
              <th className="num">Out</th>
              <th className="num">Net</th>
              <th className="num">B</th>
            </> : <>
              <th>How out</th>
              <th className="num">R</th>
              <th className="num">B</th>
              <th className="num">4s</th>
              <th className="num">6s</th>
              <th className="num">SR</th>
            </>}
          </tr>
        </thead>
        <tbody>
          {batting.map(b => (
            <tr key={b.player_id} style={b.did_not_bat ? { opacity: 0.45 } : {}}>
              <td className="bold">
                <span className="player-link" onClick={() => navigate(`/player/${b.player_id}`)}>{dn(b.name)}</span>
              </td>
              {isPairs ? <>
                <td className="num bold">{b.did_not_bat ? '–' : b.runs}</td>
                <td className="num">{b.did_not_bat ? '–' : b.timesOut}</td>
                <td className={`num bold ${b.netScore < 0 ? 'dismissed' : ''}`}>{b.did_not_bat ? '–' : b.netScore}</td>
                <td className="num dim">{b.did_not_bat ? '–' : b.balls}</td>
              </> : <>
                <td className={b.did_not_bat ? 'muted' : b.dismissed ? 'dismissed' : 'dim'} style={{ fontSize: '0.82rem' }}>
                  {'dismissalFielder' in b
                    ? formatDismissalDesc(b.dismissalType, dn(b.dismissalFielder), dn(b.dismissalBowler))
                    : (b.dismissalDesc || (b.dismissed ? 'out' : 'not out'))}
                </td>
                <td className="num bold">{b.did_not_bat ? '–' : b.runs}</td>
                <td className="num dim">{b.did_not_bat ? '–' : b.balls}</td>
                <td className="num">{b.did_not_bat ? '' : b.fours}</td>
                <td className="num">{b.did_not_bat ? '' : b.sixes}</td>
                <td className="num dim">{b.did_not_bat || b.balls === 0 ? '–' : ((b.runs/b.balls)*100).toFixed(0)}</td>
              </>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BowlingTable({ bowling, navigate, isManual, dn = x => x }) {
  if (!bowling.length) return <div className="empty">No bowling data</div>
  const rows = isManual ? bowling : [...bowling].sort((a,b) => b.wickets - a.wickets || a.runs - b.runs)
  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>Bowler</th>
            <th className="num">O</th>
            <th className="num">M</th>
            <th className="num">R</th>
            <th className="num">W</th>
            <th className="num">Wd</th>
            <th className="num">NB</th>
            <th className="num">Econ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(b => (
            <tr key={b.player_id}>
              <td className="bold">
                <span className="player-link" onClick={() => navigate(`/player/${b.player_id}`)}>{dn(b.name)}</span>
              </td>
              <td className="num">{b.overs}</td>
              <td className="num">{b.maidens}</td>
              <td className="num">{b.runs}</td>
              <td className={`num ${b.wickets > 0 ? 'bold' : ''}`}>{b.wickets}</td>
              <td className="num dim">{b.wides}</td>
              <td className="num dim">{b.noBalls}</td>
              <td className="num dim">{b.economy || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function OversGrid({ overs, dn = x => x }) {
  if (!overs.length) return <div className="empty">No over data</div>
  return (
    <div className="over-grid">
      {overs.map(o => (
        <div key={o.over} className="over-cell">
          <div className="over-header">
            <span className="over-num">Over {o.over}</span>
            <span className="over-runs">
              {o.runs}
              {o.wickets > 0 && <span style={{ color: 'var(--red)', marginLeft: 3 }}>·{o.wickets}W</span>}
            </span>
          </div>
          <div className="over-balls">
            {o.balls.map((b, i) => <BallCircle key={i} ball={b} />)}
          </div>
          <div className="over-bowler">{dn(o.bowler)}</div>
        </div>
      ))}
    </div>
  )
}

function StumpsIcon({ size = 24 }) {
  const s = size, mid = s / 2, gap = s * 0.22, h = s * 0.68, bailY = s * 0.18, bailLen = s * 0.14
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none" stroke="currentColor" strokeWidth={s * 0.1} strokeLinecap="round">
      <line x1={mid - gap} y1={bailY} x2={mid - gap} y2={bailY + h} />
      <line x1={mid}       y1={bailY} x2={mid}       y2={bailY + h} />
      <line x1={mid + gap} y1={bailY} x2={mid + gap} y2={bailY + h} />
      <line x1={mid - gap - bailLen} y1={bailY + s * 0.06} x2={mid}                 y2={bailY} />
      <line x1={mid}                 y1={bailY}             x2={mid + gap + bailLen} y2={bailY + s * 0.06} />
    </svg>
  )
}

const DISMISSAL_ICONS = {
  'Bowled': StumpsIcon, 'Caught': Hand, 'CaughtAndBowled': HandCoins,
  'LBW': ShieldAlert, 'Run out': Zap, 'RunOut': Zap, 'Stumped': Lock, 'Other': HelpCircle,
}
function formatDismissalLabel(type) {
  if (type === 'CaughtAndBowled') return 'Caught and Bowled'
  if (type === 'RunOut') return 'Run out'
  return type
}

function DismissalSummary({ methods, catches, dn = x => x }) {
  return (
    <div>
      <div className="dismissal-grid">
        {Object.entries(methods||{}).sort((a,b)=>b[1]-a[1]).map(([type, count]) => {
          const Icon = DISMISSAL_ICONS[type] || HelpCircle
          return (
            <div key={type} className="dismissal-item">
              <span style={{ display: 'flex', justifyContent: 'center' }}><Icon size={18} /></span>
              <span className="dismissal-count">{count}</span>
              <span className="dim">{formatDismissalLabel(type)}</span>
            </div>
          )
        })}
      </div>
      {Object.keys(catches||{}).length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h3>Catches</h3>
          <table style={{ width: 'auto' }}>
            <thead><tr><th>Fielder</th><th className="num">Catches</th></tr></thead>
            <tbody>
              {Object.entries(catches).sort((a,b)=>b[1]-a[1]).map(([name, count]) => (
                <tr key={name}><td>{dn(name)}</td><td className="num bold">{count}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
