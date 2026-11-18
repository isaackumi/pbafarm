# 09 — Production calculation audit

## Stage header

**Objective.** For every production calculation (biomass, ABW, FCR/eFCR, survival, mortality %, SGR, ADG, DOC, feed cost, cost per kg, margins, stock values), record where it is computed, its inputs, formula, whether it is stored or computed on read, rounding, edge cases, whether history can change silently, and where modules disagree. Then test stock-consistency scenarios by reading the code, and list the calculations that should become shared services.

**Files inspected.** `convex/lib/growth.ts`, `convex/lib/farmRules.ts`, `convex/lib/feedLedger.ts`, `convex/lib/fishTransferLogic.ts`, `convex/{cages,stocking,dailyRecords,biweeklyRecords,harvest,fishTransfers,feed,inventory,sales,reports,reminders}.ts`, `convex/*.test.ts`; client: `components/{Dashboard,HarvestForm,DailyEntryForm,BulkDailyUploadForm,BulkBiweeklyUploadForm,BiweeklyEntryForm,BiweeklyForm,FishTransferForm,TopUpForm,StockingForm}.js`, `pages/{harvest,harvest-sampling,stocking-management,report,pnl,approvals,biweekly-records}.js`, `pages/cages/[id].js`, `pages/cages/analytics.js`, `pages/cages/analytics/{growth,harvest}.js`, `pages/feed-management/overview.js`, `lib/{databaseService,stockingService}.js`, `contexts/AnalyticsContext.js`. Search terms run over `convex/ lib/ pages/ components/ contexts/`: `fcr, biomass, survival, sgr, adg, abw, feedCost, feed_cost, costPerKg, cost_per_kg, mortalityRate, mortality_rate, growth, /1000, *1000`.

**Findings (summary).**
1. There is one well-formed growth library (`convex/lib/growth.ts`), but it reads the *live* cage count and the cage's *latest* ABW, so cycle figures are wrong after restock, top-ups, transfers and partial harvests, and closed-cycle figures collapse to zero after a complete harvest.
2. Four different "FCR" numbers exist: cycle eFCR (computed), farm eFCR (computed), harvest FCR (typed by the user, pre-filled from a suggestion, or hard-coded 1.5) and report "avg FCR" (unweighted mean of stored harvest FCRs).
3. Four different "growth per day" and three different "mortality %" definitions exist across server reports and pages; one report pools samples from different cages into a single slope.
4. Stored values that never recompute: harvest FCR, daily feed price/cost, stocking initial biomass (client-computed), biweekly totals. Values that silently change on read: everything from `cageCycleGrowth`, all report KPIs.
5. Stock consistency: the fish count can be double-counted through approvals, overwritten on approval, zeroed by editing an old harvest, and pushed into the wrong cycle by edits to past records. No transfer can be corrected. Details in §5 (16 scenarios: 1 Critical, 8 High, 7 Medium).

**Dependencies.** 08 (business flows), 04/05 (schema/relationships), 07 (role checks on edit paths).

**Risks.** Management KPIs (eFCR, survival, mortality %, cost per kg) can be wrong without any visible error; fish inventory can drift or double; edits can corrupt a later cycle.

**Outstanding questions.** End of document.

**Completion status.** Complete. All findings are from code reading; scenarios were not executed (only `npm test` was permitted and the existing suite does not cover them — 17 tests pass). Confidence per item.

---

## 1. Calculation inventory

Legend — **S** stored at write time, **R** computed on read, **C** computed in the browser.

| ID | Metric | Location | Inputs | Formula | S/R/C | Rounding |
|---|---|---|---|---|---|---|
| C1 | Biomass (kg) | `convex/lib/growth.ts:6-7` | count, ABW g | `count × abw / 1000`, 0 if either ≤ 0 | helper | none |
| C2 | FCR | `growth.ts:10-13` | feed kg, gain kg | `feed / gain`; null if feed ≤ 0 or gain ≤ 0 | helper | none |
| C3 | SGR %/day | `growth.ts:16-19` | ABW start/end, days | `(ln end − ln start)/days × 100`; null on non-positive inputs | helper | none |
| C4 | ADG g/day | `growth.ts:22-25` | ABW start/end, days | `(end − start)/days`; null on non-positive inputs (negative growth allowed) | helper | none |
| C5 | Days between | `growth.ts:27-30` | ISO dates | noon-UTC diff, `round`, `max(0, …)` | helper | integer |
| C6 | Cycle growth bundle | `growth.ts:53-119` (`cageCycleGrowth`) → `cages.growth` `convex/cages.ts:115-125` | open/latest approved stocking; biweekly in window; daily in window; `cage.currentCount`; `cage.currentWeight` | see §2.1 | R | ABW/biomass/feed 1 dp; eFCR/SGR/ADG/cost 2 dp; survival 1 dp |
| C7 | Farm eFCR, farm biomass | `convex/cages.ts:131-158` (`growthAll`) | C6 per active cage (max 300) | `Σfeed / Σgain` over cages with a stocking date and gain > 0; biomass `Σ current_biomass_kg` | R | eFCR 2 dp; biomass integer |
| C8 | Suggested harvest FCR | `growth.ts:125-140` (`harvestFcr`) → `harvest.suggestFcr` `convex/harvest.ts:190-204` → `components/HarvestForm.js:76-97` | C6 as of harvest date; harvest kg typed | `cycleFeed / (harvestKg − initialBiomass)` | R, then copied into form | 2 dp |
| C9 | Harvest FCR (recorded) | `harvestRecords.fcr`; `harvest.create`/`update`; `harvest.createFromSampling` `convex/harvest.ts:408` | user value or C8; or literal `1.5` | as entered | **S** | as typed |
| C10 | Cage current ABW | `growth.ts:143-155` (`syncCageAbw`) | all biweekly rows of the cage | ABW of latest-dated row, any cycle | **S** (`cages.currentWeight`) | none |
| C11 | Daily feed cost | server: `convex/dailyRecords.ts:407-426` (`createBatch`: `feedType.pricePerKg`), `:494-502` (`update` re-prices at *current* price); client: `components/DailyEntryForm.js:57-64`, `lib/databaseService.js:47-48,124-126,198`, `components/BulkDailyUploadForm.js:65-75` | kg, price | `kg × price` | **S** (`feedPrice`, `feedCost`) | none |
| C12 | Daily mortality % | `convex/lib/farmRules.ts:312-315` | mortality, count before deduction | `mortality / count × 100` | R (alert only) | `toFixed(2)` in message |
| C13 | Cumulative mortality % | `farmRules.ts:317-324` | `cage.initialCount`, `cage.currentCount` after deduction | `max(0, initial − current) / initial × 100` | R (alert only) | `toFixed(1)` |
| C14 | Survival % | `growth.ts:107` | `liveCount`, `stockedCount` | `live / stocked × 100` | R | 1 dp |
| C15 | DOC | server `growth.ts:103` (C5); `convex/harvest.ts:228-234` (floor of raw ms diff, UTC midnight parse); client `pages/harvest-sampling.js:55-58` (floor, ≥ 0), `pages/biweekly-entry.js:54-55` (**ceil of abs** diff), `pages/cages/analytics.js:138,157`, `pages/cages/analytics/{growth,harvest}.js:47` (floor vs *now* local time) | stocking date, date | various | R/C | integer, differing |
| C16 | Initial biomass (stocking) | client `lib/stockingService.js:126-131` (`count × abw / 1000` unless supplied), `pages/stocking-management.js:199-208`; server trusts `args.initialBiomass` (`convex/stocking.ts:224-275`) | count, ABW | `count × abw / 1000` | **S** | none (stocking-management shows 2 dp) |
| C17 | Transfer biomass | `convex/lib/fishTransferLogic.ts:12-14`; client `components/FishTransferForm.js:91` | qty, ABW | `qty × abw / 1000` | **S** (`fishTransfers.biomass`, destination stocking `initialBiomass`) | none |
| C18 | Top-up biomass | `convex/stocking.ts:719` (approvals list), `components/TopUpForm.js:107`, `pages/topup/[id]/details.js` | count, ABW | `count × abw / 1000` | R/C (never stored, never added to cycle biomass) | 2 dp in form |
| C19 | Harvest count from weight | `components/HarvestForm.js:143-147` | total kg, ABW g | `round(total × 1000 / abw)` | C → S | integer |
| C20 | Harvest total from grades | `components/HarvestForm.js:136-141` | grade kg | `Σ grades`, 2 dp | C → S | 2 dp |
| C21 | Harvest-sampling ABW | `pages/harvest-sampling.js:63-66`, `convex/harvest.ts:404-406` | weight **kg**, count | `weight / count` → **kg per fish** stored as `averageBodyWeight` | S | 2 dp (client) |
| C22 | Bi-weekly ABW | `components/BiweeklyEntryForm.js:73-93` | sub-sample g and counts | per sample `g / n`; overall `Σg / Σn` (weighted) | S | 2 dp per sample |
| C23 | Bi-weekly totals | BiweeklyEntryForm (sample n, sample **g**); `BulkBiweeklyUploadForm.js:51-54` and `BiweeklyForm.js:47-61` (population n, `abw × n / 1000` **kg**) | — | — | S | none |
| C24 | Dashboard mortality % | `convex/reports.ts:166-169` | period deaths (all cages in scope), active fish (active cages only) | `deaths / (activeFish + deaths) × 100` | R | `toFixed(1)` in `Dashboard.js:164-167` |
| C25 | Dashboard avg FCR | `reports.ts:156-163` | stored C9 of harvests in period | unweighted mean of `fcr > 0` | R | `toFixed(2)` |
| C26 | Dashboard avg daily growth | `reports.ts:123-152` | biweekly rows in period, per cage | per cage `(lastABW − firstABW)/max(1, ceil(days))`, then unweighted mean across cages | R | `toFixed(1)` |
| C27 | Feed cost per kg harvested | `reports.ts:164,181-182` | period feed cost (all cages), period harvest kg | `cost / kg` | R | `toFixed(2)` |
| C28 | Report avg FCR | `reports.ts:429-432` | stored C9 of harvests in range | unweighted mean, **includes 0/invalid** | R | `toFixed(2)` (`pages/report.js:361`) |
| C29 | Report avg growth | `reports.ts:433-446` | **all** biweekly rows of **all** selected cages | `(ABW of latest row − ABW of earliest row)/days` — rows may be different cages | R | `toFixed(2)` |
| C30 | Report per-cage latest ABW | `reports.ts:453,462` | biweekly rows in range | latest row | R | none |
| C31 | Production metrics (dead code) | `reports.ts:303-374` | per cage | mortality `deaths/(count+deaths)`, feed/fish, cost/fish (current count), ABW slope | R | none |
| C32 | Cage P&L | `reports.ts:571-638`, `:641-700`; totals `pages/pnl.js:52-58` | sales `totalAmount`, daily `feedCost` in date range | margin `revenue − feedCost`; `margin / revenue × 100` | R | none |
| C33 | Sale amount | `convex/sales.ts:252-253`, `:326` | kg, price | `round(kg × price, 2)` | S | 2 dp |
| C34 | Feed stock value | `convex/inventory.ts:128` | stock (company or site), `feedType.pricePerKg` | `stock × price` | R | none |
| C35 | Average price in stock | `pages/feed-management/overview.js:91-107` | all feed types | `Σ(stock × price) / Σ stock` | C | money format |
| C36 | Low-stock flags | `inventory.ts:117-129` (`min × multiplier`, `≤`, no `min > 0` guard), `inventory.ts:445-452` (`min > 0`, `min × multiplier`), `reports.ts:76-82` (`min > 0`, `≤ min`), `reminders.ts:75-81` (same), `overview.js:93-98` (`min × 1.2`), `reports.ts:563` (`≤ min`, no guard) | — | — | R/C | — |
| C37 | Bags ↔ kg | `convex/lib/feedLedger.ts:18-26` (default bag 20 kg), `applyStockChange` (`feedRules.defaultBagSizeKg`, also 20), `convex/feed.ts:54-61` (description regex, then 20) | — | `kg / size`, `bags × size` | S/R | 3 dp |
| C38 | Site stock | `feedLedger.ts:90-106` | lots, `currentStock` | `own + unassigned lots + max(0, currentStock − Σlots)` | R | none (1 dp in messages) |
| C39 | Stocked biomass KPI | `components/Dashboard.js:129-137` | latest stocking row per active cage (any status, incl. pending/rejected) | `Σ initial_biomass` | C | integer |
| C40 | Growth analytics page | `pages/cages/analytics/growth.js:43-56` | `cage.initial_weight`, `current_weight` | `(cur − init)/init × 100`, `/doc` | C | 2 dp |
| C41 | Harvest warnings | `farmRules.ts:278-310` | DOC (C15 harvest variant), ABW, FCR | DOC range; `|abw − target|/target > 0.2`; `fcr > maxFcrAlert` | R at create | — |
| C42 | Harvest-ready filter | `convex/cages.ts:76-81` | `cage.currentWeight` (C10) | `≥ targetHarvestAbwG` | R | — |
| C43 | Client analytics placeholders | `contexts/AnalyticsContext.js:64-95` | — | returns zeros | C | — (stub) |

---

## 2. Detail on the core calculations

### 2.1 `cageCycleGrowth` (C6) — the only cycle-aware calculation

Inputs and derivation (`convex/lib/growth.ts:53-119`):

| Quantity | Source | Problem |
|---|---|---|
| Cycle | `currentStocking`: approved, not deleted, newest by `stockingDate`, preferring one without `closedAt` (`:38-47`) | Ties on the same date resolve by array order. A stocking left open by a full transfer out (never closed) can be picked when a cage has no newer stocking. |
| Start / end | `stocking.stockingDate` (or `cage.stockingDate`), `closedAt` or `asOf` | — |
| Initial ABW | `stocking.initialAbw` | Top-ups and transfers-in ignored. |
| Stocked count | `stocking.fishCount` | Excludes top-ups and transfers-in. |
| Initial biomass | `stocking.initialBiomass` (client-computed, C16) or C1 | Excludes top-up/transfer-in biomass. Not re-derived if the stocking's count/ABW is edited without also sending biomass. |
| Current ABW | latest biweekly in window; **else `cage.currentWeight`**; else initial ABW (`:78`) | `currentWeight` is the latest sample of *any* cycle (C10), so a restocked cage shows the previous cycle's harvest ABW. The UI note "Growth figures use the stocking weight until the first bi-weekly sample" (`pages/cages/[id].js:83-85`) is therefore wrong after the first cycle. |
| Feed kg / cost / mortality | Σ daily records in window (`:81-91`) | Feed issued via `feed.createIssue` to the cage is not included. |
| Live count | **`cage.currentCount`** (`:93`); only if undefined, `stocked − mortality` | Uses *today's* count even when computing as of a past date (harvest FCR) or for a closed cycle. After a complete harvest `currentCount = 0` → current biomass 0, gain negative, eFCR null, survival 0 % for the "Last cycle" panel. |
| Gain | `currentBiomass − initialBiomass` | Partial harvests and transfers out remove biomass that was fed (gain understated → eFCR overstated); top-ups/transfers in add biomass that was not fed (gain overstated → eFCR understated). |
| eFCR | C2 | 2 dp; null when no gain. |
| SGR / ADG | C3/C4 between stocking date and the ABW date | When no sample in cycle, `abwDate = startDate` → days 0 → null (correct), unless the carry-over ABW is used, in which case days = 0 still → null, but biomass and eFCR are wrong. |
| Survival | `live / stocked` (C14) | Exceeds 100 % after top-ups/transfers in; harvested and transferred-out fish counted as dead. |

Recalculated: on every read (Convex reactive query). Historical values are not stored, so the panel for a past cycle changes whenever anything about the cage changes.

### 2.2 FCR variants

| Variant | Numerator | Denominator | Where shown |
|---|---|---|---|
| Cycle eFCR (C6) | cycle daily feed | current biomass (live count × latest ABW) − initial biomass | cage page |
| Farm eFCR (C7) | Σ feed of active cages with positive gain | Σ positive gains | feed overview, feed purchases |
| Suggested harvest FCR (C8) | cycle feed to harvest date | this harvest's kg − **whole** initial biomass | harvest form pre-fill |
| Recorded harvest FCR (C9) | user | user | harvest list, export, reports |
| Report/dashboard avg FCR (C25, C28) | — | unweighted mean of recorded FCRs | dashboard, report |

Inconsistencies: C8 for a **partial** harvest compares all feed to date with one partial's weight (often gain ≤ 0 → null, forcing manual entry; or very high). Second partial: same feed again. C25/C28 weight a 100 kg partial harvest equally with a 10 t complete harvest; C28 includes FCR values of 0; both include the hard-coded 1.5 from `createFromSampling`. C7 drops cages with non-positive gain (e.g. right after a mass mortality) — excluding exactly the poor performers its comment says it should surface (`convex/cages.ts:127-130`). None uses `targetFcr` (unused setting).

### 2.3 Mortality and survival variants

| Variant | Definition | Population base |
|---|---|---|
| C12 daily alert | today's deaths ÷ count before | live cage |
| C13 cumulative alert | `(initialCount − currentCount)/initialCount` | cage fields; counts harvest/transfer-out as losses; top-ups hide losses; stale after stocking edits (cage not updated) |
| C14 survival | `currentCount / stocking.fishCount` | mixes live cage with stocking row |
| C24 dashboard | period deaths ÷ (active-cage fish + period deaths) | deaths include harvested/empty cages, base excludes them |
| C31 (dead) | `deaths / (count + deaths)` | per cage |

### 2.4 Growth-rate variants

| Variant | Definition |
|---|---|
| C4 ADG (cage page) | `(currentABW − stockingABW)/days since stocking` |
| C3 SGR (cage page) | log-based, same interval |
| C26 dashboard | per cage, first vs last sample **in the last N days** (crosses cycles: a restock inside the window gives a large negative slope), `ceil` days, unweighted mean of cages |
| C29 report | first vs last sample across **all selected cages pooled** — meaningless for > 1 cage |
| C40 analytics page | relies on `cage.initial_weight`, which no production flow writes, so the page filters every cage out |

### 2.5 Cost

- Feed price per daily record is a snapshot (C11). `createBatch` uses the feed type's list price; `create`/`createMany` trust the client. `update` re-prices the record at the **current** list price whenever feed amount or type changes, so correcting a quantity months later also changes its unit price.
- `feedTypes.pricePerKg` is maintained by hand (`feed.updateFeedType`); purchase prices (`feedPurchases.pricePerKg`) never flow into it or into lots, so no weighted-average or FIFO costing exists.
- Cost per kg (C27) divides period feed cost of all cages by period harvest kg of other cages/cycles. No cost per cycle, per fish, or per kg produced exists elsewhere (C31 is dead code).
- P&L margin (C32) = revenue − feed cost; fingerlings, treatments, labour absent (see 08 §14).

### 2.6 Rounding summary

Server stores raw floats for feed kg, cost, biomass, ABW; rounds only for display in `growth.ts` (`round()` helper, `:32-33`), `growthAll`, `bagsFromKg` (3 dp), `reverseDailyFeed` outstanding (3 dp, `convex/dailyRecords.ts:132`), sale totals (2 dp), and the partial-harvest count (`Math.round`, `convex/harvest.ts:116`). Reports return raw floats; pages apply `toFixed`. Currency amounts are stored as raw floats (no minor units).

---

## 3. Cross-module inconsistencies

| # | Topic | Module A | Module B | Effect | Severity |
|---|---|---|---|---|---|
| X1 | FCR | C6/C7 computed eFCR | C25/C28 mean of typed harvest FCR | Dashboard "Avg FCR" and cage eFCR disagree by construction | Medium |
| X2 | Harvest FCR source | HarvestForm suggestion (C8) | harvest-sampling literal 1.5 | Fake FCRs enter averages | Medium |
| X3 | ABW units | grams everywhere | `createFromSampling` kg (C21) | Harvest ABW 1000× too small; `harvestWarnings` not run on that path | Medium |
| X4 | Biweekly totals | sample g / sample n (form) | population n / kg (CSV) | `growth_rows` in reports mix units | Low |
| X5 | Mortality % | C12/C13/C14/C24 | — | Four different answers for "mortality" | Medium |
| X6 | Growth/day | C4/C26/C29/C40 | — | Dashboard and report growth not comparable with cage page; C29 wrong for multi-cage | Medium |
| X7 | DOC | `daysBetween` round @ noon UTC | harvest floor @ UTC midnight; biweekly `ceil(abs)`; analytics floor vs local now | ±1 day differences; biweekly entry shows positive DOC for dates before stocking | Low |
| X8 | Harvest threshold | `farmRules.harvestDocMinDays` (150) | hard-coded 120 days in `pages/cages/analytics.js:139`, `pages/cages/analytics/harvest.js:48`, `lib/databaseService.js` `getHarvestReadiness` | Harvest-readiness views ignore settings | Low |
| X9 | Low-stock threshold | multiplier (inventory) | 1× (dashboard, reminders), 1.2× (overview), no guard (AI) | Different counts of "low" feed types on different screens | Low |
| X10 | FCR colour bands | `targetFcr` 1.4 / `maxFcrAlert` 1.8 settings | cage page 1.6/2.0 (`pages/cages/[id].js:37-38`); dashboard 1.4/1.8 hard-coded (`components/Dashboard.js:72-75`) | Settings not honoured in UI | Low |
| X11 | Initial biomass | client-computed (C16), trusted by server | transfer biomass server-computed (C17) | A client can store a biomass inconsistent with count × ABW; edits in stocking-management recompute client-side only | Low |
| X12 | Stocked biomass KPI | C39 includes pending/rejected latest stocking | C6 uses approved only | Dashboard KPI may include unapproved fish | Low |
| X13 | Bag size default | `feedRules.defaultBagSizeKg` in ledger/stock levels | literal 20 in `bagsFromKg`, `createFeedType`, `toClientFeedType` (plus description regex) | Bag counts differ when a company changes the default | Low |

---

## 4. Can historical values change silently?

| Value | Stored? | Changes when | Silent? |
|---|---|---|---|
| Cycle ABW/biomass/eFCR/survival (C6) | No | Any later count change, sample edit, restock, harvest | **Yes** — past cycles are not snapshotted; a closed cycle's survival becomes 0 % after harvest |
| Harvest FCR (C9) | Yes | Never recomputed when daily feed or samples are edited | Stale rather than changing |
| Daily feed cost | Yes | Re-priced at current list price when amount/type edited | Yes (audit log only) |
| Cage `currentCount` | Yes | Edits/deletes of past daily records and harvests apply deltas to the *current* cage state, even across cycles | **Yes** |
| Stocking `closedAt` | Yes | Harvest edit/delete reopens it; editing harvest date does not move it | Yes |
| Report KPIs (C24–C32) | No | Any underlying row change; window-based | Yes |
| Feed ledger rows | Yes (append-only) | Never edited; corrections are new rows | No (good) |
| Feed lots | Yes | Mutated/deleted in place | Yes (no lot history) |
| Sales totals | Yes | Recomputed on edit | Audit only |

---

## 5. Stock-consistency scenarios (code-read)

Severity: Critical (silent corruption of fish inventory or another cycle, reachable from normal UI), High (corruption reachable via UI or public API by an admin, or wrong core KPI), Medium, Low.

**S1 — Transfer A→B approved, then needs editing or deleting.**
Expected: an edit/reversal that restores A, removes from B, and keeps both histories.
Actual: no mutation exists (`convex/fishTransfers.ts` exports list/get/create/approve/reject only); reject works only while pending. The only correction is an admin hand-editing both cages' `currentCount` (`convex/cages.ts:252-254`), leaving the transfer row, the destination stocking/top-up and the source cycle untouched.
Verdict: **Completely missing** (correction path). Severity **High**. Confidence High.

**S2 — Transfer into an active cage counted twice.**
Steps: create transfer (pending) → linked pending top-up is created → admin opens `/topup/<id>/details` and clicks Approve (`pages/topup/[id]/details.js:69-77`) → `approveTopup` adds qty to B (`convex/stocking.ts:580-586`) → admin approves the transfer → `applyFishTransfer` subtracts from A and adds `topup.fishCount` to B **again** (`convex/fishTransfers.ts:101-119`; no check that the top-up was already approved).
Expected: B +qty once. Actual: B +2·qty, A −qty. Variant: approve the top-up, then reject the transfer → `rejectFishTransfer` leaves the approved top-up alone (`:447-456`) → B +qty, A unchanged (fish duplicated).
Verdict: **Implemented but potentially defective**. Severity **High** (admin + direct navigation; approvals page hides linked rows only in the UI, `convex/stocking.ts:656-669`). Confidence High.

**S3 — Transfer into an empty cage approved via the stocking page.**
Steps: pending transfer → linked pending stocking → admin approves it at `/stocking/<id>/details` (`approveStocking`, `convex/stocking.ts:385-427`) → B = qty, A unchanged → transfer then rejected → stocking stays approved.
Expected: fish exist once. Actual: fish exist in A and B. If the transfer is approved instead, A is decremented and B is overwritten to qty again (no doubling, but approval order matters).
Verdict: defective. Severity **High**. Confidence High.

**S4 — Partial harvest, then mortality, then harvest correction.**
Steps: count 1 000; partial harvest 400 → 600 (`fishRemoved 400`); mortality 20 → 580; delete harvest → 980.
Expected 980. Actual 980 (correct). Edge: count 100; partial harvest 100 → 0 (status stays `active`); mortality 5 → `max(0, −5) = 0` (5 lost); delete harvest → 100 (should be 95). Also cumulative mortality alert treats the 400 harvested fish as losses (C13) → false "Cumulative mortality 40 %" alert on the next mortality entry; survival (C14) shows 58 %.
Verdict: count logic **Implemented and working** except at the zero clamp; alerts/KPIs **defective**. Severity **Medium**. Confidence High.

**S5 — Edit an old complete harvest after the cage has been restocked.**
Steps: cycle 1 complete harvest H1 (cage 0, `harvested`, stocking 1 closed) → stock cycle 2 (cage 5 000, `active`) → user edits H1's fish count in `pages/harvest.js` (`harvest.update`, any company user).
Code: `cageTouched` → `undoHarvestOnCage` (`convex/harvest.ts:164-187`): cage not `harvested` → count/status kept, but stocking 1 `closedAt` cleared → `applyHarvestToCage` complete (`:132-160`): open stockings are now 1 and 2; newest (2) is closed with H1's (earlier) date; cage set to 0 and `harvested`.
Expected: only H1's record changes. Actual: cycle 2 is closed with a date before it started, its 5 000 fish disappear, and stocking 1 is left open forever.
Verdict: **Implemented but potentially defective**. Severity **Critical**. Confidence High (traced line by line; not covered by `convex/harvest.test.ts`).

**S6 — Delete an old partial harvest after a later complete harvest/restock.**
Code: partial undo adds `fishRemoved` to whatever is in the cage now (`convex/harvest.ts:183-185`).
Expected: no effect on a later cycle. Actual: phantom fish added to cycle 2 (or to an emptied cage).
Verdict: defective. Severity **High** (delete is admin-only, `:321`). Confidence High.

**S7 — Restock after harvest: growth figures.**
Code: no stocking path resets `cages.currentWeight` (`convex/stocking.ts:278-286,410-418`; `convex/fishTransfers.ts:90-98`); C6 falls back to it (`growth.ts:78`).
Expected: ABW = stocking ABW until first sample. Actual: previous harvest ABW (e.g. 600 g on 10 g fingerlings) → biomass ×60, eFCR near 0, "harvest-ready" filter (C42) lists the new cage.
Verdict: defective. Severity **High**. Confidence High.

**S8 — Daily record edited or deleted after a complete harvest.**
Code: `dailyRecords.update` (any company user) / `remove` (admin) apply mortality deltas to the current cage count with no cycle check (`convex/dailyRecords.ts:511-520,562-570`); feed reversal and re-deduction work, but the harvested cycle's stored harvest FCR is not recomputed.
Expected: closed cycle's history corrected; cage count of the next cycle untouched. Actual: lowering a past mortality adds fish to a harvested/empty or restocked cage; raising it is clamped on an empty cage. No UI currently calls these mutations (`lib/databaseService.js:109-155` unused), so reachability is via the public API.
Verdict: defective. Severity **High** (latent; becomes Critical once an edit UI ships). Confidence High.

**S9 — Two stockings approved for the same cage.**
Steps: two pending stockings for an empty cage (both pass the status check at creation) → approve both.
Code: `approveStocking` overwrites `initialCount/currentCount` without re-checking status/capacity (`convex/stocking.ts:409-418`).
Expected: second approval refused or treated as a top-up. Actual: first stocking's fish vanish from the count; first stocking stays open. Same via a transfer into a cage that has a pending ordinary stocking.
Verdict: defective. Severity **High**. Confidence High.

**S10 — Full transfer created, then source count changes before approval.**
Code: `transferType` frozen at creation (`convex/fishTransfers.ts:228`); on approval `full` → source count 0 (`fishTransferLogic.ts:32-38`).
Cases: mortality reduces source below qty → approval throws "Insufficient fish" (`:67-69`), must reject and recreate (safe). Top-up approved on source in between → approval zeroes the source, the extra fish vanish (not moved). Several pending partial transfers can together exceed the source; later ones fail at approval (safe).
Verdict: partially defective. Severity **Medium**. Confidence High.

**S11 — Transfer counted in both cycles' performance.**
Code: C6 for source keeps all feed, loses transferred biomass; destination stocking gets `initialBiomass = transfer biomass` (correct for a new cycle) but a top-up destination gets no initial biomass credit.
Expected: biomass and feed attributed per cycle. Actual: source eFCR overstated, top-up destination eFCR understated and survival > 100 %.
Verdict: defective (KPI). Severity **Medium**. Confidence High.

**S12 — Harvest recorded via the sampling page and then via the harvest form.**
Code: `createFromSampling` inserts a `complete` harvest with no cage effect (`convex/harvest.ts:386-450`); a second, real harvest via HarvestForm then empties the cage.
Expected: one harvest. Actual: two harvest records, harvest kg double-counted in `dashboardSummary`, `dashboardKpis`, `productionReport`, P&L `harvest_kg`; fake FCR 1.5 averaged in.
Verdict: defective. Severity **Medium**. Confidence Medium (depends on how staff use the sampling page — see open question).

**S13 — Feed reversal of a daily usage row, then the daily record is edited.**
Steps: admin reverses the `daily_usage` transaction in `pages/inventory-transactions.js` (`inventory.reverseTransaction`, ledger row with `referenceId = transactionId`) → later the daily record's feed is edited → `reverseDailyFeed` nets only rows with `referenceId = dailyRecordId` and returns the stock again (`convex/dailyRecords.ts:89-145`).
Also: the same transaction can be reversed any number of times (`convex/inventory.ts:352-372` checks only reversal-of-reversal). Reversals carry no `locationId`, so lots return as unassigned stock.
Expected: one net return; site-correct. Actual: stock inflated by each extra reversal; daily record still counts the feed in FCR.
Verdict: defective. Severity **High**. Confidence High.

**S14 — Feed issued to a cage and also logged in the daily entry.**
Code: `feed.createIssue` with `cageId` and `dailyRecords.createBatch` both deduct (`convex/feed.ts:609-685`; `convex/dailyRecords.ts:37-82`); only the daily entry feeds FCR.
Expected: one deduction. Actual: two, unless staff use only one path.
Verdict: process ambiguity. Severity **Medium**. Confidence Medium.

**S15 — Purchase edited/voided at a site with transferred stock.**
Code: `updatePurchase` adjustment and `voidPurchase` reversal pass no `locationId` (`convex/feed.ts:501-511,542-554`) → FIFO across all sites / new unassigned lot.
Expected: correction at the purchase's site. Actual: another site's lots can be drawn down; site balances drift while company total stays right (`stockTally` still OK).
Verdict: defective. Severity **Medium**. Confidence High.

**S16 — Manual cage status change / cage delete.**
Code: any user can set status (`convex/cages.ts:218-275`); setting an active cage with fish to `empty` lets a new stocking pass `assertStockingAllowed` and overwrite the count. `cages.remove` hard-deletes and orphans all related rows.
Verdict: defective. Severity **Medium**. Confidence High.

Additional check — **"is a transfer counted twice in normal use?"** With approval through the transfer row only (the approvals page default), no: the source is decremented once and the destination incremented once, atomically in one mutation. Double counting requires S2/S3.

### Scenario summary

| ID | Scenario | Severity |
|---|---|---|
| S5 | Old complete-harvest edit after restock wipes new cycle | Critical |
| S2 | Linked top-up approved separately → double count | High |
| S3 | Linked stocking approved separately → duplicate fish | High |
| S6 | Old partial-harvest delete adds fish to later cycle | High |
| S7 | Previous-cycle ABW carried into new cycle | High |
| S8 | Past daily record edits move current count (latent) | High |
| S9 | Second stocking approval overwrites count | High |
| S13 | Feed reversals unlinked / repeatable | High |
| S1 | No transfer correction path | High |
| S4 | Partial harvest + mortality clamp; false alerts | Medium |
| S10 | Frozen transfer type vs changed source | Medium |
| S11 | Transfer distorts cycle KPIs | Medium |
| S12 | Sampling-page harvest double counts kg | Medium |
| S14 | Issue + daily entry double deduction | Medium |
| S15 | Purchase edit/void hits wrong site | Medium |
| S16 | Manual status/delete | Medium |

S8 becomes Critical as soon as an edit UI for daily records ships.

---

## 6. Calculations that should become shared services

| Service | Replaces | Why |
|---|---|---|
| **Fish movement ledger + population service** (append-only events: stock, top-up, mortality, harvest, transfer out/in, adjustment; count derived per cycle and as-of date) | the 12 writers in 08 §4 | Removes overwrites, clamps, cross-cycle deltas and double counting; enables history. |
| **Cycle (batch) service** — open/close, membership of daily/sample/harvest rows by `stockingId` | date-window inference in `growth.ts`, `closedAt` handling in `harvest.ts`, `findApprovedStockingForCage` in `fishTransfers.ts` | One definition of "current cycle"; edits scoped to their cycle. |
| **Growth/KPI service** — biomass, ABW as-of, eFCR (with harvested and transferred biomass credited), SGR, ADG, survival, DOC | C3–C6, C14, C15 variants, C24–C31, C39, C40, client DOC copies | One formula set used by cage page, dashboard, report, export and AI context. |
| **Harvest FCR service** — computed on save, stored with inputs (feed kg, gain kg), recomputed on upstream edits | C8/C9, literal 1.5 | Stops typed/fake FCRs. |
| **Feed costing service** — price per issue from purchase lots (FIFO or weighted average) | C11, C34, C35 | Real feed cost; consistent across create/update paths. |
| **Production cost / P&L service** — feed + fingerlings + treatments + other expenses per cycle | C27, C32 | Real cost per kg. |
| **Feed stock service** (already partly `feedLedger.ts`) — add site on every movement, two-legged transfers, reversal linkage | `inventory.createTransfer`, `reverseTransaction`, `updatePurchase`, `voidPurchase` | Per-site history and safe reversals. |
| **Threshold/rules service** — low stock, FCR bands, harvest readiness, mortality alerts from settings | X8–X10, C36 | One source for thresholds. |
| **DOC/date utility** | X7 | One day-count convention. |

---

## 7. Test coverage relevant to these calculations

Present (`npm test`, 17 passing): growth formulas and sample-driven eFCR (`convex/growth.test.ts`), harvest complete/partial/edit/delete/type switch (`convex/harvest.test.ts`), per-site feed stock (`convex/siteStock.test.ts`), reminders.
Not run: `convex/lib/fishTransferLogic.test.ts` (excluded by `vitest.config` `include: ['convex/*.test.ts']`).
Missing: every scenario in §5, restock carry-over (S7), approval interactions (S2, S3, S9), harvest edit across cycles (S5, S6), daily edits after harvest (S8), feed reversals (S13), report KPI definitions (C24–C32).

## Outstanding questions

1. Which FCR is the business's official figure: eFCR on standing biomass, harvest FCR, or both? Should harvest FCR ever be typed?
2. Should mortality % exclude harvested and transferred fish (standard) — and should survival count top-ups/transfers in the denominator?
3. Should a daily-record or harvest edit be allowed after its cycle is closed, and if so, should it re-open/recompute the cycle?
4. Is feed cost meant to follow purchase price (lot costing) or a manually set list price?
5. What is `pages/harvest-sampling.js` for (see 08 open question 1)?
