/**
 * Projects (Paper 20): pure rules shared by convex/projects.ts, the Anowa
 * project tools and the pages (budget %, milestone roll-up, at-risk, the
 * timeline geometry and the Anowa brief). No Convex imports, so the browser
 * can use it.
 */

export const PROJECT_LIMITS = {
  name: 120,
  note: 500,
  milestoneTitle: 160,
  milestonesPerProject: 100,
  costsPerProject: 2000,
  units: 200,
  maxAmount: 1e12,
  pageSize: 100,
} as const

export const PROJECT_STATUSES = ['planned', 'active', 'on_hold', 'done', 'cancelled'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

export const PROJECT_CATEGORIES = ['infrastructure', 'equipment', 'expansion', 'maintenance', 'certification', 'other'] as const
export type ProjectCategory = (typeof PROJECT_CATEGORIES)[number]

/** Statuses whose milestones and budget still need watching. */
export const OPEN_STATUSES: readonly ProjectStatus[] = ['planned', 'active', 'on_hold']

export const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))

/** Spent as a whole percentage of the budget, or null with no budget. */
export function budgetPct(spent: number, budget: number): number | null {
  if (!(budget > 0)) return null
  return Math.round((spent / budget) * 100)
}

/** How far over budget, in whole percent (23 for 123%); 0 when within. */
export function overBudgetPct(spent: number, budget: number): number {
  const pct = budgetPct(spent, budget)
  return pct != null && pct > 100 ? pct - 100 : 0
}

export function clampProgress(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, Math.round(n)))
}

type MilestoneLike = { dueDate: string; progressPct: number; open: boolean }

/** Totals the project row keeps from its milestones. */
export function rollupMilestones(milestones: readonly MilestoneLike[]) {
  const total = milestones.length
  const done = milestones.filter((m) => !m.open).length
  const progressPct = total ? Math.round(milestones.reduce((s, m) => s + (m.open ? clampProgress(m.progressPct) : 100), 0) / total) : 0
  const nextDueDate = milestones
    .filter((m) => m.open)
    .map((m) => m.dueDate)
    .sort()[0]
  return { milestonesTotal: total, milestonesDone: done, progressPct, nextDueDate }
}

type ProjectLike = {
  status: string
  spent: number
  budget: number
  nextDueDate?: string | null
  targetEndDate: string
}

/**
 * Why a project needs someone: over budget, a late milestone, or past its
 * target end while still open. Closed projects never need anyone.
 */
export function projectHealth(p: ProjectLike, today: string) {
  const open = (OPEN_STATUSES as readonly string[]).includes(p.status)
  const overBudget = p.budget > 0 && p.spent > p.budget
  const lateMilestone = open && !!p.nextDueDate && p.nextDueDate < today
  const pastEnd = open && p.targetEndDate < today
  return { overBudget, lateMilestone, pastEnd, atRisk: open && (overBudget || lateMilestone || pastEnd) }
}

/** Whole days from `from` to `to` (YYYY-MM-DD, UTC). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

function monthStart(iso: string, add = 0): string {
  const d = new Date(`${iso.slice(0, 7)}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + add)
  return d.toISOString().slice(0, 10)
}

/**
 * The timeline's months: one before today's month and `months - 1` from
 * it (Paper 20 shows Oct..Mar with Nov current). `offset` pages by months.
 */
export function timelineWindow(today: string, months = 6, offset = 0) {
  const first = monthStart(today, -1 + offset)
  const list = Array.from({ length: months }, (_, i) => monthStart(first, i))
  const end = monthStart(first, months)
  return { start: first, end, months: list, days: daysBetween(first, end) }
}

/**
 * A bar's left and width as percentages of the window, clipped to it; null
 * when the project does not overlap the window.
 */
export function barGeometry(startDate: string, endDate: string, win: { start: string; end: string; days: number }) {
  if (!isDate(startDate) || !isDate(endDate) || endDate < win.start || startDate >= win.end) return null
  const from = Math.max(0, daysBetween(win.start, startDate))
  const to = Math.min(win.days, daysBetween(win.start, endDate) + 1)
  if (to <= from) return null
  return {
    left: (from / win.days) * 100,
    width: ((to - from) / win.days) * 100,
    clippedStart: startDate < win.start,
    clippedEnd: daysBetween(win.start, endDate) + 1 > win.days,
  }
}

/** Where today sits in the window, as a percentage; null outside it. */
export function todayOffset(today: string, win: { start: string; end: string; days: number }) {
  if (today < win.start || today >= win.end) return null
  return ((daysBetween(win.start, today) + 0.5) / win.days) * 100
}

export type BriefInput = {
  overBudget: Array<{ id: string; name: string; spent: number; budget: number }>
  lateMilestones: Array<{ projectId: string; projectName: string; title: string; dueDate: string; progressPct: number }>
  dueSoon: Array<{ projectId: string; projectName: string; title: string; dueDate: string; progressPct: number }>
}

export type BriefItem =
  | { kind: 'over_budget'; projectId: string; name: string; pct: number }
  | { kind: 'late'; projectId: string; name: string; title: string; dueDate: string; progressPct: number }
  | { kind: 'due_soon'; projectId: string; name: string; title: string; dueDate: string; progressPct: number }

/**
 * The Anowa brief at the top of Projects: the projects that need someone,
 * worst first (over budget by most, then late milestones by oldest due,
 * then milestones due soon that are not nearly done). One item per project.
 */
export function projectBrief(input: BriefInput, max = 3): { count: number; items: BriefItem[] } {
  const items: BriefItem[] = []
  const seen = new Set<string>()
  const push = (id: string, item: BriefItem) => {
    if (seen.has(id)) return
    seen.add(id)
    items.push(item)
  }
  for (const p of [...input.overBudget].sort((a, b) => overBudgetPct(b.spent, b.budget) - overBudgetPct(a.spent, a.budget))) {
    push(p.id, { kind: 'over_budget', projectId: p.id, name: p.name, pct: overBudgetPct(p.spent, p.budget) })
  }
  for (const m of [...input.lateMilestones].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
    push(m.projectId, { kind: 'late', projectId: m.projectId, name: m.projectName, title: m.title, dueDate: m.dueDate, progressPct: m.progressPct })
  }
  for (const m of [...input.dueSoon].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) {
    if (m.progressPct >= 90) continue
    push(m.projectId, { kind: 'due_soon', projectId: m.projectId, name: m.projectName, title: m.title, dueDate: m.dueDate, progressPct: m.progressPct })
  }
  return { count: items.length, items: items.slice(0, max) }
}

/** Purchase order value: received figures once received, else ordered. */
export function purchaseOrderValue(lines: ReadonlyArray<{ quantityKg: number; pricePerKg: number; receivedKg?: number; receivedPricePerKg?: number }>, received: boolean) {
  const total = lines.reduce(
    (s, l) => s + (received && l.receivedKg != null ? l.receivedKg * (l.receivedPricePerKg ?? l.pricePerKg) : l.quantityKg * l.pricePerKg),
    0,
  )
  return Math.round(total * 100) / 100
}
