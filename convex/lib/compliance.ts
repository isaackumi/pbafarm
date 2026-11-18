/**
 * Compliance checklists (TRACE-006): due periods and the built-in templates.
 */
import type { MutationCtx } from '../_generated/server'
import type { Id } from '../_generated/dataModel'

export type Frequency = 'daily' | 'weekly' | 'monthly'

export const MAX_TEMPLATE_ITEMS = 50

/** ISO week of a YYYY-MM-DD date, as 2026-W47. */
export function isoWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  const day = d.getUTCDay() || 7
  // Thursday of this week decides the ISO year.
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/** The period a completion on `date` counts for. */
export function periodOf(frequency: Frequency, date: string): string {
  if (frequency === 'daily') return date
  if (frequency === 'weekly') return isoWeek(date)
  return date.slice(0, 7)
}

type TemplateSeed = {
  key: string
  name: string
  description: string
  frequency: Frequency
  items: string[]
}

export const DEFAULT_TEMPLATES: TemplateSeed[] = [
  {
    key: 'daily_biosecurity',
    name: 'Daily biosecurity check',
    description: 'Entry controls, dead fish removal and equipment hygiene at the site.',
    frequency: 'daily',
    items: [
      'Footbath and wheel dip refreshed at the site entrance',
      'Every visitor and vehicle entered in the biosecurity log',
      'Dead fish removed, counted and disposed of away from the water',
      'Nets, buckets and boats disinfected after use',
      'No sick or abnormally behaving fish seen (or reported to the manager)',
    ],
  },
  {
    key: 'weekly_net_inspection',
    name: 'Weekly net inspection',
    description: 'Physical check of every cage net and its moorings.',
    frequency: 'weekly',
    items: [
      'Nets checked for holes, tears and worn seams',
      'Predator and bird nets intact',
      'Mooring lines, anchors and buoys secure',
      'Collars and walkways sound',
      'Net fouling acceptable or cleaning scheduled',
      'Repairs needed are recorded',
    ],
  },
  {
    key: 'monthly_water_quality',
    name: 'Monthly water quality review',
    description: "Review of the month's dissolved oxygen, temperature and transparency readings.",
    frequency: 'monthly',
    items: [
      'Dissolved oxygen readings reviewed; low readings followed up',
      'Water temperature trend reviewed',
      'Secchi (transparency) readings reviewed',
      'Feeding adjusted where water quality was poor',
      'Meters calibrated or checked',
    ],
  },
]

const itemId = (i: number) => `i${i + 1}`

export function templateItems(labels: string[]) {
  return labels.map((label, i) => ({ id: itemId(i), label, required: true }))
}

/** Add any missing built-in template to a company. Returns the keys added. */
export async function seedTemplatesFor(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  opts: { dryRun?: boolean; userId?: Id<'users'> } = {},
) {
  const added: string[] = []
  for (const t of DEFAULT_TEMPLATES) {
    const existing = await ctx.db
      .query('complianceTemplates')
      .withIndex('by_companyId_and_key', (q) => q.eq('companyId', companyId).eq('key', t.key))
      .first()
    if (existing) continue
    added.push(t.key)
    if (opts.dryRun) continue
    await ctx.db.insert('complianceTemplates', {
      companyId,
      key: t.key,
      name: t.name,
      description: t.description,
      frequency: t.frequency,
      items: templateItems(t.items),
      active: true,
      createdBy: opts.userId,
      updatedAt: Date.now(),
    })
  }
  return added
}
