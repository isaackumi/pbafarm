# Route & component coverage

Every route in `pages/` and every shared UI component maps to a Paper artboard (file **PBA Farm — Redesign**, `01M7RD5Z2VX87M2KSRH9YKX8XA`) or to a named **pattern**. The build agent works through this list top to bottom and ticks each row in its PR. If a row is ambiguous, ask the designer and don't improvise.

Artboard ids are listed in [HANDOFF.md §3](./HANDOFF.md). Patterns are defined at the bottom of this file.

Brand: the product is now **Anowa** (logo on Paper page `p-5-0`, artboard EMT-0). The Paper file keeps its original title.

Status: `[ ]` not started · `[~]` in progress · `[x]` built and matches Paper (dark + light).

## Phase 0: foundation (must land first)

| | Item | Source |
|---|---|---|
| [x] | Design tokens as CSS variables, dark default plus `[data-theme="light"]` | HANDOFF §2, §3b |
| [x] | Inter font, radii (card 24, control 999, inner 14), shadows | HANDOFF §2 |
| [x] | Primitives: Card, KPI strip, Tabs, Pill (6 tones), Status dot, Table, GradientButton, GhostButton, Toggle, Checkbox cell, Avatar, SearchField, Segmented, Progress bar, Sparkline | Shell 7Z-0, 01, 22, 28 |
| [x] | `components/Layout.js`, `Sidebar.js`, `Header.js` (workspace switcher, feed cover, nav with Production sub-nav, search ⌘K, bell, avatar) | 7Z-0 |
| [x] | Settings sub-nav (Company, Farm sites, Members, Roles & permissions, Access policies, Audit log, Automations, API keys, Billing) — `components/SettingsNav.js`; Access policies and Billing hidden until their routes exist | 22 / 23 / 31 |
| [x] | Theme toggle (user menu), persisted per user (per device via localStorage for now) | 3b |
| [x] | `MobileTabBar.js` uses tokens only (no mobile artboard yet) | pattern P-MOBILE |

## Phase 1: routes

| | Route | Artboard / pattern |
|---|---|---|
| [x] | `/` | Website Landing 3I0-0 |
| [x] | `/login` | 15 / 15b |
| [x] | `/signup`, `/verify`, `/verify-email`, `/reset-password`, `/invite/[token]` | P-AUTH (15 layout) |
| [x] | `/register-company`, `/create-cage` | 16 Onboarding (stepper) |
| [x] | `/dashboard` | 01 Home |
| [x] | `/tasks` | 12 My tasks |
| [x] | `/cages`, `/units`, `/units/groups` | 02 Cages |
| [x] | `/units/map` | 02 header and filters + full-width map card (P-LIST) |
| [x] | `/cages/[id]`, `/batches/[id]` | 03 Cage detail (batch adds the 26 timeline) |
| [x] | `/units/[id]/water` | 03 tab + 07 |
| [x] | `/units/[id]/maintenance`, `/maintenance` | 03 tab + 27 (checklist/findings rows) |
| [x] | `/cages/settings`, `/species` | P-SETTINGS |
| [x] | `/cages/qr-codes`, `/scan` | 26 label card · P-MOBILE |
| [x] | `/cages/analytics`, `/cages/analytics/growth` | 05 |
| [x] | `/cages/analytics/harvest` | 08 |
| [x] | `/daily-entry`, `/daily-data`, `/water-entry`, `/inspection-entry` | 04 Daily entry |
| [x] | `/bulk-upload` | 04 + P-UPLOAD |
| [x] | `/biweekly-entry`, `/biweekly-records` | 05 |
| [x] | `/stocking`, `/stocking-management`, `/stocking/[id]/details`, `/fish-transfers`, `/topup`, `/topup/[id]/details` | 06 (detail = 25 detail panel) |
| [x] | `/pending-approval` | redirect only, keep |
| [x] | `/approvals` | 25 |
| [x] | `/health`, `/water-quality` | 07 |
| [x] | `/harvest`, `/harvest-sampling`, `/grading` | 08 |
| [x] | `/trace`, `/trace/[lotId]` | 26 |
| [x] | `/hatchery`, `/hatchery/broodstock`, `/hatchery/broodstock/[id]`, `/hatchery/larval`, `/hatchery/live-feed`, `/hatchery/spawning` | 13 |
| [x] | `/feed-management`, `/feed-management/overview`, `/feed-management/analytics`, `/feed-issue`, `/feed-types`, `/feeding-plans`, `/stock-levels` | 09 |
| [x] | `/inventory/overview`, `/inventory/items`, `/inventory/lots`, `/inventory/counts`, `/inventory/adjust`, `/inventory/analytics`, `/inventory-transactions` | 09 + P-LIST |
| [x] | `/inventory-alerts` | 30 feed list |
| [x] | `/procurement`, `/feed-purchases`, `/feed-suppliers` | 29 |
| [x] | `/sales`, `/invoices/[id]` | 24 |
| [x] | `/pnl` | 10 |
| [x] | `/expenses`, `/accounting-export` | 19 |
| [x] | `/reports`, `/report`, `/reports/regions`, `/group-reports`, `/analytics` | 11 |
| [x] | `/export` | 31 "Download my data" row + P-SETTINGS |
| [x] | `/compliance` | 27 |
| [x] | `/sensors` | 28 |
| [x] | `/automations` | 21 + `automation-flow.html` (motion) |
| [x] | `/notifications` | 30 |
| [x] | `/messaging-settings`, `/outbox` | 30 delivery matrix · 30 feed list |
| [x] | `/users`, `/teams`, `/workforce` | 14 Team + 23 Member access |
| [x] | `/organization-structure`, `/farm-locations`, `/company-settings` | P-SETTINGS (23 scope chips) |
| [x] | `/customization` | 32 |
| [x] | `/account` | 31 |
| [x] | `/ai-settings` | P-SETTINGS (31 rows) |
| [x] | `/api-keys`, `/webhooks`, `/inbound-webhooks`, `/api-docs` | P-SETTINGS + P-LIST |
| [x] | `/audit-logs` | P-LIST + 23 access history rows |
| [x] | `/admin/admin`, `/admin/company-registrations`, `/global-settings` | P-SETTINGS · 25 queue |
| [x] | `/404`, `_error` | P-SYSTEM |
| [x] | `/calendar` | 18 Calendar |
| [x] | `/assistant` (`?chat=<id>`, `?view=saved`) | 47 Ask Anowa — Expanded PJ0-0 · 47b model menu POM-0 (page "Anowa app · Console, bot & AI"); compact bubble stays 17 |
| [x] | `/alerts`, `/weekly-report` | 30 feed list · 11 |
| [x] | `/billing`, `/suspended` | P-SETTINGS · P-SYSTEM |
| [x] | `/platform`, `/platform/tenants`, `/platform/tenants/[id]`, `/platform/admins`, `/platform/audit`, `/platform/billing`, `/platform/usage` | Platform console (P-LIST + P-SETTINGS) |
| [ ] | Projects (tasks grouped by cycle) | 20 Projects 4HK-0 — not built; no route yet |

## Phase 2: shared components

| | Component | Artboard / pattern |
|---|---|---|
| [x] | `AiAssistant.js` (drawer + full page) | 17 |
| [x] | `RolesPanel.js` | 22 |
| [x] | `MembersPanel.js`, `UserManagement.js`, `PersonPicker.js` | 23 / 14 |
| [x] | `AuthenticatorApp.js`, `DataPrivacyCard.js`, `AccountDeletionCard.js`, `NotificationPreferencesCard.js` | 31 / 30 |
| [x] | `CustomFields.js`, `FormLayout.js`, `customization/*` | 32 |
| [x] | All entry forms (`StockingForm`, `FishTransferForm`, `MultiTransferForm`, `TopUpForm`, `HarvestForm`, `GradingForm`, `SamplingForm`, `WaterQualityForm`, `InspectionForm`, `BiweeklyEntryForm`, `CreateCageForm`, `EquipmentForm`, `FeedPurchaseModal`) | 04 form pattern |
| [x] | `CsvImportForm`, `BulkDailyUploadForm`, `BulkBiweeklyUploadForm`, `DailyUploadPage` | P-UPLOAD |
| [x] | `DataTable.js`, `SiteKpiTable.js` | Table primitive |
| [x] | Modals: `ConfirmDeleteModal`, `LogoutConfirmationModal`, `SignOutOutboxDialog`, `CageManageModals`, `QuickCreateModals` | P-MODAL |
| [x] | `Toast.js`, `AppUpdatePrompt.js`, `ActAs.js` banner, `OutboxSync` indicator | P-FEEDBACK |
| [x] | `QueryBoundary`, `ErrorBoundary`, `DependencyEmpty` | P-SYSTEM |
| [x] | `BatchTrace`, `BatchHistory`, `InspectionHistory` | 26 timeline |
| [x] | `Dashboard.js`, `DashboardInsights.js`, `dashboard/*`, `charts/*` | 01 (chart styling from 01 / 10) |
| [x] | `UnitTabs`, `UnitProfile`, `Waterline`, `SiteConditions` | 03 / 28 |
| [x] | `TourProvider` (walkthrough popovers; styling lives in `styles/tour.css`) | P-MODAL styling |
| [x] | `HumanCheck`, `LanguageSwitcher`, `QrScanner` (the unused `dark` variant of `LanguageSwitcher` still has legacy zinc classes) | P-AUTH / P-MOBILE |

Audit 2026-11-19 (Anowa rebrand PR): every ticked row was checked against `pages/`/`components/` on `main` after redesign PRs #97–#103. Each file exists and was rebuilt in those PRs or renders only through `components/ui` primitives and token aliases (`FormLayout`, `EquipmentForm`, `QueryBoundary`, the bulk-upload wrappers, `TourProvider`). Known leftovers: `/cages/qr-codes` keeps `bg-white`/`text-black` on the printable label on purpose, and `/company-settings` uses zinc swatches to preview nav contrast.

## Patterns

Build patterns from the primitives. Don't add new visual language.

- **P-LIST:** page header (eyebrow + H1 + up to two gradient buttons) → KPI strip (optional) → Table card with title, filter tabs and search (see 24 Sales).
- **P-SETTINGS:** settings sub-nav on the left (200px) + stacked cards of `label / helper / control` rows (see 31 Account, 22 Roles).
- **P-AUTH:** 15 Sign in split layout. Form on the left, lake scene on the right. Same input, segmented and button styles.
- **P-UPLOAD:** dashed-border drop zone in a card, then a validation table with Pill status per row, then a sticky "Import n rows" button.
- **P-MODAL:** surface-2 panel, radius 24, 28px padding, title 20/600, footer actions right-aligned (ghost + solid gradient). Backdrop is `#000` at 60% (light: `#101828` at 30%).
- **P-FEEDBACK:** toast is a pill-shaped surface-2 with a status dot. Act-as banner is a full-width pink-outline strip above the header.
- **P-SYSTEM:** centered card on bg with a large muted icon, H1, one sentence and one gradient button. Skeletons use surface-2 blocks with radius 14.
- **P-MOBILE:** same tokens. Bottom tab bar is surface with active pill = button colour. Full-width touch targets ≥ 44px.

When a pattern route turns out to need a bespoke layout, the build agent stops and asks. The designer then adds an artboard in Paper and logs it in `DESIGN-CHANGELOG.md`.
