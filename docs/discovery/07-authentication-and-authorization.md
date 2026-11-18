# 07 — Authentication and Authorization

Discovery stage: MASTER-PROMPT PART 6 (Phase Three). Branch `docs/discovery`. Everything below comes from reading the source. Nothing was run against a deployment.

---

## Objective

Document how users register, sign in and keep a session, how an identity maps to a `users` row, and how roles, tenant (company) scoping and location scoping are enforced. Then check every public Convex function for authorization gaps and list each vulnerable or questionable function with its exploit, severity and a suggested fix. No code was changed.

## Files inspected

- Auth core: `convex/auth.ts`, `convex/auth.config.ts`, `convex/http.ts`, `convex/userAccounts.ts`, `convex/users.ts`, `convex/schema.ts` (users, companies, userInvites, auditLogs, notifications)
- Authz helpers: `convex/lib/authz.ts`, `convex/lib/tenancy.ts`, `convex/lib/feedLedger.ts` (`applyStockChange`)
- All public function modules: `convex/audit.ts`, `biweeklyRecords.ts`, `cages.ts`, `companies.ts`, `dailyRecords.ts`, `farmLocations.ts`, `feed.ts`, `fishTransfers.ts`, `harvest.ts`, `health.ts`, `inventory.ts`, `notifications.ts`, `reminders.ts`, `reports.ts`, `sales.ts`, `seed.ts`, `stocking.ts`, `crons.ts`
- Tests: `convex/*.test.ts` (one cross-tenant negative test, in `convex/harvest.test.ts:125`)
- Frontend: `pages/_app.js` (`AuthWrapper`), `contexts/AuthContext.js`, `components/ProtectedRoute.js`, `components/Sidebar.js`, `components/Header.js`, `pages/login.js`, `pages/signup.js`, `pages/register-company.js`, `components/CompanyRegistrationsPage.js`, `lib/companyService.js`, `lib/userService.js`, `pages/company-settings.js`, `pages/pending-approval.js`, `pages/account.js`
- Next API: `pages/api/llm/chat.js`, `pages/api/llm/status.js`, `lib/llmApiAuth.js`, `lib/llmEnv.js`, `lib/llmClient.js`, `components/AiAssistant.js`
- Library internals used as evidence: `node_modules/@convex-dev/auth` v0.0.94 (`providers/Password.js`, `server/implementation/{tokens,sessions,refreshTokens,rateLimit}.js`, `mutations/retrieveAccountWithCredentials.js`, `react/client.js`); `convex` v1.42.3

---

## Findings

### 1. Summary

| Area | Status | Confidence |
|---|---|---|
| Email + password sign-up and sign-in (Convex Auth) | Implemented and working | High |
| Session management (JWT + refresh token) | Implemented and working (library defaults, no customisation) | High |
| Identity → `users` row | Implemented and working | High |
| Roles (`user` / `admin` / `super_admin`) | Implemented but incomplete | High |
| Backend tenant isolation (company) | Implemented but potentially defective (good baseline; several holes, see §4) | High |
| Location-level access | Partially implemented (field and helper exist; nothing ever assigns locations) | High |
| Company registration and approval | Implemented but potentially defective (approval state not enforced afterwards) | High |
| User deactivation | Implemented but potentially defective (sets a flag nothing reads) | High |
| Invitations | Implemented but potentially defective (no email verification, no expiry, can take over existing users) | High |
| Multi-company membership | Completely missing (one `users.companyId`) | High |
| Forced password change | Implemented but incomplete (frontend-only) | High |
| Password reset / email verification / MFA | Completely missing | High |
| Rate limiting (app level) | Completely missing (only Convex Auth's built-in failed-sign-in limit) | High |
| Audit logging | Implemented but incomplete (gaps; no tamper evidence) | High |

Every one of the 142 public queries, mutations and actions calls `requireUser`, `getAuthUserId` or `api.users.current`, which I checked with a script over all `convex/*.ts`. So there is **no unauthenticated data access**. The problems are wrong scoping (who sees what) and missing role checks.

### 2. Authentication

#### 2.1 Provider and wiring
- `convex/auth.ts:5-25` configures a single provider, `Password<DataModel>` from `@convex-dev/auth`. `profile()` lowercases the email and **hard-codes `role: 'user'`** (`:13`), so a sign-up request cannot pick its own role. The extra params from `signUpWithEmail` (`contexts/AuthContext.js:71-83`) are only `email`, `password`, `flow` and `name`.
- `validatePasswordRequirements` (`convex/auth.ts:16-20`) only requires `length >= 6`. `assertPassword` in `convex/userAccounts.ts:11-15` applies the same rule.
- `convex/auth.config.ts:1-8` uses the standard Convex Auth issuer: `domain: process.env.CONVEX_SITE_URL`, `applicationID: 'convex'`.
- `convex/http.ts:6` calls `auth.addHttpRoutes(http)`. This adds the OIDC/JWKS routes and nothing custom.
- No OAuth provider. `signInWithGoogle` returns a "not configured" error (`AuthContext.js:85-92`). The provider sets no `reset` or `verify`, so there is **no password reset and no email verification**. `/reset-password` and `/verify-email` are listed as public routes in `pages/_app.js:76`, but neither page exists under `pages/`.

#### 2.2 Registration (sign-up)
1. `pages/signup.js:39` → `signUpWithEmail` → `signIn('password', {flow:'signUp'})` (`AuthContext.js:71-83`) → Convex Auth `signIn` action → `createAccount`. This writes `authAccounts` and a new `users` row with `role:'user'` and no `companyId`.
2. The client then routes to `/dashboard` (`pages/signup.js:47`). `AuthContext.js:30-33` automatically calls `users.claimInvite` whenever the signed-in user has no `companyId` (§3.5).
3. Without an invite the user stays company-less. Through `listForCompany` (§3.2) they get **full use of the app inside a shared "no company" pseudo-tenant**.
4. Company registration: `/register-company` → `components/CompanyRegistrationsPage.js:92` → `lib/companyService.js:178` → `companies.register` (`convex/companies.ts:217-298`). It inserts a `companies` row with `status:'pending'` and `submittedByUserId`, rejects a duplicate `code`, and rejects callers that already have a `companyId`. The submitter is **not** linked to the company until approval. The only in-app link to `/register-company` is on `pages/company-settings.js:247`, which is wrapped in `ProtectedRoute requiredRole="admin"` (`:84`). A fresh `user`-role sign-up therefore has no navigation path to it and has to type the URL. No query lets a submitter see the status of their own registration.
5. Approval: super_admin only, `companies.approve` (`convex/companies.ts:315-395`). It sets `status:'approved'`, picks the submitter (or an explicit `userId`, or a lookup by `contactEmail`), sets that user's `companyId` and `role:'admin'`, creates a "Main farm" `farmLocations` row and sets `activeLocationId`. `companies.reject` (`:397`) and `companies.remove` (`:433`, a soft remove that sets `status:'rejected'`) only change the company row.
6. `companies.status` is **read by almost nothing**. Only `reminders.dailyDigest` (`convex/reminders.ts:125-127`) and `farmLocations.backfillLocations` (`:205`) read it. No access path checks it, so members of a rejected or removed company keep full access (finding X2).

#### 2.3 Login
`pages/login.js:29` → `signInWithEmail` → `signIn('password', {flow:'signIn'})` → `retrieveAccount`. The library returns `InvalidAccountId`, `InvalidSecret` or `TooManyFailedAttempts` (`retrieveAccountWithCredentials.js:23-31`) and throws them as `Error(result)`. `login.js:32-36` maps the first two to one friendly message. **Nothing checks `users.active` at sign-in** (finding X1).

The post-login redirect follows `?next=` when it `startsWith('/')` (`pages/login.js:42-45`). `//evil.example` passes that check. That is a likely open redirect: Next treats a protocol-relative URL as external and does a full navigation (confidence Medium; not exercised).

#### 2.4 Session management
- Library defaults apply because `convexAuth({...})` passes no `jwt` or `session` options. Access JWTs are RS256, signed with `JWT_PRIVATE_KEY`, and last **1 hour** (`tokens.js:4,7-8`). `sub = userId|sessionId` (`tokens.js:24`). Sessions last **30 days** in total (`sessions.js:4`), with a 30-day inactivity limit and a 10-second refresh-token reuse window (`refreshTokens.js:2-3`). Refresh is handled by the library's `refreshSession` mutation.
- Client storage: `ConvexAuthProvider` (`pages/_app.js:42`) is the plain React provider, not the Next.js server variant, so tokens sit in **`localStorage`** under `__convexAuthJWT` and `__convexAuthRefreshToken` (`react/client.js:14-15`). Any XSS can steal a 30-day session.
- **No `middleware.ts`** and no server-side rendering auth. Every page guard runs in the browser (§5).
- `contexts/AuthContext.js:23` mirrors the token into `lib/convexBridge` so imperative `databaseService` calls are authenticated. `lib/llmClient.js:12` sends it as `Authorization: Bearer` to `/api/llm/*`.
- Sign-out: `convexSignOut()` (`AuthContext.js:94-101`). **Nothing revokes sessions server-side** when a user is deactivated, a company is removed, or a password changes (`userAccounts.changePassword`, `convex/userAccounts.ts:84-121`, only calls `modifyAccountCredentials`). The last point is confidence Medium, from library reading.

#### 2.5 Identity → `users` row
`schema.ts:15` spreads `authTables` and then overrides `users` (`:17-35`) with the extra fields `role`, `companyId`, `active`, `mustChangePassword`, `locationIds` and `activeLocationId`. `getAuthUserId(ctx)` parses the JWT `sub` into a `users._id`. `requireUser` (`convex/lib/authz.ts:7-17`) loads that row and throws `Not authenticated` / `User not found`. It **does not check `active`, `mustChangePassword` or the company's status.** `users` has only the `email` index; there is no `by_company` (noted at `convex/reminders.ts:84`).

### 3. Authorization model

#### 3.1 Roles
- Stored in `users.role` (`schema.ts:25-27`) as one of `'user' | 'admin' | 'super_admin'`. A missing value means `user`.
- Ordering lives in `requireRole` (`convex/lib/authz.ts:19-28`): super_admin > admin > user. The frontend `hasRole` copies it (`contexts/AuthContext.js:115-120`).
- How a user gets each role:
  - `user`: by default at sign-up (`auth.ts:13`).
  - `admin`: when a super_admin approves their company registration (`companies.ts:359-362`), through `users.update` by an admin or super_admin (`users.ts:97-133`), through `users.invite` (`:136-208`) or `userAccounts.createWithPassword` (`userAccounts.ts:18-81`) with `role:'admin'`, or through `claimInvite`.
  - `super_admin`: through `users.promoteToSuperAdmin`, an **internal** mutation that can only be run from the CLI or dashboard (`users.ts:278-291`), or through `users.update` when the caller is already a super_admin (`:114-121`).
- There are no finer permissions (no "can approve stocking", "finance", "read-only" and so on). `lib/permissionService.js` is a thin wrapper over the same three roles.

#### 3.2 Tenant scoping helpers (`convex/lib/tenancy.ts`)
- `listForCompany(user, rows)` (`:18-27`) does the filtering **in memory after reading the rows**:
  - super_admin → all rows
  - user with `companyId` → rows where `companyId` matches
  - user **without** `companyId` → rows where `companyId` is missing
  
  Almost every read and per-id write check uses it (`allowed = await listForCompany(user,[doc]); if(!allowed.length) …`).
- `assertOwns` (`:34-43`) applies the same rule as an assertion. It is used in `dailyRecords`, `stocking`, `harvest`, `biweeklyRecords` and `sales`.
- `writeCompanyId(user)` (`:63-65`) returns `user.companyId`. Writes therefore get the caller's company, or `undefined` for company-less users and company-less super_admins. Many inserts use `(await writeCompanyId(user)) ?? cage.companyId`.
- `writeLocationId` (`:86-108`) checks that the location is active and belongs to the caller's company, **but only when `user.companyId` is set** (`:99-106`). A company-less user can attach any company's `locationId` to their own unscoped rows. Severity Low.
- `assertCompanyAccess` (`authz.ts:30-38`) is **never called**; it is dead code.
- Consequence of the "no company → unscoped rows" rule: everyone who has signed up but has no company, plus every company-less super_admin's writes, shares **one pseudo-tenant**. Each of them can read and edit the others' cages, feed, sales and so on. Any **legacy rows written before tenancy without `companyId`** are visible to every new sign-up. Whether such rows exist in production is unknown (see Outstanding questions).

#### 3.3 Location-level access
- `users.locationIds` exists (`schema.ts:32-33`; comment: "empty/undefined = all company locations") and `assertLocationAccess` (`tenancy.ts:68-80`) honours it for role `user`.
- **No mutation or UI ever writes `locationIds`.** A repository grep found it only in the schema, `tenancy.ts`, `farmLocations.ts:36` and a read in `AuthContext.js:46`. Location restriction is therefore inert.
- Even if it were populated, it is enforced only in `farmLocations.list/getActive/setActiveLocation` and inside `writeLocationId`. List queries take `locationId` as an optional filter (`listForCompanyAndLocation`, `tenancy.ts:51-61`) and never check it against the user's assignment. Status: Partially implemented.

#### 3.4 Role checks on operations
Admin-gated (`requireRole(user,'admin')`):
- all deletes and voids (`cages.remove`, `dailyRecords.remove`, `harvest.remove`, `health.remove`, `biweeklyRecords.remove`, `sales.removeSale`, `feed.softDelete*`, `feed.voidPurchase`, `stocking.removeStocking`)
- approvals and rejections (stocking, top-up, fish transfer)
- inventory adjustment, transfer and reversal
- company settings, logo, farm locations create/update
- user management, customers, audit reads
- `reminders.runForMyCompanyNow`
- negative-stock overrides (`feedLedger.ts:205,229`)
- manual fish-count edits on cages (`cages.ts:252-254`)

Super_admin-gated: `companies.listPending/approve/reject/remove/list`.

Open to any authenticated member: everything else, including several financially or operationally sensitive writes (§4, class d).

#### 3.5 Invitations
They exist (`userInvites` table, `schema.ts:137-145`):
- `users.invite` (admin) assigns an **existing** user immediately (`users.ts:150-176`). For an unknown email it upserts one `userInvites` row per email (`:178-197`).
- `users.claimInvite` (any user without a company, called automatically by `AuthContext.js:30-33`) joins whatever company the invite names, with its role (`users.ts:252-271`).
- No expiry, no token, no list or revoke API, no email sent.
- Because sign-up does **not verify email ownership**, whoever registers the invited address first takes the seat, including `admin` seats (finding V3).
- Because there is one invite row per email, a second company's admin who invites the same email overwrites the first company's invite (`users.ts:182-188`).

`userAccounts.createWithPassword` (admin action) creates a login-ready account with a temporary password and `mustChangePassword:true`, then calls `internal.users.finalizeCreatedUser` (`users.ts:294-334`).

#### 3.6 Multi-company membership
Not possible. `users.companyId` is a single optional id (`schema.ts:28`). `companies.register` refuses users who already have one (`companies.ts:257-259`). `invite` refuses users in another company unless the caller is super_admin (`users.ts:156-162`). There is no membership table and no company switcher. Status: Completely missing.

#### 3.7 Approval workflows (operational)
- `stocking`, `topupHistory` and `fishTransfers` have a `pending_approval` → `approved`/`rejected` status, controlled by company settings (`stockingRules.requireApprovalFor*`).
- Approve and reject are admin-only and tenant-checked.
- Gaps:
  - **no segregation of duties**: an admin can approve their own submission.
  - **transfer-linked stockings and top-ups can be approved directly** through `stocking.approveStocking`/`approveTopup`, which do not check whether a `fishTransfers` row references them. This adds fish to the destination cage without the source decrement that `approveFishTransfer` → `applyFishTransfer` performs. `listPendingApprovals` hides these rows in the UI (`stocking.ts:656-669`), but the backend does not refuse them.

#### 3.8 Super-admin cross-tenant powers
A super_admin:
- passes every `listForCompany`/`assertOwns` check, so they can read and **write** every company's records through the normal tenant APIs, approve any company's stockings, and so on.
- can approve, reject or remove companies, list all companies with user counts, and read all audit logs.
- can send notifications to anyone, grant `super_admin` (`users.update`), and invite users out of other companies (`users.invite`).
- sees **every company's rows mixed together** in dashboards and reports (`reports.dashboardSummary` and the rest aggregate across tenants), which is a correctness problem for any super_admin who also belongs to a company.
- with no company, writes (`writeCompanyId` → `undefined`) into the shared unscoped pseudo-tenant.

There is no "act as company" mode and no separate audit of super_admin cross-tenant access. `aiAssistantStatus` always enables AI for company-less super_admins (`companies.ts:569-573`).

### 4. Authorization sweep of all public functions

Classification: **(a)** no auth · **(b)** auth but no tenant scoping · **(c)** takes a document id without an ownership check · **(d)** role check missing for a destructive or admin operation · **(e)** OK (authenticated, tenant-scoped, role-appropriate).

No function is in class (a). Unless noted, "OK" means the function uses `listForCompany`/`assertOwns` correctly. The cross-cutting issues X1–X3 (§4.2) affect **every** function.

#### 4.1 Per-function classification

| Module | Function (line) | Class | Note |
|---|---|---|---|
| audit | list (29), getByUser (118), getSummary (144) | e | admin. `list` for super_admin reads the newest 3×limit rows globally |
| audit | getByTable (83) | e* | takes rows globally by table, then filters by tenant, so a company admin can get an incomplete result (functional) |
| biweeklyRecords | list (29), get (52), update (184), remove (230) | e | |
| biweeklyRecords | create (64), createMany (137) | e* | `by_batch_code` uniqueness is **global across tenants**, which gives a cross-tenant existence oracle and lets one tenant squat on another's codes. `createMany` is used by the admin-only Bulk Upload page, but the backend has no role check |
| cages | list, get, getActive, growth, growthAll, create, remove, analytics | e | `remove` hard-deletes and leaves child rows orphaned (integrity, not authz) |
| cages | update (218) | d | any member can set `status`, `currentWeight`, ABW and dates. Only the counts are admin-only |
| companies | listPending, approve, reject, remove, list | e | super_admin. `remove` is not enforced afterwards (X2) |
| companies | register (217) | e* | a user can file unlimited pending registrations and squat on company codes |
| companies | get, updateSettings, aiAssistantStatus, getCurrentCompany, getEffectiveSettings, getSettingsDraft | e | |
| companies | saveSettingsDraft (665) | e* | `draft: v.any()` is stored unvalidated (size and shape) |
| companies | publishSettings (704) | c | `draft.logoStorageId` is copied into `companies.logoStorageId` unchecked (`:742-744`). See V11 |
| companies | generateLogoUploadUrl (790), setLogo (800), clearLogo (826) | c / e | `setLogo` accepts any `_storage` id and deletes the previous one. `clearLogo` writes no audit log |
| dailyRecords | list, listForDate, get, remove | e | `listForDate` uses `take(500)` across all tenants for a date before filtering (functional) |
| dailyRecords | create (337), createBatch (365), update (444), createMany (581) | **c** | **`feedTypeId` is not ownership-checked** (V1). `createMany` writes no audit log |
| farmLocations | list, getActive, ensureDefault, setActiveLocation, create, update | e | |
| farmLocations | backfillLocations (195) | **d** | **company admin can run a global, cross-tenant migration** (V4) |
| feed | listSuppliers, createSupplier, updateSupplier, softDeleteSupplier, listFeedTypes, softDeleteFeedType, listPurchases, updatePurchase, voidPurchase, listUsage, createUsage, createIssue | e | |
| feed | createFeedType (234) | c | `supplierId` is not checked |
| feed | updateFeedType (285) | c + d | `supplierId` is not checked. Any member can change `pricePerKg` (drives feed cost and P&L) |
| feed | createPurchase (362) | d (policy) | any member can add stock through a purchase. Only void and edit are admin-only |
| fishTransfers | all 5 | e | |
| harvest | list, get, suggestFcr, remove, listSampling, createFromSampling | e | |
| harvest | create (206) | d (policy) | any member can post a complete harvest, which empties the cage and closes the cycle |
| harvest | update (263) | d | any member can change `estimatedCount`/`harvestType`, which re-posts fish counts on the cage. This gets around the admin-only count edit in `cages.update` |
| harvest | createSampling (347) | c | `args.cageId` is not checked (`:370`). It can point at another tenant's cage id |
| health | list, create, remove, activeWithdrawals | e | |
| inventory | listStockLevels, listTransactions, createAdjustment, reverseTransaction, listLots, listAlerts, stockTally | e | |
| inventory | createTransfer (249) | c | `fromLocationId`/`toLocationId` are not checked for ownership (`:270-279`). An admin can tag lots with a foreign location, and the foreign location's name is read |
| notifications | listForCurrentUser, getUnreadCount, markRead, markAllRead, deleteNotification | e | |
| notifications | create (100), createBulk (139) | **d** | **any member can send arbitrary title, message and link** to colleagues. Company-less users can send to any company-less user, including a company-less super_admin (V7). No UI calls these |
| reminders | runForMyCompanyNow (137) | e | |
| reports | dashboardSummary, dashboardKpis, exportBundle, getProductionMetrics, productionReport, farmContextForAi, getCagePnL, listCagePnL | e* | tenant-scoped. P&L and revenue are open to every role (policy). Full-table `.collect()` scans are an availability risk |
| sales | listCustomers, createCustomer, updateCustomer, listSales, createSale, removeSale, harvestSaleSummary | e | |
| sales | updateSale (283) | c + d | `customerId` is not checked (`:328-332`), which leaks a foreign customer's name. Any member can change price and payment status. No over-sale check on edit |
| seed | seedDemo (5) | d | any member can inject demo cages into a production company that has no cages |
| stocking | listStockingHistory, getStocking, getTopup, createStocking, suggestBatchNumber, updateStocking, removeStocking, rejectStocking, listTopupHistory, createTopup, rejectTopup | e | |
| stocking | approveStocking (385), approveTopup (552) | e* | can approve transfer-linked rows directly, which bypasses `applyFishTransfer` (§3.7). An admin can approve their own submission |
| stocking | listPendingApprovals (632) | e* | `take(100)` by status **across all tenants**, then filters. One company's queue can hide another's (functional) |
| userAccounts | createWithPassword (18) | e | admin. Audit is written in `finalizeCreatedUser` |
| userAccounts | changePassword (84) | e* | does not revoke other sessions and writes no audit log |
| users | current, get, list, listDirectory, reactivate | e | `reactivate` writes no audit log |
| users | update (97) | d | an admin can demote or rename a super_admin who shares their company, and there is no last-admin guard |
| users | invite (136) | **d** | can take over **any company-less user, including a company-less super_admin**, and overwrite their role (V2) |
| users | deactivate (210) | e (ineffective) | correct checks, but the flag is never enforced (X1) |
| users | claimInvite (252) | **c** | binds by unverified email (V3) |
| auth | signIn, signOut (library actions) | public by design | |

Internal functions (`users.emailExists`, `promoteToSuperAdmin`, `finalizeCreatedUser`, `clearMustChangePassword`, `farmLocations.ensureForCompanyInternal`, `reminders.dailyDigest`) cannot be called by clients and were not classified. `promoteToSuperAdmin` writes no audit log.

#### 4.2 Vulnerability and questionable-behaviour register

| ID | Where | Exploit scenario | Severity | Suggested fix (describe only) |
|---|---|---|---|---|
| X1 | `lib/authz.ts:7-17` `requireUser`; `users.ts:210-232` `deactivate`; `auth.ts` | An admin "deactivates" a dismissed employee. `active:false` is written, but `requireUser` never reads it, sign-in does not check it, and existing sessions are not revoked. The ex-employee keeps reading and writing everything for up to 30 days per session and can simply sign in again. The UI suggests offboarding worked | Critical | Reject `active === false` in `requireUser` (and in `users.current`, so the client signs out). Delete the user's `authSessions`/`authRefreshTokens` on deactivate. Block sign-in for inactive users through an auth callback. Add a convex-test negative case |
| X2 | All tenant functions; `companies.ts:397-467` | A super_admin rejects or removes a company (for example for non-payment or abuse). Members keep their `companyId` and every API keeps serving and accepting their data. `status` is only read by the cron | High | Resolve the caller's company in `requireUser` (or a `requireMember` helper) and refuse unless `status === 'approved'`. On remove, optionally revoke member sessions |
| X3 | `lib/tenancy.ts:18-27,34-43,63-65` | Anyone who signs up (no approval) is company-less, sees every unscoped row (legacy pre-tenancy data, other company-less users' data, company-less super_admin writes), and can edit it. Two strangers who sign up share one farm | High (Critical if production has legacy rows without `companyId`) | Treat "no company" as "no tenant data": return `[]` and refuse writes until the user belongs to an approved company. Backfill or quarantine rows that have no `companyId`. Route company-less users to `/register-company` or a waiting page |
| V1 | `dailyRecords.ts:337,365,444,581` → `deductDailyFeed` (`:37-82`) → `feedLedger.applyStockChange` (`lib/feedLedger.ts:188-193`) | A user in company A sends `dailyRecords.create({cageId: <A cage>, feedTypeId: <B feed type>, feedAmount: 500, …})`. B's `feedTypes.currentStock` and lots drop by 500 kg. A `feedUsage` row and a `feedInventoryTransactions` row are written **with B's companyId** (`companyId: feedType.companyId ?? …`), and B's feed name and price leak into A's record (`createBatch :410-415`, `update :495-501`). Requires B's feed type id (ids are not guessable but do leak through URLs, exports and ex-staff) | High | `assertOwns(user, feedType)` in `insertDailyRecord`, `createBatch`, `update` and `createMany`. Also add a defensive check inside `applyStockChange` that `feedType.companyId` matches the user's company (except for super_admin) |
| V2 | `users.ts:136-176` `invite` | Admin of A invites the email of the platform owner (a company-less super_admin). The `existing.companyId &&` guard is false, so the owner is patched to `companyId: A, role: 'user'`, losing super_admin; recovery needs the CLI. The same path lets A grab any company-less user, including someone whose company registration is pending, which then makes `approve` fail with "User already belongs to a company" | High | Never change an existing user's role or company through invite. Create a pending membership that the invitee must accept. Refuse to touch super_admins. Write audit entries |
| V3 | `users.ts:252-271` `claimInvite`; no email verification (`auth.ts`) | Admin invites `newhire@farm.com` as `admin`. An attacker who knows or guesses the address signs up with it first (no verification) and `AuthContext` auto-claims the invite, so the attacker joins as admin. Also `companies.approve` falls back to a user lookup by `contactEmail` (`companies.ts:332-338`) | High | Turn on email verification (Password provider `verify`, or an OTP provider) and require `emailVerificationTime` before claiming. Use signed, expiring single-use invite tokens. Show invites for explicit acceptance |
| V4 | `farmLocations.ts:195-325` `backfillLocations` | Any company admin can run it. It reads **all** companies, cages and the 11 location tables, patches other tenants' rows with `locationId`, creates locations for other companies, and rewrites other tenants' users' `activeLocationId`. Large tables can also hit Convex transaction limits (denial of service) | High | Make it `internalMutation` (run from CLI) or require super_admin. Batch it with pagination or a migration component |
| V5 | `_app.js:95-102`, `account.js:25-40`; backend has no check | A user created with a temporary password (`mustChangePassword:true`) can call every Convex function directly, so a leaked or shared temporary password stays fully usable | Medium | Enforce in `requireUser` (allow only `users.current` and `changePassword` while the flag is set) |
| V6 | `users.ts:97-133` `update`; `:136-208` `invite` | An admin can demote or rename a super_admin who shares their company, demote every other admin (no last-admin guard), and change role through `invite` | Medium | Forbid non-super_admins from modifying super_admin users. Keep at least one active admin per company |
| V7 | `notifications.ts:100-178` | Any member (role `user`) posts notifications to any colleague with an arbitrary `title`, `message` and `link`. `Header.js:82-84` does `router.push(n.link)`, so an external phishing URL opens on click (whether `javascript:` URLs are blocked by Next was not verified). Company-less users can target company-less super_admins. No UI uses these mutations | Medium | Make them internal (system-generated notifications only), or admin-only with `link` restricted to same-origin relative paths |
| V8 | `stocking.ts:385-427,552-595` | An admin approves a transfer-linked pending stocking or top-up directly. The destination gains fish and the source is never decremented, so fish are created in the books. Also allows self-approval | Medium | Refuse direct approval when a `fishTransfers` row references the record and route it through `approveFishTransfer`. Optionally require approver ≠ creator |
| V9 | `cages.update :218`, `harvest.update :263`, `harvest.create :206`, `feed.updateFeedType :285`, `feed.createPurchase :362`, `sales.updateSale :283`, `seed.seedDemo :5` | A `user`-role member can change cage status and weights, re-post harvest counts, change feed price, inflate stock with purchases, change sale price and payment status, and seed demo data. The frontend hides some of these from non-admins (`pages/sales.js:35`) | Medium (policy) | Decide on a permission matrix. Gate financial and master-data edits (price, payment status, purchases, harvest edits) behind admin or a dedicated permission |
| V10 | `pages/api/llm/chat.js` | Authenticated through a Convex bearer token (`lib/llmApiAuth.js`), and gated by the company AI flag. **No rate limit, no role gate, client-chosen `model`, unbounded `messages`**, so any member can run up the server's LLM bill or pick an expensive model. `farmContextForAi` sends company data to a third-party provider. `NEXT_PUBLIC_*_API_KEY` keys, if set, are shipped to browsers (`lib/llmEnv.js:12-19`) | Medium | Per-user and per-company rate limit (for example `@convex-dev/rate-limiter`), a model allow-list, a size cap, no `NEXT_PUBLIC_*` LLM keys in production, documented data-sharing consent |
| V11 | `companies.ts:704-746,800-844` | An admin sets `logoStorageId` (through the draft or `setLogo`) to another company's storage id, which they would have to learn. A later `setLogo`/`clearLogo` then **deletes that file**. Logo URLs from `storage.getUrl` are public and do not expire | Low | Accept a storage id only straight from an upload by the same user (record uploads per company) and check ownership before deleting |
| V12 | `dailyRecords.ts:174`, `stocking.ts:638-654`, `audit.ts:94-98` | Global `take(N)` followed by an in-memory tenant filter: as the platform grows, a tenant's own rows get pushed out (missing approvals or audit rows) | Medium (functional) | Use the composite indexes that already exist (`by_company_status`, `by_company`) and filter in the index |
| V13 | `users.ts:178-188` | Admin of B invites an email already invited by A, and the single invite row is re-pointed to B | Low | One invite per (company, email) and explicit acceptance |
| V14 | `harvest.createSampling :370`, `feed.createFeedType/updateFeedType` (`supplierId`), `inventory.createTransfer`, `sales.updateSale` (`customerId`), `tenancy.writeLocationId :99-106` | Foreign ids are stored as references and their names leak through joins (supplier name in `listStockLevels`, customer name in the sale). Low impact, but it breaks referential tenancy | Low | `assertOwns` every referenced id. Make `writeLocationId` refuse a foreign location when the user has no company |
| V15 | `biweeklyRecords.ts:92-96,156-160,203-210` | Global batch-code uniqueness gives a cross-tenant existence oracle and lets one tenant pre-claim another's codes | Low | Scope uniqueness per company (index `by_company_batch_code`) |
| V16 | `pages/login.js:42-45` | `?next=//evil.example` passes `startsWith('/')`, so the user lands on the attacker's page after a real login | Low (confidence Medium) | Require `startsWith('/') && !startsWith('//')`, or allow-list routes |

#### 4.3 Specific checks requested

- **List queries when `companyId` is undefined.** No list returns all companies to an ordinary user. Super_admins get all rows by design. Company-less users get **all unscoped rows** (X3). `audit.list`, `audit.getSummary`, `inventory.listStockLevels`, `listTransactions` and `listLots` branch to a full-table read when the user has no company, then apply `listForCompany`. That is correct but costly.
- **Audit-log tamperability.**
  - No public mutation updates or deletes `auditLogs` (grep: the only writer is `logAudit`, `lib/tenancy.ts:150-172`).
  - Actor and company come from the server (`requireUser`), so users cannot forge `userId`. `newValues` is caller-supplied argument data, which is fine.
  - Weaknesses:
    - no hash chain or other tamper evidence, and anyone with Convex dashboard or deploy-key access can edit rows.
    - mutations that write no audit row: `dailyRecords.createMany`, `companies.clearLogo`, `users.reactivate`, `users.claimInvite`, `users.promoteToSuperAdmin` (the most privileged action), `userAccounts.changePassword`, `farmLocations.setActiveLocation`.
    - `previousValues` stores whole documents (for example the full company row in `companies.updateSettings :552-558`).
    - no retention policy.
  - Reads are admin-only and tenant-scoped.
- **Notification spoofing.** Possible inside a tenant and among company-less users (V7). System notifications (mortality alerts `dailyRecords.ts:296-314`, reminders) are generated server-side.
- **File storage URL exposure.** Storage is used only for company logos. `generateUploadUrl` is admin-only. URLs come from `ctx.storage.getUrl` and are unauthenticated and long-lived, which is acceptable for logos. Uploads that are never attached are orphaned (storage abuse, Low). See V11.
- **Rate limiting.** The app has none. Convex Auth limits failed password attempts to 10 per hour **per account** (`rateLimit.js:1`), not per IP. Sign-up, `register`, `invite`, notification creation, heavy report queries (full scans) and `/api/llm/chat` are unlimited.
- **Password policy.** Minimum 6 characters, nothing else: no complexity, breach or length-max checks, no reset, no MFA, and other sessions are not revoked on change. Temporary passwords set by admins follow the same 6-character minimum.
- **Account enumeration.**
  - Sign-in returns distinct `InvalidAccountId` and `InvalidSecret` errors (`retrieveAccountWithCredentials.js:23-31`). The page collapses them, but a direct client sees the difference. In a production deployment Convex redacts plain `Error` messages to "Server Error" (confidence Medium; deployment type unknown), but a **timing** difference remains: the unknown-account path skips the password hash.
  - Sign-up with an existing email fails with `Account <email> already exists` (`createAccountFromCredentials.js:30`), and `signup.js:42` shows the raw message.
  - Admin-only oracles: `createWithPassword` ("An account with this email already exists") and `invite` ("User already belongs to another company"), which reveals other tenants' membership.

### 5. Frontend guards vs backend enforcement

| Guard | Location | Backend equivalent? |
|---|---|---|
| Redirect to `/login` when signed out | `pages/_app.js:79-84` (`AuthWrapper`) | Yes: every function calls `requireUser` |
| `ProtectedRoute requiredRole="admin"` on `/users`, `/approvals`, `/company-settings`, `/audit-logs`, `/bulk-upload`, `/inventory/adjust`, `/pending-approval` | `components/ProtectedRoute.js` | Mostly yes. **`/bulk-upload`** calls `dailyRecords.createMany`/`biweeklyRecords.createMany`, which have no role check |
| `ProtectedRoute requiredRole="super_admin"` on `/admin/*` | `pages/admin/admin.js:16`, `pages/admin/company-registrations.js:9` | Yes (`companies.*` use `requireRole('super_admin')`) |
| Sidebar hides `adminOnly`/`superAdminOnly` items | `components/Sidebar.js:163-185` | Navigation only. Backend checks listed in §3.4 |
| `isAdmin` hides buttons (sales, health, fish transfers, farm locations, feed issue override) | `pages/sales.js:35`, `pages/health.js:38`, etc. | Partly. `sales.updateSale` is open to all members (V9) |
| Forced password change | `pages/_app.js:95-102` | **No** (V5) |
| Deactivated user lockout | none | **No** (X1) |
| Company pending, rejected or removed | none | **No** (X2, X3) |
| Location restriction | `LocationContext` UI only | Inert (§3.3) |

`ProtectedRoute` renders `null` and redirects. It is UX only, and every page's data comes from Convex functions that apply the backend checks above.

### 6. Next.js API routes
Only `pages/api/llm/chat.js` and `pages/api/llm/status.js` exist. Both call `requireApiUser` (`lib/llmApiAuth.js:8-35`), which takes the `Authorization: Bearer <Convex JWT>` header, builds a `ConvexHttpClient`, and calls `api.users.current`. A token that is invalid or expired gets a 401. `chat` also requires `companies.aiAssistantStatus.enabled`. `status` only reports which providers are configured. Neither checks role or `active`, and neither has rate limiting (V10). The server key never goes to a client-supplied URL (`chat.js:67-68`).

### 7. Test coverage of authorization
One negative cross-tenant test exists: "another company's cage cannot be harvested" (`convex/harvest.test.ts:125-128`). Nothing tests role refusals, deactivation, invite flows, company-less users or the issues V1–V4.

---

## Dependencies

- `@convex-dev/auth` 0.0.94 (Password provider, session and JWT defaults, built-in sign-in rate limit) and `convex` 1.42.3.
- Environment: `JWT_PRIVATE_KEY`/`JWKS` (Convex Auth), `CONVEX_SITE_URL`, `NEXT_PUBLIC_CONVEX_URL`, LLM keys (`GEMINI_API_KEY` and others, optional `NEXT_PUBLIC_*`), `LLM_DEFAULT_PROVIDER`, `CUSTOM_LLM_BASE_URL`.
- Related documents: 04/05 (schema and `companyId` optionality), 06 (function inventory), 08/09 (fish-count and stock-ledger integrity, which V1, V8 and V9 affect), 12/15 (risk and debt registers should carry X1–X3 and V1–V4).

## Risks

1. **Offboarding does not work** (X1, X2). Dismissed staff and removed tenants keep access. This is the most urgent operational risk.
2. **Open self-service tenant** (X3). Anyone can sign up and use the app without approval, and shares data with every other company-less account. The impact depends on whether legacy unscoped rows exist.
3. **Cross-tenant ledger corruption** (V1). One tenant can drain another's feed stock if it obtains a feed type id.
4. **Privilege takeover** through `invite` and `claimInvite` (V2, V3), made worse by the lack of email verification.
5. **Platform-wide mutation open to company admins** (V4).
6. In-memory `listForCompany` over `.collect()` of whole tables is both a performance risk and a correctness risk: a missed filter leaks everything. Moving to index-scoped queries (`withIndex('by_company', …)`) would make isolation structural.
7. Fixing X1–X3 will change behaviour for super_admins without a company and for existing company-less users. Any rollout needs a data audit first (see Outstanding questions).

## Outstanding questions

1. Does the production deployment contain rows with no `companyId` (legacy or pre-tenancy data), and how many users are company-less? This decides whether X3 is Critical. Verification needs a read-only query in the Convex dashboard.
2. Is the production deployment a Convex "prod" deployment (error messages redacted) or a dev deployment? This affects the enumeration findings and the user-facing error UX.
3. Is any super_admin company-less? If so, V2 applies to them now.
4. Product decision: should `user`-role staff be able to edit prices, payment status, purchases and harvest counts (V9)? A permission matrix is needed.
5. Is self-service sign-up meant to stay open, or should accounts be invite-only?
6. Does Next.js 15's `router.push` block `javascript:` URLs (V7)? Not verified.
7. Session revocation on password change was inferred from library code, not exercised.

## Completion status

Complete for PART 6. All 142 public Convex functions were reviewed and classified, and the auth flows were traced from UI to library. Nothing was executed against a deployment. Findings are from static reading (confidence High unless marked otherwise). No code was modified.
