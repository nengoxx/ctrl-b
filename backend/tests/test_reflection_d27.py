"""D27 slice C — periodic reflection ("save anything worth remembering" every N user turns).

Exercises the turn-counter + the conditional nudge injection: at turn start `_maybe_arm_reflection`
counts the thread's user messages (including compacted ones, so the cadence doesn't drift) and arms a
per-turn flag when the count is a multiple of `reflection_interval`; `_assemble` then injects a single
reflection `system` message as an ephemeral TAIL layer — appended after the chat history so it never
sits inside the cached static prompt head (BE efficiency pass). All opt-in (off unless the master memory
switch and `reflection_enabled` are both on).

What's exercised:
  1. fires at interval      — enabled + interval=2, 2 user turns → the nudge is injected.
  2. silent off-interval    — 2 user turns vs interval=3 → no nudge.
  3. silent when disabled    — reflection_enabled off → no nudge even at the interval.
  4. silent when master off  — memory.enabled off → no nudge even with reflection on.
  5. compaction-stable count — a compacted user message still counts (cadence survives compaction).
  6. state clause gated      — the "update your state" clause appears only when state_enabled.
  7. position                — the nudge is an ephemeral tail layer: the LAST message overall, after
                               the static head AND the chat history (keeps the cached prefix pristine).

Each test runs in an isolated `$CTRLB_HOME` temp workspace; the real config/db are never touched.
"""

from __future__ import annotations

import contextlib
import os
import tempfile
from pathlib import Path

from _async import run_async


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


@contextlib.contextmanager
def _workspace(config_text: str = "server:\n  port: 5433\n"):
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(config_text, encoding="utf-8")
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        yield tmp, cfg
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


def _run(coro):
    return run_async(coro)


def _session(c, agent_name: str | None = None):
    from app.services.agent.session import AgentSession

    s = c.app.state
    return AgentSession(
        s.threads,
        s.messages,
        s.inference,
        s.settings,
        s.actions,
        s.settings.resolve_agent(agent_name),
        skills=getattr(s, "skills", None),
        selector=getattr(s, "skill_selector", None),
        memory=getattr(s, "memory", None),
    )


def _thread_with_users(c, n: int, *, compacted_last: bool = False):
    """A fresh thread with `n` user messages (optionally marking the last compacted)."""
    from app.domain.conversation import Message, TextPart, Thread
    from app.domain.enums import Actor

    async def go():
        t = await c.app.state.threads.create(Thread())
        for i in range(n):
            await c.app.state.messages.add(
                Message(
                    thread_id=t.id,
                    role="user",
                    actor=Actor.USER,
                    parts=[TextPart(text=f"msg {i}")],
                    compacted=(compacted_last and i == n - 1),
                )
            )
        return t

    return _run(go())


def _systems(messages: list[dict]) -> list[str]:
    # ALL system-message contents, in array order. The reflection nudge is now an ephemeral TAIL layer
    # (appended after history, BE efficiency pass), so this can't stop at the first non-system message —
    # it must scan the whole array to see both the static head and the trailing nudge.
    return [m["content"] for m in messages if m["role"] == "system"]


def _arm_and_assemble(c, thread, agent_name: str | None = None) -> list[str]:
    """Arm reflection then assemble on the SAME session (the flag is instance state)."""
    sess = _session(c, agent_name)
    _run(sess._maybe_arm_reflection(thread))
    return _systems(_run(sess._assemble(thread)))


def _has_nudge(systems: list[str]) -> bool:
    return any("turns" in s and "memory` tool" in s for s in systems)


# ── tests ──────────────────────────────────────────────────────────────────────────────────────


def test_reflection_fires_at_interval() -> None:
    with _workspace():
        with _client() as c:
            c.app.state.settings.memory.reflection_enabled = True
            c.app.state.settings.memory.reflection_interval = 2
            systems = _arm_and_assemble(c, _thread_with_users(c, 2))
            assert _has_nudge(systems)


def test_reflection_silent_off_interval() -> None:
    with _workspace():
        with _client() as c:
            c.app.state.settings.memory.reflection_enabled = True
            c.app.state.settings.memory.reflection_interval = 3
            systems = _arm_and_assemble(c, _thread_with_users(c, 2))  # 2 % 3 != 0
            assert not _has_nudge(systems)


def test_reflection_silent_when_disabled() -> None:
    with _workspace():
        with _client() as c:
            c.app.state.settings.memory.reflection_enabled = False
            c.app.state.settings.memory.reflection_interval = 1
            systems = _arm_and_assemble(c, _thread_with_users(c, 1))
            assert not _has_nudge(systems)


def test_reflection_silent_when_memory_master_off() -> None:
    with _workspace():
        with _client() as c:
            c.app.state.settings.memory.enabled = False  # master switch
            c.app.state.settings.memory.reflection_enabled = True
            c.app.state.settings.memory.reflection_interval = 1
            systems = _arm_and_assemble(c, _thread_with_users(c, 1))
            assert not _has_nudge(systems)


def test_reflection_count_includes_compacted() -> None:
    """A compacted user message still counts → the cadence survives compaction (unlike `_assemble`'s
    non-compacted history view, which would under-count and make reflection drift)."""
    with _workspace():
        with _client() as c:
            c.app.state.settings.memory.reflection_enabled = True
            c.app.state.settings.memory.reflection_interval = 2
            # 2 user messages, the first folded into a summary (compacted). Count must still read 2.
            thread = _thread_with_users(c, 2, compacted_last=False)

            # mark the FIRST user message compacted
            async def fold_first():
                msgs = await c.app.state.messages.list(thread.id)
                first = next(m for m in msgs if m.role == "user")
                first.compacted = True
                await c.app.state.messages.update(first)

            _run(fold_first())
            assert _run(c.app.state.messages.count_user_messages(thread.id)) == 2
            assert _has_nudge(_arm_and_assemble(c, thread))


def test_reflection_state_clause_gated() -> None:
    with _workspace():
        with _client() as c:
            mem = c.app.state.settings.memory
            mem.reflection_enabled = True
            mem.reflection_interval = 1
            # state off → no state clause
            mem.state_enabled = False
            systems = _arm_and_assemble(c, _thread_with_users(c, 1))
            assert _has_nudge(systems) and not any("`state`" in s for s in systems)
            # state on → the clause appears
            mem.state_enabled = True
            systems = _arm_and_assemble(c, _thread_with_users(c, 1))
            assert any("`state`" in s for s in systems)


def test_reflection_is_one_shot_per_turn() -> None:
    """The nudge fires in exactly ONE model call per firing turn — a second `_assemble` on the same
    session (the next `_drive` iteration) must NOT re-inject it (else a weak model re-saves)."""
    with _workspace():
        with _client() as c:
            c.app.state.settings.memory.reflection_enabled = True
            c.app.state.settings.memory.reflection_interval = 1
            thread = _thread_with_users(c, 1)
            sess = _session(c)
            _run(sess._maybe_arm_reflection(thread))
            first = _systems(_run(sess._assemble(thread)))  # iteration 1 — nudge present
            second = _systems(_run(sess._assemble(thread)))  # iteration 2 — already consumed
            assert _has_nudge(first)
            assert not _has_nudge(second)


def test_reflection_skipped_for_subagents() -> None:
    """A headless subagent (depth > 0) must not reflect into durable memory from its throwaway thread,
    even at an aggressive interval that its single task turn would otherwise hit."""
    from app.services.agent.session import AgentSession

    with _workspace():
        with _client() as c:
            c.app.state.settings.memory.reflection_enabled = True
            c.app.state.settings.memory.reflection_interval = 1
            s = c.app.state
            sub = AgentSession(
                s.threads,
                s.messages,
                s.inference,
                s.settings,
                s.actions,
                s.settings.resolve_agent(None),
                skills=getattr(s, "skills", None),
                selector=getattr(s, "skill_selector", None),
                memory=getattr(s, "memory", None),
                interactive=False,
                depth=1,
            )
            thread = _thread_with_users(c, 1)
            _run(sub._maybe_arm_reflection(thread))
            assert not _has_nudge(_systems(_run(sub._assemble(thread))))


def test_reflection_nudge_is_tail_layer() -> None:
    """The nudge is an ephemeral TAIL layer (BE efficiency pass): appended after the chat history, so
    it's the LAST message of the whole array — past the static head (system prompt + memory) AND past
    the user message. This is what keeps the cached prompt prefix (head + tools) byte-stable."""
    with _workspace() as (tmp, _cfg):
        with _client() as c:
            c.app.state.settings.memory.reflection_enabled = True
            c.app.state.settings.memory.reflection_interval = 1
            (tmp / "memories").mkdir(parents=True, exist_ok=True)
            (tmp / "memories" / "MEMORY.md").write_text("a durable fact", encoding="utf-8")
            sess = _session(c)
            _run(sess._maybe_arm_reflection(thread := _thread_with_users(c, 1)))
            msgs = _run(sess._assemble(thread))
            systems = _systems(msgs)
            assert "## Agent memory" in "\n".join(systems)  # memory injected (in the static head)
            # The nudge is the final message of the array — after the head and after the user turn.
            assert msgs[-1]["role"] == "system"
            assert "turns" in msgs[-1]["content"] and "memory` tool" in msgs[-1]["content"]
            assert any(m["role"] == "user" for m in msgs[:-1])  # history really precedes the nudge


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
