# R2 storage provider (CF-005, CF-006) — wired, env-gated

> With the `R2_*` env vars unset (today, and in dev/CI) nothing changes:
> uploads, attach and downloads use Convex storage exactly as before. Set all
> four on a Convex deployment and **new** attachments go to R2. Existing
> files stay on Convex until the manual backfill moves them. D-016: Convex
> storage first, R2 when a doc 14 §2.1 trigger fires and is logged.

## What exists

| File | What |
|---|---|
| `convex/lib/r2.ts` | `R2Storage` Effect service (`Context.Service`) + `r2Layer(config)` / `r2Live()`. S3 SigV4 presigned URLs on Web Crypto (no SDK): `put`, `get`, `head`, `remove`, `presign(GET\|PUT, key, expiresIn ≤ 7 d)` (PUT can sign Content-Type, `x-amz-meta-sha256` and `If-None-Match: *`; GET can sign `response-content-type` / `response-content-disposition`). All network through the `Fetch` service; per-attempt timeout; retries only network/timeout/5xx, never 4xx; 404 → `null`. Typed errors `R2NotConfigured`, `R2Error{operation,key,status,retryable}`. |
| `convex/lib/r2Files.ts` | The programs `convex/files.ts` runs on R2: `filesProvider()`, `presignUpload`, `inspectUpload`, `presignDownload`, `r2UploadKey`. |
| `convex/files.ts` | `generateUploadUrl` returns `{ provider, method, uploadUrl, headers, uploadId }`; `attach` (Convex) / `attachR2` (R2 action); download redirect; `deleteR2Object`. |
| `convex/r2Sync.ts` | Manual jobs: `copyToR2`, `reconcileR2` (by storage id), `backfillFilesToR2` (pages `files`). Nothing schedules them. |
| `lib/uploadFile.js` | Browser flow used by `components/Attachments.js` and `components/CustomFields.js`: POST to Convex or PUT to R2 depending on `provider`. |
| Tests | `convex/lib/r2.test.ts` (SigV4 vector, fake S3, copy/reconcile), `convex/r2Files.test.ts` (fake-fetch R2: presign, inspect, create-only PUT, attach/download, wrong user/company, wrong bytes, expiry cleanup, backfill). |

## Env (Convex deployment only, never Vercel)

| Var | |
|---|---|
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | All four set = R2 configured. |
| `R2_ENDPOINT` | Optional origin override (EU jurisdiction: `https://<account>.eu.r2.cloudflarestorage.com`). |
| `FILES_PROVIDER` | Optional. `convex` keeps new uploads on Convex storage even when R2 is configured (rollback switch). R2 rows already attached keep downloading from R2. |

## Flows

- **Upload.** `files.generateUploadUrl({ entityType, entityId, sha256, contentType, name })`
  creates the upload binding (CF-004: caller, company, record, 1 h window,
  declared SHA-256). On R2 the type must be on the allow-list, and the
  binding records `provider: 'r2'`, the key `files/<companyId>/<uploadId>`
  and the type; the browser gets a presigned **PUT** (15 min) with
  `Content-Type`, `x-amz-meta-sha256` and `If-None-Match: *` signed in, so the
  URL can only create that one object, never overwrite it after attach.
- **Attach.** `files.attachR2({ entityType, entityId, uploadId, name })`
  (action): re-checks the binding (same user, same company, same record,
  unexpired, unused), HEADs the object (≤ 10 MB), downloads it and hashes the
  bytes against the declared SHA-256, then inserts the `files` row
  (`provider: 'r2'`, `r2Key`, no `storageId`) with the same type, size and
  per-record checks as `attach`. A refused object is deleted.
- **Download.** `files.requestDownload` (unchanged token, company check) →
  `GET /files/download?token=…` → for `provider: 'r2'` a **302** to a
  presigned GET valid 5 minutes that forces `Content-Disposition: attachment`
  and the recorded type (`Cache-Control: private, no-store`,
  `Referrer-Policy: no-referrer`). Convex rows still stream as before.
- **Delete.** `files.remove` and the company purge (`governance.ts`) delete
  the Convex blob and schedule `files.deleteR2Object` for an `r2Key`.
  `files.pruneDownloadTokens` (existing cron) deletes R2 objects of expired,
  never-attached uploads.

## Owner setup (when the trigger fires)

1. Cloudflare → R2 → create buckets `pbafarm-prod` and `pbafarm-staging`
   in the jurisdiction matching the Convex deployment.
2. R2 → Manage API tokens → **Object Read & Write**, scoped to one bucket
   each. Store in the password manager.
3. Bucket → Settings → CORS: allow `PUT` and `GET` from the app origins,
   headers `Content-Type`, `x-amz-meta-sha256`, `If-None-Match`.
4. Lifecycle rule: delete `exports/` after 7 days (backstop).
5. `npx convex env set --deployment <staging> R2_ACCOUNT_ID …` (and the
   other three). Upload, attach and download a file on staging; then prod.
6. Key rotation: create the new token, `convex env set` both keys, verify
   `reconcileR2` on a few ids, delete the old token.
7. Rollback: `npx convex env set FILES_PROVIDER convex` (new uploads back to
   Convex; R2 files stay readable). Unsetting the `R2_*` vars makes R2 rows
   undownloadable (503), so only do that after moving them back.

## Backfill existing files (CF-006, manual, not scheduled)

Pages through `files` rows still on Convex, copies each blob to
`files/<storageId>` with its SHA-256, reconciles, and switches only rows that
reconcile `ok` to `provider: 'r2'` + `r2Key`. The Convex blob is kept
(`storageId` stays on the row). Rerunnable and idempotent; `dryRun`
defaults to true.

```bash
npx convex run --deployment <staging> r2Sync:backfillFilesToR2 '{"dryRun":true}'
npx convex run --deployment <staging> r2Sync:backfillFilesToR2 '{"dryRun":false,"numItems":100}'
# repeat with "cursor": "<continueCursor>" until "isDone": true
npx convex run --deployment <staging> r2Sync:copyToR2 '{"storageIds":["<id>"],"dryRun":true}'
npx convex run --deployment <staging> r2Sync:reconcileR2 '{"storageIds":["<id>"]}'
```

**Grace period:** delete the Convex blobs of backfilled rows only after a
later `reconcileR2` run is `ok` and one backup cycle has passed (not
automated).

## Not done

- Reconciliation cron (weekly `reconcileR2` + platform notification): left
  manual on purpose.
- Logos (`companies.setLogo`) and data exports stay on Convex storage.

Implemented on a small hand-written signer instead of `@convex-dev/r2`
(doc 17 Stage 4) so it fits the Effect service/Fetch/fake-test conventions
(D-019) and adds no dependency; swapping to the component later only changes
the Layer.
