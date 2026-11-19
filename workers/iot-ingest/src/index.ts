/**
 * Anowa IoT ingestion Worker (CF-008, doc 14 §IoT). Devices POST
 * /v1/readings with their own credentials (src/devices.ts); the Worker checks
 * each reading with the same rules as Convex (checkReading), stamps the
 * device id and pinned unit/site, and forwards valid readings to Convex
 * /ingest/v1/readings with one `ingest:write` key (src/forward.ts).
 *
 * Responses:
 *   200 { accepted, duplicates, rejected[] }  something stored (or already stored)
 *   422 same shape                             nothing could be stored
 *   400 bad JSON / too many readings, 401/403 device auth, 413 body too large
 *   502 Convex refused the Worker's key, 503 Convex unavailable (Retry-After)
 */
import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'
import { fetchLayer, type FetchFn } from '../../../convex/lib/effectHttp'
import { checkReading, type CleanReading } from '../../../convex/integrations/sensorLogic'
import { authenticateDevice, type DeviceStore } from './devices'
import { forwardAll, type ForwardError } from './forward'
import type { HttpPolicy } from '../../../convex/lib/effectHttp'

export type Env = {
  DEVICES: DeviceStore
  CONVEX_SITE_URL: string
  CONVEX_INGEST_KEY: string
}

/** A device batch: up to 2000 readings (forwarded as chunks of 500). */
export const MAX_DEVICE_BATCH = 2000
export const MAX_BODY_BYTES = 1024 * 1024

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

function failureResponse(error: ForwardError) {
  switch (error._tag) {
    case 'UpstreamUnavailable':
      return json(503, { error: error.message }, { 'Retry-After': '30' })
    case 'UpstreamRejected':
      console.error('[iot-ingest] upstream rejected', error.status)
      return json(502, { error: 'The ingestion service refused the request' })
    case 'UpstreamDecodeError':
      return json(502, { error: error.message })
  }
}

export async function handle(
  req: Request,
  env: Env,
  deps: { fetch?: FetchFn; now?: () => number; policy?: HttpPolicy } = {},
): Promise<Response> {
  const url = new URL(req.url)
  if (url.pathname === '/health') return json(200, { ok: true })
  if (url.pathname !== '/v1/readings') return json(404, { error: 'Not found' })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' }, { Allow: 'POST' })
  if (!env.CONVEX_SITE_URL || !env.CONVEX_INGEST_KEY) return json(503, { error: 'Ingestion is not configured' })

  const declared = Number(req.headers.get('Content-Length') ?? '0')
  if (declared > MAX_BODY_BYTES) return json(413, { error: 'Body too large' })
  const raw = await req.text()
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json(413, { error: 'Body too large' })

  const now = (deps.now ?? Date.now)()
  const auth = await authenticateDevice(env.DEVICES, req.headers, raw, now)
  if (!auth.ok) return json(auth.status, { error: auth.message })

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return json(400, { error: 'Body must be JSON' })
  }
  const list = (body as { readings?: unknown })?.readings
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_DEVICE_BATCH) {
    return json(400, { error: `readings must hold 1 to ${MAX_DEVICE_BATCH} items` })
  }

  const rejected: { index: number; reason: string }[] = []
  const ok: CleanReading[] = []
  const indexes: number[] = []
  for (const [index, item] of list.entries()) {
    const fields = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    const checked = checkReading(
      {
        ...fields,
        deviceId: auth.deviceId,
        ...(auth.device.cageId ? { cageId: auth.device.cageId } : {}),
        ...(auth.device.siteId ? { siteId: auth.device.siteId } : {}),
      },
      now,
    )
    if (checked.ok) {
      ok.push(checked.reading)
      indexes.push(index)
    } else rejected.push({ index, reason: checked.reason })
  }
  if (!ok.length) return json(422, { accepted: 0, duplicates: 0, rejected })

  const program = forwardAll({ siteUrl: env.CONVEX_SITE_URL, apiKey: env.CONVEX_INGEST_KEY, policy: deps.policy }, ok, indexes).pipe(
    Effect.provide(fetchLayer(deps.fetch ?? ((input, init) => fetch(input, init)))),
  )
  const result = await Effect.runPromise(Effect.result(program))
  if (Result.isFailure(result)) return failureResponse(result.failure)
  const out = result.success
  const all = [...rejected, ...out.rejected].sort((a, b) => a.index - b.index)
  return json(out.accepted + out.duplicates > 0 ? 200 : 422, { accepted: out.accepted, duplicates: out.duplicates, rejected: all })
}

const worker = {
  fetch(req: Request, env: Env): Promise<Response> {
    return handle(req, env)
  },
}

export default worker
