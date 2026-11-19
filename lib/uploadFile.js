import { sha256HexOfFile } from './fileHash'

/**
 * Upload a file and attach it to a record (TRACE-005, CF-004/005).
 * generateUploadUrl says where the bytes go: Convex storage (POST, then
 * files.attach with the storage id) or R2 (presigned PUT with the signed
 * headers, then files.attachR2). Returns attach's { ok, id } / { ok:false, message }.
 */
export async function uploadAndAttach({ file, entityType, entityId, fallbackType, generateUploadUrl, attach, attachR2 }) {
  const contentType = file.type || fallbackType
  const target = await generateUploadUrl({
    entityType,
    entityId,
    sha256: await sha256HexOfFile(file),
    contentType,
    name: file.name,
  })
  const { uploadUrl, uploadId } = target
  if (target.provider === 'r2') {
    const res = await fetch(uploadUrl, { method: 'PUT', headers: target.headers, body: file })
    if (!res.ok) throw new Error('Upload failed. Try again.')
    return attachR2({ entityType, entityId, uploadId, name: file.name })
  }
  const res = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': contentType }, body: file })
  if (!res.ok) throw new Error('Upload failed. Try again.')
  const { storageId } = await res.json()
  return attach({ entityType, entityId, uploadId, storageId, name: file.name })
}
