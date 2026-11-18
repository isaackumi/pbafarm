#!/usr/bin/env bash
# Restore drill: import a backup into a THROWAWAY deployment, export it back
# and compare per-table counts with the backup. Proves the backup restores.
#
#   BACKUP_ZIP=backups/x.zip DRILL_DEPLOYMENT=<scratch name> \
#   PROD_DEPLOYMENT=<prod name> [DRY_RUN=0] scripts/ops/convex-restore-drill.sh
#
# DRILL_DEPLOYMENT is wiped (--replace-all). Never point it at prod or staging.
source "$(dirname "$0")/lib.sh"
require BACKUP_ZIP DRILL_DEPLOYMENT PROD_DEPLOYMENT
[ "$DRILL_DEPLOYMENT" != "$PROD_DEPLOYMENT" ] || die "DRILL_DEPLOYMENT must not be production"
[ -z "${STAGING_DEPLOYMENT:-}" ] || [ "$DRILL_DEPLOYMENT" != "$STAGING_DEPLOYMENT" ] || die "DRILL_DEPLOYMENT must not be staging"
dry || [ -f "$BACKUP_ZIP" ] || die "$BACKUP_ZIP not found"
banner

if [ -f "$BACKUP_ZIP.sha256" ] && ! dry; then
  log "Checking checksum"
  shasum -a 256 -c "$BACKUP_ZIP.sha256"
fi

log "1/3 Import into $DRILL_DEPLOYMENT (replaces all its data)"
log "    The drill deployment must already run the same code (schema) as the backup's source."
run $CONVEX import --deployment "$DRILL_DEPLOYMENT" --replace-all -y "$BACKUP_ZIP"

log "2/3 Export it back"
ROUNDTRIP="${BACKUP_ZIP%.zip}.drill-$(stamp).zip"
export_snapshot "$DRILL_DEPLOYMENT" "$ROUNDTRIP"

log "3/3 Compare row counts"
run node "$(dirname "$0")/snapshot-counts.mjs" "$BACKUP_ZIP" "$ROUNDTRIP"
log "Record the date, backup name and result in docs/ops/backup-restore.md (drill log)."
