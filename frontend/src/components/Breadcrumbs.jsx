import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

export default function Breadcrumbs({ items }) {
  if (!items || items.length === 0) return null

  return (
    <nav style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
      {items.map((item, index) => (
        <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {item.href ? (
            <Link to={item.href} style={{ color: 'var(--accent)', textDecoration: 'none' }}>
              {item.label}
            </Link>
          ) : (
            <span style={{ color: 'var(--text2)' }}>{item.label}</span>
          )}
          {index < items.length - 1 && <ChevronRight size={14} style={{ color: 'var(--text3)' }} />}
        </div>
      ))}
    </nav>
  )
}
