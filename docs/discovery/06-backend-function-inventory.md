# 06 — Backend Function Inventory

## Stage header

| Item | Detail |
| --- | --- |
| **Objective** | List every Convex function the backend exposes: queries, mutations, actions, internal functions, HTTP routes and crons. For each, record kind, argument validator summary, returns validator, auth check, tenant scoping, tables read and written, side effects, unbounded reads and client callers. Flag public functions without auth, without a tenant check, or taking ids without an ownership check. |
| **Files inspected** | All 23 modules in `convex/` (excluding `_generated` and tests) and `convex/lib/*.ts`; `convex/_generated/ai/guidelines.md`; `node_modules/@convex-dev/auth/dist/server/implementation/index.d.ts`; client call sites (grep for `api.<module>.<fn>` across `lib/`, `pages/`, `components/`, `contexts/`). |
| **Findings** | 148 exported functions: 64 `query`, 76 `mutation`, 2 `action`, 1 `internalQuery`, 5 `internalMutation`. The auth library adds 4 more (`signIn`, `signOut`, `isAuthenticated`, `store`), plus 1 HTTP router and 1 cron. **No function declares a `returns` validator.** Every public function except the auth endpoints and `users.current` calls `requireUser`. Tenant isolation comes from post-read JavaScript filters (`listForCompany`) rather than indexed reads. 11 functions accept a foreign id without an ownership check. One admin mutation (`farmLocations.backfillLocations`) writes across all tenants. 11 public functions have no client caller. |
| **Dependencies** | Doc 04 (tables and findings F1–F23), doc 05 (relationships), doc 07 (authentication and authorization). |
| **Risks** | Cross-tenant writes (§4.2, §4.3); read-limit failures on report queries (§4.4); deactivated users keep full access (`requireUser` ignores `users.active`). |
| **Outstanding questions** | Whether any unlisted client (scripts, the dashboard, the `pages/api/llm/chat.js` server route) calls the functions marked "no caller". Whether `reminders.runForMyCompanyNow` and `seed.seedDemo` are meant to stay public. |
| **Completion status** | Complete. Built from reading every handler. `npx tsc --noEmit -p convex` passes. `npm test` passes 17 tests in 4 files; `convex/lib/fishTransferLogic.test.ts` is excluded by `vitest.config` (`include: ['convex/*.test.ts']`). |

---

## 1. Shared helpers every function relies on

| Helper | File:line | What it does | Caveat |
| --- | --- | --- | --- |
| `requireUser(ctx)` | `lib/authz.ts:7-17` | `getAuthUserId`, then loads the `users` row; throws if either is missing | **Does not check `users.active`.** Deactivated users pass. |
| `requireRole(user, r)` | `lib/authz.ts:19-28` | Hierarchy `super_admin > admin > user` | A role is global, not per company |
| `assertCompanyAccess` | `lib/authz.ts:30-38` | Company equality check | **Never called** anywhere |
| `listForCompany(user, rows)` | `lib/tenancy.ts:18-27` | Post-read filter: super_admin sees all; members see their company; users with no company see unscoped rows | Runs **after** reading; the read itself is cross-tenant |
| `listForCompanyAndLocation` | `lib/tenancy.ts:51-61` | Above, plus an optional `locationId` equality | Does not apply `user.locationIds` |
| `assertOwns(user, doc)` | `lib/tenancy.ts:34-43` | Same rule as `listForCompany`, for one document | Used in only 9 places; most code calls `listForCompany(user,[doc])` instead (same effect) |
| `writeCompanyId(user)` | `lib/tenancy.ts:63-65` | Returns `user.companyId` | Undefined for users without a company, so rows are written unowned |
| `assertLocationAccess` | `lib/tenancy.ts:68-80` | Non-admins limited to `user.locationIds` | `locationIds` is never written, so this always passes |
| `writeLocationId` | `lib/tenancy.ts:86-108` | Explicit site, else the active site; checks access, active flag and company | Only used where a site is passed directly (cages, purchases, usage, sales) |
| `ensureDefaultLocation` | `lib/tenancy.ts:114-148` | Creates "Main farm" if the company has no active site | Full table scan for users without a company; often called twice per mutation |
| `logAudit` | `lib/tenancy.ts:150-172` | Inserts an `auditLogs` row | Calls `requireUser` again; `companyId` is the actor's |
| `applyStockChange` | `lib/feedLedger.ts:164-314` | Feed ledger row, `feedTypes.currentStock` patch, lot add or FIFO deduct, negative-stock override rules | Takes `companyId` from the feed type; **no ownership check inside** |
| `cageCycleGrowth` | `lib/growth.ts:53-123` | Cycle KPIs from stocking, biweekly and daily rows | Default `asOf` reads the wall clock |

Abbreviations in the tables below:

- **RU**: `requireUser`
- **RR(a)** / **RR(sa)**: `requireRole` admin / super_admin
- **LFC** / **LFCL**: `listForCompany` / `listForCompanyAndLocation` post-filter
- **AO**: `assertOwns`
- **FS**: full table scan (`query(t).collect()` with no index)
- **Audit**: calls `logAudit`
- **Ledger**: calls `applyStockChange`
- **Notif**: inserts notifications
- "Caller": where the client calls it. "none" means no reference found in `lib/`, `pages/`, `components/` or `contexts/`.

`returns` validator: **absent for all 148 functions**, so the column is omitted.

---

## 2. Inventory by module

### 2.1 `auth.ts`, `http.ts`, `auth.config.ts`, `crons.ts`

| Function | Kind | Args | Auth | Notes |
| --- | --- | --- | --- | --- |
| `signIn` | action (library) | library | public by design | Password provider only. Profile sets `role: 'user'`. Minimum 6-character password (`auth.ts:5-21`). No email verification. |
| `signOut` | action (library) | — | public by design | |
| `isAuthenticated` | query (library) | — | public by design | |
| `store` | internalMutation (library) | — | internal | Writes `users`, `authAccounts`, `authSessions`, `authRefreshTokens`, `authRateLimits` |
| HTTP router | `httpRouter` | — | — | Only `auth.addHttpRoutes(http)` (`http.ts:6`). No app-defined `httpAction`. |
| Cron "daily entry and low stock reminders" | `crons.daily` at 16:00 UTC | `{}` | internal | Calls `internal.reminders.dailyDigest` (`crons.ts:8-13`). Uses `crons.daily`, which the guidelines say not to use (use `crons.cron`). |

### 2.2 `users.ts`

| Function (line) | Kind | Args | Auth | Tenant check | Reads | Writes | Side effects | Bounds / flags | Caller |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `current` (23) | query | — | `getAuthUserId`; returns null if unauthenticated | own row | users | — | — | Returns the **raw user document** plus aliases | `contexts/AuthContext.js`, `userAccounts` |
| `get` (35) | query | `id: id(users)` | RU | super_admin, same company, or self | users | — | — | ok | `lib/userService.js` |
| `list` (48) | query | — | RU, RR(a) | JS filter by `companyId` | users **FS** | — | — | Unbounded; no `users.by_company` index | `/users` |
| `listDirectory` (65) | query | — | RU | JS filter | users **FS** | — | — | Unbounded | `components/PersonPicker.js` |
| `emailExists` (86) | internalQuery | `email` | internal | — | users (`email`) | — | — | `.unique()` throws on duplicate emails | `userAccounts.createWithPassword` |
| `update` (97) | mutation | `id`, `patch{name?,phone?,role?}` | RU, RR(a) | same company unless super_admin; blocks granting super_admin | users | users | Audit (role and name only) | A company admin can demote another admin, or a super_admin who has a `companyId` | `/users` |
| `invite` (136) | mutation | `email`, `name?`, `role?` | RU, RR(a) | refuses users in another company | users (`email`), userInvites (`by_email`) | users or userInvites | Audit | **Flag:** an existing user with no company (for example one with a pending company registration) is pulled into the inviter's company without consent | `/users` |
| `deactivate` (210) | mutation | `id` | RU, RR(a) | same company | users | users.active | Audit | `active` is not enforced anywhere (§4.1) | `/users` |
| `reactivate` (234) | mutation | `id` | RU, RR(a) | same company | users | users.active | **no audit** | | `/users` |
| `claimInvite` (252) | mutation | — | RU | invite matched by email | userInvites | users, userInvites (delete) | **no audit** | **Flag:** trusts an unverified email (doc 07) | `lib/userService.js` |
| `promoteToSuperAdmin` (278) | internalMutation | `email` | internal (CLI) | — | users | users.role | none | | README |
| `finalizeCreatedUser` (294) | internalMutation | `userId, companyId, role, name?, actorId` | internal (identity propagated from the action) | caller-supplied `companyId` | users, userInvites | users, userInvites | Audit | | `userAccounts.createWithPassword` |
| `clearMustChangePassword` (336) | internalMutation | `userId` | internal | — | users | users | none | | `userAccounts.changePassword` |

### 2.3 `userAccounts.ts`

| Function | Kind | Args | Auth | Tenant | Effects | Flags | Caller |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `createWithPassword` (18) | action | `email, name?, role?, password` | `runQuery(api.users.current)`, then an admin or super_admin check | new user put in the caller's company | `createAccount` (authAccounts, users), then `finalizeCreatedUser` | Three separate transactions (query, create, finalize). If finalize fails, the user exists with no company. Temporary password travels as an argument. | `components/UserManagement.js` |
| `changePassword` (84) | action | `currentPassword, newPassword` | `getAuthUserId` | self | `retrieveAccount`, `modifyAccountCredentials`, `clearMustChangePassword` | No audit. Does not revoke other sessions. | `/account` |

### 2.4 `companies.ts`

| Function (line) | Kind | Args | Auth | Tenant check | Reads | Writes | Side effects | Flags | Caller |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `register` (217) | mutation | name, code, address?, contactEmail?, contactPhone?, abbreviation? | RU | user must have no company | companies (`by_code`) | companies | Audit | One user can file unlimited pending registrations | `/register-company` |
| `listPending` (300) | query | — | RU, RR(sa) | global | companies (`by_status`) | — | — | Unbounded `.collect()` | `/admin` registrations |
| `approve` (315) | mutation | `companyId`, `userId?` | RU, RR(sa) | global | companies, users, farmLocations | companies, users (companyId, role=admin, activeLocationId), farmLocations | Audit | | admin page |
| `reject` (397) | mutation | `companyId`, `reason?` | RU, RR(sa) | global | companies | companies | Audit (actor company) | | admin page |
| `remove` (433) | mutation | `companyId`, `reason?` | RU, RR(sa) | global | companies | companies.status=rejected | Audit | Soft. Users stay linked to the company and keep access, because no check reads `companies.status` | `/global-settings` |
| `list` (469) | query | `status?` | RU, RR(sa) | global | companies **FS**, users **FS** | — | — | Unbounded, two full scans | `/global-settings` |
| `get` (498) | query | `id` | RU | own company or super_admin | companies, `_storage` URL | — | — | | several |
| `updateSettings` (514) | mutation | `id`, `patch{name?,address?,contactEmail?,aiAssistantEnabled?}` | RU + inline admin-of-company check | yes | companies | companies | Audit | | `lib/companyService.js` |
| `aiAssistantStatus` (565) | query | — | RU | own company | companies | — | — | | `components/AiAssistant.js` |
| `getCurrentCompany` (586) | query | — | RU | own | companies | — | — | | `lib/companyService.js` |
| `getEffectiveSettings` (599) | query | — | RU | own | companies | — | — | | `contexts/CompanySettingsContext.js` and others |
| `getSettingsDraft` (617) | query | — | RU, RR(a) | own | companies, companySettingsDrafts | — | — | | `/company-settings` |
| `saveSettingsDraft` (665) | mutation | `draft: v.any()` | RU, RR(a), company admin | own | drafts | drafts | Audit | `v.any()` | `/company-settings` |
| `publishSettings` (704) | mutation | `draft?: v.any()` | RU, RR(a), company admin | own | companies, drafts | companies, drafts | Audit (previous and new settings) | **Flag:** `draft.logoStorageId` not verified (doc 04, F2); `validateSettingsForPublish` covers numbers and enums only | `/company-settings` |
| `generateLogoUploadUrl` (790) | mutation | — | RU, RR(a) | must have company | — | `_storage` upload URL | — | No size or type limit | `/company-settings` |
| `setLogo` (800) | mutation | `storageId: id(_storage)` | RU, RR(a) | own company | companies | companies; deletes the previous storage object | Audit | Any storage id is accepted | `/company-settings` |
| `clearLogo` (826) | mutation | — | RU, RR(a) | own | companies | companies; storage delete | **no audit** | | `/company-settings` |

### 2.5 `farmLocations.ts`

| Function (line) | Kind | Args | Auth | Tenant | Reads | Writes | Side effects | Flags | Caller |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `list` (28) | query | `includeInactive?` | RU | LFC, plus `locationIds` for non-admins | farmLocations **FS** | — | — | Unbounded | `contexts/LocationContext.js` (every page) |
| `getActive` (50) | query | — | RU | LFC + location access | farmLocations | — | — | | none |
| `ensureDefault` (68) | mutation | — | RU | own company | farmLocations (FS if no company) | farmLocations, users | **no audit** | Called on app load from `LocationContext` | `contexts/LocationContext.js` |
| `setActiveLocation` (77) | mutation | `locationId` | RU | LFC + location access | farmLocations | users | none | | `contexts/LocationContext.js` |
| `create` (93) | mutation | name, code?, address?, notes?, active? | RU, RR(a) | own company | — | farmLocations, users | Audit | | `/farm-locations` |
| `update` (133) | mutation | `id`, patch | RU, RR(a) | LFC | farmLocations | farmLocations | Audit | Can deactivate the site users are on | `/farm-locations` |
| `backfillLocations` (195) | mutation | `promoteCageLocationStrings?` | RU, RR(a) | **none: operates on all companies** | companies, farmLocations, cages, 11 operational tables, users (all **FS**) | farmLocations, all 11 tables, users | Audit | **Critical flag:** cross-tenant write by any company admin; unbounded single transaction | `/farm-locations` button |
| `ensureForCompanyInternal` (328) | internalMutation | `companyId` | internal | given company | farmLocations | farmLocations | — | Dead code | none |

### 2.6 `cages.ts`

| Function (line) | Kind | Args | Auth | Tenant | Reads | Writes | Side effects | Flags | Caller |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `list` (51) | query | status?, locationId?, filter? | RU | LFCL | cages **FS**, companies | — | — | Unbounded; `by_company_location` unused | 15 call sites |
| `get` (89) | query | `id` | RU | LFC | cages | — | — | | 4 |
| `getActive` (101) | query | locationId? | RU | LFCL | cages (`by_status`, all tenants) | — | — | Unbounded across tenants | 3 |
| `growth` (115) | query | `id` | RU | LFC | cages, stockingHistory, biweeklyRecords, dailyRecords | — | — | Wall clock read (default `asOf`) | `/cages/[id]` |
| `growthAll` (131) | query | locationId? | RU | LFCL | cages (`by_status`, `take(300)` before the tenant filter) + 3 reads per cage | — | — | N+1; truncates across tenants; wall clock read | 2 (dashboard) |
| `create` (160) | mutation | 15 optional cage fields | RU (no role) | own company; `writeLocationId` | farmLocations | cages, maybe farmLocations and users | Audit | `ensureDefaultLocation` called twice | 2 |
| `update` (218) | mutation | `id`, patch (21 fields) | RU; RR(a) only for count fields | LFC; `writeLocationId` if moving | cages, farmLocations | cages | Audit (whole previous document) | Any user may set `status`, ABW or initialAbw | 2 |
| `remove` (277) | mutation | `id` | RU, RR(a) | LFC | cages | cages (**hard delete**) | Audit | No cascade; orphans every child table (doc 05, R1) | 2 |
| `analytics` (296) | query | locationId? | RU | LFCL | cages **FS** | — | — | | none |

### 2.7 `dailyRecords.ts`

| Function (line) | Kind | Args | Auth | Tenant | Reads | Writes | Side effects | Flags | Caller |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `list` (147) | query | cageId?, dateFrom?, dateTo?, locationId? | RU | LFCL | dailyRecords (FS without `cageId`) | — | — | Unbounded | 4 |
| `listForDate` (174) | query | `date` | RU | LFC | dailyRecords (`by_date`, `take(500)`, all tenants) | — | — | Truncates across tenants (doc 04, F7) | `/daily-entry` |
| `get` (192) | query | `id` | RU | LFC | dailyRecords | — | — | | 3 |
| `create` (337) | mutation | cageId, date, feedAmount, feedTypeId?, feedType?, **feedPrice, feedCost**, mortality, mortalityCause?, notes?, DO?, temp?, secchi?, allowNegative?, overrideReason? | RU | AO(cage); **feed type not ownership-checked** | cages, dailyRecords, companies, users **FS** (mortality alert), feedTypes, feedInventory | dailyRecords, cages.currentCount, notifications, feedUsage, ledger | Audit, Ledger, Notif | **Flag:** foreign `feedTypeId` (doc 04, F2); client-priced cost; no non-negative check | `lib/databaseService.js`, `DailyEntryForm` |
| `createBatch` (365) | mutation | date, `records[]` (≤100), allowNegative?, overrideReason? | RU | LFC(cage); feed type existence only | same as create, per line | same, per line | Audit per line, Ledger, Notif | **Flag:** foreign `feedTypeId`; up to 100 × (ledger + lots + users FS) in one transaction | `/daily-entry` |
| `update` (444) | mutation | `id`, patch(12 fields), allowNegative?, overrideReason? | RU (no role) | LFC(record); **`patch.feedTypeId` not checked** | dailyRecords, feedTypes, feedInventoryTransactions (`by_reference`), feedUsage (`by_cage`, all rows) | dailyRecords, cages, feedUsage (delete + insert), ledger | Audit, Ledger | Any user can edit any record in the company, including old ones | `lib/databaseService.js` |
| `remove` (550) | mutation | `id` | RU, RR(a) | LFC | as `update` | dailyRecords (**hard delete**), cages, feedUsage, ledger | Audit, Ledger | | 1 |
| `createMany` (581) | mutation | `records[]` (unbounded length), allowNegative?, overrideReason? | RU | AO(cage); **feed type not checked** | cages, dailyRecords, feedTypes, lots | dailyRecords, cages, feedUsage, ledger | Ledger; **no audit; no mortality alerts; skips duplicates silently** | **Flag:** no array length cap; no validation | `BulkDailyUploadForm`, `lib/databaseService.js` (offline outbox replay) |

### 2.8 `biweeklyRecords.ts`

| Function (line) | Kind | Args | Auth | Tenant | Reads | Writes | Side effects | Flags | Caller |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `list` (29) | query | cageId?, dateFrom?, dateTo?, locationId? | RU | LFCL | biweeklyRecords (FS without `cageId`) | — | — | Unbounded | 6 |
| `get` (52) | query | `id` | RU | LFC | biweeklyRecords | — | — | | 2 |
| `create` (64) | mutation | cageId, date, batchCode, ABW, count, weight, DO?, temp?, secchi?, `samples[]?` | RU | AO(cage) | biweeklyRecords (`by_batch_code`, **global**) | biweeklyRecords, biweeklySampling, cages.currentWeight | Audit | **Flag:** batch code uniqueness is cross-tenant (doc 04, F4) | 2 |
| `createMany` (137) | mutation | `records[]` (unbounded) | RU | AO(cage) | same | biweeklyRecords, cages | Audit (count only) | Skips duplicates silently; no length cap | `BulkBiweeklyUploadForm` |
| `update` (184) | mutation | `id`, patch(5 fields) | RU | LFC | biweeklyRecords | biweeklyRecords, cages | Audit | Cannot edit water-quality fields | 1 |
| `remove` (230) | mutation | `id` | RU, RR(a) | LFC | biweeklySampling | biweeklySampling, biweeklyRecords (**hard delete**), cages | Audit | | 1 |

### 2.9 `harvest.ts`

| Function (line) | Kind | Args | Auth | Tenant | Reads | Writes | Side effects | Flags | Caller |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `list` (50) | query | cageId?, dateFrom?, dateTo?, locationId? | RU | LFCL | harvestRecords (FS without `cageId`), cages | — | — | Unbounded | 4 |
| `get` (83) | query | `id` | RU | LFC | harvestRecords | — | — | | 3 |
| `suggestFcr` (190) | query | cageId, harvestDate, totalWeight | RU | LFC | cages, stockingHistory, biweeklyRecords, dailyRecords | — | — | | `HarvestForm` |
| `create` (206) | mutation | cageId, harvestDate, ABW, totalWeight, estimatedCount, **fcr**, sizeBreakdown (`v.any`)?, notes?, harvestType?, status? | RU | AO(cage) | cages, companies, stockingHistory | harvestRecords, cages, stockingHistory.closedAt | Audit | Client-supplied FCR; withdrawal windows not checked | `lib/databaseService.js` |
| `update` (263) | mutation | `id`, patch (9 fields incl. `v.any`) | RU (no role) | LFC | harvestRecords, cages, stockingHistory | harvestRecords, cages, stockingHistory | Audit | Date change does not move `closedAt` | 1 |
| `remove` (317) | mutation | `id` | RU, RR(a) | LFC | harvestSampling | harvestSampling, harvestRecords (**hard delete**), cages, stockingHistory | Audit | Linked `sales` left orphaned | 1 |
| `createSampling` (347) | mutation | harvestId, cageId?, date?, weight?, fishCount?, crateSize?, `samples: v.any`, sizeBreakdown?, doc?, abw? | RU | LFC(harvest); **`cageId` not checked** | harvestRecords | harvestSampling | Audit | **Flag:** foreign `cageId` | `lib/databaseService.js` |
| `createFromSampling` (386) | mutation | cageId, date, weight, fishCount, `sizes: v.any`, doc?, abw?, harvestType?, notes? | RU | AO(cage) | cages | harvestRecords, harvestSampling | Audit | **Defect:** no cage effect, no stocking close, `fcr = 1.5` (doc 04, F9) | `/harvest-sampling` |
| `listSampling` (452) | query | harvestId?, cageId? | RU | LFC | harvestSampling (FS with no args) | — | — | | none |

### 2.10 `stocking.ts`

| Function (line) | Kind | Args | Auth | Tenant | Reads | Writes | Side effects | Flags | Caller |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `listStockingHistory` (100) | query | cageId?, status?, includeDeleted?, locationId? | RU | LFCL | stockingHistory (FS without `cageId`), cages (N+1) | — | — | Unbounded | 6 |
| `getStocking` (150) | query | `id` | RU | LFC | stockingHistory, cages, topupHistory | — | — | | `/stocking/[id]/details` |
| `getTopup` (183) | query | `id` | RU | LFC | topupHistory, stockingHistory, cages | — | — | | `/topup/[id]/details` |
| `createStocking` (224) | mutation | cageId, batchNumber?, stockingDate, fishCount, initialAbw, initialBiomass, 4 free-text people and places, notes?, species? | RU | AO(cage) | cages, companies, stockingHistory **FS** (batch allocation) | stockingHistory; cages if auto-approved | Audit | Positive count not enforced; user-supplied batch number not checked for uniqueness | `StockingForm`, `QuickCreateModals` |
| `suggestBatchNumber` (300) | query | cageId, stockingDate? | RU | LFC | cages, stockingHistory **FS** | — | — | Wall clock read; FS of every tenant | `StockingForm` |
| `updateStocking` (317) | mutation | `id`, patch(9 fields) | RU; RR(a) if approved | LFC | stockingHistory | stockingHistory | Audit | Does not sync to the cage | 1 |
| `removeStocking` (353) | mutation | `id`, reason? | RU, RR(a) | LFC | stockingHistory | stockingHistory.deletedAt | Audit | Pending or rejected only | 1 |
| `approveStocking` (385) | mutation | `id` | RU, RR(a) | LFC | stockingHistory | stockingHistory, cages (**overwrite**) | Audit | Does not re-check cage rules or an existing open stocking; does not refuse rows linked to a pending transfer (doc 04, F10) | 3 |
| `rejectStocking` (429) | mutation | `id`, reason? | RU, RR(a) | LFC | stockingHistory | stockingHistory | Audit | Does not reject the linked transfer | 3 |
| `listTopupHistory` (464) | query | stockingId?, status? | RU | LFC | topupHistory (FS without `stockingId`) | — | — | | 2 |
| `createTopup` (490) | mutation | stockingId, topupDate, fishCount, abw, sourceLocation?, transferSupervisor?, notes? | RU | AO(stocking) | stockingHistory, cages, companies | topupHistory; cages if auto-approved | Audit | Negative `fishCount` accepted | `TopUpForm` |
| `approveTopup` (552) | mutation | `id` | RU, RR(a) | LFC | topupHistory, stockingHistory, cages | topupHistory, cages (`+=`) | Audit | Double-count risk with a linked transfer | 3 |
| `rejectTopup` (597) | mutation | `id`, reason? | RU, RR(a) | LFC | topupHistory | topupHistory | Audit | | 3 |
| `listPendingApprovals` (632) | query | — | RU, RR(a) | LFC | stockingHistory, topupHistory, fishTransfers (`by_status`, `take(100)` each, all tenants), cages, stockingHistory (N+1) | — | — | Truncates across tenants | `/approvals` |

### 2.11 `fishTransfers.ts`

| Function (line) | Kind | Args | Auth | Tenant | Reads | Writes | Side effects | Flags | Caller |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `listFishTransfers` (123) | query | status?, sourceCageId?, destinationCageId?, locationId? | RU | LFC | fishTransfers **FS**, cages (2 per row) | — | — | Unbounded; returns the raw camelCase document | 2 |
| `getFishTransfer` (173) | query | `id` | RU | LFC | fishTransfers, cages | — | — | | none |
| `createFishTransfer` (194) | mutation | sourceCageId, destinationCageId, transferDate, quantity, abw, transferSupervisor?, notes? | RU (no role) | LFC(both cages) | cages, companies, stockingHistory (**FS** for batch allocation + `by_cage`) | stockingHistory or topupHistory, fishTransfers; cages if auto-approved | Audit | No site-access check | `FishTransferForm` |
| `approveFishTransfer` (375) | mutation | `id` | RU, RR(a) | LFC | fishTransfers, cages, stockingHistory, topupHistory | fishTransfers, stockingHistory or topupHistory, cages (source and destination) | Audit | Re-checks source count but not destination rules or status | 3 |
| `rejectFishTransfer` (409) | mutation | `id`, reason? | RU, RR(a) | LFC | fishTransfers, stockingHistory, topupHistory | the same three | Audit | | 3 |

### 2.12 `feed.ts`

| Function (line) | Kind | Args | Auth | Tenant | Reads | Writes | Side effects | Flags | Caller |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `listSuppliers` (133) | query | includeDeleted? | RU | LFC | feedSuppliers **FS** | — | — | | 4 |
| `createSupplier` (146) | mutation | name, abbreviation?, contactInfo?, website? | RU (no role) | own | — | feedSuppliers | Audit | | `QuickCreateModals`, `lib/supplierService.js` |
| `updateSupplier` (171) | mutation | `id`, patch | RU | LFC | feedSuppliers | feedSuppliers | Audit | | 1 |
| `softDeleteSupplier` (200) | mutation | `id` | RU, RR(a) | LFC | feedSuppliers | feedSuppliers.deletedAt | Audit | | 1 |
| `listFeedTypes` (221) | query | includeDeleted? | RU | LFC | feedTypes **FS** | — | — | | 12 |
| `createFeedType` (234) | mutation | name, description?, currentStock?, minimumStock?, pricePerKg, bagSizeKg?, **supplierId?**, active? | RU; RR(a) if opening stock | own; **supplier not checked** | — | feedTypes; ledger and lots for opening stock | Audit, Ledger | **Flag:** foreign `supplierId` | 4 |
| `updateFeedType` (285) | mutation | `id`, patch incl. **supplierId?** | RU (no role) | LFC(feed type); **supplier not checked** | feedTypes | feedTypes | Audit | **Flag:** foreign `supplierId`; any user can change `pricePerKg` | 2 |
| `softDeleteFeedType` (317) | mutation | `id` | RU, RR(a) | LFC | feedTypes | feedTypes.deletedAt | Audit | Lots and stock left as they are | 2 |
| `listPurchases` (338) | query | feedTypeId?, dateFrom?, dateTo?, locationId? | RU | LFCL | feedPurchases (FS without `feedTypeId`) | — | — | | 2 |
| `createPurchase` (362) | mutation | feedTypeId, quantity?, bags?, pricePerKg, purchaseDate, supplierId, batchNumber?, expiryDate?, notes?, location?, locationId? | RU (no role) | LFC(feed type, supplier); `writeLocationId` | feedTypes, feedSuppliers, companies, farmLocations | feedPurchases, ledger, lots, feedTypes | Audit, Ledger | Purchase price does not update `feedTypes.pricePerKg` | 2 |
| `updatePurchase` (449) | mutation | `id`, quantity?, bags?, pricePerKg?, purchaseDate?, supplierId?, batchNumber?, expiryDate?, notes? | RU, RR(a) | LFC | feedPurchases, feedTypes, feedSuppliers | feedPurchases, ledger | Audit, Ledger | Quantity delta applied **without `locationId`** (doc 04, F5) | 1 |
| `voidPurchase` (528) | mutation | `id`, reason? | RU, RR(a) | LFC | feedPurchases | feedPurchases.deletedAt, ledger (forced negative allowed) | Audit, Ledger | Reversal **without `locationId`** | 1 |
| `listUsage` (576) | query | feedTypeId?, cageId?, dateFrom?, dateTo?, locationId? | RU | LFCL | feedUsage (FS with no filter args) | — | — | | 4 |
| `createUsage` (687) | mutation | feedTypeId, cageId?, quantity?, bags?, usageDate, notes?, allowNegative?, overrideReason?, locationId? | RU | LFC(feed type, cage); `writeLocationId` | feedTypes, cages, farmLocations | feedUsage, ledger | Audit, Ledger | | 2 |
| `createIssue` (709) | mutation | same as `createUsage` | RU | same | same | same | Audit, Ledger | Issued feed is **not** counted in cycle eFCR | `/feed-issue` |

### 2.13 `inventory.ts`

| Function (line) | Kind | Args | Auth | Tenant | Reads | Writes | Side effects | Flags | Caller |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `listStockLevels` (75) | query | includeInactive?, locationId? | RU | `by_company` index (members) / FS (super_admin, users with no company), then LFC | feedTypes, companies, feedSuppliers (N+1), feedInventory (per type) | — | — | One of the few properly indexed reads | 6 |
| `listTransactions` (139) | query | feedTypeId?, transactionType?, dateFrom?, dateTo?, limit? | RU | `by_company` or `by_feed_type`, `take(≤1000)`, then LFC | ledger | — | — | Bounded. Ignores the active site. Filters by date and type after `take`, so results can be short. | 3 |
| `createAdjustment` (197) | mutation | feedTypeId, quantityKg (signed), bags?, notes, allowNegative?, overrideReason?, location?, batchNumber?, expiryDate? | RU, RR(a) | LFC | feedTypes | ledger, lots, feedTypes | Audit, Ledger | **No `locationId` argument**, so adjustments cannot target a site lot except through the legacy `location` string | `/inventory/adjust` |
| `createTransfer` (249) | mutation | feedTypeId, quantityKg, fromLocation?, toLocation?, fromLocationId?, toLocationId?, notes?, batchNumber? | RU, RR(a) | LFC(feed type); **sites not checked** | farmLocations, feedTypes, feedInventory | feedInventory (deduct + add), ledger (direct insert) | Audit | **Flag:** foreign site ids accepted; ledger row has a single site and positive quantity | `/inventory/adjust` |
| `reverseTransaction` (352) | mutation | transactionId, reason | RU, RR(a) | LFC | ledger | ledger, lots, feedTypes | Audit, Ledger | Not site-aware; leaves `feedUsage` in place; can reverse a transaction twice (no "already reversed" check) | `/inventory-transactions` |
| `listLots` (396) | query | feedTypeId?, locationId? | RU | `by_company` index / FS, then LFCL | feedInventory, feedTypes (memoized) | — | — | Unbounded but indexed | 3 |
| `listAlerts` (435) | query | — | RU | LFC | feedTypes **FS**, companies, feedSuppliers (N+1) | — | — | Company-wide only; ignores per-site shortage | 2 |
| `stockTally` (478) | query | feedTypeId? | RU (no role) | LFC | feedTypes **FS**; entire ledger and lots per type | — | — | Unbounded ledger read per feed type | `/inventory/*` |

### 2.14 `sales.ts`

| Function (line) | Kind | Args | Auth | Tenant | Reads | Writes | Side effects | Flags | Caller |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `listCustomers` (53) | query | includeInactive? | RU | LFC | customers **FS** | — | — | | `/sales` |
| `createCustomer` (65) | mutation | name, contactName?, phone?, email?, notes? | RU, RR(a) | own | — | customers | Audit | | `/sales` |
| `updateCustomer` (98) | mutation | `id`, patch | RU, RR(a) | LFC | customers | customers | Audit | | none |
| `listSales` (143) | query | harvestId?, locationId?, dateFrom?, dateTo? | RU | LFCL | sales (FS without `harvestId`), cages (N+1) | — | — | | `/sales` |
| `createSale` (176) | mutation | harvestId?, cageId?, customerId?, customerName?, saleDate, weightKg, pricePerKg, paymentStatus?, notes?, locationId? | RU (no role) | LFC(harvest), AO(cage), LFC(customer); `writeLocationId` | harvestRecords, cages, customers, sales (`by_harvest`) | sales | Audit | | `/sales` |
| `updateSale` (283) | mutation | `id`, patch(7 fields incl. customerId) | RU (no role) | LFC(sale); **`customerId` not checked** | sales, customers | sales | Audit | **Flag:** foreign customer name copied in; weight not re-checked against the harvest | none |
| `removeSale` (350) | mutation | `id` | RU, RR(a) | LFC | sales | sales (**hard delete**) | Audit | | `/sales` |
| `harvestSaleSummary` (371) | query | harvestId | RU | LFC | harvestRecords, sales | — | — | | none |

### 2.15 `health.ts`

| Function (line) | Kind | Args | Auth | Tenant | Reads | Writes | Side effects | Flags | Caller |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `list` (41) | query | cageId?, locationId?, dateFrom?, dateTo? | RU | LFCL | healthTreatments (FS without `cageId`), cages (N+1) | — | — | | `/health` |
| `create` (70) | mutation | cageId, date, diagnosis?, treatment, productName?, dosage?, fishAffected?, withdrawalDays?, administeredBy?, notes? | RU | LFC(cage) | cages | healthTreatments | Audit | | `/health` |
| `remove` (130) | mutation | `id` | RU, RR(a) | LFC | healthTreatments | healthTreatments (**hard delete**) | Audit | | `/health` |
| `activeWithdrawals` (151) | query | locationId?, asOf? | RU | LFCL | healthTreatments **FS**, cages (N+1) | — | — | Wall clock read for the default `asOf` | `/health` |

### 2.16 `reports.ts`

All report functions are read-only queries, RU only (no role), with tenant scoping by post-filter.

| Function (line) | Args | Tenant | Reads | Flags | Caller |
| --- | --- | --- | --- | --- | --- |
| `dashboardSummary` (6) | dateRange?, locationId? | LFCL / LFC | **FS** of cages, dailyRecords, harvestRecords, feedTypes | Four full scans per subscription; wall clock read | `components/Dashboard.js` |
| `dashboardKpis` (99) | dateRange?, locationId? | LFCL | **FS** of cages, dailyRecords, biweeklyRecords, harvestRecords | Wall clock read; averages client-supplied harvest FCR | `components/Dashboard.js` |
| `exportBundle` (187) | dateFrom, dateTo, cageId? | LFC (**ignores site**) | dailyRecords, biweeklyRecords, harvestRecords (FS without `cageId`) | Omits water quality and mortality cause | `/export` |
| `getProductionMetrics` (303) | cageId?, dateFrom?, dateTo? | LFC | cages **FS**; 2 reads per cage | N+1 | none |
| `productionReport` (377) | reportType (free string), startDate, endDate, cageIds[] | LFC | **FS** of cages, dailyRecords, biweeklyRecords, harvestRecords | `reportType` is echoed back and not validated | `/report` |
| `farmContextForAi` (516) | — | LFC; requires `aiAssistantEnabled` | **FS** of cages, dailyRecords, feedTypes | Wall clock read. The result is sent to a third-party LLM by `pages/api/llm/chat.js` (see doc 13). | `components/AiAssistant.js` |
| `getCagePnL` (571) | cageId, dateFrom?, dateTo? | LFC(cage) | dailyRecords, harvestRecords (`by_cage`), **sales FS (all tenants)** | Revenue from sales; cost is feed only | `/pnl` |
| `listCagePnL` (641) | locationId?, dateFrom?, dateTo? | LFCL | cages **FS**; per cage: dailyRecords, harvestRecords, **sales FS** | **Worst query in the codebase**: O(cages × all sales rows) | `/pnl` |

### 2.17 `notifications.ts`

| Function (line) | Kind | Args | Auth | Tenant | Reads | Writes | Side effects | Flags | Caller |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `listForCurrentUser` (21) | query | limit?, unreadOnly? | RU | own `userId` | notifications (`by_user`, collect all) | — | — | Unbounded; `limit` applied after collecting | `lib/notificationService.js` |
| `getUnreadCount` (49) | query | — | RU | own | notifications (`by_user_read`, collect) | — | — | Counts with `.collect().length` | same |
| `markRead` (63) | mutation | `id` | RU | owner check | notifications | notifications | — | | same |
| `markAllRead` (80) | mutation | — | RU | own | notifications | notifications | — | Unbounded patch loop | same |
| `create` (100) | mutation | userId, title, message, type?, link? | RU (**no role**) | target in the same company (or both without a company) | users | notifications | Audit | **Flag:** any user can send any message and link to any colleague; users with no company can target each other | `lib/notificationService.js` |
| `createBulk` (139) | mutation | `userIds[]`, title, message, type?, link? | RU (no role) | skips users in other companies | users (N+1) | notifications | Audit | Same as `create`; no array cap | none |
| `deleteNotification` (180) | mutation | `id` | RU | owner check | notifications | notifications (delete) | Audit | | same |

### 2.18 `audit.ts`

All four are read-only queries with RU + RR(a), scoped by LFC.

| Function (line) | Args | Reads | Flags | Caller |
| --- | --- | --- | --- | --- |
| `list` (29) | limit?, tableName?, userId?, actionType?, dateFrom?, dateTo? | auditLogs (`by_company` `take(≤1500)` for members; **global `take`** for super_admin and for admins without a company), users (N+1) | Filters run after `take`, so a filtered page can come back short or empty | `/audit-logs` |
| `getByTable` (83) | tableName, recordId?, limit? | auditLogs (`by_table`, **all tenants**, `take(≤600)`) | Truncates across tenants (doc 04, F7) | `lib/auditLogService.js` |
| `getByUser` (118) | userId, limit? | auditLogs (`by_user`, `take`) | ok | `lib/auditLogService.js` |
| `getSummary` (144) | dateFrom?, dateTo? | auditLogs (`take(2000)`) | Counts are capped at 2000 rows | `/audit-logs` |

### 2.19 `reminders.ts`

| Function (line) | Kind | Args | Auth | Tenant | Reads | Writes | Flags | Caller |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dailyDigest` (121) | internalMutation | date? | internal (cron) | loops over every approved company | companies (`take(1000)`; `by_status` unused); per company: cages (`by_company_status`, `take(500)`), dailyRecords (`by_date`, `take(2000)`, **all tenants**), feedTypes (`by_company`, `take(500)`), users (`take(5000)`, **all tenants**) | notifications (deduplicated) | All companies in **one transaction**; truncation (doc 04, F7); uses company-wide `currentStock`, not per site; **no audit** | cron |
| `runForMyCompanyNow` (137) | mutation | — | RU, RR(a) | own company | as above for one company | notifications | Public, but no caller | none |

### 2.20 `seed.ts`

| Function | Kind | Args | Auth | Tenant | Writes | Flags | Caller |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `seedDemo` (5) | mutation | — | RU (**no role**) | own company (or the unscoped pool) | cages, feedSuppliers, feedTypes (`currentStock` with no ledger), dailyRecords, biweeklyRecords, biweeklySampling, stockingHistory; all **without `locationId`** | **Flag:** public. Any user of a company with no cages can inject demo data into production; it breaks `stockTally` (doc 04, F5); the demo batch code `DEMO-2024-001` then blocks that code for every tenant (doc 04, F4). | README only |

---

## 3. Counts

| Module | query | mutation | action | internal | No client caller |
| --- | --- | --- | --- | --- | --- |
| audit | 4 | 0 | 0 | 0 | — |
| biweeklyRecords | 2 | 4 | 0 | 0 | — |
| cages | 6 | 3 | 0 | 0 | `analytics` |
| companies | 7 | 10 | 0 | 0 | — |
| dailyRecords | 3 | 5 | 0 | 0 | — |
| farmLocations | 2 | 5 | 0 | 1 | `getActive` (and internal `ensureForCompanyInternal`, which has no caller either) |
| feed | 4 | 11 | 0 | 0 | — |
| fishTransfers | 2 | 3 | 0 | 0 | `getFishTransfer` |
| harvest | 4 | 5 | 0 | 0 | `listSampling` |
| health | 2 | 2 | 0 | 0 | — |
| inventory | 5 | 3 | 0 | 0 | — |
| notifications | 2 | 5 | 0 | 0 | `createBulk` |
| reminders | 0 | 1 | 0 | 1 | `runForMyCompanyNow` |
| reports | 8 | 0 | 0 | 0 | `getProductionMetrics` |
| sales | 3 | 5 | 0 | 0 | `updateCustomer`, `updateSale`, `harvestSaleSummary` |
| seed | 0 | 1 | 0 | 0 | `seedDemo` |
| stocking | 6 | 8 | 0 | 0 | — |
| userAccounts | 0 | 0 | 2 | 0 | — |
| users | 4 | 5 | 0 | 4 | — (internal ones are called from actions or the CLI) |
| **Total** | **64** | **76** | **2** | **6** | 11 public functions with no caller |

Audit coverage: 66 of 76 public mutations call `logAudit`, directly or through `insertDailyRecord` or `recordOutboundUsage`. The 10 that do not:

- `companies.generateLogoUploadUrl`, `companies.clearLogo`
- `dailyRecords.createMany`
- `farmLocations.ensureDefault`, `farmLocations.setActiveLocation`
- `notifications.markRead`, `notifications.markAllRead`
- `reminders.runForMyCompanyNow`
- `users.reactivate`, `users.claimInvite`

Of the internal mutations, `reminders.dailyDigest`, `users.promoteToSuperAdmin` and `users.clearMustChangePassword` also write no audit row. Full detail in doc 04, F20.

---

## 4. Flags

### 4.1 Public functions without authentication

- None in app code, apart from `users.current`, which returns `null` when unauthenticated (by design), and the library's `signIn`, `signOut` and `isAuthenticated`.
- **Systemic:** `requireUser` does not reject users with `active === false`, so deactivated accounts keep full access to every function (`lib/authz.ts:7-17`; `users.deactivate` only sets the flag).
- `companies.remove` (status `rejected`) does not block that company's users either: no function checks `companies.status`.

### 4.2 Public functions without a correct tenant check

| Function | Problem | Severity |
| --- | --- | --- |
| `farmLocations.backfillLocations` | Company admin reads and writes every tenant's data | **Critical** |
| All functions using `listForCompany` / `assertOwns` | A user with no `companyId` gets the shared unscoped pool (doc 04, F1) | High |
| `seed.seedDemo` | No role check; writes demo data into the caller's tenant | Medium |
| `notifications.create/createBulk` | No role check; any member can message any member, with an arbitrary `link` | Low to Medium |
| `users.invite` | Pulls any company-less existing user into the inviter's company | Medium |
| Read paths with `take(N)` before the tenant filter (`dailyRecords.listForDate`, `stocking.listPendingApprovals`, `audit.getByTable`, `cages.growthAll`, `reminders.*`) | Correct isolation, but **incomplete results** once other tenants fill the window | Medium |
| All `locationId`-filtered reads | Site restriction is advisory: omit `locationId` to get every site; `users.locationIds` is never written | Medium |

### 4.3 Functions taking ids without an ownership check

| Function | Unchecked argument | Effect |
| --- | --- | --- |
| `dailyRecords.create` | `feedTypeId` | Deducts another tenant's feed stock |
| `dailyRecords.createBatch` | `records[].feedTypeId` | Same (existence-only check) |
| `dailyRecords.createMany` | `records[].feedTypeId` | Same |
| `dailyRecords.update` | `patch.feedTypeId` | Same |
| `feed.createFeedType` | `supplierId` | Cross-tenant supplier link |
| `feed.updateFeedType` | `patch.supplierId` | Same |
| `harvest.createSampling` | `cageId` | Sampling row tied to a foreign cage |
| `sales.updateSale` | `patch.customerId` | Reads a foreign customer's name |
| `inventory.createTransfer` | `fromLocationId`, `toLocationId` | Lots tagged to a foreign site; no site-access check |
| `companies.publishSettings` / `setLogo` | storage id (`v.any()` draft / `v.id('_storage')`) | Logo can point at any stored file |

All other id arguments are checked with `listForCompany(user,[doc])` or `assertOwns` before use.

### 4.4 Unbounded or expensive reads, worst first

1. `reports.listCagePnL`: cages FS + per cage (dailyRecords + harvestRecords + **sales FS**).
2. `farmLocations.backfillLocations`: 14 tables FS in one mutation.
3. `reports.dashboardSummary`, `dashboardKpis`, `productionReport`, `exportBundle`, `farmContextForAi`: 3–4 table FS each, subscribed on the dashboard.
4. `reports.getCagePnL`: sales FS.
5. `stocking.createStocking`, `suggestBatchNumber`, `fishTransfers.createFishTransfer`: stockingHistory FS through `allocateBatchNumber`.
6. `inventory.stockTally`: full ledger per feed type.
7. `dailyRecords.create` / `createBatch` with mortality: users FS per line that crosses a threshold.
8. Every `list*` query without its optional index argument (cages, dailyRecords, biweeklyRecords, harvest, stocking, topups, fishTransfers, feed suppliers, types, purchases and usage, customers, sales, health, farmLocations, users, companies).
9. `reminders.dailyDigest`: every company in one transaction.

### 4.5 Guideline deviations (from `convex/_generated/ai/guidelines.md`)

| Guideline | Deviation |
| --- | --- |
| Use `crons.interval` / `crons.cron`, not `crons.daily` | `crons.ts:8` |
| Prefer bounded `.take()` or pagination over `.collect()` | ~57 unindexed `.collect()` sites plus many unbounded indexed ones; no function uses `.paginate()` |
| Do not count with `.collect().length` | `notifications.getUnreadCount` |
| Do not read the wall clock in queries | `reports.dashboardSummary/dashboardKpis/farmContextForAi`, `health.activeWithdrawals`, `stocking.suggestBatchNumber`, `cages.growth/growthAll` |
| Never type `ctx` as `any` | `stocking.loadRules`/`allocateBatchNumber`, `fishTransfers.*` helpers, `dailyRecords.deductDailyFeed`/`reverseDailyFeed`, `feed.recordOutboundUsage`, `companies.logoUrl` |
| Index names include all fields (`by_a_and_b`) | `by_company_location`, `by_cage_date`, `by_user_read`, `by_company_status` |
| Express predicates through `withIndex` | Indexes exist but reads filter in JavaScript (doc 04, F8 and F15) |
| Validate all args (done) and prefer explicit return types | No `returns` validators anywhere |

### 4.6 Side-effect summary

- **Feed ledger** (`applyStockChange`): `feed.createFeedType` (opening stock), `createPurchase`, `updatePurchase`, `voidPurchase`, `createUsage`, `createIssue`; `inventory.createAdjustment`, `reverseTransaction`; `dailyRecords.create`, `createBatch`, `createMany`, `update`, `remove`. `inventory.createTransfer` writes the ledger directly.
- **Fish count** (`cages.currentCount`): `dailyRecords.*` (5 mutations), `stocking.createStocking`, `approveStocking`, `createTopup`, `approveTopup`, `fishTransfers.createFishTransfer` (when auto-approved), `approveFishTransfer`, `harvest.create`, `update`, `remove`, `cages.update`.
- **Notifications**: `dailyRecords.create` and `createBatch` (mortality threshold alerts to admins), `notifications.create` and `createBulk`, `reminders.dailyDigest` and `runForMyCompanyNow`.
- **Scheduler**: none. No function uses `ctx.scheduler`. The only background work is the single cron.
- **File storage**: `companies.generateLogoUploadUrl`, `setLogo`, `clearLogo`, and `logoUrl` in reads.
- **External network**: none from Convex. LLM calls happen in the Next.js API route `pages/api/llm/chat.js`, which uses `reports.farmContextForAi` (see doc 13).
