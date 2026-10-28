import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const output = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const dark = [32, 49, 43]
const coral = [240, 120, 80]

function distanceToSegment(x, y, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - ax - t * dx, y - ay - t * dy)
}

function point(x, y, maskable) {
  const px = maskable ? (x - 32) / 0.68 + 32 : x
  const py = maskable ? (y - 32) / 0.68 + 32 : y
  const cornerX = Math.max(Math.abs(px - 32) - 14, 0)
  const cornerY = Math.max(Math.abs(py - 32) - 14, 0)
  const inside = Math.hypot(cornerX, cornerY) <= 18 && Math.abs(px - 32) <= 32 && Math.abs(py - 32) <= 32
  let rgb = dark
  let alpha = maskable || inside ? 1 : 0

  function paint(color, opacity) {
    const nextAlpha = opacity + alpha * (1 - opacity)
    rgb = color.map((channel, index) => (channel * opacity + rgb[index] * alpha * (1 - opacity)) / nextAlpha)
    alpha = nextAlpha
  }

  if (distanceToSegment(px, py, 17, 42, 28, 21) <= 3) paint(coral, 1)
  if (distanceToSegment(px, py, 29, 42, 40, 21) <= 3) paint(coral, 1)
  if (distanceToSegment(px, py, 41, 42, 52, 21) <= 3) paint(coral, 0.72)
  if (Math.hypot(px - 18, py - 48) <= 3) paint([255, 255, 255], 0.95)
  return [...rgb, alpha]
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let i = 0; i < 8; i++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function chunk(type, data) {
  const name = Buffer.from(type)
  const result = Buffer.alloc(12 + data.length)
  result.writeUInt32BE(data.length, 0)
  name.copy(result, 4)
  data.copy(result, 8)
  let crc = 0xffffffff
  for (const byte of Buffer.concat([name, data])) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4)
  return result
}

function render(size, maskable) {
  const raw = Buffer.alloc(size * (1 + size * 4))
  const samples = [0.125, 0.375, 0.625, 0.875]
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4)
    for (let x = 0; x < size; x++) {
      let red = 0; let green = 0; let blue = 0; let alpha = 0
      for (const sy of samples) for (const sx of samples) {
        const [r, g, b, a] = point((x + sx) * 64 / size, (y + sy) * 64 / size, maskable)
        red += r * a; green += g * a; blue += b * a; alpha += a
      }
      const offset = row + 1 + x * 4
      raw[offset] = alpha ? Math.round(red / alpha) : 0
      raw[offset + 1] = alpha ? Math.round(green / alpha) : 0
      raw[offset + 2] = alpha ? Math.round(blue / alpha) : 0
      raw[offset + 3] = Math.round(alpha * 255 / 16)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const [file, size, maskable] of [
  ['ridebridge-192.png', 192, false],
  ['ridebridge-512.png', 512, false],
  ['ridebridge-maskable-512.png', 512, true],
  ['ridebridge-touch-180.png', 180, true],
]) writeFileSync(join(output, file), render(size, maskable))
