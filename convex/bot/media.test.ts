import { describe, expect, it } from 'vitest'
import * as Effect from 'effect/Effect'
import { type Fetch, type FetchFn, fetchLayer } from '../lib/effectHttp'
import {
  fetchTelegramAudio,
  fetchTelegramPhoto,
  fetchWhatsAppAudio,
  fetchWhatsAppPhoto,
  isMetaMediaUrl,
  MAX_AUDIO_BYTES,
  type MediaError,
  sniffAudio,
  sniffImage,
} from './media'

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])
const PDF = new TextEncoder().encode('%PDF-1.7')

type Route = (url: string) => Response | Promise<Response>

function fake(route: Route) {
  const calls: { url: string; auth?: string }[] = []
  const fetch: FetchFn = async (url, init) => {
    calls.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization })
    return route(url)
  }
  return { fetch, calls }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

function run<A extends { mime: string }>(e: Effect.Effect<A, MediaError, Fetch>, fetch: FetchFn) {
  return Effect.runPromise(Effect.result(e.pipe(Effect.provide(fetchLayer(fetch)))))
}

describe('BOT-006 media download', () => {
  it('detects image types from bytes, not the declared type', () => {
    expect(sniffImage(JPEG)).toBe('image/jpeg')
    expect(sniffImage(PNG)).toBe('image/png')
    expect(sniffImage(PDF)).toBeNull()
  })

  it('WhatsApp: media lookup then download with the same token', async () => {
    const { fetch, calls } = fake((url) =>
      url.startsWith('https://graph.facebook.com/')
        ? json({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'image/jpeg', file_size: 8 })
        : new Response(JPEG, { status: 200 }),
    )
    const r = await run(fetchWhatsAppPhoto('MEDIA1', 'tok'), fetch)
    expect(r._tag).toBe('Success')
    if (r._tag === 'Success') expect(r.success.mime).toBe('image/jpeg')
    expect(calls.map((c) => c.auth)).toEqual(['Bearer tok', 'Bearer tok'])
  })

  it('oversized media is refused from the declared size without downloading', async () => {
    const { fetch, calls } = fake(() => json({ url: 'https://lookaside.fbsbx.com/x', file_size: 50 * 1024 * 1024 }))
    const r = await run(fetchWhatsAppPhoto('MEDIA1', 'tok'), fetch)
    expect(r._tag === 'Failure' && r.failure.reason).toBe('too_large')
    expect(calls).toHaveLength(1)
  })

  it('oversized media is refused while streaming when the size was not declared', async () => {
    const big = new Uint8Array(64)
    big.set(JPEG)
    const { fetch } = fake((url) =>
      url.includes('graph.facebook.com') ? json({ url: 'https://lookaside.fbsbx.com/x' }) : new Response(big, { status: 200 }),
    )
    const r = await run(fetchWhatsAppPhoto('MEDIA1', 'tok', 32), fetch)
    expect(r._tag === 'Failure' && r.failure.reason).toBe('too_large')
  })

  it('refuses non-images and never sends the token off Meta hosts', async () => {
    const pdf = fake((url) => (url.includes('graph.facebook.com') ? json({ url: 'https://lookaside.fbsbx.com/x' }) : new Response(PDF)))
    const r = await run(fetchWhatsAppPhoto('MEDIA1', 'tok'), pdf.fetch)
    expect(r._tag === 'Failure' && r.failure.reason).toBe('bad_type')

    expect(isMetaMediaUrl('https://evil.example/x')).toBe(false)
    expect(isMetaMediaUrl('http://lookaside.fbsbx.com/x')).toBe(false)
    expect(isMetaMediaUrl('https://lookaside.fbsbx.com.evil.example/x')).toBe(false)
    const evil = fake(() => json({ url: 'https://evil.example/steal' }))
    const r2 = await run(fetchWhatsAppPhoto('MEDIA1', 'tok'), evil.fetch)
    expect(r2._tag === 'Failure' && r2.failure.reason).toBe('unavailable')
    expect(evil.calls).toHaveLength(1)
  })

  it('a 5xx on the download is retried; a 4xx is not', async () => {
    let n = 0
    const flaky = fake((url) => {
      if (url.includes('graph.facebook.com')) return json({ url: 'https://lookaside.fbsbx.com/x' })
      n++
      return n === 1 ? new Response('', { status: 502 }) : new Response(JPEG)
    })
    expect((await run(fetchWhatsAppPhoto('MEDIA1', 'tok'), flaky.fetch))._tag).toBe('Success')
    const gone = fake(() => json({ error: { message: 'expired' } }, 404))
    const r = await run(fetchWhatsAppPhoto('MEDIA1', 'tok'), gone.fetch)
    expect(r._tag === 'Failure' && r.failure.reason).toBe('unavailable')
    expect(gone.calls).toHaveLength(1)
  })

  it('Telegram: getFile then the file path; errors never carry the token', async () => {
    const { fetch, calls } = fake((url) =>
      url.includes('/getFile') ? json({ ok: true, result: { file_path: 'photos/file_1.jpg', file_size: 8 } }) : new Response(JPEG),
    )
    const r = await run(fetchTelegramPhoto('AgAD-1', 'secret-token'), fetch)
    expect(r._tag).toBe('Success')
    expect(calls[1].url).toBe('https://api.telegram.org/file/botsecret-token/photos/file_1.jpg')

    const traversal = fake(() => json({ ok: true, result: { file_path: '../../etc/passwd' } }))
    const bad = await run(fetchTelegramPhoto('AgAD-1', 'secret-token'), traversal.fetch)
    expect(bad._tag === 'Failure' && bad.failure.reason).toBe('unavailable')
    expect(bad._tag === 'Failure' && bad.failure.message).not.toContain('secret-token')
  })
})

const OGG = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0])

describe('BOT-005 voice-note download', () => {
  it('detects audio types from bytes: OGG/Opus, AMR, MP3, AAC, M4A', () => {
    expect(sniffAudio(OGG)).toBe('audio/ogg')
    expect(sniffAudio(new TextEncoder().encode('#!AMR\n'))).toBe('audio/amr')
    expect(sniffAudio(new TextEncoder().encode('ID3\x04'))).toBe('audio/mpeg')
    expect(sniffAudio(new Uint8Array([0xff, 0xfb, 0x90, 0x64]))).toBe('audio/mpeg')
    expect(sniffAudio(new Uint8Array([0xff, 0xf1, 0x50, 0x80]))).toBe('audio/aac')
    expect(sniffAudio(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41]))).toBe('audio/mp4')
    expect(sniffAudio(JPEG)).toBeNull()
    expect(sniffAudio(PDF)).toBeNull()
    expect(MAX_AUDIO_BYTES).toBe(16 * 1024 * 1024)
  })

  it('WhatsApp: a voice note downloads with the same token; a photo sent as audio is refused', async () => {
    const ok = fake((url) =>
      url.includes('graph.facebook.com') ? json({ url: 'https://lookaside.fbsbx.com/x', mime_type: 'audio/ogg; codecs=opus', file_size: 8 }) : new Response(OGG),
    )
    const r = await run(fetchWhatsAppAudio('MEDIA1', 'tok'), ok.fetch)
    expect(r._tag === 'Success' && r.success.mime).toBe('audio/ogg')
    expect(ok.calls.map((c) => c.auth)).toEqual(['Bearer tok', 'Bearer tok'])

    const jpeg = fake((url) => (url.includes('graph.facebook.com') ? json({ url: 'https://lookaside.fbsbx.com/x', mime_type: 'audio/ogg' }) : new Response(JPEG)))
    const bad = await run(fetchWhatsAppAudio('MEDIA1', 'tok'), jpeg.fetch)
    expect(bad._tag === 'Failure' && bad.failure.reason).toBe('bad_type')
  })

  it('refuses audio over 16 MB from the declared size, and while streaming', async () => {
    const declared = fake(() => json({ url: 'https://lookaside.fbsbx.com/x', file_size: MAX_AUDIO_BYTES + 1 }))
    const r = await run(fetchWhatsAppAudio('MEDIA1', 'tok'), declared.fetch)
    expect(r._tag === 'Failure' && r.failure.reason).toBe('too_large')
    expect(r._tag === 'Failure' && r.failure.message).toMatch(/voice note is larger than 16 MB/)
    expect(declared.calls).toHaveLength(1)

    const big = new Uint8Array(64)
    big.set(OGG)
    const streamed = fake((url) => (url.includes('graph.facebook.com') ? json({ url: 'https://lookaside.fbsbx.com/x' }) : new Response(big)))
    const r2 = await run(fetchWhatsAppAudio('MEDIA1', 'tok', 32), streamed.fetch)
    expect(r2._tag === 'Failure' && r2.failure.reason).toBe('too_large')
  })

  it('Telegram: voice via getFile; oversize declared refused; errors never carry the token or URL', async () => {
    const ok = fake((url) => (url.includes('/getFile') ? json({ ok: true, result: { file_path: 'voice/file_2.oga', file_size: 8 } }) : new Response(OGG)))
    const r = await run(fetchTelegramAudio('AwAD-1', 'secret-token'), ok.fetch)
    expect(r._tag === 'Success' && r.success.mime).toBe('audio/ogg')
    expect(ok.calls[1].url).toBe('https://api.telegram.org/file/botsecret-token/voice/file_2.oga')

    const huge = fake(() => json({ ok: true, result: { file_path: 'voice/file_2.oga', file_size: 20 * 1024 * 1024 } }))
    const r2 = await run(fetchTelegramAudio('AwAD-1', 'secret-token'), huge.fetch)
    expect(r2._tag === 'Failure' && r2.failure.reason).toBe('too_large')
    expect(huge.calls).toHaveLength(1)

    const gone = fake(() => json({ ok: false }, 400))
    const r3 = await run(fetchTelegramAudio('AwAD-1', 'secret-token'), gone.fetch)
    expect(r3._tag === 'Failure' && r3.failure.message).toBe('The voice note could not be downloaded')
  })
})
