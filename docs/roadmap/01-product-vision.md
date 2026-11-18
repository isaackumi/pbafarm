# 01 — Product Vision

Date: 2026-11-18. Inputs: `docs/MASTER-PROMPT.md` PART 1 and PART 10, discovery docs 01–14, `docs/project-management/DECISION-LOG.md`.

## 1. What the product is today

PBA Farm is a working single-species (tilapia) cage-farm operations app used by one Ghanaian farm business, built over about a year on Next.js 15 Pages Router + Convex (doc 01 §1). It is already multi-tenant in shape (companies with super-admin approval, per-company settings, multiple farm sites) but tenant isolation is enforced by in-memory filtering and has holes (doc 07 §1).

What it does well today (doc 14 §2, rows marked "Implemented and working"):

| Capability | Evidence |
|---|---|
| Multi-cage daily feed + mortality entry in one atomic batch, with "same as yesterday" (~9 taps for 20 cages) and an offline outbox | `components/DailyUploadPage.js`, `convex/dailyRecords.ts:365-442`, doc 11 §4.1 |
| Stocking with batch numbers, approval workflow and farm-rule checks (status, ABW range, capacity, density) | `convex/stocking.ts:224-300`, `convex/lib/farmRules.ts:209-243` |
| Cage-to-cage fish transfers with approval | `convex/fishTransfers.ts` |
| Bi-weekly growth sampling with weighted ABW and per-cycle growth (ABW, biomass, eFCR, SGR, ADG, survival) | `convex/biweeklyRecords.ts`, `convex/lib/growth.ts`, `convex/growth.test.ts` |
| A signed feed ledger with per-site lots, FIFO deduction and a tally check | `convex/lib/feedLedger.ts`, `convex/inventory.ts:478-517`, `convex/siteStock.test.ts` |
| Company settings with draft → publish and server-enforced farm rules | `convex/companies.ts:599-840` |
| Audit log viewer, in-app reminders cron, QR cage labels, AI assistant, dark mode | doc 14 rows 53, 59, 20, 60, 62 |

What blocks it from being the platform the brief describes (doc 14 §3, doc 07, doc 09):

- Access control: deactivation is not enforced, company-less users share one data pool, several cross-tenant write paths (doc 07 X1–X3, V1–V4).
- Stock integrity: fish population is one mutable counter written by twelve code paths; history cannot be rebuilt; one Critical and eight High stock-consistency scenarios (doc 08 §4, doc 09 §5).
- Scale: 57 full-table scans across all tenants on dashboard, report, export and assistant paths (doc 12 §6.1).
- Operations: the only Convex deployment is a dev deployment acting as production, with no documented backups (doc 12 §7–8).
- Scope: cages only (no ponds, tanks, RAS, hatchery, nursery), feed-only inventory, no expenses, English only, no email/SMS (doc 14 §3).

## 2. Who it serves

From MASTER-PROMPT PART 1, ordered by when the roadmap serves them well.

| Segment | What they need first | Served by phase |
|---|---|---|
| Existing customer (Ghana tilapia cage farm, several sites) | Correct fish counts, working offboarding, a real production deployment, reliable offline daily entry | Phase 0 |
| Individual fish farmers / small businesses | Self-service registration, simple setup, phone-first recording, low data usage, local currency | Phases 1, 2, 7 |
| Commercial fish farms (cage and pond) | Multiple sites, granular permissions, batch tracking across units, costing | Phases 1–4, 6, 9 |
| Hatcheries and nurseries | Broodstock, spawning, fingerling batches with lineage into grow-out | Phases 4, 5 |
| Tank and RAS operations | Equipment, water quality time series, sensors | Phases 6, 11 |
| Integrated aquaculture businesses | One engine across hatchery → nursery → grow-out → harvest → sale | Phases 4, 5, 9, 12 |
| Multi-location organizations and enterprise groups | Memberships across organizations, business units, consolidated reporting, SSO | Phases 1, 3, 13, 14 |

The people who enter most records are field staff beside cages and ponds on inexpensive Android phones, in sunlight, with unreliable signal (PART 8). The product succeeds or fails on them.

## 3. Positioning

An organization-centric aquaculture operations system whose core is a trustworthy stock and production ledger. Feed, growth, cost and traceability all derive from that ledger. It is configured per organization (terminology, units, species, fields, workflows) and never forked per customer.

Compared with generic farm or ERP tools, the differentiators are:
1. A production engine that knows cycles, batches, lineage, transfers, grading and partial harvests, with reversal-based corrections (D-004).
2. Field-first capture that works offline and survives retries (D-010).
3. Per-organization configuration of everything that varies between farms (D-007, D-012).

## 4. Principles

These apply to every phase and every PR.

1. **Field-first.** A form that field staff use must be completable one-handed on a cheap phone, offline, in the fewest taps. The current best flow (daily entry, doc 11 §4.1) is the bar. New field forms reuse the shared outbox and idempotency (D-010), never their own.
2. **One production engine.** No module computes fish counts, biomass or FCR on its own. All population changes go through `stockEvents` (D-004); all KPIs come from one growth service (doc 09 §6). Today's twelve writers of `cages.currentCount` are the anti-pattern this principle removes.
3. **Configurable, not forked.** Organization differences live in data (settings, custom fields, terminology, species, size grades, roles), not in code branches or per-customer pages (D-007, D-012). Hard-coded tilapia, GHS, 16:00 UTC and 120-day harvest thresholds (doc 09 X8, doc 12 §6.4) are defects under this principle.
4. **Evolve, do not rewrite.** Extend existing tables with optional fields and backfill (widen → backfill → dual-write → switch reads → narrow, `04-migration-and-compatibility-plan.md`). Keep `companies`, `cages`, `farmLocations` and the feed ledger (D-001–D-003).
5. **Tenant isolation is structural.** Reads go through company-prefixed indexes; every referenced id is ownership-checked; one guard decides access (D-005, D-006).
6. **History is append-only.** Corrections are reversal events. The feed ledger already works this way; fish stock must too.
7. **Done means verified.** A feature is done when it has tests (including negative tenant tests), passes CI gates and is verified in staging (PART 16, `05-testing-and-quality-plan.md`).

## 5. What success looks like

Measured against what exists today. Targets are proposals for the owner to confirm.

| Area | Today (evidence) | Success |
|---|---|---|
| Access | Deactivated users keep access for up to 30 days per session (doc 07 X1) | A deactivated user or removed organization loses access on the next request; covered by tests |
| Tenant isolation | 1 negative cross-tenant test (`convex/harvest.test.ts:125`) | Every public function has an automated cross-tenant and role-refusal test |
| Stock correctness | Count cannot be rebuilt; 16 failure scenarios (doc 09 §5) | `cages.currentCount` equals Σ `stockEvents` for every unit, checked nightly; all 16 scenarios have regression tests |
| Scale | Dashboard reads every tenant's `dailyRecords` (doc 12 §6.1) | No user-facing query reads outside its company; dashboard reads O(units) rollup rows |
| Operations | Dev deployment as production; no backups documented | Separate prod and staging; monthly restore drill recorded |
| Field use | Offline cold start likely blocked; only daily entry has an outbox (doc 11 §10) | Every field form records offline and syncs once, with no duplicates |
| Scope | Cages only, feed only, English, GHS/USD/EUR | Ponds, tanks/RAS, hatchery and nursery on the same engine; non-feed inventory and expenses; per-organization currency/timezone/units/species |
| Adoption | One organization | Pilot farms beyond the first customer onboard without code changes (`06-release-strategy.md` §6) |

## 6. Non-goals for now

- No App Router or database migration (D-001).
- No native mobile app (D-010); PWA first.
- No i18n library until a non-English locale is committed (D-012).
- No microservices; candidate external services (analytics warehouse, IoT gateway) only with a justification recorded in the decision log.
- No AI features beyond hardening the existing read-only assistant until the production engine and rollups exist (Phase 13).
