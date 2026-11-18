# Data governance: export, deletion, retention, tamper-evident audit

ENT-005 and TRACE-007. Code: `convex/governance.ts`, `convex/lib/governance.ts`, `convex/lib/zip.ts`, `convex/lib/auditChain.ts`, chain verification in `convex/audit.ts`. Tests: `convex/governance.test.ts`.

## Organization export

- `governance.requestExport` (`org.data.export`, admin-only) records a `dataExports` row, writes an audit entry and schedules `governance.runExport`.
- `runExport` (internal action) pages through every table in `TENANT_TABLES` (export ≠ false) by its company index, 1,000 rows per query, and builds a store-only zip: `manifest.json`, `json/<table>.json`, `csv/<table>.csv`. Each table is capped at 50,000 rows; cut tables are listed in the manifest and on the row. The file goes to Convex storage.
- `governance.exportDownloadUrl` (`org.data.export`) is a mutation so the download is audited and the expiry is checked against the clock.
- Left out: `integrationSecrets`, `phoneLoginCodes`, `mfaSessions`, `fileDownloadTokens`, Convex Auth tables, `userInvites.tokenHash`, `apiKeys.hash`. Stored files (attachments) are listed in `files` but not copied into the zip.
- `convex/governance.test.ts` checks `TENANT_TABLES` against the schema: every table with an index starting at `companyId` is listed or skipped with a reason, and every listed index starts with `companyId`. A new tenant table fails that test until it is classified.

## Deletion requests

| Step | Who | Effect |
|---|---|---|
| Request organization deletion | `org.data.delete` (owner/admin) | `dataRequests` row `requested`; audited |
| Request account deletion | the account itself (`requireAccount`) | same, kind `account_deletion` |
| Withdraw | requester (or an `org.data.delete` holder for the organization) | before approval; an account deletion also during its grace period |
| Approve / decline | platform admin | approval sets `graceEndsAt = now + 30 days`; an organization becomes `rejected` ("Deletion scheduled for …") so every member is refused at once |
| Cancel in grace | platform admin | restores the previous organization status |
| Complete | daily cron `governance.processDueRequests` | account: anonymized (name "Deleted user", email/phone/image cleared, inactive, memberships removed, sign-in accounts and sessions deleted); organization: `governance.purgeCompanyBatch` deletes tenant rows 100 per transaction, rescheduling itself, then keeps a tombstone `companies` row named "Deleted organization" |

`purgeCompanyBatch` is a dry run by default (counts up to 200 rows per table, writes nothing); the cron passes `dryRun: false` only for approved requests past their grace period. Users of the organization are detached (`companyId` cleared), not deleted: they may belong to other organizations. Child rows without a company index are removed with their parent: `biweeklySampling` (biweekly records), `integrationSecrets` (channels, webhook endpoints), `webhookDeliveries`, `apiIdempotencyKeys`; storage files of `files` and `dataExports` and the logo are deleted.

## Retention

| Data | Kept | Then |
|---|---|---|
| Organization data after an approved deletion | 30-day grace period | purged by `processDueRequests` |
| Audit log of a deleted organization (and its hash chain) | 365 days after the purge | purged by `processDueRequests` → `purgeAuditBatch` |
| Data export files | 7 days | deleted by `governance.pruneExports`; row marked `expired` |
| Deletion request rows | indefinitely | evidence of the request and decision |
| Domain events, idempotency keys, webhook deliveries, API idempotency keys | 30 days | existing prune crons (`convex/crons.ts`) |
| File download tokens | until expiry | `files.pruneDownloadTokens` |

Notifications and `feedInventoryTransactions` retention for live organizations (doc 04 F19) is not changed here.

## Tamper-evident audit log (TRACE-007)

Every `auditLogs` insert goes through `insertAuditLog` (`convex/lib/auditChain.ts`). For a row with a company it sets `seq` (1, 2, …), `prevHash` (the previous row's hash, 64 zeros for the first), `at`, and `hash = SHA-256(canonical JSON of the row without hash, _id, _creationTime)`; canonical JSON sorts keys and drops undefined values. `auditChainHeads` holds each company's last `seq` and `hash`. Rows without a company (platform actions with no tenant) are unchained.

Verification (`audit.verifyBatch`, 300 rows per transaction, rescheduling) walks `by_companyId_and_seq` from 1 and reports `broken` at the first row whose `seq` skips (row deleted), whose `prevHash` differs, or whose recomputed hash differs (row edited); at the end the head must equal the last row (rows deleted from the end). A daily cron (`audit.verifyAll`, 02:15 UTC) checks every company; `audit.verifyChain` (`org.audit.view`) starts a check now and `audit.chainStatus` shows the result on `/audit-logs`. Rows written before TRACE-007 have no `seq` and are reported as unchained.

Limits: the chain detects edits and deletions made without recomputing it. Someone with database write access (dashboard, `npx convex run`) could rewrite every later hash and the head. Anchoring the head outside Convex (e.g. a daily hash emailed or written to object storage) would close that gap; not done yet. The head is one document per company, so audit writes within a company serialize; Convex retries conflicts.

The `by_companyId_and_seq` index is not staged: `auditLogs` is small on the current deployment. On a large deployment, add it with `staged: true` first.
