import { describe, it, expect } from 'vitest'
import { srColor, fmtVal, fmtSR, fmtBonus, fmtBowlBase } from './mvpDisplay'

describe('srColor', () => {
  it('returns green when batSR > teamSR', () => {
    expect(srColor(120, 100)).toBe('var(--green)')
  })
  it('returns inherit when batSR <= teamSR', () => {
    expect(srColor(80, 100)).toBe('inherit')
    expect(srColor(100, 100)).toBe('inherit')
  })
  it('returns inherit when batSR is null', () => {
    expect(srColor(null, 100)).toBe('inherit')
  })
  it('returns inherit when teamSR is null', () => {
    expect(srColor(120, null)).toBe('inherit')
  })
  it('returns inherit when both null', () => {
    expect(srColor(null, null)).toBe('inherit')
  })
})

describe('fmtVal', () => {
  it('returns value when positive', () => {
    expect(fmtVal(5)).toBe(5)
    expect(fmtVal(0.5)).toBe(0.5)
  })
  it('returns em dash when zero', () => {
    expect(fmtVal(0)).toBe('—')
  })
  it('returns em dash when negative', () => {
    expect(fmtVal(-1)).toBe('—')
  })
})

describe('fmtSR', () => {
  it('returns value when not null', () => {
    expect(fmtSR(0)).toBe(0)
    expect(fmtSR(120)).toBe(120)
  })
  it('returns em dash when null', () => {
    expect(fmtSR(null)).toBe('—')
  })
  it('returns em dash when undefined', () => {
    expect(fmtSR(undefined)).toBe('—')
  })
})

describe('fmtBonus', () => {
  it('returns +N when positive', () => {
    expect(fmtBonus(0.5)).toBe('+0.5')
    expect(fmtBonus(1)).toBe('+1')
  })
  it('returns em dash when zero', () => {
    expect(fmtBonus(0)).toBe('—')
  })
  it('returns em dash when negative', () => {
    expect(fmtBonus(-1)).toBe('—')
  })
})

describe('fmtBowlBase', () => {
  it('returns base bowling score when bowl > 0', () => {
    expect(fmtBowlBase({ bowl: 5, bowlHaulBonus: 0.5, bowlMaidenBonus: 0.5 })).toBe(4)
  })
  it('rounds to 1 decimal', () => {
    expect(fmtBowlBase({ bowl: 5.1, bowlHaulBonus: 0.5, bowlMaidenBonus: 0.5 })).toBe(4.1)
  })
  it('returns em dash when bowl is 0', () => {
    expect(fmtBowlBase({ bowl: 0, bowlHaulBonus: 0, bowlMaidenBonus: 0 })).toBe('—')
  })
  it('returns em dash when bowl is negative', () => {
    expect(fmtBowlBase({ bowl: -1, bowlHaulBonus: 0, bowlMaidenBonus: 0 })).toBe('—')
  })
})
