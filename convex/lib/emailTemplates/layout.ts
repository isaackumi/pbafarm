/**
 * Shared shell of every Anowa email (Paper "Anowa · Emails", E1 to E7):
 * hidden preheader, dark header with the animated logo and a lime label
 * (E5: red header), a white rounded card, and a footer that says why the
 * reader got the email and how to stop it (security emails say they can't be
 * turned off).
 *
 * Email-client rules followed here: table layout with role="presentation",
 * inline styles (the <style> block only adds phone and dark-mode overrides),
 * 600 px max width, web-safe font fallbacks, bulletproof buttons with a VML
 * fallback for Outlook for Windows, images by absolute URL only.
 */
import { esc, safeHttpUrl, safePath } from './escape'

export type EmailLocale = 'en' | 'fr'

/** The recipient's language: French when their locale is French, else English. */
export function emailLocale(locale: string | null | undefined): EmailLocale {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

export type EmailEnv = {
  /** Public web app URL (SITE_URL), for links. */
  siteUrl: string
  /** Where public/email/* is served (EMAIL_ASSET_BASE_URL, default SITE_URL). */
  assetBaseUrl: string
}

const trimSlash = (s: string) => s.replace(/\/+$/, '')

export function emailEnv(env: Record<string, string | undefined> = process.env): EmailEnv {
  const siteUrl = trimSlash(safeHttpUrl(env.SITE_URL) ?? 'http://localhost:3000')
  const assetBaseUrl = trimSlash(safeHttpUrl(env.EMAIL_ASSET_BASE_URL) ?? siteUrl)
  return { siteUrl, assetBaseUrl }
}

export type EmailContext = EmailEnv & { locale: EmailLocale }

export function emailContext(
  locale: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): EmailContext {
  return { ...emailEnv(env), locale: emailLocale(locale) }
}

/** Absolute app link from a relative path; the app home when the path is unsafe. */
export function appUrl(ctx: EmailEnv, path: string | undefined | null): string {
  return `${ctx.siteUrl}${safePath(path) ?? '/'}`
}

export function assetUrl(ctx: EmailEnv, file: string): string {
  return `${ctx.assetBaseUrl}/email/${file}`
}

export type EmailContent = { subject: string; preheader: string; html: string; text: string }

// ---------------------------------------------------------------------------
// Palette and type (Paper values)
// ---------------------------------------------------------------------------

export const C = {
  page: '#EEF1F4',
  card: '#FFFFFF',
  line: '#E3E7EC',
  rule: '#EEF1F4',
  tile: '#F4F6F8',
  ink: '#0B0D10',
  body: '#4B5563',
  muted: '#6B7280',
  faint: '#9CA3AF',
  lime: '#D7F75B',
  link: '#2F86EA',
  urgentHeader: '#7F1D1D',
  urgentLabel: '#FECACA',
}

export const F = {
  sans: "Inter,'Helvetica Neue',Helvetica,Arial,sans-serif",
  display: "'Inter Tight',Inter,'Helvetica Neue',Helvetica,Arial,sans-serif",
  serif: "'Instrument Serif',Georgia,'Times New Roman',serif",
  mono: "'DM Mono','SFMono-Regular',Menlo,Consolas,'Courier New',monospace",
  num: "'Geist Mono','SFMono-Regular',Menlo,Consolas,'Courier New',monospace",
}

const FONTS_CSS =
  'https://fonts.googleapis.com/css2?family=DM+Mono&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@1&family=Inter+Tight:wght@500&family=Inter:wght@400;600&display=swap'

const CSS = `
body{margin:0!important;padding:0!important;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
table{mso-table-lspace:0pt;mso-table-rspace:0pt}
img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}
a{text-decoration:none}
a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
u+#body a{color:inherit;text-decoration:none}
@media only screen and (max-width:620px){
  .shell{padding:16px 8px!important}
  .px{padding-left:20px!important;padding-right:20px!important}
  .hdr{padding:20px!important}
  .h1{font-size:28px!important;line-height:32px!important}
  .h1 .serif{font-size:32px!important}
  .big{font-size:42px!important;line-height:46px!important}
  .col{display:block!important;width:100%!important;box-sizing:border-box}
  .col-gap{display:block!important;height:8px!important;width:100%!important}
  .digit{width:36px!important;height:52px!important;font-size:24px!important;line-height:52px!important;border-radius:10px!important}
  .digit-s{width:28px!important;height:46px!important;font-size:20px!important;line-height:46px!important;border-radius:8px!important}
  .dgap{width:4px!important}
  .hide-sm{display:none!important}
  .num-cell{padding:12px 10px!important}
  .num-v{font-size:17px!important;line-height:22px!important}
}
@media (prefers-color-scheme:dark){
  .bg-page{background:#0A0B0C!important}
  .card{background:#111315!important;border-color:#2A2E33!important}
  .ink{color:#F2F3F4!important}
  .body-t{color:#C9CDD2!important}
  .muted{color:#9AA0A6!important}
  .tile{background:#181A1D!important;border-color:#2A2E33!important}
  .rule{background:#2A2E33!important;border-color:#2A2E33!important}
  .link{color:#6AA8F5!important}
  .band{background:#2A1215!important;border-color:#5B1A1A!important}
  .band-t{color:#FCA5A5!important}
  .ghost{border-color:#2A2E33!important}
}
[data-ogsc] .bg-page{background:#0A0B0C!important}
[data-ogsc] .card{background:#111315!important}
[data-ogsc] .ink{color:#F2F3F4!important}
[data-ogsc] .body-t{color:#C9CDD2!important}
[data-ogsc] .tile{background:#181A1D!important}
`

// ---------------------------------------------------------------------------
// Building blocks. All take raw strings and escape them.
// ---------------------------------------------------------------------------

/** Rich text: plain strings, or `{ strong }` / `{ code }` segments. */
export type Rich = Array<string | { strong: string } | { code: string }>

export function rich(parts: Rich, strongColor = C.ink): string {
  return parts
    .map((p) =>
      typeof p === 'string'
        ? esc(p)
        : 'strong' in p
          ? `<strong class="ink" style="color:${strongColor};font-weight:600">${esc(p.strong)}</strong>`
          : `<span style="font-family:${F.num}">${esc(p.code)}</span>`,
    )
    .join('')
}

export const richText = (parts: Rich) => parts.map((p) => (typeof p === 'string' ? p : 'strong' in p ? p.strong : p.code)).join('')

export function headline(lead: string, accent: string, size: 'lg' | 'md' = 'lg'): string {
  const [fs, lh, as] = size === 'lg' ? [34, 38, 39] : [30, 34, 34]
  return (
    `<h1 class="h1 ink" style="margin:0;font-family:${F.display};font-size:${fs}px;line-height:${lh}px;font-weight:500;letter-spacing:-0.04em;color:${C.ink};mso-line-height-rule:exactly">` +
    `${esc(lead)}${accent ? ` <span class="serif" style="font-family:${F.serif};font-size:${as}px;font-style:italic;font-weight:400;letter-spacing:-0.01em;color:${C.muted}">${esc(accent)}</span>` : ''}</h1>`
  )
}

export function para(content: string | Rich, opts: { size?: 'body' | 'small' | 'tiny'; muted?: boolean } = {}): string {
  const html = typeof content === 'string' ? esc(content) : rich(content)
  const [fs, lh, color, cls] =
    opts.size === 'small'
      ? [13, 20, opts.muted === false ? C.body : C.muted, opts.muted === false ? 'body-t' : 'muted']
      : opts.size === 'tiny'
        ? [12, 18, C.faint, 'muted']
        : [15, 24, C.body, 'body-t']
  return `<p class="${cls}" style="margin:0;font-family:${F.sans};font-size:${fs}px;line-height:${lh}px;color:${color}">${html}</p>`
}

export function divider(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="rule" height="1" style="height:1px;line-height:1px;font-size:1px;background:${C.rule}">&nbsp;</td></tr></table>`
}

/** Pill button with the round arrow (Paper CTA). `inverse`: ink pill, lime circle (E5). */
export function button(ctx: EmailEnv, label: string, href: string, opts: { inverse?: boolean } = {}): string {
  const url = esc(safeHttpUrl(href) ?? ctx.siteUrl)
  const bg = opts.inverse ? C.ink : C.lime
  const fg = opts.inverse ? '#FFFFFF' : C.ink
  const circle = opts.inverse ? C.lime : C.ink
  const arrow = assetUrl(ctx, opts.inverse ? 'arrow-dark@2x.png' : 'arrow-light@2x.png')
  const width = Math.min(440, Math.round(label.length * 10.5 + 90))
  return (
    `<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:44px;v-text-anchor:middle;width:${width}px;" arcsize="50%" stroke="f" fillcolor="${bg}"><w:anchorlock/><center style="color:${fg};font-family:Arial,sans-serif;font-size:13px;letter-spacing:1px;text-transform:uppercase;">${esc(label)} &#8599;</center></v:roundrect><![endif]-->` +
    `<!--[if !mso]><!--><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${bg}" style="border-radius:999px;background:${bg}">` +
    `<a href="${url}" target="_blank" rel="noopener" style="display:block;padding:6px 6px 6px 22px;border-radius:999px;text-decoration:none;color:${fg}">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="font-family:${F.mono};font-size:13px;line-height:16px;letter-spacing:0.08em;text-transform:uppercase;color:${fg};padding-right:12px;white-space:nowrap">${esc(label)}</td>` +
    `<td width="32" height="32" align="center" valign="middle" bgcolor="${circle}" style="width:32px;height:32px;border-radius:999px;background:${circle};line-height:0"><img src="${esc(arrow)}" width="14" height="14" alt="" style="display:block;width:14px;height:14px;border:0"></td>` +
    `</tr></table></a></td></tr></table><!--<![endif]-->`
  )
}

/** Secondary outline pill (E4 "Reject"). */
export function ghostButton(ctx: EmailEnv, label: string, href: string): string {
  const url = esc(safeHttpUrl(href) ?? ctx.siteUrl)
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="ghost" style="border:1px solid ${C.line};border-radius:999px">` +
    `<a class="ink" href="${url}" target="_blank" rel="noopener" style="display:block;padding:13px 20px;font-family:${F.mono};font-size:12px;line-height:16px;letter-spacing:0.08em;text-transform:uppercase;color:${C.ink};text-decoration:none;white-space:nowrap">${esc(label)}</a>` +
    `</td></tr></table>`
  )
}

/** Buttons side by side (they wrap under each other on narrow screens). */
export function buttonRow(cells: string[]): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    cells.map((c, i) => `<td class="col" style="padding:${i ? '0 0 0 10px' : '0'};vertical-align:middle">${c}</td>`).join('') +
    `</tr></table>`
  )
}

/** "Button not working?" line with the full link as text. */
export function linkAsText(ctx: EmailContext, href: string): string {
  const url = safeHttpUrl(href) ?? ctx.siteUrl
  const lead = ctx.locale === 'fr' ? 'Le bouton ne marche pas ? Collez ce lien dans votre navigateur :' : 'Button not working? Paste this into your browser:'
  return `<p class="muted" style="margin:0;font-family:${F.sans};font-size:12px;line-height:18px;color:${C.faint}">${esc(lead)}<br><a class="link" href="${esc(url)}" target="_blank" rel="noopener" style="color:${C.link};text-decoration:none;word-break:break-all">${esc(url)}</a></p>`
}

/** One-time code as digit boxes (E1). Readers copy the code from the line under it. */
export function codeBoxes(code: string): string {
  const digits = code.replace(/\s+/g, '').split('')
  const small = digits.length > 6
  const cls = small ? 'digit-s' : 'digit'
  const [w, h, fs] = small ? [50, 64, 28] : [62, 72, 32]
  const half = Math.ceil(digits.length / 2)
  const cells: string[] = []
  digits.forEach((d, i) => {
    if (i === half) {
      cells.push(`<td class="dgap" width="8" style="width:8px">&nbsp;</td><td width="14" valign="middle" aria-hidden="true" style="width:14px"><div style="width:14px;height:3px;background:#D1D5DB;border-radius:2px;font-size:0;line-height:0">&nbsp;</div></td>`)
    }
    if (i > 0) cells.push(`<td class="dgap" width="8" style="width:8px;font-size:0;line-height:0">&nbsp;</td>`)
    cells.push(
      `<td class="${cls} tile ink" width="${w}" height="${h}" align="center" valign="middle" style="width:${w}px;height:${h}px;background:${C.tile};border:1px solid ${C.line};border-radius:14px;font-family:${F.num};font-size:${fs}px;line-height:${h}px;font-weight:500;color:${C.ink};text-align:center">${esc(d)}</td>`,
    )
  })
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" aria-hidden="true"><tr>${cells.join('')}</tr></table>`
}

/** Small grey tiles in a row (E3 role/site/cages). */
export function tiles(items: Array<{ label: string; value: string }>): string {
  const cells = items.map(
    (it, i) =>
      (i ? `<td class="col-gap" width="10" style="width:10px;font-size:0;line-height:0">&nbsp;</td>` : '') +
      `<td class="col tile" valign="top" style="background:${C.tile};border-radius:14px;padding:14px">` +
      `<div class="muted" style="font-family:${F.mono};font-size:11px;line-height:14px;letter-spacing:0.06em;text-transform:uppercase;color:${C.muted}">${esc(it.label)}</div>` +
      `<div class="ink" style="padding-top:4px;font-family:${F.sans};font-size:14px;line-height:18px;font-weight:600;color:${C.ink}">${esc(it.value)}</div></td>`,
  )
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells.join('')}</tr></table>`
}

/** Bordered row of headline numbers (E7). */
export function numbers(items: Array<{ label: string; value: string; tone?: 'good' | 'bad' }>): string {
  const cells = items.map((it, i) => {
    const color = it.tone === 'good' ? '#15803D' : it.tone === 'bad' ? '#B91C1C' : C.ink
    return (
      `<td class="num-cell" valign="top" style="padding:16px 18px;${i < items.length - 1 ? `border-right:1px solid ${C.rule};` : ''}">` +
      `<div class="muted" style="font-family:${F.sans};font-size:12px;line-height:16px;color:${C.muted}">${esc(it.label)}</div>` +
      `<div class="num-v${it.tone ? '' : ' ink'}" style="padding-top:4px;font-family:${F.num};font-size:22px;line-height:28px;color:${color}">${esc(it.value)}</div></td>`
    )
  })
  return `<table class="ghost" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line};border-radius:18px;border-collapse:separate"><tr>${cells.join('')}</tr></table>`
}

/** Grey box with an optional bold title (E5 "What to do", E2 notes). */
export function noteBox(title: string | null, body: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="tile" style="background:${C.tile};border-radius:16px;padding:16px 18px">` +
    (title ? `<div class="ink" style="font-family:${F.sans};font-size:13px;line-height:18px;font-weight:600;color:${C.ink};padding-bottom:10px">${esc(title)}</div>` : '') +
    `<div class="body-t" style="font-family:${F.sans};font-size:14px;line-height:21px;color:${C.body}">${body}</div></td></tr></table>`
  )
}

/** Initials avatar circle. */
export function avatar(name: string, bg: string, size = 28): string {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || 'A'
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="${size}" height="${size}" align="center" valign="middle" bgcolor="${bg}" style="width:${size}px;height:${size}px;border-radius:999px;background:${bg};font-family:${F.sans};font-size:${size > 30 ? 12 : 11}px;font-weight:600;line-height:${size}px;color:#FFFFFF;text-align:center">${esc(initials)}</td></tr></table>`
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** A body row: padded (default) or full-bleed (hero bands). */
export type Block = string | { bleed: string }

export type Footer =
  | { kind: 'security'; reason: string }
  | { kind: 'manage'; reason: string; links: Array<{ label: string; href: string }> }
  | { kind: 'plain'; reason: string }

const FOOTER_COPY = {
  en: {
    tagline: 'Anowa · calm farm operations for cage, pond and tank farms',
    privacy: 'Privacy',
    security: 'Security',
    cannotStop: "Security emails can't be turned off.",
  },
  fr: {
    tagline: 'Anowa · la gestion sereine des fermes en cages, étangs et bassins',
    privacy: 'Confidentialité',
    security: 'Sécurité',
    cannotStop: 'Les e-mails de sécurité ne peuvent pas être désactivés.',
  },
}

export function layout(
  ctx: EmailContext,
  opts: {
    subject: string
    preheader: string
    label: string
    tone?: 'default' | 'urgent'
    blocks: Block[]
    footer: Footer
  },
): string {
  const urgent = opts.tone === 'urgent'
  const headerBg = urgent ? C.urgentHeader : C.ink
  const labelColor = urgent ? C.urgentLabel : C.lime
  const logo = urgent ? 'anowa-logo-urgent' : 'anowa-logo'
  const copy = FOOTER_COPY[ctx.locale]

  const body = opts.blocks
    .map((b, i) => {
      const first = i === 0
      const last = i === opts.blocks.length - 1
      if (typeof b !== 'string') return `<tr><td style="padding:0 0 ${last ? 36 : 22}px">${b.bleed}</td></tr>`
      const top = first ? 40 : 0
      return `<tr><td class="px" style="padding:${top}px 36px ${last ? 36 : 22}px">${b}</td></tr>`
    })
    .join('')

  const footerLinks = (opts.footer.kind === 'manage' ? opts.footer.links : [])
    .map(
      (l) =>
        ` <a class="muted" href="${esc(safeHttpUrl(l.href) ?? ctx.siteUrl)}" target="_blank" rel="noopener" style="color:${C.faint};text-decoration:underline">${esc(l.label)}</a>.`,
    )
    .join('')
  const reason =
    esc(opts.footer.reason) + (opts.footer.kind === 'security' ? ` ${esc(copy.cannotStop)}` : '') + footerLinks

  const preheader = esc(opts.preheader)
  // Spacer characters stop clients from pulling body text into the preview.
  const pad = '&#847;&zwnj;&nbsp;'.repeat(60)

  return `<!doctype html>
<html lang="${ctx.locale}" dir="ltr" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(opts.subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>td,th,div,p,a,h1,span{font-family:Arial,sans-serif!important}.serif{font-family:Georgia,serif!important}</style><![endif]-->
<!--[if !mso]><!--><link href="${FONTS_CSS}" rel="stylesheet"><!--<![endif]-->
<style>${CSS}</style>
</head>
<body id="body" class="bg-page" style="margin:0;padding:0;background:${C.page}">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.page}">${preheader}${pad}</div>
<table role="presentation" class="bg-page" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.page}" style="background:${C.page}">
<tr><td class="shell" align="center" style="padding:32px 16px">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto">
<tr><td class="card" bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-radius:24px;overflow:hidden">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td class="hdr" bgcolor="${headerBg}" style="background:${headerBg};padding:24px 36px;border-radius:23px 23px 0 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="line-height:0"><!--[if mso]><img src="${esc(assetUrl(ctx, `${logo}@2x.png`))}" width="130" height="30" alt="Anowa" style="display:block;border:0"><![endif]--><!--[if !mso]><!--><img src="${esc(assetUrl(ctx, `${logo}@2x.gif`))}" width="130" height="30" alt="Anowa" style="display:block;width:130px;height:30px;border:0;color:#FFFFFF;font-family:${F.num};font-size:20px;line-height:30px"><!--<![endif]--></td>
<td valign="middle" align="right" style="font-family:${F.mono};font-size:11px;line-height:14px;letter-spacing:0.08em;text-transform:uppercase;color:${labelColor}">&bull; ${esc(opts.label)}</td>
</tr></table>
</td></tr>
${body}
</table>
</td></tr>
<tr><td align="center" style="padding:28px 24px 4px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="middle" style="padding-right:8px;line-height:0"><img src="${esc(assetUrl(ctx, 'anowa-mark-muted@2x.png'))}" width="24" height="15" alt="" style="display:block;width:24px;height:15px;border:0"></td>
<td valign="middle" class="muted" style="font-family:${F.sans};font-size:12px;line-height:16px;color:${C.muted}">${esc(copy.tagline)}</td>
</tr></table>
</td></tr>
<tr><td align="center" class="muted" style="padding:10px 24px 0;font-family:${F.sans};font-size:12px;line-height:16px;color:${C.faint}"><a class="muted" href="${esc(`${ctx.siteUrl}/privacy`)}" target="_blank" rel="noopener" style="color:${C.faint};text-decoration:none">${esc(copy.privacy)}</a> &middot; <a class="muted" href="${esc(`${ctx.siteUrl}/security`)}" target="_blank" rel="noopener" style="color:${C.faint};text-decoration:none">${esc(copy.security)}</a> &middot; <a class="muted" href="https://getanowa.com" target="_blank" rel="noopener" style="color:${C.faint};text-decoration:none">getanowa.com</a></td></tr>
<tr><td align="center" class="muted" style="padding:10px 24px 4px;font-family:${F.sans};font-size:11px;line-height:15px;color:${C.faint}">${reason}</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`
}

/** Plain-text part: blocks separated by blank lines, footer last. */
export function textPart(ctx: EmailContext, blocks: Array<string | null | undefined | false>, footer: Footer): string {
  const copy = FOOTER_COPY[ctx.locale]
  const foot = [
    footer.reason + (footer.kind === 'security' ? ` ${copy.cannotStop}` : ''),
    ...(footer.kind === 'manage' ? footer.links.map((l) => `${l.label}: ${l.href}`) : []),
    '',
    `Anowa · ${ctx.siteUrl}`,
  ]
  return [...blocks.filter((b): b is string => typeof b === 'string' && b.length > 0), '--', foot.join('\n')].join('\n\n')
}
