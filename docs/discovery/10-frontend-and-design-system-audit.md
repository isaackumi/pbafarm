# 10 — Frontend and Design System Audit

Discovery stage: PART 8 (Phase Five), frontend half. The mobile/field-worker half is in `11-mobile-user-experience-audit.md`.
Branch audited: `docs/discovery` (code of PRs #8–#12, #14). PR state, verified 2026-11-18 after discovery: #7–#13 are merged to `main` and deployed to `vibrant-stork-860`; #14 (UI only) was merged into a stale branch and is not on `main`. See docs/project-management/CHANGELOG.md.. No code was changed. Nothing was run except `npx eslint` (read-only) and a size measurement of an existing `.next` build output that was already on disk.

## Stage header

**Objective.** Describe the frontend as it is: design system, app shell, navigation, forms, tables, dialogs, loading/error/empty states, accessibility, duplication, oversized components, state management, data fetching, i18n readiness and dark mode. Say what works, what is defective and what is missing, with file and line evidence.

**Files inspected.**
- Design system: `styles/globals.css`, `styles/theme.css`, `styles/tour.css` (skimmed), `components/ui/index.js`, `components/Waterline.js`, `pages/_document.js`, `next.config.mjs`.
- Shell and navigation: `pages/_app.js`, `components/Layout.js`, `components/Sidebar.js`, `components/Header.js`, `components/MobileTabBar.js`, `components/ProtectedRoute.js`, `components/Toast.js`, `components/AiAssistant.js` (render conditions and position only), `components/TourProvider.js`, `lib/tours/tourEngine.js` (imports only).
- Forms: `components/DailyUploadPage.js` (read in full), `components/DailyEntryForm.js`, `components/BiweeklyEntryForm.js`, `components/BiweeklyForm.js`, `components/HarvestForm.js`, `components/SamplingForm.js`, `components/FeedPurchaseModal.js`, `components/FishTransferForm.js`, `components/StockingForm.js`, `components/TopUpForm.js`, `components/QuickCreateModals.js` (`ModalShell`), `components/LocationMetaField.js`, `pages/biweekly-entry.js`, `pages/harvest.js`, `pages/harvest-sampling.js`, `pages/fish-transfers.js`, `pages/feed-purchases.js` (structure), `pages/cages/qr-codes.js`, `pages/cages/[id].js` (links).
- Tables, dialogs: `components/DataTable.js`, `components/Pagination.js`, `components/ConfirmDeleteModal.js`, `components/LogoutConfirmationModal.js`, `components/CageManageModals.js`, plus every file containing `fixed inset-0` or `<table` (listed in sections below).
- State and data: `contexts/*.js` (all 8), `store/index.js`, `store/slices/cagesSlice.js`, `hooks/usePersistedForm.js`, `hooks/useToast.js`, `hooks/useCurrency.js`, `lib/convexBridge.js`, `lib/convexClient.js`, `lib/databaseService.js` (first 170 lines), `lib/cageService.js` (`getActiveCages`), `lib/locationScope.js`, `lib/money.js`, `lib/currencyUtils.js`, `lib/offlineOutbox.js`.
- Repo-wide greps (counts quoted below) across `pages/`, `components/`, `contexts/`, `hooks/`.

**Findings.** Sections 1–15 below. Summary table in section 16.

**Dependencies.** Reads from the same data layer described in `06-backend-function-inventory.md` (Convex functions) and `07-authentication-and-authorization.md` (auth, roles). Offline and PWA behaviour is detailed in `11-mobile-user-experience-audit.md`.

**Risks.** Section 17.

**Outstanding questions.** Section 18.

**Completion status.** Complete for the scope in PART 8 (frontend). Visual rendering was not checked in a browser (no dev server per brief), so anything about how a screen *looks* is inferred from classes and is marked with a confidence.

---

## 1. Stack facts relevant to the UI

| Item | Evidence | Note |
|---|---|---|
| Next.js 15.2.8, pages router, React 19 | `package.json`; `pages/` tree, no `app/` | All 60+ routes are client-rendered pages; only redirect stubs use `getServerSideProps`. |
| Tailwind v4 via `@tailwindcss/postcss` | `styles/globals.css:1` `@import 'tailwindcss'`; `@theme` block at `globals.css:7` | `tailwind.config.js` exists and lists `require('@tailwindcss/forms')` etc. (`:80-81`), but Tailwind v4 only reads a JS config through an `@config` directive, and there is no `@config` or `@plugin` in `styles/`. The JS config and its plugins are therefore probably ignored. Confidence Medium (not built). |
| Two icon libraries | `lucide-react` (used everywhere), `@phosphor-icons/react` | Phosphor has **zero imports** in `pages/` or `components/`. Dead dependency. |
| Redux Toolkit + redux-persist | `store/index.js:32-36` | Used by 6 files only (see §12). |
| Charts | `recharts` imported by 9 files | Not lazy-loaded (see §15 and doc 11). |
| Tours | `driver.js` via `lib/tours/tourEngine.js:6-7` | Loaded in `_app` for every page. |

## 2. Design system

### 2.1 Tokens (`styles/theme.css`, `styles/globals.css`)

**Status: Implemented and working (light), Implemented but incomplete (system level).** Confidence High.

- Semantic CSS variables live on `:root` in `theme.css:2-44`: chrome (`--lagoon-950/800/700`), canvas (`--foam`, `--foam-deep`), status (`--kelp` green, `--signal` red), text (`--chart-ink`, `--muted`), `--surface`, input tokens, one accent `--lake` (`theme.css:20-21`), spacing (`--space-xs…xl`) and two shadows.
- `globals.css:7-40` maps them into Tailwind colours (`bg-surface`, `text-muted`, `border-foam-deep`, `text-lake`, …) and fonts (`--font-display` Lexend, `--font-sans` Figtree, `--font-data` JetBrains Mono).
- Dark values override the same variables under `html.dark, html[data-theme='dark']` (`theme.css:54-80`), so components using semantic utilities switch automatically.
- Adoption is high: 1,644 semantic utility uses vs 26 raw `zinc-*` and 89 raw `amber/red/green/yellow/orange/purple/cyan-*` uses in `pages/` + `components/`.

Gaps:
- **No status "warning" token.** Amber is used raw (`bg-amber-50`, `text-amber-800`, `bg-amber-500` in `HealthMeter`, `components/ui/index.js:119`). Amber-500 on white is 2.15:1.
- **No typography scale tokens.** Sizes are inline Tailwind (`text-[28px]`, `text-2xl sm:text-[28px]`).
- **Spacing tokens are defined but unused by components** (they use Tailwind spacing). `--space-*` appear only in `theme.css`.
- **Undefined variable**: `var(--lagoon-soft, #7dd3fc)` at `theme.css:454` — `--lagoon-soft` is never declared, so the fallback is always used.
- **Dead CSS.** `globals.css:103-128` remaps legacy `bg-indigo-*`/`bg-blue-*`/`text-indigo-*` with `!important`; a grep finds **0** remaining uses of those classes. Likewise `theme.css` defines `.btn-secondary` (0 uses), `.table-shell` (0 uses), `.input-field` (0 uses), `.page-title` (1 use), `.btn-primary` (3 uses). `.page-card` is the only legacy class still widely used (76 uses in 31 files).
- **Dark-mode "safety net"** (`theme.css:328-561`) rewrites ~60 raw Tailwind palette classes with `!important`. It works, but it means a raw class can look different from what its name says, and it keeps the codebase dependent on the safety net instead of tokens.

### 2.2 Primitives (`components/ui/index.js`, 504 lines)

| Primitive | Lines | Status | Notes |
|---|---|---|---|
| `Button` (variants primary/secondary/ghost/danger; sizes sm/md/lg; `href` → `Link`) | 4-43 | Implemented and working | `focus-visible:ring-2 ring-lake`. `sm` = `min-h-9` (36 px), below a 44–48 px touch target. Used 229 times in 64 files; 66 raw `<button>` remain in 31 files. |
| `Card`, `CardHeader`, `StatCard`, `HealthMeter` | 45-126 | Working | `StatCard` accepts `icon` but intentionally does not render it (comment at :81). `HealthMeter` has `role="meter"` + aria values. |
| `EmptyState` | 128-136 | Working | Used in 7 files only. |
| `TabBar` | 138-157 | Working, a11y incomplete | Plain buttons; no `role="tablist"`/`aria-selected`. `min-h-9`. |
| `Breadcrumbs`, `PageHeader` | 159-249 | Working | `aria-current="page"`, `nav aria-label`. Separator `text-zinc-300` (decorative, aria-hidden). |
| `Field`, `Input`, `Select`, `Textarea` | 251-294 | Working, a11y incomplete | `FIELD_CLASS` is `text-base` (16 px) and `min-h-11` (44 px) — comment at :252 notes iOS zoom. `Field` does **not** generate ids, does not set `aria-invalid`, and does not link hint/error with `aria-describedby`. Error text is `text-xs text-signal` without `role="alert"`. |
| `FormPage`, `FormSection`, `FormCard`, `FormActions` | 296-367 | Working | `FormActions` is not sticky (see doc 11). |
| `Skeleton`, `AppShellSkeleton`, `DashboardSkeleton` | 369-503 | Working on desktop, **defective on phones** | `AppShellSkeleton` hard-codes a fixed 256 px sidebar and `ml-64` content (:386-405) with no responsive classes, so on a 360 px phone the loading screen is mostly a dark sidebar. It is shown on every cold start and on every `ProtectedRoute` wait. Confidence High (class reading). |

**Missing primitives** (searched `components/ui/index.js` and `components/`): `Modal`/`Dialog`, `ConfirmDialog` (there is a component, not a primitive — §6), `Table` (there is `DataTable`, used by 3 pages — §5), `Badge`/`StatusPill`, `Checkbox`/`Radio`/`Switch`, `NumberInput` with steppers, `DateInput` helpers, `Toast` as a primitive (lives in `components/Toast.js`), `Banner`/`Alert`, `Tooltip`, `Tabs` with ARIA. Status: **Completely missing** for Modal and Badge; others partially covered by ad-hoc markup.

### 2.3 Waterline

`components/Waterline.js` draws a 4 px bar showing `count / capacity` with `role="img"` and an `aria-label`. Used in 2 places: cage chips in `DailyUploadPage.js:639-644` and `pages/cages/[id].js`. Also a `.waterline` 2 px divider class exists in `theme.css` (`--waterline` token). **Implemented and working.** It is the only domain-specific visual primitive.

### 2.4 Fonts

`pages/_document.js:13-18` loads three Google Fonts families (Figtree 400/500/600, JetBrains Mono 400/500, Lexend 400/500/600 — 8 faces) with `display=swap`. Consequences:
- Third-party request on every cold load; the service worker skips cross-origin requests (`public/sw.js:27`), so fonts are **not available offline** (falls back to `system-ui`; harmless but inconsistent).
- No `next/font` self-hosting. No `preload` of the woff2.

## 3. App shell and layout

| Element | File | Behaviour | Status |
|---|---|---|---|
| Provider stack | `pages/_app.js:41-70` | 11 nested providers: Convex auth → Redux → Theme → Settings → Auth → CompanySettings → Location → Data → Toast → Notification → Analytics → Tour. | Working; two providers are dead (see §12). |
| Auth gate | `_app.js:73-119` `AuthWrapper` | Redirects to `/login`, forces `/account?force=1` when `mustChangePassword`. Shows `AppShellSkeleton` while loading. | Working online; blocks offline cold start (doc 11 §5). |
| Per-page guard | `components/ProtectedRoute.js` | Role check via `hasRole`; redirects to `/dashboard` when not allowed. Used by 53 pages. | Working. Client-side only; server enforcement is a backend concern (doc 07). |
| Layout | `components/Layout.js` | Sidebar + sticky Header + `<main>` (`pb-24` on phones to clear the tab bar) + `MobileTabBar`. Title from `TITLE_BY_PREFIX` (:11-49). Dispatches Redux `fetchCages` once (`:76-79`). Shows a banner "Cage data temporarily unavailable" on any Redux cage error (:108-112). | Working. Every page re-renders the full shell; there is no persistent layout (pages router `getLayout` pattern not used), so Sidebar/Header state resets on navigation. |
| Header | `components/Header.js` (297 lines) | Menu button (phones), title, **location `<select>`** (`:121-138`, `text-sm`, `h-10`), help/tour menu (hidden < `sm`), notifications dropdown, theme toggle (hidden < `sm`, `:242`), profile dropdown. | Working. Changing location calls `window.location.reload()` (`contexts/LocationContext.js:70-72`). |
| Sidebar | `components/Sidebar.js` (456 lines) | 7 sections, **39 links** (`MENU_SECTIONS`, `:47-144`), role-filtered (`adminOnly`, `superAdminOnly`). Desktop collapsible; phone drawer via `translate-x`. All sections expanded by default (`:150-158`). | Working. Drawer has no focus trap, no Escape handler, no body scroll lock (searched `Sidebar.js`, `Layout.js`). |
| Mobile tab bar | `components/MobileTabBar.js` | 4 fixed tabs (Home, Daily entry, Cages, Feed → `/feed-issue`) + "More" (opens drawer). `h-16`, safe-area padding. | Working. Not role- or company-configurable. |
| Toasts | `components/Toast.js:35` | `fixed bottom-0 right-0 z-50`, 5 s auto-dismiss, `role="alert"` for errors, `role="status"` otherwise. | Working; on phones it sits over the tab bar (doc 11). |
| AI assistant FAB | `components/AiAssistant.js:234` | `fixed bottom-6 right-6 z-50 h-14 w-14`, shown only when `api.companies.aiAssistantStatus` says enabled (:118). | On phones it overlaps the "More" tab (doc 11). |
| Error boundary | — | **Completely missing.** No `ErrorBoundary`/`componentDidCatch` and no `pages/_error.js` (searched `pages/`, `components/`). A render exception anywhere unmounts the app. | Missing. |

## 4. Navigation

- **Information architecture.** 39 sidebar items across Production (12), Cages (5), Feed (6), Inventory (7), Reports (3), Management (6), Admin (2). Several items are near-duplicates from the user's point of view: "Harvest Data" vs "Harvest Sampling"; "Stocking Management" vs "New Stocking"; Feed "Overview" (`/feed-management`) vs Inventory "Overview" (`/inventory/overview`) vs "Stock Levels"; two "Analytics" entries under Feed and Inventory plus Cage Analytics.
- **Redirect stubs.** 11 legacy URLs redirect (`next.config.mjs` redirects, plus 7 stub pages with `getServerSideProps` redirects, plus 4 client-side `router.replace` stubs such as `pages/cages/active.js`). `pages/daily-data.js` is a one-line re-export of `daily-entry`. These are harmless but add routes that must be kept working.
- **Deep links.** `/daily-entry?cage=<id>` and `?cages=a,b` are honoured (`DailyUploadPage.js:189-202`). `/biweekly-entry?cage=<id>` is linked from `pages/cages/[id].js` (breadcrumb "related" links and a button) but **`pages/biweekly-entry.js` never reads `router.query`** (only `useRouter()` at :19) — the user lands on the cage picker again. Status: **Implemented but potentially defective.** Confidence High. `/fish-transfers?sourceCageId=` is honoured (`FishTransferForm.js:56-64`) but nothing links to it.
- **Title source of truth is duplicated**: `Layout.js` `TITLE_BY_PREFIX` and `Sidebar.js` `MENU_SECTIONS` list the same routes with different labels ("Harvest" vs "Harvest Data", "Inventory Ledger" vs "Transactions").
- **Navigation is hard-coded**, not driven by company configuration, enabled modules or permissions beyond the three roles (`user`/`admin`/`super_admin`). Relevant to the target "customizable interface".

## 5. Tables

| Implementation | Where | Features |
|---|---|---|
| `components/DataTable.js` (224 lines) | 3 pages: `pages/admin/admin.js`, `pages/feed-management/index.js`, `pages/cages/index.js` | Client-side search (columns flagged `searchable`), click-to-sort headers (no `aria-sort`, header is a `<th onClick>` — not keyboard reachable), built-in pagination, loading and empty message. |
| Hand-rolled `<table>` | 21 other files: `approvals`, `sales`, `feed-types`, `fish-transfers`, `pnl`, `report` (which defines its own local `DataTable` at `pages/report.js:481`, shadowing the component name), `biweekly-records` (2), `inventory/adjust`, `SamplingForm`, `BulkUploadModal`, `Dashboard`, `UserManagement`, `health`, `stocking-management`, `inventory-transactions`, `stock-levels`, `audit-logs`, `feed-purchases`, `harvest`, `inventory/lots`, `cages/analytics/growth`, `cages/analytics/harvest` | Each re-implements header styles, number alignment, empty rows and actions. |

- 23 of 24 table files wrap the table in `overflow-x-auto`; `BulkUploadModal.js` does not (it is dead code — §8). **No table has a phone card layout** (searched `md:hidden`/`sm:hidden`; only `DataTable` pagination and `feed-management/index.js` use breakpoint hiding). On phones every list is a horizontally scrolling table.
- **Pagination: four implementations** — `DataTable.js:157-210`, `components/Pagination.js` (unused, 0 importers), inline in `pages/feed-management/index.js:271-560`, inline in `pages/biweekly-records.js:472-490` (server-side pages of 20 via `getBiweeklyRecordsPaginated`). Every other list loads everything and renders it.
- No column visibility, no saved views, no export from table (export is a separate page `pages/export.js`), no virtualisation.

## 6. Modals and dialogs

There is **no shared Modal primitive**. Overlays are built by hand in 16 files (`fixed inset-0` count):

| File | Overlays | `role="dialog"`/`alertdialog` | `aria-modal` | Escape closes | Focus moved/trapped | Body scroll lock |
|---|---|---|---|---|---|---|
| `components/QuickCreateModals.js` (`ModalShell`, 4 modals) | 1 shell | yes | yes | yes (:25-27) | no | yes (:28-29) |
| `components/FeedPurchaseModal.js` | 1 | yes | yes | yes (:80) | no | not found |
| `components/ConfirmDeleteModal.js` | 1 | `alertdialog` | yes | **no** | no | no |
| `components/LogoutConfirmationModal.js` | 1 | yes | yes | no | no | no |
| `components/CageManageModals.js` | 2 | **no** | no | no | no | no |
| `components/BulkUploadModal.js` (dead) | 1 | no | no | no | no | no |
| `pages/approvals.js` | 2 | yes | yes | no | no | no |
| `pages/audit-logs.js` | 1 | yes | yes | no | no | no |
| `pages/biweekly-records.js` | 2+ | **no** | no | no | no | no |
| `pages/feed-management/index.js` | 2 | yes | yes | no | no | no |
| `pages/feed-purchases.js` | 1+ | yes | yes | no | no | no |
| `pages/feed-suppliers.js` | 2 | yes | yes | no | no | no |
| `pages/feed-types.js` | 2 | yes | yes | no | no | no |
| `pages/stocking-management.js` | 2+ | **no** | no | no | no | no |
| `pages/stocking/[id]/details.js` | 1 | no | no | no | no | no |
| `pages/topup/[id]/details.js` | 1 | no | no | no | no | no |

- **Focus management: none anywhere.** Initial focus is not moved into dialogs and is not restored on close; Tab can leave every dialog. Status: **Partially implemented** (ARIA roles in about half). Confidence High (grep for `focus()`, `autoFocus`, `inert`, `FocusTrap`).
- **Backdrop click closes data-entry dialogs.** `ModalShell` closes on any backdrop click (`QuickCreateModals.js:46`); `ConfirmDeleteModal` too (`:23`). For a create form this discards typed data on a stray tap (doc 11).
- **Confirmation dialogs: at least three patterns** — `ConfirmDeleteModal` (7 importers), `LogoutConfirmationModal` (Sidebar), and inline confirm overlays in `approvals.js`, `stocking-management.js`, `biweekly-records.js`. No `window.confirm` remains (grep).
- Two header dropdowns (help, notifications, profile in `Header.js`) are hand-rolled popovers without `role="menu"` or Escape handling.

## 7. Forms, validation and error messages

### 7.1 Primitive adoption

- `<Field>`: 283 uses. **48 have no `htmlFor`** (multi-line regex count), so their label is not associated with the control: `company-settings.js` (18), `CageManageModals.js` (8), `FishTransferForm.js` (7 — every field), `inventory/adjust.js` (6), `UserManagement.js` (4), `pnl.js` (3), `global-settings.js` (2).
- `<Input>/<Select>/<Textarea>`: 288 uses. Raw `<input>`: 28 (mostly checkboxes/file inputs; 10 in `company-settings.js`). Raw `<select>`: 2 (Header location switcher; one other). Raw `<label>`: 25, only 1 with `htmlFor` (most wrap their checkbox, which is valid).
- Legacy `.input-field` class (14 px text): 0 uses — fully migrated.

### 7.2 Draft persistence (`hooks/usePersistedForm.js`)

Debounced (300 ms) write of the whole form object to `sessionStorage` (default) or `localStorage` (`storage: 'local'`), key `pbafarm:form:<key>`.

| Form | Key | Storage |
|---|---|---|
| `DailyUploadPage` | `daily-entry-batch` | **local** (survives tab close) |
| `HarvestForm` | `harvest-create` | session |
| `StockingForm` | `stocking-create` | session |
| `TopUpForm` | `topup-create` | session |
| `FishTransferForm` | `fish-transfer-create` | session |
| `DailyEntryForm` (dead) | — | session |
| `BiweeklyEntryForm`, `FeedPurchaseModal`, `SamplingForm`, `harvest-sampling`, `feed-issue`, `health`, `sales`, `CreateCageForm`, all QuickCreate modals | — | **none** (plain `useState`) |

Defects/limits:
- Keys are **not scoped to user, company or location**. On a shared phone a draft (including cage ids of another tenant) survives sign-out and reappears for the next user. Nothing clears these on `signOut` (`contexts/AuthContext.js:94-103`).
- `clearPersistedForm(key)` (`usePersistedForm.js:107-109`) only clears `sessionStorage`; it cannot clear a `local` draft. No callers found, so latent.
- Two tabs on the same key overwrite each other (last debounce wins). Relevant to QR scanning, which tends to open new tabs (doc 11).
- Date defaults are computed **once at module load** (e.g. `HARVEST_DEFAULTS.harvestDate`, `STOCKING_DEFAULTS.stockingDate`, `TRANSFER_DEFAULTS.transferDate`, `emptyPurchase().purchase_date` is fine because it is a function) and with `toISOString()` (UTC). A page left open overnight, or a draft restored from storage, keeps yesterday's date.

### 7.3 Validation patterns

Five distinct styles exist:
1. **Single function returning `[message, lineIndex]`** with an inline `role="alert"` banner and the offending line outlined — `DailyUploadPage.js:314-344, 507-528, 697-699`. Best in the codebase; server errors that start with `Line N` are mapped back to the line (`:450-452`).
2. **Collect-all problems, join into one toast** — `HarvestForm.js:122-177`. Auto-fills derivable values (total from grades, count from total/ABW, FCR from server calc) before validating. Errors are **toast-only** (5 s, bottom of screen), not attached to fields.
3. **First-error `setError` banner + toast** — `FishTransferForm.js:120-152`, `BiweeklyEntryForm.js:105-158`.
4. **Toast-only guard clauses** — `FeedPurchaseModal.js` ("Please add at least one feed entry", "Please fill in all feed entry details").
5. **Native HTML `required`** relied on by most other forms (only `HarvestForm` sets `noValidate`, `:272`). Browser bubbles are not styled, not translated by the app and inconsistent with the custom messages.

No schema validation library; no shared validators between client and Convex `v.*` validators. `Field error` prop exists but is almost never passed (inline per-field errors are rare). Error messages are generally plain-language and actionable (e.g. "Not enough Grower 3mm: 12.0 kg on hand, 40.0 kg needed"), and `cleanError` (`lib/offlineOutbox.js:92-95`) strips Convex stack noise.

### 7.4 Toast API

`components/Toast.js:8-20` accepts both `showToast(message, type)` and `showToast(type, message)` and guesses which is which. 24 files use the `(type, message)` order, the rest the other. Works, but a message that happens to equal `'error'`/`'info'` would be misread. `hooks/useToast.js` (178 lines) is a second, different toast implementation with **0 importers**.

## 8. Component duplication and dead code

| Area | Duplicates | Status / evidence |
|---|---|---|
| Daily entry | `components/DailyUploadPage.js` (919, live, multi-cage batch, offline outbox) vs `components/DailyEntryForm.js` (241, single cage, `api.dailyRecords.create`) | `DailyEntryForm` has **0 importers**. Dead. |
| Bi-weekly entry | `components/BiweeklyEntryForm.js` (376, live via `pages/biweekly-entry.js`) vs `components/BiweeklyForm.js` (`api.biweeklyRecords.create`) | `BiweeklyForm` has 0 importers. Dead. |
| Harvest sampling | `components/SamplingForm.js` inside `/harvest` (`harvestRecordService.addSamplingData`, crate-based) vs `pages/harvest-sampling.js` (`api.harvest.createFromSampling`) | Two live UIs, two different backend paths for a similar task. Confidence Medium that they overlap semantically (business rules in doc 08). |
| Feed purchase create | `FeedPurchaseModal` (one `createPurchase` call per line) vs `QuickCreatePurchaseModal` (`QuickCreateModals.js:809`, `api.feed.createPurchase`) vs inline edit form in `pages/feed-purchases.js:1568` | Three forms. |
| Feed type create | `pages/feed-types.js` add form, `pages/feed-management/index.js` add form, `QuickCreateFeedTypeModal` | Three forms. |
| Supplier create | `pages/feed-suppliers.js`, `pages/feed-management/index.js` | Two. |
| Cage create | `CreateCageForm` (`/create-cage`), `QuickCreateCageModal` | Two. |
| Stocking create | `StockingForm` (`/stocking`), `QuickCreateStockingModal` | Two. |
| Bulk upload | `BulkDailyUploadForm` + `BulkBiweeklyUploadForm` (live on `/bulk-upload`) vs `BulkUploadModal` (732 lines, 0 importers) | Dead modal. |
| Pagination | 4 impls (§5) | `Pagination.js` dead. |
| Confirm dialogs | 3 patterns (§6) | |
| Toasts | `Toast.js` vs `hooks/useToast.js` (dead) | |
| Currency | `lib/money.js` (`formatMoney`/`useMoney`, `Intl.NumberFormat`) vs `lib/currencyUtils.js` + `hooks/useCurrency.js` (static table of 3 currencies) | Two systems reading **different settings** (§13). |
| Other dead code | `components/CageManagementSidebar.js` (0 importers), `contexts/DataContext.js` + `contexts/AnalyticsContext.js` (providers mounted, 0 consumers outside each other), `@phosphor-icons/react`, `store/slices/harvestSlice.js` (never imported) and `store/slices/dailySlice.js` (imported at `store/index.js:10` but left out of `combineReducers`, `:38-45`) | |

Dead code is roughly 2,000+ lines (`BulkUploadModal` 732, `DailyEntryForm` 241, `BiweeklyForm`, `CageManagementSidebar` 192, `Pagination`, `useToast` 178, `DataContext` 115, `AnalyticsContext` 191).

## 9. Giant components (> 500 lines)

| File | Lines | What it mixes |
|---|---|---|
| `pages/feed-purchases.js` | 1,743 | List + filters, 21 `useState`s, 11 imperative service calls, recharts charts, add (via `FeedPurchaseModal`), inline edit dialog form, delete confirm, totals/derived maths, currency labels. |
| `components/QuickCreateModals.js` | 1,122 | Modal shell + 4 complete create flows (cage, feed type, stocking, purchase) with their own `useQuery`s (7) and `useMutation`s (4) and business defaults (`nextCageCode`). |
| `components/DailyUploadPage.js` | 919 | Lookups + offline cache, draft persistence, QR prefill, unit conversion, "same as yesterday", stock check, validation, offline outbox, submit, and all rendering. Cohesive in purpose but untestable as a unit. |
| `pages/feed-management/index.js` | 858 | Feed type CRUD + supplier CRUD + inline pagination + 2 dialogs + `DataTable`. Overlaps `feed-types.js`/`feed-suppliers.js`. |
| `pages/company-settings.js` | 781 | 5 tabs of settings, draft/deep-equal diffing, 5 mutations, 18 unlabeled `Field`s. |
| `pages/stocking-management.js` | 752 | List, filters, dropdown menus, 3 overlays, approval actions. |
| `components/BulkUploadModal.js` | 732 | Dead. |
| `pages/biweekly-records.js` | 728 | Server-paginated list, filters, view dialog, edit form, delete, two tables. |
| `pages/feed-types.js` | 663 | List + add/edit dialogs + delete. |
| `components/HarvestForm.js` | 550 | Form, FCR fetch, auto-fill, validation, preview/confirm step. |
| `components/Dashboard.js` | 545 | 4 data loads, health score maths (`farmHealthScore`, :64), 2 recharts charts, table. |
| `pages/report.js` | 528 | Report maths + local `DataTable`. |
| `pages/sales.js` | 517 | Sales + customer creation + list. |
| `lib/tours/systemWalkthrough.js` | 515 | Tour content (data, acceptable). |
| `components/ui/index.js` | 504 | All primitives in one file (acceptable size, but no per-primitive files). |

Business calculations living inside pages (e.g. `Dashboard.js:64` health score, `pages/biweekly-entry.js` DOC/size categories, `HarvestForm` count/FCR derivation, `report.js` aggregates) duplicate or diverge from server logic; see doc 09 for the calculation audit.

## 10. Loading, error and empty states

| State | Coverage | Evidence |
|---|---|---|
| App-level loading | `AppShellSkeleton` (desktop-only layout) | §2.2 |
| Page loading | Mixed: `DashboardSkeleton` (1 page), "Loading…" text (61 files), spinners/`Loader2` (19 files) | grep counts |
| Empty | `EmptyState` (7 files), `DependencyEmpty` (6 files) — the latter offers "create the missing prerequisite" inline (e.g. no cages → create cage / stock cage; not enough stock → record purchase) | `DailyUploadPage.js:598-611, 852-865` |
| Errors | `role="alert"` banners in 8 files; Layout cage-error banner; elsewhere `console.error` (54 sites) + toast. Many imperative loaders swallow errors into empty lists (e.g. `pages/biweekly-entry.js:37-46` logs and shows "no cages"). | |
| Reactive query `undefined` handling | 17 pages check `=== undefined` for `useQuery` loading | |
| Crash | No error boundary (§3) | |

`DependencyEmpty` is a good pattern worth keeping. The weak spot is errors that look like empty data: an HTTP failure in a one-shot loader usually renders as "No records" rather than "Couldn't load".

## 11. Accessibility

| Area | Finding | Status |
|---|---|---|
| Document language | `<Html lang="en">` (`_document.js:5`) | OK |
| Labels | 48 `Field`s unlinked (§7.1). Inline line inputs in `DailyUploadPage` are properly labelled. | Partial |
| Error association | No `aria-invalid`, no `aria-describedby` from `Field` | Missing |
| Focus visibility | `Button` and most custom controls use `focus-visible:ring`. Global `input:focus` ring at `globals.css:84-90`. Sidebar nav links have no custom focus style (rely on UA outline). `Header.js:255` profile button `focus:outline-none` with no replacement ring. | Mostly OK |
| Keyboard | Drawer/dialogs lack focus trap/Escape (§4, §6). `DataTable` sort headers are clickable `<th>` (not focusable). `TabBar` lacks tab semantics. No skip link. | Partial |
| Live regions | Toasts use `role="status"`/`alert` but are mounted together with their content, which some screen readers do not announce. Confidence Medium. | Partial |
| Colour contrast (computed from tokens) | Text: `--muted` #52525b on white 7.7:1; `--lake` 6.9:1; `--signal` 4.8:1; `--kelp` 5.0:1 — all pass AA. **Non-text**: `--input-border` #d4d4d8 on white **1.48:1**; card borders `--foam-deep` #e4e4e7 **1.27:1**; dark-mode input border on input bg 1.93:1. WCAG 1.4.11 asks 3:1 for input boundaries. Amber-500 (meter "warn") 2.15:1. | Text OK; UI boundaries fail |
| Motion | `prefers-reduced-motion` respected globally (`theme.css:318-330`) | OK |
| Charts | recharts output has no text alternative/table equivalent | Missing |
| Lint | `npx eslint components pages hooks contexts`: 18 `react-hooks/exhaustive-deps` warnings, no jsx-a11y rules enabled beyond Next's defaults | Tooling gap |

## 12. State management (`contexts/`, `store/`)

| Store | Source | Consumers | Notes |
|---|---|---|---|
| `AuthContext` | `useConvexAuth` + `useQuery(api.users.current)` (`AuthContext.js:15-18`) | everywhere | Also pushes the JWT into a module variable for the HTTP client (`setConvexAuthToken`, :23). |
| `CompanySettingsContext` | `useQuery` company settings | Sidebar, `useMoney`, `useCurrency` | Also applies brand + theme to `<html>`. |
| `LocationContext` | `useQuery(api.farmLocations.list)` + `localStorage['pba_active_location_id']` | Header, forms (via `lib/locationScope.js`) | Location switch = full reload. |
| `ThemeContext` | `localStorage['theme']` + `matchMedia` | Header toggle | Second writer of `html.dark` (with CompanySettings). |
| `SettingsContext` | `localStorage['userSettings']` (language `en`, dateFormat `DD/MM/YYYY`, currency `GHS`) | `global-settings.js`, `useCurrency` | `dateFormat` is saved but never applied anywhere (grep). **Implemented but incomplete.** |
| `NotificationContext` | one-shot `notificationService.getNotifications(user.id, 50)` on user change | Header | Not reactive, no polling; new notifications appear only after reload. |
| `DataContext`, `AnalyticsContext` | fetch helpers, no effects | none | Dead (still mounted on every page). |
| Redux (`store/index.js`) | `auth`, `cages`, `biweekly`, `dashboard`, `feed`, `notifications` slices; `redux-persist` to `localStorage` key `root`, whitelist `auth, cages, biweekly, dashboard, feed` | `Layout.js`, `pages/feed-types.js`, `pages/cages/analytics*.js` (3), dead `CageManagementSidebar` | `persistor` is created (:64) but there is no `PersistGate` and **no purge on sign-out** (grep `purge` → none). Persisted `cages.hasFetched=true` means `Layout` will not refetch after reload, and cage data from a previous user/company can be shown on a shared device. Confidence Medium (depends on rehydrate timing). |

Assessment: three overlapping state systems (Convex reactive cache, React contexts, persisted Redux) plus ad-hoc `localStorage` keys (`pbafarm:daily-entry:lookups`, `pbafarm:outbox:daily-batch`, `pbafarm:form:*`, `pba_active_location_id`, `theme`, `userSettings`, LLM keys in `lib/llmClient.js`). None are namespaced by user/company and none are cleared at sign-out.

## 13. Data fetching patterns and staleness

Two transports coexist:

1. **Reactive `useQuery`/`useMutation` (WebSocket, `ConvexReactClient` in `lib/convexClient.js`)** — 27 files use `useQuery`, 15 use `useMutation`: e.g. `pages/sales.js`, `health.js`, `approvals.js`, `audit-logs.js`, `cages/index.js`, `cages/[id].js`, `fish-transfers.js`, `inventory/*`, `pnl.js`, `company-settings.js`, `FishTransferForm`, `StockingForm`, `TopUpForm`, `QuickCreateModals`.
2. **Imperative one-shot calls through `lib/databaseService.js` and sibling services** — 40 files. `getConvexHttpClient()` (`lib/convexBridge.js:38-52`) returns a **new `ConvexHttpClient` per call** with the cached JWT, falling back to the React client only when no token is cached. Used by `DailyUploadPage`, `BiweeklyEntryForm`, `HarvestForm`, `FeedPurchaseModal`, `Dashboard`, `feed-purchases`, `feed-management/*`, `feed-issue`, `harvest`, `harvest-sampling`, `biweekly-records`, `report`, `stock-levels`, `inventory-alerts`, `export`, Redux `cagesSlice`, etc.

Consequences of (2):
- **Stale views.** These screens do not update when another user writes. Example: two workers doing daily entry at once — `loggedCageIds` (`DailyUploadPage.js:142-146`) only refreshes on load, date change and after save, so the second worker sees cages as open and gets a server "already logged" error at save.
- **Refetch-all after writes**: `loadLookups()` reloads all active cages, all feed types and site stock after every save (`:441-443`).
- **Errors become empty states** (§10).
- **Offline semantics differ**: HTTP calls fail immediately with "Failed to fetch" (the outbox relies on this, `lib/offlineOutbox.js:52-58`), whereas `useMutation` calls on the WebSocket client are queued in memory and the promise stays pending — a form on a reactive page shows "Saving…" until reconnect, and the queued write is lost if the tab closes. Confidence Medium (Convex client behaviour, not run).
- **Location scoping is implicit**: `withActiveLocation()` reads `localStorage` at call time (`lib/locationScope.js:10-14`); reactive pages instead rely on whatever the server reads from `users.activeLocationId`. Two sources of truth for "current site".

## 14. i18n readiness

**Status: Completely missing** (no i18n library, no message catalogue, no locale routing; `next.config.mjs` has no `i18n` key; grep for `i18n|useTranslation|next-intl` → none). Specific blockers:

| Concern | Evidence |
|---|---|
| Hard-coded English strings | Every page and component; ~1,600+ JSX text nodes (not counted exactly). Error strings are composed in code (`DailyUploadPage.js:319-341`). |
| Currency | Two systems: `lib/money.js` (`Intl.NumberFormat`, any ISO code, reads `CompanySettingsContext.currency` = `settings.locale.currency || 'GHS'`) used by 7 pages; `lib/currencyUtils.js` + `hooks/useCurrency.js` (static table **GHS, USD, EUR only**, reads company setting then a per-browser `userSettings.currency`) used by 8 files. Hard-coded `₵` in labels: `FeedPurchaseModal.js:357` "Price per bag (₵)", `feed-purchases.js:1631`, `feed-management/index.js:694`, `sales.js:453` "₵/kg", plus copy in `global-settings.js:104`. |
| Dates | 31 sites build "today" with `new Date().toISOString().split('T')[0]` (UTC date, wrong near midnight outside UTC+0); 56 `toLocale*String` calls mostly with the browser default locale, three forced `'en-US'` (`Dashboard.js:48,214`, `stocking-management.js:289`). `SettingsContext.dateFormat` is not applied. `date-fns` is a dependency but used sparingly. No company time zone is read anywhere in the UI (grep `timeZone` → none). |
| Units | `kg`, `g`, `mg/L`, `°C`, `cm`, `m³` hard-coded in labels (189 `kg` occurrences). Bag sizes `PRESETS = [10, 20, 25]` (`BagSizeField.js:3`) and fallback bag size 20 kg (`DailyUploadPage.js:226`). |
| Species/domain assumptions | Harvest size grades hard-coded (`HarvestForm.js` `SIZE_CATEGORIES`: …, `SS 300–400 g`, `SB 200–300 g`, `Rej < 200 g`); stocking species default `nile_tilapia` (`StockingForm.js:30`); cage size categories `<50m³` etc. (`pages/biweekly-entry.js` `getSizeCategory`). |
| Number formatting | Mix of `toFixed`, `toLocaleString()` and `Intl`; decimal separator is always `.` in inputs (`type="number"` handles locale on most mobile keyboards; unverified). |
| RTL | No `dir` handling; physical `ml-`/`mr-`/`left-` classes everywhere. |

## 15. Dark mode

**Status: Implemented and working, with caveats.** Confidence Medium (not viewed).

- Token-driven via `html.dark` / `[data-theme='dark']` (`theme.css:54-80`), Tailwind `dark:` variant bound to the same selectors (`globals.css:5`), plus the `!important` safety net (§2.1).
- **Two writers** of the class: `ThemeContext.js:28-31, 40-43` and `CompanySettingsContext.js` `applyBrandToDocument` (company `branding.themeMode` light/dark/system; a per-browser `localStorage.theme` overrides it, `:63-67`).
- **Flash of light theme** on load: no inline script in `_document.js` sets the class before hydration.
- Theme toggle is hidden on phones (`Header.js:242` `hidden sm:flex`), so phone users only get the company default or OS setting when the company chose "system".
- No high-contrast/"outdoor" theme (relevant to sunlight; doc 11).

## 16. Summary of statuses

| Area | Status | Confidence |
|---|---|---|
| Token system and semantic utilities | Implemented and working | High |
| UI primitives (`components/ui`) | Implemented but incomplete (no Modal, Badge, Checkbox, NumberInput; Field lacks a11y wiring) | High |
| App shell / navigation | Implemented and working; drawer a11y incomplete; nav not configurable | High |
| Loading skeleton on phones | Implemented but potentially defective (desktop layout) | High |
| Tables | Partially implemented (1 shared component used by 3 pages; 21 hand-rolled; no mobile layout) | High |
| Modals | Partially implemented (16 hand-rolled; no focus management) | High |
| Form primitives adoption | Implemented and working (mostly) | High |
| Validation consistency | Partially implemented (5 styles) | High |
| Draft persistence | Implemented but incomplete (not user-scoped; most forms none) | High |
| Error boundary | Completely missing | High |
| `/biweekly-entry?cage=` deep link | Implemented but potentially defective (ignored) | High |
| State management | Implemented but potentially defective (3 systems, persisted Redux never purged) | Medium |
| Data fetching | Implemented and working online; stale by design on 40 files | High |
| i18n / locale / units | Completely missing (currency partially configurable through two systems) | High |
| Dark mode | Implemented and working (with flash and dual writers) | Medium |

## 17. Risks

1. **Cross-user data on shared phones** (drafts, outbox, lookups cache, persisted Redux, active location — none user-scoped or cleared at sign-out). Severity High for multi-tenant SaaS. Overlaps doc 07.
2. **No error boundary** — one bad record that throws during render blanks the whole app. High.
3. **Two data transports** — any refactor must decide per screen; staleness bugs are structural, not local. Medium-High.
4. **Duplicate create flows** (3× purchase, 3× feed type, 2× cage, 2× stocking, 2× sampling) — business rules can drift between them. Medium.
5. **Giant page components** with embedded calculations — hard to test and to reuse in a mobile-first or offline client. Medium.
6. **i18n retrofitting cost** grows with every new screen; currency is already split across two systems that read different settings. Medium.
7. **Modal accessibility** — failure on keyboard/screen reader use; also an enterprise procurement risk (WCAG). Medium.

## 18. Outstanding questions

1. Are `tailwind.config.js` and the `@tailwindcss/forms`/`typography`/`aspect-ratio` plugins meant to be active? Nothing in `styles/` loads them under Tailwind v4.
2. Which harvest sampling flow is canonical: `SamplingForm` on `/harvest` or `/harvest-sampling`? (doc 08 owner)
3. Should currency be per company only (as `lib/money.js` assumes) or overridable per browser (as `useCurrency` allows)?
4. Is the dead code (`DailyEntryForm`, `BiweeklyForm`, `BulkUploadModal`, `CageManagementSidebar`, `Pagination`, `hooks/useToast`, `DataContext`, `AnalyticsContext`, `harvestSlice`, Phosphor) safe to delete? Nothing imports it on this branch; confirm no external branch depends on it.
5. Is the Redux store still wanted at all, given 5 live consumers and the Convex reactive cache?
