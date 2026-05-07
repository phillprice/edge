import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { useApiFetch } from '../hooks/useApiFetch'

const WHCC = ['woking', 'horsell', 'whcc', 'whirlwind']
function isWhccTeam(name) { return WHCC.some(k => (name||'').toLowerCase().includes(k)) }

function computeResultPhrase(m) {
  const { home_team, away_team, home_score, home_wickets, away_score, away_wickets,
          toss_winner, toss_decision } = m
  const whccTeam = isWhccTeam(home_team) ? home_team : isWhccTeam(away_team) ? away_team : null
  if (!whccTeam || !home_score || !away_score || !toss_winner || !toss_decision) return m.result

  const dec = toss_decision.toLowerCase()
  const batFirst = dec === 'bat' ? toss_winner : (toss_winner === home_team ? away_team : home_team)
  const whccFirst = isWhccTeam(batFirst)
  const isWhccHome = isWhccTeam(home_team)

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

function formatScore(score, wickets, overs) {
  if (!score) return null
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
          {matches.map(m => (
            <div key={m.fixture_id} className="match-card" onClick={() => navigate(`/match/${m.fixture_id}`)}>
              <div>
                <div className="match-teams">
                  <span style={{ fontWeight: isWhccTeam(m.home_team) ? 700 : 400 }}>{m.home_team || 'Home'}</span>
                  {' '}<span className="dim">vs</span>{' '}
                  <span style={{ fontWeight: isWhccTeam(m.away_team) ? 700 : 400 }}>{m.away_team || 'Away'}</span>
                </div>
                <div className="match-meta">
                  {m.match_date && <span>{m.match_date} · </span>}
                  {m.ground && <span>{m.ground} · </span>}
                  <span>{m.innings_count} innings · {m.total_deliveries} balls</span>
                </div>
              </div>
              <div className="match-score">
                {(() => {
                  const phrase = computeResultPhrase(m)
                  if (!phrase) return null
                  const lower = (phrase || '').toLowerCase()
                  const cls = lower.includes(' won ') ? 'tag-green' : lower.includes(' lost ') ? 'tag-red' : ''
                  return <div><span className={`tag ${cls}`}>{phrase}</span></div>
                })()}
                <div className="dim" style={{ fontSize: '0.82rem', marginTop: '4px' }}>
                  {formatScore(m.away_score, m.away_wickets, m.away_overs) && (
                    <div>{formatScore(m.away_score, m.away_wickets, m.away_overs)}</div>
                  )}
                  {formatScore(m.home_score, m.home_wickets, m.home_overs) && (
                    <div>{formatScore(m.home_score, m.home_wickets, m.home_overs)}</div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
