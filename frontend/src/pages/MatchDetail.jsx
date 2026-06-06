import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { Calendar, MapPin, Trophy, ChevronLeft, Pencil, HelpCircle, RefreshCw, ExternalLink, Trash2 } from 'lucide-react'
import Breadcrumbs from '../components/Breadcrumbs'
import { BarChart, Bar, LabelList, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { useApiFetch } from '../hooks/useApiFetch'
import { dn, shortTeam, isWhccTeam as isWhcc, netScore } from '../utils/cricket'
import { Skeleton, SkeletonRow } from '../components/Skeleton'
import MatchFlow from '../components/MatchFlow'
import InningsRoles from '../components/InningsRoles'
import { BattingTable, BowlingTable, OversGrid, OversTable, formatDismissalLabel, DISMISSAL_ICONS } from '../components/ScorecardTables'
import { ResultEditor, DeliveryEditor, PairBlockEditor } from '../components/MatchEditors'


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
function computeResult(scorecards, roles, fixture) {
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
    // Prefer the official fixture score (authoritative) over the ball-by-ball net, which can
    // understate when the delivery feed is incomplete. Falls back to the computed net.
    let wr = whccSc.totals.netTotal ?? whccSc.totals.runs
    let or = oppSc.totals.netTotal ?? oppSc.totals.runs
    if (fixture && fixture.home_score != null && fixture.home_score !== '') {
      const whccHome = whccTeam === fixture.home_team
      const whccRaw = whccHome ? fixture.home_score : fixture.away_score
      const whccWk  = whccHome ? fixture.home_wickets : fixture.away_wickets
      const oppRaw  = whccHome ? fixture.away_score : fixture.home_score
      const oppWk   = whccHome ? fixture.away_wickets : fixture.home_wickets
      wr = netScore(whccRaw, whccWk, fixture.starting_score)
      or = netScore(oppRaw, oppWk, fixture.starting_score)
    }
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
  const [reingesting,   setReingesting]   = useState(false)
  const [reingestMsg,   setReingestMsg]   = useState(null)
  const [availTeams,    setAvailTeams]    = useState(null)
  const [assocTeamKey,  setAssocTeamKey]  = useState('')
  const [associating,   setAssociating]   = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [editingBall, setEditingBall] = useState(null)
  const [editingPairBlock, setEditingPairBlock] = useState(null)
  const [editingResult, setEditingResult] = useState(false)
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
    setAvailTeams(null)
    try {
      const res = await apiFetch('/api/admin/fetch-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `https://whcc.play-cricket.com/website/results/${playCricketId}` }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Re-ingest failed')
      if (json.associated) {
        setReingestMsg({ ok: true, text: `Re-ingested and linked to team ${json.associated.team_id} / season ${json.associated.season_id}` })
      } else {
        setReingestMsg({ ok: true, text: 'Re-ingested — team not auto-detected, select below to link for access control' })
        // Load available teams for manual association
        apiFetch('/api/admin/teams').then(r => r.json()).then(ts => { setAvailTeams(ts); setAssocTeamKey(ts[0] ? `${ts[0].team_id}:${ts[0].season_id}` : '') })
      }
      loadMatch()
      refreshRoles()
    } catch (e) {
      setReingestMsg({ ok: false, text: e.message })
    } finally {
      setReingesting(false)
    }
  }

  async function associateTeam() {
    if (!assocTeamKey || !data?.fixture) return
    const [team_id, season_id] = assocTeamKey.split(':')
    setAssociating(true)
    try {
      const r = await apiFetch('/api/admin/associate-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixture_id: data.fixture.fixture_id, team_id, season_id }),
      })
      if (!r.ok) throw new Error((await r.json()).error)
      setAvailTeams(null)
      setReingestMsg({ ok: true, text: 'Match linked to team successfully' })
    } catch (e) {
      setReingestMsg({ ok: false, text: e.message })
    }
    setAssociating(false)
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

  function toggleOvers(i) {
    setExpandedOvers(prev => ({ ...prev, [i]: !prev[i] }))
  }

  return (
    <div className="page">
      <Breadcrumbs items={[
        { label: 'Matches', href: '/' },
        { label: `${shortTeam(fixture?.home_team)} vs ${shortTeam(fixture?.away_team)}` }
      ]} />
      <div style={{ display: 'flex', gap: '8px', marginBottom: reingestMsg ? '0.5rem' : '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
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
          <button className="secondary" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => setEditingResult(true)}>
            <Pencil size={13} /> Result
          </button>
        )}
        {canUpload && (
          <button className="secondary" style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4, color: 'var(--red)', borderColor: 'var(--red)' }}
            onClick={deleteMatch} disabled={deleting}>
            <Trash2 size={13} /> {deleting ? 'Deleting…' : 'Delete'}
          </button>
        )}
      </div>
      {reingestMsg && (
        <div className={`alert ${reingestMsg.ok ? 'alert-success' : 'alert-error'}`} style={{ marginBottom: availTeams ? '0.5rem' : '1rem' }}>
          {reingestMsg.text}
        </div>
      )}
      {availTeams && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--text2)' }}>Link to team:</span>
          <select value={assocTeamKey} onChange={e => setAssocTeamKey(e.target.value)} style={{ fontSize: '0.85rem' }}>
            {availTeams.map(t => {
              const k = `${t.team_id}:${t.season_id}`
              const lbl = t.year ? `${t.label} ${t.year}` : t.label
              return <option key={k} value={k}>{lbl}</option>
            })}
          </select>
          <button onClick={associateTeam} disabled={associating} style={{ fontSize: '0.85rem' }}>
            {associating ? 'Linking…' : 'Link'}
          </button>
          <button className="secondary" onClick={() => setAvailTeams(null)} style={{ fontSize: '0.85rem' }}>Dismiss</button>
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
                const r = computeManualResult(scorecards, fixture) || computeResult(scorecards, roles, fixture)
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
                  const battingTeam = roles?.[sc.inningsOrder]?.batting_team || (sc.inningsOrder === 1 ? fixture.home_team : fixture.away_team)
                  const teamLabel = isPairs && !isManual
                    ? shortTeam(battingTeam)
                    : (sc.inningsOrder === 1 ? whccTeam : oppTeam)
                  const { runs, wickets, overs, netTotal } = sc.totals
                  // For pairs, prefer the official fixture score (authoritative) over the
                  // ball-by-ball net, which can understate when the delivery feed is incomplete.
                  // This also keeps the headline consistent with the match list.
                  let pairsScore = netTotal != null ? netTotal : runs
                  if (isPairs && !isManual) {
                    const isAway = battingTeam === fixture.away_team
                    const officialRaw  = isAway ? fixture.away_score   : fixture.home_score
                    const officialWkts = isAway ? fixture.away_wickets : fixture.home_wickets
                    if (officialRaw != null && officialRaw !== '') {
                      pairsScore = netScore(officialRaw, officialWkts, fixture.starting_score)
                    }
                  }
                  return (
                    <div key={i} className="score-block">
                      <div className="score-label">{teamLabel}</div>
                      {isPairs
                        ? <div className="score-value">{pairsScore}</div>
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

          {sc.isManual && sc.fielding?.length > 0 && <>
            <h3 style={{ marginTop: '1.25rem' }}>Fielding</h3>
            <table className="scorecard-table">
              <thead><tr>
                <th style={{ textAlign: 'left' }}>Player</th>
                <th>Ct</th>
                <th>St</th>
                <th>RO</th>
              </tr></thead>
              <tbody>
                {sc.fielding.map((f, i) => (
                  <tr key={i}>
                    <td>{dn(f.name)}</td>
                    <td style={{ textAlign: 'center' }}>{f.catches  || '—'}</td>
                    <td style={{ textAlign: 'center' }}>{f.stumpings || '—'}</td>
                    <td style={{ textAlign: 'center' }}>{f.run_outs  || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                    : <OversGrid overs={sc.overs} dn={dn} isPairs={sc.isPairs}
                        onEditBall={canUpload ? (b) => setEditingBall(b) : null}
                        onReassignPair={canUpload && sc.isPairs ? (block) => setEditingPairBlock({ ...block, inningsOrder: sc.inningsOrder }) : null} />
                  }
                </div>
              )}
            </div>
          )}
        </div>
        )
      })}
      {editingBall && (
        <DeliveryEditor
          ball={editingBall}
          fixtureId={id}
          matchPlayers={data.matchPlayers || []}
          onClose={() => setEditingBall(null)}
          onSaved={() => { setEditingBall(null); loadMatch() }}
        />
      )}
      {editingPairBlock && (
        <PairBlockEditor
          fixtureId={id}
          inningsOrder={editingPairBlock.inningsOrder}
          overStart={editingPairBlock.overStart}
          overEnd={editingPairBlock.overEnd}
          currentPlayerIds={editingPairBlock.currentPlayerIds}
          matchPlayers={data.matchPlayers || []}
          onClose={() => setEditingPairBlock(null)}
          onSaved={() => { setEditingPairBlock(null); loadMatch() }}
        />
      )}
      {editingResult && (
        <ResultEditor
          fixture={fixture}
          fixtureId={id}
          onClose={() => setEditingResult(false)}
          onSaved={() => { setEditingResult(false); loadMatch() }}
        />
      )}
      {user?.publicMetadata?.isSuperAdmin && <IngestDetailPanel fixtureId={id} />}
    </div>
  )
}

// ── Admin: ingest detail (super-admin only) ──────────────────────────────────

function IngestDetailPanel({ fixtureId }) {
  const [open,  setOpen]  = useState(false)
  const [data,  setData]  = useState(null)
  const [error, setError] = useState(null)
  const apiFetch = useApiFetch()

  useEffect(() => {
    if (!open || data) return
    apiFetch(`/api/admin/match/${fixtureId}`)
      .then(r => r.json())
      .then(setData)
      .catch(e => setError(e.message))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const ts = ms => ms ? new Date(Number(ms)).toISOString().replace('T', ' ').slice(0, 19) : '—'

  return (
    <div className="card" style={{ marginTop: '2rem', fontSize: '0.82rem', color: 'var(--text2)' }}>
      <button
        className="secondary"
        style={{ fontSize: '0.82rem', width: '100%', textAlign: 'left' }}
        onClick={() => setOpen(o => !o)}
      >
        {open ? '▾' : '▸'} Admin: ingest detail
      </button>
      {open && (
        <div style={{ marginTop: '0.75rem' }}>
          {error && <p style={{ color: 'var(--red)' }}>{error}</p>}
          {!data && !error && <p>Loading…</p>}
          {data && (
            <>
              <section style={{ marginBottom: '1rem' }}>
                <strong>Fixture</strong>
                <table style={{ marginTop: 4, borderCollapse: 'collapse', width: '100%' }}>
                  <tbody>
                    {[
                      ['fixture_id', data.fixture.fixture_id],
                      ['play_cricket_id', data.fixture.play_cricket_id ?? '—'],
                      ['format', data.fixture.format ?? '—'],
                      ['competition', data.fixture.competition ?? '—'],
                      ['result', data.fixture.result ?? '—'],
                    ].map(([k, v]) => (
                      <tr key={k}>
                        <td style={{ paddingRight: 16, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{k}</td>
                        <td>{String(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section style={{ marginBottom: '1rem' }}>
                <strong>Scheduled fixtures</strong>
                {data.scheduled.length === 0 ? <p style={{ marginTop: 4 }}>None</p> : data.scheduled.map((sf, i) => (
                  <table key={i} style={{ marginTop: 4, borderCollapse: 'collapse', width: '100%' }}>
                    <tbody>
                      {[
                        ['team', `${sf.team_label ?? sf.team_id} / ${sf.season_year ?? sf.season_id}`],
                        ['status', sf.status],
                        ['attempts', sf.attempt_count ?? 0],
                        ['ingest_after', sf.ingest_after ?? '—'],
                        ['ingested_at', sf.ingested_at ?? '—'],
                        ['cron_job_id', sf.cron_job_id ?? '—'],
                        ['error_msg', sf.error_msg ?? '—'],
                      ].map(([k, v]) => (
                        <tr key={k}>
                          <td style={{ paddingRight: 16, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{k}</td>
                          <td style={{ color: k === 'error_msg' && v !== '—' ? 'var(--red)' : undefined }}>{String(v)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ))}
              </section>

              <section style={{ marginBottom: '1rem' }}>
                <strong>Team/season associations</strong>
                {data.associations.length === 0
                  ? <p style={{ marginTop: 4, color: 'var(--orange)' }}>None — match is invisible to scoped users</p>
                  : <ul style={{ marginTop: 4, paddingLeft: 16 }}>
                      {data.associations.map((a, i) => (
                        <li key={i}>{a.team_label ?? a.team_id} · {a.season_year ?? a.season_id}</li>
                      ))}
                    </ul>
                }
              </section>

              <section>
                <strong>Ingest log</strong>
                {data.ingests.length === 0 ? <p style={{ marginTop: 4 }}>None</p> : (
                  <table style={{ marginTop: 4, borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                      <tr>
                        {['#', 'when', 'by', 'sources', 'counts'].map(h => (
                          <th key={h} style={{ textAlign: 'left', paddingRight: 12, color: 'var(--text3)', fontWeight: 500 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.ingests.map(ig => (
                        <tr key={ig.id}>
                          <td style={{ paddingRight: 12 }}>{ig.id}</td>
                          <td style={{ paddingRight: 12, whiteSpace: 'nowrap' }}>{ts(ig.ingested_at)}</td>
                          <td style={{ paddingRight: 12 }}>{ig.clerk_user_name ?? ig.clerk_user_id ?? 'system'}</td>
                          <td style={{ paddingRight: 12 }}>{ig.source_files ? JSON.parse(ig.source_files).join(', ') : '—'}</td>
                          <td>{ig.row_counts ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
        </div>
      )}
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
    const { x, y, width, value: over } = labelProps
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

      {tab === 'manhattan' && (() => {
        // Compute lower bound so wicket-dot circles on negative bars aren't clipped
        let manhattanMin = 0
        let maxWktsAtMin = 0
        for (const row of manhattanData) {
          for (const sc of charted) {
            const val = row[`inn${sc.inningsOrder}`]
            if (val != null && val < manhattanMin) {
              manhattanMin = val
              maxWktsAtMin = row[`wkt${sc.inningsOrder}`] || 0
            } else if (val != null && val === manhattanMin) {
              maxWktsAtMin = Math.max(maxWktsAtMin, row[`wkt${sc.inningsOrder}`] || 0)
            }
          }
        }
        // Each wicket dot is 8px apart + 5px gap; chart ~185px, rough estimate 4px per data unit
        const dotBuffer = maxWktsAtMin > 0 ? Math.ceil((5 + (maxWktsAtMin - 1) * 8) / 4) : 0
        const yDomainMin = manhattanMin < 0 ? manhattanMin - dotBuffer : 0
        return (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={manhattanData} margin={{ top: 4, right: 4, bottom: 0, left: -16 }} barCategoryGap="20%">
            <CartesianGrid {...gridProps} vertical={false} />
            <XAxis dataKey="over" tick={axisStyle} />
            <YAxis tick={axisStyle} domain={[yDomainMin, 'auto']} />
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
              <Bar key={sc.inningsOrder} dataKey={`inn${sc.inningsOrder}`} name={getLabel(sc)} fill={getColor(sc)} radius={[2, 2, 0, 0]} minPointSize={1}>
                <LabelList dataKey="over" content={makeWicketDots(sc)} />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
        )
      })()}

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

// ── Phase analysis (powerplay / middle / death) ───────────────────────────────


