import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { Calendar, MapPin, Trophy, ChevronLeft, Pencil, X, Hand, HandCoins, ShieldAlert, Lock, HelpCircle, Award, Flag, RefreshCw, ExternalLink, Trash2 } from 'lucide-react'
import { BarChart, Bar, LabelList, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useApiFetch } from '../hooks/useApiFetch'
import { dn, displayName, shortTeam, isWhccTeam as isWhcc } from '../utils/cricket'
import { Skeleton, SkeletonRow } from '../components/Skeleton'


const CHART_COLOURS_LIGHT = { whcc: '#690028', opp: '#3E14BA' }
const CHART_COLOURS_DARK  = { whcc: '#ff5252', opp: '#82b1ff' }
function getIsDark() {
  const attr = document.documentElement.getAttribute('data-theme')
  if (attr === 'dark') return true
  if (attr === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

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
  // max wickets = first-innings batter count - 1 (fall back to 10 for manual matches)
  const maxWickets = sc1.batting.length > 0 ? sc1.batting.length - 1 : 10

  if (wr > or) {
    if (!whccFirst) {
      const n = maxWickets - ww
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
    const n = maxWickets - ow
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
  const [bowlingView, setBowlingView] = useState(() => localStorage.getItem('bowlingView') || 'grid')
  const [reingesting, setReingesting] = useState(false)
  const [reingestMsg, setReingestMsg] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [dark, setDark] = useState(getIsDark)
  const apiFetch = useApiFetch()

  const loadMatch = useCallback(() => {
    apiFetch(`/api/matches/${id}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadMatch() }, [loadMatch])

  useEffect(() => {
    const update = () => setDark(getIsDark())
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', update)
    return () => { observer.disconnect(); mq.removeEventListener('change', update) }
  }, [])

  const refreshRoles = useCallback(() => {
    apiFetch(`/api/matches/${id}/roles`)
      .then(r => r.json())
      .then(setRoles)
      .catch(() => {})
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { refreshRoles() }, [refreshRoles])

  async function deleteMatch() {
    if (!window.confirm('Delete this match and all its data? This cannot be undone.')) return
    setDeleting(true)
    try {
      const res = await apiFetch(`/api/admin/match/${id}`, { method: 'DELETE' })
      if (!res.ok) { const j = await res.json(); throw new Error(j.error || 'Delete failed') }
      navigate('/')
    } catch (e) {
      alert(e.message)
      setDeleting(false)
    }
  }

  async function reingest(playCricketId) {
    setReingesting(true)
    setReingestMsg(null)
    try {
      const res = await apiFetch('/api/admin/fetch-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `https://whcc.play-cricket.com/website/results/${playCricketId}` }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Re-ingest failed')
      setReingestMsg({ ok: true, text: 'Re-ingested successfully' })
      loadMatch()
      refreshRoles()
    } catch (e) {
      setReingestMsg({ ok: false, text: e.message })
    } finally {
      setReingesting(false)
    }
  }

  if (loading) return (
    <div className="page">
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <Skeleton height="1.6rem" width="55%" />
        <div style={{ marginTop: '0.6rem', display: 'flex', gap: '1rem' }}>
          <Skeleton height="0.8rem" width="6rem" />
          <Skeleton height="0.8rem" width="8rem" />
          <Skeleton height="0.8rem" width="7rem" />
        </div>
        <div style={{ marginTop: '0.5rem' }}><Skeleton height="1.2rem" width="10rem" /></div>
      </div>
      <div className="card" style={{ marginBottom: '1.5rem', height: '220px' }} />
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginBottom: '0.75rem' }}>Batting</h2>
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table><tbody>{Array.from({ length: 7 }).map((_, i) => <SkeletonRow key={i} cols={9} />)}</tbody></table>
        </div>
        <h2 style={{ marginTop: '1.25rem', marginBottom: '0.75rem' }}>Bowling</h2>
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table><tbody>{Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} cols={8} />)}</tbody></table>
        </div>
      </div>
    </div>
  )
  if (!data?.fixture) return <div className="loading">Match not found.</div>

  const { fixture, scorecards } = data
  const ordinals = ['1st', '2nd', '3rd', '4th']

  function toggleOvers(i) {
    setExpandedOvers(prev => ({ ...prev, [i]: !prev[i] }))
  }

  return (
    <div className="page">
      <div style={{ display: 'flex', gap: '8px', marginBottom: reingestMsg ? '0.5rem' : '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="secondary" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 }}
          onClick={() => navigate('/')}><ChevronLeft size={14} /> Matches</button>
        {canUpload && scorecards.some(sc => sc.isManual) && (
          <button className="secondary" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => navigate(`/manual/${id}`)}><Pencil size={13} /> Edit</button>
        )}
        {canUpload && fixture.play_cricket_id && (
          <button className="secondary" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => reingest(fixture.play_cricket_id)} disabled={reingesting}>
            <RefreshCw size={13} style={reingesting ? { animation: 'spin 1s linear infinite' } : {}} />
            {reingesting ? 'Re-ingesting…' : 'Re-ingest'}
          </button>
        )}
        {fixture.play_cricket_id && (
          <a href={`https://whcc.play-cricket.com/website/results/${fixture.play_cricket_id}`}
            target="_blank" rel="noopener noreferrer"
            style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text2)', marginLeft: 'auto' }}>
            <ExternalLink size={13} /> play-cricket
          </a>
        )}
        {canUpload && (
          <button className="secondary" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4, color: 'var(--red)', borderColor: 'var(--red)' }}
            onClick={deleteMatch} disabled={deleting}>
            <Trash2 size={13} /> {deleting ? 'Deleting…' : 'Delete'}
          </button>
        )}
      </div>
      {reingestMsg && (
        <div className={`alert ${reingestMsg.ok ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: '1rem' }}>
          {reingestMsg.text}
        </div>
      )}

      {/* Match header */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="match-header-top">
          <div style={{ minWidth: 0 }}>
            <h1 style={{ marginBottom: '0' }}>
              {shortTeam(fixture.home_team) || 'Home'} <span style={{ fontWeight: 300, color: 'var(--text3)' }}>vs</span> {shortTeam(fixture.away_team) || 'Away'}
            </h1>
            <div className="match-header-meta">
              {fixture.match_date && <span><Calendar size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />{fixture.match_date}</span>}
              {fixture.ground     && <span><MapPin   size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />{fixture.ground}</span>}
            </div>
            {fixture.competition && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', color: 'var(--text2)', marginTop: '0.2rem' }}>
                <Trophy size={13} />{fixture.competition}
              </div>
            )}
            {fixture.last_ingested_at && (
              <div style={{ fontSize: '0.72rem', color: 'var(--text3)', marginTop: '0.25rem' }}>
                Ingested {new Date(fixture.last_ingested_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {fixture.last_ingested_by && ` by ${fixture.last_ingested_by}`}
              </div>
            )}
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
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '2px 10px 2px 6px', borderRadius: 999,
                  fontSize: '0.8rem', fontWeight: 500,
                  background: isWhcc(fixture.toss_winner) ? '#690028' : '#3E14BA',
                  color: '#fff',
                }}>
                  <img src="/coin.png" height="14" style={{ opacity: 0.9 }} />
                  Toss: {shortTeam(fixture.toss_winner)} · {fixture.toss_decision}
                  {fixture.toss_decision === 'bat'
                    ? <img src="/cricket-bat.png" height="13" style={{ opacity: 0.85, marginLeft: 1 }} />
                    : <svg width="11" height="11" viewBox="0 0 11 11" style={{ opacity: 0.85, marginLeft: 1, flexShrink: 0 }}>
                        <circle cx="5.5" cy="5.5" r="5" fill="none" stroke="#fff" strokeWidth="1.2" />
                        <path d="M2 5.5 Q5.5 2 9 5.5 Q5.5 9 2 5.5Z" fill="#fff" opacity="0.5" />
                      </svg>
                  }
                </span>
              )}
            </div>
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
        </div>

        {/* WHCC captain / WK for this match */}
        {(() => {
          const entries = Object.entries(roles || {})
          const battingEntry  = entries.find(([, v]) => isWhcc(v?.batting_team))
          const fieldingEntry = entries.find(([, v]) => !isWhcc(v?.batting_team))
          if (!battingEntry) return null
          const fieldingInningsOvers = fieldingEntry
            ? parseFloat(scorecards?.find(sc => sc.inningsOrder === Number(fieldingEntry[0]))?.totals?.overs) || null
            : null
          const whccSc      = scorecards?.find(sc => sc.inningsOrder === Number(battingEntry[0]))
          const fieldingSc  = scorecards?.find(sc => sc.inningsOrder === (fieldingEntry ? Number(fieldingEntry[0]) : -1))
          const activePids  = new Set([
            ...(whccSc?.batting  || []).map(b => b.player_id).filter(Boolean),
            ...(fieldingSc?.bowling || []).map(b => b.player_id).filter(Boolean),
            ...(fieldingEntry?.[1]?.wk_stints || []).map(s => s.player_id),
          ])
          const alsoFielded = (battingEntry[1].players || []).filter(p => !activePids.has(p.player_id))
          return (
            <InningsRoles
              fixtureId={id}
              battingOrder={Number(battingEntry[0])}
              battingRolesData={battingEntry[1]}
              fieldingOrder={fieldingEntry ? Number(fieldingEntry[0]) : null}
              fieldingRolesData={fieldingEntry?.[1] ?? null}
              fieldingOvers={fieldingInningsOvers}
              alsoFielded={alsoFielded}
              onRefresh={refreshRoles}
            />
          )
        })()}
      </div>

      <MatchCharts scorecards={scorecards} roles={roles} fixture={fixture} partnerships={data.partnerships || []} phases={data.phases || []} dn={dn} dark={dark} />
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
              {(() => {
                const e = sc.totals.extras
                const total = e.byes + e.legByes + e.wides + e.noBalls
                return `Extras: ${total} (b ${e.byes}, lb ${e.legByes}, w ${e.wides}, nb ${e.noBalls})`
              })()}
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
            <BattingTable batting={sc.batting} navigate={navigate} isPairs={sc.isPairs} dn={dn} matchId={id} />
          </>}

          {showBowling && <>
            <h3 style={{ marginTop: showBatting ? '1.25rem' : 0 }}>Bowling</h3>
            <BowlingTable bowling={sc.bowling} navigate={navigate} isManual={sc.isManual} dn={dn} matchId={id} />
          </>}

          {/* Over-by-over — expandable, only for ingested matches */}
          {!sc.isManual && (
            <div style={{ marginTop: '1rem', marginBottom: '2rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button className="secondary" style={{ fontSize: '0.82rem', padding: '4px 12px' }}
                  onClick={() => toggleOvers(i)}>
                  {expandedOvers[i] ? '▲ Hide overs' : '▼ Show over-by-over'}
                </button>
                {expandedOvers[i] && (
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {['grid', 'table'].map(v => (
                      <button
                        key={v}
                        className={`pill${bowlingView === v ? ' active' : ''}`}
                        style={{ padding: '2px 12px', fontSize: '0.78rem' }}
                        onClick={() => {
                          setBowlingView(v)
                          localStorage.setItem('bowlingView', v)
                        }}
                      >
                        {v.charAt(0).toUpperCase() + v.slice(1)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {expandedOvers[i] && (
                <div style={{ marginTop: '1rem' }}>
                  {bowlingView === 'table'
                    ? <OversTable overs={sc.overs} dn={dn} />
                    : <OversGrid overs={sc.overs} dn={dn} />
                  }
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

function MatchCharts({ scorecards, roles, fixture, partnerships = [], phases = [], dn = x => x, dark }) {
  const charted = scorecards.filter(sc => !sc.isManual && sc.overs?.length > 0)
  const whccPartnerships = partnerships.filter(p => isWhcc(roles?.[p.innings_order]?.batting_team))
  const hasPartnerships = whccPartnerships.length > 0
  const defaultTab = charted.length > 0 ? 'manhattan' : hasPartnerships ? 'partnerships' : 'phases'
  const [tab, setTab] = useState(defaultTab)
  const [showNet, setShowNet] = useState(true)
  if (charted.length === 0 && !hasPartnerships && phases.length === 0) return null
  const hasPairs = charted.some(sc => sc.isPairs)
  const startingScore = fixture?.starting_score || 0

  const CC = dark ? CHART_COLOURS_DARK : CHART_COLOURS_LIGHT
  const getColor = sc => {
    if (!sc) return CC.opp
    const team = roles?.[sc.inningsOrder]?.batting_team
    return isWhcc(team) ? CC.whcc : CC.opp
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
      row[`inn${sc.inningsOrder}`] = o ? (sc.isPairs && showNet ? o.runs - o.wickets * 5 : o.runs) : undefined
      row[`wkt${sc.inningsOrder}`] = o ? o.wickets : 0
    }
    return row
  })

  const wormData = (() => {
    const overNums = [...new Set([0, ...charted.flatMap(sc => sc.overs.map(o => o.over))])].sort((a, b) => a - b)
    return overNums.map(over => {
      const row = { over }
      for (const sc of charted) {
        const scMaxOver = sc.overs.length ? Math.max(...sc.overs.map(o => o.over)) : 0
        if (over > scMaxOver) {
          row[`inn${sc.inningsOrder}`] = null
          row[`wkt${sc.inningsOrder}`] = 0
        } else {
          const cumRuns = sc.overs.filter(o => o.over <= over).reduce((s, o) => s + o.runs, 0)
          const cumWkts = sc.overs.filter(o => o.over <= over).reduce((s, o) => s + o.wickets, 0)
          row[`inn${sc.inningsOrder}`] = (sc.isPairs && showNet)
            ? startingScore + cumRuns - cumWkts * 5
            : cumRuns
          const o = sc.overs.find(x => x.over === over)
          row[`wkt${sc.inningsOrder}`] = o?.wickets || 0
        }
      }
      return row
    })
  })()

  const rrData = (() => {
    const overNums = [...new Set(charted.flatMap(sc => sc.overs.map(o => o.over)))].sort((a, b) => a - b)
    return overNums.map(over => {
      const row = { over }
      for (const sc of charted) {
        const scMaxOver = sc.overs.length ? Math.max(...sc.overs.map(o => o.over)) : 0
        if (over > scMaxOver) {
          row[`inn${sc.inningsOrder}`] = null
          row[`wkt${sc.inningsOrder}`] = 0
        } else {
          const cumRuns = sc.overs.filter(o => o.over <= over).reduce((s, o) => s + o.runs, 0)
          if (sc.isPairs && showNet) {
            const cumWkts = sc.overs.filter(o => o.over <= over).reduce((s, o) => s + o.wickets, 0)
            row[`inn${sc.inningsOrder}`] = +((cumRuns - cumWkts * 5) / over).toFixed(2)
          } else {
            row[`inn${sc.inningsOrder}`] = +(cumRuns / over).toFixed(2)
          }
          const o = sc.overs.find(x => x.over === over)
          row[`wkt${sc.inningsOrder}`] = o?.wickets || 0
        }
      }
      return row
    })
  })()

  const makeWicketDots = (sc) => (labelProps) => {
    const { x, y, width, height, value: over } = labelProps
    const row = manhattanData.find(r => r.over === over)
    const val = row?.[`inn${sc.inningsOrder}`]
    const wkts = row?.[`wkt${sc.inningsOrder}`] || 0
    if (!wkts || val == null) return null
    // For negative bars: Recharts sets y = bar bottom (furthest SVG point from zero line),
    // height = negative (going up). So y is already the bottom — just offset down from there.
    const below = val < 0
    return (
      <g>
        {Array.from({ length: wkts }, (_, i) => (
          <circle key={i} cx={x + width / 2} cy={below ? y + 5 + i * 8 : y - 5 - i * 8} r={3} fill="#ff69b4" />
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1rem', flexWrap: 'wrap' }}>
        {[...(charted.length > 0 ? ['manhattan', 'worm', 'run rate'] : []), ...(hasPartnerships ? ['partnerships'] : []), ...(phases.length > 0 ? ['phases'] : [])].map(t => (
          <button key={t} onClick={() => setTab(t)} className={tab !== t ? 'secondary' : ''} style={{ fontSize: '0.82rem', padding: '4px 12px', textTransform: 'capitalize' }}>{t}</button>
        ))}
        {hasPairs && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {[{ v: true, label: 'Net' }, { v: false, label: 'Raw' }].map(({ v, label }) => (
              <button key={label} onClick={() => setShowNet(v)} className={showNet !== v ? 'secondary' : ''} style={{ fontSize: '0.78rem', padding: '2px 10px' }}>{label}</button>
            ))}
          </div>
        )}
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
                <LabelList dataKey="over" content={makeWicketDots(sc)} />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}

      {tab === 'worm' && (
        <>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={wormData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="over" tick={axisStyle} />
            <YAxis tick={axisStyle} domain={(hasPairs && showNet) ? ['auto', 'auto'] : [0, 'auto']} />
            <Tooltip formatter={(v, key) => {
              const sc = charted.find(s => `inn${s.inningsOrder}` === key)
              return [v, getLabel(sc)]
            }} />
            {charted.length > 1 && <Legend formatter={(_, entry) => getLabel(charted.find(sc => `inn${sc.inningsOrder}` === entry.dataKey))} />}
            {charted.map(sc => (
              <Line key={sc.inningsOrder} type="linear" dataKey={`inn${sc.inningsOrder}`} stroke={getColor(sc)} strokeWidth={2} dot={makeWormDot(sc)} activeDot={{ r: 4 }} name={getLabel(sc)} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        </>
      )}

      {tab === 'run rate' && (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={rrData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="over" tick={axisStyle} />
            <YAxis tick={axisStyle} domain={[0, 'auto']} tickFormatter={v => v.toFixed(1)} />
            <Tooltip formatter={(v, key) => {
              const sc = charted.find(s => `inn${s.inningsOrder}` === key)
              return [`${v} rpo`, getLabel(sc)]
            }} />
            {charted.length > 1 && <Legend formatter={(_, entry) => getLabel(charted.find(sc => `inn${sc.inningsOrder}` === entry.dataKey))} />}
            {charted.map(sc => (
              <Line key={sc.inningsOrder} type="linear" dataKey={`inn${sc.inningsOrder}`} stroke={getColor(sc)} strokeWidth={2} dot={makeWormDot(sc)} activeDot={{ r: 4 }} name={getLabel(sc)} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}

      {tab === 'partnerships' && (
        <PartnershipChart partnerships={whccPartnerships} dn={dn} dark={dark} />
      )}

      {tab === 'phases' && (() => {
        const getPhaseColor = inn => {
          const team = roles?.[inn.innings_order]?.batting_team
          return isWhcc(team) ? CC.whcc : CC.opp
        }
        const getPhaseLabel = inn => {
          const sc = scorecards.find(s => s.inningsOrder === inn.innings_order)
          const team = roles?.[inn.innings_order]?.batting_team
          if (team) return shortTeam(team)
          if (sc?.isManual) return inn.innings_order === 1 ? shortTeam(fixture.home_team || 'WHCC') : shortTeam(fixture.away_team || 'Opp')
          return `Innings ${inn.innings_order}`
        }
        const PHASE_ORDER = ['Powerplay', 'Middle', 'Death']
        const chartData = PHASE_ORDER.map(phaseName => {
          const row = { phase: phaseName }
          phases.forEach(inn => {
            const sc = scorecards.find(s => s.inningsOrder === inn.innings_order)
            const p = inn.phases.find(x => x.phase === phaseName)
            if (p) {
              const k = `inn${inn.innings_order}`
              row[k]        = sc?.isPairs && showNet ? p.runs - p.wickets * 5 : p.runs
              row[`${k}w`]  = p.wickets
              row[`${k}rr`] = p.run_rate
              row[`${k}ov`] = p.from === p.to ? `Ov ${p.from}` : `Ov ${p.from}–${p.to}`
            }
          })
          return row
        }).filter(row => phases.some(inn => row[`inn${inn.innings_order}`] !== undefined))

        const PhaseTooltip = ({ active, payload, label }) => {
          if (!active || !payload?.length) return null
          return (
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: '0.82rem' }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
              {payload.map(p => {
                const k = p.dataKey
                return (
                  <div key={k} style={{ color: p.fill, lineHeight: 1.7 }}>
                    {p.name}: <strong>{p.value}r</strong> · {p.payload[`${k}w`]}w · {p.payload[`${k}rr`]} rpo
                    <span style={{ color: 'var(--text3)', marginLeft: 4 }}>({p.payload[`${k}ov`]})</span>
                  </div>
                )
              })}
            </div>
          )
        }

        const WktsLabel = ({ x, y, width, height, value }) => {
          if (!value || height < 18) return null
          return (
            <text x={x + width / 2} y={y + Math.min(height - 6, 15)} textAnchor="middle"
                  fontSize={10} fill="rgba(255,255,255,0.85)" fontWeight={500}>
              {value}w
            </text>
          )
        }

        return (
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={chartData} barCategoryGap="28%" barGap={3}
                      margin={{ top: 12, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="phase" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<PhaseTooltip />} cursor={{ fill: 'var(--bg2)', opacity: 0.5 }} />
              {phases.length > 1 && (
                <Legend formatter={(_, entry) => {
                  const inn = phases.find(i => `inn${i.innings_order}` === entry.dataKey)
                  return inn ? getPhaseLabel(inn) : entry.value
                }} wrapperStyle={{ fontSize: '0.78rem', paddingTop: 4 }} />
              )}
              {phases.map(inn => (
                <Bar key={inn.innings_order} dataKey={`inn${inn.innings_order}`}
                     name={getPhaseLabel(inn)} fill={getPhaseColor(inn)} radius={[3, 3, 0, 0]}>
                  <LabelList content={<WktsLabel />} dataKey={`inn${inn.innings_order}w`} />
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        )
      })()}
    </div>
  )
}

function PartnershipChart({ partnerships, dn = x => x, dark }) {
  const navigate = useNavigate()
  const RED = dark ? '#ff5252' : '#690028'
  const maxRuns = Math.max(...partnerships.map(p => p.runs), 1)
  return (
    <div style={{ padding: '0.25rem 0' }}>
      {partnerships.map((p, i) => {
        const pct = Math.max((p.runs / maxRuns) * 88, p.runs > 0 ? 6 : 2)
        const rr = p.balls > 0 ? ((p.runs / p.balls) * 6).toFixed(1) : '–'
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ textAlign: 'right', lineHeight: 1.3 }}>
              <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{p.batter1_id > 0 ? <span className="player-link" onClick={() => navigate(`/player/${p.batter1_id}`)}>{dn(p.batter1_name)}</span> : dn(p.batter1_name)}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>{p.batter1_runs} ({p.batter1_balls})</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
              <div style={{ position: 'relative', width: '100%', height: 28 }}>
                <div style={{ position: 'absolute', top: 6, left: 0, right: 0, height: 14, borderRadius: 99, background: 'var(--bg2)' }} />
                <div style={{
                  position: 'absolute', top: 6,
                  left: `${(100 - pct) / 2}%`, width: `${pct}%`,
                  height: 14, borderRadius: 99,
                  background: p.dismissed_batter_id ? RED : `${RED}99`,
                }} />
                <div style={{
                  position: 'absolute', top: 1,
                  left: '50%', transform: 'translateX(-50%)',
                  minWidth: 28, height: 26, padding: '0 5px',
                  borderRadius: 99,
                  background: 'var(--bg)', border: '1.5px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.78rem', fontWeight: 700, zIndex: 1,
                }}>
                  {p.runs}
                </div>
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text3)' }}>{rr} rpo</div>
            </div>
            <div style={{ textAlign: 'left', lineHeight: 1.3 }}>
              <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{p.batter2_id > 0 ? <span className="player-link" onClick={() => navigate(`/player/${p.batter2_id}`)}>{dn(p.batter2_name)}</span> : dn(p.batter2_name)}</div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>{p.batter2_runs} ({p.batter2_balls})</div>
            </div>
          </div>
        )
      })}
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
  const navigate = useNavigate()
  const meta = FLOW_ICONS[event.type] || {}
  const { Icon, imgSrc, cls = '' } = meta

  // Only link WHCC players: batters when WHCC batting, bowler hauls when WHCC bowling
  const canLink = event.player_id > 0 && (
    (isWhccBatting  && ['batter_milestone', 'wicket', 'pairs_out'].includes(event.type)) ||
    (!isWhccBatting && event.type === 'bowler_haul')
  )
  const playerName = event.player ? dn(event.player) : ''
  const playerEl = canLink
    ? <span className="player-link" onClick={() => navigate(`/player/${event.player_id}`)}>{playerName}</span>
    : playerName

  let content
  if (event.type === 'powerplay') {
    content = `Powerplay: ${event.score}/${event.wickets} after 6 overs`
  } else if (event.type === 'team_milestone') {
    content = `${event.runs} up — ${event.wickets} down — ov ${event.over}`
  } else if (event.type === 'batter_milestone') {
    content = <>{playerEl} {event.runs}{event.runs >= 10 ? '*' : ''} ({event.balls}b) — ov {event.over}</>
  } else if (event.type === 'wicket') {
    if (isWhccBatting) {
      const rb = `${event.runs}(${event.balls})`
      const isRunOut = event.dismissalMethod === 'RunOut'
      const methodWord = { Bowled: 'bowled', Caught: 'caught', CaughtAndBowled: 'caught & bowled', LBW: 'lbw', Stumped: 'stumped' }[event.dismissalMethod]
      const after = isRunOut
        ? ` run out · ${rb}`
        : `${methodWord ? ` out ${methodWord}` : ' out'} ${rb}`
      const suffix = ` · ${ordSuffix(event.wickets)} wkt for ${event.score}${event.partnership > 0 ? ` · p'ship ${event.partnership}` : ''} · ov ${event.over}`
      content = <>{playerEl}{after}{suffix}</>
    } else {
      const disDesc = dismissalShortDesc(event.dismissalMethod, event.fielder, event.bowler, dn)
      const parts = [disDesc, `${ordSuffix(event.wickets)} wkt for ${event.score}`]
      if (event.partnership > 0) parts.push(`p'ship ${event.partnership}`)
      parts.push(`ov ${event.over}`)
      content = parts.join(' · ')
    }
  } else if (event.type === 'bowler_haul') {
    content = <>{playerEl} takes {ordSuffix(event.wickets)} wicket — ov {event.over}</>
  } else if (event.type === 'pairs_out') {
    if (isWhccBatting) {
      content = <>{playerEl} out — {ordSuffix(event.wickets)} dismissal · {event.score} raw · ov {event.over}</>
    } else {
      const disDesc = dismissalShortDesc(event.dismissalMethod, event.fielder, event.bowler, dn)
      content = `${disDesc} — ${ordSuffix(event.wickets)} dismissal · ${event.score} raw · ov ${event.over}`
    }
  } else if (event.type === 'innings_end') {
    content = event.netScore != null
      ? `Innings ends: ${event.score} raw · ${event.wickets} out · net ${event.netScore} (${event.overs} overs)`
      : `Innings ends: ${event.score}/${event.wickets} (${event.overs} overs)`
  }

  return (
    <div className={`flow-event ${cls}`}>
      <span className="flow-icon">{imgSrc ? <img src={imgSrc} style={{ width: 13, height: 13, objectFit: 'contain' }} alt="" /> : Icon ? <Icon size={13} /> : <span className="flow-dot" />}</span>
      <span className="flow-text">{content}</span>
    </div>
  )
}

function MatchFlow({ scorecards, roles, dn, isWhcc }) {
  const flowScs = scorecards.filter(sc => sc.flow?.length > 1)
  if (!flowScs.length) return null

  const sideBySide = flowScs.length > 1
  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.75rem' }}>Match flow</h3>
      <div style={sideBySide ? { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' } : {}}>
        {flowScs.map((sc) => {
          const team = roles?.[sc.inningsOrder]?.batting_team
          const isWhccBatting = team ? isWhcc(team) : sc.isManual ? sc.inningsOrder === 1 : true
          return (
            <div key={sc.inningsOrder}>
              {sideBySide && (
                <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text2)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                  {team ? shortTeam(team) : `Innings ${sc.inningsOrder}`} batting
                </div>
              )}
              <div className="flow-list">
                {sc.flow
                  .filter(event => isWhccBatting || event.type !== 'batter_milestone')
                  .map((event, j) => <FlowEvent key={j} event={event} dn={dn} isWhccBatting={isWhccBatting} />)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── MVP ───────────────────────────────────────────────────────────────────────

function MvpCard({ mvp, meta, dn }) {
  const navigate = useNavigate()
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
          <span style={{ flex: 1, fontWeight: i === 0 ? 600 : 400 }}>{p.playerId > 0 ? <span className="player-link" onClick={() => navigate(`/player/${p.playerId}`)}>{dn(p.name)}</span> : dn(p.name)}</span>
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
                    <td style={{ paddingRight: 8, paddingTop: 2, paddingBottom: 2 }}>{p.playerId > 0 ? <span className="player-link" onClick={() => navigate(`/player/${p.playerId}`)}>{dn(p.name)}</span> : dn(p.name)}</td>
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

function InningsRoles({ fixtureId, battingOrder, battingRolesData, fieldingOrder, fieldingRolesData, fieldingOvers, alsoFielded, onRefresh }) {
  const navigate = useNavigate()
  const [saving, setSaving]             = useState(false)
  const [editingCaptain, setEditingCaptain] = useState(false)
  const [addWkPlayer, setAddWkPlayer]   = useState('')
  const [addWkFrom, setAddWkFrom]       = useState('')
  const [addWkTo, setAddWkTo]           = useState('')
  const [wkError, setWkError]           = useState('')
  const [showWkForm, setShowWkForm]     = useState(false)
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
    const body = { innings_order: fieldingOrder, player_id: Number(addWkPlayer), from_over: Number(addWkFrom) + 1 }
    if (addWkTo) body.to_over = Number(addWkTo)
    const r = await apiFetch(`/api/matches/${fixtureId}/wk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (r.ok) {
      setAddWkPlayer(''); setAddWkFrom(''); setAddWkTo(''); setShowWkForm(false)
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
    if (r.ok) { setAddWkPlayer(''); setShowWkForm(false); onRefresh() }
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
        <div className="role-col-label"><img src="/shield.png" height="14" style={{ verticalAlign: 'middle', marginRight: 4, opacity: 0.7 }} />Captain</div>
        {editingCaptain
          ? <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <select className="role-select" autoFocus value={captain_player_id ?? ''}
                onChange={e => { setCaptain(e.target.value); setEditingCaptain(false) }}
                disabled={saving}>
                <option value="">— unset —</option>
                {players.map(p => <option key={p.player_id} value={p.player_id}>{dn(p.name)}</option>)}
              </select>
              <button className="icon-btn" onClick={() => setEditingCaptain(false)} title="Cancel"><X size={12} /></button>
            </div>
          : <div className="wk-stint">
              <span className="wk-stint-name">
                {captain_player_id
                ? <span className="player-link" onClick={() => navigate(`/player/${captain_player_id}`)}>{dn(players.find(p => p.player_id === captain_player_id)?.name ?? '')}</span>
                : <span className="dim" style={{ fontWeight: 400 }}>unset</span>}
              </span>
              <button className="icon-btn" onClick={() => setEditingCaptain(true)} title="Edit captain" disabled={saving}>
                <Pencil size={12} />
              </button>
            </div>
        }
      </div>

      <div className="role-col">
        <div className="role-col-label"><img src="/gloves.png" height="14" style={{ verticalAlign: 'middle', marginRight: 4, opacity: 0.7 }} />Wicket keeper</div>
        {showWkForm
          ? <>
              <div className="wk-add-row">
                {wk_stints.length > 0 && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.82rem', color: 'var(--text2)' }}>
                    from ov
                    <input type="number" min="0" className="role-input-over"
                      value={addWkFrom} onChange={e => { setAddWkFrom(e.target.value); setWkError('') }} disabled={saving} />
                    {fieldingOvers && (
                      <button type="button" className="secondary" style={{ fontSize: '0.75rem', padding: '1px 6px' }}
                        onClick={() => setAddWkFrom(String(Math.ceil(Math.floor(fieldingOvers) / 2)))}>
                        half
                      </button>
                    )}
                  </label>
                )}
                <select className="role-select" value={addWkPlayer} onChange={e => setAddWkPlayer(e.target.value)} disabled={saving}>
                  <option value="">{wk_stints.length === 0 ? '— set keeper —' : '— new keeper —'}</option>
                  {players.map(p => <option key={p.player_id} value={p.player_id}>{dn(p.name)}</option>)}
                </select>
                <button className="secondary" style={{ fontSize: '0.82rem', padding: '4px 10px' }}
                  onClick={wk_stints.length === 0 ? setFirstWk : addWk}
                  disabled={saving || !addWkPlayer || (wk_stints.length > 0 && addWkFrom === '')}>
                  {wk_stints.length === 0 ? 'Set' : 'Add'}
                </button>
                <button className="secondary" style={{ fontSize: '0.82rem', padding: '4px 8px' }}
                  onClick={() => { setShowWkForm(false); setAddWkPlayer(''); setAddWkFrom(''); setWkError('') }}>
                  Cancel
                </button>
              </div>
              {wkError && <div style={{ color: 'var(--red)', fontSize: '0.8rem', marginTop: 4 }}>{wkError}</div>}
            </>
          : <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              {wk_stints.map(stint => {
                const overRange = stint.to_over
                  ? `ov ${stint.from_over - 1}–${stint.to_over - 1}`
                  : stint.from_over > 1 ? `ov ${stint.from_over - 1}+` : null
                return (
                  <div key={stint.id} className="wk-stint">
                    <span className="wk-stint-name player-link" onClick={() => navigate(`/player/${stint.player_id}`)}>{playerName(stint.player_id)}</span>
                    {overRange && <span className="dim wk-stint-meta">{overRange}</span>}
                    {stint.byes > 0 && <span className="dim wk-stint-meta">{stint.byes}b</span>}
                    <button className="icon-btn danger" onClick={() => deleteWk(stint.id)} disabled={saving} title="Remove"><X size={12} /></button>
                    {wk_errors.filter(e => e.player_id === stint.player_id).map(err => (
                      <span key={err.id} className="error-tag">
                        {err.error_type === 'dropped_catch' ? 'dropped' : 'missed stumping'}
                        <button className="icon-btn" onClick={() => deleteError(err.id)} disabled={saving}><X size={12} /></button>
                      </span>
                    ))}
                  </div>
                )
              })}
              <button className="icon-btn" onClick={() => { setAddWkPlayer(''); setAddWkFrom(''); setShowWkForm(true) }}
                title={wk_stints.length === 0 ? 'Set keeper' : 'Record change'} disabled={saving}>
                <Pencil size={12} />
              </button>
            </div>
        }
      </div>
      {alsoFielded?.length > 0 && (
        <div className="role-col" style={{ minWidth: 0 }}>
          <div className="role-col-label">Also fielded</div>
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
            {alsoFielded.map(p => (
              <span key={p.player_id} className="wk-stint">
                <span className="wk-stint-name player-link" onClick={() => navigate(`/player/${p.player_id}`)}>{dn(p.name)}</span>
              </span>
            ))}
          </div>
        </div>
      )}
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

function BattingTable({ batting, navigate, isPairs, dn = x => x, matchId }) {
  if (!batting.length) return <div className="empty">No batting data</div>
  const showDotPct = !isPairs && batting[0]?.fours !== undefined
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
              {showDotPct && <th className="num">Dot%</th>}
            </>}
          </tr>
        </thead>
        <tbody>
          {batting.map(b => (
            <tr key={b.player_id} style={b.did_not_bat ? { opacity: 0.45 } : {}}>
              <td className="bold">
                {b.player_id > 0
                  ? <span className="player-link" onClick={() => navigate(`/player/${b.player_id}`, { state: { from: `/match/${matchId}` } })}>{dn(b.name)}</span>
                  : dn(b.name)}
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
                {showDotPct && <td className="num dim">{b.did_not_bat || b.dot_pct == null ? '–' : `${b.dot_pct}%`}</td>}
              </>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PartnershipsTable({ partnerships, dn = x => x }) {
  const [open, setOpen] = useState(false)
  if (!partnerships.length) return null
  return (
    <div style={{ marginTop: '0.75rem' }}>
      <button
        className="secondary"
        style={{ fontSize: '0.82rem', padding: '4px 12px' }}
        onClick={() => setOpen(v => !v)}
      >
        {open ? '▲ Hide partnerships' : '▼ Partnerships'}
      </button>
      {open && (
        <div className="card" style={{ padding: 0, overflowX: 'auto', marginTop: '0.5rem' }}>
          <table>
            <thead>
              <tr>
                <th>Batters</th>
                <th className="num">R</th>
                <th className="num">B</th>
                <th className="num">SR</th>
              </tr>
            </thead>
            <tbody>
              {partnerships.map((p, i) => {
                const sr = p.balls > 0 ? ((p.runs / p.balls) * 100).toFixed(0) : '–'
                const names = `${dn(p.batter1_name)} & ${dn(p.batter2_name)}`
                return (
                  <tr key={i} style={p.dismissed_batter_id ? {} : { opacity: 0.8 }}>
                    <td>{names}</td>
                    <td className="num bold">{p.runs}</td>
                    <td className="num dim">{p.balls}</td>
                    <td className="num dim">{sr}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function spellFigures(spell) {
  const total = spell.balls + (spell.wides || 0) + (spell.noBalls || 0)
  const overs = Math.floor(total / 6)
  const rem   = total % 6
  const oversStr = rem > 0 ? `${overs}.${rem}` : String(overs)
  return `${oversStr}-${spell.maidens}-${spell.runs}-${spell.wickets}`
}

function BowlingTable({ bowling, navigate, isManual, dn = x => x, matchId = null }) {
  const [expandedSpells, setExpandedSpells] = useState({})
  if (!bowling.length) return <div className="empty">No bowling data</div>
  const rows = isManual ? bowling : [...bowling].sort((a,b) => b.wickets - a.wickets || a.runs - b.runs)
  const showDotPct = rows[0]?.dot_pct !== undefined

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
            {showDotPct && <th className="num">Dot%</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(b => {
            const hasMultipleSpells = b.spells?.length > 1
            const isExpanded = !!expandedSpells[b.player_id]
            return (
              <React.Fragment key={b.player_id}>
                <tr>
                  <td className="bold">
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {b.player_id > 0
                        ? <span className="player-link" onClick={() => navigate(`/player/${b.player_id}`, { state: { from: matchId ? `/match/${matchId}` : null } })}>{dn(b.name)}</span>
                        : dn(b.name)}
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
                  {showDotPct && <td className="num dim">{b.dot_pct != null ? `${b.dot_pct}%` : '–'}</td>}
                </tr>
                {hasMultipleSpells && isExpanded && b.spells.map((spell, idx) => (
                  <tr key={`${b.player_id}-spell-${idx}`} style={{ background: 'var(--bg2, var(--bg))' }}>
                    <td colSpan={showDotPct ? 9 : 8} style={{ paddingLeft: '1.5rem', fontSize: '0.78rem', color: 'var(--text3)', paddingTop: 2, paddingBottom: 2 }}>
                      Spell {idx + 1}: overs {spell.from_over + 1}{spell.from_over !== spell.to_over ? `–${spell.to_over + 1}` : ''} &nbsp; {spellFigures(spell)}
                    </td>
                  </tr>
                ))}
              </React.Fragment>
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
      {overs.map(o => {
        const wides   = o.balls.filter(b => b.extras_type === 2).length
        const noBalls = o.balls.filter(b => b.extras_type === 1).length
        return (
        <div key={o.over} className="over-cell">
          <div className="over-header">
            <span className="over-num">Over {o.over}</span>
            <span className="over-runs">
              {o.runs}
              {o.wickets > 0 && <span style={{ color: 'var(--red)', marginLeft: 3 }}>·{o.wickets}W</span>}
              {wides   > 0 && <span style={{ color: 'var(--text3)', marginLeft: 3, fontSize: '0.7em' }}>{wides}wd</span>}
              {noBalls > 0 && <span style={{ color: 'var(--text3)', marginLeft: 3, fontSize: '0.7em' }}>{noBalls}nb</span>}
            </span>
          </div>
          <div className="over-balls">
            {o.balls.map((b, i) => <BallCircle key={i} ball={b} />)}
          </div>
          <div className="over-bowler">{dn(o.bowler)}</div>
        </div>
        )
      })}
    </div>
  )
}

function OversTable({ overs, dn = x => x }) {
  if (!overs.length) return <div className="empty">No over data</div>
  return (
    <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th className="num">Ov</th>
            <th>Bowler</th>
            <th className="num">R</th>
            <th className="num">W</th>
            <th className="num">Econ</th>
          </tr>
        </thead>
        <tbody>
          {overs.map(o => {
            const legalBalls = o.balls.filter(b => b.extras_type !== 2 && b.extras_type !== 1).length
            const econ = legalBalls > 0 ? (o.runs / legalBalls * 6).toFixed(1) : '–'
            return (
              <tr key={o.over}>
                <td className="num dim">{o.over}</td>
                <td>{dn(o.bowler)}</td>
                <td className="num">{o.runs}</td>
                <td className={`num ${o.wickets > 0 ? 'bold' : 'dim'}`}>{o.wickets > 0 ? o.wickets : '–'}</td>
                <td className="num dim">{econ}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
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

const RunOutIcon    = ({ size = 18 }) => <img src="/runer-silhouette-running-fast.png" alt="run out" width={size} height={size} className="icon-png" style={{ verticalAlign: 'middle' }} />
const CatchingIcon  = ({ size = 18 }) => <img src="/catching.png"  alt="caught"  width={size} height={size} className="icon-png" style={{ verticalAlign: 'middle' }} />
const BowledPngIcon = ({ size = 18 }) => <img src="/cricket.png"   alt="bowled"  width={size} height={size} className="icon-png" style={{ verticalAlign: 'middle' }} />
const LBWIcon       = ({ size = 18 }) => <img src="/pads.png"      alt="lbw"     width={size} height={size} className="icon-png" style={{ verticalAlign: 'middle' }} />

const DISMISSAL_ICONS = {
  'Bowled': BowledPngIcon, 'Caught': CatchingIcon, 'CaughtAndBowled': HandCoins,
  'LBW': LBWIcon, 'Run out': RunOutIcon, 'RunOut': RunOutIcon, 'Stumped': Lock, 'Other': HelpCircle,
}
function formatDismissalLabel(type) {
  if (type === 'CaughtAndBowled') return 'Caught and Bowled'
  if (type === 'RunOut') return 'Run out'
  return type
}

// ── Phase analysis (powerplay / middle / death) ───────────────────────────────

function PhaseCard({ phases, scorecards, roles, fixture, dark }) {
  if (!phases?.length) return null
  const CC = dark ? CHART_COLOURS_DARK : CHART_COLOURS_LIGHT
  const getPhaseColor = inn => {
    const team = roles?.[inn.innings_order]?.batting_team
    return isWhcc(team) ? CC.whcc : CC.opp
  }
  const getPhaseLabel = inn => {
    const sc = scorecards.find(s => s.inningsOrder === inn.innings_order)
    const team = roles?.[inn.innings_order]?.batting_team
    if (team) return shortTeam(team)
    if (sc?.isManual) return inn.innings_order === 1 ? shortTeam(fixture.home_team || 'WHCC') : shortTeam(fixture.away_team || 'Opp')
    return `Innings ${inn.innings_order}`
  }

  const PHASE_ORDER = ['Powerplay', 'Middle', 'Death']
  const chartData = PHASE_ORDER.map(phaseName => {
    const row = { phase: phaseName }
    phases.forEach(inn => {
      const p = inn.phases.find(x => x.phase === phaseName)
      if (p) {
        const k = `inn${inn.innings_order}`
        row[k]         = p.runs
        row[`${k}w`]   = p.wickets
        row[`${k}rr`]  = p.run_rate
        row[`${k}ov`]  = p.from === p.to ? `Ov ${p.from}` : `Ov ${p.from}–${p.to}`
      }
    })
    return row
  }).filter(row => phases.some(inn => row[`inn${inn.innings_order}`] !== undefined))

  const PhaseTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: '0.82rem' }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
        {payload.map(p => {
          const k = p.dataKey
          return (
            <div key={k} style={{ color: p.fill, lineHeight: 1.7 }}>
              {p.name}: <strong>{p.value}r</strong> · {p.payload[`${k}w`]}w · {p.payload[`${k}rr`]} rpo
              <span style={{ color: 'var(--text3)', marginLeft: 4 }}>({p.payload[`${k}ov`]})</span>
            </div>
          )
        })}
      </div>
    )
  }

  const WktsLabel = ({ x, y, width, height, value }) => {
    if (!value || height < 18) return null
    return (
      <text x={x + width / 2} y={y + Math.min(height - 6, 15)} textAnchor="middle"
            fontSize={10} fill="rgba(255,255,255,0.85)" fontWeight={500}>
        {value}w
      </text>
    )
  }

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ marginBottom: '0.75rem' }}>Phase Analysis</h3>
      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={chartData} barCategoryGap="28%" barGap={3}
                  margin={{ top: 12, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
          <XAxis dataKey="phase" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <Tooltip content={<PhaseTooltip />} cursor={{ fill: 'var(--bg2)', opacity: 0.5 }} />
          {phases.length > 1 && (
            <Legend formatter={(_, entry) => {
              const inn = phases.find(i => `inn${i.innings_order}` === entry.dataKey)
              return inn ? getPhaseLabel(inn) : entry.value
            }} wrapperStyle={{ fontSize: '0.78rem', paddingTop: 4 }} />
          )}
          {phases.map(inn => (
            <Bar key={inn.innings_order} dataKey={`inn${inn.innings_order}`}
                 name={getPhaseLabel(inn)} fill={getPhaseColor(inn)} radius={[3, 3, 0, 0]}>
              <LabelList content={<WktsLabel />} dataKey={`inn${inn.innings_order}w`} />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function DismissalSummary({ methods }) {
  return (
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
  )
}
