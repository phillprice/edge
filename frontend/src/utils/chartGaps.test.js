import { describe, it, expect } from 'vitest'
import { findGaps, withGapSentinels } from './chartGaps'

const makePoint = (date, idx) => ({ match_date_iso: date, idx })

describe('findGaps', () => {
  it('finds no gaps when series is shorter than minDays', () => {
    const series = [makePoint('2024-04-01', 0), makePoint('2024-04-15', 1)]
    expect(findGaps(series, 'game', 90)).toEqual([])
  })

  it('finds a gap >= minDays', () => {
    const series = [makePoint('2024-04-01', 0), makePoint('2024-12-01', 1)]
    const gaps = findGaps(series, 'game', 90)
    expect(gaps).toHaveLength(1)
    expect(gaps[0].xValue).toBe(0.5)
    expect(gaps[0].label).toBe('2024')
  })

  it('uses midDate as xValue in calendar mode', () => {
    const series = [makePoint('2024-04-01', 0), makePoint('2024-12-01', 1)]
    const gaps = findGaps(series, 'calendar', 90)
    expect(gaps[0].xValue).toBe(gaps[0].midDate)
  })

  it('returns empty for empty series', () => {
    expect(findGaps([], 'game', 90)).toEqual([])
  })

  it('skips points without match_date_iso', () => {
    const series = [{ idx: 0 }, makePoint('2024-12-01', 1)]
    expect(findGaps(series, 'game', 90)).toEqual([])
  })

  it('sorts by date before detecting gaps', () => {
    const series = [makePoint('2024-12-01', 1), makePoint('2024-04-01', 0)]
    const gaps = findGaps(series, 'game', 90)
    expect(gaps).toHaveLength(1)
    expect(gaps[0].xValue).toBe(0.5)
  })
})

describe('withGapSentinels', () => {
  it('returns series unchanged when no gaps', () => {
    const series = [makePoint('2024-04-01', 0), makePoint('2024-04-15', 1)]
    expect(withGapSentinels(series, [])).toEqual(series)
  })

  it('inserts sentinel at gap midpoint', () => {
    const series = [makePoint('2024-04-01', 0), makePoint('2024-12-01', 1)]
    const gaps = findGaps(series, 'calendar', 90)
    const result = withGapSentinels(series, gaps)
    const sentinel = result.find((p) => p._gap)
    expect(sentinel).toBeDefined()
    expect(sentinel.match_date_iso).toBe(gaps[0].midDate)
  })

  it('does not insert sentinel when mid date does not match gap', () => {
    const series = [makePoint('2024-04-01', 0), makePoint('2024-04-15', 1)]
    const fakeGap = [{ midDate: '2025-01-01' }]
    const result = withGapSentinels(series, fakeGap)
    expect(result.every((p) => !p._gap)).toBe(true)
  })
})
