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

`delete` gets one more gate, and it is this file's alone (D64 §2.3): the turn's own `RecallState`
must show the WHOLE topic was read, under the hash it still has. Authority to destroy is minted
from complete reads and enforced by the server's records — the model carries no token of any kind,
which is the failure surface the 2026-08-21 incident proved. The corpus keeps its stateless
`delete(path, expected_hash, …)` precondition underneath, so a non-agent caller that obtained a
hash itself is still served and the D60 crash-retry branch is untouched.

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
    CoreMemoryCorpus,
    CoreMemoryError,
    CoreRead,
    CoreSearch,
    render_hits,
    topic_path,
)
from app.services.agent.prompts import resolve

#: Actions that change the corpus — the set the `memory.auto_write` switch governs.
_MUTATIONS = ("create", "update", "remove", "delete")

#: The `ToolResult.data` key one accepted `read` page leaves its coverage receipt under (D64 §2.2).
#: Opaque and never model-facing; `AgentSession._seed_recall` consumes it to rebuild this turn's
#: coverage after a suspend/resume. Defined here, on the only writer, so the reader imports the name
#: rather than re-spelling the string.
RECALL_RECEIPT = "recall_read"

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
    offset: int = Field(
        default=1,
        ge=1,
        description=(
            "For `read`: the 1-based line to start the page at. Default 1. A page that does not "
            "reach the end of the topic says so and names the offset to continue at."
        ),
    )
    limit: int | None = Field(
        default=None,
        ge=1,
        description=(
            "For `read`: at most this many lines. Optional — a page always stops at the topic "
            "character cap anyway, so leave it out unless you want a smaller peek."
        ),
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
        "FIRST) or give a reason, it archives rather than destroys, and it is allowed only once you "
        "have read the whole topic in this turn (page through it with `offset` if it takes more than "
        "one read)."
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
            read = corpus.read_topic(inp.path, inp.offset, inp.limit)
            # The NORMALIZED path is what the frame names — never the raw argument the model sent.
            return _recalled(ctx, corpus, read.path, _read_result(read), read=read)
        if inp.action == "search":
            found = corpus.search(inp.query)
            # Omitted-but-not-shown is NOT "no matches" (D61 ⑤): only an empty search says that.
            matched = len(found.hits) + found.omitted
            if not matched:
                return ToolResult(state=RunState.OK, summary=f"no core-memory topic matches {inp.query!r}")
            produced = _hits_result(found, corpus.topic_char_limit())
            return _recalled(ctx, corpus, f"{matched} topics matching {inp.query!r}", produced)
        if inp.action == "create":
            summary = await corpus.create(inp.name, inp.description, inp.type, inp.content)
        elif inp.action == "update":
            summary = await corpus.update(inp.path, inp.old_text, inp.new_text)
        elif inp.action == "remove":
            summary = await corpus.remove(inp.path, inp.old_text)
        else:
            summary = await corpus.delete(
                inp.path,
                _delete_gate(ctx, corpus, inp.path),
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
        "delete": ("path",),
    }
    for field in required.get(inp.action, ()):
        if not str(getattr(inp, field, "") or "").strip():
            return field
    return None


def _read_result(read: CoreRead) -> tuple[str, str]:
    """(summary, body) for one page (D64 §2.1). A page that carried the whole topic gets a plain
    head — its own path, nothing else. Any other page is marked PARTIAL and states the FACTS: which
    lines of how many, how many characters of how many, and the exact call that continues it.

    Facts only, deliberately: no per-page restatement of the "don't merge from a fragment" rule. The
    incident model read the old truncation note and merged anyway — prose that does not work is
    prose the recall budget pays for every page. The rule is a rail now (`_delete_gate`) and a
    consolidation-prompt clause, which is where behaviour actually comes from."""
    span = f"lines {read.first_line:,}-{read.last_line:,} of {read.lines:,}"
    if read.complete:
        return f"read {read.path} ({len(read.text):,} chars)", f"{read.path}\n\n{read.text}"
    head = f"{read.path} (PARTIAL: {span} — {len(read.text):,} of {read.chars:,} chars)"
    if read.last_line < read.lines:
        head += f" · continue: read offset={read.last_line + 1}"
    return f"read {read.path} {span} ({len(read.text):,} chars)", f"{head}\n\n{read.text}"


def _hits_result(found: CoreSearch, cap: int) -> tuple[str, str]:
    """(summary, body) for a search: each topic's path followed by its matching lines, then the
    omission note when the cap cost the search a match. The rendering itself lives on the corpus
    (`render_hits`, which also owns the final hard clamp to `cap`) because `search` charges every hit
    against `topic_char_limit` with exactly this arithmetic — a mirrored copy here would drift."""
    shown = f"searched core memory — {len(found.hits)} topic(s) shown"
    tail = f", {found.omitted} not shown" if found.omitted else ""
    return shown + tail, render_hits(found, cap)


def _delete_gate(ctx: InvocationContext, corpus: CoreMemoryCorpus, raw_path: str) -> str:
    """The model-facing door's delete guard (D64 §2.3): the expected-state hash `corpus.delete` will
    re-check under its lock, or a steering `CoreMemoryError` naming the one call that fixes this.

    The authority to destroy is MINTED FROM READS and held by the server: the model sends no token,
    and this asks the turn's own record whether it was shown the whole topic. Order matters —
    freshness before coverage, because coverage of a file that has since changed is not coverage of
    anything, and telling the model to "read 40 more lines" of a rewritten topic would be steering
    it into the wrong action.

    Two deliberate pass-throughs, both to the corpus which owns the case: a path that cannot name a
    topic (its refusal is the canonical one), and a topic with NO live file — the D60 crash-retry
    shape, where the topic is already archived and only its index line remains. `_delete_blocking`
    re-checks the hash under the lock whenever a file IS there, so nothing here is load-bearing
    twice.

    Below full coverage the refusal SPLITS, and the split is the whole point: "continue at offset N"
    is only true steering when the turn can actually get there. A topic the budget cannot cover goes
    to the OWNER instead (review round, reproduced), and that branch is checked BEFORE "you have not
    read this" — an unreachable topic whose first page was already budget-refused has no coverage at
    all, so ordering it the other way made the owner branch unreachable exactly where it matters."""
    if ctx.recall is None:
        # Fail closed. Reachable only outside an agent turn (a direct API invoke, a test): nothing
        # recorded what was read, so nothing can authorize destroying it. The corpus's own
        # `delete(path, expected_hash, …)` stays available to a caller that obtained a hash itself.
        raise CoreMemoryError(
            "a `delete` is only available inside an agent turn, where the server can verify the "
            "whole topic was read first — this call carries no read state, so it is refused."
        )
    rel = topic_path(raw_path)
    if rel is None:
        return ""
    live = corpus.current_hash(raw_path)  # ONE look at the file — two would compare two moments
    if live is None:
        return ""
    covered = ctx.recall.reads.get(rel)
    if covered is not None and live != covered.hash:
        ctx.recall.reads.pop(rel, None)  # what was read describes a topic that no longer exists
        raise CoreMemoryError(
            f"{rel} has changed since you read it — read it again (offset=1) before deleting it."
        )
    if covered is not None and covered.complete:
        return covered.hash
    # Not covered, or not covered fully. Is finishing the read even POSSIBLE in this turn?
    cap = corpus.recall_char_limit()
    chars = corpus.topic_chars(rel)
    if _framed_cost(corpus, rel, chars) > cap:
        raise CoreMemoryError(
            f"{rel} is {chars:,} characters — with per-page framing it cannot fit one turn's "
            f"{cap:,}-character recall budget, so it can never be read in full here. Curating a "
            "topic that size is an owner/file operation: report it to the owner instead."
        )
    if covered is None:
        raise CoreMemoryError(f"you have not read {rel} this turn — `read` it (offset=1) before deleting it.")
    raise CoreMemoryError(
        f"you have read lines 1-{covered.seen:,} of {covered.total_lines:,} of {rel} this turn "
        f"— continue: read offset={covered.seen + 1}. A topic must be read in full before it "
        "can be deleted."
    )


def _framed_cost(corpus: CoreMemoryCorpus, rel: str, chars: int) -> int:
    """A CONSERVATIVE estimate of what reading all of `rel` would charge the recall budget — the
    classifier that tells "keep paging" from "no turn can read this" (review round MED).

    Raw length was the wrong yardstick: the budget charges the FRAMED page, so a 23K topic under a
    24,576 cap stops mid-way with the next page budget-refused, and the delete refusal kept saying
    "continue at offset N" for an offset the turn could never afford. Content + `ceil(chars / page)`
    frames is the honest floor of the real cost.

    The per-page frame is MEASURED, never a literal: the live `core_memory_recall` text (an owner
    edit changes it) plus a worst-case PARTIAL marker rendered by `_read_result` itself — the very
    function the real page uses, so the two cannot drift. Worst-case = the widest numbers this topic
    could ever print: a full page against the topic's own length, and line numbers standing in at
    `chars` (a line is at least one character, so the count can never exceed it). That rounding is
    deliberately UPWARD — steering a borderline topic to the owner costs one honest report, while
    under-estimating costs an endless continue-grind.

    KNOWN FLOOR (recorded, not engineered away): `ceil(chars / page)` is the page count of a file
    that packs perfectly, and pages break at LINE boundaries — a topic of long paragraph lines needs
    more pages than that, so near the cap it can still be judged reachable when it is not. Counting
    real pages would mean re-reading, at delete time, a file the scan has already read."""
    page = corpus.topic_char_limit()
    lines = max(chars, 2)
    marker = CoreRead(
        path=rel,
        text="x" * page,  # a full page → the widest "N of M chars" the head can print
        content_hash="",
        chars=chars,
        lines=lines,
        first_line=lines - 1,  # not line 1 and not the last line ⇒ PARTIAL, with its continuation
        last_line=lines - 1,
    )
    _summary, body = _read_result(marker)
    frame = resolve("core_memory_recall", corpus.settings, {"source": rel})
    # `_recalled` builds `frame + "\n\n" + body`, and `body` is `head + "\n\n" + text` — so the
    # overhead one page adds beyond its own content is everything here except that page's text.
    overhead = len(frame) + 2 + len(body) - page
    return chars + -(-chars // page) * overhead


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
    ctx: InvocationContext,
    corpus: CoreMemoryCorpus,
    source: str,
    produced: tuple[str, str],
    read: CoreRead | None = None,
) -> ToolResult:
    """Frame recalled content with the `core_memory_recall` prompt and charge it to the turn's budget.
    The budget counts the COMPLETE framed output — the framing is context the model pays for too —
    minus the floor the call already paid up-front (D60 §15b-3), so the total charged for a real
    result is exactly its own length.

    The frame is resolved before the check, so a refused read still records the prompt's stamp: the
    same benign over-report the ephemeral reflection nudge already has (`AgentSession._stamps`).

    **Budget acceptance is the MINT POINT** (D64 §2.2): a page whose charge was refused never
    reached the model, so it banks no coverage. Past the charge, the accepted page advances this
    path's high-water mark and leaves an opaque receipt in `ToolResult.data` — persisted verbatim
    with the result, never model-facing (`_tool_content` reads summary/output/error), so a
    suspend/resume can rebuild the same coverage without re-reading anything."""
    summary, body = produced
    output = resolve("core_memory_recall", corpus.settings, {"source": source}, stamps=ctx.stamps)
    output = f"{output}\n\n{body}"
    refused = _charge(ctx, corpus, len(output) - corpus.recall_min_charge_chars())
    if refused is not None:
        return refused
    data: dict[str, object] = {}
    if read is not None and ctx.recall is not None:
        banked = ctx.recall.bank(read.path, read.content_hash, read.lines, read.first_line, read.last_line)
        data[RECALL_RECEIPT] = {
            "path": read.path,
            "hash": banked.hash,
            "total_lines": banked.total_lines,
            "seen": banked.seen,
        }
    return ToolResult(state=RunState.OK, summary=summary, output=output, data=data)
