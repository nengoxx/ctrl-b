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

#: Blocking-fs sites deliberately left on the loop, keyed `<path>: <function>: <call>` → how many are
#: waived there, each with its reason.
#:
#: Deliberately NOT line-keyed (A3 slice 2): the old `app/db.py:201: mkdir` form made every edit ABOVE a
#: waived line — adding a migration, extending a docstring — fail this test for a reason that has nothing
#: to do with the invariant, and the fix was always to renumber the waiver, which is exactly the kind of
#: edit that stops being read. The ENCLOSING FUNCTION is what makes the anchor stable AND specific
#: (post-14b review, LOW): keying on the file alone would have let the startup `connect()` mkdir be
#: deleted and an identical call appear inside a hot request handler in the same file, preserving the
#: file+call+count and passing silently. The reason below is a property of *that function*, so that is
#: what the key names; the count then still catches a second waived call inside it.
_ALLOWED: dict[str, int] = {
    # One mkdir on the SQLite parent dir, at process startup inside the lifespan `connect()` —
    # before the server accepts traffic, so there is no loop to stall (and it must happen before
    # aiosqlite opens the file). Moving it to a thread would buy nothing.
    "app/db.py: connect: mkdir": 1,
}


def _anchor(hit: str) -> str:
    """A `<path>:<line>: <function>: <call>` hit re-keyed to its stable anchor `<path>: <function>:
    <call>` (see `_ALLOWED`) — everything but the line number."""
    path, _, rest = hit.partition(":")
    return f"{path}: {rest.partition(': ')[2]}"


def _unwaived(hits: list[str]) -> list[str]:
    """Hits beyond what `_ALLOWED` waives: everything at an un-waived anchor, plus the SURPLUS at a
    waived one (sorted, so a surplus reports the specific extra sites and not the whole group)."""
    grouped: dict[str, list[str]] = {}
    for hit in sorted(set(hits)):
        grouped.setdefault(_anchor(hit), []).append(hit)
    out: list[str] = []
    for anchor, sites in grouped.items():
        out += sites[_ALLOWED.get(anchor, 0) :]
    return sorted(out)


#: Direct `async def` → blocking-sync-helper calls deliberately left as-is (same format, same rules).
_ALLOWED_HELPER_CALLS: set[str] = set()


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
                found.append(f"{rel}:{inner.lineno}: {node.name}: {label}")
    return found


def _blocking_fs_in_async(py: Path) -> list[str]:
    return _scan(py.read_text(encoding="utf-8"), py.relative_to(BACKEND).as_posix())


def test_no_blocking_filesystem_calls_inside_async_defs():
    hits: list[str] = []
    for py in sorted((BACKEND / "app").rglob("*.py")):
        hits += _blocking_fs_in_async(py)

    unexpected = _unwaived(hits)
    assert not unexpected, (
        "blocking filesystem call inside an `async def` (SYS-16) — it stalls the event loop for "
        f"every other request: {unexpected}. Hoist the whole blocking sequence into ONE sync helper "
        "and call it via `asyncio.to_thread` (see `api/agent.py::_write_soul`, "
        "`memory_backup._prep_repo_dir`), or add it to _ALLOWED with a reason."
    )
    # And the allowlist can't rot into dead entries (a waiver for a site that no longer exists, or one
    # waiving MORE sites than the file actually has):
    found: dict[str, int] = {}
    for hit in set(hits):
        found[_anchor(hit)] = found.get(_anchor(hit), 0) + 1
    stale = sorted(a for a, n in _ALLOWED.items() if found.get(a, 0) < n)
    assert not stale, f"allowlisted blocking-fs sites are gone — prune the allowlist: {stale}"


def test_the_waiver_is_keyed_to_the_function_not_the_line():
    """The re-keying itself: a waived call that MOVES within its function stays waived; an extra one, a
    different call, a different file, or the SAME call in a different function does not. Editing db.py
    above line 201 used to fail this test for a reason unrelated to the invariant, and the "fix" was to
    renumber the waiver — while keying on the file alone would have waived any mkdir anywhere in it."""
    moved = ["app/db.py:1: connect: mkdir"]  # the same call in the same function, anywhere in the file
    assert _unwaived(moved) == []
    surplus = ["app/db.py:1: connect: mkdir", "app/db.py:2: connect: mkdir"]  # a SECOND one still counts
    assert _unwaived(surplus) == ["app/db.py:2: connect: mkdir"]
    assert _unwaived(["app/db.py:1: connect: read_text"]) == ["app/db.py:1: connect: read_text"]
    assert _unwaived(["app/other.py:1: connect: mkdir"]) == ["app/other.py:1: connect: mkdir"]
    # …and the gaming the file-only key allowed: delete the startup mkdir, add one to a hot handler in
    # the SAME file. File + call + count all still match; the ENCLOSING FUNCTION is what refuses it.
    assert _unwaived(["app/db.py:9: query: mkdir"]) == ["app/db.py:9: query: mkdir"]


def _blocking_helpers(tree: ast.Module) -> set[str]:
    """Module-level sync `def`s that perform blocking fs work, directly or by calling another such
    helper in the same file (transitive closure). These are exactly the functions that must only be
    reached via `asyncio.to_thread`, never called straight from an `async def`."""
    defs = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
    blocking = {
        name
        for name, fn in defs.items()
        if any(isinstance(x, ast.Call) and _blocking_label(x) for x in _own_body(fn))
    }
    changed = True
    while changed:  # propagate: a helper calling a blocking helper is itself blocking
        changed = False
        for name, fn in defs.items():
            if name in blocking:
                continue
            for x in _own_body(fn):
                if isinstance(x, ast.Call) and isinstance(x.func, ast.Name) and x.func.id in blocking:
                    blocking.add(name)
                    changed = True
                    break
    return blocking


def _sync_helper_calls_in_async(src: str, rel: str) -> list[str]:
    """`<rel>:<line>: <helper>()` for every direct call to a blocking sync helper from an `async def`.

    This closes the ratchet's other blind spot (shared with ASYNC240): moving the blocking calls into
    a sync helper is only a fix if the helper is then reached via `to_thread`. Passing the helper as
    a *reference* (`asyncio.to_thread(_write_soul, ...)`) is not a Call node, so the correct shape
    never trips this — only dropping the `to_thread` does.
    """
    tree = ast.parse(src)
    helpers = _blocking_helpers(tree)
    if not helpers:
        return []
    awaited = {
        id(n.value) for n in ast.walk(tree) if isinstance(n, ast.Await) and isinstance(n.value, ast.Call)
    }
    found: list[str] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.AsyncFunctionDef):
            continue
        for x in _own_body(node):
            if (
                isinstance(x, ast.Call)
                and id(x) not in awaited
                and isinstance(x.func, ast.Name)
                and x.func.id in helpers
            ):
                found.append(f"{rel}:{x.lineno}: {node.name}: {x.func.id}()")
    return found


def test_no_blocking_sync_helpers_called_straight_from_async():
    hits: list[str] = []
    for py in sorted((BACKEND / "app").rglob("*.py")):
        hits += _sync_helper_calls_in_async(
            py.read_text(encoding="utf-8"), py.relative_to(BACKEND).as_posix()
        )

    unexpected = sorted(set(hits) - _ALLOWED_HELPER_CALLS)  # empty allowlist — nothing to re-key here
    assert not unexpected, (
        "an `async def` calls a blocking sync helper directly (SYS-16) — hoisting the fs work into a "
        f"helper only fixes the stall if the helper is reached via `asyncio.to_thread`: {unexpected}"
    )
    stale = sorted(_ALLOWED_HELPER_CALLS - set(hits))
    assert not stale, f"allowlisted helper calls are gone — prune the allowlist: {stale}"


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
    assert labels == ["bad: is_file", "bad: read_text"]  # only the two in `bad`, named by their function


def test_ratchet_detects_a_dropped_to_thread():
    """The second guard's smoke test: calling the blocking helper directly must fail, while reaching
    it via `asyncio.to_thread` (a reference, not a call) must not."""
    tmpl = """
import asyncio
from pathlib import Path

def _read_soul(p: Path) -> str:
    return p.read_text() if p.is_file() else ""

def _wrapper(p: Path) -> str:
    return _read_soul(p)

async def handler(p: Path) -> str:
    return {body}
"""
    good = _sync_helper_calls_in_async(tmpl.format(body="await asyncio.to_thread(_read_soul, p)"), "s.py")
    assert good == [], f"the to_thread form must not trip the guard: {good}"

    bad = _sync_helper_calls_in_async(tmpl.format(body="_read_soul(p)"), "s.py")
    assert [h.split(": ", 1)[1] for h in bad] == ["handler: _read_soul()"]

    # transitive: a helper that only *calls* a blocking helper is itself blocking
    trans = _sync_helper_calls_in_async(tmpl.format(body="_wrapper(p)"), "s.py")
    assert [h.split(": ", 1)[1] for h in trans] == ["handler: _wrapper()"]
