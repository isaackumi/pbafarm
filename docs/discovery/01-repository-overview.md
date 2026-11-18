# 01 — Repository Overview

Discovery stage: PART 3 (Phase Zero — Repository Discovery). Branch inspected: `docs/discovery` (code of PRs #8–#12, #14). PR state, verified 2026-11-18 after discovery: #7–#13 are merged to `main` and deployed to `vibrant-stork-860`; #14 (UI only) was merged into a stale branch and is not on `main`. See docs/project-management/CHANGELOG.md.. Date: 2026-11-18.

## Stage header

| Item | Value |
|---|---|
| Objective | Establish the real technology stack, configuration, folder structure, entry points, environment variables, dependency health and existing documentation, so later stages start from verified facts. |
| Files inspected | `package.json`, `package-lock.json`, `next.config.mjs`, `jsconfig.json`, `convex/tsconfig.json`, `postcss.config.mjs`, `tailwind.config.js`, `styles/globals.css`, `vitest.config.mjs`, `eslint.config.mjs`, `.gitignore`, `.env.example`, `.env.local` (variable names only), `.github/workflows/ci.yml`, `.github/workflows/convex-deploy.yml`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `generateKeys.mjs`, `pages/_app.js`, `pages/_document.js`, `pages/api/llm/*.js`, `convex/http.ts`, `convex/crons.ts`, `convex/auth.ts`, `convex/auth.config.ts`, `convex/schema.ts`, `lib/convexClient.js`, `lib/convexBridge.js`, `lib/databaseService.js`, `lib/llm*.js`, `lib/offlineOutbox.js`, `store/index.js`, `store/slices/*`, `contexts/*`, `public/sw.js`, `public/manifest.webmanifest`, `archive/README.md`, `docs/plans/*`, `docs/superpowers/*`, `design-system/pba-farm/*`. |
| Commands run | `npm ls --depth=0`, `npm outdated`, `npm audit`, `npx next build`, `npx eslint .`, `npx next lint`, `npx tsc --noEmit -p convex`, `npm test`, grep-based import scans. Nothing was installed or modified. |
| Completion status | Complete for repository level. Per-feature tracing is in docs 02–11; build/test/security health in doc 12; integrations in doc 13. |

## 1. Technology stack (verified versions)

Versions are the installed versions from `npm ls --depth=0`, not the ranges in `package.json`.

| Layer | Technology | Installed | Evidence / notes |
|---|---|---|---|
| Package manager | npm, lockfile v3 | npm 10.9.9 locally | `package-lock.json` `lockfileVersion: 3`. No `yarn.lock`/`pnpm-lock.yaml`. No `engines` field, no `.nvmrc`. CI pins Node 20 (`.github/workflows/ci.yml:16`); local machine runs Node 22.23.4. |
| Web framework | Next.js **Pages Router** | 15.2.8 (exact pin) | `package.json` `"next": "15.2.8"`. No `app/` directory. No `middleware.js`. |
| UI runtime | React / React DOM | 19.1.0 | |
| Language | JavaScript for the frontend; TypeScript for `convex/` only | — | Root has `jsconfig.json` (path alias `@/*` only). The only `tsconfig.json` is `convex/tsconfig.json` (strict). 0 `.ts/.tsx` files under `pages/`, `components/`, `lib/`, `contexts/`. |
| Styling | Tailwind CSS v4 via `@tailwindcss/postcss` | 4.0.17 | `postcss.config.mjs`; `styles/globals.css` uses v4 `@import 'tailwindcss'` + `@theme` + `@custom-variant dark`. Design tokens in `styles/theme.css` (577 lines). |
| Component library | In-house, `components/ui/index.js` (504 lines: `PageHeader`, `FormPage`, `FormCard`, `TabBar`, `Button`, `AppShellSkeleton`, …) | — | No third-party component kit (no MUI/Radix/shadcn). |
| Icons | `lucide-react` | 0.485.0 | Used in ~40 files. `@phosphor-icons/react` 2.1.10 is installed but never imported. |
| Charts | `recharts` | 2.15.3 | 9 files (dashboard, cages analytics, feed/inventory analytics). |
| Backend | Convex | 1.42.3 | `convex/` — 26 tables (`convex/schema.ts`), 64 public queries, 76 public mutations, 2 public actions, 5 internal mutations, 1 internal query. |
| Auth | `@convex-dev/auth` (Password provider only) + `@auth/core` peer | 0.0.94 / 0.41.1 | `convex/auth.ts:6-25`, `convex/auth.config.ts`. |
| Client state | React Context (8 providers) + Redux Toolkit + `redux-persist` | RTK 2.8.2, react-redux 9.2.0, redux-persist 6.0.0 | `store/index.js`; Redux is used by only 4 pages (see §7). |
| Spreadsheet | `xlsx` (SheetJS community, npm registry build) | 0.18.5 | `pages/export.js`, `components/BulkUploadModal.js` (dead). |
| QR | `qrcode` | 1.5.4 | `pages/cages/qr-codes.js`. |
| Product tours | `driver.js` | 1.8.0 | `lib/tours/tourEngine.js`, `lib/tours/systemWalkthrough.js`, `components/TourProvider.js`. |
| Dates | `date-fns` | 4.1.0 | Imported in exactly one file (`pages/biweekly-records.js`). Elsewhere dates are hand-rolled ISO strings. |
| Testing | Vitest + `convex-test` (edge-runtime env) | vitest 3.2.4, convex-test 0.0.38, `@edge-runtime/vm` 5.0.0 | `vitest.config.mjs`. 4 test files run, 17 tests. |
| Lint | ESLint 9 flat config wrapping `next/core-web-vitals` | eslint 9.23.0, eslint-config-next 15.2.4 | `eslint.config.mjs`. |
| Hosting (frontend) | Vercel (inferred) | — | README "Frontend (Vercel)"; remote branch `origin/vercel/react-server-components-cve-vu-t2mqt7` authored by the Vercel bot (2026-09-02). No `vercel.json`. |
| Hosting (backend) | Convex Cloud, deployment `vibrant-stork-860` (a **dev** deployment) | — | `.env.local` `CONVEX_DEPLOYMENT=dev:vibrant-stork-860`; `.github/workflows/convex-deploy.yml:3-5`; README "Deploy". No `convex.json`. |
| CI/CD | GitHub Actions: `ci.yml`, `convex-deploy.yml` | — | See §5. |
| PWA | Hand-written service worker + manifest | — | `public/sw.js`, `public/manifest.webmanifest`, registered in `pages/_app.js:28-37` (production only). |
| AI assistant | Multi-provider LLM client (Gemini default) via a Next API route | — | `pages/api/llm/chat.js`, `lib/llmClient.js`. |

## 2. Project architecture (as built)

```
Browser (Next.js Pages Router, static-exported pages, all client-rendered)
  pages/_app.js  →  ConvexAuthProvider → Redux Provider → 8 Context providers → AuthWrapper (client-side redirects)
     │
     ├── Path A (reactive):   useQuery/useMutation from convex/react           — 27 files
     └── Path B (imperative): lib/*Service.js / lib/databaseService.js
                               → lib/convexBridge.getConvexHttpClient()       — 40 files use services,
                                 (ConvexHttpClient with cached JWT, or the       33 files call the bridge
                                  React client as fallback)
     │
     ▼
Convex deployment (vibrant-stork-860)
  convex/*.ts public queries/mutations → convex/lib/{authz,tenancy,feedLedger,growth,farmRules,fishTransferLogic}.ts
  convex/http.ts   → only @convex-dev/auth HTTP routes
  convex/crons.ts  → one daily cron (reminders.dailyDigest, 16:00 UTC)
  File storage     → company logo only

Next.js server (Vercel functions)
  pages/api/llm/chat.js, pages/api/llm/status.js → authenticate by forwarding the user's Convex JWT
  to api.users.current, then call third-party LLM APIs with server-side keys.
```

Key observations:
- **Two parallel data-access styles.** Roughly half the UI reads through non-reactive `ConvexHttpClient` calls wrapped in `{ data, error }` service objects (a pattern carried over from the Supabase era, see `lib/databaseService.js:1-20`), and half uses reactive `useQuery`. Path B pages do not update live, and they need manual `fetchX()` calls (the source of most `react-hooks/exhaustive-deps` lint warnings, doc 12 §3).
- **Every page is statically prerendered** (`○` in build output, 61 pages) and fully client-rendered. There is no SSR, no `getServerSideProps`, and no server-side auth gate; route protection is client-side (`pages/_app.js:66-112`, `components/ProtectedRoute.js`). Security therefore rests entirely on Convex function checks.
- **Tenancy is enforced in application code** (`convex/lib/tenancy.ts:18-27` `listForCompany`) which filters rows *after* reading them. Many queries read whole tables across all tenants first (doc 12 §6).

## 3. Folder structure — what each area actually does

Line counts are `wc -l` totals.

| Path | Files / lines | What it really contains |
|---|---|---|
| `pages/` (root) | 40 files, 11,330 lines | Route components. Largest: `feed-purchases.js` (1,743), `company-settings.js` (781), `stocking-management.js` (752), `biweekly-records.js` (728). Several are 10–30 line wrappers around a component (`daily-entry.js` → `components/DailyUploadPage.js`; `dashboard.js` → `components/Dashboard.js`). `daily-data.js` is 1 line. |
| `pages/admin/`, `cages/`, `feed-management/`, `inventory/`, `stocking/[id]/`, `topup/[id]/` | 28 files | Sub-routes. `feed-management/{purchases,suppliers,types,usage}.js` and `inventory/{items,categories,reports,transactions}.js` are 12-line stubs; the real behaviour is the redirect table in `next.config.mjs:11-53`. `cages/{active,harvest-ready,maintenance}.js` are 10-line stubs. |
| `pages/api/llm/` | `chat.js` (78), `status.js` (30) | The only server-side code in the Next app. |
| `components/` | 40 files, 10,806 lines + `components/ui/index.js` (504) | Forms, modals, layout (`Layout`, `Sidebar`, `Header`, `MobileTabBar`), `Dashboard`, `DailyUploadPage` (919, the field-entry screen with offline outbox), `QuickCreateModals` (1,122), `AiAssistant` (412). **Unreferenced (dead):** `BiweeklyForm.js`, `BulkUploadModal.js` (732), `CageManagementSidebar.js`, `DailyEntryForm.js`, `Pagination.js`. |
| `contexts/` | 8 files, 1,013 lines | `AuthContext` (wraps `@convex-dev/auth/react`, pushes JWT into `convexBridge`), `LocationContext` (active farm site), `CompanySettingsContext` (published company settings/theme), `ThemeContext`, `SettingsContext` (per-browser prefs in localStorage), `NotificationContext` (bell, non-reactive). **`DataContext` and `AnalyticsContext` have zero consumers** (`useData(`/`useAnalytics(` appear only in their own files) yet are mounted in `_app.js`. |
| `hooks/` | 3 files | `useCurrency`, `usePersistedForm` (form drafts in local/sessionStorage), `useToast` (**unreferenced**; the app uses `components/Toast.js`). |
| `lib/` | 25 files, 3,313 lines | Client data layer: `databaseService.js` (742) re-exports `cageService`, `stockingService`, and defines `dailyRecordService` etc.; per-domain `*Service.js`; `convexBridge.js`, `convexClient.js`; LLM (`llmClient.js`, `llmEnv.js`, `llmApiAuth.js`); `offlineOutbox.js`; helpers (`money.js`, `currencyUtils.js`, `farmHealth.js`, `fishSpecies.js`, `feedTypeMeta.js`, `locationScope.js`). **Unreferenced:** `auditLogService.js`, `feedTrackingService.js`, `permissionService.js`. |
| `lib/tours/` | 2 files | driver.js guided walkthrough definitions. |
| `lib/migrations/` | 2 `.sql` files | Supabase-era SQL. Not used. |
| `store/` | `index.js` + 8 slices | Redux store persisted to localStorage under `persist:root` (whitelist `auth, cages, biweekly, dashboard, feed`). Thunks call `convexBridge`. `harvestSlice.js` is not even registered in the store. |
| `styles/` | `globals.css`, `theme.css`, `tour.css` | Tailwind v4 entry and token layer. |
| `convex/` | 29 files, 8,941 lines | Backend: `schema.ts` (592), domain modules (`companies` 844, `stocking` 750, `feed` 728, `reports` 700, `dailyRecords` 645, `inventory` 517, `harvest` 473, `fishTransfers` 465, `sales` 396, `farmLocations` 347, `users` 344, `cages` 316, `biweeklyRecords` 257, `seed` 207, `audit` 205, `notifications` 197, `health` 174, `reminders` 145, `userAccounts` 121), `auth.ts`, `auth.config.ts`, `http.ts`, `crons.ts`, 4 test files. |
| `convex/lib/` | 7 files, 1,108 lines | `authz.ts` (`requireUser`, `requireRole`), `tenancy.ts` (company/location filtering, audit logging, default location), `feedLedger.ts` (stock movements), `growth.ts` (ABW/FCR/biomass), `farmRules.ts` (company setting enforcement), `fishTransferLogic.ts` (+ a test file that is never run, doc 12 §4). |
| `convex/_generated/` | generated | Includes `ai/guidelines.md` (project rule: read before Convex work). |
| `public/` | 11 files | `sw.js`, `manifest.webmanifest`, `icon.svg`, `icon-maskable.svg`, `logo.svg`, `favicon.ico`. `file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg` are **0-byte** create-next-app leftovers. |
| `archive/` | `legacy-mocks/` (5 js), `supabase/migrations/` (3 sql), `README.md` | Explicitly retired material. |
| `supabase/migrations/`, `migrations/`, `db.sql` (715 lines) | root-level | **Supabase leftovers that were not moved into `archive/`**, contradicting `archive/README.md` and README "Supabase has been fully removed". Not used at runtime. |
| `project-structure.txt` (26,994 lines), `project-structure-1.txt` (49) | root | Old `tree` dumps (the large one includes `node_modules`). Stale noise. |
| `design-system/pba-farm/` | `MASTER.md`, `pages/ai-assistant.md` | Short design notes ("charcoal light" palette). |
| `docs/` | see §9 | Plans/specs + this discovery set. |
| `.agents/skills/`, `.claude/skills/`, `skills-lock.json` | tooling | Convex agent skills for AI coding tools (duplicated in two directories). Not application code. |
| `.convex/local/` | ignored | Local Convex backend state from an earlier "local" setup; the active `.env.local` targets the cloud dev deployment instead. |

## 4. Application entry points

| Entry point | File | Behaviour |
|---|---|---|
| App shell | `pages/_app.js` | Registers `/sw.js` in production only (`:28-37`). Provider tree (`:39-64`): `ConvexAuthProvider(client=convex)` → Redux `Provider` → `ThemeProvider` → `SettingsProvider` → `AuthProvider` → `CompanySettingsProvider` → `LocationProvider` → `DataProvider` → `ToastProvider` → `NotificationProvider` → `AnalyticsProvider` → `TourProvider` → `AuthWrapper` → page + lazily loaded `AiAssistant` (`dynamic(..., { ssr:false })`, `:24`). `AuthWrapper` (`:66-118`) redirects unauthenticated users to `/login`, signed-in users away from public routes, and users with `mustChangePassword` to `/account?force=1`. Public routes list includes `/reset-password` and `/verify-email`, **which do not exist as pages**. `PersistGate` is not used. |
| Document | `pages/_document.js` | Manifest + icons, `theme-color`, Apple PWA meta, **Google Fonts stylesheet** (Figtree, JetBrains Mono, Lexend) loaded from `fonts.googleapis.com`. |
| Middleware | none | No `middleware.js`; no server-side auth or headers. |
| Next API | `pages/api/llm/chat.js`, `pages/api/llm/status.js` | Only server routes (see doc 13 §LLM). |
| Convex HTTP | `convex/http.ts` | `auth.addHttpRoutes(http)` only — no webhooks or custom endpoints. |
| Convex auth | `convex/auth.ts`, `convex/auth.config.ts` | Password provider; profile forces `role: 'user'` and lower-cases email; min password length 6. `auth.config.ts` trusts `process.env.CONVEX_SITE_URL`. |
| Scheduled jobs | `convex/crons.ts` | One cron: `crons.daily('daily entry and low stock reminders', { hourUTC: 16 }, internal.reminders.dailyDigest)`. No `ctx.scheduler` use anywhere. |
| Service worker | `public/sw.js` | App-shell cache (doc 13). |
| CLI-only functions | `convex/users.ts:278` `promoteToSuperAdmin` (internalMutation) | Bootstrap of the first super admin per README. |

## 5. Important configuration

| File | Contents | Observations |
|---|---|---|
| `next.config.mjs` | `reactStrictMode: true`; `devIndicators: false` (workaround for a Pages Router HMR bug); `eslint.ignoreDuringBuilds: true`; 8 temporary redirects for legacy `/feed-management/*` and `/inventory/*` paths; webpack fallback `fs/net/tls: false`. | No `headers()` (no CSP, no `X-Frame-Options`), no `images` config. Lint never fails a build. The webpack fallback is cargo from Supabase days and has no current consumer. |
| `jsconfig.json` | `paths: { "@/*": ["./*"] }` | Frontend has no type checking at all. |
| `convex/tsconfig.json` | `strict: true`, `allowJs`, `moduleResolution: Bundler`, excludes `_generated` and `**/*.test.ts`. | Tests are not type-checked by `tsc -p convex`. |
| `postcss.config.mjs` | `@tailwindcss/postcss` only. | `autoprefixer` is installed but not configured (v4 does prefixing itself). |
| `tailwind.config.js` | v3-style config (content globs, `darkMode: 'class'`, theme extend, plugins `forms`, `typography`, `aspect-ratio`). | **Dead under Tailwind v4**: `styles/*.css` contain no `@config` or `@plugin` directive, so v4 never loads this file. Its three plugins are therefore inert, and the theme it declares is duplicated by `@theme` in `styles/globals.css`. `package.json` also lists it as `"main"`, which is meaningless for an app. |
| `vitest.config.mjs` | `environment: 'edge-runtime'`, inline `convex-test`, `include: ['convex/*.test.ts']`. | Glob is not recursive, so `convex/lib/fishTransferLogic.test.ts` is silently excluded (verified: `npx vitest run convex/lib/fishTransferLogic.test.ts` → "No test files found"). No coverage config. |
| `eslint.config.mjs` | `FlatCompat` → `next/core-web-vitals`. No `ignores`. | `npx eslint .` also lints `.next/` build output (7 of its 7 errors come from `.next/`). `npm run lint` = `next lint`, which only covers `pages/ components/ lib/` (it skips `convex/`, `contexts/`, `hooks/`, `store/`). `next lint` is deprecated after Next 15. |
| `.github/workflows/ci.yml` | On push to `main`, `master`, `feat/**` and on every PR: `npm ci` → `npm test` → `npm run lint` (**`continue-on-error: true`**) → `npm run build` with placeholder Convex URLs. Node 20. | Lint is non-gating. Node 20 reached end of life in April 2026. Branches named `fix/**`, `ui/**`, `docs/**` only get CI via PRs. |
| `.github/workflows/convex-deploy.yml` | On push to `main` touching `convex/**`, `package*.json` or the workflow: `npx convex deploy --yes` with `secrets.CONVEX_DEPLOY_KEY`. | The key is documented as a **dev** key for `vibrant-stork-860` (`convex-deploy.yml:3-5`, README). There is no production Convex deployment yet. |
| `.gitignore` | Ignores `.env*` except `.env.example`, `.next`, `.convex/`, `.vercel`. | Verified `git ls-files` contains no `.env.local` and a history grep found no committed API keys/JWTs (only `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY` references in old code). |

## 6. Environment variables

Values in `.env.local` were not printed; only names and non-secret prefixes were checked.

| Variable | Where read | Side | In `.env.example` | In `.env.local` | Notes |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_CONVEX_URL` | `lib/convexClient.js:3`, `lib/convexBridge.js:22`, `lib/llmApiAuth.js:16` | browser + API route | yes | yes (`https://vibrant-stork-860.convex.cloud`) | **`.env.example` sets it to `https://vibrant-stork-860.convex.site`** — the `.site` host is the HTTP-actions host, not the client API host. Copying the example as-is produces a broken client. If missing, `convexClient.js:11` silently falls back to `https://placeholder.convex.cloud`. |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | not read by app code | — | yes | yes | Set but unused in source (Convex Auth's React client does not need it here). |
| `NEXT_PUBLIC_APP_NAME` | not read by app code | — | yes | yes | Unused. |
| `CONVEX_DEPLOYMENT` | Convex CLI | CLI | no | yes (`dev:vibrant-stork-860`) | |
| `CONVEX_DEPLOY_KEY` | Convex CLI | CLI | no | yes (a `dev:` key) | README states the local `.env.local` holds the same dev key, so `npm run dev:backend` on any branch **pushes that branch's backend to the shared deployment**. |
| `GEMINI_API_KEY`, `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `CUSTOM_LLM_API_KEY` | `lib/llmEnv.js:2-25` via `process.env[name]` | Next server only | yes (Gemini active, others commented) | `GEMINI_API_KEY` only | |
| `CUSTOM_LLM_BASE_URL` | `pages/api/llm/chat.js:68` | server | commented | no | Explicitly not taken from the request body. |
| `LLM_DEFAULT_PROVIDER` | `lib/llmEnv.js:36` | server | yes | yes | |
| `NEXT_PUBLIC_{GEMINI,OPENAI,OPENROUTER,ANTHROPIC,GROQ,CUSTOM_LLM}_API_KEY` | `lib/llmEnv.js:12-19,46-52` (dynamic `process.env[name]`) | browser | one, commented | no | **Defect:** Next.js only inlines `NEXT_PUBLIC_*` values for literal `process.env.NEXT_PUBLIC_X` references. `readPublicProviderKeys()` uses `process.env[name]`, so in the browser bundle these always resolve to empty. The "browser public key" path is effectively dead (it still runs on the server in `api/llm/status.js`). Confidence: High (standard Next.js behaviour; not exercised at runtime here). |
| `NEXT_PUBLIC_CUSTOM_LLM_BASE_URL` | `lib/llmClient.js:104` | browser | no | no | Literal reference, so this one would be inlined. |
| `NODE_ENV` | `pages/_app.js:31` | browser | — | — | SW registration gate. |
| `CONVEX_SITE_URL` | `convex/auth.config.ts:4` | Convex | — | — | Built-in Convex variable. |
| `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL` | `@convex-dev/auth` internals | Convex deployment env | no (README §First-time setup) | — | Generated by `generateKeys.mjs` (uses `jose`, a devDependency) and set with `npx convex env set`. Cannot verify deployment values from the repo. |

## 7. Dependency review

### 7.1 Usage scan (grep of import/require across `pages components contexts lib hooks store convex`, excluding `archive/`)

| Package | Used by | Verdict |
|---|---|---|
| `@phosphor-icons/react` | nothing | **Unused** — remove candidate. Second icon library alongside `lucide-react`. |
| `@tailwindcss/forms`, `@tailwindcss/typography`, `@tailwindcss/aspect-ratio` | only `tailwind.config.js`, which Tailwind v4 does not load | **Effectively unused.** |
| `autoprefixer` | nothing | **Unused** under Tailwind v4 PostCSS plugin. |
| `@auth/core` | no direct import | Required peer of `@convex-dev/auth` (`peerDependencies: "@auth/core": "^0.41.1"`). Keep. |
| `redux-persist`, `@reduxjs/toolkit`, `react-redux` | `store/`, 4 pages (`feed-types`, `cages/analytics`, `cages/analytics/growth`, `cages/analytics/harvest`) + `Layout.js` | **Low-value duplication**: a second state system that caches Convex data in localStorage, parallel to Contexts and `useQuery`. Never purged on sign-out (doc 12 §5). |
| `date-fns` | 1 file | Lightly used; most date logic is manual ISO-string slicing. |
| `xlsx` 0.18.5 | `pages/export.js` (live), `components/BulkUploadModal.js` (dead) | Live; carries unfixed npm advisories (prototype pollution, ReDoS); SheetJS no longer publishes to npm. |
| `jose` (dev) | `generateKeys.mjs` | Keep (bootstrap script). |
| `@edge-runtime/vm` (dev) | vitest `environment: 'edge-runtime'` | Keep (implicit use). |
| `@types/node` 26 (dev) | no TS outside `convex/` | Marginal. |
| `@emnapi/runtime` | — | `npm ls` reports it as **extraneous** (present in `node_modules` but not in the manifest). |

### 7.2 Duplicated concerns
- Icons: `lucide-react` (used) + `@phosphor-icons/react` (unused).
- State: Redux + redux-persist, 8 Contexts, and Convex `useQuery` all hold server data.
- Data access: `lib/*Service.js` HTTP wrappers vs `useQuery` (§2).
- Toasts: `components/Toast.js` (used) vs `hooks/useToast.js` (unused).
- Tailwind theme: `tailwind.config.js` (dead) vs `@theme` in `styles/globals.css` (live).
- Skills folders: `.agents/skills` and `.claude/skills` are identical copies.

### 7.3 Outdated (`npm outdated`, 2026-11-18)

| Package | Installed | Latest | Gap |
|---|---|---|---|
| `next` | 15.2.8 | 16.4.6 | major; 15.x line also has later patches (npm audit offers 15.5.29) |
| `@convex-dev/auth` | 0.0.94 | 2.0.0 | major (pre-1.0 → 2.x) |
| `convex` | 1.42.3 | 1.51.0 | minor |
| `convex-test` | 0.0.38 | 0.0.72 | many pre-1.0 releases |
| `recharts` | 2.15.3 | 3.11.0 | major |
| `lucide-react` | 0.485.0 | 1.75.0 | major |
| `eslint` / `eslint-config-next` | 9.23.0 / 15.2.4 | 10.15.0 / 16.4.6 | major |
| `vitest` | 3.2.4 | 5.1.1 | 2 majors |
| `tailwindcss` / `@tailwindcss/postcss` | 4.0.17 | 4.3.5 | minor |
| `react`, `react-dom` | 19.1.0 | 19.3.1 | minor |
| `@auth/core` | 0.41.1 | 0.41.3 | patch (fixes advisories) |
| others | | | `@reduxjs/toolkit` 2.8→2.14, `driver.js` 1.8→1.14, `date-fns` 4.1→4.4, patches for `jose`, `@eslint/eslintrc`, `@types/node`, `autoprefixer`, typography/forms |

### 7.4 Vulnerabilities (`npm audit`)
25 total (4 critical, 14 high, 5 moderate, 2 low). Production-relevant highlights: `next` 15.2.8 (critical; many advisories, a large share apply to App Router, middleware or `next/image`, none of which this app uses — `next/image` is not imported anywhere), `@auth/core` ≤0.41.2 (critical; fix via patch bump), `xlsx` (high, no fix on npm), `sharp` (transitive via Next, high), `lodash` (high, transitive). Details and applicability in doc 12 §5.

## 8. Asset organisation
- Icons/logo are SVG in `public/`; manifest icons are SVG only (no PNG sizes — iOS home-screen icons from SVG are unreliable; see doc 11/13).
- Fonts come from Google Fonts at runtime (`pages/_document.js:13-17`), not self-hosted; the service worker does not cache cross-origin requests, so offline launches fall back to system fonts.
- No image pipeline (`next/image` unused). Company logos are served from Convex storage URLs.

## 9. Existing documentation

| Document | Status | Notes |
|---|---|---|
| `README.md` | Partly stale | Accurate on Convex Auth key bootstrap, `promoteToSuperAdmin`, Convex deploy workflow. **Inaccurate:** "Everything runs on your machine. No Convex account is needed" — the active `.env.local` points at the cloud dev deployment and the README's own Deploy section says `dev:backend` pushes to `vibrant-stork-860`. `npx convex run seed:seedDemo` will fail: `seed.seedDemo` is a public mutation that calls `requireUser` (`convex/seed.ts:5-8`), and a CLI run has no user identity. "Supabase has been fully removed" is true for runtime, not for files (§3). |
| `AGENTS.md`, `CLAUDE.md` | Current | Point to `convex/_generated/ai/guidelines.md`. |
| `docs/plans/2026-07-24-convex-migration-and-ui-theme.md` (408 lines) | Historical | Supabase → Convex migration + "Tide Chart" theme plan; marked implementation-ready. Later superseded by the "charcoal" design-system pass (`design-system/pba-farm/MASTER.md`). |
| `docs/superpowers/specs/2026-08-11-farm-company-settings-design.md` + plan | Spec says "Approved — implementation in progress / shipped" | Draft → publish company settings; `convex/lib/farmRules.ts` and `companySettingsDrafts` exist. |
| `docs/superpowers/specs/2026-09-05-fish-cage-transfer-design.md` + plan (602 lines) | Spec says "Draft for review"; code exists (`convex/fishTransfers.ts`, `pages/fish-transfers.js`, commit `623b344`) | Spec status not updated after shipping. |
| `design-system/pba-farm/*.md` | Short | Palette and AI-assistant page notes. |
| `docs/MASTER-PROMPT.md` | Untracked | Owner's brief for this discovery. |

## 10. Architectural observations

1. **Pages Router + fully client-rendered app.** Fine for a logged-in ops tool and for PWA caching, but there is no server boundary for auth, headers, or data shaping. All authorization must live in Convex functions (it largely does — every public function calls `requireUser`, verified by a scan of 142 public functions; only `feed.createUsage`/`createIssue` delegate it to a helper that does call `requireUser`, `convex/feed.ts:626`).
2. **Supabase-shaped client layer on top of Convex.** `{ data, error }` service objects, imperative fetches, Redux thunks and a persisted Redux cache are carried over from the old stack. They negate Convex reactivity on about half of the screens and create three sources of truth on the client.
3. **Tenant isolation by in-memory filtering.** `listForCompany` filters arrays after `ctx.db.query(table).collect()`; 57 queries scan entire tables (all tenants) before filtering, although `by_company` indexes exist on most tables (doc 12 §6). Correct today, but cost and failure scale with the *total* data of all customers.
4. **Single shared dev Convex deployment acts as production.** Every developer machine with `.env.local` and the `main`-branch workflow all push to `vibrant-stork-860`. There is no staging/prod separation (doc 12 §7).
5. **Optional `companyId` on 21 tables** (`convex/schema.ts`), with "unscoped" rows treated as a separate pseudo-tenant (`tenancy.ts:23-25`). A legacy of the single-farm era; affects every multi-tenant design decision (doc 04/05).
6. **No error boundary, no monitoring, plain `Error` everywhere** (234 `throw new Error` in `convex/`, 0 `ConvexError`) — doc 12 §5b–5d.
7. **Dead weight is significant:** 5 dead components (~1,300 lines incl. `BulkUploadModal`), 3 dead lib services, 1 dead hook, 2 dead contexts mounted globally, 1 unregistered Redux slice, 8 stub pages behind redirects, dead Tailwind v3 config, Supabase SQL at root, 27k-line tree dumps.

## 11. Technical risks (repository level)

| # | Risk | Severity | Evidence |
|---|---|---|---|
| R1 | Shared dev deployment used as production; any `convex dev` from any branch changes live backend/schema | High | `.env.local` `CONVEX_DEPLOY_KEY=dev:…`, README Deploy, `convex-deploy.yml:3-5` |
| R2 | Next 15.2.8 and `@auth/core` 0.41.1 carry known advisories; `xlsx` has no npm fix | High | `npm audit` |
| R3 | Unbounded cross-tenant `.collect()` scans will hit Convex per-transaction read limits as data grows, breaking dashboards/exports for *every* tenant at once | High | doc 12 §6 |
| R4 | Frontend has no type checking and lint is non-gating | Medium | `jsconfig.json`; `next.config.mjs` `ignoreDuringBuilds`; `ci.yml` `continue-on-error` |
| R5 | `.env.example` contains a wrong Convex URL host (`.convex.site` for the client URL) | Medium | `.env.example:2` |
| R6 | `@convex-dev/auth` pinned to a 0.0.x pre-release two majors behind | Medium | `npm outdated` |
| R7 | Client state duplicated across Redux-persist / Contexts / Convex, persisted in localStorage across users | Medium | `store/index.js:32-36`, no purge on sign-out |
| R8 | CI on end-of-life Node 20; no `engines` pin | Low | `ci.yml:16` |

## 12. Areas requiring deeper inspection
- Whether the Vercel production frontend points at `vibrant-stork-860` (cannot be determined from the repo; Vercel project settings needed).
- Convex dashboard: backup/export configuration, deployment env vars (`JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL`), function error rates, current document counts per table (to size the `.collect()` risk).
- Whether Convex redacts plain `Error` messages on this deployment type (affects all user-facing validation messages once a prod deployment exists; doc 12 §5b).
- Migration plan for the Path B service layer → `useQuery` (doc 10).
- Resolved: #7–#13 are merged and deployed; #14 still needs a PR to `main`.

## Dependencies
Feeds docs 02–15 and the architecture/roadmap sets. Relies on doc 12 (health numbers) and doc 13 (integrations) for detail.

## Outstanding questions
1. Is there a Vercel production URL in use by the farm today, and which Convex deployment does it use?
2. Is a `prod:` Convex deployment planned, and who holds the Convex team admin rights?
3. Is Redux/redux-persist intentionally kept, or is it scheduled for removal?
4. Should the root-level Supabase SQL (`db.sql`, `migrations/`, `supabase/`, `lib/migrations/`) be archived or deleted?
