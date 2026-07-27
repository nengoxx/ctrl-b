#!/usr/bin/env bash
# Update PRODUCTION to a released tag, end-to-end, for a human with no coding agent (UPDATE_PLAN §5).
#
#   bash ~/apps/ctrl-b/deploy/linux/update.sh v1.3.0
#   bash ~/apps/ctrl-b/deploy/linux/update.sh v1.3.0 --force     # skip the CI-green requirement
#
# It is ORCHESTRATION ONLY. Everything that makes an update safe — the config preflight, the migration,
# the fatal verified stop, the dist swap and the health/identity gate — lives in `install.sh` (§15) and
# is deliberately NOT repeated here. This script adds exactly what install.sh cannot know: which tag,
# whether CI is green on it, whether rolling back would strand a config the older build cannot read,
# and what to tell the operator when any of that fails.
#
# Rollback is this same command with the previous tag (`update.sh v1.2.1`), which is why step 5 exists.

set -euo pipefail

# EVERYTHING lives in main(), called on the last line. Bash reads a script INCREMENTALLY, and step 6
# checks out a different version of this very file — without this wrapper the shell could resume in the
# middle of the NEW update.sh, executing a line whose context no longer exists.
main() {
  local tag="${1:-}" force="${2:-}"
  [ -n "$tag" ] || { echo "usage: update.sh <tag> [--force]   e.g. update.sh v1.3.0"; exit 2; }

  # ── 1. the prod tree, and only the prod tree (D32) ──────────────────────────────────────────────
  local repo="${REPO:-$HOME/apps/ctrl-b}"
  local ctrlb_home="${CTRLB_HOME:-$HOME/.ctrl-b}"   # the SAME default chain install.sh uses (below)
  [ -d "$repo/.git" ] || { echo "✗ $repo is not a git checkout — this script updates the PROD tree only."; exit 1; }
  case "$(cd "$repo" && pwd -P)" in
    "$(cd "$HOME/apps/ctrl-b" 2>/dev/null && pwd -P || echo /nonexistent)") ;;
    *) echo "✗ refusing: $repo is not the prod tree (~/apps/ctrl-b). The workspace is updated with git pull."; exit 1 ;;
  esac
  if [ -n "$(git -C "$repo" status --porcelain)" ]; then
    echo "✗ refusing: the prod tree has local changes. Prod must only ever move by checking out a tag."
    git -C "$repo" status --short | sed 's/^/    /'
    exit 1
  fi

  # ── 2. the deployment lock, handed to install.sh so the child does not block on its parent ──────
  # The bypass is keyed on the LOCK PATH, so this must be computed from the identical default chain
  # install.sh uses — a different spelling here means the child never matches and deadlocks on us.
  local lock="$ctrlb_home/.deploy.lock"
  mkdir -p "$ctrlb_home"
  command -v flock >/dev/null || { echo "✗ flock missing: sudo apt install -y util-linux"; exit 1; }
  exec 9>"$lock"
  flock -n 9 || { echo "✗ another install/update is already running ($lock)"; exit 1; }
  export CTRLB_DEPLOY_LOCK_HELD="$lock"

  # ── 3. the tag must exist on the remote ────────────────────────────────────────────────────────
  echo "-- fetching tags"
  git -C "$repo" fetch --tags --quiet || { echo "✗ git fetch failed — network? Nothing has changed."; exit 1; }
  git -C "$repo" rev-parse -q --verify "refs/tags/$tag" >/dev/null \
    || { echo "✗ tag '$tag' does not exist on origin. Release it first (deploy/linux/README.md §Release)."; exit 1; }

  # ── 4. CI gate: never knowingly deploy red. "Cannot check" is not "knowingly deploying red". ────
  if command -v gh >/dev/null; then
    local concl
    concl="$(cd "$repo" && gh run list --limit 20 --json headBranch,conclusion,status \
      --jq "[.[]|select(.headBranch==\"$tag\")][0] | (.conclusion // .status)" 2>/dev/null || true)"
    case "$concl" in
      success) echo "-- CI release gate: green" ;;
      "" | null) echo "   ! no CI run found for $tag — cannot verify the release gate; proceeding" ;;
      *) if [ "$force" = --force ]; then
           echo "   ! CI for $tag is '$concl' — proceeding because --force was given"
         else
           echo "✗ the CI release gate for $tag is '$concl', not success."
           echo "  Wait for it (gh run watch), or re-run with --force if you know why it is red."
           exit 1
         fi ;;
    esac
  else
    echo "   ! gh not installed — cannot check the release gate; proceeding"
  fi

  # ── 5. THE DOWNGRADE PRECHECK, before the checkout (§6) ────────────────────────────────────────
  # The refusal that matters lives in the code you roll back TO — and the tags before this release have
  # no checker at all. So it has to happen HERE, from the newer tree, while it still exists: read the
  # TARGET tag's config-shape version without checking it out, and compare it to what is on disk.
  local target_ver disk_ver
  target_ver="$(git -C "$repo" show "$tag:backend/app/config_migration/VERSION" 2>/dev/null | tr -dc '0-9')"
  target_ver="${target_ver:-0}"
  disk_ver="$(sed -n 's/^config_version:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$ctrlb_home/config.yaml" 2>/dev/null | head -1)"
  disk_ver="${disk_ver:-0}"
  if [ "$disk_ver" -gt "$target_ver" ]; then
    echo "✗ refusing: your config is at shape version $disk_ver, but $tag only understands $target_ver."
    echo "  That build cannot read this config, and it has no checker of its own to tell you so — it"
    echo "  would boot 'healthy' with its providers silently empty. Restore the config FIRST:"
    echo ""
    echo "    systemctl --user stop ctrl-b-dashboard"
    echo "    ls -t $ctrlb_home/backups/config.yaml.*        # newest pre-migration backup"
    echo "    cp -p <that file> $ctrlb_home/config.yaml"
    echo ""
    echo "  then re-run this same command. Full sequence: deploy/linux/README.md §Rollback → CONFIG."
    exit 78
  fi

  # ── 6. go ──────────────────────────────────────────────────────────────────────────────────────
  local from backups_before
  from="$(git -C "$repo" describe --tags --exact-match 2>/dev/null || git -C "$repo" rev-parse --short HEAD)"
  # Snapshot the backup set so a failure can name the EXACT file to restore rather than describing it.
  backups_before="$(ls -1 "$ctrlb_home/backups/"config.yaml.* 2>/dev/null || true)"
  echo "-- updating prod: $from → $tag"
  git -C "$repo" checkout --quiet "$tag" || { echo "✗ checkout failed; prod is untouched at $from."; exit 1; }

  if ! bash "$repo/deploy/linux/install.sh" prod; then
    echo ""
    echo "════ UPDATE FAILED ════"
    local state
    state="$(systemctl --user is-active ctrl-b-dashboard.service 2>/dev/null || true)"
    if [ "$state" = active ]; then
      echo "prod is RUNNING — the failure was before the cutover, so the previous version is still serving."
    else
      echo "prod is STOPPED (state: ${state:-unknown}) — it is DOWN until you act."
    fi
    local new_backup
    new_backup="$(ls -1 "$ctrlb_home/backups/"config.yaml.* 2>/dev/null | grep -vxF "$backups_before" | tail -1 || true)"
    echo ""
    echo "go back:"
    echo "    cd $repo && git checkout $from && bash deploy/linux/install.sh prod"
    if [ -n "$new_backup" ]; then
      echo ""
      echo "⚠ YOUR CONFIG WAS MIGRATED during this run, so the tag revert alone is NOT enough — $from"
      echo "  cannot read the new shape. Restore it first, with the service stopped:"
      echo "    systemctl --user stop ctrl-b-dashboard"
      echo "    cp -p $new_backup $ctrlb_home/config.yaml"
    fi
    echo ""
    echo "No automatic revert was attempted: rolling back is a decision, and doing it silently would"
    echo "hide which of the two states above you are actually in."
    exit 1
  fi

  # ── 7. verify what is actually running (install.sh already gated health + identity) ─────────────
  local at
  at="$(git -C "$repo" describe --tags --exact-match 2>/dev/null || true)"
  [ "$at" = "$tag" ] || { echo "✗ tree is at '${at:-unknown}', expected '$tag'."; exit 1; }
  echo ""
  echo "✓ prod updated: $from → $tag"
  echo "  verify on a device: https://emma.lobster-vector.ts.net"
  echo "  roll back with:     bash $repo/deploy/linux/update.sh $from"
}

main "$@"
