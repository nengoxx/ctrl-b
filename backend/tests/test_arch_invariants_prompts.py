"""QH-9-family drift-guard — **no model-facing prompt outside the registry** (PROMPTS_PLAN §2.5,
§6 C-10 as amended by §7 L-10).

Registration is enforced by nothing, everywhere: goose ships a prompt registry and still leaks 4,923
characters of prompt past it (R30). So the guarantee here is a TEST, not the registry. This sweeps
`backend/app` the way PROMPTS_AUDIT's own inventory did — every `ast.Constant` string ≥80 characters
plus every reconstructed f-string, minus docstrings — and fails on any hit that is neither in
`prompts.py` nor allowlisted below. A new prompt literal therefore fails CI until it is either moved
into the registry or consciously added here with a reason.

**Honest contract (C-10).** This is a *structural backstop*, not a proof: a literal under 80
characters slips through. That threshold is deliberate — the C-1 granularity ruling puts the short
interpolated status `summary` strings out of registry scope anyway, so the sweep's blind spot and the
registry's scope agree.

The allowlist is keyed by `(file, symbol)` (L-10) — readable, and a copy edit inside an allowlisted
function no longer churns an opaque hash. `symbol` is the enclosing class/function qualname, or the
module-level assignment target for a constant. Two exclusions are STRUCTURAL rather than listed,
because they are whole corpora with their own editing path: the `description=` argument of
`@action`/`@tool` (Class B — editable via `tool_overrides`) and of `Field` (the PR-1 corpus, ruled
won't-build).
"""

from __future__ import annotations

import ast
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]

#: The prompt-sized threshold PROMPTS_AUDIT swept at — kept identical so the two agree.
_MIN_CHARS = 80

#: `description=` on these calls is a whole corpus with its own editing path (see the docstring).
_DESCRIPTION_CALLS = frozenset({"action", "tool", "Field"})

#: `{reason: ((file, symbol), …)}` — everything long that is NOT a registrable prompt. Grouped so
#: each entry inherits a stated reason instead of carrying a repeated comment.
_ALLOWED: dict[str, tuple[tuple[str, str], ...]] = {
    "SQL — statements for SQLite, never seen by a model": (
        ("app/db.py", "<module>"),
        ("app/services/automations/repo.py", "AutomationRepo.add_run"),
        ("app/services/automations/repo.py", "AutomationRepo.due"),
        ("app/services/automations/repo.py", "AutomationRepo.excess_runs"),
        ("app/services/automations/repo.py", "AutomationRepo.finish_run"),
        ("app/services/automations/repo.py", "AutomationRepo.latest_runs"),
        ("app/services/automations/repo.py", "AutomationRepo.runs"),
        ("app/services/automations/repo.py", "AutomationRepo.unread_counts"),
        ("app/services/conversation.py", "MessageRepo.add"),
        ("app/services/conversation.py", "MessageRepo.attachment_part"),
        ("app/services/conversation.py", "MessageRepo.attachment_paths"),
        ("app/services/conversation.py", "MessageRepo.search"),
        ("app/services/conversation.py", "MessageRepo.with_call_states"),
        ("app/services/conversation.py", "ThreadRepo.create"),
        ("app/services/events.py", "EventService.recent"),
        ("app/services/events.py", "EventService.record"),
    ),
    "config + migration refusals and their remedies — CLI/startup text for the owner": (
        ("app/config.py", "Settings._known_media_namespaces_roles_and_slots"),
        ("app/config.py", "Settings._monitor_interval_covers_the_fleet_cache"),
        ("app/config.py", "QuietHoursCfg._hhmm"),
        ("app/config.py", "QuietHoursCfg._not_the_whole_day"),
        ("app/config.py", "_apply_env_overrides"),
        ("app/config.py", "_presence_address"),
        ("app/config_migration/__init__.py", "_assert_unchanged"),
        ("app/config_migration/__init__.py", "_call_step"),
        ("app/config_migration/__init__.py", "_parse"),
        ("app/config_migration/__init__.py", "_refuse_downgrade"),
        ("app/config_migration/__init__.py", "_refuse_empty_provider_models"),
        ("app/config_migration/__init__.py", "_refuse_retired_env"),
        ("app/config_migration/__init__.py", "_retired_path"),
        ("app/config_migration/__init__.py", "validate"),
        ("app/config_migration/steps.py", "_refuse_unmappable"),
        ("app/config_migration/steps.py", "media_v2_apply"),
        ("app/config_migration/steps.py", "presence_devices_apply"),
        ("app/main.py", "_preflight_config"),
    ),
    "diagnostics — log lines and operator-facing HTTP/exception detail": (
        ("app/adapters/inference.py", "InferenceClient._maybe_notice_anchoring_inactive"),
        ("app/adapters/inference.py", "InferenceClient._note_reasoning_demotion"),
        ("app/adapters/inference.py", "InferenceClient.stream_chat.attempt"),
        ("app/api/agent.py", "_AUTOMATION_THREAD_DETAIL"),
        ("app/api/agent.py", "_agent_folder"),
        ("app/api/agent.py", "_resume_skills"),
        ("app/api/agent.py", "apply_proposal_endpoint"),
        ("app/core/attachments.py", "CLAIM_REFUSED"),
        ("app/core/attachments.py", "sniff_file"),
        ("app/core/media.py", "MediaIdentity._exactly_one_identity"),
        ("app/core/media.py", "require_real_dir"),
        ("app/core/media.py", "admission_reason"),
        ("app/core/media.py", "ensure_media_dirs"),
        ("app/core/provider_registry.py", "EndpointGates.hold"),
        ("app/core/provider_registry.py", "_compute_gate_caps"),
        ("app/core/provider_registry.py", "_resolve"),
        ("app/core/provider_registry.py", "_validate_config_refs"),
        ("app/core/provider_registry.py", "provider_skill_collision_warnings"),
        ("app/db.py", "Database.transaction"),
        ("app/services/agent/compaction.py", "_warn_degenerate_trigger"),
        ("app/services/agent/session.py", "AgentSession._log_context_cost"),
        ("app/services/agent/session.py", "AgentSession._run_calls._complete"),
        ("app/services/automations/schedule.py", "validate_cron"),
        ("app/services/automations/service.py", "AutomationAgentMissing.__init__"),
        ("app/services/automations/service.py", "AutomationService._update"),
        ("app/services/automations/service.py", "AutomationService.claim"),
    ),
    "per-call outcome text — what happened on THIS invocation, not a standing instruction "
    "(the C-1 granularity ruling's class, one size up from the short `summary` labels)": (
        ("app/adapters/ssh.py", "run_command"),
        ("app/services/actions/_common.py", "run_service_command"),
        ("app/services/actions/reboot.py", "reboot_host"),
        ("app/services/actions/shutdown.py", "shutdown_host"),
        ("app/services/actions/terminal.py", "_unconfigured"),
        ("app/services/agent/automation_tools.py", "create_automation"),
        # D57 tier 2: the corpus's refusals (stale/ambiguous CAS, a path outside the corpus, a
        # duplicate topic, a write carrying a known secret) and the tool's gates (slot off,
        # auto_write off, recall budget spent) — all "what happened on THIS call", exactly the class
        # `memory_tool.gate_memory` below already sits in. The corpus's model-facing FRAMING lives in
        # the registry (`core_memory_policy`/`core_memory_recall`) and its routing/eligibility wording
        # in the `@action` description, which is `tool_overrides` territory.
        # D60 ②③ extends the same class: the delete-intent gate + its create-before-delete/
        # self-reference refusals, and the recall budget's spent-for-this-turn refusal.
        # D64 adds the paging refusals (`read_topic`: an offset past the end / below 1) and the
        # delete guard (`_delete_gate`: no read state, no/partial coverage with the exact next
        # offset, a topic no turn can read) — all facts about THIS call, computed from this turn's
        # own read record, so none of them is a standing instruction the registry could carry.
        # D68 attachments extend exactly that class, in three places. The store's paging refusals
        # (`read_page`: an offset past the end / below 1) are `read_topic`'s, verbatim. The tool's
        # refusals (a name this conversation does not hold, an image kind that is shown rather than
        # read, a PDF with no extracted text yet) are facts about THIS call. And the two assembly
        # STUBS (`image_stub`/`document_stub`) describe one file in one request — what was not sent
        # and the one call that reaches it — the same shape as D64's "continue at offset N".
        # `NO_IMAGE_SUPPORT` is the same class one layer down: opencode's in-band note, naming the
        # file this hop could not carry. It also *could not* be a registry text — `adapters/
        # inference.py` never reads live `Settings` (D48 C10), which is what `resolve()` needs.
        # The S2 fix wave's MED-1 cut extends it once more, into the two PAGE FRAMERS
        # (`inline_marker`, `_page_result`): "this page's line was longer than one page, so its first
        # N characters are shown" is a measured fact about the page in hand — the same shape as
        # "continue at offset N" beside it — and an owner rewording it could only make the coverage
        # statement disagree with the bytes.
        # S4's `NO_TEXT_SIDECAR` is the last of them: the CONTENT of the sidecar written for a PDF
        # nothing could be read out of — "we looked at this file and there is no text in it" — which
        # reaches the model through the ordinary §4.2 page frame, exactly like a real extraction. It
        # is a per-file outcome, not a standing instruction, and it is structurally out of the
        # registry's reach for `NO_IMAGE_SUPPORT`'s own reason one layer down: `core/attachments.py`
        # never imports `app.config`, which is what `resolve()` needs.
        ("app/adapters/inference.py", "NO_IMAGE_SUPPORT"),
        ("app/core/attachments.py", "NO_TEXT_SIDECAR"),
        ("app/core/attachments.py", "read_page"),
        ("app/services/agent/attachment_tool.py", "_page_result"),
        ("app/services/agent/attachment_tool.py", "read_attachment"),
        ("app/services/agent/attachments.py", "document_stub"),
        ("app/services/agent/attachments.py", "image_stub"),
        ("app/services/agent/attachments.py", "inline_marker"),
        ("app/services/agent/core_memory.py", "CoreMemoryCorpus._confine"),
        ("app/services/agent/core_memory.py", "CoreMemoryCorpus._create_blocking"),
        ("app/services/agent/core_memory.py", "CoreMemoryCorpus._delete_blocking"),
        ("app/services/agent/core_memory.py", "CoreMemoryCorpus._guard_secrets"),
        ("app/services/agent/core_memory.py", "CoreMemoryCorpus._require_supersedes"),
        ("app/services/agent/core_memory.py", "CoreMemoryCorpus.delete"),
        ("app/services/agent/core_memory.py", "CoreMemoryCorpus.read_topic"),
        ("app/services/agent/core_memory.py", "_cas"),
        ("app/services/agent/core_memory.py", "_delete_note"),
        ("app/services/agent/core_memory.py", "_index_raw"),
        ("app/services/agent/core_memory_tool.py", "_charge"),
        ("app/services/agent/core_memory_tool.py", "_delete_gate"),
        ("app/services/agent/core_memory_tool.py", "gate_core_memory"),
        ("app/services/agent/memory.py", "FileMemoryProvider._merge"),
        ("app/services/agent/memory.py", "MemoryCapError.__init__"),
        ("app/services/agent/memory_tool.py", "gate_memory"),
        ("app/services/agent/skill_tool.py", "gate_skill"),
        ("app/services/automations/runner.py", "AutomationRunner._drive"),
        ("app/services/automations/runner.py", "AutomationRunner._terminal"),
    ),
    "run-outcome text no model ever reads — the automation run row's `error` and the audit Event "
    "summary built from it, both owner-facing only: `run.error` is served by the REST history and the "
    "event feed, and the one agent-visible automation read (`list_automations`) prints `run.status` "
    "alone. Same class as `AutomationRunner._drive`/`_terminal` above, but hoisted to module constants": (
        ("app/services/automations/runner.py", "INTERRUPTED_NOTE"),
        ("app/services/automations/service.py", "ORPHAN_NOTE"),
    ),
    "Class B — tool-level `description=` text, hoisted to a constant only because the tool picks "
    "between two variants at runtime (`ToolSpec.describe`, D57 §4b-5). Same corpus and same editing "
    "path as every inline `@action(description=…)` the sweep excludes structurally: `tool_overrides` "
    "still overrides it, and §4b-5 rules routing/eligibility wording to live here rather than in the "
    "registry": (
        ("app/services/agent/memory_tool.py", "_DESCRIPTION_SOLO"),
        ("app/services/agent/memory_tool.py", "_DESCRIPTION_TIERED"),
    ),
    "data and file templates, not instructions": (
        ("app/api/agent.py", "_SKILL_TEMPLATE"),
        ("app/core/textmatch.py", "_STOP"),
        ("app/core/tool.py", "<module>"),
        ("app/services/agent/memory_backup.py", "_GITIGNORE"),
        ("app/services/tools/ip_info.py", "_FIELDS"),
    ),
    "Class A — the main system prompt keeps its own richer three-level chain (out of scope, C-23)": (
        ("app/services/agent/session.py", "DEFAULT_SYSTEM_PROMPT"),
    ),
}

_REGISTRY_FILE = "app/services/agent/prompts.py"


def _reconstruct(node: ast.JoinedStr) -> str:
    """An f-string's literal text with each interpolation standing in as `{}` — the same
    reconstruction PROMPTS_AUDIT's sweep used, so a long prompt built by f-string can't hide."""
    return "".join(
        v.value if isinstance(v, ast.Constant) and isinstance(v.value, str) else "{}" for v in node.values
    )


class _Sweep(ast.NodeVisitor):
    """Collects (symbol, lineno, text) for every long literal that isn't a docstring or structurally
    excluded. Symbol = the enclosing class/function qualname, or a module-level assignment target."""

    def __init__(self) -> None:
        self.stack: list[str] = []
        self.hits: list[tuple[str, int, str]] = []
        self._skip: set[int] = set()

    def _scoped(self, node: ast.AST, name: str) -> None:
        self.stack.append(name)
        self.generic_visit(node)
        self.stack.pop()

    def _skip_docstring(self, node: ast.AST) -> None:
        body = getattr(node, "body", [])
        if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
            if isinstance(body[0].value.value, str):
                self._skip.add(id(body[0].value))

    def visit_Module(self, node: ast.Module) -> None:
        self._skip_docstring(node)
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self._skip_docstring(node)
        self._scoped(node, node.name)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self._skip_docstring(node)
        self._scoped(node, node.name)

    visit_AsyncFunctionDef = visit_FunctionDef  # type: ignore[assignment]

    def visit_Assign(self, node: ast.Assign) -> None:
        names = [t.id for t in node.targets if isinstance(t, ast.Name)]
        if names and not self.stack:  # a module-level constant is named by its target
            self._scoped(node, names[0])
        else:
            self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        fn = node.func
        name = fn.id if isinstance(fn, ast.Name) else fn.attr if isinstance(fn, ast.Attribute) else ""
        if name in _DESCRIPTION_CALLS:
            for kw in node.keywords:
                if kw.arg == "description":
                    self._skip.update(id(sub) for sub in ast.walk(kw.value))
        self.generic_visit(node)

    def visit_JoinedStr(self, node: ast.JoinedStr) -> None:
        text = _reconstruct(node)
        if id(node) not in self._skip and len(text) >= _MIN_CHARS:
            self._record(node.lineno, text)
        # Only the f-string's own literal SEGMENTS are suppressed — `text` already represents them,
        # so they are not separate hits. Every interpolation is still descended into: `f"{'…'}"` and
        # `f"{'…' if x else ''}"` hide a whole prompt inside an expression the reconstruction shows
        # as `{}`, and skipping the subtree wholesale would let exactly that through.
        self._skip.update(id(v) for v in node.values if isinstance(v, ast.Constant))
        self.generic_visit(node)

    def visit_Constant(self, node: ast.Constant) -> None:
        if id(node) in self._skip or not isinstance(node.value, str):
            return
        if len(node.value) >= _MIN_CHARS:
            self._record(node.lineno, node.value)

    def _record(self, lineno: int, text: str) -> None:
        self.hits.append((".".join(self.stack) or "<module>", lineno, text))


def _sweep() -> dict[tuple[str, str], list[tuple[int, str]]]:
    found: dict[tuple[str, str], list[tuple[int, str]]] = {}
    for py in sorted((BACKEND / "app").rglob("*.py")):
        rel = py.relative_to(BACKEND).as_posix()
        sweep = _Sweep()
        sweep.visit(ast.parse(py.read_text(encoding="utf-8")))
        for symbol, lineno, text in sweep.hits:
            found.setdefault((rel, symbol), []).append((lineno, text))
    return found


def _allowed() -> set[tuple[str, str]]:
    return {entry for entries in _ALLOWED.values() for entry in entries}


def test_no_model_facing_literal_lives_outside_the_registry() -> None:
    hits = _sweep()
    allowed = _allowed()
    unexpected = {
        key: [f"line {lineno}: {text[:70]!r}" for lineno, text in items]
        for key, items in hits.items()
        if key[0] != _REGISTRY_FILE and key not in allowed
    }
    assert not unexpected, (
        "long string literal outside the prompt registry: "
        f"{unexpected} — if it is a prompt, move the text into services/agent/prompts.py and call "
        "resolve(); if it is not, add its (file, symbol) to _ALLOWED under the reason that applies"
    )


def test_the_allowlist_has_no_dead_entries() -> None:
    """An allowlist that outlives its literals stops describing the code (the QH-9 pattern)."""
    stale = sorted(_allowed() - set(_sweep()))
    assert not stale, f"allowlisted symbols no longer hold a long literal — prune: {stale}"


def test_the_registry_module_holds_the_prompt_corpus() -> None:
    """The positive half: the sweep must actually SEE prompts.py's defaults — otherwise a broken
    sweep (wrong path, wrong threshold) would pass the guard above vacuously."""
    in_registry = [key for key in _sweep() if key[0] == _REGISTRY_FILE]
    assert in_registry, "the sweep found no long literals in prompts.py — the sweep itself is broken"


# ── the sweep's own behaviour, pinned on synthetic sources ──────────────────────────────────────

_LONG = "This is a long instruction the model would read, well past the eighty-character floor."


def _sweep_source(src: str) -> list[tuple[str, int, str]]:
    sweep = _Sweep()
    sweep.visit(ast.parse(src))
    return sweep.hits


def test_a_literal_hidden_inside_an_fstring_interpolation_is_caught() -> None:
    """`f"{'…'}"` reconstructs to `{}` — under 80 chars — so the prompt rides in the expression the
    reconstruction can't see. The interpolation subtree must still be swept."""
    hits = _sweep_source(f'X = f"{{{_LONG!r}}}"')
    assert [text for _sym, _line, text in hits] == [_LONG]


def test_a_literal_inside_a_conditional_interpolation_is_caught() -> None:
    """The `state_clause` shape — the branch a code-precomputed clause would take if someone inlined
    it back into an f-string."""
    hits = _sweep_source(f"X = f\"prefix {{{_LONG!r} if c else ''}}\"")
    assert [text for _sym, _line, text in hits] == [_LONG]


def test_a_plain_fstring_is_reported_once_as_a_whole() -> None:
    """The other half of the same fix: an ordinary f-string's literal segments are NOT separate hits
    on top of the reconstruction (that would double-report every long interpolated prompt)."""
    hits = _sweep_source(f'X = f"{_LONG} {{value}} {_LONG}"')
    assert [text for _sym, _line, text in hits] == [f"{_LONG} {{}} {_LONG}"]
