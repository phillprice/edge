// Detect winter gaps between match series points and inject sentinel data for charts.

const MS_PER_DAY = 24 * 60 * 60 * 1000

function sortByDate(arr) {
  return [...arr].sort((a, b) => {
    if (!a.match_date_iso) return -1
    if (!b.match_date_iso) return 1
    return a.match_date_iso < b.match_date_iso ? -1 : 1
  })
}

// Returns gap descriptors for reference lines. Game-by-game: numeric midpoint between bars.
// Calendar: ISO midDate string to inject as a sentinel category for recharts.
export function findGaps(series, mode, minDays = 90) {
  const sorted = sortByDate(series)
  const gaps = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const curr = sorted[i]
    if (!prev.match_date_iso || !curr.match_date_iso) continue
    const prevMs = new Date(prev.match_date_iso).getTime()
    const currMs = new Date(curr.match_date_iso).getTime()
    if ((currMs - prevMs) / MS_PER_DAY >= minDays) {
      const midDate = new Date((prevMs + currMs) / 2).toISOString().slice(0, 10)
      gaps.push({
        xValue: mode === 'game' ? prev.idx + 0.5 : midDate,
        midDate,
        label: curr.match_date_iso.slice(0, 4)
      })
    }
  }
  return gaps
}

// For calendar mode, inserts a null-data sentinel at each gap's midpoint date so the
// category axis has the key and ReferenceLine can snap to it.
export function withGapSentinels(series, gaps) {
  if (!gaps.length) return series
  const sentinelDates = new Set(gaps.map((g) => g.midDate))
  const sorted = sortByDate(series)
  const result = []
  for (let i = 0; i < sorted.length; i++) {
    result.push(sorted[i])
    const a = sorted[i].match_date_iso
    const b = sorted[i + 1]?.match_date_iso
    if (!a || !b) continue
    const mid = new Date((new Date(a).getTime() + new Date(b).getTime()) / 2)
      .toISOString()
      .slice(0, 10)
    if (sentinelDates.has(mid)) result.push({ match_date_iso: mid, _gap: true })
  }
  return result
}
