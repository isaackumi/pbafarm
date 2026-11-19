# Open Questions for the Owner

Last updated: 2026-11-19. Consolidated and de-duplicated from the "Outstanding questions" sections of discovery docs 01–14 and from roadmap planning. Each question says why it matters and what it blocks. Tracker IDs refer to `MASTER-TRACKER.md`.

Questions marked **Blocking now** gate Phase 0 work.

## Operations and environment

| ID | Question | Why it matters | Blocks | Source |
|---|---|---|---|---|
| Q-002 | **Is `vibrant-stork-860` serving real users today, and which Vercel URL do they use?** Is a separate prod Convex deployment already planned, and who holds Convex team admin rights? | It is a dev deployment acting as production; every merge to `main` and possibly every developer's `convex dev` changes it. Decides whether OPS-001 needs a data cutover and how urgent the S5 hotfix is. | OPS-001, OPS-000, M14 — **Blocking now** | d01 Q1–Q2; d12 Q3; d07 Q2 |
| Q-032 | Which Convex plan is the team on? Are scheduled backups or exports enabled? Has a restore ever been tested? | Backups, log streaming and some components depend on the plan. | OPS-001 | d12 Q2; d01 §12 |
| Q-012 | Vendor and budget preferences for error monitoring (e.g. Sentry) and for platform email. | OPS-001 monitoring and SEC-005/ORG-003 emails need a provider. | OPS-001, INT-002 | roadmap |
| Q-021 | Data-protection requirements: can staging hold an unmasked copy of production? Any regulation for staff/customer personal data in the target markets? | Staging rehearsals use a prod copy (R06 §2). | OPS-001 staging, R-40 | roadmap |
| Q-039 | Current document counts for `dailyRecords`, `cages`, `feedTypes`, `users`, `feedInventoryTransactions`, `auditLogs` on the live deployment. | Sizes the full-scan failure timeline and migration run times. | PLAT-001 ordering, M7 | d12 Q1; d04 header |
| Q-043 | **Production security headers:** do the deployed Vercel responses carry the headers from `next.config.mjs` (enforced CSP, `Content-Security-Policy-Report-Only`, `X-Frame-Options: DENY`, HSTS)? Check with `curl -sI https://<prod-url>/login`. Has the report-only CSP been observed long enough with no legitimate violations to enforce it? | Security audit B (2026-11-19) could only review the config, not the live responses. Enforcing the full CSP closes script-injection paths the narrow enforced policy leaves open. | Enforcing the full CSP. **Checked 2026-11-19 09:58 UTC:** production (`pbafarm.vercel.app`) sent only HSTS, because Vercel rate-limited the production builds of main after #86–#89 (`Deployment rate limited — retry in 24 hours`), so the live frontend was still the pre-audit build. This commit re-triggers the production build; re-run the curl after it lands. | `docs/security/audits/2026-11-19-full-b` |

## Data and tenancy

| ID | Question | Why it matters | Blocks | Source |
|---|---|---|---|---|
| Q-006 | **Does the live deployment contain rows without `companyId` (legacy, pre-tenancy, or created by company-less users)? How many users are company-less, and is any super_admin company-less?** For such rows: assign to a company, or quarantine? | Decides whether X3 is Critical, and how M1 resolves them. A company-less super_admin is exposed to the invite takeover (V2) today. | **Answered by data, 2026-11-19:** dry runs on `vibrant-stork-860` (`migrations:preflightUnscoped`, `legacyData:m10VerifyNarrowReady`) found 0 tenant rows without `companyId`, 0 company-less users and no company-less super_admin. The only company-less rows are 6 platform `auditLogs` from the M7 migration, which are system rows and stay company-less (`auditLogs` is not narrowed). M1 has nothing to assign; quarantine is not needed. | SEC-001, SEC-003, M1, M10 — resolved | d07 Q1, Q3; d04 header; d02 Q6 |
| Q-011 | Should self-service sign-up stay open, or should accounts be invite-only? Is a company-less user meant to work "solo"? | SEC-001 routes company-less users to registration; invite-only would remove public sign-up. | SEC-001, ORG-004 | d07 Q5; d02 Q6 |
| Q-017 | Do workers share phones between staff or between farms? | Decides the severity of cross-user offline data (R-16) and how aggressively sign-out clears data. | MOBILE-001 | d11 Q3; d12 Q4 |

## Production business rules

| ID | Question | Why it matters | Blocks | Source |
|---|---|---|---|---|
| Q-003 | **Does feed *issue* (store → cage, `/feed-issue`) coexist with feed in the daily entry, or replace it?** If both are used: is issue a move to a cage-side bin (no consumption) and daily entry the consumption? | Both currently deduct stock: double deduction (S14). Also decides whether issued feed counts in FCR. **Assumed answer, 2026-11-18, revisit if owner disagrees:** both coexist. An issue to a cage moves feed from the store into that cage's bin (`cageFeedBins`); it is not consumption and not in FCR. The daily entry's feed is the consumption: it draws from the cage's bin first and takes any remainder from the store (so farms that never issue keep working). FCR counts daily-entry feed only. Implemented in PROD-000h. | PROD-000h (implemented on the assumed answer) | d02 Q1; d08 Q2; d11 Q4; d14 Q1 |
| Q-005 | **Is `/harvest-sampling` a harvest, or a pre-harvest sample?** | It writes a *complete* harvest with FCR 1.5, ABW in kg and no cage effect; harvest kg is double counted. **Assumed answer, 2026-11-18, revisit if owner disagrees:** a pre-harvest sample, not a harvest. The page writes sampling rows only (ABW in grams); old rows are tagged `source: 'sampling_page'` by M0-c (written, not yet run) and left out of KPIs and reports. | PROD-000g, M0-c (implemented on the assumed answer; M0-c to run) | d02 Q3; d08 Q1; d09 Q5; d10 Q2; d14 Q3 |
| Q-004 | **What does `cages.currentWeight` mean: ABW in grams (synced from samples) or biomass (seed data)?** | `/cages/analytics/growth` and `/cages` treat it differently; PROD-000f resets it to stocking ABW. | PROD-000f, M0-b, UX fixes on analytics pages | d02 Q2; d14 Q2 |
| Q-007 | **Which species beyond tilapia must the platform support first, and with what parameters (growth curve, target weights, grades)?** | Species are a 5-item hard-coded list; nothing varies by species. | PROD-010, ANLY-003, M19 | d08 §1; D-012 |
| Q-008 | Is `stockingHistory` the intended batch, or do batches need to move between cages with lineage across splits and merges? Do users stock a cage while the previous stocking is still open? Do they do partial then complete harvests? | Confirms the D-004 model and the M6/M7 backfill rules. | PROD-001, PROD-003 | d08 Q3; d05 header |
| Q-009 | Which FCR is official: eFCR on standing biomass, harvest FCR, or both? Should harvest FCR ever be typed by hand? | Four FCR definitions exist today. | PROD-008, PROD-009 | d09 Q1 |
| Q-013 | Should mortality % exclude harvested and transferred fish? Should survival include top-ups/transfers-in in the denominator? | Four mortality definitions; false cumulative alerts after harvests. | PROD-008 | d09 Q2 |
| Q-014 | May daily records and harvests be edited after their cycle is closed? If so, should that reopen or recompute the cycle? | PROD-000a/c refuse count changes on closed cycles as an interim rule. | PROD-000a, PROD-000c (final rule), PROD-007 | d09 Q3 |
| Q-023 | Should approval of a stocking/top-up re-validate capacity and status at approval time? | PROD-000e assumes yes. | PROD-000e (confirmation) | d08 Q5 |
| Q-024 | For feed stock history, are business dates or entry times authoritative? | Ledger uses server time; back-dated entries appear on the day typed. | INV-002, M16 | d08 Q6 |
| Q-025 | Which "ready to harvest" rule is authoritative: `targetHarvestAbwG`, `harvestDocMin/MaxDays`, or the hard-coded 120 days? | Four different definitions across pages. | PROD-008, UX fixes | d02 Q5 |
| Q-026 | Should water-quality capture be expanded (pH, ammonia, nitrite, thresholds) or removed from forms until there is a consumer? | Captured, never read back. | PROD-014 | d14 Q4 |
| Q-016 | Should a blank feed amount mean "not fed" (0) or "not recorded"? | Blank silently becomes 0 kg and skews FCR. | MOBILE-004 | d11 Q7 |
| Q-027 | Should bulk upload be admin-only on the backend as well? | SEC-002 assumes yes. | SEC-002 (confirmation) | d02 Q4 |

## Finance

| ID | Question | Why it matters | Blocks | Source |
|---|---|---|---|---|
| Q-015 | Should feed cost follow purchase price (lot costing, FIFO or weighted average) or a manually set list price? | Daily cost uses the list price; purchase prices never flow into cost. | INV-006 | d09 Q4 |
| Q-018 | Which costs must P&L include (fingerlings, labour, treatments, energy, overheads)? | P&L is revenue minus feed only. | INV-007, INV-008 | d08 Q4 |
| Q-038 | Is invoicing / payment tracking needed, or only a paid/unpaid flag? | Payment status can't be updated today. | INV-009 | d02 KF9 |
| Q-031 | Should currency be per company only, or overridable per browser (as `useCurrency` allows)? | Two currency systems read different settings. | I18N-001 | d10 Q3 |

## Permissions

| ID | Question | Why it matters | Blocks | Source |
|---|---|---|---|---|
| Q-010 | **Permission matrix:** should `user`-role staff edit prices, payment status, purchases and harvest counts? Should existing `user` members map to "field staff" or "manager"? Is segregation of duties (approver ≠ submitter) required? | Today any member can do several financially sensitive writes; Phase 0 gates them to admin as an interim. | PERM-001, M9, PERM-005; SEC-002 (confirmation) | d07 Q4 |
| Q-040 | **Role grants can exceed grantor rights:** a custom role with member management can assign admin; a holder of role management can add any permission to their own role. Should grants be limited to the grantor's own permissions? Policy decision needed. | Lets a delegated manager escalate to admin or to permissions they were not given. Raised as needs_validation by security audit A (2026-11-19); not changed until decided. | PERM-002, PERM-003 | `docs/security/audits/2026-11-19-full-a` |
| Q-041 | **OIDC SSO account linking by email:** sign-in through an SSO connection links to an existing account when the IdP asserts `email_verified` (`convex/lib/sso.ts`, @convex-dev/auth account linking). Can a tenant admin register any IdP/issuer? Is each connection bound to email domains the organization has proven it owns? | If any tenant can register an IdP it controls, it could assert a verified email of a user in another organization (or a super_admin) and take over that account. Raised as needs_validation by security audit B (2026-11-19); not changed until decided. | ENT-003 (SSO) | `docs/security/audits/2026-11-19-full-b` |

## Markets and globalization

| ID | Question | Why it matters | Blocks | Source |
|---|---|---|---|---|
| Q-020 | **Target first markets: which countries, currencies, languages and time zones after Ghana?** May existing companies default to `Africa/Accra`, metric, `GH`? | Decides when an i18n library is introduced (D-012), FX needs, timezone handling priority and pilot selection. | ORG-005, M3, I18N-002, I18N-003, pilot choice | D-012; roadmap |
| Q-044 | Are the built-in country checklist templates (Ghana: Fisheries Commission licence, EPA permit, monthly production return, registered hatcheries; Côte d’Ivoire: ministry operating authorisation, monthly production declaration, approved hatcheries) accurate, and which other countries need their own pack? | The wording is a starting point, not checked with the regulators. | I18N-004 (content) | I18N-004 |
| Q-022 | Which farms will pilot after the existing customer (ideally a pond farm, a hatchery/nursery, one outside UTC+0)? | Release strategy §7. | Phase 1+ pilots | R06 §7 |

## Integrations and channels

| ID | Question | Why it matters | Blocks | Source |
|---|---|---|---|---|
| Q-001 | **SMS/WhatsApp provider choice** (Hubtel, Africa's Talking, Twilio; WhatsApp Cloud API) and whether SMS/WhatsApp is the expected channel for field-staff reminders. | Adapter priority and cost; platform vs bring-your-own credentials. | INT-002, AUTO-003 | d13 Q2 |
| Q-030 | Should password reset be email-based, SMS-based, or admin-only? | Many field staff may not use email. | SEC-005 | d13 Q3 |
| Q-029 | Which LLM provider/model is used in production, what is the monthly spend, and should the assistant be limited to admins? | Model IDs are dated; no cost controls. | SEC-004, ANLY-005 | d12 Q5; d13 Q1 |
| Q-019 | Are cage QR labels already printed and in use on site? | Changing URL format or host would invalidate them; MOBILE-006 must keep old URLs working. | MOBILE-006 | d13 Q4 |
| Q-037 | Are spreadsheets imported regularly (format, size)? | CSV importer must accept them. | MOBILE-009 | d13 Q5 |
| Q-042 | **Outbound webhook SSRF through DNS rebinding:** public hostnames that resolve to private or metadata IPs are not blocked (`convex/integrations/webhookLogic.ts`, `convex/webhooks.ts`); this is a documented accepted risk. Can Convex action egress reach internal networks or cloud metadata addresses (169.254.169.254, RFC 1918)? Ask Convex support or test from a dev deployment. | If egress can reach them, a tenant webhook URL could probe internal services (only the status code is reflected). If not, the accepted risk stands. Raised as needs_validation by security audit B (2026-11-19). | INT-005 | `docs/security/audits/2026-11-19-full-b` |

## Field usage

| ID | Question | Why it matters | Blocks | Source |
|---|---|---|---|---|
| Q-033 | Does a signed-in PWA really stay on the loading skeleton when started offline? (Device test: install, sign in, use online once, airplane mode, cold start.) | Confirms the most severe mobile finding. | MOBILE-001 priority | d11 Q1 |
| Q-035 | Which Android devices and Chrome versions do workers use? | Icon installability, `inputMode`, bundle budget. | MOBILE-007, MOBILE-008 | d11 Q2 |
| Q-036 | How many cages does one worker log per round, at each cage (QR) or at the end (batch)? Is bi-weekly sampling done by field staff or a supervisor at a desk? | Which flow to optimise. | MOBILE-004, MOBILE-005, MOBILE-006 | d11 Q5, Q6 |

## Codebase housekeeping

| ID | Question | Why it matters | Blocks | Source |
|---|---|---|---|---|
| Q-028 | Is Redux/redux-persist intentionally kept? Is the dead code (`DailyEntryForm`, `BiweeklyForm`, `BulkUploadModal`, `CageManagementSidebar`, `Pagination`, `hooks/useToast`, `DataContext`, `AnalyticsContext`, `harvestSlice`, Phosphor icons) safe to delete? Should root-level Supabase SQL be archived or deleted? Are the inert Tailwind v3 config and plugins meant to be active? | Cleanup scope and bundle size. | UX-002, UX-005, OPS-003 | d01 Q3–Q4; d10 Q1, Q4, Q5 |
