"""Automations API — the REST surface over `AutomationService`/`AutomationRunner` (A3 slice 3, §D-6).

Thin by design: every write is one `AutomationDraft` handed to `AutomationService`, which is the ONE
validated writer (cron, zone, agent, cap — all in one transaction there, not here). This module owns
exactly three things the service cannot:

  * **The list's derived echoes.** A row on its own does not say "At 03:00 every day", when it fires
    next, how its last run went, or how many results the owner has not looked at. Those are computed
    here, in ONE response model, so the Conf list never assembles them from three round-trips.
  * **The status mapping.** Each `AutomationError` subclass maps to exactly one HTTP status, in ONE
    place (`_mapped`) that every endpoint wraps — a per-endpoint `try/except` ladder is how a new
    refusal silently becomes a 500.
  * **`schedule-preview`.** Advisory only (§D-6): it answers "what would this cron mean?" for the
    editor's live preview and NEVER 4xxs on a bad expression — an invalid schedule is a normal state
    of a field being typed into, not a failed request. The authoritative validation still happens at
    the write, in the service.

**No `settings_write_lock` anywhere in this file, deliberately** (§D-6): automations live in SQLite,
not `config.yaml`, precisely because agent-writable records must never be able to brick a
config-validated boot. The hosts/settings routers take that lock because they edit the YAML document;
this one must not, or it would serialise DB writes behind an unrelated file lock.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.domain.automation import Automation, AutomationDraft, AutomationRun
from app.services.automations import (
    AutomationAgentMissing,
    AutomationBusy,
    AutomationCapReached,
    AutomationInvalid,
    AutomationNotFound,
    AutomationService,
    ScheduleError,
    describe,
    next_fires,
    resolve_tz,
    server_tz_key,
    validate_cron,
)

router = APIRouter(tags=["automations"], prefix="/automations")

#: How many upcoming fires the LIST carries per automation. Two, not one: the pair is what makes a
#: schedule's cadence readable at a glance ("in 20m, then tomorrow 03:00") without opening the editor.
LIST_NEXT_FIRES = 2

#: How many the editor's live PREVIEW shows (§D-6: "next N fires"). Three is enough to disambiguate a
#: weekly from a daily from an every-other-hour expression while still fitting a phone row.
PREVIEW_NEXT_FIRES = 3

#: Ceiling on `GET /{id}/runs?limit=`. Retention (`automations.keep_runs`, max 1000) already bounds how
#: many rows exist, so this is not a correctness guard — it is the ordinary "a caller cannot ask the
#: server for an unbounded page" rule, sized well above any history the UI renders.
MAX_RUNS_PAGE = 200


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _svc(request: Request) -> AutomationService:
    return request.app.state.automation_service


@contextmanager
def _mapped() -> Iterator[None]:
    """Translate the service's refusals into HTTP, once, for every endpoint.

    The mapping is the contract 14b's error classes were written for (`service.py`): a field the caller
    must fix is 422 **with the field named**, so the editor can point at the offending input rather than
    dumping a sentence into a toast; a full cap and a live run are both 409 (the request was
    well-formed, the state says no); a missing row is 404. `AutomationAgentMissing` is 422 too — it is a
    stale `agent` field, i.e. something the owner fixes in the form.
    """
    try:
        yield
    except AutomationNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from None
    except AutomationInvalid as exc:
        # The `{path, message}` envelope `api/settings.py` already uses for its own field errors — the
        # frontend's `formatDetail` renders it as "schedule: invalid cron expression: …".
        raise HTTPException(status_code=422, detail=[{"path": exc.field, "message": str(exc)}]) from None
    except AutomationAgentMissing as exc:
        raise HTTPException(status_code=422, detail=[{"path": "agent", "message": str(exc)}]) from None
    except (AutomationCapReached, AutomationBusy) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


class AutomationView(BaseModel):
    """One automation as the Conf list renders it: the stored row plus the four things a list has to
    show and a row cannot know about itself.

    Nested rather than flattened on purpose — `automation` stays the exact `Automation` shape the write
    path round-trips, so the editor seeds its draft from the same object the list already holds instead
    of re-fetching, and a new column on the record needs no change here at all.
    """

    automation: Automation
    #: `cronsim`'s human echo of the schedule ("At 03:00 on Monday"). Advisory text — an expression it
    #: cannot explain degrades to the raw cron rather than failing the read (see `schedule.describe`).
    schedule_text: str
    #: The next `LIST_NEXT_FIRES` fires, in the automation's own zone. EMPTY for a disabled automation
    #: (nothing is scheduled) and for a stored schedule this build cannot evaluate — the list says
    #: "no upcoming runs" instead of the endpoint 500ing on one bad row.
    next_fires: list[datetime]
    #: The newest run, whatever its status — the list's last-status chip. `None` = never run.
    last_run: AutomationRun | None
    #: Terminal runs the owner has not opened yet (the unread badge, §D-6).
    unread_runs: int
    #: A run of THIS automation is executing right now.
    running: bool


class AutomationsDoc(BaseModel):
    """The list response. An envelope rather than a bare array because the editor needs four facts that
    belong to the FEATURE, not to any one automation — and a client that had to guess them would be
    hardcoding numbers this app keeps in config (§D-7)."""

    automations: list[AutomationView]
    #: `automations.enabled` — the master switch. False means the poll loop is idling: nothing fires on
    #: a schedule (run-now still works, which is what makes the switch usable during an incident).
    enabled: bool
    #: A run is executing somewhere right now, so run-now would be refused (concurrency 1 is GLOBAL).
    busy: bool
    #: `automations.max_count` — what "delete one first" is counting against.
    max_count: int
    #: The zone a blank `tz` resolves to at save time, so the editor's placeholder tells the truth.
    server_tz: str
    #: `automations.default_timeout_s` — what a blank timeout means, for the same reason.
    default_timeout_s: int


class EnabledIn(BaseModel):
    """The list switch's whole body. Deliberately NOT a partial draft: a PUT replaces a definition and
    needs every field, which is far too much to send for flipping one row's switch — and a partial PUT
    would make "an omitted field" mean two different things depending on the caller."""

    enabled: bool


class SchedulePreviewIn(BaseModel):
    #: NO `min_length` — deliberately. This endpoint's contract is "always 200, valid or not" (see
    #: `SchedulePreview`), and a pydantic length rule would break exactly that for the most ordinary
    #: input there is: an empty field the owner has not typed into yet, answered with a 422 the editor
    #: would have to special-case. The blank case is handled below, as data.
    schedule: str = Field(default="", max_length=200)
    tz: str | None = None


class SchedulePreview(BaseModel):
    """What a cron expression would MEAN — the editor's live preview (§D-6).

    Always returned with a 200, including for nonsense input: this endpoint is called on every
    keystroke, and a half-typed expression is not a client error. `valid=False` + `error` is the answer
    the field renders inline; `field` names which input is at fault so the warning lands on the right
    one.
    """

    valid: bool
    error: str | None = None
    field: str | None = None  # "schedule" | "tz" — which input the message belongs to
    #: The zone the preview was computed in — the resolved server zone when the editor sent none.
    tz: str
    describe: str | None = None
    next_fires: list[datetime] = []


def _view(
    row: Automation,
    *,
    last_run: AutomationRun | None,
    unread: int,
    running: bool,
    now: datetime,
) -> AutomationView:
    """Assemble one list row's derived echoes.

    `next_fires` is computed only for an ENABLED automation, and a `ScheduleError` degrades to an empty
    list instead of propagating: a row whose schedule this build cannot evaluate (written by a looser
    build, or a zone dropped from the host) must still be listable — the list is the only place the
    owner can get at it to fix it.
    """
    fires: list[datetime] = []
    if row.enabled:
        try:
            fires = next_fires(row.schedule, row.tz, after=now, count=LIST_NEXT_FIRES)
        except ScheduleError:
            fires = []
    return AutomationView(
        automation=row,
        schedule_text=describe(row.schedule),
        next_fires=fires,
        last_run=last_run,
        unread_runs=unread,
        running=running,
    )


@router.get("")
async def list_automations(request: Request) -> AutomationsDoc:
    """Every automation with its derived echoes, plus the feature-level facts the editor needs.

    Four reads total regardless of how many automations exist (list · latest runs · unread counts · open
    runs) — the per-row aggregates live in the repo as GROUP BY/window queries rather than a query per
    row, because this is the payload the Conf tab refetches on every entry.
    """
    svc = _svc(request)
    repo = svc.repo
    rows = await repo.list()
    latest = await repo.latest_runs()
    unread = await repo.unread_counts()
    active = {r.automation_id for r in await repo.open_runs()}
    now = _now()
    cfg = svc.cfg
    return AutomationsDoc(
        automations=[
            _view(
                row,
                last_run=latest.get(row.id),
                unread=unread.get(row.id, 0),
                running=row.id in active,
                now=now,
            )
            for row in rows
        ],
        enabled=cfg.enabled,
        busy=request.app.state.automation_runner.busy,
        max_count=cfg.max_count,
        server_tz=server_tz_key(),
        default_timeout_s=cfg.default_timeout_s,
    )


@router.post("", status_code=201)
async def create_automation(body: AutomationDraft, request: Request) -> Automation:
    """Create one. The body IS the shared write shape — the agent tool (14d) hands the service the very
    same object, so there is no REST-only request model that could drift from what the tool can express.
    """
    with _mapped():
        return await _svc(request).create(body)


@router.post("/schedule-preview")
async def schedule_preview(body: SchedulePreviewIn, request: Request) -> SchedulePreview:
    """What this cron would mean — never an error status (see `SchedulePreview`).

    Reads `schedule.py` DIRECTLY rather than going through the service: the service's job is to accept
    or refuse a WRITE, and routing a preview through it would either need a "don't actually save" flag
    or a second validation path. Both layers call the same three pure functions, so the preview and the
    save can never disagree about what an expression means.
    """
    try:
        tz = resolve_tz(body.tz)
    except ScheduleError as exc:
        # The zone is unusable, so there is no zone to compute fires in. Echo the server's — that is
        # what a blank field would resolve to, i.e. the value the owner gets by clearing the input.
        return SchedulePreview(valid=False, error=str(exc), field="tz", tz=server_tz_key())
    if not body.schedule.strip():
        # Short-circuited before `validate_cron` so the blank field reads as the prompt it is, rather
        # than as the parser's complaint about an expression nobody has written yet.
        return SchedulePreview(
            valid=False,
            error="a schedule is required (5-field cron, e.g. '0 3 * * *')",
            field="schedule",
            tz=tz,
        )
    try:
        schedule = validate_cron(body.schedule)
    except ScheduleError as exc:
        return SchedulePreview(valid=False, error=str(exc), field="schedule", tz=tz)
    return SchedulePreview(
        valid=True,
        tz=tz,
        describe=describe(schedule),
        next_fires=next_fires(schedule, tz, after=_now(), count=PREVIEW_NEXT_FIRES),
    )


@router.post("/runs/{run_id}/read")
async def mark_run_read(run_id: str, request: Request) -> AutomationRun:
    """Clear one run's unread marker (idempotent — an already-read run keeps its first `read_at`).

    Declared BEFORE the `/{automation_id}/…` routes: FastAPI matches in declaration order, and a
    literal first segment must not be shadowed by a path parameter.
    """
    repo = _svc(request).repo
    if not await repo.mark_run_read(run_id, _now()):
        raise HTTPException(status_code=404, detail=f"no run {run_id!r}")
    run = await repo.get_run(run_id)
    if run is None:  # deleted between the mark and the read — the caller asked about a run that is gone
        raise HTTPException(status_code=404, detail=f"no run {run_id!r}")
    return run


@router.put("/{automation_id}")
async def update_automation(automation_id: str, body: AutomationDraft, request: Request) -> Automation:
    """Replace a definition (full-body PUT). `rev` bumps in the service, which is what invalidates a
    claim already in flight for the old shape."""
    with _mapped():
        return await _svc(request).update(automation_id, body)


@router.post("/{automation_id}/enabled")
async def set_automation_enabled(automation_id: str, body: EnabledIn, request: Request) -> Automation:
    """The list switch. A separate endpoint from PUT because it is the one edit that must be cheap: the
    switch has no draft to send, and enabling is also where `next_run_at` is recomputed strictly-future
    (§D-1) — which the service does, not this handler."""
    with _mapped():
        return await _svc(request).set_enabled(automation_id, body.enabled)


@router.delete("/{automation_id}", status_code=204)
async def delete_automation(automation_id: str, request: Request) -> None:
    """Delete a definition, its run history and the threads that history owned. 409 while a run of it is
    active, or while any of those threads has a live turn (`AutomationBusy`)."""
    with _mapped():
        await _svc(request).delete(automation_id)


@router.post("/{automation_id}/run-now", status_code=202)
async def run_automation_now(automation_id: str, request: Request) -> AutomationRun:
    """Start one run immediately and answer with the row it created — 202, not 200, because the run is
    still going when this returns.

    The endpoint deliberately does NOT await the run (`start_now`, not `run_now`): a run is a full agent
    turn bounded by `timeout_s` (300s by default), and holding an HTTP request open across it is exactly
    what D39's durable-turn machinery exists to avoid — a client that navigates away, or a proxy that
    times the socket out, would cancel the handler mid-run and the honest terminal would become
    `interrupted`. The turn is watchable in the chat UI while it runs, and the run's terminal status
    lands in the history.

    409 while any run is active: concurrency 1 is a GLOBAL property (owner ruling 2), so the honest
    answer is "not now" rather than a queue nothing else in the feature has.
    """
    with _mapped():
        return await request.app.state.automation_runner.start_now(automation_id)


@router.get("/{automation_id}/runs")
async def list_runs(
    automation_id: str,
    request: Request,
    limit: int | None = Query(default=None, ge=1, le=MAX_RUNS_PAGE),
) -> list[AutomationRun]:
    """One automation's run history, newest first. `limit` omitted = the repo's own default, so the page
    size is not spelled twice; bounded by `MAX_RUNS_PAGE` so a caller cannot ask for an unbounded page."""
    repo = _svc(request).repo
    if await repo.get(automation_id) is None:
        raise HTTPException(status_code=404, detail=f"no automation {automation_id!r}")
    if limit is None:
        return await repo.runs(automation_id)
    return await repo.runs(automation_id, limit=limit)
