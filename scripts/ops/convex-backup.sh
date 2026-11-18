#!/usr/bin/env bash
# Snapshot a Convex deployment (tables + file storage) to a local ZIP, with a
# sha256 and per-table row counts next to it. Read-only on the deployment.
#
#   SOURCE_DEPLOYMENT=<name> [BACKUP_DIR=backups] [DRY_RUN=0] scripts/ops/convex-backup.sh
#
# Store the ZIP off-machine (encrypted). It contains every tenant's data.
source "$(dirname "$0")/lib.sh"
require SOURCE_DEPLOYMENT
BACKUP_DIR="${BACKUP_DIR:-backups}"
banner
run mkdir -p "$BACKUP_DIR"
ZIP="$BACKUP_DIR/$SOURCE_DEPLOYMENT-$(stamp).zip"
export_snapshot "$SOURCE_DEPLOYMENT" "$ZIP"
echo "$ZIP"
