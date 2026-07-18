"""FORMAL-AUDIT FIX WAVE A — A6 [C4-H2]: cancel is turn-scoped.

`POST /agent/turns/{thread_id}/cancel` now accepts an optional JSON body `{turn_id?}`. When it is
present and does NOT match the live handle's `turn_id`, the endpoint refuses (no cancel) and reports
the live turn — so a delayed Stop for turn A can't cancel a successor turn B on the same thread. An
absent body keeps the legacy unscoped behaviour.

The endpoint is driven directly (a fake Request) on the shared `run_async` loop so the never-run
sleeping task that stands in for a detached, still-running drain task is created and awaited on the
SAME loop (mirroring `test_durable_turns_slice3`'s `_pending_task` discipline).
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import tempfile
from pathlib import Path

from _async import run_async

_NO_BODY = object()


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


@contextlib.contextmanager
def _workspace(config_text: str = "server:\n  port: 5433\n"):
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


def _pending_task():
    """A real, never-run asyncio.Task on the shared test loop → `.done()` is False (stands in for a
    detached, still-running drain task)."""

    async def _mk():
        return asyncio.ensure_future(asyncio.sleep(3600))

    return run_async(_mk())


def _drop_task(task) -> None:
    task.cancel()

    async def _drain():
        with contextlib.suppress(asyncio.CancelledError):
            await task

    with contextlib.suppress(Exception):
        run_async(_drain())


class _FakeRequest:
    """Minimal Request stand-in — the cancel endpoint only touches `.app.state` and `await .json()`."""

    def __init__(self, app, body):
        self.app = app
        self._body = body

    async def json(self):
        if self._body is _NO_BODY:
            raise ValueError("no request body")  # what Starlette raises for an empty body
        return self._body


def _reserved_handle(c, thread_id: str = "thread-a"):
    from app.services.agent.turns import reserve

    handle = reserve(c.app.state.turns, thread_id, "chat")
    handle.task = _pending_task()
    return handle


def _cancel(c, thread_id: str, body):
    from app.api.agent import cancel_turn_endpoint

    return run_async(cancel_turn_endpoint(thread_id, _FakeRequest(c.app, body)))


def test_a6_mismatched_turn_id_does_not_cancel() -> None:
    with _workspace(), _client() as c:
        handle = _reserved_handle(c)
        try:
            out = _cancel(c, handle.thread_id, {"turn_id": "some-other-turn"})
            assert out == {"cancelled": False, "active": True, "turn_id": handle.turn_id}
            assert not handle.task.done()  # the live successor task was NOT cancelled
        finally:
            _drop_task(handle.task)


def test_a6_matching_turn_id_cancels() -> None:
    with _workspace(), _client() as c:
        handle = _reserved_handle(c)
        try:
            out = _cancel(c, handle.thread_id, {"turn_id": handle.turn_id})
            assert out["cancelled"] is True
            assert handle.task.cancelled()  # the named turn was cancelled
        finally:
            _drop_task(handle.task)


def test_a6_absent_body_is_legacy_unscoped_cancel() -> None:
    with _workspace(), _client() as c:
        handle = _reserved_handle(c)
        try:
            out = _cancel(c, handle.thread_id, _NO_BODY)  # empty body → legacy behaviour
            assert out["cancelled"] is True
            assert handle.task.cancelled()
        finally:
            _drop_task(handle.task)


def test_a6_no_live_turn_reports_inactive() -> None:
    with _workspace(), _client() as c:
        out = _cancel(c, "no-such-thread", {"turn_id": "whatever"})
        assert out == {"cancelled": False, "active": False}


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
