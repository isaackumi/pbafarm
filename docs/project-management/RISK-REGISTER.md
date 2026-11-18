# Risk Register

Last updated: 2026-11-18. Sources: discovery docs 01, 07, 08, 09, 11, 12, 13 and delivery planning (`docs/roadmap/*`).

**Likelihood:** Certain · High · Medium · Low. **Impact:** Critical · High · Medium · Low. **Owner role** is the role accountable for the mitigation (named people to be assigned by the owner): Product owner (PO), Tech lead (TL), Backend engineer (BE), Frontend engineer (FE), Ops/DevOps (OPS).

**Trigger** = the observable event that means the risk is materialising or must be acted on now.

## Product and data risks (from discovery)

| ID | Risk | Likelihood | Impact | Owner role | Mitigation | Trigger | Source |
|---|---|---|---|---|---|---|---|
| R-01 | Editing an old complete harvest after restock closes and zeroes the new cycle; live on `main` since PR #8 deployed | High | Critical | TL | PROD-000a hotfix first (OPS-000); admin-only count edits; regression test | Any harvest edit on a restocked cage; a cage showing 0 fish and `harvested` right after a harvest edit | d09 S5; R03 §0.1 |
| R-02 | Daily-record mortality edits from the new `/daily-data` UI move the current count across cycles | High | High | BE | PROD-000c hotfix | Edit of a record dated before the current stocking | d09 S8; PR #7 |
| R-03 | Deactivated users and members of removed companies keep full access | Certain (when used) | High | BE | SEC-001; delete sessions on deactivate | An offboarding; a company rejection | d07 X1, X2 |
| R-04 | Company-less sign-ups share one data pool; legacy unscoped rows visible to every new sign-up | High | High (Critical if legacy rows exist) | BE | SEC-001 + M1 pre-flight | Pre-flight P1 > 0; any new self sign-up | d07 X3; d04 F1 |
| R-05 | Cross-tenant ledger corruption via foreign `feedTypeId`; platform-wide `backfillLocations` callable by any admin | Medium | High | BE | SEC-002 | A second tenant onboards; any admin clicks "Backfill existing data" | d07 V1, V4 |
| R-06 | Invite flow lets an admin take over a company-less super_admin or any company-less user; unverified email claims admin seats | Medium | High | BE | SEC-003; then email verification (SEC-005) | A second company is approved | d07 V2, V3 |
| R-07 | Transfer-linked approvals count fish twice; second stocking approval overwrites count | Medium | High | BE | PROD-000d, PROD-000e | Approve from `/stocking/[id]/details` or `/topup/[id]/details` on a transfer-linked row | d09 S2, S3, S9 |
| R-08 | Growth/eFCR wrong after restock (previous cycle ABW) | Certain after a restock | High | BE | PROD-000f + M0-b | Restock of any harvested cage | d09 S7 |
| R-09 | `/harvest-sampling` creates fake complete harvests; kg double counted; FCR 1.5 in averages | High (if the page is used) | Medium | PO | Q-005 answer; PROD-000g interim | Rows in P7 pre-flight | d09 S12; d04 F9 |
| R-10 | Feed issue + daily entry deduct stock twice | Medium | Medium | PO | Q-003 answer; PROD-000h interim | P8 pre-flight > 0 | d09 S14 |
| R-11 | Full-table scans across tenants hit Convex read limits; dashboard, report, export and assistant fail for every tenant at once | Certain as data grows | Critical | TL | PLAT-001; rollups (PLAT-002) | Function errors on `reports.*`; P10 counts approaching limits | d12 §6.1, T1 |
| R-12 | Truncated cross-tenant `take(N)` windows: false "missed entry" reminders, invisible approvals | Certain at scale | Medium | BE | PLAT-001 | Platform > 2,000 daily records/day or > 100 pending approvals | d12 §6.2; d04 F7 |
| R-13 | Dev deployment acts as production; any laptop can push schema; no documented backups | Medium | High | OPS | OPS-001; rotate shared dev key | Any `convex dev` against `vibrant-stork-860`; any destructive schema push | d01 R1; d12 §7–8 |
| R-14 | Validation messages redacted once a real prod deployment exists (plain `Error`) | Medium | Medium | BE | `ConvexError` codes before cutover (OPS-001) | Cutover rehearsal shows "Server Error" in field UI | d12 §5b |
| R-15 | Offline cold start blocked; only daily entry survives poor signal; staff revert to paper | High | High | FE | MOBILE-001, MOBILE-002 | Field reports of blank screens offline; growth in bulk uploads | d11 §10 #1–2 |
| R-16 | Shared phones: next user flushes previous user's outbox and sees cached data | Medium (depends on Q-017) | High | FE | MOBILE-001 | Shared devices confirmed | d12 §5.2; d11 §10 #3 |
| R-17 | Inconsistent KPI definitions mislead management (4 FCRs, 4 mortality %) | Certain | Medium | PO | PROD-008 + owner definitions (Q-009, Q-013) | Owner questions dashboard vs cage page figures | d09 §3 |
| R-18 | LLM proxy without rate limit or role gate; farm data sent to third party without recorded consent | Medium | Medium | TL | SEC-004; consent setting | Unexpected LLM bill; customer data-protection question | d07 V10; d13 §11 |
| R-19 | Known-vulnerable `next`, `@auth/core`, `xlsx` | Low–Medium | Medium | OPS | OPS-003 | New applicable advisory | d12 §5.6 |
| R-20 | No error boundary; silent dashboard failures | Medium | Low–Medium | FE | OPS-001 | Blank-screen reports | d12 §5b |
| R-21 | Dates in UTC: wrong day for non-UTC+0 farms | Certain for such farms | Medium | BE | I18N-001, FARM-001 | First pilot outside UTC+0 | d12 §6.4 |
| R-22 | Hard-deleting a cage orphans its history | Low | Medium | BE | Hide delete for cages with history; PROD-013 archive | Any `cages.remove` call | d04 F11 |

## Delivery risks

| ID | Risk | Likelihood | Impact | Owner role | Mitigation | Trigger |
|---|---|---|---|---|---|---|
| R-30 | Merged-stack mistakes repeat: PRs merged into feature branches never reach `main` (as #14 did) | Medium | Medium | TL | No stacked backend PRs; re-target to `main` before merge (R06 §4) | A PR whose base is not `main` |
| R-31 | Auto-deploy on merge ships unreviewed backend changes to live data | High (today) | High | OPS | Tests before deploy; staging first; prod on tag (OPS-001/002) | Any merge to `main` touching `convex/**` before OPS-001 |
| R-32 | Phase 0 behaviour changes surprise existing users (company-less users lose data access; admins lose some edits) | Medium | Medium | PO | Pre-flight counts; release notes; pilot with existing customer | Support requests after SEC-001/002 |
| R-33 | stockEvents backfill reconciliation reveals large unexplained differences the owner cannot explain | Medium | High | PO | M0-a preview early; reconcile to current counts with explicit adjustments; owner sign-off | M0-a shows many cages off by > 1 % |
| R-34 | Migration exceeds Convex transaction limits or takes long on prod | Medium | Medium | BE | Paginated, resumable runner (PLAT-004); rehearse on staging copy | Rehearsal run time or errors |
| R-35 | Owner answers (Q-003, Q-005, Q-010) arrive late and block Phase 0 items | Medium | Medium | PO | Interim fixes that are safe under either answer (PROD-000g/h) | Items Blocked > 2 weeks |
| R-36 | Scope creep: enterprise/AI features pulled ahead of foundations | Medium | High | PO | Tracker priorities; decision log for any re-order | Request to start Phase 8+ before Phase 4 switch |
| R-37 | Single-developer bottleneck / knowledge concentration (stack built quickly in one night, 7 PRs) | Medium | High | TL | Smaller PRs, written Rule 3 descriptions, tests as documentation | PRs > 1,000 lines; unreviewed merges |
| R-38 | Frontend untyped: contract drift between Convex returns and JS consumers (snake_case `toClient` mappers, doc 04 F13) | High | Medium | FE | `returns` validators (PLAT-003); TS for new files; component tests on field forms | Runtime `undefined` errors after backend changes |
| R-39 | Convex plan limits (backups, log streams, components) differ from assumptions | Medium | Medium | OPS | Confirm plan (Q-032) before OPS-001 design is final | Feature unavailable on current plan |
| R-40 | Data-protection obligations (staff personal data, customer data in staging copies, LLM sharing) | Low–Medium | High | PO | Q-021; mask staging data if required; consent setting | Customer or regulator inquiry |
| R-41 | Parallel tracks (PLAT-001 and SEC-002) conflict in `convex/reports.ts` / `convex/lib/tenancy.ts` | High | Low | TL | Sequence those PRs or split by module | Merge conflicts in those files |
