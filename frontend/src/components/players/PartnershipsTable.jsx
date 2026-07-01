import { dn } from '../../utils/cricket'
import { SortTh } from './SortTh'

export function PartnershipsTable({ sortedPartners, sort, onSort, navigate }) {
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
