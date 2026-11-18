#!/usr/bin/env bash
# OPS-004 rollback: go back to SOURCE_DEPLOYMENT, which cutover never changed.
# First snapshots PROD_DEPLOYMENT so any writes made after the cutover can be
# recovered by hand, then prints the Vercel switch-back.
#
#   SOURCE_DEPLOYMENT=<old live> PROD_DEPLOYMENT=<new prod> [DRY_RUN=0] scripts/ops/cutover-rollback.sh
source "$(dirname "$0")/lib.sh"
require SOURCE_DEPLOYMENT PROD_DEPLOYMENT
BACKUP_DIR="${BACKUP_DIR:-backups}"
banner
run mkdir -p "$BACKUP_DIR"

log "1/2 Keep what was written to $PROD_DEPLOYMENT after the cutover"
export_snapshot "$PROD_DEPLOYMENT" "$BACKUP_DIR/rollback-$PROD_DEPLOYMENT-$(stamp).zip"

log "2/2 Switch the app back (owner, in Vercel)"
cat >&2 <<MSG
  Freeze writes again, then in Vercel (Production env):
    NEXT_PUBLIC_CONVEX_URL       = https://$SOURCE_DEPLOYMENT.convex.cloud
    NEXT_PUBLIC_CONVEX_SITE_URL  = https://$SOURCE_DEPLOYMENT.convex.site
  Redeploy, smoke-test, lift the freeze. Rows created on $PROD_DEPLOYMENT after
  the cutover are only in the snapshot above; re-enter them by hand or with
  a targeted import (--append on a single --table) after review.
  Do NOT point CI's CONVEX_DEPLOY_KEY back at $SOURCE_DEPLOYMENT until the cause is fixed.
MSG
