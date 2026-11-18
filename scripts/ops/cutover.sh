#!/usr/bin/env bash
# OPS-004 cutover: move live data from SOURCE_DEPLOYMENT (today the dev
# deployment vibrant-stork-860) to the new production deployment, migrate it,
# then point Vercel at it. Rehearse on staging first (staging-refresh.sh).
#
#   SOURCE_DEPLOYMENT=<old live> PROD_DEPLOYMENT=<new prod> CONFIRM_PROD=<new prod> \
#   COMPANY_NAME=… COMPANY_CODE=… FREEZE_CONFIRMED=1 [APPLY_MIGRATIONS=1] [DRY_RUN=0] scripts/ops/cutover.sh
#
# Preconditions (docs/ops/staging-and-cutover.md §Cutover):
#   - PROD_DEPLOYMENT already runs main's code (CI with the prod deploy key)
#     and has its env vars (auth keys, SITE_URL, LLM keys...).
#   - Writes are frozen: users told, field devices synced their outbox.
# The source deployment is never modified, which is what makes rollback safe.
source "$(dirname "$0")/lib.sh"
require SOURCE_DEPLOYMENT PROD_DEPLOYMENT COMPANY_NAME COMPANY_CODE
[ "$SOURCE_DEPLOYMENT" != "$PROD_DEPLOYMENT" ] || die "SOURCE and PROD deployments must differ"
[ "${FREEZE_CONFIRMED:-0}" = "1" ] || die "Freeze writes first (runbook step 1), then set FREEZE_CONFIRMED=1"
guard_write_target "$PROD_DEPLOYMENT"
BACKUP_DIR="${BACKUP_DIR:-backups}"
banner
run mkdir -p "$BACKUP_DIR"

log "1/6 Final snapshot of $SOURCE_DEPLOYMENT (after the freeze)"
ZIP="$BACKUP_DIR/cutover-$SOURCE_DEPLOYMENT-$(stamp).zip"
export_snapshot "$SOURCE_DEPLOYMENT" "$ZIP"

log "2/6 Safety snapshot of $PROD_DEPLOYMENT before replacing it"
export_snapshot "$PROD_DEPLOYMENT" "$BACKUP_DIR/pre-cutover-$PROD_DEPLOYMENT-$(stamp).zip"

log "3/6 Import into $PROD_DEPLOYMENT (replaces all its data)"
run $CONVEX import --deployment "$PROD_DEPLOYMENT" --replace-all -y "$ZIP"

log "4/6 Verify the copy"
CHECK="$BACKUP_DIR/cutover-check-$PROD_DEPLOYMENT-$(stamp).zip"
export_snapshot "$PROD_DEPLOYMENT" "$CHECK"
run node "$(dirname "$0")/snapshot-counts.mjs" "$ZIP" "$CHECK"

log "5/6 Legacy-data migrations on $PROD_DEPLOYMENT (M1, M0-b, M16), then verify"
convex_run "$PROD_DEPLOYMENT" migrations:preflightUnscoped
convex_run "$PROD_DEPLOYMENT" migrations:assignUnscopedToCompany "{\"name\":\"$COMPANY_NAME\",\"code\":\"$COMPANY_CODE\",\"dryRun\":true}"
confirm "Apply M1, M0-b and M16 to $PROD_DEPLOYMENT now (check the M1 dry run above)?" APPLY_MIGRATIONS
convex_run "$PROD_DEPLOYMENT" migrations:assignUnscopedToCompany "{\"name\":\"$COMPANY_NAME\",\"code\":\"$COMPANY_CODE\",\"dryRun\":false}"
convex_run "$PROD_DEPLOYMENT" migrations:repairStaleCageWeight '{"dryRun":false}'
convex_run "$PROD_DEPLOYMENT" legacyData:m16ConvertLegacyTransfers '{"dryRun":false}'
log "    M16 pages 200 rows per call: while isDone is false, re-run with '{\"dryRun\":false,\"cursor\":\"<continueCursor>\"}'."
convex_run "$PROD_DEPLOYMENT" legacyData:m10VerifyNarrowReady
log "    Expect ready: true. If a result says complete:false / isDone:false, re-run that step (they are idempotent)."

log "6/6 Switch the app (owner, in Vercel; not scripted)"
cat >&2 <<MSG
  Vercel → Project → Settings → Environment Variables (Production):
    NEXT_PUBLIC_CONVEX_URL       = https://$PROD_DEPLOYMENT.convex.cloud
    NEXT_PUBLIC_CONVEX_SITE_URL  = https://$PROD_DEPLOYMENT.convex.site
  Redeploy production, smoke-test (sign in, dashboard, one daily record), lift the freeze.
  Keep $ZIP: it is the rollback point (scripts/ops/cutover-rollback.sh).
MSG
