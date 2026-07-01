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

export function BowlingTable({
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
