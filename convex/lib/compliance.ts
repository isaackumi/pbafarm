/**
 * Compliance checklists (TRACE-006): due periods and the built-in templates;
 * country and language template packs (I18N-004).
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

/**
 * Country and language templates (I18N-004). Keys are unique across the
 * library, so a template shared by several packs is installed once.
 * Regulatory wording is a starting point for the farm's own records, not
 * legal advice: admins can switch any template off and add their own.
 */
export const COUNTRY_TEMPLATES: TemplateSeed[] = [
  {
    key: 'gh_monthly_regulatory',
    name: 'Ghana: monthly Fisheries Commission records',
    description: 'Licences, permits and the monthly production return for the Fisheries Commission.',
    frequency: 'monthly',
    items: [
      'Aquaculture licence from the Fisheries Commission valid and kept at the site',
      'EPA environmental permit valid',
      'Monthly production return (stocking, mortality, harvest) sent to the Fisheries Commission regional office',
      'Fingerlings bought only from hatcheries registered with the Fisheries Commission; receipts kept',
      'Mass mortality or suspected disease reported to the Fisheries Commission',
      'Feed and veterinary medicine purchases recorded with supplier and batch',
    ],
  },
  {
    key: 'fr_daily_biosecurity',
    name: 'Contrôle quotidien de biosécurité',
    description: 'Contrôles à l’entrée, retrait des poissons morts et hygiène du matériel sur le site.',
    frequency: 'daily',
    items: [
      'Pédiluve et rotoluve renouvelés à l’entrée du site',
      'Chaque visiteur et véhicule inscrit au registre de biosécurité',
      'Poissons morts retirés, comptés et éliminés loin de l’eau',
      'Filets, seaux et barques désinfectés après usage',
      'Aucun poisson malade ou au comportement anormal (ou signalé au responsable)',
    ],
  },
  {
    key: 'fr_weekly_net_inspection',
    name: 'Inspection hebdomadaire des filets',
    description: 'Contrôle physique de chaque filet de cage et de ses amarrages.',
    frequency: 'weekly',
    items: [
      'Filets vérifiés : trous, déchirures et coutures usées',
      'Filets anti-prédateurs et anti-oiseaux intacts',
      'Amarres, ancres et bouées solides',
      'Cadres et passerelles en bon état',
      'Encrassement des filets acceptable ou nettoyage prévu',
      'Réparations nécessaires notées',
    ],
  },
  {
    key: 'fr_monthly_water_quality',
    name: 'Bilan mensuel de la qualité de l’eau',
    description: 'Revue des relevés du mois : oxygène dissous, température et transparence.',
    frequency: 'monthly',
    items: [
      'Relevés d’oxygène dissous revus ; valeurs basses suivies',
      'Évolution de la température de l’eau revue',
      'Relevés Secchi (transparence) revus',
      'Alimentation ajustée lorsque la qualité de l’eau était mauvaise',
      'Appareils de mesure étalonnés ou vérifiés',
    ],
  },
  {
    key: 'ci_monthly_regulatory',
    name: 'Côte d’Ivoire : registre réglementaire mensuel',
    description: 'Autorisations et déclaration mensuelle de production auprès des services des ressources halieutiques.',
    frequency: 'monthly',
    items: [
      'Autorisation d’exploitation aquacole du ministère des Ressources animales et halieutiques valide et disponible sur le site',
      'Déclaration mensuelle de production (empoissonnement, mortalités, récoltes) transmise à la direction régionale',
      'Alevins achetés uniquement auprès d’écloseries agréées ; factures conservées',
      'Mortalités massives ou suspicion de maladie signalées aux services vétérinaires',
      'Achats d’aliments et de médicaments vétérinaires enregistrés (fournisseur et lot)',
    ],
  },
]

const STANDARD_KEYS = DEFAULT_TEMPLATES.map((t) => t.key)
const FRENCH_KEYS = ['fr_daily_biosecurity', 'fr_weekly_net_inspection', 'fr_monthly_water_quality']

export type TemplatePack = {
  id: string
  name: string
  description: string
  language: 'en' | 'fr'
  /** Countries this pack is recommended for (lib/countries `pack`). */
  countries: string[]
  templateKeys: string[]
}

export const TEMPLATE_PACKS: TemplatePack[] = [
  {
    id: 'standard',
    name: 'Standard aquaculture biosecurity',
    description: 'Daily biosecurity, weekly net inspection and monthly water quality review.',
    language: 'en',
    countries: [],
    templateKeys: STANDARD_KEYS,
  },
  {
    id: 'gh',
    name: 'Ghana (Fisheries Commission)',
    description: 'The standard checklists plus monthly Fisheries Commission and EPA records.',
    language: 'en',
    countries: ['GH'],
    templateKeys: [...STANDARD_KEYS, 'gh_monthly_regulatory'],
  },
  {
    id: 'ci',
    name: 'Côte d’Ivoire (français)',
    description: 'Les contrôles de biosécurité en français et le registre réglementaire mensuel.',
    language: 'fr',
    countries: ['CI'],
    templateKeys: [...FRENCH_KEYS, 'ci_monthly_regulatory'],
  },
  {
    id: 'fr',
    name: 'Biosécurité aquacole (français)',
    description: 'Contrôle quotidien de biosécurité, inspection hebdomadaire des filets et bilan mensuel de l’eau.',
    language: 'fr',
    countries: ['BF', 'BJ', 'CM', 'SN', 'TG'],
    templateKeys: FRENCH_KEYS,
  },
]

const LIBRARY = new Map([...DEFAULT_TEMPLATES, ...COUNTRY_TEMPLATES].map((t) => [t.key, t]))

export function templatePack(id: string): TemplatePack | null {
  return TEMPLATE_PACKS.find((p) => p.id === id) ?? null
}

export function libraryTemplate(key: string): TemplateSeed | null {
  return LIBRARY.get(key) ?? null
}

/** The pack to suggest for a country: its own, otherwise the standard one. */
export function recommendedPack(country: string): TemplatePack {
  return TEMPLATE_PACKS.find((p) => p.countries.includes(country)) ?? TEMPLATE_PACKS[0]
}

const itemId = (i: number) => `i${i + 1}`

export function templateItems(labels: string[]) {
  return labels.map((label, i) => ({ id: itemId(i), label, required: true }))
}

/**
 * Add the library templates the company does not have yet (matched by key,
 * so re-running is a no-op and a switched-off template stays off). Returns
 * the keys added.
 */
export async function installTemplatesFor(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  keys: string[],
  opts: { dryRun?: boolean; userId?: Id<'users'> } = {},
) {
  const added: string[] = []
  for (const key of keys) {
    const t = LIBRARY.get(key)
    if (!t) continue
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

/** Add any missing built-in (standard) template to a company. Returns the keys added. */
export async function seedTemplatesFor(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  opts: { dryRun?: boolean; userId?: Id<'users'> } = {},
) {
  return await installTemplatesFor(ctx, companyId, STANDARD_KEYS, opts)
}
