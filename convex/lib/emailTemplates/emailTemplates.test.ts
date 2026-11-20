import { describe, expect, test } from 'vitest'
import {
  alertEmail,
  approvalEmail,
  cleanSubject,
  emailContext,
  emailLocale,
  inviteEmail,
  passwordResetEmail,
  safePath,
  scheduledReportEmail,
  verificationCodeEmail,
  weeklySummaryEmail,
  type EmailContent,
  type EmailContext,
} from '.'
import { EMAIL_SAMPLES } from './samples'
import { readingFromPayload, renderNotificationEmail } from '../notificationEmail'
import { weeklyEmailHighlights } from '../weeklyReport'

const ENV = { SITE_URL: 'https://app.getanowa.com', EMAIL_ASSET_BASE_URL: 'https://cdn.getanowa.com/' }
const en = emailContext('en', ENV)
const fr = emailContext('fr-FR', ENV)

/** Hostile value used for every dynamic string field. */
const EVIL = `<script>alert(1)</script>"'><img src=x onerror=alert(2)>\r\nBcc: victim@example.com`

/** Link targets (anchors and the Outlook VML button), not the font stylesheet. */
const hrefs = (html: string) =>
  [...html.matchAll(/<(?:a|v:roundrect)\b[^>]*\shref="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))
const srcs = (html: string) => [...html.matchAll(/src="([^"]*)"/g)].map((m) => m[1])

function expectSafe(mail: EmailContent) {
  expect(mail.html).not.toContain('<script')
  expect(mail.html).not.toMatch(/<img src=x/i)
  // Escaped text is inert; a real tag or attribute is not.
  expect(mail.html).not.toMatch(/<[^>]*onerror=/i)
  expect(mail.html).not.toContain(`"'>`)
  expect(mail.subject).not.toMatch(/[\r\n]/)
  expect(mail.preheader).not.toMatch(/[\r\n]/)
  expect(mail.text.length).toBeGreaterThan(20)
  expect(mail.text).not.toContain('<td')
  for (const h of hrefs(mail.html)) expect(h).toMatch(/^https?:\/\//)
}

/** Every template, with EVIL in each string field. */
const EVIL_RENDERS: Array<[string, (ctx: EmailContext) => EmailContent]> = [
  ['verification', (c) => verificationCodeEmail(c, { name: EVIL, code: '123456', minutes: 15 })],
  ['reset', (c) => passwordResetEmail(c, { email: EVIL, code: '12345678', minutes: 15 })],
  [
    'invite',
    (c) =>
      inviteEmail(c, { inviterName: EVIL, orgName: EVIL, roleKey: EVIL, roleLabel: EVIL, email: EVIL, token: EVIL, expiresAt: Date.UTC(2026, 10, 27) }),
  ],
  ['approval', (c) => approvalEmail(c, { kind: 'stocking', requesterName: EVIL, summary: EVIL, orgName: EVIL, path: EVIL })],
  [
    'alert',
    (c) =>
      alertEmail(c, {
        title: EVIL,
        message: EVIL,
        level: 'error',
        orgName: EVIL,
        path: EVIL,
        unitName: EVIL,
        reading: { label: EVIL, value: 3.1, unit: EVIL, limit: 4, direction: 'low', at: EVIL },
        steps: [EVIL, EVIL],
        keeperNote: EVIL,
        label: EVIL,
      }),
  ],
  [
    'weekly',
    (c) =>
      weeklySummaryEmail(c, {
        orgName: EVIL,
        siteName: EVIL,
        weekStart: EVIL,
        weekEnd: EVIL,
        units: 3,
        goodNumber: { value: EVIL, label: EVIL, detail: EVIL },
        things: [{ lead: EVIL, detail: EVIL }],
        report: EVIL,
        path: EVIL,
      }),
  ],
  [
    'report',
    (c) =>
      scheduledReportEmail(c, {
        name: EVIL,
        datasetLabel: EVIL,
        period: { from: EVIL, to: EVIL },
        numbers: [{ label: EVIL, value: EVIL }],
        rows: 2,
        attachment: { filename: EVIL, attached: true },
        notes: [EVIL],
        preview: { columns: [EVIL], rows: [[EVIL]], more: 0 },
        path: EVIL,
        ownerName: EVIL,
        orgName: EVIL,
      }),
  ],
]

describe('email templates', () => {
  test.each(EVIL_RENDERS)('%s escapes every dynamic field (en and fr)', (_name, render) => {
    for (const ctx of [en, fr]) {
      const mail = render(ctx)
      expectSafe(mail)
      expect(mail.html).toContain('&lt;script&gt;')
    }
  })

  test.each(EMAIL_SAMPLES.map((s) => [s.id, s] as const))('%s: layout, text part, French variant', (_id, sample) => {
    const a = sample.render(en)
    const b = sample.render(fr)
    for (const [mail, lang] of [[a, 'en'], [b, 'fr']] as const) {
      expect(mail.html.startsWith('<!doctype html>')).toBe(true)
      expect(mail.html).toContain(`<html lang="${lang}"`)
      expect(mail.html).toContain('<meta name="color-scheme" content="light dark">')
      expect(mail.html).toContain('role="presentation"')
      expect(mail.html).toContain('max-width:600px')
      expect(mail.html).toContain(mail.preheader.slice(0, 20).replace(/'/g, '&#39;'))
      // Images by absolute URL from EMAIL_ASSET_BASE_URL, never inline data.
      for (const src of srcs(mail.html)) expect(src.startsWith('https://cdn.getanowa.com/email/')).toBe(true)
      expect(mail.html).not.toContain('data:image')
      // Outlook gets the static PNG; everyone else the GIF.
      expect(mail.html).toMatch(/<!--\[if mso\]><img src="https:\/\/cdn\.getanowa\.com\/email\/anowa-logo(-urgent)?@2x\.png"/)
      expect(mail.html).toMatch(/anowa-logo(-urgent)?@2x\.gif/)
      // No em dashes in the copy.
      expect(mail.subject + mail.preheader + mail.text + mail.html).not.toContain('\u2014')
      expectSafe(mail)
    }
    // Alert subjects are the alert's own title; every other subject is translated.
    if (!sample.id.startsWith('e5')) expect(b.subject).not.toBe(a.subject)
    expect(b.html).not.toBe(a.html)
  })

  test('security emails say they cannot be turned off; others link to email settings', () => {
    for (const id of ['e1-verification-code', 'e2-password-reset']) {
      const s = EMAIL_SAMPLES.find((x) => x.id === id)!
      expect(s.render(en).html).toContain('Security emails can&#39;t be turned off.')
      expect(s.render(en).text).toContain("Security emails can't be turned off.")
      expect(s.render(fr).html).toContain('ne peuvent pas être désactivés')
      expect(s.render(en).html).not.toContain('/notifications')
    }
    for (const id of ['e4-approval', 'e5-alert-urgent', 'e6-weekly', 'e7-report']) {
      const s = EMAIL_SAMPLES.find((x) => x.id === id)!
      const mail = s.render(en)
      expect(mail.html).not.toContain('turned off')
      expect(hrefs(mail.html)).toContain('https://app.getanowa.com/notifications')
      expect(mail.text).toContain('https://app.getanowa.com/notifications')
    }
    const invite = EMAIL_SAMPLES.find((x) => x.id === 'e3-invite')!.render(en)
    expect(invite.html).toContain('If it reached the wrong person, ignore it.')
  })

  test('approval email needs sign-in: no approve-by-link token', () => {
    for (const ctx of [en, fr]) {
      for (const id of ['e4-approval', 'e4b-approval-escalated']) {
        const mail = EMAIL_SAMPLES.find((x) => x.id === id)!.render(ctx)
        const links = new Set(hrefs(mail.html))
        expect([...links].sort()).toEqual(
          [
            'https://app.getanowa.com/approvals',
            'https://app.getanowa.com/notifications',
            'https://app.getanowa.com/privacy',
            'https://app.getanowa.com/security',
            'https://getanowa.com',
          ].sort(),
        )
        expect(mail.html).not.toMatch(/token|approve\?|decision=|\/api\//i)
        expect(mail.text).not.toMatch(/token|approve\?|decision=/i)
      }
    }
    const en4 = EMAIL_SAMPLES.find((x) => x.id === 'e4-approval')!.render(en)
    expect(en4.html).toContain('a forwarded email can&#39;t approve anything')
  })

  test('codes are shown as boxes and as text; the reset link is also text', () => {
    const code = verificationCodeEmail(en, { name: 'Kwame Mensah', code: '482913', minutes: 15 })
    expect(code.html.match(/class="digit tile ink"/g)).toHaveLength(6)
    expect(code.html).toContain('font-family:\'Geist Mono\'')
    expect(code.text).toContain('Your code: 482913')
    expect(code.preheader).toBe('482 913 is your Anowa code. It expires in 15 minutes.')
    expect(code.html).toContain('Kwame.')
    const reset = passwordResetEmail(en, { email: 'a@b.co', code: '12345678', minutes: 15 })
    expect(reset.html.match(/class="digit-s tile ink"/g)).toHaveLength(8)
    expect(reset.text).toContain('12345678')
    expect(reset.html).toContain('>https://app.getanowa.com/reset-password</a>')
  })

  test('invite link is the single-use invite page; the token is URL-encoded', () => {
    const mail = inviteEmail(en, {
      inviterName: 'Ama Owusu',
      orgName: 'PBA Farm Ltd',
      roleLabel: 'Manager',
      email: 'k@x.co',
      token: 'ab/../c?d',
      expiresAt: Date.UTC(2026, 10, 27),
    })
    expect(hrefs(mail.html)).toContain('https://app.getanowa.com/invite/ab%2F..%2Fc%3Fd')
    expect(mail.subject).toBe('Ama Owusu invited you to PBA Farm Ltd on Anowa')
    expect(mail.html).toContain('Fri 27 Nov')
    const french = inviteEmail(fr, { inviterName: 'Ama', orgName: 'PBA', roleKey: 'field_staff', roleLabel: 'Field staff', email: 'k@x.co', token: 't', expiresAt: Date.UTC(2026, 10, 27) })
    expect(french.html).toContain('Personnel de terrain')
  })

  test('alert shows the reading only when the backend has it; urgent uses the red header', () => {
    const urgent = EMAIL_SAMPLES.find((x) => x.id === 'e5-alert-urgent')!.render(en)
    expect(urgent.html).toContain('bgcolor="#7F1D1D"')
    expect(urgent.html).toContain('anowa-logo-urgent@2x.gif')
    expect(urgent.html).toContain('Your limit is 4 mg/L (minimum).')
    expect(urgent.text).toContain('Dissolved oxygen · C-07 · 05:40: 3.1 mg/L')
    const plain = EMAIL_SAMPLES.find((x) => x.id === 'e5b-alert')!.render(en)
    expect(plain.html).not.toContain('#7F1D1D')
    expect(plain.html).not.toContain('Your limit')
    expect(plain.html).not.toContain('What to do')
  })

  test('weekly summary links to Ask Anowa with the question prefilled, not sent', () => {
    const mail = EMAIL_SAMPLES.find((x) => x.id === 'e6-weekly')!.render(en)
    const ask = hrefs(mail.html).find((h) => h.includes('/assistant'))!
    const url = new URL(ask)
    expect(url.pathname).toBe('/assistant')
    expect(url.searchParams.get('q')).toBe('How did the week of 16 to 22 Nov go, and what should I do first?')
    expect([...url.searchParams.keys()]).toEqual(['q'])
    expect(mail.html.match(/>0[1-3]</g)).toHaveLength(3)
    const calm = weeklySummaryEmail(en, { orgName: 'PBA', weekStart: '2026-11-16', weekEnd: '2026-11-22', units: 0, things: [], report: '' })
    expect(calm.html).toContain('all clear.')
    expect(calm.html).not.toContain('Anowa read the records')
  })

  test('report shows headline numbers and the attachment card', () => {
    const mail = EMAIL_SAMPLES.find((x) => x.id === 'e7-report')!.render(en)
    expect(mail.html).toContain('weekly-feed-use-2026-11-22.csv')
    expect(mail.html).toContain('Attached · 38 rows · opens in Excel or Sheets')
    expect(mail.html).toContain('9,840')
    expect(mail.text).toContain('A-01 | 260')
    expect(mail.subject).toBe('Report: Weekly feed use (16 to 22 Nov)')
  })

  test('helpers', () => {
    expect(cleanSubject('Hi\r\nBcc: x@y.z')).toBe('Hi Bcc: x@y.z')
    expect(cleanSubject('a\u2028b')).toBe('a b')
    expect(cleanSubject('x'.repeat(300))).toHaveLength(200)
    expect(safePath('//evil.com')).toBeNull()
    expect(safePath('javascript:alert(1)')).toBeNull()
    expect(safePath('/\\evil.com')).toBeNull()
    expect(safePath('/approvals')).toBe('/approvals')
    expect(emailLocale('fr-CA')).toBe('fr')
    expect(emailLocale(undefined)).toBe('en')
    expect(emailContext('en', { SITE_URL: 'javascript:alert(1)' }).siteUrl).toBe('http://localhost:3000')
    expect(emailContext('en', { SITE_URL: 'https://app.x/' }).assetBaseUrl).toBe('https://app.x')
  })
})

describe('notification emails', () => {
  test('picks the approval, weekly or alert template', () => {
    const base = { locale: 'en', orgName: 'PBA', env: ENV }
    const approval = renderNotificationEmail({
      ...base,
      source: 'approval.requested',
      email: { approval: { kind: 'stocking', requesterName: 'Kofi', summary: 'Stocking 10 fish into C-1' } },
      delivery: { subject: 'Stocking needs approval', body: 'Kofi: Stocking 10 fish into C-1.', link: '/approvals' },
    })
    expect(approval.subject).toBe('Needs your approval: Stocking 10 fish into C-1')
    const weekly = renderNotificationEmail({
      ...base,
      source: 'weekly_report',
      email: { weekly: { weekStart: '2026-11-16', weekEnd: '2026-11-22', units: 2, things: [] } },
      delivery: { subject: 'Weekly report', body: 'Fed 10 kg.' },
    })
    expect(weekly.html).toContain('Fed 10 kg.')
    const alert = renderNotificationEmail({
      ...base,
      source: 'farm_alert',
      email: { alert: { steps: ['Start the aerator.', 'Hold the feed.'] } },
      delivery: { subject: 'Low oxygen: C-07', body: 'DO is 3.1. Start the aerator.', level: 'error', link: '/cages/x', unitName: 'C-07' },
    })
    expect(alert.html).toContain('What to do')
    expect(alert.text).toContain('DO is 3.1.\n')
    expect(alert.html).toContain('Open C-07')
  })

  test('reading from a water breach payload', () => {
    expect(
      readingFromPayload({ unitName: 'C-07', breachLabel: 'Dissolved oxygen', breachValue: 3.1, breachLimit: 4, breachDirection: 'low', breachUnit: 'mg/L' }),
    ).toEqual({ unitName: 'C-07', reading: { label: 'Dissolved oxygen', value: 3.1, limit: 4, direction: 'low', unit: 'mg/L' } })
    expect(readingFromPayload({ unitName: 'C-07', breachValue: '3' })).toEqual({ unitName: 'C-07' })
    expect(readingFromPayload(null)).toEqual({})
  })

  test('weekly highlights use only pack facts', () => {
    const pack = {
      week: { units: 4, fcr: 1.38, gain_kg: 100, feed_vs_suggested_pct: 120 },
      previous: { fcr: 1.45 },
      units: [{ name: 'C-03', mortality: 412, feed_kg: 1, gain_kg: 1, fcr: null }],
      alerts: { raised: 1, critical: 1, open: 1, items: [{ unit: 'B-12', title: 'Low oxygen', severity: 'critical' }] },
    }
    const h = weeklyEmailHighlights(JSON.stringify(pack), 'en')!
    expect(h.goodNumber?.value).toBe('1.38')
    expect(h.things.map((t) => t.lead)).toEqual(['B-12: Low oxygen', 'C-03 lost 412 fish this week.', 'Feed was 120% of the suggested ration.'])
    const flat = weeklyEmailHighlights(JSON.stringify({ week: { units: 1, fcr: 1.5, gain_kg: 0 }, previous: { fcr: 1.4 } }), 'fr')!
    expect(flat.goodNumber).toBeUndefined()
    expect(flat.things).toEqual([])
    expect(weeklyEmailHighlights('nope', 'en')).toBeNull()
  })
})
