import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { Tooltip } from 'react-tooltip'
import { useApiFetch } from '../hooks/useApiFetch'
import { dn } from '../utils/cricket'
import { SkeletonRow } from '../components/Skeleton'
import { downloadCsv } from '../utils/csvExport'
import { JerseyIcon, jerseyInitials } from '../components/JerseyIcon'

function dash(v) { return v == null || v === '' ? '–' : v }
function n0(v)   { return v == null ? 0 : v }

function heatRange(rows, key) {
  const vals = rows.map(r => r[key]).filter(v => v != null && v !== '' && !isNaN(Number(v))).map(Number)
  if (vals.length < 2) return null
  const mn = Math.min(...vals), mx = Math.max(...vals)
  return mn < mx ? { mn, mx } : null
}
function heatBg(value, range, isNeg) {
  if (!range || value == null || value === '') return undefined
  const v = Number(value)
  if (isNaN(v)) return undefined
  const t = Math.min(1, Math.max(0, (v - range.mn) / (range.mx - range.mn)))
  if (t <= 0) return undefined
  const a = t * 0.45
  return isNeg ? `rgba(255,167,38,${a})` : `rgba(76,175,80,${a})`
}

function SortTh({ label, title, sortKey, activeSort, onSort, isName = false, style }) {
  const active = activeSort.key === sortKey
  const arrow  = active ? (activeSort.dir === -1 ? ' ↓' : ' ↑') : ''
  const ariaSort = active ? (activeSort.dir === -1 ? 'descending' : 'ascending') : 'none'
  return (
    <th
      role="columnheader"
      aria-sort={ariaSort}
      tabIndex={0}
      className={isName ? 'sortable' : 'sortable num'}
      data-tooltip-id="pl-tip"
      data-tooltip-content={title || label}
      onClick={() => onSort(sortKey)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(sortKey) } }}
      style={{ whiteSpace: 'nowrap', ...style }}
    >
      {label}{arrow}
    </th>
  )
}

function sortRows(arr, { key, dir }) {
  return [...arr].sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    if (av == null || av === '') return 1
    if (bv == null || bv === '') return -1
    const an = Number(av)
    if (!isNaN(an)) return (an - Number(bv)) * dir
    return String(av).localeCompare(String(bv)) * dir
  })
}


function FilterPills({ label, options, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.78rem', color: 'var(--text2)', marginRight: 2 }}>{label}</span>
      {options.map(o => (
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

function ViewToggle({ value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span style={{ fontSize: '0.78rem', color: 'var(--text2)', marginRight: 2 }}>View</span>
      {['Table', 'Cards'].map(v => (
        <button
          key={v}
          className={value === v ? 'pill active' : 'pill'}
          onClick={() => onChange(v)}
        >
          {v}
        </button>
      ))}
    </div>
  )
}

function BatCard({ p, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--bg3)',
        border: '1px solid var(--border2)',
        borderRadius: '10px',
        padding: '0.85rem 1rem',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: '0.92rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <JerseyIcon size={18} initials={jerseyInitials(p.name)} />{dn(p.name)}
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>
        {n0(p.games_attended)} mat
      </div>
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Runs</div>
          <div style={{ fontWeight: 600, fontSize: '1rem' }}>{n0(p.runs)}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Avg</div>
          <div style={{ fontWeight: 600, fontSize: '1rem' }}>{p.bat_avg_per_game ?? '–'}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>SR</div>
          <div style={{ fontWeight: 600, fontSize: '1rem' }}>{p.bat_sr ?? '–'}</div>
        </div>
      </div>
    </div>
  )
}

function BowlCard({ p, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--bg3)',
        border: '1px solid var(--border2)',
        borderRadius: '10px',
        padding: '0.85rem 1rem',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
      }}
    >
      <div style={{ fontWeight: 600, fontSize: '0.92rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <JerseyIcon size={18} initials={jerseyInitials(p.name)} />{dn(p.name)}
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>
        {n0(p.games_attended)} mat
      </div>
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Wkts</div>
          <div style={{ fontWeight: 600, fontSize: '1rem' }}>{n0(p.wickets)}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Avg</div>
          <div style={{ fontWeight: 600, fontSize: '1rem' }}>{p.bowl_avg ?? '–'}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Econ</div>
          <div style={{ fontWeight: 600, fontSize: '1rem' }}>{p.bowl_econ ?? '–'}</div>
        </div>
      </div>
    </div>
  )
}

const cardGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
  gap: '0.75rem',
  marginBottom: '2.5rem',
}

export default function PlayerList() {
  const { user } = useUser()
  const isSuperAdmin = user?.publicMetadata?.isSuperAdmin === true
  const hasGroups    = (user?.publicMetadata?.accessGroups ?? []).length > 0
  const showFilters  = isSuperAdmin || hasGroups

  const [players,      setPlayers]      = useState([])
  const [years,        setYears]        = useState([])
  const [partnerships, setPartnerships] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [showSubs, setShowSubs] = useState(false)
  const [listView, setListView] = useState(() => localStorage.getItem('playerListView') || 'Table')

  function handleViewChange(v) {
    setListView(v)
    localStorage.setItem('playerListView', v)
  }
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const apiFetch = useApiFetch()

  const year = searchParams.get('year') || ''
  const team = searchParams.get('team') || ''
  const comp = searchParams.get('comp') || ''
  const batSort     = { key: searchParams.get('batKey')     || 'runs',       dir: Number(searchParams.get('batDir'))     || -1 }
  const bowlSort    = { key: searchParams.get('bowlKey')    || 'wickets',    dir: Number(searchParams.get('bowlDir'))    || -1 }
  const partnerSort = { key: searchParams.get('partnerKey') || 'total_runs', dir: Number(searchParams.get('partnerDir')) || -1 }

  function updateFilter(key, value, defaultValue) {
    const next = new URLSearchParams(searchParams)
    if (value === defaultValue) next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (year) params.set('year', year)
    if (team) params.set('team', team)
    if (comp) params.set('comp', comp)
    Promise.all([
      apiFetch(`/api/players/stats?${params}`).then(r => r.json()),
      apiFetch(`/api/players/partnerships?${params}`).then(r => r.json()),
    ]).then(([stats, pships]) => {
        setPlayers(stats.players || [])
        if (stats.years?.length) setYears(stats.years)
        setPartnerships(pships || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, team, comp])

  function toggleSort(prefix, defaultKey, currentSort, key) {
    const next = new URLSearchParams(searchParams)
    const newDir = currentSort.key === key ? -currentSort.dir : -1
    if (key === defaultKey) { next.delete(`${prefix}Key`) } else { next.set(`${prefix}Key`, key) }
    if (newDir === -1) { next.delete(`${prefix}Dir`) } else { next.set(`${prefix}Dir`, String(newDir)) }
    setSearchParams(next, { replace: true })
  }

  const filtered = players
    .filter(p => !search || p.name?.toLowerCase().includes(search.toLowerCase()))
    .filter(p => showSubs || !p.is_sub)

  const batPlayers      = sortRows(filtered.filter(p => n0(p.innings) > 0 || n0(p.dnb_count) > 0 || n0(p.games_attended) > 0), batSort)
  const bowlPlayers     = sortRows(filtered.filter(p => n0(p.games_bowled) > 0 || n0(p.games_attended) > 0), bowlSort)
  const sortedPartners  = sortRows(partnerships, partnerSort)

  const onBat     = k => toggleSort('bat',     'runs',       batSort,     k)
  const onBowl    = k => toggleSort('bowl',    'wickets',    bowlSort,    k)
  const onPartner = k => toggleSort('partner', 'total_runs', partnerSort, k)

  function exportBatCsv() {
    const header = ['Name','Mat','Inn','NO','Runs','HS','Avg','SR','Balls',
      ...(batShow.dot_balls ? ['Dots'] : []),
      '4s','6s',
      ...(batShow.total_minutes ? ['Mins','Min/I'] : []),
      'Out',
      ...(batShow.dis_bowled  ? ['Bowled']  : []),
      ...(batShow.dis_caught  ? ['Caught']  : []),
      ...(batShow.dis_lbw     ? ['LBW']     : []),
      ...(batShow.dis_runout  ? ['Run out'] : []),
      ...(batShow.dis_stumped ? ['Stumped'] : []),
      ...(batShow.captain_count ? ['Capt'] : []),
      ...(batShow.wk_count    ? ['WK']     : []),
    ]
    const data = batPlayers.map(p => [
      p.name, n0(p.games_attended), n0(p.innings), n0(p.not_outs),
      n0(p.runs), n0(p.high_score), p.bat_avg_per_game ?? '', p.bat_sr ?? '',
      n0(p.balls_faced),
      ...(batShow.dot_balls ? [n0(p.dot_balls)] : []),
      n0(p.fours), n0(p.sixes),
      ...(batShow.total_minutes ? [n0(p.total_minutes), p.avg_minutes ?? ''] : []),
      n0(p.times_out),
      ...(batShow.dis_bowled  ? [n0(p.dis_bowled)]  : []),
      ...(batShow.dis_caught  ? [n0(p.dis_caught)]  : []),
      ...(batShow.dis_lbw     ? [n0(p.dis_lbw)]     : []),
      ...(batShow.dis_runout  ? [n0(p.dis_runout)]  : []),
      ...(batShow.dis_stumped ? [n0(p.dis_stumped)] : []),
      ...(batShow.captain_count ? [n0(p.captain_count)] : []),
      ...(batShow.wk_count    ? [n0(p.wk_count)]    : []),
    ])
    downloadCsv(`players-${year || 'all'}-batting.csv`, [header, ...data])
  }

  function exportBowlCsv() {
    const header = ['Name','Mat','Inn','Overs',
      ...(bowlShow.maidens         ? ['M']    : []),
      ...(bowlShow.wicket_maidens  ? ['WM']   : []),
      ...(bowlShow.bowl_dot_balls  ? ['Dots'] : []),
      'R','W','Avg','Econ','W/O',
      ...(bowlShow.three_fers  ? ['3W'] : []),
      ...(bowlShow.four_fers   ? ['4W'] : []),
      ...(bowlShow.five_fers   ? ['5W'] : []),
      ...(bowlShow.six_fers    ? ['6W'] : []),
      'Wd','NB',
      ...(bowlShow.wkt_bowled  ? ['Wkt Bowled']  : []),
      ...(bowlShow.wkt_caught  ? ['Wkt Caught']  : []),
      ...(bowlShow.wkt_lbw     ? ['Wkt LBW']     : []),
      ...(bowlShow.wkt_stumped ? ['Wkt Stumped'] : []),
      ...(bowlShow.catches     ? ['Catches']     : []),
      ...(bowlShow.stumpings   ? ['Stumpings']   : []),
      ...(bowlShow.run_outs    ? ['Run outs']    : []),
    ]
    const data = bowlPlayers.map(p => [
      p.name, n0(p.games_attended), n0(p.games_bowled), p.overs,
      ...(bowlShow.maidens         ? [n0(p.maidens)]         : []),
      ...(bowlShow.wicket_maidens  ? [n0(p.wicket_maidens)]  : []),
      ...(bowlShow.bowl_dot_balls  ? [n0(p.bowl_dot_balls)]  : []),
      n0(p.runs_conceded), n0(p.wickets), p.bowl_avg ?? '', p.bowl_econ ?? '', p.wkts_per_over ?? '',
      ...(bowlShow.three_fers  ? [n0(p.three_fers)]  : []),
      ...(bowlShow.four_fers   ? [n0(p.four_fers)]   : []),
      ...(bowlShow.five_fers   ? [n0(p.five_fers)]   : []),
      ...(bowlShow.six_fers    ? [n0(p.six_fers)]    : []),
      n0(p.wides), n0(p.no_balls),
      ...(bowlShow.wkt_bowled  ? [n0(p.wkt_bowled)]  : []),
      ...(bowlShow.wkt_caught  ? [n0(p.wkt_caught)]  : []),
      ...(bowlShow.wkt_lbw     ? [n0(p.wkt_lbw)]     : []),
      ...(bowlShow.wkt_stumped ? [n0(p.wkt_stumped)] : []),
      ...(bowlShow.catches     ? [n0(p.catches)]     : []),
      ...(bowlShow.stumpings   ? [n0(p.stumpings)]   : []),
      ...(bowlShow.run_outs    ? [n0(p.run_outs)]    : []),
    ])
    downloadCsv(`players-${year || 'all'}-bowling.csv`, [header, ...data])
  }

  const batR = {
    games_attended: heatRange(batPlayers, 'games_attended'),
    innings:        heatRange(batPlayers, 'innings'),
    not_outs:       heatRange(batPlayers, 'not_outs'),
    runs:          heatRange(batPlayers, 'runs'),
    high_score:    heatRange(batPlayers, 'high_score'),
    bat_avg_per_game: heatRange(batPlayers, 'bat_avg_per_game'),
    balls_faced:      heatRange(batPlayers, 'balls_faced'),
    dot_balls:        heatRange(batPlayers, 'dot_balls'),
    fours:         heatRange(batPlayers, 'fours'),
    sixes:         heatRange(batPlayers, 'sixes'),
    bat_sr:        heatRange(batPlayers, 'bat_sr'),
    total_minutes: heatRange(batPlayers, 'total_minutes'),
    avg_minutes:   heatRange(batPlayers, 'avg_minutes'),
    captain_count: heatRange(batPlayers, 'captain_count'),
    wk_count:      heatRange(batPlayers, 'wk_count'),
    times_out:     heatRange(batPlayers, 'times_out'),
    dis_bowled:    heatRange(batPlayers, 'dis_bowled'),
    dis_caught:    heatRange(batPlayers, 'dis_caught'),
    dis_lbw:       heatRange(batPlayers, 'dis_lbw'),
    dis_runout:    heatRange(batPlayers, 'dis_runout'),
    dis_stumped:   heatRange(batPlayers, 'dis_stumped'),
  }
  const bowlR = {
    games_attended: heatRange(bowlPlayers, 'games_attended'),
    games_bowled:   heatRange(bowlPlayers, 'games_bowled'),
    balls_bowled:   heatRange(bowlPlayers, 'balls_bowled'),
    wickets:        heatRange(bowlPlayers, 'wickets'),
    maidens:        heatRange(bowlPlayers, 'maidens'),
    wicket_maidens: heatRange(bowlPlayers, 'wicket_maidens'),
    wkts_per_over:  heatRange(bowlPlayers, 'wkts_per_over'),
    three_fers:     heatRange(bowlPlayers, 'three_fers'),
    four_fers:      heatRange(bowlPlayers, 'four_fers'),
    five_fers:      heatRange(bowlPlayers, 'five_fers'),
    six_fers:       heatRange(bowlPlayers, 'six_fers'),
    catches:        heatRange(bowlPlayers, 'catches'),
    stumpings:      heatRange(bowlPlayers, 'stumpings'),
    run_outs:       heatRange(bowlPlayers, 'run_outs'),
    wkt_bowled:     heatRange(bowlPlayers, 'wkt_bowled'),
    wkt_caught:     heatRange(bowlPlayers, 'wkt_caught'),
    wkt_lbw:        heatRange(bowlPlayers, 'wkt_lbw'),
    wkt_stumped:    heatRange(bowlPlayers, 'wkt_stumped'),
    runs_conceded:  heatRange(bowlPlayers, 'runs_conceded'),
    bowl_avg:       heatRange(bowlPlayers, 'bowl_avg'),
    bowl_econ:      heatRange(bowlPlayers, 'bowl_econ'),
    bowl_sr:        heatRange(bowlPlayers, 'bowl_sr'),
    wides:          heatRange(bowlPlayers, 'wides'),
    no_balls:       heatRange(bowlPlayers, 'no_balls'),
    bowl_dot_balls: heatRange(bowlPlayers, 'bowl_dot_balls'),
  }

  const batShow = {
    dot_balls:     batPlayers.some(p => n0(p.dot_balls) > 0),
    total_minutes: batPlayers.some(p => n0(p.total_minutes) > 0),
    dis_bowled:    batPlayers.some(p => n0(p.dis_bowled) > 0),
    dis_caught:    batPlayers.some(p => n0(p.dis_caught) > 0),
    dis_lbw:       batPlayers.some(p => n0(p.dis_lbw) > 0),
    dis_runout:    batPlayers.some(p => n0(p.dis_runout) > 0),
    dis_stumped:   batPlayers.some(p => n0(p.dis_stumped) > 0),
    captain_count: batPlayers.some(p => n0(p.captain_count) > 0),
    wk_count:      batPlayers.some(p => n0(p.wk_count) > 0),
  }
  const bowlShow = {
    maidens:        bowlPlayers.some(p => n0(p.maidens) > 0),
    wicket_maidens: bowlPlayers.some(p => n0(p.wicket_maidens) > 0),
    three_fers:     bowlPlayers.some(p => n0(p.three_fers) > 0),
    four_fers:      bowlPlayers.some(p => n0(p.four_fers) > 0),
    five_fers:      bowlPlayers.some(p => n0(p.five_fers) > 0),
    six_fers:       bowlPlayers.some(p => n0(p.six_fers) > 0),
    wkt_bowled:     bowlPlayers.some(p => n0(p.wkt_bowled) > 0),
    wkt_caught:     bowlPlayers.some(p => n0(p.wkt_caught) > 0),
    wkt_lbw:        bowlPlayers.some(p => n0(p.wkt_lbw) > 0),
    wkt_stumped:    bowlPlayers.some(p => n0(p.wkt_stumped) > 0),
    catches:        bowlPlayers.some(p => n0(p.catches) > 0),
    stumpings:      bowlPlayers.some(p => n0(p.stumpings) > 0),
    run_outs:       bowlPlayers.some(p => n0(p.run_outs) > 0),
    bowl_dot_balls: bowlPlayers.some(p => n0(p.bowl_dot_balls) > 0),
  }

  const gb = { borderLeft: '2px solid var(--border2)' }
  const ghStyle = { textAlign: 'center', fontSize: '0.68rem', fontWeight: 500, color: 'var(--text3)', paddingTop: 4, paddingBottom: 2, ...gb }
  const batDisCount    = 1 + (batShow.dis_bowled?1:0) + (batShow.dis_caught?1:0) + (batShow.dis_lbw?1:0) + (batShow.dis_runout?1:0) + (batShow.dis_stumped?1:0)
  const bowlHaulCount  = (bowlShow.three_fers?1:0) + (bowlShow.four_fers?1:0) + (bowlShow.five_fers?1:0) + (bowlShow.six_fers?1:0)
  const bowlWktCount   = (bowlShow.wkt_bowled?1:0) + (bowlShow.wkt_caught?1:0) + (bowlShow.wkt_lbw?1:0) + (bowlShow.wkt_stumped?1:0)
  const bowlFieldCount = (bowlShow.catches?1:0) + (bowlShow.stumpings?1:0) + (bowlShow.run_outs?1:0)
  const batFirstRole   = batShow.captain_count ? 'captain_count' : 'wk_count'
  const bowlFirstHaul  = bowlShow.three_fers ? 'three_fers' : bowlShow.four_fers ? 'four_fers' : bowlShow.five_fers ? 'five_fers' : 'six_fers'
  const bowlFirstWkt   = bowlShow.wkt_bowled ? 'wkt_bowled' : bowlShow.wkt_caught ? 'wkt_caught' : bowlShow.wkt_lbw ? 'wkt_lbw' : 'wkt_stumped'
  const bowlFirstFld   = bowlShow.catches ? 'catches' : bowlShow.stumpings ? 'stumpings' : 'run_outs'

  const yearOptions = [{ value: '', label: 'All' }, ...years.map(y => ({ value: y, label: y }))]
  const teamOptions = [
    { value: '',          label: 'All' },
    { value: 'whirlwind', label: 'Whirlwinds' },
    { value: 'hurricane', label: 'Hurricanes' },
  ]

  return (
    <div className="page" style={{ maxWidth: '1600px' }}>
      <h1>Players</h1>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <input
          className="search-input"
          type="search"
          placeholder="Search players…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        {showFilters && (
          <>
            <FilterPills label="Year" options={yearOptions} value={year} onChange={v => updateFilter('year', v, '')} />
            <FilterPills label="Team" options={teamOptions} value={team} onChange={v => updateFilter('team', v, '')} />
            <FilterPills
              label="Type"
              options={[
                { value: '',         label: 'All' },
                { value: 'league',   label: 'League' },
                { value: 'cup',      label: 'Cup' },
                { value: 'friendly', label: 'Friendly' },
              ]}
              value={comp}
              onChange={v => updateFilter('comp', v, '')}
            />
          </>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.82rem', cursor: 'pointer', color: 'var(--text2)' }}>
          <input type="checkbox" checked={showSubs} onChange={e => setShowSubs(e.target.checked)} style={{ accentColor: '#690028' }} />
          Show subs
        </label>
        <ViewToggle value={listView} onChange={handleViewChange} />
      </div>

      {loading ? (
        <>
          <h2 style={{ marginBottom: '0.5rem' }}>Batting</h2>
          <div className="card" style={{ padding: 0, overflowX: 'auto', marginBottom: '2.5rem', border: '1px solid var(--border2)' }}>
            <table style={{ fontSize: '0.8rem' }}>
              <tbody>
                {Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} cols={14} />)}
              </tbody>
            </table>
          </div>
          <h2 style={{ marginBottom: '0.5rem' }}>Bowling</h2>
          <div className="card" style={{ padding: 0, overflowX: 'auto', border: '1px solid var(--border2)' }}>
            <table style={{ fontSize: '0.8rem' }}>
              <tbody>
                {Array.from({ length: 10 }).map((_, i) => <SkeletonRow key={i} cols={12} />)}
              </tbody>
            </table>
          </div>
        </>
      ) : filtered.length === 0 ? (
        <div className="empty">
          {year || team || comp || search
            ? `No players found${team ? ` for ${team === 'whirlwind' ? 'Whirlwinds' : 'Hurricanes'}` : ''}${year ? ` in ${year}` : ''} — try adjusting the filters.`
            : 'No players found.'}
        </div>
      ) : (
        <>
          {/* ── Batting ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <h2 style={{ marginBottom: 0 }}>Batting</h2>
            <button className="secondary" style={{ fontSize: '0.75rem', padding: '2px 8px' }} onClick={exportBatCsv}>Export CSV</button>
          </div>
          {listView === 'Cards' ? (
            <div style={cardGridStyle}>
              {batPlayers.map(p => (
                <BatCard key={p.player_id} p={p} onClick={() => navigate(`/player/${p.player_id}`)} />
              ))}
            </div>
          ) : (
          <div className="card" style={{ padding: 0, overflowX: 'auto', marginBottom: '2.5rem', border: '1px solid var(--border2)' }}>
            <table style={{ fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  <th />
                  <th colSpan={3} style={ghStyle}>Appearances</th>
                  <th colSpan={4} style={ghStyle}>Batting</th>
                  <th colSpan={1 + (batShow.dot_balls?1:0)} style={ghStyle}>Balls</th>
                  <th colSpan={2} style={ghStyle}>Boundaries</th>
                  {batShow.total_minutes && <th colSpan={2} style={ghStyle}>Time</th>}
                  <th colSpan={batDisCount} style={ghStyle}>Dismissals</th>
                  {(batShow.captain_count || batShow.wk_count) && <th colSpan={(batShow.captain_count?1:0)+(batShow.wk_count?1:0)} style={ghStyle}>Roles</th>}
                </tr>
                <tr>
                  <SortTh label="Name"  sortKey="name"          activeSort={batSort} onSort={onBat} isName title="Player name" />
                  <SortTh label="Mat"   sortKey="games_attended" activeSort={batSort} onSort={onBat} title="Matches attended (batted or bowled)" style={gb} />
                  <SortTh label="Inn"   sortKey="innings"        activeSort={batSort} onSort={onBat} title="Innings batted" />
                  <SortTh label="NO"    sortKey="not_outs"       activeSort={batSort} onSort={onBat} title="Not outs" />
                  <SortTh label="Runs"  sortKey="runs"           activeSort={batSort} onSort={onBat} title="Total runs" style={gb} />
                  <SortTh label="HS"    sortKey="high_score"     activeSort={batSort} onSort={onBat} title="Highest score" />
                  <SortTh label="Avg" sortKey="bat_avg_per_game" activeSort={batSort} onSort={onBat} title="Average per game (runs ÷ matches batted)" />
                  <SortTh label="SR"    sortKey="bat_sr"         activeSort={batSort} onSort={onBat} title="Strike rate (runs per 100 balls)" />
                  <SortTh label="B"     sortKey="balls_faced"      activeSort={batSort} onSort={onBat} title="Balls faced" style={gb} />
                  {batShow.dot_balls    && <SortTh label="Dots"  sortKey="dot_balls"        activeSort={batSort} onSort={onBat} title="Dot balls (legal deliveries scoring 0)" />}
                  <SortTh label="4s"    sortKey="fours"          activeSort={batSort} onSort={onBat} title="Fours" style={gb} />
                  <SortTh label="6s"    sortKey="sixes"          activeSort={batSort} onSort={onBat} title="Sixes" />
                  {batShow.total_minutes && <SortTh label="Mins"  sortKey="total_minutes"  activeSort={batSort} onSort={onBat} title="Total minutes at crease (inc. non-striker)" style={gb} />}
                  {batShow.total_minutes && <SortTh label="Min/I" sortKey="avg_minutes"    activeSort={batSort} onSort={onBat} title="Average minutes per innings" />}
                  <SortTh label="Out"   sortKey="times_out"      activeSort={batSort} onSort={onBat} title="Times dismissed" style={gb} />
                  {batShow.dis_bowled   && <SortTh label="Bo"    sortKey="dis_bowled"     activeSort={batSort} onSort={onBat} title="Times bowled" />}
                  {batShow.dis_caught   && <SortTh label="Ct"    sortKey="dis_caught"     activeSort={batSort} onSort={onBat} title="Times caught" />}
                  {batShow.dis_lbw      && <SortTh label="LBW"   sortKey="dis_lbw"        activeSort={batSort} onSort={onBat} title="Times out LBW" />}
                  {batShow.dis_runout   && <SortTh label="RO"    sortKey="dis_runout"     activeSort={batSort} onSort={onBat} title="Times run out" />}
                  {batShow.dis_stumped  && <SortTh label="St"    sortKey="dis_stumped"    activeSort={batSort} onSort={onBat} title="Times stumped" />}
                  {batShow.captain_count && <SortTh label="Capt"  sortKey="captain_count"  activeSort={batSort} onSort={onBat} title="Times captain" style={gb} />}
                  {batShow.wk_count     && <SortTh label="WK"    sortKey="wk_count"       activeSort={batSort} onSort={onBat} title="Times wicket keeper" style={batFirstRole === 'wk_count' ? gb : undefined} />}
                </tr>
              </thead>
              <tbody>
                {batPlayers.map(p => (
                  <tr key={p.player_id} style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/player/${p.player_id}`)}>
                    <td className="bold" style={{ whiteSpace: 'nowrap' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><JerseyIcon size={24} initials={jerseyInitials(p.name)} />{dn(p.name)}</span></td>
                    <td className="num" style={{ backgroundColor: heatBg(p.games_attended, batR.games_attended, false), ...gb }}>{n0(p.games_attended)}</td>
                    <td className="num" style={{ backgroundColor: heatBg(p.innings, batR.innings, false) }}>{n0(p.innings)}</td>
                    <td className="num dim" style={{ backgroundColor: heatBg(p.not_outs, batR.not_outs, false) }}>{n0(p.not_outs)}</td>
                    <td className="num bold" style={{ backgroundColor: heatBg(p.runs, batR.runs, false), ...gb }}>{n0(p.runs)}</td>
                    <td className="num" style={{ backgroundColor: heatBg(p.high_score, batR.high_score, false) }}>{n0(p.high_score)}</td>
                    <td className="num" style={{ backgroundColor: heatBg(p.bat_avg_per_game, batR.bat_avg_per_game, false) }}>{dash(p.bat_avg_per_game)}</td>
                    <td className="num dim" style={{ backgroundColor: heatBg(p.bat_sr, batR.bat_sr, false) }}>{dash(p.bat_sr)}</td>
                    <td className="num dim" style={{ backgroundColor: heatBg(p.balls_faced, batR.balls_faced, false), ...gb }}>{n0(p.balls_faced)}</td>
                    {batShow.dot_balls    && <td className="num dim" style={{ backgroundColor: heatBg(p.dot_balls, batR.dot_balls, true) }}>{n0(p.dot_balls) || '–'}</td>}
                    <td className="num" style={{ backgroundColor: heatBg(p.fours, batR.fours, false), ...gb }}>{n0(p.fours)}</td>
                    <td className="num" style={{ backgroundColor: heatBg(p.sixes, batR.sixes, false) }}>{n0(p.sixes)}</td>
                    {batShow.total_minutes && <td className="num dim" style={{ backgroundColor: heatBg(p.total_minutes, batR.total_minutes, false), ...gb }}>{n0(p.total_minutes) || '–'}</td>}
                    {batShow.total_minutes && <td className="num dim" style={{ backgroundColor: heatBg(p.avg_minutes, batR.avg_minutes, false) }}>{dash(p.avg_minutes)}</td>}
                    <td className="num" style={{ backgroundColor: heatBg(p.times_out, batR.times_out, true), ...gb }}>{n0(p.times_out)}</td>
                    {batShow.dis_bowled   && <td className="num dim" style={{ backgroundColor: heatBg(p.dis_bowled, batR.dis_bowled, true) }}>{n0(p.dis_bowled)  || '–'}</td>}
                    {batShow.dis_caught   && <td className="num dim" style={{ backgroundColor: heatBg(p.dis_caught, batR.dis_caught, true) }}>{n0(p.dis_caught)  || '–'}</td>}
                    {batShow.dis_lbw      && <td className="num dim" style={{ backgroundColor: heatBg(p.dis_lbw, batR.dis_lbw, true) }}>{n0(p.dis_lbw)     || '–'}</td>}
                    {batShow.dis_runout   && <td className="num dim" style={{ backgroundColor: heatBg(p.dis_runout, batR.dis_runout, true) }}>{n0(p.dis_runout)  || '–'}</td>}
                    {batShow.dis_stumped  && <td className="num dim" style={{ backgroundColor: heatBg(p.dis_stumped, batR.dis_stumped, true) }}>{n0(p.dis_stumped) || '–'}</td>}
                    {batShow.captain_count && <td className="num dim" style={{ backgroundColor: heatBg(p.captain_count, batR.captain_count, false), ...gb }}>{n0(p.captain_count) || '–'}</td>}
                    {batShow.wk_count     && <td className="num dim" style={{ backgroundColor: heatBg(p.wk_count, batR.wk_count, false), ...(batFirstRole === 'wk_count' ? gb : {}) }}>{n0(p.wk_count)      || '–'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          {/* ── Bowling ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <h2 style={{ marginBottom: 0 }}>Bowling</h2>
            {bowlPlayers.length > 0 && <button className="secondary" style={{ fontSize: '0.75rem', padding: '2px 8px' }} onClick={exportBowlCsv}>Export CSV</button>}
          </div>
          {bowlPlayers.length === 0 ? (
            <div className="empty">
              {year || team || comp
                ? `No bowling data${team ? ` for ${team === 'whirlwind' ? 'Whirlwinds' : 'Hurricanes'}` : ''}${year ? ` in ${year}` : ''} — try adjusting the filters.`
                : 'No bowling data yet.'}
            </div>
          ) : listView === 'Cards' ? (
            <div style={cardGridStyle}>
              {bowlPlayers.map(p => (
                <BowlCard key={p.player_id} p={p} onClick={() => navigate(`/player/${p.player_id}`)} />
              ))}
            </div>
          ) : (
            <div className="card" style={{ padding: 0, overflowX: 'auto', border: '1px solid var(--border2)' }}>
              <table style={{ fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    <th />
                    <th colSpan={2} style={ghStyle}>Appearances</th>
                    <th colSpan={1+(bowlShow.maidens?1:0)+(bowlShow.wicket_maidens?1:0)+(bowlShow.bowl_dot_balls?1:0)} style={ghStyle}>Bowling</th>
                    <th colSpan={5} style={ghStyle}>Performance</th>
                    {bowlHaulCount > 0 && <th colSpan={bowlHaulCount} style={ghStyle}>Hauls</th>}
                    <th colSpan={2} style={ghStyle}>Extras</th>
                    {bowlWktCount > 0 && <th colSpan={bowlWktCount} style={ghStyle}>Wickets</th>}
                    {bowlFieldCount > 0 && <th colSpan={bowlFieldCount} style={ghStyle}>Fielding</th>}
                  </tr>
                  <tr>
                    <SortTh label="Name"  sortKey="name"           activeSort={bowlSort} onSort={onBowl} isName title="Player name" />
                    <SortTh label="Mat"   sortKey="games_attended"  activeSort={bowlSort} onSort={onBowl} title="Matches attended" style={gb} />
                    <SortTh label="Inn"   sortKey="games_bowled"    activeSort={bowlSort} onSort={onBowl} title="Innings bowled" />
                    <SortTh label="O"     sortKey="balls_bowled"    activeSort={bowlSort} onSort={onBowl} title="Overs bowled" style={gb} />
                    {bowlShow.maidens        && <SortTh label="M"     sortKey="maidens"         activeSort={bowlSort} onSort={onBowl} title="Maiden overs" />}
                    {bowlShow.wicket_maidens && <SortTh label="WM"    sortKey="wicket_maidens"  activeSort={bowlSort} onSort={onBowl} title="Wicket maidens" />}
                    {bowlShow.bowl_dot_balls && <SortTh label="Dots"  sortKey="bowl_dot_balls"  activeSort={bowlSort} onSort={onBowl} title="Dot balls bowled" />}
                    <SortTh label="R"     sortKey="runs_conceded"   activeSort={bowlSort} onSort={onBowl} title="Runs conceded" style={gb} />
                    <SortTh label="W"     sortKey="wickets"         activeSort={bowlSort} onSort={onBowl} title="Wickets" />
                    <SortTh label="Avg"   sortKey="bowl_avg"        activeSort={bowlSort} onSort={onBowl} title="Bowling average (runs ÷ wickets)" />
                    <SortTh label="Econ"  sortKey="bowl_econ"       activeSort={bowlSort} onSort={onBowl} title="Economy (runs per over)" />
                    <SortTh label="W/O"   sortKey="wkts_per_over"   activeSort={bowlSort} onSort={onBowl} title="Wickets per over" />
                    {bowlShow.three_fers  && <SortTh label="3W"    sortKey="three_fers"      activeSort={bowlSort} onSort={onBowl} title="3-wicket hauls" style={bowlFirstHaul === 'three_fers'  ? gb : undefined} />}
                    {bowlShow.four_fers   && <SortTh label="4W"    sortKey="four_fers"       activeSort={bowlSort} onSort={onBowl} title="4-wicket hauls" style={bowlFirstHaul === 'four_fers'   ? gb : undefined} />}
                    {bowlShow.five_fers   && <SortTh label="5W"    sortKey="five_fers"       activeSort={bowlSort} onSort={onBowl} title="5-wicket hauls" style={bowlFirstHaul === 'five_fers'   ? gb : undefined} />}
                    {bowlShow.six_fers    && <SortTh label="6W"    sortKey="six_fers"        activeSort={bowlSort} onSort={onBowl} title="6-wicket hauls" style={bowlFirstHaul === 'six_fers'    ? gb : undefined} />}
                    <SortTh label="Wd"    sortKey="wides"           activeSort={bowlSort} onSort={onBowl} title="Wides" style={gb} />
                    <SortTh label="NB"    sortKey="no_balls"        activeSort={bowlSort} onSort={onBowl} title="No balls" />
                    {bowlShow.wkt_bowled  && <SortTh label="Bo"    sortKey="wkt_bowled"      activeSort={bowlSort} onSort={onBowl} title="Wickets: bowled" style={bowlFirstWkt === 'wkt_bowled'  ? gb : undefined} />}
                    {bowlShow.wkt_caught  && <SortTh label="Ct"    sortKey="wkt_caught"      activeSort={bowlSort} onSort={onBowl} title="Wickets: caught (inc. c&b)" style={bowlFirstWkt === 'wkt_caught'  ? gb : undefined} />}
                    {bowlShow.wkt_lbw     && <SortTh label="LBW"   sortKey="wkt_lbw"         activeSort={bowlSort} onSort={onBowl} title="Wickets: LBW" style={bowlFirstWkt === 'wkt_lbw'     ? gb : undefined} />}
                    {bowlShow.wkt_stumped && <SortTh label="St"    sortKey="wkt_stumped"     activeSort={bowlSort} onSort={onBowl} title="Wickets: stumped" style={bowlFirstWkt === 'wkt_stumped' ? gb : undefined} />}
                    {bowlShow.catches     && <SortTh label="Cau"   sortKey="catches"         activeSort={bowlSort} onSort={onBowl} title="Catches taken in field" style={bowlFirstFld === 'catches'     ? gb : undefined} />}
                    {bowlShow.stumpings   && <SortTh label="Stp"   sortKey="stumpings"       activeSort={bowlSort} onSort={onBowl} title="Stumpings" style={bowlFirstFld === 'stumpings'   ? gb : undefined} />}
                    {bowlShow.run_outs    && <SortTh label="RO"    sortKey="run_outs"        activeSort={bowlSort} onSort={onBowl} title="Run outs effected" style={bowlFirstFld === 'run_outs'    ? gb : undefined} />}
                  </tr>
                </thead>
                <tbody>
                  {bowlPlayers.map(p => (
                    <tr key={p.player_id} style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/player/${p.player_id}`)}>
                      <td className="bold" style={{ whiteSpace: 'nowrap' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}><JerseyIcon size={24} initials={jerseyInitials(p.name)} />{dn(p.name)}</span></td>
                      <td className="num" style={{ backgroundColor: heatBg(p.games_attended, bowlR.games_attended, false), ...gb }}>{n0(p.games_attended)}</td>
                      <td className="num" style={{ backgroundColor: heatBg(p.games_bowled, bowlR.games_bowled, false) }}>{n0(p.games_bowled)}</td>
                      <td className="num" style={{ backgroundColor: heatBg(p.balls_bowled, bowlR.balls_bowled, false), ...gb }}>{p.overs}</td>
                      {bowlShow.maidens        && <td className="num" style={{ backgroundColor: heatBg(p.maidens, bowlR.maidens, false) }}>{n0(p.maidens)}</td>}
                      {bowlShow.wicket_maidens && <td className="num" style={{ backgroundColor: heatBg(p.wicket_maidens, bowlR.wicket_maidens, false) }}>{n0(p.wicket_maidens)}</td>}
                      {bowlShow.bowl_dot_balls && <td className="num dim" style={{ backgroundColor: heatBg(p.bowl_dot_balls, bowlR.bowl_dot_balls, false) }}>{n0(p.bowl_dot_balls) || '–'}</td>}
                      <td className="num" style={{ backgroundColor: heatBg(p.runs_conceded, bowlR.runs_conceded, true), ...gb }}>{n0(p.runs_conceded)}</td>
                      <td className="num bold" style={{ backgroundColor: heatBg(p.wickets, bowlR.wickets, false) }}>{n0(p.wickets)}</td>
                      <td className="num" style={{ backgroundColor: heatBg(p.bowl_avg, bowlR.bowl_avg, true) }}>{dash(p.bowl_avg)}</td>
                      <td className="num" style={{ backgroundColor: heatBg(p.bowl_econ, bowlR.bowl_econ, true) }}>{dash(p.bowl_econ)}</td>
                      <td className="num dim" style={{ backgroundColor: heatBg(p.wkts_per_over, bowlR.wkts_per_over, false) }}>{dash(p.wkts_per_over)}</td>
                      {bowlShow.three_fers  && <td className="num" style={{ backgroundColor: heatBg(p.three_fers, bowlR.three_fers, false), ...(bowlFirstHaul === 'three_fers'  ? gb : {}) }}>{n0(p.three_fers) || '–'}</td>}
                      {bowlShow.four_fers   && <td className="num" style={{ backgroundColor: heatBg(p.four_fers,  bowlR.four_fers,  false), ...(bowlFirstHaul === 'four_fers'   ? gb : {}) }}>{n0(p.four_fers)  || '–'}</td>}
                      {bowlShow.five_fers   && <td className="num" style={{ backgroundColor: heatBg(p.five_fers,  bowlR.five_fers,  false), ...(bowlFirstHaul === 'five_fers'   ? gb : {}) }}>{n0(p.five_fers)  || '–'}</td>}
                      {bowlShow.six_fers    && <td className="num" style={{ backgroundColor: heatBg(p.six_fers,   bowlR.six_fers,   false), ...(bowlFirstHaul === 'six_fers'    ? gb : {}) }}>{n0(p.six_fers)   || '–'}</td>}
                      <td className="num dim" style={{ backgroundColor: heatBg(p.wides,    bowlR.wides,    true),  ...gb }}>{n0(p.wides)}</td>
                      <td className="num dim" style={{ backgroundColor: heatBg(p.no_balls, bowlR.no_balls, true) }}>{n0(p.no_balls)}</td>
                      {bowlShow.wkt_bowled  && <td className="num dim" style={{ backgroundColor: heatBg(p.wkt_bowled,  bowlR.wkt_bowled,  false), ...(bowlFirstWkt === 'wkt_bowled'  ? gb : {}) }}>{n0(p.wkt_bowled)  || '–'}</td>}
                      {bowlShow.wkt_caught  && <td className="num dim" style={{ backgroundColor: heatBg(p.wkt_caught,  bowlR.wkt_caught,  false), ...(bowlFirstWkt === 'wkt_caught'  ? gb : {}) }}>{n0(p.wkt_caught)  || '–'}</td>}
                      {bowlShow.wkt_lbw     && <td className="num dim" style={{ backgroundColor: heatBg(p.wkt_lbw,     bowlR.wkt_lbw,     false), ...(bowlFirstWkt === 'wkt_lbw'     ? gb : {}) }}>{n0(p.wkt_lbw)     || '–'}</td>}
                      {bowlShow.wkt_stumped && <td className="num dim" style={{ backgroundColor: heatBg(p.wkt_stumped, bowlR.wkt_stumped, false), ...(bowlFirstWkt === 'wkt_stumped' ? gb : {}) }}>{n0(p.wkt_stumped) || '–'}</td>}
                      {bowlShow.catches     && <td className="num dim" style={{ backgroundColor: heatBg(p.catches,    bowlR.catches,    false), ...(bowlFirstFld === 'catches'     ? gb : {}) }}>{n0(p.catches)    || '–'}</td>}
                      {bowlShow.stumpings   && <td className="num dim" style={{ backgroundColor: heatBg(p.stumpings,  bowlR.stumpings,  false), ...(bowlFirstFld === 'stumpings'   ? gb : {}) }}>{n0(p.stumpings)  || '–'}</td>}
                      {bowlShow.run_outs    && <td className="num dim" style={{ backgroundColor: heatBg(p.run_outs,   bowlR.run_outs,   false), ...(bowlFirstFld === 'run_outs'    ? gb : {}) }}>{n0(p.run_outs)   || '–'}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {!loading && partnerships.length > 0 && (
        <>
          <h2 style={{ marginBottom: '0.5rem', marginTop: '2.5rem' }}>Top partnerships</h2>
          <div className="card" style={{ padding: 0, overflowX: 'auto', border: '1px solid var(--border2)' }}>
            <table style={{ fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  <SortTh label="Partnership" sortKey="p1_name"     activeSort={partnerSort} onSort={onPartner} isName title="Partnership" />
                  <SortTh label="Stands"      sortKey="stands"      activeSort={partnerSort} onSort={onPartner} title="Number of innings batted together" />
                  <SortTh label="Runs"        sortKey="total_runs"  activeSort={partnerSort} onSort={onPartner} title="Total runs scored together" />
                  <SortTh label="Best"        sortKey="best_stand"  activeSort={partnerSort} onSort={onPartner} title="Best single partnership stand" />
                  <SortTh label="Avg"         sortKey="avg_stand"   activeSort={partnerSort} onSort={onPartner} title="Average runs per stand" />
                </tr>
              </thead>
              <tbody>
                {sortedPartners.map((p, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500, fontSize: '0.82rem' }}>
                      <span style={{ cursor: 'pointer', color: 'var(--link)' }}
                        onClick={() => navigate(`/player/${p.p1_id}`)}>{dn(p.p1_name)}</span>
                      <span style={{ color: 'var(--text3)', margin: '0 0.4rem' }}>&amp;</span>
                      <span style={{ cursor: 'pointer', color: 'var(--link)' }}
                        onClick={() => navigate(`/player/${p.p2_id}`)}>{dn(p.p2_name)}</span>
                    </td>
                    <td className="num dim">{p.stands}</td>
                    <td className="num bold">{p.total_runs}</td>
                    <td className="num">{p.best_stand}</td>
                    <td className="num">{p.avg_stand}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Tooltip id="pl-tip" />
    </div>
  )
}
