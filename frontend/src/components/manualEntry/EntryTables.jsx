import { X } from 'lucide-react'

export function BattingTable({ rows, onChange, onAdd, onRemove, playerNames, isPairs }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <datalist id="player-list">
        {playerNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <table className="entry-table" style={{ minWidth: isPairs ? '780px' : '790px' }}>
        <thead>
          <tr>
            <th style={{ width: '180px' }}>Player</th>
            <th>How out</th>
            <th style={{ width: '64px' }}>R</th>
            <th style={{ width: '64px' }}>B</th>
            <th style={{ width: '64px' }}>4s</th>
            <th style={{ width: '64px' }}>6s</th>
            {isPairs ? (
              <th style={{ width: '56px' }}>Out</th>
            ) : (
              <>
                <th style={{ width: '48px' }}>NO</th>
                <th style={{ width: '52px' }} title="Times out (retired/re-batted)">
                  ×Out
                </th>
              </>
            )}
            <th style={{ width: '52px' }}>DNB</th>
            <th style={{ width: '40px' }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const dnb = !!row.did_not_bat
            return (
              <tr key={i} style={dnb ? { opacity: 0.5 } : {}}>
                <td>
                  <input
                    list="player-list"
                    value={row.player_name}
                    onChange={(e) => onChange(i, 'player_name', e.target.value)}
                    placeholder="Name"
                  />
                </td>
                <td>
                  <input
                    value={row.how_out}
                    onChange={(e) => onChange(i, 'how_out', e.target.value)}
                    placeholder="b Smith / ct Jones b Smith"
                    disabled={dnb}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    value={dnb ? '' : row.runs}
                    onChange={(e) => onChange(i, 'runs', e.target.value)}
                    disabled={dnb}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    value={dnb ? '' : row.balls}
                    onChange={(e) => onChange(i, 'balls', e.target.value)}
                    disabled={dnb}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    value={dnb ? '' : row.fours}
                    onChange={(e) => onChange(i, 'fours', e.target.value)}
                    disabled={dnb}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    value={dnb ? '' : row.sixes}
                    onChange={(e) => onChange(i, 'sixes', e.target.value)}
                    disabled={dnb}
                  />
                </td>
                {isPairs ? (
                  <td>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      value={dnb ? '' : row.times_out}
                      onChange={(e) => onChange(i, 'times_out', e.target.value)}
                      disabled={dnb}
                    />
                  </td>
                ) : (
                  <>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={!dnb && !!row.not_out}
                        onChange={(e) => onChange(i, 'not_out', e.target.checked)}
                        disabled={dnb}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={dnb ? '' : row.times_out || ''}
                        onChange={(e) => onChange(i, 'times_out', e.target.value)}
                        disabled={dnb}
                        placeholder="0"
                      />
                    </td>
                  </>
                )}
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={dnb}
                    onChange={(e) => onChange(i, 'did_not_bat', e.target.checked)}
                  />
                </td>
                <td>
                  <button className="icon-btn danger" onClick={() => onRemove(i)}>
                    <X size={12} />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <button
        className="secondary"
        style={{ marginTop: '10px', fontSize: '0.85rem', padding: '6px 14px' }}
        onClick={onAdd}
      >
        + Add batter
      </button>
    </div>
  )
}

export function BowlingTable({ rows, onChange, onAdd, onRemove, playerNames }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <datalist id="player-list">
        {playerNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <table className="entry-table" style={{ minWidth: '680px' }}>
        <thead>
          <tr>
            <th style={{ width: '180px' }}>Player</th>
            <th style={{ width: '70px' }}>Overs</th>
            <th style={{ width: '64px' }}>M</th>
            <th style={{ width: '64px' }}>WM</th>
            <th style={{ width: '64px' }}>R</th>
            <th style={{ width: '64px' }}>W</th>
            <th style={{ width: '64px' }}>Wd</th>
            <th style={{ width: '64px' }}>NB</th>
            <th style={{ width: '40px' }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <input
                  list="player-list"
                  value={row.player_name}
                  onChange={(e) => onChange(i, 'player_name', e.target.value)}
                  placeholder="Name"
                />
              </td>
              <td>
                <input
                  value={row.overs}
                  onChange={(e) => onChange(i, 'overs', e.target.value)}
                  placeholder="4.3"
                />
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  value={row.maidens}
                  onChange={(e) => onChange(i, 'maidens', e.target.value)}
                />
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  value={row.wicket_maidens}
                  onChange={(e) => onChange(i, 'wicket_maidens', e.target.value)}
                />
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  value={row.runs}
                  onChange={(e) => onChange(i, 'runs', e.target.value)}
                />
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  value={row.wickets}
                  onChange={(e) => onChange(i, 'wickets', e.target.value)}
                />
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  value={row.wides}
                  onChange={(e) => onChange(i, 'wides', e.target.value)}
                />
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  value={row.no_balls}
                  onChange={(e) => onChange(i, 'no_balls', e.target.value)}
                />
              </td>
              <td>
                <button className="icon-btn danger" onClick={() => onRemove(i)}>
                  <X size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="secondary"
        style={{ marginTop: '10px', fontSize: '0.85rem', padding: '6px 14px' }}
        onClick={onAdd}
      >
        + Add bowler
      </button>
    </div>
  )
}

export function FieldingTable({ rows, onChange, onAdd, onRemove, playerNames }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <p style={{ fontSize: '0.82rem', color: 'var(--text2)', marginBottom: '0.75rem' }}>
        Record fielding contributions when WHCC bowls — catches, stumpings, and run outs credited to
        individual players.
      </p>
      <datalist id="player-list-field">
        {playerNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <table className="entry-table" style={{ minWidth: '420px' }}>
        <thead>
          <tr>
            <th style={{ width: '180px' }}>Player</th>
            <th style={{ width: '80px' }}>Catches</th>
            <th style={{ width: '80px' }}>Stumpings</th>
            <th style={{ width: '80px' }}>Run outs</th>
            <th style={{ width: '40px' }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td>
                <input
                  list="player-list-field"
                  value={row.player_name}
                  onChange={(e) => onChange(i, 'player_name', e.target.value)}
                  placeholder="Name"
                />
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  value={row.catches}
                  onChange={(e) => onChange(i, 'catches', e.target.value)}
                />
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  value={row.stumpings}
                  onChange={(e) => onChange(i, 'stumpings', e.target.value)}
                />
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  value={row.run_outs}
                  onChange={(e) => onChange(i, 'run_outs', e.target.value)}
                />
              </td>
              <td>
                <button className="icon-btn danger" onClick={() => onRemove(i)}>
                  <X size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="secondary"
        style={{ marginTop: '10px', fontSize: '0.85rem', padding: '6px 14px' }}
        onClick={onAdd}
      >
        + Add fielder
      </button>
    </div>
  )
}
