# Master Tracker

Last updated: 2026-11-18. Owner approval of the roadmap: **pending** (MASTER-PROMPT PART 16). No item below is "In progress".

**Statuses** (PART 15): Not started · Investigating · Designed · Ready for implementation · In progress · Implemented · Testing · Verified · Blocked.
- *Ready for implementation* = fully specified in `docs/roadmap/03-development-roadmap.md` (files, fix, tests, acceptance, rollback) and not waiting on an owner answer.
- *Designed* = approach decided (decision log / roadmap) but details or owner answers outstanding.
- *Testing* = code exists on a branch or `main` but has not been verified in staging.

**Priority:** P0 Phase 0 stabilize · P1 foundational · P2 core enhancement · P3 later.

**ID scheme:** `SEC, OPS, PLAT, PROD, ORG, FARM, PERM, HAT, NUR, CAGE, POND, RAS, MOBILE, CUSTOM, INV, AUTO, INT, TRACE, ANLY, ENT, UX, I18N` + 3 digits. IDs `9xx` track work already shipped in PRs #7–#14.

**Doc shorthand:** `dNN` = `docs/discovery/NN-*.md`; `R03` = `docs/roadmap/03-development-roadmap.md`; `R04` migration plan; `R05` testing plan; `R06` release strategy; `A0N` = `docs/architecture/0N-*.md`; `D-0NN` = decision log.

**Testing status vocabulary:** None · Regression test specified · Partial (existing tests) · Covered.

---

## Shipped work from PRs #7–#14 (tracked until verified)

Verified state on GitHub, 2026-11-18: #7, #8, #13 merged to `main` (carrying #9–#12) and deployed to `vibrant-stork-860`; #14 merged into `feat/per-site-stock` after #13 merged, so it is **not on `main`** (R03 §0.1).

| ID | Feature | Description | Priority | Dependencies | Status | Docs | Source files | Testing status | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| PROD-901 | PR #7 Daily records view/edit/delete | `/daily-data` lists records 7/30/90 days, edit sheet, admin delete, CSV export; `dailyRecords.list` bounded indexed reads | P1 | PROD-000c (S8 guard) | Testing | R03 §0.1, d09 S8 | `pages/daily-data.js`, `lib/databaseService.js:109-180`, `convex/dailyRecords.ts`, `components/Sidebar.js`, `components/Layout.js` | None (no test in PR) | Edits change only the edited record's cycle; delete restores feed and fish within the same cycle; verified in staging |
| PROD-902 | PR #8 Harvest closes the cage and cycle | Complete harvest zeroes cage, sets `harvested`, closes stocking; undo on edit/delete | P1 | PROD-000a, PROD-000b | Testing | d08 §8, d09 S5, S6 | `convex/harvest.ts:107-345` | Partial (`convex/harvest.test.ts`, 4 tests; S5/S6 not covered) | S5 and S6 regression tests pass |
| ANLY-901 | PR #9 Growth metrics | eFCR, SGR, ADG, biomass, survival per cycle; cage ABW sync | P1 | PROD-000f | Testing | d09 §2.1 | `convex/lib/growth.ts`, `convex/cages.ts:115-158`, `pages/cages/[id].js` | Partial (`convex/growth.test.ts`) | ABW resets on restock; figures match KPI service later (PROD-008) |
| INV-901 | PR #10 Real feed and inventory KPIs | Replace placeholder numbers on feed/inventory pages | P2 | PLAT-001 | Testing | d14 rows 43–45 | `pages/feed-management/overview.js`, `pages/inventory/*.js`, `pages/feed-purchases.js` | None | Numbers equal ledger totals for the selected site |
| AUTO-901 | PR #11 Daily reminders | 16:00 UTC cron: missed entries, low stock; dedupe | P1 | PLAT-001 (fan-out), AUTO-007 | Testing | d13 §5, d12 §6.2 | `convex/reminders.ts`, `convex/crons.ts`, `convex/notifications.ts` | Partial (`convex/reminders.test.ts`, 3 tests) | Correct per company regardless of other tenants' volume |
| INV-902 | PR #12 Per-site feed stock | Feed deductions limited to the cage site's stock (+ unassigned) | P1 | — | Testing | d08 §6.2 | `convex/lib/feedLedger.ts:90-106`, `convex/inventory.ts:111-115` | Partial (`convex/siteStock.test.ts`, 5 tests) | Existing daily entries at sites without stock fail with a clear message; staging check with prod data copy |
| PROD-903 | PR #13 Combined: per-site stock, reminders, optional harvest grades | Merged #10–#12 to `main`, plus optional size grades and notification click navigation | P1 | INV-902, AUTO-901 | Testing | PR #13 body | `components/HarvestForm.js`, `components/Header.js` | Partial (17 tests total) | Harvest saves with blank grades; totals derived correctly |
| UX-901 | PR #14 UI consistency | Remaining pages on the shared design system (51 UI files, no `convex/` changes) | P2 | OPS-000 (re-land) | Testing (not on `main`) | R03 §0.1 | 51 files under `pages/`, `components/` (commit `89d4f9d`) | None | Re-landed on `main` via a new PR; `next build` green; visual check of key pages |

## Phase 0 — Stabilize

| ID | Feature | Description | Priority | Dependencies | Status | Docs | Source files | Testing status | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| OPS-000 | PR reconciliation + live hotfix sequencing | Freeze `convex/**` merges; hotfix S5/S6/S8; re-land #14; confirm deployed code = `main` | P0 | — | Ready for implementation | R03 §0.1, R06 §4 | `.github/workflows/convex-deploy.yml` | n/a | #14 on `main`; deploy history matches `main`; hotfixes deployed |
| SEC-001 | Enforce active user, company status; remove shared pool | `requireUser` rejects inactive users, unapproved companies, `mustChangePassword`; deactivate revokes sessions; company-less users get no tenant data | P0 | OPS-002, M1 pre-flight | Ready for implementation | d07 X1–X3, V5; d04 F1; R03 §0.2; R04 M1; D-005 | `convex/lib/authz.ts`, `convex/lib/tenancy.ts`, `convex/users.ts`, `convex/companies.ts`, `pages/_app.js`, `contexts/AuthContext.js` | Regression test specified | Deactivated user refused on next call; rejected company refused; new sign-up sees no data; approved users unaffected |
| SEC-002 | Close cross-tenant and role gaps | `backfillLocations`, `seedDemo`, `notifications.create*` → internal; ownership checks on foreign ids; admin gates for high-risk writes; admin-only UI parity; per-company batch codes | P0 | SEC-001 | Ready for implementation | d07 V1, V4, V6, V7, V9, V11, V14, V15; d04 F2, F3; d02 KF2; R03 §0.3 | `convex/farmLocations.ts`, `convex/seed.ts`, `convex/notifications.ts`, `convex/dailyRecords.ts`, `convex/lib/feedLedger.ts`, `convex/feed.ts`, `convex/harvest.ts`, `convex/sales.ts`, `convex/inventory.ts`, `convex/companies.ts`, `convex/biweeklyRecords.ts`, `convex/users.ts`, pages listed in R03 §0.3 | Regression test specified | No public mutation accepts another company's id; buttons match permissions |
| SEC-003 | Invitation takeover and super-admin protection | Invites never mutate existing accounts; no auto-claim; join requests approved by admin; one invite per company+email; audit | P0 | SEC-001 | Ready for implementation | d07 V2, V3, V6, V13; R03 §0.4 | `convex/users.ts:136-271`, `contexts/AuthContext.js:30-33`, `components/UserManagement.js` | Regression test specified | V2 and V13 scenarios refused |
| PROD-000 | Stock-integrity fixes with regression tests (umbrella) | Sub-items a–i below | P0 | OPS-002 | Ready for implementation (a–f, i); Blocked (g, h) | d08 §§3–9; d09 §5; R03 §0.5 | see sub-items | Regression test specified | Each scenario test fails on `main`, passes after |
| PROD-000a | S5: harvest edit after restock wipes new cycle | Refuse count/type edits on superseded cycles; close the stocking open on the harvest date; reopen only if cage still harvested | P0 | OPS-000 | Ready for implementation | d09 S5 | `convex/harvest.ts:132-187,263-315`, `pages/harvest.js` | Regression test specified | S5 test passes; new cycle untouched |
| PROD-000b | S6: partial-harvest delete adds fish to later cycle | Refuse undo when a later stocking/complete harvest exists | P0 | PROD-000a | Ready for implementation | d09 S6 | `convex/harvest.ts:183-185,317-345` | Regression test specified | S6 test passes |
| PROD-000c | S8: daily-record edits move current count across cycles | Refuse mortality edits for records before current stocking or on harvested/empty cages | P0 | — | Ready for implementation | d09 S8; PR #7 | `convex/dailyRecords.ts:444-580`, `pages/daily-data.js` | Regression test specified | S8 test passes; UI shows reason |
| PROD-000d | S2/S3: transfer-linked approvals double count | Refuse direct approval of linked rows; `applyFishTransfer` adds only if linked row was pending | P0 | M8 indexes | Ready for implementation | d09 S2, S3; d07 V8; d04 F10 | `convex/stocking.ts:385-427,552-595`, `convex/fishTransfers.ts:63-121,409-465`, `pages/stocking/[id]/details.js`, `pages/topup/[id]/details.js` | Regression test specified | Fish added exactly once in every approval order |
| PROD-000e | S9: second stocking approval overwrites count | Re-run `assertStockingAllowed` at approval; refuse if another approved open stocking | P0 | — | Ready for implementation | d09 S9 | `convex/stocking.ts:385-427`, `convex/lib/farmRules.ts:209-243` | Regression test specified | Second approval refused |
| PROD-000f | S7: ABW not reset on restock | Set `currentWeight = initialAbw` on stocking apply; growth ignores out-of-cycle ABW; M0-b repair | P0 | — | Ready for implementation | d09 S7; R04 M0-b | `convex/stocking.ts:278-286,410-418`, `convex/fishTransfers.ts:90-98`, `convex/lib/growth.ts:78` | Regression test specified | New cycle shows stocking ABW until first sample |
| PROD-000g | S12: `/harvest-sampling` writes fake complete harvests | Interim: write sampling rows only; tag existing rows (M0-c) and exclude from KPIs; final per owner answer | P0 | Q-005 | Blocked | d09 S12; d04 F9; d02 KF1; R04 M0-c | `convex/harvest.ts:386-450`, `pages/harvest-sampling.js` | Regression test specified | No new fake harvests; KPIs exclude tagged rows |
| PROD-000h | S14: feed issue + daily entry double deduction | Interim: second deduction for same cage/date refused unless admin override; final per owner answer | P0 | Q-003 | Blocked | d09 S14; d02 KF7; d11 §11 risk 5 | `convex/feed.ts:609-720`, `convex/dailyRecords.ts:37-82`, `pages/feed-issue.js` | Regression test specified | One deduction per feeding |
| PROD-000i | S13: repeatable / unlinked feed reversals | Refuse second reversal; refuse reversing `daily_usage` rows | P0 | — | Ready for implementation | d09 S13 | `convex/inventory.ts:352-394` | Regression test specified | Second reversal refused; tally stays OK |
| OPS-001 | Prod + staging, backups, errors, monitoring | New Convex prod/staging; data move from `vibrant-stork-860`; restore drill; `ConvexError`; error boundary; monitoring; gated deploys | P0 | Q-002, Q-012, Q-032 | Designed | d12 §5b–8; d01 R1; D-011; R03 §0.6; R06 §2–3 | `.github/workflows/convex-deploy.yml`, `pages/_app.js`, `components/Dashboard.js`, `lib/offlineOutbox.js`, `convex/lib/feedLedger.ts`, `convex/dailyRecords.ts` | None | Prod and staging live; restore drill recorded; validation messages visible in prod; boundary catches render errors |
| OPS-002 | CI gates | Recursive vitest include; source-only gating lint; typecheck incl. tests; tests before Convex deploy; Node 22 | P0 | — | Ready for implementation | d12 §2–4, §7; R05 §8 | `vitest.config.mjs`, `eslint.config.mjs`, `.github/workflows/ci.yml`, `.github/workflows/convex-deploy.yml`, `convex/tsconfig.json` | n/a | `fishTransferLogic.test.ts` runs; a lint/type/test failure blocks merge and deploy |
| OPS-003 | Dependency security patches | `@auth/core` 0.41.3; Next 15.x patch; delete dead `BulkUploadModal` (`xlsx` parse path) | P2 | OPS-002 | Ready for implementation | d12 §5.6; d01 §7 | `package.json`, `components/BulkUploadModal.js` | Partial | `npm audit` critical count reduced; build green |
| PLAT-001 | Company-indexed paginated reads | Replace 57 full scans and truncated cross-tenant windows; per-company cron fan-out; pagination on list pages | P0 | M8 indexes; coordinate with SEC-002 | Designed | d12 §6.1–6.2; d04 F7, F8, F14, F18, F22; D-006; R03 §0.8 | `convex/reports.ts` (22 scans), `convex/farmLocations.ts`, `convex/feed.ts`, `convex/inventory.ts`, `convex/stocking.ts`, `convex/reminders.ts`, `convex/crons.ts`, + 10 modules | Regression test specified (`convex/scale.test.ts`) | No user-facing scan outside the company; reminders unaffected by other tenants' data |
| MOBILE-001 | Offline-safe shell and per-user offline data | Cold start offline from cache; outbox and caches namespaced per user; clear on sign-out | P0 | Q-017 | Designed | d11 §10 #1, #3; d12 §5.2; D-010; R03 §0.9 | `pages/_app.js`, `components/ProtectedRoute.js`, `contexts/AuthContext.js`, `lib/offlineOutbox.js`, `hooks/usePersistedForm.js`, `store/index.js` | None | Offline cold start reaches daily entry; user B never flushes user A's queue |
| SEC-004 | LLM proxy and small security fixes | Rate limit, model allow-list, size cap, role gate on `/api/llm/chat`; `?next=//` open redirect; pasted LLM keys not kept in plaintext | P2 | Q-029 | Designed | d07 V10, V16; d12 §5.1, §5.4; d13 §11 | `pages/api/llm/chat.js`, `lib/llmClient.js`, `lib/llmEnv.js`, `pages/login.js` | None | Abuse limits enforced; `//evil` rejected |

## Phase 1 — Organization and multi-tenancy

| ID | Feature | Description | Priority | Dependencies | Status | Docs | Source files | Testing status | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| ORG-001 | Memberships | `memberships` table; user in several orgs; `users.companyId` = active pointer | P1 | SEC-001, PLAT-004, OPS-001 | Designed | D-002; R04 M2; A03, A04 | `convex/schema.ts`, `convex/lib/authz.ts`, `convex/users.ts` | None | Every user has a membership matching old data; switching orgs isolates data |
| ORG-002 | Organization switcher | Header switcher, active org change audited | P1 | ORG-001 | Not started | R03 Phase 1 | `components/Header.js`, `contexts/AuthContext.js` | None | User in two orgs switches without sign-out |
| ORG-003 | Safe invitations | Signed expiring single-use tokens, acceptance page, list/revoke | P1 | ORG-001, SEC-005 | Designed | d07 §3.5; R03 Phase 1 | `convex/users.ts`, new `pages/invite/[token].js` | None | Expired/reused token refused; invitee accepts explicitly |
| ORG-004 | Self-service onboarding | Sign-up → register org → pending status page; submitter sees registration status | P1 | SEC-001 | Not started | d07 §2.2 | `pages/signup.js`, `pages/register-company.js`, `pages/pending-approval.js`, `convex/companies.ts` | None | New user reaches registration without typing a URL |
| ORG-005 | Organization profile | Country, timezone, unit system, locale on `companies` | P1 | — | Designed | R04 M3; D-012 | `convex/schema.ts`, `pages/company-settings.js` | None | Profile editable; defaults applied to existing org after owner confirmation |
| ORG-006 | Super-admin console fixes | Remove links to missing routes; correct "Delete" semantics; audited act-as | P2 | PERM-002 | Not started | d02 KF6; d07 §3.8 | `pages/admin/admin.js` | None | No 404 links; platform actions appear in tenant audit |
| ORG-007 | Legacy unscoped data resolution | Execute M1 decisions; then M10 narrow | P1 | SEC-001 pre-flight | Designed | R04 M1, M10 | `convex/lib/tenancy.ts` | None | P1 pre-flight returns zero |
| ORG-008 | Audit coverage | Audit the 10 unaudited mutations + internal ones; tenant-visible platform actions | P2 | — | Not started | d04 F20; d06 §3 | `convex/users.ts`, `convex/companies.ts`, `convex/farmLocations.ts`, `convex/dailyRecords.ts` | None | Every public mutation writes an audit row |
| SEC-005 | Password reset and email verification | Convex Auth `reset`/`verify`; pages that `_app.js` already lists | P1 | INT-002 (email slice) | Designed | d07 §2.1; d13 §2 | `convex/auth.ts`, new `pages/reset-password.js`, `pages/verify-email.js` | None | User resets password by email; invites require verified email |
| PLAT-004 | Migration framework | Batched, resumable, idempotent migrations + `migrationLog` | P1 | OPS-001 | Designed | R04 §1 | new `convex/migrations/*` | None | A migration resumes after interruption with identical results |

## Phase 2 — Farms, locations and hierarchy

| ID | Feature | Description | Priority | Dependencies | Status | Docs | Source files | Testing status | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| FARM-001 | Site metadata | `siteType`, `timezone`, coordinates, `waterBody` on `farmLocations` | P1 | — | Designed | D-003; R04 M5 | `convex/farmLocations.ts`, `pages/farm-locations.js` | None | Site timezone drives "today" |
| FARM-002 | Production unit types | `unitType` + typed dimensions on `cages`; terminology by type | P1 | — | Designed | D-003; R04 M4 | `convex/schema.ts`, `convex/cages.ts`, `components/CageManageModals.js`, `pages/create-cage.js` | None | A pond can be created and used in daily entry |
| FARM-003 | Active site honoured everywhere | Inventory, export, feed overview and alerts pages pass `locationId` | P1 | PLAT-001 | Not started | d02 KF12 | `pages/stock-levels.js`, `pages/inventory/*.js`, `pages/inventory-alerts.js`, `pages/export.js`, `pages/feed-management/overview.js` | None | Every page reflects the header site |
| I18N-001 | Formatting and date helpers | Money/number/date-in-timezone/unit helpers; one day-count convention | P1 | ORG-005, FARM-001 | Designed | D-012; d09 X7; d12 §6.4 | `lib/money.js`, `lib/currencyUtils.js`, `hooks/useCurrency.js`, new `convex/lib/dates.ts`, `lib/format.js` | None | DOC identical on all screens; entries land on the local date |
| FARM-004 | Business units / regions | Optional grouping between org and site | P3 | ENT-001 | Not started | D-003 | — | None | Sites grouped; reports filter by group |

## Phase 3 — Permissions

| ID | Feature | Description | Priority | Dependencies | Status | Docs | Source files | Testing status | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| PERM-001 | Permission catalog + role templates | owner, admin, manager, field_staff, viewer | P1 | ORG-001, Q-010 | Designed | D-005; A10 | new `convex/lib/permissions.ts` | None | Catalog covers every public function |
| PERM-002 | Central guard `requireMember` | Replace `requireUser`/`requireRole`/`listForCompany` in 142 functions; shadow mode first | P1 | PERM-001 | Designed | D-005; R04 M9 | all `convex/*.ts` | None | Authz matrix test complete and green |
| PERM-003 | Custom roles UI | Org-defined roles in `/users` | P2 | PERM-002 | Not started | R03 Phase 3 | `components/UserManagement.js` | None | Admin creates a role and assigns it |
| PERM-004 | Site-scoped access | `memberships.locationScope` enforced on reads and writes | P1 | ORG-001, FARM-003 | Designed | d07 §3.3; d04 F17 | `convex/lib/tenancy.ts` | None | Field user of site A cannot read site B |
| PERM-005 | Segregation of duties | Approver ≠ creator (configurable) for stocking/top-up/transfer | P2 | PERM-002 | Not started | d07 §3.7 | `convex/stocking.ts`, `convex/fishTransfers.ts` | None | Self-approval refused when enabled |
| UX-007 | Permission-aware UI | `usePermission` hook drives Sidebar, tab bar and buttons | P1 | PERM-002 | Not started | d02 §15 | `components/Sidebar.js`, `components/MobileTabBar.js`, `components/ProtectedRoute.js` | None | No visible action fails with "Insufficient permissions" |

## Phase 4 — Production engine

| ID | Feature | Description | Priority | Dependencies | Status | Docs | Source files | Testing status | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| PROD-001 | Batches | `batches` with lineage; backfill from `stockingHistory` | P1 | PROD-000, PLAT-004, FARM-002 | In progress (table, `openBatch`, `lineage` implemented; M6 backfill next) | D-004; R04 M6; A05 | `convex/schema.ts`, `convex/lib/productionEngine.ts` | Covered (`convex/productionEngine.test.ts` 7.3 lineage) | Every approved stocking has a batch; transfer lineage present |
| PROD-002 | Stock event ledger + engine | `stockEvents`; `convex/lib/productionEngine.ts` sole writer | P1 | PROD-001 | Implemented (stockIn, recordMortality, multi-destination transfer, partial/complete harvest with close-out, gradingSplit, merge, adjustCount, reverse, reverseOperation; strict and shadow modes) | D-004; R04 M7; A05 | `convex/lib/productionEngine.ts`, `convex/schema.ts` | Covered (`convex/productionEngine.test.ts`: doc 05 §7.1–7.8 and I1, I2, I3, I4, I6, I9, I10; `convex/productionEngine.property.test.ts`: conservation, Σ events = cage cache, reversal idempotence, no cross-cycle effects) | Invariants I1–I5 hold (R05 §5) |
| PROD-003 | Historical backfill + reconciliation | M7 steps 3–5 with owner-reviewed adjustments | P1 | PROD-002 | Designed | R04 M7 | new `convex/migrations/m7_stockEvents.ts` | None | Σ events = `currentCount` for all units |
| PROD-004 | Route writers through the engine | 12 writers (d08 §4) call the engine; dual-write then switch | P1 | PROD-003 | Designed | d08 §4 | `convex/stocking.ts`, `convex/dailyRecords.ts`, `convex/harvest.ts`, `convex/fishTransfers.ts`, `convex/cages.ts` | None | No direct `currentCount` patch outside the engine |
| PROD-005 | Reconciliation job and physical counts | Nightly Σ vs cache; count adjustment workflow | P1 | PROD-002 | Not started | d08 §15 | new `convex/reconciliation.ts` | None | Zero unexplained mismatches for 14 days |
| PROD-006 | Split, merge, multi-destination transfers | `grading_split`, `merge`, atomic multi-destination transfer | P1 | PROD-004 | Not started | d08 §9 | `convex/fishTransfers.ts`, `components/FishTransferForm.js` | None | One transfer to three units conserves fish |
| PROD-007 | Corrections by reversal | Reverse any event incl. approved transfers (S1) | P1 | PROD-002 | In progress (engine `reverse` / `reverseOperation` implemented; transfer reversal endpoint next) | d09 S1 | `convex/lib/productionEngine.ts` | Covered (engine: 7.1 transfer reversal, I6 idempotence) | Approved transfer reversible; history kept |
| PROD-008 | One KPI service | One definition each of FCR, survival, mortality %, growth/day, DOC | P1 | PROD-004, I18N-001 | In progress (`convex/lib/kpi.ts` with eFCR, biological and pooled FCR, survival, cumulative/daily/period mortality, ADG/SGR, sample growth/day, DOC, `occupancyKpis`; `growth.ts` formulas re-exported from it; screens switch in the UI PR) | d09 §3, §6 | `convex/lib/kpi.ts`, `convex/lib/growth.ts`, `convex/reports.ts`, `components/Dashboard.js`, `pages/report.js` | Covered (`convex/lib/kpi.test.ts`) | Same figure on every screen (I9) |
| PROD-009 | Harvest FCR computed and stored | Computed with inputs; recomputed on upstream edits | P1 | PROD-008 | Not started | d09 §2.2 | `convex/harvest.ts`, `components/HarvestForm.js` | None | No typed FCR; partial harvests handled |
| PROD-010 | Species and size grades configuration | Per-org species (with parameters) and grade masters | P2 | M19 | Not started | d08 §1, §8; D-012 | `lib/fishSpecies.js`, `components/HarvestForm.js` | None | Org adds a species and grades without code |
| PROD-011 | Cycle-scoped records | `batchId` on operational records (M11) | P1 | PROD-001 | Designed | R04 M11 | `convex/dailyRecords.ts`, `convex/biweeklyRecords.ts`, `convex/harvest.ts` | None | Cycle KPIs no longer use date windows |
| PROD-012 | Withdrawal-period enforcement | Warn/block harvest and sale inside withdrawal | P1 | M8 index | Not started | d02 KF8; d14 row 38 | `convex/harvest.ts`, `convex/sales.ts`, `convex/health.ts` | None | Harvest in withdrawal blocked unless overridden with reason |
| PROD-013 | Unit status state machine; no hard delete | Allowed transitions; archive instead of `cages.remove` hard delete | P1 | PROD-004 | Not started | d08 §2; d04 F11 | `convex/cages.ts` | None | Invalid transition refused; no orphans |
| PLAT-002 | Rollup tables | `unitDailyStats`, `batchStats`, `siteDailyStats` maintained on write | P1 | PROD-004 | Designed | D-006; R04 §5 | new `convex/rollups.ts` | None | Dashboard reads O(units) rows |

## Phase 5 — Hatchery and nursery

| ID | Feature | Description | Priority | Dependencies | Status | Docs | Source files | Testing status | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| HAT-001 | Broodstock registry | Individuals/groups on broodstock units | P2 | FARM-002 | Not started | R03 Phase 5 | new `convex/hatchery.ts` | None | Broodstock listed per unit |
| HAT-002 | Spawning, incubation, hatching | Events producing hatched batches | P2 | PROD-002, HAT-001 | Not started | R03 Phase 5 | new | None | Hatch creates a batch with lineage |
| HAT-003 | Larval rearing and live feed | Daily records on hatchery tanks; live feed log | P3 | HAT-002, INV-001 | Not started | — | new | None | Larval mortality/feeding recorded |
| HAT-004 | Fingerling output and nursery transfer | Transfer to nursery units via engine | P2 | PROD-006 | Not started | — | — | None | Lineage visible from grow-out |
| NUR-001 | Nursery workspace and grading | Receiving, acclimatization checklist, grading splits | P2 | PROD-006 | Not started | — | new `pages/nursery/*` | None | Grading conserves fish |
| NUR-002 | Fingerling sales by count | `sales` by unit count | P3 | INV-009 | Not started | d08 §10 | `convex/sales.ts` | None | Sale by count reduces batch |

## Phase 6 — Cage, pond and tank

| ID | Feature | Description | Priority | Dependencies | Status | Docs | Source files | Testing status | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| CAGE-001 | Cage workspace | Groups, GPS, dimensions, per-cage tabs | P2 | FARM-002 | Not started | — | `pages/cages/[id].js` | None | Cage page shows type-specific tabs |
| CAGE-002 | Net inspection and maintenance log | Inspections, repairs, next due | P2 | CAGE-001 | Not started | d04 §3.6 | new `convex/inspections.ts` | None | Overdue inspection visible |
| POND-001 | Pond profiles | Area, depth, capacity | P2 | FARM-002 | Not started | — | — | None | Pond density uses area |
| POND-002 | Water management and treatments | Fill/drain/exchange events; treatments per pond | P2 | POND-001 | Not started | d14 row 37 | `convex/health.ts` | None | Treatment recorded per pond |
| RAS-001 | Tanks and raceways | Unit types with volume, flow | P2 | FARM-002 | Not started | — | — | None | Tank density uses volume |
| RAS-002 | Equipment registry | Pumps, blowers, biofilters, status | P3 | RAS-001 | Not started | — | new `convex/equipment.ts` | None | Equipment linked to units |
| PROD-014 | Water quality module | Readings table, parameters, thresholds, charts, alerts; backfill M15 | P2 | FARM-002 | Not started | d02 KF10; R04 M15 | `convex/dailyRecords.ts`, `convex/biweeklyRecords.ts` | None | DO chart per unit; threshold alert |

## Phase 7 — Mobile and offline

| ID | Feature | Description | Priority | Dependencies | Status | Docs | Source files | Testing status | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| MOBILE-002 | Generalized outbox + server idempotency | `clientMutationId`; all field forms offline | P1 | MOBILE-001 | Designed | D-010; R04 M13 | `lib/offlineOutbox.js`, field forms | None | Replays never double-write |
| MOBILE-003 | Offline reference data cache | Cages, feed types, species cached per user | P1 | MOBILE-001 | Not started | d13 §16 (e) | `components/DailyUploadPage.js:98-140` | None | Cold start offline can pick cages |
| MOBILE-004 | Daily entry ergonomics | Sticky save; blank feed ≠ 0; compact cards | P2 | Q-016 | Implemented (PR feat/mobile-002: compact lines, sticky save above tab bar, blank feed asks before saving 0 kg) | d11 §10 #4 | `components/DailyUploadPage.js` | None | 20 cages logged without scrolling to find Save |
| MOBILE-005 | Bi-weekly batch flow and deep link | Multi-cage sampling; `?cage=` honoured | P2 | — | Implemented (`biweeklyRecords.createBatch`, `components/BiweeklyBatchEntry.js`, `?cage=`/`?cages=`; tests `convex/biweeklyBatch.test.ts`) | d11 §10 #5 | `pages/biweekly-entry.js`, `components/BiweeklyEntryForm.js` | None | Sampling from cage page pre-selects cage |
| MOBILE-006 | In-app QR scanner, stable short codes | Scanner; codes independent of origin/id; old labels still work | P2 | Q-019 | In progress (in-app scanner `components/QrScanner.js` + `/scan`, origin-independent label parsing `lib/qrTarget.js` with tests; stable short codes not started) | d13 §17–18 | `pages/cages/qr-codes.js` | None | Scan opens the cage in the PWA |
| MOBILE-007 | PWA hygiene | PNG icons, SW versioning/pruning, update prompt, self-hosted fonts | P2 | — | Not started | d13 §15; d01 §8 | `public/sw.js`, `public/manifest.webmanifest`, `pages/_document.js` | None | Installable on Android; cache bounded |
| MOBILE-008 | Bundle diet | Lazy recharts, dynamic `xlsx`, lazy tours | P2 | — | In progress (recharts lazy on Home and Cages: 184/187 kB first load; tours lazy; `xlsx` not yet) | d12 §1 | `pages/export.js`, chart pages, `pages/_app.js` | None | Daily entry first load ≤ 200 kB |
| MOBILE-009 | Robust CSV import | Proper parser, row-level report, same rules as interactive entry | P2 | SEC-002 | Not started | d13 §19–21; d02 KF11 | `components/BulkDailyUploadForm.js`, `components/BulkBiweeklyUploadForm.js`, `convex/dailyRecords.ts:581-645` | None | Quoted fields parse; skipped rows reported |
| UX-001 | Loading, error, empty states | Consistent states; no silent `.catch(() => null)` | P2 | OPS-001 | Not started | d10 §10 | `components/Dashboard.js` and pages | None | Every list has empty/error state |
| UX-002 | Converge data transport | Path B services → `useQuery`; retire Redux-persist server cache | P2 | — | Not started | d01 §2; d10 §13 | `lib/*Service.js`, `store/*` | None | Screens update live; no `persist:root` server data |
| UX-003 | Accessibility of modals and forms | Labels (`htmlFor`), focus trap, keyboard | P2 | — | Not started | d10 §11 | `components/QuickCreateModals.js`, forms | None | WCAG 2.2 AA on field forms |
| UX-004 | Configurable navigation | Shorter drawer; configurable bottom bar | P2 | PERM-002 | Not started | d11 §10 #7 | `components/Sidebar.js`, `components/MobileTabBar.js` | None | Field user reaches daily, sampling, harvest in one tap |
| UX-005 | Dead code removal | 5 dead components, 3 services, hook, 2 contexts, slice, stubs, Supabase SQL | P3 | Q-028 | Not started | d01 §10.7; d10 §8 | listed in d01 §3 | n/a | Build size reduced; no imports broken |
| UX-006 | Outdoor legibility | Higher-contrast borders, larger helper text, outdoor theme | P2 | — | Not started | d11 §10 #8 | `styles/theme.css` | None | Border contrast ≥ 3:1 |

## Phase 8 — Customization

| ID | Feature | Description | Priority | Dependencies | Status | Docs | Source files | Testing status | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| CUSTOM-001 | Custom field engine | `customFieldDefs` + validated `custom` values | P2 | PERM-002 | Designed | D-007; A06 | new `convex/lib/customFields.ts` | None | Required custom field enforced server-side |
| CUSTOM-002 | Field builder UI | Define, order, archive fields | P2 | CUSTOM-001 | Not started | — | new `pages/settings/fields.js` | None | Admin adds a field without code |
| CUSTOM-003 | Terminology overrides | Org/unit-type labels | P2 | FARM-002 | Not started | D-003 | new `hooks/useTerm.js` | None | "Pond" shown for pond units |
| CUSTOM-004 | Form layouts | Ordered sections, conditional fields | P3 | CUSTOM-001 | Not started | — | — | None | Layout applies on mobile |
| CUSTOM-005 | Dashboard layouts | Widget grid over rollups | P3 | PLAT-002 | Not started | — | `components/Dashboard.js` | None | Org saves a dashboard |
| CUSTOM-006 | Branding and themes | Keep existing; contrast checks | P3 | — | Not started | d14 row 11 | `contexts/CompanySettingsContext.js` | Partial | — |
| CUSTOM-007 | User preferences per user | Move `SettingsContext` from browser to user | P3 | — | Not started | d01 §3 | `contexts/SettingsContext.js` | None | Preferences follow the user |

## Phase 9 — Inventory, procurement, costing

| ID | Feature | Description | Priority | Dependencies | Status | Docs | Source files | Testing status | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| INV-001 | Generic inventory items | Drugs, chemicals, nets, fuel, spares alongside feed | P2 | — | Not started | d14 §3 | `convex/inventory.ts`, `convex/feed.ts` | None | Non-feed item stocked and issued |
| INV-002 | Site on every movement; two-legged transfers | M16 | P1 | PROD-000i | Designed | d08 §6.3; d09 S15; R04 M16 | `convex/lib/feedLedger.ts`, `convex/inventory.ts:249-349`, `convex/feed.ts:449-573` | Partial | Per-site ledger = lots |
| INV-003 | Reversal linkage | Reversals linked to source records; usage rows consistent | P1 | INV-002 | Not started | d04 F5 | `convex/inventory.ts`, `convex/dailyRecords.ts:89-145` | None | `listUsage` matches ledger |
| INV-004 | Procurement / purchase orders | PO → receipt → lot | P3 | INV-001 | Not started | — | new `convex/procurement.ts` | None | Receipt creates lot |
| INV-005 | Suppliers for all items | Extend `feedSuppliers` | P3 | INV-001 | Not started | — | `convex/feed.ts` | None | — |
| INV-006 | Lot costing | FIFO / weighted average from purchase prices | P2 | INV-002, Q-015 | Implemented (weighted average, reports only) | d09 §2.5 | `convex/lib/costing.ts` (weighted average of the feed type's purchases up to the feeding day; list price only when nothing was bought). Daily records still store list price; FIFO lot `unitCost` not done | Covered (`convex/expenses.test.ts`: costing helpers, P&L feed at purchase price) | Daily feed cost = lot cost |
| INV-007 | Expenses | Categories, cost centres (site/unit/batch) | P2 | PROD-001 | Implemented | d08 §14 | `convex/expenses.ts`, `convex/schema.ts` (`expenses`, `expenseCategories`), `pages/expenses.js` | Covered (`convex/expenses.test.ts`: roles, cross-tenant, custom categories, filters/totals) | Expense attributed to batch (cycle = `stockingHistory` row until PROD-001 `batches`; attachments later) |
| INV-008 | Batch costing and cost per kg | Feed + fingerlings + expenses per batch | P2 | INV-006, INV-007 | Implemented | d09 §2.5 | `convex/reports.ts` (`getCagePnL`, `listCagePnL`, `listCyclePnL`, `pnlOverheads`), `pages/pnl.js` | Covered (`convex/expenses.test.ts` P&L suite) | Cost per kg per cage and per cycle shown |
| INV-009 | Sales edit, payments, invoices | Payment updates, invoices, receivables; over-sale re-check on edit | P2 | SEC-002 | Not started | d08 §10; d02 KF9 | `convex/sales.ts`, `pages/sales.js` | None | Pending sale can be marked paid |
| INV-010 | Customers management UI | Wire `updateCustomer` | P3 | — | Not started | d06 §3 | `pages/sales.js` | None | — |
| INV-011 | Stock counts | Cycle count workflow for inventory | P3 | INV-001 | Not started | d14 domain "Inventory" | — | None | Count posts adjustment |
| INV-012 | Assets and maintenance | Asset registry | P3 | — | Not started | — | — | None | — |
| PROD-015 | Feeding plans | Feed tables per species/size; ration suggestion | P3 | PROD-010 | Not started | d14 §3 | — | None | Daily entry shows planned ration |

## Phase 10 — Automation

| ID | Feature | Description | Priority | Dependencies | Status | Docs | Source files | Testing status | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| AUTO-001 | Domain events outbox | Engine and writers emit events | P2 | PROD-002 | Designed | D-008; A07 | new `convex/events.ts` | None | Each stock event emits a domain event |
| AUTO-002 | Rules and runs | `automationRules`, `automationRuns`, retries | P2 | AUTO-001, PERM-002 | Designed | D-008 | new `convex/automation.ts` | None | Failed run retried and visible |
| AUTO-003 | Reactive, multi-channel notifications | `useQuery` bell; notifications page; channel preferences | P2 | INT-002 | Not started | d13 §6 | `contexts/NotificationContext.js`, `convex/notifications.ts` | None | New notification appears without reload |
| AUTO-004 | Approval notifications and escalations | Notify approvers; escalate after delay | P2 | AUTO-002 | Not started | d14 row 26 | `convex/stocking.ts`, `convex/fishTransfers.ts` | None | Approver notified on submission |
| AUTO-005 | Tasks and recurring tasks | Assignable tasks with recurrence | P3 | AUTO-002 | Not started | — | — | None | Weekly net inspection task generated |
| AUTO-006 | Automation templates | Seeded rule templates | P3 | AUTO-002 | Not started | — | — | None | — |
| AUTO-007 | Per-org schedules in local time | Replace fixed 16:00 UTC with per-org schedule | P1 | PLAT-001, ORG-005 | Not started | d13 §5; d12 §6.4 | `convex/crons.ts`, `convex/reminders.ts` | Partial | Reminder at the org's chosen local hour |

## Phase 11 — Integrations

| ID | Feature | Description | Priority | Dependencies | Status | Docs | Source files | Testing status | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| INT-001 | Messaging channels and encrypted credential store | Per-company SMS (Hubtel, Africa's Talking, Twilio), WhatsApp (Cloud API, Twilio) and email (Resend) channels; AES-GCM credentials in `integrationSecrets`; write-only admin UI `/messaging-settings`; test send verifies a channel; platform default from env; rate-limited test sends | P1 | D-017 rate limiter | Implemented (PR #26, merged) | D-009; D-018; A09; A18 | `convex/messaging/*`, `convex/lib/crypto.ts`, `convex/lib/phone.ts`, `convex/lib/rateLimits.ts`, `convex/convex.config.ts`, `pages/messaging-settings.js` | Covered (`convex/messaging.test.ts`) | No public result contains a secret; non-admin and cross-company refused; test send marks verified; missing key refuses only credential saves |
| INT-002 | Provider adapters (email, SMS, WhatsApp) | Email slice pulled into Phase 1 for auth | P1 (email) / P2 | INT-001, Q-001 | Designed | D-009; d13 §7–9 | new `convex/integrations/*` | None | Test message delivered per provider |
| INT-003 | Inbound signed webhooks | `httpAction` + HMAC | P3 | INT-001 | Not started | d13 §13 | `convex/http.ts` | None | Unsigned request rejected |
| INT-004 | Public API and API keys | Hashed keys, scopes, rate limits | P3 | PERM-002 | Not started | d13 §14 | `convex/http.ts` | None | Key reads only its org |
| INT-005 | Outbound webhooks | Subscriptions, signed delivery, retries | P3 | AUTO-001 | Not started | — | — | None | — |
| INT-006 | Weather | Per-site weather | P3 | FARM-001 | Not started | d13 §27 | — | None | — |
| INT-007 | IoT ingestion | Device registry, readings ingest | P3 | PROD-014 | Not started | d13 §28 | — | None | Sensor DO stored as readings |
| INT-008 | Accounting export | Sales/purchases/expenses export or sync | P3 | INV-007 | Not started | d13 §29 | — | None | — |
| INT-009 | LLM gateway on credential model | Provider keys per org; usage log | P3 | INT-001, SEC-004 | Not started | d13 §11 | `pages/api/llm/chat.js` | None | Usage per org visible |

## Phase 12 — Traceability

| ID | Feature | Description | Priority | Dependencies | Status | Docs | Source files | Testing status | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| TRACE-001 | Batch genealogy view | Multi-hop lineage | P2 | PROD-001 | Not started | d08 §1 | new `convex/traceability.ts` | None | Lineage across split/merge shown |
| TRACE-002 | Feed and supplier traceability | Lot → unit/batch | P3 | INV-002 | Not started | — | — | None | — |
| TRACE-003 | Treatment history | Per batch | P2 | PROD-011 | Not started | d14 row 37 | `convex/health.ts` | None | — |
| TRACE-004 | Harvest lots and dispatch | Lots, dispatch notes, customer link | P3 | M18 | Not started | — | — | None | — |
| TRACE-005 | Document management | Attachments with type/size checks | P3 | — | Not started | d12 §9 | — | None | — |
| TRACE-006 | Compliance templates | Checklists via custom forms | P3 | CUSTOM-004 | Not started | — | — | None | — |
| TRACE-007 | Tamper-evident audit | Hash chain, retention | P3 | ORG-008 | Not started | d07 §4.3 | `convex/lib/tenancy.ts` (`logAudit`) | None | — |

## Phase 13 — Analytics and AI

| ID | Feature | Description | Priority | Dependencies | Status | Docs | Source files | Testing status | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| ANLY-001 | Report builder over rollups | Saved reports | P3 | PLAT-002 | Not started | — | `convex/reports.ts` | None | — |
| ANLY-002 | Farm comparisons | Site vs site KPIs | P3 | PLAT-002 | Not started | — | — | None | — |
| ANLY-003 | Forecasting | Growth curves per species; harvest date/weight forecast | P3 | PROD-010 | Not started | — | — | None | — |
| ANLY-004 | Cost per kg and profitability | Over INV-008 | P3 | INV-008 | Not started | d09 §2.5 | `pages/pnl.js` | None | — |
| ANLY-005 | Assistant with permission-checked tools | Replace JSON snapshot | P3 | PERM-002, SEC-004 | Not started | d13 §11 | `components/AiAssistant.js`, `convex/reports.ts:516-567` | None | Cannot answer outside user's scope |
| ANLY-006 | Sensor analytics | Over INT-007 | P3 | INT-007 | Not started | — | — | None | — |
| ANLY-007 | Scheduled / emailed reports | — | P3 | INT-002 | Not started | d14 §3 | — | None | — |
| ANLY-008 | Warehouse export | Only with a recorded justification (D-001) | P3 | PLAT-002 | Not started | D-001 | — | None | — |

## Phase 14 — Enterprise and global

| ID | Feature | Description | Priority | Dependencies | Status | Docs | Source files | Testing status | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|
| ENT-001 | Subsidiaries, business units, regions | Parent orgs and groupings | P3 | ORG-001, PERM-002 | Not started | D-003 | — | None | Group admin sees consolidated KPIs |
| ENT-002 | Consolidated reporting | Cross-org rollups for group roles | P3 | ENT-001, PLAT-002 | Not started | — | — | None | — |
| ENT-003 | SSO and MFA | OIDC/SAML; MFA | P3 | ORG-001 | Not started | d07 §1 | `convex/auth.ts` | None | — |
| ENT-004 | Teams, departments, workforce | — | P3 | PERM-001 | Not started | — | — | None | — |
| ENT-005 | Data retention | `auditLogs`, `notifications`, ledger retention policies | P3 | — | Not started | d04 F19 | — | None | — |
| ENT-006 | Super-admin act-as with audit | Explicit, logged cross-tenant support access | P2 | PERM-002 | Not started | d07 §3.8 | `convex/companies.ts` | None | Every act-as session audited under the tenant |
| I18N-002 | UI translation library | When first non-English locale is committed (candidate `next-intl`) | P3 | Q-020 | Not started | D-012 | all pages | None | — |
| I18N-003 | Multi-currency with FX | Rates and reporting currency | P3 | Q-020 | Not started | d13 §31 | `lib/currencyUtils.js` | None | — |
| I18N-004 | Country settings and compliance templates | — | P3 | TRACE-006 | Not started | — | — | None | — |
| PLAT-003 | Return validators; no `any` ctx | Progressive across modules | P2 | — | Not started | d04 F12, F22 | all `convex/*.ts` | n/a | All exports have `returns` |
| PLAT-005 | Effect foundation | `effect` ^4.1.4; `convex/lib/effect.ts` (runEffect/runEffectSync, UserFacingError → userError); `convex/lib/effectHttp.ts` (timeout, 5xx/network-only retry, tagged errors, Schema decode); ESLint ban on the `effect` barrel | P1 | — | Implemented | D-019; A19 | `convex/lib/effect.ts`, `convex/lib/effectHttp.ts`, `eslint.config.mjs` | Covered (`convex/lib/effect.test.ts` 9 tests, `convex/lib/effectHttp.test.ts` 12 tests) | 4xx never retried; 5xx/timeout retried; UserFacingError reaches the client as `userError` |
| PLAT-006 | Effect: AI proxy | `pages/api/llm/chat.js` provider calls on Effect in a server-only module: Schema-validated body, per-attempt timeout, retry on transient failures, Schema-validated provider responses; same messages as before | P2 | PLAT-005 | Designed | D-019; A19 §8 (notes) | `pages/api/llm/chat.js`, new `convex/lib/llmProviders.ts` | None | Same text/errors as before for every provider; 5xx/timeout retried, 4xx not |
| PLAT-007 | Effect pilot: messaging providers | `convex/messaging/providers/*` sends are Effect programs: tagged `ProviderRejected`/`ProviderUnavailable`, 10 s per-attempt timeout (aborted, not re-sent), retry on 5xx/connection errors only, Schema-checked 2xx bodies; `SendResult` and messages unchanged | P2 | PLAT-005, INT-001 | Implemented | D-019; A19 §8 | `convex/messaging/providers/send.ts`, `hubtel.ts`, `africastalking.ts`, `twilio.ts`, `whatsappCloud.ts`, `resend.ts` | Covered (`convex/messaging/providers/send.test.ts` 52 tests; `convex/messaging.test.ts` 25 tests unchanged and green) | Same delivery results and messages; 5xx retried, 4xx/429 not, timeouts not re-sent |


## Added 2026-11-18 (after discovery)

### Cloudflare evaluation (proposed — see docs/architecture/17-cloudflare-adoption-roadmap.md)

| ID | Feature | Priority | Dependencies | Status | Docs |
|---|---|---|---|---|---|
| CF-001 | Record the Cloudflare position; confirm Vercel plan; Next ≥ 15.5.29 | P1 | OPS-001, OPS-003 | Designed | arch 14, 17 |
| CF-002 | Production DNS on Cloudflare (DNS-only) | P2 | — | Not started | arch 17 |
| CF-003 | Turnstile on sign-up, registration, reset, invite | P2 | SEC-001, Q-011, ORG-004 | Designed | arch 14, 17 |
| CF-004 | `files` table on Convex storage | P2 | PERM-002, SEC-002 | Designed | arch 16 |
| CF-005 | R2 provider behind `files` | P3 | CF-004, D-016 | Not started | arch 16, 17 |
| CF-006 | Copy existing files to R2 + reconciliation job | P3 | CF-005 | Not started | arch 17 |
| CF-007 | Cloudflare Access on the staging frontend | P2 | — | Not started | arch 17 |
| CF-008 | IoT ingestion Worker | P3 | INT-004, INT-007 | Not started | arch 14 |
| CF-009 | WAF in front of Convex custom domains | P4 | — | Not started | arch 14 |
| CF-010 | Hosting re-evaluation | P4 | — | Not started | arch 14 §3.3 |

### Owner requests

| ID | Feature | Description | Priority | Dependencies | Status | Acceptance criteria |
|---|---|---|---|---|---|---|
| SEC-006 | Passwordless phone login | An admin registers a staff member's mobile number; the worker signs in with a one-time SMS/WhatsApp code (Convex Auth `phone-otp` credentials provider), no password. Email + password remains for office staff. | P1 | INT-001, SEC-001, SEC-003, D-017 | Implemented (PR feat/otp-login-2fa) | A18; D-018 | `convex/auth.ts`, `convex/phoneAuth.ts`, `convex/users.ts` (`setPhone`), `pages/login.js`, `components/UserManagement.js` | Covered (`convex/otpAuth.test.ts`) | Code ≤10 min, single use, ≤5 attempts; per-number/company/global send limits; unknown numbers get the same response and no send; never creates a user; audit on phone change |
| SEC-007 | Company-required two-step verification | Company setting `require2fa` (SMS or WhatsApp, only with a working channel); per-session `mfaSessions`; `requireUser` refuses `MFA_REQUIRED` until verified; `/verify` page with enrolment for users without a phone; offline shell never renders an unverified session | P1 | INT-001, SEC-006 | Implemented (PR feat/otp-login-2fa) | A18; D-018 | `convex/lib/authz.ts`, `convex/mfa.ts`, `convex/security.ts`, `pages/verify.js`, `pages/messaging-settings.js`, `lib/offlineSession.js` | Covered (`convex/otpAuth.test.ts`, `lib/offlineSession.test.js`) | Gate refuses then allows after verify; enabling refused without a verified channel or admin phone; cross-company isolation |
| OPS-004 | Staging environment and safe cutover | `release/phase0` deployed to a separate staging Convex deployment loaded with a copy of live data; Vercel preview points at it; cutover = freeze → final export/import into the production deployment → run M1 → switch Vercel env; old deployment kept as rollback. | P0 | Owner creates staging Convex project + Vercel preview env | Ready for implementation (blocked on owner access) | PBA staff sign in on staging with existing passwords; all live rows present after M1; live portal unaffected until cutover; rollback tested. |
