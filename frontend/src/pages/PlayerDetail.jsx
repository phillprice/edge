import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { ChevronLeft, Hand, HandCoins, PersonStanding, SportShoe, Lock, HelpCircle, Pencil, Check, X } from 'lucide-react'
import { useUser } from '@clerk/clerk-react'
import { useApiFetch } from '../hooks/useApiFetch'
import { shortTeam, parseMatchDate } from '../utils/cricket'
import { downloadCsv } from '../utils/csvExport'
import { JerseyIcon, jerseyInitials } from '../components/JerseyIcon'

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
  'LBW': PersonStanding, 'Run out': SportShoe, 'Stumped': Lock, 'Other': HelpCircle
}

function formatDismissalType(type) {
  if (type === 'CaughtAndBowled') return 'Caught and Bowled'
  return type
}


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

export default function PlayerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const backTo = location.state?.from || null
  const { user } = useUser()
  const canUpload = user?.publicMetadata?.canUpload === true
  const [batting, setBatting]     = useState(null)
  const [bowling, setBowling]     = useState(null)
  const [loading, setLoading]     = useState(true)
  const [activeTab, setActiveTab] = useState('batting')
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput]     = useState('')
  const [nameSaving, setNameSaving]   = useState(false)
  const [year, setYear]   = useState('')
  const [team, setTeam]   = useState('')
  const [allYears, setAllYears] = useState([])
  const [dateAsc, setDateAsc] = useState(false)
  const [h2h, setH2h]           = useState(null)
  const [h2hLoading, setH2hLoading] = useState(false)
  const apiFetch = useApiFetch()

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (year) params.set('year', year)
    if (team) params.set('team', team)
    const qs = params.toString() ? `?${params}` : ''
    Promise.all([
      apiFetch(`/api/players/${id}/batting${qs}`).then(r => r.json()),
      apiFetch(`/api/players/${id}/bowling${qs}`).then(r => r.json()),
    ]).then(([bat, bow]) => {
      setBatting(bat); setBowling(bow); setLoading(false)
      if (!year && !team) {
        const combined = [...new Set([...(bat.years || []), ...(bow.years || [])])].sort((a, b) => b - a)
        setAllYears(combined)
      }
    }).catch(() => setLoading(false))
  }, [id, year, team]) // eslint-disable-line react-hooks/exhaustive-deps

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

  function loadH2h() {
    if (h2h || h2hLoading) return
    setH2hLoading(true)
    apiFetch(`/api/players/${id}/h2h`)
      .then(r => r.json())
      .then(data => { setH2h(data); setH2hLoading(false) })
      .catch(() => setH2hLoading(false))
  }

  async function toggleSub() {
    await apiFetch(`/api/admin/player/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_sub: rawPlayer?.is_sub ? 0 : 1 }),
    })
    const [bat, bow] = await Promise.all([
      apiFetch(`/api/players/${id}/batting`).then(r => r.json()),
      apiFetch(`/api/players/${id}/bowling`).then(r => r.json()),
    ])
    setBatting(bat); setBowling(bow)
  }

  return (
    <div className="page">
      <button className="secondary" style={{ marginBottom: '1rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 }}
        onClick={() => navigate(backTo || '/players')}>
        <ChevronLeft size={14} /> {backTo ? 'Match' : 'Players'}
      </button>

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
            <JerseyIcon size={36} initials={jerseyInitials(playerName)} />
            <h1 style={{ marginBottom: 0 }}>{playerName}</h1>
            {canUpload && <button className="icon-btn" onClick={startEdit} title="Edit display name"><Pencil size={14} /></button>}
            {canUpload && (
              <button
                className={rawPlayer?.is_sub ? 'pill active' : 'pill'}
                onClick={toggleSub}
                title={rawPlayer?.is_sub ? 'Mark as squad player (show in tables)' : 'Mark as sub (hide from tables)'}
                style={{ fontSize: '0.72rem' }}
              >{rawPlayer?.is_sub ? 'Sub' : 'Squad'}</button>
            )}
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
          {allYears.length > 1 && (
            <FilterPills
              label="Year"
              options={[{ value: '', label: 'All' }, ...allYears.map(y => ({ value: y, label: y }))]}
              value={year}
              onChange={setYear}
            />
          )}
          <FilterPills
            label="Team"
            options={[
              { value: '', label: 'All' },
              { value: 'whirlwind', label: 'Whirlwinds' },
              { value: 'hurricane', label: 'Hurricanes' },
            ]}
            value={team}
            onChange={setTeam}
          />
        </div>

      <div className="tabs">
        <button className={`tab ${activeTab === 'batting' ? 'active' : ''}`} onClick={() => setActiveTab('batting')}>Batting</button>
        <button className={`tab ${activeTab === 'bowling' ? 'active' : ''}`} onClick={() => setActiveTab('bowling')}>Bowling</button>
        <button className={`tab ${activeTab === 'h2h' ? 'active' : ''}`} onClick={() => { setActiveTab('h2h'); loadH2h() }}>Head to Head</button>
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

          {batting.fielding && (batting.fielding.catches > 0 || batting.fielding.stumpings > 0 || batting.fielding.run_outs > 0) && (
            <div className="stat-row" style={{ marginBottom: '1.25rem' }}>
              {batting.fielding.catches > 0 && (
                <div className="stat-box"><div className="label">Catches</div><div className="value">{batting.fielding.catches}</div></div>
              )}
              {batting.fielding.stumpings > 0 && (
                <div className="stat-box"><div className="label">Stumpings</div><div className="value">{batting.fielding.stumpings}</div></div>
              )}
              {batting.fielding.run_outs > 0 && (
                <div className="stat-box"><div className="label">Run outs</div><div className="value">{batting.fielding.run_outs}</div></div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem', marginBottom: 0 }}>
            <h2 style={{ marginBottom: 0 }}>Innings by innings</h2>
            <button className="secondary" style={{ fontSize: '0.75rem', padding: '2px 8px' }} onClick={() => {
              const rows = [...batting.innings].sort((a, b) =>
                dateAsc ? parseMatchDate(a.match_date) - parseMatchDate(b.match_date)
                        : parseMatchDate(b.match_date) - parseMatchDate(a.match_date)
              )
              const showTimesOut = rows.some(inn =>
                inn.home_team?.toLowerCase().includes('hurricane') ||
                inn.away_team?.toLowerCase().includes('hurricane')
              )
              const header = ['Date','Match','Runs','Balls','4s','6s','SR', ...(showTimesOut ? ['Times out'] : [])]
              const data = rows.map(inn => {
                const notOut = inn.times_out === 0
                const match = `${shortTeam(inn.home_team) || '?'} vs ${shortTeam(inn.away_team) || '?'}`
                const sr = inn.balls > 0 ? ((inn.runs / inn.balls) * 100).toFixed(0) : ''
                return [
                  inn.match_date || '', match,
                  inn.runs + (notOut ? '*' : ''), inn.balls, inn.fours, inn.sixes, sr,
                  ...(showTimesOut ? [inn.times_out] : []),
                ]
              })
              downloadCsv(`${playerName}-batting.csv`, [header, ...data])
            }}>Export CSV</button>
          </div>
          {batting.innings.length === 0 ? (
            <div className="empty">
              {year || team
                ? `No batting data${team ? ` for ${team === 'whirlwind' ? 'Whirlwinds' : 'Hurricanes'}` : ''}${year ? ` in ${year}` : ''} — try removing the filter.`
                : 'No batting data.'}
            </div>
          ) : (
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            {(() => {
              const rows = [...batting.innings].sort((a, b) =>
                dateAsc ? parseMatchDate(a.match_date) - parseMatchDate(b.match_date)
                        : parseMatchDate(b.match_date) - parseMatchDate(a.match_date)
              )
              const showTimesOut = rows.some(inn =>
                inn.home_team?.toLowerCase().includes('hurricane') ||
                inn.away_team?.toLowerCase().includes('hurricane')
              )
              const chron = [...batting.innings].sort((a, b) =>
                parseMatchDate(a.match_date) - parseMatchDate(b.match_date)
              )
              const battingMilestones = new Map()
              let found50 = false, found100 = false, foundDuck = false
              let pbInn = null
              for (const inn of chron) {
                const notOut = inn.times_out === 0
                if (!found50 && inn.runs >= 50) { found50 = true; battingMilestones.set(inn, [...(battingMilestones.get(inn) || []), 'First 50']) }
                if (!found100 && inn.runs >= 100) { found100 = true; battingMilestones.set(inn, [...(battingMilestones.get(inn) || []), 'First 100']) }
                if (!foundDuck && inn.runs === 0 && !notOut) { foundDuck = true; battingMilestones.set(inn, [...(battingMilestones.get(inn) || []), 'First duck']) }
                if (!pbInn || inn.runs > pbInn.runs) pbInn = inn
              }
              if (pbInn) battingMilestones.set(pbInn, [...(battingMilestones.get(pbInn) || []), 'PB'])
              return (
                <table>
                  <thead>
                    <tr>
                      <th className="sortable" onClick={() => setDateAsc(v => !v)} style={{ whiteSpace: 'nowrap' }}>
                        Date{dateAsc ? ' ↑' : ' ↓'}
                      </th>
                      <th>Match</th>
                      <th className="num">R</th>
                      <th className="num">B</th>
                      <th className="num">4s</th>
                      <th className="num">6s</th>
                      <th className="num">SR</th>
                      {showTimesOut && <th className="num" title="Times dismissed">×Out</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((inn, i) => {
                      const isHurricane = inn.home_team?.toLowerCase().includes('hurricane') ||
                                          inn.away_team?.toLowerCase().includes('hurricane')
                      const notOut = inn.times_out === 0
                      const labels = battingMilestones.get(inn) || []
                      return (
                        <tr key={i} style={{ cursor: 'pointer' }}
                          onClick={() => navigate(`/match/${inn.fixture_id}`)}>
                          <td className="dim" style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                            {inn.match_date || '—'}
                          </td>
                          <td style={{ fontSize: '0.83rem' }}>
                            {shortTeam(inn.home_team) || '?'} vs {shortTeam(inn.away_team) || '?'}
                          </td>
                          <td className="num bold">
                            {inn.runs}{notOut ? '*' : ''}
                            {labels.map(lbl => (
                              <span key={lbl} style={{ fontSize: '0.68rem', padding: '1px 5px', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text2)', marginLeft: 4 }}>{lbl}</span>
                            ))}
                          </td>
                          <td className="num dim">{inn.balls}</td>
                          <td className="num">{inn.fours}</td>
                          <td className="num">{inn.sixes}</td>
                          <td className="num dim">{inn.balls > 0 ? ((inn.runs/inn.balls)*100).toFixed(0) : '–'}</td>
                          {showTimesOut && <td className="num dim">{isHurricane ? inn.times_out : '–'}</td>}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )
            })()}
          </div>
          )}
        </>
      )}

      {activeTab === 'h2h' && (
        h2hLoading ? <div className="loading">Loading…</div> :
        !h2h ? null : (
          <>
            <h2 style={{ marginBottom: '0.5rem' }}>Batting by opponent</h2>
            {h2h.batting.length === 0 ? (
              <div className="empty">No batting data.</div>
            ) : (
              <div className="card" style={{ padding: 0, overflowX: 'auto', marginBottom: '2rem' }}>
                <table style={{ fontSize: '0.8rem' }}>
                  <thead>
                    <tr>
                      <th>Opponent</th>
                      <th className="num">Inn</th>
                      <th className="num">Runs</th>
                      <th className="num">HS</th>
                      <th className="num">Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h2h.batting.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: '0.83rem' }}>{r.opponent}</td>
                        <td className="num dim">{r.innings}</td>
                        <td className="num bold">{r.runs}</td>
                        <td className="num">{r.high_score}</td>
                        <td className="num">{r.outs > 0 ? (r.runs / r.outs).toFixed(2) : '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <h2 style={{ marginBottom: '0.5rem' }}>Bowling by opponent</h2>
            {h2h.bowling.length === 0 ? (
              <div className="empty">No bowling data.</div>
            ) : (
              <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                <table style={{ fontSize: '0.8rem' }}>
                  <thead>
                    <tr>
                      <th>Opponent</th>
                      <th className="num">Spells</th>
                      <th className="num">O</th>
                      <th className="num">R</th>
                      <th className="num">W</th>
                      <th className="num">Avg</th>
                      <th className="num">Econ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h2h.bowling.map((r, i) => (
                      <tr key={i}>
                        <td style={{ fontSize: '0.83rem' }}>{r.opponent}</td>
                        <td className="num dim">{r.spells}</td>
                        <td className="num">{Math.floor(r.legal_balls/6)}.{r.legal_balls%6}</td>
                        <td className="num">{r.runs}</td>
                        <td className="num bold">{r.wickets}</td>
                        <td className="num">{r.wickets > 0 ? (r.runs / r.wickets).toFixed(2) : '–'}</td>
                        <td className="num">{r.legal_balls > 0 ? ((r.runs / r.legal_balls) * 6).toFixed(2) : '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )
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

<div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem', marginBottom: 0 }}>
            <h2 style={{ marginBottom: 0 }}>Spell by spell</h2>
            <button className="secondary" style={{ fontSize: '0.75rem', padding: '2px 8px' }} onClick={() => {
              const spells = [...bowling.spells].sort((a, b) =>
                dateAsc ? parseMatchDate(a.match_date) - parseMatchDate(b.match_date)
                        : parseMatchDate(b.match_date) - parseMatchDate(a.match_date)
              )
              const header = ['Date','Match','Overs','Runs','Wickets','Wides','No balls','Economy']
              const data = spells.map(sp => {
                const match = `${shortTeam(sp.home_team) || '?'} vs ${shortTeam(sp.away_team) || '?'}`
                const overs = `${Math.floor(sp.legal_balls / 6)}.${sp.legal_balls % 6}`
                const econ = sp.legal_balls > 0 ? ((sp.runs / sp.legal_balls) * 6).toFixed(2) : ''
                return [sp.match_date || '', match, overs, sp.runs, sp.wickets, sp.wides, sp.no_balls, econ]
              })
              downloadCsv(`${playerName}-bowling.csv`, [header, ...data])
            }}>Export CSV</button>
          </div>
          {bowling.spells.length === 0 ? (
            <div className="empty">
              {year || team
                ? `No bowling data${team ? ` for ${team === 'whirlwind' ? 'Whirlwinds' : 'Hurricanes'}` : ''}${year ? ` in ${year}` : ''} — try removing the filter.`
                : 'No bowling data.'}
            </div>
          ) : (
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            {(() => {
              const chronSpells = [...bowling.spells].sort((a, b) =>
                parseMatchDate(a.match_date) - parseMatchDate(b.match_date)
              )
              const bowlingMilestones = new Map()
              let foundWkt = false, found5fer = false
              let bestSpell = null
              for (const sp of chronSpells) {
                if (!foundWkt && sp.wickets >= 1) { foundWkt = true; bowlingMilestones.set(sp, [...(bowlingMilestones.get(sp) || []), 'First wicket']) }
                if (!found5fer && sp.wickets >= 5) { found5fer = true; bowlingMilestones.set(sp, [...(bowlingMilestones.get(sp) || []), 'First 5-fer']) }
                if (!bestSpell || sp.wickets > bestSpell.wickets || (sp.wickets === bestSpell.wickets && sp.runs < bestSpell.runs)) bestSpell = sp
              }
              if (bestSpell && bestSpell.wickets > 0) bowlingMilestones.set(bestSpell, [...(bowlingMilestones.get(bestSpell) || []), 'Best figures'])
              const displaySpells = [...bowling.spells].sort((a, b) =>
                dateAsc ? parseMatchDate(a.match_date) - parseMatchDate(b.match_date)
                        : parseMatchDate(b.match_date) - parseMatchDate(a.match_date)
              )
              return (
                <table>
                  <thead>
                    <tr>
                      <th className="sortable" onClick={() => setDateAsc(v => !v)} style={{ whiteSpace: 'nowrap' }}>
                        Date{dateAsc ? ' ↑' : ' ↓'}
                      </th>
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
                    {displaySpells.map((sp, i) => {
                      const labels = bowlingMilestones.get(sp) || []
                      return (
                        <tr key={i} style={{ cursor: 'pointer' }}
                          onClick={() => navigate(`/match/${sp.fixture_id}`)}>
                          <td className="dim" style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                            {sp.match_date || '—'}
                          </td>
                          <td style={{ fontSize: '0.83rem' }}>
                            {shortTeam(sp.home_team) || '?'} vs {shortTeam(sp.away_team) || '?'}
                          </td>
                          <td className="num">{Math.floor(sp.legal_balls/6)}.{sp.legal_balls%6}</td>
                          <td className="num">{sp.runs}</td>
                          <td className={`num ${sp.wickets > 0 ? 'bold' : ''}`}>
                            {sp.wickets}
                            {labels.map(lbl => (
                              <span key={lbl} style={{ fontSize: '0.68rem', padding: '1px 5px', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text2)', marginLeft: 4 }}>{lbl}</span>
                            ))}
                          </td>
                          <td className="num dim">{sp.wides}</td>
                          <td className="num dim">{sp.no_balls}</td>
                          <td className="num dim">
                            {sp.legal_balls > 0 ? ((sp.runs/sp.legal_balls)*6).toFixed(2) : '–'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )
            })()}
          </div>
          )}
        </>
      )}
    </div>
  )
}
