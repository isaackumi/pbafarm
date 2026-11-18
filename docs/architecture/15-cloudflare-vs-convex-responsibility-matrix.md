# Architecture 15 — Cloudflare vs Convex Responsibility Matrix

Status: proposed, 2026-11-18. Companion to `14-cloudflare-adoption-assessment.md` (per-service stages), `16-storage-cost-and-scaling-assessment.md` and `17-cloudflare-adoption-roadmap.md`. Cloudflare is not used by this project today; every "Cloudflare" cell below is a conditional target.

## Objective

State, capability by capability, which platform owns it now, which should own it in the target architecture, why, and the boundary contract that keeps Convex the system of record if a Cloudflare component is introduced.

## Sources and date

Retrieved 2026-11-18. Source ids `[Sn]` refer to the source table in `14-cloudflare-adoption-assessment.md`. Codebase facts from commit `d1d5de1`: `convex/http.ts` (auth routes only), `convex/crons.ts` (one cron), `convex/companies.ts:14,790-844` (logo storage), `pages/api/llm/*.js`, `pages/export.js`, `components/BulkUploadModal.js`.

## Assumptions

1. Stages from doc 14 apply: only R2, Workers (narrow), Turnstile, Access, DNS and inbound Email Routing are candidates, each "Adopt when needed"; WAF and hosting are "Revisit at enterprise scale"; Queues, Workflows, Images, D1/KV/DO are "Do not adopt".
2. "Owner" means the component that holds the authoritative state or makes the authoritative decision, not merely the one that carries bytes.
3. "Vercel" is the inferred current frontend host (doc 13 §33).

## 1. Matrix

| # | Capability | Owner now | Owner target | Why | Boundary contract |
|---|---|---|---|---|---|
| 1 | Business records (cages, stock events, feed ledger, harvests, sales, documents metadata) | Convex | Convex | Transactions, indexes, reactivity, one backup regime (D-001, D-004) | No Cloudflare component writes or caches business records. D1/KV/Durable Objects are not used as application stores. |
| 2 | Authentication | Convex Auth (Password) | Convex Auth (Password, later reset/verify, SSO under ENT-003) | Sessions and identity live next to the data they authorize | Cloudflare Access (if adopted for staging) is an extra gate in front of a frontend hostname only; it never replaces Convex Auth and its identity is never trusted by Convex functions. |
| 3 | Authorization / tenant isolation | Convex (`requireUser`, `listForCompany`) | Convex (`requireMember`, D-005) | Only Convex knows memberships, permissions, site scope | Every presigned URL, file read and service call is authorized in Convex first. Edge components hold no permission data. |
| 4 | Realtime | Convex reactive queries (WebSocket) | Convex | Native; no edge equivalent needed | — |
| 5 | Business logic | Convex mutations | Convex domain modules (doc 02 §3) | Single writer per table | Workers contain transport logic only (auth of the caller, parsing, batching), never business rules. |
| 6 | Scheduled jobs | Convex cron (`reminders.dailyDigest`) | Convex crons + scheduler fan-out (PLAT-001, AUTO-007) | Transactional scheduling; per-org time zones computed from Convex data | Workers Cron Triggers are not used for business schedules. A Worker cron is allowed only for edge housekeeping that touches no business data. |
| 7 | Durable multi-step automation | None | Convex scheduler + `automationRuns`; `@convex-dev/workflow` if needed (D-008) | Steps read/write Convex data transactionally [S37] | Cloudflare Workflows not used (doc 14 §2.4). |
| 8 | Async fan-out / retries | None | Convex scheduler; `@convex-dev/workpool` for outbound deliveries and webhooks [S37] | Outbox pattern inside the mutation transaction (doc 07 §2) | Cloudflare Queues only behind an ingestion Worker, and its consumer calls Convex like any other service caller (row 15). |
| 9 | File storage (bytes) | Convex storage (logo) | Convex storage first; R2 when doc 14 §2.1 trigger fires (per file, `provider` field) | Convex is enough at current scale; R2 is cheaper on egress at volume and offers expiring links | **Convex issues every upload and download URL** after `requireMember` + subject ownership check. Object key prefix `{env}/{companyId}/…` computed server-side. R2 credentials only in Convex env. Browser uploads directly to R2 with a presigned PUT; Convex records the file only after verifying size/type from R2 metadata. |
| 10 | File metadata | `companies.logoStorageId` | Convex `files` table (`companyId`, `provider`, `storageId` or `objectKey`, subject, type, size, sha256, status) (doc 16 §8) | Metadata is a business record (row 1) | No listing of R2 buckets drives UI; the `files` table is authoritative. Orphan cleanup runs from Convex. |
| 11 | Image transforms | None | Client-side compression and thumbnail before upload | Saves field upload bandwidth; avoids Images cost (doc 16 §5) | If Cloudflare Images is ever adopted, a Worker must validate a short-lived Convex-signed token before transforming a private object. |
| 12 | Static assets / CDN | Vercel | Vercel | Hosting decision in doc 14 §3 | DNS records for the app stay DNS-only if the zone moves to Cloudflare [S26]. |
| 13 | Edge APIs (server code near users) | Next.js API routes on Vercel (`/api/llm/*`) | Convex actions (LLM gateway, INT-009); no edge API layer | Server code next to data and credentials | — |
| 14 | Inbound webhooks (SMS, WhatsApp, email providers) | None | Convex HTTP actions `/webhooks/:provider/:connectionId` (doc 09 §6) | Signature secrets and dedupe tables live in Convex | A Worker front is not used for webhooks unless a provider's latency/volume requirement is measured as unmet (doc 14 §2.2). |
| 15 | IoT / sensor ingestion | None | Convex HTTP action `/ingest/v1/readings` (batches ≤ 500) for pilots; optional ingestion Worker when the doc 14 §2.2 trigger fires | Volume unknown; Convex handles pilot volume | **Workers never write business records directly.** An ingestion Worker authenticates the device by forwarding the device key to Convex (or receives pre-validated batches from a gateway holding a Convex-issued key), batches readings, and calls one Convex HTTP action with an HMAC-signed service credential (`X-PBA-Service-Signature`, timestamped, scope `ingest:write`, rotated via Convex env). Convex re-validates units, ranges and device ownership, writes `waterQualityReadings` and rollups. The Worker keeps no device registry of its own. |
| 16 | Outbound integrations (SMS, WhatsApp, email, weather, accounting) | None (LLM via Next route) | Convex actions behind adapters with encrypted per-org credentials (D-009) | Credentials decrypted only inside Convex actions | Cloudflare Email sending not used (beta, Worker-bound) [S22]. |
| 17 | Bot protection on public forms | None | Turnstile widget + Convex action verification (when trigger fires) | Only Convex can bind the human check to the sign-up transaction | Turnstile secret only in Convex env; `siteverify` called from a Convex action [S27, S35]; the action writes a single-use, purpose-bound, ≤ 5-minute ticket that the sign-up/registration mutation consumes. |
| 18 | Rate limiting | None | `@convex-dev/rate-limiter` per member, company, API key, IP-hash where available | Identity-aware limits need Convex data [S37] | Cloudflare rate-limiting rules (if a zone is proxied) are coarse per-IP backstops only; they must not be the sole limit on any authenticated operation. |
| 19 | DDoS / WAF | Vercel defaults (frontend); Convex platform (backend) | Same; Cloudflare WAF in front of Convex custom domains only at enterprise scale | WAF protects only proxied hostnames; Convex default hostnames stay reachable unless disabled [S29] | If adopted: Convex Pro custom domains proxied, default `*.convex.cloud`/`*.convex.site` disabled by Convex support, `CONVEX_SITE_URL`/Auth issuer updated, Bot Fight Mode off for API/ingest hostnames. |
| 20 | Secrets | Convex env (JWT keys), Vercel env (LLM keys) | Convex env for platform secrets (incl. R2 keys, Turnstile secret, service HMAC keys); `integrationSecrets` encrypted per org (D-009) | One custody point | Any Worker holds only its own inbound-auth secret and the outbound HMAC key for Convex — never Convex deploy/admin keys, never org credentials, never R2 admin tokens. |
| 21 | Audit | Convex `auditLogs` (66/76 mutations) | Convex `auditLogs` + `domainEvents` | Audit must be in the same transaction as the change | File uploads, downloads of documents (issuance of GET URLs) and service-credential calls are audited in Convex. Edge logs are diagnostic, not audit. |
| 22 | Analytics export | None (client-side XLSX/JSON) | Convex rollups; scheduled exports generated by Convex actions into `files`; warehouse export only per D-001/doc 02 §7 | Bounded reads; exports are files with retention | Export files follow row 9 (Convex-signed URLs, lifecycle/retention from the `files` row; on R2, a lifecycle rule on the `exports/` prefix as a backstop [S6]). |
| 23 | Email | None | Convex action → HTTP email provider (D-009) | — | Cloudflare Email Routing only for staff inbound aliases; no application dependency. |
| 24 | DNS / domain | Unknown registrar; Vercel domain | Any DNS; Cloudflare DNS acceptable (DNS-only) | Precondition for Access/WAF/Workers custom domains if ever adopted | QR label host and path (doc 13 Q4) must not change when DNS moves. |
| 25 | Backups / recovery | None documented | Convex periodic backups (Pro) [S39] + R2 objects protected by delayed delete (doc 16 §9) | R2 has no versioning/object lock [S3] | Convex restore and R2 contents must be reconcilable: `files` rows are the index; a reconciliation job reports rows without objects and objects without rows. |

## 2. Contracts in one place

1. **Source of truth.** Convex holds every record, every file metadata row and every authorization decision. Cloudflare holds bytes (R2) or runs stateless transport code (Workers).
2. **Write path from the edge.** A Worker calls a Convex HTTP action with a signed service credential. That action calls internal mutations, which validate everything again. A Worker never calls public mutations as a fake user and never holds a deploy key.
3. **Presigned URLs.** Only Convex issues them, after `requireMember` and subject ownership checks. Uploads: PUT, expiry ≤ 15 min, key fixed by Convex. Downloads: GET, expiry 5–15 min for documents, never stored in the database or `localStorage`.
4. **Tenant key layout.** `{env}/{companyId}/{domain}/{subjectTable}/{subjectId}/{fileId}`, with `fileId` a Convex-generated id or UUID. Keys never derive from file names supplied by the user. The original file name is stored in the `files` row.
5. **Credential custody.** R2 bucket-scoped tokens, the Turnstile secret and service HMAC keys live in Convex env per deployment (prod, staging) and are rotated in a runbook. No Cloudflare credential reaches Next.js or the browser.
6. **Observability.** Every edge-to-Convex call carries a request id that Convex logs and stores on `inboundEvents` rows, so a failed device batch can be traced across both systems.
