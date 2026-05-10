import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { useApiFetch } from '../hooks/useApiFetch'
import { isWhccTeam, netScore, formatDate, parseMatchDate, computeResultPhrase, shortTeam, displayName } from '../utils/cricket'

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
        <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
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
                    <span style={{ fontWeight: isWhccTeam(m.home_team) ? 700 : 400 }}>{shortTeam(m.home_team) || 'Home'}</span>
                    {' '}<span className="dim">vs</span>{' '}
                    <span style={{ fontWeight: isWhccTeam(m.away_team) ? 700 : 400 }}>{shortTeam(m.away_team) || 'Away'}</span>
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
                        {bat && <span> · {displayName(bat, [])} {batR}{batB ? ` (${batB}b)` : ''}</span>}
                        {bowl && <span> · {displayName(bowl, [])} {bowlW}/{bowlR}</span>}
                      </>
                    })()}
                  </div>
                </div>
                <div className="match-score">
                  {isManual ? (() => {
                    const wr = m.manual_runs, or = m.manual_opp_runs
                    if (wr === null) return null
                    const won = or !== null && wr > or, lost = or !== null && wr < or
                    const diff = Math.abs(wr - (or ?? 0))
                    const whccTeam = shortTeam(isWhccTeam(m.home_team) ? m.home_team : m.away_team)
                    const label = or === null ? null : won ? `${whccTeam} won by ${diff} run${diff === 1 ? '' : 's'}`
                                             : lost ? `${whccTeam} lost by ${diff} run${diff === 1 ? '' : 's'}` : 'Tied'
                    return (
                      <div className="match-score-inner">
                        {label && <span className={`tag ${won ? 'tag-green' : lost ? 'tag-red' : ''}`}>{label}</span>}
                        <div className="dim">
                          <span>{wr}/{m.manual_wkts}{m.manual_whcc_overs ? ` (${m.manual_whcc_overs} ov)` : ''}</span>
                          {or !== null && <span style={{ marginLeft: '0.75rem' }}>{or}/{m.manual_bowl_wkts ?? 0}{m.manual_opp_overs ? ` (${m.manual_opp_overs} ov)` : ''}</span>}
                        </div>
                      </div>
                    )
                  })() : (() => {
                    const phrase = computeResultPhrase(m)
                    const lower = (phrase || '').toLowerCase()
                    const cls = lower.includes(' won ') ? 'tag-green' : lower.includes(' lost ') ? 'tag-red' : ''
                    const s1 = formatScore(m.away_score, m.away_wickets, m.away_overs, m.format, m.starting_score)
                    const s2 = formatScore(m.home_score, m.home_wickets, m.home_overs, m.format, m.starting_score)
                    return (
                      <div className="match-score-inner">
                        {phrase && <span className={`tag ${cls}`}>{phrase}</span>}
                        {(s1 || s2) && <div className="dim">
                          {s1 && <span>{s1}</span>}
                          {s2 && <span style={{ marginLeft: '0.75rem' }}>{s2}</span>}
                        </div>}
                      </div>
                    )
                  })()}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
