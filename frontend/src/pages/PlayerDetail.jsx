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

const BowledPngIcon = ({ size = 18 }) => (
  <img
    src="/cricket.png"
    alt="bowled"
    width={size}
    height={size}
    className="icon-png"
    style={{ verticalAlign: 'middle' }}
  />
)
const CatchingIcon = ({ size = 18 }) => (
  <img
    src="/catching.png"
    alt="caught"
    width={size}
    height={size}
    className="icon-png"
    style={{ verticalAlign: 'middle' }}
  />
)
const LBWIcon = ({ size = 18 }) => (
  <img
    src="/pads.png"
    alt="lbw"
    width={size}
    height={size}
    className="icon-png"
    style={{ verticalAlign: 'middle' }}
  />
)
const RunOutIcon = ({ size = 18 }) => (
  <img
    src="/runer-silhouette-running-fast.png"
    alt="run out"
    width={size}
    height={size}
    className="icon-png"
    style={{ verticalAlign: 'middle' }}
  />
)

const methodIcons = {
  Bowled: BowledPngIcon,
  Caught: CatchingIcon,
  CaughtAndBowled: CatchingIcon,
  LBW: LBWIcon,
  'Run out': RunOutIcon,
  Stumped: Lock,
  Other: HelpCircle,
}

function formatDismissalType(type) {
  if (type === 'CaughtAndBowled') return 'Caught and Bowled'
  return type
}

function toggleSort(current, col) {
  if (current.col === col) return { col, dir: current.dir === 'desc' ? 'asc' : 'desc' }
  return { col, dir: 'desc' }
}

function SortArrow({ sort, col }) {
  if (sort.col !== col) return null
  return sort.dir === 'asc' ? ' ↑' : ' ↓'
}

// Clickable, sort-aware table header. Keeps the sort onClick/arrow out of the
// large render block so each stays simple.
function SortableTh({ label, col, sort, setSort, className = 'num sortable', style, title }) {
  return (
    <th
      className={className}
      style={style}
      title={title}
      onClick={() => setSort((s) => toggleSort(s, col))}
    >
      {label}
      <SortArrow sort={sort} col={col} />
    </th>
  )
}

const TEAM_KEYWORDS = ['hurricane', 'whirlwind', 'thunder', 'lightning']
const isHurricaneRow = (r) =>
  TEAM_KEYWORDS.some(
    (t) => r.home_team?.toLowerCase().includes(t) || r.away_team?.toLowerCase().includes(t)
  )
const matchup = (r) => `${shortTeam(r.home_team) || '?'} vs ${shortTeam(r.away_team) || '?'}`
const rowDate = (r) =>
  formatDateShort(r.match_date_iso) || formatDateShort(r.match_date) || r.match_date || '—'

function addMilestone(map, key, label) {
  map.set(key, [...(map.get(key) || []), label])
}

function MilestoneBadge({ label, style }) {
  return (
    <span
      style={{
        fontSize: '0.68rem',
        padding: '1px 5px',
        borderRadius: 4,
        background: 'var(--surface2)',
        color: 'var(--text2)',
        ...style,
      }}
    >
      {label}
    </span>
  )
}

function computeBattingMilestones(innings) {
  const chron = innings
    .filter((i) => !i.did_not_bat)
    .sort((a, b) => parseMatchDate(a.match_date) - parseMatchDate(b.match_date))
  const milestones = new Map()
  const first50 = chron.find((i) => i.runs >= 50)
  const first100 = chron.find((i) => i.runs >= 100)
  const pbInn = chron.reduce((best, i) => (!best || i.runs > best.runs ? i : best), null)
  if (first50) addMilestone(milestones, first50, 'First 50')
  if (first100) addMilestone(milestones, first100, 'First 100')
  if (pbInn) addMilestone(milestones, pbInn, 'PB')
  return milestones
}

function computeBowlingMilestones(spells) {
  const chron = [...spells].sort(
    (a, b) => parseMatchDate(a.match_date) - parseMatchDate(b.match_date)
  )
  const milestones = new Map()
  const firstWkt = chron.find((s) => s.wickets >= 1)
  const first5fer = chron.find((s) => s.wickets >= 5)
  const best = chron.reduce(
    (b, s) => (!b || s.wickets > b.wickets || (s.wickets === b.wickets && s.runs < b.runs) ? s : b),
    null
  )
  if (firstWkt) addMilestone(milestones, firstWkt, 'First wicket')
  if (first5fer) addMilestone(milestones, first5fer, 'First 5-fer')
  if (best && best.wickets > 0) addMilestone(milestones, best, 'Best figures')
  return milestones
}

// Runs cell with milestone badges (PB shown before the score, others after).
function RunsCell({ runs, notOut, labels }) {
  return (
    <td className="num bold">
      {labels.map((lbl) => (
        <MilestoneBadge key={lbl} label={lbl} style={{ marginRight: 4 }} />
      ))}
      {runs}
      {notOut ? '*' : ''}
    </td>
  )
}

function BattingInningsRow({ inn, labels, showTimesOut, onClick }) {
  const date = rowDate(inn)
  if (inn.did_not_bat) {
    return (
      <tr style={{ cursor: 'pointer', opacity: 0.55 }} onClick={onClick}>
        <td className="dim" style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
          {date}
        </td>
        <td style={{ fontSize: '0.83rem' }}>{matchup(inn)}</td>
        <td className="num bold">
          <span style={{ fontSize: '0.82rem', fontWeight: 400, color: 'var(--text3)' }}>DNB</span>
        </td>
        <td className="num dim">–</td>
        <td className="num" />
        <td className="num" />
        <td className="num dim">–</td>
        {showTimesOut && <td className="num dim">–</td>}
      </tr>
    )
  }
  const notOut = inn.times_out === 0
  const sr = inn.balls > 0 ? ((inn.runs / inn.balls) * 100).toFixed(0) : '–'
  return (
    <tr style={{ cursor: 'pointer' }} onClick={onClick}>
      <td className="dim" style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
        {date}
      </td>
      <td style={{ fontSize: '0.83rem' }}>{matchup(inn)}</td>
      <RunsCell runs={inn.runs} notOut={notOut} labels={labels} />
      <td className="num dim">{inn.balls}</td>
      <td className="num">{inn.fours}</td>
      <td className="num">{inn.sixes}</td>
      <td className="num dim">{sr}</td>
      {showTimesOut && <td className="num dim">{isHurricaneRow(inn) ? inn.times_out : '–'}</td>}
    </tr>
  )
}

function BowlingInningsRow({ sp, labels, onClick }) {
  const econ = sp.legal_balls > 0 ? ((sp.runs / sp.legal_balls) * 6).toFixed(2) : '–'
  const date = rowDate(sp)
  // Overs include wides/no-balls (junior cricket doesn't re-bowl them), matching the match scorecard.
  const overBalls = sp.legal_balls + (sp.wide_count || 0) + (sp.nb_count || 0)
  return (
    <tr style={{ cursor: 'pointer' }} onClick={onClick}>
      <td className="dim" style={{ fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
        {date}
      </td>
      <td style={{ fontSize: '0.83rem' }}>{matchup(sp)}</td>
      <td className="num">
        {Math.floor(overBalls / 6)}.{overBalls % 6}
      </td>
      <td className="num">{sp.runs}</td>
      <td className={`num ${sp.wickets > 0 ? 'bold' : ''}`}>
        {labels.map((lbl) => (
          <MilestoneBadge key={lbl} label={lbl} style={{ marginRight: 4 }} />
        ))}
        {sp.wickets}
      </td>
      <td className="num dim">{sp.wides}</td>
      <td className="num dim">{sp.no_balls}</td>
      <td className="num dim">{econ}</td>
    </tr>
  )
}

function FilterPills({ label, options, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.78rem', color: 'var(--text2)', marginRight: 2 }}>{label}</span>
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? 'pill active' : 'pill'}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

const TEAM_LABELS = {
  whirlwind: 'Whirlwinds',
  hurricane: 'Hurricanes',
  thunder: 'Thunder',
  lightning: 'Lightning',
}
const teamLabel = (t) => TEAM_LABELS[t] ?? (t ? t.charAt(0).toUpperCase() + t.slice(1) : '')
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
  const [nameInput, setNameInput] = useState('')
  const [nameSaving, setNameSaving] = useState(false)
  const [year, setYear] = useState('')
  const [team, setTeam] = useState('')
  const [batSort, setBatSort] = useState({ col: 'date', dir: 'desc' })
  const [bowlSort, setBowlSort] = useState({ col: 'date', dir: 'desc' })
  const [h2h, setH2h] = useState(null)
  const [h2hLoading, setH2hLoading] = useState(false)
  const apiFetch = useApiFetch()
  const { batting, bowling, loading, allYears, refresh } = usePlayerStats(id, year, team)

  useEffect(() => {
    if (shouldResetTeam(team, batting, bowling)) setTeam('')
  }, [batting, bowling]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="loading">Loading player stats…</div>

  const rawPlayer = batting?.player || bowling?.player
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
    await refresh() // reflect the new name
    setEditingName(false)
    setNameSaving(false)
  }

  function startEdit() {
    setNameInput(rawPlayer?.display_name || '')
    setEditingName(true)
  }

  function loadH2h() {
    if (h2h || h2hLoading) return
    setH2hLoading(true)
    apiFetch(`/api/players/${id}/h2h`)
      .then((r) => r.json())
      .then((data) => {
        setH2h(data)
        setH2hLoading(false)
      })
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

  const BAT_VALUE = {
    date: (r) => parseMatchDate(r.match_date),
    runs: (r) => r.runs,
    balls: (r) => r.balls,
    fours: (r) => r.fours,
    sixes: (r) => r.sixes,
    sr: (r) => (r.balls > 0 ? (r.runs / r.balls) * 100 : 0),
    outs: (r) => r.times_out,
  }

  const BOWL_VALUE = {
    date: (r) => parseMatchDate(r.match_date),
    overs: (r) => r.legal_balls + (r.wide_count || 0) + (r.nb_count || 0),
    runs: (r) => r.runs,
    wickets: (r) => r.wickets,
    wides: (r) => r.wides,
    nb: (r) => r.no_balls,
    economy: (r) => (r.legal_balls > 0 ? (r.runs / r.legal_balls) * 6 : 0),
  }

  function sortRows(rows, sort, valueMap) {
    const valueOf = valueMap[sort.col] ?? valueMap.date
    const cmp =
      sort.dir === 'asc' ? (a, b) => valueOf(a) - valueOf(b) : (a, b) => valueOf(b) - valueOf(a)
    return [...rows].sort(cmp)
  }

  function sortBattingRows(innings, sort) {
    const dnb = innings.filter((r) => r.did_not_bat)
    return [
      ...sortRows(
        innings.filter((r) => !r.did_not_bat),
        sort,
        BAT_VALUE
      ),
      ...dnb,
    ]
  }

  function sortBowlingRows(spells, sort) {
    return sortRows(spells, sort, BOWL_VALUE)
  }

  return (
    <div className="page">
      <Breadcrumbs
        items={[
          { label: backTo ? 'Match' : 'Players', href: backTo || '/players' },
          { label: playerName },
        ]}
      />

      <div style={{ marginBottom: playerTeam ? '0.25rem' : '1.5rem' }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.3rem' }}
        >
          {editingName ? (
            <>
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveDisplayName()
                  if (e.key === 'Escape') setEditingName(false)
                }}
                style={{ fontSize: '1.4rem', fontWeight: 600, width: '14rem', padding: '2px 6px' }}
                placeholder={playerName}
                autoFocus
              />
              <button
                className="icon-btn"
                onClick={saveDisplayName}
                disabled={nameSaving}
                title="Save"
              >
                <Check size={16} />
              </button>
              <button className="icon-btn" onClick={() => setEditingName(false)} title="Cancel">
                <X size={16} />
              </button>
              {rawPlayer?.display_name && (
                <button
                  className="icon-btn"
                  style={{ fontSize: '0.75rem', color: 'var(--text3)' }}
                  onClick={() => {
                    setNameInput('')
                  }}
                  title="Clear override (revert to original name)"
                >
                  clear
                </button>
              )}
            </>
          ) : (
            <>
              <JerseyIcon size={32} initials={jerseyInitials(playerName)} />
              <h1 style={{ marginBottom: 0 }}>{playerName}</h1>
              {canUpload && (
                <button
                  className="icon-btn"
                  onClick={startEdit}
                  title="Edit display name"
                  style={{ marginLeft: '0.3rem' }}
                >
                  <Pencil size={13} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          gap: '1.5rem',
          marginBottom: '1.25rem',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {allYears.length > 1 && (
          <FilterPills
            label="Year"
            options={[
              { value: '', label: 'All' },
              ...allYears.map((y) => ({ value: y, label: y })),
            ]}
            value={year}
            onChange={setYear}
          />
        )}
        {availableTeams.length > 1 && (
          <FilterPills
            label="Team"
            options={[
              { value: '', label: 'All' },
              ...availableTeams.map((kw) => ({ value: kw, label: TEAM_LABELS[kw] ?? kw })),
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
            data-tooltip-content={
              rawPlayer?.is_sub
                ? 'Occasional/substitute player — excluded from squad statistics tables. Click to mark as squad.'
                : 'Regular squad member — included in statistics tables. Click to mark as sub.'
            }
            style={{ fontSize: '0.68rem', marginLeft: 'auto' }}
          >
            {rawPlayer?.is_sub ? 'Sub' : 'Squad'}
          </button>
        )}
      </div>

      {/* Career hero — only when the player has meaningful data in both disciplines */}
      {batting?.totals?.innings > 0 && bowling?.totals?.overs && bowling.totals.overs !== '0' && (
        <div className="card" style={{ marginBottom: '1rem', padding: '0.85rem 1rem' }}>
          <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap' }}>
            <div
              style={{ flex: 1, minWidth: 160, cursor: 'pointer' }}
              onClick={() => setActiveTab('batting')}
            >
              <div
                style={{
                  fontSize: '0.66rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--text3)',
                  marginBottom: '0.4rem',
                }}
              >
                Batting
              </div>
              <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 700, lineHeight: 1.1 }}>
                    {batting.totals.average ?? '–'}
                  </div>
                  <div
                    style={{
                      fontSize: '0.66rem',
                      color: 'var(--text3)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Avg
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 700, lineHeight: 1.1 }}>
                    {batting.totals.highScore ?? '–'}
                  </div>
                  <div
                    style={{
                      fontSize: '0.66rem',
                      color: 'var(--text3)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    HS
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 700, lineHeight: 1.1 }}>
                    {batting.totals.innings ?? '–'}
                  </div>
                  <div
                    style={{
                      fontSize: '0.66rem',
                      color: 'var(--text3)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Inn
                  </div>
                </div>
              </div>
            </div>
            <div
              style={{
                flex: 1,
                minWidth: 160,
                cursor: 'pointer',
                borderLeft: '1px solid var(--border)',
                paddingLeft: '1.25rem',
              }}
              onClick={() => setActiveTab('bowling')}
            >
              <div
                style={{
                  fontSize: '0.66rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--text3)',
                  marginBottom: '0.4rem',
                }}
              >
                Bowling
              </div>
              <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 700, lineHeight: 1.1 }}>
                    {bowling.totals.wickets ?? '–'}
                  </div>
                  <div
                    style={{
                      fontSize: '0.66rem',
                      color: 'var(--text3)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Wkts
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 700, lineHeight: 1.1 }}>
                    {bowling.totals.best ?? '–'}
                  </div>
                  <div
                    style={{
                      fontSize: '0.66rem',
                      color: 'var(--text3)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Best
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: '1.35rem', fontWeight: 700, lineHeight: 1.1 }}>
                    {bowling.totals.overs ?? '–'}
                  </div>
                  <div
                    style={{
                      fontSize: '0.66rem',
                      color: 'var(--text3)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    Overs
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="tabs" style={{ display: 'flex', alignItems: 'center' }}>
        <button
          className={`tab ${activeTab === 'batting' ? 'active' : ''}`}
          onClick={() => setActiveTab('batting')}
        >
          Batting
        </button>
        <button
          className={`tab ${activeTab === 'bowling' ? 'active' : ''}`}
          onClick={() => setActiveTab('bowling')}
        >
          Bowling
        </button>
        {batting?.keeping?.matches > 0 && (
          <button
            className={`tab ${activeTab === 'keeping' ? 'active' : ''}`}
            onClick={() => setActiveTab('keeping')}
          >
            Keeping
          </button>
        )}
        <button
          className={`tab ${activeTab === 'h2h' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('h2h')
            loadH2h()
          }}
        >
          Head to Head
        </button>
        {batting?.roles && (batting.roles.captain > 0 || batting.roles.wk > 0) && (
          <div
            style={{
              marginLeft: 'auto',
              display: 'flex',
              gap: '0.75rem',
              alignItems: 'center',
              paddingRight: '0.25rem',
              color: 'var(--text2)',
              fontSize: '0.8rem',
            }}
          >
            {batting.roles.captain > 0 && (
              <span
                data-tooltip-id="pd-tip"
                data-tooltip-content={`Captain ${batting.roles.captain} time${batting.roles.captain !== 1 ? 's' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              >
                <img
                  src="/shield.png"
                  height="13"
                  className="icon-png"
                  style={{ verticalAlign: 'middle', opacity: 0.7 }}
                  alt="captain"
                />
                {batting.roles.captain}
              </span>
            )}
            {batting.roles.wk > 0 && (
              <span
                data-tooltip-id="pd-tip"
                data-tooltip-content={`Kept wicket ${batting.roles.wk} time${batting.roles.wk !== 1 ? 's' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              >
                <img
                  src="/gloves.png"
                  height="13"
                  className="icon-png"
                  style={{ verticalAlign: 'middle', opacity: 0.7 }}
                  alt="wicket keeper"
                />
                {batting.roles.wk}
              </span>
            )}
          </div>
        )}
      </div>

      {activeTab === 'batting' && batting && (
        <>
          <div className="stat-row">
            {[
              { label: 'Innings', value: batting.totals.innings },
              { label: 'Runs', value: batting.totals.runs },
              { label: 'High score', value: batting.totals.highScore },
              { label: 'Average', value: batting.totals.average },
              { label: 'Strike rate', value: batting.totals.strikeRate },
              { label: 'Not outs', value: batting.totals.notOuts },
              { label: 'Fours', value: batting.totals.fours },
              { label: 'Sixes', value: batting.totals.sixes },
            ].map((s) => (
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
                        <span style={{ display: 'flex', justifyContent: 'center' }}>
                          <Icon size={18} />
                        </span>
                        <span className="dismissal-count">{count}</span>
                        <span className="dim">{formatDismissalType(type)}</span>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginTop: '0.5rem',
              marginBottom: 0,
            }}
          >
            <h2 style={{ marginBottom: 0 }}>Innings by innings</h2>
            <button
              className="secondary"
              style={{ fontSize: '0.75rem', padding: '2px 8px' }}
              onClick={() => {
                const rows = sortBattingRows(batting.innings, batSort)
                const showTimesOut = rows.some((inn) =>
                  ['hurricane', 'whirlwind', 'thunder', 'lightning'].some(
                    (t) =>
                      inn.home_team?.toLowerCase().includes(t) ||
                      inn.away_team?.toLowerCase().includes(t)
                  )
                )
                const header = [
                  'Date',
                  'Match',
                  'Runs',
                  'Balls',
                  '4s',
                  '6s',
                  'SR',
                  ...(showTimesOut ? ['Times out'] : []),
                ]
                const data = rows.map((inn) => {
                  const isDnb = !!inn.did_not_bat
                  const notOut = !isDnb && inn.times_out === 0
                  const match = `${shortTeam(inn.home_team) || '?'} vs ${shortTeam(inn.away_team) || '?'}`
                  const sr =
                    !isDnb && inn.balls > 0 ? ((inn.runs / inn.balls) * 100).toFixed(0) : ''
                  return [
                    inn.match_date || '',
                    match,
                    isDnb ? 'DNB' : inn.runs + (notOut ? '*' : ''),
                    isDnb ? '' : inn.balls,
                    isDnb ? '' : inn.fours,
                    isDnb ? '' : inn.sixes,
                    sr,
                    ...(showTimesOut ? [isDnb ? '' : inn.times_out] : []),
                  ]
                })
                downloadCsv(`${playerName}-batting.csv`, [header, ...data])
              }}
            >
              Export CSV
            </button>
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
                const rows = sortBattingRows(batting.innings, batSort)
                const showTimesOut = rows.some(isHurricaneRow)
                const battingMilestones = computeBattingMilestones(batting.innings)
                return (
                  <table>
                    <thead>
                      <tr>
                        <SortableTh
                          label="Date"
                          col="date"
                          sort={batSort}
                          setSort={setBatSort}
                          className="sortable"
                          style={{ whiteSpace: 'nowrap' }}
                        />
                        <th>Match</th>
                        <SortableTh label="R" col="runs" sort={batSort} setSort={setBatSort} />
                        <SortableTh label="B" col="balls" sort={batSort} setSort={setBatSort} />
                        <SortableTh label="4s" col="fours" sort={batSort} setSort={setBatSort} />
                        <SortableTh label="6s" col="sixes" sort={batSort} setSort={setBatSort} />
                        <SortableTh label="SR" col="sr" sort={batSort} setSort={setBatSort} />
                        {showTimesOut && (
                          <SortableTh
                            label="×Out"
                            col="outs"
                            sort={batSort}
                            setSort={setBatSort}
                            title="Times dismissed"
                          />
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((inn, i) => (
                        <BattingInningsRow
                          key={i}
                          inn={inn}
                          labels={battingMilestones.get(inn) || []}
                          showTimesOut={showTimesOut}
                          onClick={() => navigate(`/match/${inn.fixture_id}`)}
                        />
                      ))}
                    </tbody>
                  </table>
                )
              })()}
            </div>
          )}
        </>
      )}

      {activeTab === 'h2h' &&
        (h2hLoading ? (
          <div className="loading">Loading…</div>
        ) : !h2h ? null : (
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
                        <td className="num">
                          {Math.floor(r.legal_balls / 6)}.{r.legal_balls % 6}
                        </td>
                        <td className="num">{r.runs}</td>
                        <td className="num bold">{r.wickets}</td>
                        <td className="num">
                          {r.wickets > 0 ? (r.runs / r.wickets).toFixed(2) : '–'}
                        </td>
                        <td className="num">
                          {r.legal_balls > 0 ? ((r.runs / r.legal_balls) * 6).toFixed(2) : '–'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ))}

      {activeTab === 'bowling' && bowling && (
        <>
          <div className="stat-row">
            {[
              { label: 'Overs', value: bowling.totals.overs },
              { label: 'Wickets', value: bowling.totals.wickets },
              { label: 'Runs', value: bowling.totals.runs },
              { label: 'Average', value: bowling.totals.average },
              { label: 'Economy', value: bowling.totals.economy },
              { label: 'Best', value: bowling.totals.best },
              { label: 'Wides', value: bowling.totals.wides },
              { label: 'No balls', value: bowling.totals.noBalls },
            ].map((s) => (
              <div key={s.label} className="stat-box">
                <div className="label">{s.label}</div>
                <div className="value">{s.value}</div>
              </div>
            ))}
          </div>

          {batting?.fielding &&
            (batting.fielding.catches > 0 ||
              batting.fielding.stumpings > 0 ||
              batting.fielding.run_outs > 0) && (
              <div className="card" style={{ marginBottom: '1.25rem' }}>
                <h3 style={{ marginBottom: '0.5rem' }}>Fielding</h3>
                <div className="dismissal-grid">
                  {batting.fielding.catches > 0 && (
                    <div className="dismissal-item">
                      <span style={{ display: 'flex', justifyContent: 'center' }}>
                        <CatchingIcon size={18} />
                      </span>
                      <span className="dismissal-count">{batting.fielding.catches}</span>
                      <span className="dim">Catches</span>
                    </div>
                  )}
                  {batting.fielding.stumpings > 0 && (
                    <div className="dismissal-item">
                      <span style={{ display: 'flex', justifyContent: 'center' }}>
                        <Lock size={18} />
                      </span>
                      <span className="dismissal-count">{batting.fielding.stumpings}</span>
                      <span className="dim">Stumpings</span>
                    </div>
                  )}
                  {batting.fielding.run_outs > 0 && (
                    <div className="dismissal-item">
                      <span style={{ display: 'flex', justifyContent: 'center' }}>
                        <RunOutIcon size={18} />
                      </span>
                      <span className="dismissal-count">{batting.fielding.run_outs}</span>
                      <span className="dim">Run outs</span>
                    </div>
                  )}
                </div>
              </div>
            )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginTop: '0.5rem',
              marginBottom: 0,
            }}
          >
            <h2 style={{ marginBottom: 0 }}>Spell by spell</h2>
            <button
              className="secondary"
              style={{ fontSize: '0.75rem', padding: '2px 8px' }}
              onClick={() => {
                const spells = sortBowlingRows(bowling.spells, bowlSort)
                const header = [
                  'Date',
                  'Match',
                  'Overs',
                  'Runs',
                  'Wickets',
                  'Wides',
                  'No balls',
                  'Economy',
                ]
                const data = spells.map((sp) => {
                  const match = `${shortTeam(sp.home_team) || '?'} vs ${shortTeam(sp.away_team) || '?'}`
                  const overBalls = sp.legal_balls + (sp.wide_count || 0) + (sp.nb_count || 0)
                  const overs = `${Math.floor(overBalls / 6)}.${overBalls % 6}`
                  const econ = sp.legal_balls > 0 ? ((sp.runs / sp.legal_balls) * 6).toFixed(2) : ''
                  return [
                    sp.match_date || '',
                    match,
                    overs,
                    sp.runs,
                    sp.wickets,
                    sp.wides,
                    sp.no_balls,
                    econ,
                  ]
                })
                downloadCsv(`${playerName}-bowling.csv`, [header, ...data])
              }}
            >
              Export CSV
            </button>
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
                const bowlingMilestones = computeBowlingMilestones(bowling.spells)
                const displaySpells = sortBowlingRows(bowling.spells, bowlSort)
                return (
                  <table>
                    <thead>
                      <tr>
                        <SortableTh
                          label="Date"
                          col="date"
                          sort={bowlSort}
                          setSort={setBowlSort}
                          className="sortable"
                          style={{ whiteSpace: 'nowrap' }}
                        />
                        <th>Match</th>
                        <SortableTh label="O" col="overs" sort={bowlSort} setSort={setBowlSort} />
                        <SortableTh label="R" col="runs" sort={bowlSort} setSort={setBowlSort} />
                        <SortableTh label="W" col="wickets" sort={bowlSort} setSort={setBowlSort} />
                        <SortableTh label="Wd" col="wides" sort={bowlSort} setSort={setBowlSort} />
                        <SortableTh label="NB" col="nb" sort={bowlSort} setSort={setBowlSort} />
                        <SortableTh
                          label="Econ"
                          col="economy"
                          sort={bowlSort}
                          setSort={setBowlSort}
                        />
                      </tr>
                    </thead>
                    <tbody>
                      {displaySpells.map((sp, i) => (
                        <BowlingInningsRow
                          key={i}
                          sp={sp}
                          labels={bowlingMilestones.get(sp) || []}
                          onClick={() => navigate(`/match/${sp.fixture_id}`)}
                        />
                      ))}
                    </tbody>
                  </table>
                )
              })()}
            </div>
          )}
        </>
      )}
      {activeTab === 'keeping' && batting?.keeping?.matches > 0 && (
        <>
          <div className="stat-row" style={{ marginBottom: '1.25rem' }}>
            {[
              { label: 'Matches', value: batting.keeping.matches },
              { label: 'Catches', value: batting.keeping.catches },
              { label: 'Stumpings', value: batting.keeping.stumpings },
              ...(batting.keeping.byes > 0
                ? [{ label: 'Byes conceded', value: batting.keeping.byes }]
                : []),
            ].map((s) => (
              <div key={s.label} className="stat-box">
                <div className="label">{s.label}</div>
                <div className="value">{s.value}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <Tooltip id="pd-tip" />
    </div>
  )
}
