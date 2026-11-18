import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { requireUser, requireRole, revokeUserSessions } from './lib/authz'
import { logAudit } from './lib/tenancy'
import { PLATFORM_SCAN_LIMIT } from './lib/scope'
import {
  mergeSettings,
  validateSettingsForPublish,
  DEFAULT_SETTINGS,
} from './lib/farmRules'

/** A file must be claimed as a logo within this long of its upload. */
const LOGO_CLAIM_WINDOW_MS = 60 * 60 * 1000

/**
 * Record a just-uploaded file as this company's logo (doc 07 V11). Refuses a
 * file recorded for another company, and an unrecorded file older than the
 * claim window (it was not uploaded for this logo change), so an admin cannot
 * point their logo at another company's file and later delete it.
 */
async function claimLogoUpload(
  ctx: MutationCtx,
  user: Doc<'users'>,
  companyId: Id<'companies'>,
  storageId: Id<'_storage'>,
) {
  const recorded = await ctx.db
    .query('logoUploads')
    .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
    .unique()
  if (recorded) {
    if (recorded.companyId !== companyId) throw new Error('Logo file not found')
    return
  }
  const file = await ctx.db.system.get(storageId)
  if (!file || Date.now() - file._creationTime > LOGO_CLAIM_WINDOW_MS) {
    throw new Error('Logo file not found. Upload the logo again.')
  }
  await ctx.db.insert('logoUploads', { companyId, storageId, uploadedBy: user._id })
}

/** Whether a stored logo file may be published or deleted by this company. */
async function logoBelongsTo(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  storageId: Id<'_storage'>,
) {
  const recorded = await ctx.db
    .query('logoUploads')
    .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
    .unique()
  return recorded?.companyId === companyId
}

/**
 * Delete the company's current logo file, unless it is recorded as another
 * company's upload. Logos set before upload records existed are deleted as
 * before.
 */
async function deleteOldLogo(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  storageId: Id<'_storage'> | undefined,
) {
  if (!storageId) return
  const recorded = await ctx.db
    .query('logoUploads')
    .withIndex('by_storageId', (q) => q.eq('storageId', storageId))
    .unique()
  if (recorded && recorded.companyId !== companyId) return
  try {
    await ctx.storage.delete(storageId)
  } catch {
    /* ignore */
  }
  if (recorded) await ctx.db.delete(recorded._id)
}

async function logoUrl(ctx: any, storageId?: any) {
  if (!storageId) return null
  try {
    return await ctx.storage.getUrl(storageId)
  } catch {
    return null
  }
}

function toClient(c: any, logo_url: string | null = null) {
  const settings = mergeSettings(c.settings)
  return {
    id: c._id,
    _id: c._id,
    name: c.name,
    code: c.code,
    abbreviation: c.abbreviation,
    address: c.address,
    contact_email: c.contactEmail,
    contact_phone: c.contactPhone,
    logo_storage_id: c.logoStorageId,
    logo_url,
    submitted_by_user_id: c.submittedByUserId,
    status: c.status,
    rejection_reason: c.rejectionReason,
    settings: {
      ai_assistant_enabled: settings.aiAssistantEnabled,
      branding: settings.branding,
      farm_rules: settings.farmRules,
      stocking_rules: settings.stockingRules,
      feed_rules: settings.feedRules,
      updated_at: settings.updatedAt,
    },
    created_at: c.createdAt,
    approved_at: c.approvedAt,
    approved_by: c.approvedBy,
  }
}

/**
 * Sign out every member of a company (requireUser already refuses them once
 * the company is not approved; this ends their open sessions too).
 * Super_admins and the caller keep their sessions.
 */
async function revokeMemberSessions(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  callerId: Id<'users'>,
) {
  const members = await ctx.db
    .query('users')
    .withIndex('by_companyId', (q) => q.eq('companyId', companyId))
    .collect()
  let sessions = 0
  for (const member of members) {
    if (member._id === callerId || member.role === 'super_admin') continue
    sessions += await revokeUserSessions(ctx, member._id)
  }
  return sessions
}

function requireCompanyAdmin(user: any, companyId: string) {
  if (user.role === 'super_admin') return
  if (user.companyId !== companyId || user.role !== 'admin') {
    throw new Error('Access denied')
  }
}

function profileFromDraft(draft: any) {
  return {
    name: draft?.name,
    abbreviation: draft?.abbreviation,
    address: draft?.address,
    contactEmail: draft?.contactEmail ?? draft?.contact_email,
    contactPhone: draft?.contactPhone ?? draft?.contact_phone,
    logoStorageId: draft?.logoStorageId ?? draft?.logo_storage_id,
  }
}

function settingsFromDraft(draft: any, existingAi?: boolean) {
  const branding = draft?.branding || draft?.settings?.branding || {}
  const farmRules = draft?.farmRules || draft?.farm_rules || draft?.settings?.farmRules || {}
  const stockingRules =
    draft?.stockingRules ||
    draft?.stocking_rules ||
    draft?.settings?.stockingRules ||
    {}
  const feedRules =
    draft?.feedRules || draft?.feed_rules || draft?.settings?.feedRules || {}
  const locale = draft?.locale || draft?.settings?.locale || {}
  const ai =
    draft?.aiAssistantEnabled ??
    draft?.ai_assistant_enabled ??
    draft?.settings?.aiAssistantEnabled ??
    existingAi ??
    false

  return {
    aiAssistantEnabled: ai === true,
    branding: {
      displayName: branding.displayName || branding.display_name,
      accentHex: branding.accentHex || branding.accent_hex || DEFAULT_SETTINGS.branding.accentHex,
      themeMode: branding.themeMode || branding.theme_mode || DEFAULT_SETTINGS.branding.themeMode,
    },
    farmRules: {
      targetHarvestAbwG: numOr(
        farmRules.targetHarvestAbwG ?? farmRules.target_harvest_abw_g,
        DEFAULT_SETTINGS.farmRules.targetHarvestAbwG,
      ),
      harvestDocMinDays: numOr(
        farmRules.harvestDocMinDays ?? farmRules.harvest_doc_min_days,
        DEFAULT_SETTINGS.farmRules.harvestDocMinDays,
      ),
      harvestDocMaxDays: numOr(
        farmRules.harvestDocMaxDays ?? farmRules.harvest_doc_max_days,
        DEFAULT_SETTINGS.farmRules.harvestDocMaxDays,
      ),
      maxDensityFishPerM3: numOr(
        farmRules.maxDensityFishPerM3 ?? farmRules.max_density_fish_per_m3,
        DEFAULT_SETTINGS.farmRules.maxDensityFishPerM3,
      ),
      dailyMortalityAlertPct: numOr(
        farmRules.dailyMortalityAlertPct ?? farmRules.daily_mortality_alert_pct,
        DEFAULT_SETTINGS.farmRules.dailyMortalityAlertPct,
      ),
      cumulativeMortalityAlertPct: numOr(
        farmRules.cumulativeMortalityAlertPct ??
          farmRules.cumulative_mortality_alert_pct,
        DEFAULT_SETTINGS.farmRules.cumulativeMortalityAlertPct,
      ),
      targetFcr: numOr(
        farmRules.targetFcr ?? farmRules.target_fcr,
        DEFAULT_SETTINGS.farmRules.targetFcr,
      ),
      maxFcrAlert: numOr(
        farmRules.maxFcrAlert ?? farmRules.max_fcr_alert,
        DEFAULT_SETTINGS.farmRules.maxFcrAlert,
      ),
    },
    stockingRules: {
      requireApprovalForStocking:
        stockingRules.requireApprovalForStocking ??
        stockingRules.require_approval_for_stocking ??
        true,
      requireApprovalForTopup:
        stockingRules.requireApprovalForTopup ??
        stockingRules.require_approval_for_topup ??
        true,
      enforceCageCapacity:
        stockingRules.enforceCageCapacity ??
        stockingRules.enforce_cage_capacity ??
        true,
      minInitialAbwG: numOr(
        stockingRules.minInitialAbwG ?? stockingRules.min_initial_abw_g,
        DEFAULT_SETTINGS.stockingRules.minInitialAbwG,
      ),
      maxInitialAbwG: numOr(
        stockingRules.maxInitialAbwG ?? stockingRules.max_initial_abw_g,
        DEFAULT_SETTINGS.stockingRules.maxInitialAbwG,
      ),
      minTopupAbwG: numOr(
        stockingRules.minTopupAbwG ?? stockingRules.min_topup_abw_g,
        DEFAULT_SETTINGS.stockingRules.minTopupAbwG,
      ),
      maxTopupAbwG: numOr(
        stockingRules.maxTopupAbwG ?? stockingRules.max_topup_abw_g,
        DEFAULT_SETTINGS.stockingRules.maxTopupAbwG,
      ),
      allowStockOnlyEmptyStatuses:
        stockingRules.allowStockOnlyEmptyStatuses ||
        stockingRules.allow_stock_only_empty_statuses ||
        DEFAULT_SETTINGS.stockingRules.allowStockOnlyEmptyStatuses,
    },
    feedRules: {
      defaultBagSizeKg: numOr(
        feedRules.defaultBagSizeKg ?? feedRules.default_bag_size_kg,
        DEFAULT_SETTINGS.feedRules.defaultBagSizeKg,
      ),
      defaultLocation:
        feedRules.defaultLocation ||
        feedRules.default_location ||
        DEFAULT_SETTINGS.feedRules.defaultLocation,
      allowNegativeStock:
        feedRules.allowNegativeStock ??
        feedRules.allow_negative_stock ??
        false,
      trackLots: feedRules.trackLots ?? feedRules.track_lots ?? true,
      lowStockMultiplier: numOr(
        feedRules.lowStockMultiplier ?? feedRules.low_stock_multiplier,
        DEFAULT_SETTINGS.feedRules.lowStockMultiplier,
      ),
      requireBatchOnPurchase:
        feedRules.requireBatchOnPurchase ??
        feedRules.require_batch_on_purchase ??
        false,
    },
    locale: {
      currency: (['GHS', 'USD', 'EUR'].includes(locale.currency)
        ? locale.currency
        : DEFAULT_SETTINGS.locale.currency) as 'GHS' | 'USD' | 'EUR',
    },
  }
}

/**
 * Settings that publishSettings must carry over unchanged: the draft does not
 * contain them, and publishing rebuilds `settings` from the draft.
 */
function preservedSettings(settings: Doc<'companies'>['settings']) {
  const out: Partial<NonNullable<Doc<'companies'>['settings']>> = {}
  if (settings?.defaultCountryCode !== undefined) out.defaultCountryCode = settings.defaultCountryCode
  if (settings?.messaging !== undefined) out.messaging = settings.messaging
  if (settings?.security !== undefined) out.security = settings.security
  return out
}

function numOr(v: any, fallback: number) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

function draftPayloadFromCompany(c: any) {
  const settings = mergeSettings(c.settings)
  return {
    name: c.name,
    abbreviation: c.abbreviation || '',
    address: c.address || '',
    contactEmail: c.contactEmail || '',
    contactPhone: c.contactPhone || '',
    logoStorageId: c.logoStorageId,
    aiAssistantEnabled: settings.aiAssistantEnabled,
    branding: settings.branding,
    farmRules: settings.farmRules,
    stockingRules: settings.stockingRules,
    feedRules: settings.feedRules,
    locale: settings.locale,
  }
}


export const register = mutation({
  args: {
    name: v.string(),
    code: v.string(),
    address: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    contactPhone: v.optional(v.string()),
    abbreviation: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)

    const name = args.name.trim()
    if (!name) throw new Error('Company name is required')

    let code = args.code
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, '')
    if (!code) {
      code = name
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '')
        .slice(0, 8)
    }
    if (!code) throw new Error('Company code is required')
    if (code.length < 2) {
      throw new Error('Company code must be at least 2 characters')
    }

    // Check if company code already exists
    const existingByCode = await ctx.db
      .query('companies')
      .withIndex('by_code', (q) => q.eq('code', code))
      .first()
    if (existingByCode) {
      throw new Error('Company code already exists — choose another short code')
    }

    // User should not already belong to a company
    if (user.companyId) {
      throw new Error('User already belongs to a company')
    }

    const contactEmail =
      args.contactEmail?.trim() || user.email || undefined
    const contactPhone = args.contactPhone?.trim() || undefined
    const address = args.address?.trim() || undefined
    const abbreviation = args.abbreviation?.trim() || undefined

    const now = Date.now()
    const companyId = await ctx.db.insert('companies', {
      name,
      code,
      address,
      contactEmail,
      contactPhone,
      abbreviation,
      submittedByUserId: user._id,
      status: 'pending',
      settings: { aiAssistantEnabled: false },
      createdAt: now,
    })

    await logAudit(ctx, {
      actionType: 'register',
      tableName: 'companies',
      recordId: companyId,
      newValues: {
        name,
        code,
        address,
        contactEmail,
        contactPhone,
        abbreviation,
        requestedByUserId: user._id,
      },
    })

    return companyId
  },
})

/** Company-less user: my latest company registration, to show its status. */
export const myRegistration = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    if (user.companyId) return null
    const latest = await ctx.db
      .query('companies')
      .withIndex('by_submittedByUserId', (q) => q.eq('submittedByUserId', user._id))
      .order('desc')
      .first()
    if (!latest) return null
    return {
      id: latest._id,
      name: latest.name,
      code: latest.code,
      status: latest.status,
      rejectionReason: latest.rejectionReason ?? null,
      createdAt: latest.createdAt,
    }
  },
})

export const listPending = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    requireRole(user, 'super_admin')
    
    const pending = await ctx.db
      .query('companies')
      .withIndex('by_status', (q) => q.eq('status', 'pending'))
      .collect()
    
    return pending.map((c) => toClient(c)).sort((a, b) => b.created_at - a.created_at)
  },
})

export const approve = mutation({
  args: {
    companyId: v.id('companies'),
    userId: v.optional(v.id('users')), // User to promote to admin
  },
  handler: async (ctx, { companyId, userId: requestedUserId }) => {
    const user = await requireUser(ctx)
    requireRole(user, 'super_admin')

    const company = await ctx.db.get(companyId)
    if (!company) throw new Error('Company not found')

    if (company.status !== 'pending') {
      throw new Error('Company is not pending approval')
    }

    let userId = requestedUserId || company.submittedByUserId
    if (!userId && company.contactEmail) {
      const byEmail = await ctx.db
        .query('users')
        .withIndex('email', (q) => q.eq('email', company.contactEmail!))
        .unique()
      userId = byEmail?._id
    }
    if (!userId) {
      throw new Error('No user to promote — registration missing submitter')
    }

    const targetUser = await ctx.db.get(userId)
    if (!targetUser) throw new Error('User not found')

    if (targetUser.companyId) {
      throw new Error('User already belongs to a company')
    }

    const now = Date.now()

    await ctx.db.patch(companyId, {
      status: 'approved',
      approvedAt: now,
      approvedBy: user._id,
      submittedByUserId: company.submittedByUserId || userId,
    })

    await ctx.db.patch(userId, {
      companyId: companyId,
      role: 'admin',
    })

    const existingLocs = await ctx.db
      .query('farmLocations')
      .withIndex('by_company', (q) => q.eq('companyId', companyId))
      .collect()
    let locationId = existingLocs.find((l) => l.active !== false)?._id
    if (!locationId) {
      locationId = await ctx.db.insert('farmLocations', {
        companyId,
        name: 'Main farm',
        code: 'MAIN',
        active: true,
        notes: 'Default location',
        updatedAt: now,
      })
    }
    await ctx.db.patch(userId, { activeLocationId: locationId })

    await logAudit(ctx, {
      actionType: 'approve',
      tableName: 'companies',
      recordId: companyId,
      newValues: {
        status: 'approved',
        promotedUserId: userId,
        locationId,
      },
      locationId,
    })

    return { companyId, userId, locationId }
  },
})

export const reject = mutation({
  args: {
    companyId: v.id('companies'),
    reason: v.optional(v.string()),
    /** Sign members out now (default true). */
    revokeSessions: v.optional(v.boolean()),
  },
  handler: async (ctx, { companyId, reason, revokeSessions }) => {
    const user = await requireUser(ctx)
    requireRole(user, 'super_admin')
    
    const company = await ctx.db.get(companyId)
    if (!company) throw new Error('Company not found')
    
    if (company.status !== 'pending') {
      throw new Error('Company is not pending approval')
    }

    await ctx.db.patch(companyId, {
      status: 'rejected',
      rejectionReason: reason,
      approvedAt: Date.now(),
      approvedBy: user._id,
    })
    const sessionsRevoked =
      revokeSessions === false ? 0 : await revokeMemberSessions(ctx, companyId, user._id)

    await logAudit(ctx, {
      actionType: 'reject',
      tableName: 'companies',
      recordId: companyId,
      newValues: { 
        status: 'rejected',
        reason,
        sessionsRevoked,
      },
    })
  },
})

/** Soft-remove a company (super_admin). Does not wipe tenant data. */
export const remove = mutation({
  args: {
    companyId: v.id('companies'),
    reason: v.optional(v.string()),
    /** Sign members out now (default true). */
    revokeSessions: v.optional(v.boolean()),
  },
  handler: async (ctx, { companyId, reason, revokeSessions }) => {
    const user = await requireUser(ctx)
    requireRole(user, 'super_admin')

    const company = await ctx.db.get(companyId)
    if (!company) throw new Error('Company not found')
    if (company.status === 'rejected') {
      return companyId
    }

    await ctx.db.patch(companyId, {
      status: 'rejected',
      rejectionReason: reason || 'Removed by admin',
      approvedAt: Date.now(),
      approvedBy: user._id,
    })
    const sessionsRevoked =
      revokeSessions === false ? 0 : await revokeMemberSessions(ctx, companyId, user._id)

    await logAudit(ctx, {
      actionType: 'reject',
      tableName: 'companies',
      recordId: companyId,
      newValues: {
        status: 'rejected',
        reason: reason || 'Removed by admin',
        sessionsRevoked,
      },
    })

    return companyId
  },
})

export const list = query({
  args: { status: v.optional(v.union(v.literal('pending'), v.literal('approved'), v.literal('rejected'))) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    requireRole(user, 'super_admin')
    
    // Platform view (super_admin only): bounded, and filtered by the status
    // index when a status is given.
    const companies = args.status
      ? await ctx.db
          .query('companies')
          .withIndex('by_status', (q) => q.eq('status', args.status!))
          .take(PLATFORM_SCAN_LIMIT)
      : await ctx.db.query('companies').take(PLATFORM_SCAN_LIMIT)

    // Member counts per listed company through users.by_companyId.
    const userCountByCompany = new Map<string, number>()
    for (const c of companies) {
      const members = await ctx.db
        .query('users')
        .withIndex('by_companyId', (q) => q.eq('companyId', c._id))
        .collect()
      userCountByCompany.set(String(c._id), members.length)
    }
    
    return companies
      .map((c) => ({
        ...toClient(c),
        user_count: userCountByCompany.get(String(c._id)) || 0,
      }))
      .sort((a, b) => b.created_at - a.created_at)
  },
})

export const get = query({
  args: { id: v.id('companies') },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx)
    const company = await ctx.db.get(id)
    if (!company) return null
    
    // Super admins can see all, others can only see their own company
    if (user.role !== 'super_admin' && user.companyId !== id) {
      throw new Error('Access denied')
    }
    
    return toClient(company, await logoUrl(ctx, company.logoStorageId))
  },
})

export const updateSettings = mutation({
  args: {
    id: v.id('companies'),
    patch: v.object({
      name: v.optional(v.string()),
      address: v.optional(v.string()),
      contactEmail: v.optional(v.string()),
      aiAssistantEnabled: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, { id, patch }) => {
    const user = await requireUser(ctx)
    const company = await ctx.db.get(id)
    if (!company) throw new Error('Company not found')

    // Only super admins or company admins can update
    if (user.role !== 'super_admin' && (user.companyId !== id || user.role !== 'admin')) {
      throw new Error('Access denied')
    }

    const { aiAssistantEnabled, ...rest } = patch
    if (aiAssistantEnabled !== undefined) {
      requireRole(user, 'admin')
    }

    const existing = { ...company }
    await ctx.db.patch(id, {
      ...rest,
      ...(aiAssistantEnabled !== undefined
        ? {
            settings: {
              ...(company.settings || {}),
              aiAssistantEnabled,
            },
          }
        : {}),
    })

    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'companies',
      recordId: id,
      previousValues: existing,
      newValues: patch,
    })

    return id
  },
})

/** Lightweight flag for AI widget gating. */
export const aiAssistantStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    if ((user.role ?? 'user') === 'super_admin') {
      // Super admins without a company: allow for support; with company: follow setting
      if (!user.companyId) {
        return { enabled: true, canManage: true }
      }
    }
    if (!user.companyId) {
      return { enabled: false, canManage: false }
    }
    const company = await ctx.db.get(user.companyId)
    const enabled = company?.settings?.aiAssistantEnabled === true
    const role = user.role ?? 'user'
    const canManage = role === 'admin' || role === 'super_admin'
    return { enabled, canManage }
  },
})

export const getCurrentCompany = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    if (!user.companyId) return null

    const company = await ctx.db.get(user.companyId)
    if (!company) return null

    return toClient(company, await logoUrl(ctx, company.logoStorageId))
  },
})

export const getEffectiveSettings = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    if (!user.companyId) {
      return { settings: mergeSettings(undefined), company: null }
    }
    const company = await ctx.db.get(user.companyId)
    if (!company) {
      return { settings: mergeSettings(undefined), company: null }
    }
    return {
      settings: mergeSettings(company.settings),
      company: toClient(company, await logoUrl(ctx, company.logoStorageId)),
    }
  },
})

export const getSettingsDraft = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    if (!user.companyId) {
      return {
        missingCompany: true,
        draft: null,
        published: null,
        hasDraft: false,
        draftUpdatedAt: null,
        logoUrl: null,
        companyId: null,
      }
    }
    const company = await ctx.db.get(user.companyId)
    if (!company) {
      return {
        missingCompany: true,
        draft: null,
        published: null,
        hasDraft: false,
        draftUpdatedAt: null,
        logoUrl: null,
        companyId: null,
      }
    }

    const existing = await ctx.db
      .query('companySettingsDrafts')
      .withIndex('by_company', (q) => q.eq('companyId', user.companyId!))
      .first()

    const published = draftPayloadFromCompany(company)
    const draft = existing?.draft || published
    return {
      missingCompany: false,
      draft,
      published,
      hasDraft: !!existing,
      draftUpdatedAt: existing?.updatedAt,
      logoUrl: await logoUrl(ctx, draft.logoStorageId || company.logoStorageId),
      companyId: company._id,
    }
  },
})

export const saveSettingsDraft = mutation({
  args: { draft: v.any() },
  handler: async (ctx, { draft }) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    if (!user.companyId) throw new Error('No company linked to your account')
    requireCompanyAdmin(user, user.companyId)

    const now = Date.now()
    const existing = await ctx.db
      .query('companySettingsDrafts')
      .withIndex('by_company', (q) => q.eq('companyId', user.companyId!))
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, {
        draft,
        updatedAt: now,
        updatedBy: user._id,
      })
    } else {
      await ctx.db.insert('companySettingsDrafts', {
        companyId: user.companyId,
        draft,
        updatedAt: now,
        updatedBy: user._id,
      })
    }

    await logAudit(ctx, {
      actionType: 'settings_draft',
      tableName: 'companies',
      recordId: user.companyId,
      newValues: { savedAt: now },
    })
    return { ok: true }
  },
})

export const publishSettings = mutation({
  args: { draft: v.optional(v.any()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    if (!user.companyId) throw new Error('No company linked to your account')
    requireCompanyAdmin(user, user.companyId)

    const company = await ctx.db.get(user.companyId)
    if (!company) throw new Error('Company not found')

    let draft = args.draft
    if (!draft) {
      const row = await ctx.db
        .query('companySettingsDrafts')
        .withIndex('by_company', (q) => q.eq('companyId', user.companyId!))
        .first()
      draft = row?.draft || draftPayloadFromCompany(company)
    }

    const nextSettings = {
      ...settingsFromDraft(draft, company.settings?.aiAssistantEnabled),
      // Managed on their own settings screens, not through the draft (INT-001).
      ...preservedSettings(company.settings),
      updatedAt: Date.now(),
      updatedBy: user._id,
    }
    validateSettingsForPublish(nextSettings)

    const profile = profileFromDraft(draft)
    const patch: Record<string, any> = {
      settings: nextSettings,
    }
    if (profile.name) patch.name = String(profile.name).trim()
    if (profile.abbreviation !== undefined) {
      patch.abbreviation = String(profile.abbreviation || '').trim()
    }
    if (profile.address !== undefined) patch.address = profile.address
    if (profile.contactEmail !== undefined) patch.contactEmail = profile.contactEmail
    if (profile.contactPhone !== undefined) patch.contactPhone = profile.contactPhone
    if (profile.logoStorageId !== undefined) {
      const nextLogo = profile.logoStorageId || undefined
      // Only the current logo or a file this company uploaded (V11).
      if (
        nextLogo &&
        nextLogo !== company.logoStorageId &&
        !(await logoBelongsTo(ctx, user.companyId, nextLogo))
      ) {
        throw new Error('Logo file not found. Upload the logo again.')
      }
      patch.logoStorageId = nextLogo
    }

    await ctx.db.patch(user.companyId, patch)

    const published = draftPayloadFromCompany({
      ...company,
      ...patch,
      settings: nextSettings,
    })

    const existing = await ctx.db
      .query('companySettingsDrafts')
      .withIndex('by_company', (q) => q.eq('companyId', user.companyId!))
      .first()
    if (existing) {
      await ctx.db.patch(existing._id, {
        draft: published,
        updatedAt: Date.now(),
        updatedBy: user._id,
      })
    } else {
      await ctx.db.insert('companySettingsDrafts', {
        companyId: user.companyId,
        draft: published,
        updatedAt: Date.now(),
        updatedBy: user._id,
      })
    }

    await logAudit(ctx, {
      actionType: 'settings_publish',
      tableName: 'companies',
      recordId: user.companyId,
      previousValues: company.settings,
      newValues: nextSettings,
    })

    return {
      company: toClient(
        { ...company, ...patch },
        await logoUrl(ctx, patch.logoStorageId ?? company.logoStorageId),
      ),
    }
  },
})

export const generateLogoUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    if (!user.companyId) throw new Error('No company linked')
    return await ctx.storage.generateUploadUrl()
  },
})

export const setLogo = mutation({
  args: { storageId: v.id('_storage') },
  handler: async (ctx, { storageId }) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    if (!user.companyId) throw new Error('No company linked')
    const company = await ctx.db.get(user.companyId)
    if (!company) throw new Error('Company not found')
    if (company.logoStorageId === storageId) {
      return { logoUrl: await logoUrl(ctx, storageId) }
    }
    await claimLogoUpload(ctx, user, user.companyId, storageId)
    await deleteOldLogo(ctx, user.companyId, company.logoStorageId)
    await ctx.db.patch(user.companyId, { logoStorageId: storageId })
    await logAudit(ctx, {
      actionType: 'update',
      tableName: 'companies',
      recordId: user.companyId,
      newValues: { logoStorageId: storageId },
    })
    return { logoUrl: await logoUrl(ctx, storageId) }
  },
})

export const clearLogo = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx)
    requireRole(user, 'admin')
    if (!user.companyId) throw new Error('No company linked')
    const company = await ctx.db.get(user.companyId)
    if (!company) throw new Error('Company not found')
    await deleteOldLogo(ctx, user.companyId, company.logoStorageId)
    await ctx.db.patch(user.companyId, { logoStorageId: undefined })
    return { ok: true }
  },
})
