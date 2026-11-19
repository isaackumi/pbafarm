# Route & component coverage

Every route in `pages/` and every shared UI component maps to a Paper artboard (file **PBA Farm — Redesign**, `01M7RD5Z2VX87M2KSRH9YKX8XA`) or to a named **pattern**. The build agent works through this list top to bottom and ticks each row in its PR. If a row is ambiguous, ask the designer and don't improvise.

Artboard ids are listed in [HANDOFF.md §3](./HANDOFF.md). Patterns are defined at the bottom of this file.

Status: `[ ]` not started · `[~]` in progress · `[x]` built and matches Paper (dark + light).

## Phase 0: foundation (must land first)

| | Item | Source |
|---|---|---|
| [ ] | Design tokens as CSS variables, dark default plus `[data-theme="light"]` | HANDOFF §2, §3b |
| [ ] | Inter font, radii (card 24, control 999, inner 14), shadows | HANDOFF §2 |
| [ ] | Primitives: Card, KPI strip, Tabs, Pill (6 tones), Status dot, Table, GradientButton, GhostButton, Toggle, Checkbox cell, Avatar, SearchField, Segmented, Progress bar, Sparkline | Shell 7Z-0, 01, 22, 28 |
| [ ] | `components/Layout.js`, `Sidebar.js`, `Header.js` (workspace switcher, feed cover, nav with Production sub-nav, search ⌘K, bell, avatar) | 7Z-0 |
| [ ] | Settings sub-nav (Company, Farm sites, Members, Roles & permissions, Access policies, Audit log, Automations, API keys, Billing) | 22 / 23 / 31 |
| [ ] | Theme toggle (user menu), persisted per user | 3b |
| [ ] | `MobileTabBar.js` uses tokens only (no mobile artboard yet) | pattern P-MOBILE |

## Phase 1: routes

| | Route | Artboard / pattern |
|---|---|---|
| [ ] | `/` | Website Landing 3I0-0 |
| [ ] | `/login` | 15 / 15b |
| [ ] | `/signup`, `/verify`, `/verify-email`, `/reset-password`, `/invite/[token]` | P-AUTH (15 layout) |
| [ ] | `/register-company`, `/create-cage` | 16 Onboarding (stepper) |
| [ ] | `/dashboard` | 01 Home |
| [ ] | `/tasks` | 12 My tasks |
| [ ] | `/cages`, `/units`, `/units/groups` | 02 Cages |
| [ ] | `/units/map` | 02 header and filters + full-width map card (P-LIST) |
| [ ] | `/cages/[id]`, `/batches/[id]` | 03 Cage detail (batch adds the 26 timeline) |
| [ ] | `/units/[id]/water` | 03 tab + 07 |
| [ ] | `/units/[id]/maintenance`, `/maintenance` | 03 tab + 27 (checklist/findings rows) |
| [ ] | `/cages/settings`, `/species` | P-SETTINGS |
| [ ] | `/cages/qr-codes`, `/scan` | 26 label card · P-MOBILE |
| [ ] | `/cages/analytics`, `/cages/analytics/growth` | 05 |
| [ ] | `/cages/analytics/harvest` | 08 |
| [ ] | `/daily-entry`, `/daily-data`, `/water-entry`, `/inspection-entry` | 04 Daily entry |
| [ ] | `/bulk-upload` | 04 + P-UPLOAD |
| [ ] | `/biweekly-entry`, `/biweekly-records` | 05 |
| [ ] | `/stocking`, `/stocking-management`, `/stocking/[id]/details`, `/fish-transfers`, `/topup`, `/topup/[id]/details` | 06 (detail = 25 detail panel) |
| [ ] | `/pending-approval` | redirect only, keep |
| [ ] | `/approvals` | 25 |
| [ ] | `/health`, `/water-quality` | 07 |
| [ ] | `/harvest`, `/harvest-sampling`, `/grading` | 08 |
| [ ] | `/trace`, `/trace/[lotId]` | 26 |
| [ ] | `/hatchery`, `/hatchery/broodstock`, `/hatchery/broodstock/[id]`, `/hatchery/larval`, `/hatchery/live-feed`, `/hatchery/spawning` | 13 |
| [ ] | `/feed-management`, `/feed-management/overview`, `/feed-management/analytics`, `/feed-issue`, `/feed-types`, `/feeding-plans`, `/stock-levels` | 09 |
| [ ] | `/inventory/overview`, `/inventory/items`, `/inventory/lots`, `/inventory/counts`, `/inventory/adjust`, `/inventory/analytics`, `/inventory-transactions` | 09 + P-LIST |
| [ ] | `/inventory-alerts` | 30 feed list |
| [ ] | `/procurement`, `/feed-purchases`, `/feed-suppliers` | 29 |
| [ ] | `/sales`, `/invoices/[id]` | 24 |
| [ ] | `/pnl` | 10 |
| [ ] | `/expenses`, `/accounting-export` | 19 |
| [ ] | `/reports`, `/report`, `/reports/regions`, `/group-reports`, `/analytics` | 11 |
| [ ] | `/export` | 31 "Download my data" row + P-SETTINGS |
| [ ] | `/compliance` | 27 |
| [ ] | `/sensors` | 28 |
| [ ] | `/automations` | 21 + `automation-flow.html` (motion) |
| [ ] | `/notifications` | 30 |
| [ ] | `/messaging-settings`, `/outbox` | 30 delivery matrix · 30 feed list |
| [ ] | `/users`, `/teams`, `/workforce` | 14 Team + 23 Member access |
| [ ] | `/organization-structure`, `/farm-locations`, `/company-settings` | P-SETTINGS (23 scope chips) |
| [ ] | `/customization` | 32 |
| [ ] | `/account` | 31 |
| [ ] | `/ai-settings` | P-SETTINGS (31 rows) |
| [ ] | `/api-keys`, `/webhooks`, `/inbound-webhooks`, `/api-docs` | P-SETTINGS + P-LIST |
| [ ] | `/audit-logs` | P-LIST + 23 access history rows |
| [ ] | `/admin/admin`, `/admin/company-registrations`, `/global-settings` | P-SETTINGS · 25 queue |
| [ ] | `/404`, `_error` | P-SYSTEM |

## Phase 2: shared components

| | Component | Artboard / pattern |
|---|---|---|
| [ ] | `AiAssistant.js` (drawer + full page) | 17 |
| [ ] | `RolesPanel.js` | 22 |
| [ ] | `MembersPanel.js`, `UserManagement.js`, `PersonPicker.js` | 23 / 14 |
| [ ] | `AuthenticatorApp.js`, `DataPrivacyCard.js`, `AccountDeletionCard.js`, `NotificationPreferencesCard.js` | 31 / 30 |
| [ ] | `CustomFields.js`, `FormLayout.js`, `customization/*` | 32 |
| [ ] | All entry forms (`StockingForm`, `FishTransferForm`, `MultiTransferForm`, `TopUpForm`, `HarvestForm`, `GradingForm`, `SamplingForm`, `WaterQualityForm`, `InspectionForm`, `BiweeklyEntryForm`, `CreateCageForm`, `EquipmentForm`, `FeedPurchaseModal`) | 04 form pattern |
| [ ] | `CsvImportForm`, `BulkDailyUploadForm`, `BulkBiweeklyUploadForm`, `DailyUploadPage` | P-UPLOAD |
| [ ] | `DataTable.js`, `SiteKpiTable.js` | Table primitive |
| [ ] | Modals: `ConfirmDeleteModal`, `LogoutConfirmationModal`, `SignOutOutboxDialog`, `CageManageModals`, `QuickCreateModals` | P-MODAL |
| [ ] | `Toast.js`, `AppUpdatePrompt.js`, `ActAs.js` banner, `OutboxSync` indicator | P-FEEDBACK |
| [ ] | `QueryBoundary`, `ErrorBoundary`, `DependencyEmpty` | P-SYSTEM |
| [ ] | `BatchTrace`, `BatchHistory`, `InspectionHistory` | 26 timeline |
| [ ] | `Dashboard.js`, `DashboardInsights.js`, `dashboard/*`, `charts/*` | 01 (chart styling from 01 / 10) |
| [ ] | `UnitTabs`, `UnitProfile`, `Waterline`, `SiteConditions` | 03 / 28 |
| [ ] | `TourProvider` (walkthrough popovers) | P-MODAL styling |
| [ ] | `HumanCheck`, `LanguageSwitcher`, `QrScanner` | P-AUTH / P-MOBILE |

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
