import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Skeleton, SkeletonRow } from './Skeleton'

describe('Skeleton', () => {
  it('renders a span element', () => {
    const { container } = render(<Skeleton />)
    expect(container.querySelector('span')).toBeTruthy()
  })

  it('applies default width and height', () => {
    const { container } = render(<Skeleton />)
    const span = container.querySelector('span')
    expect(span.style.width).toBe('100%')
    expect(span.style.height).toBe('1rem')
  })

  it('accepts custom width and height', () => {
    const { container } = render(<Skeleton width="8rem" height="2rem" />)
    const span = container.querySelector('span')
    expect(span.style.width).toBe('8rem')
    expect(span.style.height).toBe('2rem')
  })

  it('merges custom style prop', () => {
    const { container } = render(<Skeleton style={{ opacity: 0.5 }} />)
    const span = container.querySelector('span')
    expect(span.style.opacity).toBe('0.5')
  })
})

describe('SkeletonRow', () => {
  it('renders a table row with default 5 cells', () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonRow />
        </tbody>
      </table>
    )
    const cells = container.querySelectorAll('td')
    expect(cells.length).toBe(5)
  })

  it('renders correct number of cells when cols specified', () => {
    const { container } = render(
      <table>
        <tbody>
          <SkeletonRow cols={3} />
        </tbody>
      </table>
    )
    const cells = container.querySelectorAll('td')
    expect(cells.length).toBe(3)
  })
})
