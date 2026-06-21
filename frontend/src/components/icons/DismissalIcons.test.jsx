import { render, screen } from '@testing-library/react'
import { BowledPngIcon, CatchingIcon, LBWIcon, RunOutIcon, DISMISSAL_ICONS } from './DismissalIcons'

describe('DISMISSAL_ICONS map', () => {
  test('has all expected dismissal keys', () => {
    const keys = Object.keys(DISMISSAL_ICONS)
    expect(keys).toContain('Bowled')
    expect(keys).toContain('Caught')
    expect(keys).toContain('CaughtAndBowled')
    expect(keys).toContain('LBW')
    expect(keys).toContain('Run out')
    expect(keys).toContain('RunOut')
    expect(keys).toContain('Stumped')
    expect(keys).toContain('Retired')
  })

  test('Run out and RunOut map to the same component', () => {
    expect(DISMISSAL_ICONS['Run out']).toBe(DISMISSAL_ICONS['RunOut'])
  })

  test('all values are renderable React components', () => {
    for (const val of Object.values(DISMISSAL_ICONS)) {
      expect(val).toBeTruthy()
      expect(['function', 'object'].includes(typeof val)).toBe(true)
    }
  })
})

describe('BowledPngIcon', () => {
  test('renders img with alt "bowled"', () => {
    render(<BowledPngIcon />)
    expect(screen.getByAltText('bowled')).toBeInTheDocument()
  })

  test('applies custom size', () => {
    render(<BowledPngIcon size={24} />)
    const img = screen.getByAltText('bowled')
    expect(img).toHaveAttribute('width', '24')
    expect(img).toHaveAttribute('height', '24')
  })
})

describe('CatchingIcon', () => {
  test('renders img with alt "caught"', () => {
    render(<CatchingIcon />)
    expect(screen.getByAltText('caught')).toBeInTheDocument()
  })
})

describe('LBWIcon', () => {
  test('renders img with alt "lbw"', () => {
    render(<LBWIcon />)
    expect(screen.getByAltText('lbw')).toBeInTheDocument()
  })
})

describe('RunOutIcon', () => {
  test('renders img with alt "run out"', () => {
    render(<RunOutIcon />)
    expect(screen.getByAltText('run out')).toBeInTheDocument()
  })
})
