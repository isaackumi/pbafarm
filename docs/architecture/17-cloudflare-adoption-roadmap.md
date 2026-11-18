# Architecture 17 — Cloudflare Adoption Roadmap

Status: proposed, 2026-11-18 — awaiting owner approval like the rest of the roadmap (MASTER-PROMPT PART 16). Nothing here is authorized for implementation. Cloudflare is not used by this project today.

## Objective

Map each candidate Cloudflare adoption from `14-cloudflare-adoption-assessment.md` onto the existing phases and tracker ids in `docs/roadmap/03-development-roadmap.md` and `docs/project-management/MASTER-TRACKER.md`, with entry criteria, exit criteria, rollback, cost and the decisions to log. Propose new tracker ids (`CF-0xx`) for the lead to add; this document does not edit the tracker.

## Sources and date

Retrieved 2026-11-18; `[Sn]` ids refer to the source table in doc 14. Cost figures from doc 16.

## Assumptions

1. Phase order and dependencies are those of R03 (Phase 0 Stabilize, then Phases 1–14).
2. Every stage is trigger-based. If a trigger never fires, the stage never runs, and that is an acceptable outcome.
3. Convex Pro is in place from OPS-001 (needed for backups and log streams regardless) [S33, S39].
4. "Owner" below is the person approving the decision; "lead" is the lead architect who maintains the tracker and decision log.

## 1. Stage overview

| Stage | Cloudflare item | Roadmap anchor | Trigger | Proposed id |
|---|---|---|---|---|
| 0 | None — record the decision; verify hosting plan | Phase 0 OPS-001, OPS-003 | Now | CF-001 |
| 1 | DNS (DNS-only) for the production domain | Phase 0 OPS-001 cutover / Phase 1 SEC-005 email auth | Production domain set up or moved | CF-002 |
| 2 | Turnstile on public auth/registration forms | Phase 1 ORG-004, SEC-005, ORG-003 | Q-011 answered "sign-up stays open", or abuse observed | CF-003 |
| 3 | `files` abstraction on Convex storage (prerequisite, no Cloudflare) | Phase 7 (photos on field forms), Phase 8 (CUSTOM branding), Phase 12 TRACE-005 | First file feature beyond the logo | CF-004 |
| 4 | R2 provider behind `files` | Phase 12 TRACE-005 (or earlier) | Doc 14 §2.1 triggers: ≥ ~$100/month projected overage (~300 orgs), originals/video, expiring links or EU jurisdiction, retention rules | CF-005, CF-006 |
| 5 | Access for staging frontend | Phase 0 OPS-001 follow-up | Staging holds real data or external staging users | CF-007 |
| 6 | Ingestion Worker (+ Queue only if buffering is needed) | Phase 11 INT-007, Phase 6 POND/RAS, ANLY-006 | IoT load beyond batched HTTP actions, measured | CF-008 |
| 7 | WAF in front of Convex custom domains | Phase 14 (ENT) | Enterprise security review or incident | CF-009 |
| 8 | Hosting re-evaluation (OpenNext / static export) | Phase 14 or any time | Vercel cost > ~$100/month, frontend residency requirement, or owner standardization | CF-010 |
| — | Queues/Workflows as replacement for workpool/workflow | Phase 10 AUTO-002, Phase 11 INT-005 | Only with a measured case where `@convex-dev/workpool`/`@convex-dev/workflow` fail | (no id; log as decision if ever raised) |

## 2. Stages in detail

### Stage 0 — Record the position (Phase 0)

| Item | Detail |
|---|---|
| Work | Log D-014 (Convex is the source of truth; Cloudflare adopted by trigger). Confirm Vercel plan; if Hobby, move to Pro (Hobby is "personal or non-commercial use" only [S26]) as part of OPS-001. Upgrade Next within 15.x under OPS-003 to at least the OpenNext floor 15.5.29 [S24] — for CVEs first, option value second. |
| Entry criteria | Roadmap approved. |
| Exit criteria | D-014 and D-015 logged; Vercel plan documented in `docs/ops/`; Next version ≥ 15.5.29 on `main` (OPS-003). |
| Rollback | n/a (documentation) / revert Next upgrade per OPS-003. |
| Cost | Vercel Pro $20/month if not already [S26]. |

### Stage 1 — DNS (CF-002)

| Item | Detail |
|---|---|
| Work | Host the production zone on Cloudflare DNS (registrar transfer optional, at cost [S31]). Records for the Vercel app stay **DNS-only** [S26]. Add SPF/DKIM/DMARC for the email provider chosen under INT-002/SEC-005. If Convex custom domains are used (Pro), their CNAMEs are DNS-only at this stage. |
| Entry criteria | OPS-001 production cutover planned; domain chosen; QR label host confirmed (doc 13 Q4) so it does not change. |
| Exit criteria | App, Convex custom domain (if any) and email authentication resolve; TTLs lowered before and raised after; zone export stored in `docs/ops/`. |
| Rollback | Revert nameservers at the registrar (keep the previous zone file). |
| Cost | $0 DNS; domain at registry cost [S31]. |

### Stage 2 — Turnstile (CF-003)

| Item | Detail |
|---|---|
| Work | Widget on `pages/signup.js`, `pages/register-company.js`, reset-password and invite-accept pages, and on `pages/login.js` after repeated failures. Convex action `verifyHuman({ token, purpose })` calls `siteverify` [S27] (actions only can `fetch` [S35]), checks `success`, `hostname`, `action`; internal mutation writes a single-use `humanTickets` row (≤ 5 min). Sign-up/registration consumes the ticket. `@convex-dev/rate-limiter` per email and per company registration added in the same change [S37]. CSP allows `challenges.cloudflare.com`. |
| Spike first | Where the ticket check plugs into Convex Auth's Password flow (`profile` callback vs `ConvexCredentials` provider) — UNCONFIRMED [S38]. |
| Entry criteria | SEC-001 merged (no shared pool); Q-011 answered; ORG-004 in progress. |
| Exit criteria | Sign-up without a valid ticket refused (test); expired/reused ticket refused (test); widget works on low-end Android on 3G; error copy for failed challenge. |
| Rollback | Feature flag `TURNSTILE_REQUIRED=false` in Convex env: action still runs, mutation skips the check. |
| Cost | $0 (Free: 20 widgets, unlimited challenges) [S27]. |

Implemented (CF-003): the ticket check wraps the Password provider's `authorize` (the `profile` callback is synchronous); the rollback flag is simply unsetting `TURNSTILE_SECRET_KEY`. Not yet done: the post-failure widget on `pages/login.js` and per-email rate limits.

### Stage 3 — `files` abstraction on Convex storage (CF-004)

| Item | Detail |
|---|---|
| Work | `files` table and API from doc 16 §9; client-side compression and thumbnail utility (`lib/files/compressImage.js`); logo moved onto `files` (dual-read); orphan cleanup job (TD-015); type/size validation server-side (SEC-002 logo item). Upload through the offline outbox is out of scope at first (photos are queued as blobs in IndexedDB under MOBILE-002 later). |
| Entry criteria | First feature needing attachments is scheduled (Phase 7 field photos, Phase 12 TRACE-005, or CUSTOM branding). |
| Exit criteria | Tests: member of company A cannot obtain an upload or download URL for a subject of company B; `pending` uploads older than 24 h are removed; document downloads audited. Measured: average stored photo size, files per org per month (replaces doc 16 assumptions). |
| Rollback | Additive; feature flags per file feature. |
| Cost | Inside Convex Pro allowances until ~10–20 orgs, then cents to tens of dollars per month (doc 16 §2). |

Partly implemented (CF-004): the existing `files` table gained an upload binding (`fileUploads`: company, uploader, entity, declared SHA-256, 1 h expiry). `files.attach` accepts a storage id only through the caller's own pending binding, uploaded inside its window, with matching bytes; expired bindings are pruned daily. Logo uploads, compression and thumbnails remain open.

### Stage 4 — R2 provider (CF-005, CF-006)

| Item | Detail |
|---|---|
| Work | CF-005: Cloudflare account ownership and billing set up by the owner; prod and staging buckets in the jurisdiction matching the Convex deployment [S7]; bucket-scoped Object Read & Write tokens [S10]; CORS (PUT/GET, `Content-Type`) [S4]; `@convex-dev/r2` installed [S36]; env vars in Convex only; `requestUpload` provider switch; lifecycle backstop on `exports/` [S6]; runbook for key rotation. CF-006: backfill Convex blobs to R2 (doc 16 §9.2 steps 4–5) and reconciliation job. |
| Entry criteria | CF-004 Verified; one doc 14 §2.1 trigger has fired and is recorded in the decision log (D-016) with the measured numbers. |
| Exit criteria | New uploads land in R2 under `{env}/{companyId}/…`; cross-tenant URL tests pass with provider `r2`; presigned GET expiry ≤ 15 min for documents; reconciliation reports zero missing objects; Convex file storage trending down after backfill. |
| Rollback | Provider setting back to `convex` (new uploads); rows already on R2 keep working; until step 5 completes, rows can be patched back to their retained `storageId`. |
| Cost | Doc 16: at 300 orgs ≈ $12–35/month R2 vs ≈ $120–166/month Convex Pro overage (month 12–36); at 1,000 orgs $39–115 vs $420–573. No Workers plan needed. |

> Status (2026-11): the R2 provider (`convex/lib/r2.ts`, Effect service, hand-written SigV4 instead of `@convex-dev/r2`) and the copy/reconcile actions (`convex/r2Sync.ts`) are implemented and tested but **not wired** into `convex/files.ts`; env-gated no-op until `R2_*` is set. Owner setup and the wiring steps: `docs/ops/r2-storage.md`.

### Stage 5 — Access for staging (CF-007)

| Item | Detail |
|---|---|
| Work | Cloudflare Access policy on the staging frontend hostname (zone on Cloudflare, Stage 1) [S30]; staging Convex deployment keeps synthetic/anonymized data because Access does not cover `*.convex.cloud`. |
| Entry / exit | Entry: trigger in doc 14 §2.9. Exit: staging frontend requires identity; non-members denied (test from a clean browser). |
| Rollback | Remove the Access application. |
| Cost | $0 up to 50 users [S30]. |

### Stage 6 — Ingestion Worker (CF-008)

| Item | Detail |
|---|---|
| Work | Only after INT-004 (API keys) and INT-007 (device registry, `/ingest/v1/readings` HTTP action) are live and measured. Worker accepts device batches, authenticates by forwarding to Convex or via a gateway credential issued by Convex, aggregates, and calls a Convex HTTP action with a signed service credential (doc 15 row 15). Queue only if bursts exceed what the Worker can forward synchronously [S18]. |
| Entry criteria | Measured Convex HTTP-action load or cost from ingestion exceeds an agreed threshold (record in D-017), or a non-HTTP device protocol is required. |
| Exit criteria | Same readings and alerts as the direct path for a pilot site (dual-run comparison); replayed batches are idempotent; Worker holds no Convex deploy key and no device registry. |
| Rollback | Devices point back to the Convex `/ingest/v1/readings` URL (keep it live). |
| Cost | Workers Paid $5/month base; ingestion volumes in doc 09 fit the included 10M requests [S12]. |

### Stage 7 — WAF in front of Convex (CF-009)

| Item | Detail |
|---|---|
| Work | Convex custom domains (Pro) proxied through the Cloudflare zone; ask Convex support to disable default hostnames; update `CONVEX_SITE_URL`, Convex Auth issuer and client URLs; managed rules on Pro/Business plan; rate-limit rules as per-IP backstops; Bot Fight Mode off for API/ingest hostnames [S28, S29]. |
| Entry criteria | Enterprise security requirement or incident; staging rehearsal plan for WebSocket through the proxy. |
| Exit criteria | Realtime, HTTP actions and auth flows work through the proxy in staging; default hostnames disabled in prod; no regression in offline replay. |
| Rollback | Grey-cloud the records (DNS-only) — requires default hostnames re-enabled by Convex support if clients were moved; therefore move clients only after a staging soak. |
| Cost | Cloudflare Pro $20–25/month or Business $200–250/month [S28]; Convex Pro custom domains. |

### Stage 8 — Hosting re-evaluation (CF-010)

| Item | Detail |
|---|---|
| Work | Re-run doc 14 §3 with then-current OpenNext/vinext status; prerequisites: Next ≥ adapter floor, LLM routes moved to Convex (INT-009), redirect stubs replaced by host redirect rules. |
| Entry criteria | Doc 14 §3.3 trigger. |
| Exit criteria | Decision logged; if migrating, preview environments per PR rebuilt and wired to Convex staging, QR URLs unchanged. |
| Rollback | DNS back to Vercel (keep the Vercel project for one release). |
| Cost | Workers Paid $5/month vs Vercel Pro $20/month+ [S12, S26]. |

## 3. Proposed tracker ids (for the lead to add; not added here)

| ID | Feature | Description | Priority | Dependencies | Status | Docs |
|---|---|---|---|---|---|---|
| CF-001 | Cloudflare position and hosting plan check | Log D-014/D-015; confirm Vercel plan (Pro if commercial); Next ≥ 15.5.29 via OPS-003 | P1 | OPS-001, OPS-003 | Designed | A14, A17 |
| CF-002 | Production DNS on Cloudflare (DNS-only) | Zone, email auth records, QR host unchanged | P2 | OPS-001, Q-019 | Not started | A14 §2.10 |
| CF-003 | Turnstile on sign-up, registration, reset, invite | Convex action verification, single-use tickets, rate limits | P1 when triggered | SEC-001, Q-011, ORG-004 | Designed | A14 §2.7, A15 row 17 |
| CF-004 | `files` abstraction on Convex storage | Provider-neutral file metadata, compression, orphan cleanup, logo migration | P2 | PERM-002, SEC-002 | Designed | A16 §9 |
| CF-005 | R2 provider for `files` | `@convex-dev/r2`, buckets per env, scoped tokens, CORS, lifecycle backstop | P3 (trigger) | CF-004, D-016 | Not started | A14 §2.1, A16 |
| CF-006 | Backfill Convex blobs to R2 + reconciliation | Verified copy, grace period, reconciliation job | P3 | CF-005 | Not started | A16 §9.2 |
| CF-007 | Access on staging frontend | Identity gate for staging hostname | P3 (trigger) | CF-002, OPS-001 | Not started | A14 §2.9 |
| CF-008 | IoT ingestion Worker | Edge batching in front of Convex ingest; Queue only if needed | P3 (trigger) | INT-004, INT-007, D-017 | Not started | A14 §2.2–2.3, A15 row 15 |
| CF-009 | WAF in front of Convex custom domains | Proxied custom domains, default hostnames disabled | P3 (enterprise) | CF-002, Convex Pro | Not started | A14 §2.8 |
| CF-010 | Hosting re-evaluation | OpenNext / static export vs Vercel | P3 (trigger) | OPS-003, INT-009 | Not started | A14 §3 |

## 4. Decisions to log (drafts for the lead)

- **D-014** Convex remains the system of record; Cloudflare services are adopted only by recorded trigger; no D1/KV/Durable Objects as application databases.
- **D-015** Frontend hosting stays on Vercel (Pro); OpenNext/Workers re-evaluated only on the doc 14 §3.3 triggers.
- **D-016** File storage: provider-neutral `files` table on Convex storage first; R2 behind it when a doc 14 §2.1 trigger fires; Convex issues all presigned URLs; client-side compression; no Cloudflare Images.
- **D-017** Bot protection and edge: Turnstile verified in Convex when sign-up is open; rate limiting in Convex; Cloudflare WAF/Workers/Queues/Workflows not adopted until their triggers.

## 5. Risks

| Risk | Mitigation |
|---|---|
| Vendor sprawl for a small team | Trigger-based stages; one vendor added at a time; every stage has a rollback that removes Cloudflare from the path |
| Tenant leakage through object storage | Convex-only URL issuance, server-computed key prefixes, cross-tenant tests in CF-004/CF-005 |
| R2 deletions are permanent (no versioning [S3]) | Soft delete + grace period in Convex; optional DR bucket |
| Beta/fast-moving tooling (OpenNext 1.20.x patches, Email sending beta, R2 IA beta label) | Not on the critical path; re-verify status at each trigger |
| Pricing changes (Convex egress model changed in 2026 [S33]) | Re-run doc 16 formulas with current prices at each trigger review |
