"""core_memory — the agent's window onto the tier-2 long-term corpus (D57, CORE_MEMORY_PLAN §5).

A built-in, agent-only tool (no Utils card, no host button) on the `memory_tool.py` template. Six
actions over one shared markdown corpus: `read`/`search` pull topic content mid-turn (the recall
mechanism — only the bounded INDEX rides the system head, §4), and `create`/`update`/`remove`/
`delete` curate it. Unlike tier 1 this tool DOES read (D57 ruling O3): the tier-1 no-read rule was a
property of a store injected whole, and Claude's shipping shape is index-in-head + on-demand reads.

This file stays thin on purpose — validate → gate → confine → one `CoreMemoryCorpus` call → a framed
`ToolResult`. Every corpus invariant (path confinement, CAS, the secret gate, the crash-tolerant
two-file orderings) lives on the corpus, so the API endpoint that may one day drive the same
operations cannot bypass them.

Gating, in order: the two-layer exposure gate (the session hides the tool from the schema set when
the slot is off — `AgentSession._hidden_tools` — and this file re-checks `enabled()` at invoke, so a
hallucinated or stale-context call is denied rather than run, fit audit C2); then `memory.auto_write`
for the four mutations (council Codex-6 — denied with a steering error naming the switch, never a
silent write); then the per-turn recall budget for the two reads (§4, council Codex-11), which
D60 ② makes their ONLY bound — read-class calls no longer count against `max_calls_per_tool`, so
every one of them charges at least `recall_min_charge_chars` whatever it returns. Every invocation
is audited by `ActionService._record` like any other tool.

LOW risk → auto-runs under the agent's CONFIRM privilege, like `memory`. `core=False` (§5) so an
agent's `tools` allowlist can exclude it.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Literal

from pydantic import BaseModel, Field

from app.core.tool import InvocationContext, action
from app.domain.enums import Risk, RunState
from app.domain.result import ToolResult
from app.services.agent.core_memory import (
    CORE_MEMORY_TOOL,
    CoreHit,
    CoreMemoryCorpus,
    CoreMemoryError,
    CoreRead,
    render_hits,
)
from app.services.agent.prompts import resolve

#: Actions that change the corpus — the set the `memory.auto_write` switch governs.
_MUTATIONS = ("create", "update", "remove", "delete")

#: The READ-CLASS actions (D60 ②). Named here, beside the dispatcher that runs them, because the
#: agent loop asks this file (`is_recall_call`) rather than knowing the corpus's vocabulary itself.
#: Spelled out rather than derived as "not a mutation" so a malformed/unknown action stays inside
#: the blanket per-tool cap — only these two are exempt from it, bounded by the recall budget instead.
_READS = ("read", "search")


class CoreMemoryInput(BaseModel):
    action: Literal["read", "search", "create", "update", "remove", "delete"] = Field(
        description=(
            "`read` one topic by its index path · `search` the whole corpus for a literal phrase · "
            "`create` a new topic · `update`/`remove` an exact passage inside one · `delete` a whole "
            "topic."
        ),
    )
    path: str = Field(
        default="",
        description=(
            "For read/update/remove/delete: the topic's path exactly as the index lists it (e.g. "
            "`wake-ritual.md`)."
        ),
    )
    query: str = Field(
        default="",
        description="For `search`: a literal phrase. Matching is case-insensitive; no wildcards.",
    )
    name: str = Field(
        default="",
        description="For `create`: the topic title. The filename is derived from it.",
    )
    description: str = Field(
        default="",
        description=(
            "For `create`: the one-line hook shown in the index — what this topic answers, so a "
            "later session knows whether to read it."
        ),
    )
    type: Literal["user", "feedback", "project", "reference"] | None = Field(
        default=None,
        description="For `create`: the topic's kind. Optional — omit it when none fits.",
    )
    content: str = Field(
        default="",
        description="For `create`: the topic body (markdown, no frontmatter — that is rendered for you).",
    )
    old_text: str = Field(
        default="",
        description=(
            "For `update`/`remove`: an exact substring of the topic that **identifies exactly one "
            "passage** — copy it verbatim from what you read, and add surrounding text if a short "
            "one would match several."
        ),
    )
    new_text: str = Field(
        default="",
        description="For `update`: the replacement for `old_text`.",
    )
    content_hash: str = Field(
        default="",
        description="For `delete`: the `content_hash` the last `read` of this topic returned.",
    )
    superseded_by: str = Field(
        default="",
        description=(
            "For `delete`: the path of the topic that REPLACES this one. It must already exist — "
            "`create` the merged topic first, then delete the originals. Give this OR `reason`."
        ),
    )
    reason: str = Field(
        default="",
        description=(
            "For `delete`: one line saying why this topic goes away, when nothing replaces it "
            "(e.g. 'the host it documents was decommissioned'). Give this OR `superseded_by`."
        ),
    )


@action(
    CORE_MEMORY_TOOL,
    title="Core Memory",
    description=(
        "Your long-term memory: one shared corpus of topic files every agent reads and writes, "
        "indexed in the block at the top of this conversation. Use it for durable, generally useful "
        "knowledge — the owner's conventions and workflows, stable facts, corrections that should "
        "outlive this session — and keep it lean: no secrets or credentials, nothing you can derive "
        "or look up, no task state or session chatter (that is what your ordinary `memory` is for), "
        "and no step-by-step procedures (skills own those). Store a pointer, not a copy, when the "
        "real source lives somewhere else. `read` a topic the index says is relevant BEFORE you "
        "answer; `search` when the fact you need might sit in a body the hooks don't mention; "
        "`create` a new topic, `update`/`remove` a passage inside one, `delete` a whole topic that is "
        "wrong or obsolete — a `delete` must name the topic that supersedes it (create that one "
        "FIRST) or give a reason, and it archives rather than destroys."
    ),
    icon="library",
    category="builtin",
    risk=Risk.LOW,
    ui_exposed=False,
    core=False,  # §5 — an agent's `tools` allowlist may legitimately exclude the corpus
    # ACA-7: local file IO plus the best-effort D26 commit, which runs two git invocations each bounded
    # by `MemoryGitCfg.commit_timeout_s` (10s by default). 30s is that worst case plus headroom for the
    # scan; it must not be None — the fail-closed deadline policy requires a declared bound (council M2).
    timeout_s=30.0,
)
async def core_memory(inp: CoreMemoryInput, ctx: InvocationContext) -> ToolResult:
    """Read, search and curate your long-term memory — the shared topic corpus indexed at the top of
    this conversation. Read a topic before answering when the index says it is relevant."""
    deps = ctx.require_deps()
    corpus = deps.core_memory
    gated = gate_core_memory(corpus, inp)
    if gated is not None:
        return gated
    assert corpus is not None, "the gate returns on a missing corpus, so it is wired past this point"
    if inp.action in _READS:
        # D60 §15b-3: EVERY read-class call charges the floor, before it runs — a refused `read` or an
        # empty `search` returns no framed output at all, and with reads now outside the per-tool cap
        # a zero-cost failure would loop forever. `_recalled` then charges only what a result costs
        # ABOVE this floor, so a real read still costs exactly its own length.
        spent = _charge(ctx, corpus, corpus.recall_min_charge_chars())
        if spent is not None:
            return spent
    try:
        if inp.action == "read":
            read = corpus.read_topic(inp.path)
            # The NORMALIZED path is what the frame names — never the raw argument the model sent.
            return _recalled(ctx, corpus, read.path, _read_result(read))
        if inp.action == "search":
            hits = corpus.search(inp.query)
            if not hits:
                return ToolResult(state=RunState.OK, summary=f"no core-memory topic matches {inp.query!r}")
            return _recalled(ctx, corpus, f"{len(hits)} topics matching {inp.query!r}", _hits_result(hits))
        if inp.action == "create":
            summary = await corpus.create(inp.name, inp.description, inp.type, inp.content)
        elif inp.action == "update":
            summary = await corpus.update(inp.path, inp.old_text, inp.new_text)
        elif inp.action == "remove":
            summary = await corpus.remove(inp.path, inp.old_text)
        else:
            summary = await corpus.delete(
                inp.path,
                inp.content_hash,
                superseded_by=inp.superseded_by,
                reason=inp.reason,
            )
    except CoreMemoryError as exc:
        return ToolResult(state=RunState.ERROR, summary=f"core memory: {inp.action} refused", error=str(exc))
    except OSError as exc:  # a disk/permission failure is data for the model, not a crashed turn
        return ToolResult(state=RunState.ERROR, summary=f"core memory: {inp.action} failed", error=str(exc))
    return ToolResult(state=RunState.OK, summary=f"core memory: {summary}")


def is_recall_call(tool: str, args: Mapping[str, object]) -> bool:
    """Is this a `core_memory` READ-class call (D60 ②)? The agent loop's per-tool call cap
    (`max_calls_per_tool`) skips these: they are already bounded by `recall_char_limit`, which is the
    honest read budget, and one shared counter for reads AND writes is what made the turn that reads
    unable to write (§14d). Classification lives HERE, next to the action set, so the loop never
    grows a second copy of the corpus's vocabulary. Reads the raw arg map (what the loop has in hand
    before validation), so a missing/odd `action` is simply not read-class — it stays capped."""
    return tool == CORE_MEMORY_TOOL and str(args.get("action") or "") in _READS


def gate_core_memory(corpus: CoreMemoryCorpus | None, inp: CoreMemoryInput) -> ToolResult | None:
    """The invoke-time half of the two-layer gate (fit audit C2) plus the arg checks the model can
    fix. Returns a short-circuit `ToolResult` or `None` to proceed.

    The slot check is deliberately repeated here: the session already drops the tool from the schema
    set when Core Memory is off, but a hallucinated name, a stale transcript or a direct API call must
    be refused rather than run against a corpus the owner has not enabled."""
    if corpus is None or not corpus.enabled():
        return ToolResult(
            state=RunState.ERROR,
            summary="core memory is off",
            error="long-term memory is not enabled — the owner turns it on with "
            "`memory.longterm.backend`. Use your ordinary `memory` tool instead.",
        )
    if inp.action in _MUTATIONS and not corpus.auto_write():
        return ToolResult(
            state=RunState.ERROR,
            summary=f"core memory: {inp.action} denied — auto_write is off",
            error="the owner has `memory.auto_write` off, so you may not change long-term memory. "
            "Reads still work. Tell the owner what you would have saved.",
        )
    missing = _missing_arg(inp)
    if missing:
        return ToolResult(
            state=RunState.ERROR,
            summary=f"core memory: {inp.action} needs {missing}",
            error=f"`{missing}` is required for `{inp.action}`.",
        )
    return None


def _missing_arg(inp: CoreMemoryInput) -> str | None:
    """The first required argument this action didn't get (ERROR data, not an exception)."""
    required: dict[str, tuple[str, ...]] = {
        "read": ("path",),
        "search": ("query",),
        "create": ("name", "description", "content"),
        "update": ("path", "old_text", "new_text"),
        "remove": ("path", "old_text"),
        "delete": ("path", "content_hash"),
    }
    for field in required.get(inp.action, ()):
        if not str(getattr(inp, field, "") or "").strip():
            return field
    return None


def _read_result(read: CoreRead) -> tuple[str, str]:
    """(summary, body) for one topic read. The hash rides the body because it is `delete`'s expected-
    state token, and the truncation note is explicit so the model never treats a clamped topic as
    whole."""
    head = f"{read.path} — content_hash: {read.content_hash}"
    if read.truncated:
        head += f" (truncated: showing {len(read.text):,} of {read.chars:,} characters)"
    return f"read {read.path} ({len(read.text):,} chars)", f"{head}\n\n{read.text}"


def _hits_result(hits: tuple[CoreHit, ...]) -> tuple[str, str]:
    """(summary, body) for a search: each topic's path followed by its matching lines. The rendering
    itself lives on the corpus (`render_hits`) because `search` charges every hit against
    `topic_char_limit` with exactly this arithmetic — a mirrored copy here would drift."""
    return f"searched core memory — {len(hits)} topic(s) matched", render_hits(hits)


def _charge(ctx: InvocationContext, corpus: CoreMemoryCorpus, chars: int) -> ToolResult | None:
    """Add `chars` to the turn's recall budget, or return the steering refusal when that would cross
    `recall_char_limit` (§4, council Codex-11). The ONE place the budget moves — a result that would
    cross the cap is refused rather than trimmed, so the model chooses what else to read instead of
    silently losing half a topic. `None` budget (no session threading it) ⇒ nothing to charge."""
    budget = ctx.recall
    if budget is None or chars <= 0:
        return None
    cap = corpus.recall_char_limit()
    if budget.used + chars > cap:
        return ToolResult(
            state=RunState.ERROR,
            summary="core-memory recall budget spent for this turn",
            error=f"this would put you past the {cap:,}-character recall limit for one turn "
            f"({budget.used:,} already used). Answer with what you have, or read something "
            "shorter — the limit resets next turn.",
        )
    budget.used += chars
    return None


def _recalled(
    ctx: InvocationContext, corpus: CoreMemoryCorpus, source: str, produced: tuple[str, str]
) -> ToolResult:
    """Frame recalled content with the `core_memory_recall` prompt and charge it to the turn's budget.
    The budget counts the COMPLETE framed output — the framing is context the model pays for too —
    minus the floor the call already paid up-front (D60 §15b-3), so the total charged for a real
    result is exactly its own length.

    The frame is resolved before the check, so a refused read still records the prompt's stamp: the
    same benign over-report the ephemeral reflection nudge already has (`AgentSession._stamps`)."""
    summary, body = produced
    output = resolve("core_memory_recall", corpus.settings, {"source": source}, stamps=ctx.stamps)
    output = f"{output}\n\n{body}"
    refused = _charge(ctx, corpus, len(output) - corpus.recall_min_charge_chars())
    if refused is not None:
        return refused
    return ToolResult(state=RunState.OK, summary=summary, output=output)
