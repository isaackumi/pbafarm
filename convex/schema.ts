import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'
import { authTables } from '@convex-dev/auth/server'

const cageStatus = v.union(
  v.literal('active'),
  v.literal('harvested'),
  v.literal('harvesting'),
  v.literal('maintenance'),
  v.literal('fallow'),
  v.literal('empty'),
)

const schema = defineSchema({
  ...authTables,

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
  }).index('email', ['email']),

  companies: defineTable({
    name: v.string(),
    code: v.string(),
    address: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    submittedByUserId: v.optional(v.id('users')),
    status: v.union(
      v.literal('pending'),
      v.literal('approved'),
      v.literal('rejected'),
    ),
    rejectionReason: v.optional(v.string()),
    settings: v.optional(
      v.object({
        aiAssistantEnabled: v.boolean(),
      }),
    ),
    createdAt: v.number(),
    approvedAt: v.optional(v.number()),
    approvedBy: v.optional(v.id('users')),
  }).index('by_code', ['code']).index('by_status', ['status']),

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
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_name', ['name'])
    .index('by_status', ['status'])
    .index('by_company', ['companyId'])
    .index('by_company_status', ['companyId', 'status']),

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
    companyId: v.optional(v.id('companies')),
    deletedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_feed_type', ['feedTypeId'])
    .index('by_company', ['companyId']),

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
    companyId: v.optional(v.id('companies')),
    deletedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index('by_feed_type', ['feedTypeId'])
    .index('by_cage', ['cageId'])
    .index('by_company', ['companyId']),

  dailyRecords: defineTable({
    cageId: v.id('cages'),
    date: v.string(),
    feedAmount: v.number(),
    feedTypeId: v.optional(v.id('feedTypes')),
    feedType: v.optional(v.string()),
    feedPrice: v.number(),
    feedCost: v.number(),
    mortality: v.number(),
    notes: v.optional(v.string()),
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
  })
    .index('by_cage', ['cageId'])
    .index('by_cage_date', ['cageId', 'date'])
    .index('by_date', ['date'])
    .index('by_company', ['companyId']),

  biweeklyRecords: defineTable({
    cageId: v.id('cages'),
    date: v.string(),
    batchCode: v.string(),
    averageBodyWeight: v.number(),
    totalFishCount: v.number(),
    totalWeight: v.number(),
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
    updatedBy: v.optional(v.id('users')),
    updatedAt: v.number(),
  })
    .index('by_cage', ['cageId'])
    .index('by_batch_code', ['batchCode'])
    .index('by_company', ['companyId'])
    .index('by_date', ['date']),

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
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
  })
    .index('by_cage', ['cageId'])
    .index('by_company', ['companyId'])
    .index('by_date', ['harvestDate']),

  harvestSampling: defineTable({
    harvestId: v.id('harvestRecords'),
    cageId: v.optional(v.id('cages')),
    date: v.optional(v.string()),
    weight: v.optional(v.number()),
    fishCount: v.optional(v.number()),
    crateSize: v.optional(v.number()),
    samples: v.any(),
    sizeBreakdown: v.optional(v.any()),
    doc: v.optional(v.number()),
    abw: v.optional(v.number()),
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
  })
    .index('by_harvest', ['harvestId'])
    .index('by_cage', ['cageId']),

  feedInventory: defineTable({
    feedTypeId: v.id('feedTypes'),
    quantityKg: v.number(),
    batchNumber: v.optional(v.string()),
    expiryDate: v.optional(v.string()),
    location: v.optional(v.string()),
    companyId: v.optional(v.id('companies')),
    updatedAt: v.number(),
  })
    .index('by_feed_type', ['feedTypeId'])
    .index('by_company', ['companyId']),

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
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
  })
    .index('by_feed_type', ['feedTypeId'])
    .index('by_company', ['companyId'])
    .index('by_reference', ['referenceId']),

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
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
    approvedBy: v.optional(v.id('users')),
    approvedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()),
  })
    .index('by_cage', ['cageId'])
    .index('by_status', ['status'])
    .index('by_company', ['companyId']),

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
    companyId: v.optional(v.id('companies')),
    createdBy: v.optional(v.id('users')),
    approvedBy: v.optional(v.id('users')),
    approvedAt: v.optional(v.number()),
  })
    .index('by_stocking', ['stockingId'])
    .index('by_status', ['status'])
    .index('by_company', ['companyId']),

  auditLogs: defineTable({
    userId: v.optional(v.id('users')),
    actionType: v.string(),
    tableName: v.string(),
    recordId: v.optional(v.string()),
    previousValues: v.optional(v.any()),
    newValues: v.optional(v.any()),
    companyId: v.optional(v.id('companies')),
  })
    .index('by_user', ['userId'])
    .index('by_table', ['tableName'])
    .index('by_company', ['companyId']),

  notifications: defineTable({
    userId: v.id('users'),
    title: v.string(),
    message: v.string(),
    type: v.optional(v.string()),
    read: v.boolean(),
    link: v.optional(v.string()),
    companyId: v.optional(v.id('companies')),
  })
    .index('by_user', ['userId'])
    .index('by_user_read', ['userId', 'read']),
})

export default schema
