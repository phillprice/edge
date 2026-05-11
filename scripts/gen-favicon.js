#!/usr/bin/env node
// Generates frontend/public/favicon.ico (32x32) and apple-touch-icon.png (180x180)
// No external dependencies — uses only Node.js built-ins.
// Run: node scripts/gen-favicon.js

const fs   = require('fs')
const path = require('path')
const zlib = require('zlib')

const PUBLIC = path.join(__dirname, '..', 'frontend', 'public')
const MAROON = [0x69, 0x00, 0x28] // RGB #690028

// ─── shared bar-chart geometry ───────────────────────────────────────────────

function drawBars(W, H, setPixel) {
  const pad   = Math.round(W * 0.12)
  const barW  = Math.round(W * 0.17)
  const gap   = Math.round(W * 0.09)
  const bY    = H - pad - 1
  const totalW = barW * 3 + gap * 2
  const left  = Math.round((W - totalW) / 2)

  const bars = [
    { x: left,                    h: Math.round((H - pad * 2) * 0.50) },
    { x: left + barW + gap,       h: Math.round((H - pad * 2) * 1.00) },
    { x: left + (barW + gap) * 2, h: Math.round((H - pad * 2) * 0.72) },
  ]

  for (const bar of bars)
    for (let x = bar.x; x < bar.x + barW; x++)
      for (let y = bY - bar.h + 1; y <= bY; y++)
        setPixel(x, y)
}

// ─── favicon.ico (32×32, 32bpp BMP inside ICO) ───────────────────────────────

function makeFaviconIco() {
  const W = 32, H = 32
  const xorData = Buffer.alloc(W * H * 4, 0) // transparent by default

  drawBars(W, H, (x, y) => {
    const off = ((H - 1 - y) * W + x) * 4  // BMP is bottom-to-top
    xorData[off]     = MAROON[2]  // B
    xorData[off + 1] = MAROON[1]  // G
    xorData[off + 2] = MAROON[0]  // R
    xorData[off + 3] = 0xFF       // A = opaque
  })

  const andRowBytes = Math.ceil(Math.ceil(W / 8) / 4) * 4
  const andMask = Buffer.alloc(H * andRowBytes, 0)

  const bmpHdr = Buffer.alloc(40)
  bmpHdr.writeUInt32LE(40, 0)
  bmpHdr.writeInt32LE(W, 4)
  bmpHdr.writeInt32LE(H * 2, 8)  // doubled for ICO
  bmpHdr.writeUInt16LE(1, 12)
  bmpHdr.writeUInt16LE(32, 14)
  bmpHdr.writeUInt32LE(0, 16)
  bmpHdr.writeUInt32LE(xorData.length + andMask.length, 20)
  bmpHdr.fill(0, 24)

  const bmpData   = Buffer.concat([bmpHdr, xorData, andMask])
  const icoHdr    = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00])
  const dirEntry  = Buffer.alloc(16)
  dirEntry[0] = W; dirEntry[1] = H; dirEntry[2] = 0; dirEntry[3] = 0
  dirEntry.writeUInt16LE(1, 4)
  dirEntry.writeUInt16LE(32, 6)
  dirEntry.writeUInt32LE(bmpData.length, 8)
  dirEntry.writeUInt32LE(22, 12)  // offset = 6 + 16

  return Buffer.concat([icoHdr, dirEntry, bmpData])
}

// ─── apple-touch-icon.png (180×180, RGB PNG) ─────────────────────────────────

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
  crcTable[n] = c
}
function crc32(buf) {
  let crc = 0xFFFFFFFF
  for (const b of buf) crc = crcTable[(crc ^ b) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}
function pngChunk(type, data) {
  const lenBuf  = Buffer.alloc(4); lenBuf.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf  = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

function makeAppleTouchIcon() {
  const W = 180, H = 180
  const grid = Array.from({ length: H }, () => new Uint8Array(W))  // 1 = maroon

  drawBars(W, H, (x, y) => { if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = 1 })

  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(W, 0); ihdrData.writeUInt32BE(H, 4)
  ihdrData[8] = 8; ihdrData[9] = 2  // 8-bit RGB

  const rows = []
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 3)
    row[0] = 0  // filter: None
    for (let x = 0; x < W; x++) {
      const off = 1 + x * 3
      if (grid[y][x]) {
        row[off] = MAROON[0]; row[off + 1] = MAROON[1]; row[off + 2] = MAROON[2]
      } else {
        row[off] = 0xFF; row[off + 1] = 0xFF; row[off + 2] = 0xFF  // white bg
      }
    }
    rows.push(row)
  }

  const compressed = zlib.deflateSync(Buffer.concat(rows), { level: 9 })
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ─── write files ─────────────────────────────────────────────────────────────

const ico = makeFaviconIco()
fs.writeFileSync(path.join(PUBLIC, 'favicon.ico'), ico)
console.log(`favicon.ico      ${ico.length} bytes`)

const png = makeAppleTouchIcon()
fs.writeFileSync(path.join(PUBLIC, 'apple-touch-icon.png'), png)
console.log(`apple-touch-icon.png  ${png.length} bytes`)
