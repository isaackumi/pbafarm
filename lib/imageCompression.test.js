import { describe, expect, test } from 'vitest'
import {
  MAX_EDGE,
  THUMB_EDGE,
  THUMB_MAX_BYTES,
  fitWithin,
  isCompressible,
  outputTypeFor,
  pickSmaller,
  prepareImageUpload,
  renameForType,
} from './imageCompression'

const fileOf = (size, type, name = 'photo.jpg') => new File([new Uint8Array(size)], name, { type })

/** Fake decoder/encoder: records calls and returns blobs of chosen sizes. */
function fakeIo({ width = 4000, height = 3000, sizes = {}, encodedType, fail } = {}) {
  const calls = []
  return {
    calls,
    decode: async () => {
      if (fail === 'decode') throw new Error('cannot decode')
      return { width, height, close: () => calls.push('close') }
    },
    encode: async (_bitmap, opts) => {
      calls.push(opts)
      const thumb = opts.width <= THUMB_EDGE && opts.height <= THUMB_EDGE
      const size = thumb ? (sizes.thumb ?? 20_000) : (sizes.full ?? 300_000)
      return new Blob([new Uint8Array(size)], { type: thumb ? 'image/jpeg' : (encodedType ?? opts.type) })
    },
  }
}

describe('image compression helpers (CF-004)', () => {
  test('only JPEG, PNG and WebP are re-encoded', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp', 'IMAGE/JPEG']) expect(isCompressible(t)).toBe(true)
    for (const t of ['image/gif', 'image/svg+xml', 'image/heic', 'application/pdf', '', undefined]) {
      expect(isCompressible(t)).toBe(false)
    }
  })

  test('fitWithin scales the longer edge down, never up, keeping the ratio', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200, scaled: true })
    expect(fitWithin(3000, 4000, 320)).toEqual({ width: 240, height: 320, scaled: true })
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600, scaled: false })
    expect(fitWithin(1600, 10, 1600)).toEqual({ width: 1600, height: 10, scaled: false })
    expect(fitWithin(10000, 1, 320)).toMatchObject({ width: 320, height: 1 })
  })

  test('PNG becomes WebP; names follow the type', () => {
    expect(outputTypeFor('image/png')).toBe('image/webp')
    expect(outputTypeFor('image/jpeg')).toBe('image/jpeg')
    expect(renameForType('net.png', 'image/webp')).toBe('net.webp')
    expect(renameForType('IMG_1.JPEG', 'image/jpeg')).toBe('IMG_1.JPEG')
    expect(renameForType('scan', 'image/jpeg')).toBe('scan.jpg')
  })

  test('the encoded copy is used only when smaller and of the type asked for', () => {
    const original = fileOf(1000, 'image/png')
    const smaller = new Blob([new Uint8Array(500)], { type: 'image/webp' })
    expect(pickSmaller(original, smaller, 'image/webp')).toBe(smaller)
    expect(pickSmaller(original, new Blob([new Uint8Array(2000)], { type: 'image/webp' }), 'image/webp')).toBeNull()
    // A browser without WebP encoding hands back PNG.
    expect(pickSmaller(original, new Blob([new Uint8Array(500)], { type: 'image/png' }), 'image/webp')).toBeNull()
    expect(pickSmaller(original, null, 'image/webp')).toBeNull()
  })
})

describe('prepareImageUpload', () => {
  test('a large photo is resized, re-encoded and gets a JPEG thumbnail', async () => {
    const io = fakeIo()
    const original = fileOf(4_000_000, 'image/png', 'pond.png')
    const { file, thumbnail } = await prepareImageUpload(original, io)
    expect(file).toBeInstanceOf(File)
    expect(file).toMatchObject({ name: 'pond.webp', type: 'image/webp', size: 300_000 })
    expect(thumbnail).toMatchObject({ type: 'image/jpeg', size: 20_000 })
    expect(io.calls[0]).toMatchObject({ width: MAX_EDGE, height: 1200, type: 'image/webp' })
    expect(io.calls[1]).toMatchObject({ width: THUMB_EDGE, height: 240, type: 'image/jpeg', background: '#fff' })
    expect(io.calls).toContain('close')
  })

  test('keeps the original when re-encoding does not make it smaller', async () => {
    const original = fileOf(100_000, 'image/jpeg')
    const { file, thumbnail } = await prepareImageUpload(original, fakeIo({ width: 900, height: 600, sizes: { full: 150_000 } }))
    expect(file).toBe(original)
    expect(thumbnail).not.toBeNull()
  })

  test('skips non-images, GIF and HEIC, and survives decoder failures', async () => {
    const io = fakeIo()
    for (const f of [fileOf(10, 'application/pdf', 'a.pdf'), fileOf(10, 'image/gif', 'a.gif'), fileOf(10, 'image/heic', 'a.heic')]) {
      expect(await prepareImageUpload(f, io)).toEqual({ file: f, thumbnail: null })
    }
    expect(io.calls).toEqual([])
    const jpeg = fileOf(10, 'image/jpeg')
    expect(await prepareImageUpload(jpeg, fakeIo({ fail: 'decode' }))).toEqual({ file: jpeg, thumbnail: null })
  })

  test('drops a thumbnail over the server limit', async () => {
    const original = fileOf(4_000_000, 'image/jpeg')
    const { file, thumbnail } = await prepareImageUpload(original, fakeIo({ sizes: { thumb: THUMB_MAX_BYTES + 1 } }))
    expect(file.size).toBe(300_000)
    expect(thumbnail).toBeNull()
  })
})
