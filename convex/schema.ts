import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { authTables } from '@convex-dev/auth/server'
import { messagingChannel, messagingProvider } from './messaging/validators'
import { batchStatsFields, unitDailyStatsFields } from './lib/rollupSchema'
import { integrationTables } from './integrations/tables'
import { billingTables } from './billing/tables'
import { botTables } from './bot/tables'
import {
  automationAction,
  automationCondition,
  automationTrigger,
  notifyChannel,
  quietHours,
  runDelivery,
  runStatus,
} from './automation/validators'
import { CURRENCY_CODES } from './lib/currencies'
import {
  reportDefinition,
  reportDeliveryStatus,
  reportRecipient,
  reportVisibility,
  scheduleFrequency,
} from './lib/reportValidators'

const [cur0, cur1, ...curRest] = CURRENCY_CODES.map((c) => v.literal(c))
/** Organization currency codes (I18N-003). */
export const currencyValidator = v.union(cur0, cur1, ...curRest)

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
  /** Larval mortality and survival counts (HAT-003). */
  v.literal('larvalLogs'),
  /** Fingerling transfers, sales and dispatches to other farms (HAT-004, NUR-002). */
  v.literal('nurseryMovements'),
)

/** Records a file can be attached to (D-016, TRACE-005). */
export const fileEntityType = v.union(
  v.literal('healthTreatments'),
  v.literal('harvestLots'),
  v.literal('dispatches'),
  v.literal('complianceRecords'),
  v.literal('biosecurityLogs'),
  /** Photos held by custom photo fields (CUSTOM-001); entityId is the field definition. */
  v.literal('customFieldDefs'),
)

export const complianceFrequency = v.union(
  v.literal('daily'),
  v.literal('weekly'),
  v.literal('monthly'),
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

export const liveFeedKind = v.union(
  v.literal('artemia'),
  v.literal('rotifer'),
  v.literal('microalgae'),
  v.literal('copepod'),
  v.literal('other'),
)
/** million = million organisms (nauplii, rotifers); L = culture volume; g = weight. */
export const liveFeedUnit = v.union(v.literal('million'), v.literal('L'), v.literal('g'))
export const liveFeedEntry = v.object({ kind: liveFeedKind, quantity: v.number(), unit: liveFeedUnit })

/** Records that can carry custom fields (D-007); see lib/customFieldRules. */
export const customEntityValidator = v.union(
  v.literal('cages'),
  v.literal('farmLocations'),
  v.literal('batches'),
  v.literal('dailyRecords'),
  v.literal('biweeklyRecords'),
  v.literal('harvestRecords'),
  v.literal('stockingHistory'),
  v.literal('expenses'),
  v.literal('equipment'),
)
export const customFieldType = v.union(
  v.literal('text'),
  v.literal('long_text'),
  v.literal('number'),
  v.literal('date'),
  v.literal('select'),
  v.literal('multiselect'),
  v.literal('boolean'),
  v.literal('photo'),
)
/** Values on a record, keyed by field key; checked against the definitions on every write. */
export const customValues = v.record(v.string(), v.any())
export const customScalar = v.union(v.string(), v.number(), v.boolean(), v.array(v.string()))
/** Form layouts (CUSTOM-004): lib/formLayouts. */
export const formLayoutField = v.object({
  ref: v.string(),
  width: v.optional(v.union(v.literal('full'), v.literal('half'))),
  showWhen: v.optional(
    v.object({
      ref: v.string(),
      op: v.union(v.literal('is_set'), v.literal('eq'), v.literal('neq')),
      value: v.optional(v.union(v.string(), v.number(), v.boolean())),
    }),
  ),
})
export const formLayoutSection = v.object({
  key: v.string(),
  title: v.optional(v.string()),
  fields: v.array(formLayoutField),
})
/** Dashboard layouts (CUSTOM-005): lib/dashboardLayout. */
export const dashboardWidget = v.object({
  widget: v.string(),
  size: v.union(v.literal('sm'), v.literal('md'), v.literal('half'), v.literal('lg'), v.literal('full')),
})
/** Feeding plans (PROD-015): lib/ration. */
/** lib/earlyWarning ALERT_RULES. */
export const farmAlertRule = v.union(
  v.literal('mortality_spike'),
  v.literal('feed_drop'),
  v.literal('missing_entries'),
  v.literal('low_oxygen'),
  v.literal('temperature_out_of_range'),
  v.literal('fcr_deterioration'),
  v.literal('growth_stall'),
)

export const feedBand = v.object({
  minAbwG: v.number(),
  bodyWeightPct: v.number(),
  feedingsPerDay: v.number(),
  pelletMm: v.number(),
})
export const customCondition = v.object({
  field: v.string(),
  op: v.union(
    v.literal('eq'),
    v.literal('neq'),
    v.literal('in'),
    v.literal('gt'),
    v.literal('lt'),
    v.literal('is_set'),
    v.literal('is_not_set'),
  ),
  value: v.optional(customScalar),
})

const schema = defineSchema({
  ...authTables,
  ...integrationTables,
  ...billingTables,
  ...botTables,

  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    /** Authenticator app confirmed (ENT-003): every new session must pass two-step verification. */
    totpEnabledAt: v.optional(v.number()),
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
    /** Set when the account was anonymized after a deletion request (ENT-005). */
    deletedAt: v.optional(v.number()),
    /** Interface language ('en' | 'fr', I18N-002); unset = organization default. */
    locale: v.optional(v.string()),
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
    /** Custom role (PERM-002); roleKey then holds the role's key. */
    roleId: v.optional(v.id('roles')),
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

  /**
   * Custom roles per organization (PERM-002). Templates (owner, admin,
   * manager, field_staff, viewer) live in code (lib/permissions); rows here
   * are an organization's own roles. permissions are catalog keys.
   */
  roles: defineTable({
    companyId: v.id('companies'),
    key: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    /** Template it was copied from, if any. */
    basedOn: v.optional(v.string()),
    permissions: v.array(v.string()),
    isTemplate: v.optional(v.boolean()),
    archived: v.boolean(),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id('users')),
  }).index('by_companyId_and_key', ['companyId', 'key']),

  /** One-time codes proving a signed-in user owns their email (SEC-005). */
  emailVerifications: defineTable({
    userId: v.id('users'),
    email: v.string(),
    codeHash: v.string(),
    expiresAt: v.number(),
    attempts: v.number(),
  }).index('by_userId', ['userId']),

  /**
   * Culture species an organization farms (D-012): growth targets and the
   * harvest size grades its harvest form offers. `key` matches cages.species.
   */
  species: defineTable({
    companyId: v.id('companies'),
    key: v.string(),
    name: v.string(),
    scientificName: v.optional(v.string()),
    targetHarvestAbwG: v.optional(v.number()),
    targetFcr: v.optional(v.number()),
    /** Expected average daily weight gain in grow-out (g/day). */
    expectedDailyGrowthG: v.optional(v.number()),
    /** Bounded (≤ 12, lib/species MAX_HARVEST_GRADES), heaviest first. */
    harvestGrades: v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        minG: v.optional(v.number()),
        maxG: v.optional(v.number()),
      }),
    ),
    active: v.boolean(),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id('users')),
  }).index('by_companyId_and_key', ['companyId', 'key']),

  /** Physical farm sites under a company (ops + inventory scope). */
  farmLocations: defineTable({
    /** Custom field values (D-007, CUSTOM-001), validated by lib/customFields. */
    custom: v.optional(customValues),
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
    /** Business unit / region the site belongs to (FARM-004); unset = directly under the organization. */
    businessUnitId: v.optional(v.id('businessUnits')),
    updatedAt: v.number(),
  }).index('by_company', ['companyId']),

  /**
   * Optional grouping between organization and site (FARM-004, ENT-001,
   * doc 04 §3.6): regions and business units, nested at most three deep.
   * Sites point at one with farmLocations.businessUnitId.
   */
  businessUnits: defineTable({
    companyId: v.id('companies'),
    name: v.string(),
    code: v.optional(v.string()),
    kind: v.union(v.literal('region'), v.literal('business_unit')),
    parentId: v.optional(v.id('businessUnits')),
    description: v.optional(v.string()),
    active: v.boolean(),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id('users')),
  }).index('by_companyId_and_parentId', ['companyId', 'parentId']),

  /**
   * Subsidiary links (ENT-001): `companyId` is the parent (group)
   * organization, `childCompanyId` the subsidiary. The parent asks, the
   * subsidiary accepts; consolidated reporting (ENT-002) reads only active
   * links whose subsidiary shares reports, and either side can end the link.
   */
  companyLinks: defineTable({
    companyId: v.id('companies'),
    childCompanyId: v.id('companies'),
    status: v.union(
      v.literal('pending'),
      v.literal('active'),
      v.literal('declined'),
      v.literal('ended'),
    ),
    /** Subsidiary's consent to consolidated reporting; it can turn this off. */
    shareReports: v.boolean(),
    note: v.optional(v.string()),
    requestedBy: v.id('users'),
    requestedAt: v.number(),
    respondedBy: v.optional(v.id('users')),
    respondedAt: v.optional(v.number()),
    endedBy: v.optional(v.id('users')),
    endedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_companyId_and_status', ['companyId', 'status'])
    .index('by_childCompanyId_and_status', ['childCompanyId', 'status']),

  /**
   * Departments and teams (ENT-004). A team may sit in a department
   * (parentId). Members and leads are teamMembers rows.
   */
  teams: defineTable({
    companyId: v.id('companies'),
    name: v.string(),
    kind: v.union(v.literal('department'), v.literal('team')),
    parentId: v.optional(v.id('teams')),
    locationId: v.optional(v.id('farmLocations')),
    description: v.optional(v.string()),
    active: v.boolean(),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id('users')),
  }).index('by_companyId_and_kind', ['companyId', 'kind']),

  teamMembers: defineTable({
    companyId: v.id('companies'),
    teamId: v.id('teams'),
    userId: v.id('users'),
    role: v.union(v.literal('lead'), v.literal('member')),
    addedAt: v.number(),
    addedBy: v.optional(v.id('users')),
  })
    .index('by_teamId_and_userId', ['teamId', 'userId'])
    .index('by_companyId_and_userId', ['companyId', 'userId']),

  /**
   * Workforce roster (ENT-004). Minimal personal data (doc 21): name, job,
   * site, department and a work contact. Contact and notes are returned only
   * to holders of workforce.manage. No national ids, birth dates or pay.
   */
  staffRecords: defineTable({
    companyId: v.id('companies'),
    /** Linked app account, when the person signs in. */
    userId: v.optional(v.id('users')),
    fullName: v.string(),
    jobTitle: v.optional(v.string()),
    employeeCode: v.optional(v.string()),
    employmentType: v.optional(
      v.union(v.literal('permanent'), v.literal('contract'), v.literal('casual'), v.literal('seasonal')),
    ),
    locationId: v.optional(v.id('farmLocations')),
    departmentId: v.optional(v.id('teams')),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    status: v.union(v.literal('active'), v.literal('inactive')),
    notes: v.optional(v.string()),
    updatedAt: v.number(),
    updatedBy: v.optional(v.id('users')),
  })
    .index('by_companyId_and_status', ['companyId', 'status'])
    .index('by_companyId_and_userId', ['companyId', 'userId']),

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
    /**
     * Suspended by the platform console or by billing after the grace period
     * (PLAT-104). requireUser refuses members with TENANT_SUSPENDED while set;
     * status stays 'approved' so reactivation restores access unchanged.
     */
    suspendedAt: v.optional(v.number()),
    suspendedBy: v.optional(v.id('users')),
    suspensionReason: v.optional(v.string()),
    suspensionSource: v.optional(v.union(v.literal('platform'), v.literal('billing'))),
    /** Organization profile (M3, D-012). Read with defaults from lib/orgProfile. */
    country: v.optional(v.string()),
    timezone: v.optional(v.string()),
    unitSystem: v.optional(v.union(v.literal('metric'), v.literal('imperial'))),
    defaultLocale: v.optional(v.string()),
    /**
     * Organization words (CUSTOM-003, D-007): override the built-in labels,
     * e.g. cage → pen. Keys are validated against lib/terminology TERM_KEYS.
     */
    terminology: v.optional(v.record(v.string(), v.string())),
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
            /** Tanks, raceways and RAS (fish per m³); falls back to maxDensityFishPerM3. */
            maxDensityTankFishPerM3: v.optional(v.number()),
            /** Warn when a unit reaches this % of its density limit (default 90). */
            densityWarnPct: v.optional(v.number()),
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
            /** Approver must not be the person who requested it (PERM-005). */
            requireDifferentApprover: v.optional(v.boolean()),
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
            /** Any code in lib/currencies (I18N-003); amounts are not converted. */
            currency: v.optional(currencyValidator),
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
        /** Approval notifications and escalation (AUTO-004). Defaults in convex/approvalAlerts.ts. */
        approvalAlerts: v.optional(
          v.object({
            enabled: v.optional(v.boolean()),
            channels: v.optional(v.array(notifyChannel)),
            /** 0 turns escalation off. */
            escalateAfterHours: v.optional(v.number()),
            escalationChannels: v.optional(v.array(notifyChannel)),
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

  /**
   * Logo upload binding (CF-004, same check as fileUploads):
   * companies.generateLogoUploadUrl records who may claim an upload, for which
   * company, with which SHA-256, until when; setLogo needs the caller's own
   * pending row and binds the storage id to it.
   */
  logoUploadRequests: defineTable({
    companyId: v.id('companies'),
    uploadedBy: v.id('users'),
    status: v.union(v.literal('pending'), v.literal('attached')),
    sha256: v.string(),
    storageId: v.optional(v.id('_storage')),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index('by_storageId', ['storageId'])
    .index('by_expiresAt', ['expiresAt']),

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
    /** Custom field values (D-007, CUSTOM-001), validated by lib/customFields. */
    custom: v.optional(customValues),
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
    /** Unit workspace (CAGE-001, POND-001, RAS-001). */
    unitGroupId: v.optional(v.id('unitGroups')),
    waterBodyId: v.optional(v.id('waterBodies')),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    /** Cages: volume inside the net (m³); density uses it before volumeM3. */
    netVolumeM3: v.optional(v.number()),
    /** Cages: net mesh size (mm). */
    meshSizeMm: v.optional(v.number()),
    /** Ponds and raceways: length and width (m). */
    lengthM: v.optional(v.number()),
    widthM: v.optional(v.number()),
    /** Tanks, raceways, RAS: water flow (m³/h) and turnover target (/h). */
    flowM3h: v.optional(v.number()),
    /** Ponds: water source (borehole, river, canal, ...). */
    waterSource: v.optional(v.string()),
    /** Per-unit density limit (fish/m² for ponds, fish/m³ otherwise). */
    maxDensity: v.optional(v.number()),
    statusChangedAt: v.optional(v.number()),
    /** Archived instead of deleted (PROD-013); history stays linked. */
    archivedAt: v.optional(v.number()),
    locationId: v.optional(v.id('farmLocations')),
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_unitGroupId', ['unitGroupId'])
    .index('by_name', ['name'])
    .index('by_status', ['status'])
    .index('by_company', ['companyId'])
    .index('by_company_status', ['companyId', 'status'])
    .index('by_location', ['locationId'])
    .index('by_company_location', ['companyId', 'locationId']),

  /**
   * A lake, reservoir, river or sea area that cages sit in, or the water
   * source of ponds (CAGE-001, PROD-007 context).
   */
  waterBodies: defineTable({
    companyId: v.id('companies'),
    name: v.string(),
    kind: v.union(
      v.literal('lake'),
      v.literal('reservoir'),
      v.literal('river'),
      v.literal('sea'),
      v.literal('lagoon'),
      v.literal('borehole'),
      v.literal('canal'),
      v.literal('other'),
    ),
    locationId: v.optional(v.id('farmLocations')),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    notes: v.optional(v.string()),
    active: v.boolean(),
    updatedAt: v.number(),
  }).index('by_companyId', ['companyId']),

  /**
   * Units managed together: a cage group (mooring line), a pond block or a
   * RAS system (tanks sharing filtration).
   */
  unitGroups: defineTable({
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    name: v.string(),
    kind: v.union(
      v.literal('cage_group'),
      v.literal('pond_block'),
      v.literal('ras_system'),
      v.literal('raceway_line'),
      v.literal('other'),
    ),
    waterBodyId: v.optional(v.id('waterBodies')),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    /** RAS: total system volume (m³) including sumps and filters. */
    systemVolumeM3: v.optional(v.number()),
    notes: v.optional(v.string()),
    active: v.boolean(),
    updatedAt: v.number(),
  })
    .index('by_companyId', ['companyId'])
    .index('by_companyId_and_locationId', ['companyId', 'locationId']),

  /**
   * Water-quality log (Phase 6, M15). One row per measurement event with a
   * field per parameter. `source` says where it came from; rows mirrored
   * from daily/bi-weekly records carry `sourceId` so edits stay in step.
   * Sensor readings stay in `sensorReadings` and are merged on read.
   */
  waterQualityReadings: defineTable({
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    unitId: v.id('cages'),
    measuredAt: v.number(),
    /** Site-local calendar day of measuredAt (YYYY-MM-DD). */
    date: v.string(),
    dissolvedOxygen: v.optional(v.number()),
    temperatureC: v.optional(v.number()),
    ph: v.optional(v.number()),
    ammonia: v.optional(v.number()),
    nitrite: v.optional(v.number()),
    nitrate: v.optional(v.number()),
    salinity: v.optional(v.number()),
    turbidityNtu: v.optional(v.number()),
    secchiCm: v.optional(v.number()),
    alkalinity: v.optional(v.number()),
    co2: v.optional(v.number()),
    /** Depth the sample was taken at (m), for stratified cages and ponds. */
    sampleDepthM: v.optional(v.number()),
    source: v.union(
      v.literal('manual'),
      v.literal('sensor'),
      v.literal('daily_record'),
      v.literal('biweekly_record'),
    ),
    sourceId: v.optional(v.string()),
    /** Parameters outside their thresholds when recorded. */
    breachCount: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id('users')),
  })
    .index('by_unitId_and_measuredAt', ['unitId', 'measuredAt'])
    .index('by_companyId_and_measuredAt', ['companyId', 'measuredAt'])
    .index('by_sourceId', ['sourceId']),

  /** Organization overrides of the default water-quality thresholds. */
  waterQualityThresholds: defineTable({
    companyId: v.id('companies'),
    /** A unit type, or 'all' for every type. */
    unitType: v.union(unitTypeValidator, v.literal('all')),
    parameter: v.string(),
    min: v.optional(v.number()),
    max: v.optional(v.number()),
    updatedBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  }).index('by_companyId', ['companyId']),

  /**
   * Pond water management and water treatments (POND-002): fill, drain,
   * exchange, liming, fertilization, treatment, aeration. Products can be
   * issued from non-feed inventory (Phase 9).
   */
  waterManagementLogs: defineTable({
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    unitId: v.id('cages'),
    date: v.string(),
    kind: v.union(
      v.literal('fill'),
      v.literal('drain'),
      v.literal('exchange'),
      v.literal('liming'),
      v.literal('fertilization'),
      v.literal('treatment'),
      v.literal('aeration'),
      v.literal('other'),
    ),
    /** Share of the water replaced (exchange). */
    exchangePct: v.optional(v.number()),
    volumeM3: v.optional(v.number()),
    /** Hours run (aeration) or duration of the event. */
    hours: v.optional(v.number()),
    product: v.optional(v.string()),
    quantity: v.optional(v.number()),
    quantityUnit: v.optional(v.string()),
    inventoryItemId: v.optional(v.id('inventoryItems')),
    inventoryMovementId: v.optional(v.id('inventoryMovements')),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id('users')),
    createdAt: v.number(),
  })
    .index('by_unitId_and_date', ['unitId', 'date'])
    .index('by_companyId_and_date', ['companyId', 'date']),

  /**
   * Equipment registry (RAS-002): pumps, blowers, aerators, biofilters,
   * nets, oxygen cones and sensors, attached to a unit or a group.
   */
  equipment: defineTable({
    /** Custom field values (D-007, CUSTOM-001), validated by lib/customFields. */
    custom: v.optional(customValues),
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    unitId: v.optional(v.id('cages')),
    unitGroupId: v.optional(v.id('unitGroups')),
    name: v.string(),
    kind: v.union(
      v.literal('pump'),
      v.literal('blower'),
      v.literal('aerator'),
      v.literal('biofilter'),
      v.literal('mechanical_filter'),
      v.literal('uv'),
      v.literal('oxygen_cone'),
      v.literal('net'),
      v.literal('mooring'),
      v.literal('feeder'),
      v.literal('generator'),
      v.literal('sensor'),
      v.literal('boat'),
      v.literal('vehicle'),
      v.literal('other'),
    ),
    status: v.union(
      v.literal('in_service'),
      v.literal('standby'),
      v.literal('faulty'),
      v.literal('under_maintenance'),
      v.literal('retired'),
    ),
    make: v.optional(v.string()),
    model: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    /** Free-text rating, e.g. "2.2 kW, 40 m³/h" or "mesh 25 mm". */
    rating: v.optional(v.string()),
    installedOn: v.optional(v.string()),
    maintenanceIntervalDays: v.optional(v.number()),
    lastMaintainedOn: v.optional(v.string()),
    nextMaintenanceDue: v.optional(v.string()),
    /** Asset register (INV-012): tag, purchase and warranty. */
    assetTag: v.optional(v.string()),
    purchasedOn: v.optional(v.string()),
    purchaseCost: v.optional(v.number()),
    supplier: v.optional(v.string()),
    warrantyUntil: v.optional(v.string()),
    /** Spare parts kept for it (non-feed inventory items, Phase 9). */
    sparePartItemIds: v.optional(v.array(v.id('inventoryItems'))),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_companyId', ['companyId'])
    .index('by_unitId', ['unitId'])
    .index('by_companyId_and_nextMaintenanceDue', ['companyId', 'nextMaintenanceDue']),

  /**
   * Net inspections, maintenance, repairs, cleaning and calibration
   * (CAGE-002, RAS-002), on a unit and/or a piece of equipment.
   */
  unitInspections: defineTable({
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    unitId: v.optional(v.id('cages')),
    equipmentId: v.optional(v.id('equipment')),
    kind: v.union(
      v.literal('net_inspection'),
      v.literal('maintenance'),
      v.literal('repair'),
      v.literal('cleaning'),
      v.literal('calibration'),
      v.literal('inspection'),
    ),
    date: v.string(),
    result: v.union(v.literal('ok'), v.literal('needs_attention'), v.literal('failed')),
    /** Checklist answers (at most 30). */
    checklist: v.optional(
      v.array(v.object({ item: v.string(), ok: v.boolean(), note: v.optional(v.string()) })),
    ),
    findings: v.optional(v.string()),
    actionsTaken: v.optional(v.string()),
    nextDueOn: v.optional(v.string()),
    performedBy: v.optional(v.string()),
    cost: v.optional(v.number()),
    /** Spare parts issued from inventory for this job (at most 20). */
    partsUsed: v.optional(
      v.array(
        v.object({
          itemId: v.id('inventoryItems'),
          quantity: v.number(),
          movementId: v.optional(v.id('inventoryMovements')),
        }),
      ),
    ),
    createdBy: v.optional(v.id('users')),
    createdAt: v.number(),
  })
    .index('by_unitId_and_date', ['unitId', 'date'])
    .index('by_equipmentId_and_date', ['equipmentId', 'date'])
    .index('by_companyId_and_date', ['companyId', 'date']),

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
    /** The daily record this row came from (source 'daily'; INV-003). */
    dailyRecordId: v.optional(v.id('dailyRecords')),
    /**
     * Daily rows (PROD-000h): kg of `quantity` fed from the cage-side bin
     * (feed issued earlier); the rest was deducted from the store.
     */
    fromBinKg: v.optional(v.number()),
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

  /**
   * Feed issued to a cage and not fed yet (PROD-000h, Q-003 assumed answer):
   * an issue moves stock from the store to the cage's bin, a daily entry's
   * feed is consumption and is taken from the bin first, then the store.
   */
  cageFeedBins: defineTable({
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    cageId: v.id('cages'),
    feedTypeId: v.id('feedTypes'),
    quantityKg: v.number(),
    updatedAt: v.number(),
  })
    .index('by_cage_and_feedTypeId', ['cageId', 'feedTypeId'])
    .index('by_company', ['companyId']),

  dailyRecords: defineTable({
    /** Custom field values (D-007, CUSTOM-001), validated by lib/customFields. */
    custom: v.optional(customValues),
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
    /** Custom field values (D-007, CUSTOM-001), validated by lib/customFields. */
    custom: v.optional(customValues),
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
    /** Custom field values (D-007, CUSTOM-001), validated by lib/customFields. */
    custom: v.optional(customValues),
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
      /** Legacy one-row transfer (source site not recorded, doc 08 §6.3). */
      v.literal('transfer'),
      v.literal('reversal'),
      /** Two-legged site-to-site transfer (INV-002): out at the source, in at the destination. */
      v.literal('transfer_out'),
      v.literal('transfer_in'),
    ),
    /** Signed kg: positive = stock in, negative = stock out. */
    quantityKg: v.number(),
    bags: v.optional(v.number()),
    transactionDate: v.number(),
    referenceId: v.optional(v.string()),
    /** Links the two legs of a transfer_out / transfer_in pair. */
    transferId: v.optional(v.string()),
    /** Batch and expiry of the lot an inbound row created or a transfer moved. */
    batchNumber: v.optional(v.string()),
    expiryDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
  })
    .index('by_feed_type', ['feedTypeId'])
    .index('by_company', ['companyId'])
    .index('by_reference', ['referenceId'])
    .index('by_transfer', ['transferId'])
    .index('by_location', ['locationId'])
    .index('by_company_location', ['companyId', 'locationId']),

  stockingHistory: defineTable({
    /** Custom field values (D-007, CUSTOM-001), validated by lib/customFields. */
    custom: v.optional(customValues),
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
    /** Set when a super-admin wrote this during support access (ENT-006). */
    actAsSessionId: v.optional(v.id('actAsSessions')),
    /** Set when the change came from the farm bot (BOT-003): chat channel and provider message id. */
    channel: v.optional(v.union(v.literal('whatsapp'), v.literal('telegram'))),
    sourceMessageId: v.optional(v.string()),
    /**
     * Hash chain per company (TRACE-007, convex/lib/auditChain.ts): position,
     * the previous row's hash, write time and SHA-256 over the canonical row.
     * Absent on rows written before TRACE-007 ("unchained").
     */
    seq: v.optional(v.number()),
    prevHash: v.optional(v.string()),
    hash: v.optional(v.string()),
    at: v.optional(v.number()),
  })
    .index('by_user', ['userId'])
    .index('by_table', ['tableName'])
    .index('by_company', ['companyId'])
    .index('by_company_and_tableName', ['companyId', 'tableName'])
    .index('by_companyId_and_seq', ['companyId', 'seq']),

  /** Last link of each company's audit hash chain (TRACE-007). */
  auditChainHeads: defineTable({
    companyId: v.id('companies'),
    seq: v.number(),
    hash: v.string(),
    updatedAt: v.number(),
  }).index('by_companyId', ['companyId']),

  /** Results of walking a company's audit chain (TRACE-007). */
  auditChainVerifications: defineTable({
    companyId: v.id('companies'),
    status: v.union(v.literal('running'), v.literal('ok'), v.literal('broken')),
    /** Rows checked so far. */
    checkedCount: v.number(),
    /** Last verified link, for continuing in the next batch. */
    lastSeq: v.number(),
    lastHash: v.optional(v.string()),
    brokenAtSeq: v.optional(v.number()),
    reason: v.optional(v.string()),
    requestedBy: v.optional(v.id('users')),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
  }).index('by_companyId', ['companyId']),

  /** Organization data exports (zip of JSON + CSV per table), kept 7 days. */
  dataExports: defineTable({
    companyId: v.id('companies'),
    requestedBy: v.id('users'),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('ready'),
      v.literal('failed'),
      v.literal('expired'),
    ),
    storageId: v.optional(v.id('_storage')),
    sizeBytes: v.optional(v.number()),
    /** Rows written per table. */
    tableCounts: v.optional(v.record(v.string(), v.number())),
    /** Tables cut at the per-table row cap. */
    truncatedTables: v.optional(v.array(v.string())),
    error: v.optional(v.string()),
    createdAt: v.number(),
    finishedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  })
    .index('by_companyId', ['companyId'])
    .index('by_status_and_expiresAt', ['status', 'expiresAt']),

  /**
   * Organization and account deletion requests (ENT-005). Platform admins
   * approve; the work happens after a grace period (lib/governance).
   */
  dataRequests: defineTable({
    kind: v.union(v.literal('org_deletion'), v.literal('account_deletion')),
    companyId: v.optional(v.id('companies')),
    /** Requester; for an account deletion, the account to delete. */
    userId: v.id('users'),
    status: v.union(
      v.literal('requested'),
      v.literal('cancelled'),
      v.literal('approved'),
      v.literal('rejected'),
      v.literal('in_progress'),
      v.literal('completed'),
    ),
    reason: v.optional(v.string()),
    requestedAt: v.number(),
    decidedBy: v.optional(v.id('users')),
    decidedAt: v.optional(v.number()),
    decisionNote: v.optional(v.string()),
    /** approvedAt + grace; work starts after this. */
    graceEndsAt: v.optional(v.number()),
    /** Company status before approval, restored if cancelled in the grace period. */
    previousCompanyStatus: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    /** Rows deleted per table (org deletions). */
    purgedCounts: v.optional(v.record(v.string(), v.number())),
    /** Audit rows are kept until then, and purged after. */
    auditRetainUntil: v.optional(v.number()),
    auditPurgedAt: v.optional(v.number()),
  })
    .index('by_status_and_graceEndsAt', ['status', 'graceEndsAt'])
    .index('by_companyId_and_status', ['companyId', 'status'])
    .index('by_userId_and_status', ['userId', 'status'])
    .index('by_status_and_auditRetainUntil', ['status', 'auditRetainUntil']),

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
    /** INT-003: an inbound webhook's verification secret. */
    inboundWebhookId: v.optional(v.id('inboundWebhooks')),
    /** INT-009: an organization's LLM provider key. */
    llmCredentialId: v.optional(v.id('llmCredentials')),
    /** base64 AES-GCM ciphertext (with tag) of the JSON credentials. */
    ciphertext: v.string(),
    /** base64 12-byte IV, random per encryption. */
    iv: v.string(),
    keyVersion: v.number(),
    updatedAt: v.number(),
  })
    .index('by_channel', ['channelId'])
    .index('by_webhookEndpointId', ['webhookEndpointId'])
    .index('by_inboundWebhookId', ['inboundWebhookId'])
    .index('by_llmCredentialId', ['llmCredentialId']),

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
   * Pending codes confirming an account's own phone number (ORG-002). An
   * admin-set number stays unverified (users.phoneVerificationTime unset, no
   * phone sign-in) until its owner enters a code sent to it. One row per
   * user; the hash is bound to the sign-in session. Only hashes.
   */
  phoneConfirmCodes: defineTable({
    userId: v.id('users'),
    phone: v.string(),
    codeHash: v.string(),
    expiresAt: v.number(),
    attempts: v.number(),
    createdAt: v.number(),
  }).index('by_user', ['userId']),

  /**
   * Two-step verification state per sign-in session (SEC-007). A session is
   * verified when verifiedAt is set. Pending codes are stored hashed.
   * `companyId` is the organization whose policy accepted the verification;
   * after switching organization it counts only if lib/authz
   * mfaRowCountsFor says the new one accepts it (ORG-002).
   */
  mfaSessions: defineTable({
    userId: v.id('users'),
    sessionId: v.id('authSessions'),
    /** Absent: platform scope (a company-less account, e.g. a super_admin). */
    companyId: v.optional(v.id('companies')),
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
    method: v.optional(
      v.union(
        v.literal('otp'),
        v.literal('phone_login'),
        v.literal('policy_enable'),
        v.literal('totp'),
        v.literal('recovery_code'),
      ),
    ),
  })
    .index('by_session', ['sessionId'])
    .index('by_user', ['userId']),

  /**
   * Authenticator-app factor (ENT-003, TOTP RFC 6238). One row per user;
   * `confirmedAt` is set once the first code is entered. `lastStep` blocks
   * replay of a code within its 30 s window.
   */
  mfaTotp: defineTable({
    userId: v.id('users'),
    /** Base32 secret, AES-GCM encrypted with the deployment key (lib/crypto, AAD `totp:<userId>`). */
    secretEnc: v.object({ ciphertext: v.string(), iv: v.string(), keyVersion: v.number() }),
    confirmedAt: v.optional(v.number()),
    lastStep: v.optional(v.number()),
    failedAttempts: v.optional(v.number()),
    lockedUntil: v.optional(v.number()),
    createdAt: v.number(),
  }).index('by_userId', ['userId']),

  /** Single-use recovery codes for the TOTP factor, stored as SHA-256 hashes. */
  mfaRecoveryCodes: defineTable({
    userId: v.id('users'),
    codeHash: v.string(),
    usedAt: v.optional(v.number()),
  })
    .index('by_userId', ['userId'])
    .index('by_userId_and_codeHash', ['userId', 'codeHash']),

  /**
   * Super-admin support access to one organization (ENT-006, doc 07 §3.8).
   * While a row is live (no endedAt, expiresAt ahead) requireUser resolves the
   * admin into `companyId` as a tenant admin; read-only unless allowWrites.
   * Started, ended and every write are audited under the tenant.
   */
  actAsSessions: defineTable({
    adminUserId: v.id('users'),
    companyId: v.id('companies'),
    reason: v.string(),
    allowWrites: v.boolean(),
    startedAt: v.number(),
    expiresAt: v.number(),
    endedAt: v.optional(v.number()),
    endedReason: v.optional(v.union(v.literal('stopped'), v.literal('expired'), v.literal('replaced'))),
  })
    .index('by_adminUserId_and_endedAt', ['adminUserId', 'endedAt'])
    .index('by_companyId_and_startedAt', ['companyId', 'startedAt']),

  /**
   * Single-use proof that a Turnstile challenge passed (CF-003, doc 17 §Stage 2).
   * Written by humanVerification.verifyHuman, consumed by sign-up, password
   * reset, company registration and invite acceptance. Stored hashed.
   */
  humanTickets: defineTable({
    ticketHash: v.string(),
    purpose: v.string(),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
    /**
     * Sign-up grant (CF-003): when a used ticket's sign-up then fails, the same
     * ticket is accepted again for this email until grantExpiresAt.
     */
    grantEmail: v.optional(v.string()),
    grantExpiresAt: v.optional(v.number()),
    grantUses: v.optional(v.number()),
  })
    .index('by_ticketHash', ['ticketHash'])
    .index('by_expiresAt', ['expiresAt']),

  /**
   * Consecutive password sign-in failures per email (CF-003, authGuard.ts).
   * Kept for unknown emails too; reset on a successful sign-in.
   */
  signInFailures: defineTable({
    email: v.string(),
    count: v.number(),
    lastFailedAt: v.number(),
  }).index('by_email', ['email']),

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
    /** Sales by count (fingerlings, NUR-002): fish sold and price per fish. */
    unitCount: v.optional(v.number()),
    pricePerUnit: v.optional(v.number()),
    batchId: v.optional(v.id('batches')),
    /**
     * Σ of the sale's live `salePayments` (INV-009). Absent on sales with no
     * recorded payment; paymentStatus then stays the manual flag.
     */
    amountPaid: v.optional(v.number()),
    /** Current invoice for the sale (INV-009). */
    invoiceId: v.optional(v.id('invoices')),
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

  /**
   * Money received against a sale (INV-009). Removing a payment voids it
   * (kept for the audit trail); `sales.amountPaid` is the Σ of live rows.
   */
  salePayments: defineTable({
    companyId: v.id('companies'),
    saleId: v.id('sales'),
    locationId: v.optional(v.id('farmLocations')),
    amount: v.number(),
    paidDate: v.string(),
    method: v.union(
      v.literal('cash'),
      v.literal('mobile_money'),
      v.literal('bank'),
      v.literal('cheque'),
      v.literal('other'),
    ),
    reference: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id('users')),
    voidedAt: v.optional(v.number()),
    voidReason: v.optional(v.string()),
  })
    .index('by_sale', ['saleId'])
    .index('by_company_and_paidDate', ['companyId', 'paidDate']),

  /**
   * Invoice for one sale (INV-009), numbered INV-0001… per company. A void
   * invoice keeps its number; issuing again gives the sale a new one.
   */
  invoices: defineTable({
    companyId: v.id('companies'),
    saleId: v.id('sales'),
    seq: v.number(),
    number: v.string(),
    issueDate: v.string(),
    dueDate: v.optional(v.string()),
    customerId: v.optional(v.id('customers')),
    customerName: v.string(),
    amount: v.number(),
    notes: v.optional(v.string()),
    locationId: v.optional(v.id('farmLocations')),
    createdBy: v.optional(v.id('users')),
    voidedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_company_and_seq', ['companyId', 'seq'])
    .index('by_sale', ['saleId']),

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
    /** Custom field values (D-007, CUSTOM-001), validated by lib/customFields. */
    custom: v.optional(customValues),
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

  /**
   * One day of larval rearing for a batch in a unit (HAT-003): deaths seen,
   * the survival count (volumetric estimate), feeding and water. Deaths and
   * the count post to the engine (source 'larvalLogs'); saving the day again
   * replaces its events.
   */
  larvalLogs: defineTable({
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    unitId: v.id('cages'),
    batchId: v.id('batches'),
    logDate: v.string(),
    mortality: v.optional(v.number()),
    /** Larvae counted alive at the end of the day; the ledger is set to it. */
    countedAlive: v.optional(v.number()),
    /** At most 10 entries. */
    liveFeed: v.optional(v.array(liveFeedEntry)),
    dryFeedG: v.optional(v.number()),
    feedingsPerDay: v.optional(v.number()),
    temperatureC: v.optional(v.number()),
    dissolvedOxygen: v.optional(v.number()),
    ph: v.optional(v.number()),
    salinityPpt: v.optional(v.number()),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_unitId_and_batchId_and_logDate', ['unitId', 'batchId', 'logDate'])
    .index('by_batchId_and_logDate', ['batchId', 'logDate'])
    .index('by_companyId_and_logDate', ['companyId', 'logDate']),

  /**
   * Live feed culture log (HAT-003): artemia, rotifers, algae produced, used
   * and discarded, inventory-style. Uses recorded on a larval log are written
   * here with `larvalLogId` and replaced when the log is saved again.
   */
  liveFeedLogs: defineTable({
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    date: v.string(),
    kind: liveFeedKind,
    movement: v.union(v.literal('produced'), v.literal('used'), v.literal('discarded')),
    /** Always positive; the movement gives the sign. */
    quantity: v.number(),
    unit: liveFeedUnit,
    /** Culture tank or batch name. */
    culture: v.optional(v.string()),
    /** Cysts, algae paste or enrichment used to produce it. */
    inputNote: v.optional(v.string()),
    larvalLogId: v.optional(v.id('larvalLogs')),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_companyId_and_date', ['companyId', 'date'])
    .index('by_larvalLogId', ['larvalLogId']),

  /**
   * Fingerlings leaving a nursery unit (HAT-004, NUR-002): a transfer to
   * another unit of the farm (engine transfer, the batch moves with them), a
   * sale by count (a `sales` row) or a dispatch to another farm.
   */
  nurseryMovements: defineTable({
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    kind: v.union(v.literal('transfer'), v.literal('sale'), v.literal('external')),
    moveDate: v.string(),
    sourceUnitId: v.id('cages'),
    batchId: v.id('batches'),
    quantity: v.number(),
    abwG: v.number(),
    destinationUnitId: v.optional(v.id('cages')),
    destinationBatchId: v.optional(v.id('batches')),
    /** Buyer or receiving farm for sales and external dispatches. */
    destinationName: v.optional(v.string()),
    saleId: v.optional(v.id('sales')),
    status: v.union(v.literal('approved'), v.literal('reversed')),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_companyId_and_moveDate', ['companyId', 'moveDate'])
    .index('by_batchId', ['batchId']),

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
    /** Custom field values (D-007, CUSTOM-001), validated by lib/customFields. */
    custom: v.optional(customValues),
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
   * Cycle count at one site (INV-011). Starting snapshots what the system
   * expects; posting writes one adjustment per line whose count differs.
   */
  stockCounts: defineTable({
    companyId: v.id('companies'),
    locationId: v.id('farmLocations'),
    countDate: v.string(),
    status: v.union(v.literal('draft'), v.literal('posted'), v.literal('cancelled')),
    lines: v.array(
      v.object({
        kind: v.union(v.literal('feed'), v.literal('item')),
        feedTypeId: v.optional(v.id('feedTypes')),
        itemId: v.optional(v.id('inventoryItems')),
        name: v.string(),
        unit: v.string(),
        expected: v.number(),
        counted: v.optional(v.number()),
        /** Signed adjustment posted for this line, when there was a difference. */
        variance: v.optional(v.number()),
      }),
    ),
    notes: v.optional(v.string()),
    createdBy: v.optional(v.id('users')),
    postedBy: v.optional(v.id('users')),
    postedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_company_and_location', ['companyId', 'locationId'])
    .index('by_company', ['companyId']),

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
    /** Assigned to a team (ENT-004): any member can close it. */
    teamId: v.optional(v.id('teams')),
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
    .index('by_company_and_status', ['companyId', 'status'])
    .index('by_teamId_and_status', ['teamId', 'status']),

  /**
   * Outbound SMS/WhatsApp/email of system notifications that are not
   * automation runs (approval alerts, AUTO-003/004). Sent by
   * convex/notificationDispatch.ts; kept 30 days.
   */
  notificationDispatches: defineTable({
    companyId: v.id('companies'),
    /** e.g. 'approval.requested', 'approval.escalated'. */
    source: v.string(),
    title: v.string(),
    status: runStatus,
    attempts: v.number(),
    maxAttempts: v.number(),
    /** Bounded: at most 50. */
    deliveries: v.array(runDelivery),
    error: v.optional(v.string()),
    nextAttemptAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_company_and_createdAt', ['companyId', 'createdAt'])
    .index('by_createdAt', ['createdAt']),

  /**
   * Per-user display preferences (CUSTOM-007): date/time format, personal
   * currency fallback and the phone bottom-bar shortcuts (UX-004). Replaces
   * the per-browser `userSettings` localStorage key; the client keeps a
   * per-user copy for offline first paint.
   */
  userPreferences: defineTable({
    userId: v.id('users'),
    dateFormat: v.optional(v.string()),
    timeFormat: v.optional(v.string()),
    currency: v.optional(v.string()),
    notifications: v.optional(
      v.object({
        email: v.boolean(),
        push: v.boolean(),
        lowFeed: v.boolean(),
        mortalityAlert: v.boolean(),
        waterQualityAlert: v.boolean(),
      }),
    ),
    dashboard: v.optional(
      v.object({
        defaultTimeRange: v.string(),
        showCharts: v.boolean(),
        showMetrics: v.boolean(),
        showStockings: v.boolean(),
      }),
    ),
    /** Routes pinned to the phone bottom bar, in order (at most 5). */
    mobileShortcuts: v.optional(v.array(v.string())),
    /** Set when the row was created from this browser's old local settings. */
    importedFromDeviceAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index('by_userId', ['userId']),

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

  /**
   * Provider-neutral file register (D-016, TRACE-005). A row is one stored
   * file attached to one record; `provider` says where the bytes live
   * (Convex storage today, R2 later via CF-005). Bytes are only served
   * through short-lived download tokens issued to the owning company.
   */
  files: defineTable({
    companyId: v.id('companies'),
    /**
     * Site of the owning record (PERM-004): the record's site, or for a
     * custom-field photo the site of the record it is for. Unset on
     * company-level records and on rows written before it was recorded.
     */
    locationId: v.optional(v.id('farmLocations')),
    entityType: fileEntityType,
    entityId: v.string(),
    /** Where the bytes live (CF-005): Convex storage, or R2 when the R2_* env vars are set. */
    provider: v.union(v.literal('convex'), v.literal('r2')),
    /** Convex blob; absent for R2-only rows, kept on backfilled rows for the grace period. */
    storageId: v.optional(v.id('_storage')),
    /** R2 object key for provider 'r2'. */
    r2Key: v.optional(v.string()),
    /**
     * Thumbnail made in the browser for an image (CF-004, doc 14 §2.5): a
     * second private object bound to the same upload, on Convex storage
     * (thumbStorageId) or R2 (thumbR2Key). Absent on documents and older rows.
     */
    thumbStorageId: v.optional(v.id('_storage')),
    thumbR2Key: v.optional(v.string()),
    thumbMime: v.optional(v.string()),
    thumbSize: v.optional(v.number()),
    name: v.string(),
    mime: v.string(),
    size: v.number(),
    uploadedBy: v.id('users'),
    createdAt: v.number(),
  })
    .index('by_companyId_and_entityType_and_entityId', ['companyId', 'entityType', 'entityId'])
    .index('by_storageId', ['storageId'])
    .index('by_thumbStorageId', ['thumbStorageId']),

  /** One-time-ish download grants: valid for a few minutes, stored hashed. */
  fileDownloadTokens: defineTable({
    tokenHash: v.string(),
    fileId: v.id('files'),
    companyId: v.id('companies'),
    userId: v.id('users'),
    /** 'thumb' grants the file's thumbnail only (CF-004); absent = the file. */
    variant: v.optional(v.literal('thumb')),
    expiresAt: v.number(),
  })
    .index('by_tokenHash', ['tokenHash'])
    .index('by_expiresAt', ['expiresAt']),

  /**
   * Upload binding (CF-004, doc 16 §9.1): files.generateUploadUrl records who
   * may attach an upload, for which record, until when. files.attach needs the
   * caller's own pending row and binds the storage id to it, so an upload can
   * only be claimed by the member (and company) that asked for it.
   */
  fileUploads: defineTable({
    companyId: v.id('companies'),
    uploadedBy: v.id('users'),
    entityType: fileEntityType,
    entityId: v.string(),
    status: v.union(v.literal('pending'), v.literal('attached')),
    /** SHA-256 (hex) of the bytes the client said it would upload; must match _storage. */
    sha256: v.string(),
    /** Set when attached. */
    storageId: v.optional(v.id('_storage')),
    fileId: v.optional(v.id('files')),
    /** 'r2' when the upload was a presigned R2 PUT (absent = Convex storage). */
    provider: v.optional(v.union(v.literal('convex'), v.literal('r2'))),
    /** Server-chosen R2 object key, `files/<companyId>/<uploadId>`. */
    r2Key: v.optional(v.string()),
    /** Content type signed into the R2 PUT. */
    contentType: v.optional(v.string()),
    /** Optional thumbnail upload (CF-004): declared SHA-256 and type; R2 key `<r2Key>.thumb`. */
    thumbSha256: v.optional(v.string()),
    thumbContentType: v.optional(v.string()),
    thumbR2Key: v.optional(v.string()),
    /** Site a custom-field photo is for (PERM-004); copied to files.locationId. */
    locationId: v.optional(v.id('farmLocations')),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index('by_storageId', ['storageId'])
    .index('by_expiresAt', ['expiresAt']),

  /** Biosecurity log per site (TRACE-006): visitors, vehicles, disinfection. */
  biosecurityLogs: defineTable({
    companyId: v.id('companies'),
    locationId: v.id('farmLocations'),
    date: v.string(),
    kind: v.union(
      v.literal('visitor'),
      v.literal('vehicle'),
      v.literal('disinfection'),
      v.literal('other'),
    ),
    /** Visitor or driver name. */
    person: v.optional(v.string()),
    organisation: v.optional(v.string()),
    vehicle: v.optional(v.string()),
    purpose: v.optional(v.string()),
    /** Area, unit or equipment disinfected or visited. */
    area: v.optional(v.string()),
    disinfectant: v.optional(v.string()),
    /** Footbath / wheel-dip / hand-wash done on entry. */
    entryControlsDone: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    createdBy: v.id('users'),
    updatedAt: v.number(),
  })
    .index('by_companyId_and_date', ['companyId', 'date'])
    .index('by_companyId_and_locationId_and_date', ['companyId', 'locationId', 'date']),

  /** A checklist with a due frequency (TRACE-006). */
  complianceTemplates: defineTable({
    companyId: v.id('companies'),
    /** Set for the built-in templates so seeding is idempotent. */
    key: v.optional(v.string()),
    name: v.string(),
    description: v.optional(v.string()),
    frequency: complianceFrequency,
    /** Bounded: at most 50 items. */
    items: v.array(v.object({ id: v.string(), label: v.string(), required: v.boolean() })),
    active: v.boolean(),
    createdBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_companyId', ['companyId'])
    .index('by_companyId_and_key', ['companyId', 'key']),

  /** A completed checklist for one site and one period (TRACE-006). */
  /** Custom field definitions per organization and entity (D-007, CUSTOM-001). */
  customFieldDefs: defineTable({
    companyId: v.id('companies'),
    entity: customEntityValidator,
    key: v.string(),
    label: v.string(),
    helpText: v.optional(v.string()),
    type: customFieldType,
    /** Display unit for numbers (kg, mm, °C …). */
    unit: v.optional(v.string()),
    options: v.optional(
      v.array(v.object({ value: v.string(), label: v.string(), archived: v.optional(v.boolean()) })),
    ),
    validation: v.optional(
      v.object({
        min: v.optional(v.number()),
        max: v.optional(v.number()),
        maxLength: v.optional(v.number()),
        pattern: v.optional(v.string()),
        integer: v.optional(v.boolean()),
      }),
    ),
    required: v.boolean(),
    defaultValue: v.optional(customScalar),
    /** Show (and require) only when every condition holds. */
    conditions: v.optional(v.array(customCondition)),
    /** Only records at these sites; empty = every site. */
    locationIds: v.optional(v.array(v.id('farmLocations'))),
    sortOrder: v.number(),
    archived: v.boolean(),
    updatedBy: v.id('users'),
    updatedAt: v.number(),
  })
    .index('by_companyId_and_entity_and_sortOrder', ['companyId', 'entity', 'sortOrder'])
    .index('by_companyId_and_entity_and_key', ['companyId', 'entity', 'key']),

  /** Saved arrangement of a record form (CUSTOM-004); bounded by lib/formLayouts LAYOUT_LIMITS. */
  formLayouts: defineTable({
    companyId: v.id('companies'),
    /** lib/formLayouts FORM_CATALOG key, e.g. 'production.sampling'. */
    formKey: v.string(),
    sections: v.array(formLayoutSection),
    updatedBy: v.id('users'),
    updatedAt: v.number(),
  }).index('by_companyId_and_formKey', ['companyId', 'formKey']),

  /** Dashboard widget list (CUSTOM-005): organization default (no userId) or one user's override. */
  dashboardLayouts: defineTable({
    companyId: v.id('companies'),
    /** lib/dashboardLayout DASHBOARD_KEYS. */
    key: v.string(),
    userId: v.optional(v.id('users')),
    /** ≤ MAX_WIDGETS, in display order. */
    widgets: v.array(dashboardWidget),
    updatedBy: v.id('users'),
    updatedAt: v.number(),
  }).index('by_companyId_and_key_and_userId', ['companyId', 'key', 'userId']),

  /** Feed table per species (PROD-015); species without a row use lib/ration DEFAULT_FEED_TABLES. */
  feedingPlans: defineTable({
    companyId: v.id('companies'),
    speciesKey: v.string(),
    name: v.string(),
    /** ≤ RATION_LIMITS.bandsPerTable, ascending minAbwG from 0. */
    bands: v.array(feedBand),
    updatedBy: v.id('users'),
    updatedAt: v.number(),
  }).index('by_companyId_and_speciesKey', ['companyId', 'speciesKey']),

  /**
   * Early-warning alerts (AI-001, lib/earlyWarning): one live row per unit and
   * rule; the daily evaluation refreshes it (idempotent per unit/day/rule).
   * Text is rendered from `rule` + `evidence` in the reader's language.
   */
  farmAlerts: defineTable({
    companyId: v.id('companies'),
    locationId: v.optional(v.id('farmLocations')),
    unitId: v.id('cages'),
    batchId: v.optional(v.id('batches')),
    unitName: v.string(),
    rule: farmAlertRule,
    severity: v.union(v.literal('info'), v.literal('warning'), v.literal('critical')),
    status: v.union(v.literal('open'), v.literal('acknowledged'), v.literal('resolved')),
    /** Business day the alert was raised for. */
    date: v.string(),
    /** Last evaluated day the condition still held. */
    lastSeenDate: v.string(),
    evidence: v.record(v.string(), v.union(v.string(), v.number(), v.null())),
    notifiedAt: v.optional(v.number()),
    acknowledgedBy: v.optional(v.id('users')),
    acknowledgedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.id('users')),
    resolvedAt: v.optional(v.number()),
    /** Closed by the evaluation when the condition cleared. */
    autoResolved: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_companyId_and_status', ['companyId', 'status'])
    .index('by_unitId_and_rule', ['unitId', 'rule'])
    .index('by_companyId_and_date', ['companyId', 'date']),

  /** Weekly natural-language report (AI-003, lib/weeklyReport), per site or company-wide. */
  weeklyReports: defineTable({
    companyId: v.id('companies'),
    /** Absent: company-wide (visible to all-sites members only). */
    locationId: v.optional(v.id('farmLocations')),
    /** Sunday the week ends on. */
    weekEnd: v.string(),
    lang: v.union(v.literal('en'), v.literal('fr')),
    text: v.string(),
    /** Costs, rendered by code; shown only with finance.view. */
    financeText: v.optional(v.string()),
    source: v.union(v.literal('llm'), v.literal('template')),
    providerId: v.optional(v.string()),
    model: v.optional(v.string()),
    /** The data pack the text was written from (JSON, no costs). */
    packJson: v.string(),
    requestedBy: v.optional(v.id('users')),
    deliveredAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_companyId_and_weekEnd', ['companyId', 'weekEnd'])
    .index('by_companyId_and_locationId_and_weekEnd_and_lang', ['companyId', 'locationId', 'weekEnd', 'lang']),

  complianceRecords: defineTable({
    companyId: v.id('companies'),
    locationId: v.id('farmLocations'),
    templateId: v.id('complianceTemplates'),
    /** 2026-11-18 (daily), 2026-W47 (weekly) or 2026-11 (monthly). */
    period: v.string(),
    completedOn: v.string(),
    /** One answer per template item (bounded by the template). */
    answers: v.array(v.object({ itemId: v.string(), ok: v.boolean(), note: v.optional(v.string()) })),
    /** Whether every required item passed. */
    passed: v.boolean(),
    notes: v.optional(v.string()),
    completedBy: v.id('users'),
    updatedAt: v.number(),
  })
    .index('by_templateId_and_locationId_and_period', ['templateId', 'locationId', 'period'])
    .index('by_companyId_and_completedOn', ['companyId', 'completedOn']),

  /**
   * A saved report definition (ANLY-001, convex/reportBuilder.ts): dataset,
   * dimensions, measures, filters, range and chart. `private` reports are
   * seen by their author only; `company` reports by every member who may
   * read the dataset.
   */
  savedReports: defineTable({
    companyId: v.id('companies'),
    name: v.string(),
    description: v.optional(v.string()),
    visibility: reportVisibility,
    definition: reportDefinition,
    createdBy: v.id('users'),
    updatedBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_companyId_and_visibility', ['companyId', 'visibility'])
    .index('by_companyId_and_createdBy', ['companyId', 'createdBy']),

  /** A saved report emailed as CSV on a schedule (ANLY-007, convex/reportSchedules.ts). */
  reportSchedules: defineTable({
    companyId: v.id('companies'),
    reportId: v.id('savedReports'),
    frequency: scheduleFrequency,
    /** HH:MM in `timezone`. */
    localTime: v.string(),
    /** 0 = Sunday … 6 = Saturday (weekly). */
    weekday: v.optional(v.number()),
    /** 1–28 (monthly). */
    dayOfMonth: v.optional(v.number()),
    timezone: v.string(),
    /** Members of the company; at most 20. */
    recipientIds: v.array(v.id('users')),
    enabled: v.boolean(),
    /** Unset while disabled. */
    nextRunAt: v.optional(v.number()),
    lastRunAt: v.optional(v.number()),
    lastStatus: v.optional(reportDeliveryStatus),
    createdBy: v.id('users'),
    updatedAt: v.number(),
  })
    .index('by_companyId', ['companyId'])
    .index('by_reportId', ['reportId'])
    .index('by_enabled_and_nextRunAt', ['enabled', 'nextRunAt']),

  /** Delivery log of scheduled and "send now" reports (ANLY-007); kept 90 days. */
  reportDeliveries: defineTable({
    companyId: v.id('companies'),
    reportId: v.id('savedReports'),
    scheduleId: v.optional(v.id('reportSchedules')),
    reportName: v.string(),
    trigger: v.union(v.literal('schedule'), v.literal('manual')),
    /** Local date of the scheduled slot; one delivery per schedule and slot. */
    slot: v.optional(v.string()),
    requestedBy: v.optional(v.id('users')),
    status: reportDeliveryStatus,
    attempts: v.number(),
    maxAttempts: v.number(),
    /** Planned on the first attempt; at most 20. */
    recipients: v.array(reportRecipient),
    rowCount: v.optional(v.number()),
    truncated: v.optional(v.boolean()),
    rangeFrom: v.optional(v.string()),
    rangeTo: v.optional(v.string()),
    error: v.optional(v.string()),
    nextAttemptAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_companyId_and_createdAt', ['companyId', 'createdAt'])
    .index('by_scheduleId_and_slot', ['scheduleId', 'slot'])
    .index('by_createdAt', ['createdAt']),
})

export default schema
