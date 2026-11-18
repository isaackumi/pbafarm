# Decision Log

Architectural decisions for the Aquaculture OS evolution of this repository. Each entry records the context found in discovery, the decision, the alternatives considered and the consequences. Per MASTER-PROMPT PART 15, an agreed decision is never changed silently: a change of direction gets a new entry that supersedes the old one.

All entries below were proposed by the lead architect on 2026-11-18 after discovery (`docs/discovery/01`–`14`).

**Status of every entry: Proposed — awaiting owner approval.** No implementation starts until the owner approves the roadmap (MASTER-PROMPT PART 16).

| ID | Title | Status |
|---|---|---|
| D-001 | Stay on Next.js (Pages Router) + Convex | Proposed — awaiting owner approval |
| D-002 | Organization = existing `companies` table, plus a `memberships` table | Proposed — awaiting owner approval |
| D-003 | Hierarchy: organization → site (`farmLocations`) → production unit (`cages` + `unitType`) | Proposed — awaiting owner approval |
| D-004 | One shared production engine: `batches` + append-only `stockEvents` | Proposed — awaiting owner approval |
| D-005 | One central authorization guard `requireMember` with a permission catalog | Proposed — awaiting owner approval |
| D-006 | Company-indexed, paginated reads; rollup tables for dashboards | Proposed — awaiting owner approval |
| D-007 | One customization engine (`customFieldDefs`, terminology, layouts) | Proposed — awaiting owner approval |
| D-008 | Automation: `automationRules` + `automationRuns` + domain events outbox | Proposed — awaiting owner approval |
| D-009 | Integrations: encrypted per-org credentials, adapters, signed webhooks, hashed API keys | Proposed — awaiting owner approval |
| D-010 | Offline/mobile: generalized outbox with server idempotency, PWA first | Proposed — awaiting owner approval |
| D-011 | Errors and operations: `ConvexError`, error boundary, monitoring, staging + prod | Proposed — awaiting owner approval |
| D-012 | Globalization: org-level currency/timezone/units/locale, i18n library deferred | Proposed — awaiting owner approval |
| D-013 | Insert a Phase 0 "Stabilize" before the brief's Phase 1 | Proposed — awaiting owner approval |
| D-019 | Adopt Effect incrementally for integration code, via a thin in-house bridge | Accepted — owner request 2026-11-18 |

---

## D-001 — Stay on Next.js (Pages Router) + Convex

**Context.** The app is Next.js 15.2.8 Pages Router, all 61 pages client-rendered, JavaScript frontend, TypeScript only under `convex/` (doc 01 §1–2). Convex 1.42.3 holds 25 application tables and 142 public functions (doc 04, doc 06 §3). Discovery found no defect caused by Convex itself. The scale problems are self-inflicted: 57 full-table `.collect()` scans although `by_company` indexes already exist on most tables (doc 04 F8, F15; doc 12 §6.1). MASTER-PROMPT PART 11 forbids migrating the database "merely because the platform is expanding".

**Decision.**
- Keep Next.js Pages Router and Convex. No App Router rewrite.
- New backend code is TypeScript (already enforced by `convex/tsconfig.json`, strict).
- New frontend code may be TypeScript or JavaScript. No big-bang conversion of the ~22k lines in `pages/` + `components/`.
- Additional infrastructure only with a written justification in this log. Named candidates for later (not now): an analytics warehouse export (Phase 13) and an IoT ingestion gateway (Phase 11/6).

**Alternatives considered.**
1. App Router migration. Rejected: no server-rendering need (logged-in ops tool, PWA cache-first shell), high churn across 61 pages, and it would collide with every Phase 0–4 change.
2. Move to Postgres (e.g. Supabase, which the project left in 2026-07, doc 01 §3 `archive/`). Rejected: the reactive model and transactional mutations are exactly what the stock engine needs; the problems found are query-shape problems.
3. Full TypeScript conversion of the frontend first. Rejected as a phase of its own; it delays every fix. Contract drift is mitigated instead by typed `returns` validators on Convex functions (PLAT-003) and TS for new files.

**Consequences.**
- Security continues to rest entirely on Convex function checks (no server boundary in Next). D-005 must therefore be strict.
- The two client data paths (reactive `useQuery` vs imperative `lib/*Service.js`, doc 01 §2) remain until UX-002 converges them screen by screen.
- Convex limits (per-transaction read limits, mutation duration) shape the design: pagination, rollups and scheduler fan-out (D-006) are mandatory, not optional.

---

## D-002 — Organization = existing `companies` table, plus a `memberships` table

**Context.** `companies` is already the tenant root: registration → `pending` → super-admin `approve` (`convex/companies.ts:217-395`), settings, branding, logo (doc 04 §3.2). A user belongs to at most one company through `users.companyId` (`convex/schema.ts:28`); `companies.register` refuses users who already have one (`companies.ts:257-259`); multi-company membership is "Completely missing" (doc 07 §3.6). `users` has no `companyId` index (doc 04 F14).

**Decision.**
- "Organization" in docs and UI maps to the `companies` table. No table rename.
- Add `memberships` (`userId`, `companyId`, `role`/`roleId`, `locationScope` (array of `farmLocations` ids or "all"), `status`: `invited | active | suspended | removed`, `invitedBy`, `createdAt`, `updatedAt`), indexed `by_userId`, `by_companyId`, `by_companyId_and_userId`.
- Keep `users.companyId` as the **active organization pointer** during and after migration; it is what every existing function reads today. A company switcher updates it.
- `users.role` stays for `super_admin` only (platform role, D-005); organization roles move to `memberships.role`.

**Alternatives considered.**
1. Rename `companies` → `organizations`. Rejected: touches every module, index name and client call for no functional gain; Convex table renames require a copy migration.
2. Keep single `users.companyId` forever. Rejected: blocks consultants, group-level managers, multi-farm owners and enterprise subsidiaries (PART 1, PART 10-A).
3. Put an array of company ids on `users`. Rejected: no per-org role, status or site scope; arrays cannot be indexed for "members of company X".

**Consequences.**
- Backfill one membership per user with a `companyId` (migration M2, `docs/roadmap/04-migration-and-compatibility-plan.md`).
- Every guard must check the membership for the active company, not just `users.companyId` (D-005).
- Invites become pending memberships the invitee accepts, which closes V2/V3 (doc 07 §4.2).

---

## D-003 — Hierarchy: organization → site → production unit

**Context.** Sites exist as `farmLocations` (name, code, address, notes, active; doc 04 §3.5) with a header switcher (`contexts/LocationContext.js`). `cages` is the only production-unit table and also carries the live batch state (doc 04 §3.6). Ponds, tanks, raceways and hatchery units are "Completely missing" (doc 14 §3). No coordinates, timezone or site type exist (doc 13 §26–31).

**Decision.**
- Organization (`companies`) → optional business unit / region (later, ENT-001) → site (`farmLocations`, extended with optional `siteType`, `timezone`, `latitude`, `longitude`, `waterBody`) → production unit (`cages`).
- Keep `cages` as the generic production-unit table. Add optional `unitType`: `'cage' | 'pond' | 'tank' | 'raceway' | 'hatchery_tank' | 'nursery_tank' | 'broodstock_tank' | …`, read as `'cage'` when absent. Add type-specific optional dimensions (`areaM2`, `depthM`, `volumeM3`, `diameterM`) next to the existing `size`/`dimensions`.
- UI words ("Cage", "Pond", "Tank") come from configuration (terminology, D-007), not from forked pages.
- No rename of `cages` now.

**Alternatives considered.**
1. Separate tables per unit type (`ponds`, `tanks`, …). Rejected: every operational table (`dailyRecords`, `biweeklyRecords`, `harvestRecords`, `stockingHistory`, `fishTransfers`, `sales`, `healthTreatments`, `feedUsage`) references `cageId`; splitting forces polymorphic references everywhere and duplicate engine code (forbidden by PART 10-C).
2. Rename `cages` → `productionUnits`. Rejected for now: high churn, zero behaviour change. Can be revisited with a copy migration once the engine owns all writes.

**Consequences.**
- All existing cage features work unchanged for `unitType` absent or `'cage'`.
- Pond/tank/RAS modules (Phase 6) add optional fields and pages, not new production tables.
- The field name `cageId` remains in the schema and is documented as "production unit id".

---

## D-004 — One shared production engine: `batches` + append-only `stockEvents`

**Context.** There is no fish batch entity; a production cycle is a `stockingHistory` row (doc 08 §1). `cages.currentCount` is one mutable counter written by twelve code paths, some overwriting and some clamping at zero (doc 08 §4, doc 04 F6). History cannot be rebuilt (doc 08 §15). Doc 09 §5 lists 16 stock-consistency scenarios (1 Critical, 8 High). Lineage is one hop via `fishTransfers` (doc 08 §1). The feed side already has a working signed ledger (`feedInventoryTransactions`, `convex/lib/feedLedger.ts`), which proves the pattern works in this codebase.

**Decision.**
- Add `batches`: `companyId`, `locationId`, `unitId` (current `cages` id, optional when split across units), `batchCode`, `species`, `origin` (`stocked | hatched | transfer | split | merge`), `parentBatchIds`, `status` (`active | closed`), `openedAt`, `closedAt`, `legacyStockingId` (link to `stockingHistory`).
- Add append-only `stockEvents`: `companyId`, `locationId`, `unitId`, `batchId`, `type` (`stock_in | mortality | transfer_out | transfer_in | harvest | grading_split | merge | count_adjustment | correction`), `qty` (signed per type convention), `biomassKg`, `abwG`, `eventDate` (business date), `recordedAt`, `sourceTable` + `sourceId` (e.g. `dailyRecords`/`harvestRecords`/`fishTransfers`), `reversesEventId`, `createdBy`.
- One module (`convex/lib/productionEngine.ts`) is the only writer of `stockEvents` and of `cages.currentCount`, which becomes a derived cache.
- Corrections are reversal events (`correction` with `reversesEventId`) followed by a new event. History is never edited in place.
- Existing `stockingHistory`, `topupHistory`, `fishTransfers`, harvest `cageEffect` and daily mortality are backfilled into events (M6–M7), then routed through the engine via dual-write before reads switch.

**Alternatives considered.**
1. Keep the counter and patch each of the 16 scenarios. Rejected as the end state (it is what Phase 0 does as a stopgap): the counter cannot answer "fish in unit X on date D" and every new module (hatchery, nursery, grading) would add more writers.
2. Event sourcing with no cached counter (compute on read). Rejected: reads would grow with history; dashboards already fail on unbounded reads (D-006).
3. Use `stockingHistory` as the batch table. Rejected: it is a stocking event, not a cohort that can split, merge or move between units; its fields are copied onto `cages` and drift (doc 04 F6).

**Consequences.**
- New invariants testable as properties: Σ events per unit = `currentCount`; no negative balance without an explicit adjustment; transfer out + in conserve fish.
- `dailyRecords`, `biweeklyRecords`, `harvestRecords` gain optional `batchId` so cycle KPIs stop relying on date windows (`convex/lib/growth.ts:59-88`).
- Growth/KPI formulas consolidate into one service (doc 09 §6), fixing the four FCR and four mortality definitions.

---

## D-005 — One central authorization guard

**Context.** `requireUser` (`convex/lib/authz.ts:7-17`) does not check `users.active`, `mustChangePassword` or company status (doc 07 X1, X2, V5). `listForCompany` (`convex/lib/tenancy.ts:18-27`) filters after reading and lets every company-less user share one unscoped pool (X3, doc 04 F1). Only three roles exist (`user`, `admin`, `super_admin`); finer permissions are missing (doc 07 §3.1). `assertCompanyAccess` is dead code. Several write paths accept foreign ids (doc 04 F2, doc 07 V1, V14). `users.locationIds` is never written (doc 07 §3.3).

**Decision.**
- One guard: `requireMember(ctx, { companyId?, permission, locationId? })` returning `{ user, membership, company }`. It checks: authenticated, `users.active !== false`, `mustChangePassword` not set (except on the password-change path), membership `active` for the (active) company, company `status === 'approved'`, permission granted by the membership's role, and site in `locationScope` when a `locationId` is involved.
- A permission catalog (string constants such as `stock.approve`, `harvest.edit`, `feed.price.edit`, `sales.payment.edit`, `users.manage`) and role templates: `owner`, `admin`, `manager`, `field_staff`, `viewer`, plus custom roles per organization (Phase 3).
- Remove the "company-less users share unscoped rows" behaviour: no company → no tenant data and no writes.
- Platform super-admin stays separate from organization roles; cross-tenant access goes through explicit platform functions, audited, not through the tenant APIs.
- Helper `assertSameCompany(doc, ctx)` for every referenced id.

**Alternatives considered.**
1. Patch `requireUser` and keep three roles. Accepted only as the Phase 0 stopgap (SEC-001); insufficient for PART 10-A granular permissions.
2. Row-level security via a Convex wrapper library (custom functions wrapping `ctx.db`). Considered; may be used to implement the guard, but the decision is the single entry point and the permission model, not the library.

**Consequences.**
- All 142 public functions migrate to the guard (PERM-002); the migration is mechanical but must be covered by tenant-isolation tests (`docs/roadmap/05-testing-and-quality-plan.md` §4).
- Behaviour changes for company-less users and company-less super-admins; pre-flight data checks are required (M1).

---

## D-006 — Company-indexed, paginated reads; rollups for dashboards

**Context.** 57 call sites scan whole tables across all tenants (doc 12 §6.1, doc 04 F8); `.paginate()` is used 0 times; several reads take N rows from a non-tenant index and then filter, which silently drops rows at scale (doc 04 F7). About 40 tenant indexes exist but are unused (doc 04 F15). The daily cron processes every company in one transaction (doc 12 §6.2).

**Decision.**
- Every tenant read uses a company-prefixed index (`by_company`, `by_company_and_date`, `by_company_and_status`, …) and is bounded: paginated for lists, `take(n)` with a documented cap otherwise. No full-table scans in user-facing paths.
- Dashboards and reports read summary/rollup tables (e.g. per site per day, per batch) maintained on write by the engine or by scheduled jobs. Evaluate `@convex-dev/aggregate` before hand-rolling.
- Crons are bounded: a cron enumerates companies page by page and schedules one job per company with `ctx.scheduler.runAfter`.

**Alternatives considered.**
1. Raise limits / accept scans until data grows. Rejected: the failure mode is all tenants failing together (doc 12 T1).
2. External analytics store now. Rejected (D-001): premature; rollups inside Convex cover dashboards. Revisit in Phase 13.

**Consequences.** New indexes (F14 list) and rollup tables are additive; report queries change shape (paginated or summary-based). Test fixtures must include two companies.

---

## D-007 — One customization engine

**Context.** Customization today is limited to branding, theme, currency (GHS/USD/EUR) and farm rules in `companies.settings` with a draft → publish flow (`convex/companies.ts:599-840`, doc 14 row 11, 45). Settings drafts are stored as `v.any()` (doc 04 F12). No custom fields, terminology or layouts exist.

**Decision.** `customFieldDefs` (`companyId`, `entity`, `key`, `label`, `type`, `validation`, `required`, `defaultValue`, `conditions`, `locationScope`, `order`, `archivedAt`); values stored on records in an optional `custom` object validated server-side against the defs; `terminology` overrides; form layouts and dashboard layouts as config documents. One renderer and one validator used by every module. No per-module custom-field code.

**Alternatives considered.** Per-module extra columns (rejected: duplicated code, PART 17 "uncontrolled dynamic fields"); a separate EAV values table (rejected for now: extra joins on every read; revisit if a field must be indexed or queried across records).

**Consequences.** Records gain optional `custom: v.optional(v.record(v.string(), v.any()))` with server-side validation; reports can only filter on custom fields through explicit, indexed promotion later.

---

## D-008 — Automation engine

**Context.** One cron (`reminders.dailyDigest`, 16:00 UTC for all companies) creates in-app notifications only (doc 13 §5); no `ctx.scheduler` use, no retries, no email/SMS/push (doc 12 §10, doc 13 §7–10). Approvers are not notified (doc 14 row 26).

**Decision.** `automationRules` (trigger: domain event or schedule; conditions; actions) and `automationRuns` (status, attempts, error, timestamps), executed through the Convex scheduler; evaluate `@convex-dev/workpool` for retries and concurrency. Domain events are emitted by the production engine and other mutations into an `events` outbox table, consumed asynchronously.

**Alternatives considered.** Hard-coded reminder functions per feature (current pattern; rejected: grows linearly with features); an external workflow service (rejected, D-001).

**Consequences.** Mutations write an event row in the same transaction; delivery is at-least-once, so actions must be idempotent (keyed by event id).

---

## D-009 — Integration platform

**Context.** No outbound provider integration exists besides LLMs; no webhooks, no API keys, no credential storage (doc 13 §13–14). User-pasted LLM keys sit in plaintext `localStorage` (doc 12 §5.1).

**Decision.** Per-organization credentials stored encrypted (key held in Convex env; decrypt only inside actions; never returned to clients; write-only in the UI). Outbound providers behind one adapter interface (SMS: Hubtel, Africa's Talking, Twilio; WhatsApp Cloud API; email). Inbound via signed `httpAction` webhooks. Public API via organization API keys stored hashed, with scopes and rate limits.

**Alternatives considered.** Platform-only credentials (rejected: PART 10-F requires bring-your-own); storing secrets in plain table fields protected by function checks (rejected: dashboard/export readers would see them).

**Consequences.** New tables `integrationCredentials`, `apiKeys`, `webhookSubscriptions`, `deliveryLog`; an encryption helper and key-rotation runbook.

---

## D-010 — Offline and mobile

**Context.** Only daily entry has an offline outbox (`lib/offlineOutbox.js`, one global localStorage key, no idempotency key, doc 13 §16). Cold start with no signal very likely never passes the loading skeleton because the auth gate waits for Convex (doc 11 §10 #1). Outbox, drafts, Redux-persist and lookups are not user-scoped or cleared at sign-out (doc 12 §5.2, doc 11 §10 #3).

**Decision.** Generalize `lib/offlineOutbox.js` to every field form; add server-side idempotency (`clientMutationId` recorded per company/user so a retry never double-writes); namespace outbox and caches per user and clear at sign-out; offline-capable app shell (cached last-known user/session and reference data). PWA first; no native app now.

**Alternatives considered.** Native app with a local database (rejected for now: second codebase; revisit only if PWA limits block real farms); full local-first sync engine (rejected: premature).

**Consequences.** Mutations used by field forms accept an optional `clientMutationId`; an `idempotencyKeys` table (or field + index on each record) with retention.

---

## D-011 — Errors and operations

**Context.** 234 `throw new Error`, 0 `ConvexError` (doc 12 §5b) — messages the field UI relies on may be redacted on a production deployment. No React error boundary, no monitoring, console-only logging (doc 12 §5b–5d). Only a dev deployment (`vibrant-stork-860`) exists and acts as production; every developer laptop can push schema to it; no documented backups (doc 01 R1, doc 12 §7–8). CI lint is non-gating and lints `.next/` (doc 12 §3).

**Decision.** User-facing errors via `ConvexError` with stable codes; a React error boundary; error monitoring (frontend and Convex log streaming); separate **production** and **staging** Convex deployments (`vibrant-stork-860` stays dev); documented backups and a tested restore drill; CI runs lint (source only, gating), tests and typecheck on every PR, and the Convex deploy workflow runs tests first.

**Alternatives considered.** Keep the single deployment with stricter key handling (rejected: no isolation for migrations).

**Consequences.** A one-time data move from `vibrant-stork-860` to the new prod deployment (OPS-001, release strategy §3); deploy keys for prod held only by CI.

---

## D-012 — Globalization

**Context.** Currency is GHS/USD/EUR on `companies.settings.locale` (doc 14 row 12); no i18n library and all strings hard-coded English (row 13); all dates are UTC `YYYY-MM-DD` strings, correct for Ghana only (doc 12 §6.4); species are a five-item client list (`lib/fishSpecies.js`) and harvest size grades are free-form (doc 08 §8).

**Decision.** Organization-level currency, timezone, unit system and locale; per-user language. Introduce an i18n library (candidate `next-intl`) only when the first non-English locale is committed. Meanwhile route all formatting through `lib` helpers (money, number, date in organization/site timezone, units). Species and harvest size grades become per-organization configuration.

**Alternatives considered.** Add i18n now (rejected: string extraction cost with no target locale confirmed — OPEN-QUESTIONS Q-020); keep UTC dates (rejected: wrong for any non-UTC+0 market).

**Consequences.** "Today" for reminders, daily-entry duplicates and DOC is computed in the site/organization timezone. Existing rows stay as date strings (they were entered as local dates in Ghana, UTC+0, so no data rewrite is needed).

---

## D-013 — Phase 0 "Stabilize" before the brief's Phase 1

**Context.** Discovery found defects that corrupt data or leak access today:
- Deactivated users keep access (doc 07 X1); rejected/removed companies keep access (X2); company-less users share one data pool (X3).
- Cross-tenant writes: `farmLocations.backfillLocations` callable by any company admin across all tenants (V4); foreign `feedTypeId` drains another tenant's stock (V1); other unchecked ids (V14); `seed.seedDemo` public (doc 12 §5.3).
- Stock integrity: harvest edit after restock wipes the new cycle (doc 09 S5, Critical); transfer double count (S2/S3); stocking approval overwrites count (S9); ABW not reset on restock (S7); `/harvest-sampling` writes fake complete harvests (S12, doc 04 F9); feed issue + daily entry double deduction (S14).
- 57 full-table scans (doc 12 §6.1); no prod deployment or backups (doc 12 §7–8); offline cold start hangs (doc 11 §10 #1).

**Decision.** Insert Phase 0 "Stabilize": fix these with regression tests; ship nothing new. The first five features are SEC-001, SEC-002, PROD-000, OPS-001, PLAT-001; then ORG-001 (memberships) opens Phase 1.

**Alternatives considered.** Start at Phase 1 and fix defects along the way (rejected: Phase 1–4 migrations would backfill from corrupted counts and leaky tenancy).

**Consequences.** Phase 1 starts later; in exchange, the stockEvents backfill (M7) starts from counts that are no longer being corrupted, and the tenancy migration starts from enforced company boundaries.

**Note added after verification (2026-11-18).** The brief assumed PRs #7–#14 were open and that the S5 defect had to be fixed before #8 merged. GitHub shows #7, #8 and #13 merged into `main` (carrying #9–#12) and deployed to `vibrant-stork-860` by `convex-deploy.yml` (runs at 00:54 and 09:43 UTC on 2026-11-18). S5 is therefore live, and #7's daily-record edit UI makes S8 reachable (doc 09 says S8 "becomes Critical as soon as an edit UI for daily records ships"). PR #14 was merged into `feat/per-site-stock` after #13 had merged, so its commit `89d4f9d` is not on `main`. Phase 0 therefore starts with OPS-000 (reconcile PRs) and treats S5/S8 as hotfixes. See `docs/roadmap/03-development-roadmap.md` §0.1.


---

## D-014 — Convex stays the system of record; Cloudflare only on recorded triggers

**Status.** Proposed — awaiting owner approval (2026-11-18).

**Context.** The owner uses Cloudflare (R2, Workers) elsewhere and asked whether it should join this platform. It is not used today (`docs/architecture/14-cloudflare-adoption-assessment.md`).

**Decision.** Convex remains the database and source of truth for business records. Cloudflare services are adopted only when the trigger recorded for each in doc 14 fires. D1, KV and Durable Objects are not used as application databases.

**Alternatives considered.** Adopt R2/Workers/Queues now (rejected: adds a vendor, credentials and failure modes with no current workload that needs them); D1 for some modules (rejected: two sources of truth, no transactional consistency with Convex).

**Consequences.** One backend to operate in Phase 0–7; Cloudflare entry points are designed in (`files` abstraction, Convex-issued presigned URLs) so adoption later is incremental.

## D-015 — Frontend hosting stays on Vercel (Pro)

**Status.** Proposed — awaiting owner approval.

**Decision.** Keep Next.js on Vercel. Re-evaluate Workers/OpenNext only on the triggers in doc 14 §3.3 (Vercel cost above ~$100/month, a frontend residency rule, or the owner standardizing on Cloudflare). Confirm the Vercel plan: Hobby forbids commercial use (CF-001, OPS-001).

**Alternatives.** OpenNext on Cloudflare Workers now (rejected: adapter floor/maturity caveats, migration risk for ~$15/month saving).

## D-016 — Provider-neutral file storage; Convex storage first, R2 behind it when triggered

**Status.** Proposed — awaiting owner approval.

**Decision.** Files are tracked in a `files` table in Convex (companyId, provider, key, size, mime, entity link). Start on Convex file storage; add R2 behind the same table when doc 16's trigger fires (~300 orgs or full-size media). Convex issues every upload/download URL after the permission check; object keys are prefixed `{env}/{companyId}/…`; photos are compressed in the browser; Cloudflare Images is not used.

## D-017 — Bot protection and rate limiting

**Status.** Proposed — awaiting owner approval.

**Decision.** Turnstile on open sign-up/registration/reset/invite flows, verified in a Convex action, when sign-up stays open (Q-011) or abuse appears. Application rate limiting uses `@convex-dev/rate-limiter`. WAF, Workers, Queues and Workflows wait for their triggers.

## D-018 — Company messaging channels, phone sign-in and SMS/WhatsApp two-step verification

**Status.** Accepted by the owner (2026-11-18 requirements); implemented by INT-001, SEC-006, SEC-007.

**Context.** The owner wants each company to choose its own SMS, WhatsApp and email providers, a platform default, passwordless phone sign-in for staff, and company-required 2FA by SMS or WhatsApp. D-009 designed the general integration platform; doc 10 deferred MFA to TOTP in ENT.

**Decision.** (1) One `messagingChannels` row per company and channel, verified by a successful test send before it is used for codes; credentials AES-256-GCM encrypted in `integrationSecrets` with the key in `INTEGRATIONS_ENCRYPTION_KEY`, decrypted only in actions. (2) A platform default per channel from Convex env, used unless the company opts out. (3) Phone sign-in through a Convex Auth `ConvexCredentials` provider `phone-otp` with our own hashed code table, not the library `Phone` provider, because the latter creates users and accounts before sending and cannot keep unknown numbers indistinguishable. (4) App-level, per-session 2FA enforced in `requireUser` with an `MFA_REQUIRED` code. (5) Rate limits through `@convex-dev/rate-limiter` 0.3.2 (the 0.4 line needs Convex ≥ 1.43).

**Alternatives considered.** Library `Phone` provider with a `createOrUpdateUser` that throws for unknown numbers (rejected: reveals registered numbers, and the callback also governs password sign-up). Storing credentials in channel rows (rejected: dashboard and export readers would see them). Only TOTP for 2FA (deferred: farm staff use basic phones and WhatsApp; SMS/WhatsApp first, TOTP later).

**Consequences.** Design in `docs/architecture/18-messaging-and-verification.md`. Operators must set `INTEGRATIONS_ENCRYPTION_KEY` before companies can save credentials, and keep a platform channel funded if companies rely on it. SMS codes carry SIM-swap risk, accepted for this user base.

## D-019 — Adopt Effect incrementally for integration code, via a thin in-house bridge

**Status.** Accepted — owner request 2026-11-18 ("we will need this https://effect.website/"). Details: `docs/architecture/19-effect-adoption.md`.

**Context.** Upcoming work (messaging providers INT-001, webhooks, automation runs D-008, AI proxy, IoT ingestion) is dominated by outbound calls that need timeouts, retry on transient failures, typed errors and payload validation. Today each call hand-rolls this (or skips it: the AI proxy has no timeout or retry). `effect` 4.1.4 (Nov 2026) bundles typed errors, retry schedules, timeouts, Layers and Schema in one dependency-free package that runs in the Convex default runtime.

**Decision.**
- Add `effect` (^4.1.4). Use it for integrations/providers, webhooks, automation engine runs, the AI proxy, IoT ingestion, and pure domain pipelines only where it removes code.
- Do not use it for simple queries/mutations or React components; no rewrite of existing functions.
- Bridge in-house: `convex/lib/effect.ts` (`runEffect`, `runEffectSync`, `UserFacingError` → `userError`) and `convex/lib/effectHttp.ts` (fetch with timeout, transient-only retry, tagged errors, Schema decoding).
- Deep imports only (`effect/Effect`); the `effect` barrel is banned by ESLint (measured 4x larger esbuild bundles).
- Queries run only pure programs through `runEffectSync` (no Clock/Random/timers).

**Alternatives considered.**
1. Confect (`@confect/*`). Rejected for now: whole-app framework (Effect-defined schema, codegen, own function builders), 10 major versions in 9 months, needs Convex ≥1.48 and Node 24. Re-evaluate when it is stable and we want Effect-defined schemas.
2. No library; keep hand-written retry/timeout helpers. Rejected: the owner asked for Effect, and typed errors + Schema would be re-invented per provider.
3. Effect everywhere (rewrite queries/mutations). Rejected: churn without benefit; plain Convex code is clearer for CRUD.

**Consequences.**
- ~10 kB gzip (runner) to ~30 kB gzip (with Schema + HTTP) added to the Convex bundle; nothing added to the client bundle.
- Contributors learn a second style for integration code; `CLAUDE.md` and doc 19 §7 hold the checklist.
- `@effect/vitest` waits for a vitest 5 upgrade; tests use plain vitest.

