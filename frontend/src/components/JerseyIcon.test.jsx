import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { jerseyInitials, JerseyIcon } from './JerseyIcon'

describe('jerseyInitials', () => {
  it('returns first+last initial for two-word name', () => {
    expect(jerseyInitials('Leo Brown')).toBe('LB')
  })

  it('returns first+last initial for multi-word name', () => {
    expect(jerseyInitials('Samuel James Lawrence')).toBe('SL')
  })

  it('returns single initial for one-word name', () => {
    expect(jerseyInitials('Ronaldo')).toBe('R')
  })

  it('returns empty string for null', () => {
    expect(jerseyInitials(null)).toBe('')
  })

  it('returns empty string for empty string', () => {
    expect(jerseyInitials('')).toBe('')
  })

  it('trims whitespace before splitting', () => {
    expect(jerseyInitials('  Leo Brown  ')).toBe('LB')
  })

  it('uppercases initials', () => {
    expect(jerseyInitials('leo brown')).toBe('LB')
  })
})

describe('JerseyIcon', () => {
  it('renders an SVG', () => {
    const { container } = render(<JerseyIcon initials="LB" />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('renders the initials text', () => {
    render(<JerseyIcon initials="LB" />)
    expect(screen.getByText('LB')).toBeTruthy()
  })

  it('uses default size of 30', () => {
    const { container } = render(<JerseyIcon initials="LB" />)
    const svg = container.querySelector('svg')
    expect(svg.getAttribute('width')).toBe('30')
    expect(svg.getAttribute('height')).toBe('30')
  })

  it('accepts custom size', () => {
    const { container } = render(<JerseyIcon size={48} initials="AB" />)
    const svg = container.querySelector('svg')
    expect(svg.getAttribute('width')).toBe('48')
  })
})
