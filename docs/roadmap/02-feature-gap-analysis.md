# 02 — Feature Gap Analysis

Date: 2026-11-18. Compares what exists (discovery docs 01–14, branch `docs/discovery`, plus `main` as verified on GitHub) with the target in MASTER-PROMPT PART 10 A–J. Format required by PART 13.

## How to read this

**Existing Status** uses PART 13's vocabulary:
- **Complete** — works end to end; no defect found in discovery.
- **Partial** — some of it exists; real gaps remain.
- **Needs refactoring** — exists but is defective or structurally wrong for the target (data integrity, tenancy, scale).
- **Missing** — searched for and absent.
- **Requires investigation** — behaviour or intent unknown; blocked on an owner answer or a live-data check.

**Priority:** P0 = Phase 0 stabilization (fix before anything new) · P1 = foundational, needed by many later features · P2 = core product enhancement · P3 = later / enterprise.

**Class:** **F** = foundational (other features depend on it, or it fixes integrity/security) · **E** = enhancement (adds value, nothing structural depends on it).

**Dependencies** name tracker IDs from `docs/project-management/MASTER-TRACKER.md`.

Evidence references use `docNN §section` for `docs/discovery/NN-*.md`.

---

## 0. Platform foundations (cross-cutting, not listed in PART 10 but required by all of it)

| Feature | Existing Status | Required Changes | Dependencies | Priority | Class | Evidence |
|---|---|---|---|---|---|---|
| Authentication (email + password) | Complete | Keep; add reset + verification (below) | — | — | F | doc07 §2.1, doc13 §2 |
| Deactivation / offboarding enforced | Needs refactoring | Reject `active === false` in guard; delete `authSessions` on deactivate | SEC-001 | P0 | F | doc07 X1 (`convex/lib/authz.ts:7-17`, `convex/users.ts:210-231`) |
| Company status enforced (pending/rejected/removed) | Needs refactoring | Guard refuses non-approved companies | SEC-001 | P0 | F | doc07 X2 |
| No shared "company-less" data pool | Needs refactoring | Company-less users get no tenant data and cannot write; quarantine legacy rows | SEC-001, M1 | P0 | F | doc07 X3, doc04 F1 (`convex/lib/tenancy.ts:18-27`) |
| Ownership checks on referenced ids | Needs refactoring | `assertOwns` on `feedTypeId`, `supplierId`, `customerId`, `cageId`, location ids, storage ids | SEC-002 | P0 | F | doc07 V1, V11, V14; doc04 F2 |
| Platform-wide mutations restricted | Needs refactoring | `backfillLocations` → internal; `seed.seedDemo` → internal; `notifications.create/createBulk` → internal | SEC-002 | P0 | F | doc07 V4, V7; doc12 §5.3 |
| Password reset, email verification | Missing | Convex Auth `reset`/`verify` with an email provider | INT-002 | P1 | F | doc07 §2.1, doc13 §2 |
| Invitation safety (token, expiry, acceptance) | Needs refactoring | Pending membership + signed expiring token; never re-point existing users | ORG-003, SEC-003 | P0 (V2) / P1 | F | doc07 V2, V3, V13 |
| Tenant-scoped indexed reads, pagination | Needs refactoring | Replace 57 full scans; fix truncated `take(N)` windows | PLAT-001 | P0 | F | doc12 §6.1–6.2, doc04 F7, F8 |
| Production + staging deployments, backups | Missing | New prod + staging Convex deployments; restore drill | OPS-001 | P0 | F | doc12 §7–8, doc01 R1 |
| Error handling (`ConvexError`, boundary, monitoring) | Missing | `ConvexError` codes; React error boundary; Sentry-class monitoring; Convex log stream | OPS-001 | P0 | F | doc12 §5b–5d |
| CI gates (lint source, tests incl. `convex/lib`, typecheck) | Partial | Fix vitest glob; lint gating on source; typecheck tests; tests before Convex deploy | OPS-002 | P0 | F | doc12 §3–4, §7 |
| Migration framework | Missing | Adopt `@convex-dev/migrations` (or equivalent) with batched, resumable jobs | PLAT-004 | P1 | F | doc04 F3 (`backfillLocations` single transaction) |
| Return validators, no `any` ctx | Needs refactoring | Add `returns` to 148 exports progressively; remove `any` | PLAT-003 | P2 | F | doc04 F12, F22 |

## A. Organization and enterprise management

| Feature | Existing Status | Required Changes | Dependencies | Priority | Class | Evidence |
|---|---|---|---|---|---|---|
| Organization registration | Partial | Keep `companies.register` + approve; add self-service onboarding path from sign-up, status page for submitters, code squatting limits | SEC-001, ORG-004 | P1 | F | doc07 §2.2, doc14 row 8 |
| Organization profiles | Partial | Extend `companies` with country, timezone, unit system, address; profile page | ORG-005 | P1 | F | doc04 §3.2 |
| Multiple orgs per user (memberships) | Missing | `memberships` table + backfill + switcher (D-002) | SEC-001, PLAT-004 | P1 | F | doc07 §3.6 |
| Business units | Missing | Optional `businessUnits` between company and sites | ORG-001, FARM-001 | P3 | E | doc14 §3 |
| Subsidiaries | Missing | Parent/child `companies` link + consolidated views | ENT-001 | P3 | E | — |
| Regions | Missing | Region grouping of sites (same mechanism as business units) | ENT-001 | P3 | E | — |
| Locations / farms / facilities | Partial | `farmLocations` extended with `siteType`, `timezone`, coordinates, water body | FARM-001 | P1 | F | doc04 §3.5, doc13 §26 |
| Multiple farms per organization | Complete (mechanics) / Needs refactoring (scoping) | Make every page honour the active site; enforce site scope on reads | FARM-003, PERM-004 | P1 | F | doc14 row 10; doc02 KF12 |
| Cross-location operations | Partial | Fish transfers between sites through the engine; feed inter-site transfer two-legged | PROD-006, INV-002 | P2 | F | doc08 §6.3, §9 |
| User invitations | Needs refactoring | Backend exists (`users.invite`, `claimInvite`) but unsafe and has no UI | ORG-003 | P1 | F | doc07 §3.5, doc14 row 55 |
| Teams / departments | Missing | `teams` with members; used by tasks and notifications | PERM-001 | P3 | E | — |
| Roles | Partial | 3 roles → role templates + custom roles | PERM-001, PERM-003 | P1 | F | doc07 §3.1 |
| Granular permissions | Missing | Permission catalog + `requireMember` | PERM-001, PERM-002 | P1 | F | doc07 §3.4, V9 |
| Site-level access | Partial (inert) | `memberships.locationScope`, enforced on reads and writes | PERM-004 | P1 | F | doc07 §3.3 |
| Audit logs | Partial | Close gaps (F20), audit platform-admin actions under tenant, retention, tamper evidence later | ORG-008, TRACE-007 | P2 | F | doc04 F20, doc07 §4.3 |
| Organization settings | Complete | Keep draft → publish; replace `v.any()` draft with a validator | PLAT-003 | P2 | E | doc14 row 56, doc04 F12 |
| Per-org configuration without forks | Partial | Settings exist; extend to terminology, species, grades, fields (D-007, D-012) | CUSTOM-001, I18N-001 | P2 | F | doc08 §12 |
| Super-admin console | Needs refactoring | Fix links to missing routes; "Delete" = reject; audited act-as mode | ORG-006 | P2 | E | doc02 KF6, doc07 §3.8 |

## B. Production management

### Hatchery

| Feature | Existing Status | Required Changes | Dependencies | Priority | Class | Evidence |
|---|---|---|---|---|---|---|
| Broodstock | Missing | `broodstock` (individuals or groups) on hatchery units | FARM-002, PROD-001 | P2 | E | doc14 §3 |
| Breeding / spawning | Missing | Spawning events linked to broodstock | HAT-001 | P2 | E | doc14 §3 |
| Egg collection, incubation, hatching | Missing | Hatchery event types producing a `batches` row (`origin: hatched`) | HAT-002, PROD-002 | P2 | E | — |
| Larval rearing | Missing | Daily records on `hatchery_tank` units | HAT-002 | P2 | E | — |
| Live feed | Missing | Live-feed culture log; feed items in generic inventory | INV-001 | P3 | E | — |
| Fingerling production | Missing | Output counts as `stock_in` events of new batches | PROD-002 | P2 | E | — |
| Nursery transfers | Missing | Engine transfer between units/sites | PROD-006 | P2 | E | — |

### Nursery

| Feature | Existing Status | Required Changes | Dependencies | Priority | Class | Evidence |
|---|---|---|---|---|---|---|
| Fingerling receiving | Partial | Stocking exists for cages; add supplier, cost, health certificate | PROD-002, INV-004 | P2 | E | doc08 §3 |
| Acclimatization | Missing | Checklist / event on receiving | CUSTOM-001 | P3 | E | — |
| Stocking | Needs refactoring | Engine-backed; fix overwrite on approval | PROD-000, PROD-004 | P0→P1 | F | doc09 S9 |
| Grading | Missing | `grading_split` event producing child batches | PROD-006 | P2 | E | doc08 §1 |
| Feeding, mortality, sampling, growth | Partial | Reuse daily/biweekly flows on nursery units | FARM-002 | P2 | E | doc14 domain matrix |
| Transfers | Needs refactoring | Engine transfers | PROD-006 | P1 | F | doc09 S1–S3 |
| Fingerling sales | Missing | Sales by count, not only kg | INV-009 | P3 | E | doc08 §10 |

### Cage management

| Feature | Existing Status | Required Changes | Dependencies | Priority | Class | Evidence |
|---|---|---|---|---|---|---|
| Water bodies | Missing | `waterBody` on `farmLocations` (or small table) | FARM-001 | P2 | E | doc13 §26 |
| Sites | Partial | See A | FARM-001 | P1 | F | doc04 §3.5 |
| Cage groups | Missing | Optional `unitGroup` on units | FARM-002 | P2 | E | — |
| Individual cages (CRUD) | Needs refactoring | UI shows admin actions to all; hard delete orphans children → soft delete/archive | SEC-002, PROD-013 | P0/P1 | F | doc14 row 15, doc04 F11 |
| GPS coordinates | Missing | Optional lat/long on units and sites | FARM-001, CAGE-001 | P2 | E | doc13 §26 |
| Cage dimensions | Partial | `size` (m³), `dimensions` text → typed dims | FARM-002 | P2 | E | doc04 §3.6 |
| Stocking | Needs refactoring | Approval overwrite (S9), cycle copy drift | PROD-000, PROD-004 | P0 | F | doc08 §3, doc09 S9 |
| Feeding | Needs refactoring | Issue vs daily double deduction (S14); list price not lot cost | PROD-000, INV-006 | P0/P2 | F | doc09 S14, §2.5 |
| Sampling | Complete (entry) / Needs refactoring (ABW carry-over, units mix) | Reset ABW on restock (S7); single unit for totals | PROD-000, PROD-008 | P0 | F | doc08 §7, doc09 S7, X4 |
| Mortality | Needs refactoring | Clamp loses information; edits cross cycles (S4, S8); alert definitions | PROD-000, PROD-004 | P0 | F | doc08 §5, doc09 S8 |
| Biomass | Needs refactoring | One growth service; credit transfers/harvests | PROD-008 | P1 | F | doc09 §2.1 |
| Net inspection | Missing | Inspection log per unit | CAGE-002 | P2 | E | — |
| Maintenance | Partial | Only `lastMaintenanceDate`/`nextMaintenanceDate` fields | CAGE-002 | P2 | E | doc04 §3.6 |
| Harvesting | Needs refactoring | S5, S6, S12; withdrawal not enforced | PROD-000, PROD-012 | P0 | F | doc09 S5, S6, S12; doc02 KF8 |
| Cage status lifecycle | Needs refactoring | No state machine; any user changes status | PROD-013, SEC-002 | P1 | F | doc08 §2 |

### Pond management

| Feature | Existing Status | Required Changes | Dependencies | Priority | Class | Evidence |
|---|---|---|---|---|---|---|
| Pond profiles, dimensions, capacity | Missing | `unitType: 'pond'` + `areaM2`, `depthM` | FARM-002 | P2 | E | doc14 §1 "Pond" |
| Water management | Missing | Water exchange / fill / drain events | POND-002 | P2 | E | — |
| Stocking, feeding, sampling, mortality | Missing (for ponds) | Reuse cage flows once `unitType` exists | FARM-002, PROD-004 | P2 | E | — |
| Treatments | Partial | `healthTreatments` exists for cages | POND-002 | P2 | E | doc14 row 37 |
| Harvest | Missing (for ponds) | Reuse engine harvest; partial seine harvests | PROD-004 | P2 | E | — |

### Tank and RAS

| Feature | Existing Status | Required Changes | Dependencies | Priority | Class | Evidence |
|---|---|---|---|---|---|---|
| Tanks, raceways | Missing | `unitType: 'tank' | 'raceway'` | FARM-002 | P2 | E | doc14 §3 |
| Water circulation, filtration, pumps, biofilters, oxygenation | Missing | `equipment` registry linked to units/systems | RAS-002 | P3 | E | — |
| Sensors | Missing | Ingestion endpoint + readings table | INT-007 | P3 | E | doc13 §28 |
| Water quality | Partial | DO/temp/Secchi captured, never read back; add parameters, thresholds, charts, alerts | PROD-014 | P2 | E | doc14 domain matrix "Water quality" |
| Equipment monitoring | Missing | Equipment status + maintenance tasks | RAS-002, AUTO-005 | P3 | E | — |

## C. Shared production engine

| Feature | Existing Status | Required Changes | Dependencies | Priority | Class | Evidence |
|---|---|---|---|---|---|---|
| Batch creation | Partial | `stockingHistory` = cycle; add `batches` (D-004) | PROD-001 | P1 | F | doc08 §1 |
| Parent-child lineage | Partial | One hop via `fishTransfers`; add `parentBatchIds` | PROD-001 | P1 | F | doc08 §1 "Lineage" |
| Batch splitting | Partial | One transfer per destination, no grouping → `grading_split` / multi-destination transfer | PROD-006 | P1 | F | doc08 §9 |
| Batch merging | Partial | Top-up only, no ABW/biomass blend → `merge` event | PROD-006 | P2 | F | doc08 §1 |
| Stock movements ledger | Missing | `stockEvents` append-only (D-004) | PROD-002 | P1 | F | doc04 F6, doc08 §15 |
| Transfers between units | Needs refactoring | Double count S2/S3; no correction S1 | PROD-000, PROD-006, PROD-007 | P0/P1 | F | doc09 S1–S3 |
| Transfers between farms | Partial | Works if cages are in different sites; no site-level validation or in-transit state | PROD-006 | P2 | E | doc04 §3.20 |
| Partial harvesting | Partial | Works for count; FCR suggestion wrong for partials; undo crosses cycles (S6) | PROD-000, PROD-009 | P0/P1 | F | doc09 §2.2, S6 |
| Mortality | Needs refactoring | Event-based, cycle-scoped | PROD-004 | P1 | F | doc09 S4, S8 |
| Stock reconciliation | Missing | Nightly Σevents vs `currentCount`; physical count adjustments | PROD-005 | P1 | F | doc08 §15 |
| Complete event history | Missing | Ledger + "as of date" queries | PROD-002 | P1 | F | doc08 §15 |
| One KPI service (FCR, survival, mortality, growth, DOC) | Needs refactoring | 4 FCRs, 4 mortality %, 4 growth/day definitions → one | PROD-008 | P1 | F | doc09 §3 X1–X10 |

## D. Customization engine

| Feature | Existing Status | Required Changes | Dependencies | Priority | Class | Evidence |
|---|---|---|---|---|---|---|
| Custom fields | Missing | `customFieldDefs` + `custom` values (D-007) | PERM-002 | P2 | F | doc14 §3 |
| Custom forms / layouts | Missing | Form layout documents; one renderer | CUSTOM-001 | P2 | E | — |
| Custom terminology | Missing | `terminology` overrides (Cage→Pond, etc.) | CUSTOM-003 | P2 | F | D-003 |
| Custom dashboards | Missing | Dashboard layout documents over rollups | PLAT-002, CUSTOM-005 | P3 | E | — |
| Custom reports | Missing | Saved report definitions over rollups | ANLY-001 | P3 | E | — |
| Custom navigation | Missing | Configurable sidebar/bottom bar (39-item drawer today) | UX-004 | P2 | E | doc11 §10 #7 |
| Custom workflows | Partial | Approval toggles for stocking/top-up/transfer exist in settings | AUTO-002 | P3 | E | doc08 §12 |
| Custom validation, conditional fields, defaults, required | Missing | Part of `customFieldDefs` | CUSTOM-001 | P2 | E | — |
| Organization branding / themes | Complete | Keep; ensure contrast for outdoor use | UX-006 | — | E | doc14 rows 11, 62 |
| User preferences | Partial | `SettingsContext` per browser in localStorage, not per user | CUSTOM-007 | P3 | E | doc01 §3 |

## E. Automation engine

| Feature | Existing Status | Required Changes | Dependencies | Priority | Class | Evidence |
|---|---|---|---|---|---|---|
| Event triggers | Missing | Domain events outbox from engine | AUTO-001, PROD-002 | P2 | F | doc12 §10 |
| Conditions / actions | Missing | `automationRules` (D-008) | AUTO-002 | P2 | E | — |
| Scheduled automations | Partial | One fixed cron, 16:00 UTC, one transaction | PLAT-001, AUTO-007 | P1 | F | doc13 §5, doc12 §6.2 |
| Recurring tasks | Missing | `tasks` + recurrence | AUTO-005 | P3 | E | — |
| Notifications (in-app) | Partial | Not reactive; only reminders + mortality alerts produce them | AUTO-003 | P2 | E | doc13 §6 |
| Notifications (email/SMS/WhatsApp/push) | Missing | Adapters (D-009) | INT-001, INT-002 | P2 | E | doc13 §7–10 |
| Approval workflows | Partial | Stocking/top-up/transfer approvals; no notification, no segregation of duties | PERM-005, AUTO-004 | P2 | E | doc07 §3.7 |
| Escalations | Missing | Rule action with delay | AUTO-002 | P3 | E | — |
| Webhooks (outbound) | Missing | Subscriptions + signed delivery | INT-005 | P3 | E | doc13 §14 |
| Execution history, retries | Missing | `automationRuns`; workpool | AUTO-002 | P2 | E | doc12 §10 |
| Automation templates | Missing | Seeded rule templates | AUTO-006 | P3 | E | — |

## F. Integration platform

| Feature | Existing Status | Required Changes | Dependencies | Priority | Class | Evidence |
|---|---|---|---|---|---|---|
| Credential protection | Missing (store) / Needs refactoring (LLM keys in localStorage) | Encrypted per-org store, write-only UI | INT-001 | P2 | F | doc13 gap summary, doc12 §5.1 |
| SMS (BYO credentials) | Missing | Adapter: Hubtel / Africa's Talking / Twilio | INT-001, INT-002 | P2 | E | doc13 §8 |
| Email (BYO + platform) | Missing | Platform email for auth; BYO later | INT-002 | P1 (auth) / P2 | F | doc13 §7 |
| WhatsApp | Missing | Cloud API adapter + template approval + webhook | INT-002, INT-003 | P2 | E | doc13 §9 |
| API keys / public API | Missing | Hashed org API keys, scopes, rate limits | INT-004 | P3 | E | doc13 §14 |
| Webhook endpoints (inbound) | Missing | Signed `httpAction` receivers | INT-003 | P3 | E | doc13 §13 |
| Weather | Missing | Provider + site coordinates | FARM-001, INT-006 | P3 | E | doc13 §27 |
| IoT devices | Missing | Device registry + ingestion | INT-007 | P3 | E | doc13 §28 |
| Accounting | Missing | Export / sync of sales, purchases, expenses | INV-007, INT-008 | P3 | E | doc13 §29 |
| LLM gateway hardening | Needs refactoring | Rate limit, model allow-list, size cap, role gate | SEC-004 | P1 | F | doc07 V10, doc13 §11 |

## G. Business management

| Feature | Existing Status | Required Changes | Dependencies | Priority | Class | Evidence |
|---|---|---|---|---|---|---|
| Inventory (generic items) | Missing | Feed-only today; add item types (drugs, chemicals, nets, fuel, spares) | INV-001 | P2 | F | doc14 §3 |
| Warehouses | Partial | Sites act as stores for feed lots | INV-001 | P2 | E | doc08 §6.2 |
| Feed management | Complete (core) / Needs refactoring (site, reversal) | Site on every movement, two-legged transfers, reversal linkage (S13, S15) | PROD-000 (S13), INV-002, INV-003 | P0/P1 | F | doc08 §6.3, doc09 S13, S15 |
| Feeding plans, ration tables | Missing | Feed tables per species/size; daily ration suggestion | PROD-015 | P3 | E | doc14 §3 |
| Procurement / purchase orders | Missing | PO → receipt → lot | INV-004 | P3 | E | doc14 §3 |
| Suppliers | Complete (feed) | Extend to all item types | INV-001 | P2 | E | doc14 row 40 |
| Expenses | Missing | `expenses` with categories, cost centres (site/unit/batch) | INV-007 | P2 | F | doc14 row 50, doc08 §14 |
| Costing (cost per kg, per batch) | Missing | Lot costing + expenses + fingerling cost per batch | INV-006, INV-008, PROD-002 | P2 | F | doc09 §2.5 |
| Revenue / harvest sales | Partial | Sales exist; edit/payment update has no UI; per-cycle attribution missing | INV-009 | P2 | E | doc08 §10, doc02 KF9 |
| Customers | Partial | CRUD exists; `updateCustomer` no UI caller | INV-009 | P3 | E | doc06 §3 |
| Invoices | Missing | Invoice + payments received | INV-009 | P3 | E | doc14 §3 |
| Asset management, maintenance | Missing | Asset registry + maintenance log | INV-012, CAGE-002 | P3 | E | — |
| Workforce | Missing | Staff records beyond `users` | ENT-004 | P3 | E | — |
| Tasks | Missing | Task assignment + recurrence | AUTO-005 | P3 | E | — |

## H. Traceability and compliance

| Feature | Existing Status | Required Changes | Dependencies | Priority | Class | Evidence |
|---|---|---|---|---|---|---|
| Batch genealogy | Partial (one hop) | Walk `parentBatchIds` | PROD-001, TRACE-001 | P2 | E | doc08 §1 |
| Feed traceability | Partial | Lot → site exists; lot → unit/batch missing | INV-002, TRACE-002 | P3 | E | doc08 §6 |
| Treatment history | Partial | `healthTreatments` exists | TRACE-003 | P2 | E | doc14 row 37 |
| Withdrawal enforcement | Partial (displayed only) | Block/warn harvest and sale inside withdrawal | PROD-012 | P1 | F | doc02 KF8, doc14 row 38 |
| Supplier traceability | Partial | Feed supplier on purchase; fingerling source is free text | TRACE-002 | P3 | E | doc04 F13 |
| Harvest lot tracking, dispatch | Missing | Harvest lots + dispatch notes | TRACE-004 | P3 | E | doc14 §3 |
| Customer tracking | Partial | `sales.customerId` | TRACE-004 | P3 | E | doc08 §10 |
| Audit records | Partial | See A | ORG-008, TRACE-007 | P2 | F | doc04 F20 |
| Biosecurity, compliance templates | Missing | Checklists via custom forms | CUSTOM-004, TRACE-006 | P3 | E | — |
| Document management | Missing | Attachments (Convex storage) with type/size validation | TRACE-005 | P3 | E | doc12 §9 |

## I. Analytics and intelligence

| Feature | Existing Status | Required Changes | Dependencies | Priority | Class | Evidence |
|---|---|---|---|---|---|---|
| Production dashboards | Needs refactoring | Full scans; heuristics; KPIs polluted by fake harvests | PLAT-001, PLAT-002, PROD-008 | P0/P1 | F | doc12 §6.1, doc14 row 14 |
| Farm comparisons | Missing | Per-site rollups | PLAT-002, ANLY-002 | P3 | E | — |
| Feed efficiency (FCR) | Needs refactoring | One FCR definition set | PROD-008, PROD-009 | P1 | F | doc09 §2.2 |
| Biomass, survival, mortality, growth | Needs refactoring | One KPI service, event-based | PROD-008 | P1 | F | doc09 §2.3–2.4 |
| Harvest forecasting | Missing | Growth model per species | ANLY-003 | P3 | E | — |
| Cost per kg, profitability | Missing | Requires expenses + costing | INV-008 | P3 | E | doc09 §2.5 |
| Predictive analytics | Missing | After rollups and history exist | ANLY-003 | P3 | E | — |
| AI assistant | Needs refactoring | Works read-only; cost/abuse controls missing; reads all tenants | SEC-004, PLAT-001, ANLY-005 | P1 / P3 | E | doc13 §11 |
| Sensor analytics | Missing | After INT-007 | ANLY-006 | P3 | E | — |
| Reports / export | Partial | Site scoping, CSV option bug, scheduled reports | FARM-003, ANLY-007 | P2 | E | doc13 §19, doc14 row 52 |

## J. Global support

| Feature | Existing Status | Required Changes | Dependencies | Priority | Class | Evidence |
|---|---|---|---|---|---|---|
| Multiple currencies | Partial | GHS/USD/EUR per company; no FX | I18N-003 | P2 | E | doc14 row 12, doc13 §31 |
| Multiple languages | Missing | Formatting helpers now; library when first locale committed | I18N-002 | P3 | E | doc14 row 13 |
| Time zones | Missing | Org/site timezone for "today", DOC, reminders | I18N-001, FARM-001 | P1 | F | doc12 §6.4 |
| Localization (number/date formats) | Missing | `lib` helpers | I18N-001 | P2 | F | doc10 §14 |
| Measurement systems | Missing | Unit system per org; conversions in helpers | I18N-001 | P2 | E | — |
| Species configuration | Partial | 5 hard-coded species → per-org species with parameters | PROD-010 | P2 | F | doc08 §1 "Species" |
| Harvest size grades | Partial | Free-form `v.any()` → per-org grade master | PROD-010 | P2 | E | doc08 §8 |
| Country-specific settings, regional compliance | Complete (I18N-004) | Country presets for profile defaults; country/language checklist packs | I18N-004 | P3 | E | — |
| International organizations | Missing | Subsidiaries in other countries | ENT-001, I18N-003 | P3 | E | — |

---

## 1. Existing functionality worth preserving

These work and the target architecture builds on them rather than replacing them.

| What | Why keep | Evidence |
|---|---|---|
| Multi-cage daily entry (`components/DailyUploadPage.js`) with "same as yesterday", line-level validation and the offline outbox pattern | Best field flow in the app; the pattern to generalize | doc11 §4.1, doc10 §7.3 |
| `dailyRecords.createBatch` atomic batch with per-line errors | Correct transactional shape | `convex/dailyRecords.ts:365-442` |
| Feed ledger (`convex/lib/feedLedger.ts`): signed append-only transactions, lots, FIFO, per-site check, `stockTally` | Model for the fish `stockEvents` ledger | doc08 §6.2, `convex/siteStock.test.ts` |
| `convex/lib/growth.ts` helpers (biomass, FCR, SGR, ADG, day count) | Correct formulas; becomes the KPI service once inputs are event-based | doc09 §1 C1–C5 |
| Farm rules (`convex/lib/farmRules.ts`) + company settings draft → publish | Server-enforced, per-org config already | doc08 §12 |
| Approval workflow states on stocking / top-up / transfer | Business process the farm uses | doc07 §3.7 |
| Company registration + super-admin approval | Tenant onboarding gate | doc07 §2.2 |
| `auditLogs` via `logAudit` (66 of 76 mutations) | Foundation for compliance | doc06 §3 |
| Reminders cron with dedupe keys (`notifications.by_dedupe`) | Correct dedupe idea; needs fan-out | doc13 §5 |
| QR labels → daily entry deep link | Cheap, effective field shortcut | doc14 row 20 |
| In-house UI primitives (`components/ui/index.js`) and token layer (`styles/theme.css`) | Single design system after PR #14 | doc10 §2 |

## 2. Existing functionality requiring improvement

| What | Problem | Tracker |
|---|---|---|
| `requireUser` / `listForCompany` | No active/company-status checks; shared pool; in-memory filtering | SEC-001, PERM-002, PLAT-001 |
| Harvest edit/delete undo | S5 (Critical), S6 | PROD-000 |
| Daily-record edit/delete (now with UI from PR #7) | S8 cross-cycle deltas | PROD-000 |
| Stocking/top-up approval | S2, S3, S9 | PROD-000 |
| `/harvest-sampling` | Writes complete harvests, FCR 1.5, ABW in kg | PROD-000 |
| Feed issue vs daily feed | Double deduction | PROD-000 (+ owner answer) |
| Feed reversals / purchase edit/void / inter-site transfer | Site-less movements, repeatable reversal | PROD-000 (S13), INV-002, INV-003 |
| Reports and dashboard | Full scans; inconsistent KPIs | PLAT-001, PROD-008 |
| Reminders cron | One transaction; cross-tenant `take` windows; UTC | PLAT-001, AUTO-007 |
| Offline outbox | Not per-user; no idempotency; daily only; cold start | MOBILE-001, MOBILE-002 |
| Notifications | Not reactive | AUTO-003 |
| Users & invites | No site assignment UI; unsafe invites; no reset | ORG-003, PERM-004, SEC-005 |
| Client data layer | Two transports; Redux-persist cache of server data | UX-002 |
| Bulk CSV import | Naive parser, silent skips, no alerts/audit | MOBILE-009 |

## 3. Missing foundational capabilities

Ordered by dependency:

1. Enforced access (active user, approved company, no shared pool) — SEC-001.
2. Structural tenant isolation (indexed reads, ownership checks) — SEC-002, PLAT-001.
3. Production/staging separation, backups, error handling — OPS-001.
4. Migration framework — PLAT-004.
5. Memberships and a central permission guard — ORG-001, PERM-001, PERM-002.
6. Site metadata (type, timezone, coordinates) and production unit type — FARM-001, FARM-002.
7. Batches and the stock event ledger — PROD-001, PROD-002.
8. One KPI service — PROD-008.
9. Rollup tables — PLAT-002.
10. Server-side idempotency for field writes — MOBILE-002.
11. Domain events outbox — AUTO-001.
12. Encrypted credentials + email provider (for reset/verification/invites) — INT-001, INT-002.

## 4. Features that can be added without restructuring

Low-risk additions on today's schema (each still follows Rule 3 in its PR):

- Daily-record correction UI (done in PR #7; needs S8 fix).
- Sale edit / payment status update UI over existing `sales.updateSale` (after adding the over-sale re-check and `customerId` ownership check) — INV-009 slice.
- Water-quality read-back: charts and export columns over existing `dailyRecords`/`biweeklyRecords` fields — PROD-014 slice.
- Withdrawal-period warning at harvest/sale using existing `healthTreatments.withdrawalUntil` — PROD-012.
- Top-up history list and nav entry — UX.
- Export CSV option fix (`pages/export.js:82-94`) — UX.
- Biweekly `?cage=` deep link — MOBILE-005.
- Fix `/cages/analytics/harvest` (snake_case filter) and use settings thresholds — UX/PROD-008.
- PWA hygiene (PNG icons, SW versioning) — MOBILE-007.
- Bundle diet (lazy recharts, dynamic `xlsx`) — MOBILE-008.
- Admin-only UI parity (hide actions the backend refuses) — SEC-002.

## 5. Features requiring architectural changes

| Feature | Architectural change | Decision |
|---|---|---|
| Multi-org users, invites, custom roles | `memberships`, permission catalog, `requireMember` | D-002, D-005 |
| Ponds, tanks, RAS, hatchery units | `unitType` on `cages`, typed dims, terminology | D-003, D-007 |
| Batch lineage, splitting, merging, grading, reconciliation, history | `batches` + `stockEvents`; engine as only writer | D-004 |
| Dashboards at scale, farm comparisons | Rollup tables, indexed reads | D-006 |
| Custom fields / forms / terminology | `customFieldDefs`, `custom` values, config docs | D-007 |
| Automations, notifications across channels, webhooks | Events outbox, rules/runs, scheduler/workpool, adapters | D-008, D-009 |
| Offline for every form | Generalized outbox + `clientMutationId` | D-010 |
| Time zones, units, species config | Org/site settings + formatting helpers | D-012 |

## 6. Features that depend on other modules

| Feature | Depends on |
|---|---|
| Hatchery / nursery (HAT-*, NUR-*) | FARM-002 (unit types), PROD-001/002 (batches, events), PROD-006 (split/transfer) |
| Pond / tank / RAS (POND-*, RAS-*) | FARM-002, PROD-004, PROD-014 |
| Cost per kg, profitability (ANLY-004) | INV-006 (lot costing), INV-007 (expenses), INV-008 (batch costing), PROD-002 |
| Traceability views (TRACE-*) | PROD-001 (lineage), INV-002 (site-correct feed ledger), INV-001 |
| Automation (AUTO-002+) | AUTO-001 events, PROD-002 engine, PERM-002 (who may configure) |
| SMS/WhatsApp notifications | INT-001, INT-002, AUTO-003 |
| Custom dashboards/reports | PLAT-002 rollups, CUSTOM-001 |
| Farm comparisons, forecasting | PLAT-002, PROD-008 |
| Password reset, invite emails | INT-002 (email provider) |
| Site-scoped permissions | ORG-001 (membership.locationScope), FARM-003 (site honoured on every page) |
| Public API | PERM-002 (scopes map to permissions), INT-004 |

## 7. Foundational vs enhancement summary

| Foundational (do first, in this order) | Enhancements (after their foundations) |
|---|---|
| Phase 0: SEC-001, SEC-002, SEC-003, PROD-000, OPS-000, OPS-001, OPS-002, PLAT-001, MOBILE-001 | Hatchery, nursery (Phase 5) |
| Phase 1–3: ORG-001..005, PLAT-004, FARM-001..003, I18N-001, PERM-001..005 | Pond/tank/RAS workspaces (Phase 6) |
| Phase 4: PROD-001..013, PLAT-002 | Custom fields/forms/dashboards (Phase 8) |
| Phase 7 core: MOBILE-002, MOBILE-003 | Procurement, invoices, assets (Phase 9) |
| Phase 10–11 core: AUTO-001, INT-001, INT-002 | Automation templates, public API, IoT, accounting (Phases 10–11) |
| | Traceability, analytics, AI, enterprise (Phases 12–14) |
