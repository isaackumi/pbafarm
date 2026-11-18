# Legacy data migrations: M1, M0-b, M16, M10 (ORG-007, PROD-000f, INV-002)

> **None of these has been run** on any deployment. They are internal Convex
> functions an operator runs by hand: first on staging loaded with a copy of
> live data (`scripts/ops/staging-refresh.sh`), then on production during the
> cutover (`scripts/ops/cutover.sh`). Every write migration defaults to
> `dryRun: true` and is idempotent (a second run finds nothing to do).
> Take a snapshot first (`scripts/ops/convex-backup.sh`).

Add `--deployment <name>` to every command below. Never rely on the CLI's
default deployment.

## Order

| Step | Command | Writes | Re-run until |
|---|---|---|---|
| 1. Report | `npx convex run migrations:preflightUnscoped` | no | — |
| 2. M1 dry run | `npx convex run migrations:assignUnscopedToCompany '{"name":"<Company>","code":"<CODE>","dryRun":true}'` | no | — |
| 3. M1 | same with `"dryRun":false` | yes | `complete: true` |
| 4. M0-b dry run / write | `npx convex run migrations:repairStaleCageWeight '{"dryRun":true}'`, then `false` | yes | one run |
| 5. M16 dry run / write | `npx convex run legacyData:m16ConvertLegacyTransfers '{"dryRun":true}'`, then `false`; pass `"cursor":"<continueCursor>"` | yes | `isDone: true` |
| 6. M10 check | `npx convex run legacyData:m10VerifyNarrowReady` | no | `ready: true` |

## M1 — rows and users without `companyId` (`convex/migrations.ts`)

Assigns every row of every tenant table (`UNSCOPED_TABLES`) that has no
`companyId`, and every company-less user, to one approved company: reuses the
company with that `code` if it exists (it must be `approved`), otherwise
creates it. Users keep their role; each user's `activeLocationId` is moved to
an active site of that company if it pointed elsewhere. One audit row
(`migration_m1_assign_company`) lists the counts and user ids.

Up to 1000 rows per table per run (scans at most 5000 rows of the two tables
without a `by_company` index); `complete: false` means run it again.

**Open decision — flagged.** R04 M1 offers *assign* or *quarantine* per
table, and OPEN-QUESTIONS **Q-006** (are there unscoped rows, how many, is
any super_admin company-less, assign or quarantine?) is still unanswered.
The implemented default is **assign everything to the original farm's
company** (R04 option 1, the case where all legacy data belongs to the first
customer). Quarantine is not implemented. Before step 3 the owner must:
read step 1's output on the staging copy, confirm every unscoped row belongs
to that farm, and confirm which company-less users (especially super_admins)
may join it. If any table must be quarantined instead, stop: that needs a
code change (a `rejected` quarantine company per R04).

Rollback: rows assigned by M1 are the ones whose `companyId` is that
company's and whose `_creationTime` predates the run; the snapshot taken
before the run is the reliable rollback (`backup-restore.md` §3).

## M0-b — stale ABW after restock (`migrations:repairStaleCageWeight`, PROD-000f)

Cages restocked since their last sample still carry the previous cycle's
ABW in `currentWeight`. Sets it to the current stocking's `initialAbw`;
cages sampled in the current cycle or never sampled are left alone. Each
change is an audit row (`migration`) with the previous value (rollback).
Covered by `convex/stockIntegrity.test.ts` (S7).

## M16 — legacy one-row feed transfers (`legacyData:m16ConvertLegacyTransfers`, INV-002)

Before INV-002 a feed transfer wrote one `transfer` row (positive quantity,
`locationId` = destination) and never recorded the source site on the ledger.
The audit row written with it did keep the request (`fromLocationId`,
`toLocationId`, `quantityKg`). For each `transfer` row whose audit row
exists and agrees (same quantity, row site = destination, source ≠
destination), M16:

- inserts a `transfer_out` leg (−qty, source site),
- turns the row into the `transfer_in` leg (+qty, destination site),
- sets a shared `transferId` (the original row id), and
- writes an audit row (`migration`, `M16`) with the previous values.

Lots are not touched (the old code already moved them). Rows without a
matching audit row are reported as `unresolved` and stay `transfer`; the
per-site tally ignores `transfer` rows, so they remain the
"legacy_unsigned" state R04 M16 describes. Review them by hand.

Deviation from R04 M16: R04 assumed the source site was never stored and
planned only to mark legacy rows. The audit log does store it, so M16
converts the rows it can prove and marks nothing.

Rollback: delete the `transfer_out` rows with `transferId` = an original row
id and restore the original row from the M16 audit row (or the snapshot).

## M10 — narrow `companyId` to required (follow-up; schema unchanged here)

`legacyData:m10VerifyNarrowReady` (read-only) returns `ready: true` only when
every tenant table has no row without `companyId` (indexed check via
`by_company`, full scan up to 5000 rows for the two tables without that
index) and no scan was truncated; `blockers` names each failing table.
It also reports company-less users (`users.companyless`,
`users.companylessNonSuperAdmins`) without blocking on them, because
`users.companyId` stays optional.

Tenancy code already refuses company-less access (`convex/lib/tenancy.ts`,
SEC-001), so the remaining M10 work is the schema change. It is **not** in
this PR (schema changes here are additive only). Checklist for that
follow-up PR, one approved deploy per group of tables (R04 M10):

1. [ ] M1 has run on production (step 3 above) and `complete: true`.
2. [ ] `m10VerifyNarrowReady` on production returns `ready: true`, no
       truncated table, `companylessNonSuperAdmins: 0`.
3. [ ] Fresh snapshot taken (`convex-backup.sh`) and its counts recorded.
4. [ ] PR: change `companyId: v.optional(v.id('companies'))` to
       `v.id('companies')` for one group of the tables listed in
       `narrowTables`; fix every insert that type-checking flags; keep
       `users.companyId` optional (company-less super_admins and new sign-ups).
5. [ ] Deploy to staging (holding a migrated copy of live data) first:
       `convex deploy` validates every existing row against the narrowed
       schema and refuses the push if one is missing `companyId`.
6. [ ] Deploy to production; re-run `m10VerifyNarrowReady`.
7. Rollback: revert the PR (loosening a field back to optional is always safe).
