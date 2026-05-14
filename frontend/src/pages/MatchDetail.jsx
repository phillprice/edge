import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { Calendar, MapPin, Trophy, ChevronLeft, Pencil, X, Hand, HandCoins, ShieldAlert, Zap, Lock, HelpCircle, Award, Flag } from 'lucide-react'
import { BarChart, Bar, LabelList, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useApiFetch } from '../hooks/useApiFetch'
import { dn, displayName, shortTeam } from '../utils/cricket'

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
          {shortTeam(fixture.home_team) || 'Home'} <span style={{ fontWeight: 300, color: 'var(--text3)' }}>vs</span> {shortTeam(fixture.away_team) || 'Away'}
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
                {shortTeam(r.label)}
              </span>
            )
            if (fixture.result) return (
              <span className={`tag ${isWhcc(fixture.result) ? 'tag-green' : 'tag-red'}`}>
                {shortTeam(fixture.result)}
              </span>
            )
            return null
          })()}
          {fixture.toss_winner && (
            <span className="toss-text">
              Toss: {shortTeam(fixture.toss_winner)} · elected to {fixture.toss_decision}
            </span>
          )}
        </div>
        <div className="score-blocks">
          {(() => {
            const isManual = scorecards.some(sc => sc.isManual)
            const isPairs  = scorecards.some(sc => sc.isPairs)
            if (isManual || isPairs) {
              const whccTeam = shortTeam(isWhcc(fixture.home_team) ? fixture.home_team : fixture.away_team)
              const oppTeam  = shortTeam(isWhcc(fixture.home_team) ? fixture.away_team : fixture.home_team)
              return scorecards.map((sc, i) => {
                const teamLabel = isPairs && !isManual
                  ? shortTeam(roles?.[sc.inningsOrder]?.batting_team || (sc.inningsOrder === 1 ? fixture.home_team : fixture.away_team))
                  : (sc.inningsOrder === 1 ? whccTeam : oppTeam)
                const { runs, wickets, overs, netTotal } = sc.totals
                return (
                  <div key={i} className="score-block">
                    <div className="score-label">{teamLabel}</div>
                    {isPairs
                      ? <div className="score-value">{netTotal != null ? netTotal : runs}</div>
                      : <div className="score-value">{runs}/{wickets}</div>
                    }
                    {overs && <div className="score-overs">({overs} ov)</div>}
                  </div>
                )
              })
            }
            return [
              { label: shortTeam(fixture.home_team), score: fixture.home_score, wkts: fixture.home_wickets, overs: fixture.home_overs },
              { label: shortTeam(fixture.away_team), score: fixture.away_score, wkts: fixture.away_wickets, overs: fixture.away_overs },
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

      <MatchCharts scorecards={scorecards} roles={roles} fixture={fixture} />
      <MatchFlow scorecards={scorecards} roles={roles} dn={dn} isWhcc={isWhcc} />
      {data.mvp?.length > 0 && <MvpCard mvp={data.mvp} meta={data.mvpMeta} dn={dn} />}

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
            {!sc.isPairs && Object.entries(sc.dismissalMethods || {}).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
              const Icon = DISMISSAL_ICONS[type] || HelpCircle
              return (
                <div key={type} className="stat-box">
                  <div className="label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                    <Icon size={11} />{formatDismissalLabel(type)}
                  </div>
                  <div className="value">{count}</div>
                </div>
              )
            })}
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

    </div>
  )
}

// ── Charts ───────────────────────────────────────────────────────────────────

function MatchCharts({ scorecards, roles, fixture }) {
  const [tab, setTab] = useState('manhattan')
  const [netWorm, setNetWorm] = useState(true)
  const charted = scorecards.filter(sc => !sc.isManual && sc.overs?.length > 0)
  if (charted.length === 0) return null
  const hasPairs = charted.some(sc => sc.isPairs)
  const startingScore = fixture?.starting_score || 0

  const getColor = sc => {
    if (!sc) return '#3E14BA'
    const team = roles?.[sc.inningsOrder]?.batting_team
    return isWhcc(team) ? '#690028' : '#3E14BA'
  }
  const getLabel = sc => {
    if (!sc) return ''
    const team = roles?.[sc.inningsOrder]?.batting_team
    if (!team) return `Inn ${sc.inningsOrder}`
    return shortTeam(team)
  }

  const maxOver = Math.max(...charted.flatMap(sc => sc.overs.map(o => o.over)))

  const manhattanData = Array.from({ length: maxOver }, (_, i) => {
    const over = i + 1
    const row = { over }
    for (const sc of charted) {
      const o = sc.overs.find(x => x.over === over)
      row[`inn${sc.inningsOrder}`] = o ? o.runs : undefined
      row[`wkt${sc.inningsOrder}`] = o ? o.wickets : 0
    }
    return row
  })

  const wormData = (() => {
    const overNums = [...new Set([0, ...charted.flatMap(sc => sc.overs.map(o => o.over))])].sort((a, b) => a - b)
    return overNums.map(over => {
      const row = { over }
      for (const sc of charted) {
        const cumRuns = sc.overs.filter(o => o.over <= over).reduce((s, o) => s + o.runs, 0)
        const cumWkts = sc.overs.filter(o => o.over <= over).reduce((s, o) => s + o.wickets, 0)
        row[`inn${sc.inningsOrder}`] = (sc.isPairs && netWorm)
          ? startingScore + cumRuns - cumWkts * 5
          : cumRuns
        const o = sc.overs.find(x => x.over === over)
        row[`wkt${sc.inningsOrder}`] = o?.wickets || 0
      }
      return row
    })
  })()

  const makeWicketDots = (sc) => (labelProps) => {
    const { x, y, width, index } = labelProps
    const row = manhattanData[index]
    const wkts = row?.[`wkt${sc.inningsOrder}`] || 0
    if (!wkts || row?.[`inn${sc.inningsOrder}`] == null) return null
    return (
      <g>
        {Array.from({ length: wkts }, (_, i) => (
          <circle key={i} cx={x + width / 2} cy={y - 5 - i * 8} r={3} fill="#ff69b4" />
        ))}
      </g>
    )
  }

  const makeWormDot = (sc) => (props) => {
    const { cx, cy, payload } = props
    if (!payload || !payload[`wkt${sc.inningsOrder}`]) return null
    return <circle key={`wdot-${sc.inningsOrder}-${props.index}`} cx={cx} cy={cy} r={4} fill="#ff69b4" stroke="#fff" strokeWidth={1.5} />
  }

  const axisStyle = { fontSize: 11, fill: 'var(--text2)' }
  const gridProps = { strokeDasharray: '3 3', stroke: 'var(--border)' }

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
        {['manhattan', 'worm'].map(t => (
          <button key={t} onClick={() => setTab(t)} className={tab !== t ? 'secondary' : ''} style={{ fontSize: '0.82rem', padding: '4px 12px', textTransform: 'capitalize' }}>{t}</button>
        ))}
      </div>

      {tab === 'manhattan' && (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={manhattanData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }} barCategoryGap="20%">
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="over" tick={axisStyle} />
            <YAxis tick={axisStyle} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                return (
                  <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: '0.82rem' }}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>Over {label}</div>
                    {payload.filter(p => p.value != null).map(p => {
                      const sc = charted.find(s => `inn${s.inningsOrder}` === p.dataKey)
                      const wkts = manhattanData.find(d => d.over === label)?.[`wkt${sc?.inningsOrder}`] || 0
                      return <div key={p.dataKey} style={{ color: p.fill }}>{getLabel(sc)}: {p.value} runs{wkts > 0 ? ` · ${wkts}W` : ''}</div>
                    })}
                  </div>
                )
              }}
            />
            {charted.length > 1 && <Legend formatter={(_, entry) => getLabel(charted.find(sc => `inn${sc.inningsOrder}` === entry.dataKey))} />}
            {charted.map(sc => (
              <Bar key={sc.inningsOrder} dataKey={`inn${sc.inningsOrder}`} name={getLabel(sc)} fill={getColor(sc)} radius={[2, 2, 0, 0]}>
                <LabelList content={makeWicketDots(sc)} />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}

      {tab === 'worm' && (
        <>
        {hasPairs && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {[{ v: true, label: 'Net' }, { v: false, label: 'Raw' }].map(({ v, label }) => (
              <button key={label} onClick={() => setNetWorm(v)} className={netWorm !== v ? 'secondary' : ''} style={{ fontSize: '0.78rem', padding: '2px 10px' }}>{label}</button>
            ))}
          </div>
        )}
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={wormData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="over" tick={axisStyle} />
            <YAxis tick={axisStyle} domain={(hasPairs && netWorm) ? ['auto', 'auto'] : [0, 'auto']} />
            <Tooltip formatter={(v, key) => {
              const sc = charted.find(s => `inn${s.inningsOrder}` === key)
              return [v, getLabel(sc)]
            }} />
            {charted.length > 1 && <Legend formatter={(_, entry) => getLabel(charted.find(sc => `inn${sc.inningsOrder}` === entry.dataKey))} />}
            {charted.map(sc => (
              <Line key={sc.inningsOrder} type="monotone" dataKey={`inn${sc.inningsOrder}`} stroke={getColor(sc)} strokeWidth={2} dot={makeWormDot(sc)} activeDot={{ r: 4 }} name={getLabel(sc)} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        </>
      )}
    </div>
  )
}

// ── Match flow ────────────────────────────────────────────────────────────────

const FLOW_ICONS = {
  team_milestone:   { Icon: Trophy,     cls: 'flow-team-milestone' },
  batter_milestone: { imgSrc: '/cricket-bat.png', cls: 'flow-batter' },
  wicket:           { Icon: null,       cls: 'flow-wicket' },
  pairs_out:        { Icon: null,       cls: 'flow-wicket' },
  bowler_haul:      { Icon: Award,      cls: 'flow-haul' },
  innings_end:      { Icon: Flag,       cls: 'flow-end' },
}

function ordSuffix(n) {
  if (n === 1) return '1st'; if (n === 2) return '2nd'; if (n === 3) return '3rd'; return `${n}th`
}

function dismissalShortDesc(method, fielder, bowler, dn) {
  const f = fielder ? dn(fielder) : null
  const b = bowler  ? dn(bowler)  : null
  switch (method) {
    case 'Caught':          return f && b ? `ct ${f} b ${b}` : b ? `c&b ${b}` : 'caught'
    case 'CaughtAndBowled': return b ? `c&b ${b}` : 'c&b'
    case 'Bowled':          return b ? `b ${b}` : 'bowled'
    case 'LBW':             return b ? `lbw b ${b}` : 'lbw'
    case 'Stumped':         return f && b ? `st ${f} b ${b}` : b ? `st b ${b}` : 'stumped'
    case 'RunOut':          return f ? `run out (${f})` : 'run out'
    default:                return b ? `b ${b}` : 'out'
  }
}

function FlowEvent({ event, dn, isWhccBatting }) {
  const meta = FLOW_ICONS[event.type] || {}
  const { Icon, imgSrc, cls = '' } = meta

  let text
  if (event.type === 'powerplay') {
    text = `Powerplay: ${event.score}/${event.wickets} after 6 overs`
  } else if (event.type === 'team_milestone') {
    text = `${event.runs} up — ${event.wickets} down — ov ${event.over}`
  } else if (event.type === 'batter_milestone') {
    text = `${dn(event.player)} ${event.runs}${event.runs >= 50 ? '!' : ''} (${event.balls} balls) — ov ${event.over}`
  } else if (event.type === 'wicket') {
    if (isWhccBatting) {
      // WHCC batting — show our batter's dismissal prominently
      const parts = [`${dn(event.player)} out for ${event.runs}`]
      if (event.bowler) parts.push(`b ${dn(event.bowler)}`)
      parts.push(`${ordSuffix(event.wickets)} wkt for ${event.score}`)
      if (event.partnership > 0) parts.push(`partnership ${event.partnership}`)
      parts.push(`ov ${event.over}`)
      text = parts.join(' · ')
    } else {
      // Opposition batting — lead with our player's dismissal, batter name secondary
      const disDesc = dismissalShortDesc(event.dismissalMethod, event.fielder, event.bowler, dn)
      const parts = [disDesc, `${ordSuffix(event.wickets)} wkt for ${event.score}`]
      if (event.partnership > 0) parts.push(`p'ship ${event.partnership}`)
      parts.push(`ov ${event.over}`)
      text = parts.join(' · ')
    }
  } else if (event.type === 'bowler_haul') {
    text = `${dn(event.player)} takes ${ordSuffix(event.wickets)} wicket — ov ${event.over}`
  } else if (event.type === 'pairs_out') {
    if (isWhccBatting) {
      text = `${dn(event.player)} out — ${ordSuffix(event.wickets)} dismissal · ${event.score} raw · ov ${event.over}`
    } else {
      const disDesc = dismissalShortDesc(event.dismissalMethod, event.fielder, event.bowler, dn)
      text = `${disDesc} — ${ordSuffix(event.wickets)} dismissal · ${event.score} raw · ov ${event.over}`
    }
  } else if (event.type === 'innings_end') {
    text = event.netScore != null
      ? `Innings ends: ${event.score} raw · ${event.wickets} out · net ${event.netScore} (${event.overs} overs)`
      : `Innings ends: ${event.score}/${event.wickets} (${event.overs} overs)`
  }

  return (
    <div className={`flow-event ${cls}`}>
      <span className="flow-icon">{imgSrc ? <img src={imgSrc} style={{ width: 13, height: 13, objectFit: 'contain' }} alt="" /> : Icon ? <Icon size={13} /> : <span className="flow-dot" />}</span>
      <span className="flow-text">{text}</span>
    </div>
  )
}

function MatchFlow({ scorecards, roles, dn, isWhcc }) {
  const flowScs = scorecards.filter(sc => sc.flow?.length > 1)
  if (!flowScs.length) return null

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.75rem' }}>Match flow</h3>
      {flowScs.map((sc, idx) => {
        const team = roles?.[sc.inningsOrder]?.batting_team
        const isWhccBatting = team ? isWhcc(team) : sc.isManual ? sc.inningsOrder === 1 : true
        return (
          <div key={sc.inningsOrder} style={idx > 0 ? { marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border)' } : {}}>
            {flowScs.length > 1 && (
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text2)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                {team ? shortTeam(team) : `Innings ${sc.inningsOrder}`} batting
              </div>
            )}
            <div className="flow-list">
              {sc.flow.map((event, j) => <FlowEvent key={j} event={event} dn={dn} isWhccBatting={isWhccBatting} />)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── MVP ───────────────────────────────────────────────────────────────────────

function MvpCard({ mvp, meta, dn }) {
  const [showFormula, setShowFormula] = useState(false)
  if (!mvp?.length) return null
  const wv       = meta?.wicketVal        ?? 1.8
  const mpw      = meta?.maidensPerWicket ?? 2
  const srPct    = meta?.srPct            ?? 0.08
  const teamSR   = meta?.teamSR           ?? null
  const matchType = meta?.matchType       ?? 'T20'
  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.75rem' }}>Match MVP</h3>
      {mvp.slice(0, 3).map((p, i) => (
        <div key={p.playerId} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 0', borderBottom: i < Math.min(mvp.length, 3) - 1 ? '1px solid var(--border)' : 'none' }}>
          <span style={{ width: 18, fontWeight: 700, color: i === 0 ? '#f9a825' : 'var(--text3)', fontSize: '0.9rem' }}>{i + 1}</span>
          <span style={{ flex: 1, fontWeight: i === 0 ? 600 : 400 }}>{dn(p.name)}</span>
          <span className={`tag ${i === 0 ? 'tag-green' : ''}`} style={{ minWidth: 52, textAlign: 'center' }}>{p.total} pts</span>
          <span style={{ fontSize: '0.78rem', color: 'var(--text2)', minWidth: 120, textAlign: 'right' }}>
            {[p.bat > 0 && `bat ${p.bat}`, p.bowl > 0 && `bowl ${p.bowl}`, p.field > 0 && `field ${p.field}`].filter(Boolean).join(' · ')}
          </span>
        </div>
      ))}
      <div style={{ marginTop: '0.75rem' }}>
        <button
          onClick={() => setShowFormula(v => !v)}
          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text3)' }}
        >
          {showFormula ? '▲' : '▼'} How is this calculated?
        </button>
        {showFormula && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text3)', lineHeight: 1.7 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0.5rem' }}>
              <thead>
                <tr style={{ color: 'var(--text3)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', fontWeight: 400, paddingBottom: 4 }}>Player</th>
                  <th style={{ textAlign: 'right', fontWeight: 400 }}>Bat</th>
                  <th style={{ textAlign: 'right', fontWeight: 400 }}>SR</th>
                  <th style={{ textAlign: 'right', fontWeight: 400 }}>SR+</th>
                  <th style={{ textAlign: 'right', fontWeight: 400 }}>Bowl</th>
                  <th style={{ textAlign: 'right', fontWeight: 400 }}>Haul+</th>
                  <th style={{ textAlign: 'right', fontWeight: 400 }}>Mdn+</th>
                  <th style={{ textAlign: 'right', fontWeight: 400 }}>Field</th>
                  <th style={{ textAlign: 'right', fontWeight: 600 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {mvp.map((p, i) => (
                  <tr key={p.playerId} style={{ borderBottom: i < mvp.length - 1 ? '1px solid var(--border)' : 'none', opacity: i >= 3 ? 0.7 : 1 }}>
                    <td style={{ paddingRight: 8, paddingTop: 2, paddingBottom: 2 }}>{dn(p.name)}</td>
                    <td style={{ textAlign: 'right' }}>{p.batBase > 0 ? p.batBase : '—'}</td>
                    <td style={{ textAlign: 'right', color: p.batSR != null && teamSR != null && p.batSR > teamSR ? 'var(--green)' : 'inherit' }}>
                      {p.batSR != null ? p.batSR : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--green)' }}>
                      {p.batSRBonus > 0 ? `+${p.batSRBonus}` : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>{p.bowl > 0 ? +(p.bowl - p.bowlHaulBonus - p.bowlMaidenBonus).toFixed(1) : '—'}</td>
                    <td style={{ textAlign: 'right', color: 'var(--green)' }}>
                      {p.bowlHaulBonus > 0 ? `+${p.bowlHaulBonus}` : '—'}
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--green)' }}>
                      {p.bowlMaidenBonus > 0 ? `+${p.bowlMaidenBonus}` : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>{p.field > 0 ? p.field : '—'}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text1)' }}>{p.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.4rem' }}>
              <div><strong>Batting</strong> · 10 runs = 1 pt{teamSR != null ? ` · team SR: ${teamSR}` : ''} · SR bonus: base pts × (yourSR ÷ teamSR − 1) × {Math.round(srPct * 100)}% when faster than team</div>
              <div><strong>Bowling</strong> · {wv} pts/wkt ({matchType}) · 3-fer +0.5, 5-fer +1.0 · {+(wv / mpw).toFixed(2)} pts/maiden</div>
              <div><strong>Fielding</strong> · {+(wv * 0.2).toFixed(2)} pts per catch or stumping</div>
              <div style={{ marginTop: '0.2rem' }}>
                Based on the{' '}
                <a href="https://blog.cricheroes.com/most-valuable-player-mvp-by-cricheroes/" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                  CricHeroes MVP algorithm
                </a>
              </div>
            </div>
          </div>
        )}
      </div>
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

  async function setFirstWk() {
    if (!addWkPlayer || fieldingOrder == null) return
    setWkError('')
    setSaving(true)
    const r = await apiFetch(`/api/matches/${fixtureId}/wk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ innings_order: fieldingOrder, player_id: Number(addWkPlayer), from_over: 1 })
    })
    if (r.ok) { setAddWkPlayer(''); onRefresh() }
    else { const d = await r.json(); setWkError(d.error || 'Failed to save') }
    setSaving(false)
  }

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
            {stint.from_over > 1 && <span className="dim wk-stint-meta">from ov {stint.from_over}</span>}
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
          {wk_stints.length > 0 && (
            <input type="number" min="2" placeholder="changed from ov" className="role-input-over" style={{ width: '7rem' }}
              value={addWkFrom} onChange={e => { setAddWkFrom(e.target.value); setWkError('') }} disabled={saving} />
          )}
          <button className="secondary" style={{ fontSize: '0.82rem', padding: '4px 10px' }}
            onClick={wk_stints.length === 0 ? setFirstWk : addWk}
            disabled={saving || !addWkPlayer || (wk_stints.length > 0 && !addWkFrom)}>
            {wk_stints.length === 0 ? 'Set' : 'Changed'}
          </button>
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

function spellFigures(spell) {
  const overs = Math.floor(spell.balls / 6)
  const rem   = spell.balls % 6
  const oversStr = rem > 0 ? `${overs}.${rem}` : String(overs)
  return `${oversStr}-${spell.maidens}-${spell.runs}-${spell.wickets}`
}

function BowlingTable({ bowling, navigate, isManual, dn = x => x }) {
  const [expandedSpells, setExpandedSpells] = useState({})
  if (!bowling.length) return <div className="empty">No bowling data</div>
  const rows = isManual ? bowling : [...bowling].sort((a,b) => b.wickets - a.wickets || a.runs - b.runs)

  function toggleSpells(playerId) {
    setExpandedSpells(prev => ({ ...prev, [playerId]: !prev[playerId] }))
  }

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
          {rows.map(b => {
            const hasMultipleSpells = b.spells?.length > 1
            const isExpanded = !!expandedSpells[b.player_id]
            return (
              <>
                <tr key={b.player_id}>
                  <td className="bold">
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="player-link" onClick={() => navigate(`/player/${b.player_id}`)}>{dn(b.name)}</span>
                      {hasMultipleSpells && (
                        <button
                          onClick={() => toggleSpells(b.player_id)}
                          style={{ background: 'none', border: 'none', padding: '0 2px', cursor: 'pointer', fontSize: '0.7rem', color: 'var(--text3)', lineHeight: 1 }}
                          title={isExpanded ? 'Hide spells' : 'Show spell breakdown'}
                        >
                          {isExpanded ? '▼' : '▶'}
                        </button>
                      )}
                    </span>
                  </td>
                  <td className="num">{b.overs}</td>
                  <td className="num">{b.maidens}</td>
                  <td className="num">{b.runs}</td>
                  <td className={`num ${b.wickets > 0 ? 'bold' : ''}`}>{b.wickets}</td>
                  <td className="num dim">{b.wides}</td>
                  <td className="num dim">{b.noBalls}</td>
                  <td className="num dim">{b.economy || '–'}</td>
                </tr>
                {hasMultipleSpells && isExpanded && b.spells.map((spell, idx) => (
                  <tr key={`${b.player_id}-spell-${idx}`} style={{ background: 'var(--bg2, var(--bg))' }}>
                    <td colSpan={8} style={{ paddingLeft: '1.5rem', fontSize: '0.78rem', color: 'var(--text3)', paddingTop: 2, paddingBottom: 2 }}>
                      Spell {idx + 1}: overs {spell.from_over + 1}{spell.from_over !== spell.to_over ? `–${spell.to_over + 1}` : ''} &nbsp; {spellFigures(spell)}
                    </td>
                  </tr>
                ))}
              </>
            )
          })}
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
