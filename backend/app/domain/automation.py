"""Automation + AutomationRun — the scheduled-agent-run records (A3 slice 2, D49 / AUTOMATIONS_PLAN §D-1).

An `Automation` is a saved instruction to run the agent unattended on a cron schedule: a prompt, when
to run it, which agent runs it, and how the run should behave when nobody is there to answer a
question. An `AutomationRun` is one execution of that instruction — the row the history reads.

This module owns the **vocabulary** for the whole feature (`QuestionPolicy` / `ThreadMode` /
`RunStatus` / `RunTrigger`): the repo's SQL, the runner's terminal mapping, the API and the tests all
narrow against these Literals, so a new arm (`pinned` thread mode, a notify-and-wait policy) is one
edit here and a type error at every site that must learn about it. Nothing here does I/O.

Two records + two value types, and the split between them is load-bearing:

  * `Automation`/`AutomationRun` are the MUTABLE persisted rows.
  * `AutomationDraft` is the single WRITE shape — the REST body (14c), the agent tool (14d) and the
    tests all hand this to `AutomationService`, so validation cannot be re-implemented per caller.
  * `AutomationSnapshot` is the FROZEN execution snapshot the claim returns: the definition as it read
    at the instant the run was claimed. The runner reads only this, never the live row, so an edit
    landing mid-run affects the NEXT run and never the one in flight (§D-2).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

from app.domain.enums import Privilege

#: What an unattended run does when the model calls `question` and there is no owner to answer (owner
#: ruling 1, §D-3). `skip` = today's headless behavior (the call resolves DENIED, the run continues);
#: `use_default` = resolve the declared default → the first choice → a synthesized
#: "proceed on your best judgement", as the tool RESULT, so the run keeps moving. Named for what it
#: governs: CONFIRM gates are NOT covered by it — those always follow the privilege/approvals ladder.
QuestionPolicy = Literal["skip", "use_default"]

#: Where a run's conversation lives (owner ruling 4). `fresh` = its own archived thread per run (the
#: default — a run is a throwaway task); `rolling` = one lazily-owned archived thread the automation
#: keeps appending to, so it accumulates context across runs. `pinned` (an owner-chosen destination)
#: is the recorded future third arm — see AUTOMATIONS_PLAN §Out of v1.
ThreadMode = Literal["fresh", "rolling"]

#: How a run ended. `running` is the only non-terminal one — the claim inserts it and the runner's
#: shielded finalizer replaces it, so a `running` row after a restart means the process died mid-run
#: (the boot orphan sweep turns those into `interrupted`). The four honest failures are distinct on
#: purpose (§D-2): `error` = the turn failed or hit its cap · `timed_out` = the run's own
#: `timeout_s` fired and the turn was cancelled through `cancel_turn` · `interrupted` = a shutdown or
#: an owner Stop cut it off, so its external effects may be unknown · `missed` = the slot was so late
#: (`misfire_grace_s`) that firing it would have been dishonest, so it never ran at all.
RunStatus = Literal["running", "ok", "error", "timed_out", "interrupted", "missed"]

#: Terminal statuses — everything but `running`. The finalizer, the orphan sweep and the "is this
#: automation busy?" reads all key on this set rather than spelling the four names again.
TERMINAL_RUN_STATUSES: frozenset[str] = frozenset({"ok", "error", "timed_out", "interrupted", "missed"})

#: What set a run off: the scheduler's own poll loop, or the owner pressing run-now (14c).
RunTrigger = Literal["scheduled", "manual"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Automation(BaseModel):
    """One saved automation. Times are aware UTC `datetime`s here and UTC epoch integers in SQLite —
    the repo converts at its boundary (see the migration-5 comment for why storage is integral).

    `next_run_at` carries the scheduler's whole contract in one nullable column: NULL means "never
    claim this" (which is exactly what a disabled automation is), and a non-NULL value is always a
    real future fire computed by `cronsim` at write/enable/claim time — the service never advances it
    by adding a wall-clock interval, because that is the DST trap R7 caught croniter in.

    `rev` is bumped by the service on every DEFINITION change and re-verified inside the claim
    transaction: an edit that lands between the loop's due-scan and the claim invalidates the claim
    rather than running a stale prompt.
    """

    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    name: str
    schedule: str  # 5-field cron; only the write service is allowed to accept one
    tz: str  # validated IANA key — never blank (the service resolves the server zone at save)
    prompt: str
    enabled: bool = True
    agent: str | None = None  # NULL = the default agent, resolved per run; a name is checked STRICTLY
    privilege: Privilege | None = None  # NULL = the resolved agent's own level
    question_policy: QuestionPolicy = "use_default"
    thread_mode: ThreadMode = "fresh"
    thread_id: str | None = None  # rolling mode's own thread; NULL until the first run creates it
    timeout_s: int | None = None  # NULL = `automations.default_timeout_s`
    next_run_at: datetime | None = None
    rev: int = 1
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


class AutomationRun(BaseModel):
    """One execution of an automation — inserted by the claim, closed by the runner's finalizer.

    `scheduled_for` is the SLOT this run belongs to (NULL for a manual run that consumed no slot), and
    it is deliberately distinct from `started_at`: a run inside the misfire grace starts late, and the
    pair is what makes that visible instead of pretending the slot moved.
    """

    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    automation_id: str
    trigger: RunTrigger = "scheduled"
    scheduled_for: datetime | None = None
    started_at: datetime = Field(default_factory=_now)
    finished_at: datetime | None = None
    status: RunStatus = "running"
    error: str | None = None
    thread_id: str | None = None
    read_at: datetime | None = None  # NULL = unread (the F1/history unread marker, 14c)

    @property
    def terminal(self) -> bool:
        return self.status in TERMINAL_RUN_STATUSES


class AutomationDraft(BaseModel):
    """The ONE write shape (§D-1 "the ONE shared write service used by POST, PUT, and the agent
    tool"). Field-level rules live here so every caller gets them for free; the cross-field rules that
    need the world — is this cron parseable, is this a real IANA zone, does this agent exist, is the
    cap already full — live in `AutomationService`, which is the only writer.

    `tz=None` means "use the server's zone", resolved to a real key at save time rather than stored as
    a null that later reads would have to interpret.
    """

    name: str = Field(min_length=1, max_length=80)
    schedule: str = Field(min_length=1, max_length=200)
    prompt: str = Field(min_length=1)
    tz: str | None = None
    agent: str | None = None
    privilege: Privilege | None = None
    question_policy: QuestionPolicy = "use_default"
    thread_mode: ThreadMode = "fresh"
    timeout_s: int | None = Field(default=None, ge=1, le=86_400)
    enabled: bool = True


class AutomationSnapshot(BaseModel):
    """The immutable execution snapshot a successful claim returns (§D-2).

    Frozen, and the runner's ONLY input: the prompt/agent/privilege/policy/thread wiring are read once,
    inside the claim transaction, so a mid-flight edit (or a disable, or a delete) cannot change what
    the in-flight run is doing. It is also the ONE options object `_build_session` takes for an
    automation turn (§D-3) — the builder reads the few fields it needs off this rather than a parallel
    bag of bools that could disagree with the row the run was claimed from.
    """

    model_config = {"frozen": True}

    run_id: str
    automation_id: str
    name: str
    rev: int
    trigger: RunTrigger
    scheduled_for: datetime | None
    tz: str  # the definition's zone — the run thread's title is stamped in it, not in UTC
    prompt: str
    agent: str | None
    privilege: Privilege | None
    question_policy: QuestionPolicy
    thread_mode: ThreadMode
    thread_id: str | None
    timeout_s: int  # already resolved against `automations.default_timeout_s` — never None here

    @property
    def rolling(self) -> bool:
        """Whether this run appends to the automation's own thread (vs. getting a fresh one). One
        predicate so the runner and the session builder can't drift on the mode's meaning."""
        return self.thread_mode == "rolling"
