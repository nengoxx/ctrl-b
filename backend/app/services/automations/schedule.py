"""Cron + timezone resolution for automations — the ONE wrapper over `cronsim` (A3, §D-2).

Everything schedule-shaped goes through here: validating what the owner (or the agent) typed, computing
the next fire, and rendering the human echo the editor shows. Pure functions, no I/O beyond one cached
read of the host's zone — so the write service, the claim and 14c's preview endpoint all agree by
construction about what a schedule means.

Two rules this module exists to enforce:

1. **Times are computed, never incremented.** `next_fire` asks `cronsim` for the next matching instant
   *in the automation's own zone*; nothing anywhere adds `timedelta(days=1)` to a wall clock. That is
   the DST trap R7 measured croniter double-firing on across the autumn fold: 02:30 exists twice, and
   only a zone-aware cron walk gets exactly one fire out of it. The returned datetime is aware, so
   `.timestamp()` resolves the fold correctly on its way to storage.
2. **Exactly five fields.** `cronsim` also accepts a six-field form whose first field is SECONDS —
   `*/15 * * * * *` is "every 15 seconds", which a 10-second poll loop could only ever service as a
   stream of misfires. The spec is a 5-field cron (§D-1) and this is where that is true.
"""

from __future__ import annotations

import functools
import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from cronsim import CronSim, CronSimError

#: Fields in the accepted cron form: minute hour day-of-month month day-of-week (§D-1). A 6-field
#: expression is refused rather than silently interpreted as a seconds-resolution schedule.
CRON_FIELDS = 5

#: Where a Linux/macOS host's `/etc/localtime` symlink points into the zone database. The segment after
#: it is the IANA key (`/usr/share/zoneinfo/Europe/Madrid` → `Europe/Madrid`).
_ZONEINFO_DIRS = ("zoneinfo/", "zoneinfo.default/")


class ScheduleError(ValueError):
    """An unusable schedule or timezone. Carries a message written for the OWNER (it is surfaced
    verbatim by the write service, the editor and the agent tool), never a traceback."""


def _valid_zone(key: str) -> bool:
    try:
        ZoneInfo(key)
    except ZoneInfoNotFoundError, ValueError:
        return False
    return True


@functools.cache
def server_tz_key() -> str:
    """The host's IANA zone key — the default an automation saved without an explicit `tz` gets.

    Resolved once per process (the answer cannot change without a restart of the box's clock config,
    and the write path must not stat the filesystem on every save). Three sources, in order: an
    explicit `TZ`, the `/etc/localtime` symlink, else `UTC`.

    `UTC` as the floor is deliberate over guessing from `time.tzname` (an abbreviation like "CEST" is
    not a zone — several zones share one) and over raising: a Windows host has no `/etc/localtime`, and
    the owner picking their zone in the editor must not be a prerequisite for the feature to load. Only
    `Path.resolve()` is used — no file is read — so this stays cheap enough for the one call it gets.
    """
    env = os.environ.get("TZ", "").strip()
    if env and _valid_zone(env):
        return env
    try:
        resolved = Path("/etc/localtime").resolve().as_posix()
    except OSError:  # pragma: no cover — a hostile /etc; the UTC floor below is the answer
        return "UTC"
    for marker in _ZONEINFO_DIRS:
        _, sep, tail = resolved.partition(marker)
        if sep and tail and _valid_zone(tail):
            return tail
    return "UTC"


def resolve_tz(tz: str | None) -> str:
    """Validate an IANA key, or resolve the server's when none was given (§D-1: `tz` is NOT NULL, and
    the default is decided at SAVE time so the stored row is self-describing). Raises `ScheduleError`
    on anything `zoneinfo` cannot load — including a key that exists on the author's machine but not on
    this host, which is exactly the failure a stored row must never hide."""
    if tz is None or not tz.strip():
        return server_tz_key()
    key = tz.strip()
    if not _valid_zone(key):
        raise ScheduleError(f"unknown timezone {key!r} — use an IANA name like 'Europe/Madrid' or 'UTC'")
    return key


def validate_cron(schedule: str) -> str:
    """The stripped, parseable 5-field cron expression, or `ScheduleError`.

    Parsing is not enough on its own: an expression can parse and still match no instant this century
    (`cronsim` signals that by exhausting its iterator), so this also proves ONE fire exists. Better
    here, at the write, than as a silent never-runs row the owner would only notice by its absence.
    """
    expr = " ".join(schedule.split())  # collapse the owner's whitespace; `cronsim` wants single spaces
    if not expr:
        raise ScheduleError("a schedule is required (5-field cron, e.g. '0 3 * * *')")
    fields = expr.split(" ")
    if len(fields) != CRON_FIELDS:
        raise ScheduleError(
            f"expected {CRON_FIELDS} cron fields (minute hour day month weekday), got {len(fields)} — "
            "a seconds field is not supported"
        )
    try:
        it = CronSim(expr, datetime.now(ZoneInfo("UTC")))
        next(it)
    except CronSimError as exc:
        raise ScheduleError(f"invalid cron expression: {exc}") from exc
    except StopIteration as exc:
        raise ScheduleError(f"{expr!r} never fires — check the day/month fields") from exc
    return expr


#: How many `cronsim` candidates may be discarded for not being in the future before we give up. Only
#: the DST fold produces any at all (see `_future_fires`), and a fold is one hour — so even a
#: minute-granular schedule discards ~60. The bound exists so a pathological expression cannot spin.
_MAX_PAST_CANDIDATES = 200


def _future_fires(schedule: str, tz: str, *, after: datetime, count: int) -> list[datetime]:
    """Up to `count` fires whose EPOCH is strictly greater than `after`'s — the one place that guarantee
    lives (post-14b review, HIGH).

    `cronsim` is strictly-after in LOCAL WALL-CLOCK terms, which is not the same thing during an autumn
    DST fold, when the same wall clock happens twice. Measured: with `Europe/Madrid` and
    `after = 2026-10-25T01:00Z` — 02:00 local in the SECOND pass of the folded hour — a `30 2 * * *`
    schedule yields `02:30+02:00`, i.e. the FIRST pass, whose epoch is `00:30Z`: thirty minutes in the
    PAST. Stored as `next_run_at` that regresses the schedule: every poll re-reads a due slot, records
    the same `missed` row (or, with a grace ≥ the offset, RE-RUNS the automation) until the fold ends.

    Filtering on the epoch rather than on the wall clock is the whole fix — it is also the only
    comparison that means anything across a fold, which is why storage is epoch-based to begin with.
    """
    zone = ZoneInfo(tz)
    floor = after.timestamp()
    out: list[datetime] = []
    discarded = 0
    try:
        it = CronSim(schedule, after.astimezone(zone))
        while len(out) < count and discarded <= _MAX_PAST_CANDIDATES:
            candidate = next(it)
            if candidate.timestamp() > floor:
                out.append(candidate)
            else:
                discarded += 1  # a fold-1 wall clock resolving to an instant already behind us
    except CronSimError as exc:  # a row written by an older/looser build
        raise ScheduleError(f"invalid cron expression: {exc}") from exc
    except StopIteration:
        pass
    return out


def next_fire(schedule: str, tz: str, *, after: datetime) -> datetime:
    """The first fire whose instant is STRICTLY after `after`, as an aware datetime in `tz`.

    This is the property every `next_run_at` invariant rests on: a claim advancing from *now* can never
    hand back the slot it just consumed, and enabling an automation can never reuse a stale past value.
    See `_future_fires` for why "strictly after" has to be measured in epoch seconds.
    """
    fires = _future_fires(schedule, tz, after=after, count=1)
    if not fires:
        raise ScheduleError(f"{schedule!r} never fires again")
    return fires[0]


def next_fires(schedule: str, tz: str, *, after: datetime, count: int = 3) -> list[datetime]:
    """The next `count` fires — the editor's live preview (14c). Same strictly-future guarantee as
    `next_fire` (one implementation). Stops early rather than raising if the expression runs out of
    matches, so a preview always renders what it *can*."""
    return _future_fires(schedule, tz, after=after, count=max(0, count))


def describe(schedule: str) -> str:
    """`cronsim`'s human echo ("At 03:00 on Monday") for the editor + the agent tool's confirmation
    card. Advisory text only: an unexplainable expression falls back to the raw form rather than
    failing a read path that has nothing to do with validity."""
    try:
        return CronSim(schedule, datetime.now(ZoneInfo("UTC"))).explain()
    except CronSimError, StopIteration, ValueError:
        return schedule
