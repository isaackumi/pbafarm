#!/usr/bin/env node
/**
 * Screenshots the email previews written by
 * convex/lib/emailTemplates/previews.test.ts, at desktop (680 px) and phone
 * (375 px) widths, in light and dark colour schemes. Images load from
 * public/email/ (the previews point at a placeholder asset host).
 *
 *   npm run email:preview            # writes HTML, then screenshots
 *   EMAIL_PREVIEW_DIR=/some/dir npm run email:preview
 */
import { readdir, readFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const dir = process.env.EMAIL_PREVIEW_DIR || path.join(tmpdir(), 'anowa-email-previews')
const outDir = path.join(dir, 'screens')
const only = process.argv[2]

const files = (await readdir(dir)).filter((f) => f.endsWith('.html') && (!only || f.includes(only))).sort()
if (!files.length) throw new Error(`No previews in ${dir}; run the previews test first`)
await mkdir(outDir, { recursive: true })

const face = (family, file, extra = '') =>
  `@font-face{font-family:'${family}';src:url(https://email-assets.test/fonts/${file}) format('woff2');font-weight:100 900;${extra}}`
const FONT_CSS = [
  face('Inter', 'inter-latin-wght-normal.woff2'),
  face('Inter Tight', 'inter-tight-latin-wght-normal.woff2'),
  face('Instrument Serif', 'instrument-serif-latin-400-normal.woff2', 'font-style:italic;'),
  face('DM Mono', 'dm-mono-latin-400-normal.woff2'),
  face('Geist Mono', 'geist-mono-latin-wght-normal.woff2'),
].join('')

const browser = await chromium.launch()
for (const [label, width, scheme] of [
  ['desktop', 680, 'light'],
  ['phone', 375, 'light'],
  ['phone-dark', 375, 'dark'],
]) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme })
  await page.route('https://email-assets.test/**', async (route) => {
    const file = path.join(root, 'public', new URL(route.request().url()).pathname)
    await route.fulfill({ body: await readFile(file) })
  })
  // Offline and deterministic: the Google Fonts stylesheet is answered with the
  // app's own font files (public/fonts), same families as the email asks for.
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: FONT_CSS }))
  for (const f of files) {
    if (label === 'phone-dark' && !f.endsWith('.en.html')) continue
    await page.setContent(await readFile(path.join(dir, f), 'utf8'), { waitUntil: 'load' })
    // Let the logo GIF reach its last frame.
    await page.waitForTimeout(1800)
    await page.screenshot({ path: path.join(outDir, f.replace('.html', `.${label}.png`)), fullPage: true })
  }
  await page.close()
}
await browser.close()
console.log(`Screenshots in ${outDir}`)
