import { v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { requireUser, requireRole } from './lib/authz'
import { logAudit } from './lib/tenancy'
import {
  mergeSettings,
  validateSettingsForPublish,
  DEFAULT_SETTINGS,
} from './lib/farmRules'

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
  }
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
  }
}


export const register = mutation({
  args: {
    name: v.string(),
    code: v.string(),
    address: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    
    // Check if company code already exists
    const existingByCode = await ctx.db
      .query('companies')
      .withIndex('by_code', (q) => q.eq('code', args.code))
      .first()
    if (existingByCode) {
      throw new Error('Company code already exists')
    }

    // User should not already belong to a company
    if (user.companyId) {
      throw new Error('User already belongs to a company')
    }

    const now = Date.now()
    const companyId = await ctx.db.insert('companies', {
      name: args.name,
      code: args.code,
      address: args.address,
      contactEmail: args.contactEmail || user.email,
      submittedByUserId: user._id,
      status: 'pending',
      settings: { aiAssistantEnabled: false },
      createdAt: now,
    })

    // Note: We don't set user.companyId yet - that happens on approval
    // Store the requesting user's email in contactEmail if not provided
    if (!args.contactEmail && user.email) {
      await ctx.db.patch(companyId, {
        contactEmail: user.email,
      })
    }

    await logAudit(ctx, {
      actionType: 'register',
      tableName: 'companies',
      recordId: companyId,
      newValues: { ...args, requestedByUserId: user._id },
    })

    return companyId
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

    await logAudit(ctx, {
      actionType: 'approve',
      tableName: 'companies',
      recordId: companyId,
      newValues: {
        status: 'approved',
        promotedUserId: userId,
      },
    })

    return { companyId, userId }
  },
})

export const reject = mutation({
  args: {
    companyId: v.id('companies'),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, { companyId, reason }) => {
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

    await logAudit(ctx, {
      actionType: 'reject',
      tableName: 'companies',
      recordId: companyId,
      newValues: { 
        status: 'rejected',
        reason,
      },
    })
  },
})

export const list = query({
  args: { status: v.optional(v.union(v.literal('pending'), v.literal('approved'), v.literal('rejected'))) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    requireRole(user, 'super_admin')
    
    let companies = await ctx.db.query('companies').collect()
    
    if (args.status) {
      companies = companies.filter((c) => c.status === args.status)
    }
    
    return companies.map((c) => toClient(c)).sort((a, b) => b.created_at - a.created_at)
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
      patch.logoStorageId = profile.logoStorageId || undefined
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
    if (company.logoStorageId) {
      try {
        await ctx.storage.delete(company.logoStorageId)
      } catch {
        /* ignore */
      }
    }
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
    if (company.logoStorageId) {
      try {
        await ctx.storage.delete(company.logoStorageId)
      } catch {
        /* ignore */
      }
    }
    await ctx.db.patch(user.companyId, { logoStorageId: undefined })
    return { ok: true }
  },
})
