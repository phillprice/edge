import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApiFetch } from '../../hooks/useApiFetch'
import { shortTeam, formatDateShort } from '../../utils/cricket'
import TagPicker from '../../components/TagPicker'

// ── Manual tab ────────────────────────────────────────────────────────────────

export default function ManualTab() {
  const [matches, setMatches] = useState(null)
  const navigate = useNavigate()
  const apiFetch = useApiFetch()

  async function setTags(fixtureId, tags) {
    const res = await apiFetch(`/api/admin/match/${fixtureId}/type`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags })
    })
    if (res.ok) {
      setMatches((prev) => prev.map((m) => (m.fixture_id === fixtureId ? { ...m, tags } : m)))
    }
  }

  useEffect(() => {
    apiFetch('/api/admin/manual-matches')
      .then((r) => r.json())
      .then(setMatches)
      .catch(() => setMatches([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
          flexWrap: 'wrap',
          gap: '0.5rem'
        }}
      >
        <p style={{ color: 'var(--text2)', fontSize: '0.88rem', margin: 0 }}>
          Manually-entered match scorecards.
        </p>
        <button onClick={() => navigate('/manual')}>+ New match</button>
      </div>

      {!matches && <div className="loading">Loading…</div>}
      {matches && matches.length === 0 && <div className="empty">No manual matches yet.</div>}
      {matches && matches.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ fontSize: '0.85rem', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Date</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Match</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Competition</th>
                <th style={{ textAlign: 'left', padding: '8px 12px' }}>Type</th>
                <th style={{ textAlign: 'center', padding: '8px 12px' }}>Batting rows</th>
                <th style={{ textAlign: 'center', padding: '8px 12px' }}>Bowling rows</th>
                <th style={{ padding: '8px 12px' }}></th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.fixture_id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '7px 12px', whiteSpace: 'nowrap', color: 'var(--text2)' }}>
                    {formatDateShort(m.match_date_iso) ?? '—'}
                  </td>
                  <td style={{ padding: '7px 12px' }}>
                    {shortTeam(m.home_team)} vs {shortTeam(m.away_team)}
                  </td>
                  <td style={{ padding: '7px 12px', color: 'var(--text2)' }}>
                    {m.competition || '—'}
                  </td>
                  <td style={{ padding: '7px 12px' }}>
                    <TagPicker
                      value={m.tags ?? (m.match_type ? [m.match_type] : ['league'])}
                      onChange={(tags) => setTags(m.fixture_id, tags)}
                    />
                  </td>
                  <td style={{ padding: '7px 12px', textAlign: 'center' }}>{m.bat_rows}</td>
                  <td style={{ padding: '7px 12px', textAlign: 'center' }}>{m.bowl_rows}</td>
                  <td style={{ padding: '7px 12px', display: 'flex', gap: 6 }}>
                    <button
                      className="secondary btn-sm"
                      onClick={() => navigate(`/match/${m.fixture_id}`)}
                    >
                      View
                    </button>
                    <button
                      className="secondary btn-sm"
                      onClick={() => navigate(`/manual/${m.fixture_id}`)}
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
