export function Skeleton({ width = '100%', height = '1rem', style }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width,
        height,
        borderRadius: '4px',
        background:
          'linear-gradient(90deg, var(--bg2, #2a2a2a) 25%, var(--bg3, #333) 50%, var(--bg2, #2a2a2a) 75%)',
        backgroundSize: '200% 100%',
        animation: 'skeleton-shimmer 1.4s infinite',
        verticalAlign: 'middle',
        ...style,
      }}
    />
  )
}

export function SkeletonRow({ cols = 5 }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i}>
          <Skeleton width={i === 0 ? '8rem' : '3rem'} />
        </td>
      ))}
    </tr>
  )
}
