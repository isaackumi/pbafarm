# 04 — Convex Schema Audit

## Stage header

| Item | Detail |
| --- | --- |
| **Objective** | Document every table in `convex/schema.ts` (including the `@convex-dev/auth` tables) as it exists today: purpose, fields, indexes, references, tenant/location scope, mutability, soft-delete, which functions read and write it, and which pages depend on it. Then record cross-cutting data-model problems. No redesign. |
| **Files inspected** | `convex/schema.ts`; every module in `convex/` (`audit, auth, auth.config, biweeklyRecords, cages, companies, crons, dailyRecords, farmLocations, feed, fishTransfers, harvest, health, http, inventory, notifications, reminders, reports, sales, seed, stocking, userAccounts, users`); `convex/lib/{authz,tenancy,feedLedger,growth,farmRules,fishTransferLogic}.ts`; `node_modules/@convex-dev/auth/dist/server/implementation/types.js` (authTables, v0.0.94); `convex/_generated/ai/guidelines.md`; client call sites under `lib/`, `pages/`, `components/`, `contexts/` (grep of `api.<module>.<fn>`); `vitest.config.*`. |
| **Findings** | 25 application tables plus 7 auth tables (the auth `users` table is overridden). Indexes for tenant and site scope exist on most tables, but almost no read path uses them: 57 call sites (22 of them in `reports.ts`) call `ctx.db.query(table).collect()` and filter by company in JavaScript. Feed stock lives in three places that can drift; fish counts live in one mutable counter on `cages` with no movement ledger. Greenfield users (no `companyId`) share a single unscoped data pool. Several write paths accept foreign ids without an ownership check. Details in §4. |
| **Dependencies** | Feeds 05 (relationships), 06 (function inventory), 07 (auth), 09 (calculations), 12 and 15 (risk and debt registers). |
| **Risks** | Read limits are reached as data grows (full scans in reports); cross-tenant writes through unchecked ids; counts and stock drifting with no reconciliation besides `inventory.stockTally`. |
| **Outstanding questions** | Production row counts per table (not measurable from the repo). Whether legacy rows with `companyId` unset exist in production. Whether `users.locationIds` is set by hand in the dashboard. |
| **Completion status** | Complete for schema and code reading. Verified by reading code, `npx tsc --noEmit -p convex` (clean) and `npm test` (4 files, 17 tests pass). Not verified against a live deployment. |

---

## 1. How to read this document

**Scope columns**

- *Org-scoped*: the row has `companyId` and reads filter on it (via `lib/tenancy.listForCompany`, `convex/lib/tenancy.ts:18-27`).
- *Site-scoped*: the row has `locationId` (a `farmLocations` id). Read filtering by site happens only when the client passes `locationId` (`listForCompanyAndLocation`, `tenancy.ts:51-61`).
- *History*: **append-only** (rows never patched), **mutable**, or **mutable + hard-delete**.

**Every `companyId` and `locationId` in the schema is `v.optional`.** Nothing at the schema level stops a row from being written without an owner.

**Tenancy rule in practice** (`tenancy.ts:18-43`): `super_admin` sees every row; a user with `companyId` sees rows with the same `companyId`; a user **without** `companyId` sees rows whose `companyId` is unset. That last rule means all users without a company share one pool of data (finding F1).

**"Used" index** means some function in `convex/` calls `.withIndex(<name>)` on it (Perl scan of `query('<table>').withIndex('<index>')` across `convex/*.ts` and `convex/lib/*.ts`; test files excluded).

**Pages** are the routes and components that call the table's functions, from a grep of `api.<module>.` in `lib/`, `pages/`, `components/` and `contexts/`. Doc 03 has the full route map.

---

## 2. Auth tables (`authTables` from `@convex-dev/auth` 0.0.94)

The library owns and maintains these tables. App code never queries them directly. It reaches them only through `getAuthUserId` (`lib/authz.ts:8`, `users.ts:26`, `userAccounts.ts:90`) and the account helpers `createAccount`, `retrieveAccount` and `modifyAccountCredentials` (`userAccounts.ts:52,102,110`).

| Table | Fields (all from library) | Indexes | Notes |
| --- | --- | --- | --- |
| `authSessions` | `userId: id(users)`, `expirationTime: number` | `userId` | One row per signed-in session. Not company-scoped. Deactivating a user does not delete its sessions (see doc 07). |
| `authAccounts` | `userId: id(users)`, `provider: string`, `providerAccountId: string`, `secret?: string` (password hash), `emailVerified?: string`, `phoneVerified?: string` | `userIdAndProvider`, `providerAndAccountId` | Only the `password` provider is configured (`convex/auth.ts:5-25`). `providerAccountId` is the lower-cased email. Written by sign-up, by `userAccounts.createWithPassword` (`createAccount`) and by `userAccounts.changePassword` (`modifyAccountCredentials`). |
| `authRefreshTokens` | `sessionId: id(authSessions)`, `expirationTime`, `firstUsedTime?`, `parentRefreshTokenId?: id(authRefreshTokens)` | `sessionId`, `sessionIdAndParentRefreshTokenId` | Library-managed. |
| `authVerificationCodes` | `accountId`, `provider`, `code`, `expirationTime`, `verifier?`, `emailVerified?`, `phoneVerified?` | `accountId`, `code` | Unused in practice: no OTP, magic-link or email verification is configured. |
| `authVerifiers` | `sessionId?`, `signature?` | `signature` | OAuth PKCE; no OAuth provider is configured. |
| `authRateLimits` | `identifier`, `lastAttemptTime`, `attemptsLeft` | `identifier` | Password sign-in rate limiting (library default). |
| `users` | — | — | **Overridden** by the app definition below. The override **drops the library's `phone` index**. Phone sign-in is not used, so this is harmless today. |

HTTP routes for auth are registered in `convex/http.ts:6` (`auth.addHttpRoutes`). `convex/auth.config.ts` points at `CONVEX_SITE_URL` as the issuer.

---

## 3. Application tables

### 3.1 `users`

**Purpose.** The identity row. It is extended from the auth library with a role, a single company, and site assignment. There is **no membership table**: a user belongs to at most one company, through `companyId`.

| Field | Type | Optional | Notes |
| --- | --- | --- | --- |
| name, image, email, phone | string | yes | `email` is lower-cased by the Password `profile()` (`auth.ts:7-9`) |
| emailVerificationTime, phoneVerificationTime | number | yes | library |
| isAnonymous | boolean | yes | library |
| role | `'user' \| 'admin' \| 'super_admin'` | yes | Reads treat a missing role as `'user'` (`authz.ts:23`). Sign-up sets `'user'` (`auth.ts:13`). |
| companyId | id(companies) | yes | The single tenant link |
| active | boolean | yes | **Not enforced server-side.** `requireUser` (`authz.ts:7-17`) never checks it. |
| mustChangePassword | boolean | yes | Set by `users.finalizeCreatedUser`; enforcement is client-only (`contexts/AuthContext.js:44`) |
| locationIds | array(id(farmLocations)) | yes | Read by `tenancy.assertLocationAccess` (`tenancy.ts:75`) and `farmLocations.list` (`farmLocations.ts:36`). **No function writes it.** |
| activeLocationId | id(farmLocations) | yes | Current site picker. Written by `setActiveLocation`, `ensureDefaultLocation`, `companies.approve`, `farmLocations.create`, `backfillLocations` |

- **Indexes.** `email` on [email] (used: `companies.approve`, `users.emailExists`, `users.invite`, `users.promoteToSuperAdmin`). There is **no index on `companyId`**; `reminders.ts:84` says so in a comment.
- **Scope.** The row itself is the tenant link. Mutable.
- **Read by.** `lib/authz.requireUser` (every authenticated function); `users.current/get/list/listDirectory/emailExists`; `companies.list` (full scan of all users, `companies.ts:481`); `dailyRecords.insertDailyRecord` (full scan to find admins, `dailyRecords.ts:296-303`); `reminders.digestForCompany` (`take(5000)` then filter, `reminders.ts:85`); `farmLocations.backfillLocations` (full scan); `audit.labelForUser`; `notifications.create/createBulk`.
- **Written by.** The auth library on sign-up; `users.update/invite/deactivate/reactivate/claimInvite/promoteToSuperAdmin(internal)/finalizeCreatedUser(internal)/clearMustChangePassword(internal)`; `companies.approve`; `farmLocations.setActiveLocation/create/backfillLocations`; `lib/tenancy.ensureDefaultLocation`.
- **Pages.** `contexts/AuthContext.js` (every page); `/users` (`components/UserManagement.js`); `/account`; `components/PersonPicker.js`.

### 3.2 `companies` (the "organization")

**Purpose.** The tenant. It holds its registration and approval state, branding, and all configurable business rules, nested under `settings`.

| Field | Type | Optional |
| --- | --- | --- |
| name, code | string | no |
| address, contactEmail, contactPhone, abbreviation, rejectionReason | string | yes |
| logoStorageId | id(_storage) | yes |
| submittedByUserId, approvedBy | id(users) | yes |
| status | `'pending' \| 'approved' \| 'rejected'` | no |
| settings | object (see below) | yes |
| createdAt | number | no |
| approvedAt | number | yes |

`settings` = `{ aiAssistantEnabled: boolean, branding?: {displayName?, accentHex?, themeMode?}, farmRules?: {targetHarvestAbwG?, harvestDocMinDays?, harvestDocMaxDays?, maxDensityFishPerM3?, dailyMortalityAlertPct?, cumulativeMortalityAlertPct?, targetFcr?, maxFcrAlert?}, stockingRules?: {requireApprovalForStocking, requireApprovalForTopup, requireApprovalForFishTransfer?, enforceCageCapacity, min/maxInitialAbwG?, min/maxTopupAbwG?, allowStockOnlyEmptyStatuses?: string[]}, feedRules?: {defaultBagSizeKg?, defaultLocation?, allowNegativeStock?, trackLots?, lowStockMultiplier?, requireBatchOnPurchase?}, locale?: {currency?: 'GHS'|'USD'|'EUR'}, updatedAt?, updatedBy? }` (`schema.ts:63-124`). Defaults are applied at read time by `lib/farmRules.mergeSettings`.

- **Indexes.** `by_code` (used in `companies.register`), `by_status` (used in `companies.listPending`).
- **Scope.** This is the root of each tenant. Mutable. Soft-remove is done by setting `status: 'rejected'` (`companies.remove`, `companies.ts:433-467`). Tenant data is kept.
- **Read by.** `companies.*`; settings loaders in `lib/feedLedger.loadFeedRules`, `stocking.loadRules`, `fishTransfers.loadRules`, `feed.createPurchase`, `inventory.listStockLevels/listAlerts`, `cages.list` (harvest-ready filter), `dailyRecords.insertDailyRecord` (mortality thresholds), `harvest.create`, `reports.farmContextForAi`; `reminders.dailyDigest` (`take(1000)` then filters to `status === 'approved'` in JavaScript, although `by_status` exists).
- **Written by.** `companies.register/approve/reject/remove/updateSettings/publishSettings/setLogo/clearLogo`.
- **Pages.** `/register-company`, `/pending-approval`, `/company-settings`, `/global-settings`, `/admin/*` (registrations), `contexts/CompanySettingsContext.js` (app-wide), `components/AiAssistant.js`, `pages/api/llm/chat.js`.
- **Notes.** `register` does not stop the same user from submitting several pending companies; it only checks `user.companyId` (`companies.ts:257`). `settings` is a single nested document that is rewritten on every publish. That is acceptable at this size.

### 3.3 `companySettingsDrafts`

**Purpose.** An unpublished draft of the company settings form (save, then publish).

| Field | Type | Optional |
| --- | --- | --- |
| companyId | id(companies) | no |
| draft | **v.any()** | no |
| updatedAt | number | no |
| updatedBy | id(users) | yes |

- **Indexes.** `by_company` (used). Expected cardinality is one row per company; this is not enforced, and reads use `.first()`.
- **Read/written by.** `companies.getSettingsDraft`, `saveSettingsDraft`, `publishSettings`.
- **Pages.** `/company-settings`.
- **Notes.** `draft` is untyped. `publishSettings` copies `draft.logoStorageId` straight into `companies.logoStorageId` (`companies.ts:742-744`) without checking that the storage id belongs to this company.

### 3.4 `userInvites`

**Purpose.** A pending invite for an email that has no account yet.

| Field | Type | Optional |
| --- | --- | --- |
| email | string | no |
| role | `'user' \| 'admin'` | no |
| companyId | id(companies) | no |
| invitedBy | id(users) | yes |
| createdAt | number | no |

- **Indexes.** `by_email` (used), `by_company` (**unused**).
- **Read/written by.** `users.invite` (insert or patch), `users.claimInvite` (read, then delete), `users.finalizeCreatedUser` (delete).
- **Pages.** `/users`.
- **Notes.** Invites have no expiry and no status. A claimed invite is hard-deleted. `claimInvite` trusts `users.email`, and the Password provider does not verify email. Anyone who signs up with an invited address joins that company (see doc 07).

### 3.5 `farmLocations` (sites)

**Purpose.** Physical farm sites inside a company. They scope operations and inventory.

| Field | Type | Optional |
| --- | --- | --- |
| companyId | id(companies) | yes |
| name | string | no |
| code, address, notes | string | yes |
| active | boolean | no |
| updatedAt | number | no |

- **Indexes.** `by_company` (used: `tenancy.ensureDefaultLocation`, `companies.approve`, `backfillLocations`, `ensureForCompanyInternal`).
- **Scope.** Org-scoped. Mutable. Deactivated with `active: false`; never deleted.
- **Read by.** `farmLocations.list` (full table scan, `farmLocations.ts:32`), `getActive`, `setActiveLocation`; `tenancy.writeLocationId`; `tenancy.ensureDefaultLocation` (full scan when the user has no company, `tenancy.ts:124`); `feed.createPurchase`; `inventory.createTransfer`; `lib/feedLedger.applyStockChange` (site name for error text).
- **Written by.** `farmLocations.create/update/backfillLocations`, `tenancy.ensureDefaultLocation`, `companies.approve`, `farmLocations.ensureForCompanyInternal` (internal; **no caller found**).
- **Pages.** `/farm-locations`; `contexts/LocationContext.js` (site picker on every page).

### 3.6 `cages` (production units)

**Purpose.** The production unit. It also acts as the **live state of the current batch** (counts, ABW, species, stocking date), because there is no separate batch entity.

| Field | Type | Optional | Maintained by |
| --- | --- | --- | --- |
| name | string | no | user |
| code, location (free text), dimensions, material, notes | string | yes | user |
| size (m³), capacity (fish) | number | yes | user |
| installationDate, lastMaintenanceDate, nextMaintenanceDate | string (ISO date) | yes | user |
| stockingDate | string | yes | copied from stocking on approve |
| initialCount | number | yes | copied from stocking; admin can edit |
| currentCount | number | yes | **mutable counter**, see F6 |
| initialAbw | number | yes | copied from stocking |
| initialBiomass, initialWeight | number | yes | set only by `cages.create/update` and `seed`; stocking never updates them |
| currentWeight | number | yes | `lib/growth.syncCageAbw` (latest biweekly ABW, in grams despite the name) |
| growthRate, mortalityRate | number | yes | **never computed** (only `cages.update` / `seed`) |
| status | `active \| harvested \| harvesting \| maintenance \| fallow \| empty` | no | many paths |
| species | string | yes | from stocking (free-text code, no table) |
| locationId | id(farmLocations) | yes | |
| companyId | id(companies) | yes | |
| createdBy | id(users) | yes | |
| updatedAt | number | no | |

- **Indexes.** `by_name` (unused), `by_status` (used by `getActive` and `growthAll`; **not tenant-prefixed**, so it scans every company's active cages), `by_company` (used only in `seed.seedDemo`), `by_company_status` (used only in `reminders.digestForCompany`), `by_location` (unused), `by_company_location` (unused).
- **Scope.** Org- and site-scoped. Mutable. **Hard delete** (`cages.remove`, `cages.ts:277-294`) with no cascade and no check for child rows.
- **Read by.** `cages.list/get/getActive/growth/growthAll/analytics`; `reports.*` (all six report queries do a full scan); every operational mutation (`dailyRecords`, `biweeklyRecords`, `harvest`, `stocking`, `fishTransfers`, `health`, `sales`, `feed.recordOutboundUsage`); `stocking.listStockingHistory/getStocking/getTopup/listPendingApprovals` (name lookups); `fishTransfers.list/get`; `sales.listSales`; `health.list/activeWithdrawals`; `harvest.list`.
- **Written by.** `cages.create/update/remove`; `dailyRecords.insertDailyRecord/update/remove/createMany` (currentCount); `stocking.createStocking/approveStocking/createTopup/approveTopup`; `fishTransfers.applyFishTransfer`; `harvest.applyHarvestToCage/undoHarvestOnCage`; `lib/growth.syncCageAbw`; `farmLocations.backfillLocations`; `seed.seedDemo`.
- **Pages.** `/cages`, `/cages/[id]`, `/cages/settings`, `/cages/qr-codes`, `/create-cage`, `/dashboard`, `/daily-entry`, `/biweekly-entry`, `/harvest`, `/harvest-sampling`, `/stocking*`, `/fish-transfers`, `/feed-issue`, `/feed-purchases`, `/health`, `/export`, `/report`, `/pnl`. Almost every page reads it.

### 3.7 `feedSuppliers`

| Field | Type | Optional |
| --- | --- | --- |
| name | string | no |
| abbreviation, contactInfo, website | string | yes |
| companyId | id(companies) | yes |
| deletedAt | number | yes |
| updatedAt | number | no |

- **Indexes.** `by_company` (**unused**; `feed.listSuppliers` scans the whole table, `feed.ts:137`).
- **Scope.** Org only. Mutable. **Soft delete** (`softDeleteSupplier`).
- **Read by.** `feed.listSuppliers`, `createPurchase`, `updatePurchase`; `inventory.listStockLevels/listAlerts` (N+1 name lookup per feed type).
- **Written by.** `feed.createSupplier/updateSupplier/softDeleteSupplier`, `seed`.
- **Pages.** `/feed-suppliers`, `/feed-purchases`, `components/QuickCreateModals.js`.
- **Notes.** `toClientSupplier` returns hard-coded empty `phone`, `email` and `address` for legacy UI fields (`feed.ts:19-23`). Contact details are one free-text `contactInfo`.

### 3.8 `feedTypes`

**Purpose.** Feed catalog item. It also holds the **company-wide stock balance**.

| Field | Type | Optional |
| --- | --- | --- |
| name | string | no |
| description | string | yes. Protein %, pellet size and bag size are **parsed out of free text** (`feed.ts:33-52`) |
| currentStock | number (kg) | no. **Denormalized balance**, see F5 |
| minimumStock, pricePerKg | number | no |
| bagSizeKg | number | yes |
| supplierId | id(feedSuppliers) | yes |
| active | boolean | no |
| companyId | id(companies) | yes |
| deletedAt | number | yes |
| updatedAt | number | no |

- **Indexes.** `by_company` (used by `inventory.listStockLevels` and `reminders`), `by_supplier` (unused).
- **Scope.** Org only. There is **no per-site balance on this table**; per-site stock is derived from `feedInventory`. Mutable. Soft delete.
- **Read by.** `feed.listFeedTypes` (full scan); `inventory.listStockLevels/listAlerts/stockTally` (`listAlerts` and `stockTally` do full scans); `reports.dashboardSummary/farmContextForAi` (full scan); `reminders.digestForCompany`; `lib/feedLedger.applyStockChange`; `dailyRecords.deductDailyFeed/createBatch/update`; `feed.createPurchase/updatePurchase/recordOutboundUsage`.
- **Written by.** `feed.createFeedType/updateFeedType/softDeleteFeedType`; `lib/feedLedger.applyStockChange` (`currentStock`); `seed.seedDemo`, which writes `currentStock: 500` **with no ledger row** (`seed.ts:96-106`).
- **Pages.** `/feed-types`, `/feed-management/*`, `/stock-levels`, `/inventory/*`, `/inventory-alerts`, `/daily-entry`, `/feed-issue`, `/feed-purchases`, `/dashboard`.

### 3.9 `feedPurchases`

| Field | Type | Optional |
| --- | --- | --- |
| feedTypeId | id(feedTypes) | no |
| quantity (kg) | number | no |
| bags | number | yes |
| pricePerKg | number | no |
| purchaseDate | string | no |
| supplierId | id(feedSuppliers) | yes. Required by the mutation (`feed.ts:369`), optional in the schema |
| batchNumber, expiryDate, notes | string | yes |
| locationId, companyId | id | yes |
| deletedAt | number | yes |
| updatedAt | number | no |

- **Indexes.** `by_feed_type` (used), `by_company`, `by_location` and `by_company_location` (all **unused**).
- **Scope.** Org and site. Mutable (an admin can change quantity). Soft delete (void).
- **Read by.** `feed.listPurchases` (full scan unless `feedTypeId` is given), `updatePurchase`, `voidPurchase`. No report reads purchases; cost reports use `dailyRecords.feedCost`.
- **Written by.** `feed.createPurchase/updatePurchase/voidPurchase`, `backfillLocations`.
- **Pages.** `/feed-purchases`, `/feed-management/*`.

### 3.10 `feedUsage`

**Purpose.** Feed going out of the store: issues to cages, generic usage, and one row per daily record.

| Field | Type | Optional |
| --- | --- | --- |
| feedTypeId | id(feedTypes) | no |
| cageId | id(cages) | yes |
| quantity (kg) | number | no |
| bags | number | yes |
| usageDate | string | no |
| source | `'issue' \| 'daily' \| 'usage'` | yes |
| notes | string | yes |
| locationId, companyId | id | yes |
| deletedAt | number | yes. **Never set by any function** |
| updatedAt | number | no |

- **Indexes.** `by_feed_type` and `by_cage` (used), `by_company`, `by_location` and `by_company_location` (unused).
- **Scope.** Org and site. Rows are **hard-deleted** by `dailyRecords.reverseDailyFeed` (`dailyRecords.ts:97-105`), which deletes every `source: 'daily'` row for the cage and date.
- **Read by.** `feed.listUsage` (full scan without filter args); `dailyRecords.reverseDailyFeed`.
- **Written by.** `feed.createUsage/createIssue` (through `recordOutboundUsage`); `dailyRecords.deductDailyFeed`; `backfillLocations`.
- **Pages.** `/feed-issue`, `/feed-management/overview`, `lib/feedTrackingService.js`.
- **Notes.** Daily feed exists both here and in `dailyRecords.feedAmount` (F5). Usage and issue rows cannot be edited or voided. `inventory.reverseTransaction` reverses the stock change but leaves the `feedUsage` row in place.

### 3.11 `dailyRecords`

**Purpose.** One row per cage per day: feed, mortality, and optional water quality. It is the main operational log.

| Field | Type | Optional |
| --- | --- | --- |
| cageId | id(cages) | no |
| date | string (YYYY-MM-DD; format not validated) | no |
| feedAmount (kg) | number | no |
| feedTypeId | id(feedTypes) | yes |
| feedType (name copy) | string | yes |
| feedPrice, feedCost | number | no. **Client-supplied** in `create` and `createMany`; computed on the server in `createBatch` and `update` |
| mortality | number | no |
| mortalityCause | string (free text; comment lists a vocabulary) | yes |
| notes | string | yes |
| dissolvedOxygen, temperatureC, secchiCm | number | yes. **The only water-quality storage** besides `biweeklyRecords` |
| locationId, companyId | id | yes |
| createdBy | id(users) | yes |

There is no `updatedAt` or `updatedBy`, so edits are visible only in `auditLogs`.

- **Indexes.** `by_cage` (used), `by_cage_date` (used; serves uniqueness and growth windows), `by_date` (used by `listForDate` and `reminders`; **not tenant-prefixed**), `by_company`, `by_location` and `by_company_location` (unused).
- **Uniqueness.** One row per (cage, date), enforced in the mutation (`dailyRecords.ts:235-241`), not by the schema.
- **Scope.** Org and site (`locationId` copied from the cage). Mutable, with **hard delete** (`remove`).
- **Read by.** `dailyRecords.list` (full scan without `cageId`), `listForDate` (`take(500)` across all tenants, then filtered), `get`; `lib/growth.cageCycleGrowth`; `reports.dashboardSummary/dashboardKpis/exportBundle/productionReport/farmContextForAi` (all full scans), `reports.getProductionMetrics/getCagePnL/listCagePnL` (`by_cage`); `reminders.digestForCompany` (`by_date`, `take(2000)` across all tenants).
- **Written by.** `dailyRecords.create/createBatch/createMany/update/remove`; `seed`; `backfillLocations`.
- **Pages.** `/daily-entry`, `/daily-data`, `/bulk-upload`, `components/DailyUploadPage.js` (offline outbox replay), `components/Dashboard.js`, `/cages/[id]`, `/report`, `/export`, `/pnl`.

### 3.12 `biweeklyRecords` (growth sampling)

| Field | Type | Optional |
| --- | --- | --- |
| cageId | id(cages) | no |
| date | string | no |
| batchCode | string | no. **Globally unique** (F4) |
| averageBodyWeight (g), totalFishCount, totalWeight | number | no |
| dissolvedOxygen, temperatureC, secchiCm | number | yes |
| locationId, companyId | id | yes |
| createdBy, updatedBy | id(users) | yes |
| updatedAt | number | no |

- **Indexes.** `by_cage` and `by_batch_code` (used), `by_company`, `by_date`, `by_location` and `by_company_location` (unused).
- **Scope.** Org and site. Mutable, hard delete (cascades to `biweeklySampling`).
- **Read by.** `biweeklyRecords.list/get`; `lib/growth.cageCycleGrowth/syncCageAbw`; `reports.dashboardKpis/exportBundle/getProductionMetrics/productionReport`.
- **Written by.** `biweeklyRecords.create/createMany/update/remove`, `seed`, `backfillLocations`.
- **Pages.** `/biweekly-entry`, `/biweekly-records`, `/bulk-upload` (`BulkBiweeklyUploadForm`), `/cages/[id]`, `/report`, `/export`.
- **Notes.** `batchCode` here is a sampling-event code. It is **not** the stocking batch (`stockingHistory.batchNumber`), and nothing links the two.

### 3.13 `biweeklySampling`

| Field | Type | Optional |
| --- | --- | --- |
| biweeklyRecordId | id(biweeklyRecords) | no |
| samplingNumber, fishCount, totalWeight, averageBodyWeight | number | no |
| createdBy | id(users) | yes |
| updatedAt | number | no |

- **Indexes.** `by_record` (used only by the cascade delete).
- **Scope.** **No `companyId` or `locationId`.** Scope is inherited only through the parent.
- **Written by.** `biweeklyRecords.create` (when `samples` is passed; `lib/databaseService.js:240-279` passes it), `seed`. Deleted by `biweeklyRecords.remove`.
- **Read by.** **No query reads this table.** The individual samples are written and never shown.

### 3.14 `harvestRecords`

| Field | Type | Optional |
| --- | --- | --- |
| cageId | id(cages) | no |
| harvestDate | string | no |
| averageBodyWeight, totalWeight, estimatedCount | number | no |
| fcr | number | no. **Client-supplied** in `create`; **hard-coded `1.5`** in `createFromSampling` (`harvest.ts:408`) |
| sizeBreakdown | **v.any()** | yes |
| notes | string | yes |
| harvestType | `'complete' \| 'partial'` | yes |
| status | `'completed' \| 'in_progress'` | yes |
| cageEffect | `{fishRemoved, countBefore?, statusBefore?, closedStockingId?: id(stockingHistory)}` | yes. Undo record, see below |
| locationId, companyId | id | yes |
| createdBy | id(users) | yes |

- **Indexes.** `by_cage` (used), `by_company`, `by_date`, `by_location` and `by_company_location` (unused).
- **Scope.** Org and site. Mutable, hard delete (cascades to `harvestSampling`; **does not touch `sales` rows that point at it**).
- **Read by.** `harvest.list` (full scan without `cageId`), `get`, `suggestFcr`; `sales.createSale/harvestSaleSummary`; `reports.dashboardSummary/dashboardKpis/exportBundle/productionReport/getCagePnL/listCagePnL`.
- **Written by.** `harvest.create/update/remove/createFromSampling`, `backfillLocations`.
- **Pages.** `/harvest`, `/harvest-sampling`, `/sales`, `/cages/[id]`, `/report`, `/export`, `/pnl`, `/dashboard`.
- **Notes.** `cageEffect` lets an edit or delete undo the change to the cage. Rows created by `createFromSampling` have **no `cageEffect` and no effect on the cage** (F9).

### 3.15 `harvestSampling`

| Field | Type | Optional |
| --- | --- | --- |
| harvestId | id(harvestRecords) | no |
| cageId | id(cages) | yes |
| date | string | yes |
| weight, fishCount, crateSize, doc, abw | number | yes |
| samples | **v.any()** | no |
| sizeBreakdown | **v.any()** | yes |
| locationId, companyId | id | yes |
| createdBy | id(users) | yes |

- **Indexes.** `by_harvest` and `by_cage` (used), `by_location` (unused). There is **no `by_company` index**.
- **Read by.** `harvest.listSampling` (**no client caller found**), `harvest.remove` (cascade).
- **Written by.** `harvest.createSampling` (from `lib/databaseService.js:527`), `harvest.createFromSampling` (`pages/harvest-sampling.js:79`), `backfillLocations`.
- **Notes.** `createFromSampling` stores the same object in `samples`, `sizeBreakdown` and the parent `harvestRecords.sizeBreakdown` (`harvest.ts:417,432-433`).

### 3.16 `feedInventory` (lots)

**Purpose.** Feed stock lots per feed type, batch, expiry and site. It drives per-site availability and FIFO deduction.

| Field | Type | Optional |
| --- | --- | --- |
| feedTypeId | id(feedTypes) | no |
| quantityKg | number | no |
| batchNumber, expiryDate | string | yes |
| location | string | yes. Legacy store label, default "Main store" |
| locationId, companyId | id | yes |
| updatedAt | number | no |

- **Indexes.** `by_feed_type` (used everywhere in the ledger), `by_company` (used by `inventory.listLots`), `by_location` (used only in a test), `by_company_location` (unused).
- **Scope.** Org and site. **Mutable balance rows. A lot is hard-deleted when it reaches 0** (`feedLedger.ts:150-151`), so lot history is lost.
- **Read by.** `lib/feedLedger.addInventoryLot/siteStock/deductInventoryLots`; `inventory.listLots/stockTally/listStockLevels` (through `siteStock`)/`createTransfer`.
- **Written by.** `lib/feedLedger` (only when `feedRules.trackLots` is on, which is the default); `inventory.createTransfer` (always, whatever `trackLots` says); `backfillLocations`.
- **Pages.** `/inventory/lots`, `/stock-levels`, `/inventory/*`, `/daily-entry` (site stock check).

### 3.17 `feedInventoryTransactions` (feed ledger)

**Purpose.** The signed stock-movement ledger. There is **no `feedTransactions` table**; this is it.

| Field | Type | Optional |
| --- | --- | --- |
| feedTypeId | id(feedTypes) | no |
| transactionType | `purchase \| usage \| issue \| daily_usage \| adjustment \| transfer \| reversal` | no |
| quantityKg | number (signed; transfers are written **positive**) | no |
| bags | number | yes |
| transactionDate | number (ms) | no. Note this is a number, while every operational table stores ISO strings |
| referenceId | string (untyped pointer to a purchase, usage, daily record or transaction) | yes |
| notes | string | yes |
| locationId, companyId | id | yes |
| createdBy | id(users) | yes |

- **Indexes.** `by_feed_type`, `by_company` and `by_reference` (used), `by_location` and `by_company_location` (unused).
- **Scope.** Org and site. **Append-only**: only `backfillLocations` patches existing rows. Corrections are made by writing `reversal` rows.
- **Read by.** `inventory.listTransactions` (bounded `take`; not filtered by site), `stockTally` (reads the **entire** ledger per feed type), `reverseTransaction`; `dailyRecords.reverseDailyFeed` (`by_reference`).
- **Written by.** `lib/feedLedger.applyStockChange` (every stock change), `inventory.createTransfer` (direct insert), `backfillLocations`.
- **Pages.** `/inventory-transactions`, `/inventory/adjust`, `/inventory/analytics`, `/stock-levels`.
- **Notes.** A transfer row has one `locationId` (the destination, or the source if there is none) and a positive quantity (`inventory.ts:325-337`). Per-site balances therefore **cannot be rebuilt from the ledger**. `referenceId` is a string, not a typed id.

### 3.18 `stockingHistory` (the de facto "batch")

**Purpose.** One stocking event that opens a production cycle in a cage. This is the closest thing the app has to a batch or cohort.

| Field | Type | Optional |
| --- | --- | --- |
| cageId | id(cages) | no |
| batchNumber | string | no. Auto-allocated `CAGECODE-YYYYMMDD[-n]`; per-company uniqueness is attempted only when auto-allocating |
| stockingDate | string | no |
| fishCount, initialAbw, initialBiomass | number | no. Not checked to be positive |
| sourceLocation, sourceCage, transferSupervisor, samplingSupervisor, notes | string | yes. Free text, no ids |
| status | `pending_approval \| approved \| rejected` | no |
| closedAt | string | yes. Set by a complete harvest |
| species | string | yes |
| locationId, companyId | id | yes |
| createdBy, approvedBy | id(users) | yes |
| approvedAt, deletedAt | number | yes |

- **Indexes.** `by_cage` (used), `by_status` (used by `listPendingApprovals`; **not tenant-prefixed**, `take(100)`), `by_company`, `by_location` and `by_company_location` (unused).
- **Scope.** Org and site. Mutable (an admin can edit an approved row; `updateStocking` does **not** push changes to the cage). Soft delete applies only to pending or rejected rows.
- **Read by.** `stocking.listStockingHistory` (full scan without `cageId`)/`getStocking`/`getTopup`/`listPendingApprovals`/`suggestBatchNumber`; `stocking.allocateBatchNumber` and `fishTransfers.allocateBatchNumber` (**full table scan, every company**, `stocking.ts:37`, `fishTransfers.ts:42`); `lib/growth.currentStocking`; `harvest.applyHarvestToCage`; `fishTransfers.findApprovedStockingForCage`.
- **Written by.** `stocking.createStocking/updateStocking/removeStocking/approveStocking/rejectStocking`; `fishTransfers.createFishTransfer/applyFishTransfer/rejectFishTransfer`; `harvest.applyHarvestToCage/undoHarvestOnCage` (`closedAt`); `seed`; `backfillLocations`.
- **Pages.** `/stocking`, `/stocking-management`, `/stocking/[id]/details`, `/approvals`, `/export`, `components/StockingForm.js`, `components/QuickCreateModals.js`.

### 3.19 `topupHistory`

| Field | Type | Optional |
| --- | --- | --- |
| stockingId | id(stockingHistory) | no |
| topupDate | string | no |
| fishCount, abw | number | no |
| sourceLocation, transferSupervisor, notes | string | yes |
| status | `pending_approval \| approved \| rejected` | no |
| locationId, companyId | id | yes |
| createdBy, approvedBy | id(users) | yes |
| approvedAt | number | yes |

- **Indexes.** `by_stocking` and `by_status` (used), `by_company` and `by_location` (unused). It has **no `by_company_location` index**, unlike its sibling tables.
- **Scope.** Org and site. Mutable through status transitions only. Never deleted.
- **Read by.** `stocking.getStocking/getTopup/listTopupHistory` (full scan)/`listPendingApprovals`.
- **Written by.** `stocking.createTopup/approveTopup/rejectTopup`; `fishTransfers.createFishTransfer/applyFishTransfer/rejectFishTransfer`; `backfillLocations`.
- **Pages.** `/topup`, `/topup/[id]/details`, `/approvals`, `components/TopUpForm.js`.

### 3.20 `fishTransfers`

| Field | Type | Optional |
| --- | --- | --- |
| sourceCageId, destinationCageId | id(cages) | no |
| sourceLocationId, destinationLocationId | id(farmLocations) | yes |
| sourceStockingId, destinationStockingId | id(stockingHistory) | yes |
| destinationTopupId | id(topupHistory) | yes |
| transferDate | string | no |
| quantity, abw, biomass | number | no |
| transferType | `'full' \| 'partial'` | no |
| transferSupervisor, notes | string | yes |
| status | `pending_approval \| approved \| rejected` | no |
| companyId | id | yes |
| createdBy, approvedBy | id(users) | yes |
| approvedAt | number | yes |
| updatedAt | number | no |

- **Indexes.** `by_status` (used, not tenant-prefixed), `by_company`, `by_source_cage` and `by_destination_cage` (unused; `listFishTransfers` does a full scan and filters in JavaScript, `fishTransfers.ts:138-153`). `by_company_location` is on `['companyId', 'sourceLocationId']`; the name is misleading and the index is unused.
- **Scope.** Org; site through source and destination. Mutable through status transitions. Never deleted.
- **Read by.** `fishTransfers.listFishTransfers/getFishTransfer/approveFishTransfer/rejectFishTransfer`, `stocking.listPendingApprovals`.
- **Written by.** `fishTransfers.createFishTransfer/approveFishTransfer/rejectFishTransfer`.
- **Pages.** `/fish-transfers`, `/approvals`.

### 3.21 `auditLogs`

| Field | Type | Optional |
| --- | --- | --- |
| userId | id(users) | yes |
| actionType, tableName | string | no |
| recordId | string | yes |
| previousValues, newValues | **v.any()** | yes |
| locationId, companyId | id | yes |

- **Indexes.** `by_user`, `by_table` and `by_company` (all used). `by_table` is not tenant-prefixed (F7).
- **Scope.** Org. **`companyId` is the actor's company**, not the record's (`tenancy.ts:170`). Append-only, with no retention policy.
- **Written by.** Only `lib/tenancy.logAudit`, called from 66 of the 76 public mutations (see doc 06). Each call re-runs `requireUser`, which re-reads the user row.
- **Read by.** `audit.list/getByTable/getByUser/getSummary`.
- **Pages.** `/audit-logs`, `lib/auditLogService.js`.
- **Notes.** `tableName` values mix conventions: `'daily_records'` (`dailyRecords.ts:331,541,574`) against camelCase elsewhere, and `'system'` (seed). `previousValues` often holds the **entire prior document**, which grows the table quickly.

### 3.22 `notifications`

| Field | Type | Optional |
| --- | --- | --- |
| userId | id(users) | no |
| title, message | string | no |
| type, link | string | yes |
| read | boolean | no |
| locationId, companyId | id | yes |
| dedupeKey | string | yes |

- **Indexes.** `by_user`, `by_user_read` and `by_dedupe` (all used).
- **Scope.** Per user. Mutable (`read`), hard delete by the owner. **No retention.** The daily cron adds up to two rows per user per day.
- **Read by.** `notifications.listForCurrentUser` (collects **all** of a user's notifications, then slices), `getUnreadCount` (collects to count), `markRead/markAllRead/deleteNotification`; `reminders.notifyOnce`.
- **Written by.** `notifications.create/createBulk/markRead/markAllRead/deleteNotification`; `dailyRecords.insertDailyRecord` (mortality alerts, no `dedupeKey`); `reminders.notifyOnce`.
- **Pages.** `contexts/NotificationContext.js` (header bell on every page).

### 3.23 `customers`

| Field | Type | Optional |
| --- | --- | --- |
| name | string | no |
| contactName, phone, email, notes | string | yes |
| active | boolean | no |
| companyId | id | yes |
| deletedAt | number | yes. **Never set** |
| updatedAt | number | no |

- **Indexes.** `by_company` (unused; `listCustomers` does a full scan).
- **Scope.** Org only. Mutable. No delete function exists.
- **Read/written by.** `sales.listCustomers/createCustomer/updateCustomer` (**no client caller for `updateCustomer`**), `sales.createSale/updateSale`.
- **Pages.** `/sales`.

### 3.24 `sales`

| Field | Type | Optional |
| --- | --- | --- |
| harvestId | id(harvestRecords) | yes |
| cageId | id(cages) | yes |
| customerId | id(customers) | yes |
| customerName | string (copy) | yes |
| saleDate | string | no |
| weightKg, pricePerKg, totalAmount | number | no. `totalAmount` is computed on the server |
| paymentStatus | `pending \| partial \| paid` | yes |
| notes | string | yes |
| locationId, companyId | id | yes |
| createdBy | id(users) | yes |
| updatedAt | number | no |

- **Indexes.** `by_harvest` (used), `by_company`, `by_location`, `by_company_location` and `by_date` (unused). There is **no `by_cage` index**, although both P&L reports filter by cage (F6).
- **Scope.** Org and site. Mutable, **hard delete** (`removeSale`).
- **Read by.** `sales.listSales` (full scan, N+1 cage lookups), `createSale` (sold-weight check), `harvestSaleSummary` (no client caller); `reports.getCagePnL` (full scan of all tenants' sales) and `reports.listCagePnL` (**full scan of `sales` once per cage**, `reports.ts:661`).
- **Written by.** `sales.createSale/updateSale/removeSale`. `updateSale` has no client caller.
- **Pages.** `/sales`, `/pnl`.

### 3.25 `healthTreatments`

| Field | Type | Optional |
| --- | --- | --- |
| cageId | id(cages) | no |
| date | string | no |
| treatment | string | no |
| diagnosis, productName, dosage, administeredBy, notes, withdrawalUntil | string | yes |
| fishAffected, withdrawalDays | number | yes |
| locationId, companyId | id | yes |
| createdBy | id(users) | yes |
| updatedAt | number | no |

- **Indexes.** `by_cage` (used), `by_company`, `by_location`, `by_company_location` and `by_date` (unused).
- **Scope.** Org and site. Insert and hard delete only; there is no update function.
- **Read by.** `health.list` (full scan without `cageId`), `activeWithdrawals` (full scan every call).
- **Written by.** `health.create/remove`.
- **Pages.** `/health`.
- **Notes.** `fishAffected` is not linked to mortality or cage counts. Withdrawal windows do not block harvest; `harvest.create` never reads `healthTreatments`.

---

## 4. Cross-cutting findings

Severity: **Critical**, **High**, **Medium**, **Low**. Status uses the shared vocabulary. "Confidence" applies where the behaviour was inferred from code rather than run.

### F1. Users without a company share one unscoped data pool. High. Implemented but potentially defective.

`listForCompany` returns rows whose `companyId` is unset to any user whose `companyId` is unset (`tenancy.ts:23-25`). `assertOwns` grants write access on the same rule (`tenancy.ts:41`). A brand-new sign-up (role `user`, no company, `auth.ts:13`) can therefore read and modify:

- legacy pre-tenancy rows;
- rows created by every other unassigned user, through `cages.create`, `feed.createFeedType`, `dailyRecords.create` and so on;
- seed data.

`tenancy.ensureDefaultLocation` puts all such users on a shared "Main farm" location (`tenancy.ts:124-128`). Confidence: High, from code. Not reproduced at runtime.

### F2. Foreign ids accepted without ownership checks. High. Implemented but potentially defective.

| Path | Unchecked id | Effect |
| --- | --- | --- |
| `dailyRecords.create` → `insertDailyRecord` → `deductDailyFeed` (`dailyRecords.ts:50-81, 231`) | `feedTypeId` | Deducts stock from, and writes ledger rows to, **another company's** feed type (`applyStockChange` takes `companyId` from the feed type, `feedLedger.ts:193`) |
| `dailyRecords.createBatch` (`:409-416`) | `feedTypeId` | Checks only that it exists and is not deleted, then does the same as above |
| `dailyRecords.createMany` (`:581-645`) | `feedTypeId` | Same |
| `dailyRecords.update` (`:494-501`) | `patch.feedTypeId` | Same |
| `feed.createFeedType`, `feed.updateFeedType` (`feed.ts:242,294`) | `supplierId` | Links to another tenant's supplier; `inventory.listStockLevels` then shows its name |
| `harvest.createSampling` (`harvest.ts:350,370`) | `cageId` | Sampling row points at a foreign cage |
| `sales.updateSale` (`sales.ts:328-332`) | `customerId` | Copies another tenant's customer name into the sale |
| `inventory.createTransfer` (`inventory.ts:270-279`) | `fromLocationId`, `toLocationId` | Lots tagged with another tenant's site; no `assertLocationAccess` |
| `companies.publishSettings` (`companies.ts:742-744`) | `draft.logoStorageId` (from `v.any()`) | Points the logo at any storage object |

Exploiting these needs a foreign document id. Ids are opaque but not secret, and some appear in URLs. Confidence: High.

### F3. `farmLocations.backfillLocations` runs across tenants, and any company admin can call it. High. Implemented but potentially defective.

`farmLocations.ts:195-325` is a **public mutation** gated only by `requireRole(user, 'admin')`. It does all of the following:

- reads all companies;
- creates "Main farm" sites for every approved company;
- full-scans eleven operational tables, plus `cages`, `users` and `farmLocations`;
- patches `locationId` on every company's rows;
- patches `activeLocationId` on every user.

The `/farm-locations` page shows a "Backfill existing data" button to any admin (`pages/farm-locations.js:139-147`). The mutation is also a single unbounded transaction, so it will exceed transaction limits on a real dataset. Confidence: High.

### F4. Biweekly batch codes are unique across all tenants. High (correctness and information leak). Implemented but potentially defective.

`biweeklyRecords.create/createMany/update` check `by_batch_code` with no company prefix (`biweeklyRecords.ts:92-96, 156-160, 203-211`). Company B cannot use a code company A already used. The error "Batch code already exists" also confirms that the code exists in another tenant. `createMany` silently skips the duplicate.

### F5. Feed stock is stored three ways, and they can drift. High. Implemented but incomplete.

1. **`feedTypes.currentStock`**: one company-wide scalar per feed type, patched on every `applyStockChange` (`feedLedger.ts:287-290`).
2. **`feedInventory` lots**: per site, batch and expiry. Maintained only when `feedRules.trackLots` is on. Deleted at zero.
3. **`feedInventoryTransactions`**: the signed ledger.

Known ways they diverge:

- `seed.seedDemo` sets `currentStock: 500` with no ledger row and no lot (`seed.ts:99`). `inventory.stockTally` then reports `ok: false`.
- `inventory.createTransfer` writes a positive `transfer` row with a single `locationId`. `stockTally` skips transfers, but per-site ledger balances are impossible.
- `feed.updatePurchase` quantity changes, `feed.voidPurchase` and `inventory.reverseTransaction` call `applyStockChange` **without `locationId`**. Positive deltas create a site-less "shared" lot; negative deltas take FIFO from **any** site's lots (`feedLedger.ts:133-143`). The site that bought the feed is not necessarily the one debited.
- `siteStock` treats `currentStock - sum(lots)` as "untracked" shared stock (`feedLedger.ts:103`). Toggling `trackLots` off and back on silently moves the difference into a shared pool.
- `inventory.reverseTransaction` on a `usage` or `issue` restores stock but leaves the `feedUsage` row in place, so `feed.listUsage` overstates consumption.
- Daily feed is stored twice: `dailyRecords.feedAmount` and a `feedUsage` row with `source: 'daily'`. `reverseDailyFeed` matches the usage row by `(cageId, usageDate, source)` rather than by a reference id (`dailyRecords.ts:97-105`). If a second daily-sourced usage row exists for the same cage and date, both are deleted.

`inventory.stockTally` (`inventory.ts:478-517`) is the only reconciliation tool. It compares `currentStock` with the ledger sum and reports `lots_sum`, but does not judge whether the lots are correct.

### F6. Fish counts are one mutable counter with no movement ledger. High. Implemented but incomplete.

`cages.currentCount` is changed in place by nine code paths:

- daily mortality: insert, update by difference, and restore on delete;
- stocking approve, which **overwrites** the count;
- top-up create and approve (`+=`);
- fish-transfer apply, on both the source and the destination;
- harvest apply and undo;
- the admin manual edit in `cages.update`.

No table records the resulting opening and closing balance per event. A batch's live count cannot be rebuilt from history except by approximation (`lib/growth.cageCycleGrowth` falls back to `stocked - mortality` only when `currentCount` is null, `growth.ts:94`).

Related duplication:

- `cages.stockingDate`, `initialCount` and `initialAbw` are **copies** of the open `stockingHistory` row. `stocking.updateStocking` edits the history but not the cage (`stocking.ts:317-350`). `approveStocking` overwrites them without closing any previous open stocking (`stocking.ts:410-418`).
- `cages.initialBiomass`, `initialWeight`, `growthRate` and `mortalityRate` are never computed on the server. They are stale user-entered values.
- `cages.currentWeight` is a cached copy of the latest `biweeklyRecords.averageBodyWeight` (`growth.ts:143-155`). It is re-synced only by biweekly mutations, and holds grams despite the name.
- `stockingHistory.fishCount` and `topupHistory.fishCount` are not checked to be positive. `assertStockingAllowed` and `assertTopupAllowed` check ABW, capacity and density only (`farmRules.ts:209-276`). A negative top-up lowers the cage count.

### F7. Truncated reads across tenants. Medium to High. Implemented but potentially defective.

Several reads take the first N rows from an index that is not tenant-prefixed, then filter by company. Once the whole system (not one tenant) exceeds N, a tenant gets incomplete results:

| Function | Read | Effect when exceeded |
| --- | --- | --- |
| `dailyRecords.listForDate` (`:178-182`) | `by_date`, `take(500)` | Daily entry form marks cages "not done" when they are done |
| `reminders.digestForCompany` (`:57-60`) | `by_date`, `take(2000)` | False "missed entry" reminders |
| `reminders.digestForCompany` (`:85`) | `users.take(5000)` | Users after row 5000 get no reminders |
| `reminders.dailyDigest` (`:125`) | `companies.take(1000)` | Companies after row 1000 skipped |
| `stocking.listPendingApprovals` (`:638-654`) | `by_status`, `take(100)` per type | Pending items invisible to approvers |
| `audit.getByTable` (`:94-98`) | `by_table`, `take(maxRows*2)` | Audit history appears empty |
| `cages.growthAll` (`:135-138`) | `by_status`, `take(300)` | Cages missing from the farm growth table |
| `audit.list/getSummary` for super_admin | unindexed, `take` | Expected: global view |

### F8. Full-table scans instead of the indexes that exist. High (scale). Implemented but incomplete.

57 call sites run `ctx.db.query('<table>').collect()` with no index, then filter by company in JavaScript. Per file: reports 22, farmLocations 6, feed 4, inventory 4, stocking 3, and 1–2 each in biweeklyRecords, cages, companies, dailyRecords, fishTransfers, harvest, health, sales, users and lib/tenancy. A further dynamic per-table loop runs in `backfillLocations`. The `by_company` and `by_company_location` indexes they need are already defined on almost every table **but are unused**. Every such query reads **every tenant's rows**, and as a reactive subscription it re-runs on **any write by any tenant** to that table.

The worst cases:

- `reports.listCagePnL` reads the whole `sales` table once per cage, plus `dailyRecords` and `harvestRecords` per cage (`reports.ts:649-696`).
- `reports.dashboardSummary` and `dashboardKpis` read all `cages`, `dailyRecords`, `harvestRecords`, `feedTypes` and `biweeklyRecords`.
- `reports.productionReport` and `exportBundle` read four full tables.
- `stocking.allocateBatchNumber` and `fishTransfers.allocateBatchNumber` read all of `stockingHistory` on every stocking.
- `inventory.stockTally` reads the full ledger per feed type.

Convex enforces per-transaction read limits (on the order of 16 MiB and tens of thousands of documents scanned; confirm the exact figures for convex 1.42 in the docs). `dailyRecords` grows by cages × days. A single tenant with 50 cages adds about 18,000 rows a year, so the report queries are likely to fail inside the first year or two of multi-tenant use. Confidence: Medium on timing, High on the mechanism.

### F9. Harvest from sampling skips the cage effect. High. Implemented but potentially defective.

`harvest.createFromSampling` (`harvest.ts:386-450`) is used by `/harvest-sampling` (`pages/harvest-sampling.js:79`). It inserts a `complete` harvest but:

- does not call `applyHarvestToCage`, so the cage stays `active` with its count;
- does not close the stocking;
- stores no `cageEffect`;
- hard-codes `fcr: 1.5` instead of `lib/growth.harvestFcr`.

The cage then still shows live fish after a complete harvest, and the open cycle keeps accruing feed into eFCR.

### F10. Approvals can double-apply. Medium. Implemented but potentially defective.

`stocking.listPendingApprovals` hides stockings and top-ups that are linked to a pending fish transfer (`stocking.ts:656-669`). `approveStocking` and `approveTopup` do not refuse them, though, and the UI calls those mutations by id.

Approving a linked top-up through `approveTopup` adds the fish (`stocking.ts:580-586`). If the transfer is then approved, `applyFishTransfer` adds them **again** (`fishTransfers.ts:101-120`), because it only skips the status change, not the count change. `approveStocking` also does not re-run `assertStockingAllowed`. Two pending stockings for one empty cage can both be approved, and the second overwrites the first. Confidence: Medium (needs a UI path that exposes the linked row; `/stocking/[id]/details` and `/topup/[id]/details` call approve).

### F11. Hard deletes and lost history. Medium.

| Function | What is lost | Mitigation |
| --- | --- | --- |
| `cages.remove` (`cages.ts:277-294`) | The cage. Children (`dailyRecords`, `stockingHistory`, `harvestRecords`, `sales`, `healthTreatments`, `feedUsage`, `biweeklyRecords`, `fishTransfers`) **are left orphaned**, with `cageId` pointing at a deleted row | Audit snapshot of the cage |
| `dailyRecords.remove`, `biweeklyRecords.remove`, `harvest.remove`, `sales.removeSale`, `health.remove` | Operational facts | Audit snapshot |
| `dailyRecords.reverseDailyFeed` | `feedUsage` rows | None |
| `feedLedger.deductInventoryLots` | Exhausted lots (batch and expiry history) | None |
| `harvest.remove` | `harvestSampling` children; does not touch linked `sales` | Audit snapshot of the harvest only |

Soft delete is inconsistent. `feedSuppliers`, `feedTypes`, `feedPurchases` and `stockingHistory` use `deletedAt`. `feedUsage` and `customers` have the field but nothing sets it. Every other table hard-deletes.

### F12. `v.any()` and missing return validators. Medium.

- **Schema** (6 uses): `companySettingsDrafts.draft`, `harvestRecords.sizeBreakdown`, `harvestSampling.samples`, `harvestSampling.sizeBreakdown`, `auditLogs.previousValues`, `auditLogs.newValues`.
- **Arguments** (7 uses): `companies.saveSettingsDraft.draft`, `companies.publishSettings.draft`, `harvest.create.sizeBreakdown`, `harvest.update.patch.sizeBreakdown`, `harvest.createSampling.samples` and `.sizeBreakdown`, `harvest.createFromSampling.sizes`.
- **Returns**: **none of the 148 exported functions declares a `returns` validator.**
- Many handlers type `ctx` or documents as `any` (`stocking.ts:11,26`, `fishTransfers.ts:17-121`, `dailyRecords.ts:37-145`, `feed.ts:609-625`, `companies.ts:11-66`). This goes against the guideline "NEVER use `any` for ctx parameters".

### F13. Inconsistent naming. Low to Medium.

- The database uses camelCase. Every query maps rows to snake_case through hand-written `toClient` functions, and returns both `id` and `_id`. `fishTransfers.listFishTransfers/getFishTransfer` spread the raw camelCase document instead (`fishTransfers.ts:162-167`), so the API is inconsistent between modules.
- Date fields are named `date`, `harvestDate`, `saleDate`, `usageDate`, `purchaseDate`, `stockingDate`, `topupDate` and `transferDate`. They are ISO strings, except `feedInventoryTransactions.transactionDate`, which is a number in milliseconds.
- Quantities are named `quantity` (kg) in `feedPurchases` and `feedUsage`, `quantityKg` in lots and the ledger, and `currentStock` (kg, implicit) on `feedTypes`.
- Index names do not follow the guideline `by_field1_and_field2`: `by_company_location`, `by_cage_date`, `by_user_read`, `by_company_status`. The library index is just `email`. `fishTransfers.by_company_location` actually indexes `sourceLocationId`.
- `auditLogs.tableName` mixes `'daily_records'` with camelCase table names, plus `'system'`.
- Free-text fields stand in for references: `cages.location`, `feedInventory.location`, `stockingHistory.sourceLocation`, `sourceCage`, `transferSupervisor` and `samplingSupervisor`, `topupHistory.sourceLocation`, and `healthTreatments.administeredBy`. `components/PersonPicker.js` selects a user and stores the **name string**.

### F14. Indexes that should exist but do not. Medium.

| Access pattern in code | Missing index |
| --- | --- |
| Users of a company (`reminders.ts:85`, `dailyRecords.ts:296`, `users.list/listDirectory`, `companies.list` count) | `users.by_companyId` |
| Sales by cage (`reports.getCagePnL/listCagePnL`) | `sales.by_cage` (or `by_company_and_cage`) |
| Daily records by company and date (`listForDate`, reminders, dashboards) | `dailyRecords.by_companyId_and_date` |
| Pending approvals per company | `stockingHistory/topupHistory/fishTransfers.by_companyId_and_status` |
| Batch number allocation | `stockingHistory.by_companyId_and_batchNumber` |
| Biweekly batch code per company | `biweeklyRecords.by_companyId_and_batchCode` |
| Audit by company and table, and by record | `auditLogs.by_companyId_and_tableName`, `by_recordId` |
| Lots by feed type and site (FIFO, `siteStock`) | `feedInventory.by_feedTypeId_and_locationId` |
| Ledger by feed type and site | `feedInventoryTransactions.by_feedTypeId_and_locationId` |
| Health withdrawals by company and `withdrawalUntil` | `healthTreatments.by_companyId_and_withdrawalUntil` |
| Customers or suppliers by company | exists (`by_company`), unused |

### F15. Indexes defined but never used. Low (write cost only).

- `cages`: `by_name`, `by_location`, `by_company_location` (`by_company` is used only in seed).
- `feedSuppliers.by_company`, `feedTypes.by_supplier`.
- `feedPurchases`: `by_company`, `by_location`, `by_company_location`.
- `feedUsage`: `by_company`, `by_location`, `by_company_location`.
- `dailyRecords`: `by_company`, `by_location`, `by_company_location`.
- `biweeklyRecords`: `by_company`, `by_date`, `by_location`, `by_company_location`.
- `harvestRecords`: `by_company`, `by_date`, `by_location`, `by_company_location`.
- `harvestSampling.by_location`.
- `feedInventory`: `by_location` (test only), `by_company_location`.
- `feedInventoryTransactions`: `by_location`, `by_company_location`.
- `stockingHistory`: `by_company`, `by_location`, `by_company_location`.
- `topupHistory`: `by_company`, `by_location`.
- `fishTransfers`: `by_company`, `by_source_cage`, `by_destination_cage`, `by_company_location`.
- `customers.by_company`, `userInvites.by_company`.
- `sales`: `by_company`, `by_location`, `by_company_location`, `by_date`.
- `healthTreatments`: `by_company`, `by_location`, `by_company_location`, `by_date`.

About 40 indexes in total. Most are exactly what F8 needs. They were added for tenancy and site scope, but the read paths were never switched over.

### F15b. Unbounded `.collect()` that is not a table scan. Medium.

Index-bounded reads that still grow without limit:

- `notifications.listForCurrentUser` (all of a user's notifications);
- `getUnreadCount` (counts by collecting);
- `inventory.stockTally` (full ledger per feed type);
- `lib/feedLedger` lot reads per feed type (all sites);
- `lib/growth.cageCycleGrowth` (all biweekly records per cage);
- `stocking.getStocking` (top-ups);
- `sales.createSale` (all sales of a harvest);
- `dailyRecords.reverseDailyFeed` (all `feedUsage` rows of the cage, `dailyRecords.ts:97-100`).

The last one runs on every daily-record edit and grows with cage age.

### F16. N+1 reads (`ctx.db.get` in loops). Low to Medium.

| Function | Loop | Location |
| --- | --- | --- |
| `cages.growthAll` | ≤300 cages × (`currentStocking` + biweekly + daily range) | `cages.ts:143-151` |
| `reports.getProductionMetrics` | 2 index reads per cage | `reports.ts:321-370` |
| `reports.listCagePnL` | 2 index reads plus 1 **full** `sales` scan per cage | `reports.ts:653-696` |
| `inventory.listStockLevels` | supplier `get` plus `siteStock` lots read per feed type | `inventory.ts:100-131` |
| `inventory.listAlerts` | supplier `get` per feed type | `inventory.ts:455-471` |
| `inventory.stockTally` | 2 full index reads per feed type | `inventory.ts:489-514` |
| `inventory.listLots` | feed type `get` per new feed type (memoized) | `inventory.ts:419-425` |
| `sales.listSales`, `health.list`, `health.activeWithdrawals` | cage `get` per row (not memoized) | `sales.ts:164-171`, `health.ts:62-65,166-169` |
| `stocking.listStockingHistory` | cage `get` per row | `stocking.ts:126-145` |
| `fishTransfers.listFishTransfers` | 2 cage `get` per row | `fishTransfers.ts:156-169` |
| `audit.list/getByTable` | user `get` per log row (≤500) | `audit.ts:75-79,110-113` |
| `notifications.createBulk` | user `get` per target | `notifications.ts:151-168` |

### F17. Ownership and location gaps. Medium.

- `companyId` and `locationId` are optional on every table. Rows written by users without a company get no `companyId` (F1).
- `biweeklySampling` has no `companyId` and is scoped only through its parent.
- `auditLogs.companyId` is the actor's company. A super_admin's actions on a tenant's record (approve, reject or remove a company) are stored with `companyId` unset, and the tenant's admins never see them.
- **Site scope is not enforced on reads.** `listForCompanyAndLocation` filters only when the client sends `locationId`. Omitting it returns every site. `user.locationIds` is never written by any function, so `assertLocationAccess` always passes for non-admins in practice (`tenancy.ts:72-80`). Most writes copy `cage.locationId` and never call `assertLocationAccess` at all (daily, biweekly, harvest, stocking, transfer, health). Status: Partially implemented.

### F18. Wall clock read inside queries. Low to Medium.

The guideline says queries should not read the wall clock. These do:

- `reports.dashboardSummary` and `dashboardKpis` (`new Date()`, `reports.ts:14,107`);
- `reports.farmContextForAi` (`:536`);
- `health.activeWithdrawals` (default `asOf`, `health.ts:158`);
- `stocking.suggestBatchNumber` (`stocking.ts:312`);
- `cages.growth` and `cages.growthAll`, through `lib/growth.cageCycleGrowth`'s default `asOf` (`growth.ts:56`).

The query cache does not invalidate at midnight, so "last 30 days" and "days of culture" are stale until some write happens.

### F19. Data growth and retention. Medium.

| Table | Growth driver | Retention or rollup |
| --- | --- | --- |
| `dailyRecords` | cages × days | None. Every dashboard reads all of it (F8) |
| `feedInventoryTransactions` | every feed movement, plus reversals on every daily edit | None. `stockTally` reads all of it per feed type |
| `auditLogs` | every mutation, often with full previous documents | None |
| `notifications` | the cron adds up to two per user per day | None. `listForCurrentUser` collects all of them |
| `feedUsage` | every daily record plus issues | None |

There are no aggregate or summary tables (for example daily per-site totals or cycle totals). Every KPI is recomputed from raw rows on each subscription. `reminders.dailyDigest` processes every company in one mutation (`reminders.ts:121-134`), so its cost grows linearly with tenants × cages × users.

### F20. Audit coverage gaps. Low to Medium.

These mutations write no audit row:

- `users.reactivate`, `users.claimInvite`;
- `companies.clearLogo`;
- `farmLocations.setActiveLocation`, `farmLocations.ensureDefault` (implicit site creation);
- `notifications.markRead/markAllRead`;
- `reminders.*`;
- `dailyRecords.createMany`, used by bulk upload and the offline outbox (`components/BulkDailyUploadForm.js:84`, `lib/databaseService.js:203`).

`applyStockChange` audits only negative-stock overrides. Ordinary stock movements rely on the ledger. Sign-in, sign-out and password-change events are not audited (`userAccounts.changePassword` writes nothing). `users.update` records only the previous `role` and `name`.

### F21. Validation gaps. Medium.

- `dailyRecords.create` and `createMany` do not reject negative or non-integer `mortality` or negative `feedAmount`. Only `createBatch` (`:400`) and `update` (`:472-477`) do.
- `dailyRecords.create` and `createMany` accept client-supplied `feedPrice` and `feedCost`. Feed cost totals in reports can therefore be wrong.
- `harvest.create` accepts client `fcr`. `harvest.update` changing `harvestDate` does not move the closed stocking's `closedAt`.
- `stocking.createStocking`, `createTopup` and `fishTransfers.createFishTransfer` do not require a positive `fishCount` or `quantity`. `createFishTransfer` does check `quantity <= 0` (`fishTransfers.ts:219`).
- No date string anywhere is validated as `YYYY-MM-DD`, yet range filters use string comparison.
- Every user can change cage `status` freely (`cages.update`); only counts require admin.
- `sales.updateSale` does not re-check sold weight against the harvest total.

### F22. Convex guideline deviations. Low.

- `crons.daily(...)` (`crons.ts:8`). The guidelines require `crons.interval` or `crons.cron`.
- No `returns` validators (F12).
- Unbounded `.collect()` everywhere (F8 and F15b). The guidelines prefer `.take` or pagination.
- `.collect().length` used for counting (`notifications.getUnreadCount`).
- Wall clock read in queries (F18).
- `any`-typed `ctx` (F12).
- Index naming (F13).
- `userAccounts.createWithPassword` and `changePassword` are public actions that call `ctx.runQuery(api.users.current)` and then internal mutations. This is acceptable: identity is derived on the server, not from arguments.

### F23. Test coverage of the schema. Low. Informational.

`vitest.config` includes only `convex/*.test.ts`, so `convex/lib/fishTransferLogic.test.ts` **never runs**. `npm test` runs 4 files with 17 tests, covering growth, harvest, reminders and siteStock. No test covers tenancy isolation, feed ledger reversal, stocking approval or transfers.

---

## 5. Summary table

| Table | Org | Site | History model | Soft delete | Index use | Biggest issue |
| --- | --- | --- | --- | --- | --- | --- |
| users | link | assign (never written) | mutable | `active` flag (not enforced) | email only | no company index; `active` ignored |
| companies | root | — | mutable | status=rejected | ok | — |
| companySettingsDrafts | yes | — | mutable | — | ok | v.any |
| userInvites | yes | — | mutable/delete | — | partial | no expiry; unverified email claim |
| farmLocations | yes | root | mutable | `active` | partial | list is a full scan |
| cages | yes | yes | mutable/**hard delete** | — | poor | counter drift; orphaning delete |
| feedSuppliers | yes | — | mutable | yes | none | full scan |
| feedTypes | yes | no | mutable balance | yes | partial | company-wide `currentStock` |
| feedPurchases | yes | yes | mutable | yes (void) | partial | void hits any site's lots |
| feedUsage | yes | yes | insert/hard delete | field unused | partial | duplicate of daily feed |
| dailyRecords | yes | yes | mutable/hard delete | — | partial | full scans; cross-tenant feedTypeId |
| biweeklyRecords | yes | yes | mutable/hard delete | — | partial | global batchCode |
| biweeklySampling | **no** | no | insert/cascade | — | ok | never read |
| harvestRecords | yes | yes | mutable/hard delete | — | partial | createFromSampling skips cage |
| harvestSampling | yes | yes | insert/cascade | — | ok | v.any; triple copy |
| feedInventory | yes | yes | mutable/deleted at 0 | — | partial | lot history lost |
| feedInventoryTransactions | yes | yes | **append-only** | — | partial | transfers not site-signed |
| stockingHistory | yes | yes | mutable | yes | partial | batch number scan; cage copy drift |
| topupHistory | yes | yes | status transitions | — | partial | double-apply risk |
| fishTransfers | yes | src/dest | status transitions | — | poor | full scan list |
| auditLogs | actor's | yes | append-only | — | ok | unbounded; actor-company |
| notifications | yes | unused | mutable/delete | — | ok | no retention |
| customers | yes | — | mutable | field unused | none | full scan |
| sales | yes | yes | mutable/hard delete | — | partial | no by_cage; P&L N×scan |
| healthTreatments | yes | yes | insert/hard delete | — | partial | withdrawal not enforced at harvest |
