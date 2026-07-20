"""SYS-16 drift-guard — **no blocking filesystem call on the event loop**.

The Phase-12 deep pass moved the known offenders off the loop (agent/skill file CRUD, the memory
overwrite path, the backup reconcile stat). This test is the ratchet that keeps them off.

Why a bespoke AST test rather than the ruff `ASYNC` rules: **ASYNC240 is lexical on the receiver** —
it fires only when the receiver is a statically-known `Path` (a `Path(...)` call or a `Path`-annotated
name), so it misses BinOp receivers (`(root / ".git").is_file()`), attribute receivers
(`self.path.mkdir()`) and plain locals. That blind spot is exactly what SYSTEM_AUDIT's SYS-16
addendum recorded as unguarded. This walk keys off the *method name* instead, inside any
`async def` body, and ignores nested sync `def`s / lambdas (a sync helper is the correct fix, and
is the shape used throughout: hoist the blocking sequence into one sync function and call it via
`asyncio.to_thread`).

Two deliberate reductions keep the signal clean:
  * an **awaited** call is never a blocking sync fs call (`await self._threads.touch(...)` is a DB
    coroutine; `await client.glob(...)` is remote HTTP over httpx) — awaited calls are skipped;
  * `replace`/`resolve` are omitted as bare method names (`str.replace` collides constantly);
    `os.replace`/`os.remove`/`shutil.rmtree` are matched in their module-qualified form instead.

A new hit fails until it is either moved into a `to_thread`-wrapped sync helper or consciously
added to `_ALLOWED` below with a reason.
"""

from __future__ import annotations

import ast
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]

#: Blocking `pathlib`/file methods, matched by attribute name on any receiver.
_BLOCKING_METHODS = {
    "is_file",
    "is_dir",
    "exists",
    "unlink",
    "mkdir",
    "rmdir",
    "touch",
    "read_text",
    "write_text",
    "read_bytes",
    "write_bytes",
    "stat",
    "lstat",
    "glob",
    "rglob",
    "iterdir",
    "samefile",
}

#: Module-qualified blocking calls (`os.replace(...)`, `shutil.rmtree(...)`, …).
_BLOCKING_MODULE_CALLS = {
    ("os", "replace"),
    ("os", "remove"),
    ("os", "rename"),
    ("os", "mkdir"),
    ("os", "makedirs"),
    ("os", "unlink"),
    ("os", "stat"),
    ("os", "listdir"),
    ("os", "walk"),
    ("shutil", "rmtree"),
    ("shutil", "copy"),
    ("shutil", "copy2"),
    ("shutil", "copytree"),
    ("shutil", "move"),
}

#: `<path>:<line>: <call>` sites deliberately left on the loop, each with its reason.
_ALLOWED = {
    # One mkdir on the SQLite parent dir, at process startup inside the lifespan `connect()` —
    # before the server accepts traffic, so there is no loop to stall (and it must happen before
    # aiosqlite opens the file). Moving it to a thread would buy nothing.
    "app/db.py:180: mkdir",
}


def _own_body(fn: ast.AST) -> list[ast.AST]:
    """Every node lexically inside `fn`, **excluding** nested `def`/`async def`/`lambda` bodies —
    those are separate scopes (a nested sync `def` is the sanctioned fix shape, not a violation)."""
    out: list[ast.AST] = []
    stack: list[ast.AST] = list(getattr(fn, "body", []))
    while stack:
        node = stack.pop()
        out.append(node)
        for child in ast.iter_child_nodes(node):
            if isinstance(child, ast.FunctionDef | ast.AsyncFunctionDef | ast.Lambda):
                continue
            stack.append(child)
    return out


def _blocking_label(call: ast.Call) -> str | None:
    """The reportable label for a blocking fs call, or None if `call` isn't one."""
    func = call.func
    if isinstance(func, ast.Attribute):
        if isinstance(func.value, ast.Name) and (func.value.id, func.attr) in _BLOCKING_MODULE_CALLS:
            return f"{func.value.id}.{func.attr}"
        if func.attr in _BLOCKING_METHODS:
            return func.attr
        return None
    if isinstance(func, ast.Name) and func.id == "open":
        return "open()"
    return None


def _scan(src: str, rel: str) -> list[str]:
    """`<rel>:<line>: <call>` for every blocking fs call lexically inside an `async def` in `src`."""
    tree = ast.parse(src)

    awaited: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Await) and isinstance(node.value, ast.Call):
            awaited.add(id(node.value))

    found: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.AsyncFunctionDef):
            continue
        for inner in _own_body(node):
            if not isinstance(inner, ast.Call) or id(inner) in awaited:
                continue
            label = _blocking_label(inner)
            if label is not None:
                found.append(f"{rel}:{inner.lineno}: {label}")
    return found


def _blocking_fs_in_async(py: Path) -> list[str]:
    return _scan(py.read_text(encoding="utf-8"), py.relative_to(BACKEND).as_posix())


def test_no_blocking_filesystem_calls_inside_async_defs():
    hits: list[str] = []
    for py in sorted((BACKEND / "app").rglob("*.py")):
        hits += _blocking_fs_in_async(py)

    unexpected = sorted(set(hits) - _ALLOWED)
    assert not unexpected, (
        "blocking filesystem call inside an `async def` (SYS-16) — it stalls the event loop for "
        f"every other request: {unexpected}. Hoist the whole blocking sequence into ONE sync helper "
        "and call it via `asyncio.to_thread` (see `api/agent.py::_write_soul`, "
        "`memory_backup._prep_repo_dir`), or add it to _ALLOWED with a reason."
    )
    # And the allowlist can't rot into dead entries:
    stale = sorted(_ALLOWED - set(hits))
    assert not stale, f"allowlisted blocking-fs sites are gone — prune the allowlist: {stale}"


def test_ratchet_detects_a_planted_violation():
    """The guard's own smoke test: it must flag a blocking call in an async def, ignore the same
    call inside a nested sync helper, and ignore awaited (non-fs) calls of the same name."""
    src = """
import asyncio
from pathlib import Path

async def bad(p: Path) -> str:
    if p.is_file():
        return p.read_text()
    return ""

def _sync_ok(p: Path) -> str:
    return p.read_text() if p.is_file() else ""

async def good(p: Path, threads) -> str:
    await threads.touch("id")
    return await asyncio.to_thread(_sync_ok, p)
"""
    labels = sorted(h.split(": ", 1)[1] for h in _scan(src, "sample.py"))
    assert labels == ["is_file", "read_text"]  # only the two in `bad`
