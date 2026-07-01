import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { Tooltip } from 'react-tooltip'
import { useApiFetch } from '../hooks/useApiFetch'
import { dn } from '../utils/cricket'
import { SkeletonRow } from '../components/Skeleton'
import { exportBatCsv, exportBowlCsv } from '../utils/csvExport'
import FilterPills from '../components/FilterPills'
import { MATCH_TYPE_OPTIONS, FORMAT_OPTIONS } from '../constants/filterOptions'
import TeamDropdown from '../components/TeamDropdown'
import { useGroupFilter } from '../hooks/useGroupFilter'
import { HighlightChip } from '../components/SeasonCards'
import { TopTrumpsCard } from '../components/TopTrumpsCard'
import { BatCard } from '../components/players/BatCard'
import { BowlCard } from '../components/players/BowlCard'
import { BattingTable } from '../components/players/BattingTable'
import { BowlingTable } from '../components/players/BowlingTable'
import { PartnershipsTable } from '../components/players/PartnershipsTable'
import { n0, heatRange } from '../components/players/playerStatsFormat'

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

function ViewToggle({ value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
      <span style={{ fontSize: '0.78rem', color: 'var(--text2)', marginRight: 2 }}>View</span>
      {['Table', 'Cards', 'Top Trumps'].map((v) => (
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

const cardGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
  gap: '0.75rem',
  marginBottom: '2.5rem'
}

const DEFAULT_COLUMNS = ['MAT', 'INN', 'RUNS', 'AVG']

export default function PlayerList() {
  const { user } = useUser()
  const isSuperAdmin = user?.publicMetadata?.isSuperAdmin === true
  const hasGroups = isSuperAdmin || true // myGroups resolved inside useGroupFilter

  const [players, setPlayers] = useState([])
  const [partnerships, setPartnerships] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showSubs, setShowSubs] = useState(false)
  const [listView, setListView] = useState(() => localStorage.getItem('playerListView') || 'Table')
  const [selectedColumns, setSelectedColumns] = useState(DEFAULT_COLUMNS)
  const [savingPrefs, setSavingPrefs] = useState(false)
  const [showAllCols, setShowAllCols] = useState(false)
  const [ttData, setTtData] = useState(null)
  const [ttLoading, setTtLoading] = useState(false)
  const [showUnqualified, setShowUnqualified] = useState(false)

  function handleViewChange(v) {
    setListView(v)
    localStorage.setItem('playerListView', v)
  }
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const apiFetch = useApiFetch()

  // Load column preferences from API
  useEffect(() => {
    apiFetch('/api/players/preferences')
      .then((r) => (r.ok ? r.json() : { columns: DEFAULT_COLUMNS }))
      .then((data) => setSelectedColumns(data.columns || DEFAULT_COLUMNS))
      .catch(() => setSelectedColumns(DEFAULT_COLUMNS))
  }, [apiFetch])

  // Save column preferences
  async function saveColumnPreferences(cols) {
    setSavingPrefs(true)
    setSelectedColumns(cols)
    try {
      await apiFetch('/api/players/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ columns: cols })
      })
    } catch (e) {
      console.error('Failed to save preferences:', e)
    } finally {
      setSavingPrefs(false)
    }
  }

  function toggleColumn(col) {
    const next = selectedColumns.includes(col)
      ? selectedColumns.filter((c) => c !== col)
      : [...selectedColumns, col]
    if (next.length > 0) saveColumnPreferences(next)
  }

  const typesParam = searchParams.get('types') || ''
  const typeFilter = typesParam ? typesParam.split(',').filter(Boolean) : []
  const format = searchParams.get('format') || ''
  const batSort = {
    key: searchParams.get('batKey') || 'runs',
    dir: Number(searchParams.get('batDir')) || -1
  }
  const bowlSort = {
    key: searchParams.get('bowlKey') || 'wickets',
    dir: Number(searchParams.get('bowlDir')) || -1
  }
  const partnerSort = {
    key: searchParams.get('partnerKey') || 'total_runs',
    dir: Number(searchParams.get('partnerDir')) || -1
  }

  function updateFilter(key, value, defaultValue) {
    const next = new URLSearchParams(searchParams)
    if (value === defaultValue) next.delete(key)
    else next.set(key, value)
    setSearchParams(next, { replace: true })
  }

  const { myGroups, favourites, toggleFavourite, selectedKey, pillValue, setGroups, isExplicit } =
    useGroupFilter({ searchParams, setSearchParams })
  const showCompFilter = hasGroups || myGroups.length > 0

  useEffect(() => {
    // null = explicitly none — show empty without fetching
    if (selectedKey === null) {
      setPlayers([])
      setPartnerships([])
      setLoading(false)
      return
    }
    setLoading(true)
    const params = new URLSearchParams()
    if (selectedKey) params.set('groups', selectedKey)
    if (typesParam) params.set('types', typesParam)
    if (format) params.set('format', format)
    Promise.all([
      apiFetch(`/api/players/stats?${params}`).then((r) => r.json()),
      apiFetch(`/api/players/partnerships?${params}`).then((r) => r.json())
    ])
      .then(([stats, pships]) => {
        setPlayers(stats.players || [])
        setPartnerships(pships || [])
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [selectedKey, typesParam, format, apiFetch])

  useEffect(() => {
    if (listView !== 'Top Trumps') return
    if (selectedKey === null) {
      setTtData([])
      return
    }
    setTtLoading(true)
    const params = new URLSearchParams()
    if (selectedKey) params.set('groups', selectedKey)
    if (typesParam) params.set('types', typesParam)
    if (format) params.set('format', format)
    apiFetch(`/api/players/top-trumps?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setTtData(data.players || [])
        setTtLoading(false)
      })
      .catch(() => setTtLoading(false))
  }, [listView, selectedKey, typesParam, format, apiFetch])

  function toggleSort(prefix, defaultKey, currentSort, key) {
    const next = new URLSearchParams(searchParams)
    const newDir = currentSort.key === key ? -currentSort.dir : -1
    if (key === defaultKey) {
      next.delete(`${prefix}Key`)
    } else {
      next.set(`${prefix}Key`, key)
    }
    if (newDir === -1) {
      next.delete(`${prefix}Dir`)
    } else {
      next.set(`${prefix}Dir`, String(newDir))
    }
    setSearchParams(next, { replace: true })
  }

  const filtered = players
    .filter((p) => !search || p.name?.toLowerCase().includes(search.toLowerCase()))
    .filter((p) => showSubs || !p.is_sub)

  const batPlayers = sortRows(
    filtered.filter((p) => n0(p.innings) > 0 || n0(p.dnb_count) > 0 || n0(p.games_attended) > 0),
    batSort
  )
  const bowlPlayers = sortRows(
    filtered.filter((p) => n0(p.games_bowled) > 0 || n0(p.games_attended) > 0),
    bowlSort
  )
  const sortedPartners = sortRows(
    !search
      ? partnerships
      : partnerships.filter(
          (p) =>
            p.p1_name?.toLowerCase().includes(search.toLowerCase()) ||
            p.p2_name?.toLowerCase().includes(search.toLowerCase())
        ),
    partnerSort
  )

  const onBat = (k) => toggleSort('bat', 'runs', batSort, k)
  const onBowl = (k) => toggleSort('bowl', 'wickets', bowlSort, k)
  const onPartner = (k) => toggleSort('partner', 'total_runs', partnerSort, k)

  const batR = {
    games_attended: heatRange(batPlayers, 'games_attended'),
    innings: heatRange(batPlayers, 'innings'),
    not_outs: heatRange(batPlayers, 'not_outs'),
    runs: heatRange(batPlayers, 'runs'),
    high_score: heatRange(batPlayers, 'high_score'),
    bat_avg_per_game: heatRange(batPlayers, 'bat_avg_per_game'),
    balls_faced: heatRange(batPlayers, 'balls_faced'),
    dot_balls: heatRange(batPlayers, 'dot_balls'),
    fours: heatRange(batPlayers, 'fours'),
    sixes: heatRange(batPlayers, 'sixes'),
    bat_sr: heatRange(batPlayers, 'bat_sr'),
    total_minutes: heatRange(batPlayers, 'total_minutes'),
    avg_minutes: heatRange(batPlayers, 'avg_minutes'),
    captain_count: heatRange(batPlayers, 'captain_count'),
    wk_count: heatRange(batPlayers, 'wk_count'),
    times_out: heatRange(batPlayers, 'times_out'),
    dis_bowled: heatRange(batPlayers, 'dis_bowled'),
    dis_caught: heatRange(batPlayers, 'dis_caught'),
    dis_lbw: heatRange(batPlayers, 'dis_lbw'),
    dis_runout: heatRange(batPlayers, 'dis_runout'),
    dis_stumped: heatRange(batPlayers, 'dis_stumped')
  }
  const bowlR = {
    games_attended: heatRange(bowlPlayers, 'games_attended'),
    games_bowled: heatRange(bowlPlayers, 'games_bowled'),
    balls_bowled: heatRange(bowlPlayers, 'balls_bowled'),
    wickets: heatRange(bowlPlayers, 'wickets'),
    maidens: heatRange(bowlPlayers, 'maidens'),
    wicket_maidens: heatRange(bowlPlayers, 'wicket_maidens'),
    wkts_per_over: heatRange(bowlPlayers, 'wkts_per_over'),
    three_fers: heatRange(bowlPlayers, 'three_fers'),
    four_fers: heatRange(bowlPlayers, 'four_fers'),
    five_fers: heatRange(bowlPlayers, 'five_fers'),
    six_fers: heatRange(bowlPlayers, 'six_fers'),
    catches: heatRange(bowlPlayers, 'catches'),
    stumpings: heatRange(bowlPlayers, 'stumpings'),
    run_outs: heatRange(bowlPlayers, 'run_outs'),
    wkt_bowled: heatRange(bowlPlayers, 'wkt_bowled'),
    wkt_caught: heatRange(bowlPlayers, 'wkt_caught'),
    wkt_lbw: heatRange(bowlPlayers, 'wkt_lbw'),
    wkt_stumped: heatRange(bowlPlayers, 'wkt_stumped'),
    runs_conceded: heatRange(bowlPlayers, 'runs_conceded'),
    bowl_avg: heatRange(bowlPlayers, 'bowl_avg'),
    bowl_econ: heatRange(bowlPlayers, 'bowl_econ'),
    bowl_sr: heatRange(bowlPlayers, 'bowl_sr'),
    wides: heatRange(bowlPlayers, 'wides'),
    no_balls: heatRange(bowlPlayers, 'no_balls'),
    bowl_dot_balls: heatRange(bowlPlayers, 'bowl_dot_balls')
  }

  const batShow = {
    dot_balls: batPlayers.some((p) => n0(p.dot_balls) > 0),
    total_minutes: batPlayers.some((p) => n0(p.total_minutes) > 0),
    dis_bowled: batPlayers.some((p) => n0(p.dis_bowled) > 0),
    dis_caught: batPlayers.some((p) => n0(p.dis_caught) > 0),
    dis_lbw: batPlayers.some((p) => n0(p.dis_lbw) > 0),
    dis_runout: batPlayers.some((p) => n0(p.dis_runout) > 0),
    dis_stumped: batPlayers.some((p) => n0(p.dis_stumped) > 0),
    captain_count: batPlayers.some((p) => n0(p.captain_count) > 0),
    wk_count: batPlayers.some((p) => n0(p.wk_count) > 0)
  }
  const bowlShow = {
    maidens: bowlPlayers.some((p) => n0(p.maidens) > 0),
    wicket_maidens: bowlPlayers.some((p) => n0(p.wicket_maidens) > 0),
    three_fers: bowlPlayers.some((p) => n0(p.three_fers) > 0),
    four_fers: bowlPlayers.some((p) => n0(p.four_fers) > 0),
    five_fers: bowlPlayers.some((p) => n0(p.five_fers) > 0),
    six_fers: bowlPlayers.some((p) => n0(p.six_fers) > 0),
    wkt_bowled: bowlPlayers.some((p) => n0(p.wkt_bowled) > 0),
    wkt_caught: bowlPlayers.some((p) => n0(p.wkt_caught) > 0),
    wkt_lbw: bowlPlayers.some((p) => n0(p.wkt_lbw) > 0),
    wkt_stumped: bowlPlayers.some((p) => n0(p.wkt_stumped) > 0),
    catches: bowlPlayers.some((p) => n0(p.catches) > 0),
    stumpings: bowlPlayers.some((p) => n0(p.stumpings) > 0),
    run_outs: bowlPlayers.some((p) => n0(p.run_outs) > 0),
    bowl_dot_balls: bowlPlayers.some((p) => n0(p.bowl_dot_balls) > 0)
  }

  const batDisCount =
    1 +
    (batShow.dis_bowled ? 1 : 0) +
    (batShow.dis_caught ? 1 : 0) +
    (batShow.dis_lbw ? 1 : 0) +
    (batShow.dis_runout ? 1 : 0) +
    (batShow.dis_stumped ? 1 : 0)
  const bowlHaulCount =
    (bowlShow.three_fers ? 1 : 0) +
    (bowlShow.four_fers ? 1 : 0) +
    (bowlShow.five_fers ? 1 : 0) +
    (bowlShow.six_fers ? 1 : 0)
  const bowlWktCount =
    (bowlShow.wkt_bowled ? 1 : 0) +
    (bowlShow.wkt_caught ? 1 : 0) +
    (bowlShow.wkt_lbw ? 1 : 0) +
    (bowlShow.wkt_stumped ? 1 : 0)
  const bowlFieldCount =
    (bowlShow.catches ? 1 : 0) + (bowlShow.stumpings ? 1 : 0) + (bowlShow.run_outs ? 1 : 0)
  const batFirstRole = batShow.captain_count ? 'captain_count' : 'wk_count'

  const sc = (key) => selectedColumns.includes(key)
  const appCols = (sc('MAT') ? 1 : 0) + (sc('INN') ? 1 : 0) + (sc('NO') ? 1 : 0)
  const batCols =
    (sc('RUNS') ? 1 : 0) + (sc('HS') ? 1 : 0) + (sc('AVG') ? 1 : 0) + (sc('SR') ? 1 : 0)
  const ballCols = (sc('BALLS') ? 1 : 0) + (batShow.dot_balls ? 1 : 0)
  const bndCols = (sc('4S') ? 1 : 0) + (sc('6S') ? 1 : 0)

  const bowlFirstHaul = bowlShow.three_fers
    ? 'three_fers'
    : bowlShow.four_fers
      ? 'four_fers'
      : bowlShow.five_fers
        ? 'five_fers'
        : 'six_fers'
  const bowlFirstWkt = bowlShow.wkt_bowled
    ? 'wkt_bowled'
    : bowlShow.wkt_caught
      ? 'wkt_caught'
      : bowlShow.wkt_lbw
        ? 'wkt_lbw'
        : 'wkt_stumped'
  const bowlFirstFld = bowlShow.catches ? 'catches' : bowlShow.stumpings ? 'stumpings' : 'run_outs'

  return (
    <div className="page">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
          marginBottom: '1.5rem'
        }}
      >
        <h1 style={{ margin: 0 }}>Players</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: '0.82rem',
              cursor: 'pointer',
              color: 'var(--text2)',
              whiteSpace: 'nowrap'
            }}
          >
            <input
              type="checkbox"
              checked={showSubs}
              onChange={(e) => setShowSubs(e.target.checked)}
              style={{ accentColor: '#690028' }}
            />
            Show subs
          </label>
          <input
            className="search-input"
            type="search"
            placeholder="Search players…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div
        className="player-filter-bar"
        style={{
          display: 'flex',
          gap: '1rem',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          position: 'relative',
          zIndex: 20
        }}
      >
        {myGroups.length > 1 && (
          <TeamDropdown
            myGroups={myGroups}
            value={pillValue}
            onChange={setGroups}
            favourites={favourites}
            onToggleFavourite={toggleFavourite}
            isExplicit={isExplicit}
          />
        )}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {showCompFilter && (
            <FilterPills
              label="Type"
              multiSelect
              options={MATCH_TYPE_OPTIONS}
              value={typeFilter}
              onChange={(arr) => updateFilter('types', arr.join(','), '')}
            />
          )}
          <FilterPills
            label="Format"
            options={FORMAT_OPTIONS}
            value={format}
            onChange={(v) => updateFilter('format', v, '')}
          />
        </div>
      </div>

      {loading ? (
        <>
          <h2 style={{ marginBottom: '0.5rem' }}>Batting</h2>
          <div className="card player-table-wrap" style={{ marginBottom: '2.5rem' }}>
            <table style={{ fontSize: '0.8rem' }}>
              <tbody>
                {Array.from({ length: 10 }).map((_, i) => (
                  <SkeletonRow key={i} cols={14} />
                ))}
              </tbody>
            </table>
          </div>
          <h2 style={{ marginBottom: '0.5rem' }}>Bowling</h2>
          <div className="card player-table-wrap">
            <table style={{ fontSize: '0.8rem' }}>
              <tbody>
                {Array.from({ length: 10 }).map((_, i) => (
                  <SkeletonRow key={i} cols={12} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : filtered.length === 0 ? (
        <div className="empty">
          {selectedKey || typesParam || search
            ? 'No players found — try adjusting the filters.'
            : 'No players found.'}
        </div>
      ) : (
        <>
          {/* ── Season leaderboard chips ── */}
          {(() => {
            const byRuns = [...batPlayers].sort((a, b) => n0(b.runs) - n0(a.runs))
            const byWickets = [...bowlPlayers].sort((a, b) => n0(b.wickets) - n0(a.wickets))
            const bySR = batPlayers
              .filter((p) => n0(p.innings) >= 5 && p.bat_sr != null)
              .sort((a, b) => Number(b.bat_sr) - Number(a.bat_sr))
            const topRuns = byRuns[0]
            const topWickets = byWickets[0]
            const topSR = bySR[0]
            if (!topRuns && !topWickets && !topSR) return null
            return (
              <div
                style={{
                  display: 'flex',
                  gap: '0.6rem',
                  flexWrap: 'wrap',
                  marginBottom: '1.25rem'
                }}
              >
                {topRuns && (
                  <HighlightChip
                    label="Most runs"
                    value={n0(topRuns.runs)}
                    sub={dn(topRuns.name)}
                    onClick={() => navigate(`/player/${topRuns.player_id}`)}
                  />
                )}
                {topWickets && (
                  <HighlightChip
                    label="Most wickets"
                    value={n0(topWickets.wickets)}
                    sub={dn(topWickets.name)}
                    onClick={() => navigate(`/player/${topWickets.player_id}`)}
                  />
                )}
                {topSR && (
                  <HighlightChip
                    label="Best SR"
                    value={topSR.bat_sr}
                    sub={`${dn(topSR.name)} (${n0(topSR.innings)} inn)`}
                    onClick={() => navigate(`/player/${topSR.player_id}`)}
                  />
                )}
              </div>
            )
          })()}

          {/* ── View toggle ── */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '1rem' }}>
            <ViewToggle value={listView} onChange={handleViewChange} />
          </div>

          {listView === 'Top Trumps' ? (
            <>
              <p
                style={{
                  fontSize: '0.82rem',
                  color: 'var(--text2)',
                  marginBottom: '1.25rem',
                  maxWidth: 560
                }}
              >
                Each card rates a player across four dimensions — <strong>Batting</strong>,{' '}
                <strong>Bowling</strong>, <strong>Fielding</strong>, and{' '}
                <strong>Gamechanger</strong> (matches where they had the highest MVP score) —
                combined into an overall <strong>Top Trumps Rating</strong> out of 100. Ratings are
                based on your club's recorded match data. Minimum 5 matches needed to qualify.
              </p>
              {ttLoading ? (
                <div style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>Loading…</div>
              ) : (
                (() => {
                  const qualified = (ttData || []).filter((p) => p.qualified)
                  const unqualified = (ttData || []).filter((p) => !p.qualified)
                  return (
                    <>
                      <div style={cardGridStyle}>
                        {qualified.map((p) => (
                          <TopTrumpsCard
                            key={p.player_id}
                            p={p}
                            onClick={() => navigate(`/player/${p.player_id}`)}
                          />
                        ))}
                      </div>
                      {unqualified.length > 0 && (
                        <div style={{ marginTop: '0.5rem' }}>
                          <button
                            className="secondary"
                            style={{ fontSize: '0.8rem', marginBottom: '0.75rem' }}
                            onClick={() => setShowUnqualified((v) => !v)}
                          >
                            {showUnqualified ? 'Hide' : 'Show'} {unqualified.length} player
                            {unqualified.length !== 1 ? 's' : ''} with fewer than 5 matches
                          </button>
                          {showUnqualified && (
                            <div style={cardGridStyle}>
                              {unqualified.map((p) => (
                                <TopTrumpsCard
                                  key={p.player_id}
                                  p={p}
                                  onClick={() => navigate(`/player/${p.player_id}`)}
                                />
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )
                })()
              )}
            </>
          ) : (
            <>
              {/* ── Batting ── */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  marginBottom: '0.5rem'
                }}
              >
                <h2 style={{ marginBottom: 0 }}>Batting</h2>
                <button
                  className="secondary"
                  style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                  onClick={() => exportBatCsv(batPlayers, batShow)}
                >
                  Export CSV
                </button>
                <div
                  style={{
                    marginLeft: 'auto',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}
                >
                  <button
                    className="player-more-stats-btn"
                    onClick={() => setShowAllCols((v) => !v)}
                    aria-pressed={showAllCols}
                  >
                    📊 {showAllCols ? 'Fewer stats' : 'More stats'}
                  </button>
                  <details style={{ display: 'inline-block', position: 'relative' }}>
                    <summary
                      style={{
                        cursor: 'pointer',
                        fontSize: '0.78rem',
                        color: 'var(--text2)',
                        padding: '0.4rem 0.8rem',
                        borderRadius: 4,
                        border: '1px solid var(--border2)',
                        display: 'inline-block',
                        userSelect: 'none'
                      }}
                    >
                      {savingPrefs ? 'Saving...' : 'Columns'}
                    </summary>
                    <div
                      style={{
                        position: 'absolute',
                        right: 0,
                        background: 'var(--bg2)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        padding: '0.75rem',
                        marginTop: '0.5rem',
                        zIndex: 200,
                        minWidth: '200px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                      }}
                    >
                      <div
                        style={{
                          fontSize: '0.75rem',
                          color: 'var(--text3)',
                          marginBottom: '0.5rem',
                          textTransform: 'uppercase',
                          fontWeight: 600
                        }}
                      >
                        Batting Stats
                      </div>
                      {['MAT', 'INN', 'NO', 'RUNS', 'HS', 'AVG', 'SR', 'BALLS', '4S', '6S'].map(
                        (col) => (
                          <label
                            key={col}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '0.4rem 0',
                              fontSize: '0.85rem',
                              cursor: 'pointer'
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedColumns.includes(col)}
                              onChange={() => toggleColumn(col)}
                            />
                            {col}
                          </label>
                        )
                      )}
                    </div>
                  </details>
                </div>
              </div>
              {listView === 'Cards' ? (
                <div style={cardGridStyle}>
                  {batPlayers.map((p) => (
                    <BatCard
                      key={p.player_id}
                      p={p}
                      onClick={() => navigate(`/player/${p.player_id}`)}
                    />
                  ))}
                </div>
              ) : (
                <BattingTable
                  players={batPlayers}
                  sort={batSort}
                  onSort={onBat}
                  show={batShow}
                  ranges={batR}
                  navigate={navigate}
                  sc={sc}
                  appCols={appCols}
                  batCols={batCols}
                  ballCols={ballCols}
                  bndCols={bndCols}
                  batDisCount={batDisCount}
                  batFirstRole={batFirstRole}
                  showAllCols={showAllCols}
                />
              )}

              {/* ── Bowling ── */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  marginBottom: '0.5rem'
                }}
              >
                <h2 style={{ marginBottom: 0 }}>Bowling</h2>
                {bowlPlayers.length > 0 && (
                  <button
                    className="secondary"
                    style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                    onClick={() => exportBowlCsv(bowlPlayers, bowlShow)}
                  >
                    Export CSV
                  </button>
                )}
              </div>
              {listView === 'Cards' && bowlPlayers.length > 0 ? (
                <div style={cardGridStyle}>
                  {bowlPlayers.map((p) => (
                    <BowlCard
                      key={p.player_id}
                      p={p}
                      onClick={() => navigate(`/player/${p.player_id}`)}
                    />
                  ))}
                </div>
              ) : (
                <BowlingTable
                  players={bowlPlayers}
                  sort={bowlSort}
                  onSort={onBowl}
                  show={bowlShow}
                  ranges={bowlR}
                  navigate={navigate}
                  bowlHaulCount={bowlHaulCount}
                  bowlWktCount={bowlWktCount}
                  bowlFieldCount={bowlFieldCount}
                  bowlFirstHaul={bowlFirstHaul}
                  bowlFirstWkt={bowlFirstWkt}
                  bowlFirstFld={bowlFirstFld}
                  showAllCols={showAllCols}
                  selectedKey={selectedKey}
                  comp={typesParam}
                />
              )}
            </>
          )}
        </>
      )}
      {!loading && partnerships.length > 0 && (
        <>
          <h2 style={{ marginBottom: '0.5rem', marginTop: '2.5rem' }}>Top partnerships</h2>
          <PartnershipsTable
            sortedPartners={sortedPartners}
            sort={partnerSort}
            onSort={onPartner}
            navigate={navigate}
          />
        </>
      )}
      <Tooltip id="pl-tip" />
    </div>
  )
}
