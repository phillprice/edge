export function SortTh({ label, title, sortKey, activeSort, onSort, isName = false, style }) {
  const active = activeSort.key === sortKey
  const arrow = active ? (activeSort.dir === -1 ? ' ↓' : ' ↑') : ''
  const ariaSort = active ? (activeSort.dir === -1 ? 'descending' : 'ascending') : 'none'
  return (
    <th
      role="columnheader"
      aria-sort={ariaSort}
      tabIndex={0}
      className={isName ? 'sortable' : 'sortable num'}
      data-tooltip-id="pl-tip"
      data-tooltip-content={title || label}
      onClick={() => onSort(sortKey)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSort(sortKey)
        }
      }}
      style={{ whiteSpace: 'nowrap', ...style }}
    >
      {label}
      {arrow}
    </th>
  )
}
