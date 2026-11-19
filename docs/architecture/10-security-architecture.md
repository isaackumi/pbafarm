# Architecture 10 — Security Architecture

Status: proposed. Binding decisions: D-005 (central `requireMember`, permission catalog, platform admin separate, no shared unassigned pool), D-009 (encrypted per-org credentials, hashed API keys, signed webhooks), D-010 (per-user offline storage cleared at sign-out), D-011 (`ConvexError` codes, error boundary, monitoring, separate prod and staging deployments, backups and restore drill, gating CI), D-013 (Phase 0: SEC-001, SEC-002, OPS-001). This document is the security view across `03` (tenancy), `08` (device), `09` (credentials) and the ops baseline. Retires TD-001 … TD-027, TD-131, TD-150 … TD-154.

## 1. Current state (summary of discovery)

| Area | Finding | Severity | Evidence | TD |
|---|---|---|---|---|
| Authentication | Password provider only, 6-char minimum, no reset, no verification, no MFA; tokens in `localStorage` (30-day session) | Medium | doc 07 §2 | TD-022, TD-023 |
| Offboarding | `active:false` ignored; sessions not revoked; removed companies keep access | Critical / High | doc 07 X1, X2 | TD-001, TD-002 |
| Tenant isolation | Post-read filtering; company-less users share a pool; super_admin bypasses tenant APIs | High | doc 07 X3, §3.8 | TD-003, TD-017 |
| Object ownership | 11 foreign ids not checked; `applyStockChange` trusts callers | High | doc 06 §4.3 | TD-005, TD-006 |
| Privileged functions | `backfillLocations` public cross-tenant; `seed.seedDemo`, `notifications.create` public; invite takeover; unverified invite claim | High–Medium | doc 07 V2–V4, V7 | TD-004, TD-007–TD-010 |
| Authorization granularity | Three global roles; money edits open to all members | High (product) | doc 07 V9 | TD-016 |
| Client-side only checks | `mustChangePassword`, route guards, location restriction | Medium | doc 07 §5 | TD-011, TD-018 |
| Browser hardening | No CSP or frame protection; open redirect after login | Medium / Low | doc 12 §5.5; doc 07 V16 | TD-014, TD-022 |
| Shared devices | Outbox, drafts, caches, LLM keys not per user, not cleared | High | doc 12 §5.2 | TD-026 |
| LLM | No rate limit, role gate or model allow-list; browser keys in plaintext | Medium | doc 07 V10 | TD-020, TD-021 |
| Abuse | No app-level rate limiting; account enumeration | Medium / Low | doc 07 §4.3 | TD-024, TD-025 |
| Audit | Actor-company stamping; gaps; no retention; no tamper evidence | Medium | doc 04 F20 | TD-027 |
| Ops | Dev deployment as prod, any laptop can push schema, no backups, no monitoring, plain `Error`, vulnerable deps | Critical–Medium | doc 12 §7–8, §5.6 | TD-131, TD-150–TD-154 |

Strength to keep: every public function already authenticates (doc 07 §1), and secrets are not committed (doc 12 §5.1).

## 2. Threat model (in scope)

| Actor | Goal | Main controls |
|---|---|---|
| Dismissed employee | Keep reading or altering farm data | Guard checks `active`, membership status; session revocation (§4) |
| Member of tenant A | Read or corrupt tenant B (ids from URLs, exports, ex-staff) | `requireMember` + `assertSameCompany` on every id; index-scoped reads; isolation tests (`03`) |
| Low-privilege member | Change prices, payments, counts, approve own requests | Permission catalog; segregation-of-duties option; corrections through reversal events (`05`) |
| Stranger signing up | Use the app or see others' data without approval | No tenant access without an approved organization membership (`03` step 1–3) |
| Invite interceptor | Take an admin seat | Token invitations, email verification, explicit acceptance (`03` §8 step 6) |
| Next user of a shared phone | See or send previous user's data | Namespaced storage, sign-out purge, replay only under the owning user (`08` §6) |
| XSS via content or dependency | Steal session tokens | CSP, no `dangerouslySetInnerHTML` of user data, relative-only notification links, dependency upgrades |
| Abusive client | Run up LLM/SMS cost, scrape, brute force | Rate limiter, budgets, quotas (§7) |
| Developer error / bad migration | Destroy production data | Separate prod deployment, restricted deploy keys, backups, rehearsed migrations (§9) |
| Compromised integration provider or webhook target | Pivot into the platform | Encrypted credentials, signature checks, SSRF limits (`09` §4, §6–7) |

Out of scope for this document: physical device theft beyond sign-out hygiene, provider-side compromise, Convex platform security.

## 3. Authentication

| Control | Phase | Design |
|---|---|---|
| Upgrade `@convex-dev/auth` (0.0.94 → current) and `@auth/core` (≥ 0.41.3) | 0 (patch) / PLAT (major) | Patch `@auth/core` in OPS-001; the auth major upgrade is its own tracked item with a test sign-in matrix (TD-154) |
| Email verification | ORG-001 | Password provider `verify` with OTP via the platform email channel (`09` §5); `emailVerificationTime` required before accepting invitations or being made owner |
| Password reset | ORG-001 | Password provider `reset` with emailed OTP; `/reset-password` page (route already declared public in `pages/_app.js`) |
| Password policy | ORG-001 | Minimum 10 characters, block the 10k most common passwords (bundled list), max 128; same rule in `userAccounts.assertPassword` |
| Session revocation | 0 (SEC-001) | Internal `revokeSessions(userId, { exceptSessionId? })` deleting `authSessions` and their `authRefreshTokens` (library indexes `userId`, `sessionId`); called on deactivate, membership removal from the only organization, password change (other sessions) |
| Forced password change | 0 (SEC-001) | Guard step 3 (`03` §5) |
| MFA | ENT-003 (implemented) | SMS/WhatsApp codes (SEC-007) plus TOTP authenticator apps for any user (`convex/mfaTotp.ts`, RFC 6238, ±1 step, replay-protected, 5-attempt lockout). Secrets encrypted with `INTEGRATIONS_ENCRYPTION_KEY`; 10 single-use recovery codes stored as SHA-256 hashes. A user with TOTP is always challenged per session; admins require 2FA per organization with the existing `require2fa` policy |
| SSO / OAuth | ENT-003 (implemented, OIDC) | Generic OIDC provider (`convex/lib/sso.ts`) enabled only when `AUTH_OIDC_ISSUER`/`AUTH_OIDC_ID`/`AUTH_OIDC_SECRET` are set; the profile never carries `role` and `emailVerified` is only true when the IdP asserts `email_verified`, so SSO never auto-links or escalates. SAML is out of scope: the only Auth.js path (BoxyHQ SAML Jackson) needs a separately operated service; customers with SAML-only IdPs use an OIDC broker (Entra ID, Okta, Keycloak, Auth0) |
| Token storage | ENT (evaluate) | Tokens stay in `localStorage` (plain React provider); CSP (§6) is the main mitigation. Moving to cookie-based sessions would need server rendering of auth, which conflicts with the static pages-router setup (D-001); revisit only with a concrete requirement |
| Human check | CF-003 (implemented) | Turnstile on sign-up, company registration, password reset and invite acceptance: `humanVerification.verify` calls `siteverify` (Effect `requestJson`), stores a hashed single-use ticket (5 min, purpose-bound) that the Password provider `authorize` wrapper, `companies.register` and `memberships.acceptInvite` consume. No-op when `TURNSTILE_SECRET_KEY` is unset |
| Login redirect | 0 (SEC-002) | Accept `next` only if it starts with `/` and not `//` or `/\` (TD-014) |
| Enumeration | ORG-001 | Generic sign-in and sign-up messages in the UI; `ConvexError` codes without the email; admin oracles reworded (TD-025) |

## 4. Authorization

The full model is in `03`. Security-relevant rules:

1. **Every public function starts with `requireMember(ctx, { permission, locationId? })` or `requirePlatformAdmin(ctx)`.** A meta-test scans `convex/**/*.ts` exports and fails the build if a public query/mutation/action lacks one (exceptions listed explicitly: `users.current`, auth library functions).
2. **Every dereferenced id is ownership-checked** with `assertSameCompany` — including ids inside arrays (`createBatch.records[].feedTypeId`) and storage ids (logo uploads recorded per company before `setLogo` accepts them, TD-015).
3. **`companyId` is never an argument** of a tenant function; it comes from the member context.
4. **Internal by default.** Migrations (`backfillLocations`), seeding, notifications to arbitrary users, reminders and anything called by the scheduler, crons or `httpAction`s are `internal*` (TD-004, TD-009, TD-010).
5. **Platform admins** act cross-tenant only through `convex/platform/*` and time-boxed support memberships, both audited into the tenant's log (TD-017).
6. **Money and stock edits** require explicit permissions (`inventory.prices.manage`, `finance.sales.correct`, `production.*.correct`, `production.stock.adjust`), and corrections are reversal events, not overwrites (`05`).
7. **Segregation of duties** for approvals is an organization setting (`03` §4).
8. **Site scope** is applied inside queries (`sitesToQuery`), never by trusting an optional client filter (TD-018).

### Phase 0 changes in current code (SEC-001, SEC-002)

| Item | Change | Files | Test |
|---|---|---|---|
| SEC-001 | `requireUser`: reject `active === false`, `mustChangePassword` (except `users.current`, `changePassword`), company not approved; `listForCompany`/`assertOwns` deny company-less non-platform users; revoke sessions on deactivate; `users.current` returns `accessState`; client signs out on `disabled` | `convex/lib/authz.ts`, `convex/lib/tenancy.ts`, `convex/users.ts`, `contexts/AuthContext.js` | Disabled, removed-company, company-less and must-change users refused across a sample of every module |
| SEC-001 | Unscoped-row audit and quarantine (`03` §8 steps 2–3) | `convex/platform/*` (new), migration | Zero unscoped rows |
| SEC-001 (recommended) | Purge per-user browser storage on sign-out; stop flushing another user's outbox (`08` §9 step 2) | `contexts/AuthContext.js`, `lib/offlineOutbox.js`, `hooks/usePersistedForm.js`, `store/index.js` | Component test |
| SEC-002 | `backfillLocations` → `internalMutation`, batched; remove the UI button | `convex/farmLocations.ts`, `pages/farm-locations.js` | Public API no longer exposes it |
| SEC-002 | Ownership checks: `feedTypeId` (4 daily paths), `supplierId`, `harvest.createSampling.cageId`, `sales.updateSale.customerId`, `inventory.createTransfer` sites, logo storage ids; ownership check inside `applyStockChange` | `convex/dailyRecords.ts`, `feed.ts`, `harvest.ts`, `sales.ts`, `inventory.ts`, `companies.ts`, `lib/feedLedger.ts` | Cross-tenant negative test per path |
| SEC-002 | `seed.seedDemo` internal; `notifications.create/createBulk` internal; `users.invite` refuses existing users and never touches super_admins; `users.update` cannot modify super_admins, last-admin guard; per-company biweekly batch-code uniqueness; login redirect fix | `convex/seed.ts`, `notifications.ts`, `users.ts`, `biweeklyRecords.ts`, `pages/login.js` | Negative tests |
| SEC-002 | Admin-only UI parity: hide or disable actions the backend refuses; admin-gate `createMany` bulk import, `feed.updateFeedType` price, `sales.updateSale` price/payment, `harvest.update` counts on the backend | Pages in TD-104, `convex/*` | Role tests |

### Support access (ENT-006)

Super-admins reach a tenant only through an explicit act-as session (`convex/actAs.ts`, table `actAsSessions`): reason required, 1–120 minutes, read-only unless `allowWrites` is set, one live session per admin. While live, `requireUser`/`requireMember` resolve the target organization with the `admin` role (platform functions are refused); every mutation in a write session is audit-logged under the tenant with the real actor and `auditLogs.actAsSessionId`; mutations in a read-only session fail with `ACT_AS_READ_ONLY`. Start and stop are audited in both the tenant and the platform log, sessions expire on their own, and the app shows a banner while one is live.

## 5. Data protection

| Data | Control |
|---|---|
| Tenant data at rest | Convex-managed storage; access only through authorized functions; no public queries without the guard |
| Integration credentials | AES-256-GCM, separate table, decrypt only in actions (`09` §4) |
| API keys | SHA-256 hash only; shown once; prefix lookup; constant-time compare (`09` §8) |
| Webhook signing secrets | Encrypted like credentials |
| File storage (logos now; photos, documents later) | `documents` metadata table with company and subject; type and size validated on attach; URLs issued only by an authorized query and never persisted; orphaned uploads deleted by a daily job (TD-015) |
| Personal data | Names, emails, phones in `users`, `customers`, `messageDeliveries.to`; retention policy per table (§8); export/delete on request handled by a platform function (ENT) |
| AI assistant | Context built server-side from internal queries (no client-supplied context), organization opt-in recorded with who enabled it and when; which provider received data is logged per request (`09` §9) |
| Browser storage | Only per-user namespaced data; no secrets (LLM browser keys removed); purge on sign-out (`08` §6) |

## 6. Web application hardening

`next.config.mjs` `headers()` for all routes (static export still served by Vercel with headers):

| Header | Value (initial) |
|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; connect-src 'self' https://*.convex.cloud wss://*.convex.cloud https://*.convex.site; img-src 'self' data: blob: https://*.convex.cloud; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` — start as `Content-Security-Policy-Report-Only`, tighten after a week; `'unsafe-inline'` for styles only because of runtime brand colours (`CompanySettingsContext`); fonts become self-hosted (`08` §8) |
| `X-Frame-Options` | `DENY` (legacy browsers) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(self), geolocation=(self), microphone=()` (camera for the QR scanner, geolocation for site coordinates) |
| `X-Content-Type-Options` | `nosniff` |

Other rules: notification links must be relative paths (validated on insert, checked again before `router.push`); no `dangerouslySetInnerHTML` with stored data (lint rule); the CSV importer replaced by a quoted-field parser; `xlsx` parsing stays out of the app (dead `BulkUploadModal` removed), export only.

## 7. Abuse and cost controls

`@convex-dev/rate-limiter` (component, installed once in `convex/convex.config.ts`):

| Bucket | Limit (initial) |
|---|---|
| Sign-up per IP-less key (email domain + hour) and global | 20/hour per email domain, 200/hour global |
| `companies.register` per user | 3 pending at a time |
| Invitations per organization | 50/day |
| Report exports per user | 20/hour |
| AI chat per user / per organization | 30/hour / 300/day, plus monthly token budget |
| Outbound SMS/WhatsApp per organization | Budget set by the organization; hard platform cap |
| Public API per key | 600/minute reads, 60/minute writes |

Convex Auth's own failed-sign-in limit (10/hour per account) stays.

## 8. Audit and retention

| Change | Design |
|---|---|
| Audit ownership | `auditLogs.companyId` = record's company; `actorCompanyId` = actor's; platform actions visible to the tenant (TD-027) |
| Coverage | Every public mutation writes an audit row through the guard's write helpers (meta-test like §4.1), including invitation accept, role and membership changes, password change, session revocation, support access, integration changes, API key creation/revocation |
| Content | Changed fields only (`previousValues`/`newValues` limited to keys in the patch), typed instead of `v.any()` where practical; never secrets |
| Tamper evidence | Append-only by API; optional hash chain per company (`prevHash`, `hash`) in ENT; nightly export to backups |
| Retention | Audit: 7 years default (configurable per organization for compliance); notifications 90/180 days (`07`); `domainEvents` 180 days; `messageDeliveries` 1 year; `idempotencyKeys` 30 days; jobs delete in batches per company |

## 9. Operational security (OPS-001, D-011)

| Control | Design |
|---|---|
| Deployments | New Convex **prod** deployment; **staging** deployment; `vibrant-stork-860` stays dev. Data moved to prod with export/import during a maintenance window (rehearsed on staging) |
| Deploy keys | Prod deploy key only in GitHub Actions environment `production` with required reviewers; developers keep dev keys; `.env.local` never holds prod keys |
| Pipeline | CI: lint (source only, gating), `tsc -p convex`, tests (including `convex/lib/*.test.ts`), build. Convex deploy runs only after CI passes; staging deploy on merge to `main`, prod deploy on tag; frontend and backend deployed together from the same commit (backend first for additive changes) |
| Backups | Convex scheduled backups on prod (plan permitting) plus a weekly `npx convex export` stored outside Convex; quarterly restore drill into a scratch deployment with an assertion script (counts per table, sample documents) |
| Errors | `ConvexError({ code, message })` for every user-facing failure so prod redaction does not hide them (TD-131); client maps codes to messages; React error boundary and `pages/_error.js` (TD-107) |
| Monitoring | Error tracking in the client (for example Sentry) and Convex log streaming to the same tool (plan permitting); alerts on function error rate, cron/automation failure (`automationRuns` failures), backup age, outbox `needs_attention` spikes |
| Dependencies | Patch `next` within 15.x, `@auth/core`; Dependabot/Renovate weekly; `npm audit --omit=dev` in CI as a warning, critical advisories applicable to the pages router as failures |
| Secrets | Convex env per deployment (`JWT_PRIVATE_KEY`, `JWKS`, `INTEGRATIONS_KEK_V*`, LLM keys, platform email key); `.env.example` corrected (TD-156); no `NEXT_PUBLIC_*` secrets |
| Access | Convex team and Vercel project roles reviewed; least privilege; offboarding checklist for developers |
| Node | CI on a supported Node LTS, `engines` pinned |

## 10. Security testing

- Tenant-isolation and permission suites from `03` §9 run in CI on every PR.
- Negative tests for each TD security row closed (one test minimum per row).
- Meta-tests: guard present on every public function; no public function reads `integrationSecrets`; no `v.any()` in new tables.
- Before the first prod deployment and yearly: an external review of authz and the public API.
- Migration rehearsals on staging snapshots (`@convex-dev/migrations` dry runs) before any prod backfill.

## 11. Migration and compatibility

| Change | What could break | Compatibility approach |
|---|---|---|
| Guard hardening (SEC-001) | Disabled users, removed companies and company-less users lose access (intended); company-less super_admins lose tenant views | Communicate before release; platform functions for super_admins; support access grant |
| Ownership checks (SEC-002) | Requests that relied on foreign ids fail (should be none legitimately) | Errors carry codes; monitoring for spikes after deploy |
| Admin-gating money edits | `user`-role staff who edited prices or payment status lose that | Announce; admins can grant via role templates once PERM ships |
| CSP | Inline scripts or third-party calls blocked | Report-only first |
| Session revocation on password change | Other devices signed out | Intended; message on next request |
| Prod deployment cutover | Downtime; deployment URL change for the frontend | Maintenance window; `NEXT_PUBLIC_CONVEX_URL` switched in the same Vercel deploy; dev remains for development |

## 12. Open questions

1. Does production data contain rows without `companyId`, and are any super_admins company-less (decides SEC-001 rollout care)?
2. Is self-service sign-up to remain open?
3. Which monitoring tool and Convex plan (log streaming, scheduled backups) are acceptable cost-wise?
4. Required audit retention by customers' regulators (7 years assumed)?
5. Should the AI assistant be limited to admins/managers by default?
