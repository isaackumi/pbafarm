/**
 * The Anowa transactional emails (Paper "Anowa · Emails", E1 to E7). Each
 * function returns { subject, preheader, html, text } in the recipient's
 * language. They only show facts the caller passes: optional data (a
 * reading, steps, a good number) is left out rather than invented.
 *
 * Copy rules: plain, short, no em dashes. Approvals never carry a one-click
 * approve link: the button opens the app, which asks the reader to sign in.
 */
import { cleanSubject, cleanText, esc, oneLine } from './escape'
import {
  C,
  F,
  appUrl,
  avatar,
  button,
  buttonRow,
  codeBoxes,
  divider,
  ghostButton,
  headline,
  layout,
  linkAsText,
  noteBox,
  numbers,
  para,
  rich,
  richText,
  textPart,
  tiles,
  type Block,
  type Rich,
  type EmailContent,
  type EmailContext,
  type EmailLocale,
  type Footer,
} from './layout'

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const intl = (l: EmailLocale) => (l === 'fr' ? 'fr-FR' : 'en-GB')

export function fmtNum(x: number, l: EmailLocale, maxDp = 1): string {
  if (!Number.isFinite(x)) return ''
  return x.toLocaleString(l === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: maxDp })
}

/** "Fri 27 Nov" / "ven. 27 nov." from epoch ms or a YYYY-MM-DD date (UTC). */
export function fmtDay(value: number | string, l: EmailLocale, withWeekday = true): string {
  const d = typeof value === 'number' ? new Date(value) : new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString(intl(l), {
    timeZone: 'UTC',
    ...(withWeekday ? { weekday: 'short' } : {}),
    day: 'numeric',
    month: 'short',
  })
}

/** "16 to 22 Nov" / "16 au 22 nov." */
export function fmtRange(from: string, to: string, l: EmailLocale): string {
  const a = new Date(`${from}T12:00:00Z`)
  const b = new Date(`${to}T12:00:00Z`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return `${from} ${l === 'fr' ? 'au' : 'to'} ${to}`
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear()
  const left = sameMonth ? String(a.getUTCDate()) : fmtDay(from, l, false)
  return `${left} ${l === 'fr' ? 'au' : 'to'} ${fmtDay(to, l, false)}`
}

const firstName = (name: string | null | undefined) => oneLine(name ?? '', 60).split(' ')[0] ?? ''
const spacedCode = (code: string) => {
  const c = code.replace(/\s+/g, '')
  const half = Math.ceil(c.length / 2)
  return `${c.slice(0, half)} ${c.slice(half)}`
}

const manageLink = (ctx: EmailContext) => ({
  label: ctx.locale === 'fr' ? 'Choisir les e-mails que vous recevez' : 'Choose which emails you get',
  href: appUrl(ctx, '/notifications'),
})

function content(ctx: EmailContext, o: { subject: string; preheader: string; label: string; tone?: 'default' | 'urgent'; blocks: Block[]; text: Array<string | null | undefined | false>; footer: Footer }): EmailContent {
  const subject = cleanSubject(o.subject)
  const preheader = oneLine(o.preheader, 200)
  return {
    subject,
    preheader,
    html: layout(ctx, { subject, preheader, label: oneLine(o.label, 60), tone: o.tone, blocks: o.blocks, footer: o.footer }),
    text: textPart(ctx, o.text, o.footer),
  }
}

/** Multi-line user text as escaped HTML with <br>. */
const lines = (text: string) => esc(cleanText(text)).replace(/\n/g, '<br>')

// ---------------------------------------------------------------------------
// E1 Verification code
// ---------------------------------------------------------------------------

export type VerificationCodeData = { name?: string | null; code: string; minutes: number }

export function verificationCodeEmail(ctx: EmailContext, d: VerificationCodeData): EmailContent {
  const fr = ctx.locale === 'fr'
  const name = firstName(d.name)
  const code = oneLine(d.code, 12)
  const m = d.minutes
  const [lead, accent] = name
    ? [fr ? 'Voici votre code,' : "Here's your code,", `${name}.`]
    : [fr ? 'Voici votre' : "Here's your", fr ? 'code.' : 'code.']
  const intro = fr
    ? `Saisissez-le dans Anowa pour confirmer votre adresse e-mail. Il ne sert qu'une fois et expire dans ${m} minutes.`
    : `Type it in Anowa to confirm your email address. It works once and expires in ${m} minutes.`
  const codeLine = fr ? 'Votre code :' : 'Your code:'
  const ignore = fr
    ? "Vous n'avez rien demandé ? Ignorez cet e-mail ; rien ne change sans le code."
    : "Didn't ask for this? You can ignore it; nothing changes without the code."
  const footer: Footer = {
    kind: 'security',
    reason: fr
      ? "Vous recevez cet e-mail car quelqu'un a demandé à confirmer cette adresse pour un compte Anowa."
      : 'You got this because someone asked to confirm this address for an Anowa account.',
  }
  return content(ctx, {
    subject: fr ? 'Votre code de vérification Anowa' : 'Your Anowa verification code',
    preheader: fr
      ? `${spacedCode(code)} est votre code Anowa. Il expire dans ${m} minutes.`
      : `${spacedCode(code)} is your Anowa code. It expires in ${m} minutes.`,
    label: fr ? 'Code de vérification' : 'Verification code',
    blocks: [
      headline(lead, accent),
      para(intro),
      codeBoxes(code) + `<div style="height:12px;line-height:12px;font-size:12px">&nbsp;</div>` + para([`${codeLine} `, { code }], { size: 'small', muted: false }),
      divider(),
      para(ignore, { size: 'small' }),
    ],
    text: [`${lead} ${accent}`, intro, `${codeLine} ${code}`, ignore],
    footer,
  })
}

// ---------------------------------------------------------------------------
// E2 Password reset (the backend emails a code; the button opens the reset page)
// ---------------------------------------------------------------------------

export type PasswordResetData = { email: string; code: string; minutes: number }

export function passwordResetEmail(ctx: EmailContext, d: PasswordResetData): EmailContent {
  const fr = ctx.locale === 'fr'
  const code = oneLine(d.code, 12)
  const email = oneLine(d.email, 254)
  const m = d.minutes
  const url = appUrl(ctx, '/reset-password')
  const intro: Rich = fr
    ? ["Quelqu'un a demandé à réinitialiser le mot de passe de ", { strong: email }, `. Saisissez ce code sur la page de réinitialisation pour en choisir un nouveau. Il ne sert qu'une fois, pendant ${m} minutes.`]
    : ['Someone asked to reset the password for ', { strong: email }, `. Enter this code on the reset page to choose a new one. It works once, for ${m} minutes.`]
  const codeLine = fr ? 'Votre code :' : 'Your code:'
  const cta = fr ? 'Choisir un nouveau mot de passe' : 'Choose a new password'
  const ignore = fr
    ? "Vous n'avez rien demandé ? Ignorez cet e-mail : votre mot de passe ne change pas."
    : "Didn't ask for this? Ignore this email and your password stays the same."
  const footer: Footer = {
    kind: 'security',
    reason: fr
      ? "Vous recevez cet e-mail car quelqu'un a demandé à réinitialiser un mot de passe Anowa avec cette adresse."
      : 'You got this because someone asked to reset an Anowa password with this address.',
  }
  const [lead, accent] = fr ? ['On vous aide à', 'revenir.'] : ["Let's get you", 'back in.']
  return content(ctx, {
    subject: fr ? 'Réinitialisez votre mot de passe Anowa' : 'Reset your Anowa password',
    preheader: fr
      ? `Votre code de réinitialisation est ${spacedCode(code)}. Il ne sert qu'une fois, pendant ${m} minutes.`
      : `Your reset code is ${spacedCode(code)}. It works once, for ${m} minutes.`,
    label: fr ? 'Mot de passe' : 'Password reset',
    blocks: [
      headline(lead, accent),
      para(intro),
      codeBoxes(code) + `<div style="height:12px;line-height:12px;font-size:12px">&nbsp;</div>` + para([`${codeLine} `, { code }], { size: 'small', muted: false }),
      button(ctx, cta, url),
      linkAsText(ctx, url),
      divider(),
      para(ignore, { size: 'small' }),
    ],
    text: [`${lead} ${accent}`, richText(intro), `${codeLine} ${code}`, `${cta}: ${url}`, ignore],
    footer,
  })
}

// ---------------------------------------------------------------------------
// E3 Invitation
// ---------------------------------------------------------------------------

const ROLE_FR: Record<string, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  manager: 'Responsable',
  field_staff: 'Personnel de terrain',
  viewer: 'Lecteur',
}

export type InviteData = {
  inviterName: string
  orgName: string
  roleKey?: string
  roleLabel: string
  email: string
  /** Single-use token; the link is SITE_URL/invite/<token>. */
  token: string
  expiresAt: number
}

export function inviteEmail(ctx: EmailContext, d: InviteData): EmailContent {
  const fr = ctx.locale === 'fr'
  const inviter = oneLine(d.inviterName, 80) || (fr ? 'Un administrateur' : 'An admin')
  const org = oneLine(d.orgName, 120) || (fr ? 'une organisation' : 'an organization')
  const role = oneLine((fr && d.roleKey && ROLE_FR[d.roleKey]) || d.roleLabel, 60)
  const email = oneLine(d.email, 254)
  const url = appUrl(ctx, `/invite/${encodeURIComponent(d.token)}`)
  const expires = fmtDay(d.expiresAt, ctx.locale)
  const intro: Rich = fr
    ? ["Vous rejoindrez l'équipe en tant que ", { strong: role }, `. Acceptez pour ouvrir ${org} dans Anowa.`]
    : ["You'll join as ", { strong: role }, `. Accept to open ${org} in Anowa.`]
  const cta = fr ? "Accepter l'invitation" : 'Accept invitation'
  const note = fr
    ? `L'invitation ne sert qu'une fois et expire le ${expires}. Pas encore de compte ? Inscrivez-vous d'abord avec ${email}. Vous ne l'attendiez pas ? Ignorez cet e-mail.`
    : `The invitation works once and expires on ${expires}. No account yet? Sign up with ${email} first. Not expecting it? Ignore this email.`
  const [lead, accent] = fr ? [`Rejoignez ${org}`, 'sur Anowa.'] : [`Join ${org}`, 'on Anowa.']
  const invited = fr ? ' vous invite' : ' invited you'
  const hero =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td class="px" height="150" valign="bottom" bgcolor="#1562D6" style="height:150px;padding:0 36px 20px;background:#1562D6;background-image:linear-gradient(180deg,#0B3A7A 0%,#1562D6 55%,#7DB6F2 100%)">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.25);border-radius:999px;padding:10px 14px 10px 10px">` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle">${avatar(inviter, '#5B3A6B', 34)}</td>` +
    `<td valign="middle" style="padding-left:12px;font-family:${F.sans};font-size:14px;line-height:18px;color:#FFFFFF">${rich([{ strong: inviter }], '#FFFFFF')}${esc(invited)}</td></tr></table>` +
    `</td></tr></table></td></tr></table>`
  const footer: Footer = {
    kind: 'plain',
    reason: fr
      ? `${inviter} a envoyé cette invitation depuis ${org}. Si elle ne vous est pas destinée, ignorez-la.`
      : `${inviter} sent this invitation from ${org}. If it reached the wrong person, ignore it.`,
  }
  return content(ctx, {
    subject: fr ? `${inviter} vous invite à rejoindre ${org} sur Anowa` : `${inviter} invited you to ${org} on Anowa`,
    preheader: fr ? `${inviter} vous invite à rejoindre ${org} sur Anowa.` : `${inviter} invited you to ${org} on Anowa.`,
    label: 'Invitation',
    blocks: [
      { bleed: hero },
      `<div style="height:12px;line-height:12px;font-size:12px">&nbsp;</div>${headline(lead, accent)}`,
      para(intro),
      tiles([
        { label: fr ? 'Rôle' : 'Role', value: role },
        { label: fr ? 'Organisation' : 'Organization', value: org },
        { label: fr ? 'Expire le' : 'Expires', value: expires },
      ]),
      button(ctx, cta, url),
      linkAsText(ctx, url),
      para(note, { size: 'small' }),
    ],
    text: [`${inviter}${invited}.`, `${lead} ${accent}`, richText(intro), `${cta}: ${url}`, note],
    footer,
  })
}

// ---------------------------------------------------------------------------
// E4 Approval needed (sign-in required; no approve-by-link token)
// ---------------------------------------------------------------------------

export type ApprovalKind = 'stocking' | 'topup' | 'transfer' | 'join_request'

const APPROVAL_COPY: Record<EmailLocale, Record<ApprovalKind, { one: string; label: string; plural: string }>> = {
  en: {
    stocking: { one: 'One stocking', label: 'Stocking', plural: 'stockings' },
    topup: { one: 'One top-up', label: 'Top-up', plural: 'top-ups' },
    transfer: { one: 'One fish transfer', label: 'Fish transfer', plural: 'fish transfers' },
    join_request: { one: 'One join request', label: 'Join request', plural: 'join requests' },
  },
  fr: {
    stocking: { one: 'Un empoissonnement', label: 'Empoissonnement', plural: 'les empoissonnements' },
    topup: { one: 'Un complément', label: 'Complément', plural: 'les compléments' },
    transfer: { one: 'Un transfert de poissons', label: 'Transfert de poissons', plural: 'les transferts de poissons' },
    join_request: { one: "Une demande d'adhésion", label: "Demande d'adhésion", plural: "les demandes d'adhésion" },
  },
}

export type ApprovalData = {
  kind: ApprovalKind
  requesterName: string
  /** One-line description from the backend, e.g. "Stocking 20,000 fish into C-07". */
  summary: string
  orgName: string
  /** App page that lists the request (behind sign-in), e.g. "/approvals". */
  path: string
  /** Set on the escalation email. */
  waitedHours?: number
}

export function approvalEmail(ctx: EmailContext, d: ApprovalData): EmailContent {
  const fr = ctx.locale === 'fr'
  const k = APPROVAL_COPY[ctx.locale][d.kind] ?? APPROVAL_COPY[ctx.locale].stocking
  const who = oneLine(d.requesterName, 80) || (fr ? "Quelqu'un" : 'Someone')
  const summary = oneLine(d.summary, 200)
  const org = oneLine(d.orgName, 120)
  const url = appUrl(ctx, d.path || '/approvals')
  const late = d.waitedHours != null && d.waitedHours > 0
  const h = late ? fmtNum(d.waitedHours!, ctx.locale) : ''
  const accent = late ? (fr ? 'attend toujours.' : 'is still waiting.') : fr ? 'attend votre accord.' : 'needs your yes.'
  const intro = late
    ? fr
      ? `${who} a fait cette demande, en attente depuis plus de ${h} h. Rien ne change à la ferme tant que personne n'a décidé.`
      : `${who} asked for this and it has waited more than ${h} h. Nothing changes on the farm until someone decides.`
    : fr
      ? `${who} a fait cette demande. Rien ne change à la ferme tant que personne n'a décidé.`
      : `${who} asked for this. Nothing changes on the farm until someone decides.`
  const approve = fr ? 'Examiner et approuver' : 'Review and approve'
  const reject = fr ? 'Refuser' : 'Reject'
  const signIn = fr
    ? 'Il faudra vous connecter : un e-mail transféré ne peut rien approuver.'
    : "You'll be asked to sign in, so a forwarded email can't approve anything."
  const waiting = fr ? 'En attente' : 'Waiting'
  const card =
    `<table class="ghost" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${C.line};border-radius:18px;border-collapse:separate">` +
    `<tr><td class="tile" style="background:${C.tile};padding:14px 18px;border-radius:17px 17px 0 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td class="ink" style="font-family:${F.sans};font-size:14px;line-height:18px;font-weight:600;color:${C.ink}">${esc(k.label)}${org ? ` &middot; ${esc(org)}` : ''}</td>` +
    `<td align="right" style="white-space:nowrap"><span style="display:inline-block;background:#FEF3C7;border-radius:999px;padding:4px 10px;font-family:${F.sans};font-size:12px;line-height:16px;font-weight:600;color:#92400E">${esc(waiting)}</span></td>` +
    `</tr></table></td></tr>` +
    `<tr><td class="ink" style="padding:16px 18px;font-family:${F.sans};font-size:15px;line-height:22px;color:${C.ink}">${esc(summary)}</td></tr></table>`
  const footer: Footer = {
    kind: 'manage',
    reason: fr
      ? `Vous recevez cet e-mail car vous approuvez ${k.plural}${org ? ` chez ${org}` : ''}.`
      : `You got this because you approve ${k.plural}${org ? ` at ${org}` : ''}.`,
    links: [manageLink(ctx)],
  }
  return content(ctx, {
    subject: `${late ? (fr ? 'Toujours en attente' : 'Still waiting') : fr ? 'À approuver' : 'Needs your approval'}${fr ? ' : ' : ': '}${summary}`,
    preheader: late
      ? fr
        ? `${summary} attend depuis plus de ${h} h.`
        : `${summary} has waited more than ${h} h.`
      : fr
        ? `${summary} vous attend.`
        : `${summary} is waiting for you.`,
    label: late ? (fr ? 'Toujours en attente' : 'Still waiting') : fr ? 'À approuver' : 'Needs your approval',
    blocks: [
      headline(k.one, accent),
      para(intro),
      card,
      buttonRow([button(ctx, approve, url), ghostButton(ctx, reject, url)]),
      para(signIn, { size: 'small' }),
    ],
    text: [`${k.one} ${accent}`, intro, `${k.label}: ${summary}`, `${approve}: ${url}`, signIn],
    footer,
  })
}

// ---------------------------------------------------------------------------
// E5 Farm alert (urgent when level is "error")
// ---------------------------------------------------------------------------

export type AlertReading = {
  label: string
  value: number
  unit?: string
  limit: number
  direction: 'low' | 'high'
  /** Shown as given, e.g. "05:40" or "2026-11-20". */
  at?: string
}

export type AlertData = {
  title: string
  message: string
  level: 'info' | 'warning' | 'error'
  orgName: string
  /** Relative app path for the button. */
  path?: string
  unitName?: string
  reading?: AlertReading
  steps?: string[]
  /** e.g. "Kofi (keeper) was told on WhatsApp at 05:41." */
  keeperNote?: string
  /** Header label override for non-alert notifications. */
  label?: string
}

export function alertEmail(ctx: EmailContext, d: AlertData): EmailContent {
  const fr = ctx.locale === 'fr'
  const urgent = d.level === 'error'
  const title = oneLine(d.title, 200)
  const message = cleanText(d.message, 4000).trim()
  const org = oneLine(d.orgName, 120)
  const unit = oneLine(d.unitName ?? '', 60)
  const url = appUrl(ctx, d.path || '/alerts')
  const label =
    oneLine(d.label ?? '', 60) || (urgent ? `Urgent${unit ? ` · ${unit}` : ''}` : fr ? 'Alerte ferme' : 'Farm alert')
  const accent = urgent ? (fr ? 'Agissez maintenant.' : 'Act now.') : fr ? 'À vérifier.' : 'Take a look.'
  const cta = unit ? `${fr ? 'Ouvrir' : 'Open'} ${unit}` : fr ? 'Ouvrir dans Anowa' : 'Open in Anowa'
  const blocks: Block[] = []
  const text: string[] = []

  const r = d.reading
  if (r && Number.isFinite(r.value) && Number.isFinite(r.limit)) {
    const rUnit = oneLine(r.unit ?? '', 16)
    const caption = [oneLine(r.label, 60), unit, oneLine(r.at ?? '', 20)].filter(Boolean).join(' · ')
    const limitLine = fr
      ? `Votre seuil est ${fmtNum(r.limit, ctx.locale, 2)}${rUnit ? ` ${rUnit}` : ''} (${r.direction === 'low' ? 'minimum' : 'maximum'}).`
      : `Your limit is ${fmtNum(r.limit, ctx.locale, 2)}${rUnit ? ` ${rUnit}` : ''} (${r.direction === 'low' ? 'minimum' : 'maximum'}).`
    blocks.push({
      bleed:
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="px band" bgcolor="#FEF2F2" style="background:#FEF2F2;border-bottom:1px solid #FECACA;padding:28px 36px">` +
        `<div class="band-t" style="font-family:${F.mono};font-size:11px;line-height:14px;letter-spacing:0.08em;text-transform:uppercase;color:#B91C1C">${esc(caption)}</div>` +
        `<div class="big band-t" style="padding-top:6px;font-family:${F.display};font-size:54px;line-height:56px;font-weight:500;letter-spacing:-0.04em;color:#991B1B">${esc(fmtNum(r.value, ctx.locale, 2))}${rUnit ? ` <span style="font-size:22px;letter-spacing:0">${esc(rUnit)}</span>` : ''}</div>` +
        `<div class="band-t" style="padding-top:6px;font-family:${F.sans};font-size:13px;line-height:18px;color:#7F1D1D">${esc(limitLine)}</div>` +
        `</td></tr></table>`,
    })
    text.push(`${caption}: ${fmtNum(r.value, ctx.locale, 2)}${rUnit ? ` ${rUnit}` : ''}. ${limitLine}`)
  }

  blocks.push(headline(title, accent, 'md'))
  text.unshift(`${title} ${accent}`)
  if (message) {
    blocks.push(`<p class="body-t" style="margin:0;font-family:${F.sans};font-size:15px;line-height:24px;color:${C.body}">${lines(message)}</p>`)
    text.push(message)
  }
  const steps = (d.steps ?? []).map((s) => oneLine(s, 200)).filter(Boolean).slice(0, 5)
  if (steps.length) {
    const what = fr ? 'Que faire' : 'What to do'
    blocks.push(noteBox(what, steps.map((s, i) => `${i + 1}. ${esc(s)}`).join('<br>')))
    text.push(`${what}:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`)
  }
  const keeper = oneLine(d.keeperNote ?? '', 200)
  if (keeper) {
    blocks.push(para(keeper, { size: 'small', muted: false }))
    text.push(keeper)
  }
  blocks.push(button(ctx, cta, url, { inverse: urgent }))
  text.push(`${cta}: ${url}`)

  // The reading band sits flush under the header; the headline then needs its own top space.
  if (typeof blocks[0] !== 'string') blocks[1] = `<div style="height:6px;line-height:6px;font-size:6px">&nbsp;</div>${blocks[1]}`

  const footer: Footer = {
    kind: 'manage',
    reason: fr
      ? `Vous recevez cet e-mail car une alerte${org ? ` de ${org}` : ''} vous est envoyée par e-mail.`
      : `You got this because an alert${org ? ` at ${org}` : ''} is set to email you.`,
    links: [{ label: fr ? 'Réglages des alertes' : 'Alert settings', href: appUrl(ctx, '/notifications') }],
  }
  return content(ctx, {
    subject: title,
    preheader: oneLine(message.split('\n')[0] || title, 160),
    label,
    tone: urgent ? 'urgent' : 'default',
    blocks,
    text,
    footer,
  })
}

// ---------------------------------------------------------------------------
// E6 Weekly Anowa summary
// ---------------------------------------------------------------------------

export type WeeklyData = {
  orgName: string
  siteName?: string | null
  weekStart: string
  weekEnd: string
  /** Units read this week; the intro line is left out when 0. */
  units: number
  goodNumber?: { value: string; label: string; detail?: string } | null
  /** At most 3 are shown. */
  things: Array<{ lead: string; detail?: string }>
  /** The written report (and the costs part for finance readers). */
  report: string
  path?: string
}

export function weeklySummaryEmail(ctx: EmailContext, d: WeeklyData): EmailContent {
  const fr = ctx.locale === 'fr'
  const scope = oneLine(d.siteName || d.orgName, 120)
  const range = fmtRange(d.weekStart, d.weekEnd, ctx.locale)
  const things = d.things
    .map((t) => ({ lead: oneLine(t.lead, 160), detail: oneLine(t.detail ?? '', 240) }))
    .filter((t) => t.lead)
    .slice(0, 3)
  const good = d.goodNumber
    ? { value: oneLine(d.goodNumber.value, 20), label: oneLine(d.goodNumber.label, 120), detail: oneLine(d.goodNumber.detail ?? '', 200) }
    : null
  const [lead, accent] = things.length
    ? fr
      ? ['Votre semaine,', 'et ce qui vous attend.']
      : ['Your week,', 'and what needs you.']
    : fr
      ? ['Une semaine calme,', 'rien à signaler.']
      : ['A calm week,', 'all clear.']
  const unitsWord = (n: number) => (fr ? (n > 1 ? 'unités' : 'unité') : n === 1 ? 'unit' : 'units')
  const intro =
    d.units > 0
      ? fr
        ? `Anowa a lu les relevés de ${fmtNum(d.units, 'fr', 0)} ${unitsWord(d.units)} de ${scope} du ${range}.${things.length ? ` ${things.length === 1 ? 'Un point mérite' : `${things.length} points méritent`} votre attention.` : ''}`
        : `Anowa read the records of ${fmtNum(d.units, 'en', 0)} ${unitsWord(d.units)} at ${scope} from ${range}.${things.length ? ` ${things.length === 1 ? 'One thing is' : `${['', '', 'Two', 'Three'][things.length]} things are`} worth your time.` : ''}`
      : ''
  const question = fr
    ? `Comment s'est passée la semaine du ${range}, et par quoi commencer ?`
    : `How did the week of ${range} go, and what should I do first?`
  const askUrl = appUrl(ctx, `/assistant?q=${encodeURIComponent(question)}`)
  const reportUrl = appUrl(ctx, d.path || '/weekly-report')
  const ask = fr ? 'Demander à Anowa' : 'Ask Anowa about your week'
  const open = fr ? 'Ouvrir le rapport hebdomadaire' : 'Open the weekly report'
  const reportLabel = fr ? 'Le rapport' : 'The report'
  const report = cleanText(d.report, 6000).trim()

  const blocks: Block[] = [headline(lead, accent)]
  if (intro) blocks.push(para(intro))
  if (good) {
    blocks.push(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${C.ink}" style="background:${C.ink};border-radius:18px;padding:18px 20px">` +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
        `<td valign="middle" style="padding-right:16px;font-family:${F.display};font-size:44px;line-height:46px;font-weight:500;letter-spacing:-0.04em;color:${C.lime};white-space:nowrap">${esc(good.value)}</td>` +
        `<td valign="middle"><div style="font-family:${F.sans};font-size:14px;line-height:18px;font-weight:600;color:#FFFFFF">${esc(good.label)}</div>` +
        (good.detail ? `<div style="padding-top:3px;font-family:${F.sans};font-size:13px;line-height:18px;color:${C.faint}">${esc(good.detail)}</div>` : '') +
        `</td></tr></table></td></tr></table>`,
    )
  }
  if (things.length) {
    blocks.push(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
        things
          .map(
            (t, i) =>
              `<tr><td class="${i < things.length - 1 ? 'rule-b' : ''}" style="padding:14px 0;${i < things.length - 1 ? `border-bottom:1px solid ${C.rule};` : ''}">` +
              `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
              `<td width="34" valign="top" class="muted" style="width:34px;font-family:${F.num};font-size:13px;line-height:21px;color:${C.faint}">0${i + 1}</td>` +
              `<td valign="top" class="ink" style="font-family:${F.sans};font-size:14px;line-height:21px;color:${C.ink}"><strong style="font-weight:600">${esc(t.lead)}</strong>${t.detail ? ` <span class="body-t" style="color:${C.body}">${esc(t.detail)}</span>` : ''}</td>` +
              `</tr></table></td></tr>`,
          )
          .join('') +
        `</table>`,
    )
  }
  if (report) {
    blocks.push(
      `<div class="muted" style="font-family:${F.mono};font-size:11px;line-height:14px;letter-spacing:0.06em;text-transform:uppercase;color:${C.muted};padding-bottom:8px">${esc(reportLabel)}</div>` +
        `<p class="body-t" style="margin:0;font-family:${F.sans};font-size:14px;line-height:21px;color:${C.body}">${lines(report).replace(/(<br>){2,}/g, '<br><br>')}</p>`,
    )
  }
  blocks.push(button(ctx, ask, askUrl))
  blocks.push(
    `<p style="margin:0;font-family:${F.sans};font-size:13px;line-height:20px"><a class="link" href="${esc(reportUrl)}" target="_blank" rel="noopener" style="color:${C.link};text-decoration:none">${esc(open)}</a></p>`,
  )

  const footer: Footer = {
    kind: 'manage',
    reason: fr
      ? `Envoyé chaque lundi aux membres qui lisent les rapports de ${scope}.`
      : `Sent every Monday to members who read ${scope}'s reports.`,
    links: [manageLink(ctx)],
  }
  return content(ctx, {
    subject: fr ? `Rapport hebdomadaire : ${scope}, ${range}` : `Weekly report: ${scope}, ${range}`,
    preheader: things.length
      ? fr
        ? `${things.length} point${things.length > 1 ? 's' : ''} à regarder cette semaine${good ? ', et un bon chiffre' : ''}.`
        : `${things.length} thing${things.length > 1 ? 's' : ''} to look at this week${good ? ', and one good number' : ''}.`
      : fr
        ? 'Une semaine calme. Rien ne vous attend pour le moment.'
        : 'A calm week. Nothing needs you right now.',
    label: `${fr ? 'Votre semaine' : 'Your week'} · ${range}`,
    blocks,
    text: [
      `${lead} ${accent}`,
      intro,
      good && `${good.value}: ${good.label}${good.detail ? `. ${good.detail}` : ''}`,
      things.length > 0 && things.map((t, i) => `0${i + 1}. ${t.lead}${t.detail ? ` ${t.detail}` : ''}`).join('\n'),
      report && `${reportLabel}:\n${report}`,
      `${ask}: ${askUrl}`,
      `${open}: ${reportUrl}`,
    ],
    footer,
  })
}

// ---------------------------------------------------------------------------
// E7 Scheduled report with CSV
// ---------------------------------------------------------------------------

export type ScheduledReportData = {
  name: string
  datasetLabel: string
  period: { from: string; to: string } | { asOf: string }
  /** Up to 3 headline numbers, already formatted. */
  numbers: Array<{ label: string; value: string }>
  rows: number
  attachment: { filename: string; attached: boolean } | null
  notes: string[]
  /** Plain-text preview (text part only). */
  preview?: { columns: string[]; rows: string[][]; more: number }
  path: string
  ownerName?: string | null
  orgName: string
}

export function reportPeriodText(p: ScheduledReportData['period'], l: EmailLocale): string {
  if ('asOf' in p) return l === 'fr' ? `stock au ${fmtDay(p.asOf, l, false)}` : `stock on ${fmtDay(p.asOf, l, false)}`
  return l === 'fr' ? `du ${fmtRange(p.from, p.to, l)}` : fmtRange(p.from, p.to, l)
}

export function scheduledReportEmail(ctx: EmailContext, d: ScheduledReportData): EmailContent {
  const fr = ctx.locale === 'fr'
  const name = oneLine(d.name, 120) || (fr ? 'Rapport' : 'Report')
  const dataset = oneLine(d.datasetLabel, 80)
  const period = reportPeriodText(d.period, ctx.locale)
  const url = appUrl(ctx, d.path)
  const org = oneLine(d.orgName, 120)
  const owner = oneLine(d.ownerName ?? '', 80)
  const rowsText = fr ? `${fmtNum(d.rows, 'fr', 0)} ligne${d.rows > 1 ? 's' : ''}` : `${fmtNum(d.rows, 'en', 0)} row${d.rows === 1 ? '' : 's'}`
  const nums = d.numbers.slice(0, 3).map((n) => ({ label: oneLine(n.label, 40), value: oneLine(n.value, 24) }))
  const cta = fr ? 'Ouvrir le rapport complet' : 'Open the full report'
  const blocks: Block[] = [headline(`${name},`, `${period}.`)]
  const text: string[] = [`${name}, ${period}.`, `${dataset}.`]
  if (nums.length) {
    blocks.push(numbers(nums))
    text.push(nums.map((n) => `${n.label}: ${n.value}`).join('\n'))
  }
  if (d.rows === 0) {
    const none = fr ? 'Aucune donnée pour cette période.' : 'No data for this period.'
    blocks.push(para(none))
    text.push(none)
  } else if (d.attachment) {
    const file = oneLine(d.attachment.filename, 120)
    const sub = d.attachment.attached
      ? fr
        ? `Joint · ${rowsText} · s'ouvre dans Excel ou Sheets`
        : `Attached · ${rowsText} · opens in Excel or Sheets`
      : fr
        ? `Trop volumineux pour être joint · ${rowsText} · ouvrez le rapport dans Anowa`
        : `Too large to attach · ${rowsText} · open the report in Anowa`
    blocks.push(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="tile" style="background:${C.tile};border-radius:14px;padding:14px 16px">` +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
        `<td width="40" valign="middle" style="width:40px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="38" height="40" valign="bottom" align="center" style="width:38px;height:40px;background:#FFFFFF;border:1px solid ${C.line};border-radius:8px;padding-bottom:6px;font-family:${F.mono};font-size:10px;line-height:12px;color:#15803D">CSV</td></tr></table></td>` +
        `<td valign="middle" style="padding-left:14px"><div class="ink" style="font-family:${F.sans};font-size:14px;line-height:18px;font-weight:600;color:${C.ink};word-break:break-all">${esc(file)}</div>` +
        `<div class="muted" style="padding-top:2px;font-family:${F.sans};font-size:12px;line-height:16px;color:${C.muted}">${esc(sub)}</div></td>` +
        `</tr></table></td></tr></table>`,
    )
    text.push(`${file}: ${sub}`)
  }
  const notes = d.notes.map((n) => oneLine(n, 300)).filter(Boolean)
  if (notes.length) {
    blocks.push(para(notes.join(' '), { size: 'small' }))
    text.push(notes.join('\n'))
  }
  if (d.preview && d.preview.rows.length) {
    const p = d.preview
    const head = fr ? 'Aperçu :' : 'Preview:'
    const more = p.more > 0 ? (fr ? `… ${p.more} de plus dans la pièce jointe.` : `… ${p.more} more in the attachment.`) : ''
    text.push([head, p.columns.join(' | '), ...p.rows.map((r) => r.join(' | ')), more].filter(Boolean).join('\n'))
  }
  blocks.push(button(ctx, cta, url))
  text.push(`${cta}: ${url}`)
  const footer: Footer = {
    kind: 'manage',
    reason: fr
      ? `Envoyé par une planification de rapport${owner ? ` créée par ${owner}` : ''}${org ? ` chez ${org}` : ''}.`
      : `Sent by a report schedule${owner ? ` ${owner} set up` : ''}${org ? ` at ${org}` : ''}.`,
    links: [manageLink(ctx)],
  }
  return content(ctx, {
    subject: `${fr ? 'Rapport' : 'Report'}${fr ? ' : ' : ': '}${name} (${period})`,
    preheader: `${dataset}, ${period}. ${rowsText}${d.attachment?.attached ? (fr ? ', CSV joint' : ', CSV attached') : ''}.`,
    label: `${fr ? 'Rapport' : 'Report'} · ${name}`,
    blocks,
    text,
    footer,
  })
}
