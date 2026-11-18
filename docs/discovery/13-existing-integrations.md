# 13 — Existing Integrations

Discovery stage: PART 9 (API integrations) and input to PART 10-F (Integration platform). Branch: `docs/discovery`. Date: 2026-11-18.

## Stage header

| Item | Value |
|---|---|
| Objective | List every external service, protocol, library-level integration and device capability the application actually uses, trace each from UI to backend, and give each a status. Record what is absent so the future integration platform (PART 10-F) starts from facts. |
| Files inspected | `convex/{auth,auth.config,http,crons,reminders,companies,reports,dailyRecords,biweeklyRecords,notifications}.ts`; `pages/api/llm/{chat,status}.js`; `lib/{llmClient,llmEnv,llmApiAuth,convexClient,convexBridge,offlineOutbox,companyService,currencyUtils,notificationService}.js`; `lib/tours/*`; `components/{AiAssistant,DailyUploadPage,BulkDailyUploadForm,BulkBiweeklyUploadForm,BulkUploadModal,TourProvider}.js`; `contexts/{AuthContext,NotificationContext}.js`; `pages/{_app,_document,export,company-settings,report}.js`; `pages/cages/qr-codes.js`; `public/{sw.js,manifest.webmanifest}`; `.github/workflows/*`; `.env.example`; `package.json`. |
| Method | Grep across all source (excluding `node_modules`, `.next`, `archive/`, `_generated`) for `fetch(`, provider SDK names (resend, sendgrid, nodemailer, twilio, whatsapp, sms, smtp, mailgun, stripe, sentry, posthog, datadog, gtag, mapbox, leaflet, google maps, weather), `httpAction`, `action(`, `ctx.storage`, `ctx.scheduler`, `navigator.*` device APIs; then read each hit. |
| Completion status | Complete for code. Account-side configuration (Vercel, Convex dashboard, LLM provider consoles) cannot be verified from the repo. |

## Summary

| # | Integration | Kind | Status | Confidence |
|---|---|---|---|---|
| 1 | Convex (database, functions, realtime) | Platform | Implemented and working | High |
| 2 | Convex Auth — Password provider | Auth | Implemented but incomplete (no reset, no verification, deactivation not enforced) | High |
| 3 | Google OAuth sign-in | Auth | Completely missing (stub that returns an error; existed in the Supabase era) | High |
| 4 | Convex file storage (company logo) | Storage | Implemented and working (narrow) | Medium |
| 5 | Convex cron (daily digest) → in-app notifications | Scheduler | Implemented but potentially defective (scale) | High |
| 6 | In-app notifications (bell) | Messaging | Implemented but incomplete (not reactive) | Medium |
| 7 | Email (any provider) | Messaging | Completely missing | High |
| 8 | SMS | Messaging | Completely missing | High |
| 9 | WhatsApp | Messaging | Completely missing | High |
| 10 | Push notifications (Web Push) | Messaging | Completely missing | High |
| 11 | LLM assistant (Gemini default; OpenAI, OpenRouter, Anthropic, Groq, custom) | AI | Implemented but potentially defective | Medium |
| 12 | Next.js API routes `/api/llm/*` | Server API | Implemented and working (with gaps) | High |
| 13 | Convex HTTP router / webhooks | Inbound API | Completely missing beyond auth routes | High |
| 14 | Public/partner API (REST, API keys) | Outbound API | Completely missing | High |
| 15 | PWA (manifest + service worker) | Device | Implemented and working (app shell only) | Medium |
| 16 | Offline outbox (daily entry batches) | Device/sync | Implemented but potentially defective | High |
| 17 | QR code generation (cage labels) | Device | Implemented and working | High |
| 18 | QR scanning in-app | Device | Completely missing (relies on the phone's camera app) | High |
| 19 | Excel/JSON export (`xlsx`); CSV option | File I/O | Implemented and working (CSV option is defective) | High |
| 20 | CSV bulk import (daily, biweekly) | File I/O | Implemented but potentially defective | High |
| 21 | Excel import (`xlsx` parse) | File I/O | Implemented but not reachable (dead component) | High |
| 22 | Printing (report, QR sheet) | Browser | Implemented and working | Medium |
| 23 | Charts (`recharts`) | UI library | Implemented and working | High |
| 24 | Guided tours (`driver.js`) | UI library | Implemented and working | Medium |
| 25 | Google Fonts | CDN | Implemented and working (online only) | High |
| 26 | Maps / GIS | — | Completely missing | High |
| 27 | Weather | — | Completely missing | High |
| 28 | IoT / sensors (DO, temperature probes) | — | Completely missing (values typed by hand) | High |
| 29 | Accounting (QuickBooks, Xero, Sage) | — | Completely missing | High |
| 30 | Payments (Stripe, mobile money) | — | Completely missing | High |
| 31 | Currency / FX rates | — | Completely missing (static currency list) | High |
| 32 | Monitoring / analytics (Sentry, PostHog, Vercel Analytics) | Ops | Completely missing | High |
| 33 | Vercel (frontend hosting) | Ops | Unknown – requires verification | Low |
| 34 | GitHub Actions (CI + Convex deploy) | Ops | Implemented but incomplete | High |

---

## 1. Convex platform
- Client: one `ConvexReactClient` (`lib/convexClient.js:3-11`, falls back to `https://placeholder.convex.cloud` if `NEXT_PUBLIC_CONVEX_URL` is missing — fails silently rather than loudly). Imperative calls go through `ConvexHttpClient` with a cached JWT (`lib/convexBridge.js:21-53`).
- Server: 26 tables, 142 public functions, `convex/http.ts` (auth routes only), `convex/crons.ts` (1 job).
- Deployment: `vibrant-stork-860` (dev). Doc 12 §7.
- No Convex components installed (no `convex/convex.config.ts`): no rate-limiter, aggregate, workflow, Resend, or migrations components.

## 2. Authentication — Convex Auth
- `convex/auth.ts:6-25`: `Password<DataModel>` provider only. `profile()` lower-cases email and forces `role: 'user'`; `validatePasswordRequirements` requires ≥6 characters.
- `convex/auth.config.ts`: single provider `{ domain: process.env.CONVEX_SITE_URL, applicationID: 'convex' }`.
- `convex/http.ts`: `auth.addHttpRoutes(http)` (JWKS/OIDC endpoints for Convex Auth).
- Client: `contexts/AuthContext.js:60-80` calls `signIn('password', formData)` with `flow = signIn | signUp`; sign-out at `:95-101`.
- Admin-created accounts: `userAccounts.createWithPassword` and `changePassword` actions (`convex/userAccounts.ts:18,84`), with `users.mustChangePassword` forcing `/account?force=1` (`pages/_app.js:79-91`).
- Missing: password reset (no email provider; `/reset-password` listed as a public route in `pages/_app.js:70` but there is no page), email verification (`/verify-email` likewise), MFA, OAuth/SSO, session revocation on deactivation (doc 12 §5.2).
- Package state: `@convex-dev/auth` 0.0.94 (latest 2.0.0), `@auth/core` 0.41.1 (advisories; 0.41.3 available).
- **Status: Implemented but incomplete.**

## 3. Google sign-in
`contexts/AuthContext.js:85-92` `signInWithGoogle` returns `Error('Google sign-in is not configured. Use email and password.')`. No Google provider in `convex/auth.ts`, no login button references it. Git history shows "sign with google completed" (2025-03-31) from the Supabase era; it was not ported. **Completely missing.**

## 4. File storage (Convex)
Company logo only: `companies.generateLogoUploadUrl` (admin) → browser `fetch(uploadUrl, { method: 'POST', body: file })` (`pages/company-settings.js:194-200`; duplicate implementation in `lib/companyService.js:66-79`) → `companies.setLogo` (deletes previous blob) / `clearLogo` (`convex/companies.ts:790-844`). No server-side MIME/size validation; orphaned uploads are not cleaned up. No other attachments anywhere. **Implemented and working** for this one use.

## 5. Scheduler / cron
`convex/crons.ts:8-13` — daily at 16:00 UTC, `internal.reminders.dailyDigest`. For each approved company: active cages without a daily record today → notification to every active user (link `/daily-entry?cages=…`); feed types at/below `minimumStock` → notification to admins (link `/stock-levels`). Deduplicated with `notifications.by_dedupe`. Admin manual trigger: `reminders.runForMyCompanyNow`. Covered by `convex/reminders.test.ts` (3 tests). Scale defects (single transaction for all companies; `.take(2000)` cross-tenant window on `dailyRecords.by_date`; `users.take(5000)`) in doc 12 §6.2. **Implemented but potentially defective.**

## 6. In-app notifications
Table `notifications`; functions in `convex/notifications.ts` (`listForCurrentUser`, `getUnreadCount`, `markRead`, …). UI: bell in `components/Header.js:14,35` via `contexts/NotificationContext.js`, which loads through the HTTP client once per `user` change (`:15-35`), not a live `useQuery`; new cron notifications appear only after reload or user-object change. The only producer is the reminder cron (no notifications on approvals, transfers, harvests). **Implemented but incomplete.** Confidence Medium (behaviour inferred from code, not observed).

## 7–10. Email, SMS, WhatsApp, Web Push
Searched for `resend`, `sendgrid`, `nodemailer`, `mailgun`, `smtp`, `twilio`, `africastalking`/`sms`, `whatsapp`, `wa.me`, `mailto:`, `tel:`, `PushManager`, `pushManager`, `Notification.requestPermission`, `web-push` across source and `package.json`: **no hits** (the only "weather" hit is a placeholder string at `components/DailyUploadPage.js:823`). No Convex actions perform outbound HTTP besides the two password actions (which do not call external services). The service worker has no `push` handler (`public/sw.js`). **All Completely missing.** Consequences: no password-reset mail, no approval/reminder delivery outside the app, no alerts for field staff who are not logged in.

## 11. LLM assistant
Flow:
1. `pages/_app.js:24` lazy-loads `components/AiAssistant.js` on every page.
2. Visibility gated by `api.companies.aiAssistantStatus` (`convex/companies.ts:565-584`): enabled when `company.settings.aiAssistantEnabled === true`; super admins without a company always enabled.
3. On each question, the browser fetches `api.reports.farmContextForAi` (`convex/reports.ts:516-567`: user email/name/role, every cage's name/status/count/stocking date, last-30-day feed kg/cost/mortality, feed stock levels) and embeds it as JSON in a system prompt (`AiAssistant.js:175-186`), plus the last 8 messages.
4. `lib/llmClient.js:338-361` `chatCompletion`: if a browser key exists (localStorage), call the provider **directly from the browser** (`chatCompletionWithKey`, including Anthropic with `anthropic-dangerous-direct-browser-access`); otherwise POST to `/api/llm/chat` with the Convex JWT.
5. `pages/api/llm/chat.js`: verifies JWT via `api.users.current`, re-checks `aiAssistantStatus`, picks provider (`requestedProvider` → `LLM_DEFAULT_PROVIDER` → first configured), reads key from server env, calls provider, returns `{ text }`.

Providers (`lib/llmClient.js:16-87`): `openai` (gpt-4o-mini default), `gemini` (gemini-2.0-flash default; the env file configures only `GEMINI_API_KEY`), `openrouter`, `anthropic` (`claude-3-5-sonnet-latest`), `groq`, `custom` (OpenAI-compatible, base URL from server env only).

Issues:
- **Model IDs are hard-coded and dated** (`gemini-1.5-*`, `gemini-2.0-*`, `claude-3-5-*-latest`, `mixtral-8x7b-32768`). Several are retired or scheduled for retirement by providers; a retired default makes every request fail. Unknown – requires verification against provider catalogs; confidence Medium.
- **No rate limit, quota, max message size or role restriction** on `/api/llm/chat`; the client controls `messages` and `model` (doc 12 §5.4).
- **Browser-key path is broken for env keys**: `readPublicProviderKeys()` reads `process.env[name]` dynamically, which Next.js does not inline into the client bundle, so `NEXT_PUBLIC_*_API_KEY` never reach the browser (`lib/llmEnv.js:46-52`). User-pasted keys still work and are stored in plaintext localStorage (`pbafarm_llm_settings`), not cleared on sign-out.
- **Data sharing**: farm data plus the user's email and name are sent to a third-party model provider; there is no per-company consent record beyond the on/off toggle, and no record of which provider received what.
- `farmContextForAi` reads all `cages`, `dailyRecords` and `feedTypes` across tenants before filtering (doc 12 §6.1).
- No tool use / function calling; the assistant is read-only Q&A over a JSON snapshot. No conversation persistence (state lives in React only).

**Status: Implemented but potentially defective** (works for the configured Gemini path today; fragile model IDs, no cost controls).

## 12. Next.js API routes
Only `pages/api/llm/chat.js` (POST) and `pages/api/llm/status.js` (GET, returns which providers have keys, as booleans). Both require a Convex bearer token (`lib/llmApiAuth.js`). The service worker explicitly bypasses `/api/` (`public/sw.js:28`). **Implemented and working**, gaps as above.

## 13. Inbound HTTP / webhooks
`convex/http.ts` registers only Convex Auth routes. No `httpAction`, no webhook receivers (payments, IoT, messaging callbacks), no signature verification utilities. **Completely missing.**

## 14. Outbound/public API
No API-key model, no REST/GraphQL surface for third parties, no per-organisation credentials table, no outbound webhook subscriptions. Relevant to PART 10-F, which requires organisation-supplied SMS/email/WhatsApp credentials, webhooks, weather, IoT and accounting connectors: **none of the plumbing exists** (no encrypted-secret storage, no integration table, no action layer that calls external APIs, no retry/queue). **Completely missing.**

## 15. PWA
- `public/manifest.webmanifest`: name/short_name "PBA Farm", `start_url: /daily-entry`, `display: standalone`, theme `#18181b`, SVG icons only (`icon.svg`, `icon-maskable.svg`), shortcuts to Daily entry and Dashboard. No PNG icons (Android installability and iOS home-screen icons are more reliable with PNG 192/512 + `apple-touch-icon` PNG; `pages/_document.js:8` points `apple-touch-icon` at an SVG).
- `public/sw.js` (60 lines): precaches `/daily-entry`, `/dashboard`, manifest, icon; cache-first for `/_next/static/*` and images; network-first for navigations with fallback to the cached page then to `/daily-entry`; ignores non-GET, cross-origin (so Convex and Google Fonts are never cached) and `/api/`. Registered only in production (`pages/_app.js:28-37`).
- Gaps: static cache name `pbafarm-v1` never bumped per release and never pruned; no update prompt ("new version available"); no Background Sync; no push.
- **Status: Implemented and working** for app-shell offline launch. Data is not available offline (Convex queries need the network), so only the daily-entry form is useful offline.

## 16. Offline outbox
- `lib/offlineOutbox.js`: localStorage list under one global key `pbafarm:outbox:daily-batch`; `enqueue`, `flushOutbox(send)`, `isNetworkError`, `cleanError`. Records `lastError` per item so rejected batches are shown rather than retried forever.
- Used only by `components/DailyUploadPage.js` (daily feed/mortality/water batch): queues when `navigator.onLine === false` or on network-type errors (`:425-449`); flushes on mount and on the `online` event (`:349-381`) via `dailyRecordService.createBatch` → `api.dailyRecords.createBatch` (atomic; `convex/dailyRecords.ts:363-365`).
- Defects: (a) **not scoped to the user** — a different user signing in on the same phone flushes the previous user's queue under their own identity; not cleared on sign-out; (b) no idempotency key — a batch whose response was lost is re-sent and rejected as "already exists", shown to the user as a failure; (c) only daily entry is covered (stocking, harvest, biweekly sampling, feed issue have no offline path); (d) concurrent flush triggers (mount + `online`) are not guarded by a lock; the server duplicate check prevents double counting. (e) Lookups (cages, feed types) are loaded online; a cold offline start with an empty form cannot pick cages unless the page was opened while online.
- **Status: Implemented but potentially defective.**

## 17–18. QR codes
- Generation: `pages/cages/qr-codes.js:2,23-34` uses `qrcode` to render SVG for each cage encoding `${window.location.origin}/daily-entry?cage=<cageId>`; page has a print button (`:61`). The encoded origin is whatever host the admin used when printing (a label printed from `localhost` or a preview URL is wrong forever).
- Consumption: `components/DailyUploadPage.js:189-202` reads `?cage=` / `?cages=` and pre-adds those cages to the batch.
- Scanning: no in-app scanner (`BarcodeDetector`, `getUserMedia`, `html5-qrcode`, `jsqr` not found). Workers use the phone's camera app, which opens the browser (not necessarily the installed PWA).
- Labels encode the raw Convex document id; no short code, no signature. Ids are not secrets (access still requires sign-in and tenant checks).
- **Generation: Implemented and working. Scanning: Completely missing.**

## 19–21. Spreadsheet import/export
- **Export** (`pages/export.js`): calls `api.reports.exportBundle` (or `cages.list`, `stocking.listStockingHistory`) and writes either `.xlsx` (`XLSX.utils.json_to_sheet` / `writeFile`, `:16-25`) or `.json` (Blob download, `:66-78`). A "CSV" option appears in the format select (`:150`), but the download branch only distinguishes `json` from everything else (`:82-94`), so **choosing CSV downloads an `.xlsx` workbook** — a small but real defect. `exportBundle` performs cross-tenant full scans (doc 12 §6.1). `xlsx` is statically imported (115 kB page chunk). **Implemented and working** for xlsx/json; CSV option **Implemented but potentially defective**.
- **CSV import** (`pages/bulk-upload.js` → `components/BulkDailyUploadForm.js`, `BulkBiweeklyUploadForm.js`): hand-written parser `text.split(/\r?\n/)` then `line.split(',')` (`BulkDailyUploadForm.js:17-31`) — breaks on quoted fields, embedded commas (e.g. notes "fed, then rain"), semicolon-delimited locale exports and BOMs. Rows are sent in one `api.dailyRecords.createMany` / `api.biweeklyRecords.createMany` call with no array size cap; large files will exceed a single mutation's limits. `createMany` silently **skips** existing cage/date rows (`convex/dailyRecords.ts:610-616`, `continue`) while `createBatch` rejects them — inconsistent duplicate semantics. `feedPrice`/`feedCost` come from the CSV rather than the ledger. **Implemented but potentially defective.**
- **Excel import**: `components/BulkUploadModal.js` (732 lines) parses `.xlsx/.xls/.csv` with `XLSX.read` and generates templates, but nothing imports the component. **Dead code** (would be "Implemented but incomplete" if wired). It is also the only place the vulnerable `xlsx` parser would process untrusted files.

## 22. Printing
`window.print()` on `/report` (`pages/report.js:303`) and `/cages/qr-codes` (`:61`). No PDF generation library. **Implemented and working** (browser-dependent).

## 23. Charts
`recharts` 2.15.3 in `components/Dashboard.js`, `pages/cages/{index,analytics}.js`, `pages/cages/analytics/{growth,harvest}.js`, `pages/feed-management/overview.js`, `pages/inventory/{analytics,overview}.js`, `pages/feed-purchases.js`. Adds ~110 kB first-load JS to each chart route; not lazy-loaded. Recharts 3 is available. **Implemented and working.**

## 24. Guided tours
`driver.js` via `lib/tours/tourEngine.js` (275 lines) and `lib/tours/systemWalkthrough.js` (515), provider `components/TourProvider.js`. Progress in `sessionStorage` (`pbafarm:tour:v1`), completion in `localStorage` (`pbafarm:tour:completed`) — per browser, not per user. **Implemented and working** (not exercised).

## 25. Google Fonts
`pages/_document.js:11-17` loads Figtree, JetBrains Mono, Lexend from `fonts.googleapis.com`. Third-party request on every cold load (privacy/GDPR consideration in some markets) and unavailable offline because the SW skips cross-origin requests. Could be self-hosted with `next/font`. **Implemented and working** online.

## 26–31. Absent domain integrations
Searched for map libraries (`leaflet`, `mapbox`, `google.maps`, `maplibre`), geolocation (`navigator.geolocation`), weather APIs, MQTT/IoT, accounting SDKs, payment SDKs (`stripe`, `paystack`, `flutterwave`, mobile-money), FX APIs: **none found.**
- Farm locations (`farmLocations` table) store text metadata; no coordinates or map view.
- Water quality (`dissolvedOxygen`, `temperatureC`, `secchiCm` on `dailyRecords`, `convex/schema.ts:252-273`) is typed manually; no sensor ingestion.
- Sales/customers (`convex/sales.ts`, tables `customers`, `sales`) have no invoicing, payment capture or accounting export beyond the generic export page.
- Currency: `lib/currencyUtils.js` static list (GHS default, USD, EUR, …) with company-level choice; no exchange rates, so multi-currency reporting is not possible.
**All Completely missing.**

## 32. Monitoring / analytics
No Sentry, PostHog, Datadog, LogRocket, Vercel Analytics/Speed Insights, Google Analytics. **Completely missing** (doc 12 §5d).

## 33. Vercel
Inferred from README ("Frontend (Vercel)") and the Vercel bot branch `origin/vercel/react-server-components-cve-vu-t2mqt7` (2026-09-02). No `vercel.json`, no `.vercel/` in the repo. Project settings, env vars, domains and which Convex URL production uses cannot be verified. **Unknown – requires verification.**

## 34. GitHub Actions
`ci.yml` (test → lint [non-gating] → build) and `convex-deploy.yml` (`npx convex deploy` on `main` with a dev deploy key; no tests run before deploy). **Implemented but incomplete** (doc 12 §7).

---

## Integration readiness for PART 10-F (gap summary)

| Requirement in PART 10-F | What exists | Gap |
|---|---|---|
| Org-supplied SMS credentials | nothing | provider abstraction, encrypted credential storage per company, Convex actions, delivery log, retries |
| Org-supplied email credentials | nothing (not even platform email) | same; also needed for password reset / invites |
| WhatsApp | nothing | Business API integration, template approval, webhook receiver |
| API keys | none issued; LLM keys only as platform env vars or user localStorage | per-org API keys (hashed), scopes, rate limits |
| Webhook endpoints | none (in or out) | `httpAction` receivers with signature checks; outbound subscriptions with retry |
| Weather | none | provider + location coordinates on `farmLocations` |
| IoT devices | none | ingestion endpoint, device registry, time-series storage strategy |
| Accounting | none | chart-of-accounts mapping, sync jobs |
| Credential protection | LLM keys server-only (good); user keys plaintext in localStorage (bad) | secret storage outside readable tables, admin-only write, never returned to clients |

## Dependencies
Doc 01 (stack/env), doc 07 (auth model), doc 12 (security, scale, deployment). Feeds `architecture/09-integration-architecture.md` and `architecture/08-mobile-and-offline-architecture.md`.

## Outstanding questions
1. Which LLM provider/model is actually used in production, and what is the monthly spend?
2. Is SMS/WhatsApp the expected channel for field-staff reminders (likely, for Ghanaian farm sites)? Preferred providers?
3. Should password reset be email-based, SMS-based, or admin-only?
4. Are cage QR labels already printed and deployed on site? (Changing the URL format or host would invalidate them.)
5. Are there spreadsheets currently imported regularly (format, size) that the CSV importer must accept?
