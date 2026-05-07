import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useApiFetch } from '../hooks/useApiFetch'

const methodIcons = {
  'Bowled': '🎯', 'Caught': '🤲', 'LBW': '🦵',
  'Run out': '🏃', 'Stumped': '🧤', 'Other': '❓'
}

export default function PlayerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [batting, setBatting]   = useState(null)
  const [bowling, setBowling]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState('batting')
  const apiFetch = useApiFetch()

  useEffect(() => {
    Promise.all([
      apiFetch(`/api/players/${id}/batting`).then(r => r.json()),
      apiFetch(`/api/players/${id}/bowling`).then(r => r.json()),
    ]).then(([bat, bow]) => {
      setBatting(bat); setBowling(bow); setLoading(false)
    }).catch(() => setLoading(false))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="loading">Loading player stats…</div>

  const playerName = batting?.player?.name || bowling?.player?.name || `Player #${id}`
  const playerTeam = batting?.player?.team || bowling?.player?.team

  return (
    <div className="page">
      <button className="secondary" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}
        onClick={() => navigate('/players')}>← Players</button>

      <h1>{playerName}</h1>
      {playerTeam && (
        <div style={{ color: 'var(--text2)', fontSize: '0.88rem', marginBottom: '1.5rem', marginTop: '-1rem' }}>
          {playerTeam}
        </div>
      )}

      <div className="tabs">
        <button className={`tab ${activeTab === 'batting' ? 'active' : ''}`} onClick={() => setActiveTab('batting')}>Batting</button>
        <button className={`tab ${activeTab === 'bowling' ? 'active' : ''}`} onClick={() => setActiveTab('bowling')}>Bowling</button>
      </div>

      {activeTab === 'batting' && batting && (
        <>
          <div className="stat-row">
            {[
              { label: 'Innings',     value: batting.totals.innings },
              { label: 'Runs',        value: batting.totals.runs },
              { label: 'High score',  value: batting.totals.highScore },
              { label: 'Average',     value: batting.totals.average },
              { label: 'Strike rate', value: batting.totals.strikeRate },
              { label: 'Not outs',    value: batting.totals.notOuts },
              { label: 'Fours',       value: batting.totals.fours },
              { label: 'Sixes',       value: batting.totals.sixes },
            ].map(s => (
              <div key={s.label} className="stat-box">
                <div className="label">{s.label}</div>
                <div className="value">{s.value}</div>
              </div>
            ))}
          </div>

          {/* Dismissal breakdown */}
          {batting.dismissalCounts && Object.keys(batting.dismissalCounts).length > 0 && (
            <div className="card" style={{ marginBottom: '1.25rem' }}>
              <h3 style={{ marginBottom: '0.5rem' }}>How out</h3>
              <div className="dismissal-grid">
                {Object.entries(batting.dismissalCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => (
                    <div key={type} className="dismissal-item">
                      <span style={{ fontSize: '1.2rem' }}>{methodIcons[type] || '❓'}</span>
                      <span className="dismissal-count">{count}</span>
                      <span className="dim">{type}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <h2 style={{ marginTop: '0.5rem' }}>Innings by innings</h2>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Match</th>
                  <th className="num">R</th>
                  <th className="num">B</th>
                  <th className="num">4s</th>
                  <th className="num">6s</th>
                  <th className="num">SR</th>
                  <th>Out?</th>
                </tr>
              </thead>
              <tbody>
                {batting.innings.map((inn, i) => (
                  <tr key={i} style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/match/${inn.fixture_id}`)}>
                    <td className="dim" style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                      {inn.match_date || '—'}
                    </td>
                    <td style={{ fontSize: '0.83rem' }}>
                      {inn.home_team || '?'} vs {inn.away_team || '?'}
                    </td>
                    <td className="num bold">{inn.runs}</td>
                    <td className="num dim">{inn.balls}</td>
                    <td className="num">{inn.fours}</td>
                    <td className="num">{inn.sixes}</td>
                    <td className="num dim">{inn.balls > 0 ? ((inn.runs/inn.balls)*100).toFixed(0) : '–'}</td>
                    <td>{inn.dismissed ? <span style={{color:'var(--red)'}}>out</span> : <span className="muted">no</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === 'bowling' && bowling && (
        <>
          <div className="stat-row">
            {[
              { label: 'Overs',    value: bowling.totals.overs },
              { label: 'Wickets',  value: bowling.totals.wickets },
              { label: 'Runs',     value: bowling.totals.runs },
              { label: 'Average',  value: bowling.totals.average },
              { label: 'Economy',  value: bowling.totals.economy },
              { label: 'Best',     value: bowling.totals.best },
              { label: 'Wides',    value: bowling.totals.wides },
              { label: 'No balls', value: bowling.totals.noBalls },
            ].map(s => (
              <div key={s.label} className="stat-box">
                <div className="label">{s.label}</div>
                <div className="value">{s.value}</div>
              </div>
            ))}
          </div>

          <h2 style={{ marginTop: '0.5rem' }}>Spell by spell</h2>
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Match</th>
                  <th className="num">O</th>
                  <th className="num">R</th>
                  <th className="num">W</th>
                  <th className="num">Wd</th>
                  <th className="num">NB</th>
                  <th className="num">Econ</th>
                </tr>
              </thead>
              <tbody>
                {bowling.spells.map((sp, i) => (
                  <tr key={i} style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/match/${sp.fixture_id}`)}>
                    <td className="dim" style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                      {sp.match_date || '—'}
                    </td>
                    <td style={{ fontSize: '0.83rem' }}>
                      {sp.home_team || '?'} vs {sp.away_team || '?'}
                    </td>
                    <td className="num">{Math.floor(sp.legal_balls/6)}.{sp.legal_balls%6}</td>
                    <td className="num">{sp.runs}</td>
                    <td className={`num ${sp.wickets > 0 ? 'bold' : ''}`}>{sp.wickets}</td>
                    <td className="num dim">{sp.wides}</td>
                    <td className="num dim">{sp.no_balls}</td>
                    <td className="num dim">
                      {sp.legal_balls > 0 ? ((sp.runs/sp.legal_balls)*6).toFixed(2) : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
