"""Generic failover primitive (Phase 6, D-failover).

Failover is its own cross-cutting subsystem: whatever endpoint is *active* (chosen by a service's
config, by chat mode, by an agent), if it fails the request walks an ordered chain — entry 1, then
entry 2, … — until one succeeds. The chain is independent of how the active endpoint was picked; the
active endpoint simply delegates here on failure.

Voice (STT/TTS) is the first consumer; the LLM inference fallback chain reuses this unchanged later
(its own slice). The primitive is deliberately **value-agnostic**: `attempt(endpoint)` returns
whatever the consumer wants (a buffered value for voice; a `(first_chunk, stream)` handle for a
streaming consumer), and "success = the first attempt that doesn't raise". So a streaming reuse can
fail over at stream *initiation* without this code assuming a buffered result.

Policy (owner directive, Phase 6 Q2): **any error → try the next endpoint** — best-effort, ensure
functionality. Each failed hop is logged + collected so the caller can *surface* the degradation
(e.g. a `X-Voice-Served-By: fallback` header) while still returning a working result. Only when every
endpoint fails does `failover` raise `FailoverError` carrying all the per-hop errors.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Generic, Sequence, TypeVar

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


@dataclass
class FailoverResult(Generic[T]):
    """A successful attempt + the trail that led to it. `served_index` is the 0-based position in the
    chain that worked (0 = primary/active); `failures` are the messages from the endpoints tried
    *before* it. `degraded` is the simple "did a fallback have to save us" signal the API surfaces."""

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
) -> FailoverResult[T]:
    """Walk `endpoints` in order, awaiting `attempt(ep)`; return the first success with metadata.

    ANY exception from `attempt` is caught, logged, recorded, and the next endpoint tried (the
    "ensure functionality" policy). `label(ep)` names an endpoint in log lines / error messages
    (defaults to `str`). Raises `FailoverError` (with every hop's error) only if the chain is empty
    or every endpoint fails — the caller turns that into a clean upstream error.
    """
    failures: list[str] = []
    for i, ep in enumerate(endpoints):
        try:
            value = await attempt(ep)
        except Exception as exc:  # noqa: BLE001 — any error → fall through to the next endpoint
            msg = f"{label(ep)}: {exc}"
            failures.append(msg)
            log.warning("failover: endpoint %d/%d failed (%s)", i + 1, len(endpoints), msg)
            continue
        if failures:
            log.warning(
                "failover: served by endpoint %d/%d after %d failure(s)",
                i + 1,
                len(endpoints),
                len(failures),
            )
        return FailoverResult(value=value, served_index=i, failures=failures)
    raise FailoverError(failures)
