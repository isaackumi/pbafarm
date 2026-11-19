# IoT ingestion Worker (CF-008)

A Cloudflare Worker that sits in front of the Convex sensor endpoint
(`POST /ingest/v1/readings`, INT-007). Devices authenticate with their own
credentials. Convex sees one `ingest:write` API key, which the Worker holds.
This keeps per-device secrets out of Convex and lets a large fleet send
bigger batches (up to 2,000 readings) at the edge.

It is **not deployed** by CI or by this repository. Convex ingestion works
without it (doc 14: add the Worker when volume or device count calls for it).

## Request

```
POST /v1/readings
X-Device-Id: probe-1
X-Device-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
# or, for devices that cannot sign:
Authorization: Bearer <device token>

{ "readings": [ { "parameter": "dissolved_oxygen", "value": 5.2, "measuredAt": "2026-01-15T12:00:00Z" } ] }
```

- `deviceId` always comes from `X-Device-Id`, never from the body.
- If the device is pinned to a unit or site, `cageId` and `siteId` come from
  its record.
- Parameters and value ranges match Convex (`convex/integrations/sensorLogic.ts`).
- The signature uses the same scheme as inbound webhooks (INT-003), with a
  300-second tolerance. A replay inside that window is harmless because
  Convex de-duplicates readings by (company, device, parameter, measuredAt).
- Responses:

  | Status | Meaning |
  | --- | --- |
  | 200 / 422 | `{ accepted, duplicates, rejected: [{ index, reason }] }`. 422 means nothing was stored. |
  | 400 | Bad JSON, or not 1–2000 readings. |
  | 401 / 403 | Device authentication failed, or the device is disabled. |
  | 413 | Body over 1 MB. |
  | 502 | Convex refused the Worker key. Check `CONVEX_INGEST_KEY`. |
  | 503 + `Retry-After` | Convex is unavailable. The device should resend the batch. |

Forwarding behaviour:

- Readings go to Convex in chunks of 500.
- Calls use `requestJson` (`convex/lib/effectHttp.ts`): 10 s per attempt, and
  2 retries on network errors, timeouts and 5xx only.
- If a chunk fails, the device resends the whole batch. The chunks that were
  already stored come back as duplicates.

## Device registry (KV `DEVICES`)

Each device has a key `device:<deviceId>` with a JSON value:

```json
{ "secret": "<hmac secret>", "cageId": "<Convex cages id>", "siteId": "<farmLocations id>", "disabled": false }
{ "tokenSha256": "<hex sha256 of the bearer token>" }
```

Generate a secret with `openssl rand -hex 32`. For a token device, store
`printf %s "$TOKEN" | shasum -a 256`. Disable a device with
`"disabled": true`, or delete its key.

## Deploy (manual)

1. In the app, open **API keys** and create a key with the `ingest:write`
   scope. Optionally limit it to sites.
2. Create the KV namespace:

   ```sh
   cd workers/iot-ingest
   npx wrangler kv namespace create DEVICES
   ```

   Put the id it prints into `wrangler.toml`.
3. Set `CONVEX_SITE_URL` in `wrangler.toml` to the deployment's
   `https://<name>.convex.site` origin.
4. Set the key as a secret: `npx wrangler secret put CONVEX_INGEST_KEY`.
5. Register devices: `npx wrangler kv key put --binding DEVICES device:probe-1 '{"secret":"…"}'`.
6. Deploy with `npx wrangler deploy` (`workers_dev = false`). Then add a route
   or custom domain, e.g. `iot.<your domain>/*`, in the Cloudflare dashboard
   or under `routes` in `wrangler.toml`.
7. Smoke test with `curl https://iot.<domain>/health`.

Dependencies resolve from the repository root (`npm ci` at the root), and the
Worker imports the shared rules from `convex/`. Tests run with the root
suite: `npm test`, or `npx vitest run workers`.

## Follow-ups

- Device management UI in the app, with the registry in Convex instead of KV.
- Per-device rate limits (Cloudflare rate limiting rules or Durable Objects).
