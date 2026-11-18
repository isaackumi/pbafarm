# 12 — Technical Health and Risk Report

Discovery stage: PART 9 (Phase Six — Existing Functionality and Technical Health). Branch: `docs/discovery`. Date: 2026-11-18.

## Stage header

| Item | Value |
|---|---|
| Objective | Measure the real build, type, lint and test state; describe error handling, logging, monitoring, security posture, performance hot spots, deployment, backups, file storage and background processing; identify bugs that get worse with scale. |
| Files inspected | Build/lint/test configs (see doc 01 §5); `convex/lib/{authz,tenancy}.ts`; `convex/{reports,dailyRecords,audit,reminders,companies,users,userAccounts,seed,feed,auth,crons,http}.ts`; `convex/schema.ts`; `pages/_app.js`; `pages/api/llm/*`; `lib/{llmClient,llmEnv,llmApiAuth,convexBridge,convexClient,offlineOutbox,notificationService,databaseService,companyService}.js`; `components/{Dashboard,DailyUploadPage,AiAssistant}.js`; `contexts/{AuthContext,NotificationContext,DataContext}.js`; `store/index.js`; `public/sw.js`; `.github/workflows/*`. |
| Commands run (all read-only) | `npx next build` (exit 0); `npx eslint . -f json` (exit 1); `npx next lint` (warnings only); `npx tsc --noEmit -p convex` (exit 0); `npm test` (exit 0); `npx vitest run convex/lib/fishTransferLogic.test.ts` (no files matched); `npm ls --depth=0`; `npm outdated`; `npm audit`; grep scans for `.collect()`, `.take(`, `paginate`, `console.*`, `ConvexError`, auth calls. |
| Completion status | Complete for static and local analysis. Not verifiable from the repo: production traffic, Convex dashboard logs/insights, real table sizes, backup settings, Vercel project settings. |

## Summary scorecard

| Area | Status (vocabulary) | Confidence |
|---|---|---|
| Production build | Implemented and working | High (ran) |
| Backend type-check (`convex/`) | Implemented and working | High (ran) |
| Frontend type-check | Completely missing (JS, no `tsconfig`) | High |
| Lint | Implemented but incomplete (non-gating; 0 real errors, 18 hook warnings) | High (ran) |
| Automated tests | Partially implemented (17 tests, 4 of 20 backend modules touched, 0 frontend) | High (ran) |
| Coverage measurement | Completely missing | High |
| Error handling | Implemented but potentially defective | Medium |
| Logging | Partially implemented (console only) | High |
| Monitoring / alerting | Completely missing | High (no SDK found) |
| Security posture | Implemented but potentially defective (see §5) | Medium–High |
| Performance at scale | Implemented but potentially defective (§6) | High for the pattern, Medium for the threshold |
| Deployment | Implemented but incomplete (no prod Convex deployment) | High |
| Backups | Unknown – requires verification (nothing in repo) | — |
| File storage | Implemented and working (logo only) | Medium |
| Background processing | Implemented but potentially defective (one cron, single transaction) | High |

---

## 1. Build

`npx next build` — **exit 0**, Next.js 15.2.8, "Compiled successfully", 61/61 static pages generated. Linting skipped (`next.config.mjs` `eslint.ignoreDuringBuilds: true`). "Checking validity of types" is close to a no-op because the frontend is JavaScript.

Route sizes (First Load JS, shared baseline 185 kB, of which `_app` chunk 78.2 kB):

| Route | Page | First Load | Driver |
|---|---|---|---|
| `/feed-purchases` | 10.2 kB | **313 kB** | recharts + 1,743-line page |
| `/inventory/analytics`, `/inventory/overview` | 2.7–3 kB | 304 kB | recharts |
| `/feed-management/overview` | 3.4 kB | 300 kB | recharts |
| `/export` | **115 kB** | 298 kB | `xlsx` statically imported (`pages/export.js:16`) |
| `/cages/analytics`, `/cages`, `/dashboard`, `/cages/analytics/growth` | 2–5 kB | 292–295 kB | recharts |
| `/daily-entry` (field entry) | 0.2 kB | 202 kB | `DailyUploadPage` |
| `/login` | 1.2 kB | 173 kB | |

All 61 routes are `○` static (client-rendered); the 8 legacy redirect stubs and the 2 API routes are `ƒ`. Observations: recharts adds ~110 kB to every chart page and is not lazy-loaded; `xlsx` could be dynamically imported on click; the `_app` chunk carries Redux, redux-persist, 8 providers and the tour engine for every route, including the field-worker daily entry page used on weak mobile signal.

## 2. Type errors

- `npx tsc --noEmit -p convex` — **exit 0, no errors.** `convex/tsconfig.json` is `strict: true`.
- Caveats: `convex/tsconfig.json` excludes `**/*.test.ts`, so tests are never type-checked. Several helpers use `any` to escape typing, e.g. `recordOutboundUsage(ctx: any, args: { feedTypeId: any, cageId?: any, locationId?: any … })` (`convex/feed.ts:609-624`), and `toClientTransaction(t: any)` (`convex/inventory.ts:14`).
- Frontend: no type checking at all (`jsconfig.json` has only a path alias). Contract drift between Convex return shapes and JS consumers is caught only at runtime.

## 3. Lint

`npx eslint .` (flat config, no ignores) — 245 files, **7 errors, 25 warnings**:

| Rule | Severity | Count | Where |
|---|---|---|---|
| `react-hooks/exhaustive-deps` | warning | 18 | 14 pages, 3 contexts, `AiAssistant.js` — almost all are Path B pages whose `useEffect(() => fetchX(), [])` omits the fetch function (`pages/harvest.js:41`, `pages/feed-management/index.js:69`, `pages/_app.js:103`, `contexts/NotificationContext.js:23`, …) |
| `@next/next/no-assign-module-variable` | error | 7 | **all in `.next/` build output** (lint config has no `ignores`) — not source defects |
| unused `eslint-disable` directive | warning | 6 | 5 in `convex/_generated/*`, 1 in `components/QuickCreateModals.js:910` |
| `import/no-anonymous-default-export` | warning | 1 | `convex/auth.config.ts:1` |

`npx next lint` (what CI runs via `npm run lint`) — **0 errors**, warnings only; it lints only `pages/ components/ lib/`, so `convex/`, `contexts/`, `hooks/`, `store/` are outside CI lint. CI runs lint with `continue-on-error: true` (`.github/workflows/ci.yml:23-25`). Net: source has **no lint errors**, but lint is neither complete nor gating. The `exhaustive-deps` warnings are mostly benign today but mark stale-closure risk (e.g. `pages/stocking-management.js:62` missing `filterStockings`).

## 4. Tests and coverage

`npm test` → `vitest run` — **4 files, 17 tests, all passing**, 650 ms.

| Test file | Tests | Exercises |
|---|---|---|
| `convex/siteStock.test.ts` | 5 | `dailyRecords.create`, `inventory.createTransfer`, `inventory.listStockLevels` (per-site feed stock) |
| `convex/growth.test.ts` | 5 | `biweeklyRecords.create/remove`, `cages.growth`, `cages.growthAll`, pure `lib/growth` |
| `convex/reminders.test.ts` | 3 | `internal.reminders.dailyDigest`, `reminders.runForMyCompanyNow`, `dailyRecords.create` |
| `convex/harvest.test.ts` | 4 | `harvest.create/update/remove/suggestFcr`, `biweeklyRecords.create` |
| `convex/lib/fishTransferLogic.test.ts` | ? | **Never runs.** `vitest.config.mjs` `include: ['convex/*.test.ts']` is not recursive; verified with `npx vitest run convex/lib/fishTransferLogic.test.ts` → "No test files found". Added in commit `623b344` (2026-09-05). |

Coverage tooling: none (`@vitest/coverage-*` not installed, no `coverage` config; `/coverage` is merely gitignored).

**Modules with no tests at all** (by import/API reference scan): `companies.ts` (844 lines, registration/approval/settings/publish), `stocking.ts` (750, stocking + top-up + approvals), `feed.ts` (728, purchases/usage/issue — the stock ledger entry points), `reports.ts` (700, dashboard/P&L/export/AI context), `fishTransfers.ts` (465), `sales.ts` (396), `farmLocations.ts` (347), `users.ts` (344, roles/invites/deactivation), `audit.ts`, `notifications.ts`, `health.ts`, `seed.ts`, `userAccounts.ts` (password actions), and `convex/lib/{authz,tenancy,feedLedger,farmRules}.ts` except as side effects. **No tenant-isolation test exists** (no test signs in as company A and asserts company B rows are invisible). Frontend: zero tests (no React Testing Library, no Playwright/Cypress).

## 5. Security posture summary

Detailed authz analysis belongs to doc 07; this section records what was verified here.

### 5.1 Secrets handling
- `.env*` ignored (`.gitignore`), `.env.local` not tracked; git history grep found no committed API keys, JWTs or Supabase keys (only `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY` references). **OK.**
- LLM keys are read server-side (`lib/llmEnv.js:21-25`) and never returned to the browser; `/api/llm/status` returns booleans only. **OK.**
- The assistant UI lets each user paste their own provider key, stored **in plaintext in `localStorage`** (`lib/llmClient.js:90,108-157`, key `pbafarm_llm_settings`); with a browser key, farm context JSON is sent **directly from the browser** to the provider, bypassing the server and any company-level control except the `aiAssistantStatus` toggle.
- Convex Auth signing keys (`JWT_PRIVATE_KEY`, `JWKS`) live in Convex deployment env (README). Cannot verify from repo.
- `.env.local` contains a `dev:` deploy key, so every developer laptop can push code and schema to the deployment that serves real data (doc 01 R1).

### 5.2 Authentication / session
- Password provider only (`convex/auth.ts`), minimum 6 characters, no complexity rule, **no password reset, no email verification** (no email provider configured; `/reset-password` and `/verify-email` are listed as public routes in `pages/_app.js:70` but no such pages exist). A user who forgets a password needs an admin (`userAccounts.createWithPassword`/manual) — see doc 07.
- **Deactivated users keep access.** `users.deactivate` only sets `active: false` (`convex/users.ts:210-231`). `requireUser` (`convex/lib/authz.ts:7-17`) does not check `active`, and no session is revoked, so a deactivated user's existing session and any new sign-in continue to pass every `requireUser`/`requireRole` check. Confidence: High (code read; not executed).
- Sign-out (`contexts/AuthContext.js:95-101`) does not clear `persist:root` (Redux-persist cache of cages/feed/dashboard data), the offline outbox (`pbafarm:outbox:daily-batch`), LLM keys, or `usePersistedForm` drafts. On a shared farm phone, the next user sees the previous user's cached data, and **the next user's session will flush the previous user's queued daily-entry batches under the new user's identity** (`lib/offlineOutbox.js:8` uses one global key, not per user).

### 5.3 Authorization surface
- 142 public Convex functions (64 queries, 76 mutations, 2 actions). A scan for `requireUser|requireRole|getAuthUserId` found every public function guarded, except `feed.createUsage`/`feed.createIssue` and `userAccounts.createWithPassword`, which are guarded indirectly (`recordOutboundUsage` calls `requireUser`, `convex/feed.ts:626`; the action checks `api.users.current`, `convex/userAccounts.ts:26-31`). **OK at the entry-point level.**
- `seed.seedDemo` is a **public** mutation any authenticated user can call to insert demo cages into their company if it has none (`convex/seed.ts:5-19`). Low risk but should be internal or admin-only.
- Super-admin bypasses tenancy everywhere (`tenancy.ts:22`, `authz.ts:24`), including returning all tenants' rows from list queries.

### 5.4 API routes under `pages/api`
Only `pages/api/llm/chat.js` and `status.js`.
- Auth: Bearer Convex JWT forwarded to `api.users.current` via `ConvexHttpClient` (`lib/llmApiAuth.js`). **OK.**
- Company gate: `api.companies.aiAssistantStatus` must be `enabled` (`chat.js:18-23`). **OK.**
- **No rate limiting, no quota, no message-size limit, no role restriction** — any user of an enabled company can use the server's key as a general-purpose LLM proxy: `messages` (including the system prompt) and `model` come straight from the request body (`chat.js:25-30,61-66`). Cost exposure. The base URL cannot be overridden by the client (`chat.js:67-68`). **OK** on SSRF.
- Errors from providers are echoed to the client (`chat.js:72-76`).
- Gemini key is sent in the URL query string (`lib/llmClient.js:220-222`) — standard for that API but ends up in any proxy/access logs.

### 5.5 Transport / headers
No `headers()` in `next.config.mjs`, no `middleware.js`: no Content-Security-Policy, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, or `Permissions-Policy`. Vercel defaults apply (HSTS on vercel.app domains).

### 5.6 Dependency vulnerabilities (`npm audit`: 25 — 4 critical, 14 high, 5 moderate, 2 low)

| Package | Severity | Applies here? |
|---|---|---|
| `next` 15.2.8 | critical | Partly. Many advisories target App Router, middleware, Server Actions, or `next/image`; this app uses none of those. Pages-Router-relevant items (e.g. request-smuggling in rewrites — the app uses `redirects`, not `rewrites`) need case-by-case review. Upgrading within 15.x is still advisable. |
| `@auth/core` 0.41.1 | critical | Possibly: the email-normalisation advisory concerns Auth.js email flows; `@convex-dev/auth` Password provider uses its own normalisation (`convex/auth.ts:8-11`). Patch bump to 0.41.3 is cheap. |
| `xlsx` 0.18.5 | high, **no fix on npm** | Yes for import paths (prototype pollution / ReDoS when *parsing* untrusted files). The live import path (`BulkDailyUploadForm`) uses a hand-written CSV splitter, not `xlsx`; `xlsx` parsing exists only in the dead `BulkUploadModal`. Export (`pages/export.js`) only writes. Exposure is therefore low today. |
| `sharp`, `lodash` (transitive) | high | `sharp` is used by `next/image`, which the app does not use. `lodash` path unclear. |

## 5b. Error handling (cross-cutting)

- **Backend:** 234 `throw new Error(...)` in `convex/`, **0 `ConvexError`**. Messages are human-readable ("Daily record already exists for this cage and date", `convex/dailyRecords.ts:241`) and the UI shows them (`lib/offlineOutbox.js:91-95` `cleanError` strips Convex noise). Risk: Convex production deployments redact the message of non-`ConvexError` exceptions to a generic "Server Error"; once a real `prod:` deployment exists, every validation message the field UI depends on (insufficient stock, duplicate entry, "Line N: …" batch errors parsed at `components/DailyUploadPage.js:452`) would disappear. Confidence: Medium (Convex behaviour per its docs, not reproduced here because the only deployment is a dev deployment). Unknown – requires verification.
- **Client service layer:** every `lib/*Service.js` method catches, `console.error`s and returns `{ data: null|[], error }` (e.g. `lib/notificationService.js:4-12`). Callers inconsistently check `error`. `components/Dashboard.js:142-143` swallows failures entirely with `.catch(() => null)` — if the KPI queries start failing (see §6), the dashboard silently shows empty numbers.
- **No React error boundary** anywhere (no `ErrorBoundary`/`componentDidCatch`, no `pages/_error.js`, no `pages/500.js`). A render exception blanks the screen.
- Offline outbox distinguishes network vs data errors (`lib/offlineOutbox.js:51-58`) — good pattern.

## 5c. Logging

- `console.error`: 31 in `pages/`, 23 in `components/`, 9 in `contexts/`, 41 in `lib/`, 1 in `store/`; `console.log`: 2; **zero** `console.*` in `convex/`. Backend observability is limited to Convex's automatic function logs (exceptions only, since no function logs anything).
- Business audit trail exists separately: `auditLogs` table written via `logAudit` (`convex/lib/tenancy.ts`), surfaced at `/audit-logs`. This is an audit feature, not operational logging.

## 5d. Monitoring

**Completely missing.** No Sentry, Datadog, LogRocket, PostHog, Vercel Analytics, Convex log streaming or log drains (grep for sentry/posthog/datadog/logrocket/gtag across source: no hits). No uptime checks, no alerting on cron failure (the daily digest returning or throwing is visible only in the Convex dashboard). No health endpoint.

---

## 6. Performance hot spots and bugs that get worse at scale

### 6.1 Cross-tenant full-table scans (highest-impact scale bug)
`grep` finds **57** occurrences of `ctx.db.query('<table>').collect()` with no index — every row of every company — before `listForCompany` filters in memory (`convex/lib/tenancy.ts:18-27`). Most affected tables: `cages` 9, `feedTypes` 6, `dailyRecords` 6, `users` 5, `harvestRecords` 5, `farmLocations` 4, `biweeklyRecords` 4. Total `.collect()` calls in `convex/`: ~115; `.paginate()` calls: **0**.

`by_company` / `by_company_location` indexes already exist on most of these tables (e.g. `dailyRecords` `convex/schema.ts:274-279`) but are not used by the report queries.

Worst offenders, on hot paths:

| Function | File:line | What it reads | Who calls it |
|---|---|---|---|
| `reports.dashboardSummary` | `convex/reports.ts:6-33` | all `cages`, **all `dailyRecords`** | Dashboard on every load (`components/Dashboard.js:143`) |
| `reports.dashboardKpis` | `convex/reports.ts:99-117` | all `dailyRecords` | Dashboard |
| `dailyRecords.list` (no `cageId`) | `convex/dailyRecords.ts:147-168` | all `dailyRecords`; returns the entire company history to the client, unbounded | Dashboard (`Dashboard.js:~146`), daily-records views |
| `reports.exportBundle` | `convex/reports.ts:187-217` | all `dailyRecords`, all `biweeklyRecords`, … then date-filters in memory | `/export` |
| `reports.productionReport` | `convex/reports.ts:377-392` | all `dailyRecords` | `/report` |
| `reports.farmContextForAi` | `convex/reports.ts:516-541` | all `cages`, all `dailyRecords`, all `feedTypes` | every assistant message |

Why it matters: Convex enforces per-function read limits (documents and bytes scanned per transaction — on the order of tens of thousands of documents / ~16 MiB; exact current values to be confirmed in Convex docs). One cage produces one `dailyRecords` row per day; a single farm with 100 cages writes ~36,500 rows a year. Because these queries read **all tenants' rows**, the platform-wide total, not one farm's, is what hits the limit — and when it does, the dashboard, report, export and assistant fail **for every company simultaneously**. Before the hard limit, cost and latency grow linearly with total platform data, and each reactive subscription re-runs on any write to `dailyRecords` anywhere. Confidence: High that the pattern exists and scales with global data; Medium on the exact threshold.

### 6.2 Bounded-but-wrong reads (silent data loss at scale)
- `reminders.digestForCompany` reads `dailyRecords.by_date` for the date with `.take(2000)` **across all companies**, then filters to the company (`convex/reminders.ts:56-64`). Once more than 2,000 daily records exist platform-wide for one date, some companies' logged cages fall outside the window and are reported as "missing" — false reminders go to every user.
- Same function reads `users` with `.take(5000)` and filters by company because `users` has no `companyId` index (`convex/reminders.ts:84-87`; schema `users` has only `.index('email')`, `convex/schema.ts:35`). Beyond 5,000 users some companies get no reminders.
- `dailyDigest` loads up to 1,000 companies with `.take(1000)` and processes **all of them in one mutation** (`convex/reminders.ts:121-133`). Every notification insert across all companies shares one transaction's write budget; one failure rolls back reminders for everyone. Should fan out per company via `ctx.scheduler`.
- `audit.list`/`audit.stats` for super admins read the newest `maxRows*3` / 2,000 rows globally, then filter (`convex/audit.ts:44-53,152-161`). Company admins use `by_company` (fine), but table/user/date filters are applied after a fixed `take`, so filtered audit views silently miss older matches.

### 6.3 Client-side "fetch everything" pages
- `pages/feed-purchases.js:162-170` fires 7 parallel list calls (all feed types, all purchases, all lots, stock levels, usage stats, all cages, all suppliers) via the non-reactive HTTP client on mount.
- `components/Dashboard.js:105-150` loads all cages, all stockings, two global-scan report queries, and the full daily-record history.
- `contexts/DataContext.js` exposes `getAllCages/getAllStockings` helpers but has no consumers (dead, but mounted).

### 6.4 Other scale/robustness issues
- Notifications are loaded once per `user` change through the HTTP client (`contexts/NotificationContext.js:15-35`), not via `useQuery`; cron-created reminders do not appear until a reload. (Implemented but incomplete.)
- Offline outbox replays without an idempotency key; a batch whose response was lost is re-sent and rejected as a duplicate, then shown to the user as "needs attention" even though it was saved (`components/DailyUploadPage.js:349-361`, `convex/dailyRecords.ts:241`). Safe (no double count) but confusing.
- Service worker cache `pbafarm-v1` is never versioned per deploy and the static-asset cache is never pruned within a version (`public/sw.js:5,31-43`); it grows with every deploy until the version string is changed by hand.
- All dates are `YYYY-MM-DD` strings computed in UTC (`convex/reminders.ts:7`); fine for Ghana (UTC+0), wrong for farms in other time zones (entries after local midnight land on the wrong day).

## 7. Deployment

| Piece | State |
|---|---|
| Frontend | Vercel, inferred (README; Vercel bot branch). No `vercel.json`. Env vars set in Vercel UI — cannot verify. CI builds with placeholder Convex URLs, so the build does not prove the deployed env is right. |
| Backend | `convex-deploy.yml`: push to `main` touching `convex/**` → `npx convex deploy --yes` using `secrets.CONVEX_DEPLOY_KEY`, which README and the workflow comment say is a **dev** key for `vibrant-stork-860`. No preview deployments per PR, no staging, no prod. |
| Drift | Developers' `.env.local` carries the same deploy key; `npm run dev:backend` (`convex dev`) on any branch hot-pushes functions **and schema** to the same deployment. PRs #7–#13 have since merged and auto-deployed, but any developer running `convex dev` on another branch can still push ahead of `main`. Unknown – requires checking the Convex dashboard's deploy history. |
| Ordering | Frontend (Vercel) and backend (Actions) deploy independently with no coordination; a schema/function change can reach the backend before or after the frontend that needs it. |
| Gates | Tests gate CI but not the Convex deploy workflow (it runs `npm ci` → `convex deploy` with no `npm test`). `convex deploy` does type-check and validate schema. |
| Node | CI uses Node 20 (EOL April 2026). |

## 8. Backup strategy

Nothing in the repository: no export scripts, no scheduled `npx convex export`, no runbook, no restore drill. Convex offers dashboard snapshot export/import and (on paid plans) scheduled backups; whether either is enabled for `vibrant-stork-860` is **Unknown – requires verification** in the Convex dashboard. Because the "production" data lives on a dev deployment that every developer can push schema to, a bad schema push or a destructive migration has no documented recovery path. Status: Completely missing (in repo).

## 9. File storage

- Only use: company logo. `companies.generateLogoUploadUrl` (admin-only, `convex/companies.ts:790-797`) → browser POSTs the file (`pages/company-settings.js:194-200`, also `lib/companyService.js:66-76`) → `companies.setLogo` stores `logoStorageId` and deletes the previous file (`:799-822`); `clearLogo` deletes (`:824-844`). URLs resolved with `ctx.storage.getUrl` (`:14`).
- Gaps: no server-side check of content type or size (`setLogo` accepts any `_storage` id; the only restriction is `accept="image/*"` on the input, `pages/company-settings.js:408`); an uploaded file that is never passed to `setLogo` is orphaned (no cleanup job). No other attachments (no photos of fish, receipts, lab reports). Status: Implemented and working for its narrow scope.

## 10. Background processing

- One cron: `reminders.dailyDigest` daily at 16:00 UTC (`convex/crons.ts:8-13`). Creates in-app notifications only, deduplicated via `notifications.by_dedupe` (`convex/reminders.ts:16-37`). Manual trigger: `reminders.runForMyCompanyNow` (admin).
- No `ctx.scheduler` use, no workflows, no queues, no retry logic. All other "background" behaviour (stock ledger updates, approvals) happens synchronously inside the user's mutation.
- Defects: single-transaction fan-out and cross-tenant `.take()` windows (§6.2).

## 11. Risk register (this stage)

| # | Risk | Severity | Likelihood | Evidence |
|---|---|---|---|---|
| T1 | Cross-tenant full-table `.collect()` in dashboard/report/export/AI queries hits Convex read limits; all tenants fail together | **Critical** (at scale) | Certain as data grows | §6.1 |
| T2 | Deactivated users retain full access | **High** | Certain when used | `convex/users.ts:210-231`, `convex/lib/authz.ts:7-17` |
| T3 | Shared dev Convex deployment is the de facto production; any laptop can push schema; no backups documented | **High** | Medium | §7, §8 |
| T4 | Shared-device data leakage and cross-user outbox replay (no purge on sign-out) | **High** for multi-user phones | Medium | §5.2 |
| T5 | Daily digest: false "missing entry" reminders once >2,000 records/day platform-wide; whole run in one transaction | Medium | Certain at scale | §6.2 |
| T6 | Validation messages may be redacted on a future prod deployment (plain `Error`) | Medium | Medium (Unknown – verify) | §5b |
| T7 | LLM proxy without rate limit/quota/role check | Medium | Medium | §5.4 |
| T8 | No monitoring/alerting; failures (including the cron) invisible | Medium | Certain | §5d |
| T9 | Test gaps on ledger, stocking, companies, tenancy; one test file never runs | Medium | — | §4 |
| T10 | Known-vulnerable `next`, `@auth/core`, `xlsx` | Medium | Low–Medium (most advisories not applicable) | §5.6 |
| T11 | No error boundary; silent `.catch(() => null)` on dashboard | Low–Medium | — | §5b |
| T12 | Lint non-gating, frontend untyped | Low | — | §3, §2 |

## Dependencies
Builds on doc 01 (stack, configs). Feeds doc 07 (auth/authz: T2, T4), doc 04/06 (schema/indexes: T1, T5), doc 15 (technical debt register), and the roadmap testing/release plans.

## Outstanding questions
1. Current document counts for `dailyRecords`, `cages`, `feedTypes`, `users` on `vibrant-stork-860` (sizes the T1 timeline).
2. Are Convex backups/exports configured? Has a restore ever been tested?
3. Is a separate `prod:` Convex deployment and a Vercel preview/prod split planned?
4. Are farm phones shared between workers (determines T4 severity)?
5. Monthly LLM spend and whether the assistant should be limited to admins.
