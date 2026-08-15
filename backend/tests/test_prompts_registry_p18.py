"""Phase 18 Slice 1 — the prompt registry (`services/agent/prompts.py`) and `resolve()`.

Two halves, both gates from PROMPTS_PLAN:

1. **The migration goldens (§6 C-16).** Every one of the 15 registered prompts must render, under a
   pinned context, to EXACTLY the text the pre-migration code produced. The expected strings below
   were lifted from the pre-migration sources by AST (not retyped), so this file is an independent
   copy of what the model used to see: if a default is ever edited by accident, this fails. For the
   three frame+data prompts (`memory_intro`, `fleet_roster`, `skills_note`) the frame golden is
   joined by an assembly golden, because those migrations also moved a separator into code.
2. **The resolution contract (§6 C-3 as amended by §7 L-5/L-6).** override replaces, append
   concatenates and renders in the same pass, blank is unset, an unknown `{{token}}` stays literal,
   a render failure falls back to the baked default with ONE warning, an unknown id is a `KeyError`.

No test here touches the real config.yaml — `Settings(...)` is constructed in-memory, and the memory
fixture runs in its own `$CTRLB_HOME`.
"""

from __future__ import annotations

import contextlib
import logging
import os
import tempfile
from pathlib import Path

import pytest

from app.config import ComputerCfg, PromptOverride, ServiceCfg, Settings
from app.services.agent.prompts import REGISTRY, placeholders, resolve, resolve_with_template

# ── the pre-migration texts, and the context each site supplied ─────────────────────────────────

_STATE_CLAUSE = " Also update your `state` (action `set`) if how you feel has shifted."
_SECTION_BLOCK = (
    "## Goals & Requests\n"
    "## Key Facts & State\n"
    "## Actions Taken & Outcomes\n"
    "## Rules & Constraints\n"
    "## Next Steps\n"
)

#: {id: (ctx, the exact text the pre-migration code produced under that ctx)}. Registry order.
_GOLDEN: dict[str, tuple[dict[str, str], str]] = {
    "memory_intro": (
        {},
        "Context you carry across sessions — treat it as known and current. The percentages show "
        "how full each store is against its character cap.",
    ),
    "consolidation_nudge": (
        {"pressured": "Agent memory (91%), User profile (84%)"},
        "Consolidate before adding more — Agent memory (91%), User profile (84%). Merge overlapping "
        "entries with `replace`, drop stale ones with `remove`, and reconcile anything that "
        "contradicts what you just learned.",
    ),
    "fleet_roster": ({}, "Fleet roster - use the `id` as the tool argument (host_id / service_id):"),
    "skills_note": ({}, "The following skill instructions apply to this task — follow them:"),
    "wrapup_nudge": (
        {},
        "You have done enough tool work for this request. Do NOT call any more tools. Give the owner "
        "your final answer now. Be honest: summarize only what you actually accomplished via the "
        "tool results above, and clearly state what you could NOT do. Do not claim a step or plan "
        "succeeded if its tool was never run or returned an error.",
    ),
    "question_declined": (
        {},
        "The owner chose not to answer this question. Do not re-ask it or rephrase it. Proceed using "
        "your best judgment, or give the owner your final answer.",
    ),
    "rejection_notice": (
        {},
        "The owner reviewed this tool call and REJECTED it. It was NOT run — nothing happened. This "
        "is the owner's deliberate decision, not an error: do not retry this call, and do not attempt "
        "the same action any other way. If the rest of your task doesn't depend on it, continue "
        "without it; otherwise stop and give the owner your final answer.",
    ),
    "denial_echo": (
        {},
        "The owner already rejected this exact call this turn. It was NOT run. Do not ask again — "
        "continue without it or give the owner your final answer.",
    ),
    "repeat_suppressed": (
        {},
        "You already ran this exact call. Do not repeat it — use the previous result, try a different "
        "approach, or give your final answer.",
    ),
    "per_tool_cap": (
        {"tool": "ping_host", "count": "7"},
        "You have already called ping_host 7 times this turn. Stop calling it — use what you have, "
        "switch to a different tool, or give the owner your final answer now.",
    ),
    "unattended_answer": (
        {},
        "No owner is available to answer this — proceed on your best judgement and state the "
        "assumption you made in your final answer.",
    ),
    "reflection_nudge": (
        {"reflection_interval": "8", "state_clause": _STATE_CLAUSE},
        "It's been 8 turns — pause and review the recent conversation. If anything is durably worth "
        "remembering (a lasting fact, preference, or decision), save it with the `memory` tool."
        + _STATE_CLAUSE
        + " If there's nothing worth keeping, just continue — don't invent things to store.",
    ),
    "summarizer": (
        {"sections": _SECTION_BLOCK, "focus": ""},
        "You compress the earlier part of a conversation between a user and an assistant that "
        "controls a single-user homelab (waking/monitoring/managing PCs and services). Rewrite the "
        "earlier messages as a STRUCTURED summary that later turns can rely on. Output EXACTLY these "
        "five sections, each a markdown heading followed by terse bullet points; if a section has "
        "nothing, write 'none' under it:\n"
        + _SECTION_BLOCK
        + "Fill EVERY section. 'Next Steps' and anything you mark still pending refer ONLY to the "
        "earlier messages shown to you here (the folded-away head) — do NOT speculate about messages "
        "you cannot see. Preserve every load-bearing detail (ids, names, decisions, errors) and omit "
        "pleasantries. This summary REPLACES the earlier messages in the assistant's working context.",
    ),
    "m1_tool_blocked": (
        {"tool": "run_shell"},
        "The tool `run_shell` is not available to you in this conversation — it was NOT run and "
        "nothing happened. This is a capability boundary, not a transient failure: do not call it "
        "again and do not try to reach it another way. Use one of the tools you were given, or give "
        "the owner your final answer.",
    ),
    "m3_batch_rejected": (
        {"count": "5", "max": "3"},
        "You asked for 5 subagents at once, but this agent may fan out to at most 3. Nothing was "
        "spawned. Send a batch of 3 or fewer — split the work into rounds and delegate the next round "
        "after this one returns, or do the extra tasks yourself.",
    ),
}


# ── 1. the registry table (C-1) ─────────────────────────────────────────────────────────────────


def test_registry_holds_exactly_the_c1_ids_in_table_order() -> None:
    """The C-1 table is normative for ids AND order (the Conf list renders in registry order)."""
    assert list(REGISTRY) == list(_GOLDEN)


@pytest.mark.parametrize("prompt_id", list(_GOLDEN))
def test_prompt_renders_the_pre_migration_text(prompt_id: str) -> None:
    ctx, expected = _GOLDEN[prompt_id]
    assert resolve(prompt_id, Settings(), ctx) == expected


def test_every_default_renders_with_no_token_left_over() -> None:
    """L-6's one shape rule: each default, under the context its call site supplies, leaves no
    unresolved `{{token}}` — i.e. every derived placeholder is actually fed. (Extra context keys are
    harmless by construction, so there is no both-directions matrix.)"""
    for prompt_id, (ctx, _expected) in _GOLDEN.items():
        rendered = resolve(prompt_id, Settings(), ctx)
        # `placeholders()`, not a `{{` substring: a literal brace pair that isn't a token is legal
        # text (a JSON example), and L-6's rule is about TOKENS.
        assert not placeholders(rendered), f"{prompt_id} left a token unrendered: {rendered!r}"
        assert set(placeholders(REGISTRY[prompt_id].default)) <= set(ctx)


def test_steering_prompts_carry_a_coupling_warning() -> None:
    """The C2 nudges + the two guard denials are editable, so their descriptions must say what they
    are coupled to (§2.4 — one of the three containments for the aider-style coupling risk)."""
    coupled = (
        "wrapup_nudge",
        "question_declined",
        "rejection_notice",
        "denial_echo",
        "repeat_suppressed",
        "per_tool_cap",
        "unattended_answer",
        "reflection_nudge",
        "m1_tool_blocked",
        "m3_batch_rejected",
    )
    for prompt_id in coupled:
        description = REGISTRY[prompt_id].description or ""
        assert "Coupling:" in description, f"{prompt_id} has no coupling warning"


# ── 2. the assembly goldens (the frame+data three) ──────────────────────────────────────────────


def test_skills_note_assembly_is_byte_identical() -> None:
    from app.core.skills import Skill
    from app.services.agent.skills import skills_prompt

    active = [
        Skill(name="deploy", description="d", instructions="Deploy carefully."),
        Skill(name="triage", description="t", instructions="Triage first."),
    ]
    assert skills_prompt(active, Settings()) == (
        _GOLDEN["skills_note"][1]
        + "\n\n## Skill: deploy\nDeploy carefully.\n\n## Skill: triage\nTriage first."
    )


def test_fleet_roster_assembly_is_byte_identical() -> None:
    from app.services.agent.session import AgentSession

    settings = Settings(
        computers={
            "Corsair": ComputerCfg(
                ip="10.0.0.5",
                os_type="windows",
                role="desktop",
                services={"Plex": ServiceCfg(kind="systemd", port=32400)},
            )
        }
    )
    # `_roster` is a pure projection of Settings — the same bare-session probe
    # `test_context_cache_aca18_21` uses for `_log_context_cost`, no DB/registry/model needed.
    session = AgentSession.__new__(AgentSession)
    session._settings = settings
    session._stamps = {}  # the per-turn stamp accumulator `resolve()` records into (Slice 2)
    assert session._roster() == (
        _GOLDEN["fleet_roster"][1]
        + "\nHosts:\n- Corsair (windows, desktop) -> host_id: corsair"
        + "\nServices:\n- Plex on corsair -> service_id: corsair.plex"
    )


@contextlib.contextmanager
def _memory_workspace(config_text: str):
    """An isolated `$CTRLB_HOME` + config (the `test_memory_registry_d27` pattern) — the real
    config.yaml/db are never touched."""
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


def test_memory_block_assembly_is_byte_identical() -> None:
    """Intro + sections + the consolidation nudge, straight off `load_context` — the whole composed
    block, so both the frame text AND the separators the migration moved into code are pinned."""
    from app.config import load_settings
    from app.services.agent.memory import FileMemoryProvider

    config = (
        "server:\n  port: 5433\n"
        "memory:\n"
        "  enabled: true\n"
        "  user_profile_enabled: false\n"
        "  consolidation_nudge: true\n"
        "  consolidation_nudge_pct: 10\n"
        "  memory_char_limit: 100\n"
    )
    with _memory_workspace(config) as home:
        body = "m" * 50
        (home / "memories").mkdir(parents=True, exist_ok=True)
        (home / "memories" / "MEMORY.md").write_text(body, encoding="utf-8")
        settings = load_settings()
        provider = FileMemoryProvider(settings)
        block = provider.load_context(settings.resolve_agent(None))

    assert block == (
        _GOLDEN["memory_intro"][1]
        + f"\n\n## Agent memory (50% — 50/100)\n{body}"
        + "\n\nConsolidate before adding more — Agent memory (50%). Merge overlapping entries with "
        "`replace`, drop stale ones with `remove`, and reconcile anything that contradicts what you "
        "just learned."
    )


# ── 3. the resolution contract (C-3 as amended by L-5/L-6) ──────────────────────────────────────


def _settings_with(prompt_id: str, **fields: str | None) -> Settings:
    return Settings(prompts={prompt_id: PromptOverride(**fields)})


def test_override_replaces_the_default() -> None:
    settings = _settings_with("wrapup_nudge", override="Wrap it up.")
    assert resolve("wrapup_nudge", settings) == "Wrap it up."


def test_append_rides_the_default_with_a_blank_line() -> None:
    settings = _settings_with("wrapup_nudge", append="And keep it short.")
    assert resolve("wrapup_nudge", settings) == (_GOLDEN["wrapup_nudge"][1] + "\n\nAnd keep it short.")


def test_override_and_append_concatenate_in_that_order() -> None:
    settings = _settings_with("wrapup_nudge", override="Wrap it up.", append="Briefly.")
    assert resolve("wrapup_nudge", settings) == "Wrap it up.\n\nBriefly."


def test_the_append_renders_in_the_same_pass_as_the_base() -> None:
    """One `safe_substitute` over the concatenation — a placeholder in the append gets the same
    context the base did, so the owner can reuse `{{tool}}` in their extra instruction."""
    settings = _settings_with("per_tool_cap", append="Seriously: stop calling {{tool}}.")
    assert resolve("per_tool_cap", settings, {"tool": "ping_host", "count": "7"}) == (
        _GOLDEN["per_tool_cap"][1] + "\n\nSeriously: stop calling ping_host."
    )


def test_blank_fields_are_unset_everywhere() -> None:
    """L-5: blank is unset, not 'intentional emptiness' — restoring a prompt is deleting its entry."""
    for fields in ({"override": ""}, {"append": ""}, {"override": "", "append": ""}):
        settings = _settings_with("wrapup_nudge", **fields)
        assert resolve("wrapup_nudge", settings) == _GOLDEN["wrapup_nudge"][1], fields
    assert resolve("wrapup_nudge", Settings()) == _GOLDEN["wrapup_nudge"][1]  # no entry at all


def test_an_unknown_placeholder_in_an_override_stays_literal() -> None:
    """Ruled: a typo is visible to the owner, never silently blanked and never a failed turn."""
    settings = _settings_with("per_tool_cap", override="Stop calling {{toool}} ({{count}}).")
    assert resolve("per_tool_cap", settings, {"tool": "ping_host", "count": "7"}) == (
        "Stop calling {{toool}} (7)."
    )


def test_a_render_failure_falls_back_to_the_default_with_one_warning(caplog) -> None:
    """Infallible (§2.1): a use site always receives a usable `str`, and the fallback is the BAKED
    default — never a shorter improvised literal at the call site."""

    class _ExplodingCtx(dict[str, str]):
        def __getitem__(self, key: str) -> str:
            if key == "boom":
                raise RuntimeError("render exploded")
            return super().__getitem__(key)

    settings = _settings_with("m1_tool_blocked", override="{{boom}}")
    ctx = _ExplodingCtx({"tool": "run_shell", "boom": "x"})
    with caplog.at_level(logging.WARNING, logger="app.services.agent.prompts"):
        rendered = resolve("m1_tool_blocked", settings, ctx)
    assert rendered == _GOLDEN["m1_tool_blocked"][1]
    assert len(caplog.records) == 1 and "m1_tool_blocked" in caplog.records[0].getMessage()


def test_an_unknown_registry_id_raises() -> None:
    """A programmer error, never an owner-input path — owner text only ever reaches `settings`."""
    with pytest.raises(KeyError):
        resolve("no_such_prompt", Settings())


def test_an_unknown_config_id_is_ignored_not_fatal() -> None:
    """A hand-edited config.yaml naming a prompt this build doesn't have must still load and run."""
    settings = Settings(prompts={"from_the_future": PromptOverride(override="…")})
    assert resolve("wrapup_nudge", settings) == _GOLDEN["wrapup_nudge"][1]


def test_resolution_is_live_per_call() -> None:
    """C-17: no cache anywhere, so an edit to the shared Settings applies from the next resolve."""
    settings = Settings()
    assert resolve("denial_echo", settings) == _GOLDEN["denial_echo"][1]
    settings.prompts["denial_echo"] = PromptOverride(override="No.")
    assert resolve("denial_echo", settings) == "No."


def test_a_failing_default_falls_back_to_the_raw_text(caplog) -> None:
    """The last resort: even the BAKED default's render can be defeated by a context that raises on
    a key the default itself declares. The use site still gets a `str` — the unsubstituted default."""

    class _ExplodingCtx(dict[str, str]):
        def __getitem__(self, key: str) -> str:
            raise RuntimeError("render exploded")

    with caplog.at_level(logging.WARNING, logger="app.services.agent.prompts"):
        rendered = resolve("m1_tool_blocked", Settings(), _ExplodingCtx({"tool": "run_shell"}))
    assert rendered == REGISTRY["m1_tool_blocked"].default  # raw, `{{tool}}` still in it
    assert len(caplog.records) == 1


# ── 4. the template seam Slice 2 stamps from (C-8) ──────────────────────────────────────────────


def test_resolve_returns_the_effective_template_beside_the_rendering() -> None:
    """The pair is atomic on purpose: a later `Settings` read can be a DIFFERENT template (a mid-turn
    edit is live by design), so the template must come back with the text it produced."""
    default = REGISTRY["wrapup_nudge"].default

    rendered, template = resolve_with_template("wrapup_nudge", Settings())
    assert (rendered, template) == (_GOLDEN["wrapup_nudge"][1], default)

    rendered, template = resolve_with_template(
        "wrapup_nudge", _settings_with("wrapup_nudge", override="Wrap up.")
    )
    assert (rendered, template) == ("Wrap up.", "Wrap up.")

    settings = _settings_with("wrapup_nudge", append="Briefly.")
    _rendered, template = resolve_with_template("wrapup_nudge", settings)
    assert template == default + "\n\nBriefly."  # pre-substitution, override+append concatenated

    # …and a template carrying placeholders comes back UNRENDERED — the hash identifies the template.
    _rendered, template = resolve_with_template("per_tool_cap", Settings(), {"tool": "x", "count": "1"})
    assert template == REGISTRY["per_tool_cap"].default and "{{tool}}" in template


# ── 5. the renderer's edges ─────────────────────────────────────────────────────────────────────


def test_renderer_edges() -> None:
    """`{{name}}` and nothing else: single braces (prompts quote JSON), a non-identifier after `{{`,
    a dangling delimiter, and `$` are all inert; adjacent tokens both resolve; and substitution is
    ONE pass, so a value that itself looks like a token is not re-rendered."""

    def render(text: str, **ctx: str) -> str:
        return resolve("wrapup_nudge", _settings_with("wrapup_nudge", override=text), ctx)

    assert render('{"a": 1, "b": {"c": 2}}') == '{"a": 1, "b": {"c": 2}}'  # JSON survives untouched
    assert render('{{"key": 1}}') == '{{"key": 1}}'  # `{{` not followed by an identifier
    assert render("{{9x}}") == "{{9x}}"  # identifiers don't start with a digit
    assert render("ends with {{") == "ends with {{"  # dangling delimiter
    assert render("{{a}}{{b}}", a="1", b="2") == "12"  # adjacent tokens
    assert render("${x} and $x", x="1") == "${x} and $x"  # `$` is not our delimiter
    assert render("{{a}}", a="{{b}}", b="2") == "{{b}}"  # values are data, never re-rendered


# ── 6. the config read path ─────────────────────────────────────────────────────────────────────


def test_prompts_map_loads_from_config_yaml() -> None:
    """The whole point of Mechanism A: `config.yaml` is hand-editable, so a `prompts:` block written
    by hand must reach `resolve()`. Runs against a temp config — never the real one."""
    from app.config import load_settings

    config = (
        "server:\n  port: 5433\n"
        "prompts:\n"
        "  denial_echo:\n"
        "    override: |-\n"
        "      Already refused. Move on.\n"
        "  wrapup_nudge:\n"
        "    append: |-\n"
        "      Keep it under three sentences.\n"
    )
    with _memory_workspace(config):
        settings = load_settings()
        assert resolve("denial_echo", settings) == "Already refused. Move on."
        assert resolve("wrapup_nudge", settings) == (
            _GOLDEN["wrapup_nudge"][1] + "\n\nKeep it under three sentences."
        )
        assert resolve("question_declined", settings) == _GOLDEN["question_declined"][1]  # untouched
