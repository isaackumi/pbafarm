/**
 * Data governance (ENT-005): which tables hold an organization's data, how
 * they are exported and purged, and the retention rules. Documented in
 * docs/architecture/21-data-governance.md; convex/governance.test.ts checks
 * this list against the schema (every company-indexed table is listed or
 * skipped with a reason, and every index named here starts with companyId).
 */
import type { TableNames } from '../_generated/dataModel'

const DAY = 24 * 60 * 60 * 1000

export const RETENTION = {
  /** Approved deletions wait this long; a platform admin can still cancel. */
  deletionGraceMs: 30 * DAY,
  /** Audit rows of a deleted organization are kept this long after the purge. */
  auditAfterDeletionMs: 365 * DAY,
  /** Export files are downloadable this long, then deleted. */
  exportMs: 7 * DAY,
} as const

/** Rows per table in one export (the zip is built in one action's memory). */
export const EXPORT_ROW_CAP = 50_000

export type TenantTable = {
  table: TableNames
  /** An index whose first field is companyId. */
  index: string
  /** Include in the organization export (default true). */
  export?: boolean
  /** delete (default) | keep (audit rows: retention) | detach (users: other orgs) */
  purge?: 'delete' | 'keep' | 'detach'
  /** Fields left out of the export (hashes, tokens). */
  redact?: string[]
}

export const TENANT_TABLES: TenantTable[] = [
  { table: 'users', index: 'by_companyId', purge: 'detach' },
  { table: 'memberships', index: 'by_companyId' },
  { table: 'roles', index: 'by_companyId_and_key' },
  { table: 'farmLocations', index: 'by_company' },
  { table: 'companySettingsDrafts', index: 'by_company' },
  { table: 'userInvites', index: 'by_company', redact: ['tokenHash'] },
  { table: 'cages', index: 'by_company' },
  { table: 'waterBodies', index: 'by_companyId' },
  { table: 'unitGroups', index: 'by_companyId' },
  { table: 'waterQualityReadings', index: 'by_companyId_and_measuredAt' },
  { table: 'waterQualityThresholds', index: 'by_companyId' },
  { table: 'waterManagementLogs', index: 'by_companyId_and_date' },
  { table: 'equipment', index: 'by_companyId' },
  { table: 'unitInspections', index: 'by_companyId_and_date' },
  { table: 'feedSuppliers', index: 'by_company' },
  { table: 'feedTypes', index: 'by_company' },
  { table: 'species', index: 'by_companyId_and_key' },
  { table: 'customFieldDefs', index: 'by_companyId_and_entity_and_sortOrder' },
  { table: 'feedPurchases', index: 'by_company' },
  { table: 'feedUsage', index: 'by_company' },
  { table: 'dailyRecords', index: 'by_company' },
  { table: 'biweeklyRecords', index: 'by_company' },
  { table: 'harvestRecords', index: 'by_company' },
  { table: 'harvestSampling', index: 'by_company' },
  { table: 'feedInventory', index: 'by_company' },
  { table: 'feedInventoryTransactions', index: 'by_company' },
  { table: 'stockingHistory', index: 'by_company' },
  { table: 'topupHistory', index: 'by_company' },
  { table: 'fishTransfers', index: 'by_company' },
  { table: 'auditLogs', index: 'by_company', purge: 'keep' },
  { table: 'messagingChannels', index: 'by_company_and_channel' },
  { table: 'customers', index: 'by_company' },
  { table: 'sales', index: 'by_company' },
  { table: 'salePayments', index: 'by_company_and_paidDate' },
  { table: 'invoices', index: 'by_company_and_seq' },
  { table: 'healthTreatments', index: 'by_company' },
  { table: 'batches', index: 'by_companyId_and_batchNumber' },
  { table: 'stockEvents', index: 'by_companyId_and_eventDate' },
  { table: 'broodstock', index: 'by_companyId_and_code' },
  { table: 'spawningEvents', index: 'by_companyId_and_spawnDate' },
  { table: 'incubationLots', index: 'by_companyId_and_status' },
  { table: 'larvalLogs', index: 'by_companyId_and_logDate' },
  { table: 'liveFeedLogs', index: 'by_companyId_and_date' },
  { table: 'nurseryMovements', index: 'by_companyId_and_moveDate' },
  { table: 'stockOperations', index: 'by_companyId_and_operationDate' },
  { table: 'expenses', index: 'by_company_and_date' },
  { table: 'expenseCategories', index: 'by_company_and_key' },
  { table: 'purchaseOrders', index: 'by_company' },
  { table: 'inventoryItems', index: 'by_company' },
  { table: 'inventoryItemStock', index: 'by_company' },
  { table: 'inventoryMovements', index: 'by_company_and_date' },
  { table: 'stockCounts', index: 'by_company' },
  { table: 'domainEvents', index: 'by_company_and_createdAt' },
  { table: 'automationRules', index: 'by_company' },
  { table: 'automationRuns', index: 'by_company_and_createdAt' },
  { table: 'notificationDispatches', index: 'by_company_and_createdAt' },
  { table: 'tasks', index: 'by_company_and_status' },
  { table: 'unitDailyStats', index: 'by_companyId_and_date' },
  { table: 'batchStats', index: 'by_companyId_and_lastDate' },
  { table: 'harvestLots', index: 'by_companyId_and_harvestDate' },
  { table: 'dispatches', index: 'by_companyId_and_dispatchDate' },
  { table: 'files', index: 'by_companyId_and_entityType_and_entityId' },
  { table: 'biosecurityLogs', index: 'by_companyId_and_date' },
  { table: 'complianceTemplates', index: 'by_companyId' },
  { table: 'complianceRecords', index: 'by_companyId_and_completedOn' },
  { table: 'apiKeys', index: 'by_companyId', redact: ['hash'] },
  { table: 'webhookEndpoints', index: 'by_companyId' },
  { table: 'weatherObservations', index: 'by_companyId_and_date' },
  { table: 'sensorReadings', index: 'by_companyId_and_measuredAt' },
  // Governance bookkeeping: purged, not exported.
  { table: 'dataExports', index: 'by_companyId', export: false },
  { table: 'auditChainVerifications', index: 'by_companyId', export: false, purge: 'keep' },
  { table: 'auditChainHeads', index: 'by_companyId', export: false, purge: 'keep' },
]

/**
 * Tables with a company index that are neither exported nor purged by
 * company, and why. Child rows without a company index are removed with their
 * parent (governance.purgeCompanyBatch cascades).
 */
export const SKIPPED_TABLES: Record<string, string> = {
  dataRequests: 'the deletion record itself; kept as evidence',
}

export function tenantTable(name: string): TenantTable | undefined {
  return TENANT_TABLES.find((t) => t.table === name)
}

export const EXPORT_TABLES = TENANT_TABLES.filter((t) => t.export !== false)

/** Order matters only for readability of purge progress; children cascade. */
export const PURGE_TABLES = TENANT_TABLES.filter((t) => (t.purge ?? 'delete') !== 'keep')

/** A row as exported: system fields renamed, redacted fields removed. */
export function exportRow(row: Record<string, unknown>, redact: string[] = []) {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (redact.includes(key)) continue
    out[key === '_id' ? 'id' : key === '_creationTime' ? 'createdAt_system' : key] = value
  }
  return out
}
