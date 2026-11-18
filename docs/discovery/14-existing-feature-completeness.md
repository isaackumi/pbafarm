# 14 — Existing Feature Completeness

Discovery stage: completeness roll-up for PART 4 (inventory). It feeds PART 13 (gap analysis). Branch `docs/discovery`, 2026-11-18. Docs only.

## Stage header

**Objective.** Classify every discovered feature, plus every domain the owner's brief names, using the fixed status vocabulary. Each row carries a confidence level and file:line evidence. List explicitly what is completely missing.

**Files inspected.** Everything listed in doc 02 (all `pages/`, `components/`, `contexts/`, `lib/`, `store/`, `convex/*.ts`, `convex/lib/*.ts`). The test files `convex/growth.test.ts`, `convex/harvest.test.ts`, `convex/reminders.test.ts`, `convex/siteStock.test.ts` and `convex/lib/fishTransferLogic.test.ts` were noted as coverage evidence but not run by this agent.

**Findings.** The matrices below.

**Dependencies.** Docs 02 and 03 (route evidence), 07 (auth), 08/09 (calculation correctness: rows here defer to them for formula accuracy).

**Risks.**
- Status is assigned from reading code, not from running the app. "Implemented and working" means the code path is complete end to end (UI → mutation → tables) and no defect was found while reading it. It does not mean it was observed working in production.
- Confidence: **High** = the full path was traced; **Medium** = the main path was traced but there are edge cases or formulas not verified; **Low** = inferred.

**Outstanding questions.** Listed at the end.

**Completion status.** Complete.

**Status vocabulary** (exactly as required): Implemented and working · Implemented but incomplete · Implemented but potentially defective · Partially implemented · Planned but not implemented · Completely missing · Unknown – requires verification.

---

## 1. Domain matrix (the brief's domains)

| Domain | Status | Conf. | What exists | What is missing or wrong | Evidence |
|---|---|---|---|---|---|
| **Farm / organisation** | Implemented but incomplete | High | Companies with pending → approved registration by super_admin; multiple farm sites per company (`farmLocations`) with a header switcher; per-company settings using draft → publish; branding and logo | No farm hierarchy below site (zones, blocks); no farm profile page; companyless users fall back to "unscoped rows" (`convex/lib/tenancy.ts:12-17`); `/admin/admin` view/edit/create routes do not exist | `convex/companies.ts:217-467`, `convex/farmLocations.ts:28-195`, `components/Header.js:111-145`, `pages/admin/admin.js:130-150` |
| **Pond** | Completely missing | High | — | No pond, tank, raceway or hatchery entity; `cages` is the only culture-unit table | grep `pond\|tank\|hatchery` in `convex/`, `pages/`, `components/`: only one seed string |
| **Cage** | Implemented but potentially defective | High | CRUD, status, capacity, size, species, location; detail page with current-cycle growth; QR labels | Edit/delete shown to non-admins although the backend is admin-only; four inconsistent "ready to harvest" rules; `/cages/analytics/harvest` always empty; statuses `harvesting`/`fallow` are manual only | `convex/cages.ts:8-15,160-295`, `pages/cages/index.js:62-64`, `pages/cages/analytics.js:139`, `store/slices/cagesSlice.js:35-52` |
| **Stock (stocking, top-up, transfer)** | Implemented and working | High | Stocking with batch numbers, species and supervisors; optional approval; rule checks (status, ABW range, capacity, density); top-ups against approved stockings; partial or full fish transfers with approval; approvals queue | Top-up has no nav entry or history list; approvers are not notified; edit/delete of stockings not role-gated in the UI | `convex/stocking.ts:224-660`, `convex/lib/farmRules.ts:209-276`, `convex/fishTransfers.ts:194-440`, `pages/approvals.js`, `convex/lib/fishTransferLogic.test.ts` |
| **Feeding** | Implemented but potentially defective | Medium | Multi-cage daily feed entry in kg or bags with an atomic batch, feed-type stock deduction through the ledger, admin negative-stock override with a reason, an offline outbox; a separate store → cage "feed issue" | Issue and daily entry both deduct stock with no link between them (double-count risk); daily feed cost uses the list price, not lot cost; no feeding plan, feed table or ration recommendation; growth/eFCR counts daily-entry feed only | `convex/dailyRecords.ts:37-83,365-442`, `convex/feed.ts:609-720`, `components/DailyUploadPage.js:346-450`, `convex/lib/growth.ts:83-89` |
| **Mortality** | Implemented but incomplete | High | Daily mortality per cage with cause; cage count decremented; daily and cumulative threshold alerts to admins; dashboard chart; report rows; P&L cause breakdown | Daily records cannot be corrected (no edit/delete UI); bulk upload skips alerts; no mortality-event workflow (photos, disposal) | `convex/dailyRecords.ts:254-317,581-642`, `components/Dashboard.js:191-217`, `convex/reports.ts:488-495` |
| **Water quality** | Partially implemented | High | Optional DO and temperature on daily entry; DO, temperature and Secchi on bi-weekly entry; stored on `dailyRecords`/`biweeklyRecords` | Never displayed, charted, exported, reported or alerted; no pH, ammonia, nitrite or other parameters; no thresholds; no sensor integration | `components/DailyUploadPage.js:410-411`, `components/BiweeklyEntryForm.js:121-125`; grep of `pages/` and `convex/reports.ts` for `dissolved\|temperature\|secchi` finds nothing |
| **Sampling (growth)** | Implemented and working | High | Bi-weekly multi-sample ABW entry; weighted ABW; cage ABW sync; records list with edit and (admin) delete; CSV bulk import; per-cage cycle growth (ABW, biomass, eFCR, SGR, ADG, survival) | `?cage=` deep link ignored; client-side pagination over the full list; delete not gated in the UI | `convex/biweeklyRecords.ts:64-260`, `convex/lib/growth.ts`, `pages/cages/[id].js:25-90`, `convex/growth.test.ts` |
| **Sampling (harvest)** | Implemented but potentially defective | High | `SamplingForm` on `/harvest` writes `harvestSampling`; `/harvest-sampling` records weight and size grades | `/harvest-sampling` creates a completed harvest with fixed FCR 1.5 and no cage update; recorded harvest samples are never displayed (`harvest.listSampling` has no caller) | `convex/harvest.ts:347-460` (esp. `:408`), `pages/harvest-sampling.js:79` |
| **Harvest** | Implemented but incomplete | High | Partial or complete harvest; cage count/status update and stocking cycle close; undo on edit/delete; FCR suggestion; DOC/ABW/FCR warnings against company rules; CSV export | Withdrawal periods not enforced; delete not gated in the UI; contaminated by `/harvest-sampling` records | `convex/harvest.ts:107-345`, `convex/lib/farmRules.ts:278-310`, `convex/harvest.test.ts` |
| **Inventory** | Implemented but incomplete | High | Feed-only inventory: purchases create lots; a ledger of transactions; FIFO lot deduction; adjustments; inter-site transfers; reversals; stock levels; tally reconciliation; low-stock alerts; lots view; analytics | Only feed (no medicines, nets, fuel, fingerlings, spares); most inventory pages ignore the active site; no stock count / cycle count workflow; no purchase orders | `convex/inventory.ts:75-520`, `convex/lib/feedLedger.ts:35-200`, `pages/stock-levels.js:35-36`, `convex/siteStock.test.ts` |
| **Expenses** | Completely missing | High | — | No expense, cost-centre, labour, fuel or overhead model. P&L is sales minus daily feed cost, as the page itself states | grep `expense\|invoice\|payroll` finds nothing; `pages/pnl.js:69` |
| **Reports** | Implemented but incomplete | High | Production report (5 types) with print and JSON; XLSX export of daily, biweekly, harvest, cages and stocking; cage P&L; dashboard KPIs; feed, inventory and cage analytics pages | "Financial summary" is feed cost only; export is company-wide (ignores the site); no PDF/XLSX on `/report`; no scheduled or emailed reports; several analytics are client-side heuristics | `convex/reports.ts:187-512,571-700`, `pages/report.js:174-178`, `pages/export.js:44-70` |
| **Users** | Implemented but incomplete | High | Admin creates users with a temporary password and forced change; role change user/admin; deactivate/reactivate; self password change | No location assignment UI (`users.locationIds` unused in the UI); invite flow has backend but no UI; no forgot or reset password; no email verification; only 3 roles; no profile edit | `convex/users.ts:48-336`, `convex/userAccounts.ts:18-120`, `components/UserManagement.js`, `pages/_app.js:77` |
| **Settings** | Implemented and working | High | Company settings: branding, farm rules, stocking rules, feed rules, currency (GHS/USD/EUR), AI toggle, logo upload; draft → publish with validation; rules enforced in the backend | `targetFcr` stored but unused; `/global-settings` duplicates the currency setting | `pages/company-settings.js`, `convex/companies.ts:599-840`, `convex/lib/farmRules.ts:6-207` |
| **Notifications** | Partially implemented | High | In-app notifications: mortality threshold alerts; a daily 16:00 UTC cron for missed entries and low stock (de-duplicated); header bell with mark read / mark all read | No email, SMS or push; no notifications page; the list is not live (loaded once per user change); no approval-request notifications; delete not exposed | `convex/crons.ts:8-13`, `convex/reminders.ts:16-140`, `contexts/NotificationContext.js:15-23`, `convex/reminders.test.ts` |

---

## 2. Feature matrix (all discovered features)

| # | Feature | Status | Conf. | Evidence | Notes |
|---|---|---|---|---|---|
| 1 | Email/password sign-in | Implemented and working | High | `contexts/AuthContext.js:58-69`, `convex/auth.ts` | `@convex-dev/auth` Password provider |
| 2 | Self sign-up | Implemented but incomplete | High | `pages/signup.js:47`, `convex/auth.ts:13` | Lands on the dashboard with no company and no guidance to `/register-company` |
| 3 | Forgot / reset password | Completely missing | High | `pages/_app.js:77` lists `/reset-password`; no page file | |
| 4 | Email verification | Completely missing | High | `/verify-email` listed, no page | |
| 5 | Google / SSO sign-in | Planned but not implemented | High | `AuthContext.js:85-92` stub | |
| 6 | Forced password change | Implemented and working | High | `pages/_app.js:95-102`, `pages/account.js:25-40` | |
| 7 | Client route guard by role | Implemented and working | High | `components/ProtectedRoute.js` | Several Sidebar items disagree with page guards (doc 02 §15) |
| 8 | Company registration and approval | Implemented and working | High | `convex/companies.ts:217-430`, `pages/admin/company-registrations.js` | |
| 9 | Super-admin company admin console | Implemented but potentially defective | High | `pages/admin/admin.js:130-150` | Links to missing routes; "Delete" = reject |
| 10 | Multi-site (farm locations) | Implemented but incomplete | Medium | `convex/farmLocations.ts`, `contexts/LocationContext.js`, `lib/locationScope.js` | Scoping is inconsistent across pages (inventory, export, feed overview are company-wide) |
| 11 | Company branding (logo, name, accent, theme) | Implemented and working | High | `pages/company-settings.js`, `contexts/CompanySettingsContext.js` | |
| 12 | Currency selection | Implemented and working | High | `convex/schema.ts` `locale.currency`, `hooks/useCurrency.js` | GHS/USD/EUR only |
| 13 | Multi-language / i18n | Completely missing | High | No i18n library or `useTranslation`; all strings are hard-coded English | `locale` holds currency only |
| 14 | Dashboard KPIs and charts | Implemented but incomplete | High | `components/Dashboard.js:65-188` | Client heuristic health score; "stocked" biomass, not current; FCR polluted by row 47 (harvest sampling) |
| 15 | Cage CRUD | Implemented but potentially defective | High | `convex/cages.ts:160-295`; ungated UI actions | |
| 16 | Cage detail and cycle growth | Implemented and working | Medium | `pages/cages/[id].js`, `convex/lib/growth.ts` | Formula review in doc 09; top-ups not in `stocked_count` |
| 17 | Cage analytics (status/size/readiness) | Implemented but incomplete | High | `pages/cages/analytics.js` | Hard-coded 120-day threshold |
| 18 | Cage growth analytics | Implemented but potentially defective | Medium | `pages/cages/analytics/growth.js` | Mixes biomass and ABW fields |
| 19 | Cage harvest-readiness analytics | Implemented but potentially defective | High | `store/slices/cagesSlice.js:35-52` | Always empty |
| 20 | Cage QR labels → daily entry deep link | Implemented and working | High | `pages/cages/qr-codes.js:21-31`, `components/DailyUploadPage.js:189-200` | No in-app scanner; relies on the phone camera |
| 21 | Stocking with approval and rules | Implemented and working | High | `convex/stocking.ts:224-300`, `convex/lib/farmRules.ts:209-243` | |
| 22 | Batch number suggestion | Implemented and working | High | `convex/stocking.ts:26,300` | |
| 23 | Stocking edit/delete | Implemented but potentially defective | High | `pages/stocking-management.js:211,269`; backend admin | Ungated UI |
| 24 | Top-up | Implemented and working | High | `convex/stocking.ts:490-630`, `pages/topup.js` | Not in nav; no history list |
| 25 | Fish transfer between cages | Implemented and working | High | `convex/fishTransfers.ts`, `convex/lib/fishTransferLogic.test.ts` | |
| 26 | Approvals queue | Implemented and working | High | `pages/approvals.js`, `convex/stocking.ts:632-660` | No notifications to approvers |
| 27 | Species tracking | Implemented but incomplete | Medium | `lib/fishSpecies.js`, `cages.species`, `stockingHistory.species` | 5 hard-coded species; no species-specific parameters |
| 28 | Daily multi-cage entry | Implemented and working | High | `components/DailyUploadPage.js`, `convex/dailyRecords.ts:365-442` | |
| 29 | Daily record correction (view/edit/delete) | Completely missing (UI) | High | Backend `dailyRecords.update/remove` (`:444,550`) has no UI caller | Backend done, UI missing |
| 30 | Offline capture (outbox) | Partially implemented | High | `lib/offlineOutbox.js`, `public/sw.js` | Daily entry only |
| 31 | Bulk CSV upload (daily/biweekly) | Implemented but potentially defective | High | `convex/dailyRecords.ts:581-642`, `components/BulkDailyUploadForm.js` | Silent skips, no alerts or audit, naive CSV, backend not admin-only |
| 32 | Bi-weekly sampling entry | Implemented and working | High | `convex/biweeklyRecords.ts:64-135` | |
| 33 | Bi-weekly records management | Implemented but potentially defective | High | `pages/biweekly-records.js:451` | Ungated delete; client-side pagination |
| 34 | Mortality capture and cause | Implemented and working | High | `convex/dailyRecords.ts:254-266` | |
| 35 | Mortality threshold alerts | Implemented and working | Medium | `convex/dailyRecords.ts:268-317` | Full `users` table scan |
| 36 | Water quality capture | Partially implemented | High | see domain matrix | Never read back |
| 37 | Fish health / treatments | Implemented but incomplete | High | `convex/health.ts`, `pages/health.js` | |
| 38 | Withdrawal period enforcement | Partially implemented | High | Computed in `convex/health.ts:151`, not checked in `harvest.ts`/`sales.ts` | Displayed only |
| 39 | Feed types | Implemented but potentially defective | High | `convex/feed.ts:221-335`, `pages/feed-types.js` | Admin-only create, UI ungated; duplicated on `/feed-management` |
| 40 | Feed suppliers | Implemented and working | High | `convex/feed.ts:133-220` | Delete ungated (admin backend) |
| 41 | Feed purchases → lots | Implemented and working | High | `convex/feed.ts:362-575`, `convex/lib/feedLedger.ts:35` | Edit/void ungated |
| 42 | Feed issue (store → cage) | Unknown – requires verification | Medium | `convex/feed.ts:709` | Works mechanically; overlap with daily feed undefined |
| 43 | Feed ledger, stock levels, tally | Implemented and working | High | `convex/lib/feedLedger.ts`, `convex/inventory.ts:75-520` | |
| 44 | Stock adjustment and inter-site transfer | Implemented and working | High | `convex/inventory.ts:197-350`, `pages/inventory/adjust.js` | Sidebar shows it to non-admins |
| 45 | Low-stock alerts (page and cron) | Implemented and working | High | `convex/inventory.ts:435`, `convex/reminders.ts:25-70` | Page is company-wide |
| 46 | Harvest recording | Implemented but incomplete | High | `convex/harvest.ts:206-345` | |
| 47 | Harvest sampling | Implemented but potentially defective | High | `convex/harvest.ts:386-450` | Fixed FCR 1.5; no cage update; samples never listed |
| 48 | Sales and customers | Implemented but incomplete | High | `convex/sales.ts`, `pages/sales.js` | No sale edit (payment status frozen); no invoicing |
| 49 | Cage P&L | Implemented but incomplete | High | `convex/reports.ts:571-700` | Feed cost only on the cost side |
| 50 | Expenses / cost tracking | Completely missing | High | — | |
| 51 | Production reports | Implemented but incomplete | High | `convex/reports.ts:377-512` | "Financial" = feed cost |
| 52 | Excel export | Implemented but incomplete | High | `pages/export.js` | Company-wide; few datasets |
| 53 | Audit log viewer | Implemented and working | High | `convex/audit.ts`, `pages/audit-logs.js` | Not every write is audited |
| 54 | User management | Implemented but incomplete | High | `components/UserManagement.js`, `convex/userAccounts.ts` | No site assignment; invite UI missing |
| 55 | Invite flow | Partially implemented | High | `convex/users.ts:136,252` (`invite`, `claimInvite`) | No UI to send invites |
| 56 | Company settings (draft/publish) | Implemented and working | High | `convex/companies.ts:617-760` | |
| 57 | In-app notifications | Partially implemented | High | see domain matrix | |
| 58 | Email / SMS / push notifications | Completely missing | High | No mail or SMS provider; no push subscription code (grep `pushManager` returns nothing) | |
| 59 | Scheduled reminders (cron) | Implemented and working | High | `convex/crons.ts`, `convex/reminders.test.ts` | Fixed 16:00 UTC for all companies |
| 60 | AI assistant (read-only chat) | Implemented and working | Medium | `components/AiAssistant.js`, `pages/api/llm/chat.js` | Keys may be exposed in the browser (`lib/llmEnv.js:13-18`) |
| 61 | Guided product tour | Implemented and working | Medium | `components/TourProvider.js`, `lib/tours` | |
| 62 | Dark mode / theming | Implemented and working | High | `contexts/ThemeContext.js` | |
| 63 | Demo data seeding | Implemented but potentially defective | High | `convex/seed.ts:5-18` | Public mutation callable by any signed-in user; no UI |
| 64 | Install as app (PWA) | Implemented but incomplete | Medium | `public/manifest.webmanifest`, `public/sw.js`, `_app.js:28-37` | Covered in doc 11 |
| 65 | Printing | Implemented and working | Medium | `print:hidden` shell classes; `/report` print; `/cages/qr-codes` print | |

---

## 3. Completely missing (explicit list)

Each item below was searched for in `convex/`, `pages/`, `components/` and `lib/` and found absent.

| Capability | Search evidence |
|---|---|
| Ponds, tanks, raceways, RAS units | No table or route; grep `pond\|tank` returns nothing |
| Hatchery / broodstock / fingerling production | grep `hatchery\|broodstock` matches only a seed string |
| Expenses, cost centres, labour, overheads, budgets | grep `expense\|payroll\|budget` returns nothing; P&L disclaims it (`pages/pnl.js:69`) |
| Invoicing, receipts, payments ledger, accounts receivable | `sales.paymentStatus` exists but cannot be updated in the UI; no invoice entity |
| Non-feed inventory (drugs, chemicals, nets, equipment, fuel) | `inventory.ts` operates on `feedTypes` only; `/inventory/items` redirects to `/feed-types` |
| Purchase orders / procurement workflow | Purchases are recorded after the fact only |
| Feeding plans, feed tables, ration calculation | No table or function |
| Water-quality dashboards, thresholds, extended parameters (pH, NH3, NO2) | No reads of the captured fields |
| Sensor / IoT integration | No HTTP ingest besides auth (`convex/http.ts`) |
| Daily record correction UI | Backend exists, UI missing |
| Multi-language / localisation of UI text | No i18n library |
| Email, SMS, WhatsApp, push notifications | No provider integration |
| Password reset and email verification | Routes declared, pages absent |
| Per-location user permissions UI | `users.locationIds` is never edited by the UI |
| Fine-grained roles (e.g. supervisor, viewer, accountant) | Only `user`/`admin`/`super_admin` (`convex/lib/authz.ts:19-28`) |
| Traceability (batch → harvest → sale chain report) | Links exist (`sales.harvestId`, `harvestRecords.cageId`, stocking batch) but no traceability view |
| Scheduled / emailed reports | None |
| Public API, webhooks, third-party integrations (accounting, ERP) | None besides LLM providers |

## 4. Summary counts (section 2, 65 features)

| Status | Count |
|---|---|
| Implemented and working | 29 |
| Implemented but incomplete | 13 |
| Implemented but potentially defective | 10 |
| Partially implemented | 5 |
| Planned but not implemented | 1 |
| Completely missing | 6 (row 29 is a missing UI over a complete backend) |
| Unknown – requires verification | 1 |

Total: 65. "Completely missing" rows: 3, 4, 13, 29, 50, 58.

## Outstanding questions

1. Feed issue vs daily feed: are they alternative workflows or complementary ones? This decides whether row 42 is a defect.
2. `cages.currentWeight` semantics (ABW vs biomass): this decides whether row 18 is a defect.
3. Is `/harvest-sampling` meant to create a harvest at all?
4. Should water-quality capture be expanded, or dropped from the forms, until there is a consumer?
5. None of the "working" statuses has been confirmed against a running deployment.
