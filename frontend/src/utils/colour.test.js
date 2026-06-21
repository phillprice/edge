import { describe, it, expect } from 'vitest'
import { hexToRgb, relativeLuminance, contrastRatio, lightenForDark } from './colour'

describe('hexToRgb', () => {
  it('converts white', () => {
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255])
  })
  it('converts black', () => {
    expect(hexToRgb('#000000')).toEqual([0, 0, 0])
  })
  it('converts a colour', () => {
    expect(hexToRgb('#ff8000')).toEqual([255, 128, 0])
  })
})

describe('relativeLuminance', () => {
  it('white has luminance 1', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 4)
  })
  it('black has luminance 0', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 4)
  })
  it('mid-grey is between 0 and 1', () => {
    const L = relativeLuminance('#808080')
    expect(L).toBeGreaterThan(0)
    expect(L).toBeLessThan(1)
  })
})

describe('contrastRatio', () => {
  it('white on white has ratio ~1', () => {
    expect(contrastRatio('#ffffff')).toBeCloseTo(1, 1)
  })
  it('black has high ratio', () => {
    expect(contrastRatio('#000000')).toBeGreaterThan(20)
  })
})

describe('lightenForDark', () => {
  it('returns hex unchanged when already light enough', () => {
    expect(lightenForDark('#ffffff')).toBe('#ffffff')
  })
  it('returns input unchanged when null', () => {
    expect(lightenForDark(null)).toBe(null)
  })
  it('returns input unchanged when invalid', () => {
    expect(lightenForDark('not-a-colour')).toBe('not-a-colour')
  })
  it('lightens a dark colour to 55% lightness', () => {
    const result = lightenForDark('#000080')
    expect(result).toMatch(/^#[0-9a-f]{6}$/)
    expect(result).not.toBe('#000080')
  })
  it('returns light hex unchanged (luminance already >= 0.55)', () => {
    expect(lightenForDark('#e0e0e0')).toBe('#e0e0e0')
  })
  it('handles achromatic dark colour (grey)', () => {
    const result = lightenForDark('#333333')
    expect(result).toMatch(/^#[0-9a-f]{6}$/)
  })
})
