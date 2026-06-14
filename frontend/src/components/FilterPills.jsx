// multiSelect: value is an array; clicking toggles membership; no "All" concept needed
export default function FilterPills({ label, options, value, onChange, multiSelect = false }) {
  if (multiSelect) {
    const active = Array.isArray(value) ? value : []
    function toggle(v) {
      onChange(active.includes(v) ? active.filter((x) => x !== v) : [...active, v])
    }
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.78rem', color: 'var(--text2)', marginRight: 2 }}>{label}</span>
        {options.map((o) => (
          <button
            key={o.value}
            className={active.includes(o.value) ? 'pill active' : 'pill'}
            onClick={() => toggle(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '0.78rem', color: 'var(--text2)', marginRight: 2 }}>{label}</span>
      {options.map((o) => (
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
