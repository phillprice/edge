import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { useApiFetch } from '../hooks/useApiFetch'

const WHCC = ['woking', 'horsell', 'whcc', 'whirlwind']
function isWhccTeam(name) { return WHCC.some(k => (name||'').toLowerCase().includes(k)) }

function netScore(rawScore, wickets, startingScore) {
  return Number(rawScore) + (startingScore || 0) - (Number(wickets) || 0) * 5
}

function computeResultPhrase(m) {
  const { home_team, away_team, home_score, home_wickets, away_score, away_wickets,
          toss_winner, toss_decision, format, starting_score } = m
  const whccTeam = isWhccTeam(home_team) ? home_team : isWhccTeam(away_team) ? away_team : null
  if (!whccTeam || !home_score || !away_score) return m.result

  const isWhccHome = isWhccTeam(home_team)

  if (format === 'pairs') {
    const wr = netScore(isWhccHome ? home_score : away_score, isWhccHome ? home_wickets : away_wickets, starting_score)
    const or = netScore(isWhccHome ? away_score : home_score, isWhccHome ? away_wickets : home_wickets, starting_score)
    if (isNaN(wr) || isNaN(or)) return m.result
    if (wr > or) return `${whccTeam} won by ${wr - or} runs (net)`
    if (wr < or) return `${whccTeam} lost by ${or - wr} runs (net)`
    return 'Tied'
  }

  if (!toss_winner || !toss_decision) return m.result
  const dec = toss_decision.toLowerCase()
  const batFirst = dec === 'bat' ? toss_winner : (toss_winner === home_team ? away_team : home_team)
  const whccFirst = isWhccTeam(batFirst)

  const wr = Number(isWhccHome ? home_score : away_score)
  const ww = isWhccHome ? home_wickets : away_wickets
  const or = Number(isWhccHome ? away_score : home_score)
  const ow = isWhccHome ? away_wickets : home_wickets
  if (isNaN(wr) || isNaN(or)) return m.result

  if (wr > or) {
    if (!whccFirst) {
      const n = 10 - (ww ? Number(ww) : 10)
      return `${whccTeam} won by ${n} wicket${n === 1 ? '' : 's'}`
    }
    const n = wr - or
    return `${whccTeam} won by ${n} run${n === 1 ? '' : 's'}`
  }
  if (wr < or) {
    if (!whccFirst) {
      const n = or - wr
      return `${whccTeam} lost by ${n} run${n === 1 ? '' : 's'}`
    }
    const n = 10 - (ow ? Number(ow) : 10)
    return `${whccTeam} lost by ${n} wicket${n === 1 ? '' : 's'}`
  }
  return 'Tied'
}

function formatScore(score, wickets, overs, format, startingScore) {
  if (!score) return null
  if (format === 'pairs') {
    const net = netScore(score, wickets, startingScore)
    return `Net ${net} (${overs} ov)`
  }
  const wkt = wickets ? `/${wickets}` : ' a/o'
  return `${score}${wkt} (${overs} ov)`
}

export default function MatchList() {
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const apiFetch = useApiFetch()
  const { user } = useUser()
  const canUpload = user?.publicMetadata?.canUpload === true

  useEffect(() => {
    apiFetch('/api/matches')
      .then(r => r.json())
      .then(d => { setMatches(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="loading">Loading matches…</div>

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ marginBottom: 0 }}>Matches</h1>
        {canUpload && <button onClick={() => navigate('/ingest')}>+ Upload match</button>}
      </div>

      {matches.length === 0 ? (
        <div className="card">
          <div className="empty">No matches yet. Upload a scorecard PDF and innings JSON files to get started.</div>
        </div>
      ) : (
        <div className="match-list">
          {matches.map(m => {
            const isManual = m.total_deliveries === 0 && m.manual_runs !== null
            return (
              <div key={m.fixture_id} className="match-card" onClick={() => navigate(`/match/${m.fixture_id}`)}>
                <div>
                  <div className="match-teams">
                    <span style={{ fontWeight: isWhccTeam(m.home_team) ? 700 : 400 }}>{m.home_team || 'Home'}</span>
                    {' '}<span className="dim">vs</span>{' '}
                    <span style={{ fontWeight: isWhccTeam(m.away_team) ? 700 : 400 }}>{m.away_team || 'Away'}</span>
                    {isManual && <span className="tag tag-orange" style={{ marginLeft: '8px', verticalAlign: 'middle' }}>Manual</span>}
                    {m.format === 'pairs' && <span className="tag" style={{ marginLeft: '6px', verticalAlign: 'middle', background: 'var(--blue-bg)', color: 'var(--blue)' }}>Pairs</span>}
                  </div>
                  <div className="match-meta">
                    {m.match_date && <span>{m.match_date}</span>}
                    {m.ground && <span> · {m.ground}</span>}
                    {(() => {
                      const bat = isManual ? m.manual_top_bat : m.ing_top_bat
                      const batR = isManual ? m.manual_top_bat_runs : m.ing_top_bat_runs
                      const bowl = isManual ? m.manual_top_bowl : m.ing_top_bowl
                      const bowlW = isManual ? m.manual_top_bowl_wkts : m.ing_top_bowl_wkts
                      return <>
                        {bat && <span> · {bat} {batR}</span>}
                        {bowl && <span> · {bowl} {bowlW}w</span>}
                      </>
                    })()}
                  </div>
                </div>
                <div className="match-score">
                  {isManual ? (
                    <div style={{ textAlign: 'right' }}>
                      {(() => {
                        const wr = m.manual_runs, or = m.manual_opp_runs
                        if (wr === null || or === null) return null
                        const won = wr > or, lost = wr < or
                        const whccTeam = isWhccTeam(m.home_team) ? m.home_team : m.away_team
                        const label = won ? `${whccTeam} won` : lost ? `${whccTeam} lost` : 'Tied'
                        return <div><span className={`tag ${won ? 'tag-green' : lost ? 'tag-red' : ''}`}>{label}</span></div>
                      })()}
                      {m.manual_runs !== null && (
                        <div style={{ fontSize: '0.82rem', marginTop: '4px' }}>
                          <div>{m.manual_runs}/{m.manual_wkts}</div>
                          {m.manual_opp_runs !== null && <div className="dim">{m.manual_opp_runs}/{m.manual_bowl_wkts ?? 0}</div>}
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      {(() => {
                        const phrase = computeResultPhrase(m)
                        if (!phrase) return null
                        const lower = (phrase || '').toLowerCase()
                        const cls = lower.includes(' won ') ? 'tag-green' : lower.includes(' lost ') ? 'tag-red' : ''
                        return <div><span className={`tag ${cls}`}>{phrase}</span></div>
                      })()}
                      <div className="dim" style={{ fontSize: '0.82rem', marginTop: '4px' }}>
                        {formatScore(m.away_score, m.away_wickets, m.away_overs, m.format, m.starting_score) && (
                          <div>{formatScore(m.away_score, m.away_wickets, m.away_overs, m.format, m.starting_score)}</div>
                        )}
                        {formatScore(m.home_score, m.home_wickets, m.home_overs, m.format, m.starting_score) && (
                          <div>{formatScore(m.home_score, m.home_wickets, m.home_overs, m.format, m.starting_score)}</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
