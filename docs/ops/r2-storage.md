# R2 storage provider (CF-005, CF-006) — implemented, not wired

> Code only. No bucket, token or env var exists; nothing calls these
> functions. With the `R2_*` env vars unset every entry point is a no-op
> (`configured: false`). D-016: Convex storage first, R2 when a doc 14 §2.1
> trigger fires and is logged.

## What exists

| File | What |
|---|---|
| `convex/lib/r2.ts` | `R2Storage` Effect service (`Context.Service`) + `r2Layer(config)` / `r2Live()`. S3 SigV4 presigned URLs on Web Crypto (no SDK): `put`, `get`, `head`, `presign(GET\|PUT, key, expiresIn ≤ 7 d)`. All network through the `Fetch` service; per-attempt timeout; retries only network/timeout/5xx, never 4xx; 404 → `null`. Typed errors `R2NotConfigured`, `R2Error{operation,key,status,retryable}`. |
| `convex/r2Sync.ts` | `copyToR2` (internal action; `dryRun` default true; ≤ 100 storage ids per call) copies Convex blobs to `files/<storageId>` with the Convex SHA-256 as metadata, skipping objects already there (idempotent). `reconcileR2` compares each Convex blob with its R2 object: `ok`, `missing_in_r2`, `size_mismatch`, `hash_mismatch`, `missing_in_convex`. |
| `convex/lib/r2.test.ts` | AWS SigV4 test vector, fake S3 (5xx retry, 403 no retry, timeout, network), copy/reconcile, no-op without env. |

Env (Convex deployment only, never Vercel): `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, optional
`R2_ENDPOINT` (EU jurisdiction: `https://<account>.eu.r2.cloudflarestorage.com`).

Implemented on a small hand-written signer instead of `@convex-dev/r2`
(doc 17 Stage 4) so it fits the Effect service/Fetch/fake-test conventions
(D-019) and adds no dependency; swapping to the component later only changes
the Layer.

## Owner setup (when the trigger fires)

1. Cloudflare → R2 → create buckets `pbafarm-prod` and `pbafarm-staging`
   in the jurisdiction matching the Convex deployment.
2. R2 → Manage API tokens → **Object Read & Write**, scoped to one bucket
   each. Store in the password manager.
3. Bucket → Settings → CORS: allow `PUT`, `GET` from the app origins, header
   `Content-Type` (needed only once browsers upload directly, step 3 below).
4. Lifecycle rule: delete `exports/` after 7 days (backstop).
5. `npx convex env set --deployment <name> R2_ACCOUNT_ID …` (and the other
   three) on staging first.
6. Key rotation: create the new token, `convex env set` both keys, verify
   `reconcileR2` on a few ids, delete the old token.

## Wiring follow-up (separate PR, after CF-004 `files` is Verified)

1. **Schema (additive):** `files.provider: v.union(v.literal('convex'), v.literal('r2'))`,
   `files.r2Key: v.optional(v.string())`; keep `storageId` (optional for
   r2-only rows) for the grace period.
2. **Downloads** (`convex/files.ts` / `GET /files/download` in `convex/http.ts`):
   for `provider: 'r2'`, after the existing company/token checks, redirect
   to `R2Storage.presign('GET', file.r2Key, 900)` (≤ 15 min) instead of
   streaming `ctx.storage.get`.
3. **Uploads:** a provider setting (`FILES_PROVIDER=r2` env) makes
   `requestUpload` return a presigned PUT for a server-computed key
   `{env}/{companyId}/{fileId}`; `attach` checks the object with `head`
   (size/type) instead of `ctx.db.system.get`.
4. **Backfill (CF-006):** an internal action pages `files` where
   `provider = 'convex'`, calls `copyToR2` logic with `dryRun:false`, then
   `reconcileR2`; only rows reporting `ok` are patched to `provider: 'r2'`,
   `r2Key`. Rerunnable; pages of ≤ 100.
5. **Reconciliation cron:** weekly `reconcileR2` over a page of r2 rows;
   anything not `ok` raises a platform notification.
6. **Grace period:** delete the Convex blob only after a later reconcile run
   is `ok` and one backup cycle has passed.
7. Tests: cross-tenant download refused with provider `r2`; presign expiry.

## Manual run (staging, once env vars exist)

```bash
npx convex run --deployment <staging> r2Sync:copyToR2 '{"storageIds":["<id>"],"dryRun":true}'
npx convex run --deployment <staging> r2Sync:copyToR2 '{"storageIds":["<id>"],"dryRun":false}'
npx convex run --deployment <staging> r2Sync:reconcileR2 '{"storageIds":["<id>"]}'
```
