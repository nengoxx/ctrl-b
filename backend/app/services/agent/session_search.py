"""session_search — recall past conversations (7e-e, Hermes Tier 2, D15 #7).

A built-in, agent-only tool (no Utils card, no host button): the model calls it to find something
from an earlier session — a decision, a value, a thing the owner said — that isn't in the current
thread's working context. It runs the FTS5 index over message text (migration 3) through
`MessageRepo.search`, **global across all (non-archived) threads** (sessions stay agent-agnostic in
`ctrlb.db`, D14), and returns ranked excerpts. The order is the security property (SECURITY_MODEL
§2.4, ISS-118): the index holds RAW text, so each hit's WHOLE message text is **redacted** against
the live config secrets FIRST, and only then is the excerpt cut and its matches marked, in Python
(`_excerpt`). A cut, an edge `…` or a `«»` mark can therefore never split a secret into pieces
`redact` no longer recognises — which FTS5's `snippet()`, cutting before redaction, did. The raw
text never leaves this module (popped from each hit). `ActionService._record` masks the whole result
once more (the egress funnel) — defense-in-depth, the same `core.redact`. Read-only → LOW risk,
auto-runs under CONFIRM (no confirm gate), like `web_search`.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.core.redact import redact
from app.core.tool import InvocationContext, action
from app.domain.enums import Risk, RunState
from app.domain.result import ToolResult
from app.services.conversation import fts_tokens

#: Excerpt shape (module constants like `core_memory._EXCERPT_CHARS`: they shape one hit's excerpt,
#: they are not deployment knobs). `_EXCERPT_WORDS` = the window FTS5 `snippet()` used to cut;
#: `_EXCERPT_CHARS` caps a window of a few very long words (the dev DB's longest 12-word window: 252).
_EXCERPT_WORDS = 12
_EXCERPT_CHARS = 300


class SessionSearchInput(BaseModel):
    query: str = Field(
        ...,
        description="What to recall from past conversations — keywords or a short phrase. Matches the "
        "text of past user/assistant messages (all words must appear).",
    )
    limit: int = Field(5, ge=1, le=20, description="Maximum number of past messages to return (1-20).")


def _excerpt(masked: str, terms: set[str]) -> str:
    """The `_EXCERPT_WORDS`-word window of ALREADY-REDACTED text holding the most distinct query
    `terms` (earliest on a tie; no match → the head) — `snippet()`'s choice, cut on whitespace so a
    cut never lands inside a mask. A word matches when one of its `fts_tokens` equals a term (a match
    inside a secret is now `••••`, which has no token, so it can neither anchor nor be marked). `…`
    marks a cut edge, `«»` a matched word; a window still over `_EXCERPT_CHARS` is sliced plainly +
    `…` (not `clip`: its marker holds a newline that would break `_format`'s one-line list; the text is
    already masked, so a plain slice discloses nothing)."""
    words = masked.split()
    matched = [{t for t in fts_tokens(w) if t in terms} for w in words]
    start, best = 0, 0
    for i in range(max(1, len(words) - _EXCERPT_WORDS + 1)):
        n = len(set().union(*matched[i : i + _EXCERPT_WORDS]))
        if n > best:
            start, best = i, n
    end = start + _EXCERPT_WORDS
    window = [f"«{w}»" if matched[start + j] else w for j, w in enumerate(words[start:end])]
    excerpt = ("…" if start > 0 else "") + " ".join(window) + ("…" if end < len(words) else "")
    return excerpt if len(excerpt) <= _EXCERPT_CHARS else excerpt[:_EXCERPT_CHARS] + "…"


def _format(hits: list[dict[str, Any]]) -> str:
    """Render hits as a compact numbered list the model reads — when, thread, who, snippet. `who` is
    the agent only for an assistant row: a user row is the owner's own words, whichever agent's
    thread it sits in (`messages.agent` is NULL on user rows, so the thread's agent used to show)."""
    lines: list[str] = []
    for i, h in enumerate(hits, 1):
        when = (h.get("ts") or "")[:10]
        title = h.get("thread_title") or "(untitled)"
        if h.get("role") == "assistant":
            who = h.get("agent") or h.get("thread_agent") or "assistant"
        else:
            who = "owner"
        lines.append(f"{i}. [{when}] {title} · {who}: {h.get('snippet') or ''}")
    return "\n".join(lines)


@action(
    "session_search",
    title="Search sessions",
    description=(
        "Search your past conversations (across all sessions) for something you discussed before but "
        "that isn't in the current thread — a past decision, a value the owner gave you, an earlier "
        "request. Returns the best-matching messages with a snippet. Use it to recall context instead "
        "of asking the owner to repeat themselves; this searches history only, it takes no action."
    ),
    icon="history",
    category="builtin",
    risk=Risk.LOW,
    read_only=True,  # searches history only, takes no action → retry-safe
    ui_exposed=False,
    core=True,  # cognitive builtin — always reachable regardless of an agent's tools allowlist
)
async def session_search(inp: SessionSearchInput, ctx: InvocationContext) -> ToolResult:
    """Search your past conversations (all sessions) for something discussed earlier that isn't in the
    current thread. Returns ranked message snippets; history-only, takes no action."""
    deps = ctx.deps
    if deps is None or deps.messages is None:
        return ToolResult(state=RunState.DENIED, summary="session search is not available")

    hits = await deps.messages.search(inp.query, limit=inp.limit)
    secrets = deps.settings.secret_values() if deps.settings else []
    terms = set(fts_tokens(inp.query))
    for h in hits:
        # Redact the WHOLE row, THEN cut (ISS-118); `pop` keeps the raw text out of `data`.
        h["snippet"] = _excerpt(redact(h.pop("text"), secrets) or "", terms)

    data = {"query": inp.query, "results": hits}
    if not hits:
        return ToolResult(state=RunState.OK, summary=f"No past sessions matched '{inp.query}'.", data=data)
    return ToolResult(
        state=RunState.OK,
        summary=f"{len(hits)} past message(s) matched '{inp.query}'.",
        data=data,
        output=_format(hits),
    )
