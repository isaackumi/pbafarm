import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { authTables } from '@convex-dev/auth/server'
import { messagingChannel, messagingProvider } from './messaging/validators'
import { batchStatsFields, unitDailyStatsFields } from './lib/rollupSchema'
import { integrationTables } from './integrations/tables'
import {
  automationAction,
  automationCondition,
  automationTrigger,
  quietHours,
  runDelivery,
  runStatus,
} from './automation/validators'

/** Production unit kinds (D-003). Rows without unitType are cages. */
export const unitTypeValidator = v.union(
  v.literal('cage'),
  v.literal('pond'),
  v.literal('tank'),
  v.literal('raceway'),
  v.literal('hatchery_tank'),
  v.literal('incubator'),
  v.literal('hapa'),
)

export const siteTypeValidator = v.union(
  v.literal('cage_farm'),
  v.literal('pond_farm'),
  v.literal('hatchery'),
  v.literal('nursery'),
  v.literal('ras_facility'),
  v.literal('mixed'),
  v.literal('store'),
)

const cageStatus = v.union(
  v.literal('active'),
  v.literal('harvested'),
  v.literal('harvesting'),
  v.literal('maintenance'),
  v.literal('fallow'),
  v.literal('empty'),
)

/** Production engine (D-004, docs/architecture/05). */
export const stockEventType = v.union(
  v.literal('stock_in'),
  v.literal('mortality'),
  v.literal('transfer_out'),
  v.literal('transfer_in'),
  v.literal('harvest'),
  v.literal('grading_split'),
  v.literal('merge'),
  v.literal('count_adjustment'),
  v.literal('reversal'),
)

export const stockSourceTable = v.union(
  v.literal('stockingHistory'),
  v.literal('topupHistory'),
  v.literal('fishTransfers'),
  v.literal('dailyRecords'),
  v.literal('harvestRecords'),
  v.literal('stockOperations'),
  v.literal('legacyBackfill'),
  /** Hatch of an incubation lot opens a larval batch (HAT-002). */
  v.literal('incubationLots'),
)

/** Who overrode an active withdrawal period, when and why (PROD-012). */
export const withdrawalOverride = v.object({
  reason: v.string(),
  by: v.id('users'),
  at: v.number(),
  /** Last withdrawal day that was overridden (YYYY-MM-DD). */
  until: v.string(),
  treatmentIds: v.array(v.id('healthTreatments')),
})

export const batchOrigin = v.union(
  v.literal('stocking'),
  v.literal('transfer_split'),
  v.literal('grading_split'),
  v.literal('merge'),
  v.literal('hatchery'),
  v.literal('legacy'),
)

export const broodstockKind = v.union(v.literal('individual'), v.literal('group'))
export const broodstockSex = v.union(
  v.literal('female'),
  v.literal('male'),
  v.literal('mixed'),
  v.literal('unknown'),
)
export const broodstockOrigin = v.union(
  v.literal('wild'),
  v.literal('farm'),
  v.literal('purchased'),
  v.literal('hatchery'),
  v.literal('other'),
)
export const broodstockStatus = v.union(
  v.literal('conditioning'),
  v.literal('ready'),
  v.literal('spent'),
  v.literal('resting'),
  v.literal('retired'),
  v.literal('dead'),
)

const schema = defineSchema({
  ...authTables,
  ...integrationTables,

  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    role: v.optional(
      v.union(v.literal('user'), v.literal('admin'), v.literal('super_admin')),
    ),
    companyId: v.optional(v.id('companies')),
    active: v.optional(v.boolean()),
    /** Set when an admin creates the account with a temporary password. */
    mustChangePassword: v.optional(v.boolean()),
    /** Assigned farm sites; empty/undefined = all company locations. */
    locationIds: v.optional(v.array(v.id('farmLocations'))),
    activeLocationId: v.optional(v.id('farmLocations')),
  })
    .index('email', ['email'])
    // Same name as the Convex Auth users table: phone sign-in looks users up by E.164 phone.
    .index('phone', ['phone'])
    .index('by_companyId', ['companyId']),

  /**
   * A user's place in an organization (D-002, ORG-001). One row per
   * user + company; users.companyId stays the active-organization pointer and
   * is only set to a company where the user has an active membership.
   */
  memberships: defineTable({
    userId: v.id('users'),
    companyId: v.id('companies'),
    /** Role template key: owner | admin | manager | field_staff | viewer (Phase 3 adds custom roles). */
    roleKey: v.string(),
    /** true = every site of the organization, now and future. */
    allLocations: v.boolean(),
    /** Ignored when allLocations; at most 100 entries. */
    locationIds: v.optional(v.array(v.id('farmLocations'))),
    status: v.union(v.literal('active'), v.literal('suspended'), v.literal('removed')),
    invitedBy: v.optional(v.id('users')),
    joinedAt: v.optional(v.number()),
    statusChangedAt: v.optional(v.number()),
    statusChangedBy: v.optional(v.id('users')),
    /** Created by the M2 backfill from users.companyId / users.role. */
    legacy: v.optional(v.boolean()),
    updatedAt: v.number(),
  })
    .index('by_userId', ['userId'])
    .index('by_companyId', ['companyId'])
    .index('by_companyId_and_userId', ['companyId', 'userId']),

  /** One-time codes proving a signed-in user owns their email (SEC-005). */
  emailVerifications: defineTable({
    userId: v.id('users'),
    email: v.string(),
    codeHash: v.string(),
    expiresAt: v.number(),
    attempts: v.number(),
  }).index('by_userId', ['userId']),

  /** Physical farm sites under a company (ops + inventory scope). */
  farmLocations: defineTable({
    companyId: v.optional(v.id('companies')),
    name: v.string(),
    code: v.optional(v.string()),
    address: v.optional(v.string()),
    active: v.boolean(),
    notes: v.optional(v.string()),
    /** Site metadata (FARM-001, M5). Timezone falls back to the company's. */
    siteType: v.optional(siteTypeValidator),
    timezone: v.optional(v.string()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    waterBody: v.optional(v.string()),
    updatedAt: v.number(),
  }).index('by_company', ['companyId']),

  companies: defineTable({
    name: v.string(),
    code: v.string(),
    address: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    abbreviation: v.optional(v.string()),
    logoStorageId: v.optional(v.id('_storage')),
    submittedByUserId: v.optional(v.id('users')),
    status: v.union(
      v.literal('pending'),
      v.literal('approved'),
      v.literal('rejected'),
    ),
    rejectionReason: v.optional(v.string()),
    /** Organization profile (M3, D-012). Read with defaults from lib/orgProfile. */
    country: v.optional(v.string()),
    timezone: v.optional(v.string()),
    unitSystem: v.optional(v.union(v.literal('metric'), v.literal('imperial'))),
    defaultLocale: v.optional(v.string()),
    settings: v.optional(
      v.object({
        aiAssistantEnabled: v.boolean(),
        branding: v.optional(
          v.object({
            displayName: v.optional(v.string()),
            accentHex: v.optional(v.string()),
            themeMode: v.optional(
              v.union(
                v.literal('light'),
                v.literal('dark'),
                v.literal('system'),
              ),
            ),
          }),
        ),
        farmRules: v.optional(
          v.object({
            targetHarvestAbwG: v.optional(v.number()),
            harvestDocMinDays: v.optional(v.number()),
            harvestDocMaxDays: v.optional(v.number()),
            maxDensityFishPerM3: v.optional(v.number()),
            /** Ponds: stocking density by surface area. */
            maxDensityFishPerM2: v.optional(v.number()),
            dailyMortalityAlertPct: v.optional(v.number()),
            cumulativeMortalityAlertPct: v.optional(v.number()),
            targetFcr: v.optional(v.number()),
            maxFcrAlert: v.optional(v.number()),
          }),
        ),
        stockingRules: v.optional(
          v.object({
            requireApprovalForStocking: v.boolean(),
            requireApprovalForTopup: v.boolean(),
            requireApprovalForFishTransfer: v.optional(v.boolean()),
            enforceCageCapacity: v.boolean(),
            minInitialAbwG: v.optional(v.number()),
            maxInitialAbwG: v.optional(v.number()),
            minTopupAbwG: v.optional(v.number()),
            maxTopupAbwG: v.optional(v.number()),
            allowStockOnlyEmptyStatuses: v.optional(v.array(v.string())),
          }),
        ),
        feedRules: v.optional(
          v.object({
            defaultBagSizeKg: v.optional(v.number()),
            defaultLocation: v.optional(v.string()),
            allowNegativeStock: v.optional(v.boolean()),
            trackLots: v.optional(v.boolean()),
            lowStockMultiplier: v.optional(v.number()),
            requireBatchOnPurchase: v.optional(v.boolean()),
          }),
        ),
        locale: v.optional(
          v.object({
            currency: v.optional(
              v.union(v.literal('GHS'), v.literal('USD'), v.literal('EUR')),
            ),
          }),
        ),
        /** ISO 3166 alpha-2 used to read local phone numbers (INT-001). Default 'GH'. */
        defaultCountryCode: v.optional(v.string()),
        /** Messaging preferences (INT-001); channels live in messagingChannels. */
        messaging: v.optional(
          v.object({
            /** Use the platform's channel when the company has none (default true). */
            usePlatformDefaultSms: v.optional(v.boolean()),
            usePlatformDefaultWhatsapp: v.optional(v.boolean()),
            usePlatformDefaultEmail: v.optional(v.boolean()),
          }),
        ),
        /** Sign-in policy (SEC-006, SEC-007, doc 18 §7–8). All default off. */
        security: v.optional(
          v.object({
            allowPhoneLogin: v.optional(v.boolean()),
            phoneLoginChannel: v.optional(v.union(v.literal('sms'), v.literal('whatsapp'))),
            require2fa: v.optional(v.boolean()),
            twoFactorChannel: v.optional(v.union(v.literal('sms'), v.literal('whatsapp'))),
            phoneLoginSatisfies2fa: v.optional(v.boolean()),
            updatedAt: v.optional(v.number()),
            updatedBy: v.optional(v.id('users')),
          }),
        ),
        updatedAt: v.optional(v.number()),
        updatedBy: v.optional(v.id('users')),
      }),
    ),
    createdAt: v.number(),
    approvedAt: v.optional(v.number()),
    approvedBy: v.optional(v.id('users')),
  })
    .index('by_code', ['code'])
    .index('by_status', ['status'])
    .index('by_submittedByUserId', ['submittedByUserId']),

  companySettingsDrafts: defineTable({
    companyId: v.id('companies'),
    draft: v.any(),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id('users')),
  }).index('by_company', ['companyId']),

  /**
   * Logo files a company uploaded (SEC-002, doc 07 V11). setLogo records an
   * upload the first time it sees it; publishSettings and logo deletion only
   * accept files recorded for the caller's company.
   */
  logoUploads: defineTable({
    companyId: v.id('companies'),
    storageId: v.id('_storage'),
    uploadedBy: v.id('users'),
  }).index('by_storageId', ['storageId']),

  userInvites: defineTable({
    email: v.string(),
    role: v.union(v.literal('user'), v.literal('admin')),
    companyId: v.id('companies'),
    invitedBy: v.optional(v.id('users')),
    createdAt: v.number(),
    /**
     * pending (or missing, for older rows): waiting for the invitee.
     * requested: the invitee asked to join; a company admin must approve.
     * accepted / declined: decided by a company admin.
     */
    status: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('requested'),
        v.literal('accepted'),
        v.literal('declined'),
        v.literal('revoked'),
      ),
    ),
    /** Role template for the new membership; falls back to `role` (admin → admin, user → manager). */
    roleKey: v.optional(v.string()),
    /** SHA-256 (hex) of the single-use invite token; the token is only in the link. */
    tokenHash: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    acceptedBy: v.optional(v.id('users')),
    acceptedAt: v.optional(v.number()),
    requestedByUserId: v.optional(v.id('users')),
    requestedAt: v.optional(v.number()),
    decidedBy: v.optional(v.id('users')),
    decidedAt: v.optional(v.number()),
  })
    .index('by_email', ['email'])
    .index('by_company', ['companyId'])
    .index('by_company_and_email', ['companyId', 'email'])
    .index('by_tokenHash', ['tokenHash']),

  cages: defineTable({
    name: v.string(),
    code: v.optional(v.string()),
    location: v.optional(v.string()),
    size: v.optional(v.number()),
    capacity: v.optional(v.number()),
    dimensions: v.optional(v.string()),
    material: v.optional(v.string()),
    installationDate: v.optional(v.string()),
    stockingDate: v.optional(v.string()),
    initialCount: v.optional(v.number()),
    currentCount: v.optional(v.number()),
    initialAbw: v.optional(v.number()),
    initialBiomass: v.optional(v.number()),
    initialWeight: v.optional(v.number()),
    currentWeight: v.optional(v.number()),
    growthRate: v.optional(v.number()),
    mortalityRate: v.optional(v.number()),
    lastMaintenanceDate: v.optional(v.string()),
    nextMaintenanceDate: v.optional(v.string()),
    status: cageStatus,
    notes: v.optional(v.string()),
    /** Active culture species (set from stocking). */
    species: v.optional(v.string()),
    /** Engine cache: the batch whose occupancy is open in this cage. */
    currentBatchId: v.optional(v.id('batches')),
    /** Production unit type and geometry (FARM-002, M4). Missing unitType = cage. */
    unitType: v.optional(unitTypeValidator),
    areaM2: v.optional(v.number()),
    depthM: v.optional(v.number()),
    volumeM3: v.optional(v.number()),
    diameterM: v.optional(v.number()),
    /** Free-text group label, e.g. "Block A" or "Line 2". */
    unitGroup: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_name', ['name'])
    .index('by_status', ['status'])
    .index('by_company', ['companyId'])
    .index('by_company_status', ['companyId', 'status'])
    .index('by_location', ['locationId'])
    .index('by_company_location', ['companyId', 'locationId']),

  feedSuppliers: defineTable({
    name: v.string(),
    abbreviation: v.optional(v.string()),
    contactInfo: v.optional(v.string()),
    website: v.optional(v.string()),
    companyId: v.optional(v.id('companies')),
    deletedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index('by_company', ['companyId']),

  feedTypes: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    currentStock: v.number(),
    minimumStock: v.number(),
    pricePerKg: v.number(),
    /** Default bag weight for bags↔kg conversion (e.g. 25). */
    bagSizeKg: v.optional(v.number()),
    supplierId: v.optional(v.id('feedSuppliers')),
    active: v.boolean(),
    companyId: v.optional(v.id('companies')),
    deletedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_company', ['companyId'])
    .index('by_supplier', ['supplierId']),

  feedPurchases: defineTable({
    feedTypeId: v.id('feedTypes'),
    quantity: v.number(),
    bags: v.optional(v.number()),
    pricePerKg: v.number(),
    purchaseDate: v.string(),
    supplierId: v.optional(v.id('feedSuppliers')),
    batchNumber: v.optional(v.string()),
    expiryDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
    companyId: v.optional(v.id('companies')),
    deletedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_feed_type', ['feedTypeId'])
    .index('by_company', ['companyId'])
    .index('by_location', ['locationId'])
    .index('by_company_location', ['companyId', 'locationId']),

  feedUsage: defineTable({
    feedTypeId: v.id('feedTypes'),
    cageId: v.optional(v.id('cages')),
    quantity: v.number(),
    bags: v.optional(v.number()),
    usageDate: v.string(),
    /** issue = store take-out; daily = from daily record; usage = generic */
    source: v.optional(
      v.union(v.literal('issue'), v.literal('daily'), v.literal('usage')),
    ),
    notes: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
    companyId: v.optional(v.id('companies')),
    deletedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_feed_type', ['feedTypeId'])
    .index('by_cage', ['cageId'])
    .index('by_company', ['companyId'])
    .index('by_location', ['locationId'])
    .index('by_company_location', ['companyId', 'locationId']),

  dailyRecords: defineTable({
    cageId: v.id('cages'),
    date: v.string(),
    feedAmount: v.number(),
    feedTypeId: v.optional(v.id('feedTypes')),
    feedType: v.optional(v.string()),
    feedPrice: v.number(),
    feedCost: v.number(),
    mortality: v.number(),
    /** Cause when mortality > 0 (disease, do_crash, predator, theft, cull, unknown, other). */
    mortalityCause: v.optional(v.string()),
    notes: v.optional(v.string()),
    /** Dissolved oxygen (mg/L). */
    dissolvedOxygen: v.optional(v.number()),
    /** Water temperature (°C). */
    temperatureC: v.optional(v.number()),
    /** Secchi disk depth (cm). */
    secchiCm: v.optional(v.number()),
    /** Batch in the cage on `date` (production engine). */
    batchId: v.optional(v.id('batches')),
    locationId: v.optional(v.id('farmLocations')),
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
  })
    .index('by_cage', ['cageId'])
    .index('by_cage_date', ['cageId', 'date'])
    .index('by_date', ['date'])
    .index('by_company', ['companyId'])
    .index('by_company_and_date', ['companyId', 'date'])
    .index('by_location', ['locationId'])
    .index('by_company_location', ['companyId', 'locationId']),

  biweeklyRecords: defineTable({
    cageId: v.id('cages'),
    date: v.string(),
    batchCode: v.string(),
    averageBodyWeight: v.number(),
    totalFishCount: v.number(),
    totalWeight: v.number(),
    dissolvedOxygen: v.optional(v.number()),
    temperatureC: v.optional(v.number()),
    secchiCm: v.optional(v.number()),
    /** Batch in the cage on `date` (production engine). */
    batchId: v.optional(v.id('batches')),
    locationId: v.optional(v.id('farmLocations')),
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
    updatedBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_cage', ['cageId'])
    .index('by_cage_and_date', ['cageId', 'date'])
    .index('by_batch_code', ['batchCode'])
    .index('by_company_and_batchCode', ['companyId', 'batchCode'])
    .index('by_company', ['companyId'])
    .index('by_company_and_date', ['companyId', 'date'])
    .index('by_date', ['date'])
    .index('by_location', ['locationId'])
    .index('by_company_location', ['companyId', 'locationId']),

  biweeklySampling: defineTable({
    biweeklyRecordId: v.id('biweeklyRecords'),
    samplingNumber: v.number(),
    fishCount: v.number(),
    totalWeight: v.number(),
    averageBodyWeight: v.number(),
    createdBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  }).index('by_record', ['biweeklyRecordId']),

  harvestRecords: defineTable({
    cageId: v.id('cages'),
    harvestDate: v.string(),
    averageBodyWeight: v.number(),
    totalWeight: v.number(),
    estimatedCount: v.number(),
    fcr: v.number(),
    sizeBreakdown: v.optional(v.any()),
    notes: v.optional(v.string()),
    harvestType: v.optional(v.union(v.literal('complete'), v.literal('partial'))),
    status: v.optional(v.union(v.literal('completed'), v.literal('in_progress'))),
    /** What this harvest did to its cage, so edits and deletes can undo it. */
    cageEffect: v.optional(
      v.object({
        fishRemoved: v.number(),
        countBefore: v.optional(v.number()),
        statusBefore: v.optional(v.string()),
        closedStockingId: v.optional(v.id('stockingHistory')),
      }),
    ),
    /**
     * Where the record came from. 'sampling_page' marks rows the old
     * /harvest-sampling page wrote as harvests (migration M0-c); they are kept
     * for reference but left out of harvest KPIs. Unset = harvest form.
     */
    source: v.optional(v.string()),
    /** Batch harvested (production engine). */
    batchId: v.optional(v.id('batches')),
    /** Inputs of the FCR computed from the ledger at save time (TD-060). */
    fcrInputs: v.optional(
      v.object({
        feedKg: v.number(),
        gainKg: v.number(),
        method: v.union(v.literal('complete'), v.literal('interim')),
        efcr: v.union(v.number(), v.null()),
      }),
    ),
    /** Admin override of an active treatment withdrawal (PROD-012), audited. */
    withdrawalOverride: v.optional(withdrawalOverride),
    locationId: v.optional(v.id('farmLocations')),
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
  })
    .index('by_cage', ['cageId'])
    .index('by_company', ['companyId'])
    .index('by_company_and_harvestDate', ['companyId', 'harvestDate'])
    .index('by_date', ['harvestDate'])
    .index('by_location', ['locationId'])
    .index('by_company_location', ['companyId', 'locationId']),

  harvestSampling: defineTable({
    /** Unset for a pre-harvest sample from /harvest-sampling. */
    harvestId: v.optional(v.id('harvestRecords')),
    cageId: v.optional(v.id('cages')),
    date: v.optional(v.string()),
    weight: v.optional(v.number()),
    fishCount: v.optional(v.number()),
    crateSize: v.optional(v.number()),
    samples: v.any(),
    sizeBreakdown: v.optional(v.any()),
    doc: v.optional(v.number()),
    abw: v.optional(v.number()),
    locationId: v.optional(v.id('farmLocations')),
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
  })
    .index('by_harvest', ['harvestId'])
    .index('by_cage', ['cageId'])
    .index('by_company', ['companyId'])
    .index('by_location', ['locationId']),

  feedInventory: defineTable({
    feedTypeId: v.id('feedTypes'),
    quantityKg: v.number(),
    batchNumber: v.optional(v.string()),
    expiryDate: v.optional(v.string()),
    location: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
    companyId: v.optional(v.id('companies')),
    updatedAt: v.number(),
  })
    .index('by_feed_type', ['feedTypeId'])
    .index('by_company', ['companyId'])
    .index('by_location', ['locationId'])
    .index('by_company_location', ['companyId', 'locationId']),

  feedInventoryTransactions: defineTable({
    feedTypeId: v.id('feedTypes'),
    transactionType: v.union(
      v.literal('purchase'),
      v.literal('usage'),
      v.literal('issue'),
      v.literal('daily_usage'),
      v.literal('adjustment'),
      v.literal('transfer'),
      v.literal('reversal'),
    ),
    /** Signed kg: positive = stock in, negative = stock out. */
    quantityKg: v.number(),
    bags: v.optional(v.number()),
    transactionDate: v.number(),
    referenceId: v.optional(v.string()),
    notes: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
  })
    .index('by_feed_type', ['feedTypeId'])
    .index('by_company', ['companyId'])
    .index('by_reference', ['referenceId'])
    .index('by_location', ['locationId'])
    .index('by_company_location', ['companyId', 'locationId']),

  stockingHistory: defineTable({
    cageId: v.id('cages'),
    batchNumber: v.string(),
    stockingDate: v.string(),
    fishCount: v.number(),
    initialAbw: v.number(),
    initialBiomass: v.number(),
    sourceLocation: v.optional(v.string()),
    sourceCage: v.optional(v.string()),
    transferSupervisor: v.optional(v.string()),
    samplingSupervisor: v.optional(v.string()),
    status: v.union(
      v.literal('pending_approval'),
      v.literal('approved'),
      v.literal('rejected'),
    ),
    notes: v.optional(v.string()),
    /** Set when a complete harvest ends this stocking's production cycle. */
    closedAt: v.optional(v.string()),
    /** Culture species code (e.g. nile_tilapia). */
    species: v.optional(v.string()),
    /** The batch this stocking opened (production engine). */
    batchId: v.optional(v.id('batches')),
    locationId: v.optional(v.id('farmLocations')),
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
    approvedBy: v.optional(v.id('users')),
    approvedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index('by_cage', ['cageId'])
    .index('by_status', ['status'])
    .index('by_company', ['companyId'])
    .index('by_company_and_status', ['companyId', 'status'])
    .index('by_company_and_batchNumber', ['companyId', 'batchNumber'])
    .index('by_location', ['locationId'])
    .index('by_company_location', ['companyId', 'locationId']),

  topupHistory: defineTable({
    stockingId: v.id('stockingHistory'),
    topupDate: v.string(),
    fishCount: v.number(),
    abw: v.number(),
    sourceLocation: v.optional(v.string()),
    transferSupervisor: v.optional(v.string()),
    status: v.union(
      v.literal('pending_approval'),
      v.literal('approved'),
      v.literal('rejected'),
    ),
    notes: v.optional(v.string()),
    /** Batch the fish were added to (production engine). */
    batchId: v.optional(v.id('batches')),
    locationId: v.optional(v.id('farmLocations')),
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
    approvedBy: v.optional(v.id('users')),
    approvedAt: v.optional(v.number()),
  })
    .index('by_stocking', ['stockingId'])
    .index('by_status', ['status'])
    .index('by_company', ['companyId'])
    .index('by_company_and_status', ['companyId', 'status'])
    .index('by_location', ['locationId']),

  fishTransfers: defineTable({
    sourceCageId: v.id('cages'),
    destinationCageId: v.id('cages'),
    sourceLocationId: v.optional(v.id('farmLocations')),
    destinationLocationId: v.optional(v.id('farmLocations')),
    sourceStockingId: v.optional(v.id('stockingHistory')),
    destinationStockingId: v.optional(v.id('stockingHistory')),
    destinationTopupId: v.optional(v.id('topupHistory')),
    transferDate: v.string(),
    quantity: v.number(),
    abw: v.number(),
    biomass: v.number(),
    transferType: v.union(v.literal('full'), v.literal('partial')),
    transferSupervisor: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.union(
      v.literal('pending_approval'),
      v.literal('approved'),
      v.literal('rejected'),
    ),
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
    approvedBy: v.optional(v.id('users')),
    approvedAt: v.optional(v.number()),
    /** Source batch moved (production engine). */
    batchId: v.optional(v.id('batches')),
    /** Lines of one multi-destination transfer share this id. */
    transferGroupId: v.optional(v.string()),
    /** move: the batch continues in the destination; merge: joins the batch already there. */
    mode: v.optional(v.union(v.literal('move'), v.literal('merge'))),
    /** Set when an approved transfer was reversed (doc 09 S1). */
    reversedAt: v.optional(v.number()),
    reversedBy: v.optional(v.id('users')),
    reversalReason: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('by_company', ['companyId'])
    .index('by_status', ['status'])
    .index('by_company_and_status', ['companyId', 'status'])
    .index('by_companyId_and_transferGroupId', ['companyId', 'transferGroupId'])
    .index('by_source_cage', ['sourceCageId'])
    .index('by_destination_cage', ['destinationCageId'])
    .index('by_company_location', ['companyId', 'sourceLocationId'])
    .index('by_destinationStockingId', ['destinationStockingId'])
    .index('by_destinationTopupId', ['destinationTopupId']),

  auditLogs: defineTable({
    userId: v.optional(v.id('users')),
    actionType: v.string(),
    tableName: v.string(),
    recordId: v.optional(v.string()),
    previousValues: v.optional(v.any()),
    newValues: v.optional(v.any()),
    locationId: v.optional(v.id('farmLocations')),
    companyId: v.optional(v.id('companies')),
    /** Set when the change came through the public API (INT-004). */
    apiKeyId: v.optional(v.id('apiKeys')),
  })
    .index('by_user', ['userId'])
    .index('by_table', ['tableName'])
    .index('by_company', ['companyId'])
    .index('by_company_and_tableName', ['companyId', 'tableName']),

  /**
   * A company's own messaging provider per channel (INT-001, doc 18). Holds
   * only non-secret configuration; credentials are in integrationSecrets.
   */
  messagingChannels: defineTable({
    companyId: v.id('companies'),
    channel: messagingChannel,
    provider: messagingProvider,
    status: v.union(v.literal('draft'), v.literal('verified'), v.literal('disabled')),
    /** Sender ID, from-number or from-address shown to recipients. */
    senderId: v.optional(v.string()),
    /** Non-secret provider settings (phone number id, template name, ...). */
    settings: v.optional(v.record(v.string(), v.string())),
    /** Non-secret hint for the write-only UI, e.g. "…4F2a". */
    credentialHint: v.optional(v.string()),
    credentialsSetAt: v.optional(v.number()),
    lastTestAt: v.optional(v.number()),
    /** 'ok' or a short provider error (never contains credentials). */
    lastTestResult: v.optional(v.string()),
    updatedBy: v.id('users'),
    updatedAt: v.number(),
  }).index('by_company_and_channel', ['companyId', 'channel']),

  /**
   * Encrypted provider credentials (AES-256-GCM, key in the Convex env).
   * Written only by internal mutations and read only by internal functions:
   * no public query or mutation touches this table (tested).
   */
  integrationSecrets: defineTable({
    companyId: v.id('companies'),
    /** Owner: a messaging channel or (INT-005) a webhook endpoint's signing secret. */
    channelId: v.optional(v.id('messagingChannels')),
    webhookEndpointId: v.optional(v.id('webhookEndpoints')),
    /** base64 AES-GCM ciphertext (with tag) of the JSON credentials. */
    ciphertext: v.string(),
    /** base64 12-byte IV, random per encryption. */
    iv: v.string(),
    keyVersion: v.number(),
    updatedAt: v.number(),
  })
    .index('by_channel', ['channelId'])
    .index('by_webhookEndpointId', ['webhookEndpointId']),

  /**
   * Pending phone sign-in codes (SEC-006). One row per phone; replaced on
   * resend, deleted on success or after too many wrong tries. Only hashes.
   */
  phoneLoginCodes: defineTable({
    phone: v.string(),
    userId: v.id('users'),
    companyId: v.id('companies'),
    codeHash: v.string(),
    expiresAt: v.number(),
    attempts: v.number(),
    createdAt: v.number(),
  }).index('by_phone', ['phone']),

  /**
   * Two-step verification state per sign-in session (SEC-007). A session is
   * verified when verifiedAt is set. Pending codes are stored hashed.
   */
  mfaSessions: defineTable({
    userId: v.id('users'),
    sessionId: v.id('authSessions'),
    companyId: v.id('companies'),
    purpose: v.union(v.literal('verify'), v.literal('enrol')),
    channel: v.optional(v.union(v.literal('sms'), v.literal('whatsapp'))),
    codeHash: v.optional(v.string()),
    /** Number being enrolled; saved to users.phone once the code is entered. */
    pendingPhone: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    attempts: v.number(),
    lastSentAt: v.optional(v.number()),
    verifiedAt: v.optional(v.number()),
    /** otp: code entered; phone_login: signed in by phone code; policy_enable: the admin who turned 2FA on, in that session. */
    method: v.optional(v.union(v.literal('otp'), v.literal('phone_login'), v.literal('policy_enable'))),
  })
    .index('by_session', ['sessionId'])
    .index('by_user', ['userId']),

  notifications: defineTable({
    userId: v.id('users'),
    title: v.string(),
    message: v.string(),
    type: v.optional(v.string()),
    read: v.boolean(),
    link: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
    companyId: v.optional(v.id('companies')),
    /** Set by scheduled reminders so the same reminder is never sent twice. */
    dedupeKey: v.optional(v.string()),
  })
    .index('by_user', ['userId'])
    .index('by_user_read', ['userId', 'read'])
    .index('by_dedupe', ['dedupeKey']),

  /** Buyers / market outlets (company-wide catalog). */
  customers: defineTable({
    name: v.string(),
    contactName: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    notes: v.optional(v.string()),
    active: v.boolean(),
    companyId: v.optional(v.id('companies')),
    deletedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index('by_company', ['companyId']),

  /** Sales from harvest (or ad-hoc) — revenue by kg × price. */
  sales: defineTable({
    harvestId: v.optional(v.id('harvestRecords')),
    cageId: v.optional(v.id('cages')),
    customerId: v.optional(v.id('customers')),
    customerName: v.optional(v.string()),
    saleDate: v.string(),
    weightKg: v.number(),
    pricePerKg: v.number(),
    totalAmount: v.number(),
    paymentStatus: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('partial'),
        v.literal('paid'),
      ),
    ),
    notes: v.optional(v.string()),
    /** Admin override of an active treatment withdrawal (PROD-012), audited. */
    withdrawalOverride: v.optional(withdrawalOverride),
    locationId: v.optional(v.id('farmLocations')),
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_company', ['companyId'])
    .index('by_harvest', ['harvestId'])
    .index('by_location', ['locationId'])
    .index('by_company_location', ['companyId', 'locationId'])
    .index('by_company_and_cage', ['companyId', 'cageId'])
    .index('by_company_and_saleDate', ['companyId', 'saleDate'])
    .index('by_date', ['saleDate']),

  /** Health events / treatments on a cage (medications, diagnosis, withdrawal). */
  healthTreatments: defineTable({
    cageId: v.id('cages'),
    date: v.string(),
    diagnosis: v.optional(v.string()),
    treatment: v.string(),
    productName: v.optional(v.string()),
    dosage: v.optional(v.string()),
    fishAffected: v.optional(v.number()),
    withdrawalDays: v.optional(v.number()),
    withdrawalUntil: v.optional(v.string()),
    administeredBy: v.optional(v.string()),
    notes: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_cage', ['cageId'])
    .index('by_company', ['companyId'])
    .index('by_location', ['locationId'])
    .index('by_company_location', ['companyId', 'locationId'])
    .index('by_company_and_date', ['companyId', 'date'])
    .index('by_company_and_withdrawalUntil', ['companyId', 'withdrawalUntil'])
    .index('by_date', ['date']),

  /**
   * A cohort of fish with one origin and species that can live in one or
   * several cages over time (D-004). Children of a grading or transfer split
   * list their parents; a merge adds the merged batch to the target's parents.
   */
  batches: defineTable({
    companyId: v.id('companies'),
    batchNumber: v.string(),
    speciesCode: v.optional(v.string()),
    origin: batchOrigin,
    /** Bounded: at most 20, enforced by the engine. */
    parentBatchIds: v.optional(v.array(v.id('batches'))),
    status: v.union(v.literal('active'), v.literal('closed')),
    openedOn: v.string(),
    closedOn: v.optional(v.string()),
    homeLocationId: v.optional(v.id('farmLocations')),
    legacyStockingId: v.optional(v.id('stockingHistory')),
    /** Hatched batches (origin 'hatchery'): the spawning and its broodstock (HAT-002). */
    spawningEventId: v.optional(v.id('spawningEvents')),
    /** Bounded: at most 50, enforced by convex/hatchery.ts. */
    broodstockIds: v.optional(v.array(v.id('broodstock'))),
    createdBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_companyId_and_batchNumber', ['companyId', 'batchNumber'])
    .index('by_spawningEventId', ['spawningEventId'])
    .index('by_companyId_and_status', ['companyId', 'status'])
    .index('by_legacyStockingId', ['legacyStockingId']),

  /**
   * Append-only fish ledger (D-004). Rows are never patched or deleted; a
   * correction is a `reversal` row. Only convex/lib/productionEngine.ts writes
   * this table.
   */
  stockEvents: defineTable({
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    unitId: v.id('cages'),
    batchId: v.id('batches'),
    type: stockEventType,
    /** Set when type === 'reversal'. */
    reversedType: v.optional(stockEventType),
    /** Signed whole number of fish. */
    qtyDelta: v.number(),
    /** Signed kg. */
    biomassKgDelta: v.number(),
    abwG: v.optional(v.number()),
    abwSource: v.optional(v.union(v.literal('measured'), v.literal('estimated'))),
    /** Business date, YYYY-MM-DD. */
    eventDate: v.string(),
    /** 0 inflows, 1 adjustments (+), 2 mortality and adjustments (−), 3 outflows. */
    intraDayOrder: v.number(),
    sourceTable: stockSourceTable,
    sourceId: v.string(),
    /** 'closeout' marks the derived adjustment that empties a fully harvested occupancy. */
    component: v.optional(v.string()),
    counterpartUnitId: v.optional(v.id('cages')),
    counterpartBatchId: v.optional(v.id('batches')),
    reversesEventId: v.optional(v.id('stockEvents')),
    reason: v.optional(v.string()),
    /** Server time the event was recorded ("known at"). */
    recordedAt: v.number(),
    recordedBy: v.optional(v.id('users')),
  })
    .index('by_unitId_and_eventDate', ['unitId', 'eventDate'])
    .index('by_unitId_and_batchId_and_eventDate', ['unitId', 'batchId', 'eventDate'])
    .index('by_batchId_and_eventDate', ['batchId', 'eventDate'])
    .index('by_companyId_and_eventDate', ['companyId', 'eventDate'])
    .index('by_sourceTable_and_sourceId', ['sourceTable', 'sourceId'])
    .index('by_reversesEventId', ['reversesEventId']),

  /**
   * Broodstock registry (HAT-001): one tagged fish (`kind: 'individual'`,
   * count 1) or a group of fish kept and spawned together. `weightG` is the
   * fish's weight, or the group's mean weight.
   */
  broodstock: defineTable({
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    /** Broodstock or conditioning tank the fish live in. */
    unitId: v.optional(v.id('cages')),
    kind: broodstockKind,
    /** Tag, PIT number or group name; unique per company. */
    code: v.string(),
    pitTag: v.optional(v.string()),
    speciesCode: v.optional(v.string()),
    strain: v.optional(v.string()),
    sex: broodstockSex,
    count: v.number(),
    weightG: v.optional(v.number()),
    lengthCm: v.optional(v.number()),
    origin: broodstockOrigin,
    /** Supplier, wild site or source farm. */
    originNote: v.optional(v.string()),
    /** Grow-out batch the fish were selected from (origin 'farm'). */
    originBatchId: v.optional(v.id('batches')),
    acquiredOn: v.optional(v.string()),
    status: broodstockStatus,
    conditioningStartedOn: v.optional(v.string()),
    lastSpawnedOn: v.optional(v.string()),
    spawnCount: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_companyId_and_code', ['companyId', 'code'])
    .index('by_companyId_and_status', ['companyId', 'status'])
    .index('by_unitId', ['unitId']),

  /**
   * A spawning (HAT-002): the broodstock that spawned, how (natural or
   * hormone-induced), and the egg collection. `femaleWeightKg` is a snapshot
   * for fry per kg of female.
   */
  spawningEvents: defineTable({
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    unitId: v.optional(v.id('cages')),
    spawnDate: v.string(),
    method: v.union(v.literal('natural'), v.literal('induced'), v.literal('stripped')),
    hormone: v.optional(v.string()),
    hormoneDose: v.optional(v.string()),
    /** At most 50 between the two lists. */
    femaleIds: v.array(v.id('broodstock')),
    maleIds: v.array(v.id('broodstock')),
    femaleWeightKg: v.optional(v.number()),
    speciesCode: v.optional(v.string()),
    eggsCollected: v.optional(v.number()),
    eggWeightG: v.optional(v.number()),
    fertilizationPct: v.optional(v.number()),
    collectedOn: v.optional(v.string()),
    status: v.union(
      v.literal('spawned'),
      v.literal('incubating'),
      v.literal('hatched'),
      v.literal('failed'),
    ),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_companyId_and_spawnDate', ['companyId', 'spawnDate'])
    .index('by_companyId_and_status', ['companyId', 'status']),

  /**
   * Eggs of one spawning in one incubator (HAT-002). The hatch opens a larval
   * batch through the production engine (`stockIn`, source 'incubationLots').
   */
  incubationLots: defineTable({
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    spawningEventId: v.id('spawningEvents'),
    unitId: v.id('cages'),
    startedOn: v.string(),
    eggs: v.number(),
    temperatureC: v.optional(v.number()),
    status: v.union(v.literal('incubating'), v.literal('hatched'), v.literal('failed')),
    hatchedOn: v.optional(v.string()),
    larvaeCount: v.optional(v.number()),
    hatchPct: v.optional(v.number()),
    /** Unit the larvae were stocked into (defaults to the incubator). */
    larvalUnitId: v.optional(v.id('cages')),
    batchId: v.optional(v.id('batches')),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_companyId_and_status', ['companyId', 'status'])
    .index('by_spawningEventId', ['spawningEventId']),

  /** Source document for engine-only operations: grading, merge, count adjustment. */
  stockOperations: defineTable({
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    kind: v.union(
      v.literal('grading_split'),
      v.literal('merge'),
      v.literal('count_adjustment'),
    ),
    operationDate: v.string(),
    status: v.union(v.literal('approved'), v.literal('reversed')),
    unitId: v.optional(v.id('cages')),
    reason: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
    createdBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_companyId_and_operationDate', ['companyId', 'operationDate'])
    .index('by_companyId_and_idempotencyKey', ['companyId', 'idempotencyKey']),

  /**
   * Operating expenses (INV-007). Cost centre is the company, optionally a
   * site, a cage and a production cycle (the cage's stocking record) — until
   * Phase 4 adds `batches`, the stocking is the cycle. `category` is a
   * built-in key (lib/costing EXPENSE_CATEGORIES) or a custom
   * `expenseCategories.key`. `currency` is the company currency when saved.
   */
  expenses: defineTable({
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    cageId: v.optional(v.id('cages')),
    stockingId: v.optional(v.id('stockingHistory')),
    category: v.string(),
    amount: v.number(),
    currency: v.string(),
    date: v.string(),
    supplierId: v.optional(v.id('feedSuppliers')),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id('users')),
    deletedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_company_and_date', ['companyId', 'date'])
    .index('by_company_and_cage', ['companyId', 'cageId'])
    .index('by_company_and_stocking', ['companyId', 'stockingId']),

  /** Company-defined expense categories, alongside the built-in ones. */
  expenseCategories: defineTable({
    companyId: v.id('companies'),
    key: v.string(),
    label: v.string(),
    active: v.boolean(),
    updatedAt: v.number(),
  }).index('by_company_and_key', ['companyId', 'key']),

  /**
   * Feed purchase orders (INV-004): draft → ordered → received (or
   * cancelled). Receiving writes one `feedPurchases` row per line through the
   * feed ledger, so stock, lots and purchase prices come from the receipt.
   */
  purchaseOrders: defineTable({
    companyId: v.id('companies'),
    poNumber: v.string(),
    supplierId: v.id('feedSuppliers'),
    /** Delivery site. */
    locationId: v.optional(v.id('farmLocations')),
    status: v.union(
      v.literal('draft'),
      v.literal('ordered'),
      v.literal('received'),
      v.literal('cancelled'),
    ),
    lines: v.array(
      v.object({
        feedTypeId: v.id('feedTypes'),
        quantityKg: v.number(),
        pricePerKg: v.number(),
        receivedKg: v.optional(v.number()),
        receivedPricePerKg: v.optional(v.number()),
        batchNumber: v.optional(v.string()),
        expiryDate: v.optional(v.string()),
        purchaseId: v.optional(v.id('feedPurchases')),
      }),
    ),
    expectedDate: v.optional(v.string()),
    orderedAt: v.optional(v.number()),
    receivedDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id('users')),
    orderedBy: v.optional(v.id('users')),
    receivedBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_company', ['companyId'])
    .index('by_company_and_status', ['companyId', 'status']),

  /**
   * Non-feed stock (INV-001): chemicals, drugs, nets, equipment, fuel,
   * spares. Feed stays in `feedTypes` and its ledger.
   */
  inventoryItems: defineTable({
    companyId: v.id('companies'),
    name: v.string(),
    category: v.string(),
    /** kg, L, pcs, … */
    unit: v.string(),
    /** Company-wide reorder level; 0 = no alert. */
    minimumStock: v.number(),
    supplierId: v.optional(v.id('feedSuppliers')),
    unitCost: v.optional(v.number()),
    active: v.boolean(),
    deletedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index('by_company', ['companyId']),

  /** Quantity of an item held at a site (kept equal to its movements). */
  inventoryItemStock: defineTable({
    companyId: v.id('companies'),
    itemId: v.id('inventoryItems'),
    locationId: v.id('farmLocations'),
    quantity: v.number(),
    updatedAt: v.number(),
  })
    .index('by_item_and_location', ['itemId', 'locationId'])
    .index('by_company', ['companyId']),

  /** Signed movements of non-feed items; transfers are two rows. */
  inventoryMovements: defineTable({
    companyId: v.id('companies'),
    itemId: v.id('inventoryItems'),
    locationId: v.id('farmLocations'),
    type: v.union(
      v.literal('receipt'),
      v.literal('issue'),
      v.literal('adjustment'),
      v.literal('transfer_out'),
      v.literal('transfer_in'),
    ),
    quantity: v.number(),
    unitCost: v.optional(v.number()),
    cageId: v.optional(v.id('cages')),
    supplierId: v.optional(v.id('feedSuppliers')),
    /** Links the two legs of a transfer. */
    transferId: v.optional(v.string()),
    date: v.string(),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id('users')),
  })
    .index('by_company_and_item', ['companyId', 'itemId'])
    .index('by_company_and_date', ['companyId', 'date']),

  /**
   * Domain event outbox (AUTO-001, D-008). Written by convex/lib/events.ts
   * emitDomainEvent in the same transaction as the change it describes;
   * consumers (automation, webhooks) append their name to `processedBy`.
   */
  domainEvents: defineTable({
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    type: v.string(),
    payload: v.record(v.string(), v.any()),
    createdAt: v.number(),
    processedBy: v.optional(v.array(v.string())),
  })
    .index('by_company_and_createdAt', ['companyId', 'createdAt'])
    .index('by_createdAt', ['createdAt']),

  /** Automation rules (AUTO-002): trigger, conditions, actions. */
  automationRules: defineTable({
    companyId: v.id('companies'),
    name: v.string(),
    description: v.optional(v.string()),
    enabled: v.boolean(),
    /** Set when created from a template (convex/automation/templates.ts). */
    templateKey: v.optional(v.string()),
    /** Built-in reminder that replaced the legacy daily digest. */
    builtIn: v.optional(v.boolean()),
    trigger: automationTrigger,
    /** Flattened from trigger for indexing (event rules only). */
    eventType: v.optional(v.string()),
    /** 'all' (default) or 'any' of the conditions must hold. */
    match: v.optional(v.union(v.literal('all'), v.literal('any'))),
    /** Bounded: at most 10. */
    conditions: v.array(automationCondition),
    /** Bounded: at most 5. */
    actions: v.array(automationAction),
    /** Next due time for schedule rules (UTC ms). */
    nextRunAt: v.optional(v.number()),
    lastRunAt: v.optional(v.number()),
    createdBy: v.optional(v.id('users')),
    updatedBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_company', ['companyId'])
    .index('by_company_and_eventType_and_enabled', ['companyId', 'eventType', 'enabled'])
    .index('by_company_and_templateKey', ['companyId', 'templateKey'])
    .index('by_enabled_and_nextRunAt', ['enabled', 'nextRunAt']),

  /** Execution history of automation rules (AUTO-002). */
  automationRuns: defineTable({
    companyId: v.id('companies'),
    ruleId: v.id('automationRules'),
    ruleName: v.string(),
    triggerKind: v.union(v.literal('event'), v.literal('schedule'), v.literal('manual')),
    eventId: v.optional(v.id('domainEvents')),
    /** Company-local business date the run is for (schedule/manual runs). */
    localDate: v.optional(v.string()),
    dedupeKey: v.string(),
    status: runStatus,
    attempts: v.number(),
    maxAttempts: v.number(),
    /** In-app notifications and tasks are written once, on the first attempt. */
    localDone: v.boolean(),
    notified: v.optional(v.number()),
    tasksCreated: v.optional(v.number()),
    /** Outbound SMS/WhatsApp/email for this run. Bounded: at most 50. */
    deliveries: v.optional(v.array(runDelivery)),
    note: v.optional(v.string()),
    error: v.optional(v.string()),
    nextAttemptAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_dedupeKey', ['dedupeKey'])
    .index('by_company_and_createdAt', ['companyId', 'createdAt'])
    .index('by_rule_and_createdAt', ['ruleId', 'createdAt']),

  /** Simple assignable tasks (AUTO-005); automation actions can create them. */
  tasks: defineTable({
    companyId: v.id('companies'),
    title: v.string(),
    description: v.optional(v.string()),
    assigneeUserId: v.optional(v.id('users')),
    /** YYYY-MM-DD. */
    dueDate: v.optional(v.string()),
    cageId: v.optional(v.id('cages')),
    status: v.union(v.literal('open'), v.literal('done'), v.literal('cancelled')),
    ruleId: v.optional(v.id('automationRules')),
    runId: v.optional(v.id('automationRuns')),
    createdBy: v.optional(v.id('users')),
    completedBy: v.optional(v.id('users')),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_assignee_and_status', ['assigneeUserId', 'status'])
    .index('by_company_and_status', ['companyId', 'status']),

  /** Per-user notification channels and quiet hours (AUTO-003). */
  notificationPreferences: defineTable({
    userId: v.id('users'),
    inApp: v.boolean(),
    sms: v.boolean(),
    whatsapp: v.boolean(),
    email: v.boolean(),
    /** 'HH:MM'–'HH:MM' in the company time zone; external channels pause. */
    quietHours: v.optional(quietHours),
    updatedAt: v.number(),
  }).index('by_user', ['userId']),

  /**
   * Replay guard for field writes sent from a phone's outbox (MOBILE-002).
   * A mutation called with `clientMutationId` records its result here; a
   * retry with the same key (lost response, flaky signal) returns that result
   * instead of writing again. Rows older than 30 days are pruned daily.
   */
  idempotencyKeys: defineTable({
    // Scoped by user (keys are per user); no companyId, so tenant migrations skip it.
    userId: v.id('users'),
    key: v.string(),
    mutation: v.string(),
    result: v.any(),
    createdAt: v.number(),
  })
    .index('by_user_and_key', ['userId', 'key'])
    .index('by_createdAt', ['createdAt']),

  /** Rollups (PLAT-002, convex/lib/rollups.ts): one unit, one batch, one day. */
  unitDailyStats: defineTable(unitDailyStatsFields)
    .index('by_unitId_and_date', ['unitId', 'date'])
    .index('by_unitId_and_batchId_and_date', ['unitId', 'batchId', 'date'])
    .index('by_batchId_and_date', ['batchId', 'date'])
    .index('by_companyId_and_date', ['companyId', 'date']),

  /** Rollups (PLAT-002): one row per occupancy, recomputed by the rollup job. */
  batchStats: defineTable(batchStatsFields)
    .index('by_unitId_and_batchId', ['unitId', 'batchId'])
    .index('by_batchId', ['batchId'])
    .index('by_companyId_and_open', ['companyId', 'open'])
    .index('by_companyId_and_lastDate', ['companyId', 'lastDate']),

  /** Occupancies whose batchStats must be recomputed (one row per pair). */
  rollupDirty: defineTable({
    companyId: v.id('companies'),
    unitId: v.id('cages'),
    batchId: v.id('batches'),
    markedAt: v.number(),
  })
    .index('by_unitId_and_batchId', ['unitId', 'batchId'])
    .index('by_markedAt', ['markedAt']),

  /**
   * A traceable unit of harvested fish (TRACE-004): part or all of one
   * harvest, with its own code, weight, grade and destination. Dispatches
   * send a lot (or part of it) to a customer.
   */
  harvestLots: defineTable({
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    harvestId: v.id('harvestRecords'),
    cageId: v.id('cages'),
    batchId: v.optional(v.id('batches')),
    lotCode: v.string(),
    harvestDate: v.string(),
    weightKg: v.number(),
    fishCount: v.optional(v.number()),
    grade: v.optional(v.string()),
    destination: v.optional(v.string()),
    notes: v.optional(v.string()),
    /** Set by migration M18 for the default lot of a pre-existing harvest. */
    backfilled: v.optional(v.boolean()),
    createdBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_companyId_and_lotCode', ['companyId', 'lotCode'])
    .index('by_companyId_and_harvestDate', ['companyId', 'harvestDate'])
    .index('by_harvestId', ['harvestId'])
    .index('by_batchId', ['batchId']),

  /** A harvest lot leaving the farm for a customer (TRACE-004). */
  dispatches: defineTable({
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    harvestLotId: v.id('harvestLots'),
    customerId: v.optional(v.id('customers')),
    customerName: v.optional(v.string()),
    saleId: v.optional(v.id('sales')),
    dispatchDate: v.string(),
    weightKg: v.number(),
    vehicle: v.optional(v.string()),
    driver: v.optional(v.string()),
    /** Product temperature at loading (°C). */
    temperatureC: v.optional(v.number()),
    notes: v.optional(v.string()),
    withdrawalOverride: v.optional(withdrawalOverride),
    createdBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_harvestLotId', ['harvestLotId'])
    .index('by_companyId_and_dispatchDate', ['companyId', 'dispatchDate'])
    .index('by_customerId', ['customerId']),
})

export default schema
