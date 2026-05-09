import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { useApiFetch } from '../hooks/useApiFetch'

function FilterPills({ label, options, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.78rem', color: 'var(--text2)', marginRight: 2 }}>{label}</span>
      {options.map(o => (
        <button key={o.value} className={value === o.value ? 'pill active' : 'pill'} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

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

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DAYS   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
function formatDate(d) {
  if (!d) return null
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) {
    const dt = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00`)
    return `${DAYS[dt.getDay()]} ${parseInt(m[3])} ${MONTHS[parseInt(m[2])-1]} ${m[1]}`
  }
  return d
}

function parseMatchDate(d) {
  if (!d) return 0
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(d + 'T12:00:00').getTime()
  const cleaned = d.replace(/^[A-Za-z]+\s+/, '').replace(/(\d+)(st|nd|rd|th)\b/, '$1')
  const t = new Date(cleaned).getTime()
  return isNaN(t) ? 0 : t
}

function getMatchYear(d) {
  if (!d) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d.slice(0, 4)
  const m = d.match(/\b(\d{4})\b/)
  return m ? m[1] : null
}

function getWhccTeam(m) {
  const both = `${m.home_team || ''} ${m.away_team || ''}`.toLowerCase()
  if (both.includes('hurricane')) return 'hurricane'
  if (both.includes('whirlwind')) return 'whirlwind'
  return null
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
  const [matches, setMatches]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [yearFilter, setYearFilter] = useState('all')
  const [teamFilter, setTeamFilter] = useState('all')
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

  const years = [...new Set(matches.map(m => getMatchYear(m.match_date)).filter(Boolean))].sort((a,b) => b-a)
  const teams = [...new Set(matches.map(m => getWhccTeam(m)).filter(Boolean))].sort()

  const sorted = [...matches].sort((a, b) => parseMatchDate(b.match_date) - parseMatchDate(a.match_date))
  const filtered = sorted.filter(m => {
    if (yearFilter !== 'all' && getMatchYear(m.match_date) !== yearFilter) return false
    if (teamFilter !== 'all' && getWhccTeam(m) !== teamFilter) return false
    return true
  })

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h1 style={{ marginBottom: 0 }}>Matches</h1>
        {canUpload && <button onClick={() => navigate('/ingest')}>+ Upload match</button>}
      </div>

      {(years.length > 1 || teams.length > 1) && (
        <div style={{ display: 'flex', gap: '12px', marginBottom: '1.25rem', flexWrap: 'wrap', flexDirection: 'column' }}>
          {years.length > 1 && (
            <FilterPills
              label="Year"
              options={[{ value: 'all', label: 'All' }, ...years.map(y => ({ value: y, label: y }))]}
              value={yearFilter}
              onChange={setYearFilter}
            />
          )}
          {teams.length > 1 && (
            <FilterPills
              label="Team"
              options={[{ value: 'all', label: 'All' }, ...teams.map(t => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) + 's' }))]}
              value={teamFilter}
              onChange={setTeamFilter}
            />
          )}
        </div>
      )}

      {matches.length === 0 ? (
        <div className="card">
          <div className="empty">No matches yet. Upload a scorecard PDF and innings JSON files to get started.</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card"><div className="empty">No matches for the selected filters.</div></div>
      ) : (
        <div className="match-list">
          {filtered.map(m => {
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
                    {m.match_date && <span>{formatDate(m.match_date)}</span>}
                    {m.ground && <span> · {m.ground}</span>}
                    {(() => {
                      const bat = isManual ? m.manual_top_bat : m.ing_top_bat
                      const batR = isManual ? m.manual_top_bat_runs : m.ing_top_bat_runs
                      const batB = isManual ? m.manual_top_bat_balls : m.ing_top_bat_balls
                      const bowl = isManual ? m.manual_top_bowl : m.ing_top_bowl
                      const bowlW = isManual ? m.manual_top_bowl_wkts : m.ing_top_bowl_wkts
                      const bowlR = isManual ? m.manual_top_bowl_runs : m.ing_top_bowl_runs
                      return <>
                        {bat && <span> · {bat} {batR}{batB ? ` (${batB}b)` : ''}</span>}
                        {bowl && <span> · {bowl} {bowlW}/{bowlR}</span>}
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
                        const diff = Math.abs(wr - or)
                        const whccTeam = isWhccTeam(m.home_team) ? m.home_team : m.away_team
                        const label = won ? `${whccTeam} won by ${diff} run${diff === 1 ? '' : 's'}`
                                         : lost ? `${whccTeam} lost by ${diff} run${diff === 1 ? '' : 's'}`
                                         : 'Tied'
                        return <div><span className={`tag ${won ? 'tag-green' : lost ? 'tag-red' : ''}`}>{label}</span></div>
                      })()}
                      {m.manual_runs !== null && (
                        <div style={{ fontSize: '0.82rem', marginTop: '4px' }}>
                          <div>{m.manual_runs}/{m.manual_wkts}{m.manual_whcc_overs ? ` (${m.manual_whcc_overs} ov)` : ''}</div>
                          {m.manual_opp_runs !== null && <div className="dim">{m.manual_opp_runs}/{m.manual_bowl_wkts ?? 0}{m.manual_opp_overs ? ` (${m.manual_opp_overs} ov)` : ''}</div>}
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
