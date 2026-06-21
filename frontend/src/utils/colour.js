const HEX_RE = /^#[0-9a-fA-F]{6}$/

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function relativeLuminance(hex) {
  return hexToRgb(hex)
    .map((c) => {
      const s = c / 255
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    })
    .reduce((acc, c, i) => acc + c * [0.2126, 0.7152, 0.0722][i], 0)
}

export function contrastRatio(hex) {
  const L = relativeLuminance(hex)
  return (1 + 0.05) / (L + 0.05)
}

function rgbHue(r, g, b, max, min) {
  if (max === min) return 0
  const d = max - min
  if (max === r) return ((g - b) / d + (g < b ? 6 : 0)) / 6
  if (max === g) return ((b - r) / d + 2) / 6
  return ((r - g) / d + 4) / 6
}

export function lightenForDark(hex) {
  if (!hex || !HEX_RE.test(hex)) return hex
  const [r, g, b] = hexToRgb(hex)
  const max = Math.max(r, g, b) / 255
  const min = Math.min(r, g, b) / 255
  let l = (max + min) / 2
  if (l >= 0.55) return hex
  const s = max === min ? 0 : l < 0.5 ? (max - min) / (max + min) : (max - min) / (2 - max - min)
  const h = rgbHue(r, g, b, max, min)
  l = 0.55
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const h2r = (t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    return t < 1 / 6
      ? p + (q - p) * 6 * t
      : t < 0.5
        ? q
        : t < 2 / 3
          ? p + (q - p) * (2 / 3 - t) * 6
          : p
  }
  return `#${[h2r(h + 1 / 3), h2r(h), h2r(h - 1 / 3)]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}
