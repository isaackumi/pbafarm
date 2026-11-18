#!/usr/bin/env bash
# OPS-004: load staging with a copy of live data, then run the legacy-data
# migrations there (dry runs by default) so a release is tested on real data.
#
#   SOURCE_DEPLOYMENT=<live> STAGING_DEPLOYMENT=<staging> PROD_DEPLOYMENT=<prod> \
#   [COMPANY_NAME=… COMPANY_CODE=… APPLY_MIGRATIONS=1] [DRY_RUN=0] scripts/ops/staging-refresh.sh
#
# Staging must already run the release branch's code (push release/** with
# CONVEX_DEPLOY_KEY_STAGING set, or `npx convex deploy` with that key).
# Staging then holds real customer data: keep it behind Cloudflare Access
# (CF-007) and don't add people who couldn't see production.
source "$(dirname "$0")/lib.sh"
require SOURCE_DEPLOYMENT STAGING_DEPLOYMENT PROD_DEPLOYMENT
[ "$STAGING_DEPLOYMENT" != "$PROD_DEPLOYMENT" ] || die "STAGING_DEPLOYMENT must not be production"
[ "$STAGING_DEPLOYMENT" != "$SOURCE_DEPLOYMENT" ] || die "STAGING_DEPLOYMENT must differ from SOURCE_DEPLOYMENT"
BACKUP_DIR="${BACKUP_DIR:-backups}"
banner
run mkdir -p "$BACKUP_DIR"

log "1/4 Snapshot live ($SOURCE_DEPLOYMENT)"
ZIP="$BACKUP_DIR/$SOURCE_DEPLOYMENT-$(stamp).zip"
export_snapshot "$SOURCE_DEPLOYMENT" "$ZIP"

log "2/4 Replace staging data ($STAGING_DEPLOYMENT)"
guard_write_target "$STAGING_DEPLOYMENT"
run $CONVEX import --deployment "$STAGING_DEPLOYMENT" --replace-all -y "$ZIP"

log "3/4 Legacy-data report on staging"
convex_run "$STAGING_DEPLOYMENT" migrations:preflightUnscoped
convex_run "$STAGING_DEPLOYMENT" legacyData:m10VerifyNarrowReady

log "4/4 Migrations on staging"
APPLY="false"; [ "${APPLY_MIGRATIONS:-0}" = "1" ] && APPLY="true"
DRYRUN_JSON=$([ "$APPLY" = "true" ] && echo false || echo true)
if [ -n "${COMPANY_NAME:-}" ] && [ -n "${COMPANY_CODE:-}" ]; then
  convex_run "$STAGING_DEPLOYMENT" migrations:assignUnscopedToCompany \
    "{\"name\":\"$COMPANY_NAME\",\"code\":\"$COMPANY_CODE\",\"dryRun\":$DRYRUN_JSON}"
else
  warn "COMPANY_NAME/COMPANY_CODE unset: skipping M1 (assignUnscopedToCompany)."
fi
convex_run "$STAGING_DEPLOYMENT" migrations:repairStaleCageWeight "{\"dryRun\":$DRYRUN_JSON}"
convex_run "$STAGING_DEPLOYMENT" legacyData:m16ConvertLegacyTransfers "{\"dryRun\":$DRYRUN_JSON}"
convex_run "$STAGING_DEPLOYMENT" legacyData:m10VerifyNarrowReady
[ "$APPLY" = "true" ] || log "Migrations were reported only. APPLY_MIGRATIONS=1 writes them (staging only)."
