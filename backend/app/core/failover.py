"""Generic failover primitive (Phase 6, D-failover; async-generator form, D43/Slice 7).

Failover is its own cross-cutting subsystem: whatever endpoint is *active* (chosen by a service's
config, by chat mode, by an agent), if it fails the request walks an ordered chain — entry 1, then
entry 2, … — until one succeeds. The chain is independent of how the active endpoint was picked; the
active endpoint simply delegates here on failure.

Voice (STT/TTS) is the first consumer; the LLM inference fallback chain reuses this (its own slice).
The primitive is deliberately **value-agnostic**: `attempt(endpoint)` returns whatever the consumer
wants (a buffered value for voice; a `(first_chunk, stream, permit)` handle for a streaming consumer),
and "success = the first attempt that doesn't raise". So a streaming reuse can fail over at stream
*initiation* without this code assuming a buffered result.

**`failover()` is an async GENERATOR (D43/A6).** It yields typed *control items* as they happen —
`HopRetry` (a same-endpoint retry is about to sleep-then-re-attempt) and `HopFailover` (dropping to
the next endpoint) — and then the terminal `FailoverResult` as its **LAST** yielded item. Python async
generators cannot `return` a value, so the winning result rides the stream as that final item; the
last-item contract is the typed union `HopRetry | HopFailover | FailoverResult[T]` and is the reason a
consumer that wants to *interleave* those control items into its own output stream (the inference chat
stream) can — a plain called function could not. Buffered callers that don't care about the events use
**`failover_collect()`**, which drains the generator, discards the control items, and returns the
`FailoverResult` (byte-for-byte the old return-a-value behaviour).

Policy (owner directive, Phase 6 Q2): the DEFAULT is **any error → try the next endpoint** — best-
effort, ensure functionality (the `policy` param defaults to always-`NEXT_HOP`, so no `HopRetry` is
ever yielded and the shape reduces to today's walk). A consumer MAY pass a `policy(exc, attempt)` that
asks for a bounded same-endpoint **retry** first (D43/A7 — the visible transient-error retry tier): on
a failure whose policy returns `RETRY_AFTER(delay, max)`, this yields `HopRetry`, sleeps `delay`, and
re-enters the SAME hop's `attempt`; when the policy returns `NEXT_HOP` (budget exhausted, or the error
isn't retry-worthy) it records the hop and moves on. Each failed hop is logged + collected so the
caller can *surface* the degradation while still returning a working result. Only when every endpoint
fails does the generator raise `FailoverError` carrying all the per-hop errors.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import AsyncGenerator, Awaitable, Callable, Generic, Sequence, TypeVar

E = TypeVar("E")  # endpoint type (opaque to this module)
T = TypeVar("T")  # result type

log = logging.getLogger(__name__)


class FailoverError(RuntimeError):
    """Every endpoint in the chain failed (or the chain was empty). `failures` holds one
    human-readable message per attempted endpoint, in order, for surfacing/logging."""

    def __init__(self, failures: list[str]) -> None:
        self.failures = failures
        body = "; ".join(failures) if failures else "no endpoints configured"
        super().__init__(f"all endpoints failed: {body}")


@dataclass(frozen=True)
class FailAction:
    """The failover policy's verdict on ONE failed attempt (D43/A7). `delay_s is None` ⇒ **NEXT_HOP**:
    record the hop and drop to the next endpoint (today's any-error→next-hop). `delay_s` set ⇒
    **RETRY_AFTER**: sleep that many seconds and re-enter the SAME hop's `attempt`. `max_attempts` is
    the hop's total retry budget, carried on the action so the emitted `HopRetry` can report
    `attempt/max` WITHOUT `failover()` knowing per-endpoint config — it stays value-agnostic (the
    inference layer, which owns the budget, encodes it here). Build via the module-level `NEXT_HOP`
    singleton / `RETRY_AFTER(...)` factory, never by hand."""

    delay_s: float | None = None
    max_attempts: int = 0


#: The default policy verdict + the always-next-hop policy: never retry, always fail over (Phase 6 Q2).
NEXT_HOP = FailAction()


def RETRY_AFTER(delay_s: float, max_attempts: int) -> FailAction:
    """A `FailAction` asking `failover()` to sleep `delay_s` then re-attempt the SAME hop. `max_attempts`
    is the hop's whole retry budget (for the `HopRetry` event's `attempt/max`), supplied by the caller
    since `failover()` doesn't know per-endpoint config."""
    return FailAction(delay_s=delay_s, max_attempts=max_attempts)


#: `policy(exc, attempt)` — given the exception and how many retries this hop has already done (0-based),
#: return the verdict. The default always fails over, so the generator's shape is today's walk.
FailPolicy = Callable[[BaseException, int], FailAction]


def _always_next_hop(_exc: BaseException, _attempt: int) -> FailAction:
    return NEXT_HOP


@dataclass(frozen=True)
class HopRetry:
    """Control item: the served endpoint at chain position `index` failed with a retry-worthy error and
    a same-endpoint retry (`attempt` of `max_attempts`) is about to sleep `delay_s` then re-attempt.
    Yielded BEFORE the sleep so a consumer can narrate the wait live (D43/A6)."""

    index: int
    attempt: int
    max_attempts: int
    delay_s: float


@dataclass(frozen=True)
class HopFailover:
    """Control item: the endpoint at `from_index` is giving up (budget exhausted / non-retryable) and
    the chain is dropping to `to_index`. Yielded before the next hop is attempted (D43/A6)."""

    from_index: int
    to_index: int


@dataclass
class FailoverResult(Generic[T]):
    """A successful attempt + the trail that led to it, yielded as the generator's LAST item.
    `served_index` is the 0-based position in the chain that worked (0 = primary/active); `failures`
    are the messages from the endpoints tried *before* it. `degraded` is the simple "did a fallback
    have to save us" signal the API surfaces."""

    value: T
    served_index: int
    failures: list[str] = field(default_factory=list)

    @property
    def degraded(self) -> bool:
        return self.served_index > 0


async def failover(
    endpoints: Sequence[E],
    attempt: Callable[[E], Awaitable[T]],
    *,
    label: Callable[[E], str] = str,
    policy: FailPolicy = _always_next_hop,
) -> AsyncGenerator[HopRetry | HopFailover | FailoverResult[T], None]:
    """Walk `endpoints` in order, awaiting `attempt(ep)`; yield control items live and the winning
    `FailoverResult` as the FINAL item (the last-item contract — async generators can't return a value).

    On a failure, `policy(exc, retries_so_far)` decides: `RETRY_AFTER(delay, max)` → yield `HopRetry`,
    sleep, re-attempt the SAME endpoint; `NEXT_HOP` → record the hop, yield `HopFailover` (when a next
    endpoint exists), advance. `label(ep)` names an endpoint in log lines / error messages. Raises
    `FailoverError` (with every hop's error) only if the chain is empty or every endpoint fails — the
    caller turns that into a clean upstream error.
    """
    failures: list[str] = []
    total = len(endpoints)
    for i, ep in enumerate(endpoints):
        retries = 0
        while True:
            try:
                value = await attempt(ep)
            except Exception as exc:  # noqa: BLE001 — verdict comes from `policy`, not the type
                action = policy(exc, retries)
                if action.delay_s is not None:
                    retries += 1
                    yield HopRetry(
                        index=i, attempt=retries, max_attempts=action.max_attempts, delay_s=action.delay_s
                    )
                    log.warning(
                        "failover: endpoint %d/%d retry %d/%d in %.1fs (%s)",
                        i + 1,
                        total,
                        retries,
                        action.max_attempts,
                        action.delay_s,
                        exc,
                    )
                    # The backoff sleep holds NOTHING: the failed `attempt` already released whatever it
                    # held (its endpoint permit) inside its own `except` before raising (verified in
                    # adapters/inference.py `stream_chat.attempt`), and the retry re-enters `attempt`,
                    # which re-acquires. A cancel landing here propagates with nothing open — a
                    # structural no-op cleanup (no stream object exists between attempts).
                    await asyncio.sleep(action.delay_s)
                    continue  # re-enter the SAME hop
                # NEXT_HOP: record this hop and drop to the next endpoint.
                msg = f"{label(ep)}: {exc}"
                failures.append(msg)
                log.warning("failover: endpoint %d/%d failed (%s)", i + 1, total, msg)
                if i + 1 < total:
                    yield HopFailover(from_index=i, to_index=i + 1)
                break  # advance the for-loop to the next endpoint
            else:
                if failures:
                    log.warning(
                        "failover: served by endpoint %d/%d after %d failure(s)",
                        i + 1,
                        total,
                        len(failures),
                    )
                yield FailoverResult(value=value, served_index=i, failures=list(failures))
                return  # the FailoverResult was the last item — the chain is done
    raise FailoverError(failures)


async def failover_collect(
    endpoints: Sequence[E],
    attempt: Callable[[E], Awaitable[T]],
    *,
    label: Callable[[E], str] = str,
    policy: FailPolicy = _always_next_hop,
) -> FailoverResult[T]:
    """Drain `failover()` for a buffered caller: discard the control items, return the `FailoverResult`.
    Byte-for-byte the old return-a-value `failover()` — voice/embeddings/`complete()` use this so they
    stay behaviourally unchanged (D43/A6, Invariant 6). Propagates `FailoverError` unchanged."""
    result: FailoverResult[T] | None = None
    async for item in failover(endpoints, attempt, label=label, policy=policy):
        if isinstance(item, FailoverResult):
            result = item  # the terminal item; the generator returns right after
    # A clean drain always ends with a FailoverResult (the only non-raising exit); an all-fail chain
    # raised FailoverError out of the `async for` above instead of reaching here.
    assert result is not None, "failover() drained without a FailoverResult and without raising"
    return result
