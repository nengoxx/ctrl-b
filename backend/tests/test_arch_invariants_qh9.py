"""QH-9 drift-guards — two architecture invariants, upgraded from prose to gate assertions.

1. **Server-OS branches are a closed allowlist** (ARCHITECTURE §6 / CLAUDE.md): code must branch on
   `host.os_type` (the managed host), never the server's OS. The sanctioned exceptions are
   `fleet._ping_cmd` (local ping syntax), `run_shell`'s per-OS shell, and `memory._fsync_dir`
   (a POSIX-only durability no-op). `tools/check.py` is the runner's own OS chokepoint and lives
   outside `app/` — deliberately out of scope here. A new `os.name`/`platform.system()`/
   `sys.platform` use fails until it's consciously added to BOTH this allowlist and §6.

2. **`app/core/` never imports `app/services/` at runtime** (the layering SYSTEM_AUDIT verified by
   hand): core is the dependency floor. `if TYPE_CHECKING:` imports are allowed (annotation-only —
   the documented `core/tool.py` case).
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]

# --- 1. server-OS branch allowlist -------------------------------------------------------------

_OS_TOKEN = re.compile(r"\bos\.name\b|\bplatform\.system\b|\bsys\.platform\b")

_ALLOWED_OS_BRANCH_FILES = {
    "app/services/fleet.py",  # _ping_cmd — the local ping syntax (ARCHITECTURE §6)
    "app/services/actions/shell.py",  # run_shell's per-OS shell
    "app/services/agent/memory.py",  # _fsync_dir — dir-fsync no-op on Windows
}


def test_server_os_branches_stay_on_the_allowlist():
    hits: dict[str, list[int]] = {}
    for py in (BACKEND / "app").rglob("*.py"):
        rel = py.relative_to(BACKEND).as_posix()
        for lineno, line in enumerate(py.read_text(encoding="utf-8").splitlines(), 1):
            if line.lstrip().startswith("#"):
                continue
            if _OS_TOKEN.search(line):
                hits.setdefault(rel, []).append(lineno)

    unexpected = {f: lines for f, lines in hits.items() if f not in _ALLOWED_OS_BRANCH_FILES}
    assert not unexpected, (
        f"new server-OS branch outside the ARCHITECTURE §6 allowlist: {unexpected} — "
        "branch on host.os_type instead, or consciously extend the allowlist AND §6"
    )
    # And the allowlist can't rot into dead entries:
    stale = _ALLOWED_OS_BRANCH_FILES - set(hits)
    assert not stale, f"allowlisted files no longer branch on the server OS — prune: {sorted(stale)}"


# --- 2. core/ must not import services/ at runtime ---------------------------------------------


def _is_type_checking(test: ast.expr) -> bool:
    return (isinstance(test, ast.Name) and test.id == "TYPE_CHECKING") or (
        isinstance(test, ast.Attribute) and test.attr == "TYPE_CHECKING"
    )


def _runtime_service_imports(tree: ast.Module) -> list[str]:
    guarded: set[ast.AST] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.If) and _is_type_checking(node.test):
            for stmt in node.body:
                guarded.update(ast.walk(stmt))

    bad: list[str] = []
    for node in ast.walk(tree):
        if node in guarded:
            continue
        if isinstance(node, ast.Import):
            bad += [
                f"import {a.name} (line {node.lineno})"
                for a in node.names
                if a.name == "app.services" or a.name.startswith("app.services.")
            ]
        elif isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            absolute = mod == "app.services" or mod.startswith("app.services.")
            relative = node.level >= 2 and (mod == "services" or mod.startswith("services."))
            if absolute or relative:
                bad.append(f"from {'.' * node.level}{mod} import ... (line {node.lineno})")
    return bad


def test_core_never_imports_services_at_runtime():
    violations: dict[str, list[str]] = {}
    for py in (BACKEND / "app" / "core").rglob("*.py"):
        tree = ast.parse(py.read_text(encoding="utf-8"))
        bad = _runtime_service_imports(tree)
        if bad:
            violations[py.relative_to(BACKEND).as_posix()] = bad
    assert not violations, (
        f"app/core/ imports app/services/ at runtime (layering breach): {violations} — "
        "core is the dependency floor; use TYPE_CHECKING for annotation-only imports"
    )
