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
# warning, because the alternative is a production deploy proceeding on an assumption. On the RECOVERY
# path (the failure report, the rollback hints) the same rule reads: an unknown is said to be unknown,
# never defaulted to the number that makes the advice permissive (ISS-90, UPDATE_PLAN §18).

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

#: The VALUE of a `config_version:` line AS THE MIGRATOR WRITES IT — ruamel stamps an end-of-line
#: comment (`config_version: 1  # config shape version — managed by …`), so the value must be cut at
#: the first `#` before `parse_version` sees it (which strips whitespace, a CRLF file's `\r` included). parse_version itself
#: stays strict: it also guards the VERSION file, where a stray `#` IS damage. The v1.3.1 release was
#: refused by exactly this — the v1.3.0 bootstrap run passed only because the config was still
#: unstamped, so the first stamp broke the first shipped-script run (caught 2026-07-28). ISS-90 was the
#: same omission at a third, hand-copied read site; `config_shape` is now the only caller.
marker_value() {
  local v="${1#config_version:}"
  printf '%s' "${v%%#*}"
}

#: The config SHAPE recorded in a config file — the ONE place this script reads `config_version`. Absent
#: file, or no line that names the key at column 0 → 0 (the migrator's own meaning). A line that NAMES the
#: key at column 0 but is not the exact marker the migrator writes → FAIL (rc 1, prints nothing): the caller
#: decides (refuse / "unknown" / skip), never a default number — a default here is how a recovery report
#: fails open. Case-sensitive (YAML keys are); indented or nested keys are not the marker.
#: History (why one reader): the v1.3.1 refusal and ISS-90 were both a hand-copied read drifting from the
#: others (`0f87652b` fixed "both call sites" while a third existed). The strict pattern refuses exactly
#: what the migrator refuses (`5#c` is the YAML string '5#c', `05` is not an int to it, `config_version:5`
#: with no space after the colon is not a mapping at all — the whitespace is required; a TAB there or before
#: the `#` is refused by the YAML scanner, so the separators are literal spaces, and only a final `\r` (a
#: CRLF file, which the migrator preserves) is tolerated); the loose one
#: catches a key spelled so that bash would otherwise read it as absent (BOM, quotes, a space before the
#: colon) while YAML still reads the number — both directions fail closed (UPDATE_PLAN §18).
#: An unreadable file FAILS too: it exists, so "absent → 0" would be a guess.
config_shape() {
  local f="$1" bom=$'\xEF\xBB\xBF' cr=$'\r' line
  [ -f "$f" ] || { printf 0; return 0; }
  [ -r "$f" ] || return 1
  line="$(LC_ALL=C grep -m1 -E "^config_version:[ ]+(0|[1-9][0-9]{0,8})([ ]+#.*)?[ ]*${cr}?\$" "$f" || true)"
  if [ -n "$line" ]; then parse_version "$(marker_value "$line")"; return; fi
  if LC_ALL=C grep -q -E "^(${bom})?[\"']?config_version[\"']?[[:space:]]*:" "$f"; then return 1; fi
  printf 0
}

#: The config shape the build at <rev> understands — its config_migration/VERSION; the ONE VERSION read.
#: Prints the number (rc 0) or nothing, with an rc that says WHY, because each answer means something
#: different to the caller (UPDATE_PLAN §18):
#:   2  <rev> is not a commit here, or its tree cannot be listed (decided on ls-tree's EXIT STATUS, so a
#:      missing tree object offline is never mistaken for "the file is absent")
#:   3  the tree has no VERSION file: a pre-runner build (≤ v1.2.1), which understands shape 0
#:   4  the tree lists the file but its blob is not here — prod is a `--filter=blob:none` clone, and an
#:      offline lazy fetch fails exactly like a missing file; that must never read as "pre-runner"
#:   1  the file is not a plain integer (damaged)
build_version() {
  local repo="$1" rev="$2" path=backend/app/config_migration/VERSION listed raw
  git -C "$repo" cat-file -e "$rev^{commit}" 2>/dev/null || return 2
  listed="$(git -C "$repo" ls-tree "$rev" -- "$path" 2>/dev/null)" || return 2
  [ -n "$listed" ] || return 3
  raw="$(git -C "$repo" show "$rev:$path" 2>/dev/null)" || return 4
  parse_version "$raw"
}

#: Every backup set the config MIGRATION took, as its <UTC stamp>, oldest first, once each: the stamps of the
#: regular files named EXACTLY `config.yaml.<YYYYmmddTHHMMSSZ>` or `config.yaml.<stamp>-<N>` — `_backup`'s
#: naming (config_migration `apply`): on a same-second collision it appends `-N` to each FILE that already
#: exists, so a second apply in one second writes `config.yaml.<T>-2` (an earlier strict-only rule hid
#: that set and the report failed OPEN). A hand copy (`.manual`, `manual-…`, `.pre-v…`) or a non-file is
#: never one. The stamps are fixed-width UTC, so name order is time order — no `ls -t`, which a `cp -p` or a
#: touch can reorder. Within one stamp the highest suffix is the latest apply (`config_backup`).
backup_stamps() {
  local f
  for f in "$1"/backups/config.yaml.*; do
    [[ "${f##*/}" =~ ^config\.yaml\.([0-9]{8}T[0-9]{6}Z)(-[0-9]+)?$ ]] || continue
    [ -f "$f" ] || continue   # a directory or dangling link with that name is not a backup (it would read as shape 0)
    printf '%s\n' "${BASH_REMATCH[1]}"
  done | LC_ALL=C sort -u
}

#: The highest-suffix file `backups/<prefix>.<stamp>[-N]` (the plain name counts as suffix 1), or failure.
#: `_backup` numbers each file on its own, so this is resolved per file: for the config and per agent.
latest_backup() {
  local f n best="" bestn=0
  for f in "$1"/backups/"$2"."$3" "$1"/backups/"$2"."$3"-*; do
    [ -f "$f" ] || continue
    n="${f##*."$3"}"; n="${n#-}"; n="${n:-1}"
    [[ "$n" =~ ^[0-9]+$ ]] || continue
    if (( 10#$n > bestn )); then best="$f"; bestn=$((10#$n)); fi
  done
  [ -n "$best" ] || return 1
  printf '%s' "$best"
}

#: The config backup of the set <stamp> (its highest suffix).
config_backup() { latest_backup "$1" config.yaml "$2"; }

#: The agent-file backups of ONE migration run, one path per line: `<agent>--agent.yaml.<stamp>[-N]`
#: (`_backup`'s naming; the run backs up every agent file it rewrites under the config's stamp), the
#: highest suffix per agent. Residual: two applies in one second that back up DIFFERENT agents are merged.
agent_backups() {
  local f name seen=$'\n'
  for f in "$1"/backups/*--agent.yaml."$2" "$1"/backups/*--agent.yaml."$2"-*; do
    [ -f "$f" ] || continue
    name="${f##*/}"; name="${name%%--agent.yaml.*}"
    [[ "$seen" != *$'\n'"$name"$'\n'* ]] || continue
    seen+="$name"$'\n'
    latest_backup "$1" "$name--agent.yaml" "$2" && printf '\n'
  done
}

#: The stamp of the backup set to restore for a build that reads shape <= $2: the NEWEST migration
#: backup whose own marker is <= $2. A backup whose marker is unreadable — or whose file cannot be
#: resolved — is never offered (a failed lookup must not read as "absent → shape 0"). Fails when nothing
#: qualifies.
restore_stamp() {
  local max="$2" stamp cb shape pick=""
  while IFS= read -r stamp; do
    [ -n "$stamp" ] || continue
    cb="$(config_backup "$1" "$stamp")" || continue
    shape="$(config_shape "$cb")" || continue
    [ "$shape" -gt "$max" ] || pick="$stamp"
  done <<<"$(backup_stamps "$1")"
  [ -n "$pick" ] || return 1
  printf '%s' "$pick"
}

# ── the migrator's run records (ISS-90 option C, UPDATE_PLAN §18.3) ─────────────────────────────────
# A write phase that rewrites agent files leaves `backups/<config backup name>.run` from just before its
# first agent write. Its STATE is its name, one rename each, never a sibling file:
#     .run  →  .run.committed (the migrator, at its commit) | .run.superseded (the migrator, a later
#              commit) | .run.resolved (closed without a commit: this script, or the operator's `mv`)
# So a `.run` that is still there names a run that rewrote agent files and NEVER committed — exactly,
# with no clock, reflog or shape heuristic (each was tried and reproduced false: a manual checkout
# defeats a time window; a committed same-shape migration matches a state rule). A state read from file
# contents is never left implicit: once every listed file is back, the record is RENAMED `.resolved`, so
# a later edit cannot reopen it (wave 5 — the reviewers' HIGH).

#: Every record of one state (<tail> = `.run` or `.run.superseded`), oldest first: by stamp, then by the
#: config backup's collision suffix (a plain name counts as 1).
records() {
  local f name n
  for f in "$1"/backups/config.yaml.*"$2"; do
    [ -f "$f" ] || continue
    name="${f##*/}"; name="${name%"$2"}"
    [[ "$name" =~ ^config\.yaml\.([0-9]{8}T[0-9]{6}Z)(-([0-9]+))?$ ]] || continue
    n="${BASH_REMATCH[3]:-1}"
    printf '%s %09d %s\n' "${BASH_REMATCH[1]}" "$((10#$n))" "$f"
  done | LC_ALL=C sort | cut -d' ' -f3-
}

#: The stamp a record names (from its file name).
record_stamp() { local n="${1##*/}"; n="${n#config.yaml.}"; printf '%s' "${n:0:16}"; }

#: A record's pairs as `<backup>\t<live>` absolute paths, one per line — or FAILURE when the record is not
#: exactly what the migrator writes. Each PAIR is checked, not only each side: the `stamp=` line first and
#: equal to the record's own name; the first pair `backups/config.yaml.<T>[-N]` → `config.yaml`; every
#: other pair `backups/<x>--agent.yaml.<T>[-N]` → `agents/<x>/agent.yaml` with the SAME `<x>`; every pair
#: of the record's own `<T>`; no `..`, whitespace or control character anywhere; at least one agent pair.
#: update.sh turns these into `cp` lines for a human, so a record that is anything else is never trusted.
#: `LC_ALL=C` pins the class to U+0000–U+0020 and DEL in EVERY locale (under a UTF-8 locale bash would
#: also refuse C1 and a dozen Unicode spaces — a rule the migrator could not mirror byte for byte).
record_pairs() {
  local home="$1" rec="$2" stamp line b l extra x first=1 n=0 out="" LC_ALL=C
  stamp="$(record_stamp "$rec")"
  while IFS= read -r line || [ -n "$line" ]; do
    if [ "$first" = 1 ]; then
      first=0
      [ "$line" = "stamp=$stamp" ] || return 1
      continue
    fi
    [[ "$line" == *$'\t'* ]] || return 1
    IFS=$'\t' read -r b l extra <<<"$line"
    [ -z "$extra" ] || return 1
    [[ "$b$l" != *..* ]] || return 1
    [[ ! "$b$l" =~ [[:space:][:cntrl:]] ]] || return 1
    if [ "$n" = 0 ]; then
      [[ "$b" =~ ^backups/config\.yaml\.${stamp}(-[0-9]+)?$ ]] && [ "$l" = config.yaml ] || return 1
    else
      [[ "$b" =~ ^backups/([^/]+)--agent\.yaml\.${stamp}(-[0-9]+)?$ ]] || return 1
      x="${BASH_REMATCH[1]}"
      [ "$l" = "agents/$x/agent.yaml" ] || return 1
    fi
    out+="$home/$b"$'\t'"$home/$l"$'\n'
    n=$((n + 1))
  done <"$rec"
  [ "$first" = 0 ] && [ "$n" -ge 2 ] || return 1
  printf '%s' "$out"
}

#: A `.run` record's state, by its contents: `broken:<reason>` (not one the migrator wrote, or a listed
#: backup is gone — never closed, never a `cp`), `committed` (the LIVE config's shape is above the
#: record's config backup: the migrator crashed between its config `os.replace` and the rename — the
#: commit is proven by the shape), `restored` (every listed live file is byte-identical to its backup:
#: nothing is half-applied), or `open`.
record_state() {
  local home="$1" rec="$2" pairs b l cfg_bak="" live_ver bak_ver open=no
  pairs="$(record_pairs "$home" "$rec")" || { printf 'broken:the run record %s is not one the migrator wrote' "$(q "$rec")"; return 0; }
  while IFS=$'\t' read -r b l; do
    [ -n "$b" ] || continue
    [ -f "$b" ] || { printf 'broken:backup %s listed by the record is missing' "$(q "$b")"; return 0; }
    [ -n "$cfg_bak" ] || cfg_bak="$b"
    cmp -s "$b" "$l" || open=yes
  done <<<"$pairs"
  if live_ver="$(config_shape "$home/config.yaml")" && bak_ver="$(config_shape "$cfg_bak")" \
    && [ "$live_ver" -gt "$bak_ver" ]; then
    printf committed; return 0
  fi
  if [ "$open" = yes ]; then printf open; else printf restored; fi
}

#: The OPEN run, as `<record path><TAB><state>` (a broken state's reason holds spaces): the OLDEST `.run`
#: that is open or broken — with no commit in between, every later attempt started from its
#: half-written state, so its set is the pre-state. On the way it CLOSES what its contents prove closed,
#: by the rename that makes the state durable (the deploy lock is held): `committed` → `.run.committed`,
#: `restored` → `.run.resolved` — and a SUPERSEDED record whose set is back in place is renamed
#: `.run.resolved` too, so it is never offered for a rollback again (a later edit would be lost to it;
#: wave 6). A superseded record is never renamed `committed` (its commit was another run's), and a broken
#: one is skipped: it blocks nothing, and `superseded_for` never offers it. Fails when no record is open.
open_run() {
  local rec st
  while IFS= read -r rec; do
    [ -n "$rec" ] || continue
    [ "$(record_state "$1" "$rec")" != restored ] || mv -f -- "$rec" "${rec%.superseded}.resolved"
  done <<<"$(records "$1" .run.superseded)"
  while IFS= read -r rec; do
    [ -n "$rec" ] || continue
    st="$(record_state "$1" "$rec")"
    case "$st" in
      committed) mv -f -- "$rec" "$rec.committed" ;;
      restored) mv -f -- "$rec" "$rec.resolved" ;;
      *) printf '%s\t%s' "$rec" "$st"; return 0 ;;
    esac
  done <<<"$(records "$1" .run)"
  return 1
}

#: The superseded record whose set is the real pre-state behind backup set <stamp>, if any: the OLDEST
#: `.run.superseded` stamped at or before <stamp> whose config backup is byte-identical to <stamp>'s. A
#: superseded run rewrote agent files, never committed, and later applies started from its half state
#: (each backing up the SAME untouched config, but only the agent files still to rewrite — already
#: half-migrated ones are not backed up again), so the FIRST of them holds every original (adversary
#: `supers2`). Residual: a config edited between two partials matches neither — the shape pick is offered.
superseded_for() {
  local home="$1" stamp="$2" cb rec pairs b
  cb="$(config_backup "$home" "$stamp")" || return 1
  while IFS= read -r rec; do
    [ -n "$rec" ] || continue
    (( 10#$(record_stamp "$rec" | tr -d TZ) <= 10#${stamp//[TZ]/} )) || continue
    pairs="$(record_pairs "$home" "$rec")" || continue
    b="${pairs%%$'\t'*}"
    if [ -f "$b" ] && cmp -s "$b" "$cb"; then printf '%s' "$rec"; return 0; fi
  done <<<"$(records "$home" .run.superseded)"
  return 1
}

#: THE set to offer for going back to a build that reads shape <= $2 (one resolver, so the success hint
#: names exactly what `update.sh $from` will print): `record<TAB><path>` for the superseded record behind
#: the shape-picked set, else `stamp<TAB><T>` (the shape pick, `restore_stamp`). Fails when nothing qualifies.
offer_set() {
  local stamp rec
  stamp="$(restore_stamp "$1" "$2")" || return 1
  if rec="$(superseded_for "$1" "$stamp")"; then printf 'record\t%s' "$rec"; else printf 'stamp\t%s' "$stamp"; fi
}

#: On a RETRY (the tree is already at <tag>), the version the first attempt left: the newest reflog hop
#: `checkout: moving from X to …` whose X is not <tag>'s commit, as a tag when one points at it, else a
#: short sha. The reflog is ground truth for every checkout, manual ones included; a same-tag checkout
#: logs nothing, so retries never bury the real hop. Fails when no such hop exists (a fresh clone, an
#: expired reflog) — the caller then says "unknown", never a self-referential "revert to <tag>".
reflog_from() {
  local repo="$1" tagc moves x xc
  tagc="$(git -C "$repo" rev-parse -q --verify "$2^{commit}" 2>/dev/null)" || return 1
  moves="$(git -C "$repo" reflog --format='%gs' 2>/dev/null | sed -n 's/^checkout: moving from \([^ ]*\) to .*/\1/p')" || return 1
  while IFS= read -r x; do
    [ -n "$x" ] || continue
    xc="$(git -C "$repo" rev-parse -q --verify "$x^{commit}" 2>/dev/null)" || continue
    [ "$xc" != "$tagc" ] || continue
    git -C "$repo" describe --tags --exact-match "$xc" 2>/dev/null || git -C "$repo" rev-parse --short "$xc"
    return 0
  done <<<"$moves"
  return 1
}

#: A path as a shell word, for the commands this script PRINTS for a human to paste: a space or a quote
#: in $HOME must not split a `cp` line into four arguments.
q() { printf '%q' "$1"; }

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
    # `--branch "$tag"`: the gate is looked up PER TAG. An unfiltered `--limit 30` window drops an older
    # tag's run after ~30 pushes, and then `update.sh v(prev)` — the rollback entry point that prints the
    # config restore — refuses here before it can say anything useful (ISS-90 N-1, measured 2026-10-22).
    if runs="$(cd "$repo" && gh run list --branch "$tag" --limit 30 --json headBranch,headSha,event,conclusion,status 2>/dev/null)"; then
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
  local target_ver target_has_runner=yes vrc=0
  target_ver="$(build_version "$repo" "$tag")" || vrc=$?
  case "$vrc" in
    0) ;;
    3) target_has_runner=no; target_ver=0 ;;
    2) echo "✗ cannot read $tag's tree in $repo (unknown tag, or a missing object). Nothing has changed."; exit 1 ;;
    4) echo "✗ $tag's config_migration/VERSION is not local in this blob:none clone, so its config shape cannot"
       echo "  be read: git -C $(q "$repo") fetch origin tag $tag   (or check the network). Nothing has changed."; exit 1 ;;
    *) echo "✗ $tag's config_migration/VERSION is not a plain integer — that build is damaged; do not deploy it."; exit 78 ;;
  esac
  local disk_ver
  disk_ver="$(config_shape "$cfg")" || {
    echo "✗ $cfg has a malformed config_version line. Fix or remove it, then re-run."; exit 78; }
  # A run that rewrote agent files and never committed (option C): no shape comparison can see it, and
  # deploying ANY tag over it — forward or back — builds on half-written agent files (a re-run of the
  # migration does not repair them: ISS-114). Refuse until its set is back (open_run then renames it
  # `.resolved` itself and this run proceeds) or the operator deliberately closes it (README §Rollback).
  local orun ostate orec
  if orun="$(open_run "$ctrlb_home")"; then
    orec="${orun%%$'\t'*}"; ostate="${orun#*$'\t'}"
    echo "✗ refusing: $(open_run_headline "$ctrlb_home" "$ostate" "$orec") — put this set back first, then re-run this same command:"
    if print_config_restore "$ctrlb_home" "$disk_ver" "$orec" ""; then
      echo "    4. bash $(q "$repo/deploy/linux/update.sh") $tag${force:+ $force}"
    else
      restore_unresolved "$tag"
    fi
    exit 78
  fi
  if [ "$disk_ver" -gt "$target_ver" ]; then
    echo "✗ refusing: your config is at shape $disk_ver, but $tag understands shape $target_ver or below."
    echo "  Put back the config $tag can read, then re-run this same command:"
    if print_config_restore "$ctrlb_home" "$target_ver" "" ""; then
      echo "    4. bash $(q "$repo/deploy/linux/update.sh") $tag${force:+ $force}"
    else
      restore_unresolved "$tag"
    fi
    exit 78
  fi
  # A config carrying the NEW shape at shape 0 (no marker) would sail into an old build, whose tolerant
  # sections swallow `providers:` and boot empty (Codex H4). The marker is trusted only when the shape
  # agrees with it. (`disk_ver -eq 0` replaces a second marker read; an explicit `config_version: 0`
  # with `providers:` is refused too, which is strictly safer.)
  if [ "$target_ver" -eq 0 ] && [ "$disk_ver" -eq 0 ] && grep -qE '^providers:' "$cfg" 2>/dev/null; then
    echo "✗ refusing: $cfg already carries the new 'providers:' shape but is UNSTAMPED, and $tag cannot"
    echo "  read it — it would start and report healthy with no providers at all. Put back the config"
    echo "  $tag can read:"
    print_config_restore "$ctrlb_home" 0 "" "" || restore_unresolved "$tag"
    exit 78
  fi

  # ── 6. never DRIVE an installer that predates the safety protocol (Codex H2) ────────────────────
  # `install.sh` only gates the stop, the migration and health/identity from this release onward. Older
  # tags swallow a failed stop and have no health gate, so running one from here would produce a
  # confident "✓ updated" over an unverified service. Rolling back that far is a documented MANUAL
  # procedure, and this script says so rather than pretending to own it. Step 5 has just proven the
  # config is at a shape that tag reads, so no config restore belongs in this sequence (A-5).
  if [ "$target_has_runner" = no ]; then
    echo "✗ $tag predates the safe installer (no config_migration in that tree), so this script will not"
    echo "  drive its deploy: its install.sh swallows a failed stop and has no health gate, and a '✓'"
    echo "  from here would mean nothing. Roll back by hand (README §Rollback). Your config is at a shape"
    echo "  $tag reads (checked above), so no config restore is needed:"
    echo "    1. systemctl --user stop ctrl-b-dashboard"
    echo "    2. cd $(q "$repo") && git checkout $tag && bash deploy/linux/install.sh prod"
    echo "    3. curl -s -m5 localhost:5433/api/health     # verify by hand: this build cannot self-verify"
    exit 1
  fi

  # ── 7. go ──────────────────────────────────────────────────────────────────────────────────────
  local unit="$HOME/.config/systemd/user/ctrl-b-dashboard.service" port=5433
  [ ! -f "$unit" ] || port="$(sed -n 's/.*--port \([0-9][0-9]*\).*/\1/p' "$unit" | head -1)"
  # Where we come FROM decides every rollback line in step 8, so it is fixed here, BEFORE the checkout,
  # together with the config shape it reads (A-2: the old code only knew it on the success path). After
  # a failed run the tree stays at $tag (no auto-revert), so on a re-run `git describe` names $tag itself
  # and the report would advise "revert to $tag" (ISS-90 G1): a tree already at $tag is either a manual
  # landing that is serving (nothing to do) or a RETRY, whose origin only the reflog still knows.
  local head_tag from="" from_ver="" from_has_runner=yes from_why="" retry=no
  head_tag="$(git -C "$repo" describe --tags --exact-match 2>/dev/null || true)"
  if [ "$head_tag" != "$tag" ]; then
    from="${head_tag:-$(git -C "$repo" rev-parse --short HEAD)}"
    echo "-- updating prod: $from → $tag"
  else
    # Serving this tag means: the unit is active, /api/health says ok at this version, AND the answering
    # pid is the unit's MainPID — a stale process answering after install.sh's identity gate failed must
    # not turn a failed run into "nothing to update" (the same check install.sh makes).
    local st0 h0="" hs0="" hv0="" hp0="" mpid=""
    st0="$(systemctl --user is-active ctrl-b-dashboard.service 2>/dev/null || true)"
    mpid="$(systemctl --user show -p MainPID --value ctrl-b-dashboard.service 2>/dev/null || true)"
    if h0="$(probe_health "${port:-5433}" "$repo/backend/.venv")"; then read -r hs0 hv0 hp0 <<<"$h0"; fi
    if [ "$st0" = active ] && [ "$hs0" = ok ] && [ "$hv0" = "${tag#v}" ] && [ -n "$hp0" ] && [ "$hp0" = "$mpid" ]; then
      echo "✓ already at $tag and serving it — nothing to update"
      exit 0
    fi
    # Not serving: a previous run of this update did not finish, OR it did and the service went down
    # since — the tree cannot tell the two apart, so the banner claims neither (review, 2026-10-22).
    retry=yes
    if from="$(reflog_from "$repo" "$tag")"; then
      echo "-- retrying $tag (the tree is already at $tag but the service is not serving it — a previous run of"
      echo "   this update did not finish, or the service is down; you came from $from per the git reflog — if"
      echo "   $from itself never finished deploying, go back further: README §Rollback step 2)"
    else
      from=""
      echo "-- retrying $tag (the tree is already at $tag but the service is not serving it — a previous run of"
      echo "   this update did not finish, or the service is down; the version you came from is unknown (no"
      echo "   reflog entry) — README §Rollback step 2)"
    fi
  fi
  if [ -z "$from" ]; then
    from_why="the version you came from is unknown (no reflog entry)"
  else
    vrc=0; from_ver="$(build_version "$repo" "$from")" || vrc=$?
    case "$vrc" in
      0) ;;
      3) from_has_runner=no; from_ver=0 ;;
      1) from_ver=0 ;;   # damaged VERSION: reads as "understands nothing" — the restore is advised, never skipped
      4) from_ver=""; from_why="$from's config_migration/VERSION is not local in this blob:none clone (git -C $(q "$repo") fetch origin tag $from, or check the network)" ;;
      *) from_ver=""; from_why="$from's tree cannot be read here (unknown revision, or a missing object)" ;;
    esac
    [ -n "$from_ver" ] || echo "   ! $from_why — a failure report could not tell whether a tag revert alone is enough."
  fi
  git -C "$repo" checkout --quiet "$tag" || { echo "✗ checkout failed; prod is untouched at ${from:-the previous tree}."; exit 1; }

  local rc=0 run_start
  run_start="$(date -u +%Y%m%dT%H%M%SZ)"   # labels a set "taken during this run" — a label, never a decision
  bash "$repo/deploy/linux/install.sh" prod || rc=$?

  # ── 8. the updater's OWN verification, and a state report that never guesses ────────────────────
  local state health="" hstatus="" hver=""
  state="$(systemctl --user is-active ctrl-b-dashboard.service 2>/dev/null || true)"
  if health="$(probe_health "${port:-5433}" "$repo/backend/.venv")"; then
    read -r hstatus hver _ <<<"$health"
  fi

  # ONE question decides every rollback line below, computed once and used by both reports (A-2): can
  # $from read the config as it is NOW — or is there an OPEN run (a migration that rewrote agent files and
  # never committed: the migrator's own record says so, option C)? Not "did the shape change this run": a
  # stamp-only run changes the file without stranding $from (A-2), and a half-written run does not move
  # the shape at all (G2). An open run decides even when $from is unknown: its set is the pre-state.
  local cur_ver restore=unknown orun="" ostate="" orec=""
  cur_ver="$(config_shape "$cfg")" || cur_ver=""
  if orun="$(open_run "$ctrlb_home")"; then orec="${orun%%$'\t'*}"; ostate="${orun#*$'\t'}"; fi
  if [ -n "$orec" ]; then
    restore=yes
  elif [ -n "$cur_ver" ] && [ -n "$from_ver" ]; then
    if [ "$cur_ver" -gt "$from_ver" ]; then restore=yes; else restore=no; fi
  fi

  if [ "$rc" -eq 0 ] && [ "$state" = active ] && [ "$hstatus" = ok ] && [ "${hver}" = "${tag#v}" ]; then
    echo ""
    echo "✓ prod updated: ${from:-unknown} → $tag  (serving $hver)"
    echo "  verify on a device: https://emma.lobster-vector.ts.net"
    # The rollback hint must be VERSION-AWARE (v1.3.0 release finding): `update.sh $from` refuses at
    # step 5 when $from cannot read today's shape, and the real sequence starts with the CONFIG restore.
    local stamp
    case "$restore" in
      no)  echo "  roll back with:     bash $(q "$repo/deploy/linux/update.sh") $from" ;;
      yes)
        if [ -n "$orec" ]; then
          echo "  roll back:          NOT a one-liner — $(open_run_headline "$ctrlb_home" "$ostate" "$orec");"
          echo "                      'update.sh <tag>' refuses until its set is back (README §Rollback step 2)."
        else
          stamp="$(offer_set "$ctrlb_home" "$from_ver")" || stamp="none"
          case "${stamp%%$'\t'*}" in
            record) stamp="$(record_stamp "${stamp#*$'\t'}") (the set of a migration that never committed — ISS-114)" ;;
            stamp) stamp="${stamp#*$'\t'}" ;;
            *) stamp="NONE FOUND — README §Rollback step 2" ;;
          esac
          echo "  roll back:          NOT a one-liner — your config is now shape $cur_ver (was $disk_ver) and $from"
          echo "                      reads $from_ver or below. 'update.sh $from' will refuse and print the exact"
          echo "                      restore first; the backup set it will name: $stamp"
        fi ;;
      *)
        if [ -z "$cur_ver" ]; then
          echo "  roll back:          could not read $cfg's config_version line — decide by README §Rollback step 2."
        else
          echo "  roll back:          $from_why — decide by README §Rollback step 2."
        fi ;;
    esac
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
  if [ "$retry" = yes ]; then
    echo "tree: at $tag (not moved by this run; the reflog's previous version: ${from:-unknown}). install.sh exit: $rc"
  else
    echo "tree: now at $tag (was ${from:-unknown}). install.sh exit: $rc"
  fi
  # $from may itself be a release that never served (a chain of failed updates, or a manual checkout of a
  # failed target before this run) — the reflog and the tree cannot tell; say so on every path.
  [ -z "$from" ] || echo "  (if $from itself never finished deploying, go back further: README §Rollback step 2)"
  # Backup presence alone does not prove the config commit happened — the backup is written BEFORE the
  # writes (Codex M2). The marker on disk is the fact for the shape (read once, above); the migrator's run
  # record is the fact for the agent files.
  echo ""
  case "$restore" in
    no)
      echo "config: shape $cur_ver, which $from reads ($from_ver or below) — the tag revert alone is enough:"
      echo "    cd $(q "$repo") && git checkout $from && bash deploy/linux/install.sh prod" ;;
    yes)
      if [ -n "$orec" ]; then
        # The partial write (G2). NOT "re-run, it converges": reproduced false for a derive-and-rename
        # step — the re-run stamps the config and the derived data is lost for good (ISS-114).
        echo "⚠ $(open_run_headline "$ctrlb_home" "$ostate" "$orec") — put its whole set back before anything"
        echo "  else (a re-run does NOT repair this — ISS-114):"
      elif [ "$from_has_runner" = yes ]; then
        echo "⚠ config: shape $cur_ver now (it was $disk_ver when this run started); $from reads $from_ver or below."
        echo "  A tag revert ALONE fails: $from's installer refuses this config at its preflight (the migrator"
        echo "  exits 78) and prod stays as it is. Go back in this order, all of it:"
      else
        echo "⚠ config: shape $cur_ver now (it was $disk_ver when this run started); $from reads $from_ver or below."
        echo "  $from predates the shape check: a tag revert ALONE would start it on a shape it does not know"
        echo "  and report healthy (with NO providers once the file uses 'providers:'). Go back in this order:"
      fi ;;
    *)
      if [ -z "$from_ver" ]; then
        echo "⚠ $from_why — README §Rollback step 2."
      else
        echo "⚠ config: its config_version line cannot be read ($cfg), so this report cannot tell whether $from"
        echo "  ($from_ver or below) reads it. Do NOT revert the tag alone; check the line (README §Rollback step 2),"
        echo "  and if it is above $from_ver go back in this order:"
      fi ;;
  esac
  if [ "$restore" = yes ] || { [ "$restore" = unknown ] && [ -n "$from_ver" ]; }; then
    echo ""
    if print_config_restore "$ctrlb_home" "${from_ver:-${disk_ver}}" "$orec" "$run_start"; then
      if [ -n "$from" ]; then
        echo "    4. cd $(q "$repo") && git checkout $from && bash deploy/linux/install.sh prod"
        echo "    5. curl -s -m5 localhost:${port:-5433}/api/health"
      else
        echo "    4. the release to go back to is unknown here — README §Rollback step 2"
      fi
    else
      restore_unresolved "${from:-the previous release}"
    fi
  fi
  echo ""
  echo "No automatic revert was attempted: rolling back is a decision, and doing it silently would hide"
  echo "which of the states above you are actually in."
  exit 1
}

#: One line naming an open run for the reports and the step-5 refusal: when it started, how many files it
#: rewrote, or why its record cannot be used.
open_run_headline() {
  local home="$1" st="$2" rec="$3" stamp n
  stamp="$(record_stamp "$rec")"
  if [ "${st%%:*}" = broken ]; then
    printf 'a migration started at %s left a run record that cannot be used (%s)' "$stamp" "${st#broken:}"
    return 0
  fi
  n="$(record_pairs "$home" "$rec" | grep -c $'\t' || true)"
  printf 'a migration started at %s rewrote %s file(s) and never committed' "$stamp" "$((n - 1))"
}

#: The CONFIG restore for going back to a build that reads shape <= $2, printed identically everywhere
#: it is needed so the operator never sees two subtly different versions of the one sequence that must
#: not be improvised. It names the migrator's WHOLE backup set for one run — config.yaml plus every
#: agent file that run rewrote — as exact commands, one `cp` per line (no `&&`: a failing line must not
#: silently skip the rest), never "the newest file" (A-4, A-5). With $3 (an OPEN run record) it prints
#: the record's exact pairs; a record's set — open, or the superseded one `offer_set` picks — ends with
#: the ONE guarded line that closes the record once — and only once — every file is back (`cmp -s … &&
#: mv <record> <…>.run.resolved`), so the closure survives a rollback through an older updater that knows
#: no records. Without $3, `offer_set` decides (the same
#: resolver the success hint uses): the shape pick, or the superseded record behind it — labelled with
#: its date and shape so a stale pick is visible; $4 = this run's start (`taken during this run`, a label
#: only). Every printed path is shell-quoted (`q`). Nothing qualifies, or a record cannot be used → it
#: says so, prints no `cp`, and FAILS (rc 1): the caller must then NOT print the steps that would proceed.
print_config_restore() {
  local home="${1-}" max="${2-}" rec="${3-}" run_start="${4-}" stamp="" label shape cfg_bak="" f name
  local pairs b l offer kind="shape" agents=() checks=()
  if [ -z "$home" ] || [ -z "$max" ]; then
    echo "    ✗ update.sh bug: print_config_restore needs <home> <max> — README §Rollback step 2."
    return 1
  fi
  echo "    1. systemctl --user stop ctrl-b-dashboard"
  if [ -n "$rec" ]; then
    kind="open"
    stamp="$(record_stamp "$rec")"
    label="the set of a migration that rewrote agent files and never committed (started ${stamp:0:4}-${stamp:4:2}-${stamp:6:2} ${stamp:9:2}:${stamp:11:2} UTC)"
  elif ! offer="$(offer_set "$home" "$max")"; then
    echo "    2. ✗ no backup taken by the config migration holds a config at shape $max or below"
    echo "       ($(q "$home/backups")/config.yaml.<UTC stamp>). Do not improvise: README §Rollback step 2."
    return 1
  elif [ "${offer%%$'\t'*}" = record ]; then
    kind="superseded"
    rec="${offer#*$'\t'}"; stamp="$(record_stamp "$rec")"
    label="taken ${stamp:0:4}-${stamp:4:2}-${stamp:6:2} ${stamp:9:2}:${stamp:11:2} UTC by a migration that rewrote agent files and never committed (a later run committed over it — ISS-114)"
  else
    stamp="${offer#*$'\t'}"
    if [ -n "$run_start" ] && (( 10#${stamp//[TZ]/} >= 10#${run_start//[TZ]/} )); then
      label="taken during this run"
    else
      label="taken earlier — ${stamp:0:4}-${stamp:4:2}-${stamp:6:2} ${stamp:9:2}:${stamp:11:2} UTC"
    fi
  fi
  if [ -n "$rec" ]; then
    if ! pairs="$(record_pairs "$home" "$rec")"; then
      echo "    2. ✗ the run record $(q "$rec") is not one the migrator wrote. Do not improvise: README §Rollback step 2."
      return 1
    fi
    while IFS=$'\t' read -r b l; do
      [ -n "$b" ] || continue
      if [ ! -f "$b" ]; then
        echo "    2. ✗ backup $(q "$b") listed by the record is missing — README §Rollback step 2."
        return 1
      fi
      checks+=("cmp -s $(q "$b") $(q "$l")")
      if [ "$l" = "$home/config.yaml" ]; then cfg_bak="$b"; else agents+=("$b"$'\t'"$l"); fi
    done <<<"$pairs"
  else
    cfg_bak="$(config_backup "$home" "$stamp")" || cfg_bak=""
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      name="${f##*/}"; name="${name%%--agent.yaml.*}"
      agents+=("$f"$'\t'"$home/agents/$name/agent.yaml")
    done < <(agent_backups "$home" "$stamp")
  fi
  if [ -z "$cfg_bak" ]; then
    echo "    2. ✗ the config backup of set $stamp cannot be resolved. Do not improvise: README §Rollback step 2."
    return 1
  fi
  shape="$(config_shape "$cfg_bak")" || shape="unreadable"
  echo "    2. put back EVERY file of the migration's backup set $stamp — $label, shape $shape."
  if [ "${label#taken earlier}" != "$label" ]; then
    echo "       The right one if you are retrying a failed attempt of this same update, or undoing the update"
    echo "       that took it; otherwise check README §Rollback step 2."
  fi
  if [ "$shape" = unreadable ] || [ "$shape" -gt "$max" ]; then
    echo "       ⚠ its shape is not $max or below: restoring it alone will not make the older build read it —"
    echo "       README §Rollback step 2."
  fi
  if [ "${#agents[@]}" -ge 1 ]; then
    echo "       Config + ${#agents[@]} agent file(s) — all of them, never the config alone:"
  else
    echo "       Config only — if the run that took it also rewrote agent files, their backups are missing:"
    echo "       README §Rollback step 2."
  fi
  echo "         cp -p $(q "$cfg_bak") $(q "$home/config.yaml")"
  for f in "${agents[@]}"; do
    echo "         cp -p $(q "${f%%$'\t'*}") $(q "${f#*$'\t'}")"
  done
  echo "       (cp -p keeps 0600. This discards any config or agent edit made after $stamp.)"
  if [ "$kind" != shape ]; then
    # The same closure for an open AND a superseded record: once its set is back it must never be offered
    # again (`….run[.superseded]` → `….run.resolved`; the four states stay four).
    local guard="" c
    for c in "${checks[@]}"; do guard+="$c && "; done
    echo "       then close the record — it renames only when EVERY file is back:"
    echo "         ${guard}mv -- $(q "$rec") $(q "${rec%.superseded}.resolved")"
  fi
  echo "    3. grep -m1 '^config_version:' $(q "$home/config.yaml")   # must show $max or less, or no line at all"
}

#: The ONE line every caller prints instead of its continuation when `print_config_restore` found nothing
#: to restore: proceeding to <rev> would start a build on a config it cannot read.
restore_unresolved() {
  echo "    stop here: resolve the backup first (README §Rollback step 2) — do not check out $1 until the config it reads is in place"
}

main "$@"
