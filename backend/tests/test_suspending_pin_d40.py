"""D40 (Slice 4) — the `ToolSpec.suspending` static pin (ADAPTER_BOUNDED house style).

`suspending` is the classify-time marker for a builtin tool whose own `run` can return a
`RunState.AWAITING_*` result — i.e. it suspends the turn. It is load-bearing for D40 parallel
dispatch (a suspending tool is excluded from the read-only prefix, because suspension is only
observable *post*-invoke, so the loop must know BEFORE it dispatches — never a tool-name literal).

Two guards, both fail-closed and symbol-keyed (not name-string matched):

1. **Static scan → declared flag.** AST-walk the builtin tool modules (`services/actions`,
   `services/tools`, `services/agent`) for functions that `return` a `RunState.AWAITING_*`. Every
   such module must own a registered spec with `suspending=True`; and the ONLY module that does so
   today is `question` (→ `AWAITING_ANSWER`). A new suspending tool that forgets the flag — or a
   `suspending=True` on a tool whose code can't actually suspend — fails here (update-the-pin).

2. **Declared flag is exactly `{question}`.** Walk the live registry: the set of registered builtins
   with `suspending=True` is exactly `{"question"}`.

**Scope note — why `session.py` and `turns.py` are excluded from the scan.** They reference
`RunState.AWAITING_CONFIRM`/`AWAITING_ANSWER`, but never *return* them from a tool: the
`AWAITING_CONFIRM` suspend is **loop-owned** (`session.py` mints it from `decide()==CONFIRM`, not a
tool's `run`), and `turns.py` only folds the states into events. Neither registers a tool, so
neither maps to a spec — the scan keys on `return` statements, which structurally excludes both.
MCP/OpenAPI adapters are out of scope too: they are dynamically registered (not in `build_registry`)
and structurally cannot return `AWAITING_*` (D40 — verified against both adapters).

LOW-2 scan-limitation note: `_returns_awaiting` matches an `AWAITING_`-prefixed attribute *under a
`Return` node* — i.e. DIRECT returns (`return ToolResult(state=RunState.AWAITING_ANSWER, …)` or
`return RunState.AWAITING_*`). An INDIRECTED suspend that binds the result first —
`r = ToolResult(state=RunState.AWAITING_ANSWER, …); return r` — slips the AST scan (the `AWAITING_`
attr lives on the assignment, not under the `Return`). This is a known house-style limitation shared
with the other static pins (e.g. the ADAPTER_BOUNDED / arch-invariant scans): they trade total
dataflow fidelity for a cheap, readable, fail-closed check against the direct-return idiom the
codebase actually uses. Runtime belts (§4: the parallel-prefix fail-closed conversion of an
AWAITING_*/needs_confirm result to an error) catch a misdeclaration this scan can't see.
"""

from __future__ import annotations

import ast
import inspect
from pathlib import Path

from app.core.tool import FunctionTool
from app.services.actions import build_registry

BACKEND = Path(__file__).resolve().parents[1]

#: The builtin tool-module trees the pin scans. The loop machinery (`session.py`, the loop that OWNS
#: the confirm suspend; `turns.py`, the event accumulator) references AWAITING states but never
#: returns one from a tool — excluded by construction (the scan keys on `return`) and named here.
_TOOL_DIRS = ("app/services/actions", "app/services/tools", "app/services/agent")
_LOOP_EXCLUDED = {"app/services/agent/session.py", "app/services/agent/turns.py"}


def _returns_awaiting(tree: ast.Module) -> bool:
    """True if any `return` in the module hands back a `RunState.AWAITING_*` (directly or nested in a
    `ToolResult(state=...)`) — detected by an `AWAITING_`-prefixed attribute anywhere under a Return."""
    for node in ast.walk(tree):
        if not isinstance(node, ast.Return) or node.value is None:
            continue
        for sub in ast.walk(node.value):
            if isinstance(sub, ast.Attribute) and sub.attr.startswith("AWAITING_"):
                return True
    return False


def _suspending_source_modules() -> set[str]:
    """The dotted module names (under the tool dirs, minus the loop files) that can return AWAITING_*."""
    found: set[str] = set()
    for d in _TOOL_DIRS:
        for py in (BACKEND / d).rglob("*.py"):
            rel = py.relative_to(BACKEND).as_posix()
            if rel in _LOOP_EXCLUDED or py.name == "__init__.py":
                continue
            if _returns_awaiting(ast.parse(py.read_text(encoding="utf-8"))):
                # app/services/agent/question.py -> app.services.agent.question
                found.add(rel[: -len(".py")].replace("/", "."))
    return found


def test_every_awaiting_returning_module_declares_a_suspending_spec() -> None:
    """Static scan ↔ declared flag: each builtin module that can return AWAITING_* owns a registered
    spec with `suspending=True`, and that set of modules is exactly `{question}`. Fail-closed: a new
    suspending tool without the flag (or vice-versa) breaks this."""
    reg = build_registry()
    # symbol-keyed: a tool's DEFINING module comes from its function, not a name string.
    module_of: dict[str, str] = {}
    for t in reg.all():
        assert isinstance(t, FunctionTool)  # every builtin registers as a FunctionTool
        module_of[t.spec.name] = t.fn.__module__
    suspending_specs = {t.spec.name for t in reg.all() if t.spec.suspending}

    scan_modules = _suspending_source_modules()
    assert scan_modules == {"app.services.agent.question"}, (
        f"a builtin module returns RunState.AWAITING_* that the pin doesn't expect: {scan_modules} — "
        "if a NEW suspending tool landed, set suspending=True on its spec and update this pin"
    )

    # Every module that can suspend must back a spec flagged suspending.
    modules_with_suspending_spec = {module_of[n] for n in suspending_specs}
    assert scan_modules <= modules_with_suspending_spec, (
        f"module(s) return AWAITING_* but no registered spec sets suspending=True: "
        f"{scan_modules - modules_with_suspending_spec}"
    )


def test_suspending_registry_set_is_exactly_question() -> None:
    """The declared flag on the live registry: `question` is suspending, nothing else is — and its
    source really returns AWAITING_ANSWER (symbol-checked, no name-string coupling)."""
    reg = build_registry()
    suspending = {t.spec.name for t in reg.all() if t.spec.suspending}
    assert suspending == {"question"}, f"unexpected suspending builtins: {sorted(suspending)}"

    q = reg.get("question")
    assert isinstance(q, FunctionTool)
    assert q.spec.suspending is True
    src = inspect.getsource(q.fn)
    assert "AWAITING_ANSWER" in src  # the flag matches what the code actually does


if __name__ == "__main__":
    passed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
            passed += 1
    print(f"\n{passed} passed")
