"""Phase 18 Slice 0 · M1 (PROMPTS_PLAN §6 C-11) — the effective tool allowlist is enforced at EXECUTION.

`_tools()` only ever showed the model `for_agent(self._tool_allow)`, but the execution path handed the
model-emitted name straight to `ActionService.invoke`, which resolves it from the FULL registry — so a
tool hidden by `agent_exposed=False`, excluded by the agent's `tools`, or narrowed away by an active
skill still ran on a hallucinated or stale-context name. The guard (`_tool_allowed`/`_blocked_call`)
wraps BOTH invoke sites (the serial loop + the parallel prefix) and consults the effective set at CALL
TIME, so a per-turn skill narrowing is respected and the core builtins keep surviving any allowlist.

The pins here drive the REAL `AgentSession` + `ActionService` + SQLite path against a temp workspace
with a synthetic action whose body FLIPS A FLAG — so "never invokes its body" is asserted directly (the
negative regression the audit asked for: it fails on the pinned baseline). Harness mirrors
`test_parallel_executor_d40.py`; the synthetic-tool fixture mirrors `test_prefix_classifier_d40.py`.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
import uuid
from pathlib import Path

from _async import run_async
from pydantic import BaseModel


@contextlib.contextmanager
def _workspace(config_text: str = "server:\n  port: 5433\n"):
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(config_text, encoding="utf-8")
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        yield tmp
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


def _guard(*, max_repeat: int = 5, max_per_tool: int = 10):
    from app.services.agent.session import _LoopGuard

    return _LoopGuard(max_repeat=max_repeat, max_per_tool=max_per_tool)


class _NoArgs(BaseModel):
    pass


@contextlib.contextmanager
def _flag_tool(registry, name: str, fired: dict, **spec_kw):
    """Register a synthetic action whose BODY flips `fired[name]`, then remove it (the registry is a
    process-global singleton shared across `create_app()` calls — a leaked tool poisons later tests)."""
    from app.core.tool import FunctionTool, ToolSpec
    from app.domain.enums import RunState
    from app.domain.result import ToolResult

    spec_kw.setdefault("input_model", _NoArgs)
    spec_kw.setdefault("category", "builtin")
    spec_kw.setdefault("title", name)

    async def _fn(inp, ctx):  # noqa: ANN001
        fired[name] = True
        return ToolResult(state=RunState.OK, summary=f"ran {name}")

    registry.register(FunctionTool(spec=ToolSpec(name=name, **spec_kw), fn=_fn))
    try:
        yield name
    finally:
        registry.remove(name)


def _session(c, specs: list[dict], *, tools="*", max_parallel: int = 4):
    """Session (its `AgentDef.tools` = `tools`) + a persisted assistant holding `specs` as PENDING
    calls. Returns (session, thread, assistant, call_ids)."""
    from app.domain.conversation import Message, Thread, ToolCallPart
    from app.domain.enums import Actor, RunState
    from app.services.agent.session import AgentSession

    s = c.app.state
    agent = s.settings.resolve_agent(None).model_copy(
        update={"tools": tools, "max_parallel_tools": max_parallel}
    )
    session = AgentSession(
        s.threads,
        s.messages,
        s.inference,
        s.settings,
        s.actions,
        agent,
        skills=s.skills,
        selector=s.skill_selector,
        interactive=True,
    )
    thread = run_async(s.threads.create(Thread()))
    cids = [uuid.uuid4().hex for _ in specs]
    assistant = Message(
        thread_id=thread.id,
        role="assistant",
        actor=Actor.AGENT,
        agent="default",
        parts=[
            ToolCallPart(
                call_id=cid,
                tool=spec["tool"],
                args=spec.get("args", {}),
                state=RunState.PENDING,
                invalid_raw=spec.get("invalid_raw"),
            )
            for cid, spec in zip(cids, specs, strict=True)
        ],
    )
    run_async(s.messages.add(assistant))
    return session, thread, assistant, cids


def _drive(session, thread, assistant, guard, resume_tokens=None):
    """Drain the async-generator `_run_calls`, returning its events."""
    from app.services.agent.session import _BatchOutcome

    async def _collect():
        return [
            ev
            async for ev in session._run_calls(
                thread, assistant, resume_tokens or {}, guard, outcome=_BatchOutcome()
            )
        ]

    return run_async(_collect())


def _results(events) -> dict[str, dict]:
    return {ev.data["callId"]: ev.data["result"] for ev in events if ev.event == "tool.result"}


def _write_skill(root: Path, name: str, allowed_tools: list[str]) -> None:
    d = root / name
    d.mkdir(parents=True, exist_ok=True)
    at = f"\nallowed_tools: [{', '.join(allowed_tools)}]" if allowed_tools else ""
    (d / "SKILL.md").write_text(
        f"---\nname: {name}\ndescription: deploy a release{at}\n---\nDeploy carefully.\n",
        encoding="utf-8",
    )


# ── the negative regression: an excluded emitted name never executes its body ────────────────────
def test_excluded_tool_never_executes_its_body() -> None:
    from app.domain.enums import Risk, RunState
    from app.services.agent.session import M1_TOOL_BLOCKED, _LoopGuard

    with _workspace(), _client() as c:
        fired: dict = {}
        with _flag_tool(c.app.state.actions.registry, "_probe_m1", fired, risk=Risk.LOW):
            # The agent's allowlist excludes the probe — but the model emits it anyway.
            session, thread, assistant, (cid,) = _session(c, [{"tool": "_probe_m1"}], tools=["ping_host"])
            guard = _guard()
            events = _drive(session, thread, assistant, guard)
        assert fired == {}  # the body NEVER ran (fails on the pinned baseline, where it did)
        result = _results(events)[cid]
        assert result["state"] == RunState.DENIED.value
        assert result["output"] == M1_TOOL_BLOCKED.format(tool="_probe_m1")
        # …and the refusal feeds the loop guard's denied-signature path, so a loop of blocked calls
        # trips the guard instead of spinning.
        assert _LoopGuard.sig("_probe_m1", {}) in guard.denied_sigs


def test_blocked_call_is_audited() -> None:
    """The guard bypasses `ActionService` — it must NOT also bypass the audit trail (C-11)."""
    from app.domain.enums import Risk, RunState

    with _workspace(), _client() as c:
        fired: dict = {}
        with _flag_tool(c.app.state.actions.registry, "_probe_m1_audit", fired, risk=Risk.LOW):
            session, thread, assistant, _ = _session(c, [{"tool": "_probe_m1_audit"}], tools=["ping_host"])
            _drive(session, thread, assistant, _guard())
        rows = run_async(c.app.state.deps.events.recent(10))
        row = next(e for e in rows if e.action == "_probe_m1_audit")
        assert row.status == RunState.DENIED
        assert row.decision == "policy"  # the same column the gate's own DENY writes


def test_resumed_call_is_blocked_too() -> None:
    """A confirm token doesn't buy passage: the guard applies uniformly to a resumed call (C-11)."""
    from app.domain.enums import Risk, RunState

    with _workspace(), _client() as c:
        fired: dict = {}
        with _flag_tool(c.app.state.actions.registry, "_probe_m1_resume", fired, risk=Risk.MED):
            session, thread, assistant, (cid,) = _session(
                c, [{"tool": "_probe_m1_resume"}], tools=["ping_host"]
            )
            events = _drive(session, thread, assistant, _guard(), resume_tokens={cid: "tok"})
        assert fired == {}
        assert _results(events)[cid]["state"] == RunState.DENIED.value


def test_a_tool_excluded_while_suspended_is_denied_on_resume() -> None:
    """The bubble was minted while the tool was allowed; an agent/skill change excluded it before the
    owner clicked. `resume` must consult the allowlist BEFORE the `execute_always` grant and the
    confirm-token re-mint — a call that cannot run must not persist an approval rule for itself."""
    from app.domain.conversation import Message, Thread, ToolCallPart
    from app.domain.enums import Actor, Risk, RunState
    from app.services.agent.session import AgentSession

    with _workspace(), _client() as c:
        s = c.app.state
        fired: dict = {}
        with _flag_tool(s.actions.registry, "_probe_m1_gone", fired, risk=Risk.MED):
            session = AgentSession(
                s.threads,
                s.messages,
                s.inference,
                s.settings,
                s.actions,
                s.settings.resolve_agent(None).model_copy(update={"tools": ["ping_host"]}),
                interactive=True,
            )
            thread = run_async(s.threads.create(Thread()))
            cid = uuid.uuid4().hex
            run_async(
                s.messages.add(
                    Message(
                        thread_id=thread.id,
                        role="assistant",
                        actor=Actor.AGENT,
                        agent="default",
                        parts=[
                            ToolCallPart(
                                call_id=cid,
                                tool="_probe_m1_gone",
                                args={},
                                state=RunState.AWAITING_CONFIRM,
                            )
                        ],
                    )
                )
            )

            async def _collect():
                return [ev async for ev in session.resume(thread, cid, "execute_always", app=c.app)]

            events = run_async(_collect())
        assert fired == {}
        assert _results(events)[cid]["state"] == RunState.DENIED.value
        row = next(e for e in run_async(s.deps.events.recent(10)) if e.action == "_probe_m1_gone")
        assert row.status == RunState.DENIED and row.decision == "policy"
        override = s.settings.tool_overrides.get("_probe_m1_gone")  # no grant was spent on it
        assert override is None or not override.approvals


def test_excluded_tool_with_malformed_args_is_denied_not_repaired() -> None:
    """The capability boundary outranks argument validity: an excluded tool whose args were malformed
    gets the DENIED refusal (audited, denial-signature recorded), not JSON-repair steering."""
    from app.domain.enums import Risk, RunState
    from app.services.agent.session import M1_TOOL_BLOCKED, _LoopGuard

    with _workspace(), _client() as c:
        fired: dict = {}
        with _flag_tool(c.app.state.actions.registry, "_probe_m1_bad", fired, risk=Risk.LOW):
            session, thread, assistant, (cid,) = _session(
                c, [{"tool": "_probe_m1_bad", "invalid_raw": "{not json"}], tools=["ping_host"]
            )
            guard = _guard()
            events = _drive(session, thread, assistant, guard)
        assert fired == {}
        result = _results(events)[cid]
        assert result["state"] == RunState.DENIED.value
        assert result["output"] == M1_TOOL_BLOCKED.format(tool="_probe_m1_bad")
        assert _LoopGuard.sig("_probe_m1_bad", {}) in guard.denied_sigs


# ── the positive side: allowed + core tools are untouched ────────────────────────────────────────
def test_allowed_tool_still_runs() -> None:
    from app.domain.enums import Risk, RunState

    with _workspace(), _client() as c:
        fired: dict = {}
        with _flag_tool(c.app.state.actions.registry, "_probe_m1_ok", fired, risk=Risk.LOW):
            session, thread, assistant, (cid,) = _session(
                c, [{"tool": "_probe_m1_ok"}], tools=["_probe_m1_ok"]
            )
            events = _drive(session, thread, assistant, _guard())
        assert fired == {"_probe_m1_ok": True}
        assert _results(events)[cid]["state"] == RunState.OK.value


def test_core_builtin_survives_a_narrow_allowlist() -> None:
    """`for_agent` lets the cognitive builtins through any allowlist — the guard must too, since it
    reads the same set rather than restating a name list."""
    from app.domain.enums import RunState

    with _workspace(), _client() as c:
        session, thread, assistant, (cid,) = _session(
            c, [{"tool": "task_plan", "args": {"steps": [{"title": "one"}]}}], tools=["ping_host"]
        )
        assert session._actions.registry.get("task_plan").spec.core is True  # the load-bearing property
        events = _drive(session, thread, assistant, _guard())
        assert _results(events)[cid]["state"] == RunState.OK.value


def test_agent_hidden_tool_is_blocked() -> None:
    """`agent_exposed=False` keeps a tool out of `agent_tools()` — it was never advertised, so an
    emitted name for it is refused even under the wide-open `"*"` allowlist."""
    from app.domain.enums import Risk, RunState

    with _workspace(), _client() as c:
        fired: dict = {}
        with _flag_tool(
            c.app.state.actions.registry, "_probe_m1_hidden", fired, risk=Risk.LOW, agent_exposed=False
        ):
            session, thread, assistant, (cid,) = _session(c, [{"tool": "_probe_m1_hidden"}], tools="*")
            events = _drive(session, thread, assistant, _guard())
        assert fired == {}
        assert _results(events)[cid]["state"] == RunState.DENIED.value


# ── skill narrowing is respected because the set is computed at CALL time ─────────────────────────
def test_skill_narrowed_allowlist_blocks_the_wider_tool() -> None:
    from app.domain.enums import Risk, RunState

    with _workspace(), _client() as c:
        _write_skill(c.app.state.settings.skills_dir_path(), "deploy", allowed_tools=["ping_host"])
        fired: dict = {}
        with _flag_tool(c.app.state.actions.registry, "_probe_m1_skill", fired, risk=Risk.LOW):
            session, thread, assistant, (cid,) = _session(c, [{"tool": "_probe_m1_skill"}], tools="*")
            session._tools()  # render (and cache) the WIDE toolset first…
            session._activate_skills("", ["deploy"], select=False)  # …then narrow, as a turn does
            assert session._tool_allow == ["ping_host"]
            events = _drive(session, thread, assistant, _guard())
        assert fired == {}  # the guard read the narrowed allowlist, not the cached wide render
        assert _results(events)[cid]["state"] == RunState.DENIED.value


# ── the parallel prefix takes the same guard ─────────────────────────────────────────────────────
def test_parallel_prefix_blocks_only_the_excluded_read() -> None:
    from app.domain.enums import Risk, RunState

    with _workspace(), _client() as c:
        fired: dict = {}
        reg = c.app.state.actions.registry
        with (
            _flag_tool(reg, "_probe_m1_read_ok", fired, risk=Risk.LOW, read_only=True),
            _flag_tool(reg, "_probe_m1_read_no", fired, risk=Risk.LOW, read_only=True),
        ):
            session, thread, assistant, (ok_id, no_id) = _session(
                c,
                [{"tool": "_probe_m1_read_ok"}, {"tool": "_probe_m1_read_no"}],
                tools=["_probe_m1_read_ok"],
                max_parallel=4,
            )
            guard = _guard()
            # Both are read-only builtins → the classifier admits BOTH to the parallel prefix (it
            # resolves specs from the full registry); the executor's guard is what stops the second.
            assert len(session._classify_batch(assistant, _guard(), {}).prefix) == 2
            events = _drive(session, thread, assistant, guard)
        assert fired == {"_probe_m1_read_ok": True}
        results = _results(events)
        assert results[ok_id]["state"] == RunState.OK.value
        assert results[no_id]["state"] == RunState.DENIED.value


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
