import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronLeft, Hand, HandCoins, ShieldAlert, Zap, Lock, HelpCircle, Pencil, Check, X } from 'lucide-react'
import { useUser } from '@clerk/clerk-react'
import { useApiFetch } from '../hooks/useApiFetch'

function StumpsIcon({ size = 24 }) {
  const s = size, mid = s / 2, gap = s * 0.22, h = s * 0.68, bailY = s * 0.18, bailLen = s * 0.14
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none" stroke="currentColor" strokeWidth={s * 0.1} strokeLinecap="round">
      <line x1={mid - gap} y1={bailY} x2={mid - gap} y2={bailY + h} />
      <line x1={mid}       y1={bailY} x2={mid}       y2={bailY + h} />
      <line x1={mid + gap} y1={bailY} x2={mid + gap} y2={bailY + h} />
      <line x1={mid - gap - bailLen} y1={bailY + s * 0.06} x2={mid}             y2={bailY} />
      <line x1={mid}                 y1={bailY}             x2={mid + gap + bailLen} y2={bailY + s * 0.06} />
    </svg>
  )
}

const methodIcons = {
  'Bowled': StumpsIcon, 'Caught': Hand, 'CaughtAndBowled': HandCoins,
  'LBW': ShieldAlert, 'Run out': Zap, 'Stumped': Lock, 'Other': HelpCircle
}

function formatDismissalType(type) {
  if (type === 'CaughtAndBowled') return 'Caught and Bowled'
  return type
}

export default function PlayerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useUser()
  const canUpload = user?.publicMetadata?.canUpload === true
  const [batting, setBatting]     = useState(null)
  const [bowling, setBowling]     = useState(null)
  const [loading, setLoading]     = useState(true)
  const [activeTab, setActiveTab] = useState('batting')
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput]     = useState('')
  const [nameSaving, setNameSaving]   = useState(false)
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

  const rawPlayer  = batting?.player || bowling?.player
  const playerName = rawPlayer?.name || `Player #${id}`
  const playerTeam = rawPlayer?.team

  async function saveDisplayName() {
    setNameSaving(true)
    await apiFetch(`/api/admin/player/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: nameInput.trim() || null }),
    })
    // Refresh player data to reflect new name
    const [bat, bow] = await Promise.all([
      apiFetch(`/api/players/${id}/batting`).then(r => r.json()),
      apiFetch(`/api/players/${id}/bowling`).then(r => r.json()),
    ])
    setBatting(bat); setBowling(bow)
    setEditingName(false); setNameSaving(false)
  }

  function startEdit() {
    setNameInput(rawPlayer?.display_name || '')
    setEditingName(true)
  }

  return (
    <div className="page">
      <button className="secondary" style={{ marginBottom: '1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 }}
        onClick={() => navigate('/players')}><ChevronLeft size={14} /> Players</button>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: playerTeam ? '0.25rem' : '1.5rem' }}>
        {editingName ? (
          <>
            <input
              value={nameInput} onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveDisplayName(); if (e.key === 'Escape') setEditingName(false) }}
              style={{ fontSize: '1.4rem', fontWeight: 600, width: '14rem', padding: '2px 6px' }}
              placeholder={playerName}
              autoFocus
            />
            <button className="icon-btn" onClick={saveDisplayName} disabled={nameSaving} title="Save"><Check size={16} /></button>
            <button className="icon-btn" onClick={() => setEditingName(false)} title="Cancel"><X size={16} /></button>
            {rawPlayer?.display_name && (
              <button className="icon-btn" style={{ fontSize: '0.75rem', color: 'var(--text3)' }}
                onClick={() => { setNameInput(''); }}
                title="Clear override (revert to original name)">clear</button>
            )}
          </>
        ) : (
          <>
            <h1 style={{ marginBottom: 0 }}>{playerName}</h1>
            {canUpload && <button className="icon-btn" onClick={startEdit} title="Edit display name"><Pencil size={14} /></button>}
          </>
        )}
      </div>
      {playerTeam && (
        <div style={{ color: 'var(--text2)', fontSize: '0.88rem', marginBottom: '1.5rem' }}>
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
                  .map(([type, count]) => {
                    const Icon = methodIcons[type] || HelpCircle
                    return (
                      <div key={type} className="dismissal-item">
                        <span style={{ display: 'flex', justifyContent: 'center' }}><Icon size={18} /></span>
                        <span className="dismissal-count">{count}</span>
                        <span className="dim">{formatDismissalType(type)}</span>
                      </div>
                    )
                  })}
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
