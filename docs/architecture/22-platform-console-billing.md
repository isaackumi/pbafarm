# 22 — Platform console and billing foundation

Status: implemented (PLAT-101..113). Owner runbook: `docs/ops/platform-console-dns.md`.

pbafarm is a multi-tenant SaaS: every organization (`companies` row) is a tenant. This doc covers the **platform console**, the operator's dashboard across all tenants, and the provider-agnostic **billing model** behind plans, limits, trials and suspension.

## 1. Who and where

| Concern | Decision |
|---|---|
| Operators | Users with role `super_admin` ("platform admins"). |
| Gate | `requireConsoleAdmin` (`convex/platform/access.ts`) = `requirePlatformAdmin(ctx, { ignoreActAs: true })` + a verified two-step session (`sessionMfaVerified`). Every console function calls it first. Non-admins get `FORBIDDEN`; an admin without a verified session gets `MFA_REQUIRED`. |
| Host | `console.heitechinc.com` (env `NEXT_PUBLIC_PLATFORM_CONSOLE_HOST`, comma-separated; default also allows `console.localhost` for dev). Same Vercel project and build as the tenant app. |
| Audit | Every console mutation writes a `platformEvents` row (actor, action, tenant, target, details). Actions on a tenant also write the tenant's `auditLogs` (`platform.<action>`) so the organization sees what support did. |

`ignoreActAs`: an admin in an act-as session still uses the console as themselves, and console reads are never scoped to the impersonated tenant.

## 2. Host routing (`middleware.js`, `lib/platformHost.js`)

`routeForHost({ host, pathname, consoleHosts })` is a pure function (unit-tested in `lib/platformHost.test.js`):

| Host | Path | Result |
|---|---|---|
| console | `/platform/**` | next |
| console | static (`/_next/**`, any path with a file extension) | next |
| console | auth (`/login`, `/verify`, `/verify-email`, `/reset-password`, `/account`, `/404`, `/500`, `/_error`) | next |
| console | `/api/**` | 404 |
| console | anything else | 307 → `/platform` |
| other | `/platform/**` | 404 (rewrite to `/404`) |
| other | anything else | next |

Middleware is presentation only. Security headers stay in `next.config.mjs` `headers()` (applies to `/:path*`, including middleware rewrites and redirects). The console layout (`components/platform/PlatformLayout.js`) does not redirect non-admins (that would loop through `/dashboard` → `/platform`); it shows a sign-in / access-denied card, and the server refuses every call.

## 3. Console pages (`pages/platform/`)

| Page | Backend |
|---|---|
| `/platform` overview: tenants by state, active users 7/30d, records/day (14d), MRR/ARR per currency, trials ending in 7d, overdue, SMS/WhatsApp/email/AI usage and cost (30d) | `platform/overview:kpis` |
| `/platform/tenants`: search, filter (state, plan, subscription status), sort, 50 per page, sites, users, active users, last activity, health score | `platform/tenants:list` |
| `/platform/tenants/[id]`: profile, sites, members, 60-day usage, subscription, invoices, payments, limits/feature overrides, notes, audit trail. Actions: approve/reject, suspend, reactivate, change plan, extend trial, grant AI/SMS credits, create invoice, record payment, read-only act-as (`actAs.start`, `allowWrites: false`), export data + download | `platform/tenants:*`, `platform/billing:*`, `companies.approve/reject`, `actAs.start` |
| `/platform/billing`: plans CRUD, subscriptions, invoices (void), payments, dunning | `platform/billing:*` |
| `/platform/usage`: SMS, WhatsApp, email, AI calls/tokens/cost per tenant (7/30/90d) | `platform/usage:byTenant` |
| `/platform/audit`: platform audit log, filter by tenant and action prefix | `platform/audit:list` |
| `/platform/admins`: list, promote by email, demote (not yourself, not the last admin) | `platform/admins:*` |

Health score (0–100) combines recent activity, active users vs members, and subscription status (`healthScore` in `convex/billing/model.ts`). Platform-wide reads are bounded by `PLATFORM_SCAN_LIMIT`; responses say `truncated` when the cap is hit.

## 4. Billing model (`convex/billing/tables.ts`)

All money is **integer minor units** per currency (`amountMinor`); XOF has no minor unit.

| Table | Purpose |
|---|---|
| `plans` | `code`, `name`, `prices[{currency, amountMinor}]` (GHS, XOF, USD), `interval` month/year, `limits {sites, users, units, aiCredits, smsIncluded}` (absent = unlimited), `features` flags, `trialDays`, `isDefault`, `active`, `sortOrder`. |
| `subscriptions` | `companyId`, `planId`, `status` trialing/active/past_due/suspended/cancelled, `currentPeriodStart/End`, `trialEndsAt`, `graceEndsAt`, `pastDueAt`, `seats`, `currency`, `provider` + `providerRef`, `limitOverrides`, `featureOverrides`, granted AI/SMS credits. |
| `billingInvoices` | Number `INV-YYYYMM-NNNN`, lines, total, paid, status open/paid/void/uncollectible, due date, `renewsSubscription`. |
| `billingPayments` | `method` manual/bank/mobile_money/card, `provider`, `providerRef`, unique `idempotencyKey`. |
| `billingCreditGrants` | AI/SMS credit grants with reason and grantor. |
| `platformUsageDaily` | One row per organization per UTC day (nightly rollup). |
| `tenantNotes`, `platformEvents` | Console notes and platform audit log (not exported to tenants; `platformEvents` is platform-owned). |

`companies` gains `suspendedAt`, `suspensionReason`, `suspensionSource` (`platform` | `billing`), `suspendedBy`.

### Entitlements and plan limits (`convex/lib/planLimits.ts`)

- `entitlements(ctx, companyId)` = the latest subscription's plan limits/features merged with the subscription's overrides. **No subscription = unlimited** (so nothing breaks before the backfill).
- `assertPlanLimit(ctx, companyId, kind)` throws a user error (details `reason: PLAN_LIMIT`) with a friendly upgrade message ("Your Starter plan includes 1 site…"). Wired into `farmLocations.create` (sites), `cages.create` (units), and member creation/invites in `lib/memberships.ts` / `users.ts` (users = active memberships).
- `hasFeature` / `assertFeature` read the effective flags. They are available but not yet wired into existing features (PLAT-107 remaining).

### Payments are idempotent

`applyPayment` (`convex/billing/ops.ts`) looks up `idempotencyKey` first: the same key returns the existing payment (`duplicate: true`); the same key with a different tenant or amount is refused (`IDEMPOTENCY_MISMATCH`). The console form carries one key per open form. A payment that settles an invoice marked `renewsSubscription` moves the subscription to `active` for a new period and lifts a suspension **only if** `suspensionSource === 'billing'`.

## 5. Tenant suspension (PLAT-104)

- `requireUser` refuses members of a suspended organization with `TENANT_SUSPENDED` (`convex/lib/authz.ts`), so every tenant query and mutation is blocked, including the public API (`convex/publicApi.ts`) and phone sign-in. `super_admin` is never blocked.
- Only `billing/tenant:myBilling` passes `allowSuspended`, so owners (`org.settings.manage`) can still see what is owed.
- Client: `users.current.companySuspended` → access state `TENANT_SUSPENDED` (`lib/offlineSession.js`) → only `/suspended` and `/billing` render; both use a bare shell because the app shell's queries are refused.
- Console suspend also revokes the members' sessions.

## 6. Provider boundary (`convex/billing/provider.ts`)

`BillingProvider` is an Effect `Context.Service` (`createCheckout`, `verifyPayment`) with one `Layer` per provider (D-019). `manual` is implemented: no network, staff record payments. `paystack` and `stripe` are `TODO(PLAT-107)` stubs that fail with "not available yet". The provider choice is pending research (Paystack for GHS/XOF mobile money + card is the likely first adapter; Stripe for USD card). A real adapter must use `requestJsonAs` through the `Fetch` service, `retries: 0` for charge-creating calls unless the vendor de-duplicates on the idempotency key, and verify webhook signatures before calling `applyPayment`.

## 7. Lifecycle (`convex/billing/lifecycle.ts`, `model.ts`)

`nextTransition(sub, now, grace)` is pure:

```
trialing --trialEndsAt passed--> past_due (grace = BILLING_GRACE_DAYS, default 7, renewal invoice issued)
active   --period ended unpaid--> past_due
past_due --graceEndsAt passed--> suspended (+ organization suspended, source billing)
suspended --renewal invoice paid--> active (suspension lifted)
```

`runDaily` (cron 05:00 UTC) pages through `trialing`, `active` and `past_due` subscriptions by index in batches of 100 and reschedules itself while more remain. Each transition notifies the owners/admins (in-app + email, link `/billing`) and records a `platformEvents` row. Console **Reactivate** on a billing suspension returns the subscription to `past_due` with fresh grace.

New organizations get a trial on the default plan when approved (`companies.approve`). Existing organizations: `billing/lifecycle:backfillSubscriptions` (dry run by default, idempotent, paginated).

## 8. Tests

`convex/platform.test.ts`: every console function refuses a tenant admin (`FORBIDDEN`) and a super admin without a verified session (`MFA_REQUIRED`); suspension blocks tenant reads and writes but not `myBilling`; site/unit/user limits enforced with no-subscription = unlimited; cron transitions trial → past_due → suspended and payment → active; platform suspension not lifted by payment; idempotent payment recording and mismatch refusal; approve starts a trial; backfill dry run writes nothing; admin promote/demote rules; overview/list response shapes. `lib/platformHost.test.js`: host routing table.

## 9. Remaining

- Paystack / Stripe adapters, checkout from `/billing`, webhooks (PLAT-107).
- Wire `hasFeature` into feature entry points (AI assistant, WhatsApp, public API, webhooks, hatchery) once plans are priced.
- AI credit and SMS allowance enforcement against `aiCredits` / `smsIncluded` (counted and shown; not yet blocking); link SMS top-ups (`pages/topup*`) to credit grants.
- WhatsApp cost per message (counts only today).
- Legacy users without a membership row are not counted toward the users limit.
- Invoice PDF / email delivery; taxes.
