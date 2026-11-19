# Architecture 16 — Storage Cost and Scaling Assessment

Status: proposed, 2026-11-18. Companion to `14-cloudflare-adoption-assessment.md` §2.1 (R2) and §2.5 (Images), and `15-cloudflare-vs-convex-responsibility-matrix.md` rows 9–11, 22, 25.

## Objective

Estimate file storage and delivery cost for this platform's expected file workloads (field photos, compliance documents, invoices, exports) on Convex file storage versus Cloudflare R2 (with and without Cloudflare Images), at 10, 100 and 1,000 organizations; find the break-even point; cover data residency, backup and lifecycle; and define a storage abstraction that lets the platform start on Convex storage and move to R2 without a schema migration.

## Sources and date

Prices retrieved 2026-11-18; `[Sn]` ids refer to the source table in doc 14.

| Price | Convex Pro [S33] | Convex Free/Starter [S33] | R2 Standard [S1] | Cloudflare Images [S20] |
|---|---|---|---|---|
| Storage | 100 GB incl., then $0.03/GB-month | 1 GB incl., then $0.033/GB-month | 10 GB-month free, then $0.015/GB-month | (R2-stored images: transformations only) |
| Delivery | 50 GB "data egress" incl., then $0.12/GB | 1 GB incl., then $0.132/GB | $0 egress | — |
| Operations | function calls (metadata only, negligible here) | same | Class A $4.50/M after 1M free; Class B $0.36/M after 10M free | $0.50 per 1,000 unique transformations after 5,000/month |
| Base fee | $25 per developer/month (needed anyway for OPS-001 backups/log streams) | $0 | $0 | $0 (Paid features need Images Paid) |

Convex replaced "file bandwidth" with "data egress" in 2026 and made ingress free [S33] (blog post on the change; which other traffic shares the egress allowance is UNCONFIRMED — the model assumes the full allowance is available to files, which favours Convex). Included amounts are per team, shared across regions [S33].

## Assumptions

1. **No file workload exists today** except one logo per company (`convex/companies.ts:790-844`). All volumes below are planning estimates to be replaced by measured values once Phase 7/12 features ship.
2. **Client-side compression is the baseline**: photos resized to ~1600 px JPEG/WebP ≈ 0.3 MB before upload (doc 14 §2.5). PDFs/documents average 0.3 MB. A sensitivity case keeps 3 MB originals and 0.5 MB documents.
3. **Views**: each file is downloaded 10 times in its life on average (15 for enterprise groups: more managers, auditors, buyers), counted in the month of upload. Private files are served by presigned GET directly from origin (no CDN cache), so every view is egress (Convex) or a Class B operation (R2).
4. **Exports** (scheduled reports, XLSX/CSV/PDF) are retained 30 days, so their storage is a rolling balance, downloaded twice each.
5. **Retention**: photos and documents kept indefinitely (traceability, Phase 12). Results shown at month 12 and month 36 of a cohort.
6. **Tenant mix**: 70 % small farm, 25 % commercial farm, 5 % enterprise group (10 orgs = 7/2/1).
7. Thumbnails generated client-side are counted inside the 0.3 MB photo budget (thumbnail ≈ 20–30 KB).

### Tenant profiles (per month)

| Profile | Shape | Photos / month | Documents / month | Upload volume | Rolling exports |
|---|---|---|---|---|---|
| Small farm | 1 site, ~10 cages/ponds, 3 users | 36 (biweekly sampling 1 per unit × 2 = 20; harvest 2 × 3 = 6; mortality/field 10) | 10 (treatment certificates, invoices, supplier receipts) | 13.8 MB | 5 MB |
| Commercial farm | 3 sites, ~100 units, 25 users | 800 (sampling 2 per unit × 2 = 400; harvest 20 × 5 = 100; net inspection / mortality / field 300) | 100 | 270 MB | 40 MB |
| Enterprise group | ~10 sites, ~1,000 units, 200 users | 8,000 | 1,000 | 2.7 GB | 1 GB |

## 1. Formulas

For a population of organizations after `m` months:

```
U  = Σ_orgs (photos × P + docs × D)            # GB uploaded per month (P = D = 0.0003 GB baseline)
X  = Σ_orgs exports_GB                         # rolling export balance
S  = U × m + X                                 # stored GB
E  = Σ_orgs (upload_GB × views + exports_GB × 2)   # GB delivered per month
N  = Σ_orgs (photos + docs)                    # objects per month

Convex Pro  ($/month, overage only) = max(0, S − 100) × 0.03 + max(0, E − 50) × 0.12
Convex Starter ($/month)            = max(0, S − 1) × 0.033 + max(0, E − 1) × 0.132
R2 ($/month) = max(0, S − 10) × 0.015
             + max(0, 1.2 N − 1e6) / 1e6 × 4.50          # Class A: PUT (+ multipart/metadata)
             + max(0, N × avgViews − 1e7) / 1e6 × 0.36   # Class B: GET
Images ($/month) = max(0, 2 × N_photos − 5000) / 1000 × 0.50   # two variants per photo
```

The model script is reproducible from these formulas; it was run on 2026-11-18 with the assumptions above.

## 2. Results — baseline (compressed photos)

| Orgs | Month | Stored (GB) | Delivered (GB/month) | Objects / month | Convex Pro overage ($/month) | Convex Starter ($/month) | R2 ($/month) | Images, if used ($/month) |
|---|---|---|---|---|---|---|---|---|
| 10 | 12 | 41 | 49 | 11,122 | 0.0 | 7.7 | 0.5 | 7.5 |
| 10 | 36 | 121 | 49 | 11,122 | 0.6 | 10.3 | 1.7 | 7.5 |
| 100 | 12 | 261 | 292 | 70,720 | 33.9 | 47.0 | 3.8 | 61.1 |
| 100 | 36 | 770 | 292 | 70,720 | 49.2 | 63.8 | 11.4 | 61.1 |
| 1,000 | 12 | 2,609 | 2,924 | 707,200 | 420.1 | 471.9 | 39.0 | 634.0 |
| 1,000 | 36 | 7,701 | 2,924 | 707,200 | 572.9 | 639.9 | 115.4 | 634.0 |

At 1,000 orgs R2 operations stay inside the free allowance (≈ 0.85 M Class A and ≈ 7.3 M Class B per month), so R2 cost is storage only. **Delivery, not storage, is about 60–86 % of the Convex overage** in every row above 10 orgs.

## 3. Results — sensitivity (3 MB originals, 0.5 MB documents)

| Orgs | Month | Stored (GB) | Delivered (GB/month) | Convex Pro overage ($/month) | R2 ($/month) |
|---|---|---|---|---|---|
| 10 | 12 | 363 | 427 | 53.1 | 5.3 |
| 10 | 36 | 1,088 | 427 | 74.8 | 16.2 |
| 100 | 12 | 2,306 | 2,542 | 365.2 | 34.4 |
| 100 | 36 | 6,906 | 2,542 | 503.2 | 103.4 |
| 1,000 | 12 | 23,063 | 25,418 | 3,733.0 | 345.8 |
| 1,000 | 36 | 69,061 | 25,418 | 5,113.0 | 1,035.8 |

Keeping uncompressed originals multiplies cost about 9–10x on both providers and makes the R2 saving material even at 10–100 orgs. The single biggest cost lever is therefore **client-side compression**, which also shortens uploads on rural 3G — a product benefit independent of the provider.

## 4. Images

Two server-generated variants per photo cost more than the entire R2 saving at every scale in the baseline ($61 vs a $30–38 saving at 100 orgs; $634 vs $381–458 at 1,000). Recommendation stands: thumbnails are made in the browser (doc 14 §2.5).

## 5. Break-even

| Kind | Where it falls | Reading |
|---|---|---|
| Price break-even (R2 cheaper per month than Convex Pro overage) | ~10–20 orgs in the baseline, when Convex's included 50 GB egress is used up | Not a reason to switch: the difference is a few dollars. |
| Worth-it break-even (monthly saving ≥ $100, a judgement threshold covering a second vendor, a second credential set, reconciliation jobs and on-call knowledge) | ≈ 300 orgs at month 12, ≈ 260 orgs at month 36 (baseline: saving ≈ $69 at 200 orgs, $108 at 300, $147 at 400, $186 at 500 at month 12) | The practical trigger for doc 14 §2.1 (a). |
| Sensitivity (originals kept) | Below 10 orgs | If originals or video are a requirement, adopt R2 when that feature is built. |

Non-cost triggers can come first: expiring download links for compliance documents, EU-jurisdiction storage, retention/lifecycle rules, objects > 100 MB (doc 14 §2.1 b–d).

## 6. Scaling limits (non-cost)

| Concern | Convex storage | R2 |
|---|---|---|
| Upload size / time | No size limit; upload POST 2-minute timeout; upload URL valid 1 h [S34] | Single PUT ≤ 5 GiB; multipart for larger, parts 5 MiB–5 GiB, ≤ 10,000 parts [S9]; presigned URL expiry ≤ 7 days [S2] |
| Weak networks | A 2-minute timeout fails slow uploads of large files; compression keeps photos well within it | Multipart allows resumable uploads of large files; not needed for 0.3 MB photos |
| Download access control | `getUrl` links work for anyone holding them, revocable only by deleting the file [S34]; per-request auth requires serving through an HTTP action (counts as egress and action time) | Presigned GET with 1 s–7 day expiry [S2] |
| Mutations touching files | ≤ 10 files / 16 MiB stored or read per mutation [S35] | n/a (bytes never pass through Convex) |
| Server-generated files (exports, invoice PDFs) | `ctx.storage.store` from actions [S34]; Node actions 512 MB memory [S35] | `r2.store` from Convex actions via `@convex-dev/r2` [S36] |

## 7. Data residency

- Convex deployment regions: aws-us-east-1 (standard price), aws-eu-west-1, aws-ap-southeast-2, aws-ca-central-1 (1.3x); chosen at creation, not changeable [S39].
- R2: location hints wnam, enam, weur, eeur, apac, oc (best-effort, set at first bucket creation); guaranteed `eu` and `us` jurisdictions, fixed at bucket creation; **no Africa location** [S7].
- Neither provider offers in-country storage for Ghana or other West African markets. Obligations under Ghana's Data Protection Act, 2012 (Act 843) or customer contracts were not researched here; this needs legal review before onboarding customers that demand residency.
- Rule: files live in the same jurisdiction as the Convex deployment that holds their metadata (US deployment → R2 `us` jurisdiction or ENAM hint; EU deployment → R2 `eu` jurisdiction). A per-tenant residency requirement implies a separate Convex deployment per region, not just a separate bucket.

## 8. Backup and lifecycle

| Topic | Convex storage | R2 |
|---|---|---|
| Backups | Periodic backups require Pro; daily kept 7 days, weekly 14; restore wipes existing data [S39]. Whether file storage is included in periodic backups: UNCONFIRMED (verify in OPS-001 restore drill). | No versioning or object lock [S3]. Protection is application-level: soft delete in `files` (status `deleted`), physical delete by a Convex job after a 30-day grace period; optional second bucket in another jurisdiction copied by Super Slurper/Sippy for DR [S11] (cost UNCONFIRMED). |
| Lifecycle | None built in; retention jobs in Convex delete by `files.retentionUntil` | Lifecycle rules: expire by age, move to Infrequent Access, abort multipart (default 7 days) [S6]; up to 1,000 rules per bucket. IA: $0.01/GB-month, 30-day minimum, $0.01/GB retrieval [S1]. |
| Reconciliation | `_storage` system table (`sha256`, `size`, `contentType`) [S34] vs `files` | `listMetadata`/`pageMetadata` in `@convex-dev/r2` [S36] vs `files` |

Lifecycle rules are a backstop only (e.g. `*/exports/` expires after 35 days); the authoritative retention decision is the `files` row, so audit and UI stay consistent.

## 9. Storage abstraction and migration path

### 9.1 `files` table (new, in `convex/trace/` or a shared `convex/files/` domain)

```ts
files: defineTable({
  companyId: v.id('companies'),
  locationId: v.optional(v.id('farmLocations')),
  provider: v.union(v.literal('convex'), v.literal('r2')),
  storageId: v.optional(v.id('_storage')),      // provider = 'convex'
  objectKey: v.optional(v.string()),            // provider = 'r2': {env}/{companyId}/{domain}/{subjectTable}/{subjectId}/{fileId}
  kind: v.union(v.literal('photo'), v.literal('thumbnail'), v.literal('document'),
                v.literal('export'), v.literal('logo')),
  subjectTable: v.string(),                     // 'biweeklyRecords' | 'harvestRecords' | 'healthTreatments' | 'invoices' | 'companies' | …
  subjectId: v.string(),
  variantOf: v.optional(v.id('files')),         // thumbnail → original
  contentType: v.string(),
  size: v.number(),
  sha256: v.optional(v.string()),
  originalName: v.optional(v.string()),
  status: v.union(v.literal('pending'), v.literal('ready'), v.literal('deleted')),
  uploadedBy: v.id('users'),
  retentionUntil: v.optional(v.number()),
  deletedAt: v.optional(v.number()),
})
  .index('by_companyId_and_subjectTable_and_subjectId', ['companyId', 'subjectTable', 'subjectId'])
  .index('by_companyId_and_kind', ['companyId', 'kind'])
  .index('by_status_and_retentionUntil', ['status', 'retentionUntil'])
  .index('by_provider_and_status', ['provider', 'status'])
```

API (all in Convex; provider hidden from callers): `files.requestUpload({ subjectTable, subjectId, kind, contentType, size })` → `{ fileId, uploadUrl, method }`; `files.confirmUpload({ fileId })` (verifies size/type/sha256 from `_storage` or R2 metadata, sets `ready`); `files.getDownloadUrl({ fileId })` (authorizes, returns short-lived URL; audits document downloads); `files.remove({ fileId })` (soft delete). An internal job deletes `pending` rows older than 24 h with their objects (fixes the orphan problem of today's logo flow, TD-015) and purges `deleted` rows after the grace period.

> Implementation note (CF-004): uploads are bound before they are attached. `files.generateUploadUrl` records a `fileUploads` row (company, uploader, entity, declared SHA-256, expiry) and `files.attach` requires that binding, so one company cannot claim another's upload.
>
> Implementation note (CF-004, compression and thumbnails): `lib/imageCompression.js` resizes JPEG/PNG/WebP in the browser to at most 1600 px (quality 0.8; PNG → WebP to keep transparency; the original is kept if the result is not smaller; GIF/SVG/HEIC and documents are not touched; EXIF orientation is applied, EXIF metadata including GPS is dropped) and makes a ≤ 320 px JPEG thumbnail. The SHA-256 bound by `generateUploadUrl` is over the bytes actually uploaded. Instead of a `variantOf` row, the thumbnail lives on the same `files` row (`thumbStorageId` or `thumbR2Key`, `thumbMime`, `thumbSize`) and is bound by the same `fileUploads` row (`thumbSha256`, `thumbContentType`, `thumbR2Key`): one binding, one per-record cap, one delete path. `attach`/`attachR2` keep it only if its bytes match, it is JPEG/WebP ≤ 512 KB and the file is an image; otherwise the file is attached without one. `files.requestThumbnails` issues `variant: 'thumb'` download tokens with the same company and site checks as `requestDownload`. `deleteFileBlobs` (remove, company purge) and the unclaimed-upload cleanup delete thumbnails. A thumbnail takes a second upload-URL rate-limit token (limits doubled).

### 9.2 Steps

> Steps 4–5 (copy + reconciliation) have code: `convex/r2Sync.ts` (`copyToR2`, `reconcileR2`), not yet wired to `files`; see `docs/ops/r2-storage.md`.

| Step | Change | Rollback |
|---|---|---|
| 1 | Introduce `files` on Convex storage with Phase 7/12 file features; new code never stores raw `_storage` ids on business tables | Additive |
| 2 | Move the logo onto `files` (`companies.logoFileId` optional, dual-read `logoStorageId`) | Read old field |
| 3 | When a doc 14 §2.1 trigger fires: install `@convex-dev/r2` [S36], create prod/staging buckets in the matching jurisdiction, bucket-scoped tokens, CORS; `requestUpload` chooses provider by a deployment setting (optionally per org) | Switch setting back to `convex`; existing R2 rows keep working |
| 4 | Backfill: internal action pages through `by_provider_and_status('convex','ready')`, reads the blob (`ctx.storage.get`), stores to R2 under the computed key, verifies sha256, patches `provider: 'r2'`, `objectKey`, keeps `storageId` | Patch back to `convex` (blob still present) |
| 5 | After 30 days without incident, delete Convex blobs and clear `storageId` | Restore from Convex backup if within retention (verify backup includes files) |

Egress during backfill: reading Convex blobs inside a Convex action is internal traffic; whether it counts as Convex data egress is UNCONFIRMED — budget for the worst case (stored GB × $0.12).
