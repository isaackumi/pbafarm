/**
 * Downloading a photo a worker sent to the farm bot (BOT-006). Effect
 * programs over the `Fetch` service, run from an action only.
 *
 * - WhatsApp Cloud API: GET /{media-id} (Bearer) → { url, mime_type,
 *   file_size }; the url is valid about 5 minutes and needs the same Bearer
 *   token, so the download follows at once.
 *   https://developers.facebook.com/docs/whatsapp/cloud-api/reference/media
 * - Telegram: getFile?file_id=… → { result: { file_path, file_size } }, then
 *   GET /file/bot<token>/<file_path> (link valid at least 1 hour).
 *   https://core.telegram.org/bots/api#getfile
 *
 * Limits: at most MAX_PHOTO_BYTES (declared size, Content-Length and the bytes
 * read, whichever trips first) and only JPEG/PNG/WebP, decided from the
 * bytes' magic numbers, never from the declared type. Error messages never
 * carry URLs: the Telegram token is in the path and Meta's URLs are signed.
 *
 * Voice notes (BOT-005) use the same paths with MAX_AUDIO_BYTES (Meta's 16 MB
 * audio limit) and OGG/Opus, AAC (ADTS), AMR, MP3 or M4A, again by magic
 * bytes only.
 */
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { requestBytes, requestJsonAs, type Fetch, type HttpPolicy } from '../lib/effectHttp'
import { GRAPH_API_VERSION } from '../messaging/providers/whatsappCloud'

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
export type PhotoMime = 'image/jpeg' | 'image/png' | 'image/webp'

/** Meta's limit for audio messages; Telegram bots can download up to 20 MB. */
export const MAX_AUDIO_BYTES = 16 * 1024 * 1024
export type AudioMime = 'audio/ogg' | 'audio/aac' | 'audio/amr' | 'audio/mpeg' | 'audio/mp4'

export type MediaFailure = 'too_large' | 'bad_type' | 'unavailable'

export class MediaError extends Data.TaggedError('MediaError')<{
  readonly reason: MediaFailure
  readonly message: string
}> {}

export type Photo = { bytes: Uint8Array; mime: PhotoMime }
export type Audio = { bytes: Uint8Array; mime: AudioMime }

type MediaKind = 'photo' | 'audio'

/** Media GETs are idempotent: retry network errors, timeouts and 5xx. */
const MEDIA_POLICY: HttpPolicy = { timeoutMs: 20_000, retries: 2, retryBaseDelayMs: 300 }

/** The image type from the first bytes, or null for anything else. */
export function sniffImage(b: Uint8Array): PhotoMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return 'image/png'
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

/** The audio type from the first bytes, or null for anything else. */
export function sniffAudio(b: Uint8Array): AudioMime | null {
  // "OggS": WhatsApp and Telegram voice notes are Opus in Ogg.
  if (b.length >= 4 && b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'audio/ogg'
  // "#!AMR" (AMR-NB) and "#!AMR-WB".
  if (b.length >= 5 && b[0] === 0x23 && b[1] === 0x21 && b[2] === 0x41 && b[3] === 0x4d && b[4] === 0x52) return 'audio/amr'
  // "ID3" tag in front of MP3 frames.
  if (b.length >= 3 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg'
  // ISO BMFF "ftyp" box at offset 4 (M4A / MP4 audio).
  if (b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'audio/mp4'
  if (b.length >= 2 && b[0] === 0xff) {
    // ADTS AAC: 12-bit sync, layer bits 00.
    if ((b[1] & 0xf6) === 0xf0) return 'audio/aac'
    // MPEG audio frame sync (11 bits) with a non-reserved layer: MP3 without a tag.
    if ((b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0) return 'audio/mpeg'
  }
  return null
}

const noun = (kind: MediaKind) => (kind === 'audio' ? 'voice note' : 'photo')
const unavailable = (kind: MediaKind = 'photo') =>
  new MediaError({ reason: 'unavailable', message: `The ${noun(kind)} could not be downloaded` })
const tooLarge = (max: number, kind: MediaKind = 'photo') =>
  new MediaError({ reason: 'too_large', message: `The ${noun(kind)} is larger than ${Math.round(max / (1024 * 1024))} MB` })

/** Meta hands out media URLs on these hosts; the Bearer token is sent nowhere else. */
export function isMetaMediaUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return false
    const host = u.hostname.toLowerCase()
    return ['fbsbx.com', 'facebook.com', 'whatsapp.net', 'fbcdn.net'].some((d) => host === d || host.endsWith(`.${d}`))
  } catch {
    return false
  }
}

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,200}$/
const SAFE_TG_PATH = /^[A-Za-z0-9_./-]{1,200}$/

function checkedAs<M extends string>(
  bytes: Uint8Array,
  max: number,
  kind: MediaKind,
  sniff: (b: Uint8Array) => M | null,
): Effect.Effect<{ bytes: Uint8Array; mime: M }, MediaError> {
  if (bytes.byteLength > max) return Effect.fail(tooLarge(max, kind))
  const mime = sniff(bytes)
  if (!mime) {
    const message = kind === 'audio' ? 'Only OGG, AAC, AMR, MP3 or M4A voice notes can be read' : 'Only JPEG, PNG or WebP photos can be read'
    return Effect.fail(new MediaError({ reason: 'bad_type', message }))
  }
  return Effect.succeed({ bytes, mime })
}

function downloadAs<M extends string>(
  url: string,
  headers: Record<string, string>,
  max: number,
  kind: MediaKind,
  sniff: (b: Uint8Array) => M | null,
) {
  return requestBytes({ url, headers }, { ...MEDIA_POLICY, maxBytes: max }).pipe(
    Effect.catchTags({
      HttpTooLargeError: () => Effect.fail(tooLarge(max, kind)),
      HttpStatusError: () => Effect.fail(unavailable(kind)),
      HttpNetworkError: () => Effect.fail(unavailable(kind)),
      HttpTimeoutError: () => Effect.fail(unavailable(kind)),
    }),
    Effect.flatMap((r) => checkedAs(r.bytes, max, kind, sniff)),
  )
}

const WaMedia = Schema.Struct({
  url: Schema.String,
  mime_type: Schema.optional(Schema.NullOr(Schema.String)),
  file_size: Schema.optional(Schema.NullOr(Schema.Number)),
})

function fetchWhatsAppMedia<M extends string>(
  mediaId: string,
  accessToken: string,
  max: number,
  kind: MediaKind,
  sniff: (b: Uint8Array) => M | null,
): Effect.Effect<{ bytes: Uint8Array; mime: M }, MediaError, Fetch> {
  if (!SAFE_ID.test(mediaId)) return Effect.fail(unavailable(kind))
  const auth = { Authorization: `Bearer ${accessToken}` }
  return requestJsonAs(
    WaMedia,
    { url: `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(mediaId)}`, headers: auth },
    MEDIA_POLICY,
  ).pipe(
    Effect.catchTags({
      HttpStatusError: () => Effect.fail(unavailable(kind)),
      HttpNetworkError: () => Effect.fail(unavailable(kind)),
      HttpTimeoutError: () => Effect.fail(unavailable(kind)),
      HttpDecodeError: () => Effect.fail(unavailable(kind)),
    }),
    Effect.flatMap((meta) => {
      if (typeof meta.file_size === 'number' && meta.file_size > max) return Effect.fail(tooLarge(max, kind))
      if (!isMetaMediaUrl(meta.url)) return Effect.fail(unavailable(kind))
      return downloadAs(meta.url, auth, max, kind, sniff)
    }),
  )
}

/** A WhatsApp image by media id. */
export function fetchWhatsAppPhoto(
  mediaId: string,
  accessToken: string,
  max = MAX_PHOTO_BYTES,
): Effect.Effect<Photo, MediaError, Fetch> {
  return fetchWhatsAppMedia(mediaId, accessToken, max, 'photo', sniffImage)
}

/** A WhatsApp voice note / audio message by media id (BOT-005). */
export function fetchWhatsAppAudio(
  mediaId: string,
  accessToken: string,
  max = MAX_AUDIO_BYTES,
): Effect.Effect<Audio, MediaError, Fetch> {
  return fetchWhatsAppMedia(mediaId, accessToken, max, 'audio', sniffAudio)
}

const TgFile = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  result: Schema.optional(
    Schema.Struct({
      file_path: Schema.optional(Schema.NullOr(Schema.String)),
      file_size: Schema.optional(Schema.NullOr(Schema.Number)),
    }),
  ),
})

function fetchTelegramMedia<M extends string>(
  fileId: string,
  token: string,
  max: number,
  kind: MediaKind,
  sniff: (b: Uint8Array) => M | null,
): Effect.Effect<{ bytes: Uint8Array; mime: M }, MediaError, Fetch> {
  if (!SAFE_ID.test(fileId)) return Effect.fail(unavailable(kind))
  const base = `https://api.telegram.org/bot${encodeURIComponent(token)}`
  return requestJsonAs(TgFile, { url: `${base}/getFile?file_id=${encodeURIComponent(fileId)}` }, MEDIA_POLICY).pipe(
    Effect.catchTags({
      HttpStatusError: () => Effect.fail(unavailable(kind)),
      HttpNetworkError: () => Effect.fail(unavailable(kind)),
      HttpTimeoutError: () => Effect.fail(unavailable(kind)),
      HttpDecodeError: () => Effect.fail(unavailable(kind)),
    }),
    Effect.flatMap((meta) => {
      const path = meta.result?.file_path ?? ''
      const size = meta.result?.file_size
      if (typeof size === 'number' && size > max) return Effect.fail(tooLarge(max, kind))
      if (!SAFE_TG_PATH.test(path) || path.includes('..')) return Effect.fail(unavailable(kind))
      return downloadAs(`https://api.telegram.org/file/bot${encodeURIComponent(token)}/${path}`, {}, max, kind, sniff)
    }),
  )
}

/** A Telegram photo/document by file_id. */
export function fetchTelegramPhoto(
  fileId: string,
  token: string,
  max = MAX_PHOTO_BYTES,
): Effect.Effect<Photo, MediaError, Fetch> {
  return fetchTelegramMedia(fileId, token, max, 'photo', sniffImage)
}

/** A Telegram voice note or audio file by file_id (BOT-005). */
export function fetchTelegramAudio(
  fileId: string,
  token: string,
  max = MAX_AUDIO_BYTES,
): Effect.Effect<Audio, MediaError, Fetch> {
  return fetchTelegramMedia(fileId, token, max, 'audio', sniffAudio)
}
