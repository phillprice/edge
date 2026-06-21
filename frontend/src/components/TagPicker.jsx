const TAG_LABELS = {
  league: 'League',
  cup: 'Cup',
  friendly: 'Friendly',
  indoor: 'Indoor',
  internal: 'Internal'
}

const ALL_TAGS = Object.keys(TAG_LABELS)

// Multi-select tag chip row. value is string[], onChange receives the new string[].
export default function TagPicker({ value = [], onChange, disabled = false }) {
  function toggle(tag) {
    const next = value.includes(tag) ? value.filter((t) => t !== tag) : [...value, tag]
    onChange(next)
  }
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {ALL_TAGS.map((tag) => (
        <button
          key={tag}
          type="button"
          disabled={disabled}
          className={value.includes(tag) ? 'pill active' : 'pill'}
          style={{ fontSize: '0.78rem', padding: '2px 10px' }}
          onClick={() => toggle(tag)}
        >
          {TAG_LABELS[tag]}
        </button>
      ))}
    </div>
  )
}

export { TAG_LABELS, ALL_TAGS }
