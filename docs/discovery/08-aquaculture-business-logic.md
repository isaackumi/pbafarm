# 08 — Aquaculture business logic (as implemented)

## Stage header

**Objective.** Trace the real production engine end to end (UI → client service → Convex function → tables): cage lifecycle, stocking and top-ups, the live fish count, mortality, feeding and feed inventory, bi-weekly sampling, harvest, fish transfers, sales, reports, farm rules and reminders. Describe the production model that actually exists and whether history can be rebuilt from it. Calculation-level detail (formulas, rounding, edge cases) and the stock-consistency scenarios are in `09-production-calculation-audit.md`.

**Files inspected.**
- Backend: `convex/schema.ts`, `convex/cages.ts`, `convex/stocking.ts`, `convex/dailyRecords.ts`, `convex/biweeklyRecords.ts`, `convex/harvest.ts`, `convex/fishTransfers.ts`, `convex/feed.ts`, `convex/inventory.ts`, `convex/sales.ts`, `convex/reports.ts`, `convex/reminders.ts`, `convex/crons.ts`, `convex/health.ts` (header), `convex/lib/{growth,farmRules,feedLedger,fishTransferLogic,tenancy}.ts`.
- Tests: `convex/{growth,harvest,siteStock,reminders}.test.ts`, `convex/lib/fishTransferLogic.test.ts`, `vitest.config.*`.
- Client: `lib/{databaseService,stockingService,cageService,feedService,feedTrackingService,fishTransferService,offlineOutbox,fishSpecies}.js`; `components/{HarvestForm,DailyEntryForm,BulkDailyUploadForm,BulkBiweeklyUploadForm,BiweeklyEntryForm,BiweeklyForm,FishTransferForm,CageManageModals,DailyUploadPage,Dashboard}.js`; `pages/{harvest,harvest-sampling,approvals,stocking-management,feed-issue,pnl,report,biweekly-records,fish-transfers}.js`, `pages/stocking/[id]/details.js`, `pages/topup/[id]/details.js`, `pages/cages/[id].js`, `pages/cages/analytics*.js`, `pages/feed-management/overview.js`, `contexts/AnalyticsContext.js`.
- Ran `npm test`: 4 files / 17 tests pass. `convex/lib/fishTransferLogic.test.ts` is **not** run — `vitest.config` includes only `convex/*.test.ts`.

**Findings (summary — detail below).**
1. There is **no batch/lot entity for fish**. A "production cycle" is a `stockingHistory` row; a cage holds one open cycle at a time; fish population is a single mutable number, `cages.currentCount`, adjusted in place by seven different code paths. No fish movement ledger exists.
2. Several paths **overwrite** rather than add to the cage count (stocking approval, transfer-linked stocking approval), and several clamp at zero, which makes the count path-dependent and not reconstructable.
3. Approval of transfer-linked stockings/top-ups through their own approve endpoints is not blocked, which can **count transferred fish twice** (see 09, S2/S3).
4. Editing the fish count or type of an **old complete harvest after the cage has been restocked closes and zeroes the new cycle** (09, S5). The harvest edit UI exposes this to any user.
5. After restocking, growth figures use the **previous cycle's final ABW** until the first new sample (`cages.currentWeight` is never reset).
6. Feed inventory has a proper signed ledger (`feedInventoryTransactions`) with per-site lots and a tally check, but ledger dates are server timestamps, inter-site transfers are recorded as one unsigned row, and manual reversals are not linked back to daily records (double-reversal possible).
7. "Production cost" is feed cost only. There is no expense, fingerling-cost, labour or treatment-cost model.
8. Species is a free string on cage and stocking; no species-specific parameters exist.

**Dependencies.** 04 (schema), 05 (relationships), 06 (function inventory), 07 (authz — role checks referenced here), 09 (calculations).

**Risks.** Silent fish-count drift; double counting through approvals; destructive harvest edits; growth/eFCR figures wrong right after restock; P&L understates cost. See the risk list at the end and 09 §5.

**Outstanding questions.** Listed at the end of this document.

**Completion status.** Complete for the scope above. Behaviour was established by reading code; only the existing test suite was run. Confidence is stated per finding.

---

## 1. The production model that exists

| Concept | Where it lives | Notes |
|---|---|---|
| Site | `farmLocations` | Cages, feed lots, daily/biweekly/harvest rows carry `locationId`. |
| Production unit | `cages` | Holds the *current* state: `status`, `stockingDate`, `initialCount`, `currentCount`, `initialAbw`, `currentWeight` (latest ABW), `species`. Legacy fields `initialWeight`, `growthRate`, `mortalityRate`, `initialBiomass` are never written by any production flow (only by manual `cages.update`/`create`). |
| Production cycle ("batch") | `stockingHistory` | One row per stocking event: `batchNumber`, `stockingDate`, `fishCount`, `initialAbw`, `initialBiomass`, `species`, `status` (pending/approved/rejected), `closedAt` (set by complete harvest), `deletedAt`. A cycle is "open" when approved, not deleted and `closedAt` unset (`convex/lib/growth.ts:38-47`). |
| Additions to a cycle | `topupHistory` | `stockingId`, `fishCount`, `abw`, approval status. |
| Daily operations | `dailyRecords` | One row per cage per date (enforced in code via `by_cage_date`, `convex/dailyRecords.ts:235-241`): feed kg, feed type, price, cost, mortality + cause, water quality. Not linked to a stocking. |
| Sampling | `biweeklyRecords` (+ `biweeklySampling` sub-samples) | ABW, a `batchCode` that is a **random sampling code** (`BW<yymmdd><rand>` from `components/BiweeklyEntryForm.js:14-22`), not the stocking batch number. Not linked to a stocking. |
| Harvest | `harvestRecords` (+ `harvestSampling`) | Complete/partial, weight, ABW, count, FCR (typed or suggested), `sizeBreakdown`, `cageEffect` (undo information). Not linked to a stocking, except `cageEffect.closedStockingId` on complete harvests. |
| Fish transfer | `fishTransfers` | Source/destination cage, quantity, ABW, links `sourceStockingId`, `destinationStockingId` or `destinationTopupId`. |
| Sales | `sales`, `customers` | Optional `harvestId`, `cageId`. |
| Feed | `feedTypes` (company-wide `currentStock`), `feedInventory` (lots per site), `feedInventoryTransactions` (signed ledger), `feedPurchases`, `feedUsage`, `feedSuppliers` | See §6. |
| Health | `healthTreatments` | Withdrawal dates recorded; not enforced anywhere (harvest does not check them — `grep withdrawal convex/harvest.ts` finds nothing). |

**Is there a batch concept?** Partially. `stockingHistory.batchNumber` (auto `CAGECODE-YYYYMMDD[-n]`, `convex/stocking.ts:17-44`) identifies a cycle, but daily records, samples, harvests and sales attach to the **cage + date**, not to the batch. Cycle membership is inferred by date window (`stockingDate ≤ date ≤ closedAt|today`, `convex/lib/growth.ts:59-88`). There is no batch that can span cages, be split, or be merged. Status: **Partially implemented** (High confidence).

**Lineage.** A transfer records `sourceStockingId` (the source cage's most recent approved stocking, `convex/fishTransfers.ts:51-61`, chosen by latest date, open or not) and the destination stocking or top-up id. A transfer-created stocking also stores `sourceCage` as a cage *name string* and a note. There is no lineage on top-ups other than the transfer row, and no lineage for partial harvests. Lineage can be walked one hop via `fishTransfers`; multi-hop queries would need to be assembled by hand. Status: **Partially implemented**.

**Species.** `stockingHistory.species` and `cages.species` are optional strings from a five-item client list (`lib/fishSpecies.js`). Nothing in rules, growth or harvest varies by species; P&L just displays it (`pages/pnl.js`). Status: **Implemented but incomplete** (label only).

**Splitting / merging.** Splitting = a partial fish transfer to one destination; several destinations need several transfer records with no grouping. Merging = a transfer into an active cage becomes a top-up of the destination's latest approved stocking; the incoming fish lose their own cycle identity (their stocking ABW/biomass is not added to the destination's initial biomass). Status: **Partially implemented**.

---

## 2. Cage lifecycle and statuses

Statuses (`convex/schema.ts:5-12`): `active`, `harvested`, `harvesting`, `maintenance`, `fallow`, `empty`.

| Transition | Code path | Guard |
|---|---|---|
| create → `empty` (default) or any status passed | `cages.create` `convex/cages.ts:160-216` | Any authenticated company user; `initialCount` also copied to `currentCount`. |
| `empty`/`fallow`/`harvested` → `active` | `stocking.createStocking` (auto-approved) `convex/stocking.ts:277-287`; `stocking.approveStocking` `:409-418`; transfer to empty cage `convex/fishTransfers.ts:90-98` | `assertStockingAllowed` checks the status list **only at creation** (`convex/lib/farmRules.ts:217-222`). Approval does not re-check. |
| `active` → `harvested` | complete harvest `convex/harvest.ts:150-154` | None on prior status (a complete harvest can be posted on an `empty` cage). |
| `harvested` → previous status | undo of a complete harvest on edit/delete `convex/harvest.ts:173-178` | Only if the cage is still `harvested`. |
| `active` → `empty` | full fish transfer out `convex/lib/fishTransferLogic.ts:32-38` | Source stocking is **not** closed. |
| any → `active` | partial fish transfer out forces source `status: 'active'` (`fishTransferLogic.ts:40-44`) | Even if the source was `maintenance` etc. |
| any → any | `cages.update` (`convex/cages.ts:218-275`), UI `components/CageManageModals.js:96,119` | Status change is **not** admin-gated (only `currentCount`/`initialCount` are, `:252-254`). |
| delete | `cages.remove` `convex/cages.ts:277-294` | Admin. Hard delete; daily, biweekly, harvest, stocking, transfer, sales rows referencing the cage are **not** removed or blocked (orphans). |

`harvesting` is never set by any mutation (only selectable manually). `harvestRecords.status: 'in_progress'` is set by the UI for partial harvests (`components/HarvestForm.js:193`) but nothing reads it.

Status: **Implemented but potentially defective** — no state machine; status is a free field that several paths set without checking the current state (High confidence).

---

## 3. Stocking, approval and top-ups

**UI → server.** `components/StockingForm.js` → `stockingService.createStocking` → `stocking.createStocking`. Top-ups: `components/TopUpForm.js` → `stockingService.createTopup` → `stocking.createTopup`. Approvals: `pages/approvals.js` (live queue `stocking.listPendingApprovals`), `pages/stocking/[id]/details.js`, `pages/topup/[id]/details.js`. Edits/soft-delete: `pages/stocking-management.js` → `stocking.updateStocking` / `removeStocking`.

**createStocking** (`convex/stocking.ts:224-297`)
1. `assertStockingAllowed` (`convex/lib/farmRules.ts:209-243`): cage status in `allowStockOnlyEmptyStatuses` (default `empty, fallow, harvested`), initial ABW in `[minInitialAbwG, maxInitialAbwG]` (default 1–500 g), count ≤ `capacity` if enforced, density ≤ `maxDensityFishPerM3` (default 80, using `cage.size` as m³).
2. Status `pending_approval` if `requireApprovalForStocking` (default **true**), else `approved`.
3. Batch number: supplied or `allocateBatchNumber` (scans **all** stockingHistory rows then filters to company — `:37-38`).
4. If approved now: cage `stockingDate`, `initialCount = currentCount = fishCount`, `initialAbw`, `status: 'active'`, `species`. **`currentWeight` (latest ABW) is not reset**, and `initialBiomass` on the cage is not set.

**approveStocking** (`:385-427`, admin): sets approved and applies the same cage patch — **overwriting** `currentCount` regardless of the cage's current state. It does not re-run `assertStockingAllowed`, does not check whether another stocking was approved meanwhile, and does not check whether the stocking belongs to a pending fish transfer.

**updateStocking** (`:317-350`): edits `fishCount`, `initialAbw`, `initialBiomass`, `stockingDate` etc. (admin if approved). Changes are **not propagated** to the cage (`initialCount`, `currentCount`, `stockingDate`). Growth uses the stocking row, mortality alerts use the cage row, so they diverge after an edit.

**removeStocking** (`:353-383`): soft delete, only pending/rejected.

**createTopup** (`:490-550`): requires an approved stocking; `assertTopupAllowed` (ABW 1–800 g, capacity and density on `currentCount + added`); pending if `requireApprovalForTopup` (default true). When approved: `cage.currentCount += fishCount` (`:535-540`). Does **not** check that the stocking is still open (`closedAt`), so a top-up can be added to a harvested cycle and raise the count of whatever is in the cage now. `initialCount`, `initialAbw` and the cycle's initial biomass are not adjusted.

**approveTopup** (`:552-595`): adds `fishCount` to the cage. No check for a linked fish transfer (see §9).

**listPendingApprovals** (`:632-751`): hides stockings/top-ups linked to pending transfers so the approvals page only shows the transfer row. This is a UI filter only; the server endpoints still accept those ids.

Status: stocking **Implemented but potentially defective**; top-up **Implemented but incomplete** (no cycle check, no biomass/ABW blending).

---

## 4. Population: every writer of `cages.currentCount`

There is no derived population; `currentCount` is authoritative and mutated in place.

| # | Event | Code | Effect | Reversible? |
|---|---|---|---|---|
| 1 | Cage created | `convex/cages.ts:197-198` | `= initialCount` | — |
| 2 | Stocking approved (direct or on approval) | `convex/stocking.ts:278-286`, `:410-418` | **`=` fishCount (overwrite)** | No undo for approved stockings (`removeStocking` refuses approved). |
| 3 | Top-up approved | `convex/stocking.ts:535-540`, `:580-586` | `+= fishCount` | No mutation to reverse an approved top-up. |
| 4 | Daily mortality create | `convex/dailyRecords.ts:267-272` (`insertDailyRecord`, used by `create` and `createBatch`), `:625-630` (`createMany`) | `= max(0, current − mortality)` | Yes, via update/remove. |
| 5 | Daily mortality update | `convex/dailyRecords.ts:511-520` | `= max(0, current − (new − old))` | — |
| 6 | Daily record remove | `convex/dailyRecords.ts:562-570` | `+= mortality` (full amount even if the create was clamped) | — |
| 7 | Harvest partial | `convex/harvest.ts:118-130` | `= max(0, current − round(count))`, records `fishRemoved` | Yes, `undoHarvestOnCage` `+= fishRemoved`. |
| 8 | Harvest complete | `convex/harvest.ts:132-160` | `= 0`, `status harvested`, closes open stocking, records `countBefore` | Undo restores `countBefore` **only if cage still `harvested`**. |
| 9 | Fish transfer, source | `convex/lib/fishTransferLogic.ts:25-45` via `convex/fishTransfers.ts:72-78` | full: `= 0`, `status empty`; partial: `= current − qty`, `status active` | No edit/delete/reverse exists. |
| 10 | Fish transfer, destination empty | `convex/fishTransfers.ts:80-99` | **`=` qty (overwrite)**, cage re-initialised | No. |
| 11 | Fish transfer, destination active | `convex/fishTransfers.ts:101-120` | `+= topup.fishCount` (even if the top-up was already approved) | No. |
| 12 | Manual edit | `convex/cages.ts:252-254`, `:264` | any value (admin only) | Only via audit log. |

Not writers: `harvest.createFromSampling` (`convex/harvest.ts:386-450`) creates a harvest record (default type **complete**) **without** touching the cage, so the cage stays active with its fish. Bi-weekly `totalFishCount` never updates the cage.

Consequences (detail in 09 §5): the count is order-dependent (clamps), can be overwritten (2, 10), can double count (3/11 with transfers), and cannot be recomputed from events.

Status: **Implemented but potentially defective** (High confidence).

---

## 5. Mortality

- Entry: `pages/daily-entry.js` / `components/DailyUploadPage.js` → `dailyRecordService.createBatch` → `dailyRecords.createBatch` (atomic, ≤100 lines, `convex/dailyRecords.ts:365-442`); single-cage `components/DailyEntryForm.js:59` → `dailyRecords.create`; CSV `components/BulkDailyUploadForm.js:84` → `dailyRecords.createMany` (skips duplicates silently, no mortality cause, client-supplied price/cost).
- Offline: `lib/offlineOutbox.js` queues `createBatch` payloads in localStorage and replays them; the per-cage/date duplicate guard makes a replay of an already-saved batch fail instead of double-posting.
- Cause defaults to `unknown` when mortality > 0 (`convex/dailyRecords.ts:255-258`); `createMany` does not set it.
- Validation: `createBatch` rejects negatives; `update` requires a non-negative integer (`:472-474`); `create`/`createMany` accept any number (fractions, negatives — a negative mortality *increases* the count).
- No check that the cage is active or has an open stocking: mortality and feed can be posted to `empty`/`harvested` cages.
- Alerts (`convex/dailyRecords.ts:274-316`): daily % = mortality ÷ count *before* the deduction; cumulative % = `(initialCount − currentCount)/initialCount` (`convex/lib/farmRules.ts:312-324`). Notifications are inserted for every admin of the company on each qualifying record; there is no dedupe (unlike reminders). Cumulative % counts harvested and transferred-out fish as losses, and top-ups/transfers-in hide losses.
- Edit/remove: server mutations exist (`update` any company user, `remove` admin) but **no UI calls them** (`lib/databaseService.js:109-155` methods are unused; grep finds no callers).

Status: **Implemented but potentially defective** (alerts misfire after harvest/transfer; no cycle scoping).

---

## 6. Feeding and feed inventory

### 6.1 Daily feeding
`insertDailyRecord` → `deductDailyFeed` (`convex/dailyRecords.ts:37-82`): inserts a `feedUsage` row (`source: 'daily'`, cage, location) and calls `applyStockChange` with `-feedAmount`, type `daily_usage`, `referenceId = dailyRecordId`, `locationId = cage.locationId`. Price comes from `feedType.pricePerKg` at entry time in `createBatch` (`:414`); `create`/`createMany` trust the client's `feedPrice`/`feedCost`.

`reverseDailyFeed` (`:89-145`, used by update and remove): deletes `feedUsage` rows for the cage/date with `source === 'daily'`, then nets all ledger rows whose `referenceId` is the daily record id and posts a compensating `reversal` per feed type. Legacy records with no ledger rows are reversed by amount.

### 6.2 Ledger (`convex/lib/feedLedger.ts`)
`applyStockChange` (`:164-314`) is the single writer of `feedTypes.currentStock` for purchases, usage, issue, daily usage, adjustments and reversals:
- Rejects zero/non-finite deltas.
- Company-wide check: `currentStock + delta < 0` blocked unless `allowNegative` (admin + reason) or `feedRules.allowNegativeStock`.
- Per-site check (when `trackLots`, delta < 0, `locationId` given): `siteStock(...)` = own lots + unassigned lots + "untracked" stock (`currentStock − Σlots`) (`:90-106`); blocked if insufficient unless the same override applies.
- Lots: inbound merges into a lot keyed by site/legacy label + batch + expiry (`addInventoryLot`, `:35-84`); outbound FIFO by expiry then creation, own site first, then unassigned lots (`deductInventoryLots`, `:109-157`). If lots run out, the remainder is silently not deducted from lots (it is still deducted from `currentStock`), which becomes "untracked" negative drift.
- Always inserts a signed `feedInventoryTransactions` row with `transactionDate = Date.now()` (server time, **not** the business date).

### 6.3 Other feed movements
| Movement | Function | Notes |
|---|---|---|
| Opening stock | `feed.createFeedType` `convex/feed.ts:234-283` | Admin only if > 0; posted as `adjustment` "Opening stock", no `locationId` → unassigned lot. |
| Purchase | `feed.createPurchase` `:362-446` | Supplier required; batch required if `requireBatchOnPurchase`; lot at the chosen site. Purchase `pricePerKg` is stored on the purchase only — **it does not update `feedTypes.pricePerKg`**, which is what daily cost uses. |
| Purchase edit | `feed.updatePurchase` `:449-525` (admin) | Quantity delta posted as `adjustment` **without `locationId`**: an increase lands in an unassigned lot; a decrease draws FIFO from any site. |
| Purchase void | `feed.voidPurchase` `:528-573` (admin) | Reversal with `allowNegative: true`, no `locationId` → draws FIFO across all sites, not from the purchase's site. |
| Issue / generic usage | `feed.createIssue` / `createUsage` `:609-728` | `feedUsage` + ledger; optional cage. Feed issued to a cage is **not** counted in that cage's FCR (growth reads `dailyRecords` only) and, if the same feed is also logged in the daily entry, stock is deducted twice. `pages/feed-issue.js` gives no warning about this. |
| Adjustment | `inventory.createAdjustment` `convex/inventory.ts:197-246` (admin) | Signed; reason required; no `locationId` argument (legacy label only). |
| Inter-site transfer | `inventory.createTransfer` `:249-349` (admin) | Moves lots with `deductInventoryLots`/`addInventoryLot` directly, then writes **one** `transfer` row with positive quantity and `locationId = toLocationId`. The source side is not recorded as a row; `stockTally` excludes transfers. Batch/expiry of moved feed is lost unless a batch number is re-entered. Transfers cannot be reversed (`:369-371`). |
| Manual reversal | `inventory.reverseTransaction` `:352-394` (admin, UI `pages/inventory-transactions.js:22`) | Compensating row with `referenceId = transactionId`, no `locationId`. **No check that the transaction was already reversed** (only reversal-of-reversal is blocked), and reversing a `daily_usage` row leaves the daily record (and its FCR feed) in place; a later edit of that daily record nets only rows referencing the daily record id and returns the stock again. |
| Tally | `inventory.stockTally` `:478-517` | Compares `currentStock` to Σ non-transfer ledger rows; reports lot sum too. Good integrity check; not scheduled. |

Per-site stock view: `inventory.listStockLevels` with `locationId` uses the same `siteStock` rule (`convex/inventory.ts:111-115`); tested in `convex/siteStock.test.ts`.

Low-stock thresholds differ by screen: `inventory.listAlerts` uses `minimumStock × lowStockMultiplier`; `reports.dashboardSummary` and `reminders` use `minimumStock`; `pages/feed-management/overview.js:93-98` uses `minimumStock × 1.2`; `reports.farmContextForAi` uses `≤ minimumStock` without the `> 0` guard. All are company-wide except the stock-levels page with a site selected.

Status: ledger **Implemented and working** for the main paths (tested); purchase edit/void, reversals, transfers **Implemented but potentially defective** (site and linkage gaps).

---

## 7. Bi-weekly sampling and ABW sync

- UI: `pages/biweekly-entry.js` → `components/BiweeklyEntryForm.js` → `biweeklyRecordService` → `biweeklyRecords.create`; CSV via `components/BulkBiweeklyUploadForm.js` → `createMany`; edit/delete in `pages/biweekly-records.js`.
- `BiweeklyEntryForm` computes ABW = Σ sample weight (g) ÷ Σ sample fish (`:85-93`) and stores `totalFishCount` = **fish sampled** and `totalWeight` = **sample grams**. The CSV path and the (unused) `components/BiweeklyForm.js` store `totalFishCount` = population and `totalWeight` in **kg** (`BulkBiweeklyUploadForm.js:53-54`, `BiweeklyForm.js:61`). The same columns therefore hold different quantities and units depending on entry path; `pages/biweekly-records.js:186` labels the column "Total Weight (g)".
- `batchCode` must be unique **globally** (index `by_batch_code`, no company filter — `convex/biweeklyRecords.ts:92-96`); a collision with another tenant's code returns "Batch code already exists".
- No check that the sample date falls in an open cycle, or that the cage is stocked.
- `syncCageAbw` (`convex/lib/growth.ts:143-155`) runs after create/createMany/update/remove and sets `cages.currentWeight` to the ABW of the latest-dated sample **across all cycles**. It is not called on stocking, so after a harvest and restock the cage keeps the previous cycle's final ABW until a new sample arrives (see 09 S7).
- `cages.list` "harvest-ready" filter uses `currentWeight ≥ targetHarvestAbwG` (`convex/cages.ts:76-81`) and is affected by the same carry-over.

Status: **Implemented but potentially defective** (unit/semantic inconsistency; carry-over).

---

## 8. Harvest

**UI paths.**
1. `pages/harvest.js` → `components/HarvestForm.js` → `harvestRecordService.createHarvestRecord` → `harvest.create`. The form calls `harvest.suggestFcr` and pre-fills FCR (user can override); size grades optional (blank = 0), total weight can be derived from grades; count derived from weight/ABW if blank (`HarvestForm.js:136-152`).
2. `pages/harvest-sampling.js` → `harvest.createFromSampling` (`convex/harvest.ts:386-450`). This creates a harvest record (type defaults to `complete`), with **`fcr` hard-coded to 1.5** (`:408`), **no cage effect** (count, status and cycle unchanged), and ABW = `weight / fishCount` where the page labels weight "Total weight (kg)" (`pages/harvest-sampling.js:63-66,158`) — i.e. ABW in **kg**, while every other ABW is in grams.
3. Edit/delete: `pages/harvest.js:85,163` → `harvest.update` (any company user) / `harvest.remove` (admin).

**harvest.create** (`convex/harvest.ts:206-261`)
- Warnings via `harvestWarnings` (`convex/lib/farmRules.ts:278-310`): DOC outside `[harvestDocMinDays, harvestDocMaxDays]` (DOC from `cage.stockingDate`, floor of UTC ms diff), ABW > 20 % off target, FCR > `maxFcrAlert`. Warnings are returned to the client, not stored.
- `applyHarvestToCage` (`:107-161`): partial subtracts; complete zeroes the cage, sets `harvested`, closes the newest open approved stocking with `closedAt = harvestDate`, and stores `cageEffect` for undo.
- No check of cage status, withdrawal period (`healthTreatments.withdrawalUntil`), or that the harvest date is after the stocking date.

**harvest.update** (`:263-315`): re-posts the cage effect only when `harvestType` or `estimatedCount` changes (undo then apply). Changing only `harvestDate` does not move `closedAt`. Not admin-gated.

**harvest.remove** (`:317-345`): deletes harvest samples, undoes the cage effect, deletes the record. Sales linked to the harvest are left pointing at a deleted id.

**Undo semantics** (`undoHarvestOnCage`, `:164-187`): partial → `currentCount += fishRemoved` unconditionally (even into a later cycle); complete → restore status/count only if the cage is still `harvested`, but **always** clear `closedAt` on the closed stocking. Combined with re-apply, editing an old complete harvest after restock closes and empties the new cycle (09 S5).

**Harvest FCR.** Stored as entered (`harvestRecords.fcr`, required number). The suggestion `harvestFcr` (`convex/lib/growth.ts:125-140`) = cycle feed ÷ (harvest kg − stocked biomass). For partial harvests this compares all feed to date against one partial's kg (09 C9).

**Harvest sampling / size grades.** `harvestRecords.sizeBreakdown` (array of `{category, range, weight}` from HarvestForm) and `harvestSampling` (`samples`, `sizeBreakdown` as `any`). No schema for grades; no grade master data; grades are not used by sales or reports.

Status: create/edit/delete with cage effect **Implemented but potentially defective**; harvest-sampling page **Implemented but potentially defective** (no cage effect, fixed FCR, kg ABW); withdrawal enforcement **Completely missing**.

---

## 9. Fish transfers

UI: `pages/fish-transfers.js` + `components/FishTransferForm.js` (one source, **one** destination, quantity, ABW; "full" checkbox fills `currentCount`) → `fishTransferService.create` → `fishTransfers.createFishTransfer`. Approval in `pages/approvals.js` / `pages/fish-transfers.js` → `approveFishTransfer`.

**createFishTransfer** (`convex/fishTransfers.ts:194-373`)
1. Source ≠ destination, both in the caller's company, `0 < qty ≤ source.currentCount` (pending transfers do not reserve fish, so several pending transfers can together exceed the source).
2. `transferType = full` if qty ≥ source count at creation (`fishTransferLogic.ts:5-10`) — frozen at creation.
3. Destination branch (`classifyDestination`): status in `allowStockOnlyEmptyStatuses` → create a destination `stockingHistory` row (new batch number, `initialBiomass = qty × abw / 1000`, species copied from source cage, `sourceCage` = source name); `active` → create a `topupHistory` row on the destination's latest approved stocking (open or closed); anything else rejected.
4. Status pending if `requireApprovalForFishTransfer` (default true), else approved and applied immediately.

**applyFishTransfer** (`:63-121`) on approval
- Source: re-reads count; throws if count < qty; full → count 0 + `empty`; partial → count − qty + `active`. Source stocking is **not** closed on a full transfer.
- Destination stocking branch: approves the linked stocking if still pending and **overwrites** the destination cage (`initialCount = currentCount = qty`, `stockingDate`, `initialAbw`, `status active`, `species`). If the destination was stocked by something else meanwhile, those fish are overwritten.
- Destination top-up branch: approves the linked top-up if pending and **adds** `topup.fishCount` to the destination cage **whether or not the top-up was already approved** (`:101-119`).

**rejectFishTransfer** (`:409-465`): rejects the transfer and the linked stocking/top-up **only if they are still pending**.

**Gaps.**
- No edit, delete or reversal of a transfer (the module exports list/get/create/approve/reject only).
- Approving the linked stocking or top-up through `stocking.approveStocking` / `approveTopup` is not blocked (pages `/stocking/[id]/details` and `/topup/[id]/details` offer Approve for any pending row). This produces double counting (09 S2, S3).
- Feed and cost history do not follow the fish; the source cycle keeps all its feed but loses the biomass (eFCR rises), the destination cycle gains biomass it was not fed for (eFCR falls) — see 09.
- Multiple destinations: **Partially implemented** (one record per destination, no grouping or atomic split). Batch merging: only via top-up, without blending ABW/biomass.

Status: **Implemented but potentially defective** (High confidence on the code paths; UI reachability of the double-approval path is via direct navigation to the details page, Medium confidence that users would do it).

---

## 10. Sales

`pages/sales.js` → `sales.createSale` (`convex/sales.ts:176-281`): customer or free-text buyer, weight, price; `totalAmount = round2(weight × price)`. With a `harvestId`, Σ sold kg may not exceed harvest kg + 0.05 kg. Without a harvest, sales are unlimited and need not be tied to a cage. `updateSale` (no UI caller) re-computes the total but does **not** re-check remaining harvest weight. `removeSale` is a hard delete (admin). Payment status is a flag (`pending/partial/paid`) with no amounts received. Sales do not touch fish counts (harvest already did). Revenue is per cage/date range, not per cycle.

Status: **Implemented but incomplete** (no receivables, no per-cycle attribution, edit bypasses the cap).

---

## 11. Reports

| Query | Consumer | What it computes |
|---|---|---|
| `reports.dashboardSummary` | `components/Dashboard.js:143` | Cage status counts, 30-day mortality, feed kg, feed cost, harvest count/kg, active fish (Σ `currentCount` of active cages), low-stock count. |
| `reports.dashboardKpis` | `components/Dashboard.js:142` | Mortality % (period deaths ÷ (active fish + period deaths)), mean of stored harvest FCRs, mean per-cage ABW slope, feed cost ÷ harvested kg. |
| `reports.productionReport` | `pages/report.js:92` | Feed, cost, mortality totals; mean harvest FCR; a pooled ABW slope across all selected cages; per-cage rows. |
| `reports.exportBundle` | `pages/export.js:47` | Raw rows and totals. |
| `reports.getCagePnL` / `listCagePnL` | `pages/pnl.js` | Revenue (sales) − feed cost (daily records) by cage and date range. |
| `reports.farmContextForAi` | `components/AiAssistant.js` | Snapshot for the assistant. |
| `reports.getProductionMetrics` | **no caller** | Dead code. |
| `cages.growth` / `cages.growthAll` | `pages/cages/[id].js`, `pages/feed-management/overview.js`, `pages/feed-purchases.js` | Cycle growth (ABW, biomass, feed, eFCR, SGR, ADG, survival) from `convex/lib/growth.ts`. |
| `cages.analytics` | no caller found | Status counts. |

All report queries are computed on read from raw rows (`.collect()` of whole tables, then filtered in memory). None are cycle-aware except `cages.growth*`. Formula-level comparison is in 09 §3.

Status: **Implemented but potentially defective** (inconsistent definitions; see 09).

---

## 12. Farm rules and warnings (`convex/lib/farmRules.ts`)

Settings live in `companies.settings` (`convex/schema.ts:63-124`), merged over defaults by `mergeSettings` (`:92-141`; it silently widens a legacy 5–80 g initial ABW range to 1–500 g).

| Rule | Default | Enforced where | Blocking? |
|---|---|---|---|
| `allowStockOnlyEmptyStatuses` | empty, fallow, harvested | stocking create, transfer destination classification | Yes (not on approval) |
| initial ABW range | 1–500 g | stocking create, transfer → empty cage | Yes |
| top-up ABW range | 1–800 g | top-up create, transfer → active cage | Yes |
| `enforceCageCapacity` + `cage.capacity` | true | stocking/top-up create | Yes (not on approval) |
| `maxDensityFishPerM3` | 80 | stocking/top-up create (`cage.size` as m³) | Yes |
| require approval (stocking/top-up/transfer) | true / true / true | create paths | Workflow |
| `targetHarvestAbwG`, DOC min/max, `maxFcrAlert` | 600 g, 150–210 d, 1.8 | `harvestWarnings` at harvest create | Warning only |
| `dailyMortalityAlertPct`, `cumulativeMortalityAlertPct` | 0.5 %, 10 % | daily record insert | Notification |
| `targetFcr` | 1.4 | not referenced by server code (UI colour bands use their own thresholds, e.g. `pages/cages/[id].js:37-38` uses 1.6/2.0, `components/Dashboard.js:72-75` uses 1.4/1.8) | — |
| feed rules (negative stock, lots, bag size, batch on purchase, multiplier) | see file | ledger, purchase, alerts | Yes |

Client analytics pages hard-code a 120-day harvest threshold (`pages/cages/analytics.js:139`, `pages/cages/analytics/harvest.js:48`, `lib/databaseService.js` `getHarvestReadiness`), ignoring `harvestDocMinDays`.

Status: **Implemented but incomplete** (rules checked only at creation; some settings unused).

---

## 13. Reminders

`convex/crons.ts` runs `internal.reminders.dailyDigest` daily at 16:00 UTC. For each approved company (`convex/reminders.ts:45-118`): active cages with no daily record for today's **UTC** date → one notification per active user (dedupe key `missed-entry:<date>:<user>`), linking to `/daily-entry?cages=…`; feed types with `currentStock ≤ minimumStock` (company-wide, no multiplier, no per-site view) → admins (`low-stock:<date>:<user>`). `runForMyCompanyNow` lets an admin trigger it. Reads are bounded with `.take()`. Tested in `convex/reminders.test.ts`.

Status: **Implemented and working** (scope limited to missing entries and low stock; no reminders for overdue sampling, withdrawal periods, harvest windows or pending approvals).

---

## 14. Expenses and production cost

No expense, fingerling-cost, labour, energy, treatment-cost or overhead tables exist (schema search: no `expense*`/`cost*` table; `stockingHistory` has no price field; `healthTreatments` has no cost). The only cost captured is `dailyRecords.feedCost = feedAmount × feedPrice` (price snapshot at entry). P&L states this explicitly (`pages/pnl.js` description). Cost per kg produced, cost per fish, and cycle cost are not computed anywhere on the server except `dashboardKpis.feed_cost_per_kg_harvested` (period feed cost ÷ period harvest kg, unrelated populations).

Status: **Completely missing** for non-feed costs; feed cost **Implemented but incomplete**.

---

## 15. Can history be reconstructed?

| Question | Answer | Why |
|---|---|---|
| Fish on hand in cage X on date D | **No** (reliably) | No fish movement ledger. Approximate rebuild = approved stockings (overwrite semantics!) + approved top-ups − daily mortality − harvest `cageEffect.fishRemoved` − transfers out + transfers in. Breaks on: clamped mortality, overwrite on approval, `createFromSampling` harvests (no effect), manual `cages.update` count edits (only in `auditLogs`), cage hard-deletes, approval timestamps vs business dates. |
| Cycle performance after the fact | **Partially** | `cages.growth` only reports the *current/latest* cycle. Daily/biweekly rows can be windowed by a past stocking's dates, but `liveCount` comes from the live cage row, so a past cycle's survival/biomass cannot be recomputed. |
| Feed stock company-wide over time | **Yes, by server time** | Signed ledger + `stockTally`; but `transactionDate` is insertion time, not purchase/usage date, so back-dated entries appear on the day they were typed. |
| Feed stock per site over time | **No** | Transfers write one row without the source site; adjustments, purchase edits, voids and reversals often carry no `locationId`; lot rows are mutated and deleted in place. |
| Who changed what | **Partially** | `auditLogs` via `logAudit` on most mutations (previous/new values). Derived side effects (cage count changes inside harvest/daily/transfer mutations) are not logged as separate entries. |
| Lineage of fish | **One hop** | `fishTransfers` links; no multi-hop or split/merge model. |

---

## 16. Capability status summary

| Capability | Status | Confidence |
|---|---|---|
| Cage lifecycle / statuses | Implemented but potentially defective | High |
| Stocking + approval | Implemented but potentially defective | High |
| Top-ups | Implemented but incomplete | High |
| Live population (`currentCount`) | Implemented but potentially defective | High |
| Mortality recording + alerts | Implemented but potentially defective | High |
| Daily feeding → ledger | Implemented and working | High (tested) |
| Per-site feed stock | Implemented and working (main paths); defective for edit/void/reversal/adjustment | High |
| Purchases | Implemented and working; price not fed into cost | High |
| Feed transfers between sites | Implemented but incomplete (no source row, no reversal) | High |
| Bi-weekly sampling + ABW sync | Implemented but potentially defective | High |
| Harvest (complete/partial, cage effect) | Implemented but potentially defective | High |
| Harvest sampling page | Implemented but potentially defective | High |
| Size grades | Partially implemented (stored, unused) | High |
| Fish transfers | Implemented but potentially defective | High |
| Batch splitting / multiple destinations | Partially implemented | High |
| Batch merging | Partially implemented (top-up only) | High |
| Lineage | Partially implemented | High |
| Species | Implemented but incomplete | High |
| Sales | Implemented but incomplete | High |
| Reports / KPIs | Implemented but potentially defective | High |
| Farm rules | Implemented but incomplete | High |
| Reminders | Implemented and working | High (tested) |
| Withdrawal-period enforcement | Completely missing | High |
| Non-feed production costs / expenses | Completely missing | High |
| Fish movement ledger / history reconstruction | Completely missing | High |

## Risks (ranked)

1. **Critical** — Editing an old complete harvest's count/type after restock zeroes and closes the new cycle (`convex/harvest.ts:285-303` + `:164-187`); reachable from `pages/harvest.js` by any user.
2. **High** — Double counting via approving transfer-linked top-ups/stockings directly (`convex/stocking.ts:385-427,552-595`; `convex/fishTransfers.ts:80-120,437-456`).
3. **High** — Count overwrite on stocking approval / transfer to an empty cage (no state re-check).
4. **High** — Previous-cycle ABW carried into a new cycle (`cages.currentWeight` not reset).
5. **High** — Feed reversals unlinked from daily records; same transaction reversible repeatedly.
6. **Medium** — Harvest-sampling page writes harvests with no cage effect, FCR 1.5, ABW in kg.
7. **Medium** — Mortality/edits not scoped to cycles; clamps lose information.
8. **Medium** — No non-feed cost model; P&L margin overstated.

## Outstanding questions (for the owner)

1. Is `pages/harvest-sampling.js` meant to record a harvest, or a pre-harvest sample? Its output is currently counted as a complete harvest in reports.
2. Should feed *issue* to a cage and the daily feed entry be the same event (one deduction) or two steps (store → cage-side bin → fish)?
3. Is `stockingHistory` the intended "batch", or does the business need batches that move between cages (lineage across splits/merges)?
4. Which costs should P&L include (fingerlings, labour, treatments, energy)?
5. Should approval of stocking/top-up re-validate capacity/status at approval time?
6. Are business dates or entry times authoritative for feed stock history?
