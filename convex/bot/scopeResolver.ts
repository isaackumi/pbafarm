/**
 * Where to pull the data from (VFQ-1): pure parsing of a chat message into a
 * site, a unit, "all sites" and a time range, and the decision to answer or
 * ask. No database here; summary.ts loads the sites and units in reach and
 * calls these. Everything returned is one of the candidates passed in, so a
 * scope can never leave the person's effective access.
 */

export type RangeKind = 'today' | 'yesterday' | 'this_week' | 'last_7_days' | 'this_month'

export type SiteLike<Id extends string = string> = { _id: Id; name: string; code?: string | null }
export type UnitLike<Id extends string = string, SiteId extends string = string> = {
  _id: Id
  name: string
  code?: string | null
  locationId?: SiteId
}

export type Resolved<S extends string = string, U extends string = string> = {
  sites: S[]
  units: U[]
  /** The text named a cage code ("c7") that matched nothing in reach. */
  unknownUnit: string | null
  all: boolean
  range: RangeKind | null
}

export type ScopeChoice<S extends string = string, U extends string = string> =
  | { kind: 'all' }
  | { kind: 'site'; siteId: S }
  | { kind: 'unit'; unitId: U }

export type Decision<S extends string = string, U extends string = string> =
  | { kind: 'answer'; scope: ScopeChoice<S, U>; range: RangeKind }
  | { kind: 'clarify'; range: RangeKind; sites: S[]; units: U[]; reason: 'none' | 'ambiguous' | 'unknown_unit' }

/** Words that say nothing about which site. */
const STOPWORDS = new Set([
  'site', 'sites', 'farm', 'farms', 'ferme', 'fermes', 'cage', 'cages', 'pond', 'ponds', 'tank', 'tanks', 'location',
  'locations', 'the', 'and', 'of', 'de', 'du', 'des', 'la', 'le', 'les', 'at', 'in', 'on', 'from', 'for', 'unit', 'units',
  'base', 'station', 'area', 'zone', 'main', 'new', 'old', 'fish', 'tilapia',
])

const SUMMARY = /\b(summary|summar(?:y|ise|ize)|report|overview|recap|status update|how (?:are|is|did) (?:we|it|things|the farm)|how(?:'s| is| are| was| did) [\w-]{1,30} (?:doing|going|looking|today|yesterday|this week|this month|last week)|how we(?:'| a)re doing|day done|résumé|resume|rapport|bilan|point du jour|comment (?:ça|ca) va)\b|^\/(?:summary|report|today)\b/i

const FOLLOW_UP = /^(?:and|what about|how about|same for|et|pour|et pour|and for)\b/i

const ALL = /\b(all (?:the )?(?:sites|farms|locations|cages)|every(?:where| site| farm| location)|whole farm|across (?:all|the farm)|tous les sites|toutes les fermes|partout|tous|all)\b/i

const RANGES: Array<[RangeKind, RegExp]> = [
  ['last_7_days', /\b(last|past) (?:7|seven) days\b|\b7 derniers jours\b|\bla semaine (?:passée|derniere|dernière)\b|\blast week\b/i],
  ['this_week', /\bthis week\b|\bcette semaine\b|\bweek(?:ly)?\b|\bsemaine\b/i],
  ['this_month', /\bthis month\b|\bce mois(?:-ci)?\b|\bmonth(?:ly)?\b|\bmois\b/i],
  ['yesterday', /\byesterday\b|\bhier\b|\blast night\b/i],
  ['today', /\btoday\b|\baujourd'?hui\b|\bthis morning\b|\bce matin\b|\btonight\b|\bday done\b/i],
]

export function isSummaryAsk(text: string): boolean {
  return SUMMARY.test(text.trim())
}

/** "and yesterday?", "what about offshore?" */
export function isFollowUp(text: string): boolean {
  return FOLLOW_UP.test(text.trim()) && text.trim().length <= 80
}

function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
}

function words(s: string): string[] {
  return fold(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/** The words of a site name or code that identify it. */
export function siteWords(site: { name: string; code?: string | null }): string[] {
  const w = new Set(words(site.name).filter((x) => x.length >= 3 && !STOPWORDS.has(x)))
  if (site.code) {
    const c = fold(site.code).replace(/[^a-z0-9]/g, '')
    if (c.length >= 2) w.add(c)
  }
  return [...w]
}

/** Levenshtein distance, stopping early above `max`. */
function within(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, cur[j])
    }
    if (best > max) return false
    prev = cur
  }
  return prev[b.length] <= max
}

/** Words of the question itself, never a site. */
const ASK_WORDS = new Set([
  'summary', 'summarise', 'summarize', 'report', 'overview', 'recap', 'today', 'yesterday', 'week', 'month', 'doing',
  'how', 'are', 'get', 'give', 'send', 'show', 'please', 'what', 'about', 'day', 'days', 'last', 'past', 'this',
  'resume', 'rapport', 'bilan', 'aujourd', 'hier', 'semaine', 'mois', 'everywhere', 'all', 'every',
])

function wordMatches(typed: string, key: string): boolean {
  if (ASK_WORDS.has(typed)) return false
  if (typed === key) return true
  if (STOPWORDS.has(typed) || typed.length < 4) return false
  // "offsh" → "offshore"; "lakeside" → "lake" does not count (key prefix of typed only when key is long).
  if (key.startsWith(typed)) return true
  if (key.length >= 5 && typed.startsWith(key)) return true
  return typed.length >= 5 && key.length >= 5 && within(typed, key, 1)
}

/** Sites named in the text (fuzzy, case- and accent-insensitive). */
export function matchSites<S extends SiteLike>(text: string, sites: S[]): S[] {
  const typed = words(text)
  if (!typed.length) return []
  const hits = sites.filter((s) => {
    const keys = siteWords(s)
    return keys.some((k) => typed.some((t) => wordMatches(t, k)))
  })
  // A full-name match beats a single-word one ("Lake Volta" vs "Volta Hatchery").
  if (hits.length > 1) {
    const f = ` ${words(text).join(' ')} `
    const full = hits.filter((s) => {
      const n = words(s.name).join(' ')
      return n.length > 0 && f.includes(` ${n} `)
    })
    if (full.length === 1) return full
  }
  return hits
}

/** Cage codes in the text: "C-07", "c7", "cage 7", "cage C07". Returns prefix (maybe empty) and number. */
export function unitRefs(text: string): Array<{ prefix: string; n: number; raw: string }> {
  const out: Array<{ prefix: string; n: number; raw: string }> = []
  const t = fold(text)
  const word = /\b(?:cage|pond|tank|unit|bassin|etang|unite)s?\s*(?:no\.?|#|number\s*)?\s*([a-z]{0,2})[\s-]?0*(\d{1,3})\b/g
  for (const m of t.matchAll(word)) out.push({ prefix: m[1] ?? '', n: Number(m[2]), raw: m[0].trim() })
  if (out.length) return out
  // "c7", "C-07", "c 7", "pd-3"; not "at 7", "a 7-day", "7am".
  const code = /\b(?:([a-z])[\s-]?|([a-z]{2})-?)0*(\d{1,3})\b/g
  for (const m of t.matchAll(code)) {
    const prefix = m[1] ?? m[2]
    if (/^(a|i|h|x|d|t|l|g)$/.test(prefix) && /\s/.test(m[0])) continue
    if (/^(am|pm|kg|mg|at|in|on|by|to|of|no|je|il|le|la|de|du)$/.test(prefix)) continue
    out.push({ prefix, n: Number(m[3]), raw: m[0].trim() })
  }
  return out
}

function codeParts(s: string): { prefix: string; n: number } | null {
  const m = /^([a-z]{0,3})[\s-]?0*(\d{1,4})$/.exec(fold(s).replace(/\b(cage|pond|tank|unit)\b/g, '').trim())
  return m ? { prefix: m[1], n: Number(m[2]) } : null
}

/** Units the text names by code or number ("c7" → C-07). */
export function matchUnits<U extends UnitLike>(text: string, units: U[]): { units: U[]; unknown: string | null } {
  const refs = unitRefs(text)
  if (!refs.length) return { units: [], unknown: null }
  const found = new Map<string, U>()
  let unknown: string | null = null
  for (const r of refs) {
    const hits = units.filter((u) =>
      [u.code, u.name].some((label) => {
        if (!label) return false
        const p = codeParts(label)
        return !!p && p.n === r.n && (!r.prefix || !p.prefix || p.prefix === r.prefix)
      }),
    )
    if (hits.length) for (const h of hits) found.set(h._id, h)
    else unknown ??= r.raw
  }
  return { units: [...found.values()], unknown }
}

export function matchRange(text: string): RangeKind | null {
  for (const [kind, re] of RANGES) if (re.test(text)) return kind
  return null
}

/** Pull site, unit, "all" and range out of a message. Only candidates passed in can come back. */
export function resolveScope<S extends string, U extends string>(
  text: string,
  sites: SiteLike<S>[],
  units: UnitLike<U, S>[],
): Resolved<S, U> {
  const range = matchRange(text)
  const u = matchUnits(text, units)
  // Unit codes are not site words: "c7" should not fuzzy-match a site coded "C".
  const withoutCodes = unitRefs(text).reduce((acc, r) => acc.replace(new RegExp(r.raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' '), fold(text))
  const sitesHit = matchSites(withoutCodes, sites).map((s) => s._id)
  // "all" alone in "summary for all" counts; inside "all sites" too.
  const all = ALL.test(text) && !sitesHit.length
  return { sites: sitesHit, units: u.units.map((x) => x._id), unknownUnit: u.unknown, all, range }
}

/**
 * Answer or ask. `remembered` is the person's last scope in this chat (about
 * 15 minutes). One site in reach needs no question.
 */
export function decide<S extends string, U extends string>(
  r: Resolved<S, U>,
  ctx: {
    sitesInReach: S[]
    units: UnitLike<U, S>[]
    remembered?: { scope?: ScopeChoice<S, U> | null; range?: RangeKind | null } | null
    defaultRange?: RangeKind
  },
): Decision<S, U> {
  const range = r.range ?? ctx.remembered?.range ?? ctx.defaultRange ?? 'today'
  let units = r.units
  if (units.length > 1 && r.sites.length) {
    const bySite = units.filter((id) => r.sites.includes(ctx.units.find((u) => u._id === id)?.locationId as S))
    if (bySite.length) units = bySite
  }
  if (units.length === 1) return { kind: 'answer', scope: { kind: 'unit', unitId: units[0] }, range }
  if (units.length > 1) return { kind: 'clarify', range, sites: [], units: units.slice(0, 8), reason: 'ambiguous' }
  if (r.unknownUnit) return { kind: 'clarify', range, sites: [], units: [], reason: 'unknown_unit' }
  if (r.sites.length === 1) return { kind: 'answer', scope: { kind: 'site', siteId: r.sites[0] }, range }
  if (r.sites.length > 1) return { kind: 'clarify', range, sites: r.sites.slice(0, 8), units: [], reason: 'ambiguous' }
  if (r.all) return { kind: 'answer', scope: { kind: 'all' }, range }
  const mem = ctx.remembered?.scope
  if (mem && (mem.kind !== 'site' || ctx.sitesInReach.includes(mem.siteId))) return { kind: 'answer', scope: mem, range }
  if (ctx.sitesInReach.length === 1) return { kind: 'answer', scope: { kind: 'site', siteId: ctx.sitesInReach[0] }, range }
  return { kind: 'clarify', range, sites: ctx.sitesInReach.slice(0, 8), units: [], reason: 'none' }
}

function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Farm dates (YYYY-MM-DD, inclusive) of a range, given today's farm date. Weeks start Monday. */
export function rangeDates(kind: RangeKind, today: string): { from: string; to: string } {
  switch (kind) {
    case 'today':
      return { from: today, to: today }
    case 'yesterday': {
      const y = shift(today, -1)
      return { from: y, to: y }
    }
    case 'last_7_days':
      return { from: shift(today, -6), to: today }
    case 'this_week': {
      const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7
      return { from: shift(today, -dow), to: today }
    }
    case 'this_month':
      return { from: `${today.slice(0, 7)}-01`, to: today }
  }
}
