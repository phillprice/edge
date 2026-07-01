import { dn } from '../../utils/cricket'
import { JerseyIcon, jerseyInitials } from '../JerseyIcon'
import { SortTh } from './SortTh'
import { dash, n0, heatBg } from './playerStatsFormat'

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

export function BattingTable({
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
