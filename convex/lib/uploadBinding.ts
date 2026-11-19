/**
 * Upload binding checks shared by document attachments (files.attach) and
 * company logos (companies.setLogo), CF-004 / doc 16 §9.1.
 *
 * A binding row is created with the upload URL: who asked, for which company,
 * the SHA-256 the client declared, and an expiry. Claiming a stored blob needs
 * the caller's own pending binding, in the same company, before expiry, and a
 * blob created inside the binding's window whose bytes hash to the declared
 * SHA-256. A leaked storage id alone is never enough.
 */
import type { Id } from '../_generated/dataModel'

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

export function isSha256Hex(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value)
}

export type UploadBinding = {
  _creationTime: number
  status: 'pending' | 'attached'
  uploadedBy: Id<'users'>
  companyId: Id<'companies'>
  sha256: string
  expiresAt: number
}

/** The binding is the caller's, in this company, unused and unexpired. */
export function bindingUsableBy(
  binding: UploadBinding | null,
  caller: { userId: Id<'users'>; companyId: Id<'companies'> },
  now: number,
): binding is UploadBinding {
  return (
    binding !== null &&
    binding.status === 'pending' &&
    binding.uploadedBy === caller.userId &&
    binding.companyId === caller.companyId &&
    binding.expiresAt >= now
  )
}

/** The blob was uploaded inside the binding's window with the declared bytes. */
export function blobMatchesBinding(
  meta: { _creationTime: number; sha256: string } | null,
  binding: UploadBinding,
): boolean {
  return (
    meta !== null &&
    meta._creationTime >= binding._creationTime &&
    meta._creationTime <= binding.expiresAt &&
    sha256ToHex(meta.sha256) === binding.sha256
  )
}
