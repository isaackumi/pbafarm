# Shared helpers for scripts/ops/*.sh (OPS-001 / OPS-004). Source, don't run.
#
# Every script is DRY-RUN by default: it prints the commands it would run.
# Set DRY_RUN=0 to execute. Targets are always explicit deployment names
# (never the CLI's implicit default), and importing into PROD_DEPLOYMENT needs
# CONFIRM_PROD=<that name> as well.
set -euo pipefail

DRY_RUN="${DRY_RUN:-1}"
CONVEX="${CONVEX:-npx convex}"

log() { printf '\n==> %s\n' "$*" >&2; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

dry() { [ "$DRY_RUN" != "0" ]; }

# Print the command; run it only when DRY_RUN=0.
run() {
  printf '+ %s\n' "$*" >&2
  if dry; then return 0; fi
  "$@"
}

require() {
  local name
  for name in "$@"; do
    [ -n "${!name:-}" ] || die "$name is required (see docs/ops/staging-and-cutover.md)"
  done
}

# Refuse to overwrite production unless CONFIRM_PROD names it exactly.
guard_write_target() {
  local target="$1"
  if [ -n "${PROD_DEPLOYMENT:-}" ] && [ "$target" = "$PROD_DEPLOYMENT" ]; then
    [ "${CONFIRM_PROD:-}" = "$target" ] || die "$target is PROD_DEPLOYMENT. Set CONFIRM_PROD=$target to write to it."
  fi
}

# Live runs only: ask before an irreversible step. Non-interactive runs must
# pre-approve with the named variable set to 1.
confirm() {
  local question="$1" var="$2"
  dry && return 0
  [ "${!var:-0}" = "1" ] && return 0
  [ -t 0 ] || die "$question Set $var=1 to approve non-interactively."
  local answer
  read -r -p "$question Type yes to continue: " answer
  [ "$answer" = "yes" ] || die "Stopped before: $question"
}

stamp() { date -u +%Y%m%dT%H%M%SZ; }


banner() {
  if dry; then
    log "DRY RUN — nothing is executed. Re-run with DRY_RUN=0 to do it."
  else
    log "LIVE RUN"
  fi
}

# Export a deployment (with file storage) to $1 and record checksum + counts.
export_snapshot() {
  local deployment="$1" zip="$2"
  run $CONVEX export --deployment "$deployment" --include-file-storage --path "$zip"
  if ! dry; then
    shasum -a 256 "$zip" > "$zip.sha256"
    node "$(dirname "${BASH_SOURCE[0]}")/snapshot-counts.mjs" "$zip" > "$zip.counts.json"
    log "Snapshot $zip ($(wc -c < "$zip" | tr -d ' ') bytes), counts in $zip.counts.json"
  fi
}

convex_run() {
  local deployment="$1"; shift
  run $CONVEX run --deployment "$deployment" "$@"
}
