import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import {
  Calendar,
  MapPin,
  Trophy,
  Pencil,
  HelpCircle,
  RefreshCw,
  ExternalLink,
  Trash2,
  BarChart2
} from 'lucide-react'
import Breadcrumbs from '../components/Breadcrumbs'
import { useApiFetch } from '../hooks/useApiFetch'
import { dn, shortTeam, isWhccTeam as isWhcc, netScore, formatDateShort } from '../utils/cricket'
import { Skeleton, SkeletonRow } from '../components/Skeleton'
import MatchFlow from '../components/MatchFlow'
import InningsRoles from '../components/InningsRoles'
import {
  BattingTable,
  BowlingTable,
  OversGrid,
  OversTable,
  formatDismissalLabel,
  DISMISSAL_ICONS
} from '../components/ScorecardTables'
import { ResultEditor, DeliveryEditor, PairBlockEditor } from '../components/MatchEditors'
import MatchCharts from '../components/match/MatchCharts'
import IngestDetailPanel from '../components/match/IngestDetailPanel'
import MvpCard from '../components/match/MvpCard'

function getIsDark() {
  const attr = document.documentElement.getAttribute('data-theme')
  if (attr === 'dark') return true
  if (attr === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function computeManualResult(scorecards, fixture) {
  const whccSc = scorecards?.find((sc) => sc.inningsOrder === 1 && sc.isManual)
  const oppSc = scorecards?.find((sc) => sc.inningsOrder === 2 && sc.isManual)
  if (!whccSc || !oppSc) return null
  const whccTeam = shortTeam(isWhcc(fixture.home_team) ? fixture.home_team : fixture.away_team)
  const wr = whccSc.totals.runs,
    or = oppSc.totals.runs
  const diff = Math.abs(wr - or)
  if (wr > or) return { label: `${whccTeam} won by ${diff} run${diff === 1 ? '' : 's'}`, win: true }
  if (wr < or)
    return { label: `${whccTeam} lost by ${diff} run${diff === 1 ? '' : 's'}`, win: false }
  return { label: 'Tied', win: null }
}

function computePairsResult(whccTeam, whccSc, oppSc, fixture) {
  // Prefer the official fixture score (authoritative) over the ball-by-ball net, which can
  // understate when the delivery feed is incomplete. Falls back to the computed net.
  let wr = whccSc.totals.netTotal ?? whccSc.totals.runs
  let or = oppSc.totals.netTotal ?? oppSc.totals.runs
  if (fixture && fixture.home_score != null && fixture.home_score !== '') {
    const whccHome = whccTeam === fixture.home_team
    const whccRaw = whccHome ? fixture.home_score : fixture.away_score
    const whccWk = whccHome ? fixture.home_wickets : fixture.away_wickets
    const oppRaw = whccHome ? fixture.away_score : fixture.home_score
    const oppWk = whccHome ? fixture.away_wickets : fixture.home_wickets
    wr = netScore(whccRaw, whccWk, fixture.starting_score)
    or = netScore(oppRaw, oppWk, fixture.starting_score)
  }
  if (wr > or) return { label: `${whccTeam} won by ${wr - or} runs (net)`, win: true }
  if (wr < or) return { label: `${whccTeam} lost by ${or - wr} runs (net)`, win: false }
  return { label: 'Tied', win: null }
}

function computeStandardResult(whccTeam, whccFirst, whccSc, oppSc, maxWickets) {
  const wr = whccSc.totals.runs,
    or = oppSc.totals.runs
  const ww = whccSc.totals.wickets,
    ow = oppSc.totals.wickets
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

// Returns { label, win } e.g. { label: 'Team won by 4 wickets', win: true }
function computeResult(scorecards, roles, fixture) {
  if (!scorecards?.length || !roles) return null
  const sc1 = scorecards[0],
    sc2 = scorecards[1]
  if (!sc2) return null
  const t1 = roles[sc1.inningsOrder]?.batting_team
  const t2 = roles[sc2.inningsOrder]?.batting_team
  const whccFirst = isWhcc(t1),
    whccSecond = isWhcc(t2)
  if (!whccFirst && !whccSecond) return null

  const whccTeam = whccFirst ? t1 : t2
  const whccSc = whccFirst ? sc1 : sc2
  const oppSc = whccFirst ? sc2 : sc1

  if (sc1.isPairs) return computePairsResult(whccTeam, whccSc, oppSc, fixture)

  // max wickets = first-innings batter count - 1 (fall back to 10 for manual matches)
  const maxWickets = sc1.batting.length > 0 ? sc1.batting.length - 1 : 10
  return computeStandardResult(whccTeam, whccFirst, whccSc, oppSc, maxWickets)
}

function renderScoreBlocks(scorecards, roles, fixture) {
  const isManual = scorecards.some((sc) => sc.isManual)
  const isPairs = scorecards.some((sc) => sc.isPairs)
  if (isManual || isPairs) {
    const whccTeam = shortTeam(isWhcc(fixture.home_team) ? fixture.home_team : fixture.away_team)
    const oppTeam = shortTeam(isWhcc(fixture.home_team) ? fixture.away_team : fixture.home_team)
    return scorecards.map((sc, i) => {
      const battingTeam =
        roles?.[sc.inningsOrder]?.batting_team ||
        (sc.inningsOrder === 1 ? fixture.home_team : fixture.away_team)
      const teamLabel =
        isPairs && !isManual ? shortTeam(battingTeam) : sc.inningsOrder === 1 ? whccTeam : oppTeam
      const { runs, wickets, overs, netTotal } = sc.totals
      // For pairs, prefer the official fixture score (authoritative) over the
      // ball-by-ball net, which can understate when the delivery feed is incomplete.
      // This also keeps the headline consistent with the match list.
      let pairsScore = netTotal != null ? netTotal : runs
      if (isPairs && !isManual) {
        const isAway = battingTeam === fixture.away_team
        const officialRaw = isAway ? fixture.away_score : fixture.home_score
        const officialWkts = isAway ? fixture.away_wickets : fixture.home_wickets
        if (officialRaw != null && officialRaw !== '') {
          pairsScore = netScore(officialRaw, officialWkts, fixture.starting_score)
        }
      }
      return (
        <div key={i} className="score-block">
          <div className="score-label">{teamLabel}</div>
          {isPairs ? (
            <div className="score-value">{pairsScore}</div>
          ) : (
            <div className="score-value">
              {runs}/{wickets}
            </div>
          )}
          {overs && <div className="score-overs">({overs} ov)</div>}
        </div>
      )
    })
  }
  return [
    {
      label: shortTeam(fixture.home_team),
      score: fixture.home_score,
      wkts: fixture.home_wickets,
      overs: fixture.home_overs
    },
    {
      label: shortTeam(fixture.away_team),
      score: fixture.away_score,
      wkts: fixture.away_wickets,
      overs: fixture.away_overs
    }
  ]
    .filter((s) => s.score)
    .map((s, i) => (
      <div key={i} className="score-block">
        <div className="score-label">{s.label}</div>
        <div className="score-value">
          {s.score}
          {s.wkts ? `/${s.wkts}` : ' a/o'}
        </div>
        {s.overs && <div className="score-overs">({s.overs} ov)</div>}
      </div>
    ))
}

function renderInningsRoles(roles, scorecards, id, refreshRoles) {
  const entries = Object.entries(roles || {})
  const battingEntry = entries.find(([, v]) => isWhcc(v?.batting_team))
  const fieldingEntry = entries.find(([, v]) => !isWhcc(v?.batting_team))
  if (!battingEntry) return null
  const fieldingInningsOvers = fieldingEntry
    ? parseFloat(
        scorecards?.find((sc) => sc.inningsOrder === Number(fieldingEntry[0]))?.totals?.overs
      ) || null
    : null
  const whccSc = scorecards?.find((sc) => sc.inningsOrder === Number(battingEntry[0]))
  const fieldingSc = scorecards?.find(
    (sc) => sc.inningsOrder === (fieldingEntry ? Number(fieldingEntry[0]) : -1)
  )
  const activePids = new Set([
    ...(whccSc?.batting || []).map((b) => b.player_id).filter(Boolean),
    ...(fieldingSc?.bowling || []).map((b) => b.player_id).filter(Boolean),
    ...(fieldingEntry?.[1]?.wk_stints || []).map((s) => s.player_id)
  ])
  const alsoFielded = (battingEntry[1].players || []).filter((p) => !activePids.has(p.player_id))
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
}

function ScorecardTab({
  sc,
  i,
  fixture,
  roles,
  id,
  dn,
  canUpload,
  expandedOvers,
  toggleOvers,
  bowlingView,
  setBowlingView,
  setEditingBall,
  setEditingPairBlock
}) {
  const navigate = useNavigate()
  const whccBatted = sc.isManual
    ? sc.inningsOrder === 1
    : roles != null
      ? isWhcc(roles[sc.inningsOrder]?.batting_team)
      : null
  const showBatting = whccBatted !== false
  const showBowling = whccBatted !== true

  const ourTeam = shortTeam(isWhcc(fixture.home_team) ? fixture.home_team : fixture.away_team)
  const manualBattingTeam = sc.inningsOrder === 1 ? shortTeam(fixture.home_team) : ourTeam

  return (
    <div key={i}>
      <h2
        style={{
          marginBottom: '0.75rem',
          paddingBottom: '0.4rem',
          borderBottom: '1px solid var(--border)'
        }}
      >
        {sc.isManual
          ? sc.inningsOrder === 1
            ? `${manualBattingTeam} Batting`
            : `${ourTeam} Bowling`
          : whccBatted
            ? `${ourTeam} Batting`
            : `${ourTeam} Bowling`}
      </h2>

      {/* Totals row */}
      <div className="stat-row" style={{ marginBottom: '0.75rem' }}>
        {(sc.isPairs
          ? [
              { label: 'Net Score', value: sc.totals.netTotal },
              { label: 'Raw', value: sc.totals.runs },
              { label: 'Out', value: sc.totals.wickets },
              { label: 'Overs', value: sc.totals.overs }
            ]
          : [
              { label: 'Runs', value: sc.totals.runs },
              { label: 'Wickets', value: sc.totals.wickets },
              { label: 'Overs', value: sc.totals.overs },
              {
                label: 'Extras',
                value: Object.values(sc.totals.extras || {}).reduce((a, b) => a + b, 0)
              }
            ]
        ).map((s) => (
          <div key={s.label} className="stat-box">
            <div className="label">{s.label}</div>
            <div className="value">{s.value}</div>
          </div>
        ))}
        {!sc.isPairs &&
          Object.entries(sc.dismissalMethods || {})
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => {
              const Icon = DISMISSAL_ICONS[type] || HelpCircle
              return (
                <div key={type} className="stat-box">
                  <div
                    className="label"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 3
                    }}
                  >
                    <Icon size={11} />
                    {formatDismissalLabel(type)}
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
      {sc.isManual &&
        sc.totals.extras &&
        (sc.totals.extras.byes > 0 || sc.totals.extras.legByes > 0) && (
          <div style={{ fontSize: '0.82rem', color: 'var(--text2)', marginBottom: '1.25rem' }}>
            {sc.totals.extras.byes > 0 && `b ${sc.totals.extras.byes}`}
            {sc.totals.extras.byes > 0 && sc.totals.extras.legByes > 0 && ' · '}
            {sc.totals.extras.legByes > 0 && `lb ${sc.totals.extras.legByes}`}
          </div>
        )}

      {showBatting && (
        <>
          <h3>Batting</h3>
          <BattingTable
            batting={sc.batting}
            navigate={navigate}
            isPairs={sc.isPairs}
            dn={dn}
            matchId={id}
          />
        </>
      )}

      {showBowling && (
        <>
          <h3 style={{ marginTop: showBatting ? '1.25rem' : 0 }}>Bowling</h3>
          <BowlingTable
            bowling={sc.bowling}
            navigate={navigate}
            isManual={sc.isManual}
            dn={dn}
            matchId={id}
          />
        </>
      )}

      {sc.isManual && sc.fielding?.length > 0 && (
        <>
          <h3 style={{ marginTop: '1.25rem' }}>Fielding</h3>
          <table className="scorecard-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Player</th>
                <th>Ct</th>
                <th>St</th>
                <th>RO</th>
              </tr>
            </thead>
            <tbody>
              {sc.fielding.map((f, fi) => (
                <tr key={fi}>
                  <td>{dn(f.name)}</td>
                  <td style={{ textAlign: 'center' }}>{f.catches || '—'}</td>
                  <td style={{ textAlign: 'center' }}>{f.stumpings || '—'}</td>
                  <td style={{ textAlign: 'center' }}>{f.run_outs || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Over-by-over — expandable, only for ingested matches */}
      {!sc.isManual && (
        <div style={{ marginTop: '1rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              className="secondary"
              style={{ fontSize: '0.82rem', padding: '4px 12px' }}
              onClick={() => toggleOvers(i)}
            >
              {expandedOvers[i] ? '▲ Hide overs' : '▼ Show over-by-over'}
            </button>
            {expandedOvers[i] && (
              <div style={{ display: 'flex', gap: '4px' }}>
                {['grid', 'table'].map((v) => (
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
              {bowlingView === 'table' ? (
                <OversTable overs={sc.overs} dn={dn} />
              ) : (
                <OversGrid
                  overs={sc.overs}
                  dn={dn}
                  isPairs={sc.isPairs}
                  onEditBall={canUpload ? (b) => setEditingBall({ ...b, inningsOrder: sc.inningsOrder }) : null}
                  onReassignPair={
                    canUpload && sc.isPairs
                      ? (block) => setEditingPairBlock({ ...block, inningsOrder: sc.inningsOrder })
                      : null
                  }
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function MatchDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useUser()
  const canUpload = user?.publicMetadata?.canUpload === true
  const [data, setData] = useState(null)
  const [roles, setRoles] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedOvers, setExpandedOvers] = useState({})
  const [bowlingView, setBowlingView] = useState(
    () => localStorage.getItem('bowlingView') || 'grid'
  )
  const [reingesting, setReingesting] = useState(false)
  const [reingestMsg, setReingestMsg] = useState(null)
  const [availTeams, setAvailTeams] = useState(null)
  const [assocTeamKey, setAssocTeamKey] = useState('')
  const [associating, setAssociating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const [editingBall, setEditingBall] = useState(null)
  const [editingPairBlock, setEditingPairBlock] = useState(null)
  const [editingResult, setEditingResult] = useState(false)
  const [dark, setDark] = useState(getIsDark)
  const apiFetch = useApiFetch()

  const loadMatch = useCallback(() => {
    apiFetch(`/api/matches/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadMatch()
  }, [loadMatch])

  useEffect(() => {
    const update = () => setDark(getIsDark())
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    })
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', update)
    return () => {
      observer.disconnect()
      mq.removeEventListener('change', update)
    }
  }, [])

  const refreshRoles = useCallback(() => {
    apiFetch(`/api/matches/${id}/roles`)
      .then((r) => r.json())
      .then(setRoles)
      .catch(() => {})
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refreshRoles()
  }, [refreshRoles])

  async function deleteMatch() {
    if (!window.confirm('Delete this match and all its data? This cannot be undone.')) return
    setDeleting(true)
    try {
      const res = await apiFetch(`/api/admin/match/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error || 'Delete failed')
      }
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
        body: JSON.stringify({
          url: `https://whcc.play-cricket.com/website/results/${playCricketId}`
        })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Re-ingest failed')
      if (json.associated) {
        setReingestMsg({
          ok: true,
          text: `Re-ingested and linked to team ${json.associated.team_id} / season ${json.associated.season_id}`
        })
      } else {
        setReingestMsg({
          ok: true,
          text: 'Re-ingested — team not auto-detected, select below to link for access control'
        })
        // Load available teams for manual association
        apiFetch('/api/admin/teams')
          .then((r) => r.json())
          .then((ts) => {
            setAvailTeams(ts)
            setAssocTeamKey(ts[0] ? `${ts[0].team_id}:${ts[0].season_id}` : '')
          })
      }
      loadMatch()
      refreshRoles()
    } catch (e) {
      setReingestMsg({ ok: false, text: e.message })
    } finally {
      setReingesting(false)
    }
  }

  async function recalculateScore() {
    setRecalculating(true)
    try {
      const res = await apiFetch(`/api/admin/match/${id}/recalculate-score`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Recalculate failed')
      loadMatch()
    } catch (e) {
      alert(e.message)
    } finally {
      setRecalculating(false)
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
        body: JSON.stringify({ fixture_id: data.fixture.fixture_id, team_id, season_id })
      })
      if (!r.ok) throw new Error((await r.json()).error)
      setAvailTeams(null)
      setReingestMsg({ ok: true, text: 'Match linked to team successfully' })
    } catch (e) {
      setReingestMsg({ ok: false, text: e.message })
    }
    setAssociating(false)
  }

  if (loading)
    return (
      <div className="page">
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <Skeleton height="1.6rem" width="55%" />
          <div style={{ marginTop: '0.6rem', display: 'flex', gap: '1rem' }}>
            <Skeleton height="0.8rem" width="6rem" />
            <Skeleton height="0.8rem" width="8rem" />
            <Skeleton height="0.8rem" width="7rem" />
          </div>
          <div style={{ marginTop: '0.5rem' }}>
            <Skeleton height="1.2rem" width="10rem" />
          </div>
        </div>
        <div className="card" style={{ marginBottom: '1.5rem', height: '220px' }} />
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ marginBottom: '0.75rem' }}>Batting</h2>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table>
              <tbody>
                {Array.from({ length: 7 }).map((_, i) => (
                  <SkeletonRow key={i} cols={9} />
                ))}
              </tbody>
            </table>
          </div>
          <h2 style={{ marginTop: '1.25rem', marginBottom: '0.75rem' }}>Bowling</h2>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table>
              <tbody>
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonRow key={i} cols={8} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  if (!data?.fixture) return <div className="loading">Match not found.</div>

  const { fixture, scorecards } = data

  function toggleOvers(i) {
    setExpandedOvers((prev) => ({ ...prev, [i]: !prev[i] }))
  }

  return (
    <div className="page">
      <Breadcrumbs
        items={[
          { label: 'Matches', href: '/' },
          {
            label: fixture
              ? `${shortTeam(fixture.home_team)} vs ${shortTeam(fixture.away_team)}`
              : 'Match Detail'
          }
        ]}
      />
      <div
        style={{
          display: 'flex',
          gap: '8px',
          marginBottom: reingestMsg ? '0.5rem' : '1rem',
          flexWrap: 'wrap',
          alignItems: 'center'
        }}
      >
        {canUpload && scorecards.some((sc) => sc.isManual) && (
          <button
            className="secondary"
            style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => navigate(`/manual/${id}`)}
          >
            <Pencil size={13} /> Edit
          </button>
        )}
        {canUpload && fixture.play_cricket_id && (
          <button
            className="secondary"
            style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => reingest(fixture.play_cricket_id)}
            disabled={reingesting}
          >
            <RefreshCw
              size={13}
              style={reingesting ? { animation: 'spin 1s linear infinite' } : {}}
            />
            {reingesting ? 'Re-ingesting…' : 'Re-ingest'}
          </button>
        )}
        {fixture.last_ingested_at && (
          <span style={{ fontSize: '0.72rem', color: 'var(--text3)' }}>
            Ingested{' '}
            {new Date(fixture.last_ingested_at).toLocaleString('en-GB', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            })}
            {fixture.last_ingested_by && ` by ${fixture.last_ingested_by}`}
          </span>
        )}
        {fixture.play_cricket_id && (
          <a
            href={`https://whcc.play-cricket.com/website/results/${fixture.play_cricket_id}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: 'var(--text2)',
              marginLeft: 'auto'
            }}
          >
            <ExternalLink size={13} /> play-cricket
          </a>
        )}
        {canUpload && (
          <button
            className="secondary"
            style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={() => setEditingResult(true)}
          >
            <Pencil size={13} /> Result
          </button>
        )}
        {canUpload && (
          <button
            className="secondary"
            style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={recalculateScore}
            disabled={recalculating}
            title="Recalculate home/away score from ball-by-ball delivery data"
          >
            <BarChart2 size={13} /> {recalculating ? 'Recalculating…' : 'Recalc score'}
          </button>
        )}
        {canUpload && (
          <button
            className="secondary"
            style={{
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              color: 'var(--red)',
              borderColor: 'var(--red)'
            }}
            onClick={deleteMatch}
            disabled={deleting}
          >
            <Trash2 size={13} /> {deleting ? 'Deleting…' : 'Delete'}
          </button>
        )}
      </div>
      {reingestMsg && (
        <div
          className={`alert ${reingestMsg.ok ? 'alert-success' : 'alert-error'}`}
          style={{ marginBottom: availTeams ? '0.5rem' : '1rem' }}
        >
          {reingestMsg.text}
        </div>
      )}
      {availTeams && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            marginBottom: '1rem',
            flexWrap: 'wrap'
          }}
        >
          <span style={{ fontSize: '0.85rem', color: 'var(--text2)' }}>Link to team:</span>
          <select
            value={assocTeamKey}
            onChange={(e) => setAssocTeamKey(e.target.value)}
            style={{ fontSize: '0.85rem' }}
          >
            {availTeams.map((t) => {
              const k = `${t.team_id}:${t.season_id}`
              const lbl = t.year ? `${t.label} ${t.year}` : t.label
              return (
                <option key={k} value={k}>
                  {lbl}
                </option>
              )
            })}
          </select>
          <button onClick={associateTeam} disabled={associating} style={{ fontSize: '0.85rem' }}>
            {associating ? 'Linking…' : 'Link'}
          </button>
          <button
            className="secondary"
            onClick={() => setAvailTeams(null)}
            style={{ fontSize: '0.85rem' }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Match header */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="match-header-top">
          <div style={{ minWidth: 0 }}>
            <h1 style={{ marginBottom: '0' }}>
              {shortTeam(fixture.home_team) || 'Home'}{' '}
              <span style={{ fontWeight: 300, color: 'var(--text3)' }}>vs</span>{' '}
              {shortTeam(fixture.away_team) || 'Away'}
            </h1>
            <div className="match-header-meta">
              {fixture.match_date && (
                <span>
                  <Calendar size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  {formatDateShort(fixture.match_date) || fixture.match_date}
                </span>
              )}
              {fixture.ground && (
                <span>
                  <MapPin size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  {fixture.ground}
                </span>
              )}
            </div>
            {fixture.competition && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: '0.8rem',
                  color: 'var(--text2)',
                  marginTop: '0.2rem'
                }}
              >
                <Trophy size={13} />
                {fixture.competition}
              </div>
            )}
          </div>
          <div style={{ flexShrink: 0, textAlign: 'right' }}>
            <div
              className="match-result-line"
              style={{ justifyContent: 'flex-end', marginTop: 0, marginBottom: '0.5rem' }}
            >
              {(() => {
                const r =
                  computeManualResult(scorecards, fixture) ||
                  computeResult(scorecards, roles, fixture)
                if (r)
                  return (
                    <span
                      className={`tag ${r.win === true ? 'tag-green' : r.win === false ? 'tag-red' : ''}`}
                    >
                      {shortTeam(r.label)}
                    </span>
                  )
                if (fixture.result)
                  return (
                    <span className={`tag ${isWhcc(fixture.result) ? 'tag-green' : 'tag-red'}`}>
                      {shortTeam(fixture.result)}
                    </span>
                  )
                return null
              })()}
            </div>
            <div className="score-blocks" style={{ marginTop: 0 }}>
              {renderScoreBlocks(scorecards, roles, fixture)}
            </div>
          </div>
        </div>

        {/* WHCC captain / WK for this match */}
        {renderInningsRoles(roles, scorecards, id, refreshRoles)}
      </div>

      <MatchCharts
        scorecards={scorecards}
        roles={roles}
        fixture={fixture}
        partnerships={data.partnerships || []}
        phases={data.phases || []}
        dn={dn}
        dark={dark}
      />
      <MatchFlow scorecards={scorecards} roles={roles} dn={dn} isWhcc={isWhcc} fixture={fixture} />
      {data.mvp?.length > 0 && <MvpCard mvp={data.mvp} meta={data.mvpMeta} dn={dn} />}

      {/* Innings — shown in sequence, traditional scorecard style */}
      {scorecards.map((sc, i) => (
        <ScorecardTab
          key={i}
          sc={sc}
          i={i}
          fixture={fixture}
          roles={roles}
          id={id}
          dn={dn}
          canUpload={canUpload}
          expandedOvers={expandedOvers}
          toggleOvers={toggleOvers}
          bowlingView={bowlingView}
          setBowlingView={setBowlingView}
          setEditingBall={setEditingBall}
          setEditingPairBlock={setEditingPairBlock}
        />
      ))}
      {editingBall && (
        <DeliveryEditor
          ball={editingBall}
          fixtureId={id}
          matchPlayers={data.matchPlayers || []}
          inningsPlayers={data.inningsPlayers || {}}
          onClose={() => setEditingBall(null)}
          onSaved={() => {
            setEditingBall(null)
            loadMatch()
          }}
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
          onSaved={() => {
            setEditingPairBlock(null)
            loadMatch()
          }}
        />
      )}
      {editingResult && (
        <ResultEditor
          fixture={fixture}
          fixtureId={id}
          onClose={() => setEditingResult(false)}
          onSaved={() => {
            setEditingResult(false)
            loadMatch()
          }}
        />
      )}
      {user?.publicMetadata?.isSuperAdmin && <IngestDetailPanel fixtureId={id} />}
    </div>
  )
}
