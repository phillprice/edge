import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApiFetch } from '../hooks/useApiFetch'

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

function SortTh({ label, title, sortKey, activeSort, onSort, isName = false }) {
  const active = activeSort.key === sortKey
  const arrow  = active ? (activeSort.dir === -1 ? ' ↓' : ' ↑') : ''
  return (
    <th
      className={isName ? 'sortable' : 'sortable num'}
      title={title || label}
      onClick={() => onSort(sortKey)}
      style={{ whiteSpace: 'nowrap' }}
    >
      {label}{arrow}
    </th>
  )
}

function sortRows(arr, { key, dir }) {
  return [...arr].sort((a, b) => {
    const av = a[key] ?? (typeof a[key] === 'number' ? -Infinity : '')
    const bv = b[key] ?? (typeof b[key] === 'number' ? -Infinity : '')
    if (typeof av === 'string') return av.localeCompare(bv) * dir
    return ((Number(av) || 0) - (Number(bv) || 0)) * dir
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

export default function PlayerList() {
  const [players,  setPlayers]  = useState([])
  const [years,    setYears]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [year,     setYear]     = useState('')
  const [team,     setTeam]     = useState('')
  const [batSort,  setBatSort]  = useState({ key: 'runs',    dir: -1 })
  const [bowlSort, setBowlSort] = useState({ key: 'wickets', dir: -1 })
  const navigate = useNavigate()
  const apiFetch = useApiFetch()

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (year) params.set('year', year)
    if (team) params.set('team', team)
    apiFetch(`/api/players/stats?${params}`)
      .then(r => r.json())
      .then(d => {
        setPlayers(d.players || [])
        if (d.years?.length) setYears(d.years)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [year, team])

  function toggleSort(setSortState, key) {
    setSortState(prev => ({ key, dir: prev.key === key ? -prev.dir : -1 }))
  }

  const filtered = players
    .filter(p => !search || p.name?.toLowerCase().includes(search.toLowerCase()))

  const batPlayers  = sortRows(filtered.filter(p => n0(p.innings) > 0 || n0(p.dnb_count) > 0), batSort)
  const bowlPlayers = sortRows(filtered.filter(p => n0(p.games_bowled) > 0), bowlSort)

  const onBat  = k => toggleSort(setBatSort,  k)
  const onBowl = k => toggleSort(setBowlSort, k)

  const batR = {
    runs:          heatRange(batPlayers, 'runs'),
    high_score:    heatRange(batPlayers, 'high_score'),
    bat_avg:       heatRange(batPlayers, 'bat_avg'),
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
  }

  const yearOptions = [{ value: '', label: 'All' }, ...years.map(y => ({ value: y, label: y }))]
  const teamOptions = [
    { value: '',          label: 'All' },
    { value: 'whirlwind', label: 'Whirlwinds' },
    { value: 'hurricane', label: 'Hurricanes' },
  ]

  return (
    <div className="page">
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
      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <FilterPills label="Year" options={yearOptions} value={year} onChange={setYear} />
        <FilterPills label="Team" options={teamOptions} value={team} onChange={setTeam} />
      </div>

      {loading ? <div className="loading">Loading…</div> : filtered.length === 0 ? (
        <div className="empty">No players found.</div>
      ) : (
        <>
          {/* ── Batting ── */}
          <h2 style={{ marginBottom: '0.5rem' }}>Batting</h2>
          <div className="card" style={{ padding: 0, overflowX: 'auto', marginBottom: '2.5rem' }}>
            <table style={{ fontSize: '0.8rem' }}>
              <thead>
                <tr>
                  <SortTh label="Name"  sortKey="name"          activeSort={batSort} onSort={onBat} isName title="Player name" />
                  <SortTh label="Mat"   sortKey="games_attended" activeSort={batSort} onSort={onBat} title="Matches attended (batted or bowled)" />
                  <SortTh label="Inn"   sortKey="innings"        activeSort={batSort} onSort={onBat} title="Innings batted" />
                  <SortTh label="NO"    sortKey="not_outs"       activeSort={batSort} onSort={onBat} title="Not outs" />
                  <SortTh label="Runs"  sortKey="runs"           activeSort={batSort} onSort={onBat} title="Total runs" />
                  <SortTh label="HS"    sortKey="high_score"     activeSort={batSort} onSort={onBat} title="Highest score" />
                  <SortTh label="Avg"   sortKey="bat_avg"        activeSort={batSort} onSort={onBat} title="Batting average (runs ÷ dismissals)" />
                  <SortTh label="B"     sortKey="balls_faced"    activeSort={batSort} onSort={onBat} title="Balls faced" />
                  <SortTh label="4s"    sortKey="fours"          activeSort={batSort} onSort={onBat} title="Fours" />
                  <SortTh label="6s"    sortKey="sixes"          activeSort={batSort} onSort={onBat} title="Sixes" />
                  <SortTh label="SR"    sortKey="bat_sr"         activeSort={batSort} onSort={onBat} title="Strike rate (runs per 100 balls)" />
                  <SortTh label="Mins"  sortKey="total_minutes"  activeSort={batSort} onSort={onBat} title="Total minutes at crease (inc. non-striker)" />
                  <SortTh label="Min/I" sortKey="avg_minutes"    activeSort={batSort} onSort={onBat} title="Average minutes per innings" />
                  <SortTh label="Out"   sortKey="times_out"      activeSort={batSort} onSort={onBat} title="Times dismissed" />
                  <SortTh label="Bo"    sortKey="dis_bowled"     activeSort={batSort} onSort={onBat} title="Times bowled" />
                  <SortTh label="Ct"    sortKey="dis_caught"     activeSort={batSort} onSort={onBat} title="Times caught" />
                  <SortTh label="LBW"   sortKey="dis_lbw"        activeSort={batSort} onSort={onBat} title="Times out LBW" />
                  <SortTh label="RO"    sortKey="dis_runout"     activeSort={batSort} onSort={onBat} title="Times run out" />
                  <SortTh label="St"    sortKey="dis_stumped"    activeSort={batSort} onSort={onBat} title="Times stumped" />
                  <SortTh label="Capt"  sortKey="captain_count"  activeSort={batSort} onSort={onBat} title="Times captain" />
                  <SortTh label="WK"    sortKey="wk_count"       activeSort={batSort} onSort={onBat} title="Times wicket keeper" />
                </tr>
              </thead>
              <tbody>
                {batPlayers.map(p => (
                  <tr key={p.player_id} style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/player/${p.player_id}`)}>
                    <td className="bold" style={{ whiteSpace: 'nowrap' }}>{p.name}</td>
                    <td className="num">{n0(p.games_attended)}</td>
                    <td className="num">{n0(p.innings)}</td>
                    <td className="num dim">{n0(p.not_outs)}</td>
                    <td className="num bold" style={{ backgroundColor: heatBg(p.runs, batR.runs, false) }}>{n0(p.runs)}</td>
                    <td className="num" style={{ backgroundColor: heatBg(p.high_score, batR.high_score, false) }}>{n0(p.high_score)}</td>
                    <td className="num" style={{ backgroundColor: heatBg(p.bat_avg, batR.bat_avg, false) }}>{dash(p.bat_avg)}</td>
                    <td className="num dim">{n0(p.balls_faced)}</td>
                    <td className="num" style={{ backgroundColor: heatBg(p.fours, batR.fours, false) }}>{n0(p.fours)}</td>
                    <td className="num" style={{ backgroundColor: heatBg(p.sixes, batR.sixes, false) }}>{n0(p.sixes)}</td>
                    <td className="num dim" style={{ backgroundColor: heatBg(p.bat_sr, batR.bat_sr, false) }}>{dash(p.bat_sr)}</td>
                    <td className="num dim" style={{ backgroundColor: heatBg(p.total_minutes, batR.total_minutes, false) }}>{n0(p.total_minutes) || '–'}</td>
                    <td className="num dim" style={{ backgroundColor: heatBg(p.avg_minutes, batR.avg_minutes, false) }}>{dash(p.avg_minutes)}</td>
                    <td className="num" style={{ backgroundColor: heatBg(p.times_out, batR.times_out, true) }}>{n0(p.times_out)}</td>
                    <td className="num dim" style={{ backgroundColor: heatBg(p.dis_bowled, batR.dis_bowled, true) }}>{n0(p.dis_bowled)  || '–'}</td>
                    <td className="num dim" style={{ backgroundColor: heatBg(p.dis_caught, batR.dis_caught, true) }}>{n0(p.dis_caught)  || '–'}</td>
                    <td className="num dim" style={{ backgroundColor: heatBg(p.dis_lbw, batR.dis_lbw, true) }}>{n0(p.dis_lbw)     || '–'}</td>
                    <td className="num dim" style={{ backgroundColor: heatBg(p.dis_runout, batR.dis_runout, true) }}>{n0(p.dis_runout)  || '–'}</td>
                    <td className="num dim" style={{ backgroundColor: heatBg(p.dis_stumped, batR.dis_stumped, true) }}>{n0(p.dis_stumped) || '–'}</td>
                    <td className="num dim" style={{ backgroundColor: heatBg(p.captain_count, batR.captain_count, false) }}>{n0(p.captain_count) || '–'}</td>
                    <td className="num dim" style={{ backgroundColor: heatBg(p.wk_count, batR.wk_count, false) }}>{n0(p.wk_count)      || '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Bowling ── */}
          <h2 style={{ marginBottom: '0.5rem' }}>Bowling</h2>
          {bowlPlayers.length === 0 ? (
            <div className="empty">No bowling data yet.</div>
          ) : (
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table style={{ fontSize: '0.8rem' }}>
                <thead>
                  <tr>
                    <SortTh label="Name"  sortKey="name"           activeSort={bowlSort} onSort={onBowl} isName title="Player name" />
                    <SortTh label="Mat"   sortKey="games_attended"  activeSort={bowlSort} onSort={onBowl} title="Matches attended" />
                    <SortTh label="Inn"   sortKey="games_bowled"    activeSort={bowlSort} onSort={onBowl} title="Innings bowled" />
                    <SortTh label="O"     sortKey="balls_bowled"    activeSort={bowlSort} onSort={onBowl} title="Overs bowled" />
                    <SortTh label="M"     sortKey="maidens"         activeSort={bowlSort} onSort={onBowl} title="Maiden overs" />
                    <SortTh label="WM"    sortKey="wicket_maidens"  activeSort={bowlSort} onSort={onBowl} title="Wicket maidens" />
                    <SortTh label="R"     sortKey="runs_conceded"   activeSort={bowlSort} onSort={onBowl} title="Runs conceded" />
                    <SortTh label="W"     sortKey="wickets"         activeSort={bowlSort} onSort={onBowl} title="Wickets" />
                    <SortTh label="Avg"   sortKey="bowl_avg"        activeSort={bowlSort} onSort={onBowl} title="Bowling average (runs ÷ wickets)" />
                    <SortTh label="Econ"  sortKey="bowl_econ"       activeSort={bowlSort} onSort={onBowl} title="Economy (runs per over)" />
                    <SortTh label="SR"    sortKey="bowl_sr"         activeSort={bowlSort} onSort={onBowl} title="Strike rate (balls per wicket)" />
                    <SortTh label="W/O"   sortKey="wkts_per_over"   activeSort={bowlSort} onSort={onBowl} title="Wickets per over" />
                    <SortTh label="3W"    sortKey="three_fers"      activeSort={bowlSort} onSort={onBowl} title="3-wicket hauls" />
                    <SortTh label="4W"    sortKey="four_fers"       activeSort={bowlSort} onSort={onBowl} title="4-wicket hauls" />
                    <SortTh label="5W"    sortKey="five_fers"       activeSort={bowlSort} onSort={onBowl} title="5-wicket hauls" />
                    <SortTh label="6W"    sortKey="six_fers"        activeSort={bowlSort} onSort={onBowl} title="6-wicket hauls" />
                    <SortTh label="Wd"    sortKey="wides"           activeSort={bowlSort} onSort={onBowl} title="Wides" />
                    <SortTh label="NB"    sortKey="no_balls"        activeSort={bowlSort} onSort={onBowl} title="No balls" />
                    <SortTh label="Bo"    sortKey="wkt_bowled"      activeSort={bowlSort} onSort={onBowl} title="Wickets: bowled" />
                    <SortTh label="Ct"    sortKey="wkt_caught"      activeSort={bowlSort} onSort={onBowl} title="Wickets: caught (inc. c&b)" />
                    <SortTh label="LBW"   sortKey="wkt_lbw"         activeSort={bowlSort} onSort={onBowl} title="Wickets: LBW" />
                    <SortTh label="St"    sortKey="wkt_stumped"     activeSort={bowlSort} onSort={onBowl} title="Wickets: stumped" />
                    <SortTh label="Cau"   sortKey="catches"         activeSort={bowlSort} onSort={onBowl} title="Catches taken in field" />
                    <SortTh label="Stp"   sortKey="stumpings"       activeSort={bowlSort} onSort={onBowl} title="Stumpings" />
                    <SortTh label="RO"    sortKey="run_outs"        activeSort={bowlSort} onSort={onBowl} title="Run outs effected" />
                  </tr>
                </thead>
                <tbody>
                  {bowlPlayers.map(p => (
                    <tr key={p.player_id} style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/player/${p.player_id}`)}>
                      <td className="bold" style={{ whiteSpace: 'nowrap' }}>{p.name}</td>
                      <td className="num" style={{ backgroundColor: heatBg(p.games_attended, bowlR.games_attended, false) }}>{n0(p.games_attended)}</td>
                      <td className="num" style={{ backgroundColor: heatBg(p.games_bowled, bowlR.games_bowled, false) }}>{n0(p.games_bowled)}</td>
                      <td className="num" style={{ backgroundColor: heatBg(p.balls_bowled, bowlR.balls_bowled, false) }}>{p.overs}</td>
                      <td className="num" style={{ backgroundColor: heatBg(p.maidens, bowlR.maidens, false) }}>{n0(p.maidens)}</td>
                      <td className="num" style={{ backgroundColor: heatBg(p.wicket_maidens, bowlR.wicket_maidens, false) }}>{n0(p.wicket_maidens)}</td>
                      <td className="num" style={{ backgroundColor: heatBg(p.runs_conceded, bowlR.runs_conceded, true) }}>{n0(p.runs_conceded)}</td>
                      <td className="num bold" style={{ backgroundColor: heatBg(p.wickets, bowlR.wickets, false) }}>{n0(p.wickets)}</td>
                      <td className="num" style={{ backgroundColor: heatBg(p.bowl_avg, bowlR.bowl_avg, true) }}>{dash(p.bowl_avg)}</td>
                      <td className="num" style={{ backgroundColor: heatBg(p.bowl_econ, bowlR.bowl_econ, true) }}>{dash(p.bowl_econ)}</td>
                      <td className="num dim" style={{ backgroundColor: heatBg(p.bowl_sr, bowlR.bowl_sr, true) }}>{dash(p.bowl_sr)}</td>
                      <td className="num dim" style={{ backgroundColor: heatBg(p.wkts_per_over, bowlR.wkts_per_over, false) }}>{dash(p.wkts_per_over)}</td>
                      <td className="num" style={{ backgroundColor: heatBg(p.three_fers, bowlR.three_fers, false) }}>{n0(p.three_fers) || '–'}</td>
                      <td className="num" style={{ backgroundColor: heatBg(p.four_fers, bowlR.four_fers, false) }}>{n0(p.four_fers)  || '–'}</td>
                      <td className="num" style={{ backgroundColor: heatBg(p.five_fers, bowlR.five_fers, false) }}>{n0(p.five_fers)  || '–'}</td>
                      <td className="num" style={{ backgroundColor: heatBg(p.six_fers, bowlR.six_fers, false) }}>{n0(p.six_fers)   || '–'}</td>
                      <td className="num dim" style={{ backgroundColor: heatBg(p.wides, bowlR.wides, true) }}>{n0(p.wides)}</td>
                      <td className="num dim" style={{ backgroundColor: heatBg(p.no_balls, bowlR.no_balls, true) }}>{n0(p.no_balls)}</td>
                      <td className="num dim" style={{ backgroundColor: heatBg(p.wkt_bowled, bowlR.wkt_bowled, false) }}>{n0(p.wkt_bowled)  || '–'}</td>
                      <td className="num dim" style={{ backgroundColor: heatBg(p.wkt_caught, bowlR.wkt_caught, false) }}>{n0(p.wkt_caught)  || '–'}</td>
                      <td className="num dim" style={{ backgroundColor: heatBg(p.wkt_lbw, bowlR.wkt_lbw, false) }}>{n0(p.wkt_lbw)     || '–'}</td>
                      <td className="num dim" style={{ backgroundColor: heatBg(p.wkt_stumped, bowlR.wkt_stumped, false) }}>{n0(p.wkt_stumped) || '–'}</td>
                      <td className="num dim" style={{ backgroundColor: heatBg(p.catches, bowlR.catches, false) }}>{n0(p.catches)    || '–'}</td>
                      <td className="num dim" style={{ backgroundColor: heatBg(p.stumpings, bowlR.stumpings, false) }}>{n0(p.stumpings)  || '–'}</td>
                      <td className="num dim" style={{ backgroundColor: heatBg(p.run_outs, bowlR.run_outs, false) }}>{n0(p.run_outs)   || '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
