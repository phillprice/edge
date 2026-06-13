export default function FilterPills({ label, options, value, onChange }) {
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
