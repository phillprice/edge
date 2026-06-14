'use strict'

const { escHtml } = require('./escHtml')

describe('escHtml', () => {
  it('escapes ampersands', () => {
    expect(escHtml('a & b')).toBe('a &amp; b')
  })

  it('escapes less-than', () => {
    expect(escHtml('<script>')).toBe('&lt;script&gt;')
  })

  it('escapes greater-than', () => {
    expect(escHtml('1 > 0')).toBe('1 &gt; 0')
  })

  it('escapes double quotes', () => {
    expect(escHtml('"hello"')).toBe('&quot;hello&quot;')
  })

  it('escapes single quotes', () => {
    expect(escHtml("it's")).toBe('it&#39;s')
  })

  it('escapes all special chars in one string', () => {
    expect(escHtml('<a href="foo\'s">bar & baz</a>')).toBe(
      '&lt;a href=&quot;foo&#39;s&quot;&gt;bar &amp; baz&lt;/a&gt;'
    )
  })

  it('returns empty string for null', () => {
    expect(escHtml(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(escHtml(undefined)).toBe('')
  })

  it('coerces numbers to string and escapes', () => {
    expect(escHtml(42)).toBe('42')
  })

  it('is a no-op for a safe string with no special chars', () => {
    expect(escHtml('Hello World')).toBe('Hello World')
  })

  it('returns empty string for empty string input', () => {
    expect(escHtml('')).toBe('')
  })

  it('handles multiple ampersands', () => {
    expect(escHtml('a & b & c')).toBe('a &amp; b &amp; c')
  })
})
