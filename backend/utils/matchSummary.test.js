'use strict'
const { _test: { shortName, fmtScore, resultEmoji } } = require('./matchSummary')

describe('shortName', () => {
  it('strips "Woking & Horsell Cricket Club -"', () => {
    expect(shortName('Woking & Horsell Cricket Club - Seniors')).toBe('Seniors')
  })
  it('strips "Woking & Horsell CC"', () => {
    expect(shortName('Woking & Horsell CC')).toBe('')
  })
  it('strips "Woking and Horsell CC"', () => {
    expect(shortName('Woking and Horsell CC')).toBe('')
  })
  it('leaves unrelated names unchanged', () => {
    expect(shortName('Epsom CC')).toBe('Epsom CC')
    expect(shortName('Weybridge Vandals')).toBe('Weybridge Vandals')
  })
  it('handles null', () => expect(shortName(null)).toBeNull())
  it('handles empty string', () => expect(shortName('')).toBe(''))
  it('collapses extra spaces after removal', () => {
    expect(shortName('Woking & Horsell CC  Whirlwinds')).toBe('Whirlwinds')
  })
})

describe('fmtScore', () => {
  it('formats score with wickets and overs', () => {
    expect(fmtScore(120, 4, '20.0')).toBe('120/4 (20.0 ov)')
  })
  it('formats score without wickets', () => {
    expect(fmtScore(80, null, '16.3')).toBe('80 (16.3 ov)')
  })
  it('returns null for null score', () => {
    expect(fmtScore(null, 4, '20.0')).toBeNull()
  })
  it('handles zero score', () => {
    expect(fmtScore(0, 0, '0.0')).toBe('0/0 (0.0 ov)')
  })
})

describe('resultEmoji', () => {
  it('returns ✅ when WHCC team won', () => {
    expect(resultEmoji('WHCC Whirlwinds won by 30 runs')).toBe('✅')
    expect(resultEmoji('Woking & Horsell won by 5 wickets')).toBe('✅')
    expect(resultEmoji('horsell CC won by 2 wickets')).toBe('✅')
    expect(resultEmoji('WHCC Hurricanes won by 10 runs')).toBe('✅')
  })
  it('returns ❌ when opposition won', () => {
    expect(resultEmoji('Epsom CC won by 20 runs')).toBe('❌')
    expect(resultEmoji('Weybridge won by 3 wickets')).toBe('❌')
  })
  it('returns ❌ for look-alike opposition clubs (#122 regression)', () => {
    // play-cricket result text names the WINNER; these are WHCC losses, not wins.
    expect(resultEmoji('Old Woking CC - Under 11 A - Won')).toBe('❌')
    expect(resultEmoji('Camberley CC - Girls Under 14 Lightning - Won')).toBe('❌')
    expect(resultEmoji('Horsley & Send CC - Under 10 Hurricanes - Won')).toBe('❌')
  })
  it('returns 🤝 for tie/draw/no result', () => {
    expect(resultEmoji('Tied')).toBe('🤝')
    expect(resultEmoji('Match drawn')).toBe('🤝')
    expect(resultEmoji('No result')).toBe('🤝')
  })
  it('returns ➖ for abandoned/other', () => {
    expect(resultEmoji('Match abandoned')).toBe('➖')
    expect(resultEmoji('')).toBe('➖')
    expect(resultEmoji(null)).toBe('➖')
  })
})
