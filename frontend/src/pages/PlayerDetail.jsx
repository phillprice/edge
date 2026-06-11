import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { Lock, HelpCircle, Pencil, Check, X } from 'lucide-react'
import { Tooltip } from 'react-tooltip'
import { useUser } from '@clerk/clerk-react'
import { useApiFetch } from '../hooks/useApiFetch'
import { usePlayerStats } from '../hooks/usePlayerStats'
import { shortTeam, parseMatchDate, formatDateShort } from '../utils/cricket'
import { downloadCsv } from '../utils/csvExport'
import { JerseyIcon, jerseyInitials } from '../components/JerseyIcon'
import Breadcrumbs from '../components/Breadcrumbs'

const BowledPngIcon = ({ size = 18 }) => <img src="/cricket.png"   alt="bowled"  width={size} height={size} className="icon-png" style={{ verticalAlign: 'middle' }} />
const CatchingIcon  = ({ size = 18 }) => <img src="/catching.png" alt="caught"  width={size} height={size} className="icon-png" style={{ verticalAlign: 'middle' }} />
const LBWIcon       = ({ size = 18 }) => <img src="/pads.png"     alt="lbw"     width={size} height={size} className="icon-png" style={{ verticalAlign: 'middle' }} />
const RunOutIcon    = ({ size = 18 }) => <img src="/runer-silhouette-running-fast.png" alt="run out" width={size} height={size} className="icon-png" style={{ verticalAlign: 'middle' }} />

const methodIcons = {
  'Bowled': BowledPngIcon, 'Caught': CatchingIcon, 'CaughtAndBowled': CatchingIcon,
  'LBW': LBWIcon, 'Run out': RunOutIcon, 'Stumped': Lock, 'Other': HelpCircle
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

const TEAM_LABELS = { whirlwind: 'Whirlwinds', hurricane: 'Hurricanes', thunder: 'Thunder', lightning: 'Lightning' }
const teamLabel = t => TEAM_LABELS[t] ?? (t ? t.charAt(0).toUpperCase() + t.slice(1) : '')
const WHCC_KEYWORDS = ['whirlwind', 'hurricane', 'thunder', 'lightning']

// The set of WHCC sub-team keywords appearing in a player's batting/bowling innings.
function findPlayerTeams(batting, bowling) {
  const innings = [...(batting?.innings || []), ...(bowling?.innings || [])]
  const found = new Set()
  for (const row of innings) {
    const haystack = `${row.home_team || ''} ${row.away_team || ''}`.toLowerCase()
    for (const kw of WHCC_KEYWORDS) {
      if (haystack.includes(kw)) found.add(kw)
    }
  }
  return found
}

// A selected team filter is stale once the loaded data no longer contains it.
function shouldResetTeam(team, batting, bowling) {
  return team && batting && bowling && !findPlayerTeams(batting, bowling).has(team)
}

export default function PlayerDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const backTo = location.state?.from
  const { user } = useUser()
  const canUpload = user?.publicMetadata?.canUpload === true
  const [activeTab, setActiveTab] = useState('batting')
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput]     = useState('')
  const [nameSaving, setNameSaving]   = useState(false)
  const [year, setYear]   = useState('')
  const [team, setTeam]   = useState('')
  const [dateAsc, setDateAsc] = useState(false)
  const [h2h, setH2h]           = useState(null)
  const [h2hLoading, setH2hLoading] = useState(false)
  const apiFetch = useApiFetch()
  const { batting, bowling, loading, allYears, refresh } = usePlayerStats(id, year, team)

  useEffect(() => {
    if (shouldResetTeam(team, batting, bowling)) setTeam('')
  }, [batting, bowling]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="loading">Loading player stats…</div>

  const rawPlayer  = batting?.player || bowling?.player
  const playerName = rawPlayer?.name || `Player #${id}`
  const playerTeam = rawPlayer?.team

  const availableTeams = [...findPlayerTeams(batting, bowling)]

  async function saveDisplayName() {
    setNameSaving(true)
    await apiFetch(`/api/admin/player/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: nameInput.trim() || null }),
    })
    await refresh()  // reflect the new name
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
    await refresh()
  }

  return (
    <div className="page">
      <Breadcrumbs items={[
        { label: backTo ? 'Match' : 'Players', href: backTo || '/players' },
        { label: playerName }
      ]} />

      <div style={{ marginBottom: playerTeam ? '0.25rem' : '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}>
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
              <JerseyIcon size={32} initials={jerseyInitials(playerName)} />
              <h1 style={{ marginBottom: 0 }}>{playerName}</h1>
              {canUpload && <button className="icon-btn" onClick={startEdit} title="Edit display name" style={{ marginLeft: '0.3rem' }}><Pencil size={13} /></button>}
            </>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {allYears.length > 1 && (
            <FilterPills
              label="Year"
              options={[{ value: '', label: 'All' }, ...allYears.map(y => ({ value: y, label: y }))]}
              value={year}
              onChange={setYear}
            />
          )}
          {availableTeams.length > 1 && (
            <FilterPills
              label="Team"
              options={[
                { value: '', label: 'All' },
                ...availableTeams.map(kw => ({ value: kw, label: TEAM_LABELS[kw] ?? kw })),
              ]}
              value={team}
              onChange={setTeam}
            />
          )}
          {!editingName && canUpload && (
            <button
              className={rawPlayer?.is_sub ? 'pill active' : 'pill'}
              onClick={toggleSub}
              data-tooltip-id="pd-tip"
              data-tooltip-content={rawPlayer?.is_sub ? 'Occasional/substitute player — excluded from squad statistics tables. Click to mark as squad.' : 'Regular squad member — included in statistics tables. Click to mark as sub.'}
              style={{ fontSize: '0.68rem', marginLeft: 'auto' }}
            >{rawPlayer?.is_sub ? 'Sub' : 'Squad'}</button>
          )}
        </div>

      <div className="tabs" style={{ display: 'flex', alignItems: 'center' }}>
        <button className={`tab ${activeTab === 'batting' ? 'active' : ''}`} onClick={() => setActiveTab('batting')}>Batting</button>
        <button className={`tab ${activeTab === 'bowling' ? 'active' : ''}`} onClick={() => setActiveTab('bowling')}>Bowling</button>
        <button className={`tab ${activeTab === 'h2h' ? 'active' : ''}`} onClick={() => { setActiveTab('h2h'); loadH2h() }}>Head to Head</button>
        {batting?.roles && (batting.roles.captain > 0 || batting.roles.wk > 0) && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.75rem', alignItems: 'center', paddingRight: '0.25rem', color: 'var(--text2)', fontSize: '0.8rem' }}>
            {batting.roles.captain > 0 && (
              <span data-tooltip-id="pd-tip" data-tooltip-content={`Captain ${batting.roles.captain} time${batting.roles.captain !== 1 ? 's' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <img src="/shield.png" height="13" className="icon-png" style={{ verticalAlign: 'middle', opacity: 0.7 }} alt="captain" />{batting.roles.captain}
              </span>
            )}
            {batting.roles.wk > 0 && (
              <span data-tooltip-id="pd-tip" data-tooltip-content={`Kept wicket ${batting.roles.wk} time${batting.roles.wk !== 1 ? 's' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <img src="/gloves.png" height="13" className="icon-png" style={{ verticalAlign: 'middle', opacity: 0.7 }} alt="wicket keeper" />{batting.roles.wk}
              </span>
            )}
          </div>
        )}
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


          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem', marginBottom: 0 }}>
            <h2 style={{ marginBottom: 0 }}>Innings by innings</h2>
            <button className="secondary" style={{ fontSize: '0.75rem', padding: '2px 8px' }} onClick={() => {
              const rows = [...batting.innings].sort((a, b) =>
                dateAsc ? parseMatchDate(a.match_date) - parseMatchDate(b.match_date)
                        : parseMatchDate(b.match_date) - parseMatchDate(a.match_date)
              )
              const showTimesOut = rows.some(inn =>
                ['hurricane','whirlwind','thunder','lightning'].some(t => inn.home_team?.toLowerCase().includes(t) || inn.away_team?.toLowerCase().includes(t))
              )
              const header = ['Date','Match','Runs','Balls','4s','6s','SR', ...(showTimesOut ? ['Times out'] : [])]
              const data = rows.map(inn => {
                const isDnb = !!inn.did_not_bat
                const notOut = !isDnb && inn.times_out === 0
                const match = `${shortTeam(inn.home_team) || '?'} vs ${shortTeam(inn.away_team) || '?'}`
                const sr = !isDnb && inn.balls > 0 ? ((inn.runs / inn.balls) * 100).toFixed(0) : ''
                return [
                  inn.match_date || '', match,
                  isDnb ? 'DNB' : inn.runs + (notOut ? '*' : ''),
                  isDnb ? '' : inn.balls,
                  isDnb ? '' : inn.fours,
                  isDnb ? '' : inn.sixes,
                  sr,
                  ...(showTimesOut ? [isDnb ? '' : inn.times_out] : []),
                ]
              })
              downloadCsv(`${playerName}-batting.csv`, [header, ...data])
            }}>Export CSV</button>
          </div>
          {batting.innings.length === 0 ? (
            <div className="empty">
              {year || team
                ? `No batting data${team ? ` for ${teamLabel(team)}` : ''}${year ? ` in ${year}` : ''} — try removing the filter.`
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
                ['hurricane','whirlwind','thunder','lightning'].some(t => inn.home_team?.toLowerCase().includes(t) || inn.away_team?.toLowerCase().includes(t))
              )
              const chron = [...batting.innings].sort((a, b) =>
                parseMatchDate(a.match_date) - parseMatchDate(b.match_date)
              )
              const battingMilestones = new Map()
              let found50 = false, found100 = false
              let pbInn = null
              for (const inn of chron) {
                if (inn.did_not_bat) continue
                if (!found50 && inn.runs >= 50) { found50 = true; battingMilestones.set(inn, [...(battingMilestones.get(inn) || []), 'First 50']) }
                if (!found100 && inn.runs >= 100) { found100 = true; battingMilestones.set(inn, [...(battingMilestones.get(inn) || []), 'First 100']) }
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
                      const isHurricane = ['hurricane','whirlwind','thunder','lightning'].some(t => inn.home_team?.toLowerCase().includes(t) || inn.away_team?.toLowerCase().includes(t))
                      const isDnb = !!inn.did_not_bat
                      const notOut = !isDnb && inn.times_out === 0
                      const labels = battingMilestones.get(inn) || []
                      return (
                        <tr key={i} style={{ cursor: 'pointer', opacity: isDnb ? 0.55 : undefined }}
                          onClick={() => navigate(`/match/${inn.fixture_id}`)}>
                          <td className="dim" style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
                            {formatDateShort(inn.match_date) || inn.match_date || '—'}
                          </td>
                          <td style={{ fontSize: '0.83rem' }}>
                            {shortTeam(inn.home_team) || '?'} vs {shortTeam(inn.away_team) || '?'}
                          </td>
                          <td className="num bold">
                            {isDnb ? (
                              <span style={{ fontSize: '0.82rem', fontWeight: 400, color: 'var(--text3)' }}>DNB</span>
                            ) : (
                              <>
                                {labels.includes('PB') && (
                                  <span style={{ fontSize: '0.68rem', padding: '1px 5px', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text2)', marginRight: 4 }}>PB</span>
                                )}
                                {inn.runs}{notOut ? '*' : ''}
                                {labels.filter(l => l !== 'PB').map(lbl => (
                                  <span key={lbl} style={{ fontSize: '0.68rem', padding: '1px 5px', borderRadius: 4, background: 'var(--surface2)', color: 'var(--text2)', marginLeft: 4 }}>{lbl}</span>
                                ))}
                              </>
                            )}
                          </td>
                          <td className="num dim">{isDnb ? '–' : inn.balls}</td>
                          <td className="num">{isDnb ? '' : inn.fours}</td>
                          <td className="num">{isDnb ? '' : inn.sixes}</td>
                          <td className="num dim">{isDnb || inn.balls === 0 ? '–' : ((inn.runs/inn.balls)*100).toFixed(0)}</td>
                          {showTimesOut && <td className="num dim">{isDnb ? '–' : isHurricane ? inn.times_out : '–'}</td>}
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

          {batting?.fielding && (batting.fielding.catches > 0 || batting.fielding.stumpings > 0 || batting.fielding.run_outs > 0) && (
            <div className="card" style={{ marginBottom: '1.25rem' }}>
              <h3 style={{ marginBottom: '0.5rem' }}>Fielding</h3>
              <div className="dismissal-grid">
                {batting.fielding.catches > 0 && (
                  <div className="dismissal-item">
                    <span style={{ display: 'flex', justifyContent: 'center' }}><CatchingIcon size={18} /></span>
                    <span className="dismissal-count">{batting.fielding.catches}</span>
                    <span className="dim">Catches</span>
                  </div>
                )}
                {batting.fielding.stumpings > 0 && (
                  <div className="dismissal-item">
                    <span style={{ display: 'flex', justifyContent: 'center' }}><Lock size={18} /></span>
                    <span className="dismissal-count">{batting.fielding.stumpings}</span>
                    <span className="dim">Stumpings</span>
                  </div>
                )}
                {batting.fielding.run_outs > 0 && (
                  <div className="dismissal-item">
                    <span style={{ display: 'flex', justifyContent: 'center' }}><RunOutIcon size={18} /></span>
                    <span className="dismissal-count">{batting.fielding.run_outs}</span>
                    <span className="dim">Run outs</span>
                  </div>
                )}
              </div>
            </div>
          )}

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
                ? `No bowling data${team ? ` for ${teamLabel(team)}` : ''}${year ? ` in ${year}` : ''} — try removing the filter.`
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
                            {formatDateShort(sp.match_date) || sp.match_date || '—'}
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
      <Tooltip id="pd-tip" />
    </div>
  )
}
