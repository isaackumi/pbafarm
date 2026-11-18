# Staging environment and safe cutover (OPS-004)

> Scripts and runbook only. **Nothing here has been executed.** The owner
> creates the deployments and runs the scripts. All scripts are dry-run by
> default (they print the `npx convex …` commands); `DRY_RUN=0` executes.

Scripts (`scripts/ops/`):

| Script | Does | Writes to |
|---|---|---|
| `convex-backup.sh` | export (tables + files) → ZIP + `.sha256` + `.counts.json` | local disk |
| `convex-restore-drill.sh` | import a ZIP into a scratch deployment, export back, compare counts | scratch deployment |
| `staging-refresh.sh` | copy live → staging, run migration reports (or `APPLY_MIGRATIONS=1`) | staging |
| `cutover.sh` | final export → import into prod → verify counts → M1/M0-b/M16 → M10 check | new prod |
| `cutover-rollback.sh` | snapshot prod, print the Vercel switch-back | local disk |
| `snapshot-counts.mjs` | per-table row counts of an export ZIP; compares two | — |

Guards: deployment names are always explicit; a script refuses to write to
`PROD_DEPLOYMENT` unless `CONFIRM_PROD` equals that name; the drill refuses
prod or staging as its scratch target; the cutover refuses to start without
`FREEZE_CONFIRMED=1` and asks (or needs `APPLY_MIGRATIONS=1`) before writing
migrations. Snapshots go to `backups/` (git-ignored); they hold every
tenant's personal data: move them to the agreed encrypted location.

## 1. One-time setup (owner)

1. **Convex**: create the staging deployment (separate project or a
   non-default deployment of this one) and the production deployment.
   Set env vars on both (see `environments-and-deploys.md` §6 step 2).
   `SITE_URL` on staging = the staging frontend URL.
2. **GitHub**: `staging` environment secret `CONVEX_DEPLOY_KEY_STAGING`.
   From then on, pushing `release/**` (e.g. `release/phase0`) or `main`
   deploys code to staging (`convex-deploy.yml`).
3. **Vercel**: Preview environment variables `NEXT_PUBLIC_CONVEX_URL` /
   `NEXT_PUBLIC_CONVEX_SITE_URL` = the staging deployment. Optionally pin a
   stable preview domain to the release branch (Settings → Domains →
   assign to the `release/phase0` branch), e.g. `staging.<domain>`.
4. **Access** (CF-007): staging will hold real data; protect the staging
   hostname with Cloudflare Access ([cloudflare-owner-actions.md](cloudflare-owner-actions.md)).
   Vercel Deployment Protection on previews is an alternative if the zone
   is not on Cloudflare yet.

## 2. Load staging with live data and rehearse

```bash
export SOURCE_DEPLOYMENT=vibrant-stork-860 STAGING_DEPLOYMENT=<staging> PROD_DEPLOYMENT=<new prod>
scripts/ops/staging-refresh.sh                      # read the plan
DRY_RUN=0 scripts/ops/staging-refresh.sh             # copy + reports
DRY_RUN=0 APPLY_MIGRATIONS=1 COMPANY_NAME="<farm>" COMPANY_CODE=<CODE> scripts/ops/staging-refresh.sh
```

Check on staging (acceptance of OPS-004):
- PBA staff sign in on the staging URL with their existing passwords
  (Convex Auth's password hashes and sessions are tables, copied with the
  data; the signing keys `JWT_PRIVATE_KEY`/`JWKS` must match for existing
  sessions, new sign-ins work either way).
- `m10VerifyNarrowReady` → `ready: true`; every live row visible to its
  company after M1 (dashboard, cages, daily data, feed, sales).
- The live portal is unaffected (staging is a separate deployment).
- Time the whole run: it is the expected freeze length for the cutover.
- Rehearse the rollback once (§4) against staging.

## 3. Cutover

1. **Announce and freeze** (no app switch exists): agree a window; tell users
   to stop entering data; field devices must be online with an empty
   offline outbox (Sync status shows nothing pending) before the freeze.
   Optional: point the Vercel production domain at a maintenance page.
2. **Code on prod**: the new prod deployment runs `main`
   (`CONVEX_DEPLOY_KEY` = prod key; run the workflow with `target: production`).
3. **Run** (plan first, then for real):
   ```bash
   export SOURCE_DEPLOYMENT=vibrant-stork-860 PROD_DEPLOYMENT=<new prod> CONFIRM_PROD=<new prod>
   export COMPANY_NAME="<farm>" COMPANY_CODE=<CODE> FREEZE_CONFIRMED=1
   scripts/ops/cutover.sh
   DRY_RUN=0 scripts/ops/cutover.sh
   ```
   It snapshots the source and the (empty) target, imports with
   `--replace-all`, compares per-table counts (stops on mismatch), runs the
   M1 dry run, asks, then runs M1, M0-b, M16 and the M10 check.
4. **Switch** Vercel Production env vars to the new deployment (printed by
   the script), redeploy, smoke-test (sign in, dashboard, one cage, one daily
   entry, one feed purchase), lift the freeze.
5. **Keep** `vibrant-stork-860` untouched for at least one release as the
   rollback point. Stop deploying to it (CI now targets prod).

## 4. Rollback

```bash
SOURCE_DEPLOYMENT=vibrant-stork-860 PROD_DEPLOYMENT=<new prod> DRY_RUN=0 scripts/ops/cutover-rollback.sh
```

It snapshots the new prod (to keep anything written after the cutover) and
prints the Vercel switch-back. The old deployment was never written to by
the cutover, so switching the env vars back restores the pre-cutover state;
entries made on the new prod in between must be re-entered from the snapshot.
