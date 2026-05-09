import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApiFetch } from '../hooks/useApiFetch'

function dash(v) { return v == null || v === '' ? '–' : v }
function n0(v)   { return v == null ? 0 : v }

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

  const batPlayers  = sortRows(filtered, batSort)
  const bowlPlayers = sortRows(filtered.filter(p => n0(p.games_bowled) > 0), bowlSort)

  const onBat  = k => toggleSort(setBatSort,  k)
  const onBowl = k => toggleSort(setBowlSort, k)

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
                    <td className="num bold">{n0(p.runs)}</td>
                    <td className="num">{n0(p.high_score)}</td>
                    <td className="num">{dash(p.bat_avg)}</td>
                    <td className="num dim">{n0(p.balls_faced)}</td>
                    <td className="num">{n0(p.fours)}</td>
                    <td className="num">{n0(p.sixes)}</td>
                    <td className="num dim">{dash(p.bat_sr)}</td>
                    <td className="num dim">{n0(p.total_minutes) || '–'}</td>
                    <td className="num dim">{dash(p.avg_minutes)}</td>
                    <td className="num">{n0(p.times_out)}</td>
                    <td className="num dim">{n0(p.dis_bowled)  || '–'}</td>
                    <td className="num dim">{n0(p.dis_caught)  || '–'}</td>
                    <td className="num dim">{n0(p.dis_lbw)     || '–'}</td>
                    <td className="num dim">{n0(p.dis_runout)  || '–'}</td>
                    <td className="num dim">{n0(p.dis_stumped) || '–'}</td>
                    <td className="num dim">{n0(p.captain_count) || '–'}</td>
                    <td className="num dim">{n0(p.wk_count)      || '–'}</td>
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
                      <td className="num">{n0(p.games_attended)}</td>
                      <td className="num">{n0(p.games_bowled)}</td>
                      <td className="num">{p.overs}</td>
                      <td className="num">{n0(p.maidens)}</td>
                      <td className="num">{n0(p.wicket_maidens)}</td>
                      <td className="num">{n0(p.runs_conceded)}</td>
                      <td className="num bold">{n0(p.wickets)}</td>
                      <td className="num">{dash(p.bowl_avg)}</td>
                      <td className="num">{dash(p.bowl_econ)}</td>
                      <td className="num dim">{dash(p.bowl_sr)}</td>
                      <td className="num dim">{dash(p.wkts_per_over)}</td>
                      <td className="num">{n0(p.three_fers) || '–'}</td>
                      <td className="num">{n0(p.four_fers)  || '–'}</td>
                      <td className="num">{n0(p.five_fers)  || '–'}</td>
                      <td className="num">{n0(p.six_fers)   || '–'}</td>
                      <td className="num dim">{n0(p.wides)}</td>
                      <td className="num dim">{n0(p.no_balls)}</td>
                      <td className="num dim">{n0(p.wkt_bowled)  || '–'}</td>
                      <td className="num dim">{n0(p.wkt_caught)  || '–'}</td>
                      <td className="num dim">{n0(p.wkt_lbw)     || '–'}</td>
                      <td className="num dim">{n0(p.wkt_stumped) || '–'}</td>
                      <td className="num dim">{n0(p.catches)    || '–'}</td>
                      <td className="num dim">{n0(p.stumpings)  || '–'}</td>
                      <td className="num dim">{n0(p.run_outs)   || '–'}</td>
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
