"""Agent definitions (DESIGN §5.1, D11). An `AgentDef` is *data* — the configurable shape of one
agent: its system prompt, which inference backend+model it uses, the tool/skill allowlists, its
privilege, and the loop/subagent limits. The **default chat agent** is just one entry in
`settings.agents`; subagents reuse the same definition shape at greater depth (§5.5).

Kept in `domain/` (pure pydantic, no I/O) so both `config.py` (which round-trips `agents[]` from
YAML) and the agent runtime can import it without a layering cycle. `ModelRef` lives here too — it's
a pure pointer reused by `AgentDef.model` *and* `CompactionCfg.summarizer` (the selectable
summarizer, D11).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.domain.enums import Privilege


class ModelRef(BaseModel):
    """A pointer to an inference backend + model name (DESIGN §5.1). Both optional so a consumer can
    inherit the chat backend (`mode=None` → `InferenceCfg.default_mode`) and/or its model
    (`model=None` → the endpoint's configured model). Set one or both to override — used by the
    selectable compaction summarizer and by each `AgentDef.model`."""

    mode: str | None = None      # "local" | "cloud" | None → InferenceCfg.default_mode
    model: str | None = None     # None → the endpoint's configured model id


class CompactionCfg(BaseModel):
    """Context-window compaction (Phase 4e, D10/D11). When the working context (non-compacted
    history) grows past `threshold_tokens`, the oldest complete turns are summarized into a single
    system message and marked `compacted` (kept verbatim in SQLite). `keep_last_messages` is the
    floor of recent messages always kept; the summarizer is independently selectable.

    Lives here (not config.py) so an `AgentDef` can carry a per-agent override without a config↔domain
    import cycle. `Settings.agent.compaction` is the global default; `AgentDef.compaction`, when set,
    wins for that agent (and is inherited by its subagents)."""

    enabled: bool = True
    threshold_tokens: int = 6000     # working-context size that triggers auto-compaction
    keep_last_messages: int = 8      # recent-message floor kept verbatim (snapped to a turn boundary)
    summarizer: ModelRef = Field(default_factory=ModelRef)


class AgentDef(BaseModel):
    """One agent's definition (D11). `tools`/`skills` are allowlists — `"*"` means every
    `agent_exposed` tool / discovered skill, or a list of names/globs to narrow it (a skill may
    narrow further, never widen). `privilege` decides gating: `CONFIRM` (the default) auto-runs
    low-risk tools and confirms med/high; the rest of the ladder lands post-v1 (A1). The limits cap
    the loop and the subagent tree (§5.5). `extra="allow"` so future per-agent knobs round-trip."""

    model_config = {"extra": "allow"}

    name: str
    prompt: str = ""                                    # system prompt; "" → the built-in default
    #: Additive guidance (7e-a). When non-empty, emitted as its own `system` message *after* the
    #: base prompt — so the persona/base stays a stable cache-key candidate and the extra is easy
    #: to attribute when reading logs. The global `inference.system_prompt_append` is emitted too
    #: unless `inherit_append=False`; when both apply, global comes before per-agent.
    prompt_append: str = ""
    #: When False, this agent ignores the global `inference.system_prompt_append`. Default True
    #: mirrors Claude Code's CLAUDE.md model (always added) — flip it for an agent that needs to
    #: escape the global guidance (e.g. a sandboxed/clean-room persona).
    inherit_append: bool = True
    model: ModelRef = Field(default_factory=ModelRef)   # backend+model; inherits chat default when unset
    tools: list[str] | Literal["*"] = "*"               # tool-name allowlist (globs) or all agent tools
    skills: list[str] | Literal["*"] = "*"              # skill allowlist or all discovered skills
    privilege: Privilege = Privilege.CONFIRM
    #: Per-agent context-window override. `None` → inherit `Settings.agent.compaction` (the global
    #: default). A subagent inherits its parent's effective value unless its own def sets this.
    compaction: CompactionCfg | None = None
    max_iterations: int = 16                             # tool-call loop safety cap
    #: Loop-discipline guards (capability layer C1). A weak model can spiral — repeating one tool
    #: or churning many calls without ever answering. `max_repeat_calls` is how many *identical*
    #: (tool, args) calls run before the rest are suppressed with a steering note (2 still allows a
    #: legitimate re-poll, e.g. ping→wake→ping). `max_calls_per_tool` caps how many times *any one
    #: tool* may run in a single turn regardless of args — the catch-all for a model that spams one
    #: tool with varied inputs (raise it for a research-heavy agent). `max_stall_iterations` is how
    #: many consecutive no-progress iterations (no new result, no text) force a final answer.
    max_repeat_calls: int = 2
    max_calls_per_tool: int = 6
    max_stall_iterations: int = 2
    max_subagent_depth: int = 2                          # how deep spawn_subagents may nest
    max_concurrent_subagents: int = 3                    # per-agent fan-out cap (global cap in settings)
