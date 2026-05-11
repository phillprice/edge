#!/usr/bin/env node
// Generates frontend/public/favicon.ico — a 16x16 maroon 3-bar chart icon
// Uses only Node.js built-ins, no external packages required.
// Run: node scripts/gen-favicon.js

const fs = require('fs')
const path = require('path')

const W = 16, H = 16
const MAROON = [0x28, 0x00, 0x69, 0xFF] // BGRA for #690028

// 16x16 pixel grid (row 0 = top)
const pixels = Array.from({ length: H }, () => Array(W).fill(null))

function drawBar(xStart, xEnd, yStart) {
  for (let x = xStart; x <= xEnd; x++)
    for (let y = yStart; y < H; y++)
      pixels[y][x] = MAROON
}

// Three bars: left (short), middle (tall), right (medium)
drawBar(2, 4,  9)  // left
drawBar(6, 9,  2)  // middle (tallest)
drawBar(11, 13, 5) // right

// Build 32bpp XOR pixel data (BMP = bottom-to-top row order)
const xorData = Buffer.alloc(W * H * 4, 0)
for (let y = 0; y < H; y++) {
  const bmpRow = H - 1 - y
  for (let x = 0; x < W; x++) {
    const px = pixels[y][x]
    if (!px) continue
    const off = (bmpRow * W + x) * 4
    xorData[off]     = px[0]
    xorData[off + 1] = px[1]
    xorData[off + 2] = px[2]
    xorData[off + 3] = px[3]
  }
}

// AND mask (all zeros = use alpha from XOR data)
const andRowBytes = Math.ceil(Math.ceil(W / 8) / 4) * 4
const andMask = Buffer.alloc(H * andRowBytes, 0)

// BITMAPINFOHEADER (40 bytes)
const bmpHdr = Buffer.alloc(40)
bmpHdr.writeUInt32LE(40, 0)
bmpHdr.writeInt32LE(W, 4)
bmpHdr.writeInt32LE(H * 2, 8)    // height doubled for ICO format
bmpHdr.writeUInt16LE(1, 12)
bmpHdr.writeUInt16LE(32, 14)
bmpHdr.writeUInt32LE(0, 16)
bmpHdr.writeUInt32LE(xorData.length + andMask.length, 20)
bmpHdr.writeUInt32LE(0, 24)
bmpHdr.writeUInt32LE(0, 28)
bmpHdr.writeUInt32LE(0, 32)
bmpHdr.writeUInt32LE(0, 36)

const bmpData = Buffer.concat([bmpHdr, xorData, andMask])

// ICO header (6 bytes) + directory entry (16 bytes)
const icoHdr = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00])
const dirEntry = Buffer.alloc(16)
dirEntry[0] = W
dirEntry[1] = H
dirEntry[2] = 0   // no palette
dirEntry[3] = 0   // reserved
dirEntry.writeUInt16LE(1, 4)               // planes
dirEntry.writeUInt16LE(32, 6)              // bpp
dirEntry.writeUInt32LE(bmpData.length, 8)  // image data size
dirEntry.writeUInt32LE(22, 12)             // image data offset (6 + 16)

const ico = Buffer.concat([icoHdr, dirEntry, bmpData])
const dest = path.join(__dirname, '..', 'frontend', 'public', 'favicon.ico')
fs.writeFileSync(dest, ico)
console.log(`Written ${ico.length} bytes → ${dest}`)
