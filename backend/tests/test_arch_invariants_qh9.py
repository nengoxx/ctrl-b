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

_OS_TOKEN = re.compile(
    r"\bos\.name\b|\bplatform\.system\b|\bsys\.platform\b"
    # aliased-import forms — `from platform import system` etc. would dodge the dotted tokens
    r"|from\s+platform\s+import|from\s+sys\s+import\s+platform|from\s+os\s+import\s+[\w\s,]*\bname\b"
)

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


# --- 3. the installer's unit destination stays redirectable ------------------------------------


def test_installer_writes_units_only_through_systemd_user_dir():
    """UPDATE_PLAN §17.4 R1 — found by rehearsing the rollback, not by reading the script.

    `install.sh` accepts `REPO` and `CTRLB_HOME` overrides, which isolate the tree and the data — so
    running it from a scratch tree LOOKS isolated. It is not: the systemd unit NAME is fixed, and the
    render used to write straight into `$HOME/.config/systemd/user/<name>`, silently repointing the
    LIVE unit's WorkingDirectory/CTRLB_HOME/ExecStart at the scratch paths. Nothing fails at the time;
    the box keeps serving until the next `daemon-reload` or reboot, and then production starts from a
    directory that may no longer exist.

    So the destination must stay behind ONE overridable variable. Any new literal write to the
    hardcoded path re-opens it — which is exactly the kind of edit that looks harmless in review.
    """
    script = (BACKEND.parent / "deploy" / "linux" / "install.sh").read_text(encoding="utf-8")
    default_line = 'SYSTEMD_USER_DIR="${SYSTEMD_USER_DIR:-$HOME/.config/systemd/user}"'
    assert default_line in script, (
        "install.sh must resolve its unit destination through SYSTEMD_USER_DIR (with the real path as "
        "the default) so the recovery path can be rehearsed off-prod — see UPDATE_PLAN §17.4 R1"
    )
    offenders = [
        f"line {n}: {ln.strip()}"
        for n, ln in enumerate(script.splitlines(), 1)
        if "$HOME/.config/systemd/user" in ln
        and ln.strip() != default_line
        and not ln.lstrip().startswith("#")
    ]
    assert not offenders, (
        "install.sh writes/reads a systemd unit path directly instead of via $SYSTEMD_USER_DIR "
        f"(UPDATE_PLAN §17.4 R1): {offenders}"
    )


# --- 4. no endpoint renders a raw pydantic error ------------------------------------------------


def test_api_422s_go_through_the_safe_validation_renderer():
    """A11 pre-release FE audit, HIGH. `exc.errors()` includes `input` — the rejected value — so any
    endpoint rendering it directly echoes the submitted document back: `providers.*.api_key` from a
    settings PUT, `ssh_password` from a host PUT, an MCP server's `env`/`headers` from integrations.

    Six endpoints did. The fix is one chokepoint (`config.validation_detail`), and this guard is what
    keeps the seventh from reintroducing the class: inside `app/api/`, a pydantic error may not be
    rendered into a response any way other than through it.
    """
    offenders: list[str] = []
    for py in (BACKEND / "app" / "api").rglob("*.py"):
        for n, line in enumerate(py.read_text(encoding="utf-8").splitlines(), 1):
            if ".errors(" not in line or line.lstrip().startswith("#"):
                continue
            # `e.errors()[0]["msg"]` pulls ONE message and no value — allowed, and used deliberately.
            if '["msg"]' in line or "['msg']" in line:
                continue
            offenders.append(f"{py.relative_to(BACKEND).as_posix()}:{n}: {line.strip()}")
    assert not offenders, (
        "an API module renders a pydantic ValidationError directly; use `config.validation_detail(exc)` "
        f"— `.errors()` includes the rejected `input` value: {offenders}"
    )


# --- 5. the frontend's secret-sentinel mirror cannot drift --------------------------------------


def test_frontend_secret_sentinel_list_matches_the_schema_rule():
    """The Conf reference-guard names the secret sentinels inline so it can block a save before the
    server 422s. Duplication was accepted over putting the list on the wire — it changes maybe once a
    year, and a wire field is permanent machinery — but the premise "it is a fixed rule" is weaker than
    it looks: `_SECRET_SENTINEL_NAMES` is a DERIVED union of the leaf keys, the map keys and two extras,
    and it has already grown once. Add `client_secret` to the leaf keys and the mirror drifts silently
    (fail-safe — the server still rejects — but the inline guard quietly stops covering it).

    So the drift is closed by a test instead, the same way the installer's unit path is: read the other
    file and compare (Fable, review of the fix wave).
    """
    import re

    from app.config import _SECRET_SENTINEL_NAMES

    conf = (BACKEND.parent / "frontend" / "src" / "tabs" / "ConfTab.tsx").read_text(encoding="utf-8")
    m = re.search(r"const SECRET_SENTINEL_NAMES = \[(.*?)\];", conf, re.S)
    assert m, "ConfTab no longer declares SECRET_SENTINEL_NAMES — update this guard with it"
    mirrored = set(re.findall(r'"([^"]+)"', m.group(1)))
    assert mirrored == set(_SECRET_SENTINEL_NAMES), (
        "the Conf guard's secret-sentinel list has drifted from `config._SECRET_SENTINEL_NAMES`: "
        f"frontend={sorted(mirrored)} backend={sorted(_SECRET_SENTINEL_NAMES)}"
    )
