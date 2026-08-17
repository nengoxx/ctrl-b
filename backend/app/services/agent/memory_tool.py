"""memory — the agent's write path to its durable file memory (7e-d-2, D14/D15 #4/#6).

A built-in, agent-only tool (no Utils card, no host button) that lets the model persist a note it
should remember across sessions. There is **no read action** — the saved memory is injected into
every turn by `FileMemoryProvider.load_context` (7e-d-1), so the model already sees the current
content (and each store's cap usage) and writes against it.

Gating, in order: the subsystem master switch (`memory.enabled`), the `user` target's own switch
(`memory.user_profile_enabled`), then the `auto_write` kill switch — when **off** the tool neither
writes nor blocks: it returns a non-blocking "proposed (not written)" result carrying the edit in
`data["proposed"]`, for the Approve-to-apply UI deferred to 7e-f (shared with `skill_manage`). A
write that would exceed the store's char cap comes back as an ERROR result steering the model to
consolidate, not a crash. Every invocation is audited by `ActionService._record` — no manual Event.

LOW risk → auto-runs under the agent's CONFIRM privilege (no confirm gate), like `task_plan`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, Field

from app.config import Settings
from app.core.memory import StoreSemantics, store_by_key
from app.core.tool import InvocationContext, action
from app.domain.enums import Risk, RunState
from app.domain.result import ToolResult
from app.services.agent.memory import MemoryCapError, MemoryWriteError
from app.services.agent.prompts import resolve

if TYPE_CHECKING:
    from app.domain.agent import AgentDef
    from app.services.deps import Deps

#: The tool description while Core Memory is OFF — the only tier there is, so it keeps every word it
#: had before tier 2 existed (§4b-5: exact current text when off). Hoisted out of the `@action` call
#: only because `describe` below picks between two variants; it is ordinary tool-level description
#: text, `tool_overrides`-editable like any other.
_DESCRIPTION_SOLO = (
    "Save something to your durable memory so you remember it in future sessions. Use it when "
    "you learn a lasting fact, preference, or decision worth keeping — not for transient chat. "
    "`add` a new note, or `replace`/`remove` an existing one by a unique `old_text` substring. You do not "
    "need to read first: your current memory is shown to you each turn. Set `target` to `user` to "
    "record a durable fact about the person you're helping, or `target=state` with `action=set` to "
    "rewrite your own current mood/state when it shifts."
)

#: …and while Core Memory is ON (§4b-5, council Codex-10/Opus-M1): this store is the SHORT-HORIZON
#: tier, so the description stops pointing durable facts at it and routes them one clause later.
_DESCRIPTION_TIERED = (
    "Save something to your short-horizon working memory so you carry it across this and the next "
    "few sessions — what you are working on, decisions made in passing, context that will matter "
    "soon. It is capped and may be trimmed, so durable, shared knowledge belongs in `core_memory` "
    "instead. `add` a new note, or `replace`/`remove` an existing one by a unique `old_text` "
    "substring. You do not need to read first: your current memory is shown to you each turn. Set "
    "`target` to `user` for current context about the person you're helping (their lasting "
    "preferences belong in `core_memory` too), or `target=state` with `action=set` to rewrite your "
    "own current mood/state when it shifts."
)


def _describe_memory(settings: Settings) -> str:
    """The tool's model-facing description for the CURRENT config (`ToolSpec.describe`, §4b-5). With
    tier 2 on, the tier-1 surfaces must stop advertising themselves as the home of lasting facts —
    otherwise the two descriptions compete for the same content and the model routes by whichever it
    read last. Resolved by `apply_tool_overrides`, which runs on lifespan AND on every reconfigure, so
    flipping `memory.longterm.backend` reshapes the schema with no restart."""
    return _DESCRIPTION_TIERED if settings.memory.core_memory_on() else _DESCRIPTION_SOLO


class MemoryInput(BaseModel):
    target: Literal["memory", "user", "state"] = Field(
        default="memory",
        description=(
            "Which store to edit. `memory` = your own working memory (facts about ongoing tasks, "
            "decisions, project context). `user` = the durable profile of the person you're helping "
            "(their preferences, identity, standing instructions) — shared across all agents. `state` "
            "= your own current emotional/affective state (a short mood/energy note) — rewrite it "
            "wholesale with `action=set` when how you feel shifts."
        ),
    )
    action: Literal["add", "replace", "remove", "set"] = Field(
        description=(
            "For `memory`/`user`: `add` a new entry, or `replace`/`remove` an existing one (give an "
            "`old_text` substring that **uniquely identifies one entry**). For `state`: `set` — "
            "`content` becomes the whole new state, replacing what was there."
        ),
    )
    content: str = Field(
        default="",
        description=(
            "The note to store (for `add`) or the new text (for `replace`). Keep it short and "
            "durable — a single fact or preference worth remembering, not transient chatter."
        ),
    )
    old_text: str | None = Field(
        default=None,
        description=(
            "For `replace`/`remove`: an exact substring of the current memory that **identifies "
            "exactly one entry** — add surrounding text if a short one would match several. Copy it "
            "verbatim from the memory block injected this turn."
        ),
    )


@action(
    "memory",
    title="Memory",
    description=_DESCRIPTION_SOLO,
    describe=_describe_memory,
    icon="brain",
    category="builtin",
    risk=Risk.LOW,
    ui_exposed=False,
    core=True,  # cognitive builtin — always reachable regardless of an agent's tools allowlist
)
async def memory(inp: MemoryInput, ctx: InvocationContext) -> ToolResult:
    """Save something to your durable memory so you remember it across sessions. `add` a note, or
    `replace`/`remove` one by its exact `old_text`. No read needed — your memory is injected each
    turn. Use `target=user` for a durable fact about the person you're helping."""
    deps = ctx.require_deps()
    gated = gate_memory(deps, inp)
    if gated is not None:
        return gated
    agent = ctx.agent or deps.settings.default_agent_def()

    # Kill switch (D15 #6): off → propose, never write, never block. The owner approves it later via
    # the Approve-to-apply UI (7e-f-3), which re-runs the gate + `apply_memory` below, auto-write
    # aside — shared with `skill_manage` through `services/agent/proposals.py`. SET stores (emotional
    # `state`) bypass the propose-gate and always auto-apply: the agent's own mood is not a
    # fact-about-the-world that needs the owner's Approve (D27 #1).
    spec = store_by_key(inp.target)
    auto_applies = spec is not None and spec.semantics is StoreSemantics.SET
    if not deps.settings.memory.auto_write and not auto_applies:
        return ToolResult(
            state=RunState.OK,
            summary=f"proposed {inp.action} to {inp.target} memory — awaiting the owner's approval (NOT saved yet)",
            output=resolve("memory_proposal_pending", deps.settings, stamps=ctx.stamps),
            data={"proposed": inp.model_dump()},
        )
    return await apply_memory(deps, agent, inp, stamps=ctx.stamps)


def gate_memory(deps: "Deps | None", inp: MemoryInput) -> ToolResult | None:
    """The shared gate for the memory write path — used by the `memory` tool *and* the Approve-to-apply
    endpoint (proposals.py). Enforces availability + the master/user-profile switches + the arg checks
    the model can fix; returns a short-circuit `ToolResult` (DENIED/ERROR) or `None` to proceed. The
    only thing it does NOT check is `auto_write` — that gate is the tool's alone (off → propose), so an
    owner-approved apply legitimately bypasses it while every other rail still holds."""
    if deps is None or deps.memory is None:
        return ToolResult(state=RunState.DENIED, summary="memory is not available")
    cfg = deps.settings.memory
    if not cfg.enabled:
        return ToolResult(state=RunState.DENIED, summary="memory subsystem is disabled")
    if inp.target == "user" and not cfg.user_profile_enabled:
        return ToolResult(state=RunState.DENIED, summary="user-profile writes are disabled")
    if inp.target == "state" and not cfg.state_enabled:
        return ToolResult(state=RunState.DENIED, summary="emotional-state writes are disabled")
    # Action ↔ store-semantics (D27-B): `set` only on a SET store, add/replace/remove only on APPEND.
    spec = store_by_key(inp.target)
    if spec is not None:
        if spec.semantics is StoreSemantics.SET and inp.action != "set":
            return ToolResult(
                state=RunState.ERROR,
                summary=f"{inp.target} takes action=set",
                error=f"the `{inp.target}` store holds one value — use `action=set` to rewrite it, "
                "not add/replace/remove.",
            )
        if spec.semantics is StoreSemantics.APPEND and inp.action == "set":
            return ToolResult(
                state=RunState.ERROR,
                summary="set is only for the state store",
                error="`action=set` rewrites the whole store; only the emotional `state` store uses "
                "it. For `memory`/`user`, use add/replace/remove.",
            )
    # Arg checks the model can fix → ERROR (data, not an exception).
    if inp.action in ("add", "set") and not inp.content.strip():
        return ToolResult(
            state=RunState.ERROR,
            summary=f"nothing to {inp.action}",
            error=f"`content` is required for {inp.action}.",
        )
    if inp.action in ("replace", "remove") and not (inp.old_text or "").strip():
        return ToolResult(
            state=RunState.ERROR,
            summary=f"{inp.action} needs old_text",
            error="`old_text` must be an exact substring of the current memory.",
        )
    return None


async def apply_memory(
    deps: "Deps", agent: "AgentDef", inp: MemoryInput, *, stamps: dict[str, str] | None = None
) -> ToolResult:
    """Perform the memory write (assumes `gate_memory` passed). Called by the tool when `auto_write`
    is on, and by the Approve-to-apply endpoint on owner approval. A cap/write failure comes back as
    an ERROR result (the caller keeps a pending proposal so the owner can retry/dismiss).

    `stamps` is the turn's prompt-stamp accumulator, forwarded by the tool (the approve path has no
    turn to stamp and passes none) — the cap error's remediation is a registry prompt, so it is
    resolved HERE, at the boundary where the accumulator exists, exactly like
    `memory_proposal_pending` above."""
    mem = deps.memory
    if mem is None:  # gate_memory already guards this on both call paths; re-narrow at this boundary
        return ToolResult(state=RunState.DENIED, summary="memory is not available")
    try:
        summary = await mem.write(agent, inp.target, inp.action, inp.content, inp.old_text)
    except MemoryCapError as exc:
        # §4b-4 (council Codex-12/Opus-M6): the exception stays data-only and the remediation is
        # composed here — the hard cap is the deterministic moment to name the promotion path, so a
        # durable entry gets rescued into tier 2 instead of being dropped to make room.
        return ToolResult(
            state=RunState.ERROR,
            summary="memory over its cap",
            error=resolve(
                "memory_cap_error",
                deps.settings,
                {"details": str(exc), "longterm": _promotion_clause(deps, agent, inp, stamps)},
                stamps=stamps,
            ),
        )
    except MemoryWriteError as exc:
        return ToolResult(state=RunState.ERROR, summary="memory write failed", error=str(exc))
    return ToolResult(state=RunState.OK, summary=summary)


def _promotion_clause(
    deps: "Deps", agent: "AgentDef", inp: MemoryInput, stamps: dict[str, str] | None
) -> str:
    """The `{{longterm}}` value for the cap error: the `consolidation_promote` clause, or "" (§4b-4).

    Two conditions, both required. The store must be PROMOTABLE — `state` is this agent's own mood,
    which belongs in no shared corpus, so it never gets the clause. And the `core_memory` tool must be
    effectively available, or the error would name a tool the model cannot call.

    RECORDED APPROXIMATION: availability is judged at the agent's ALLOWLIST level (`Deps` owns that
    check — §8-4 keeps this module out of the corpus's). Per-turn skill narrowing is not visible at
    this boundary: a skill that temporarily hides `core_memory` would still get the clause. The
    residual is a cosmetic mention of a tool this turn happens not to carry, weighed against the
    alternative of threading turn state into the shared apply path the approve endpoint also calls."""
    if inp.target == "state" or not deps.longterm_available(agent):
        return ""
    # Leading space: the clause is concatenated onto the details sentence, the `state_clause`
    # precedent — so the off-rendering is byte-identical to the error text before tier 2 existed.
    return " " + resolve("consolidation_promote", deps.settings, stamps=stamps)
