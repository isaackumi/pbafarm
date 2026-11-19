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
 *
 * R2 (CF-005, docs/ops/r2-storage.md): when the R2_* env vars are set (and
 * FILES_PROVIDER is not `convex`), `generateUploadUrl` returns a presigned R2
 * PUT for the key `files/<companyId>/<uploadId>` instead, and the client
 * calls the `attachR2` action, which checks the same binding, downloads the
 * object and checks its SHA-256 before registering it. Downloads of
 * `provider: 'r2'` rows redirect, after the same token check, to a presigned
 * GET valid five minutes. With the env unset nothing changes.
 */
import { v } from 'convex/values'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import {
  action,
  httpAction,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { internal } from './_generated/api'
import { assertOwns, logAudit } from './lib/tenancy'
import { assertSiteFilterInScope, rowInSiteScope, siteScopeOf } from './lib/scope'
import { userError } from './lib/errors'
import { randomToken, sha256Hex } from './lib/tokens'
import { fileEntityType } from './schema'
import { assertUserCan, requireMember } from './lib/permissions'
import { bindingUsableBy, blobMatchesBinding, isSha256Hex } from './lib/uploadBinding'
import { runEffect } from './lib/effect'
import { rateLimiter, retryAfterText } from './lib/rateLimits'
import { fetchLayer } from './lib/effectHttp'
import { R2Storage, r2ConfigFromEnv, r2Layer, r2Live } from './lib/r2'
import {
  R2UploadRejected,
  contentDisposition,
  filesProvider,
  inspectUpload,
  presignDownload,
  R2_UPLOAD_TTL_SEC,
  presignUpload,
  r2UploadKey,
} from './lib/r2Files'

export { sha256ToHex } from './lib/uploadBinding'

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

/**
 * Site a custom-field photo is uploaded for (PERM-004): the record's site the
 * client sends, which must be one of the caller's; without one, a site-limited
 * member's active site (else their first), so the photo never lands outside
 * their sites. Undefined (company-wide) only for an all-sites member.
 */
async function photoSite(
  ctx: Ctx,
  user: Doc<'users'>,
  companyId: Id<'companies'>,
  locationId: Id<'farmLocations'> | undefined,
): Promise<Id<'farmLocations'> | undefined> {
  if (locationId) {
    const site = await ctx.db.get(locationId)
    if (!site || site.companyId !== companyId) throw userError('NOT_FOUND', 'Site not found')
    assertSiteFilterInScope(user, locationId)
    return locationId
  }
  const scope = siteScopeOf(user)
  if (!scope) return undefined
  const active = user.activeLocationId
  return active && scope.has(active) ? active : user.locationIds?.[0]
}

/**
 * Whether the caller's site scope (PERM-004) covers a file. A file carries its
 * record's site. A row without one falls back to its record (rows written
 * before files recorded the site), and a record without a site is
 * company-level, visible to all, as in rowInSiteScope. A custom-field photo
 * without a site has no record to fall back to (it hangs off the field
 * definition), so a site-limited member does not get it: legacy photos stay
 * hidden from them until migrations:stampCustomFieldPhotoSites records their site.
 */
async function fileInSiteScope(
  ctx: Ctx,
  user: Doc<'users'>,
  file: Doc<'files'>,
  parent?: { locationId?: Id<'farmLocations'> } | null,
): Promise<boolean> {
  const scope = siteScopeOf(user)
  if (!scope) return true
  if (file.locationId) return scope.has(file.locationId)
  if (file.entityType === 'customFieldDefs') return false
  const record = parent !== undefined ? parent : await loadEntity(ctx, file.entityType, file.entityId)
  return rowInSiteScope(scope, record)
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

/**
 * R2 signing only, for mutations (no network): presigning is local Web Crypto.
 * Undefined when R2 is not configured.
 */
function r2SignerLayer() {
  const config = r2ConfigFromEnv()
  if (!config) return undefined
  return r2Layer(config).pipe(
    Layer.provide(fetchLayer(() => Promise.reject(new Error('R2 network calls are not allowed here')))),
  )
}

const r2Unavailable = () => userError('RATE_LIMITED', 'File storage is unavailable right now. Try again shortly.')

const uploadResult = v.object({
  uploadUrl: v.string(),
  uploadId: v.id('fileUploads'),
  /** 'convex': POST the bytes, read { storageId }, call attach. 'r2': PUT, then attachR2. */
  provider: v.union(v.literal('convex'), v.literal('r2')),
  method: v.union(v.literal('POST'), v.literal('PUT')),
  /** Headers the upload request must send (signed into the R2 URL). */
  headers: v.record(v.string(), v.string()),
})

const attachResult = v.union(
  v.object({ ok: v.literal(false), code: v.literal('VALIDATION'), message: v.string() }),
  v.object({ ok: v.literal(true), id: v.id('files') }),
)

export const generateUploadUrl = mutation({
  args: {
    entityType: fileEntityType,
    entityId: v.string(),
    /** SHA-256 (hex) of the file about to be uploaded (lib/fileHash.js). */
    sha256: v.string(),
    /** The file's type and name; R2 uploads sign the type in (falls back to the name's extension). */
    contentType: v.optional(v.string()),
    name: v.optional(v.string()),
    /** Custom-field photos only: the site of the record the photo is for. */
    locationId: v.optional(v.id('farmLocations')),
  },
  returns: uploadResult,
  handler: async (ctx, { entityType, entityId, sha256, contentType, name, locationId }) => {
    const { user } = await requireMember(ctx, { permission: 'files.upload' })
    const owner = await ownedEntity(ctx, user, entityType, entityId)
    const site =
      entityType === 'customFieldDefs' ? await photoSite(ctx, user, owner.companyId, locationId) : undefined
    if (!isSha256Hex(sha256)) throw userError('VALIDATION', 'Invalid file checksum')
    const signer = filesProvider() === 'r2' ? r2SignerLayer() : undefined
    let mime: string | undefined
    if (signer) {
      mime = (contentType ?? '').split(';')[0].trim().toLowerCase() || mimeFromName(name ?? '')
      if (!ALLOWED_MIME.has(mime)) {
        throw userError('VALIDATION', 'Only PDF, images, CSV, text, Excel and Word files can be attached')
      }
    }
    for (const [name, key] of [
      ['uploadUrlPerUser', user._id],
      ['uploadUrlPerCompany', owner.companyId],
    ] as const) {
      const limit = await rateLimiter.limit(ctx, name, { key })
      if (!limit.ok) throw userError('RATE_LIMITED', `Too many uploads. ${retryAfterText(limit.retryAfter)}`)
    }
    const now = Date.now()
    const uploadId = await ctx.db.insert('fileUploads', {
      companyId: owner.companyId,
      uploadedBy: user._id,
      entityType,
      entityId,
      status: 'pending',
      sha256: sha256.toLowerCase(),
      ...(site ? { locationId: site } : {}),
      createdAt: now,
      expiresAt: now + CLAIM_WINDOW_MS,
    })
    if (!signer || !mime) {
      return { uploadUrl: await ctx.storage.generateUploadUrl(), uploadId, provider: 'convex' as const, method: 'POST' as const, headers: {} }
    }
    const r2Key = r2UploadKey(owner.companyId, uploadId)
    await ctx.db.patch(uploadId, { provider: 'r2', r2Key, contentType: mime })
    // The PUT URL does not bound the body size, so an unclaimed object is deleted
    // as soon as the claim window ends rather than at the next daily prune.
    await ctx.scheduler.runAfter(CLAIM_WINDOW_MS, internal.files.discardUnclaimedUpload, { uploadId })
    const signed = await runEffect(
      presignUpload({ key: r2Key, contentType: mime, sha256: sha256.toLowerCase() }).pipe(Effect.provide(signer)),
      { toUserError: r2Unavailable },
    )
    return { uploadUrl: signed.url, uploadId, provider: 'r2' as const, method: 'PUT' as const, headers: signed.headers }
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
  returns: attachResult,
  handler: async (ctx, args) => {
    const { user } = await requireMember(ctx, { permission: 'files.upload' })
    const owner = await ownedEntity(ctx, user, args.entityType, args.entityId)
    const notFound = () => userError('NOT_FOUND', 'File not found. Upload it again.')
    // The binding must be this member's, in this company, for this record,
    // unused and unexpired (CF-004): another company's upload cannot be claimed.
    const upload = await ctx.db.get(args.uploadId)
    if (
      !bindingUsableBy(upload, { userId: user._id, companyId: owner.companyId }, Date.now()) ||
      upload.entityType !== args.entityType ||
      upload.entityId !== args.entityId ||
      upload.provider === 'r2'
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
    if (!meta || !blobMatchesBinding(meta, upload)) throw notFound()
    // The type the upload was sent with; older clients may not set one.
    const mime =
      (meta.contentType ?? '').split(';')[0].trim().toLowerCase() || mimeFromName(args.name)
    // A refused file is deleted. Throwing would roll the delete back, so the
    // refusal is returned instead: { ok: false, code, message }.
    const reject = async (message: string) => {
      await ctx.storage.delete(args.storageId)
      return { ok: false as const, code: 'VALIDATION' as const, message }
    }
    const refusal = await refusalFor(ctx, owner.companyId, args.entityType, args.entityId, mime, meta.size)
    if (refusal) return await reject(refusal)
    const id = await registerFile(ctx, user, owner, upload, {
      entityType: args.entityType,
      entityId: args.entityId,
      name: args.name,
      mime,
      size: meta.size,
      storageId: args.storageId,
    })
    return { ok: true as const, id }
  },
})

/** Why an upload cannot be attached (type, size, per-record cap), or null. */
async function refusalFor(
  ctx: MutationCtx,
  companyId: Id<'companies'>,
  entityType: EntityType,
  entityId: string,
  mime: string,
  size: number,
): Promise<string | null> {
  if (!ALLOWED_MIME.has(mime)) return 'Only PDF, images, CSV, text, Excel and Word files can be attached'
  if (size > MAX_FILE_BYTES) return 'Files can be at most 10 MB'
  const existing = await ctx.db
    .query('files')
    .withIndex('by_companyId_and_entityType_and_entityId', (q) =>
      q.eq('companyId', companyId).eq('entityType', entityType).eq('entityId', entityId),
    )
    .take(FILES_PER_RECORD)
  // Photos of a custom photo field all hang off its definition: no per-record cap.
  if (entityType !== 'customFieldDefs' && existing.length >= FILES_PER_RECORD) {
    return `A record can have at most ${FILES_PER_RECORD} files`
  }
  return null
}

/** Insert the files row, close the binding, audit. */
async function registerFile(
  ctx: MutationCtx,
  user: Doc<'users'>,
  owner: { companyId: Id<'companies'>; locationId?: Id<'farmLocations'> },
  upload: Doc<'fileUploads'>,
  f: {
    entityType: EntityType
    entityId: string
    name: string
    mime: string
    size: number
    storageId?: Id<'_storage'>
    r2Key?: string
  },
): Promise<Id<'files'>> {
  const name = f.name.trim().slice(0, 200) || 'file'
  // The record's site; a custom-field photo's comes from its upload binding.
  const locationId = owner.locationId ?? upload.locationId
  const id = await ctx.db.insert('files', {
    companyId: owner.companyId,
    locationId,
    entityType: f.entityType,
    entityId: f.entityId,
    provider: f.r2Key ? 'r2' : 'convex',
    storageId: f.storageId,
    r2Key: f.r2Key,
    name,
    mime: f.mime,
    size: f.size,
    uploadedBy: user._id,
    createdAt: Date.now(),
  })
  await ctx.db.patch(upload._id, { status: 'attached', storageId: f.storageId, fileId: id })
  await logAudit(ctx, {
    actionType: 'file_attached',
    tableName: 'files',
    recordId: id,
    newValues: { entityType: f.entityType, entityId: f.entityId, name, mime: f.mime, size: f.size },
    locationId,
  })
  return id
}

const removeObject = (key: string) =>
  Effect.gen(function* () {
    const r2 = yield* R2Storage
    yield* r2.remove(key)
  })

const r2AttachArgs = {
  entityType: fileEntityType,
  entityId: v.string(),
  uploadId: v.id('fileUploads'),
}

/** The caller's pending R2 binding for this record, or NOT_FOUND. */
async function r2Binding(
  ctx: Ctx,
  args: { entityType: EntityType; entityId: string; uploadId: Id<'fileUploads'> },
) {
  const { user } = await requireMember(ctx, { permission: 'files.upload' })
  const owner = await ownedEntity(ctx, user, args.entityType, args.entityId)
  const upload = await ctx.db.get(args.uploadId)
  if (
    !bindingUsableBy(upload, { userId: user._id, companyId: owner.companyId }, Date.now()) ||
    upload.entityType !== args.entityType ||
    upload.entityId !== args.entityId ||
    upload.provider !== 'r2' ||
    !upload.r2Key ||
    !upload.contentType
  ) {
    throw userError('NOT_FOUND', 'File not found. Upload it again.')
  }
  return { user, owner, upload, r2Key: upload.r2Key, contentType: upload.contentType }
}

export const r2UploadForAttach = internalQuery({
  args: r2AttachArgs,
  returns: v.object({ r2Key: v.string(), sha256: v.string(), contentType: v.string() }),
  handler: async (ctx, args) => {
    const b = await r2Binding(ctx, args)
    return { r2Key: b.r2Key, sha256: b.upload.sha256, contentType: b.contentType }
  },
})

export const attachR2Object = internalMutation({
  args: { ...r2AttachArgs, name: v.string(), size: v.number() },
  returns: attachResult,
  handler: async (ctx, args) => {
    const b = await r2Binding(ctx, args)
    const refusal = await refusalFor(ctx, b.owner.companyId, args.entityType, args.entityId, b.contentType, args.size)
    if (refusal) return { ok: false as const, code: 'VALIDATION' as const, message: refusal }
    const id = await registerFile(ctx, b.user, b.owner, b.upload, {
      entityType: args.entityType,
      entityId: args.entityId,
      name: args.name,
      mime: b.contentType,
      size: args.size,
      r2Key: b.r2Key,
    })
    return { ok: true as const, id }
  },
})

/**
 * Attach an upload that went to R2 (generateUploadUrl returned provider
 * 'r2'). Same binding check as `attach`; the object must exist, be at most
 * 10 MB and hash to the declared SHA-256. A refused object is deleted.
 */
export const attachR2 = action({
  args: { ...r2AttachArgs, name: v.string() },
  returns: attachResult,
  handler: async (ctx, args): Promise<{ ok: false; code: 'VALIDATION'; message: string } | { ok: true; id: Id<'files'> }> => {
    const binding: { r2Key: string; sha256: string; contentType: string } = await ctx.runQuery(
      internal.files.r2UploadForAttach,
      { entityType: args.entityType, entityId: args.entityId, uploadId: args.uploadId },
    )
    const layer = r2Live()
    const drop = () => runEffect(removeObject(binding.r2Key).pipe(Effect.provide(layer), Effect.ignore))
    const inspected = await runEffect(
      inspectUpload({ key: binding.r2Key, sha256: binding.sha256, maxBytes: MAX_FILE_BYTES }).pipe(
        Effect.map((info) => ({ ok: true as const, size: info.size })),
        Effect.catchTag('R2UploadRejected', (e: R2UploadRejected) =>
          Effect.succeed({ ok: false as const, reason: e.reason, message: e.message }),
        ),
        Effect.provide(layer),
      ),
      { toUserError: r2Unavailable },
    )
    if (!inspected.ok) {
      if (inspected.reason !== 'missing') await drop()
      if (inspected.reason === 'too_large') return { ok: false, code: 'VALIDATION', message: inspected.message }
      throw userError('NOT_FOUND', 'File not found. Upload it again.')
    }
    const result: { ok: false; code: 'VALIDATION'; message: string } | { ok: true; id: Id<'files'> } =
      await ctx.runMutation(internal.files.attachR2Object, {
        entityType: args.entityType,
        entityId: args.entityId,
        uploadId: args.uploadId,
        name: args.name,
        size: inspected.size,
      })
    if (!result.ok) await drop()
    return result
  },
})

/** Delete an R2 object (file removed, upload refused or abandoned). No-op without R2. */
/** Delete the R2 object of an upload that was never attached. */
export const discardUnclaimedUpload = internalMutation({
  args: { uploadId: v.id('fileUploads') },
  returns: v.null(),
  handler: async (ctx, { uploadId }) => {
    const u = await ctx.db.get(uploadId)
    if (u && u.status === 'pending' && u.provider === 'r2' && u.r2Key) {
      await ctx.scheduler.runAfter(0, internal.files.deleteR2Object, { key: u.r2Key })
    }
    return null
  },
})

export const deleteR2Object = internalAction({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (_ctx, { key }) => {
    if (!r2ConfigFromEnv()) return null
    await runEffect(removeObject(key).pipe(Effect.provide(r2Live())))
    return null
  },
})

const fileRowValidator = v.object({
  id: v.id('files'),
  name: v.string(),
  mime: v.string(),
  size: v.number(),
  entity_type: fileEntityType,
  entity_id: v.string(),
  uploaded_by: v.id('users'),
  created_at: v.number(),
})

export const list = query({
  args: { entityType: fileEntityType, entityId: v.string() },
  returns: v.array(fileRowValidator),
  handler: async (ctx, { entityType, entityId }) => {
    const { user } = await requireMember(ctx, { permission: 'org.view' })
    const doc = await loadEntity(ctx, entityType, entityId)
    if (!doc?.companyId || user.companyId !== doc.companyId) return []
    // A record on a site outside the member's scope is as good as missing (PERM-004).
    if (!rowInSiteScope(siteScopeOf(user), doc)) return []
    const companyId = doc.companyId
    const rows = await ctx.db
      .query('files')
      .withIndex('by_companyId_and_entityType_and_entityId', (q) =>
        q.eq('companyId', companyId).eq('entityType', entityType).eq('entityId', entityId),
      )
      .take(FILES_PER_RECORD)
    const visible = []
    for (const f of rows) if (await fileInSiteScope(ctx, user, f, doc)) visible.push(f)
    return visible.map(fileRow)
  },
})

/** A download path valid for a few minutes, only for the owning company's members on the file's site. */
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
    // ...and only on the member's sites (PERM-004), like assertOwns.
    if (!(await fileInSiteScope(ctx, user, file))) throw userError('NOT_FOUND', 'File not found')
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
    if (!(await fileInSiteScope(ctx, user, file))) throw userError('NOT_FOUND', 'File not found')
    // Your own attachment, or anyone's with production.records.delete.
    if (file.uploadedBy !== user._id) await assertUserCan(ctx, user, 'production.records.delete')
    await deleteFileBlobs(ctx, file)
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

/** Delete a file's bytes wherever they are (Convex blob now, R2 object via an action). */
export async function deleteFileBlobs(
  ctx: MutationCtx,
  file: { storageId?: Id<'_storage'>; r2Key?: string },
): Promise<void> {
  if (file.storageId) {
    try {
      await ctx.storage.delete(file.storageId)
    } catch {
      /* already gone */
    }
  }
  if (file.r2Key) {
    await ctx.scheduler.runAfter(0, internal.files.deleteR2Object, { key: file.r2Key })
    // The upload's presigned PUT may still be live and could recreate the key
    // once it is gone (If-None-Match only blocks an existing object): delete
    // again after any such URL has expired.
    await ctx.scheduler.runAfter(R2_UPLOAD_TTL_SEC * 1000 + 60_000, internal.files.deleteR2Object, { key: file.r2Key })
  }
}

/** The file a download token grants, if the token is live and the file still exists. */
export const resolveDownload = internalQuery({
  args: { tokenHash: v.string(), now: v.number() },
  returns: v.union(
    v.object({
      provider: v.union(v.literal('convex'), v.literal('r2')),
      storageId: v.optional(v.id('_storage')),
      r2Key: v.optional(v.string()),
      name: v.string(),
      mime: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, { tokenHash, now }) => {
    const grant = await ctx.db
      .query('fileDownloadTokens')
      .withIndex('by_tokenHash', (q) => q.eq('tokenHash', tokenHash))
      .first()
    if (!grant || grant.expiresAt < now) return null
    const file = await ctx.db.get(grant.fileId)
    if (!file || file.companyId !== grant.companyId) return null
    return { provider: file.provider, storageId: file.storageId, r2Key: file.r2Key, name: file.name, mime: file.mime }
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
    for (const u of uploads) {
      // An R2 upload never attached leaves an object behind: delete it.
      if (u.status === 'pending' && u.provider === 'r2' && u.r2Key) {
        await ctx.scheduler.runAfter(0, internal.files.deleteR2Object, { key: u.r2Key })
      }
      await ctx.db.delete(u._id)
    }
    const logoUploads = await ctx.db
      .query('logoUploadRequests')
      .withIndex('by_expiresAt', (q) => q.lt('expiresAt', now))
      .take(1000)
    for (const u of logoUploads) await ctx.db.delete(u._id)
    return { deleted: expired.length + uploads.length + logoUploads.length }
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
  if (file.provider === 'r2' && file.r2Key) {
    if (!r2ConfigFromEnv()) return new Response('File storage is unavailable', { status: 503 })
    const url = await runEffect(
      presignDownload({ key: file.r2Key, name: file.name, mime: file.mime }).pipe(Effect.provide(r2Live())),
    )
    return new Response(null, {
      status: 302,
      headers: { Location: url, 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
    })
  }
  if (!file.storageId) return new Response('Not found', { status: 404 })
  const blob = await ctx.storage.get(file.storageId)
  if (!blob) return new Response('Not found', { status: 404 })
  return new Response(blob, {
    status: 200,
    headers: {
      'Content-Type': file.mime,
      'Content-Disposition': contentDisposition(file.name),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})
