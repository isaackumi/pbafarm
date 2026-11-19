/**
 * Image compression and thumbnails in the browser before upload (CF-004,
 * doc 14 §2.5, doc 16 §1): photos are resized to at most MAX_EDGE px and
 * re-encoded, and a THUMB_EDGE px JPEG thumbnail is made next to them. No
 * server-side image processing. The SHA-256 the server binds is computed on
 * the bytes this returns, i.e. the bytes actually uploaded.
 *
 * Only JPEG, PNG and WebP are touched. GIF, SVG, HEIC (most browsers cannot
 * decode it) and documents go up unchanged and get no thumbnail. The
 * compressed copy is used only when it is smaller than the original.
 * Re-encoding drops EXIF metadata (including GPS); the decoder applies the
 * EXIF orientation first, so the picture keeps its orientation.
 */

export const MAX_EDGE = 1600
export const QUALITY = 0.8
export const THUMB_EDGE = 320
export const THUMB_QUALITY = 0.7
/** Matches the server's limit (convex/files.ts THUMB_MAX_BYTES). */
export const THUMB_MAX_BYTES = 512 * 1024

const COMPRESSIBLE = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** Whether the browser should try to re-encode this type. */
export function isCompressible(type) {
  return COMPRESSIBLE.has(String(type || '').toLowerCase())
}

/** Dimensions scaled down (never up) so the longer edge is at most maxEdge. */
export function fitWithin(width, height, maxEdge) {
  const longest = Math.max(width, height)
  if (!(longest > maxEdge)) return { width, height, scaled: false }
  const ratio = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    scaled: true,
  }
}

/** PNG goes to WebP (keeps transparency); JPEG and WebP stay as they are. */
export function outputTypeFor(type) {
  const t = String(type || '').toLowerCase()
  return t === 'image/png' ? 'image/webp' : t
}

const EXTENSIONS = {
  'image/jpeg': ['jpg', /\.jpe?g$/i],
  'image/png': ['png', /\.png$/i],
  'image/webp': ['webp', /\.webp$/i],
}

/** The file name with the extension of `type` (photo.png → photo.webp). */
export function renameForType(name, type) {
  const [ext, matches] = EXTENSIONS[type] ?? EXTENSIONS['image/jpeg']
  const current = String(name || '')
  if (matches.test(current)) return current
  const base = current.replace(/\.[^./\\]+$/, '') || 'photo'
  return `${base}.${ext}`
}

/**
 * The encoded blob if it is usable instead of the original: the type asked
 * for (a browser that cannot encode WebP returns PNG) and smaller.
 */
export function pickSmaller(original, encoded, wantedType) {
  if (!encoded || encoded.type !== wantedType) return null
  return encoded.size < original.size ? encoded : null
}

async function decodeInBrowser(file) {
  if (typeof createImageBitmap !== 'function') return null
  return createImageBitmap(file, { imageOrientation: 'from-image' })
}

async function encodeInBrowser(bitmap, { width, height, type, quality, background }) {
  let canvas
  if (typeof OffscreenCanvas === 'function') canvas = new OffscreenCanvas(width, height)
  else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
  } else return null
  const g = canvas.getContext('2d')
  if (!g) return null
  if (background) {
    g.fillStyle = background
    g.fillRect(0, 0, width, height)
  }
  g.imageSmoothingQuality = 'high'
  g.drawImage(bitmap, 0, 0, width, height)
  if (typeof canvas.convertToBlob === 'function') return canvas.convertToBlob({ type, quality })
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

const browserIo = { decode: decodeInBrowser, encode: encodeInBrowser }

/**
 * Compress an image and make its thumbnail. Never throws: on any failure the
 * original file is returned with no thumbnail. `io` is injectable for tests.
 * Returns { file, thumbnail } where `file` is a File and `thumbnail` a JPEG
 * Blob or null.
 */
export async function prepareImageUpload(file, io = browserIo) {
  const unchanged = { file, thumbnail: null }
  if (!file || !isCompressible(file.type)) return unchanged
  let bitmap
  try {
    bitmap = await io.decode(file)
    if (!bitmap?.width || !bitmap?.height) return unchanged
    let out = file
    const wanted = outputTypeFor(file.type)
    const full = fitWithin(bitmap.width, bitmap.height, MAX_EDGE)
    const encoded = await io.encode(bitmap, { ...full, type: wanted, quality: QUALITY })
    const smaller = pickSmaller(file, encoded, wanted)
    if (smaller) {
      out = new File([smaller], renameForType(file.name, wanted), {
        type: wanted,
        lastModified: file.lastModified,
      })
    }
    let thumbnail = null
    const small = fitWithin(bitmap.width, bitmap.height, THUMB_EDGE)
    // JPEG for the thumbnail everywhere; transparent areas become white.
    const thumb = await io.encode(bitmap, { ...small, type: 'image/jpeg', quality: THUMB_QUALITY, background: '#fff' })
    if (thumb && thumb.type === 'image/jpeg' && thumb.size > 0 && thumb.size <= THUMB_MAX_BYTES) thumbnail = thumb
    return { file: out, thumbnail }
  } catch {
    return unchanged
  } finally {
    bitmap?.close?.()
  }
}
