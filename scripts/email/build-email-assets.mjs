#!/usr/bin/env node
/**
 * Builds the images the transactional emails load (Paper "Anowa · Emails",
 * artboard E0). Run after changing the logo or the animation:
 *
 *   node scripts/email/build-email-assets.mjs
 *
 * Frames are drawn on a <canvas> in headless Chromium (Playwright, dev
 * dependency) from the outlined logo paths in components/brand/AnowaLogo.js,
 * so no font is needed and the output is the same on every machine. The GIF
 * is encoded with gifenc (dev dependency). Output: public/email/.
 *
 * Animation (1.6 s, plays once, holds on the last frame):
 *   0.00 s  coral dot appears, wordmark already in place
 *   0.15 s  the dot beats (a soft ring), the pulse line starts to draw
 *   1.15 s  the line is complete; the fish tail flicks once
 *   1.25 s  the line flashes lime
 *   1.60 s  settles white; the last frame is the full logo and holds
 *
 * Outlook for Windows shows only the first frame of a GIF, so the layout
 * serves it the static PNG (an `<!--[if mso]>` branch). Every other client
 * gets the GIF; its first frame (dot + wordmark on the header colour) is
 * still a recognisable logo for clients that do not animate.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import gifenc from 'gifenc'

const { GIFEncoder, applyPalette, quantize } = gifenc

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const outDir = path.join(root, 'public/email')

// Logo geometry from components/brand/AnowaLogo.js (single source of truth).
const logoSource = await readFile(path.join(root, 'components/brand/AnowaLogo.js'), 'utf8')
const WORDMARK = /const WORDMARK =\s*'([^']+)'/.exec(logoSource)?.[1]
if (!WORDMARK) throw new Error('Wordmark path not found in components/brand/AnowaLogo.js')

/** Header colours: default dark header, and the urgent (farm alert) red header. */
const VARIANTS = [
  { name: 'anowa-logo', bg: '#0B0D10' },
  { name: 'anowa-logo-urgent', bg: '#7F1D1D' },
]
/** Display size in the email header (CSS px); the lockup is 26 px tall like the Paper header mark. */
const W = 130
const H = 30
const FRAME_MS = 40
const DURATION_MS = 1600

const drawingCode = `
const WORDMARK = new Path2D(${JSON.stringify(WORDMARK)})
const PTS = [[14.5,34],[18,34],[23,19],[30,49],[36,27],[40,34],[46,34],[58,22],[58,46],[46,34]]
const clamp = (x) => Math.max(0, Math.min(1, x))
const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2)
const mix = (a, b, t) => {
  const pa = [1,3,5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1,3,5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return 'rgb(' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',') + ')'
}
window.drawFrame = (canvas, opts) => {
  const { t, scale, bg, lineColor, wordColor, transparent, markOnly, w, h } = opts
  canvas.width = w * scale
  canvas.height = h * scale
  const g = canvas.getContext('2d')
  g.setTransform(1, 0, 0, 1, 0, 0)
  if (transparent) g.clearRect(0, 0, canvas.width, canvas.height)
  else { g.fillStyle = bg; g.fillRect(0, 0, canvas.width, canvas.height) }
  // Lockup units: 100 units tall = 26 CSS px, inset 2 px.
  const u = (26 / 100) * scale
  g.translate(2 * scale, 2 * scale)
  g.scale(u, u)
  if (!markOnly) {
    g.save(); g.translate(198.52, 80.07); g.fillStyle = wordColor; g.fill(WORDMARK); g.restore()
  }
  g.translate(-1.41, -45.77)
  g.scale(2.817, 2.817)
  // Dot: appears small, beats once with a soft ring, settles at r = 4.
  const r = t < 200 ? 2.6 + 1.4 * ease(clamp(t / 200)) : 4
  const ring = clamp((t - 150) / 350)
  if (ring > 0 && ring < 1) {
    g.beginPath(); g.arc(4.5, 34, 4 + 3 * ring, 0, Math.PI * 2)
    g.fillStyle = 'rgba(242,160,123,' + (0.35 * (1 - ring)).toFixed(3) + ')'; g.fill()
  }
  g.beginPath(); g.arc(4.5, 34, r, 0, Math.PI * 2); g.fillStyle = '#F2A07B'; g.fill()
  // Tail flick between 1.15 s and 1.35 s.
  const f = clamp((t - 1150) / 200)
  const flick = Math.sin(f * Math.PI)
  const pts = PTS.map((p) => p.slice())
  pts[7][0] -= 3 * flick; pts[8][0] -= 3 * flick; pts[7][1] += 2 * flick; pts[8][1] -= 2 * flick
  // Line draws from 0.15 s to 1.15 s.
  const lens = []
  let total = 0
  for (let i = 1; i < pts.length; i++) { const d = Math.hypot(pts[i][0] - pts[i-1][0], pts[i][1] - pts[i-1][1]); lens.push(d); total += d }
  let left = total * ease(clamp((t - 150) / 1000))
  if (left <= 0) return
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length && left > 0; i++) {
    const k = Math.min(1, left / lens[i-1])
    g.lineTo(pts[i-1][0] + (pts[i][0] - pts[i-1][0]) * k, pts[i-1][1] + (pts[i][1] - pts[i-1][1]) * k)
    left -= lens[i-1]
  }
  // Lime flash: in by 1.30 s, back to the resting colour by 1.60 s.
  const lime = t < 1250 ? 0 : t < 1300 ? (t - 1250) / 50 : 1 - clamp((t - 1300) / 300)
  g.strokeStyle = mix(lineColor, '#D7F75B', lime)
  g.lineWidth = 5.5; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke()
}
`

async function main() {
  await mkdir(outDir, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setContent('<canvas id="c"></canvas>')
  await page.addScriptTag({ content: drawingCode })

  const rgba = (opts) =>
    page.evaluate((o) => {
      const c = document.getElementById('c')
      window.drawFrame(c, o)
      return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data)
    }, opts)
  const png = async (opts) => {
    const url = await page.evaluate((o) => {
      const c = document.getElementById('c')
      window.drawFrame(c, o)
      return c.toDataURL('image/png')
    }, opts)
    return Buffer.from(url.split(',')[1], 'base64')
  }

  const written = []
  const save = async (file, bytes) => {
    await writeFile(path.join(outDir, file), bytes)
    written.push(`${file} ${(bytes.length / 1024).toFixed(1)} KB`)
  }

  for (const variant of VARIANTS) {
    const base = { bg: variant.bg, lineColor: '#FFFFFF', wordColor: '#FFFFFF', w: W, h: H }
    for (const scale of [1, 2]) {
      const gif = GIFEncoder()
      let prev = null
      const frames = []
      for (let t = 0; t <= DURATION_MS; t += FRAME_MS) {
        const data = await rgba({ ...base, t, scale })
        const key = data.join(',')
        if (prev && prev.key === key) {
          prev.delay += FRAME_MS
          continue
        }
        prev = { key, data, delay: FRAME_MS }
        frames.push(prev)
      }
      // One global palette from the key frames, plus a reserved transparent slot.
      // Later frames only carry the pixels that changed (the rest is transparent
      // and the previous frame stays: dispose 1), which keeps the file small.
      const sample = new Uint8ClampedArray(frames.reduce((n, fr) => n + fr.data.length, 0))
      let offset = 0
      for (const fr of frames) {
        sample.set(fr.data, offset)
        offset += fr.data.length
      }
      const palette = quantize(sample, 63)
      const TI = palette.length
      palette.push([255, 0, 255])
      let prevIndex = null
      frames.forEach((fr, n) => {
        const index = applyPalette(Uint8ClampedArray.from(fr.data), palette.slice(0, TI))
        const out = Uint8Array.from(index)
        if (prevIndex) for (let i = 0; i < out.length; i++) if (index[i] === prevIndex[i]) out[i] = TI
        prevIndex = index
        // repeat -1: no loop extension, so the GIF plays once and holds the last frame.
        gif.writeFrame(out, W * scale, H * scale, {
          palette: n === 0 ? palette : undefined,
          delay: fr.delay,
          repeat: -1,
          transparent: n > 0,
          transparentIndex: TI,
          dispose: 1,
        })
      })
      gif.finish()
      const suffix = scale === 2 ? '@2x' : ''
      await save(`${variant.name}${suffix}.gif`, Buffer.from(gif.bytes()))
      await save(`${variant.name}${suffix}.png`, await png({ ...base, t: DURATION_MS, scale }))
    }
  }

  // Footer mark (shown at 24 x 15 CSS px, grey, transparent background).
  await save(
    'anowa-mark-muted@2x.png',
    await png({ t: DURATION_MS, scale: 1, lineColor: '#6B7280', transparent: true, markOnly: true, w: 48, h: 30 }),
  )

  // Button arrows (14 CSS px glyph in a 32 px circle; the circle is a table cell).
  for (const [name, color] of [['arrow-light', '#FFFFFF'], ['arrow-dark', '#0B0D10']]) {
    const url = await page.evaluate((stroke) => {
      const c = document.createElement('canvas')
      c.width = 28; c.height = 28
      const g = c.getContext('2d')
      g.scale(28 / 24, 28 / 24)
      g.strokeStyle = stroke; g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round'
      g.stroke(new Path2D('M7 17L17 7M8 7h9v9'))
      return c.toDataURL('image/png')
    }, color)
    await save(`${name}@2x.png`, Buffer.from(url.split(',')[1], 'base64'))
  }

  await browser.close()
  console.log(written.join('\n'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
