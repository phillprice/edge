export function PlayerOptions({ players, blankLabel, dn = (x) => x }) {
  return (
    <>
      {blankLabel != null && <option value="">{blankLabel}</option>}
      {players.map((p) => (
        <option key={p.player_id} value={p.player_id}>
          {dn(p.name)}
        </option>
      ))}
    </>
  )
}

export function PlayerSelectField({ label, value, onChange, players, blankLabel, dn = (x) => x, style }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, ...style }}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <PlayerOptions players={players} blankLabel={blankLabel} dn={dn} />
      </select>
    </label>
  )
}
