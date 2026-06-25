import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/clerk-react'
import { Tooltip } from 'react-tooltip'
import { useApiFetch } from '../hooks/useApiFetch'
import { dn } from '../utils/cricket'
import { SkeletonRow } from '../components/Skeleton'
import { downloadCsv } from '../utils/csvExport'
import { JerseyIcon, jerseyInitials } from '../components/JerseyIcon'
import FilterPills from '../components/FilterPills'
import TeamDropdown from '../components/TeamDropdown'
import { useGroupFilter } from '../hooks/useGroupFilter'
import { HighlightChip } from '../components/SeasonCards'
import { TopTrumpsCard } from '../components/TopTrumpsCard'

function dash(v) {
  return v == null || v === '' ? '–' : v
}
function n0(v) {
  return v == null ? 0 : v
}

function heatRange(rows, key) {
  const vals = rows
    .map((r) => r[key])
    .filter((v) => v != null && v !== '' && !isNaN(Number(v)))
    .map(Number)
  if (vals.length < 2) return null
  const mn = Math.min(...vals),
    mx = Math.max(...vals)
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
  const arrow = active ? (activeSort.dir === -1 ? ' ↓' : ' ↑') : ''
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
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSort(sortKey)
        }
      }}
      style={{ whiteSpace: 'nowrap', ...style }}
    >
      {label}
      {arrow}
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
        gap: '0.5rem'
      }}
    >
      <div
        style={{
          fontWeight: 600,
          fontSize: '0.92rem',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem'
        }}
      >
        <JerseyIcon size={18} initials={jerseyInitials(p.name)} number={p.jerseyNumber} />
        {dn(p.name)}
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>{n0(p.games_attended)} mat</div>
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: '0.68rem',
              color: 'var(--text3)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }}
          >
            Runs
          </div>
          <div style={{ fontWeight: 600, fontSize: '1rem' }}>{n0(p.runs)}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: '0.68rem',
              color: 'var(--text3)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }}
          >
            Avg
          </div>
          <div style={{ fontWeight: 600, fontSize: '1rem' }}>{p.bat_avg_per_game ?? '–'}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: '0.68rem',
              color: 'var(--text3)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }}
          >
            SR
          </div>
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
        gap: '0.5rem'
      }}
    >
      <div
        style={{
          fontWeight: 600,
          fontSize: '0.92rem',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem'
        }}
      >
        <JerseyIcon size={18} initials={jerseyInitials(p.name)} number={p.jerseyNumber} />
        {dn(p.name)}
      </div>
      <div style={{ fontSize: '0.75rem', color: 'var(--text3)' }}>{n0(p.games_attended)} mat</div>
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: '0.68rem',
              color: 'var(--text3)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }}
          >
            Wkts
          </div>
          <div style={{ fontWeight: 600, fontSize: '1rem' }}>{n0(p.wickets)}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: '0.68rem',
              color: 'var(--text3)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }}
          >
            Avg
          </div>
          <div style={{ fontWeight: 600, fontSize: '1rem' }}>{p.bowl_avg ?? '–'}</div>
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: '0.68rem',
              color: 'var(--text3)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em'
            }}
          >
            Econ
          </div>
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
  marginBottom: '2.5rem'
}

const DEFAULT_COLUMNS = ['MAT', 'INN', 'RUNS', 'AVG']

// ── Module-level constants (no component deps) ──────────────────────────────
const gb = { borderLeft: '2px solid var(--border2)' }
const ghStyle = {
  textAlign: 'center',
  fontSize: '0.68rem',
  fontWeight: 500,
  color: 'var(--text3)',
  paddingTop: 4,
  paddingBottom: 2,
  ...gb
}

// ── Module-level CSV export helpers ─────────────────────────────────────────
function exportBatCsv(players, show) {
  const header = [
    'Name',
    'Mat',
    'Inn',
    'NO',
    'Runs',
    'HS',
    'Avg',
    'SR',
    'Balls',
    ...(show.dot_balls ? ['Dots'] : []),
    '4s',
    '6s',
    ...(show.total_minutes ? ['Mins', 'Min/I'] : []),
    'Out',
    ...(show.dis_bowled ? ['Bowled'] : []),
    ...(show.dis_caught ? ['Caught'] : []),
    ...(show.dis_lbw ? ['LBW'] : []),
    ...(show.dis_runout ? ['Run out'] : []),
    ...(show.dis_stumped ? ['Stumped'] : []),
    ...(show.captain_count ? ['Capt'] : []),
    ...(show.wk_count ? ['WK'] : [])
  ]
  const data = players.map((p) => [
    p.name,
    n0(p.games_attended),
    n0(p.innings),
    n0(p.not_outs),
    n0(p.runs),
    n0(p.high_score),
    p.bat_avg_per_game ?? '',
    p.bat_sr ?? '',
    n0(p.balls_faced),
    ...(show.dot_balls ? [n0(p.dot_balls)] : []),
    n0(p.fours),
    n0(p.sixes),
    ...(show.total_minutes ? [n0(p.total_minutes), p.avg_minutes ?? ''] : []),
    n0(p.times_out),
    ...(show.dis_bowled ? [n0(p.dis_bowled)] : []),
    ...(show.dis_caught ? [n0(p.dis_caught)] : []),
    ...(show.dis_lbw ? [n0(p.dis_lbw)] : []),
    ...(show.dis_runout ? [n0(p.dis_runout)] : []),
    ...(show.dis_stumped ? [n0(p.dis_stumped)] : []),
    ...(show.captain_count ? [n0(p.captain_count)] : []),
    ...(show.wk_count ? [n0(p.wk_count)] : [])
  ])
  downloadCsv('players-batting.csv', [header, ...data])
}

function exportBowlCsv(players, show) {
  const header = [
    'Name',
    'Mat',
    'Inn',
    'Overs',
    ...(show.maidens ? ['M'] : []),
    ...(show.wicket_maidens ? ['WM'] : []),
    ...(show.bowl_dot_balls ? ['Dots'] : []),
    'R',
    'W',
    'Avg',
    'Econ',
    'W/O',
    ...(show.three_fers ? ['3W'] : []),
    ...(show.four_fers ? ['4W'] : []),
    ...(show.five_fers ? ['5W'] : []),
    ...(show.six_fers ? ['6W'] : []),
    'Wd',
    'NB',
    ...(show.wkt_bowled ? ['Wkt Bowled'] : []),
    ...(show.wkt_caught ? ['Wkt Caught'] : []),
    ...(show.wkt_lbw ? ['Wkt LBW'] : []),
    ...(show.wkt_stumped ? ['Wkt Stumped'] : []),
    ...(show.catches ? ['Catches'] : []),
    ...(show.stumpings ? ['Stumpings'] : []),
    ...(show.run_outs ? ['Run outs'] : [])
  ]
  const data = players.map((p) => [
    p.name,
    n0(p.games_attended),
    n0(p.games_bowled),
    p.overs,
    ...(show.maidens ? [n0(p.maidens)] : []),
    ...(show.wicket_maidens ? [n0(p.wicket_maidens)] : []),
    ...(show.bowl_dot_balls ? [n0(p.bowl_dot_balls)] : []),
    n0(p.runs_conceded),
    n0(p.wickets),
    p.bowl_avg ?? '',
    p.bowl_econ ?? '',
    p.wkts_per_over ?? '',
    ...(show.three_fers ? [n0(p.three_fers)] : []),
    ...(show.four_fers ? [n0(p.four_fers)] : []),
    ...(show.five_fers ? [n0(p.five_fers)] : []),
    ...(show.six_fers ? [n0(p.six_fers)] : []),
    n0(p.wides),
    n0(p.no_balls),
    ...(show.wkt_bowled ? [n0(p.wkt_bowled)] : []),
    ...(show.wkt_caught ? [n0(p.wkt_caught)] : []),
    ...(show.wkt_lbw ? [n0(p.wkt_lbw)] : []),
    ...(show.wkt_stumped ? [n0(p.wkt_stumped)] : []),
    ...(show.catches ? [n0(p.catches)] : []),
    ...(show.stumpings ? [n0(p.stumpings)] : []),
    ...(show.run_outs ? [n0(p.run_outs)] : [])
  ])
  downloadCsv('players-bowling.csv', [header, ...data])
}

// ── BattingTable subcomponent ────────────────────────────────────────────────
function BattingTable({
  players,
  sort,
  onSort,
  show,
  ranges,
  navigate,
  sc,
  appCols,
  batCols,
  ballCols,
  bndCols,
  batDisCount,
  batFirstRole,
  showAllCols
}) {
  return (
    <div
      className={`card player-table-wrap${showAllCols ? ' show-all-cols' : ''}`}
      style={{ marginBottom: '2.5rem' }}
    >
      <table style={{ fontSize: '0.8rem', position: 'relative' }}>
        <thead>
          <tr>
            <th />
            {appCols > 0 && (
              <th colSpan={appCols} style={ghStyle}>
                Appearances
              </th>
            )}
            {batCols > 0 && (
              <th colSpan={batCols} style={ghStyle}>
                Batting
              </th>
            )}
            {ballCols > 0 && (
              <th colSpan={ballCols} style={ghStyle}>
                Balls
              </th>
            )}
            {bndCols > 0 && (
              <th colSpan={bndCols} style={ghStyle}>
                Boundaries
              </th>
            )}
            {show.total_minutes && (
              <th colSpan={2} style={ghStyle}>
                Time
              </th>
            )}
            <th colSpan={batDisCount} style={ghStyle}>
              Dismissals
            </th>
            {(show.captain_count || show.wk_count) && (
              <th colSpan={(show.captain_count ? 1 : 0) + (show.wk_count ? 1 : 0)} style={ghStyle}>
                Roles
              </th>
            )}
          </tr>
          <tr>
            <SortTh
              label="Name"
              sortKey="name"
              activeSort={sort}
              onSort={onSort}
              isName
              title="Player name"
            />
            {sc('MAT') && (
              <SortTh
                label="Mat"
                sortKey="games_attended"
                activeSort={sort}
                onSort={onSort}
                title="Matches attended (batted or bowled)"
                style={gb}
              />
            )}
            {sc('INN') && (
              <SortTh
                label="Inn"
                sortKey="innings"
                activeSort={sort}
                onSort={onSort}
                title="Innings batted"
              />
            )}
            {sc('NO') && (
              <SortTh
                label="NO"
                sortKey="not_outs"
                activeSort={sort}
                onSort={onSort}
                title="Not outs"
              />
            )}
            {sc('RUNS') && (
              <SortTh
                label="Runs"
                sortKey="runs"
                activeSort={sort}
                onSort={onSort}
                title="Total runs"
                style={gb}
              />
            )}
            {sc('HS') && (
              <SortTh
                label="HS"
                sortKey="high_score"
                activeSort={sort}
                onSort={onSort}
                title="Highest score"
              />
            )}
            {sc('AVG') && (
              <SortTh
                label="Avg"
                sortKey="bat_avg_per_game"
                activeSort={sort}
                onSort={onSort}
                title="Average per game (runs ÷ matches batted)"
              />
            )}
            {sc('SR') && (
              <SortTh
                label="SR"
                sortKey="bat_sr"
                activeSort={sort}
                onSort={onSort}
                title="Strike rate (runs per 100 balls)"
              />
            )}
            {sc('BALLS') && (
              <SortTh
                label="B"
                sortKey="balls_faced"
                activeSort={sort}
                onSort={onSort}
                title="Balls faced"
                style={gb}
              />
            )}
            {show.dot_balls && (
              <SortTh
                label="Dots"
                sortKey="dot_balls"
                activeSort={sort}
                onSort={onSort}
                title="Dot balls (legal deliveries scoring 0)"
              />
            )}
            {sc('4S') && (
              <SortTh
                label="4s"
                sortKey="fours"
                activeSort={sort}
                onSort={onSort}
                title="Fours"
                style={gb}
              />
            )}
            {sc('6S') && (
              <SortTh label="6s" sortKey="sixes" activeSort={sort} onSort={onSort} title="Sixes" />
            )}
            {show.total_minutes && (
              <SortTh
                label="Mins"
                sortKey="total_minutes"
                activeSort={sort}
                onSort={onSort}
                title="Total minutes at crease (inc. non-striker)"
                style={gb}
              />
            )}
            {show.total_minutes && (
              <SortTh
                label="Min/I"
                sortKey="avg_minutes"
                activeSort={sort}
                onSort={onSort}
                title="Average minutes per innings"
              />
            )}
            <SortTh
              label="Out"
              sortKey="times_out"
              activeSort={sort}
              onSort={onSort}
              title="Times dismissed"
              style={gb}
            />
            {show.dis_bowled && (
              <SortTh
                label="Bo"
                sortKey="dis_bowled"
                activeSort={sort}
                onSort={onSort}
                title="Times bowled"
              />
            )}
            {show.dis_caught && (
              <SortTh
                label="Ct"
                sortKey="dis_caught"
                activeSort={sort}
                onSort={onSort}
                title="Times caught"
              />
            )}
            {show.dis_lbw && (
              <SortTh
                label="LBW"
                sortKey="dis_lbw"
                activeSort={sort}
                onSort={onSort}
                title="Times out LBW"
              />
            )}
            {show.dis_runout && (
              <SortTh
                label="RO"
                sortKey="dis_runout"
                activeSort={sort}
                onSort={onSort}
                title="Times run out"
              />
            )}
            {show.dis_stumped && (
              <SortTh
                label="St"
                sortKey="dis_stumped"
                activeSort={sort}
                onSort={onSort}
                title="Times stumped"
              />
            )}
            {show.captain_count && (
              <SortTh
                label="Capt"
                sortKey="captain_count"
                activeSort={sort}
                onSort={onSort}
                title="Times captain"
                style={gb}
              />
            )}
            {show.wk_count && (
              <SortTh
                label="WK"
                sortKey="wk_count"
                activeSort={sort}
                onSort={onSort}
                title="Times wicket keeper"
                style={batFirstRole === 'wk_count' ? gb : undefined}
              />
            )}
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr
              key={p.player_id}
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/player/${p.player_id}`)}
            >
              <td className="bold" style={{ whiteSpace: 'nowrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <JerseyIcon size={24} initials={jerseyInitials(p.name)} number={p.jerseyNumber} />
                  {dn(p.name)}
                </span>
              </td>
              {sc('MAT') && (
                <td
                  className="num"
                  style={{
                    backgroundColor: heatBg(p.games_attended, ranges.games_attended, false),
                    ...gb
                  }}
                >
                  {n0(p.games_attended)}
                </td>
              )}
              {sc('INN') && (
                <td
                  className="num"
                  style={{ backgroundColor: heatBg(p.innings, ranges.innings, false) }}
                >
                  {n0(p.innings)}
                </td>
              )}
              {sc('NO') && (
                <td
                  className="num dim"
                  style={{ backgroundColor: heatBg(p.not_outs, ranges.not_outs, false) }}
                >
                  {n0(p.not_outs)}
                </td>
              )}
              {sc('RUNS') && (
                <td
                  className="num bold"
                  style={{ backgroundColor: heatBg(p.runs, ranges.runs, false), ...gb }}
                >
                  {n0(p.runs)}
                </td>
              )}
              {sc('HS') && (
                <td
                  className="num"
                  style={{ backgroundColor: heatBg(p.high_score, ranges.high_score, false) }}
                >
                  {n0(p.high_score)}
                </td>
              )}
              {sc('AVG') && (
                <td
                  className="num"
                  style={{
                    backgroundColor: heatBg(p.bat_avg_per_game, ranges.bat_avg_per_game, false)
                  }}
                >
                  {dash(p.bat_avg_per_game)}
                </td>
              )}
              {sc('SR') && (
                <td
                  className="num dim"
                  style={{ backgroundColor: heatBg(p.bat_sr, ranges.bat_sr, false) }}
                >
                  {dash(p.bat_sr)}
                </td>
              )}
              {sc('BALLS') && (
                <td
                  className="num dim"
                  style={{
                    backgroundColor: heatBg(p.balls_faced, ranges.balls_faced, false),
                    ...gb
                  }}
                >
                  {n0(p.balls_faced)}
                </td>
              )}
              {show.dot_balls && (
                <td
                  className="num dim"
                  style={{ backgroundColor: heatBg(p.dot_balls, ranges.dot_balls, true) }}
                >
                  {n0(p.dot_balls) || '–'}
                </td>
              )}
              {sc('4S') && (
                <td
                  className="num"
                  style={{ backgroundColor: heatBg(p.fours, ranges.fours, false), ...gb }}
                >
                  {n0(p.fours)}
                </td>
              )}
              {sc('6S') && (
                <td
                  className="num"
                  style={{ backgroundColor: heatBg(p.sixes, ranges.sixes, false) }}
                >
                  {n0(p.sixes)}
                </td>
              )}
              {show.total_minutes && (
                <td
                  className="num dim"
                  style={{
                    backgroundColor: heatBg(p.total_minutes, ranges.total_minutes, false),
                    ...gb
                  }}
                >
                  {n0(p.total_minutes) || '–'}
                </td>
              )}
              {show.total_minutes && (
                <td
                  className="num dim"
                  style={{ backgroundColor: heatBg(p.avg_minutes, ranges.avg_minutes, false) }}
                >
                  {dash(p.avg_minutes)}
                </td>
              )}
              <td
                className="num"
                style={{ backgroundColor: heatBg(p.times_out, ranges.times_out, true), ...gb }}
              >
                {n0(p.times_out)}
              </td>
              {show.dis_bowled && (
                <td
                  className="num dim"
                  style={{ backgroundColor: heatBg(p.dis_bowled, ranges.dis_bowled, true) }}
                >
                  {n0(p.dis_bowled) || '–'}
                </td>
              )}
              {show.dis_caught && (
                <td
                  className="num dim"
                  style={{ backgroundColor: heatBg(p.dis_caught, ranges.dis_caught, true) }}
                >
                  {n0(p.dis_caught) || '–'}
                </td>
              )}
              {show.dis_lbw && (
                <td
                  className="num dim"
                  style={{ backgroundColor: heatBg(p.dis_lbw, ranges.dis_lbw, true) }}
                >
                  {n0(p.dis_lbw) || '–'}
                </td>
              )}
              {show.dis_runout && (
                <td
                  className="num dim"
                  style={{ backgroundColor: heatBg(p.dis_runout, ranges.dis_runout, true) }}
                >
                  {n0(p.dis_runout) || '–'}
                </td>
              )}
              {show.dis_stumped && (
                <td
                  className="num dim"
                  style={{ backgroundColor: heatBg(p.dis_stumped, ranges.dis_stumped, true) }}
                >
                  {n0(p.dis_stumped) || '–'}
                </td>
              )}
              {show.captain_count && (
                <td
                  className="num dim"
                  style={{
                    backgroundColor: heatBg(p.captain_count, ranges.captain_count, false),
                    ...gb
                  }}
                >
                  {n0(p.captain_count) || '–'}
                </td>
              )}
              {show.wk_count && (
                <td
                  className="num dim"
                  style={{
                    backgroundColor: heatBg(p.wk_count, ranges.wk_count, false),
                    ...(batFirstRole === 'wk_count' ? gb : {})
                  }}
                >
                  {n0(p.wk_count) || '–'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── BowlingTable subcomponent ────────────────────────────────────────────────
function BowlingTable({
  players,
  sort,
  onSort,
  show,
  ranges,
  navigate,
  bowlHaulCount,
  bowlWktCount,
  bowlFieldCount,
  bowlFirstHaul,
  bowlFirstWkt,
  bowlFirstFld,
  showAllCols,
  selectedKey,
  comp
}) {
  if (players.length === 0) {
    return (
      <div className="empty">
        {selectedKey || comp
          ? 'No bowling data — try adjusting the filters.'
          : 'No bowling data yet.'}
      </div>
    )
  }
  return (
    <div className={`card player-table-wrap${showAllCols ? ' show-all-cols' : ''}`}>
      <table style={{ fontSize: '0.8rem', position: 'relative' }}>
        <thead>
          <tr>
            <th />
            <th colSpan={2} style={ghStyle}>
              Appearances
            </th>
            <th
              colSpan={
                1 +
                (show.maidens ? 1 : 0) +
                (show.wicket_maidens ? 1 : 0) +
                (show.bowl_dot_balls ? 1 : 0)
              }
              style={ghStyle}
            >
              Bowling
            </th>
            <th colSpan={5} style={ghStyle}>
              Performance
            </th>
            {bowlHaulCount > 0 && (
              <th colSpan={bowlHaulCount} style={ghStyle}>
                Hauls
              </th>
            )}
            <th colSpan={2} style={ghStyle}>
              Extras
            </th>
            {bowlWktCount > 0 && (
              <th colSpan={bowlWktCount} style={ghStyle}>
                Wickets
              </th>
            )}
            {bowlFieldCount > 0 && (
              <th colSpan={bowlFieldCount} style={ghStyle}>
                Fielding
              </th>
            )}
          </tr>
          <tr>
            <SortTh
              label="Name"
              sortKey="name"
              activeSort={sort}
              onSort={onSort}
              isName
              title="Player name"
            />
            <SortTh
              label="Mat"
              sortKey="games_attended"
              activeSort={sort}
              onSort={onSort}
              title="Matches attended"
              style={gb}
            />
            <SortTh
              label="Inn"
              sortKey="games_bowled"
              activeSort={sort}
              onSort={onSort}
              title="Innings bowled"
            />
            <SortTh
              label="O"
              sortKey="balls_bowled"
              activeSort={sort}
              onSort={onSort}
              title="Overs bowled"
              style={gb}
            />
            {show.maidens && (
              <SortTh
                label="M"
                sortKey="maidens"
                activeSort={sort}
                onSort={onSort}
                title="Maiden overs"
              />
            )}
            {show.wicket_maidens && (
              <SortTh
                label="WM"
                sortKey="wicket_maidens"
                activeSort={sort}
                onSort={onSort}
                title="Wicket maidens"
              />
            )}
            {show.bowl_dot_balls && (
              <SortTh
                label="Dots"
                sortKey="bowl_dot_balls"
                activeSort={sort}
                onSort={onSort}
                title="Dot balls bowled"
              />
            )}
            <SortTh
              label="R"
              sortKey="runs_conceded"
              activeSort={sort}
              onSort={onSort}
              title="Runs conceded"
              style={gb}
            />
            <SortTh label="W" sortKey="wickets" activeSort={sort} onSort={onSort} title="Wickets" />
            <SortTh
              label="Avg"
              sortKey="bowl_avg"
              activeSort={sort}
              onSort={onSort}
              title="Bowling average (runs ÷ wickets)"
            />
            <SortTh
              label="Econ"
              sortKey="bowl_econ"
              activeSort={sort}
              onSort={onSort}
              title="Economy (runs per over)"
            />
            <SortTh
              label="W/O"
              sortKey="wkts_per_over"
              activeSort={sort}
              onSort={onSort}
              title="Wickets per over"
            />
            {show.three_fers && (
              <SortTh
                label="3W"
                sortKey="three_fers"
                activeSort={sort}
                onSort={onSort}
                title="3-wicket hauls"
                style={bowlFirstHaul === 'three_fers' ? gb : undefined}
              />
            )}
            {show.four_fers && (
              <SortTh
                label="4W"
                sortKey="four_fers"
                activeSort={sort}
                onSort={onSort}
                title="4-wicket hauls"
                style={bowlFirstHaul === 'four_fers' ? gb : undefined}
              />
            )}
            {show.five_fers && (
              <SortTh
                label="5W"
                sortKey="five_fers"
                activeSort={sort}
                onSort={onSort}
                title="5-wicket hauls"
                style={bowlFirstHaul === 'five_fers' ? gb : undefined}
              />
            )}
            {show.six_fers && (
              <SortTh
                label="6W"
                sortKey="six_fers"
                activeSort={sort}
                onSort={onSort}
                title="6-wicket hauls"
                style={bowlFirstHaul === 'six_fers' ? gb : undefined}
              />
            )}
            <SortTh
              label="Wd"
              sortKey="wides"
              activeSort={sort}
              onSort={onSort}
              title="Wides"
              style={gb}
            />
            <SortTh
              label="NB"
              sortKey="no_balls"
              activeSort={sort}
              onSort={onSort}
              title="No balls"
            />
            {show.wkt_bowled && (
              <SortTh
                label="Bo"
                sortKey="wkt_bowled"
                activeSort={sort}
                onSort={onSort}
                title="Wickets: bowled"
                style={bowlFirstWkt === 'wkt_bowled' ? gb : undefined}
              />
            )}
            {show.wkt_caught && (
              <SortTh
                label="Ct"
                sortKey="wkt_caught"
                activeSort={sort}
                onSort={onSort}
                title="Wickets: caught (inc. c&b)"
                style={bowlFirstWkt === 'wkt_caught' ? gb : undefined}
              />
            )}
            {show.wkt_lbw && (
              <SortTh
                label="LBW"
                sortKey="wkt_lbw"
                activeSort={sort}
                onSort={onSort}
                title="Wickets: LBW"
                style={bowlFirstWkt === 'wkt_lbw' ? gb : undefined}
              />
            )}
            {show.wkt_stumped && (
              <SortTh
                label="St"
                sortKey="wkt_stumped"
                activeSort={sort}
                onSort={onSort}
                title="Wickets: stumped"
                style={bowlFirstWkt === 'wkt_stumped' ? gb : undefined}
              />
            )}
            {show.catches && (
              <SortTh
                label="Cau"
                sortKey="catches"
                activeSort={sort}
                onSort={onSort}
                title="Catches taken in field"
                style={bowlFirstFld === 'catches' ? gb : undefined}
              />
            )}
            {show.stumpings && (
              <SortTh
                label="Stp"
                sortKey="stumpings"
                activeSort={sort}
                onSort={onSort}
                title="Stumpings"
                style={bowlFirstFld === 'stumpings' ? gb : undefined}
              />
            )}
            {show.run_outs && (
              <SortTh
                label="RO"
                sortKey="run_outs"
                activeSort={sort}
                onSort={onSort}
                title="Run outs effected"
                style={bowlFirstFld === 'run_outs' ? gb : undefined}
              />
            )}
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr
              key={p.player_id}
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/player/${p.player_id}`)}
            >
              <td className="bold" style={{ whiteSpace: 'nowrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                  <JerseyIcon size={24} initials={jerseyInitials(p.name)} number={p.jerseyNumber} />
                  {dn(p.name)}
                </span>
              </td>
              <td
                className="num"
                style={{
                  backgroundColor: heatBg(p.games_attended, ranges.games_attended, false),
                  ...gb
                }}
              >
                {n0(p.games_attended)}
              </td>
              <td
                className="num"
                style={{ backgroundColor: heatBg(p.games_bowled, ranges.games_bowled, false) }}
              >
                {n0(p.games_bowled)}
              </td>
              <td
                className="num"
                style={{
                  backgroundColor: heatBg(p.balls_bowled, ranges.balls_bowled, false),
                  ...gb
                }}
              >
                {p.overs}
              </td>
              {show.maidens && (
                <td
                  className="num"
                  style={{ backgroundColor: heatBg(p.maidens, ranges.maidens, false) }}
                >
                  {n0(p.maidens)}
                </td>
              )}
              {show.wicket_maidens && (
                <td
                  className="num"
                  style={{
                    backgroundColor: heatBg(p.wicket_maidens, ranges.wicket_maidens, false)
                  }}
                >
                  {n0(p.wicket_maidens)}
                </td>
              )}
              {show.bowl_dot_balls && (
                <td
                  className="num dim"
                  style={{
                    backgroundColor: heatBg(p.bowl_dot_balls, ranges.bowl_dot_balls, false)
                  }}
                >
                  {n0(p.bowl_dot_balls) || '–'}
                </td>
              )}
              <td
                className="num"
                style={{
                  backgroundColor: heatBg(p.runs_conceded, ranges.runs_conceded, true),
                  ...gb
                }}
              >
                {n0(p.runs_conceded)}
              </td>
              <td
                className="num bold"
                style={{ backgroundColor: heatBg(p.wickets, ranges.wickets, false) }}
              >
                {n0(p.wickets)}
              </td>
              <td
                className="num"
                style={{ backgroundColor: heatBg(p.bowl_avg, ranges.bowl_avg, true) }}
              >
                {dash(p.bowl_avg)}
              </td>
              <td
                className="num"
                style={{ backgroundColor: heatBg(p.bowl_econ, ranges.bowl_econ, true) }}
              >
                {dash(p.bowl_econ)}
              </td>
              <td
                className="num dim"
                style={{ backgroundColor: heatBg(p.wkts_per_over, ranges.wkts_per_over, false) }}
              >
                {dash(p.wkts_per_over)}
              </td>
              {show.three_fers && (
                <td
                  className="num"
                  style={{
                    backgroundColor: heatBg(p.three_fers, ranges.three_fers, false),
                    ...(bowlFirstHaul === 'three_fers' ? gb : {})
                  }}
                >
                  {n0(p.three_fers) || '–'}
                </td>
              )}
              {show.four_fers && (
                <td
                  className="num"
                  style={{
                    backgroundColor: heatBg(p.four_fers, ranges.four_fers, false),
                    ...(bowlFirstHaul === 'four_fers' ? gb : {})
                  }}
                >
                  {n0(p.four_fers) || '–'}
                </td>
              )}
              {show.five_fers && (
                <td
                  className="num"
                  style={{
                    backgroundColor: heatBg(p.five_fers, ranges.five_fers, false),
                    ...(bowlFirstHaul === 'five_fers' ? gb : {})
                  }}
                >
                  {n0(p.five_fers) || '–'}
                </td>
              )}
              {show.six_fers && (
                <td
                  className="num"
                  style={{
                    backgroundColor: heatBg(p.six_fers, ranges.six_fers, false),
                    ...(bowlFirstHaul === 'six_fers' ? gb : {})
                  }}
                >
                  {n0(p.six_fers) || '–'}
                </td>
              )}
              <td
                className="num dim"
                style={{ backgroundColor: heatBg(p.wides, ranges.wides, true), ...gb }}
              >
                {n0(p.wides)}
              </td>
              <td
                className="num dim"
                style={{ backgroundColor: heatBg(p.no_balls, ranges.no_balls, true) }}
              >
                {n0(p.no_balls)}
              </td>
              {show.wkt_bowled && (
                <td
                  className="num dim"
                  style={{
                    backgroundColor: heatBg(p.wkt_bowled, ranges.wkt_bowled, false),
                    ...(bowlFirstWkt === 'wkt_bowled' ? gb : {})
                  }}
                >
                  {n0(p.wkt_bowled) || '–'}
                </td>
              )}
              {show.wkt_caught && (
                <td
                  className="num dim"
                  style={{
                    backgroundColor: heatBg(p.wkt_caught, ranges.wkt_caught, false),
                    ...(bowlFirstWkt === 'wkt_caught' ? gb : {})
                  }}
                >
                  {n0(p.wkt_caught) || '–'}
                </td>
              )}
              {show.wkt_lbw && (
                <td
                  className="num dim"
                  style={{
                    backgroundColor: heatBg(p.wkt_lbw, ranges.wkt_lbw, false),
                    ...(bowlFirstWkt === 'wkt_lbw' ? gb : {})
                  }}
                >
                  {n0(p.wkt_lbw) || '–'}
                </td>
              )}
              {show.wkt_stumped && (
                <td
                  className="num dim"
                  style={{
                    backgroundColor: heatBg(p.wkt_stumped, ranges.wkt_stumped, false),
                    ...(bowlFirstWkt === 'wkt_stumped' ? gb : {})
                  }}
                >
                  {n0(p.wkt_stumped) || '–'}
                </td>
              )}
              {show.catches && (
                <td
                  className="num dim"
                  style={{
                    backgroundColor: heatBg(p.catches, ranges.catches, false),
                    ...(bowlFirstFld === 'catches' ? gb : {})
                  }}
                >
                  {n0(p.catches) || '–'}
                </td>
              )}
              {show.stumpings && (
                <td
                  className="num dim"
                  style={{
                    backgroundColor: heatBg(p.stumpings, ranges.stumpings, false),
                    ...(bowlFirstFld === 'stumpings' ? gb : {})
                  }}
                >
                  {n0(p.stumpings) || '–'}
                </td>
              )}
              {show.run_outs && (
                <td
                  className="num dim"
                  style={{
                    backgroundColor: heatBg(p.run_outs, ranges.run_outs, false),
                    ...(bowlFirstFld === 'run_outs' ? gb : {})
                  }}
                >
                  {n0(p.run_outs) || '–'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── PartnershipsTable subcomponent ───────────────────────────────────────────
function PartnershipsTable({ sortedPartners, sort, onSort, navigate }) {
  return (
    <div className="card player-table-wrap">
      <table style={{ fontSize: '0.8rem' }}>
        <thead>
          <tr>
            <SortTh
              label="Partnership"
              sortKey="p1_name"
              activeSort={sort}
              onSort={onSort}
              isName
              title="Partnership"
            />
            <SortTh
              label="Stands"
              sortKey="stands"
              activeSort={sort}
              onSort={onSort}
              title="Number of innings batted together"
            />
            <SortTh
              label="Runs"
              sortKey="total_runs"
              activeSort={sort}
              onSort={onSort}
              title="Total runs scored together"
            />
            <SortTh
              label="Best"
              sortKey="best_stand"
              activeSort={sort}
              onSort={onSort}
              title="Best single partnership stand"
            />
            <SortTh
              label="Avg"
              sortKey="avg_stand"
              activeSort={sort}
              onSort={onSort}
              title="Average runs per stand"
            />
          </tr>
        </thead>
        <tbody>
          {sortedPartners.map((p, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 500, fontSize: '0.82rem' }}>
                <span
                  style={{ cursor: 'pointer', color: 'var(--link)' }}
                  onClick={() => navigate(`/player/${p.p1_id}`)}
                >
                  {dn(p.p1_name)}
                </span>
                <span style={{ color: 'var(--text3)', margin: '0 0.4rem' }}>&amp;</span>
                <span
                  style={{ cursor: 'pointer', color: 'var(--link)' }}
                  onClick={() => navigate(`/player/${p.p2_id}`)}
                >
                  {dn(p.p2_name)}
                </span>
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
  )
}

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
              options={[
                { value: 'league', label: 'League' },
                { value: 'cup', label: 'Cup' },
                { value: 'friendly', label: 'Friendly' },
                { value: 'internal', label: 'Internal' },
                { value: 'indoor', label: 'Indoor' }
              ]}
              value={typeFilter}
              onChange={(arr) => updateFilter('types', arr.join(','), '')}
            />
          )}
          <FilterPills
            label="Format"
            options={[
              { value: '', label: 'All' },
              { value: 'no-pairs', label: 'Hide pairs' },
              { value: 'pairs', label: 'Pairs only' }
            ]}
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

          {/* ── Top Trumps view ── */}
          {listView === 'Top Trumps' && (
            <>
              <h2 style={{ marginBottom: '0.75rem' }}>Top Trumps Ratings</h2>
              {ttLoading ? (
                <div style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>Loading…</div>
              ) : (
                <div style={cardGridStyle}>
                  {(ttData || []).map((p) => (
                    <TopTrumpsCard
                      key={p.player_id}
                      p={p}
                      onClick={() => navigate(`/player/${p.player_id}`)}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {listView !== 'Top Trumps' && (
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
                  <ViewToggle value={listView} onChange={handleViewChange} />
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
                <div style={{ marginLeft: 'auto' }}>
                  <ViewToggle value={listView} onChange={handleViewChange} />
                </div>
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
