/**
 * Document register (TRACE-005, D-016): files attached to treatments, harvest
 * lots, dispatches, compliance records and biosecurity entries.
 *
 * Upload (CF-004, doc 16 §9.1): `generateUploadUrl` checks the record is the
 * caller's company's and records an upload binding (`fileUploads`: company,
 * uploader, record, expiry) next to the Convex upload URL. The client uploads
 * the bytes, then calls `attach` with the binding id: only the member who
 * asked for it, in that company, for that record, before expiry, can claim a
 * storage id with it; the stored bytes must match the SHA-256 declared with
 * the binding, and a storage id is claimed once. `attach` then checks
 * type, size and freshness of the stored file and registers it. Download: `requestDownload` issues a token valid for a few
 * minutes to a member of the owning company; GET /files/download?token=…
 * streams the bytes. Storage URLs are never handed out.
 */
import { v } from 'convex/values'
import { httpAction, internalMutation, internalQuery, mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { assertOwns, logAudit } from './lib/tenancy'
import { userError } from './lib/errors'
import { randomToken, sha256Hex } from './lib/tokens'
import { fileEntityType } from './schema'
import { assertUserCan, requireMember } from './lib/permissions'

export const MAX_FILE_BYTES = 10 * 1024 * 1024
/** An upload must be attached within this window (it was uploaded for this record). */
const CLAIM_WINDOW_MS = 60 * 60 * 1000
export const DOWNLOAD_TTL_MS = 5 * 60 * 1000
const FILES_PER_RECORD = 50

export const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'text/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  csv: 'text/csv',
  txt: 'text/plain',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

function mimeFromName(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream'
}

type EntityType = Doc<'files'>['entityType']
type Ctx = QueryCtx | MutationCtx

/** The record a file is attached to, if it exists (any company). */
async function loadEntity(
  ctx: Ctx,
  entityType: EntityType,
  entityId: string,
): Promise<{ companyId?: Id<'companies'>; locationId?: Id<'farmLocations'> } | null> {
  const id = ctx.db.normalizeId(entityType, entityId)
  if (!id) return null
  return (await ctx.db.get(id)) as { companyId?: Id<'companies'>; locationId?: Id<'farmLocations'> } | null
}

/** The record, refused unless it belongs to the caller's company. */
async function ownedEntity(ctx: Ctx, user: Doc<'users'>, entityType: EntityType, entityId: string) {
  const doc = await loadEntity(ctx, entityType, entityId)
  assertOwns(user, doc, 'Record')
  if (!doc.companyId) throw userError('NOT_FOUND', 'Record not found')
  return { companyId: doc.companyId, locationId: doc.locationId }
}

function fileRow(f: Doc<'files'>) {
  return {
    id: f._id,
    name: f.name,
    mime: f.mime,
    size: f.size,
    entity_type: f.entityType,
    entity_id: f.entityId,
    uploaded_by: f.uploadedBy,
    created_at: f.createdAt,
  }
}

/** _storage.sha256 is base64 in the runtime (hex in some docs): compare as hex. */
export function sha256ToHex(value: string): string {
  const v = value.trim()
  if (/^[0-9a-f]{64}$/i.test(v)) return v.toLowerCase()
  try {
    const bin = atob(v)
    return Array.from(bin, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  } catch {
    return ''
  }
}

export const generateUploadUrl = mutation({
  args: {
    entityType: fileEntityType,
    entityId: v.string(),
    /** SHA-256 (hex) of the file about to be uploaded (lib/fileHash.js). */
    sha256: v.string(),
  },
  returns: v.object({ uploadUrl: v.string(), uploadId: v.id('fileUploads') }),
  handler: async (ctx, { entityType, entityId, sha256 }) => {
    const { user } = await requireMember(ctx, { permission: 'files.upload' })
    const owner = await ownedEntity(ctx, user, entityType, entityId)
    if (!/^[0-9a-f]{64}$/i.test(sha256)) throw userError('VALIDATION', 'Invalid file checksum')
    const now = Date.now()
    const uploadId = await ctx.db.insert('fileUploads', {
      companyId: owner.companyId,
      uploadedBy: user._id,
      entityType,
      entityId,
      status: 'pending',
      sha256: sha256.toLowerCase(),
      createdAt: now,
      expiresAt: now + CLAIM_WINDOW_MS,
    })
    return { uploadUrl: await ctx.storage.generateUploadUrl(), uploadId }
  },
})

export const attach = mutation({
  args: {
    entityType: fileEntityType,
    entityId: v.string(),
    /** The binding generateUploadUrl returned with the upload URL. */
    uploadId: v.id('fileUploads'),
    storageId: v.id('_storage'),
    name: v.string(),
  },
  returns: v.union(v.object({ ok: v.literal(false), code: v.literal('VALIDATION'), message: v.string() }), v.object({ ok: v.literal(true), id: v.id('files') })),
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'files.upload' })
    const owner = await ownedEntity(ctx, user, args.entityType, args.entityId)
    const notFound = () => userError('NOT_FOUND', 'File not found. Upload it again.')
    // The binding must be this member's, in this company, for this record,
    // unused and unexpired (CF-004): another company's upload cannot be claimed.
    const upload = await ctx.db.get(args.uploadId)
    if (
      !upload ||
      upload.status !== 'pending' ||
      upload.uploadedBy !== user._id ||
      upload.companyId !== owner.companyId ||
      upload.entityType !== args.entityType ||
      upload.entityId !== args.entityId ||
      upload.expiresAt < Date.now()
    ) {
      throw notFound()
    }
    const taken = await ctx.db
      .query('files')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first()
    if (taken) throw notFound()
    const bound = await ctx.db
      .query('fileUploads')
      .withIndex('by_storageId', (q) => q.eq('storageId', args.storageId))
      .first()
    if (bound) throw notFound()
    const meta = await ctx.db.system.get(args.storageId)
    // Uploaded after the binding was made, within its window, with the bytes
    // the binding was made for (a leaked storage id alone is not enough).
    if (
      !meta ||
      meta._creationTime < upload._creationTime ||
      meta._creationTime > upload.expiresAt ||
      sha256ToHex(meta.sha256) !== upload.sha256
    ) {
      throw notFound()
    }
    // The type the upload was sent with; older clients may not set one.
    const mime =
      (meta.contentType ?? '').split(';')[0].trim().toLowerCase() || mimeFromName(args.name)
    // A refused file is deleted. Throwing would roll the delete back, so the
    // refusal is returned instead: { ok: false, code, message }.
    const reject = async (message: string) => {
      await ctx.storage.delete(args.storageId)
      return { ok: false as const, code: 'VALIDATION' as const, message }
    }
    if (!ALLOWED_MIME.has(mime)) {
      return await reject('Only PDF, images, CSV, text, Excel and Word files can be attached')
    }
    if (meta.size > MAX_FILE_BYTES) return await reject('Files can be at most 10 MB')
    const existing = await ctx.db
      .query('files')
      .withIndex('by_companyId_and_entityType_and_entityId', (q) =>
        q.eq('companyId', owner.companyId).eq('entityType', args.entityType).eq('entityId', args.entityId),
      )
      .take(FILES_PER_RECORD)
    // Photos of a custom photo field all hang off its definition: no per-record cap.
    if (args.entityType !== 'customFieldDefs' && existing.length >= FILES_PER_RECORD) {
      return await reject(`A record can have at most ${FILES_PER_RECORD} files`)
    }
    const name = args.name.trim().slice(0, 200) || 'file'
    const id = await ctx.db.insert('files', {
      companyId: owner.companyId,
      locationId: owner.locationId,
      entityType: args.entityType,
      entityId: args.entityId,
      provider: 'convex',
      storageId: args.storageId,
      name,
      mime,
      size: meta.size,
      uploadedBy: user._id,
      createdAt: Date.now(),
    })
    await ctx.db.patch(upload._id, { status: 'attached', storageId: args.storageId, fileId: id })
    await logAudit(ctx, {
      actionType: 'file_attached',
      tableName: 'files',
      recordId: id,
      newValues: { entityType: args.entityType, entityId: args.entityId, name, mime, size: meta.size },
      locationId: owner.locationId,
    })
    return { ok: true as const, id }
  },
})

export const list = query({
  args: { entityType: fileEntityType, entityId: v.string() },
  handler: async (ctx, { entityType, entityId }) => {
    const { user } = await requireMember(ctx, { permission: 'org.view' })
    const doc = await loadEntity(ctx, entityType, entityId)
    if (!doc?.companyId || user.companyId !== doc.companyId) return []
    const companyId = doc.companyId
    const rows = await ctx.db
      .query('files')
      .withIndex('by_companyId_and_entityType_and_entityId', (q) =>
        q.eq('companyId', companyId).eq('entityType', entityType).eq('entityId', entityId),
      )
      .take(FILES_PER_RECORD)
    return rows.map(fileRow)
  },
})

/** A download path valid for a few minutes, only for the owning company's members. */
export const requestDownload = mutation({
  args: { fileId: v.id('files') },
  returns: v.object({ path: v.string(), expiresAt: v.number() }),
  handler: async (ctx, { fileId }) => {
    const { user } = await requireMember(ctx, { permission: 'org.view', allowActAsReadOnly: true })
    const file = await ctx.db.get(fileId)
    // Only members of the owning company (super_admins included only when it is their active company).
    if (!file || !user.companyId || file.companyId !== user.companyId) {
      throw userError('NOT_FOUND', 'File not found')
    }
    const token = randomToken()
    const expiresAt = Date.now() + DOWNLOAD_TTL_MS
    await ctx.db.insert('fileDownloadTokens', {
      tokenHash: await sha256Hex(token),
      fileId,
      companyId: file.companyId,
      userId: user._id,
      expiresAt,
    })
    return { path: `/files/download?token=${token}`, expiresAt }
  },
})

export const remove = mutation({
  args: { fileId: v.id('files') },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, { fileId }) => {
    const { user } = await requireMember(ctx, { permission: 'files.upload' })
    const file = await ctx.db.get(fileId)
    assertOwns(user, file, 'File')
    // Your own attachment, or anyone's with production.records.delete.
    if (file.uploadedBy !== user._id) await assertUserCan(ctx, user, 'production.records.delete')
    await ctx.storage.delete(file.storageId)
    await ctx.db.delete(fileId)
    await logAudit(ctx, {
      actionType: 'file_removed',
      tableName: 'files',
      recordId: fileId,
      previousValues: { name: file.name, entityType: file.entityType, entityId: file.entityId },
      locationId: file.locationId,
    })
    return { ok: true }
  },
})

/** The file a download token grants, if the token is live and the file still exists. */
export const resolveDownload = internalQuery({
  args: { tokenHash: v.string(), now: v.number() },
  returns: v.union(v.object({ storageId: v.id('_storage'), name: v.string(), mime: v.string() }), v.null()),
  handler: async (ctx, { tokenHash, now }) => {
    const grant = await ctx.db
      .query('fileDownloadTokens')
      .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
      .first()
    if (!grant || grant.expiresAt < now) return null
    const file = await ctx.db.get(grant.fileId)
    if (!file || file.companyId !== grant.companyId) return null
    return { storageId: file.storageId, name: file.name, mime: file.mime }
  },
})

/**
 * Delete expired download tokens and upload bindings (daily cron), bounded per
 * run. Attached bindings past expiry are no longer needed: files.by_storageId
 * keeps a storage id from being claimed twice.
 */
export const pruneDownloadTokens = internalMutation({
  args: {},
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx) => {
    const now = Date.now()
    const expired = await ctx.db
      .query('fileDownloadTokens')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
      .take(1000)
    for (const t of expired) await ctx.db.delete(t._id)
    const uploads = await ctx.db
      .query('fileUploads')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
      .take(1000)
    for (const u of uploads) await ctx.db.delete(u._id)
    return { deleted: expired.length + uploads.length }
  },
})

/** GET /files/download?token=… — streams the file for a live token. */
export const download = httpAction(async (ctx, req) => {
  const token = new URL(req.url).searchParams.get('token') ?? ''
  if (!/^[0-9a-f]{64}$/.test(token)) return new Response('Not found', { status: 404 })
  const file = await ctx.runQuery(internal.files.resolveDownload, {
    tokenHash: await sha256Hex(token),
    now: Date.now(),
  })
  if (!file) return new Response('Link expired or not found', { status: 404 })
  const blob = await ctx.storage.get(file.storageId)
  if (!blob) return new Response('Not found', { status: 404 })
  const safeName = file.name.replace(/["\\\r\n]/g, '_')
  return new Response(blob, {
    status: 200,
    headers: {
      'Content-Type': file.mime,
      'Content-Disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})
