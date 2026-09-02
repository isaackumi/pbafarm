---
title: "Convex end-to-end migration + UI theme"
date: 2026-07-24
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
product_contract_source: ce-plan-bootstrap
execution: code
---

# Convex end-to-end migration + UI theme

## Goal Capsule

Replace Supabase (Postgres, Auth, RLS, client SDK) with **Convex + Convex Auth** across the fish farm app, domain by domain, on a **greenfield** data footing (no production import). In parallel, establish a distinctive **Tide Chart** design system and restyle chrome + high-traffic screens so the product no longer reads as generic indigo Tailwind.

Authority hierarchy: user decisions in this session > this plan > current Next.js Pages Router patterns > Convex / Convex Auth docs.

Stop when: no runtime dependency on `@supabase/supabase-js` or `NEXT_PUBLIC_SUPABASE_*`; all domains listed below read/write Convex; auth is Convex Auth; Tide Chart tokens drive Layout/Sidebar/Header plus migrated domain UIs; `npm run build` passes.

## Product Contract

### Problem

The app is a Next.js 15 Pages Router ops tool (~38 pages, ~12 `lib/*Service` modules, Redux slices, Next API routes) backed entirely by Supabase. Auth, roles, company tenancy, and RLS live in Postgres. There is no Convex code today. UI uses Montserrat + sky/indigo tokens and feels plain/generic, especially harvest sampling and dense data entry screens.

### Actors

- Farm operator / field staff — daily, biweekly, harvest entry
- Farm admin — cages, feed, inventory, users, company settings
- Super admin — company registration approvals
- New registrant — company signup / pending approval

### Decisions locked

| Decision | Choice | Rationale |
|---|---|---|
| Auth | Convex Auth end-to-end | Fully leave Supabase; roles live in Convex |
| Data | Greenfield (no Supabase import) | Avoid ID-mapping complexity; archive old DB offline if needed |
| Cutover | Domain-by-domain | Safer dual-stack; ship value per domain |
| Theme | Agent-chosen **Tide Chart** | Distinctive aquaculture ops look; avoids purple/cream/acid defaults |

### Requirements

- R1. Convex project is initialized; schema covers auth tables plus app domains; local + Vercel env use `NEXT_PUBLIC_CONVEX_URL` (and Convex Auth secrets) only for backend.
- R2. Convex Auth supports email/password sign-in and sign-up; session gates protected routes; profiles carry `role` (`user` \| `admin` \| `super_admin`) and optional `companyId`.
- R3. Domain migration order: Auth → Cages → Daily/Biweekly → Harvest → Feed/Inventory → Stocking/Approvals → Reports/Audit/Notifications → Company admin → Supabase removal.
- R4. While a domain is mid-migration, other domains may still use Supabase; after a domain flips, that domain must not call Supabase.
- R5. Authorization replaces RLS with Convex `getAuthUserId` + role/company checks inside queries/mutations (no trusting client-only checks).
- R6. Redux remains for UI-local state where useful; server truth moves to Convex reactive queries (`useQuery` / `useMutation`). Auth slice is rewritten or replaced by Convex Auth hooks.
- R7. Next.js `pages/api/*` that only proxy Supabase are deleted or thinned as each domain moves to Convex (prefer client → Convex over API middleman).
- R8. Tide Chart design tokens (CSS variables + Tailwind theme) land early and are applied to shell (Layout, Sidebar, Header, login) before/during domain flips; each migrated page adopts tokens (no leftover indigo-primary chrome on flipped routes).
- R9. Sidebar Cage Management drops redundant **Active Cages**, **Maintenance**, and **Harvest Ready** links (those filters live on `/cages`).
- R10. Greenfield seed: one bootstrap script/mutation creates a super_admin and optional demo cages for local/dev — not a Supabase dump.
- R11. Definition of “complete”: zero Supabase imports, `lib/supabase.js` gone, env docs updated, build green on Vercel.

### Out of scope

- Migrating historical Supabase rows into Convex
- Rewriting Pages Router → App Router (optional later; see deferred)
- Mobile native apps
- Offline-first / PWA sync
- Changing core aquaculture formulas (FCR, DOC, ABW) beyond re-homing them

### Acceptance examples

- Fresh deploy: operator signs up/in via Convex Auth, creates a cage, logs daily feed/mortality, enters biweekly ABW, records harvest sampling — all data visible after refresh without Supabase.
- Admin cannot mutate another company’s cages when `companyId` is set; super_admin can approve company registrations.
- Login + dashboard + cages + harvest-sampling visually use Tide Chart tokens; sidebar no longer lists Active/Maintenance/Harvest Ready.

## Planning Contract

### Theme — Tide Chart (frontend-design)

Subject: cage aquaculture operations on open water. Audience: farm staff who live in tables and forms. Job: make status and numbers scannable outdoors and indoors without looking like a SaaS template.

| Token | Hex | Role |
|---|---|---|
| `lagoon-950` | `#062A33` | Sidebar / chrome dark |
| `lagoon-800` | `#0B4A58` | Primary actions, active nav |
| `foam` | `#F3F7F6` | App canvas |
| `kelp` | `#2F6B4F` | Success / active stock |
| `signal` | `#C45C26` | Alerts / harvest-ready / errors |
| `chart-ink` | `#1A2B32` | Body text |

- Type: display **Fraunces** (brand/login titles only); UI **Source Sans 3**; data **IBM Plex Mono** (tables, ABW, FCR, DOC).
- Layout: calm foam canvas, dense tables with mono numerals, restrained radius (not pill-heavy). Signature: a thin **waterline** accent under the top header / sidebar brand (1–2px lagoon→kelp gradient), not decorative cards in the hero of login.
- Motion: page fade-in for shell; subtle row highlight on table focus; respect `prefers-reduced-motion`.
- Explicitly avoid: purple gradients, cream+terracotta brochure look, broadsheet hairlines, glow, emoji chrome.

Apply via: `styles/theme.css` (CSS variables) + `tailwind.config.js` extensions; update `components/Layout.js`, `Sidebar.js`, `Header.js`, `pages/login.js`, then each domain page as it migrates. Harvest sampling gets a dedicated restyle pass in the Harvest unit (size-category grid, clearer DOC/ABW summary).

### Architecture

```
pages/* (Pages Router)
  └─ _app.js → ConvexAuthProvider + ConvexReactClient + existing Redux (shrinking)
       └─ useQuery / useMutation → convex/*.ts
            └─ auth checks (getAuthUserId, roles, companyId)
```

- Keep Pages Router. Convex Auth works with a client `ConvexAuthProvider`; protect routes via `Authenticated` / existing `ProtectedRoute` rewritten against Convex. (Full `@convex-dev/auth/nextjs` middleware is App Router–oriented — deferred.)
- Schema in `convex/schema.ts`: spread `authTables`, then app tables mirroring `db.sql` concepts with Convex `Id<>` references and indexes (`by_company`, `by_cage_date`, etc.).
- Map Postgres UUID FKs → Convex document IDs; drop generated columns (e.g. topup biomass) in favor of computed fields in queries.
- Company tenancy: `companies`, `profiles.companyId`, filter all business tables by company unless super_admin.
- Replace RLS with helpers in `convex/lib/authz.ts` (`requireUser`, `requireRole`, `assertCompanyAccess`).

### Domain sequence (dual-stack)

1. Foundation + Auth + Tide Chart shell
2. Cages (+ sidebar cleanup)
3. Daily + Biweekly records
4. Harvest + harvest sampling (+ UI polish)
5. Feed types/suppliers/purchases/usage + inventory
6. Stocking / topup / approvals
7. Reports, export, audit logs, notifications
8. Company registration + admin approvals
9. Supabase excision + Vercel env cleanup

### Key technical decisions

- KTD1. Stay on Pages Router for this migration; use Convex Auth React provider + client route guards.
- KTD2. Prefer Convex queries/mutations from the browser over Next API routes; delete API proxies per domain.
- KTD3. Greenfield only — `convex/seed.ts` internal mutation for bootstrap admin + optional demo data.
- KTD4. Simplify RBAC initially to profile `role` enum matching today (`user` / `admin` / `super_admin`); port fine-grained `permissions` tables only if a page still needs them after role checks.
- KTD5. Theme tokens ship in Foundation so every later unit inherits them.

### Assumptions

- A1. Existing Supabase data may be abandoned or manually archived outside this project.
- A2. Email/password is sufficient for v1 Convex Auth (OAuth later if needed).
- A3. Single deployment (Vercel) + one Convex project for production.

### Deferred (non-blocking)

- App Router migration for Convex Auth middleware / SSR auth
- Re-import of historical Supabase data
- Fine-grained permission matrix parity if unused in UI

### Risks

| Risk | Mitigation |
|---|---|
| Dual-stack confusion (wrong backend for a screen) | Per-domain checklist; ban new Supabase calls in flipped folders; grep gate in DoD |
| Auth gap on Pages Router vs docs (App Router bias) | Follow Convex Auth setup + Pages client provider; smoke-test login/logout/refresh |
| Role/company leaks without RLS | Central `authz` helpers; tests for cross-company denial |
| Scope creep on full UI redesign | Shell + tokens first; deep restyle only harvest-sampling + cages list + login in plan units |

## Implementation Units

### U1. Convex foundation + Tide Chart shell + Convex Auth

**Goal:** App boots with Convex + Auth; visual shell uses Tide Chart; Supabase auth no longer required for login path.

**Files:**
- Create: `convex/schema.ts`, `convex/auth.ts`, `convex/http.ts`, `convex/users.ts`, `convex/seed.ts`, `styles/theme.css`, `lib/convexClient.js`
- Modify: `package.json`, `pages/_app.js`, `pages/_document.js` (fonts), `pages/login.js`, `pages/signup.js`, `components/ProtectedRoute.js`, `components/Layout.js`, `components/Sidebar.js`, `components/Header.js`, `store/slices/authSlice.js`, `tailwind.config.js`, `.env.local.example` (or README env section), `.gitignore`

**Approach:**
- Install `convex`, `@convex-dev/auth`, run Convex init / auth init.
- Schema: `authTables` + `profiles` (+ stub `companies` if needed for signup later).
- Wire `ConvexAuthProvider`; rewrite login/signup; `ProtectedRoute` uses Convex auth state.
- Add Tide Chart CSS variables + Tailwind colors/fonts; restyle Layout/Sidebar/Header/login.
- Seed mutation for first super_admin (dev).

**Tests:** `convex/users.test.ts` (or vitest if added) — role defaults; authz helper unit tests when introduced.

**Scenarios:**
- Happy path: email/password sign-up → redirect dashboard → refresh stays logged in
- Happy path: sign-out clears session; protected route redirects to login
- Edge: invalid credentials show actionable error (Tide Chart signal color)
- Empty: first boot with seed creates bootstrap admin
- Error: missing `NEXT_PUBLIC_CONVEX_URL` fails loudly in dev

**Done when:** Login works on Convex Auth only; shell shows Tide Chart; dashboard can still use Supabase data temporarily behind auth.

---

### U2. Cages domain on Convex + sidebar cleanup

**Goal:** All cage CRUD/list/analytics reads/writes Convex; remove redundant sidebar links.

**Files:**
- Create: `convex/cages.ts`, indexes in `convex/schema.ts`
- Modify: `lib/cageService.js` (replace or delete), `store/slices/cagesSlice.js`, `pages/cages/**`, `pages/create-cage.js`, `components/CreateCageForm.js`, `components/CageManagementSidebar.js`, `components/Sidebar.js`
- Delete when unused: `pages/api/cages/*`, `pages/cages/active.js`, `pages/cages/maintenance.js`, `pages/cages/harvest-ready.js` (or keep as redirects to `/cages?filter=`)

**Approach:**
- Port cage fields from `db.sql` / `lib/cageService.js`.
- Status filters (active / maintenance / harvest-ready) as query args on `/cages`, not separate nav items.
- Company-scoped list/mutations via authz.

**Tests:** `convex/cages.test.ts`

**Scenarios:**
- Happy path: create cage → appears in list → edit status → detail page loads
- Edge: list filter active/maintenance/harvest-ready returns correct subsets
- Edge: non-admin cannot delete cage (if rule exists)
- Error: cross-company read returns empty/forbidden
- Empty: zero cages shows Tide Chart empty state with CTA to create

**Done when:** No Supabase calls under cages routes; sidebar items Active/Maintenance/Harvest Ready removed.

---

### U3. Daily + biweekly records

**Goal:** Daily entry/upload and biweekly entry/records use Convex.

**Files:**
- Create: `convex/dailyRecords.ts`, `convex/biweeklyRecords.ts`
- Modify: `components/DailyEntryForm.js`, `components/BiweeklyEntryForm.js`, `pages/daily-entry.js`, `pages/biweekly-entry.js`, `pages/biweekly-records.js`, `pages/daily-data.js`, `store/slices/dailySlice.js`, `store/slices/biweeklySlice.js`, `lib/databaseService.js` (strip migrated methods)
- Delete: `pages/api/daily-records/*`, `pages/api/biweekly-records/*` when unused

**Approach:**
- Preserve DOC/ABW calculation behavior in UI or Convex query helpers.
- Unique batch_code → Convex index + mutation conflict handling.
- Sampling child records as nested table or embedded array (prefer table `biweeklySampling` for parity).

**Tests:** `convex/biweeklyRecords.test.ts`, `convex/dailyRecords.test.ts`

**Scenarios:**
- Happy path: daily feed+mortality insert; list by cage/date
- Happy path: biweekly record + N samples; ABW aggregates correctly
- Edge: duplicate batch_code rejected
- Edge: daily entry for inactive cage warned or blocked per existing rules
- Error: unauthenticated mutation fails

**Done when:** Daily/biweekly pages have zero Supabase imports.

---

### U4. Harvest + harvest sampling (UI polish)

**Goal:** Harvest flows on Convex; harvest-sampling page is a Tide Chart showcase (dense, clear, non-plain).

**Files:**
- Create: `convex/harvest.ts`
- Modify: `pages/harvest.js`, `pages/harvest-sampling.js`, `components/HarvestForm.js`, `components/SamplingForm.js`, `store/slices/harvestSlice.js`, `lib/databaseService.js`
- Delete: `pages/api/harvest-records/*` when unused

**Approach:**
- Port size breakdown JSON → Convex object fields.
- Restyle sampling: mono for weights/counts; kelp/signal category chips; waterline section headers; sticky DOC/ABW summary.

**Tests:** `convex/harvest.test.ts`

**Scenarios:**
- Happy path: sampling → preview → persist → harvest record links samples
- Edge: size category sum ≠ fish count shows warning (existing behavior)
- Empty: no active cages → guided empty state
- Error: submit without cage/date blocked

**Done when:** Harvest domain on Convex; sampling page matches Tide Chart and is visibly improved.

---

### U5. Feed + inventory

**Goal:** Feed types, suppliers, purchases, usage, stock levels, alerts, transactions on Convex.

**Files:**
- Create: `convex/feed.ts`, `convex/inventory.ts`
- Modify: `pages/feed-*.js`, `pages/feed-management/**`, `pages/stock-levels.js`, `pages/inventory/**`, `pages/inventory-*.js`, `lib/feed*.js`, `lib/supplierService.js`

**Approach:**
- Soft-delete (`deletedAt`) parity where present.
- Stock adjustments as inventory transactions; derive stock levels in queries.

**Tests:** `convex/feed.test.ts`, `convex/inventory.test.ts`

**Scenarios:**
- Happy path: create supplier → feed type → purchase increases stock → usage decreases
- Edge: usage below zero rejected or clamped per rules
- Empty: alerts page with no low stock
- Error: deleted feed type hidden from active selectors

**Done when:** Feed/inventory pages have zero Supabase imports.

---

### U6. Stocking, topup, approvals

**Goal:** Stocking management, topups, pending approvals on Convex.

**Files:**
- Create: `convex/stocking.ts`
- Modify: `pages/stocking.js`, `pages/stocking-management.js`, `pages/topup.js`, `pages/approvals.js`, `components/StockingForm.js`, `components/TopUpForm.js`, `lib/stockingService.js`

**Approach:**
- Status workflow `pending_approval` → approved/rejected with `approvedBy` / `approvedAt`.
- Compute biomass in query/mutation instead of generated columns.

**Tests:** `convex/stocking.test.ts`

**Scenarios:**
- Happy path: stocking submit → admin approve → cage counts update per existing rules
- Happy path: topup against stocking
- Edge: reject with notes
- Error: non-admin cannot approve

**Done when:** Stocking/approvals on Convex only.

---

### U7. Reports, export, audit, notifications

**Goal:** Analytics/report/export/audit/notifications read Convex.

**Files:**
- Create: `convex/reports.ts`, `convex/audit.ts`, `convex/notifications.ts`
- Modify: `pages/report.js`, `pages/export.js`, `pages/audit-logs.js`, `pages/api/analytics/*` (remove or rewrite), `contexts/NotificationContext.js`, `lib/notificationService.js`, `lib/auditLogService.js`, `store/slices/notificationsSlice.js`, `store/slices/dashboardSlice.js`, `components/Dashboard.js`

**Approach:**
- Prefer Convex aggregations in queries; keep xlsx export client-side from query results.
- Audit: write on sensitive mutations via helper.

**Tests:** `convex/reports.test.ts`

**Scenarios:**
- Happy path: dashboard KPIs load from Convex
- Happy path: export downloads non-empty sheet for date range
- Empty: notification bell with zero items
- Error: unauthorized audit log access denied for `user` role if restricted

**Done when:** Reporting/notification paths have zero Supabase imports.

---

### U8. Companies + admin registrations

**Goal:** Company registration, pending approval, admin approve/reject, company settings on Convex Auth + Convex data.

**Files:**
- Create: `convex/companies.ts`
- Modify: `pages/register-company.js`, `pages/pending-approval.js`, `pages/company-settings.js`, `pages/admin/**`, `components/CompanyRegistrationsPage.js`, `components/AdminCompanyRegistrationsPage.js`, `components/PendingApprovalPage.js`, `lib/companyService.js`, `lib/userService.js`, `pages/users.js`, `components/UserManagement.js`

**Approach:**
- Replace Supabase admin `createUser` + RPCs with Convex Auth sign-up + `companies` / `companyRegistrations` documents and super_admin mutations.
- On approve: set profile `companyId` + `role: admin`.

**Tests:** `convex/companies.test.ts`

**Scenarios:**
- Happy path: register company → pending → super_admin approve → admin can manage cages
- Happy path: reject leaves user pending/blocked with message
- Edge: duplicate company code rejected
- Error: non–super_admin cannot approve

**Done when:** Company flows work without Supabase Auth admin APIs.

---

### U9. Supabase excision + deploy hardening

**Goal:** Remove Supabase completely; production build/deploy clean.

**Files:**
- Delete: `lib/supabase.js`, remaining `pages/api/**` proxies, unused supabase migrations from runtime path (keep SQL archive under `archive/supabase/` if desired)
- Modify: `package.json` (remove `@supabase/supabase-js`), README, Vercel env docs, any leftover imports (grep gate)

**Approach:**
- Repo-wide grep for `supabase`, `SUPABASE`, `createClient`.
- Confirm Vercel build; document Convex dashboard env + Auth JWT keys.

**Tests:** CI/build only; optional smoke script.

**Scenarios:**
- Happy path: `npm run build` succeeds
- Edge: grep finds zero supabase references in app code
- Error: missing Convex env fails deploy with clear config docs

**Done when:** App is Convex-only end to end; Vercel deploy green.

## Verification Contract

- Local: `npx convex dev` + `npm run dev` for each unit’s domain smoke paths above.
- Gate: `npm run build` after U1, U4, U9 at minimum.
- Grep gates: after each unit, no `supabase` imports in that unit’s file list; after U9, none in repo app code.
- Authz: at least one cross-company denial test by U2 and U8.
- UI: visual check login, dashboard shell, `/cages`, `/harvest-sampling` against Tide Chart tokens (no indigo primary chrome).

## Definition of Done

- All units U1–U9 complete with scenarios checked.
- R1–R11 satisfied; no `@supabase/supabase-js` dependency.
- Tide Chart applied to shell + migrated high-traffic pages; cage sidebar redundancy removed.
- README documents Convex + Auth env setup for local and Vercel.
- Plan decisions (Convex Auth, greenfield, domain-by-domain, Tide Chart) unchanged unless explicitly amended.

## Appendix

### Current coupling (research)

- Schema source of truth: `db.sql` (profiles, cages, feed_*, daily_records, biweekly_*, harvest_*, stocking_*, topup_*, roles/permissions, audit_logs) + RLS using `auth.uid()`.
- Client: `lib/supabase.js`; heavy use in `lib/*Service.js`, Redux slices, components, `pages/api/*`.
- Auth today: Supabase email/password via `store/slices/authSlice.js` + `ProtectedRoute.js`.
- UI today: `tailwind.config.js` sky primary + Montserrat; indigo spinner/nav accents.

### Suggested dependency add (directional)

- `convex`, `@convex-dev/auth`, `@auth/core` (version pinned per Convex Auth docs at implement time)
- Fonts: Fraunces, Source Sans 3, IBM Plex Mono via `next/font` or `_document.js` links

### Reference docs

- https://labs.convex.dev/auth/setup
- https://docs.convex.dev/client/nextjs/pages-router/
- https://docs.convex.dev/database/schemas
