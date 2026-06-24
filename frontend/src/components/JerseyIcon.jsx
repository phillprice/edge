import { useContext } from 'react'
import { GroupContext } from '../GroupContext'

// Module-level fallback — set from App.jsx on config load so first renders
// before context is available still get the right mode.
let _jerseyDisplay = 'both'
export function setJerseyDisplay(mode) {
  if (mode) _jerseyDisplay = mode
}

export function jerseyInitials(name) {
  if (!name) return ''
  const words = name.trim().split(/\s+/)
  if (words.length === 1) return words[0][0].toUpperCase()
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}

function numFs(n, small) {
  if (n >= 100) return small ? 6 : 7
  if (n >= 10) return small ? 7.5 : 8
  return small ? 9 : 9.5
}

const JERSEY_CONTENT = {
  number_initials(initials, number, txt) {
    if (number == null) return txt(initials, 14, 9.5)
    return (
      <>
        {txt(initials, 11, 7)}
        {txt(String(number), 20, numFs(number, true))}
      </>
    )
  },
  number(_initials, number, txt) {
    if (number == null) return null
    return txt(String(number), 13, numFs(number, false))
  },
  initials(initials, _number, txt) {
    return txt(initials, 13, 9.5)
  },
  both(initials, number, txt) {
    const label = number != null ? String(number) : initials
    const fs = number != null ? numFs(number, false) : 9.5
    return txt(label, 13, fs)
  }
}

function buildJerseyContent(mode, initials, number, txt) {
  return (JERSEY_CONTENT[mode] || JERSEY_CONTENT.both)(initials, number, txt)
}

// mode values:
//   'both'            = number if set, else initials (default)
//   'number_initials' = initials on top, number below (both shown together)
//   'number'          = number if set, hidden if not
//   'initials'        = always initials
//   'none'            = hide entirely
export function JerseyIcon({
  size = 30,
  initials = '',
  number,
  mode: modeProp,
  opposition = false
}) {
  const ctx = useContext(GroupContext)
  const mode = modeProp || ctx?.jerseyDisplay || _jerseyDisplay

  if (mode === 'none') return null

  const body = (
    <path
      className={`jersey-body${opposition ? ' jersey-body--opp' : ''}`}
      fill="maroon"
      stroke="#333"
      strokeWidth="1"
      d="M12.0001719,26 C18.3392302,26 20.4524788,24.9573166 20.4524788,24.9573166 C20.4524788,24.9573166 19.7092149,21.2280258 19.7092149,17.2809108 C19.7092149,13.3334694 20.1740127,12.1942381 20.1740127,12.1942381 C20.1740127,12.1942381 21.086419,12.1664898 21.941757,11.976822 C23.1185343,11.7156615 24,11.1668979 24,11.1668979 C24,11.1668979 23.7648508,9.86501265 22.8631018,7.36995022 C21.961009,4.87488778 21.591096,4.16746919 20.4150062,3.57169673 C19.2385727,2.97592426 15.8038132,1.52354525 15.8038132,1.52354525 L15.0980218,0.443646454 C15.0980218,0.443646454 13.3938778,0 12.0001719,0 C10.6061222,0 8.9019782,0.443646454 8.9019782,0.443646454 L8.19618685,1.52354525 C8.19618685,1.52354525 4.76177107,2.97592426 3.58533755,3.57169673 C2.40890404,4.16746919 2.03933478,4.87488778 1.13724198,7.36995022 C0.235492974,9.86501265 0,11.1668979 0,11.1668979 C0,11.1668979 0.881809457,11.7156615 2.05858676,11.976822 C2.91392474,12.1664898 3.82598731,12.1942381 3.82598731,12.1942381 C3.82598731,12.1942381 4.29112891,13.3334694 4.29112891,17.2809108 C4.29112891,21.2280258 3.54786495,24.9573166 3.54786495,24.9573166 C3.54786495,24.9573166 5.66111358,26 12.0001719,26 Z"
    />
  )

  const txt = (label, y, fontSize) => (
    <text
      className="jersey-text"
      x="12"
      y={y}
      fontSize={fontSize}
      fontWeight="bold"
      fill="#ffffff"
      textAnchor="middle"
    >
      {label}
    </text>
  )

  const content = buildJerseyContent(mode, initials, number, txt)
  if (content === null) return null

  return (
    <svg
      viewBox="0 0 28 30"
      width={size}
      height={size}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      xmlns="http://www.w3.org/2000/svg"
    >
      <g transform="translate(1,1)">
        {body}
        {content}
      </g>
    </svg>
  )
}
