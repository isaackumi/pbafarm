# Architecture 14 — Cloudflare Adoption Assessment

Status: proposed, 2026-11-18. This is an architectural evaluation, not an integration audit. **Cloudflare is not used by this project today** (verified 2026-11-18: no `wrangler.*`, no `@cloudflare/*` or `@opennextjs/*` package, no Cloudflare reference in `package.json`, `next.config.mjs`, `.github/workflows/*`, `convex/` or `pages/`). The owner uses Cloudflare (R2, Workers) on other projects and is considering it for this platform. Related: `15-cloudflare-vs-convex-responsibility-matrix.md`, `16-storage-cost-and-scaling-assessment.md`, `17-cloudflare-adoption-roadmap.md`; binding context D-001 (stay on Next.js pages router + Convex), D-008 (automation on Convex scheduler, workpool evaluated), D-009 (integrations in Convex), D-011 (ops baseline).

## Objective

For each Cloudflare service that could plausibly serve this aquaculture platform, decide whether, when and how to adopt it, with Convex kept as the system of record. Each service gets: problem solved, why this platform might need it, whether Convex already provides it, complexity, operational and financial implications, security considerations, and exactly one adoption stage: **Adopt immediately**, **Adopt when needed** (with trigger), **Do not adopt**, or **Revisit at enterprise scale**. A hosting section compares Vercel with Next.js on Cloudflare Workers via OpenNext.

## Sources and date

All external facts were retrieved on **2026-11-18** from the pages below. Inline references use `[Sn]`. Values marked **UNCONFIRMED** could not be confirmed from an official page on that date. Two values were re-checked directly a second time on the same date: S24 (OpenNext version floor) and S33 (Convex pricing).

| Id | Source |
|---|---|
| S1 | R2 pricing — https://developers.cloudflare.com/r2/pricing/ |
| S2 | R2 presigned URLs — https://developers.cloudflare.com/r2/api/s3/presigned-urls/ |
| S3 | R2 S3 API compatibility — https://developers.cloudflare.com/r2/api/s3/api/ |
| S4 | R2 CORS — https://developers.cloudflare.com/r2/buckets/cors/ |
| S5 | R2 event notifications — https://developers.cloudflare.com/r2/buckets/event-notifications/ and https://developers.cloudflare.com/r2/reference/changelog/ |
| S6 | R2 object lifecycles — https://developers.cloudflare.com/r2/buckets/object-lifecycles/ |
| S7 | R2 data location — https://developers.cloudflare.com/r2/reference/data-location/ |
| S8 | R2 public buckets — https://developers.cloudflare.com/r2/buckets/public-buckets/ |
| S9 | R2 limits — https://developers.cloudflare.com/r2/platform/limits/ and https://developers.cloudflare.com/r2/objects/multipart-objects/ |
| S10 | R2 API tokens — https://developers.cloudflare.com/r2/api/tokens/ |
| S11 | R2 migration — https://developers.cloudflare.com/r2/data-migration/super-slurper/ and https://developers.cloudflare.com/r2/data-migration/sippy/ |
| S12 | Workers pricing (also Queues, Workflows) — https://developers.cloudflare.com/workers/platform/pricing/ |
| S13 | Workers limits — https://developers.cloudflare.com/workers/platform/limits/ |
| S14 | Smart Placement — https://developers.cloudflare.com/workers/configuration/placement/ |
| S15 | Cron Triggers — https://developers.cloudflare.com/workers/configuration/cron-triggers/ |
| S16 | Node.js compatibility — https://developers.cloudflare.com/workers/runtime-apis/nodejs/ |
| S17 | Pages vs Workers — https://developers.cloudflare.com/pages/ and https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/ |
| S18 | Queues — https://developers.cloudflare.com/queues/platform/limits/, https://developers.cloudflare.com/queues/reference/delivery-guarantees/, https://developers.cloudflare.com/queues/configuration/dead-letter-queues/ |
| S19 | Workflows — https://developers.cloudflare.com/changelog/2025-04-07-workflows-ga, https://developers.cloudflare.com/workflows/reference/limits/, https://developers.cloudflare.com/workflows/build/sleeping-and-retrying/ |
| S20 | Images — https://developers.cloudflare.com/images/pricing/, https://developers.cloudflare.com/images/get-started/limits/, https://developers.cloudflare.com/images/transform-images/ |
| S21 | D1 / KV / Durable Objects / Hyperdrive — https://developers.cloudflare.com/d1/platform/limits/, https://developers.cloudflare.com/kv/concepts/how-kv-works/, https://developers.cloudflare.com/durable-objects/platform/limits/, https://developers.cloudflare.com/hyperdrive/platform/pricing/ |
| S22 | Email — https://developers.cloudflare.com/email-routing/ and https://developers.cloudflare.com/email-service/platform/pricing/ |
| S23 | OpenNext Cloudflare — https://opennext.js.org/cloudflare, https://opennext.js.org/cloudflare/get-started, https://opennext.js.org/cloudflare/caching, https://opennext.js.org/cloudflare/howtos/image, https://opennext.js.org/cloudflare/troubleshooting |
| S24 | OpenNext releases — https://github.com/opennextjs/opennextjs-cloudflare/releases (1.20.17 latest) and https://github.com/opennextjs/opennextjs-cloudflare/releases/tag/%40opennextjs%2Fcloudflare%401.20.16 |
| S25 | next-on-pages archive notice — https://github.com/cloudflare/next-on-pages ; Cloudflare Next.js guide — https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/ |
| S26 | Vercel — https://vercel.com/legal/terms, https://vercel.com/docs/plans/hobby, https://vercel.com/docs/plans/pro-plan, https://vercel.com/pricing, https://vercel.com/docs/limits/fair-use-guidelines, https://vercel.com/docs/cdn, https://vercel.com/kb/guide/cloudflare-with-vercel |
| S27 | Turnstile — https://developers.cloudflare.com/turnstile/plans/, https://developers.cloudflare.com/turnstile/get-started/server-side-validation/, https://developers.cloudflare.com/turnstile/concepts/widget/ |
| S28 | WAF / DDoS / bots — https://www.cloudflare.com/plans/network-cdn.md, https://developers.cloudflare.com/waf/managed-rules/, https://developers.cloudflare.com/waf/custom-rules/, https://developers.cloudflare.com/waf/rate-limiting-rules/, https://developers.cloudflare.com/ddos-protection/about/, https://developers.cloudflare.com/bots/get-started/bot-fight-mode/ |
| S29 | Convex abuse protection and custom domains — https://docs.convex.dev/production/abuse-protection, https://docs.convex.dev/production/custom-domains |
| S30 | Cloudflare Zero Trust / Access — https://www.cloudflare.com/plans/sase-zero-trust.md, https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-public-app/ |
| S31 | Cloudflare Registrar — https://www.cloudflare.com/products/registrar/ |
| S32 | Cloudflare cache defaults and terms — https://developers.cloudflare.com/cache/concepts/default-cache-behavior/, https://www.cloudflare.com/service-specific-terms-application-services/ |
| S33 | Convex pricing — https://www.convex.dev/pricing ; egress change — https://news.convex.dev/enterprise-launch/ |
| S34 | Convex file storage — https://docs.convex.dev/file-storage/upload-files, https://docs.convex.dev/file-storage/serve-files, https://docs.convex.dev/file-storage/store-files, https://docs.convex.dev/file-storage/file-metadata |
| S35 | Convex limits and runtimes — https://docs.convex.dev/production/state/limits, https://docs.convex.dev/functions/actions, https://docs.convex.dev/functions/runtimes, https://docs.convex.dev/functions/http-actions, https://docs.convex.dev/scheduling/scheduled-functions, https://docs.convex.dev/scheduling/cron-jobs |
| S36 | `@convex-dev/r2` — https://github.com/get-convex/r2, https://registry.npmjs.org/@convex-dev/r2/latest |
| S37 | Convex components — https://github.com/get-convex/workpool, https://github.com/get-convex/workflow, https://github.com/get-convex/rate-limiter, https://github.com/get-convex/action-retrier, https://github.com/get-convex/crons |
| S38 | Convex Auth Password provider — https://labs.convex.dev/auth/config/passwords |
| S39 | Convex regions, backups, log streams — https://docs.convex.dev/production/regions, https://docs.convex.dev/database/backup-restore, https://docs.convex.dev/production/integrations/log-streams |

## Assumptions

1. Codebase facts are from this repository at commit `d1d5de1` (branch `docs/aquaculture-os-discovery`): Next.js 15.2.8 pages router, 61 statically prerendered routes (doc 01), fully client-rendered except 8 legacy redirect stubs that export `getServerSideProps` (`pages/feed-management/*.js`, `pages/inventory/{items,categories,reports,transactions}.js`) and the two Node API routes `pages/api/llm/{chat,status}.js`; no `middleware.js`; no `vercel.json`. Convex 1.42.3 with 64 queries, 76 mutations, 2 actions, 6 internal functions, 1 cron (`reminders.dailyDigest`), an HTTP router that only mounts Convex Auth routes (`convex/http.ts`), and file storage used only for the company logo (`convex/companies.ts:14,790-844`). Spreadsheet import/export is entirely client-side (`pages/export.js` with `xlsx`, `pages/harvest.js` CSV via `Blob`, `components/BulkUploadModal.js`, dead).
2. Frontend hosting on Vercel is inferred, not verified (doc 13 §33). The Vercel plan in use (Hobby or Pro) is unknown.
3. The Convex plan in use is unknown; the target (OPS-001) is a Pro plan for prod/staging, periodic backups and log streams, which are Pro-only [S33, S39].
4. Phase numbers and tracker ids refer to `docs/roadmap/03-development-roadmap.md` and `docs/project-management/MASTER-TRACKER.md`.
5. Primary market is Ghana / West Africa (doc 13 Q2; `convex/crons.ts` comment "4pm in Accra"), with field phones on intermittent 3G/4G.
6. Prices are list prices in USD; taxes and enterprise discounts are ignored.

---

## 1. What the platform will need that touches this decision

| Future need | Roadmap source | Nature |
|---|---|---|
| Harvest and sampling photos, mortality/net-inspection photos from the field | Phase 7 (MOBILE-*), Phase 12 (TRACE-005) | User uploads on weak networks, private per tenant, read by a few people |
| Treatment certificates, lab reports, compliance documents | Phase 12 (TRACE-003, TRACE-005, TRACE-006) | Private documents, retention obligations, buyer-facing trace reports |
| Invoice PDFs, dispatch notes | Phase 9 (INV-009), Phase 12 (TRACE-004) | Generated server-side or uploaded; private |
| CSV/XLSX imports and exports | Phase 7 (MOBILE-008/009), Phase 13 scheduled reports | Today client-side; later server-generated scheduled reports |
| IoT/sensor ingestion | Phase 11 (INT-007), Phase 6 (POND/RAS), ANLY-006 | Small authenticated POSTs; volume unknown |
| SMS/WhatsApp/email delivery callbacks | Phase 11 (INT-002, INT-003) | Signed inbound webhooks |
| Weather APIs | Phase 11 (INT-006) | Scheduled outbound fetch per site |
| Open sign-up abuse | Phase 0–1 (SEC-001, ORG-004, Q-011) | Bot sign-ups, credential stuffing |
| Branding (logos) | Today; Phase 8 (CUSTOM) | Small public-ish images |

---

## 2. Service-by-service assessment

### 2.1 R2 (object storage)

| Aspect | Assessment |
|---|---|
| Problem solved | S3-compatible object storage with no egress charges. Storage $0.015/GB-month Standard, $0.01 Infrequent Access; Class A $4.50/M, Class B $0.36/M; free tier 10 GB-month, 1M Class A, 10M Class B per month [S1]. IA has a 30-day minimum and $0.01/GB retrieval [S1]; IA GA status UNCONFIRMED (marked beta in the 2024-05-29 changelog) [S5]. |
| Why this platform might need it | Photos and documents are the only workload whose bytes grow with field activity. Egress, not storage, dominates file cost here because the same photo is viewed by managers, auditors and buyers (doc 16). R2 also gives presigned GET URLs with an expiry of 1 s to 7 days [S2], which is a better access model for compliance documents than Convex `getUrl` bearer links (see Security). |
| Does Convex already provide it | Yes, functionally. Convex file storage: upload URL valid 1 hour, no file size limit but a 2-minute upload timeout [S34]; Pro includes 100 GB storage then $0.03/GB-month, 50 GB data egress then $0.12/GB [S33]. Gaps: `ctx.storage.getUrl` links are accessible to "anyone with the URL" and can only be revoked by deleting the file [S34] (expiry not documented: UNCONFIRMED); no lifecycle rules; no storage classes; no image transforms (none documented). The `@convex-dev/r2` component (v0.10.4) already wraps R2 for Convex: presigned upload URLs, `syncMetadata`, `onUpload`/`checkUpload` callbacks, signed `getUrl` with `expiresIn` (default 900 s), `store` from actions, delete/list [S36]. |
| Complexity added | Low–medium. One Cloudflare account, one bucket per environment (prod, staging), bucket CORS for PUT/GET with `Content-Type` [S4, S36], five Convex env vars (`R2_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`) [S36], a Convex component install. No Worker is required: Convex signs URLs, the browser talks to R2 directly. Presigned POST (HTML form upload) is not supported; uploads use PUT [S2]. Presigned URLs work only on `<account>.r2.cloudflarestorage.com`, not on custom domains [S2]. An expired URL returns 403 without CORS headers, so the client cannot read the error body and must treat any failure as "re-request URL" [S4]. |
| Operational implications | Second vendor for data at rest: separate billing, separate credential rotation, separate backup story. Convex backups do not include R2 objects, and R2 has no versioning or object lock [S3], so deletion is final unless the app keeps tombstones and delayed deletes. Lifecycle rules (expire, move to IA, abort multipart; default abort after 7 days) [S6] handle export retention cheaply. Writes to the same key are limited to 1/s [S9] — irrelevant with UUID keys. |
| Financial implications | At realistic volumes the saving is small until roughly 300 organizations, or much earlier if uncompressed photos/videos are kept (doc 16 §4–§5). |
| Security considerations | (1) **Credential custody:** R2 keys live only in Convex environment variables, used only in Convex actions/component code; never in Next.js, never in the browser. Use a bucket-scoped "Object Read & Write" token, one per environment [S10]. (2) **Authorization before signing:** every upload URL and download URL is issued by a Convex mutation/query/action that first runs `requireMember` with the relevant permission and checks that the subject record belongs to the member's company. (3) **Tenant key prefixing:** object keys are `{env}/{companyId}/{domain}/{subjectTable}/{subjectId}/{uuid}` — the prefix is computed server-side from the membership, never from client input; the `files` row stores `companyId` and the key, and reads always go through the row, never through a client-supplied key. (4) Short GET expiries (5–15 min) for documents; URLs never persisted in tables or `localStorage`. (5) Validate content type and size on `checkUpload`/`onUpload` and again from R2 metadata after upload (the browser can lie about `Content-Type`). (6) Never enable `r2.dev` public access for tenant data; `r2.dev` is rate-limited and for development only [S8]. (7) A public custom-domain bucket is acceptable only for non-sensitive branding assets (logos), in a separate bucket. |
| Data location | Location hints wnam, enam, weur, eeur, apac, oc; **no Africa hint**; hints are best-effort; `eu`/`us` jurisdictions are guaranteed and fixed at bucket creation [S7]. Convex regions are aws-us-east-1, eu-west-1 (1.3x), ap-southeast-2 (1.3x), ca-central-1 (1.3x) [S39]. Files should sit in the same jurisdiction as the Convex deployment holding their metadata (doc 16 §7). |
| **Recommended stage** | **Adopt when needed.** Trigger (any one): (a) projected Convex file storage + egress overage exceeds ~$100/month (≈300 orgs at compressed photo sizes, doc 16 §5); (b) a feature needs original-resolution photos, video, or files > 100 MB; (c) a customer or regulator requires expiring links or EU-jurisdiction object storage; (d) Phase 12 compliance documents need lifecycle/retention rules. Until then build the `files` abstraction on Convex storage (doc 16 §8) so the switch is a provider change, not a schema change. |

### 2.2 Workers (edge compute)

| Aspect | Assessment |
|---|---|
| Problem solved | Code at Cloudflare's edge. Free: 100,000 requests/day, 10 ms CPU per invocation. Paid: $5/month minimum, 10M requests and 30M CPU-ms included, then $0.30/M requests and $0.02/M CPU-ms; static asset requests free [S12]. 128 MB memory; CPU 30 s default, up to 5 min; 10,000 subrequests default on Paid [S13]. Cron Triggers: 5 per account on Free, 250 on Paid; UTC [S13, S15]. Smart Placement is beta [S14]. `nodejs_compat` on by default for compatibility date 2026-08-04 or later [S16]. |
| Why this platform might need it | (a) A high-volume IoT ingestion front that authenticates devices, batches readings and forwards aggregates to Convex; (b) a webhook front for providers that send bursts or require sub-second acknowledgement; (c) hosting the Next.js app (see §3); (d) an image-variant or download proxy in front of a public-ish R2 bucket. |
| Does Convex already provide it | Mostly. Convex HTTP actions serve `https://<deployment>.convex.site` with `path`/`pathPrefix` routing, manual CORS, 20 MiB limit for `multipart/form-data` bodies, 100 MiB responses, 64 MiB memory, no automatic retries [S35]. Doc 09 §6 already routes all webhooks (`/webhooks/:provider/:connectionId`) and `/ingest/v1/readings` (batch ≤ 500) through HTTP actions. Convex has `fetch` in actions and HTTP actions only [S35], crons, and the scheduler. Pro concurrency: 512 HTTP/default-runtime actions [S35]. |
| Complexity added | Medium. A second deployable with its own CI, secrets, logs, local dev (`wrangler`), and a service credential to call Convex. Every Worker that touches business data needs a Convex endpoint designed for it anyway, so a Worker only adds a hop unless it absorbs volume or latency that Convex cannot. |
| Operational implications | Two places to debug a failed inbound event; log correlation needs a request id carried into Convex. Convex log streams are Pro-only [S39]; Workers logs are separate. |
| Financial implications | $5/month base on Paid; at the IoT volumes in doc 09 (a pilot of a few probes every few minutes) usage stays inside the included 10M requests. Cost is not the constraint; operations are. |
| Security considerations | Workers never write business records directly and never hold a Convex admin/deploy key. They call a dedicated Convex HTTP action (or internal-function wrapper behind an HTTP action) with an HMAC-signed service credential scoped to one purpose (e.g. `ingest:write`), and Convex re-validates every payload as untrusted. Device API keys stay hashed in Convex (`apiKeys`, D-009); a Worker that validates them must either call Convex or hold a synchronized hash cache — the latter is a second source of truth and is rejected. |
| **Recommended stage** | **Adopt when needed.** Trigger (any one): sustained ingestion beyond what batched HTTP actions handle comfortably (doc 02 §7: roughly per-second readings from hundreds of probes), measured as Convex HTTP-action concurrency or function-call cost; a provider requiring acknowledgement latency that Convex HTTP actions miss in measurement; or a protocol Convex cannot terminate (e.g. MQTT bridged to HTTP, raw TCP from gateways). Not adopted for normal webhooks (SMS/WhatsApp/email callbacks), weather polling or cron jobs — Convex covers those. |

### 2.3 Queues

| Aspect | Assessment |
|---|---|
| Problem solved | At-least-once message queue between Workers. Paid: 1M operations/month included, then $0.40/M; Free: 10,000 ops/day; 128 KB messages, 100 per batch, 5,000 msg/s per queue, retention 4 days default up to 14 (24 h on Free), up to 100 retries, dead-letter queues (default after 3 retries) [S12, S18]. Required target of R2 event notifications [S5]. |
| Why this platform might need it | Buffering IoT bursts between an ingestion Worker and Convex; reacting to R2 object-created events (virus scan, thumbnailing) if uploads bypass Convex. |
| Does Convex already provide it | Yes for this app's scale. Mutations + `ctx.scheduler.runAfter(0, …)` give a transactional outbox (doc 07 §2); up to 1,000 scheduled functions per mutation [S35]; scheduled mutations run exactly once, scheduled actions at most once [S35]. `@convex-dev/workpool` (v0.4.16) adds per-pool parallelism, retries with jitter and `onComplete` [S37]; `@convex-dev/action-retrier` adds retries for single actions [S37]. Upload completion is already observable in Convex (`onUpload` in `@convex-dev/r2` [S36], or the attaching mutation for Convex storage), so R2 event notifications are not needed. |
| Complexity added | Medium–high: only usable from Workers, so it implies adopting Workers too; consumers must be idempotent (at-least-once) [S18]. |
| Operational / financial | Cheap in money, expensive in moving parts. |
| Security considerations | Messages may carry tenant data; queue consumers must be treated like any other Convex caller (service credential, re-validation). |
| **Recommended stage** | **Do not adopt** for now (no workload). Reassess only together with an ingestion Worker (2.2) if IoT volume requires buffering in front of Convex; `@convex-dev/workpool` is the default answer for async fan-out (D-008). |

### 2.4 Workflows

| Aspect | Assessment |
|---|---|
| Problem solved | Durable multi-step execution on Workers. GA since 2025-04-07 [S19]. Billed as Workers requests/CPU plus storage ($0.20/GB-month after 1 GB) and steps (Paid: 500,000/month included, then $0.80 per 100,000) — step and storage billing not yet started on the retrieval date [S12]. Limits (Paid): 10,000 steps default (25,000 max), sleep up to 365 days, 1 MiB per step return, 1 GB state per instance, 50,000 concurrent running instances; default 5 retries per step with exponential backoff [S19]. |
| Why this platform might need it | Long-running automation (Phase 10): approval escalations ("remind after 4 h, escalate after 24 h"), harvest-to-invoice flows, accounting syncs (INT-008). |
| Does Convex already provide it | Yes. D-008 runs automation on the Convex scheduler with `automationRuns` as history. `@convex-dev/workflow` (v0.5.0) provides durable steps, `step.sleep`, `runAfter`/`runAt`, `onComplete`; limits: 1 MB step arguments/returns per workflow, 8 MiB journal; actions not retried by default; changing steps of a running workflow breaks it; GA/beta status UNCONFIRMED [S37]. Escalations are a scheduled mutation with `runAt`, which Convex already does transactionally. |
| Complexity added | High: the workflow state would live outside Convex, so every step reads and writes business data across a network boundary — the opposite of Convex's transactional design. |
| Operational / financial | Two durable-execution engines to monitor. |
| Security considerations | Workflow state may hold tenant data outside the Convex backup and retention regime. |
| **Recommended stage** | **Do not adopt.** If `@convex-dev/workflow` proves insufficient (journal size, determinism constraints) for a specific long sync, reassess at that time with a measured failing case; Cloudflare Workflows would still have to write results back through Convex. |

### 2.5 Images (transformations)

| Aspect | Assessment |
|---|---|
| Problem solved | Resize/convert images on request. Free: 5,000 unique transformations/month (beyond: error 9422, no charge); Paid: $0.50 per 1,000 after 5,000; images stored $5 per 100,000, delivered $1 per 100,000; images in R2 billed only for transformations; format-only changes are not new transformations; `format=auto` picks WebP/AVIF [S20]. Remote input up to 100 MB / 100 MP; transform-via-URL by default only for same-zone images [S20]. |
| Why this platform might need it | Thumbnails in photo grids (sampling galleries, harvest records) on slow phones; consistent sizes for trace reports. |
| Does Convex already provide it | No (no image transformation documented [S34]). |
| Alternative that avoids it | Compress and create a thumbnail **in the browser before upload** (canvas → JPEG/WebP at ~1600 px and ~320 px). This also cuts upload time on 3G, which matters more for field workers than delivery-side resizing. Two objects per photo, both private, no transformation service. |
| Complexity added | Medium: transformations operate on URLs on a Cloudflare zone; private presigned objects need a Worker with the Images binding or a signed-URL scheme to keep tenant isolation. |
| Financial implications | At the doc 16 model (2 variants per photo) Images would cost more than the whole R2 saving at every scale (doc 16 §5). |
| Security considerations | A public transform URL over private objects would bypass Convex authorization; any adoption must keep authorization in Convex (Worker validates a Convex-signed token). |
| **Recommended stage** | **Do not adopt.** Use client-side compression and thumbnails. Revisit only if a product requirement needs arbitrary server-side sizes (e.g. public buyer-facing trace pages with responsive images). |

### 2.6 CDN / caching

| Aspect | Assessment |
|---|---|
| Problem solved | Edge caching of static assets. Cloudflare caches static file types by default, not HTML/JSON [S32]. Free-plan bandwidth figure: UNCONFIRMED (a reported 100 GB/month Free cap from July 2026 found only on a third-party blog; no Cloudflare source) [S32]. |
| Why this platform might need it | The app is static JS/CSS/HTML (prerendered pages); first load on phones is bundle-bound (MOBILE-008 target ≤ 200 kB). |
| Does the current stack provide it | Yes. Vercel's CDN serves every deployment, 126 PoPs in 51 countries, with DDoS mitigation [S26]. Convex data traffic is WebSocket/HTTPS to Convex and is not cacheable at a CDN. Vercel recommends connecting directly and keeping Cloudflare DNS-only; proxying is possible but "not recommended", and Flexible SSL causes redirect loops [S26]. |
| Complexity added | Low to configure, but a double-CDN (Cloudflare in front of Vercel) complicates cache invalidation and Vercel's own protections. |
| **Recommended stage** | **Do not adopt** while on Vercel. Caching comes with the hosting decision (§3): if the app ever moves to Workers, static assets are served free from Workers static assets [S12]. |

### 2.7 Turnstile (bot challenge)

| Aspect | Assessment |
|---|---|
| Problem solved | CAPTCHA alternative. Free: up to 20 widgets, 10 hostnames per widget, unlimited challenges [S27]. Server check: `POST https://challenges.cloudflare.com/turnstile/v0/siteverify` with `secret`, `response`, optional `remoteip` and `idempotency_key`; token ≤ 2048 chars, valid 300 s, single-use (reuse detection eventually consistent) [S27]. Modes: managed, non-interactive, invisible [S27]. Works without proxying the domain through Cloudflare. |
| Why this platform might need it | Open self-service sign-up and company registration (ORG-004; Q-011 asks whether sign-up stays open), password reset and invitation-accept forms (SEC-005, ORG-003), and any public buyer-facing trace lookup (TRACE-004). Today the Password provider accepts any sign-up; SEC-001 removes the shared data pool but does not stop bot accounts or pending-company spam. |
| Does Convex already provide it | Partly. Convex Auth rate-limits failed reset-code attempts and supports `profile` validation and `validatePasswordRequirements` [S38]; `@convex-dev/rate-limiter` (v0.4.3) provides token-bucket/fixed-window limits [S37]. Neither distinguishes humans from bots. No Convex Auth documentation covers captcha/Turnstile (UNCONFIRMED). |
| Integration shape | Widget on `pages/signup.js`, `pages/register-company.js`, `pages/login.js` (after N failures), reset/invite pages. Verification in a Convex **action** (mutations cannot `fetch` [S35]): `auth.verifyHuman({ token, purpose })` calls siteverify with the secret from Convex env, checks `hostname` and `action`, and on success writes a single-use `humanTickets` row (purpose, expiry ≤ 5 min) via an internal mutation; the sign-up / register mutation consumes the ticket. Whether the ticket can be checked inside Convex Auth's Password `profile` callback, or requires a `ConvexCredentials` provider, is UNCONFIRMED and needs a spike. Company registration (`companies.register*`) is an app mutation and can consume the ticket directly. |
| Complexity added | Low. One script tag, one action, one table, two env vars (site key public, secret in Convex). |
| Financial | $0 at this scale [S27]. |
| Security considerations | Secret key only in Convex env; tokens never logged; ticket bound to purpose and expiry; Turnstile complements, not replaces, per-IP/per-email rate limits in Convex. Content-Security-Policy (SEC phase, doc 10 §6) must allow `challenges.cloudflare.com` for script and frame. |
| **Recommended stage** | **Adopt when needed.** Trigger: the owner answers Q-011 "sign-up stays open" (ORG-004 ships), or abuse appears in sign-up/registration logs, whichever first. If sign-up becomes invite-only, keep it on reset and invite-accept only if abuse is observed. |

### 2.8 WAF, rate limiting, bot management, DDoS

| Aspect | Assessment |
|---|---|
| Problem solved | Free: Free Managed Ruleset, 5 custom rules, 1 rate-limiting rule (IP only, 10 s period), Bot Fight Mode; Pro ($20/month annual, $25 monthly): Cloudflare Managed Ruleset + OWASP, 20 custom rules, 2 rate-limiting rules (period up to 1 min); Business ($200/$250): 100 custom rules, 5 rate-limiting rules [S28]. DDoS mitigation unmetered on all plans [S28]. Bot Fight Mode cannot be skipped by custom rules and may challenge API traffic [S28]. Per-plan bot product names (Super Bot Fight Mode vs Bot Management) UNCONFIRMED. |
| The structural caveat | The WAF only protects traffic proxied through a Cloudflare zone. This app's attack surface is Convex (`*.convex.cloud` WebSocket/HTTP API and `*.convex.site` HTTP actions), not the static Next.js pages. Convex documents a proxied custom domain (CNAME to `convex.domains`, orange-cloud) as "the only option that works for the realtime Convex API" if you want WAF in front; custom domains require Convex Pro, and the default `*.convex.cloud`/`*.convex.site` hostnames remain reachable unless Convex support disables them [S29]. Without that, a WAF in front of the Next.js host protects two LLM API routes and static files only. Vercel already provides DDoS mitigation and 3 (Hobby) / 40 (Pro) WAF custom rules [S26]. |
| Does Convex already provide it | Rate limiting: yes, application-level and identity-aware via `@convex-dev/rate-limiter` (planned for sign-up, invitations, exports, LLM proxy, API keys — doc 02 §6). Bot detection: no. DDoS: Convex is a managed service; its own protection is not documented in the sources retrieved (UNCONFIRMED). |
| Complexity added | Low for the Next.js host; medium–high for Convex (custom domains on Pro, proxy configuration, WebSocket through proxy, asking Convex to disable default hostnames, Convex Auth issuer/`CONVEX_SITE_URL` changes [S29, S35]). |
| Security considerations | A WAF is not a substitute for authorization. Rate limits that matter here are per member, per company and per API key — only Convex knows those identities. Bot Fight Mode must not be enabled on a zone that proxies IoT or webhook traffic (it may challenge non-browser clients [S28]). |
| **Recommended stage** | **Revisit at enterprise scale.** Trigger: an enterprise customer's security review requires a WAF in front of all endpoints, or a volumetric/abuse incident against Convex endpoints. At that point: Convex Pro custom domains proxied through a Cloudflare zone, Pro or Business plan, default hostnames disabled. Until then: rate limiting in Convex (`@convex-dev/rate-limiter`), Turnstile on public forms, Vercel's built-in DDoS/WAF for the frontend. |

### 2.9 Access / Zero Trust (admin and staging protection)

| Aspect | Assessment |
|---|---|
| Problem solved | Identity-aware gate in front of self-hosted apps. Free for up to 50 users; pay-as-you-go $7/user/month [S30] (whether all seats become billable above 50: UNCONFIRMED). The app's domain must be an active Cloudflare zone; deny by default; validate the Access JWT at the origin [S30]. |
| Why this platform might need it | Keep staging (OPS-001 creates a staging deployment and Vercel preview → staging) and internal tools away from the public internet; restrict the super-admin console (`pages/admin/admin.js`). |
| Does the current stack provide it | Partly: Vercel deployment protection exists for previews (plan-dependent; not researched here — UNCONFIRMED). For the Convex backend, Access does not apply unless Convex is proxied (2.8). The super-admin console's real protection is server-side (`requirePlatformAdmin`, D-005); hiding the page does not protect the functions. |
| Complexity added | Low for a staging frontend hostname on a Cloudflare zone; the staging Convex deployment remains reachable directly. |
| **Recommended stage** | **Adopt when needed.** Trigger: staging holds copies of real tenant data, or external contractors need staging access. Protect the staging frontend hostname; keep staging data synthetic or anonymized regardless (Access does not protect `*.convex.cloud`). |

### 2.10 DNS and Registrar

| Aspect | Assessment |
|---|---|
| Problem solved | Authoritative DNS (free) and at-cost domain registration with DNSSEC [S31]. |
| Why this platform might need it | A product domain is needed for SEC-005 email (SPF/DKIM/DMARC), Convex custom domains (Pro), Vercel custom domain, and stable QR label URLs (doc 13 Q4, MOBILE-006). |
| Does the current stack provide it | Vercel and the current registrar (unknown) can host DNS. |
| Complexity / risk | Low. Records stay DNS-only (grey cloud) for the Vercel app per Vercel guidance [S26]. Moving nameservers is a precondition for any later WAF/Access/Workers adoption on that zone [S17, S30]. |
| **Recommended stage** | **Adopt when needed.** Trigger: when the production domain is chosen/moved for OPS-001 cutover or SEC-005 email authentication. Low-risk default choice for DNS; keep records DNS-only. |

### 2.11 Email Routing and Email Service

| Aspect | Assessment |
|---|---|
| Problem solved | Email Routing: inbound forwarding or delivery to a Worker; free [S22]. Email sending (Email Service): Workers Paid only, 3,000 emails/month included then $0.35 per 1,000; "Email Sending is in Beta" per the Email Routing page [S22]. |
| Why this platform might need it | Transactional email for reset/verification/invitations (SEC-005, INT-002 email slice); inbound email (e.g. suppliers mailing invoices) is speculative. |
| Does Convex already provide it | Convex has no email service; doc 09 picks an HTTP email provider adapter (`resend`) called from Convex actions. |
| Assessment | Sending from Convex through Cloudflare would require a Worker (binding) or the REST API, beta, plus Workers Paid. A dedicated email API called from a Convex action has fewer moving parts. Email Routing for a `support@` alias is harmless and free. |
| **Recommended stage** | Outbound: **Do not adopt** (beta, requires Workers; keep D-009 adapter approach). Inbound routing for staff aliases: **Adopt when needed** (trigger: domain on Cloudflare DNS and a need for aliases), no application impact. |

### 2.12 D1, KV, Durable Objects, Hyperdrive (second database candidates)

| Service | Facts [S21] | Why rejected |
|---|---|---|
| D1 | Serverless SQLite; 10 GB per database on Paid; single-threaded | A second relational store would split the system of record; Convex already provides transactions, indexes and reactivity. Tenant isolation, audit and backups would have to be duplicated. |
| KV | Eventually consistent; changes take "up to 60 seconds or more" to propagate | Stock, feed ledger and approvals require read-your-writes; KV is unsuitable for business data. |
| Durable Objects | Single-threaded objects with SQLite storage; ~1,000 req/s soft limit per object | Would only be justified for real-time coordination Convex already provides (reactive queries, OCC transactions). |
| Hyperdrive | Pooling/caching for an external Postgres/MySQL | There is no external SQL database. |
| **Stage** | **Do not adopt** (all four) as application databases. The only acceptable use is internal to a Cloudflare product that requires them (e.g. OpenNext's tag cache in D1/DO if hosting moved — §3), holding no business data. |

---

## 3. Hosting: stay on Vercel vs Next.js on Cloudflare Workers via OpenNext

### 3.1 What the app needs from a host

- 61 routes, statically prerendered and client-rendered; Convex data flows browser ↔ Convex directly (doc 01 §1).
- 8 legacy redirect stubs using `getServerSideProps` and 8 `redirects()` in `next.config.mjs` — same purpose, both server features.
- Two Node API routes (`pages/api/llm/chat.js`, `status.js`) calling LLM providers with `fetch`; INT-009 plans to move the LLM gateway onto the Convex credential model, which would remove them.
- Webpack fallbacks for `fs`, `net`, `tls` (`next.config.mjs`).
- No ISR, no `next/image` optimization dependency confirmed, no middleware.

### 3.2 Options

| | A. Stay on Vercel | B. OpenNext on Workers | C. Static export on any static host (incl. Workers static assets) |
|---|---|---|---|
| Compatibility | Native; current setup | `@opennextjs/cloudflare` 1.20.17 (latest, 2026-11-12); supports Next 16 and the latest Next 15 minor; Pages Router supported; Node runtime via `nodejs_compat`, Edge runtime not supported; Wrangler ≥ 3.99.0 [S23, S24]. **Release 1.20.16 (2026-11-03) raised the floor to Next 15.5.29 / 16.4.5** [S24]; this app's `main` is on 15.2.8; PR #20 (OPS-003, in `release/phase0`) bumps it to 15.5.29, which meets the floor. Pages Router `pages/api` routes not named explicitly in the docs (UNCONFIRMED, probably covered). Formal GA label UNCONFIRMED (1.x versions). Worker size limit 3 MiB Free / 10 MiB Paid gzipped per OpenNext docs [S23] (Cloudflare's limits page now states no compressed-size limit and 64 MiB uncompressed [S13] — conflicting; verify at build). `next/image` needs a Cloudflare Images binding or custom loader [S23]. | Requires `output: 'export'`: removes `getServerSideProps` stubs and `redirects()` (move to host redirect rules), dynamic routes `pages/cages/[id].js`, `pages/stocking/[id]/*`, `pages/topup/[id]/*` need client-side param handling or query-string URLs (QR labels use `?cage=` style and `/cages/<id>` — doc 13 Q4 must be checked), API routes moved to Convex (INT-009). |
| Cloudflare-side alternatives | `@cloudflare/next-on-pages` is deprecated and archived (2026-10-01), pointing to Cloudflare's `vinext`; Cloudflare's Next.js guide now leads with vinext and lists OpenNext as the alternative [S25]. vinext was not evaluated (treated as too new). | — | — |
| Risk | Low | Medium–high: adapter on a fast patch cadence (four 1.20.x patches in weeks), Next upgrade 15.2 → 15.5/16 in the same move, different runtime (workerd) for the two API routes, a less common deployment path for a team of one or two | Medium: URL/route changes touch QR deep links and redirects |
| Migration effort | None | M: Next upgrade (also wanted by OPS-003 for CVEs), wrangler config, CI job, env vars, preview environments, DNS move to Cloudflare (Workers custom domains need the zone on Cloudflare [S17]) | M: route refactor + LLM route move |
| Cost (this app's traffic) | Hobby forbids commercial use ("personal or non-commercial use" only) [S26] — if production runs on Hobby today, that is a terms issue to fix regardless. Pro: $20/month platform fee incl. 1 deploying seat and $20 usage credit; included CDN 1 TB transfer, CDN requests stated as 1M (docs) vs 10M (pricing page) — conflicting [S26]. A static app with 2 API routes should stay within the credit. | Workers Paid $5/month; static asset requests free; API route invocations within the 10M included [S12] | $0–5/month |
| Operations | Preview deployments per PR, already wired via Vercel GitHub app (inferred) | Must rebuild preview environments and their Convex staging wiring (OPS-001) | Simple |

### 3.3 Recommendation

**Stay on Vercel (Pro).** Do not move Next.js to Workers now. The application is client-rendered against Convex, so the host serves static files and two small functions; moving it saves roughly $15/month while adding a Next.js major/minor upgrade, a fast-moving adapter and a DNS move into one change. Specific follow-ups:

1. Confirm the Vercel plan; if production is on Hobby, move to Pro (terms) — log as part of OPS-001.
2. Upgrade Next within the supported line under OPS-003 for security reasons alone; this also keeps a future OpenNext option open (floor 15.5.29 [S24]).
3. Move the LLM proxy into Convex under INT-009 as already planned; this removes the only real server code from the Next host.
4. Revisit hosting (option B or C) only if one of these occurs: Vercel cost for this app exceeds ~$100/month, a data-residency requirement applies to the frontend host, or the owner standardizes all products on Cloudflare and accepts the upgrade work. Status of the decision: **Revisit at enterprise scale.**

---

## 4. Summary table

| Service | Stage | Trigger / note |
|---|---|---|
| R2 | Adopt when needed | Projected file overage > ~$100/month (≈300 orgs), originals/video, expiring-link or EU-jurisdiction requirement, or Phase 12 retention rules; build `files` abstraction on Convex storage first |
| Workers | Adopt when needed | IoT volume beyond batched HTTP actions, provider latency not met, or non-HTTP protocol |
| Queues | Do not adopt | Only alongside an ingestion Worker; workpool covers async fan-out |
| Workflows | Do not adopt | Convex scheduler + `@convex-dev/workflow` cover D-008 |
| Images | Do not adopt | Client-side compression and thumbnails |
| CDN / caching | Do not adopt | Vercel CDN; comes free with Workers only if hosting moves |
| Turnstile | Adopt when needed | Q-011 answered "open sign-up" (ORG-004) or abuse observed |
| WAF / rate limiting / bots / DDoS | Revisit at enterprise scale | Enterprise security review or incident; requires Convex Pro proxied custom domains; rate limiting stays in Convex |
| Access / Zero Trust | Adopt when needed | Staging holds real data or external staging users |
| DNS / Registrar | Adopt when needed | Production domain setup (OPS-001 / SEC-005); DNS-only records |
| Email Routing (inbound aliases) | Adopt when needed | Domain on Cloudflare DNS + alias need |
| Email sending | Do not adopt | Beta, Workers-bound; use D-009 email adapter |
| D1 / KV / Durable Objects / Hyperdrive | Do not adopt | No second application database |
| Next.js hosting on Workers (OpenNext) | Revisit at enterprise scale | See §3.3 triggers; stay on Vercel Pro |

No service is rated **Adopt immediately**: nothing in Phase 0 needs Cloudflare, and Phase 0 should not add a vendor.

## 5. Overall recommendation and principles

1. **Convex remains the source of truth.** Every business record, file metadata row, permission decision, audit entry and automation run lives in Convex. Cloudflare services, if adopted, hold bytes (R2) or run stateless edge code (Workers) and talk to Convex through defined contracts (doc 15).
2. **No D1 (or KV, Durable Objects) as a second application database.**
3. **Do not move Next.js to Workers just because it is possible.** The host is not this app's bottleneck or cost driver.
4. **Adopt Cloudflare services by trigger, not by preference.** The first likely adoptions are Turnstile (when sign-up opens) and R2 (when file features land and volume or compliance justifies it), both of which keep authorization in Convex and need no Worker.
5. **Design for the switch now, pay for it later.** Phase 8/12 file features use a provider-neutral `files` table (doc 16 §8) so moving bytes to R2 later is a background copy, not a schema migration.

## Unverified items

- R2 Infrequent Access GA status; Super Slurper GA status and cost; Sippy cost [S1, S11].
- OpenNext formal GA label; explicit `pages/api` support; compressed Worker size limit conflict between OpenNext and Cloudflare docs [S13, S23].
- Vercel Pro included CDN requests (1M vs 10M conflict); Vercel plan actually used by this project [S26].
- Cloudflare Free-plan CDN bandwidth cap claim (third-party source only) [S32].
- Convex `getUrl` link expiry; Convex Auth hook point for a Turnstile ticket; Convex-side DDoS protection details; whether the Convex "data egress" allowance is shared with non-file egress [S29, S33, S34, S38].
- Per-plan Cloudflare bot product names; Access billing above 50 seats [S28, S30].
