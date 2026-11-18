# Backup and restore runbook (Convex)

> **STATUS: DRAFT — NOT YET EXECUTED.** No backup schedule has been set up and no
> restore drill has been run. Nothing here has been tested against this project.
> The first drill must be run and recorded (see "Drill log" at the end) before
> this runbook can be relied on. Tracker: OPS-001 (roadmap §0.6).

## Scope and current state

- Backend data lives in Convex. Today there is one deployment,
  `vibrant-stork-860` (a **dev** deployment), and it holds **real farm data**.
- The roadmap plans separate **production** and **staging** deployments. Until
  they exist, "prod" in this document means whatever deployment real users are
  on (today `vibrant-stork-860`).
- What a snapshot contains: every table in `convex/schema.ts` (the app tables
  plus the Convex Auth tables from `authTables`), and optionally file storage.
  It does **not** contain environment variables (`JWT_PRIVATE_KEY`, `JWKS`,
  `SITE_URL`, LLM keys), deployed functions, or cron state. Those come from git
  and from the env-var record below.

## Rules

1. **Never import into the live deployment** except as the last step of a real,
   approved recovery (see "Recovering prod"). Drills restore into a throwaway
   deployment only.
2. `npx convex import --replace-all` **deletes** data in the target. Always pass
   `--deployment <name>` explicitly and read the name back before confirming.
3. Snapshot files contain personal data (users, customers, sales). Store them
   only in the agreed private location, never in git, chat or email.
4. Run commands from a machine whose `.env.local` does not point at prod, so a
   missing flag cannot fall through to the wrong deployment.

## 1. Taking a backup

### Scheduled (preferred)

In the Convex dashboard for the prod deployment: **Settings → Backups** →
enable periodic backups (daily). Availability and retention depend on the
Convex plan — confirm on the dashboard and record the result here:

- Plan: _TBD_
- Schedule: _TBD_ (target: daily)
- Retention: _TBD_
- Includes file storage: _TBD_

### Manual snapshot (before every risky change: migrations, imports, cutovers)

```bash
# Read-only on the source deployment. Writes a ZIP locally.
npx convex export \
  --deployment <prod-deployment-name> \
  --include-file-storage \
  --path backups/$(date +%Y-%m-%d)-<prod-deployment-name>.zip
```

Record the file name, size, and the time in the change ticket.

### Environment variables

Snapshots do not include env vars. Keep a current list (names only here, values
in the password manager) and update it whenever one changes:

| Name | Purpose |
|---|---|
| `JWT_PRIVATE_KEY`, `JWKS` | Convex Auth signing keys |
| `SITE_URL` | Auth redirect base |
| LLM provider keys | Assistant (if set on the deployment) |

## 2. Restore drill (monthly)

Goal: prove a snapshot can be restored and is complete, without touching prod.

1. **Pick the snapshot** — the latest scheduled backup (download from the
   dashboard) or take a fresh manual snapshot as in §1.
2. **Create a scratch deployment** — a new dev/preview deployment in the same
   Convex project, e.g. named `restore-drill-YYYY-MM`. Note its name.
3. **Deploy the matching code** to it: check out the git commit that was live
   when the snapshot was taken and push functions + schema to the scratch
   deployment (e.g. `npx convex deploy` with that deployment's deploy key, or
   `npx convex dev --once` pointed at it). Do not reuse the prod deploy key.
4. **Import the snapshot** into the scratch deployment only:

   ```bash
   npx convex import --deployment <scratch-deployment-name> --replace-all backups/<snapshot>.zip
   ```

5. **Compare row counts** per table between the snapshot source and the scratch
   deployment. In the dashboard Data page each table shows its document count;
   record both columns in the drill log. Every table must match exactly.
   Minimum tables to check: `users`, `companies`, `farmLocations`, `cages`,
   `dailyRecords`, `biweeklyRecords`, `harvestRecords`, `stockingHistory`,
   `feedPurchases`, `feedInventoryTransactions`, `sales`, `auditLogs`.
6. **Spot-check data**: open three random cages and compare current count,
   latest daily record and latest harvest with prod.
7. **Smoke test the app** against the scratch deployment (local `next dev` with
   `NEXT_PUBLIC_CONVEX_URL` pointed at it, after setting the auth env vars on
   it): sign in, open the dashboard, open a cage page.
8. **Record** the result in the drill log below, including time taken.
9. **Delete the scratch deployment** and the downloaded snapshot copy.

## 3. Recovering prod (real incident)

Only with the owner's explicit approval.

1. Stop writes: announce downtime; if possible, put the app in maintenance
   (e.g. point Vercel at a maintenance page).
2. Take a manual snapshot of the current (damaged) prod state (§1) so the
   recovery itself can be undone.
3. Choose the snapshot to restore and run the drill steps 2–7 on it first to
   confirm it is good.
4. Import into prod:
   `npx convex import --deployment <prod-deployment-name> --replace-all <snapshot>.zip`
5. Re-check env vars on prod against the env-var record.
6. Smoke test (sign in, dashboard, one cage, one daily entry).
7. Re-open the app; tell users which time window of entries was lost and must
   be re-entered.
8. Write an incident note: cause, data window lost, time to recover.

## Drill log

| Date | Snapshot | Scratch deployment | Row counts match? | Time taken | Run by | Notes |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | Not yet executed |
