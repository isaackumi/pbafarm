// @vitest-environment node
/**
 * Writes every template (English and French) to a folder for visual checks:
 *   EMAIL_PREVIEW_DIR (default: <tmp>/anowa-email-previews)/<id>.<locale>.html
 * `npm run email:preview` runs this, then screenshots each file with
 * scripts/email/screenshot-emails.mjs (desktop 680 px and phone 375 px).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { emailContext } from '.'
import { EMAIL_SAMPLES } from './samples'

/** Placeholder asset host; the screenshot script serves public/email/ for it. */
const PREVIEW_ASSET_BASE = 'https://email-assets.test'

test('write template previews', () => {
  const dir = process.env.EMAIL_PREVIEW_DIR || join(tmpdir(), 'anowa-email-previews')
  mkdirSync(dir, { recursive: true })
  for (const locale of ['en', 'fr'] as const) {
    const ctx = emailContext(locale, { SITE_URL: 'https://app.getanowa.com', EMAIL_ASSET_BASE_URL: PREVIEW_ASSET_BASE })
    for (const s of EMAIL_SAMPLES) {
      const mail = s.render(ctx)
      // Gmail clips messages over ~102 KB of HTML.
      expect(new TextEncoder().encode(mail.html).length).toBeLessThan(60_000)
      writeFileSync(join(dir, `${s.id}.${locale}.html`), mail.html)
      writeFileSync(join(dir, `${s.id}.${locale}.txt`), `Subject: ${mail.subject}\nPreheader: ${mail.preheader}\n\n${mail.text}\n`)
    }
  }
})
