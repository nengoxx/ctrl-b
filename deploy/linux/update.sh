#!/usr/bin/env bash
# Update PRODUCTION to a released tag, end-to-end, for a human with no coding agent (UPDATE_PLAN §5).
#
#   bash ~/apps/ctrl-b/deploy/linux/update.sh v1.3.0
#   bash ~/apps/ctrl-b/deploy/linux/update.sh v1.3.0 --force     # proceed despite an unverifiable CI state
#
# It is ORCHESTRATION ONLY. Everything that makes an update safe — the config preflight, the migration,
# the fatal verified stop, the dist swap and the health/identity gate — lives in `install.sh` (§15) and
# is deliberately NOT repeated here. This script adds what install.sh cannot know: which tag, whether CI
# is green on it, whether rolling back would strand a config the older build cannot read, and what to
# tell the operator when any of that fails.
#
# FAIL-CLOSED is the rule (§17.1): every state this script cannot positively verify is a refusal, not a
# warning, because the alternative is a production deploy proceeding on an assumption.

set -euo pipefail

# EVERYTHING lives in main(), called on the last line. Bash reads a script INCREMENTALLY, and step 7
# checks out a different version of this very file — without this wrapper the shell could resume in the
# middle of the NEW update.sh, executing a line whose context no longer exists.

#: A file's content as a bounded non-negative integer, or failure. NEVER a pipeline: under `pipefail` a
#: failing `git show` makes the whole assignment fail and `errexit` kills the script before any `:-0`
#: default is reached — which is exactly how the "absent VERSION ⇒ 0" contract silently became "exit
#: 128, no message" (Codex H1, reproduced). Malformed content is rejected, not stripped: `tr -dc` turned
#: `v1.2` into `12` and `abc` into `0` (M1).
parse_version() {
  local raw="${1-}"
  raw="${raw//[$' \t\r\n']/}"
  [[ "$raw" =~ ^0*[0-9]{1,9}$ ]] || return 1   # leading zeros fine; bounded so `-gt` cannot error
  printf '%s' "$((10#$raw))"
}

#: `/api/health` for a unit, as `status version pid`, or empty. Used for the updater's OWN verification —
#: `install.sh` gates this too, but ONLY the version of install.sh that shipped with the safety protocol.
probe_health() {
  local port="$1" venv="$2" body=""
  body="$(curl -fsS --max-time 3 "http://127.0.0.1:$port/api/health" 2>/dev/null || true)"
  [ -n "$body" ] || return 1
  printf '%s' "$body" | "$venv/bin/python" -c 'import json,sys
try: d = json.load(sys.stdin)
except Exception: sys.exit(1)
print(d.get("status",""), d.get("version",""), d.get("pid",""))' 2>/dev/null || return 1
}

main() {
  local tag="${1:-}" force="${2:-}"
  [ -n "$tag" ] || { echo "usage: update.sh <tag> [--force]   e.g. update.sh v1.3.0"; exit 2; }

  # ── 1. the prod tree, and only the prod tree (D32) ──────────────────────────────────────────────
  local repo="${REPO:-$HOME/apps/ctrl-b}" expect="$HOME/apps/ctrl-b"
  [ -d "$repo/.git" ] || { echo "✗ $repo is not a git checkout — this script updates the PROD tree only."; exit 1; }
  [ -d "$expect" ] || { echo "✗ the prod tree $expect does not exist on this machine."; exit 1; }
  # Both sides resolved explicitly, with no sentinel fallback: a `/nonexistent` placeholder could itself
  # be matched by a REPO override, and the canonical path being a symlink must not silently admit
  # whatever it points at (Codex M3).
  local repo_real expect_real
  repo_real="$(cd "$repo" && pwd -P)"
  expect_real="$(cd "$expect" && pwd -P)"
  [ "$repo_real" = "$expect_real" ] || {
    echo "✗ refusing: $repo resolves to $repo_real, not the prod tree ($expect_real)."
    echo "  The workspace is updated with git pull, never with this script."; exit 1; }

  # The updater must operate on the file the APP will actually load. It resolves `.env` → CTRLB_CONFIG /
  # CTRLB_HOME → default, and this script cannot faithfully reproduce that chain from the outside, so an
  # override is a refusal rather than a guess (Codex H3): guessing wrong means comparing the shape of a
  # config nobody loads and permitting a rollback that strands the real one.
  local ctrlb_home="${CTRLB_HOME:-$HOME/.ctrl-b}"
  [ -z "${CTRLB_CONFIG:-}" ] || { echo "✗ CTRLB_CONFIG is set; this updater cannot verify config compatibility against an overridden path. Unset it, or follow README §Release manually."; exit 1; }
  [ ! -f "$repo/.env" ] || { echo "✗ $repo/.env exists and may redirect the config path; this updater cannot faithfully resolve it. Follow README §Release manually."; exit 1; }
  local cfg="$ctrlb_home/config.yaml"

  if [ -n "$(git -C "$repo" status --porcelain)" ]; then
    echo "✗ refusing: the prod tree has local changes. Prod must only ever move by checking out a tag."
    git -C "$repo" status --short | sed 's/^/    /'
    exit 1
  fi

  # ── 2. the deployment lock, handed to install.sh so the child does not block on its parent ──────
  local lock="$ctrlb_home/.deploy.lock"
  mkdir -p "$ctrlb_home"
  command -v flock >/dev/null || { echo "✗ flock missing: sudo apt install -y util-linux"; exit 1; }
  exec 9>"$lock"
  flock -n 9 || { echo "✗ another install/update is already running ($lock)"; exit 1; }
  export CTRLB_DEPLOY_LOCK_HELD="$lock"   # the path, not `1` — install.sh only skips a lock it can name

  # ── 3. the tag must exist ON ORIGIN, not merely in the local ref namespace ──────────────────────
  echo "-- fetching tags"
  git -C "$repo" fetch --tags --quiet || { echo "✗ git fetch failed — network? Nothing has changed."; exit 1; }
  # A local `rev-parse` would be satisfied by a stale or hand-made local tag that origin never saw
  # (Codex H5). Ask the remote.
  git -C "$repo" ls-remote --tags --exit-code origin "refs/tags/$tag" >/dev/null 2>&1 \
    || { echo "✗ tag '$tag' does not exist on origin. Release it first (README §Release)."; exit 1; }
  local tag_sha
  tag_sha="$(git -C "$repo" rev-list -n1 "refs/tags/$tag")"

  # ── 4. CI gate — fail closed on anything unverifiable ───────────────────────────────────────────
  local ci_ok=no ci_why=""
  if command -v gh >/dev/null; then
    local runs=""
    if runs="$(cd "$repo" && gh run list --limit 30 --json headBranch,headSha,event,conclusion,status 2>/dev/null)"; then
      local concl
      # Bound to the tag AND its commit AND a push event, so a same-named branch or a second workflow
      # cannot answer for the release gate (Codex H5).
      concl="$(printf '%s' "$runs" | "$repo/backend/.venv/bin/python" -c 'import json,sys
tag, sha = sys.argv[1], sys.argv[2]
runs = json.load(sys.stdin)
m = [r for r in runs if r.get("headBranch") == tag and r.get("headSha") == sha and r.get("event") == "push"]
print((m[0].get("conclusion") or m[0].get("status") or "") if m else "none")' "$tag" "$tag_sha" 2>/dev/null || echo error)"
      case "$concl" in
        success) ci_ok=yes ;;
        none)    ci_why="no release-gate run found for $tag ($tag_sha). If you just pushed the tag it has not started yet." ;;
        error)   ci_why="could not interpret the CI response." ;;
        *)       ci_why="the release gate for $tag is '$concl', not success." ;;
      esac
    else
      ci_why="gh could not list runs (auth? network?)."
    fi
  else
    ci_why="gh is not installed, so the release gate cannot be checked."
  fi
  if [ "$ci_ok" != yes ]; then
    echo "✗ $ci_why"
    echo "  Wait for the gate, or re-run with --force if you know why you are deploying anyway:"
    echo "      gh run watch \$(gh run list --limit 5 --json databaseId,headBranch \\"
    echo "        --jq '[.[]|select(.headBranch==\"$tag\")][0].databaseId') --exit-status"
    [ "$force" = --force ] || exit 1
    echo "   ! proceeding because --force was given"
  else
    echo "-- CI release gate: green ($tag_sha)"
  fi

  # ── 5. compatibility: would this tag be able to read the config that is on disk? (G4) ───────────
  # The refusal has to happen HERE, from the newer tree: the tags before this release carry no checker
  # of their own, so nothing downstream would ever notice.
  local target_ver=0 target_has_runner=no raw
  if raw="$(git -C "$repo" show "$tag:backend/app/config_migration/VERSION" 2>/dev/null)"; then
    target_has_runner=yes
    target_ver="$(parse_version "$raw")" || {
      echo "✗ $tag's config_migration/VERSION is not a plain integer — that build is damaged; do not deploy it."; exit 78; }
  fi
  local disk_ver=0 marker_line=""
  if [ -f "$cfg" ]; then
    marker_line="$(grep -m1 '^config_version:' "$cfg" 2>/dev/null || true)"
    if [ -n "$marker_line" ]; then
      disk_ver="$(parse_version "${marker_line#config_version:}")" || {
        echo "✗ $cfg has a malformed config_version line. Fix or remove it, then re-run."; exit 78; }
    fi
  fi
  if [ "$disk_ver" -gt "$target_ver" ]; then
    echo "✗ refusing: your config is at shape version $disk_ver, but $tag only understands $target_ver."
    print_config_restore "$ctrlb_home"; exit 78
  fi
  # A config carrying the NEW shape but no marker reads as 0 and would sail into an old build, whose
  # tolerant sections swallow `providers:` and boot empty (Codex H4). The marker is trusted only when
  # the shape agrees with it.
  if [ "$target_ver" -eq 0 ] && [ -z "$marker_line" ] && [ -f "$cfg" ] && grep -qE '^providers:' "$cfg"; then
    echo "✗ refusing: $cfg already carries the new `providers:` shape but is UNSTAMPED, and $tag cannot"
    echo "  read it — it would start and report healthy with no providers at all."
    print_config_restore "$ctrlb_home"; exit 78
  fi

  # ── 6. never DRIVE an installer that predates the safety protocol (Codex H2) ────────────────────
  # `install.sh` only gates the stop, the migration and health/identity from this release onward. Older
  # tags swallow a failed stop and have no health gate, so running one from here would produce a
  # confident "✓ updated" over an unverified service. Rolling back that far is a documented MANUAL
  # procedure, and this script says so rather than pretending to own it.
  if [ "$target_has_runner" = no ]; then
    echo "✗ $tag predates the safe installer (no config_migration in that tree), so this script will not"
    echo "  drive its deploy: its install.sh swallows a failed stop and has no health gate, and a '✓'"
    echo "  from here would mean nothing. Roll back manually — README §Rollback has the exact sequence:"
    echo ""
    print_config_restore "$ctrlb_home"
    echo "    4. cd $repo && git checkout $tag && bash deploy/linux/install.sh prod"
    echo "    5. curl -s -m5 localhost:5433/api/health     # verify by hand: this build cannot self-verify"
    exit 1
  fi

  # ── 7. go ──────────────────────────────────────────────────────────────────────────────────────
  local from
  from="$(git -C "$repo" describe --tags --exact-match 2>/dev/null || git -C "$repo" rev-parse --short HEAD)"
  echo "-- updating prod: $from → $tag"
  git -C "$repo" checkout --quiet "$tag" || { echo "✗ checkout failed; prod is untouched at $from."; exit 1; }

  local rc=0
  bash "$repo/deploy/linux/install.sh" prod || rc=$?

  # ── 8. the updater's OWN verification, and a state report that never guesses ────────────────────
  local unit="$HOME/.config/systemd/user/ctrl-b-dashboard.service" port=5433
  [ ! -f "$unit" ] || port="$(sed -n 's/.*--port \([0-9][0-9]*\).*/\1/p' "$unit" | head -1)"
  local state health="" hstatus="" hver=""
  state="$(systemctl --user is-active ctrl-b-dashboard.service 2>/dev/null || true)"
  if health="$(probe_health "${port:-5433}" "$repo/backend/.venv")"; then
    read -r hstatus hver _ <<<"$health"
  fi

  if [ "$rc" -eq 0 ] && [ "$state" = active ] && [ "$hstatus" = ok ] && [ "${hver}" = "${tag#v}" ]; then
    echo ""
    echo "✓ prod updated: $from → $tag  (serving $hver)"
    echo "  verify on a device: https://emma.lobster-vector.ts.net"
    # The rollback hint must be VERSION-AWARE (v1.3.0 release finding): after a run that migrated the
    # config, `update.sh $from` against a pre-runner tag is refused by step 5 (safe, but the hint sent
    # the operator into a refusal), and the real sequence starts with the CONFIG restore. Only offer
    # the one-liner when $from can actually read today's on-disk shape.
    local from_ver=0 fraw cur_ver=0 cur_line
    if fraw="$(git -C "$repo" show "$from:backend/app/config_migration/VERSION" 2>/dev/null)"; then
      from_ver="$(parse_version "$fraw" || echo 0)"
    fi
    cur_line="$(grep -m1 '^config_version:' "$cfg" 2>/dev/null || true)"
    [ -z "$cur_line" ] || cur_ver="$(parse_version "${cur_line#config_version:}" || echo 0)"
    if [ "$from_ver" -ge "$cur_ver" ]; then
      echo "  roll back with:     bash $repo/deploy/linux/update.sh $from"
    else
      echo "  roll back:          NOT a one-liner — this run migrated your config (shape $disk_ver → $cur_ver),"
      echo "                      which $from cannot read. Follow README §Rollback: restore the config"
      echo "                      backup printed above FIRST, then re-deploy $from."
    fi
    return 0
  fi

  echo ""
  echo "════ UPDATE FAILED ════"
  # The phase is NEVER inferred from `is-active` (Codex H7): a post-cutover health failure can leave the
  # unit active, which the old wording called "pre-cutover, previous version serving" — the opposite of
  # the truth. Report what was observed and let the operator read it.
  case "$state" in
    active) echo "unit: ACTIVE, serving ${hstatus:-no health response}${hver:+ version $hver}" ;;
    inactive | failed) echo "unit: $state — prod is DOWN." ;;
    "") echo "unit: state could not be queried (user bus?) — DO NOT assume it is stopped." ;;
    *) echo "unit: $state (transitional) — re-check before acting: systemctl --user status ctrl-b-dashboard" ;;
  esac
  echo "tree: now at $tag (was $from). install.sh exit: $rc"
  # Backup presence alone does not prove the config commit happened — the backup is written BEFORE the
  # writes (Codex M2). The marker on disk is the fact that matters, so read that instead.
  local now_ver=0 now_line=""
  now_line="$(grep -m1 '^config_version:' "$cfg" 2>/dev/null || true)"
  [ -z "$now_line" ] || now_ver="$(parse_version "${now_line#config_version:}" || echo 0)"
  echo ""
  if [ "$now_ver" -gt "$disk_ver" ]; then
    echo "⚠ YOUR CONFIG WAS MIGRATED during this run (shape $disk_ver → $now_ver), so a tag revert ALONE"
    echo "  would leave $from reading a shape it does not understand — it would start and report healthy"
    echo "  with NO providers. Go back in this order, all of it:"
    echo ""
    print_config_restore "$ctrlb_home"
    echo "    4. cd $repo && git checkout $from && bash deploy/linux/install.sh prod"
    echo "    5. curl -s -m5 localhost:${port:-5433}/api/health"
  else
    echo "the config was NOT migrated (still shape $now_ver), so the tag revert alone is sufficient:"
    echo "    cd $repo && git checkout $from && bash deploy/linux/install.sh prod"
  fi
  echo ""
  echo "No automatic revert was attempted: rolling back is a decision, and doing it silently would hide"
  echo "which of the states above you are actually in."
  exit 1
}

#: The CONFIG restore, printed identically everywhere it is needed so the operator never sees two
#: subtly different versions of the one sequence that must not be improvised.
print_config_restore() {
  local home="$1"
  echo "    1. systemctl --user stop ctrl-b-dashboard"
  echo "    2. ls -t $home/backups/config.yaml.*        # the newest is the copy from the run you are undoing"
  echo "    3. cp -p <that file> $home/config.yaml      # keeps 0600"
}

main "$@"
