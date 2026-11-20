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
 */
import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { requestBytes, requestJsonAs, type Fetch, type HttpPolicy } from '../lib/effectHttp'
import { GRAPH_API_VERSION } from '../messaging/providers/whatsappCloud'

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
export type PhotoMime = 'image/jpeg' | 'image/png' | 'image/webp'

export type MediaFailure = 'too_large' | 'bad_type' | 'unavailable'

export class MediaError extends Data.TaggedError('MediaError')<{
  readonly reason: MediaFailure
  readonly message: string
}> {}

export type Photo = { bytes: Uint8Array; mime: PhotoMime }

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

const unavailable = () => new MediaError({ reason: 'unavailable', message: 'The photo could not be downloaded' })
const tooLarge = (max: number) =>
  new MediaError({ reason: 'too_large', message: `The photo is larger than ${Math.round(max / (1024 * 1024))} MB` })

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

function checked(bytes: Uint8Array, max: number): Effect.Effect<Photo, MediaError> {
  if (bytes.byteLength > max) return Effect.fail(tooLarge(max))
  const mime = sniffImage(bytes)
  if (!mime) return Effect.fail(new MediaError({ reason: 'bad_type', message: 'Only JPEG, PNG or WebP photos can be read' }))
  return Effect.succeed({ bytes, mime })
}

function download(url: string, headers: Record<string, string>, max: number) {
  return requestBytes({ url, headers }, { ...MEDIA_POLICY, maxBytes: max }).pipe(
    Effect.catchTags({
      HttpTooLargeError: () => Effect.fail(tooLarge(max)),
      HttpStatusError: () => Effect.fail(unavailable()),
      HttpNetworkError: () => Effect.fail(unavailable()),
      HttpTimeoutError: () => Effect.fail(unavailable()),
    }),
    Effect.flatMap((r) => checked(r.bytes, max)),
  )
}

const WaMedia = Schema.Struct({
  url: Schema.String,
  mime_type: Schema.optional(Schema.NullOr(Schema.String)),
  file_size: Schema.optional(Schema.NullOr(Schema.Number)),
})

/** A WhatsApp image by media id. */
export function fetchWhatsAppPhoto(
  mediaId: string,
  accessToken: string,
  max = MAX_PHOTO_BYTES,
): Effect.Effect<Photo, MediaError, Fetch> {
  if (!SAFE_ID.test(mediaId)) return Effect.fail(unavailable())
  const auth = { Authorization: `Bearer ${accessToken}` }
  return requestJsonAs(
    WaMedia,
    { url: `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(mediaId)}`, headers: auth },
    MEDIA_POLICY,
  ).pipe(
    Effect.catchTags({
      HttpStatusError: () => Effect.fail(unavailable()),
      HttpNetworkError: () => Effect.fail(unavailable()),
      HttpTimeoutError: () => Effect.fail(unavailable()),
      HttpDecodeError: () => Effect.fail(unavailable()),
    }),
    Effect.flatMap((meta) => {
      if (typeof meta.file_size === 'number' && meta.file_size > max) return Effect.fail(tooLarge(max))
      if (!isMetaMediaUrl(meta.url)) return Effect.fail(unavailable())
      return download(meta.url, auth, max)
    }),
  )
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

/** A Telegram photo/document by file_id. */
export function fetchTelegramPhoto(
  fileId: string,
  token: string,
  max = MAX_PHOTO_BYTES,
): Effect.Effect<Photo, MediaError, Fetch> {
  if (!SAFE_ID.test(fileId)) return Effect.fail(unavailable())
  const base = `https://api.telegram.org/bot${encodeURIComponent(token)}`
  return requestJsonAs(TgFile, { url: `${base}/getFile?file_id=${encodeURIComponent(fileId)}` }, MEDIA_POLICY).pipe(
    Effect.catchTags({
      HttpStatusError: () => Effect.fail(unavailable()),
      HttpNetworkError: () => Effect.fail(unavailable()),
      HttpTimeoutError: () => Effect.fail(unavailable()),
      HttpDecodeError: () => Effect.fail(unavailable()),
    }),
    Effect.flatMap((meta) => {
      const path = meta.result?.file_path ?? ''
      const size = meta.result?.file_size
      if (typeof size === 'number' && size > max) return Effect.fail(tooLarge(max))
      if (!SAFE_TG_PATH.test(path) || path.includes('..')) return Effect.fail(unavailable())
      return download(`https://api.telegram.org/file/bot${encodeURIComponent(token)}/${path}`, {}, max)
    }),
  )
}
