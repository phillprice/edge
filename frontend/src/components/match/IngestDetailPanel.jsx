import { useState, useEffect } from 'react'
import { useApiFetch } from '../../hooks/useApiFetch'

export default function IngestDetailPanel({ fixtureId }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const apiFetch = useApiFetch()

  useEffect(() => {
    if (!open || data) return
    apiFetch(`/api/admin/match/${fixtureId}`)
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const fmtTimestamp = (ms) =>
    ms ? new Date(Number(ms)).toISOString().replace('T', ' ').slice(0, 19) : '—'

  return (
    <div className="card" style={{ marginTop: '2rem', fontSize: '0.82rem', color: 'var(--text2)' }}>
      <button
        className="secondary"
        style={{ fontSize: '0.82rem', width: '100%', textAlign: 'left' }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '▾' : '▸'} Admin: ingest detail
      </button>
      {open && (
        <div style={{ marginTop: '0.75rem' }}>
          {error && <p style={{ color: 'var(--red)' }}>{error}</p>}
          {!data && !error && <p>Loading…</p>}
          {data && (
            <>
              <section style={{ marginBottom: '1rem' }}>
                <strong>Fixture</strong>
                <table style={{ marginTop: 4, borderCollapse: 'collapse', width: '100%' }}>
                  <tbody>
                    {[
                      ['fixture_id', data.fixture.fixture_id],
                      ['play_cricket_id', data.fixture.play_cricket_id ?? '—'],
                      ['format', data.fixture.format ?? '—'],
                      ['competition', data.fixture.competition ?? '—'],
                      ['result', data.fixture.result ?? '—']
                    ].map(([k, v]) => (
                      <tr key={k}>
                        <td
                          style={{ paddingRight: 16, color: 'var(--text3)', whiteSpace: 'nowrap' }}
                        >
                          {k}
                        </td>
                        <td>{String(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section style={{ marginBottom: '1rem' }}>
                <strong>Scheduled fixtures</strong>
                {data.scheduled.length === 0 ? (
                  <p style={{ marginTop: 4 }}>None</p>
                ) : (
                  data.scheduled.map((sf, i) => (
                    <table
                      key={i}
                      style={{ marginTop: 4, borderCollapse: 'collapse', width: '100%' }}
                    >
                      <tbody>
                        {[
                          [
                            'team',
                            `${sf.team_label ?? sf.team_id} / ${sf.season_year ?? sf.season_id}`
                          ],
                          ['status', sf.status],
                          ['attempts', sf.attempt_count ?? 0],
                          ['ingest_after', sf.ingest_after ?? '—'],
                          ['ingested_at', sf.ingested_at ?? '—'],
                          ['cron_job_id', sf.cron_job_id ?? '—'],
                          ['error_msg', sf.error_msg ?? '—']
                        ].map(([k, v]) => (
                          <tr key={k}>
                            <td
                              style={{
                                paddingRight: 16,
                                color: 'var(--text3)',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {k}
                            </td>
                            <td
                              style={{
                                color: k === 'error_msg' && v !== '—' ? 'var(--red)' : undefined
                              }}
                            >
                              {String(v)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ))
                )}
              </section>

              <section style={{ marginBottom: '1rem' }}>
                <strong>Team/season associations</strong>
                {data.associations.length === 0 ? (
                  <p style={{ marginTop: 4, color: 'var(--orange)' }}>
                    None — match is invisible to scoped users
                  </p>
                ) : (
                  <ul style={{ marginTop: 4, paddingLeft: 16 }}>
                    {data.associations.map((a, i) => (
                      <li key={i}>
                        {a.team_label ?? a.team_id} · {a.season_year ?? a.season_id}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <strong>Ingest log</strong>
                {data.ingests.length === 0 ? (
                  <p style={{ marginTop: 4 }}>None</p>
                ) : (
                  <table style={{ marginTop: 4, borderCollapse: 'collapse', width: '100%' }}>
                    <thead>
                      <tr>
                        {['#', 'when', 'by', 'sources', 'counts'].map((h) => (
                          <th
                            key={h}
                            style={{
                              textAlign: 'left',
                              paddingRight: 12,
                              color: 'var(--text3)',
                              fontWeight: 500
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.ingests.map((ig) => (
                        <tr key={ig.id}>
                          <td style={{ paddingRight: 12 }}>{ig.id}</td>
                          <td style={{ paddingRight: 12, whiteSpace: 'nowrap' }}>
                            {fmtTimestamp(ig.ingested_at)}
                          </td>
                          <td style={{ paddingRight: 12 }}>
                            {ig.clerk_user_name ?? ig.clerk_user_id ?? 'system'}
                          </td>
                          <td style={{ paddingRight: 12 }}>
                            {ig.source_files ? JSON.parse(ig.source_files).join(', ') : '—'}
                          </td>
                          <td>{ig.row_counts ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </div>
  )
}
