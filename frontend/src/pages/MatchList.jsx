import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { Trophy } from 'lucide-react'
import { useApiFetch } from '../hooks/useApiFetch'
import { isWhccTeam, netScore, formatDate, parseMatchDate, computeResultPhrase, shortTeam, dn } from '../utils/cricket'
import { Skeleton } from '../components/Skeleton'

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
  const whcc = isWhccTeam(m.home_team) ? m.home_team : isWhccTeam(m.away_team) ? m.away_team : null
  if (!whcc) return null
  const n = whcc.toLowerCase()
  if (n.includes('hurricane')) return 'hurricane'
  if (n.includes('whirlwind')) return 'whirlwind'
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
  const [sortOrder,  setSortOrder]  = useState('newest')
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

  if (loading) return (
    <div className="page">
      <h1>Matches</h1>
      <div className="match-list">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="match-card" style={{ padding: '0.75rem 1rem' }}>
            <Skeleton height="1.1rem" width="60%" />
            <div style={{ marginTop: '0.4rem' }}><Skeleton height="0.85rem" width="40%" /></div>
          </div>
        ))}
      </div>
    </div>
  )

  const years = [...new Set(matches.map(m => getMatchYear(m.match_date)).filter(Boolean))].sort((a,b) => b-a)
  const teams = [...new Set(matches.map(m => getWhccTeam(m)).filter(Boolean))].sort()


  function matchResult(m) {
    if (m.total_deliveries === 0 && m.manual_runs !== null) {
      if (m.manual_opp_runs === null) return null
      return m.manual_runs > m.manual_opp_runs ? 'won' : m.manual_runs < m.manual_opp_runs ? 'lost' : 'tied'
    }
    const phrase = (computeResultPhrase(m) || '').toLowerCase()
    if (phrase.includes(' won ')) return 'won'
    if (phrase.includes(' lost ')) return 'lost'
    return null
  }

  const sorted = [...matches].sort((a, b) => {
    const byDate = (x, y) => parseMatchDate(y.match_date) - parseMatchDate(x.match_date)
    if (sortOrder === 'oldest') return -byDate(a, b)
    if (sortOrder === 'won') {
      const aw = matchResult(a) === 'won', bw = matchResult(b) === 'won'
      return aw !== bw ? (bw ? 1 : -1) : byDate(a, b)
    }
    if (sortOrder === 'lost') {
      const al = matchResult(a) === 'lost', bl = matchResult(b) === 'lost'
      return al !== bl ? (bl ? 1 : -1) : byDate(a, b)
    }
    return byDate(a, b) // newest (default)
  })
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
          <FilterPills
            label="Sort"
            options={[
              { value: 'newest', label: 'Newest' },
              { value: 'oldest', label: 'Oldest' },
              { value: 'won',    label: 'Won first' },
              { value: 'lost',   label: 'Lost first' },
            ]}
            value={sortOrder}
            onChange={setSortOrder}
          />
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
                  </div>
                  {(() => {
                    const bat = isManual ? m.manual_top_bat : m.ing_top_bat
                    const batR = isManual ? m.manual_top_bat_runs : m.ing_top_bat_runs
                    const batB = isManual ? m.manual_top_bat_balls : m.ing_top_bat_balls
                    const bowl = isManual ? m.manual_top_bowl : m.ing_top_bowl
                    const bowlW = isManual ? m.manual_top_bowl_wkts : m.ing_top_bowl_wkts
                    const bowlR = isManual ? m.manual_top_bowl_runs : m.ing_top_bowl_runs
                    if (!bat && !bowl && !m.ing_top_mvp) return null
                    const iconStyle = { verticalAlign: 'middle', marginRight: 3, marginBottom: 1 }
                    return (
                      <div className="match-meta" style={{ marginTop: '0.1rem', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0 0.6rem' }}>
                        {bat && <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                          <img src="/cricket-bat.png" style={{ width: 13, height: 13, objectFit: 'contain', ...iconStyle }} alt="" />
                          {dn(bat)} {batR}{batB ? ` (${batB}b)` : ''}
                        </span>}
                        {bowl && <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                          <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'var(--hotpink)', marginRight: 5, flexShrink: 0 }} />
                          {dn(bowl)} {bowlW}/{bowlR}
                        </span>}
                        {m.ing_top_mvp && <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                          <Trophy size={12} color="#f9a825" style={iconStyle} />
                          {dn(m.ing_top_mvp)} <span style={{ fontSize: '0.72rem', color: 'var(--text3)', marginLeft: 2 }}>{m.ing_top_mvp_pts}pts</span>
                        </span>}
                      </div>
                    )
                  })()}
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
                          <span style={{ fontWeight: won ? 700 : undefined }}>{wr}/{m.manual_wkts}{m.manual_whcc_overs ? ` (${m.manual_whcc_overs} ov)` : ''}</span>
                          {or !== null && <span style={{ marginLeft: '0.75rem', fontWeight: lost ? 700 : undefined }}>{or}/{m.manual_bowl_wkts ?? 0}{m.manual_opp_overs ? ` (${m.manual_opp_overs} ov)` : ''}</span>}
                        </div>
                      </div>
                    )
                  })() : (() => {
                    const phrase = computeResultPhrase(m)
                    const lower = (phrase || '').toLowerCase()
                    const cls = lower.includes(' won ') ? 'tag-green' : lower.includes(' lost ') ? 'tag-red' : ''
                    const s1 = formatScore(m.away_score, m.away_wickets, m.away_overs, m.format, m.starting_score)
                    const s2 = formatScore(m.home_score, m.home_wickets, m.home_overs, m.format, m.starting_score)
                    const hr = parseInt(m.home_score), ar = parseInt(m.away_score)
                    const s1Bold = !isNaN(ar) && !isNaN(hr) && ar > hr
                    const s2Bold = !isNaN(hr) && !isNaN(ar) && hr > ar
                    return (
                      <div className="match-score-inner">
                        {phrase && <span className={`tag ${cls}`}>{phrase}</span>}
                        {(s1 || s2) && <div className="dim">
                          {s1 && <span style={{ fontWeight: s1Bold ? 700 : undefined }}>{s1}</span>}
                          {s2 && <span style={{ marginLeft: '0.75rem', fontWeight: s2Bold ? 700 : undefined }}>{s2}</span>}
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
