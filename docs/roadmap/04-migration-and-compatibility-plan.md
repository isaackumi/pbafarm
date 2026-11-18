# 04 — Migration and Compatibility Plan

Date: 2026-11-18. Status: Proposed — awaiting owner approval. Every migration here is implied by a decision in `docs/project-management/DECISION-LOG.md` or a Phase 0 fix in `03-development-roadmap.md`. Nothing has been run. MASTER-PROMPT PART 16: no destructive migration without explicit approval and a documented recovery strategy.

## 1. Method

Every schema or data change follows five steps. A step is not started until the previous one is verified.

| Step | What happens | Convex specifics | Rollback |
|---|---|---|---|
| **Widen** | Add the new table, optional field or index. Old code keeps working. | Optional fields and new tables deploy safely. Adding a **required** field fails the deploy if any existing document lacks it, because Convex validates existing documents against the schema on push. New indexes are built during deploy; check build time on large tables on staging first. | Remove the field/table/index in a later deploy (only after no code reads it). |
| **Backfill** | Fill the new structure from existing data in batches. | Use a migration runner (`@convex-dev/migrations` or equivalent, PLAT-004 — a new dependency that needs approval): paginated, resumable, idempotent, one `internalMutation` per batch, so no single transaction exceeds limits (the failure mode of today's `backfillLocations`, doc 04 F3). | Backfilled rows are tagged (`migratedBy: 'Mx'`) and can be deleted by the same runner. |
| **Dual-write** | Every writer updates old and new structures in the same mutation. | Same transaction, so both stay consistent. | Disable new-structure writes by flag. |
| **Switch reads** | Readers use the new structure, behind a per-org or global flag. | Flag in `companies.settings.features` or a `featureFlags` table (`06-release-strategy.md` §5). | Flip the flag back. |
| **Narrow** | Remove old writes and old fields; make fields required where intended. | Make a field required only after a verification query shows zero documents without it. | Needs owner approval; restore from the backup taken immediately before. |

Each migration below lists its steps, pre-flight checks and rollback. Run every migration first on **staging seeded with a copy of production** (OPS-001), compare counts, then on production with a fresh backup taken immediately before.

## 2. Pre-flight data checks (run before Phase 0 code ships)

Read-only `internalQuery` functions in `convex/internal/preflight.ts` (new), run from the CLI against production. Results are recorded in the tracker item and reviewed by the owner.

| Check | Why | Blocks |
|---|---|---|
| P1. Per table, count documents with `companyId` undefined. Tables (doc 04 §1: every `companyId` is optional): `farmLocations`, `cages`, `feedSuppliers`, `feedTypes`, `feedPurchases`, `feedUsage`, `dailyRecords`, `biweeklyRecords`, `harvestRecords`, `harvestSampling`, `feedInventory`, `feedInventoryTransactions`, `stockingHistory`, `topupHistory`, `fishTransfers`, `auditLogs`, `notifications`, `customers`, `sales`, `healthTreatments`, `userInvites`, `companySettingsDrafts`. (`biweeklySampling` has no `companyId`; check via parent.) | X3 severity; M1 decisions (doc 07 Q1) | SEC-001 |
| P2. Count users with no `companyId`, by role; list company-less `super_admin`s. | V2 exposure; SEC-001 behaviour change for these users | SEC-001, SEC-003 |
| P3. Count users whose company `status` is not `approved`. | They lose access under SEC-001 | SEC-001 |
| P4. Count users with `active === false` who have rows in `authSessions`. | Sessions to revoke | SEC-001 |
| P5. Cages where `currentCount` differs from the approximate rebuild (doc 08 §15 formula). | Size of the M7 reconciliation; owner review | PROD-000, M7 |
| P6. Cages whose `currentWeight` came from a sample dated before the cage's current `stockingDate`. | M0-b repair list | PROD-000f |
| P7. `harvestRecords` with `fcr === 1.5`, no `cageEffect`, and a matching `harvestSampling` row (created by `createFromSampling`). | M0-c tagging list | PROD-000g |
| P8. Pairs of `feedUsage` rows with `source: 'issue'` and `source: 'daily'` for the same cage and date. | Size of S14 double deduction | PROD-000h |
| P9. `feedInventoryTransactions` rows reversed more than once (count of `reversal` rows per `referenceId` > 1). | S13 damage | PROD-000i |
| P10. Document counts for `dailyRecords`, `feedInventoryTransactions`, `auditLogs`, `notifications`, `stockingHistory`. | Sizes batch counts and index build time | PLAT-001, M7 |
| P11. Pending stockings/top-ups linked to pending transfers that were approved directly (approved stocking/top-up whose linked transfer is pending or rejected). | S2/S3 damage | PROD-000d |
| P12. Biweekly `batchCode` values used by more than one company (should be none, since uniqueness was global). | Index switch to per-company is safe | SEC-002 |

## 3. Phase 0 migrations

### M0-a — Stock drift report (read-only)
P5 output saved as a CSV for the owner. No writes. It previews the M7 reconciliation adjustments.

### M0-b — Reset carried-over ABW (PROD-000f)
- **Widen:** none.
- **Backfill:** for each cage in P6, set `cages.currentWeight = openStocking.initialAbw`; log `{cageId, previous, new}` to `migrationLog` (new internal table, also used by later migrations).
- **Rollback:** restore `previous` from the log.

### M0-c — Tag sampling-page harvests (PROD-000g)
- **Widen:** optional `harvestRecords.source: 'harvest_form' | 'sampling_page' | 'import'`.
- **Backfill:** P7 rows → `source: 'sampling_page'`. KPI queries exclude `sampling_page` until the owner answers Q-005; final handling (convert to sampling records, or apply the cage effect) is a separate approved step.
- **Rollback:** unset the field.

### M1 — Legacy rows without `companyId`; company-less users (SEC-001)
- Based on P1–P3. Options per table, decided by the owner:
  1. **Assign** to a company (when rows clearly belong to the original farm; e.g. pre-tenancy data of the first customer).
  2. **Quarantine**: set `companyId` to a dedicated `quarantine` company row (status `rejected`), so no tenant sees them and nothing is deleted.
- Company-less users: no data change; SEC-001 routes them to registration. Company-less super_admins are confirmed by the owner (they keep platform access, lose tenant-API writes).
- **Rollback:** the `migrationLog` holds every patched id and its previous `companyId` (undefined).
- **Narrow (M10, later):** once P1 returns zero for all tables, remove the "unscoped" branches in `convex/lib/tenancy.ts` and make `companyId` required on tenant tables in a later approved deploy (Phase 3).

### M8 — Index additions (Phase 0 onward)
Additive only. Indexes named per the Convex guideline (`by_field1_and_field2`):

| Table | Index | Needed by |
|---|---|---|
| `users` | `by_companyId` | PLAT-001 (reminders, user lists, mortality alert recipients) |
| `dailyRecords` | `by_companyId_and_date` | PLAT-001 (`listForDate`, reminders, dashboards; PR #7's `list` uses non-tenant `by_date`) |
| `stockingHistory`, `topupHistory`, `fishTransfers` | `by_companyId_and_status` | PLAT-001 (pending approvals) |
| `stockingHistory` | `by_companyId_and_batchNumber` | PLAT-001 (batch number allocation) |
| `fishTransfers` | `by_destinationStockingId`, `by_destinationTopupId` | PROD-000d |
| `biweeklyRecords` | `by_companyId_and_batchCode` | SEC-002 (V15) |
| `sales` | `by_companyId_and_cageId` | PLAT-001 (P&L) |
| `auditLogs` | `by_companyId_and_tableName`, `by_recordId` | PLAT-001 |
| `feedInventory` | `by_feedTypeId_and_locationId` | PLAT-001 |
| `feedInventoryTransactions` | `by_feedTypeId_and_locationId` | PLAT-001 |
| `healthTreatments` | `by_companyId_and_withdrawalUntil` | PROD-012 |
| `userInvites` | `by_companyId_and_email` | SEC-003 |

- **Order:** deploy indexes one release before the code that uses them when P10 shows a large table.
- **Old indexes:** the ~40 unused ones (doc 04 F15) are kept until PLAT-001 lands; then remove those still unused, one release at a time.
- **Rollback:** drop the index in a later deploy (only after code stops using it).

### M14 — Move data from `vibrant-stork-860` to the new production deployment (OPS-001)
Not a schema migration; a deployment move. Procedure and rollback in `06-release-strategy.md` §3. It happens **before** M2–M7 so those run on production, not on the dev deployment.

## 4. Phase 1–3 migrations

### M2 — `memberships` backfill (ORG-001, D-002)
- **Widen:** add `memberships` table with indexes `by_userId`, `by_companyId`, `by_companyId_and_userId`.
- **Backfill:** for each `users` row with `companyId`: insert `{ userId, companyId, role: user.role === 'admin' ? 'admin' : 'user', locationScope: user.locationIds ?? 'all', status: user.active === false ? 'suspended' : 'active' }`. Skip if a membership for (company, user) exists (idempotent). Super_admins with a company also get a membership with role `admin` (their platform role stays on `users.role`).
- **Dual-write:** `users.update`, `users.deactivate/reactivate`, `users.invite`, `claimInvite`, `companies.approve`, `userAccounts.createWithPassword` (via `finalizeCreatedUser`) write both.
- **Switch reads:** the guard reads the membership for `users.companyId`; fallback to `users` fields only when the membership is missing, logged as an anomaly.
- **Narrow:** stop writing `users.role` for organization roles (keep it for `super_admin`); `users.companyId` stays as the active pointer (not removed). `users.locationIds` is no longer read.
- **Verification:** count(memberships) = count(users with companyId); zero fallback anomalies for 7 days.
- **Rollback:** guard flag back to `users` fields; memberships remain.

### M3 — Organization profile fields (ORG-005)
Optional `companies.country`, `timezone`, `unitSystem`, `defaultLocale`. Backfill existing companies with `timezone: 'Africa/Accra'`, `unitSystem: 'metric'`, `country: 'GH'` **only after owner confirmation** (Q-020). Readers default when absent. Rollback: unset.

### M4 — `cages.unitType` and typed dimensions (FARM-002, D-003)
Optional `unitType`, `areaM2`, `depthM`, `volumeM3`, `diameterM`, `unitGroup`. Readers use `unitType ?? 'cage'`. Optional backfill `unitType: 'cage'` for explicitness; `volumeM3` from `size` where `size` is set (doc 04 §3.6 notes `size` is m³). Rollback: unset.

### M5 — `farmLocations` extension (FARM-001)
Optional `siteType`, `timezone`, `latitude`, `longitude`, `waterBody`. No backfill required (`timezone` falls back to the company). Rollback: unset.

### M9 — Roles and permissions (PERM-001/002)
- **Widen:** `roles` table; `memberships.roleId` optional.
- **Backfill:** per company create template roles; map membership `role: 'admin'` → admin template, `'user'` → field_staff (or manager; owner decision Q-010).
- **Dual-check:** `requireMember` computes its decision alongside the legacy `requireRole` and logs mismatches for one release (shadow mode).
- **Switch:** enforce `requireMember`.
- **Narrow:** remove `requireRole`/`listForCompany` usage.
- **Rollback:** shadow mode back on.

### M10 — Remove the unassigned pool (narrow step of SEC-001/M1)
Precondition: P1 = 0 for all tables after M1. Remove the `companyId`-missing branches from `convex/lib/tenancy.ts`; make `companyId` required on tenant tables in one approved deploy per group of tables. Backup immediately before. Rollback: revert to optional (schema loosening is always safe).
- **Implemented (verification only):** `legacyData:m10VerifyNarrowReady`; the schema change is a follow-up PR per the checklist in `docs/ops/legacy-data-migrations.md`.

## 5. Phase 4 migrations (production engine)

### M6 — `batches` from `stockingHistory` (PROD-001)
- **Widen:** `batches`; optional `batchId` on `stockingHistory`, `topupHistory`, `fishTransfers`, `dailyRecords`, `biweeklyRecords`, `harvestRecords`, `sales`, `healthTreatments`.
- **Backfill:** one batch per approved, non-deleted `stockingHistory` row: `batchCode = batchNumber`, `unitId = cageId`, `species`, `openedAt = stockingDate`, `closedAt`, `origin = sourceCage ? 'transfer' : 'stocked'`, `legacyStockingId`. For transfer-created stockings, `parentBatchIds = [batch of fishTransfers.sourceStockingId]`. Stamp `stockingHistory.batchId`.
- **M11 — stamp `batchId` on operational rows:** for each `dailyRecords`, `biweeklyRecords`, `harvestRecords`, `healthTreatments` row, the batch open on the cage at that date (same rule as `convex/lib/growth.ts:38-47`, plus `closedAt`). Ambiguous rows (two open batches on one date, doc 09 S9 history) are left unstamped and listed for review.
- **Rollback:** delete backfilled batches (tagged) and unset `batchId`.

### M7 — `stockEvents` backfill (PROD-002, D-004)
Order matters because live writes continue during the migration.

1. **Widen:** `stockEvents` table and the engine module; no reads yet.
2. **Dual-write first:** deploy the engine calls inside every existing writer (the 12 paths in doc 08 §4). From this moment (`T0`), new operations append events tagged `origin: 'live'`.
3. **Backfill history before `T0`**, per cage, in date order, tagged `origin: 'backfill'`:

| Source | Event | Notes |
|---|---|---|
| Approved, non-deleted `stockingHistory` | `stock_in` (qty `fishCount`, `abwG` `initialAbw`, biomass `initialBiomass`) | If the previous batch on the cage still had a positive balance and was not closed, first emit `count_adjustment` (negative, reason `legacy_overwrite`) — this makes the old overwrite semantics (doc 09 S9) explicit. Transfer-created stockings are handled by the transfer row instead. |
| Approved `topupHistory` not linked to a transfer | `stock_in` into the stocking's batch | |
| `dailyRecords.mortality > 0` | `mortality` | Full recorded value even when the original decrement was clamped (doc 08 §4 #4). |
| `harvestRecords` with `cageEffect` | `harvest` (`fishRemoved` for partial; `countBefore` for complete) | `cageEffect` exists only for harvests written after PR #8 deployed (2026-11-18 00:54 UTC). |
| `harvestRecords` without `cageEffect` | none | Pre-#8 harvests and `source: 'sampling_page'` rows did not change the count; listed for review. |
| Approved `fishTransfers` | `transfer_out` on the source batch + `transfer_in` on the destination batch | Linked stocking/top-up rows are not emitted separately. |
| `auditLogs` rows for `cages.update` with a `currentCount` change | `count_adjustment` = new − previous | Doc 08 §4 #12. |

4. **Reconcile:** per cage, `expected = Σ events`; `actual = cages.currentCount`. Emit one `count_adjustment` dated the migration day with reason `migration_reconciliation` for `actual − expected`, so Σ events = `currentCount` (the farm operates on today's counts). The full list (≈ M0-a) goes to the owner before step 5.
5. **Observe:** nightly reconciliation job; target zero unexplained mismatches for 14 days.
6. **Switch reads:** `cages.currentCount` written only by the engine; growth and reports read events/rollups (flag `engineReads` per org).
7. **Narrow:** remove the direct `currentCount` patches from `convex/stocking.ts`, `convex/dailyRecords.ts`, `convex/harvest.ts`, `convex/fishTransfers.ts`, `convex/lib/fishTransferLogic.ts`, `convex/cages.ts`. `harvestRecords.cageEffect` becomes informational (kept, not written).

**Rollback.** Steps 1–5: disable the engine flag; legacy counter remains authoritative; delete backfill events by tag if needed. Step 6: flip `engineReads` off. Step 7: requires owner approval; rollback is a code revert (the counter is still written by the engine, so values stay valid).

### PLAT-002 — Rollup tables
New tables (`unitDailyStats`, `batchStats`, `siteDailyStats`) backfilled by paginated jobs from raw rows; maintained by the engine on write. Verification: rollup equals a raw recompute on a sample of units. Rollback: readers switch back to raw (bounded) queries.

## 6. Later-phase migrations (summary)

| ID | Phase | Change | Steps | Rollback |
|---|---|---|---|---|
| M12 | 8 | `custom` optional object on records; `customFieldDefs` | Widen only | Archive defs |
| M13 | 7 | `clientMutationId` optional on field records; `idempotencyKeys` table with retention | Widen; dual-write in field mutations | Ignore keys |
| M15 | 6 | Copy `dailyRecords.dissolvedOxygen/temperatureC`, `biweeklyRecords` DO/temperature/Secchi into `waterQualityReadings` | Widen → backfill → dual-write from daily/biweekly entry → switch charts | Delete copied readings; originals untouched |
| M16 | 9 | `locationId` on every `feedInventoryTransactions` row where derivable (purchase site; cage site for usage); legacy inter-site transfer rows marked `legacy_unsigned` (the source site was never stored on the ledger, doc 08 §6.3 — but the audit row kept it: `legacyData:m16ConvertLegacyTransfers` converts provable rows to two legs, see `docs/ops/legacy-data-migrations.md`); two-legged transfers from now on | Widen → backfill → dual-write → switch per-site ledger reads | Unset backfilled fields |
| M17 | 10 | Current reminders and mortality alerts expressed as default `automationRules` per org | Widen → seed rules → run both with dedupe → switch off legacy cron | Re-enable legacy cron |
| M18 | 12 | One `harvestLots` row per existing harvest | Widen → backfill | Delete tagged lots |
| M19 | 2/4 | Species and size grades as per-org configuration seeded from `lib/fishSpecies.js` and distinct `harvestRecords.sizeBreakdown[].category` values | Widen → seed → forms read config | Forms fall back to the static list |
| M20 | 3 | Narrow `users.role` to `super_admin`/`null`; org roles only on memberships | After M9 verified | Restore from migrationLog |

## 7. How the PRs interact with migrations

Verified state on 2026-11-18 (`03-development-roadmap.md` §0.1): #7–#13 are merged to `main` and deployed to `vibrant-stork-860`; #14 (UI only, no `convex/` changes) is not on `main`.

| PR | Schema/data effect already live | Interaction |
|---|---|---|
| #7 Daily records view/edit | `dailyRecords.list` reads `by_date` / cage-date indexes with a bounded take | Makes S8 reachable from the UI → PROD-000c is a hotfix. PLAT-001 replaces `by_date` with `by_companyId_and_date` (M8). |
| #8 Harvest closes cage | `harvestRecords.cageEffect`, stocking `closedAt` set by harvests | S5/S6 live → PROD-000a/b hotfix. M7 relies on `cageEffect`; harvests before the #8 deploy have none. |
| #9 Growth metrics | `cages.currentWeight` synced by `syncCageAbw`; `cages.growth/growthAll` | S7 → PROD-000f + M0-b. PROD-008 later replaces the growth inputs. |
| #10 Real feed KPIs | read-side | PLAT-001 (feed pages' full scans). |
| #11 Daily reminders | `notifications.dedupeKey`, `by_dedupe` index; cron | PLAT-001 fan-out; M17 later. |
| #12/#13 Per-site stock, optional grades | per-site checks in `feedLedger`; grades optional | M16 builds on per-site lots; M19 seeds grades. |
| #14 UI consistency | none | Re-land before Phase 0 UI changes to avoid conflicts in the 51 files it touches. |

Rules going forward:
- No migration runs on `vibrant-stork-860` once production exists (M14 first).
- A PR that changes the schema states its migration ID and step (widen/backfill/dual-write/switch/narrow) in the description.
- Two PRs never run backfills on the same table in the same release.
- Developers stop running `npx convex dev` against the shared deployment (doc 12 §7 "Drift"); each uses a personal dev deployment.
