/**
 * Permission catalog and role templates (D-005, PERM-001). No imports, so the
 * browser can use it too (hooks/usePermission). The guard is lib/permissions.
 *
 * Template mapping of today's roles (owner decision): `admin` → admin,
 * `user` → manager, which keeps exactly today's access: manager has every
 * permission except ADMIN_ONLY, and ADMIN_ONLY is what was admin-gated before.
 */
export const PERMISSION_GROUPS = {
  Organization: {
    'org.view': 'See the organization, its sites and people',
    'org.settings.manage': 'Change organization settings, profile and security',
    'org.members.manage': 'Invite, suspend and remove members; set their roles and sites',
    'org.roles.manage': 'Create and edit custom roles',
    'org.sites.manage': 'Add and edit sites',
    'org.audit.view': 'Read the audit log',
    'org.data.export': 'Download a full export of the organization\'s data',
    'org.data.delete': 'Ask for the organization and its data to be deleted',
    'files.upload': 'Attach files to records and remove their own',
    'integrations.manage': 'Configure messaging channels, API keys and webhooks',
    'automation.manage': 'Create and run automations; assign tasks',
  },
  Production: {
    'production.view': 'See units, stockings, records and batches',
    'production.units.manage': 'Add and edit units',
    'production.units.delete': 'Delete units',
    'production.stock.adjust': 'Correct fish counts and unit status by hand',
    'production.daily.record': 'Record daily feed and mortality',
    'production.daily.correct': 'Edit daily records',
    'production.sampling.record': 'Record sampling',
    'production.sampling.correct': 'Edit sampling records',
    'production.stocking.request': 'Request stockings and top-ups',
    'production.stocking.approve': 'Approve, edit and reject stockings and top-ups',
    'production.transfer.request': 'Request fish transfers',
    'production.transfer.approve': 'Approve, reject and reverse transfers; grade batches',
    'production.harvest.record': 'Record harvests and harvest sampling',
    'production.harvest.correct': 'Edit harvests',
    'production.health.record': 'Record treatments',
    'production.withdrawal.override': 'Harvest or sell during a withdrawal period, with a reason',
    'production.records.delete': 'Delete production records',
    'production.import': 'Bulk-import records',
  },
  Hatchery: {
    'hatchery.view': 'See broodstock, spawnings, incubation and larval batches',
    'hatchery.broodstock.manage': 'Add and edit broodstock',
    'hatchery.spawning.record': 'Record spawnings, egg collections, incubation and hatches',
    'hatchery.larval.record': 'Record larval rearing logs and live feed',
    'hatchery.grade': 'Grade larvae into fingerling batches',
    'hatchery.dispatch': 'Transfer and sell fingerlings',
    'hatchery.correct': 'Reverse hatches and larval logs',
  },
  Inventory: {
    'inventory.view': 'See stock, purchases and movements',
    'inventory.issue': 'Issue feed and items',
    'inventory.purchase.record': 'Record purchases, suppliers, items and orders',
    'inventory.purchase.correct': 'Edit or void purchases and orders',
    'inventory.adjust': 'Adjust, transfer and reverse stock; override stock checks',
    'inventory.prices.manage': 'Manage feed types, item prices and suppliers',
  },
  Finance: {
    'finance.view': 'See sales, expenses and profit and loss',
    'finance.sales.record': 'Record sales',
    'finance.sales.correct': 'Edit or delete sales; manage customers',
    'finance.expenses.record': 'Record expenses',
    'finance.expenses.manage': 'Edit expenses and categories',
  },
  Reports: {
    'reports.view': 'See dashboards and reports',
    'reports.export': 'Export data',
    'ai.use': 'Use the farm assistant',
  },
} as const

type Groups = typeof PERMISSION_GROUPS
export type Permission = { [G in keyof Groups]: keyof Groups[G] }[keyof Groups]

export const PERMISSIONS = Object.values(PERMISSION_GROUPS).flatMap((g) =>
  Object.keys(g),
) as Permission[]

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as string[]).includes(value)
}

/** Admin-gated before Phase 3: managers (today's `user` role) do not get these. */
export const ADMIN_ONLY: readonly Permission[] = [
  'org.settings.manage',
  'org.members.manage',
  'org.roles.manage',
  'org.sites.manage',
  'org.audit.view',
  'org.data.export',
  'org.data.delete',
  'integrations.manage',
  'automation.manage',
  'production.units.delete',
  'production.stock.adjust',
  'production.records.delete',
  'production.withdrawal.override',
  'hatchery.grade',
  'hatchery.dispatch',
  'hatchery.correct',
  'production.import',
  'production.stocking.approve',
  'production.transfer.approve',
  'inventory.purchase.correct',
  'inventory.adjust',
  'inventory.prices.manage',
  'finance.sales.correct',
  'finance.expenses.manage',
]

export const ROLE_TEMPLATES = {
  owner: PERMISSIONS,
  admin: PERMISSIONS,
  manager: PERMISSIONS.filter((p) => !ADMIN_ONLY.includes(p)),
  field_staff: [
    'org.view',
    'files.upload',
    'production.view',
    'production.daily.record',
    'production.sampling.record',
    'production.stocking.request',
    'production.transfer.request',
    'production.harvest.record',
    'production.health.record',
    'hatchery.view',
    'hatchery.spawning.record',
    'hatchery.larval.record',
    'inventory.view',
    'inventory.issue',
    'reports.view',
  ],
  viewer: ['org.view', 'production.view', 'hatchery.view', 'inventory.view', 'finance.view', 'reports.view'],
} as const satisfies Record<string, readonly Permission[]>

export type TemplateKey = keyof typeof ROLE_TEMPLATES

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  field_staff: 'Field staff',
  viewer: 'Viewer',
}

export function isTemplateKey(key: string): key is TemplateKey {
  return Object.prototype.hasOwnProperty.call(ROLE_TEMPLATES, key)
}
