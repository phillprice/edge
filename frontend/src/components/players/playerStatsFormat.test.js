import { dash, n0, heatRange, heatBg } from './playerStatsFormat'

describe('dash', () => {
  it('returns a dash for null, undefined and empty string', () => {
    expect(dash(null)).toBe('–')
    expect(dash(undefined)).toBe('–')
    expect(dash('')).toBe('–')
  })

  it('returns the value unchanged otherwise', () => {
    expect(dash(0)).toBe(0)
    expect(dash(42)).toBe(42)
    expect(dash('foo')).toBe('foo')
  })
})

describe('n0', () => {
  it('returns 0 for null or undefined', () => {
    expect(n0(null)).toBe(0)
    expect(n0(undefined)).toBe(0)
  })

  it('returns the value unchanged otherwise', () => {
    expect(n0(0)).toBe(0)
    expect(n0(15)).toBe(15)
  })
})

describe('heatRange', () => {
  it('returns null when fewer than two valid values exist', () => {
    expect(heatRange([{ runs: 10 }], 'runs')).toBeNull()
    expect(heatRange([{ runs: null }, { runs: undefined }], 'runs')).toBeNull()
  })

  it('returns null when all valid values are equal', () => {
    expect(heatRange([{ runs: 5 }, { runs: 5 }], 'runs')).toBeNull()
  })

  it('returns min/max for a spread of values, ignoring nulls', () => {
    expect(heatRange([{ runs: 5 }, { runs: null }, { runs: 20 }], 'runs')).toEqual({
      mn: 5,
      mx: 20
    })
  })
})

describe('heatBg', () => {
  const range = { mn: 0, mx: 100 }

  it('returns undefined when range is falsy', () => {
    expect(heatBg(50, null, false)).toBeUndefined()
  })

  it('returns undefined when value is null or empty', () => {
    expect(heatBg(null, range, false)).toBeUndefined()
    expect(heatBg('', range, false)).toBeUndefined()
  })

  it('returns undefined for the minimum value (t <= 0)', () => {
    expect(heatBg(0, range, false)).toBeUndefined()
  })

  it('returns a green rgba string scaled by t for positive metrics', () => {
    expect(heatBg(100, range, false)).toBe('rgba(76,175,80,0.45)')
    expect(heatBg(50, range, false)).toBe('rgba(76,175,80,0.225)')
  })

  it('returns an orange rgba string for negative metrics', () => {
    expect(heatBg(100, range, true)).toBe('rgba(255,167,38,0.45)')
  })
})
