import { sha256HexOfFile } from './fileHash'
import { prepareImageUpload } from './imageCompression'

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

/**
 * Upload a file and attach it to a record (TRACE-005, CF-004/005).
 * Images are compressed first and sent with a thumbnail (lib/imageCompression,
 * CF-004); the SHA-256 is of the bytes actually sent. generateUploadUrl says
 * where the bytes go: Convex storage (POST, then files.attach with the storage
 * id) or R2 (presigned PUT with the signed headers, then files.attachR2). A
 * failed thumbnail upload only means the file is attached without one.
 * Returns attach's { ok, id } / { ok:false, message }.
 */
export async function uploadAndAttach({ file: picked, entityType, entityId, locationId, fallbackType, generateUploadUrl, attach, attachR2 }) {
  const { file, thumbnail } = await prepareImageUpload(picked)
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Files can be at most 10 MB')
  const contentType = file.type || fallbackType
  const target = await generateUploadUrl({
    entityType,
    entityId,
    sha256: await sha256HexOfFile(file),
    contentType,
    name: file.name,
    // Custom-field photos: the site of the record the photo is for (PERM-004).
    ...(locationId ? { locationId } : {}),
    ...(thumbnail ? { thumbnail: { sha256: await sha256HexOfFile(thumbnail), contentType: thumbnail.type } } : {}),
  })
  const { uploadUrl, uploadId } = target
  if (target.provider === 'r2') {
    const res = await fetch(uploadUrl, { method: 'PUT', headers: target.headers, body: file })
    if (!res.ok) throw new Error('Upload failed. Try again.')
    if (target.thumb) await sendThumbnail(target.thumb, thumbnail)
    return attachR2({ entityType, entityId, uploadId, name: file.name })
  }
  const res = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': contentType }, body: file })
  if (!res.ok) throw new Error('Upload failed. Try again.')
  const { storageId } = await res.json()
  const thumbStorageId = target.thumb ? await sendThumbnail(target.thumb, thumbnail) : undefined
  return attach({ entityType, entityId, uploadId, storageId, name: file.name, ...(thumbStorageId ? { thumbStorageId } : {}) })
}

/** PUT/POST the thumbnail; the Convex storage id for a POST. Never throws. */
async function sendThumbnail(thumb, blob) {
  if (!blob) return undefined
  try {
    const headers = thumb.method === 'PUT' ? thumb.headers : { 'Content-Type': blob.type }
    const res = await fetch(thumb.uploadUrl, { method: thumb.method, headers, body: blob })
    if (!res.ok || thumb.method === 'PUT') return undefined
    return (await res.json()).storageId
  } catch {
    return undefined
  }
}
