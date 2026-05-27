#!/usr/bin/env python3
"""Rotation + quota bookkeeping for the audit-rotation automation.

This is dev/meta tooling for the `audit-rotation` skill, NOT part of the
trading bot. It does three jobs the orchestrating agent should not hand-roll
each pass:

  * pick the next subsystem to audit (rotates through all scopes, then restarts
    the cycle),
  * read the current 5-hour quota block via `ccusage` and report whether we are
    still under the configured cost cap, and
  * record completed audits into a durable, git-tracked history.

State lives next to this script in `state.json` so the whole automation is
self-contained. Reports still go to `docs/audit/` (the `audit` skill's
convention).

Usage:
    python rotation.py status                 # human summary + quota
    python rotation.py next [--json]          # the scope to audit now (no advance)
    python rotation.py quota [--json]         # 5h-block cost vs cap; exit 0 under, 1 over, 2 unknown
    python rotation.py complete --report PATH --fixed N   # record + advance cursor

Exit codes for `quota`: 0 = under cap (keep going), 1 = at/over cap (stop),
2 = could not determine (treat as stop, to be safe).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATE_PATH = HERE / "state.json"
# Repo root is four levels up: .agents/skills/audit-rotation/rotation.py
REPO_ROOT = HERE.parent.parent.parent
AUDIT_DIR = REPO_ROOT / "docs" / "audit"

# A finding heading looks like "### C1 — Title" / "### M2 - Title".
_FINDING_RE = re.compile(r"^###\s+([CHMLN])(\d+)\s*[—\-]\s*(.*)$")
# A finding is resolved if its heading or block carries a RESOLVED marker
# (matches the existing reports' "— RESOLVED <date>" convention) or an explicit
# "**Resolution:**" line. RESOLVED is matched uppercase to avoid prose hits.
_RESOLUTION_RE = re.compile(r"\bRESOLVED\b|\*\*Resolution:\*\*")
_SEVERITY_RANK = {"C": 0, "H": 1, "M": 2, "L": 3, "N": 4}

# Default cost cap (USD of consumption within the active 5-hour block) at which
# the automation stops fixing. Set this to ~80% of your plan's 5-hour limit.
# Override per-run with the AUDIT_ROTATION_COST_CAP environment variable.
# Calibrated 2026-05-24: ccusage read $19.09 when /usage showed the block at 81%,
# so 100% ~= $23.57 and the 80% cap ~= $18.85. Re-calibrate if your plan changes.
DEFAULT_COST_CAP_USD = 18.85

# The rotation: one entry per subsystem. `paths` scopes the audit; `note` is a
# hint to the auditor. Edit freely — cursor/cycle in state.json adapt to length.
DEFAULT_SCOPES = [
    {"name": "parser", "paths": ["parser/"],
     "note": "regex extraction, classification, assembly, completion policy, validation"},
    {"name": "executor", "paths": ["executor/mt5_executor.py"],
     "note": "serialized MT5 access, order routing, dry_run, position matching"},
    {"name": "listener", "paths": ["listener/telethon_listener.py"],
     "note": "Telethon user session, bootstrap history, reconnect/retry"},
    {"name": "control", "paths": ["control/"],
     "note": "aiogram admin bot, menus, AdminNotifier"},
    {"name": "backtest-engine", "paths": ["backtest/engine.py", "backtest/models.py",
        "backtest/market_data.py", "backtest/message_cache.py",
        "backtest/report_slicing.py", "backtest/run_logger.py"],
     "note": "history replay, tick simulation, report slicing"},
    {"name": "optimizer", "paths": ["backtest/optimizer.py", "backtest/optimizer_parameters.py",
        "backtest/optimizer_constraints.py", "backtest/optimizer_sampling.py",
        "backtest/optimization_config.py", "backtest/optimization_lab.py",
        "backtest/variant_search.py"],
     "note": "Optuna integration, variant sampling, constraints, walk-forward"},
    {"name": "web-dashboard", "paths": ["web_dashboard/"],
     "note": "HTTP API, data formatters, static app.js, write-token handling"},
    {"name": "execution-rules-sizing", "paths": ["execution_rules.py", "position_sizing.py",
        "allocation_utils.py"],
     "note": "deferred/scaled entry, target split, entry-quality gates, lot sizing"},
    {"name": "config-store", "paths": ["config_store.py", "state.py"],
     "note": "YAML config, hot-reload, thread-safety, BotState"},
    {"name": "storage", "paths": ["storage/"],
     "note": "artifact index, SQLite, cross-process file locking"},
    {"name": "orchestration", "paths": ["main.py"],
     "note": "event loop, task orchestration, graceful shutdown, log filtering"},
    {"name": "tools", "paths": ["tools/"],
     "note": "one-off CLI scripts: backtest, optimize, caching, maintenance, smoke"},
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_state() -> dict:
    if STATE_PATH.exists():
        state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    else:
        state = {}
    # Initialize / self-heal missing keys.
    state.setdefault("cycle", 1)
    state.setdefault("cursor", 0)
    state.setdefault("cost_cap_usd", DEFAULT_COST_CAP_USD)
    state.setdefault("scopes", DEFAULT_SCOPES)
    state.setdefault("history", [])
    if not state["scopes"]:
        state["scopes"] = DEFAULT_SCOPES
    state["cursor"] %= len(state["scopes"])
    return state


def save_state(state: dict) -> None:
    STATE_PATH.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def cost_cap(state: dict) -> float:
    env = os.environ.get("AUDIT_ROTATION_COST_CAP")
    if env:
        try:
            return float(env)
        except ValueError:
            pass
    return float(state.get("cost_cap_usd", DEFAULT_COST_CAP_USD))


def read_active_block() -> dict | None:
    """Return the active 5-hour block dict from ccusage, or None.

    Raises RuntimeError if ccusage cannot be run/parsed at all.
    """
    cmd = "npx --yes ccusage@latest blocks --active --json"
    try:
        out = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=120,
        )
    except Exception as exc:  # noqa: BLE001 - surface any launch failure
        raise RuntimeError(f"could not run ccusage: {exc}") from exc
    if out.returncode != 0:
        raise RuntimeError(f"ccusage exited {out.returncode}: {out.stderr.strip()[:200]}")
    text = out.stdout.strip()
    if not text:
        return None
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"ccusage output not JSON: {exc}") from exc
    blocks = data.get("blocks") or []
    for block in blocks:
        if block.get("isActive"):
            return block
    return None


def quota_report(state: dict) -> dict:
    cap = cost_cap(state)
    try:
        block = read_active_block()
    except RuntimeError as exc:
        return {"ok": False, "error": str(exc), "cap_usd": cap}
    if block is None:
        # No active block => no recent usage => fully under cap.
        return {"ok": True, "cost_usd": 0.0, "cap_usd": cap, "under_cap": True,
                "headroom_usd": cap, "block_end": None, "pct_of_cap": 0.0}
    cost = float(block.get("costUSD", 0.0))
    return {
        "ok": True,
        "cost_usd": round(cost, 4),
        "cap_usd": cap,
        "under_cap": cost < cap,
        "headroom_usd": round(cap - cost, 4),
        "pct_of_cap": round(100.0 * cost / cap, 1) if cap else None,
        "block_end": block.get("endTime"),
        "tokens": block.get("totalTokens"),
    }


def scan_findings(open_only: bool = True) -> list[dict]:
    """Scan docs/audit/*.md for finding blocks across all reports.

    A finding is the text from its `### Cn — ...` heading up to the next
    `###`/`##` heading. It is **open** unless that block contains a
    `**Resolution:**` line. Returns findings sorted by severity (C→N) then
    report path, so the first open one is the most important to fix next.
    """
    results: list[dict] = []
    if not AUDIT_DIR.exists():
        return results
    for path in sorted(AUDIT_DIR.glob("*.md")):
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        cur: dict | None = None
        block: list[str] = []

        def _flush(cur: dict | None, block: list[str]) -> None:
            if cur is None:
                return
            # Check the heading title too — existing reports mark resolution there.
            cur["resolved"] = bool(_RESOLUTION_RE.search(cur["title"])) or \
                any(_RESOLUTION_RE.search(b) for b in block)
            if not (open_only and cur["resolved"]):
                results.append(cur)

        for i, line in enumerate(lines, 1):
            m = _FINDING_RE.match(line)
            if m:
                _flush(cur, block)
                sev, num, title = m.group(1), m.group(2), m.group(3).strip()
                cur = {
                    "report": path.relative_to(REPO_ROOT).as_posix(),
                    "id": f"{sev}{num}",
                    "severity": sev,
                    "rank": _SEVERITY_RANK.get(sev, 9),
                    "title": title,
                    "line": i,
                }
                block = []
            elif line.startswith("## "):  # left the Findings section / new section
                _flush(cur, block)
                cur, block = None, []
            elif cur is not None:
                block.append(line)
        _flush(cur, block)

    results.sort(key=lambda f: (f["rank"], f["report"], f["id"]))
    return results


def cmd_findings(_state: dict, args) -> int:
    findings = scan_findings(open_only=not args.all)
    if args.json:
        print(json.dumps(findings))
        return 0 if findings else 1
    if not findings:
        print("no open findings in docs/audit/" if not args.all
              else "no findings in docs/audit/")
        return 1
    label = "all" if args.all else "open"
    print(f"{len(findings)} {label} finding(s), most important first:")
    for f in findings:
        flag = "" if not args.all else ("  [resolved]" if f.get("resolved") else "  [open]")
        print(f"  {f['severity']}{f['id'][1:]:<3} {f['title'][:60]:<60} "
              f"{f['report']}:{f['line']}{flag}")
    return 0


def cmd_status(state: dict, _args) -> int:
    scopes = state["scopes"]
    cur = scopes[state["cursor"]]
    print(f"cycle: {state['cycle']}  cursor: {state['cursor'] + 1}/{len(scopes)}")
    print(f"next scope: {cur['name']}  paths: {', '.join(cur['paths'])}")
    print(f"cost cap: ${cost_cap(state):.2f}")
    q = quota_report(state)
    if q["ok"]:
        if q["block_end"]:
            print(f"quota: ${q['cost_usd']:.2f} / ${q['cap_usd']:.2f} "
                  f"({q['pct_of_cap']}%)  {'UNDER' if q['under_cap'] else 'OVER'} cap  "
                  f"block ends {q['block_end']}")
        else:
            print(f"quota: no active block (under cap, ${q['cap_usd']:.2f})")
    else:
        print(f"quota: UNKNOWN ({q['error']})")
    if state["history"]:
        print("recent history:")
        for h in state["history"][-5:]:
            print(f"  c{h['cycle']} {h['scope']:24} fixed={h['fixed']} "
                  f"{h.get('report', '')}  @{h['ts']}")
    return 0


def cmd_next(state: dict, args) -> int:
    cur = state["scopes"][state["cursor"]]
    if args.json:
        print(json.dumps({"cycle": state["cycle"], "index": state["cursor"], **cur}))
    else:
        print(f"{cur['name']}")
        print(f"paths: {', '.join(cur['paths'])}")
        print(f"note: {cur['note']}")
    return 0


def cmd_quota(state: dict, args) -> int:
    q = quota_report(state)
    if args.json:
        print(json.dumps(q))
    else:
        if not q["ok"]:
            print(f"UNKNOWN: {q['error']}")
        elif q["block_end"] is None:
            print(f"UNDER cap: no active block (cap ${q['cap_usd']:.2f})")
        else:
            print(f"{'UNDER' if q['under_cap'] else 'OVER'} cap: "
                  f"${q['cost_usd']:.2f} / ${q['cap_usd']:.2f} ({q['pct_of_cap']}%), "
                  f"headroom ${q['headroom_usd']:.2f}, block ends {q['block_end']}")
    if not q["ok"]:
        return 2
    return 0 if q["under_cap"] else 1


def cmd_complete(state: dict, args) -> int:
    scopes = state["scopes"]
    done = scopes[state["cursor"]]
    state["history"].append({
        "ts": _now_iso(),
        "cycle": state["cycle"],
        "scope": done["name"],
        "report": args.report or "",
        "fixed": args.fixed,
    })
    state["cursor"] += 1
    if state["cursor"] >= len(scopes):
        state["cursor"] = 0
        state["cycle"] += 1
        print(f"completed '{done['name']}'. Cycle wrapped -> now cycle {state['cycle']}.")
    else:
        print(f"completed '{done['name']}'. Next: '{scopes[state['cursor']]['name']}'.")
    save_state(state)
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="audit-rotation bookkeeping + quota gate")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("status", help="summary of rotation state + quota")

    p_next = sub.add_parser("next", help="the scope to audit now (does not advance)")
    p_next.add_argument("--json", action="store_true")

    p_quota = sub.add_parser("quota", help="5h-block cost vs cap; exit 0 under / 1 over / 2 unknown")
    p_quota.add_argument("--json", action="store_true")

    p_done = sub.add_parser("complete", help="record the current scope as audited and advance")
    p_done.add_argument("--report", default="", help="path to the audit report written")
    p_done.add_argument("--fixed", type=int, default=0, help="number of findings fixed this pass")

    p_find = sub.add_parser("findings", help="open findings across docs/audit/*.md, most important first")
    p_find.add_argument("--json", action="store_true")
    p_find.add_argument("--all", action="store_true", help="include resolved findings too")

    # Windows consoles default to cp1252; report titles contain em dashes / arrows.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    args = parser.parse_args(argv)
    state = load_state()
    # Persist any self-heal/initialization for first run.
    if not STATE_PATH.exists():
        save_state(state)

    handlers = {
        "status": cmd_status,
        "next": cmd_next,
        "quota": cmd_quota,
        "complete": cmd_complete,
        "findings": cmd_findings,
    }
    return handlers[args.cmd](state, args)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
