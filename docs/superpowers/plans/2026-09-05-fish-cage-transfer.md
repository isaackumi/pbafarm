# Fish Cage-to-Cage Transfer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class cage-to-cage fish transfers (full/partial, empty→stocking or occupied→top-up, cross-location) with a dedicated `fishTransfers` audit table and atomic create/approve/reject.

**Architecture:** Pure helpers in `convex/lib/fishTransferLogic.ts` for type/biomass/source-debit math; Convex `fishTransfers` table + `convex/fishTransfers.ts` mutations that create linked `stockingHistory` / `topupHistory` rows and apply cage updates only on approve (or immediately when approval is off). UI at `/fish-transfers` with a form + history list; company setting `requireApprovalForFishTransfer`.

**Tech Stack:** Next.js Pages Router, Convex, existing UI kit (`PageHeader`, `FormPage`, `FormCard`, sidebar), `lib/*Service.js` HTTP Convex bridge pattern.

**Spec:** `docs/superpowers/specs/2026-09-05-fish-cage-transfer-design.md`

## Global Constraints

- Same company only; cross-location allowed
- Pending transfers must not change cage counts until approve
- Full transfer → source status `empty`, `currentCount` 0; partial → reduce count, stay `active`
- Empty dest → new stocking, DOC = transfer date; occupied → top-up, keep dest batch/DOC
- Biomass kg = `(quantity * abwGrams) / 1000` (same as top-up pending list)
- Reuse `assertStockingAllowed` / `assertTopupAllowed`
- No multi-destination, in-transit status, or mortality field in v1
- This repo has no Jest/Vitest; use Node’s built-in test runner (`node --test`) for pure helpers

## File map

| File | Responsibility |
| --- | --- |
| `convex/schema.ts` | `fishTransfers` table + `requireApprovalForFishTransfer` on settings |
| `convex/lib/farmRules.ts` | Default + type for approval flag |
| `convex/lib/fishTransferLogic.ts` | Pure: transfer type, biomass, source patch, dest branch |
| `convex/lib/fishTransferLogic.test.ts` | Node tests for pure helpers |
| `convex/fishTransfers.ts` | Queries + create/approve/reject |
| `convex/stocking.ts` | Optionally export/share apply helpers; extend pending list |
| `pages/company-settings.js` | Toggle for transfer approval |
| `lib/fishTransferService.js` | Client bridge |
| `components/FishTransferForm.js` | Create form |
| `pages/fish-transfers.js` | List + create UI |
| `components/Sidebar.js` | Nav link |

---

### Task 1: Schema + farm rules + settings toggle

**Files:**
- Modify: `convex/schema.ts` (companies.settings.stockingRules + new table)
- Modify: `convex/lib/farmRules.ts`
- Modify: `pages/company-settings.js` (defaults + checkbox + preview bullet)
- Test: `convex/lib/fishTransferLogic.test.ts` (created in Task 2; this task verified by Convex push / typecheck)

**Interfaces:**
- Produces: `fishTransfers` table; `stockingRules.requireApprovalForFishTransfer: boolean` (default `true`)

- [ ] **Step 1: Extend `stockingRules` in schema**

In `convex/schema.ts` inside `settings.stockingRules`, add:

```ts
requireApprovalForFishTransfer: v.optional(v.boolean()),
```

Keep existing required booleans for stocking/top-up unchanged.

- [ ] **Step 2: Add `fishTransfers` table** after `topupHistory` in `convex/schema.ts`:

```ts
fishTransfers: defineTable({
  sourceCageId: v.id('cages'),
  destinationCageId: v.id('cages'),
  sourceLocationId: v.optional(v.id('farmLocations')),
  destinationLocationId: v.optional(v.id('farmLocations')),
  sourceStockingId: v.optional(v.id('stockingHistory')),
  destinationStockingId: v.optional(v.id('stockingHistory')),
  destinationTopupId: v.optional(v.id('topupHistory')),
  transferDate: v.string(),
  quantity: v.number(),
  abw: v.number(),
  biomass: v.number(),
  transferType: v.union(v.literal('full'), v.literal('partial')),
  transferSupervisor: v.optional(v.string()),
  notes: v.optional(v.string()),
  status: v.union(
    v.literal('pending_approval'),
    v.literal('approved'),
    v.literal('rejected'),
  ),
  companyId: v.optional(v.id('companies')),
  createdBy: v.optional(v.id('users')),
  approvedBy: v.optional(v.id('users')),
  approvedAt: v.optional(v.number()),
  updatedAt: v.number(),
})
  .index('by_company', ['companyId'])
  .index('by_status', ['status'])
  .index('by_source_cage', ['sourceCageId'])
  .index('by_destination_cage', ['destinationCageId'])
  .index('by_company_location', ['companyId', 'sourceLocationId']),
```

- [ ] **Step 3: Update `DEFAULT_SETTINGS` and `EffectiveSettings` in `convex/lib/farmRules.ts`**

Add `requireApprovalForFishTransfer: true` to `stockingRules` default and type. `mergeSettings` already spreads `...(s.stockingRules || {})` so the new flag merges automatically once present on the type/default.

- [ ] **Step 4: Company settings UI**

In `pages/company-settings.js`:
1. Add `requireApprovalForFishTransfer: true` to the local default `stockingRules` object.
2. Add a checkbox after top-up approval:

```jsx
<label className="flex items-center gap-2 text-sm font-medium">
  <input
    type="checkbox"
    checked={!!draft.stockingRules?.requireApprovalForFishTransfer}
    onChange={(e) =>
      patch('stockingRules.requireApprovalForFishTransfer', e.target.checked)
    }
  />
  Require approval for fish transfers
</label>
```

3. Add a preview bullet near the other stocking approval bullets (same pattern as stocking/top-up).

- [ ] **Step 5: Commit**

```bash
git add convex/schema.ts convex/lib/farmRules.ts pages/company-settings.js
git commit -m "$(cat <<'EOF'
Add fishTransfers schema and transfer approval setting.

EOF
)"
```

---

### Task 2: Pure transfer logic + Node tests

**Files:**
- Create: `convex/lib/fishTransferLogic.ts`
- Create: `convex/lib/fishTransferLogic.test.ts`

**Interfaces:**
- Produces:
  - `deriveTransferType(quantity: number, sourceCurrentCount: number): 'full' | 'partial'`
  - `transferBiomassKg(quantity: number, abwGrams: number): number`
  - `classifyDestination(destStatus: string, allowEmptyStatuses: string[]): 'stock' | 'topup' | 'invalid'`
  - `sourceCagePatchAfterTransfer(opts: { transferType: 'full' | 'partial'; quantity: number; sourceCurrentCount: number; now: number }): Record<string, unknown>`

- [ ] **Step 1: Write failing tests** in `convex/lib/fishTransferLogic.test.ts`:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveTransferType,
  transferBiomassKg,
  classifyDestination,
  sourceCagePatchAfterTransfer,
} from './fishTransferLogic.ts'

describe('deriveTransferType', () => {
  it('is full when qty equals source count', () => {
    assert.equal(deriveTransferType(1000, 1000), 'full')
  })
  it('is partial when qty is less', () => {
    assert.equal(deriveTransferType(400, 1000), 'partial')
  })
})

describe('transferBiomassKg', () => {
  it('matches top-up formula', () => {
    assert.equal(transferBiomassKg(1000, 50), 50)
  })
})

describe('classifyDestination', () => {
  const empty = ['empty', 'fallow', 'harvested']
  it('stocks empty-eligible statuses', () => {
    assert.equal(classifyDestination('empty', empty), 'stock')
    assert.equal(classifyDestination('fallow', empty), 'stock')
  })
  it('topups active', () => {
    assert.equal(classifyDestination('active', empty), 'topup')
  })
  it('rejects maintenance', () => {
    assert.equal(classifyDestination('maintenance', empty), 'invalid')
  })
})

describe('sourceCagePatchAfterTransfer', () => {
  it('empties on full', () => {
    const patch = sourceCagePatchAfterTransfer({
      transferType: 'full',
      quantity: 1000,
      sourceCurrentCount: 1000,
      now: 1,
    })
    assert.equal(patch.currentCount, 0)
    assert.equal(patch.status, 'empty')
  })
  it('reduces on partial', () => {
    const patch = sourceCagePatchAfterTransfer({
      transferType: 'partial',
      quantity: 400,
      sourceCurrentCount: 1000,
      now: 1,
    })
    assert.equal(patch.currentCount, 600)
    assert.equal(patch.status, 'active')
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
node --experimental-strip-types --test convex/lib/fishTransferLogic.test.ts
```

Expected: FAIL (module not found / exports missing).

- [ ] **Step 3: Implement `convex/lib/fishTransferLogic.ts`**

```ts
export function deriveTransferType(
  quantity: number,
  sourceCurrentCount: number,
): 'full' | 'partial' {
  return quantity >= sourceCurrentCount ? 'full' : 'partial'
}

export function transferBiomassKg(quantity: number, abwGrams: number): number {
  return (quantity * abwGrams) / 1000
}

export function classifyDestination(
  destStatus: string,
  allowEmptyStatuses: string[],
): 'stock' | 'topup' | 'invalid' {
  if (allowEmptyStatuses.includes(destStatus)) return 'stock'
  if (destStatus === 'active') return 'topup'
  return 'invalid'
}

export function sourceCagePatchAfterTransfer(opts: {
  transferType: 'full' | 'partial'
  quantity: number
  sourceCurrentCount: number
  now: number
}): Record<string, unknown> {
  const { transferType, quantity, sourceCurrentCount, now } = opts
  if (transferType === 'full') {
    return {
      currentCount: 0,
      status: 'empty',
      stockingDate: undefined,
      initialCount: undefined,
      initialAbw: undefined,
      species: undefined,
      updatedAt: now,
    }
  }
  return {
    currentCount: sourceCurrentCount - quantity,
    status: 'active',
    updatedAt: now,
  }
}
```

Note: If Convex rejects `undefined` clears, in the mutation use explicit field clearing supported by your Convex version (e.g. omit clear fields and only set `currentCount`/`status`, or use `null` if schema allows). Prefer clearing enough that `assertStockingAllowed` allows restock (`status: 'empty'` is the critical part).

- [ ] **Step 4: Run tests — expect PASS**

```bash
node --experimental-strip-types --test convex/lib/fishTransferLogic.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add convex/lib/fishTransferLogic.ts convex/lib/fishTransferLogic.test.ts
git commit -m "$(cat <<'EOF'
Add pure fish transfer helpers and Node tests.

EOF
)"
```

---

### Task 3: Convex `fishTransfers` API

**Files:**
- Create: `convex/fishTransfers.ts`
- Modify: `convex/stocking.ts` (`listPendingApprovals` to include transfers)
- Consumes: helpers from Task 2; `assertStockingAllowed` / `assertTopupAllowed`; patterns from `createStocking` / `approveStocking` / `createTopup` / `approveTopup`

**Interfaces:**
- Produces:
  - `listFishTransfers` query
  - `getFishTransfer` query
  - `createFishTransfer` mutation → `Id<'fishTransfers'>`
  - `approveFishTransfer` mutation
  - `rejectFishTransfer` mutation

- [ ] **Step 1: Create `convex/fishTransfers.ts` with shared loadRules** (copy the small `loadRules` helper from `stocking.ts`).

Implement `toClient` mapping `_id` → `id` and camelCase fields for the UI (match stocking client shape).

- [ ] **Step 2: Implement `listFishTransfers`**

Args: optional `status`, `sourceCageId`, `destinationCageId`, `locationId` (match if source OR dest location equals).

```ts
export const listFishTransfers = query({
  args: {
    status: v.optional(
      v.union(
        v.literal('pending_approval'),
        v.literal('approved'),
        v.literal('rejected'),
      ),
    ),
    sourceCageId: v.optional(v.id('cages')),
    destinationCageId: v.optional(v.id('cages')),
    locationId: v.optional(v.id('farmLocations')),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx)
    let rows = await ctx.db.query('fishTransfers').collect()
    rows = await listForCompany(user, rows)
    if (args.status) rows = rows.filter((r) => r.status === args.status)
    if (args.sourceCageId)
      rows = rows.filter((r) => r.sourceCageId === args.sourceCageId)
    if (args.destinationCageId)
      rows = rows.filter((r) => r.destinationCageId === args.destinationCageId)
    if (args.locationId) {
      rows = rows.filter(
        (r) =>
          r.sourceLocationId === args.locationId ||
          r.destinationLocationId === args.locationId,
      )
    }
    rows.sort((a, b) => b.updatedAt - a.updatedAt)
    // join cage names for UI
    return Promise.all(
      rows.map(async (r) => {
        const [src, dest] = await Promise.all([
          ctx.db.get(r.sourceCageId),
          ctx.db.get(r.destinationCageId),
        ])
        return {
          id: r._id,
          ...r,
          sourceCageName: src?.name,
          destinationCageName: dest?.name,
        }
      }),
    )
  },
})
```

- [ ] **Step 3: Implement `getFishTransfer`** — by id, company-scoped, with cage names.

- [ ] **Step 4: Implement internal `applyFishTransfer` helper** (same file, not exported):

Given an approved-or-approving transfer doc + fresh source/dest cages:

1. If `source.currentCount < transfer.quantity` → throw `'Insufficient fish on source cage'`.
2. Patch source with `sourceCagePatchAfterTransfer(...)`.
3. If `destinationStockingId`: patch stocking to `approved` (if still pending) and patch dest cage like `approveStocking` (stockingDate, counts, initialAbw, status active, species).
4. If `destinationTopupId`: patch top-up to `approved` (if still pending) and add `topup.fishCount` to dest `currentCount` like `approveTopup`.

- [ ] **Step 5: Implement `createFishTransfer`**

Args:

```ts
{
  sourceCageId: v.id('cages'),
  destinationCageId: v.id('cages'),
  transferDate: v.string(),
  quantity: v.number(),
  abw: v.number(),
  transferSupervisor: v.optional(v.string()),
  notes: v.optional(v.string()),
}
```

Logic:

1. `requireUser`; load both cages; `listForCompany` must allow both; throw if missing or same id.
2. `sourceCount = source.currentCount || 0`; throw if `quantity <= 0` or `quantity > sourceCount`.
3. `transferType = deriveTransferType(quantity, sourceCount)`; `biomass = transferBiomassKg(quantity, abw)`.
4. Load rules; `branch = classifyDestination(dest.status, rules.stockingRules.allowStockOnlyEmptyStatuses)`.
5. Find latest approved stocking on source (optional `sourceStockingId`) and on dest (required if branch === `'topup'`).
6. If branch === `'stock'`: `assertStockingAllowed`; insert `stockingHistory` with new batch via same allocation approach as `createStocking` (either duplicate `allocateBatchNumber` into a shared lib or call equivalent logic inline), `stockingDate: transferDate`, `fishCount: quantity`, `initialAbw: abw`, `initialBiomass: biomass`, `sourceLocation` / `sourceCage` from source cage name/location, `species: source.species`, status = pending or approved matching **transfer** approval flag (linked stocking should stay pending until transfer approve — set linked stocking/top-up status to the **same** status as the transfer).
7. If branch === `'topup'`: require approved dest stocking; `assertTopupAllowed`; insert `topupHistory` with same status as transfer.
8. If branch === `'invalid'`: throw clear error.
9. Insert `fishTransfers` with snapshots + links + `updatedAt: Date.now()`.
10. If status === `'approved'`, call `applyFishTransfer`.
11. `logAudit`; return transfer id.

**Important:** Linked stocking/top-up created by a transfer must **not** independently apply cage side effects on insert even if their status is approved — only `applyFishTransfer` applies both sides. Simplest approach: always insert linked stocking/top-up as `pending_approval` when transfer is pending; when transfer auto-approves, insert them as `approved` **without** running stocking’s create-time cage patch, then run `applyFishTransfer` once. Do **not** call `createStocking` / `createTopup` mutations (they would double-apply). Use `ctx.db.insert` directly.

- [ ] **Step 6: Implement `approveFishTransfer` / `rejectFishTransfer`**

- Approve: `requireRole(user, 'admin')`; pending only; `applyFishTransfer`; set transfer approved fields; audit.
- Reject: admin; pending only; set transfer rejected; if linked stocking/top-up still `pending_approval`, set them `rejected`; no cage patches; audit.

- [ ] **Step 7: Extend `listPendingApprovals` in `convex/stocking.ts`**

Also query `fishTransfers` with `pending_approval`, map rows:

```ts
{
  type: 'fish_transfer' as const,
  id: t._id,
  batchNumber: `${srcName} → ${destName}`,
  cageName: destName,
  date: t.transferDate,
  count: t.quantity,
  abw: t.abw,
  biomass: t.biomass,
  createdAt: t._creationTime,
}
```

Include in `all` sort. Any UI that switches on `type` must treat unknown types safely (transfers page will be primary approve surface).

- [ ] **Step 8: Manual API smoke (Convex dashboard or app)**

With two cages (source active with count, dest empty): create transfer with approval required → cages unchanged → approve → source reduced/emptied, dest active. Reject path on a second transfer leaves counts unchanged.

- [ ] **Step 9: Commit**

```bash
git add convex/fishTransfers.ts convex/stocking.ts
git commit -m "$(cat <<'EOF'
Add fish transfer create, approve, and reject mutations.

EOF
)"
```

---

### Task 4: Client service + form + page + nav

**Files:**
- Create: `lib/fishTransferService.js`
- Create: `components/FishTransferForm.js`
- Create: `pages/fish-transfers.js`
- Modify: `components/Sidebar.js`

**Interfaces:**
- Consumes: `api.fishTransfers.*`, `api.cages.list` **without** `withActiveLocation` for both pickers (company-wide)
- Produces: working `/fish-transfers` page

- [ ] **Step 1: Create `lib/fishTransferService.js`**

Mirror `stockingService` style:

```js
import { getConvexHttpClient, api } from './convexBridge'

const fishTransferService = {
  list: async (filters = {}) => {
    try {
      const client = getConvexHttpClient()
      const data = await client.query(api.fishTransfers.listFishTransfers, filters)
      return { data: data || [], error: null }
    } catch (error) {
      return { data: [], error }
    }
  },
  create: async (payload) => {
    const client = getConvexHttpClient()
    const id = await client.mutation(api.fishTransfers.createFishTransfer, payload)
    return { data: id, error: null }
  },
  approve: async (id) => {
    const client = getConvexHttpClient()
    await client.mutation(api.fishTransfers.approveFishTransfer, { id })
    return { error: null }
  },
  reject: async (id, reason) => {
    const client = getConvexHttpClient()
    await client.mutation(api.fishTransfers.rejectFishTransfer, { id, reason })
    return { error: null }
  },
}

export default fishTransferService
```

- [ ] **Step 2: Build `components/FishTransferForm.js`**

Fields: date, source cage select, dest cage select, quantity, “Full transfer” checkbox, ABW, read-only biomass, supervisor, notes, outcome summary.

Behavior:
- Load cages via `useQuery(api.cages.list, {})` or service **without** location filter so cross-location works.
- Source options: `status === 'active' && (currentCount || 0) > 0`.
- Dest options: all cages except selected source; show badge Empty / Occupied / Unavailable.
- Full transfer checkbox sets quantity to source `currentCount`.
- On submit call `fishTransferService.create` (or `useMutation`); toast success; `onCreated` callback.

Match existing form styling from `StockingForm.js` / `TopUpForm.js` (labels, required asterisks, `FormCard` if used).

- [ ] **Step 3: Build `pages/fish-transfers.js`**

- `ProtectedRoute` + `Layout` + `FormPage`/`PageHeader` breadcrumbs: Dashboard → Stocking → Fish transfers.
- Related links: Stocking management, New stocking.
- Section 1: `FishTransferForm`.
- Section 2: history table (date, source→dest with location if available, qty, ABW, type, status).
- For admin: Approve / Reject actions on `pending_approval` rows using mutations.
- Status filter optional (All / Pending / Approved / Rejected).

- [ ] **Step 4: Sidebar**

In `components/Sidebar.js` under operations stocking items, after Stocking Management:

```js
{ title: 'Fish Transfers', path: '/fish-transfers', icon: ArrowsLeftRight, tourId: 'fish-transfers' },
```

Import `ArrowsLeftRight` from phosphor (or existing icon set used in Sidebar).

- [ ] **Step 5: Manual UI acceptance** (from spec)

1. Partial same-location empty dest → pending or applied stocking linked.
2. Full transfer empties source.
3. Occupied dest → top-up; dest DOC unchanged.
4. Cross-location dest selectable and saves.
5. Approval on/off paths.
6. Reject leaves cages unchanged.

- [ ] **Step 6: Commit**

```bash
git add lib/fishTransferService.js components/FishTransferForm.js pages/fish-transfers.js components/Sidebar.js
git commit -m "$(cat <<'EOF'
Add fish transfers page, form, and navigation.

EOF
)"
```

---

### Task 5: Polish — cage deep-link + pending UI safety

**Files:**
- Modify: `pages/fish-transfers.js` (read `?sourceCageId=` query)
- Modify: any pending-approvals UI that switches on `type` (search `listPendingApprovals` / `type === 'stocking'`)
- Optional: `lib/tours/systemWalkthrough.js` one step for fish transfers

- [ ] **Step 1: Support `?sourceCageId=`** on the form to preselect source (for future cage-detail “Transfer fish” button). Add a small link from stocking management or cage detail if a natural place exists; otherwise skip the button and only support the query param.

- [ ] **Step 2: Grep for `listPendingApprovals` / `type === 'topup'`** and ensure fish_transfer rows render or are ignored without crashing. Prefer showing them with Approve calling `approveFishTransfer`.

- [ ] **Step 3: Quick walkthrough bullet** (optional, one line) pointing at `/fish-transfers` if the tour already covers stocking.

- [ ] **Step 4: Re-run helper tests + commit**

```bash
node --experimental-strip-types --test convex/lib/fishTransferLogic.test.ts
git add -A
git commit -m "$(cat <<'EOF'
Polish fish transfer deep-links and pending approvals.

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| `fishTransfers` table | 1 |
| `requireApprovalForFishTransfer` | 1 |
| Full/partial source behavior | 2, 3 |
| Empty→stocking / occupied→top-up | 2, 3 |
| Cross-location | 3, 4 (cages.list without location) |
| Atomic approve / reject | 3 |
| Pending does not debit | 3 |
| Approve-time concurrency check | 3 |
| UI form + history + nav | 4 |
| Pending approvals surfacing | 3, 5 |

## Placeholder / consistency self-review

- No TBD steps; biomass and status names match schema.
- Linked stocking/top-up must be inserted via `ctx.db.insert`, not public create mutations, to avoid double cage updates.
- `deriveTransferType` uses `>=` so overshoot cannot become partial; create validation still forbids `quantity > sourceCount`.
