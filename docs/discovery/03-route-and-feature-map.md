# 03 — Route and Feature Map

Discovery stage: PART 4 (companion to `02-application-inventory.md`). Branch `docs/discovery`, 2026-11-18. Docs only.

## Stage header

**Objective.** Give one compact lookup for:
- every route: page file, key components, Convex functions, tables, nav location, client guard;
- a feature → routes map;
- the navigation structure (Sidebar, MobileTabBar, Header).

**Files inspected.** `pages/**` (72 files), `components/Sidebar.js`, `components/MobileTabBar.js`, `components/Header.js`, `components/Layout.js`, `components/ProtectedRoute.js`, `pages/_app.js`, `lib/*Service.js`, `lib/databaseService.js`, `store/slices/*`, `contexts/*`, and `convex/*.ts` for the function → table mapping.

**Findings.** The tables below. Narrative detail and evidence are in doc 02.

**Dependencies.** Doc 02 (per-page detail), doc 06 (backend function inventory), doc 07 (authorization).

**Risks.** Tables were derived statically from imports and `api.*` references. Functions called indirectly through a service are listed by the service's backend target.

**Outstanding questions.** None beyond doc 02.

**Completion status.** Complete for all page files.

Legend:
- **Guard**: `—` = no `ProtectedRoute` (global `AuthWrapper` still requires sign-in unless the route is public); `any` = signed-in; `admin` / `super` = `requiredRole`.
- **Nav**: `SB:<Section>` = Sidebar; `(A)` = adminOnly item; `(S)` = superAdminOnly section; `Tab` = mobile tab bar; `Hdr` = Header; `link` = only linked from other pages; `none` = not linked anywhere.
- **Tables**: those read (r) or written (w) by the backend functions, including helper side effects (ledger, audit, notifications). `auditLogs` is written by almost every mutation and is omitted except where it is the subject.

## 1. Route table

### Shell and auth

| Route | Page file | Key components | Convex functions | Tables | Nav | Guard |
|---|---|---|---|---|---|---|
| `/` | `pages/index.js` | `AppShellSkeleton` | (`users.current` via AuthContext) | users (r) | none | — (redirects) |
| `/login` | `pages/login.js` | `ui` | Convex Auth `signIn('password')` | users, authAccounts (auth tables) | public | public |
| `/signup` | `pages/signup.js` | `ui` | Convex Auth `signIn` flow `signUp` | users, auth tables | link from login | public |
| `/account` | `pages/account.js` | `Layout` | `userAccounts.changePassword` (action) | users, auth tables | Hdr profile menu; forced when `mustChangePassword` | any |
| `/404` | `pages/404.js` | — | — | — | — | — |
| `_app`, `_document` | `pages/_app.js`, `pages/_document.js` | providers, `AiAssistant`, SW registration | `users.current`, `users.claimInvite`, `farmLocations.list/ensureDefault/setActiveLocation/backfillLocations`, `companies.getEffectiveSettings`, `companies.aiAssistantStatus`, `notifications.listForCurrentUser` | users, userInvites, farmLocations, companies, notifications | — | — |
| `/reset-password`, `/verify-email` | **no file** | — | — | — | listed in `_app.js:77` | — |

### Dashboard and production

| Route | Page file | Key components | Convex functions | Tables | Nav | Guard |
|---|---|---|---|---|---|---|
| `/dashboard` | `pages/dashboard.js` | `Dashboard`, recharts, `HealthMeter` | `cages.list`, `stocking.listStockingHistory`, `reports.dashboardKpis`, `reports.dashboardSummary`, `dailyRecords.list` | cages, stockingHistory, dailyRecords, biweeklyRecords, harvestRecords, feedTypes (r) | SB:Production; Tab | any |
| `/daily-entry` | `pages/daily-entry.js` | `DailyUploadPage`, `FeedTypeField`, `LocationMetaField`, `Waterline`, `DependencyEmpty`→`QuickCreateModals`, `lib/offlineOutbox` | `cages.getActive`, `feed.listFeedTypes`, `inventory.listStockLevels`, `dailyRecords.listForDate`, `dailyRecords.createBatch` | dailyRecords (w), cages (w count), feedUsage (w), feedInventory (w), feedInventoryTransactions (w), feedTypes (w stock), notifications (w), users (r) | SB:Production; Tab | any |
| `/daily-data` | `pages/daily-data.js` | re-export of daily-entry | same | same | none | any |
| `/biweekly-entry` | `pages/biweekly-entry.js` | `BiweeklyEntryForm` | `cages.list`, `biweeklyRecords.create`, `biweeklyRecords.get` | biweeklyRecords (w), biweeklySampling (w), cages (w ABW sync) | SB:Production | any |
| `/biweekly-records` | `pages/biweekly-records.js` | `ui` | `cages.list`, `biweeklyRecords.list/update/remove`(admin) | biweeklyRecords (r/w), cages (w) | SB:Production | any |
| `/harvest` | `pages/harvest.js` | `HarvestForm`, `SamplingForm`, `ConfirmDeleteModal` | `harvest.list/get/create/update/remove`(admin), `harvest.suggestFcr`, `harvest.createSampling`, `cages.getActive` | harvestRecords (r/w), harvestSampling (w), cages (w), stockingHistory (w closedAt) | SB:Production | any |
| `/harvest-sampling` | `pages/harvest-sampling.js` | `ui` | `cages.getActive`, `harvest.createFromSampling` | harvestRecords (w), harvestSampling (w) | SB:Production | any |
| `/sales` | `pages/sales.js` | `LocationMetaField` | `harvest.list`, `sales.listCustomers`, `sales.listSales`, `sales.createSale`, `sales.createCustomer`(admin), `sales.removeSale`(admin) | sales, customers (r/w), harvestRecords (r) | SB:Production | any |
| `/health` | `pages/health.js` | `LocationMetaField`, `lib/farmHealth` | `cages.list`, `health.list`, `health.activeWithdrawals`, `health.create`, `health.remove`(admin) | healthTreatments (r/w), cages (r) | SB:Production | any |
| `/pnl` | `pages/pnl.js` | `lib/fishSpecies`, `lib/farmHealth` | `reports.listCagePnL`, `reports.getCagePnL` | cages, sales, dailyRecords (r) | SB:Production | any |
| `/stocking-management` | `pages/stocking-management.js` | `FarmLocationSelect` | `stocking.listStockingHistory`, `cages.list`, `stocking.updateStocking`(admin), `stocking.removeStocking`(admin) | stockingHistory (r/w), cages (r/w) | SB:Production | any |
| `/stocking` | `pages/stocking.js` | `StockingForm`, `PersonPicker`, `FarmLocationSelect` | `cages.list`, `companies.getEffectiveSettings`, `stocking.suggestBatchNumber`, `stocking.createStocking`, `users.listDirectory` | stockingHistory (w), cages (w), companies (r), users (r) | SB:Production | any |
| `/topup` | `pages/topup.js` | `TopUpForm`, `PersonPicker` | `stocking.listStockingHistory`, `stocking.listTopupHistory`, `cages.list`, `stocking.createTopup`, `companies.getEffectiveSettings` | topupHistory (w), cages (w), stockingHistory (r) | link (stocking, stocking-management, approvals) | any |
| `/stocking/[id]/details` | `pages/stocking/[id]/details.js` | `ui` | `stocking.getStocking`, `approveStocking`/`rejectStocking`(admin) | stockingHistory, cages | link (approvals) | any |
| `/topup/[id]/details` | `pages/topup/[id]/details.js` | `ui` | `stocking.getTopup`, `approveTopup`/`rejectTopup`(admin) | topupHistory, cages | link (approvals) | any |
| `/fish-transfers` | `pages/fish-transfers.js` | `FishTransferForm`, `PersonPicker` | `fishTransfers.listFishTransfers`, `createFishTransfer`, `approveFishTransfer`/`rejectFishTransfer`(admin), `cages.list`, `companies.getEffectiveSettings` | fishTransfers (r/w), cages (w), stockingHistory (w), topupHistory (w) | SB:Production | any |
| `/approvals` | `pages/approvals.js` | `ui` | `stocking.listPendingApprovals`(admin), approve/reject for stocking, top-up and transfer | stockingHistory, topupHistory, fishTransfers, cages | SB:Management (A) | admin |
| `/pending-approval` | `pages/pending-approval.js` | redirect → `/approvals` | — | — | none | admin |

### Cages

| Route | Page file | Key components | Convex functions | Tables | Nav | Guard |
|---|---|---|---|---|---|---|
| `/cages` | `pages/cages/index.js` | `DataTable`, `CageManageModals`, recharts | `cages.list`, `companies.getEffectiveSettings`, `cages.update`(admin), `cages.remove`(admin) | cages, companies | SB:Cages; Tab | any |
| `/cages/[id]` | `pages/cages/[id].js` | `Waterline`, `CageManageModals` | `cages.get`, `cages.growth`, `dailyRecords.list`, `biweeklyRecords.list`, `cages.update/remove`(admin) | cages, dailyRecords, biweeklyRecords, stockingHistory (r) | link (cages list) | any |
| `/cages/analytics` | `pages/cages/analytics.js` | recharts, Redux `cagesSlice` | `cages.list` | cages | SB:Cages | any |
| `/cages/analytics/growth` | `pages/cages/analytics/growth.js` | Redux `fetchActiveCages` | `cages.getActive` | cages | link | any |
| `/cages/analytics/harvest` | `pages/cages/analytics/harvest.js` | Redux `fetchHarvestReadyCages` | `cages.getActive` | cages | link | any |
| `/cages/qr-codes` | `pages/cages/qr-codes.js` | `qrcode` lib | `cages.list` | cages | SB:Cages | any |
| `/cages/settings` | `pages/cages/settings.js` | `CageManageModals` | `cages.list`, `cages.update/remove`(admin) | cages | SB:Cages | any |
| `/create-cage` | `pages/create-cage.js` | `CreateCageForm`, `FarmLocationSelect` | `cages.list`, `cages.create`, `cages.get` | cages (w), farmLocations (r/w default) | SB:Cages | any |
| `/cages/active` | `pages/cages/active.js` | redirect → `/cages?filter=active` | — | — | none | — |
| `/cages/harvest-ready` | `pages/cages/harvest-ready.js` | redirect → `/cages?filter=ready_to_harvest` | — | — | none | — |
| `/cages/maintenance` | `pages/cages/maintenance.js` | redirect → `/cages?filter=maintenance` | — | — | none | — |
| `/cages/feed-types` | `pages/cages/feed-types.js` | redirect → `/feed-types` | — | — | none | any |

### Feed

| Route | Page file | Key components | Convex functions | Tables | Nav | Guard |
|---|---|---|---|---|---|---|
| `/feed-management` | `pages/feed-management/index.js` | `DataTable`, `FeedPurchaseModal`, `ConfirmDeleteModal` | `inventory.listStockLevels`, `feed.listUsage`, `feed.listFeedTypes`, `cages.list`, `feed.createFeedType`(admin), `feed.updateFeedType`, `feed.softDeleteFeedType`(admin), `feed.listSuppliers`, `feed.createSupplier`, `feed.createPurchase` | feedTypes, feedSuppliers, feedUsage, feedPurchases, feedInventory, feedInventoryTransactions | SB:Feed "Overview" | any |
| `/feed-management/overview` | `pages/feed-management/overview.js` | recharts | `feed.listFeedTypes`, `feed.listUsage`, `feed.listSuppliers`, `cages.growthAll` | feedTypes, feedUsage, feedSuppliers, cages, stockingHistory, dailyRecords, biweeklyRecords (r) | link (breadcrumbs) | any |
| `/feed-management/analytics` | `pages/feed-management/analytics.js` | `ui` | `feed.listUsage`, `feed.listFeedTypes`, `cages.list`, `feed.listPurchases`, `inventory.listAlerts` | feedUsage, feedTypes, feedPurchases, cages | SB:Feed | any |
| `/feed-management/purchases`, `/suppliers`, `/types`, `/usage` | `pages/feed-management/*.js` | SSR redirect → `/feed-purchases`, `/feed-suppliers`, `/feed-types`, `/feed-issue` | — | — | none | — |
| `/feed-types` | `pages/feed-types.js` | Redux `feedSlice`, `ConfirmDeleteModal` | `feed.listFeedTypes`, `feed.createFeedType`(admin), `feed.updateFeedType`, `feed.softDeleteFeedType`(admin), `feed.listSuppliers` | feedTypes, feedSuppliers | SB:Feed | any |
| `/feed-suppliers` | `pages/feed-suppliers.js` | `ConfirmDeleteModal` | `feed.listSuppliers`, `createSupplier`, `updateSupplier`, `softDeleteSupplier`(admin) | feedSuppliers | SB:Feed | any |
| `/feed-purchases` | `pages/feed-purchases.js` | `FeedPurchaseModal`, `FeedTypeField`, `BagSizeField`, recharts | `feed.listFeedTypes`, `feed.listPurchases`, `inventory.listLots`, `inventory.listStockLevels`, `feed.listUsage`, `cages.list`, `feed.listSuppliers`, `cages.growthAll`, `feed.createPurchase`, `feed.updatePurchase`(admin), `feed.voidPurchase`(admin) | feedPurchases, feedInventory, feedInventoryTransactions, feedTypes, feedSuppliers, feedUsage | SB:Feed | any |
| `/feed-issue` | `pages/feed-issue.js` | `FeedTypeField`, `LocationMetaField`, `DependencyEmpty` | `feed.listFeedTypes`, `cages.getActive`, `feed.createIssue` | feedUsage (w), feedInventory, feedInventoryTransactions, feedTypes (w) | SB:Feed; Tab "Feed" | any |

### Inventory

| Route | Page file | Key components | Convex functions | Tables | Nav | Guard |
|---|---|---|---|---|---|---|
| `/inventory/overview` | `pages/inventory/overview.js` | recharts | `inventory.listStockLevels`, `inventory.listTransactions` | feedTypes, feedInventoryTransactions | SB:Inventory | any |
| `/stock-levels` | `pages/stock-levels.js` | `ui` | `inventory.listStockLevels`, `inventory.stockTally` | feedTypes, feedInventoryTransactions, feedInventory | SB:Inventory | any |
| `/inventory/lots` | `pages/inventory/lots.js` | `ui` | `inventory.listLots` | feedInventory | SB:Inventory | any |
| `/inventory/adjust` | `pages/inventory/adjust.js` | `FarmLocationSelect`, `FeedTypeField` | `feed.listFeedTypes`, `inventory.listLots`, `inventory.createAdjustment`(admin), `inventory.createTransfer`(admin) | feedInventory, feedInventoryTransactions, feedTypes | SB:Inventory (shown to all) | admin |
| `/inventory-alerts` | `pages/inventory-alerts.js` | `ui` | `inventory.listAlerts` | feedTypes, companies | SB:Inventory | any |
| `/inventory-transactions` | `pages/inventory-transactions.js` | `ConfirmDeleteModal` | `inventory.listTransactions`, `feed.listFeedTypes`, `inventory.reverseTransaction`(admin) | feedInventoryTransactions, feedInventory, feedTypes | SB:Inventory | any |
| `/inventory/analytics` | `pages/inventory/analytics.js` | recharts | `inventory.listStockLevels`, `inventory.listTransactions` | feedTypes, feedInventoryTransactions | SB:Inventory | any |
| `/inventory/items`, `/categories`, `/reports`, `/transactions` | `pages/inventory/*.js` | SSR redirect → `/feed-types`, `/feed-types`, `/inventory/analytics`, `/inventory-transactions` | — | — | none | — |

### Reports, admin, settings

| Route | Page file | Key components | Convex functions | Tables | Nav | Guard |
|---|---|---|---|---|---|---|
| `/report` | `pages/report.js` | `ui` | `cages.list`, `reports.productionReport` | cages, dailyRecords, biweeklyRecords, harvestRecords | SB:Reports | any |
| `/export` | `pages/export.js` | `xlsx` | `reports.exportBundle`, `cages.list`, `stocking.listStockingHistory` | dailyRecords, biweeklyRecords, harvestRecords, cages, stockingHistory | SB:Reports | any |
| `/audit-logs` | `pages/audit-logs.js` | `ui` | `audit.list`(admin), `audit.getSummary`(admin) | auditLogs | SB:Reports (A) | admin |
| `/users` | `pages/users.js` | `UserManagement` | `users.list`/`update`/`deactivate`/`reactivate`(admin), `userAccounts.createWithPassword` | users, auth tables | SB:Management (A) | admin |
| `/company-settings` | `pages/company-settings.js` | `ui` | `companies.getSettingsDraft`, `saveSettingsDraft`, `publishSettings`, `generateLogoUploadUrl`, `setLogo`, `clearLogo` (all admin) | companies, companySettingsDrafts, `_storage` | SB:Management (A) | admin |
| `/global-settings` | `pages/global-settings.js` | `SettingsContext` | `companies.getSettingsDraft`/`saveSettingsDraft`/`publishSettings` (admin) | companies, companySettingsDrafts | SB:Management | any (save UI admin-gated) |
| `/farm-locations` | `pages/farm-locations.js` | `ui` | `farmLocations.list`, `create`(admin), `update`(admin) | farmLocations | SB:Management (A); Hdr link when none | any |
| `/bulk-upload` | `pages/bulk-upload.js` | `BulkDailyUploadForm`, `BulkBiweeklyUploadForm` | `cages.list`, `feed.listFeedTypes`, `dailyRecords.createMany`, `biweeklyRecords.createMany` | dailyRecords, biweeklyRecords, cages, feedUsage, ledger tables | SB:Management (A) | admin |
| `/register-company` | `pages/register-company.js` | `CompanyRegistrationsPage` | `companies.register` | companies (w), users (r) | link (company-settings) | — (sign-in only) |
| `/admin/admin` | `pages/admin/admin.js` | `DataTable`, `ConfirmDeleteModal` | `companies.list`(super), `companies.remove`(super) | companies, users | SB:Admin (S) | super |
| `/admin/company-registrations` | `pages/admin/company-registrations.js` | `AdminCompanyRegistrationsPage` | `companies.listPending`/`approve`/`reject` (super) | companies, users (w role), farmLocations (w) | SB:Admin (S) | super |
| `/admin/companies/*` | **no file** | linked from `admin/admin.js:130-131,150` | — | — | broken link | — |

### API routes (Next.js server)

| Route | File | Purpose | Auth |
|---|---|---|---|
| `POST /api/llm/chat` | `pages/api/llm/chat.js` | Proxies a chat completion to an LLM provider with a server env key | Bearer Convex JWT → `users.current`; `companies.aiAssistantStatus.enabled` |
| `GET /api/llm/status` | `pages/api/llm/status.js` | Reports which providers have keys configured | Bearer Convex JWT |

The only other HTTP surface is `convex/http.ts` (Convex Auth routes).

## 2. Feature → routes map

| Feature | Primary routes | Secondary / duplicate routes | Backend modules |
|---|---|---|---|
| Overview dashboard | `/dashboard` | — | `reports.dashboard*`, `cages`, `stocking`, `dailyRecords` |
| Cage registry | `/cages`, `/create-cage`, `/cages/[id]` | `/cages/settings` (duplicate edit/delete), `/cages/active`, `/harvest-ready`, `/maintenance` | `cages` |
| Cage analytics | `/cages/analytics` | `/cages/analytics/growth`, `/cages/analytics/harvest` | `cages` (client-computed) |
| QR cage labels | `/cages/qr-codes` → `/daily-entry?cage=` | — | `cages` |
| Stocking | `/stocking`, `/stocking-management` | `/stocking/[id]/details` | `stocking`, `lib/farmRules` |
| Top-up | `/topup` | `/topup/[id]/details` | `stocking` |
| Fish transfer | `/fish-transfers` | `/approvals` | `fishTransfers`, `lib/fishTransferLogic` |
| Approvals | `/approvals` | `/pending-approval`, details pages | `stocking.listPendingApprovals` |
| Daily feeding and mortality | `/daily-entry` | `/daily-data`, `/bulk-upload` (daily CSV) | `dailyRecords`, `lib/feedLedger` |
| Bi-weekly sampling (growth) | `/biweekly-entry`, `/biweekly-records` | `/bulk-upload` (biweekly CSV) | `biweeklyRecords`, `lib/growth` |
| Harvest | `/harvest` | `/harvest-sampling` (creates harvest too) | `harvest`, `lib/farmRules.harvestWarnings` |
| Harvest sampling | `/harvest` "Add sampling", `/harvest-sampling` | — | `harvest.createSampling`, `harvest.createFromSampling` |
| Sales and customers | `/sales` | — | `sales` |
| Cage P&L | `/pnl` | `/report` "financial" (feed cost only) | `reports.*CagePnL` |
| Fish health and treatments | `/health` | — | `health` |
| Feed types | `/feed-types` | `/feed-management` (duplicate CRUD), `/cages/feed-types`, `/feed-management/types`, `/inventory/items`, `/inventory/categories` | `feed` |
| Feed suppliers | `/feed-suppliers` | `/feed-management` (create), `/feed-management/suppliers` | `feed` |
| Feed purchases | `/feed-purchases` | `/feed-management` (purchase modal), `/feed-management/purchases` | `feed`, `lib/feedLedger` |
| Feed issue | `/feed-issue` | `/feed-management/usage` | `feed.createIssue` |
| Feed analytics | `/feed-management/analytics`, `/feed-management/overview` | `/feed-management`, `/feed-purchases` analytics panels | `feed`, `inventory`, `cages.growthAll` |
| Feed inventory | `/inventory/overview`, `/stock-levels`, `/inventory/lots`, `/inventory-transactions` | `/inventory/transactions` | `inventory`, `lib/feedLedger` |
| Stock adjustment / inter-site transfer | `/inventory/adjust` | — | `inventory.createAdjustment/createTransfer` |
| Low-stock alerts | `/inventory-alerts`, cron digest | `/feed-management/analytics` | `inventory.listAlerts`, `reminders` |
| Production reports | `/report` | `/inventory/reports` → analytics | `reports.productionReport` |
| Data export | `/export` | `/harvest` CSV export | `reports.exportBundle` |
| Audit trail | `/audit-logs` | — | `audit`, `lib/tenancy.logAudit` |
| AI assistant | floating panel (all pages) | `/api/llm/*` | `reports.farmContextForAi`, `companies.aiAssistantStatus` |
| Users | `/users` | — | `users`, `userAccounts` |
| Own account | `/account` | — | `userAccounts.changePassword` |
| Company onboarding | `/register-company`, `/admin/company-registrations` | `/admin/admin` | `companies` |
| Company settings and branding | `/company-settings` | `/global-settings` (currency) | `companies` |
| Farm locations (multi-site) | `/farm-locations`, Header switcher | — | `farmLocations`, `lib/tenancy` |
| Notifications | Header bell | — | `notifications`, `reminders` (cron), `dailyRecords` (alerts) |
| Offline capture | `/daily-entry` only | `public/sw.js` | `lib/offlineOutbox` |
| Guided tour | Header help menu | — | `components/TourProvider`, `lib/tours` |

## 3. Navigation structure

### 3.1 Sidebar (`components/Sidebar.js:47-144`)

Visibility rules: `adminOnly` hides an item from `role === 'user'`; `superAdminOnly` hides a section from anyone below `super_admin` (`Sidebar.js:162-185`). Sections start expanded, and the section containing the current route is forced open (`:187-197`).

```
Production
  Dashboard ................ /dashboard
  Daily Entry .............. /daily-entry
  Bi-weekly Entry .......... /biweekly-entry
  Bi-weekly Records ........ /biweekly-records
  Harvest Data ............. /harvest
  Harvest Sampling ......... /harvest-sampling
  Sales .................... /sales
  Health ................... /health
  Cage P&L ................. /pnl
  Stocking Management ...... /stocking-management
  Fish Transfers ........... /fish-transfers
  New Stocking ............. /stocking
Cages
  All Cages ................ /cages
  Analytics ................ /cages/analytics
  QR codes ................. /cages/qr-codes
  Settings ................. /cages/settings
  Create Cage .............. /create-cage
Feed
  Overview ................. /feed-management
  Feed Types ............... /feed-types
  Suppliers ................ /feed-suppliers
  Purchases ................ /feed-purchases
  Issue Feed ............... /feed-issue
  Analytics ................ /feed-management/analytics
Inventory
  Overview ................. /inventory/overview
  Stock Levels ............. /stock-levels
  Lots ..................... /inventory/lots
  Adjust / Transfer ........ /inventory/adjust        (page is admin-only; item shown to all)
  Alerts ................... /inventory-alerts
  Transactions ............. /inventory-transactions
  Analytics ................ /inventory/analytics
Reports
  Production Report ........ /report
  Export Data .............. /export
  Audit Logs ............... /audit-logs               [adminOnly]
Management
  Global Settings .......... /global-settings
  Farm Locations ........... /farm-locations           [adminOnly]
  Users .................... /users                    [adminOnly]
  Company Settings ......... /company-settings         [adminOnly]
  Approvals ................ /approvals                [adminOnly]
  Bulk Upload .............. /bulk-upload              [adminOnly]
Admin                                                  [superAdminOnly section]
  Admin Dashboard .......... /admin/admin
  Registrations ............ /admin/company-registrations
```

Footer: avatar, name, email, and logout (with confirm modal). The logo links to `/dashboard`. The sidebar can collapse to icons on desktop and becomes a drawer on phones.

Observations:
- "Production" has 12 items in a flat list that mixes daily operations, finance (Sales, P&L), health and stocking. Top-up has no entry.
- Two items labelled "Analytics" (Cages, Feed) and a third (Inventory) live in three sections.
- Feed "Overview" points to `/feed-management`, while all breadcrumbs point "Feed" to `/feed-management/overview`.

### 3.2 MobileTabBar (`components/MobileTabBar.js:5-10`)

Visible below the `lg` breakpoint: Home `/dashboard`, Daily entry `/daily-entry`, Cages `/cages`, Feed `/feed-issue`, More (opens the Sidebar drawer). Active state uses prefix matching, so `/cages/[id]` highlights Cages.

### 3.3 Header (`components/Header.js`)

- Page title, taken from the `Layout` prefix table (`Layout.js:11-49`) or the page's `title` prop.
- Farm location selector: a `<select>` when at least one location exists; otherwise a link to `/farm-locations` (`Header.js:111-145`). Changing it calls `farmLocations.setActiveLocation` and refreshes data.
- Notifications bell: list, mark read, mark all read. Clicking an item navigates to its `link`. Links in use: `/daily-entry`, `/daily-entry?cages=…`, `/stock-levels`.
- Theme toggle (light/dark), and a help menu that starts the guided tour.
- Profile menu: `/account` and logout.

### 3.4 Routes not reachable from any nav element

`/topup` (contextual links only), `/cages/[id]`, `/cages/analytics/growth`, `/cages/analytics/harvest`, `/feed-management/overview` (breadcrumbs only), `/stocking/[id]/details`, `/topup/[id]/details`, `/register-company`, `/account` (Header only). Fully orphaned (no inbound link at all): `/daily-data`, `/pending-approval`, `/cages/active`, `/cages/harvest-ready`, `/cages/maintenance`, `/cages/feed-types`, `/feed-management/{purchases,suppliers,types,usage}`, `/inventory/{items,categories,reports,transactions}`.

### 3.5 Links that point to missing routes

- `/admin/companies/create`, `/admin/companies/[id]`, `/admin/companies/[id]/edit` (`pages/admin/admin.js:130-131,150`).
- `/reset-password`, `/verify-email` (declared public in `_app.js:77` but no pages).
