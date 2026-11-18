# Architecture 05 — Production Engine Design

Status: proposed. Binding decision D-004: introduce `batches` (lineage, species, origin) and an append-only `stockEvents` ledger (`stock_in`, `mortality`, `transfer_out`/`transfer_in`, `harvest`, `grading_split`, `merge`, `count_adjustment`, `reversal`); `cages.currentCount` becomes a derived cache written only by the engine; `stockingHistory`, `fishTransfers`, harvest `cageEffect` and daily mortality are migrated by backfill and then routed through the engine; corrections are reversal events. Also D-006 (rollups), D-008 (domain events), D-013 (Phase 0 fixes first, §10).

Retires TD-040 … TD-053, TD-060, TD-061, TD-064 and the fish half of TD-052; prepares TRACE (genealogy) and ANLY (KPIs).

## 1. Current state (discovery)

| Concept | As built | Problem | Evidence |
|---|---|---|---|
| Batch | `stockingHistory` row = one cycle in one cage; `batchNumber` string | No batch spans cages; no split/merge; records attach to cage + date | doc 08 §1; doc 05 §3.3, R4 |
| Population | `cages.currentCount`, mutated by 12 paths with `=`, `+=`, `max(0, …)` | Overwrites, clamps, double counts, cross-cycle deltas; no history | doc 08 §4; doc 09 §5 |
| Cycle membership | Date window `stockingDate ≤ date ≤ closedAt` | Same-day restock, back-dated entries go to the wrong cycle | `convex/lib/growth.ts:53-88` |
| Corrections | Undo-and-reapply (`harvest.cageEffect`), deltas on the live counter | Edits of old records hit the current cycle (S5, S6, S8) | `convex/harvest.ts:107-187` |
| Transfers | Linked pending stocking/top-up rows with their own approval | Double count (S2, S3); no correction (S1) | `convex/fishTransfers.ts:63-121` |
| Growth/KPIs | Computed on read from live count and latest ABW of any cycle | Wrong after restock, transfers, partial harvests; closed cycles collapse | doc 09 §2.1 |
| Feed (good model to copy) | Signed append-only `feedInventoryTransactions`, reversal rows, single writer `applyStockChange` | — | doc 08 §6.2 |

## 2. Concepts

| Term | Meaning | Stored in |
|---|---|---|
| **Unit** | A physical container (cage, pond, tank …) — a `cages` row (`04`) | `cages` |
| **Batch** | A cohort of fish with one origin and species that can live in one or several units over time; children inherit lineage | `batches` |
| **Occupancy** | The period during which one batch is present in one unit (opens at the first positive event, closes when its count returns to 0). This replaces today's "cycle in a cage" | `unitStock` (cache, rebuildable) |
| **Stock event** | One signed change of count and biomass for one (unit, batch) on one business date | `stockEvents` (append-only) |
| **Operation** | The business document that caused a set of events (a stocking, a transfer, a daily record, a harvest, a grading, an adjustment); events of one operation are posted and reversed together | existing tables + `stockOperations` |

Default invariant: **at most one open occupancy per unit**. It matches today's expectation of one open stocking per cage (doc 05 R3) and makes daily feed and mortality attribution exact (the unit's open batch). Mixed units are an open question (§12).

## 3. Schema

New tables in `convex/production/tables.ts`.

```ts
export const stockEventType = v.union(
  v.literal('stock_in'), v.literal('mortality'), v.literal('transfer_out'), v.literal('transfer_in'),
  v.literal('harvest'), v.literal('grading_split'), v.literal('merge'),
  v.literal('count_adjustment'), v.literal('reversal'),
)
export const stockSourceTable = v.union(
  v.literal('stockingHistory'), v.literal('topupHistory'), v.literal('fishTransfers'),
  v.literal('dailyRecords'), v.literal('harvestRecords'), v.literal('stockOperations'),
  v.literal('legacyBackfill'),
)

batches: defineTable({
  companyId: v.id('companies'),
  batchNumber: v.string(),                       // unique per company (checked via index)
  speciesCode: v.optional(v.string()),           // speciesCatalog.code (04)
  origin: v.union(v.literal('stocking'), v.literal('transfer_split'), v.literal('grading_split'),
                  v.literal('merge'), v.literal('hatchery'), v.literal('legacy')),
  parentBatchIds: v.optional(v.array(v.id('batches'))),  // bounded: ≤ 20, enforced in engine
  status: v.union(v.literal('active'), v.literal('closed')),
  openedOn: v.string(),                          // business date of first stock_in
  closedOn: v.optional(v.string()),
  homeLocationId: v.optional(v.id('farmLocations')),
  sourceInfo: v.optional(v.object({
    supplierName: v.optional(v.string()), hatcheryRef: v.optional(v.string()),
    unitCostPerFish: v.optional(v.number()),     // fingerling cost for INV/finance
  })),
  legacyStockingId: v.optional(v.id('stockingHistory')),
  custom: v.optional(customValues),              // D-007
  createdBy: v.optional(v.id('users')),
  updatedAt: v.number(),
})
  .index('by_companyId_and_batchNumber', ['companyId', 'batchNumber'])
  .index('by_companyId_and_status', ['companyId', 'status'])
  .index('by_legacyStockingId', ['legacyStockingId']),

stockEvents: defineTable({
  companyId: v.id('companies'),
  locationId: v.id('farmLocations'),
  unitId: v.id('cages'),
  batchId: v.id('batches'),
  type: stockEventType,
  reversedType: v.optional(stockEventType),      // set when type === 'reversal'
  qtyDelta: v.number(),                          // signed integer
  biomassKgDelta: v.number(),                    // signed
  abwG: v.optional(v.number()),                  // measured or estimated ABW for this event
  abwSource: v.optional(v.union(v.literal('measured'), v.literal('estimated'))),
  eventDate: v.string(),                         // business date (site timezone)
  intraDayOrder: v.number(),                     // 0 inflows, 1 adjustments(+), 2 mortality/adjust(−), 3 outflows
  sourceTable: stockSourceTable,
  sourceId: v.string(),                          // id of the operation document
  component: v.optional(v.string()),             // e.g. 'closeout' for derived harvest close-out events
  counterpartUnitId: v.optional(v.id('cages')),
  counterpartBatchId: v.optional(v.id('batches')),
  reversesEventId: v.optional(v.id('stockEvents')),
  reason: v.optional(v.string()),
  recordedAt: v.number(),                        // server time (bitemporal "known at")
  recordedBy: v.optional(v.id('users')),
})
  .index('by_unitId_and_batchId_and_eventDate', ['unitId', 'batchId', 'eventDate'])
  .index('by_batchId_and_eventDate', ['batchId', 'eventDate'])
  .index('by_companyId_and_locationId_and_eventDate', ['companyId', 'locationId', 'eventDate'])
  .index('by_sourceTable_and_sourceId', ['sourceTable', 'sourceId'])
  .index('by_reversesEventId', ['reversesEventId']),

unitStock: defineTable({                         // one row per occupancy; cache, rebuildable from events
  companyId: v.id('companies'),
  locationId: v.id('farmLocations'),
  unitId: v.id('cages'),
  batchId: v.id('batches'),
  status: v.union(v.literal('open'), v.literal('closed')),
  openedOn: v.string(),
  closedOn: v.optional(v.string()),
  count: v.number(),
  lastAbwG: v.optional(v.number()),
  lastAbwDate: v.optional(v.string()),
  totals: v.object({                             // cumulative flows, for O(1) KPIs
    stockedCount: v.number(), stockedKg: v.number(),
    inCount: v.number(), inKg: v.number(),       // transfer_in, split+, merge+
    outCount: v.number(), outKg: v.number(),     // transfer_out, split−, merge−
    mortalityCount: v.number(), mortalityKgEst: v.number(),
    harvestedCount: v.number(), harvestedKg: v.number(),
    adjustmentCount: v.number(),
  }),
  version: v.number(),
  updatedAt: v.number(),
})
  .index('by_unitId_and_status', ['unitId', 'status'])
  .index('by_batchId_and_status', ['batchId', 'status'])
  .index('by_companyId_and_locationId_and_status', ['companyId', 'locationId', 'status']),

stockOperations: defineTable({                   // source document for grading, merge, adjustment
  companyId: v.id('companies'),
  locationId: v.id('farmLocations'),
  kind: v.union(v.literal('grading_split'), v.literal('merge'), v.literal('count_adjustment')),
  operationDate: v.string(),
  status: v.union(v.literal('pending_approval'), v.literal('approved'), v.literal('rejected'), v.literal('reversed')),
  lines: v.array(v.object({                      // bounded: ≤ 20 lines
    unitId: v.id('cages'),
    batchId: v.optional(v.id('batches')),        // existing batch
    newBatchNumber: v.optional(v.string()),      // child batch to create (grading)
    qty: v.number(),                             // signed for adjustments; positive otherwise
    abwG: v.optional(v.number()),
    role: v.union(v.literal('source'), v.literal('target'), v.literal('cull'), v.literal('adjust')),
  })),
  reason: v.optional(v.string()),
  createdBy: v.id('users'),
  approvedBy: v.optional(v.id('users')),
  approvedAt: v.optional(v.number()),
  idempotencyKey: v.optional(v.string()),
  updatedAt: v.number(),
}).index('by_companyId_and_status', ['companyId', 'status']),

batchDailyRollups: defineTable({                 // flows only (no balances) → a back-dated event touches one row
  companyId: v.id('companies'),
  locationId: v.id('farmLocations'),
  unitId: v.id('cages'),
  batchId: v.id('batches'),
  date: v.string(),
  stockedCount: v.number(), inCount: v.number(), outCount: v.number(),
  mortalityCount: v.number(), harvestedCount: v.number(), harvestedKg: v.number(),
  adjustmentCount: v.number(),
  feedKg: v.number(), feedCost: v.number(),      // written by the daily-record path (INV ledger stays separate)
  sampledAbwG: v.optional(v.number()),
})
  .index('by_unitId_and_batchId_and_date', ['unitId', 'batchId', 'date'])
  .index('by_companyId_and_locationId_and_date', ['companyId', 'locationId', 'date']),
```

Additive fields on existing tables:

| Table | New fields | Notes |
|---|---|---|
| `cages` | `currentBatchId: v.optional(v.id('batches'))` | Cache. `currentCount`, `stockingDate`, `initialCount`, `initialAbw`, `currentWeight`, `species`, `status` (`active`/`empty`/`harvested`) become engine-written caches of the open occupancy |
| `stockingHistory` | `batchId`, `managedByTransferId: v.optional(v.id('fishTransfers'))` | Stocking = the operation that opens a batch |
| `topupHistory` | `batchId`, `managedByTransferId` | Top-up = `stock_in` on an existing batch |
| `fishTransfers` | `batchId`, `transferGroupId: v.optional(v.string())`, `mode: v.optional(v.union(v.literal('move'), v.literal('merge')))`, `.index('by_companyId_and_transferGroupId', …)` | Multi-destination grouping; merge into an occupied unit |
| `dailyRecords`, `biweeklyRecords`, `harvestRecords`, `healthTreatments` | `batchId: v.optional(v.id('batches'))` | Set by the engine from the unit's open occupancy at the record date |
| `harvestRecords` | `fcrInputs: v.optional(v.object({ feedKg, gainKg, method }))`, `grades: v.optional(v.array(v.object({ gradeKey, weightKg, count: v.optional(v.number()) })))` | Computed FCR with inputs (TD-060); typed grades (04 §3.5) |

## 4. Engine API

Library functions (`convex/production/engine/*.ts`), called inside the caller's mutation, so the operation document, its events, caches, rollups and domain events commit in one transaction.

```ts
type StockEventInput = {
  type: Exclude<StockEventType, 'reversal'>
  unitId: Id<'cages'>
  batchId: Id<'batches'>
  qtyDelta: number                 // integer, signed by type: stock_in/transfer_in > 0, mortality/harvest/transfer_out < 0
  biomassKgDelta?: number          // required for stock_in, transfers, split, merge, harvest; estimated for mortality
  abwG?: number
  eventDate: string
  component?: string
  counterpartUnitId?: Id<'cages'>
  counterpartBatchId?: Id<'batches'>
  reason?: string
}

postOperation(ctx: MutationCtx, m: MemberContext, op: {
  sourceTable: StockSourceTable; sourceId: string; events: StockEventInput[]
}): Promise<{ eventIds: Id<'stockEvents'>[]; warnings: string[] }>

reverseOperation(ctx: MutationCtx, m: MemberContext, ref: {
  sourceTable: StockSourceTable; sourceId: string; reason: string; component?: string
}): Promise<{ reversed: number }>

replaceOperation(ctx: MutationCtx, m: MemberContext, op: {
  sourceTable: StockSourceTable; sourceId: string; events: StockEventInput[]; reason: string
}): Promise<{ eventIds: Id<'stockEvents'>[]; warnings: string[] }>   // reverse + post, one transaction

openBatch(ctx, m, { batchNumber?: string; speciesCode?: string; origin; parentBatchIds?; openedOn; sourceInfo? }): Promise<Id<'batches'>>
openOccupancyFor(ctx, unitId: Id<'cages'>, date: string): Promise<Doc<'unitStock'> | null>  // occupancy open on that date

// Read helpers (queries)
stockAsOf(ctx, q: { unitId?: Id<'cages'>; batchId?: Id<'batches'>; date: string; knownAt?: number }):
  Promise<{ count: number; biomassKg: number; abwG: number | null }>
occupancyKpis(ctx, q: { unitId: Id<'cages'>; batchId: Id<'batches'>; asOf?: string }): Promise<OccupancyKpis>
batchKpis(ctx, q: { batchId: Id<'batches'>; asOf?: string; includeDescendants?: boolean }): Promise<BatchKpis>
lineage(ctx, batchId): Promise<{ ancestors: BatchRef[]; descendants: BatchRef[] }>   // bounded depth 10
```

Internal functions (`convex/production/engine/internal.ts`):

| Function | Purpose |
|---|---|
| `rebuildOccupancies({ unitId })` | Recompute `unitStock` rows and `cages` caches for one unit from its events |
| `reconcile({ companyId, cursor })` | Page units of a company; compare caches with Σ events; write drift to `engineIssues`; scheduled nightly per company |
| `backfillCompany({ companyId, cursor })` | Migration (§9), one unit per batch of work, self-rescheduling |
| `rebuildRollups({ unitId, batchId })` | Recompute `batchDailyRollups` from events and daily records |

Public functions keep their current names and shapes (`stocking.createStocking`, `approveStocking`, `createTopup`, `approveTopup`, `fishTransfers.createFishTransfer`, `approveFishTransfer`, `harvest.create/update/remove`, `dailyRecords.createBatch/update/remove`); their handlers call the engine. New public functions live in `convex/production/`:

| Function | Permission |
|---|---|
| `production.transfers.createGroup({ sourceUnitId, date, lines: [{ destinationUnitId, qty, abwG, mode? }], idempotencyKey })` | `production.transfer.request` |
| `production.operations.createGrading({ unitId, date, outputs: [{ unitId, newBatchNumber?, qty, abwG }], culls?, idempotencyKey })` | `production.transfer.request` |
| `production.operations.createMerge({ date, sources: [{ unitId, batchId, qty, abwG }], target: { unitId, batchId }, idempotencyKey })` | `production.transfer.request` |
| `production.operations.createAdjustment({ unitId, date, qtyDelta, reason, idempotencyKey })` | `production.stock.adjust` |
| `production.operations.approve/reject({ id })` | `production.transfer.approve` / `production.stock.adjust` |
| `production.corrections.reverse({ sourceTable, sourceId, reason })` | `production.*.correct` per source |
| `production.batches.list/get/lineage`, `production.units.occupancy({ unitId })`, `production.reports.stockAsOf({ locationId, date, knownAt? })` | `reports.view` |

## 5. Invariants

| # | Invariant | Enforced by |
|---|---|---|
| I1 | `stockEvents` rows are never patched or deleted | Only `postOperation`/`reverseOperation` insert; no other code references the table for writes (reviewed by grep test) |
| I2 | Every event's `companyId` equals the unit's and the batch's company; `locationId` equals the unit's site | `postOperation` loads unit and batch, `assertSameCompany` |
| I3 | For every (unit, batch), the running count ordered by (`eventDate`, `intraDayOrder`, `recordedAt`) is ≥ 0 at every point | After inserting, the engine reads that occupancy's events (`by_unitId_and_batchId_and_eventDate`, bounded by occupancy length) and recomputes; violation → `ConvexError('STOCK_NEGATIVE', { unitId, date, shortBy })`; the whole mutation rolls back |
| I4 | At most one open occupancy per unit at any date | Checked on the final state of each touched unit; violation → `OCCUPANCY_CONFLICT` |
| I5 | Internal moves (transfer, grading split, merge) net to zero count within an operation; biomass nets to zero for transfers and merges; for gradings the parent's negative biomass equals the measured children's biomass | Validated before insert |
| I6 | A reversal reverses exactly one event and an event is reversed at most once | `by_reversesEventId` lookup before insert |
| I7 | Caches equal the ledger: `cages.currentCount = Σ open unitStock.count = Σ qtyDelta of the unit` | Engine writes caches in the same transaction; nightly `reconcile` reports drift |
| I8 | Only approved source documents have events; pending/rejected ones have none | Approve handlers post; create handlers post only when no approval is required |
| I9 | `eventDate` is a valid date, ≤ the site's local today, ≥ the batch's `openedOn` (except the opening `stock_in`) | `postOperation` |
| I10 | `qtyDelta` is a non-zero integer with the sign implied by `type`; biomass and ABW are finite and non-negative in magnitude | `postOperation` (fixes TD-049) |
| I11 | Operations that empty an occupancy by a full physical count (complete harvest, whole-occupancy grading, transfer flagged `full`) carry a derived close-out `count_adjustment` (`component: 'closeout'`) equal to ledger balance minus counted fish. It is recomputed whenever an earlier event in that occupancy changes, so the physical count stays the closing truth | `postOperation`/`reverseOperation` call `recomputeCloseout(unitId, batchId)` when the touched occupancy is closed |

Same-day ordering (`intraDayOrder`): 0 = `stock_in`, `transfer_in`, positive `grading_split`/`merge`; 1 = positive `count_adjustment`; 2 = `mortality`, negative `count_adjustment`; 3 = `harvest`, `transfer_out`, negative `grading_split`/`merge`. Reversals take the order of the event they reverse.

## 6. Derivations

All figures come from events (count, flows) and samples (ABW); nothing is typed except measurements.

| Quantity | Definition |
|---|---|
| Count as of D (unit, batch, or site) | Σ `qtyDelta` with `eventDate ≤ D` (reversals carry the original date, so they cancel). "As known at T": also `recordedAt ≤ T` |
| ABW as of D (occupancy) | Latest biweekly sample in this occupancy with date ≤ D; else the ABW set by the latest inflow (stock-in/transfer-in/merge, count-weighted when several); never a previous occupancy's value (fixes TD-044) |
| Standing biomass | count × ABW / 1000 |
| Dead biomass (estimate) | Σ mortality count × ABW as of the mortality date / 1000 |
| Gain (kg) over an occupancy | standing biomass at end + harvested kg + out kg − stocked kg − in kg |
| eFCR (economic) | feed kg ÷ gain |
| Biological FCR | feed kg ÷ (gain + dead biomass) |
| Survival % | (count at end + harvested count + out count) ÷ (stocked count + in count) |
| Cumulative mortality % | mortality count ÷ (stocked count + in count); harvests and transfers are **not** losses (fixes C13, TD-064) |
| Daily mortality % | day's mortality ÷ count at the start of the day |
| Unaccounted loss | − Σ negative `count_adjustment` with `component: 'closeout'` |
| Harvest FCR (stored at harvest) | occupancy eFCR as of the harvest date for a complete harvest, stored with `fcrInputs`; partial harvests store interim eFCR with `method: 'interim'` (fixes C8/C9 partial-harvest distortion) |
| Batch KPIs | Σ over the batch's occupancies; `includeDescendants` adds children for lineage-level FCR |
| Feed per occupancy | Σ `dailyRecords.feedAmount` with `batchId` = occupancy batch and `cageId` = unit (exact under I4) |

`convex/lib/growth.ts` formula helpers (`biomassKg`, `fcr`, `sgr`, `adg`, `daysBetween`) are kept and fed these inputs; `cageCycleGrowth` becomes `occupancyKpis`.

## 7. Scenario walkthroughs

Common setup: site S1, cages C1–C5. Batch **B1** (`TL-0101`, Nile tilapia) stocked into C1 on 2027-01-01: 10,000 fish at 20 g (200 kg). Between 01-01 and 02-28 daily records post 300 mortality on C1 and 1,500 kg feed. Last sample on 02-25: ABW 150 g. Scenarios 7.1 and 7.2 are alternative ways of moving fish out of C1; 7.3, 7.4, 7.6 and 7.7 continue from 7.1; 7.5 uses C4 from 7.2.

### 7.1 Partial transfer (C1 → empty C2, same batch)

Operation: `fishTransfers` row T1, 2027-03-01, qty 3,000, ABW 150 g, `mode: 'move'`. With approval required, creating T1 posts nothing; `approveFishTransfer(T1)` posts:

| type | unit | batch | qtyDelta | biomassKgDelta | eventDate | source |
|---|---|---|---|---|---|---|
| `transfer_out` | C1 | B1 | −3,000 | −450 | 03-01 | fishTransfers/T1 |
| `transfer_in` | C2 | B1 | +3,000 | +450 | 03-01 | fishTransfers/T1 |

Derived: C1 9,700 → 6,700; occupancy (C2, B1) opens with ABW 150 g; batch B1 still 9,700 fish across two units. C1 occupancy eFCR to date: gain = 6,700 × 0.150 + 450 − 200 = 1,255 kg; eFCR = 1,500 ÷ 1,255 = 1.20 → correct, because the 450 kg that left was fed by C1 (today's C6 drops that biomass and overstates eFCR, S11).

Defects prevented: no linked stocking/top-up row can be approved separately (`managedByTransferId` set, their approve endpoints refuse — TD-042); "full" is computed at approval from the ledger, not frozen at creation (TD-051, S10); I3 refuses the approval if C1 no longer has 3,000 fish; a later correction is `production.corrections.reverse({ sourceTable: 'fishTransfers', sourceId: T1 })`, which posts two reversal events and closes (C2, B1) if empty (S1).

### 7.2 Multiple destinations

`production.transfers.createGroup` from C1 on 2027-03-01 with lines C2 2,000, C3 2,000, C4 1,500 (ABW 150 g) creates three `fishTransfers` rows sharing `transferGroupId` and posts (on approval, one mutation):

| type | unit | batch | qtyDelta | biomassKgDelta |
|---|---|---|---|---|
| `transfer_out` | C1 | B1 | −2,000 | −300 |
| `transfer_in` | C2 | B1 | +2,000 | +300 |
| `transfer_out` | C1 | B1 | −2,000 | −300 |
| `transfer_in` | C3 | B1 | +2,000 | +300 |
| `transfer_out` | C1 | B1 | −1,500 | −225 |
| `transfer_in` | C4 | B1 | +1,500 | +225 |

The group is approved or rejected as a whole; I3 evaluates C1 after all three outflows, so pending lines cannot together exceed the source (today they can, doc 08 §9). Batch B1 now has four open occupancies (C1 4,200, C2–C4); `batchKpis(B1)` aggregates them.

### 7.3 Split by grading (child batches)

C1 holds B1 6,700 fish on 2027-04-15. Grading output: 2,500 large at 260 g stay in C1 as **B1-A**; 4,100 small at 180 g go to empty C5 as **B1-B**; 100 culled. `stockOperations` G1 (`kind: 'grading_split'`) on approval:

| type | unit | batch | qtyDelta | biomassKgDelta | note |
|---|---|---|---|---|---|
| `grading_split` | C1 | B1-A | +2,500 | +650 | child, `counterpartBatchId` B1 |
| `grading_split` | C5 | B1-B | +4,100 | +738 | child |
| `mortality` | C1 | B1 | −100 | −20 (est. at 200 g) | `reason: 'cull at grading'` |
| `grading_split` | C1 | B1 | −6,600 | −1,388 | parent |

`openBatch` creates B1-A and B1-B with `origin: 'grading_split'`, `parentBatchIds: [B1]`. (C1, B1) closes at 0 on 04-15 and (C1, B1-A) opens the same day; I4 is evaluated on the end state of the operation, where only (C1, B1-A) is open. The outputs plus culls account for all 6,700 fish, so the derived close-out (I11) is 0 and no adjustment event is written. B1's occupancy in C1 ends with measured out-biomass 1,388 kg, so its gain includes the growth measured at grading; children start from measured biomass. `lineage(B1-B)` returns B1 as ancestor (TRACE).

### 7.4 Merge into an occupied unit

On 2027-05-01, 4,000 fish of B1-B (220 g) move from C5 into C1, which holds B1-A (2,450 fish at 300 g). `fishTransfers` T5 with `mode: 'merge'` (or `production.operations.createMerge`):

| type | unit | batch | qtyDelta | biomassKgDelta |
|---|---|---|---|---|
| `merge` | C5 | B1-B | −4,000 | −880 |
| `merge` | C1 | B1-A | +4,000 | +880 |

B1-A gets B1-B appended to `parentBatchIds`; (C5, B1-B) closes; B1-B closes if no other occupancy. C1's ABW becomes the count-weighted blend (2,450 × 300 + 4,000 × 220) ÷ 6,450 = 250.4 g, dated 05-01. Today the same movement is a top-up that adds count but no biomass or ABW blending, so the destination's eFCR falls and survival exceeds 100 % (S11) — prevented because inflow biomass enters the gain formula.

### 7.5 Mortality and mortality correction

C4 holds 1,500 fish of B1 since the transfer in 7.2. A daily record D1 for C4 on 2027-03-10 reports 50 deaths. `dailyRecords.createBatch` posts `mortality` C4/B1 −50 (biomass −50 × ABW-on-date, estimated), sets `D1.batchId = B1`, and adds 50 to `batchDailyRollups(C4, B1, 03-10).mortalityCount`. Daily mortality % = 50 ÷ 1,500 = 3.3 % (count at the start of the day), which emits `stock.mortality.recorded` with a threshold breach for automation (`07`).

Later C4 is completely harvested on 07-15 (harvest event plus a close-out of −80, mechanism in 7.6) and restocked on 08-01 with a new batch **B3** (8,000 fish). In September a supervisor corrects D1 to 35 on the daily-records page (PR #7). `dailyRecords.update` calls `replaceOperation('dailyRecords', D1)`:

| type | unit | batch | qtyDelta | eventDate | reversesEventId |
|---|---|---|---|---|---|
| `reversal` (`reversedType: 'mortality'`) | C4 | B1 | +50 | 03-10 | the original event |
| `mortality` | C4 | B1 | −35 | 03-10 | — |

(C4, B1) is closed, so I11 recomputes the harvest close-out: the occupancy now held 15 more fish at harvest time, so the close-out moves from −80 to −95 (a reversal of −80 and a new −95, both `component: 'closeout'`, source the harvest), and the response carries the warning "Unaccounted loss for TL-0101 in C4 changed from 80 to 95". B3 and C4's current count (8,000) are untouched. Today the same edit adds 15 fish to the restocked cage (`convex/dailyRecords.ts:511-520`, S8 / TD-048), and a negative mortality on `create` raises the count (TD-049); both are impossible here (I10, events scoped to B1).

### 7.6 Partial harvest, then complete harvest

C1/B1-A on 2027-06-01: partial harvest H2 of 2,000 fish, 700 kg.

| type | unit | batch | qtyDelta | biomassKgDelta | source |
|---|---|---|---|---|---|
| `harvest` | C1 | B1-A | −2,000 | −700 | harvestRecords/H2 |

The occupancy stays open; ABW is not changed by a partial harvest (harvested fish are often the largest — open question §12). `H2.fcrInputs` stores the interim eFCR. On 07-15 the ledger shows 4,380 fish (after 70 more deaths). Complete harvest H3 counts 4,300 fish, 1,720 kg:

| type | unit | batch | qtyDelta | biomassKgDelta | component |
|---|---|---|---|---|---|
| `harvest` | C1 | B1-A | −4,300 | −1,720 | — |
| `count_adjustment` | C1 | B1-A | −80 | −32 (est.) | `closeout`, reason "unaccounted at harvest" |

(C1, B1-A) closes at 0 on 07-15; `cages` caches become `currentCount 0`, `status 'harvested'`, `currentBatchId` unset. Occupancy eFCR = feed ÷ (700 + 1,720 + out − in − 0 stocked) with in = 650 (grading) + 880 (merge). Sales reference H2/H3; Σ sold kg ≤ harvested kg (TD-055).

The harvest's FCR is computed, not typed (TD-060). `/harvest-sampling` no longer creates harvests (TD-045, §10), so there is no second harvest record to double count kg.

### 7.7 Correction of an old harvest after restock (TD-040 / S5)

Same as 7.6, then C1 restocked with B2 (10,000 fish, 08-01). On 08-20 a user edits H3's count from 4,300 to 4,250. `harvest.update` → `replaceOperation('harvestRecords', H3)`:

| type | unit | batch | qtyDelta | eventDate | note |
|---|---|---|---|---|---|
| `reversal` | C1 | B1-A | +4,300 | 07-15 | reverses harvest |
| `reversal` | C1 | B1-A | +80 | 07-15 | reverses close-out |
| `harvest` | C1 | B1-A | −4,250 | 07-15 | corrected |
| `count_adjustment` | C1 | B1-A | −130 | 07-15 | recomputed close-out |

(C1, B1-A) still ends at 0 on 07-15; (C1, B2) is untouched (10,000). Changing H3 from complete to partial would leave 4,380 − 4,250 fish in B1-A while B2 is open → `OCCUPANCY_CONFLICT` ("record where these fish went, or keep the harvest complete"). Deleting the old partial harvest H2 (S6 / TD-041) reverses −2,000 on B1-A only; I11 then raises the close-out by 2,000 and the mutation refuses unless the user confirms (`confirmUnaccountedLossIncrease: true`), so phantom fish never enter B2.

### 7.8 Historical report

"Fish and biomass per unit at S1 on 2027-03-31", and "what the same report said on 2027-04-01":

1. Occupancies overlapping the date: `unitStock` by `by_companyId_and_locationId_and_status` (open) plus closed occupancies with `closedOn ≥ 03-31` (bounded per site).
2. For each occupancy, count = Σ flows from `batchDailyRollups` with `date ≤ 03-31` (≤ one row per day of the occupancy); biomass = count × ABW as of 03-31 (§6).
3. "As known at 2027-04-01 23:59" re-reads `stockEvents` for those occupancies with `recordedAt ≤ T` instead of rollups (rollups are current-knowledge only).

Result is reproducible: correcting a February mortality later changes today's answer for 03-31 (with the correction visible in the event history) but not the "known at 04-01" answer. Today there is no way to answer either question (doc 08 §15).

### 7.9 Summary: today's defects and the mechanism that prevents each

| Defect | TD | Prevented by |
|---|---|---|
| Harvest edit after restock zeroes new cycle | TD-040 | Corrections reverse only the edited operation's events (7.7) |
| Old partial-harvest delete adds fish to later cycle | TD-041 | Events scoped to (unit, batch); I11 close-out; confirmation (7.7) |
| Transfer double count via linked approvals | TD-042 | One operation posts both sides; linked rows `managedByTransferId` and unapprovable (7.1) |
| Stocking approval overwrites count | TD-043 | Stocking posts `stock_in`; caches recomputed, never assigned; I4 refuses a second open occupancy |
| ABW carried into new cycle | TD-044 | ABW per occupancy (§6) |
| Fake harvests | TD-045 | Only `harvest.*` posts harvest events; sampling writes samples (§10) |
| Daily edit moves current count | TD-048 | Events carry `batchId`; I11 (7.5) |
| Negative quantities | TD-049 | I10 |
| Mutable counter, no history | TD-050 | Ledger + bitemporal as-of (7.8) |
| No transfer correction | TD-051 | `reverseOperation` (7.1) |
| Records linked by date window | TD-052 | `batchId` on operational rows |
| Typed / fake FCR | TD-060 | Computed with stored inputs (7.6) |
| KPI disagreement | TD-061 | One derivation set (§6) for cage page, dashboard, report, export, AI context |
| Mortality alert misfires | TD-064 | Alerts from §6 definitions via domain events |

## 8. Domain events emitted

`postOperation` emits, in the same transaction (`07`): `stock.stocked`, `stock.mortality.recorded` (with daily % and cumulative %), `stock.transferred`, `stock.graded`, `stock.merged`, `stock.harvested`, `stock.adjusted`, `stock.occupancy.closed`, `stock.corrected`. Mortality threshold alerts, approval notifications and webhooks subscribe to these instead of being coded in `dailyRecords.ts`.

## 9. Migration from current tables

### 9.1 Backfill (Phase 4, per company, internal, resumable)

Runs `internal.production.engine.backfillCompany` one unit at a time (bounded reads per transaction) in `mode: 'backfill'`, where I3/I4 violations are recorded in `engineIssues` instead of failing.

| Source | Becomes | Rule |
|---|---|---|
| Approved, non-deleted `stockingHistory` not referenced by `fishTransfers.destinationStockingId` | `batches` row (`origin: 'stocking'`, `legacyStockingId`, same `batchNumber`, `speciesCode = species`) + `stock_in` (fishCount, `initialBiomass` or count × ABW / 1000, `stockingDate`) | `stockingHistory.batchId` set |
| Approved `topupHistory` not referenced by a transfer | `stock_in` on the stocking's batch at `topupDate` | — |
| Approved `fishTransfers` | `transfer_out` on the source unit's batch (`sourceStockingId` → batch, else the occupancy open at `transferDate`); destination stocking branch → child batch (`origin: 'transfer_split'`, parent = source batch) + `transfer_in`; destination top-up branch → `merge` into the destination batch | Linked stocking/top-up rows get `managedByTransferId` |
| `dailyRecords.mortality > 0` | `mortality` on the occupancy open at `date` (date-window rule from `lib/growth.ts`) | `dailyRecords.batchId` set |
| `harvestRecords` with `cageEffect` | `harvest` (−`fishRemoved`, −`totalWeight`); complete → close-out adjustment against the ledger balance | `harvestRecords.batchId` set |
| `harvestRecords` without `cageEffect` (from `createFromSampling`) | **No events**; listed in the reconciliation report for the owner (TD-045) | — |
| Remaining difference per unit | One `count_adjustment` (`sourceTable: 'legacyBackfill'`, reason "legacy reconciliation", dated backfill day) so that Σ events equals today's `cages.currentCount` | Recorded in the report with the difference |

The last rule means counts shown to users do not change on cutover day; history is as faithful as the old data allows, and every gap is visible as a labelled adjustment.

### 9.2 Phases of the switch

| Step | What | Who writes `cages.currentCount` | Exit criterion |
|---|---|---|---|
| 1 | Deploy tables and optional fields; engine library; no callers | old code | Schema deploy passes |
| 2 | Backfill all companies; reconciliation report reviewed with the owner | old code | Report accepted; issues resolved or acknowledged |
| 3 | **Dual-write**: every existing writer (§08 table of 12 paths) also posts the equivalent events; nightly `reconcile` compares caches | old code (authoritative) + engine shadow caches in `unitStock` | 14 consecutive days without unexplained drift |
| 4 | **Cutover per module**: stocking, top-up, transfers, daily records, harvest switch to engine-written caches (old direct patches deleted); `cages.update` refuses count edits and offers "stock adjustment" | engine | All 12 legacy writers removed (grep) |
| 5 | Reads switch: `cages.growth` → `occupancyKpis`; reports, dashboard, AI context → rollups + engine KPIs; `harvest.suggestFcr` → computed FCR | engine | Old `cageCycleGrowth` unused |
| 6 | Legacy fields frozen: `harvestRecords.cageEffect` kept for old rows, never written; `stockingHistory.closedAt` written by the engine as a cache of occupancy close | engine | — |

### 9.3 Compatibility shims

- Public function names and argument shapes are unchanged; returns gain fields (`batch_id`, `batch_number`) without removing any.
- `cages` cache fields keep their names, so every page that reads `current_count`, `stocking_date`, `initial_abw`, `current_weight` keeps working.
- Approve endpoints for transfer-linked stocking/top-up rows return a clear `ConvexError('MANAGED_BY_TRANSFER')`; the details pages show a link to the transfer.
- `cages.growth` returns the same keys computed from `occupancyKpis`; a `definitions_version` field lets the UI show "figures recalculated" once.

## 10. Phase 0 patches before the engine (PROD-000)

Small changes in the current code, each with a convex-test regression test, shipped before PR #8 merges:

| TD | Patch |
|---|---|
| TD-040 | `harvest.update`/`remove`: if any approved stocking on the cage has `stockingDate` after the harvest's date, refuse changes to `estimatedCount`/`harvestType` and refuse delete (`CYCLE_RESTOCKED`); `undoHarvestOnCage` touches `closedAt` only when the closed stocking is still the cage's latest |
| TD-041 | Same guard for partial-harvest delete |
| TD-042 | `approveStocking`/`approveTopup` refuse rows referenced by a `fishTransfers` row (staged indexes `fishTransfers.by_destinationStockingId`, `by_destinationTopupId`); `applyFishTransfer` adds top-up fish only if it is the one approving the top-up; `rejectFishTransfer` refuses when a linked row is already approved |
| TD-043 | `approveStocking` re-runs `assertStockingAllowed` and refuses when the cage already has an open approved stocking |
| TD-044 | Every path that opens a cycle sets `cages.currentWeight = initialAbw` |
| TD-045 | `harvest.createFromSampling` stops inserting `harvestRecords`; `/harvest-sampling` writes `harvestSampling` only (or redirects to the `/harvest` sampling form, owner to decide); a platform report lists existing records with `fcr === 1.5` and no `cageEffect` for the owner to keep or delete |
| TD-046 | Until the owner decides issue-vs-daily: `feed.createIssue` with a `cageId` and `dailyRecords` feed for the same cage and date warn on the second entry and require confirmation |
| TD-048 | `dailyRecords.update/remove` refuse mortality changes when the cage's current open stocking started after the record's date (must ship before the PR #7 edit page is deployed) |
| TD-049 | Positive-integer checks on mortality (`create`, `createMany`), stocking and top-up counts |

## 11. Risks

| Risk | Mitigation |
|---|---|
| Backfill fidelity: old clamps, overwrites and manual edits cannot be replayed exactly | Labelled reconciliation adjustments; report reviewed before cutover |
| I3 check cost on long occupancies | Reads one occupancy's events (~1 per day); if occupancies exceed ~2 years, switch to rollup-based balance check per day |
| Users surprised by close-out recomputation | Warnings in the response, confirmation required above a threshold, visible "unaccounted loss" on the occupancy page |
| One-open-occupancy rule too strict for farms that mix lots in one pond | Open question; the schema already supports several open occupancies per unit — only I4 and feed attribution (pro-rata by biomass) would change |
| Two writers during dual-write | Old code stays authoritative until the cutover criterion is met; engine caches live in `unitStock` only during step 3 |
| Feed attribution unclear while issue-vs-daily is undecided | Engine attributes only daily-record feed; issues remain stock movements until decided |

## 12. Open questions

1. Mixed units: can one pond or cage hold two batches at the same time (for example a top-up from a different hatchery lot), and should they then be tracked separately?
2. Which FCR is official: eFCR, biological FCR, or both? Should harvest FCR ever be typed (doc 09 Q1)?
3. Should a partial harvest update the occupancy ABW (harvested fish are often selected by size)?
4. Should a plain transfer into an empty unit keep the batch (proposed) or start a child batch (today's behaviour creates a new batch number)?
5. Are edits to a closed occupancy allowed for all managers, or only admins, and is there a lock date (period close)?
6. Is `/feed-issue` consumption or a store-to-unit move (TD-046)?
