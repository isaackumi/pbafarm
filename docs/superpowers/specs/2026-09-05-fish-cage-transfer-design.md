# Fish cage-to-cage transfer — design

**Date:** 2026-09-05  
**Status:** Draft for review  
**Approach:** Dedicated `fishTransfers` table + single atomic mutation

## Problem

Operators move fish between cages (often nursery → offshore). The app has stocking and top-up, but no first-class cage-to-cage transfer that updates both cages, supports full/partial moves, and preserves an audit trail across farm locations.

## Goals

- Record a transfer with date, ABW, actual quantity, source cage, and destination cage.
- Support **full** transfers (empty the source) and **partial** transfers (leave remaining fish on the source batch).
- Destination **empty** → create a new stocking (new batch; DOC starts on transfer date).
- Destination **occupied** → top-up the existing approved stocking (keep destination batch/DOC).
- Allow **cross-location** transfers within the same company.
- Allow **any stocked cage** as source (not nursery-only).
- Prefer one atomic backend write with a clear transfer history row linking source and destination effects.

## Non-goals (v1)

- Split one transfer into multiple destinations in a single submit.
- In-transit / staging cage status.
- Separate mortality-during-transfer field (operators may note losses in notes).
- Changing existing feed “transfer” inventory semantics.

## Decisions (locked)

| Topic | Choice |
| --- | --- |
| Full vs partial | Full empties source; partial reduces source `currentCount` on the same batch |
| Destination | Empty → new stocking; occupied → top-up |
| Locations | Cross-location allowed (same company) |
| Batch / DOC | Empty dest: new batch, DOC = transfer date; occupied: keep dest batch/DOC; nursery/source history lives on the transfer record |
| Source | Any stocked cage |
| Architecture | Dedicated `fishTransfers` + one mutation |

## Data model

### Table: `fishTransfers`

| Field | Notes |
| --- | --- |
| `sourceCageId` | Required |
| `destinationCageId` | Required; ≠ source |
| `sourceLocationId` | Snapshot from source cage |
| `destinationLocationId` | Snapshot from destination cage |
| `sourceStockingId` | Optional; active/approved stocking on source at create time |
| `destinationStockingId` | Set when empty dest creates stocking |
| `destinationTopupId` | Set when occupied dest creates top-up |
| `transferDate` | String date (same convention as stocking) |
| `quantity` | Fish count moved |
| `abw` | Grams |
| `biomass` | Derived; store for audit |
| `transferType` | `full` \| `partial` |
| `transferSupervisor` | Optional |
| `notes` | Optional |
| `status` | `pending_approval` \| `approved` \| `rejected` |
| `companyId`, `createdBy`, `approvedBy`, `approvedAt` | Standard |
| `updatedAt` | Number |

Indexes: `by_company`, `by_source_cage`, `by_destination_cage`, `by_status`, `by_company_location` (source location), plus destination location index if needed for filters.

### Farm rules

Add `requireApprovalForFishTransfer` (boolean) under stocking rules (default `true`, aligned with stocking/top-up defaults). When false, create path auto-approves and applies cage side effects immediately.

## Backend behavior

### `createFishTransfer`

1. Auth + company scope on both cages.
2. Validate: source ≠ dest; source has `currentCount` > 0; `quantity` > 0 and ≤ source `currentCount`; derive `transferType` (`full` when qty equals source count, else `partial`).
3. Destination branch:
   - **Empty-eligible** (status in `allowStockOnlyEmptyStatuses`): create `stockingHistory` with new batch number, `stockingDate` = transfer date, fish/ABW/biomass from transfer, `sourceLocation` / `sourceCage` filled from source cage identity. Run `assertStockingAllowed`. Link `destinationStockingId`.
   - **Occupied / active with approved stocking**: create `topupHistory` on that stocking. Run `assertTopupAllowed`. Link `destinationTopupId`.
   - Otherwise reject (e.g. maintenance with no clear stock path).
4. Insert `fishTransfers` with status from `requireApprovalForFishTransfer`.
5. If auto-approved, run apply path (below). Else leave cages unchanged until approval.
6. Audit log.

### `approveFishTransfer`

1. Admin (same as stocking/top-up approve) + pending check.
2. Re-read source cage; fail if `currentCount` < transfer quantity (concurrency).
3. Apply in one mutation:
   - **Source:** subtract quantity. If full: set `currentCount` to 0, status to `empty`, clear active stocking fields as needed so restocking is allowed later. If partial: keep `active`, reduced count.
   - **Destination:** approve linked stocking or top-up and apply the same cage patches those approve mutations already use (counts, status `active`, species, stocking date for new stocking).
4. Mark transfer approved; audit.

### `rejectFishTransfer`

Mark transfer rejected; reject linked pending stocking/top-up if still pending; no cage count changes.

### Queries

- `listFishTransfers` — company-scoped; filters: status, date range, source/dest location, cage.
- `getFishTransfer` — detail with linked stocking/top-up ids.
- Surface pending transfers in pending-approvals list (alongside stocking/top-up) or a dedicated section on the transfers page.

## UI

### Navigation

- Sidebar under Stocking: **Fish transfers** → `/fish-transfers`.
- Optional: **Transfer fish** action from cage / stocking management with source pre-filled.

### Create form

Required: transfer date, source cage, destination cage, quantity, ABW.  
Optional: supervisor, notes.  
Helpers: show source current count and locations; “Full transfer” sets qty = source count; biomass read-only; summary of full vs partial outcome and empty vs top-up destination outcome.

Destination cage picker is **not** limited to the header location (cross-location).

### History

Table: date, source → destination (location badges), qty, ABW, type, status. Filters as above.

## Edge cases

- Capacity, density, and ABW range rules apply on the **destination** create path via existing assert helpers.
- Cross-location: both cages same company; header location does not block destination selection.
- Pending transfer must not debit source until approve (avoids double-count if rejected).
- Approve-time revalidation of source count.
- Species: new stocking may copy source cage species; top-up does not change destination species.

## Testing (acceptance)

1. Partial same-location: source count down; dest empty → new stocking with DOC = transfer date; transfer row links stocking.
2. Full transfer: source emptied (`empty`, count 0); can be stocked again later.
3. Into occupied dest: top-up created; dest batch/DOC unchanged; count increased on approve.
4. Cross-location: source and dest different `locationId`; both update correctly.
5. Approval on: create leaves cages unchanged; approve applies; reject leaves cages unchanged and rejects linked records.
6. Approval off: create applies immediately.
7. Concurrent approve fails cleanly if source no longer has enough fish.

## Implementation notes

- Reuse patterns from `convex/stocking.ts` (create/approve/reject, audit, company scoping).
- Prefer shared internal helpers for “apply stocking to cage” / “apply top-up to cage” so transfer approve and standalone approve stay consistent.
- Client: mirror `lib/stockingService.js` with a small `lib/fishTransferService.js` if that is the project convention.
