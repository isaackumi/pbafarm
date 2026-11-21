import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { THEME_SCRIPT } from './themeScript.mjs'

describe('pre-paint theme script and the CSP', () => {
  it('is the only inline script in _document and is rendered from the shared module', () => {
    const doc = readFileSync(new URL('../pages/_document.js', import.meta.url), 'utf8')
    expect(doc).toContain("import { THEME_SCRIPT } from '../lib/themeScript.mjs'")
    expect(doc.match(/dangerouslySetInnerHTML/g)).toHaveLength(1)
    expect(doc).toContain('__html: THEME_SCRIPT')
  })

  it('is allowed in script-src by the hash of exactly this text', () => {
    const config = readFileSync(new URL('../next.config.mjs', import.meta.url), 'utf8')
    expect(config).toContain("createHash('sha256').update(THEME_SCRIPT).digest('base64')")
    expect(config).toMatch(/script-src 'self' \$\{THEME_SCRIPT_HASH\}/)
    const hash = createHash('sha256').update(THEME_SCRIPT).digest('base64')
    expect(hash).toMatch(/^[A-Za-z0-9+/]{43}=$/)
  })
})
