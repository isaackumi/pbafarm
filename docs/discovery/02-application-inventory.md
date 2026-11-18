# 02 — Application Inventory

Discovery stage: PART 4 (Phase One — Complete Application Inventory). Branch `docs/discovery`, read on 2026-11-18. Docs only; no code was changed or run beyond read-only shell commands.

## Stage header

**Objective.** Inventory every route under `pages/` (72 files including `_app`, `_document`, `404` and `pages/api`) and every major feature component. For each one, record: route, purpose, which roles can reach it (client guard, Sidebar visibility, in-page role checks, backend enforcement), components, data shown, Convex functions called (traced through `lib/databaseService.js`, `lib/*Service.js`, `lib/convexBridge.js`, Redux slices and contexts), tables touched, business logic, limitations and completeness.

**Files inspected.** All 72 files in `pages/`. All 40 files in `components/` (plus `components/ui/index.js` by import). `contexts/*.js` (8), `lib/*.js` (27), `store/slices/*.js` (8), `hooks/*.js` (3). On the backend: every exported function in `convex/*.ts` and `convex/lib/{authz,tenancy,farmRules,feedLedger,growth}.ts`, mapped to the tables they read and write. A script listed every `api.<module>.<fn>` reference on the client, every component's importers, and every backend `requireRole` call.

**Findings.** See the sections below. The 12 most consequential are listed first under "Key findings".

**Dependencies.** Role and tenancy semantics are in `07-authentication-and-authorization.md`. Calculation correctness (FCR, SGR, biomass) is in `08`/`09`. Schema details are in `04`. Feature status rolls up into `14-existing-feature-completeness.md`, and the compact route table is in `03-route-and-feature-map.md`.

**Risks.** Read from source only; nothing ran in a browser. Wherever "UI shows X to role Y" is stated, it comes from reading JSX conditionals. Confidence is High for structural claims (imports, calls, guards) and Medium for runtime behaviour claims.

**Outstanding questions.** These are listed at the end of the document.

**Completion status.** Complete for the pages, components, contexts and services listed above. Runtime verification is still outstanding.

---

## Conventions used below

- **Client guard**: `<ProtectedRoute requiredRole=…>` (`components/ProtectedRoute.js:8-37`). Without a prop it means "any signed-in user". It uses `hasRole` from `contexts/AuthContext.js:115-120`: `super_admin` passes every check, `admin` passes everything except `super_admin`. A user without permission is redirected to `/dashboard`.
- **Global guard**: `AuthWrapper` in `pages/_app.js:73-119` sends unauthenticated users to `/login`, except on `publicRoutes = ['/login','/signup','/reset-password','/verify-email']` (`_app.js:77`). It forces `/account?force=1` while `mustChangePassword` is set. Note that `/reset-password` and `/verify-email` have **no page files**.
- **Sidebar**: `components/Sidebar.js:47-144`. Items flagged `adminOnly` are hidden from `user`. The `admin` section is `superAdminOnly`.
- **Backend**: "any user" means the function calls `requireUser` plus a tenancy check (`assertOwns` / `listForCompany`). "admin" means it also calls `requireRole(user,'admin')` (`convex/lib/authz.ts:19-28`).
- **Data path**: the client reaches Convex in three ways.
  1. Reactive `useQuery`/`useMutation`.
  2. Imperative calls through `lib/*Service.js`, which use `getConvexHttpClient()` (`lib/convexBridge.js:38-52`). This is a `ConvexHttpClient` carrying the cached JWT, and it is **not reactive**: pages must refetch by hand.
  3. Redux thunks in `store/slices/*` that wrap the same services.

  Location scoping on the imperative path comes from `withActiveLocation()` (`lib/locationScope.js:10-14`), which reads `localStorage`.

---

## Key findings (severity)

1. **High: `/harvest-sampling` writes a completed harvest record with a hard-coded FCR of 1.5 and never updates the cage.** `pages/harvest-sampling.js:79` calls `harvest.createFromSampling` (`convex/harvest.ts:386-450`). That function inserts `harvestRecords` with `fcr: 1.5` (`harvest.ts:408`), `status:'completed'` and `harvestType:'complete'`. Unlike `harvest.create` (`harvest.ts:242`), it does **not** call `applyHarvestToCage`. As a result:
   - the cage count, cage status and the open stocking cycle are left unchanged;
   - the fake FCR flows into the dashboard "Avg FCR" (`reports.dashboardKpis`) and into reports.

   The page describes itself as "Record sample weight and size mix" (`harvest-sampling.js:106`), but it creates a harvest.
2. **High: the UI shows admin-only actions to every user, and the backend rejects them.** These pages have no role check, but the mutations behind them call `requireRole('admin')`:
   - cage edit/delete (`pages/cages/index.js`, `cages/settings.js`, `cages/[id].js`, which call `cages.update`/`cages.remove`, `convex/cages.ts:218,277`);
   - feed type create/delete (`pages/feed-types.js`, `pages/feed-management/index.js`, which call `feed.createFeedType`/`softDeleteFeedType`, `convex/feed.ts:234,317`). Creating a feed type is a prerequisite for daily entry, so a plain user cannot finish onboarding alone;
   - supplier delete (`pages/feed-suppliers.js:253`, `feed.softDeleteSupplier`);
   - purchase edit/void (`pages/feed-purchases.js:858,890`);
   - stocking edit/delete (`pages/stocking-management.js:211,269`);
   - biweekly delete (`pages/biweekly-records.js:451`);
   - harvest delete (`pages/harvest.js:231`).

   Security is not affected because the server enforces the rule. The UX is: a button that fails with "Insufficient permissions".
3. **High: there is no UI to view, correct or delete daily records.** The backend supports `dailyRecords.update`/`remove`, with stock reversal (`convex/dailyRecords.ts:444,550`). The service methods exist (`lib/databaseService.js:131-156`), but no page calls them (only `createBatch`, `listForDate`, `getDailyRecords` and the orphan `createDailyRecord` are used). A duplicate is blocked per cage+date (`dailyRecords.ts:235-241`). A wrong entry therefore cannot be fixed in the app, and `/daily-data` is just an alias of `/daily-entry` (`pages/daily-data.js:1`).
4. **Medium: `/cages/analytics/harvest` is always empty.** `fetchHarvestReadyCages` (`store/slices/cagesSlice.js:35-52`) filters on `cage.stockingDate` and `cage.growthRate >= 80`, but `cages.toClient` returns snake_case (`convex/cages.ts:17-50`). The filter can never match. Its own comment calls the criteria "Example criteria" (`cagesSlice.js:45`).
5. **Medium: four different definitions of "ready to harvest".**
   - `cages/index.js:62-64` uses ABW ≥ company `targetHarvestAbwG`.
   - `cages/analytics.js:139` and `cages/analytics/harvest.js:48` use a hard-coded 120 days of culture.
   - the Redux slice uses 180 days plus growthRate.
   - the backend `harvestWarnings` uses `harvestDocMinDays`/`harvestDocMaxDays` (`convex/lib/farmRules.ts:278-310`).
6. **Medium: broken admin links.** `/admin/admin` links to `/admin/companies/create`, `/admin/companies/[id]` and `/admin/companies/[id]/edit` (`pages/admin/admin.js:130-131,150`). None of these pages exist, so every one is a 404. "Delete" on that page calls `companies.remove`, which actually sets `status:'rejected'` (`convex/companies.ts:433-467`).
7. **Medium: feed can be deducted twice for the same feeding.** `/feed-issue` (`feed.createIssue` → `recordOutboundUsage`, `convex/feed.ts:609-685,709`) and daily entry (`deductDailyFeed`, `convex/dailyRecords.ts:37-83`) both write `feedUsage` and a negative ledger entry. Nothing links an issue to a later daily record. If staff issue feed to a cage and also log it in daily entry, stock is deducted twice. Whether issue and daily feeding are meant to be exclusive is unknown and needs verification.
8. **Medium: withdrawal periods are recorded but never enforced.** Health treatments store withdrawal periods (`convex/health.ts:70-128,151`), and `/health` shows active withdrawals. Neither `harvest.create` nor `sales.createSale` checks them: the string "withdraw" appears only in `convex/health.ts`, `schema.ts` and `pages/health.js`.
9. **Medium: payment status can be set but never changed afterwards.** It is set when a sale is created (`pages/sales.js:320`). `sales.updateSale` exists (`convex/sales.ts:283`) but no UI calls it, so a "pending" sale cannot be marked paid.
10. **Medium: water quality is captured but never shown or used.** Dissolved oxygen and temperature are collected in daily entry (optional, `components/DailyUploadPage.js:410-411`), and DO, temperature and Secchi in biweekly (`components/BiweeklyEntryForm.js:121-125`). No page, report, export column or alert reads them back. A grep for `dissolved|temperature|secchi` across `pages/` and `convex/reports.ts` returns nothing.
11. **Medium: bulk daily upload skips safeguards that interactive entry applies.** `dailyRecords.createMany` (`convex/dailyRecords.ts:581-642`):
    - silently skips duplicates (`continue`);
    - raises no mortality alerts and writes no audit log;
    - trusts the client's `feedPrice`.

    The CSV parser is a naive `split(',')` (`components/BulkBiweeklyUploadForm.js:17-23`), and rows with an unknown cage are dropped without reporting (`BulkDailyUploadForm.js` mapping, `if (!cageId) continue`).
12. **Low/Medium: inventory pages ignore the header location switcher.** `/stock-levels`, `/inventory/overview`, `/inventory/analytics` and `/inventory-alerts` call `inventory.listStockLevels`/`listAlerts`/`stockTally` with `{}` (`pages/stock-levels.js:35-36`, `inventory/overview.js:88`, `inventory-alerts.js:42`). They show company-wide stock, while the header implies per-site. Only daily entry passes `locationId` (`DailyUploadPage.js:103-107`). The same applies to `/export` (`pages/export.js:47,65,68`) and `/feed-management/overview` (`feed-management/overview.js:69`).

Dead or orphan code:
- Components `BiweeklyForm`, `BulkUploadModal`, `CageManagementSidebar`, `DailyEntryForm` and `Pagination` are imported nowhere.
- `DataContext` and `AnalyticsContext` are mounted in `_app.js:49-52`, but no page uses `useData`/`useAnalytics`. They do not fetch eagerly, so the cost is bundle size only.
- Redux slices `authSlice`, `biweeklySlice`, `dailySlice`, `dashboardSlice` and `notificationsSlice` are registered but only `cagesSlice` and `feedSlice` are read by pages; `harvestSlice` is not registered at all.

---

## 1. App shell, navigation and auth plumbing

| File | Role | Notes |
|---|---|---|
| `pages/_app.js` | Provider tree and global auth redirect | Providers: Convex Auth → Redux → Theme → Settings → Auth → CompanySettings → Location → Data → Toast → Notification → Analytics → Tour (`_app.js:42-69`). `AiAssistant` is lazy-loaded on every page (`_app.js:24-26,56`). The service worker `/sw.js` is registered in production only (`_app.js:28-37`). |
| `pages/_document.js` | HTML document | Manifest, icon, Google Fonts (Figtree, JetBrains Mono, Lexend). |
| `pages/404.js` | Not found | Links to `/dashboard`. |
| `pages/index.js` | `/` redirect | Sends signed-in users to `/dashboard` and everyone else to `/login` (`index.js:10-18`). |
| `components/Layout.js` | Shell | Sidebar + Header + MobileTabBar. The title comes from a prefix table (`Layout.js:11-49`), which still lists the `/daily-data` and `/pending-approval` aliases. Dispatches `fetchCages()` once per session into Redux (`Layout.js:76-79`), and shows a banner when that fetch fails. |
| `components/Sidebar.js` | Main nav | 7 sections, 41 items (`Sidebar.js:47-144`); filtering at `:166-185`. See `03-route-and-feature-map.md` for the full tree. |
| `components/Header.js` | Top bar | Title, farm location `<select>` (`Header.js:111-140`, using `LocationContext.setActiveLocation`), a "Set up locations" link to `/farm-locations` when there are none (`:140-145`), notifications dropdown, theme toggle, tour help menu, profile menu linking to `/account` (`:275-281`), logout. |
| `components/MobileTabBar.js` | Phone bottom bar | Dashboard, Daily entry, Cages, Feed (`/feed-issue`), More (opens the drawer) (`MobileTabBar.js:5-10`). |
| `components/ProtectedRoute.js` | Client role guard | See Conventions. |
| `components/TourProvider.js`, `lib/tours/` | Guided walkthrough | Uses `data-tour` attributes on nav items; navigates with `router.push` (`TourProvider.js:37`). |
| `contexts/AuthContext.js` | Session | Wraps `useConvexAuth` + `api.users.current`. Auto-calls `users.claimInvite` when the user has no `companyId` (`AuthContext.js:30-33`). `signInWithGoogle` and `updateUserMetadata` are stubs that return errors (`:85-111`). |
| `contexts/LocationContext.js` | Active farm site | `farmLocations.list`/`ensureDefault`/`setActiveLocation`/`backfillLocations`. Stores the active id in `localStorage` (`pba_active_location_id`) and also reads it there (`lib/locationScope.js`). |
| `contexts/CompanySettingsContext.js` | Branding and currency | `companies.getEffectiveSettings`; applies the accent colour and theme to the document. |
| `contexts/NotificationContext.js` | In-app notifications | Imperative `notifications.listForCurrentUser`, loaded **once per change of the `user` object** (`NotificationContext.js:15-23`). There is no polling and no reactive subscription, so new notifications appear only after a reload. |
| `contexts/SettingsContext.js`, `ThemeContext.js` | Local UI prefs | `localStorage`-based. |
| `contexts/DataContext.js`, `AnalyticsContext.js` | **Dead** | Mounted but never consumed. |

---

## 2. Dashboard

### `/dashboard` — `pages/dashboard.js` → `components/Dashboard.js`
- **Purpose.** Farm overview for the active location.
- **Access.** Any signed-in user. Sidebar Production → Dashboard, and the mobile tab bar. The backend queries are any-user and company-scoped.
- **Data and calls** (`Dashboard.js:104-188`):
  - `cageService.getAllCages()` → `cages.list` (location-scoped);
  - `stockingService.getAllStockings()` → `stocking.listStockingHistory`;
  - `reports.dashboardKpis` and `reports.dashboardSummary` with `{dateRange:30, locationId}`;
  - `dailyRecords.list` (location-scoped). This returns **all** daily records for the location; the client then slices the last 30 dates (`Dashboard.js:191-215`).
- **Tables.** `cages`, `stockingHistory`, `dailyRecords`, `biweeklyRecords`, `harvestRecords`, `feedTypes`.
- **Displays:**
  - "Farm health" meter: a client-only heuristic (base 70, adjusted by mortality, FCR and active cages; `Dashboard.js:65-82`), not a backend metric;
  - active cages and fish on farm;
  - "Stocked biomass": the sum of `initial_biomass` of the most recent stocking per active cage (`Dashboard.js:129-137`). This is stocking biomass, not current biomass;
  - Avg FCR from harvest records over 30 days (this is the figure contaminated by the fixed 1.5 described in Key finding 1);
  - mortality % over 30 days;
  - cumulative feed area chart and daily mortality bar chart (recharts);
  - tabs: Recent stockings and Growth (ADG, feed cost per harvest kg, feed over 30 days).
- **Limitations.**
  - Not reactive: it is loaded once per location change.
  - The health score is an unexplained heuristic.
  - "Biomass" is not live.
- **Status.** Implemented but incomplete (High confidence).

---

## 3. Cages

| Route | File | Access (client / sidebar / backend) | Calls → tables | Status |
|---|---|---|---|---|
| `/cages` | `pages/cages/index.js` | any / Cages → All Cages / list: any; edit/delete: **admin** | `cages.list` (location args), `companies.getEffectiveSettings`; edit/delete through `CageManageModals` → `cages.update`/`cages.remove` → `cages` | Implemented but potentially defective: edit/delete are not gated in the UI (`index.js:194-213` → row actions) |
| `/cages/[id]` | `pages/cages/[id].js` | any / not in nav (linked from the list) / any | `cages.get`, `dailyRecords.list({cageId})`, `biweeklyRecords.list({cageId})`, `cages.growth` → `cages`, `dailyRecords`, `biweeklyRecords`, `stockingHistory` (via `cageCycleGrowth`, `convex/lib/growth.ts:30-100`). Growth uses daily-record feed only (`growth.ts:89`), so feed issued through `/feed-issue` is not in eFCR. `stocked_count` comes from the stocking row (`growth.ts:62`) and does not include top-ups or fish transferred in. The effect on survival % needs verification (doc 09) | Implemented and working for read. The "Bi-weekly entry" button passes `?cage=` (`[id].js:192`), but `/biweekly-entry` ignores it |
| `/cages/analytics` | `pages/cages/analytics.js` | any / Cages → Analytics / any | Redux `fetchCages` → `cages.list`; fallback `analyticsService.getCageSummaryStats` (`databaseService.js:630-660`) | Implemented but incomplete: everything is computed client-side from cage fields, with a hard-coded 120-day harvest threshold (`analytics.js:139`) |
| `/cages/analytics/growth` | `pages/cages/analytics/growth.js` | any / no nav (linked from analytics) / any | Redux `fetchActiveCages` → `cages.getActive` | Implemented but potentially defective: "growth rate" is `(current_weight - initial_weight)/initial_weight`, but `initial_weight` is biomass in seed data (`convex/seed.ts` cage A1 `initialWeight: 67.5`, the same as `initialBiomass`) while `current_weight` is used as ABW elsewhere (`cages/index.js:63`). The units are inconsistent (Medium confidence) |
| `/cages/analytics/harvest` | `pages/cages/analytics/harvest.js` | any / no nav / any | Redux `fetchHarvestReadyCages` → `cages.getActive` | Implemented but potentially defective: always empty (Key finding 4) |
| `/cages/qr-codes` | `pages/cages/qr-codes.js` | any / Cages → QR codes / any | `cageService.getAllCages` → `cages.list` | Implemented and working. Generates an SVG QR per cage that encodes `/daily-entry?cage=<id>` (`qr-codes.js:21-31`); this deep link is honoured (`DailyUploadPage.js:189-200`). Filters `status !== 'inactive'`, a status that does not exist in the schema (`cages.ts:8-15`) |
| `/cages/settings` | `pages/cages/settings.js` | any / Cages → Settings / edit/delete **admin** | `cages.list`, `CageManageModals` | Implemented but potentially defective (same ungated actions). Duplicates the actions on `/cages` |
| `/create-cage` | `pages/create-cage.js` → `components/CreateCageForm.js` | any / Cages → Create Cage / any (`cages.create` has no role check, `cages.ts:160`) | `cageService.getAllCages` (name uniqueness), `cageService.createCage` → `cages.create` → `cages`, `farmLocations` (via `writeLocationId`/`ensureDefaultLocation`) | Implemented and working |
| `/cages/active` | `pages/cages/active.js` | none (client redirect only) | Redirects to `/cages?filter=active` | Alias, not linked anywhere |
| `/cages/harvest-ready` | `pages/cages/harvest-ready.js` | none | Redirects to `/cages?filter=ready_to_harvest` | Alias, not linked |
| `/cages/maintenance` | `pages/cages/maintenance.js` | none | Redirects to `/cages?filter=maintenance` | Alias, not linked |
| `/cages/feed-types` | `pages/cages/feed-types.js` | any | Redirects to `/feed-types` | Alias, not linked |

Cage statuses are `active | harvested | harvesting | maintenance | fallow | empty` (`convex/cages.ts:8-15`).
- Stocking approval sets `active` (`stocking.ts:277-283`).
- A complete harvest sets `harvested` (`harvest.ts:156-160`).
- Nothing in the code sets `harvesting` or `fallow` automatically; they are manual edits.

**Ponds, tanks, raceways and hatchery units do not exist.** `cages` is the only culture-unit table. A grep for `pond|tank|hatchery` matches only a seed string.

---

## 4. Stocking, top-up, fish transfers, approvals

### `/stocking` — `pages/stocking.js` → `components/StockingForm.js`
- **Access.** Any user. Sidebar Production → New Stocking. Backend `stocking.createStocking` is any-user (`convex/stocking.ts:224`).
- **Calls:**
  - `cages.list`, `companies.getEffectiveSettings`, `stocking.suggestBatchNumber`;
  - `stockingService.createStocking` → `stocking.createStocking` → `stockingHistory`, plus a `cages` patch when no approval is required;
  - `PersonPicker` → `users.listDirectory`.
- **Logic.**
  - Client-side pre-checks mirror the backend `assertStockingAllowed`: allowed cage statuses, ABW min/max, capacity, density (`convex/lib/farmRules.ts:209-243`).
  - Status is `pending_approval` when `stockingRules.requireApprovalForStocking` is set (`stocking.ts:254-256`).
  - Species is selected from `lib/fishSpecies.js`.
  - On success it navigates to `/stocking-management`.
- **Status.** Implemented and working (High).

### `/stocking-management` — `pages/stocking-management.js`
- **Access.** Any user. Sidebar Production → Stocking Management. The backend `updateStocking`/`removeStocking` are **admin** (`stocking.ts:317,353`), but the UI is not gated.
- **Calls.** `stockingService.getAllStockings` (`stocking.listStockingHistory` + `cages.list`), `updateStocking`, `deleteStocking` → `stocking.removeStocking`.
- **Displays.** Sortable, filterable stocking list and an edit modal. There are no top-up rows; `listTopupHistory` is reachable only through `TopUpForm`'s stocking lookup.
- **Status.** Implemented but potentially defective (ungated admin actions).

### `/topup` — `pages/topup.js` → `components/TopUpForm.js`
- **Access.** Any user. **Not in the Sidebar**; it is linked from the related links on `/stocking`, `/stocking-management` and `/approvals` (`stocking.js:22`, `stocking-management.js:308`, `approvals.js:173`).
- **Calls.** `stockingService.getActiveStockings` and `getStockingById` (which use `stocking.listTopupHistory`), then `createTopUp` → `stocking.createTopup` → `topupHistory`, plus a `cages` patch when no approval is required.
- **Logic.** `assertTopupAllowed`: ABW range, capacity, density (`farmRules.ts:245-276`). Top-ups are allowed only on approved stockings (`stocking.ts:505-507`).
- **Status.** Implemented and working. It is hard to discover because it has no nav entry.

### `/stocking/[id]/details` and `/topup/[id]/details`
- **Files.** `pages/stocking/[id]/details.js`, `pages/topup/[id]/details.js`.
- **Access.** Any user (client). Linked only from `/approvals` (`approvals.js:310`). The approve/reject buttons on these pages are **not role-gated**, while the backend `approveStocking`/`rejectStocking`/`approveTopup`/`rejectTopup` are admin (`stocking.ts:385,429,552,597`).
- **Calls.** `stocking.getStocking`/`getTopup` and the approve/reject mutations.
- **Status.** Implemented and working for admins. Non-admins who reach them by URL see actions that will fail.

### `/approvals` — `pages/approvals.js`
- **Access.** `requiredRole="admin"` (`approvals.js:21`). Sidebar Management → Approvals (adminOnly). Backend `stocking.listPendingApprovals` requires admin (`stocking.ts:632`).
- **Calls.**
  - `stocking.listPendingApprovals`, which reads `stockingHistory`, `topupHistory` and `fishTransfers` (`stocking.ts:639-651`);
  - `approveStocking`/`approveTopup`/`approveFishTransfer`;
  - `rejectStocking`/`rejectTopup`/`rejectFishTransfer` (with a reason).
- **Limitations.**
  - The description still says "stocking and top-up" although fish transfers are also listed (`approvals.js:169`).
  - Approvers are not notified: no `notifications` insert in `stocking.ts`.
- **Status.** Implemented and working.

### `/pending-approval` — `pages/pending-approval.js`
Legacy alias. It is admin-guarded and client-redirects to `/approvals` (`pending-approval.js:5-23`). Not linked.

### `/fish-transfers` — `pages/fish-transfers.js` → `components/FishTransferForm.js`
- **Access.** Any user can create. Approve/reject buttons are gated with `isAdmin` (`fish-transfers.js:38,121,155`), and the backend approve/reject are admin (`fishTransfers.ts:375,409`). Sidebar Production → Fish Transfers.
- **Calls.**
  - `fishTransfers.listFishTransfers`;
  - `fishTransferService.create` → `fishTransfers.createFishTransfer`, which writes `fishTransfers` and, when approved immediately, `stockingHistory` (empty destination) or `topupHistory` (occupied destination) and patches both cages (`fishTransfers.ts:194-372`, logic in `convex/lib/fishTransferLogic.ts`);
  - also `cages.list` and `companies.getEffectiveSettings`.
- **Logic.** Partial or full move. The destination status is checked against `allowStockOnlyEmptyStatuses`. Approval is required unless `requireApprovalForFishTransfer === false`.
- **Status.** Implemented and working (High; unit tests exist in `convex/lib/fishTransferLogic.test.ts`).

---

## 5. Daily entry and records

### `/daily-entry` — `pages/daily-entry.js` → `components/DailyUploadPage.js` (919 lines)
- **Access.** Any user. Sidebar Production → Daily Entry and the mobile tab bar. Backend `dailyRecords.createBatch` is any-user. The negative-stock override is enforced as admin inside `applyStockChange` (`convex/lib/feedLedger.ts:164+`, see doc 07/08).
- **Purpose.** Log feed (kg or bags) and mortality, with an optional cause, for many cages on one date, atomically (all or nothing). Optional DO and temperature per line when "showWater" is on.
- **Calls:**
  - `cageService.getActiveCages` → `cages.getActive`;
  - `feedTypeService.getAllFeedTypes` → `feed.listFeedTypes`;
  - `inventory.listStockLevels({locationId})` for per-site stock hints;
  - `dailyRecordService.listForDate` → `dailyRecords.listForDate` (to mark cages already logged);
  - `dailyRecordService.createBatch` → `dailyRecords.createBatch` (`convex/dailyRecords.ts:365-442`).
- **Tables written:**
  - `dailyRecords`;
  - `cages` (`currentCount -= mortality`);
  - `feedUsage`, `feedInventoryTransactions`, `feedInventory` lot deductions and `feedTypes.currentStock` (via `deductDailyFeed` → `applyStockChange`);
  - `notifications` (mortality threshold alerts to all company admins, `dailyRecords.ts:268-317`);
  - `auditLogs`.
- **Logic:**
  - at most 100 lines per batch;
  - no duplicate cage in a batch, and no existing record for the cage+date;
  - a feed type is required when feed > 0;
  - `feedCost = feedAmount × feedType.pricePerKg` (list price, not FIFO lot cost; `dailyRecords.ts:407-426`).
- **Offline.** Lookups are cached in `localStorage`. A failed or offline submit goes into an outbox (`lib/offlineOutbox.js`, key `pbafarm:outbox:daily-batch`) and is flushed on `online` (`DailyUploadPage.js:346-380,420-450`). The outbox covers daily entry only.
- **Deep links.** `?cage=<id>` and `?cages=a,b` prefill lines (QR codes and reminder notifications).
- **Limitations:**
  - no list, edit or delete for submitted records (Key finding 3);
  - Secchi is not captured on daily entry;
  - the mortality alert scans the whole `users` table (`dailyRecords.ts:296-297`).
- **Status.** Implemented and working for capture. Correcting records is completely missing.

### `/daily-data` — `pages/daily-data.js`
Re-exports the daily-entry page. Duplicate route, not linked (only listed in the `Layout` title table).

### `/biweekly-entry` — `pages/biweekly-entry.js` → `components/BiweeklyEntryForm.js`
- **Access.** Any user. Sidebar Production → Bi-weekly Entry.
- **Calls.** `cageService.getAllCages`, then `biweeklyRecordService.createBiweeklyRecord` → `biweeklyRecords.create`. That function writes `biweeklyRecords` and `biweeklySampling` rows and calls `syncCageAbw` (`convex/biweeklyRecords.ts:64-135`, `convex/lib/growth.ts:143`).
- **Logic.** Several samples per record. ABW is the weighted average (`BiweeklyEntryForm.js` `calculateAverageABW`). Optional DO, temperature and Secchi.
- **Limitations:**
  - it ignores the `?cage=` query param that `/cages/[id]` sends (`useRouter` is declared at `biweekly-entry.js:19` but never read);
  - no offline support.
- **Status.** Implemented and working.

### `/biweekly-records` — `pages/biweekly-records.js`
- **Access.** Any user. Sidebar Production → Bi-weekly Records. Update is any-user (`biweeklyRecords.ts:184`); delete is **admin** (`:230`) and is not gated in the UI (`biweekly-records.js:451`).
- **Calls.** `cageService.getAllCages`; `biweeklyRecordService.getBiweeklyRecordsPaginated` fetches the **full** list and slices it client-side (`databaseService.js:347-365`); `updateBiweeklyRecord`, `deleteBiweeklyRecord`.
- **Status.** Implemented but potentially defective (ungated delete; client-side pagination will not scale).

### `/bulk-upload` — `pages/bulk-upload.js` → `BulkDailyUploadForm`, `BulkBiweeklyUploadForm`
- **Access.** `requiredRole="admin"`. Sidebar Management → Bulk Upload (adminOnly). The backend `dailyRecords.createMany`/`biweeklyRecords.createMany` are **any-user** (`dailyRecords.ts:581`, `biweeklyRecords.ts:137`); only the UI is admin-gated.
- **Calls.** `cageService.getAllCages`, `feedTypeService.getAllFeedTypes`, `api.dailyRecords.createMany`, `api.biweeklyRecords.createMany`.
- **Limitations.** Key finding 11. The page also wraps itself in a second `ToastProvider` (`bulk-upload.js:6`), although one is already global.
- **Status.** Implemented but potentially defective.

---

## 6. Harvest, harvest sampling, sales, P&L

### `/harvest` — `pages/harvest.js` → `HarvestForm`, `SamplingForm`
- **Access.** Any user. Sidebar Production → Harvest Data. `harvest.create`/`update` are any-user; `harvest.remove` is **admin** (`convex/harvest.ts:317`), and delete is ungated in the UI (`harvest.js:231`).
- **Calls:**
  - `harvestRecordService.getHarvestRecords` → `harvest.list`;
  - `createHarvestRecord` → `harvest.create` (`harvest.ts:206-261`), which writes `harvestRecords`, applies the harvest to the cage (`applyHarvestToCage`, `harvest.ts:107-162`: partial reduces the count; complete sets count 0, status `harvested` and closes the open stocking), and returns `harvestWarnings`;
  - `HarvestForm` → `harvest.suggestFcr`;
  - `updateHarvestRecord` → `harvest.update` (undo/redo of the cage effect);
  - `deleteHarvestRecord`;
  - `exportHarvestRecords` (client CSV);
  - `SamplingForm` → `addSamplingData` → `harvest.createSampling` → `harvestSampling`.
- **Limitations:**
  - samples recorded through "Add sampling" are never displayed (`harvest.listSampling`, `harvest.ts:452`, has no caller);
  - active withdrawal periods are not checked.
- **Status.** Implemented but incomplete.

### `/harvest-sampling` — `pages/harvest-sampling.js`
- **Access.** Any user. Sidebar Production → Harvest Sampling.
- **Calls.** `cageService.getActiveCages`, `harvest.createFromSampling`.
- **Status.** **Implemented but potentially defective** (Key finding 1). It duplicates both `/harvest`'s create flow and `SamplingForm`.

### `/sales` — `pages/sales.js`
- **Access.** Any user can record a sale (`sales.createSale`, `convex/sales.ts:176`). Customer creation and sale deletion are admin, and the UI gates both (`sales.js:35,264,371,461,490`). Sidebar Production → Sales.
- **Calls.** `harvest.list` (to link a sale to a harvest), `sales.listCustomers`, `sales.listSales({locationId})`, `createSale`, `createCustomer`, `removeSale`. Tables: `sales`, `customers`, `harvestRecords`.
- **Limitations.** `updateSale`, `updateCustomer` and `harvestSaleSummary` have no UI. There are no invoices, receipts or payment records.
- **Status.** Implemented but incomplete.

### `/pnl` — `pages/pnl.js`
- **Access.** Any user. Sidebar Production → Cage P&L.
- **Calls.** `reports.listCagePnL`, `reports.getCagePnL` (`convex/reports.ts:571-700`), which read `cages`, `sales` and `dailyRecords`.
- **Logic.** Revenue from `sales` minus feed cost from daily records. The page states explicitly that it excludes labour and other operating costs (`pnl.js:69`). Fingerling cost, treatment cost and purchase-price feed cost are not included.
- **Status.** Implemented but incomplete (by design; expenses are missing).

---

## 7. Health

### `/health` — `pages/health.js`
- **Access.** Any user can record. Delete is admin, and both UI and backend gate it (`health.js:38,328,355`; `convex/health.ts:130`). Sidebar Production → Health.
- **Calls.** `cages.list`, `health.list`, `health.activeWithdrawals`, `health.create`, `health.remove` → `healthTreatments`.
- **Logic.** Diagnosis suggestions come from `lib/farmHealth.js`. Withdrawal end date = date + `withdrawalDays`.
- **Limitations.** Withdrawals are not enforced at harvest or sale. Treatment product stock is not tracked (inventory covers feed only).
- **Status.** Implemented but incomplete.

Mortality is not a separate module. It is a field on daily entry, with cause (`dailyRecords.mortality`, `mortalityCause`). It is reported through the dashboard chart, `report` mortality rows, P&L cause breakdown (`pnl.js:11` imports `mortalityCauseLabel`) and threshold notifications.

---

## 8. Feed

| Route | File | Access (client / sidebar / backend) | Calls → tables | Status |
|---|---|---|---|---|
| `/feed-management` | `pages/feed-management/index.js` (858 lines) | any / Feed → Overview / create feed type and delete are **admin**, ungated | `inventory.listStockLevels`, `feedService.getFeedUsageStats` (`feed.listUsage`+`listFeedTypes`+`cages.list`), `feedTypeService.*` (`feed.createFeedType`/`updateFeedType`/`softDeleteFeedType`), `supplierService.createSupplier`, `FeedPurchaseModal` → `feed.createPurchase` | Implemented but potentially defective. It **duplicates** the feed-type CRUD on `/feed-types` and supplier creation on `/feed-suppliers` |
| `/feed-management/overview` | `pages/feed-management/overview.js` | any / not in sidebar (used as the "Feed" breadcrumb target by `feed-suppliers.js:181`, `feed-types.js:222`, `feed-purchases.js:910`, `feed-management/analytics.js:59`) / any | `feed.listFeedTypes`, `feed.listUsage`, `feed.listSuppliers`, `cages.growthAll` | Implemented and working; company-wide stock. Two "overview" pages exist (this one and `/feed-management`) |
| `/feed-management/analytics` | `pages/feed-management/analytics.js` | any / Feed → Analytics / any | `feedService.getFeedUsageStats`, `getFeedCostAnalysis` (`feed.listPurchases`), `getLowStockAlerts` (`inventory.listAlerts`) | Implemented and working |
| `/feed-management/purchases`, `/suppliers`, `/types`, `/usage` | 12-line SSR redirects | — | Redirect to `/feed-purchases`, `/feed-suppliers`, `/feed-types`, `/feed-issue` | Legacy aliases, not linked |
| `/feed-types` | `pages/feed-types.js` | any / Feed → Feed Types / create and delete **admin**, update any (`convex/feed.ts:234,285,317`) | Redux `feedSlice` → `feedService` → `feed.*FeedType`; `supplierService.getAllSuppliers` | Implemented but potentially defective (ungated create/delete) |
| `/feed-suppliers` | `pages/feed-suppliers.js` | any / Feed → Suppliers / create and update any, delete **admin** (`feed.ts:146,171,200`) | `supplierService` → `feed.listSuppliers`/`createSupplier`/`updateSupplier`/`softDeleteSupplier` → `feedSuppliers` | Implemented but potentially defective (ungated delete) |
| `/feed-purchases` | `pages/feed-purchases.js` (1743 lines, the largest page) | any / Feed → Purchases / create any, edit and void **admin** (`feed.ts:362,449,528`) | `feedService.getAllFeedTypes/getAllPurchases/getInventoryLots/getStockLevels/getFeedUsageStats`, `cageService.getAllCages`, `supplierService.getAllSuppliers`, `cages.growthAll`; `FeedPurchaseModal` → `feed.createPurchase` → `feedPurchases`, `feedInventory` lot, `feedInventoryTransactions` (`addInventoryLot`, `convex/lib/feedLedger.ts:35`) | Implemented but potentially defective (ungated edit/void). Contains a large amount of client-side analytics (cost, supplier, usage, feed age) |
| `/feed-issue` | `pages/feed-issue.js` | any / Feed → Issue Feed and mobile tab "Feed" / any (override admin-only inside the ledger) | `feed.listFeedTypes`, `cages.getActive`, `feed.createIssue` → `feedUsage` (source `issue`), ledger | Implemented and working. Double-deduction risk with daily entry (Key finding 7) |

`feed.createUsage` (`feed.ts:687`) is reachable only through `feedService.recordFeedUsage` and `feedTrackingService`. The `recordFeedUsage` thunk is never dispatched, so there is no live UI caller.

---

## 9. Inventory (feed only)

All inventory is **feed inventory**. Nets, chemicals, fingerlings and spare parts have no item model; `/inventory/items` and `/inventory/categories` redirect to `/feed-types`.

| Route | File | Access (client / sidebar / backend) | Calls → tables | Status |
|---|---|---|---|---|
| `/inventory/overview` | `pages/inventory/overview.js` | any / Inventory → Overview / any | `inventory.listStockLevels({})`, `inventory.listTransactions` → `feedTypes`, `feedInventoryTransactions` | Implemented and working; company-wide only |
| `/stock-levels` | `pages/stock-levels.js` | any / Inventory → Stock Levels / any | `inventory.listStockLevels({})`, `inventory.stockTally` (ledger and `currentStock` reconciliation) | Implemented and working; company-wide only |
| `/inventory/lots` | `pages/inventory/lots.js` | any / Inventory → Lots / any | `inventory.listLots` → `feedInventory` | Implemented and working |
| `/inventory/adjust` | `pages/inventory/adjust.js` | **admin** client guard / Inventory → "Adjust / Transfer" shown to **all** users (no `adminOnly`, `Sidebar.js:100`) / admin | `inventory.createAdjustment`, `inventory.createTransfer` (between farm locations), `feed.listFeedTypes`, `inventory.listLots` | Implemented and working. Nav mismatch: plain users who click it are bounced to `/dashboard` |
| `/inventory-alerts` | `pages/inventory-alerts.js` | any / Inventory → Alerts / any | `inventory.listAlerts` (low stock vs `minimumStock × lowStockMultiplier`) | Implemented and working; company-wide |
| `/inventory-transactions` | `pages/inventory-transactions.js` | any / Inventory → Transactions / reverse **admin**, UI gated (`inventory-transactions.js:159-161`) | `inventory.listTransactions`, `feed.listFeedTypes`, `inventory.reverseTransaction` | Implemented and working |
| `/inventory/analytics` | `pages/inventory/analytics.js` | any / Inventory → Analytics / any | `inventory.listStockLevels`, `inventory.listTransactions` | Implemented and working (client-side aggregation) |
| `/inventory/items`, `/categories`, `/reports`, `/transactions` | SSR redirects | — | → `/feed-types`, `/feed-types`, `/inventory/analytics`, `/inventory-transactions` | Legacy aliases |

Daily reminders for low stock come from the cron `reminders.dailyDigest` (see §12).

---

## 10. Reports, export, analytics, audit

### `/report` — `pages/report.js`
- **Access.** Any user. Sidebar Reports → Production Report.
- **Calls.** `cageService.getAllCages`, `reports.productionReport` (`convex/reports.ts:377-512`), which reads `cages`, `dailyRecords`, `biweeklyRecords` and `harvestRecords`.
- **Report types.** Production, Feed usage, Growth, Mortality, Financial (`report.js:174-178`).
- **Gaps.** The "Financial summary" contains **feed cost rows only** (`reports.ts:496-502`); no sales revenue or margin. Output is an on-screen table, a JSON download (`report.js:121`) and print. There is no PDF/XLSX here.
- **Status.** Implemented but incomplete. The UI promises "financial reports" (`report.js:148`) that are feed cost only.

### `/export` — `pages/export.js`
- **Access.** Any user. Sidebar Reports → Export Data.
- **Calls.** `reports.exportBundle({dateFrom,dateTo})` (company-wide, no `locationId`), `cages.list({})`, `stocking.listStockingHistory({})`. Writes XLSX with `xlsx`.
- **Gaps.** No feed purchases, sales, health or inventory exports.
- **Status.** Implemented but incomplete.

### `/audit-logs` — `pages/audit-logs.js`
- **Access.** `requiredRole="admin"`. Sidebar Reports → Audit Logs (adminOnly). Backend `audit.list`/`getSummary` are admin (`convex/audit.ts:29,144`).
- **Data.** `auditLogs`, written by `logAudit` (`convex/lib/tenancy.ts:150`) from most mutations. Not written by `dailyRecords.createMany`, `reverseDailyFeed`, `notifications.markRead` and others.
- **Status.** Implemented and working. `audit.getByTable`/`getByUser` have no UI.

Cage analytics are covered in §3, feed analytics in §8 and inventory analytics in §9.

---

## 11. AI assistant

- **Files.** `components/AiAssistant.js` (floating panel on every page), `pages/api/llm/chat.js`, `pages/api/llm/status.js`, `lib/llmClient.js`, `lib/llmEnv.js`, `lib/llmApiAuth.js`.
- **Access.** Any signed-in user whose company has `settings.aiAssistantEnabled === true`, checked in `companies.aiAssistantStatus` and `reports.farmContextForAi` (`convex/reports.ts:516-531`). The API routes verify the Convex JWT by calling `users.current` (`lib/llmApiAuth.js:8-35`) and re-check `aiAssistantStatus` (`chat.js:19-24`).
- **Behaviour.**
  - Read-only Q&A. A farm snapshot (cages, 30 days of daily records, feed types) is sent as the system context with up to 8 turns of history (`AiAssistant.js:175-201`).
  - Providers: Gemini (default), OpenAI, OpenRouter, Anthropic, Groq, custom.
  - It takes no actions (no tool calls into Convex).
- **Risks:**
  - keys can come from `localStorage` (user-entered) or `NEXT_PUBLIC_*_API_KEY` (`lib/llmEnv.js:13-18`). Either way the key is in the browser, and with a client key the browser calls the provider directly;
  - farm data leaves to a third-party LLM under the company toggle only.
- **Status.** Implemented and working as a chat helper (Medium; not exercised).

---

## 12. Users, company, settings, locations, admin, notifications

| Route | File | Access (client / sidebar / backend) | Calls → tables | Status |
|---|---|---|---|---|
| `/users` | `pages/users.js` → `components/UserManagement.js` | admin / Management → Users (adminOnly) / admin (`users.list`/`update`/`deactivate`/`reactivate` require admin, `convex/users.ts:48,97,210,234`) | `userService.listUsers`, `updateUser` (role), `deactivateUser`/`reactivateUser`, `userAccounts.createWithPassword` (action: creates the auth account with a temporary password and sets `mustChangePassword`) | Implemented but incomplete: there is no UI to assign users to farm locations (`users.locationIds` exists), and the `users.invite` + `userInvites` flow has no UI caller (only `claimInvite` on login) |
| `/account` | `pages/account.js` | any / Header profile menu / any | `userAccounts.changePassword` (action) | Implemented and working. Password change only; no profile edit (`AuthContext.updateUserMetadata` is a stub, `:104-111`) |
| `/company-settings` | `pages/company-settings.js` (781 lines) | admin / Management → Company Settings (adminOnly) / admin | `companies.getSettingsDraft`, `saveSettingsDraft`, `publishSettings` (draft → publish workflow, `companySettingsDrafts`), `generateLogoUploadUrl`/`setLogo`/`clearLogo` (Convex `_storage`) | Implemented and working. Edits branding, farm rules, stocking rules, feed rules, currency and the AI toggle. All rules except `targetFcr` are read by the backend (`convex/lib/farmRules.ts`, `feedLedger.ts`, `inventory.ts`, `dailyRecords.ts`, `harvest.ts`); `targetFcr` is stored but unused (Medium) |
| `/global-settings` | `pages/global-settings.js` | any / Management → Global Settings (all users) / save **admin** (UI gated, `global-settings.js:35,77,137`) | `companies.getSettingsDraft`/`saveSettingsDraft`/`publishSettings`; `SettingsContext` | Implemented and working, but it overlaps `/company-settings`: it edits only the currency, through the same draft/publish path |
| `/farm-locations` | `pages/farm-locations.js` | any (read) / Management → Farm Locations (**adminOnly**) / create and update **admin** (UI gated `isAdmin`, `farm-locations.js:37`) | `farmLocations.list`/`create`/`update` → `farmLocations` | Implemented and working. Plain users can reach it by URL or through the Header "Set up locations" link and see a read-only list |
| `/register-company` | `pages/register-company.js` → `components/CompanyRegistrationsPage.js` | signed-in (global guard; no `ProtectedRoute`, no `Layout`) / not in sidebar; linked from `company-settings.js:247,285` / any user without a company | `companyService.registerCompany` → `companies.register` (status `pending`) | Implemented and working. Signup does not route new users here (`signup.js:47` → `/dashboard`), so the path is undiscoverable unless the user opens `/company-settings`, which is admin-only and so unreachable for a new `user` |
| `/admin/company-registrations` | `pages/admin/company-registrations.js` → `components/AdminCompanyRegistrationsPage.js` | super_admin / Admin → Registrations (superAdminOnly) / super_admin (`companies.listPending`/`approve`/`reject`, `companies.ts:300,315,397`) | `companies.listPending`, `approve` (promotes the submitter to admin, creates the default `farmLocations`), `reject` | Implemented and working |
| `/admin/admin` | `pages/admin/admin.js` (the file header still says `pages/admin/companies.js`) | super_admin / Admin → Admin Dashboard / super_admin | `companyService.getAllCompanies` → `companies.list`; `deleteCompany` → `companies.remove` (soft reject) | Implemented but potentially defective: view, edit and create link to non-existent routes (Key finding 6) |
| Notifications | `components/Header.js` dropdown + `contexts/NotificationContext.js` + `lib/notificationService.js` | any / header bell / own notifications only (`convex/notifications.ts:21-97`) | `notifications.listForCurrentUser`, `markRead`, `markAllRead`; producers: mortality alerts (`dailyRecords.ts:268-317`), daily cron digest (`reminders.dailyDigest` at 16:00 UTC, `convex/crons.ts:8-13`: missed daily entries linking to `/daily-entry?cages=…`, low feed stock linking to `/stock-levels`) | Partially implemented: in-app only (no email, SMS or push), no notifications page, not live-updating, `deleteNotification` not exposed in the UI, and no notifications for pending approvals |
| — | `reminders.runForMyCompanyNow` (admin), `seed.seedDemo` (any user, inserts demo cages, feed, stocking and records into the caller's company when they have no cages, `convex/seed.ts:5-18`) | no UI | — | Backend only. `seedDemo` is publicly callable by any signed-in user (flagged for doc 07) |

---

## 13. Authentication pages

| Route | File | Notes | Status |
|---|---|---|---|
| `/login` | `pages/login.js` | Email and password through `@convex-dev/auth` `signIn('password', {flow:'signIn'})` (`AuthContext.js:58-69`). Honours `?next=` (`login.js:16-20`). No "forgot password" link. | Implemented and working |
| `/signup` | `pages/signup.js` | `flow:'signUp'` with the name. The new user has role `user` (`convex/auth.ts:13`) and no company, and lands on `/dashboard` with tenancy "no companyId → unscoped rows" (`convex/lib/tenancy.ts:12-17`); see doc 07. No email verification. | Implemented but incomplete |
| `/reset-password`, `/verify-email` | — | Listed as public routes (`_app.js:77`) and referenced in `TourProvider.js:58`, but **no page files exist** | Completely missing |
| Google sign-in | `AuthContext.signInWithGoogle` | Returns "not configured" (`AuthContext.js:85-92`) | Planned but not implemented |

---

## 14. Orphan, dead and duplicate inventory

| Item | Kind | Evidence |
|---|---|---|
| `components/BiweeklyForm.js` | Orphan component | No importer (grep of `/BiweeklyForm'`) |
| `components/BulkUploadModal.js` (732 lines) | Orphan | No importer |
| `components/CageManagementSidebar.js` | Orphan | No importer. Holds stale links to `/cages/analytics/*` |
| `components/DailyEntryForm.js` | Orphan | No importer. Superseded by `DailyUploadPage`. Still calls `api.dailyRecords.create` |
| `components/Pagination.js` | Orphan | No importer |
| `contexts/DataContext.js`, `contexts/AnalyticsContext.js` | Mounted, unused | No `useData()`/`useAnalytics()` consumer in pages or components |
| Redux slices `authSlice`, `biweeklySlice`, `dailySlice`, `dashboardSlice`, `notificationsSlice` | Registered, unused by pages | Only `cagesSlice` and `feedSlice` are selected (`useSelector` in `Layout`, `cages/analytics*`, `feed-types`) |
| `store/slices/harvestSlice.js` | Unregistered | Not imported by `store/index.js` |
| `/daily-data` | Duplicate of `/daily-entry` | `pages/daily-data.js:1` |
| `/pending-approval` | Redirect alias | `pages/pending-approval.js` |
| `/cages/active`, `/cages/harvest-ready`, `/cages/maintenance`, `/cages/feed-types` | Redirect aliases, not linked | |
| `/feed-management/{purchases,suppliers,types,usage}`, `/inventory/{items,categories,reports,transactions}` | SSR redirect aliases, not linked | |
| `/feed-management` vs `/feed-management/overview` | Two overview pages | Both show stock, usage and FCR |
| `/feed-types` vs `/feed-management` feed-type CRUD | Duplicate CRUD | Both create, edit and delete feed types |
| `/cages` vs `/cages/settings` | Duplicate edit/delete | Same `CageManageModals` |
| `/harvest` sampling vs `/harvest-sampling` | Two different sampling semantics | `harvest.createSampling` vs `harvest.createFromSampling` |
| `/global-settings` vs `/company-settings` | Overlapping settings | Currency is editable in both |
| Backend functions with no UI caller | Dead or reserved API | `users.invite`, `users.get`, `companies.get`, `companies.getCurrentCompany`, `companies.updateSettings` (only via unused `companyService` methods), `cages.analytics`, `harvest.listSampling`, `sales.updateSale`, `sales.updateCustomer`, `sales.harvestSaleSummary`, `reports.getProductionMetrics`, `audit.getByTable`, `audit.getByUser`, `farmLocations.getActive`, `notifications.create`/`createBulk`/`deleteNotification`, `feed.createUsage`, `reminders.runForMyCompanyNow`, `seed.seedDemo` |

## 15. Sidebar items whose guard disagrees with the page or backend

| Sidebar item | Shown to | Page guard | Backend | Effect |
|---|---|---|---|---|
| Inventory → Adjust / Transfer | everyone | admin | admin | A plain user is silently redirected to `/dashboard` |
| Management → Global Settings | everyone | any | save admin | Read-only for users (UI gated). Consistent |
| Management → Farm Locations | admin only | any | write admin | Users can still open it by URL or through the Header link. Harmless |
| Management → Bulk Upload | admin only | admin | **any user** for `createMany` | Only the UI restricts bulk import |
| Cages → Settings, All Cages | everyone | any | edit/delete admin | Actions fail for users |
| Feed → Feed Types | everyone | any | create/delete admin | Users cannot create the feed types that daily entry needs |

---

## Outstanding questions

1. Is `/feed-issue` (store → cage) meant to replace or to complement the feed amount in daily entry? Today both deduct stock (Key finding 7).
2. What does `cages.currentWeight` mean: ABW in grams (synced by `syncCageAbw`) or biomass (seed data)? `/cages/analytics/growth` and `/cages` treat it differently.
3. Is `/harvest-sampling` meant to create a harvest? If it is only a pre-harvest sample, the record type and the fixed FCR are wrong.
4. Should `bulk-upload` be admin-only on the backend as well?
5. Which "ready to harvest" rule is authoritative: company `targetHarvestAbwG`, `harvestDocMin/MaxDays`, or the hard-coded 120 days?
6. Is a companyless signed-up user meant to be able to work "solo" on unscoped rows (`tenancy.ts:12-17`)? Two such users would share data. See doc 07.
7. Runtime behaviour was not exercised: nothing was rendered in a browser and `next build` was not run (assigned to another agent).
