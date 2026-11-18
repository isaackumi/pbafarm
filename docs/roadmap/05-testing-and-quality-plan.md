# 05 — Testing and Quality Plan

Date: 2026-11-18. Status: Proposed — awaiting owner approval. Sources: doc 12 §2–4, doc 07 §7, doc 09 §7, doc 04 F23, doc 11.

## 1. Current state (verified)

| Item | State | Evidence |
|---|---|---|
| Runner | Vitest 3.2.4 + `convex-test` 0.0.38, `environment: 'edge-runtime'` | `vitest.config.mjs`, doc 01 §1 |
| Tests that run | 4 files, **17 tests**, all passing, ~650 ms | doc 12 §4: `convex/siteStock.test.ts` (5), `convex/growth.test.ts` (5), `convex/reminders.test.ts` (3), `convex/harvest.test.ts` (4) |
| Orphaned test | `convex/lib/fishTransferLogic.test.ts` **never runs**: `include: ['convex/*.test.ts']` is not recursive (verified: "No test files found"). Same on `main`. | doc 12 §4, doc 01 §5 |
| Type-check of tests | None: `convex/tsconfig.json` excludes `**/*.test.ts` | doc 12 §2 |
| Coverage | Not measured (no `@vitest/coverage-*`, no config) | doc 12 §4 |
| Modules with no tests | `companies`, `stocking`, `feed`, `reports`, `fishTransfers`, `sales`, `farmLocations`, `users`, `audit`, `notifications`, `health`, `seed`, `userAccounts`, `convex/lib/{authz,tenancy,feedLedger,farmRules}` | doc 12 §4 |
| Tenant isolation | One negative test ("another company's cage cannot be harvested", `convex/harvest.test.ts:125-128`) | doc 07 §7 |
| Stock scenarios | None of doc 09 S1–S16 is covered | doc 09 §7 |
| Frontend | Zero tests; no React Testing Library, Playwright or Cypress | doc 12 §4 |
| Lint | `npm run lint` = `next lint` on `pages/ components/ lib/` only, non-gating (`continue-on-error: true`, `.github/workflows/ci.yml:23-25`); `npx eslint .` reports 7 errors, all in `.next/` | doc 12 §3 |
| Frontend types | None (JavaScript, `jsconfig.json` alias only) | doc 01 §5 |
| CI | `npm ci` → `npm test` → lint (non-gating) → `next build` with placeholder URLs; Node 20 | doc 01 §5 |
| Deploy gate | `convex-deploy.yml` deploys `main` with **no** `npm test` | doc 12 §7 |

## 2. Target test pyramid

| Layer | Tool | What | Target volume |
|---|---|---|---|
| Pure unit | Vitest | `convex/lib/*` pure functions: growth/KPI formulas, farm rules, date helpers, permission resolution, custom-field validation, engine reducers | Every exported pure function |
| Backend integration | Vitest + `convex-test` | Every public Convex function: happy path, validation, permission and tenant refusals (§4), side effects on related tables | Every public function (142 today) |
| Invariant / property | Vitest + `fast-check` (new dev dependency, needs approval) | Production engine and feed ledger invariants (§5) | Each invariant, 100+ generated sequences per run |
| Migration tests | `convex-test` | Each migration: idempotent, resumable, correct on fixtures with legacy shapes (no `companyId`, no `cageEffect`, clamped mortality) | Every M-item in `04` |
| Component | Vitest + React Testing Library (new dev dependency) | Field forms' validation and offline states: `DailyUploadPage`, `BiweeklyEntryForm`, `HarvestForm`, `FishTransferForm`, `StockingForm` | Field forms only at first |
| End-to-end | Playwright (new dev dependency) against a staging-like deployment | Key field flows on a mobile viewport, online and offline (§6) | ~10 flows |

Rule: the earlier layers carry most assertions. E2E covers flows across UI, outbox and backend, not business rules.

## 3. Conventions

- Test files live next to the module (`convex/<module>.test.ts`, `convex/lib/<name>.test.ts`) and are included by `convex/**/*.test.ts`.
- Every test fixture creates **two companies**, each with two sites and an admin and a field user, through a shared helper `convex/test/fixtures.ts` (new). A single-tenant fixture hides isolation bugs.
- Regression tests for a defect are written first and must fail on the unfixed code (PROD-000 rule).
- Tests assert on `ConvexError` codes (OPS-001), not on message text.

## 4. Mandatory tenant-isolation and permission tests

For **every public query, mutation and action**, the following cases exist. A generated table-driven suite (`convex/authz.matrix.test.ts`) lists each function with a fixture builder for valid arguments; CI fails if a public function is missing from the list (a script compares the list with `convex/_generated/api`).

| Case | Expected |
|---|---|
| Unauthenticated | Refused |
| Authenticated, deactivated user (`active: false`) | Refused (`USER_INACTIVE`) — SEC-001 |
| User of a pending / rejected company | Refused (`COMPANY_NOT_APPROVED`) — SEC-001 |
| Company-less user | Reads return empty; writes refused — SEC-001 |
| User of company A passing an id owned by company B (every id argument, including nested ids such as `feedTypeId`, `supplierId`, `customerId`, location ids, storage ids) | Refused or not found; company B unchanged — SEC-002 |
| List query as company A when company B has more rows than any internal cap | Company A's result unchanged — PLAT-001 |
| Each role template (after PERM-002: owner, admin, manager, field_staff, viewer) | Allow/deny matches the permission catalog |
| Site-scoped member reading or writing another site | Refused — PERM-004 |
| `mustChangePassword` user calling anything other than `users.current` / `changePassword` | Refused (`PASSWORD_CHANGE_REQUIRED`) |
| Super-admin through tenant APIs without a company | Writes refused; platform functions allowed and audited |

Specific regression tests from doc 07: X1, X2, X3, V1 (foreign `feedTypeId` drains another tenant's stock), V2 (invite of a company-less super_admin), V3 (claim by unverified email), V4 (`backfillLocations` not client-callable), V6, V7, V8, V13, V15.

## 5. Production engine invariants and property tests

Before Phase 4 these run against the legacy counter (where they hold after PROD-000); after Phase 4 against `stockEvents`.

| Invariant | Statement |
|---|---|
| I1 Cache = ledger | For every unit, `cages.currentCount === Σ stockEvents.qty` for the unit (signed by type). |
| I2 Conservation | A transfer emits `transfer_out(q)` and `transfer_in(q)` atomically; the organization's total live fish is unchanged by transfers, splits and merges. |
| I3 No silent negatives | No event sequence produces a negative balance unless it includes an explicit `count_adjustment` with a reason. |
| I4 Reversal | Reversing an event restores every balance and KPI input to the pre-event state; reversing twice is refused. |
| I5 Cycle isolation | Edits or reversals of events in a closed batch never change another batch's balance (doc 09 S5, S6, S8). |
| I6 Order independence of approvals | Approving a transfer-linked stocking/top-up through any endpoint adds fish exactly once (S2, S3). |
| I7 As-of | The balance as of date D computed from events equals the balance the cache held at D (snapshot comparison in tests). |
| I8 Feed ledger | `feedTypes.currentStock === Σ feedInventoryTransactions`; per site, Σ lots = Σ site ledger rows (after M16); a transaction is reversed at most once (S13). |
| I9 KPI consistency | Dashboard, report, cage page and export return the same FCR, survival and mortality for the same batch and period (doc 09 X1, X5, X6). |

Property generator: random sequences of stock-in, mortality, partial/complete harvest, transfer (single and multi-destination), split, merge, edit and reversal across 3 units and 2 batches, with random approval ordering. After each step assert I1–I5.

All doc 09 §5 scenarios S1–S16 also exist as named example tests (`convex/stockIntegrity.test.ts`).

## 6. Offline and idempotency tests

| Test | Layer | Expected |
|---|---|---|
| Replay of the same `clientMutationId` | backend | Second call returns the first result; no second record or ledger row (D-010) |
| Lost response, then retry | backend | Same as above; the UI shows "saved" not "needs attention" (doc 12 §6.4) |
| Two concurrent flushes (mount + `online` event) | component | One submission per queued item (doc 13 §16 (d)) |
| Outbox owned by user A, user B signs in | component/E2E | B's session never sends A's items; A's items stay or are discarded with a warning (MOBILE-001) |
| Sign-out clears drafts, persisted Redux, lookups cache, LLM keys | E2E | `localStorage` keys absent after sign-out |
| Cold start in airplane mode after one online session | E2E (Playwright, offline context) | Daily entry renders from cache and queues a batch (doc 11 §10 #1) |
| Timezone boundary | backend | An entry at 23:30 local time in a UTC+3 site is stored on the local date (Phase 2) |

## 7. End-to-end flows (Playwright, mobile viewport 360×800, throttled network)

1. Sign in → daily entry for 5 cages with "same as yesterday" → save → records visible in `/daily-data`.
2. Daily entry offline → reconnect → single sync, stock deducted once.
3. Stocking with approval → admin approves → cage active with count and ABW reset.
4. Fish transfer partial → approve → source and destination counts correct; linked top-up not approvable directly.
5. Bi-weekly sampling for a cage via deep link → growth figures update.
6. Partial then complete harvest → cage harvested → edit old harvest after restock refused (S5).
7. Feed purchase at site A → daily entry at site B cannot draw site A stock.
8. Admin deactivates a user → that user's open session is signed out on next action.
9. Company-less sign-up → routed to registration; sees no data.
10. Error boundary: forced render error shows recovery UI.

## 8. CI gates

Applied to every PR and to `main` (OPS-002):

| Gate | Command | Blocking |
|---|---|---|
| Install | `npm ci` | yes |
| Lint (source) | `npx eslint .` with `ignores: ['.next/**', 'convex/_generated/**', 'archive/**']` | yes |
| Backend type-check | `npx tsc --noEmit -p convex` | yes |
| Test type-check | `npx tsc --noEmit -p convex/tsconfig.test.json` (new; includes `**/*.test.ts`) | yes |
| Unit + integration | `npm test` with `include: ['convex/**/*.test.ts']` | yes |
| Authz matrix completeness | script comparing the matrix list with `convex/_generated/api` | yes (from PERM-002) |
| Coverage report | `vitest --coverage` (v8) | report only at first; threshold on `convex/lib/**` ≥ 80 % lines after Phase 4 |
| Build | `npx next build` | yes |
| E2E | Playwright against staging after deploy | blocking for release tags, not for every PR |
| Convex deploy | `convex-deploy.yml` runs `npm test` before `npx convex deploy` | yes |
| Node | Node 22 in CI | — |

## 9. Definition of done (per tracker item)

1. Acceptance criteria in the tracker are met.
2. Tests: regression test for any defect, tenant/permission cases for every touched public function, invariants where stock is involved.
3. CI gates green.
4. Verified on staging (and E2E flow if it touches a field form).
5. Docs and tracker updated; status moves to **Verified** only after step 4 (MASTER-PROMPT PART 16).
