"""`tools/start-claude.sh` — the REAL script in a stubbed sandbox: every Claude launch waits for
connectivity (ISS-119).

After a power outage the host booted before the router; the old wait was bounded (~60 s, then it
launched offline anyway) and sat BEFORE the `while true` loop, so every relaunch skipped it — the
Remote Control sessions came up disconnected and stayed invisible in the Android app. The fix moved an
unbounded probe inside the loop. A shell loop is only provable by running it, so these tests run the
real script under `bash` with `tmux`/`curl`/`claude`/`sleep` stubbed FIRST on PATH (the
`test_update_sh.py` idiom): the `tmux` stub runs the inner loop in the foreground, the `curl` stub
plays a scripted outcome per call and, when its script runs out, SIGKILLs the loop's shell (its
parent) — the one deterministic way the otherwise endless loop ends. Every stub appends to ONE event
log, so the assertions read the exact order of probes and launches. No network, no real tmux, no
real claude.
"""

from __future__ import annotations

import contextlib
import os
import signal
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
START_CLAUDE = REPO_ROOT / "tools" / "start-claude.sh"
BASE_PATH = "/usr/local/bin:/usr/bin:/bin"

# `has-session` answers from $STUB_HAS_SESSION; `new-session … <cmd>` logs its argv, then runs the
# LAST argument (the script's INNER loop) in the foreground from its `-c` dir, under `sh -c` — tmux's
# default-shell may be /bin/sh (dash), so a bash-only construct in INNER fails here too. It always exits 0 so
# the script's race-retry branch never re-runs the loop.
TMUX_STUB = r"""#!/usr/bin/env bash
case "$1" in
  has-session) exit "${STUB_HAS_SESSION:-1}" ;;
  new-session)
    echo "tmux $*" >> "$STUB_LOG"
    dir=.; prev=
    for a in "$@"; do [ "$prev" = -c ] && dir=$a; prev=$a; done
    cd "$dir" && sh -c "${@: -1}" || true
    exit 0 ;;
esac
exit 1
"""

# Plays line N of $STUB_DIR/curl_script on call N: `ok` = exit 0 — how `curl -sI` (no `-f`) answers
# claude.ai's HTTP 403 — and `fail` = exit 7. Past the script's end it kills its parent, the loop's
# shell, and the test is over.
CURL_STUB = r"""#!/usr/bin/env bash
n=$(( $(cat "$STUB_DIR/curl_count") + 1 )); echo "$n" > "$STUB_DIR/curl_count"
outcome=$(sed -n "${n}p" "$STUB_DIR/curl_script")
if [ -z "$outcome" ]; then echo "end" >> "$STUB_LOG"; kill -KILL "$PPID"; exit 1; fi
echo "curl $outcome $*" >> "$STUB_LOG"
[ "$outcome" = ok ] || exit 7
"""

# Logs each launch with the probe count so far. Backstop: a loop that relaunches WITHOUT probing (the
# pre-ISS-119 shape) would never reach the curl stub's end, so the 10th launch ends it the same way —
# a regression then fails on an assertion, not on the timeout.
CLAUDE_STUB = r"""#!/usr/bin/env bash
echo "claude curls=$(cat "$STUB_DIR/curl_count") $*" >> "$STUB_LOG"
if [ "$(grep -c '^claude ' "$STUB_LOG")" -ge 10 ]; then echo "runaway" >> "$STUB_LOG"; kill -KILL "$PPID"; fi
"""

SLEEP_STUB = r"""#!/usr/bin/env bash
echo "sleep $*" >> "$STUB_LOG"
"""


def _run(
    tmp: Path, curl_script: list[str], *, has_session: bool = False
) -> tuple[subprocess.CompletedProcess[str], list[str]]:
    """Run the real script in a sandbox; return the process and the ordered event log."""
    stubs, home, project = tmp / "bin", tmp / "home", tmp / "project"
    for d in (stubs, home, project):
        d.mkdir()
    for name, body in {
        "tmux": TMUX_STUB,
        "curl": CURL_STUB,
        "claude": CLAUDE_STUB,
        "sleep": SLEEP_STUB,
    }.items():
        (stubs / name).write_text(body)
        (stubs / name).chmod(0o755)
    (tmp / "curl_count").write_text("0\n")
    (tmp / "curl_script").write_text("".join(f"{line}\n" for line in curl_script))
    log = tmp / "events.log"
    log.touch()
    env = {
        "PATH": f"{stubs}:{BASE_PATH}",
        "HOME": str(home),
        "STUB_DIR": str(tmp),
        "STUB_LOG": str(log),
        "STUB_HAS_SESSION": "0" if has_session else "1",
    }
    argv = ["bash", str(START_CLAUDE), "rc-test", str(project), "fable"]
    # Own process group: a regressed loop that never probes again would outlive a plain timeout, so the
    # whole group is killed on the way out, whatever happened.
    with subprocess.Popen(
        argv, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True
    ) as p:
        try:
            out, err = p.communicate(timeout=20)
        finally:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(p.pid, signal.SIGKILL)
    return subprocess.CompletedProcess(argv, p.returncode, out, err), log.read_text().splitlines()


def _launch_gates(events: list[str]) -> list[list[str]]:
    """Per `claude` launch, the probe outcomes since the previous launch (or the start)."""
    gates: list[list[str]] = []
    since: list[str] = []
    for e in events:
        if e.startswith("curl "):
            since.append(e.split()[1])
        elif e.startswith("claude "):
            gates.append(since)
            since = []
    return gates


def test_no_launch_while_offline_and_online_releases_the_gate(tmp_path: Path) -> None:
    proc, events = _run(tmp_path, ["fail", "fail", "fail", "ok"])
    assert proc.returncode == 0, proc.stderr
    assert _launch_gates(events) == [["fail", "fail", "fail", "ok"]]
    first_launch = next(i for i, e in enumerate(events) if e.startswith("claude "))
    assert events[first_launch].startswith("claude curls=4 --remote-control rc-test ")
    assert events[:first_launch].count("sleep 10") == 3  # a patient retry after each failed probe
    assert events[-1] == "end"  # the relaunch probed again before the script ran out


def test_every_relaunch_waits_again(tmp_path: Path) -> None:
    _, events = _run(tmp_path, ["fail", "ok", "fail", "fail", "ok", "ok"])
    # Launch 2 only after a LATER success — the failures scripted after launch 1 hold it back.
    assert _launch_gates(events) == [["fail", "ok"], ["fail", "fail", "ok"], ["ok"]]
    first, second = [i for i, e in enumerate(events) if e.startswith("claude ")][:2]
    assert "sleep 5" in events[first:second]  # the post-exit delay is kept


def test_there_is_no_give_up_path(tmp_path: Path) -> None:
    proc, events = _run(tmp_path, ["fail"] * 50)
    assert proc.returncode == 0, proc.stderr
    assert not [e for e in events if e.startswith("claude ")]
    assert sum(e.startswith("curl fail ") for e in events) == 50
    assert events[-1] == "end"


def test_probe_counts_a_403_as_reachable(tmp_path: Path) -> None:
    # The stub's `ok` is exit 0 — what `curl -sI` returns for claude.ai's HTTP 403 over valid TLS. That
    # holds only while the probe has no `-f`/`--fail` (which turns a 4xx into exit 22): pin its absence.
    _, events = _run(tmp_path, ["ok"])
    argv = next(e for e in events if e.startswith("curl ")).split()[2:]
    assert "https://claude.ai" in argv
    assert not [
        a
        for a in argv
        if a.startswith("--fail") or (a.startswith("-") and not a.startswith("--") and "f" in a)
    ]


def test_existing_session_guard_exits_without_launching(tmp_path: Path) -> None:
    proc, events = _run(tmp_path, ["ok"], has_session=True)
    assert proc.returncode == 0, proc.stderr
    assert "already running" in proc.stdout
    assert events == []
