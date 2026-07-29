"""F1 — the notifications config section, its thin always-on read, and the live event frame.

The whole delivery mechanism is client-side (the PWA's Notifications API), so the backend's entire
contribution is: hold the preference, hand it to the client cheaply, and round-trip it through the
one settings write path. That is exactly what this pins — plus the one wire change F1's review
prompted: the SSE frame's projection (the client's fleet-side notification source) drops `output`,
while `GET /api/events` stays the full canonical record.

Runs as `python tests/test_notifications_f1.py` from backend/ (plain asserts + a __main__ runner) or
under pytest. Config writes go to a temp `CTRLB_CONFIG` — never the operator's real config.yaml.
"""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
from pathlib import Path
from types import SimpleNamespace

from app.config import Settings, load_settings
from app.domain.enums import Actor, RunState
from app.domain.event import Event

_SEED = """\
# fixture fleet
server:
  port: 5433
computers:
  alpha:
    ip: 192.168.1.10
"""


def _client(tmp: Path):
    from fastapi.testclient import TestClient

    from app.main import create_app

    cfg = tmp / "config.yaml"
    cfg.write_text(_SEED, encoding="utf-8")
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    return TestClient(create_app()), cfg


# --------------------------------------------------------------------------- config model


def test_defaults_are_master_off_classes_on() -> None:
    """The owner's spam guard (ROADMAP F1 decided defaults): the FEATURE is off, but every event
    class is on — so enabling notifications does something useful without three more taps, and
    nothing can fire while `enabled` is False."""
    n = Settings().notifications
    assert n.enabled is False
    assert (n.events.agent_input, n.events.turn_done, n.events.action_failed) == (True, True, True)


def test_absent_section_loads_as_defaults() -> None:
    """A config written before F1 (no `notifications:` key at all) must load, not 422 — the section
    is purely additive, which is why it needs no migration step."""
    s = Settings.model_validate({"server": {"port": 5433}})
    assert s.notifications.enabled is False
    assert s.notifications.events.turn_done is True


def test_partial_events_block_keeps_the_other_defaults() -> None:
    """A hand-written config that names ONE class doesn't silently switch the others off."""
    s = Settings.model_validate({"notifications": {"enabled": True, "events": {"turn_done": False}}})
    assert s.notifications.enabled is True
    assert s.notifications.events.turn_done is False
    assert s.notifications.events.agent_input is True
    assert s.notifications.events.action_failed is True


# --------------------------------------------------------------------------- API round-trip


def test_get_notifications_and_put_roundtrip() -> None:
    """`GET /api/notifications` is the thin always-on read the engine gates on; `PUT /api/settings`
    is the one write path. A save must be visible on BOTH the thin read and a fresh load from disk."""
    tmp = Path(tempfile.mkdtemp())
    try:
        client, cfg = _client(tmp)
        with client as c:
            # thin read, before any write: the defaults, no masking, nothing else in the body
            r = c.get("/api/notifications")
            assert r.status_code == 200, r.text
            assert r.json() == {
                "enabled": False,
                "events": {"agent_input": True, "turn_done": True, "action_failed": True},
            }

            # write through the ordinary settings PUT
            r = c.put(
                "/api/settings",
                json={"notifications": {"enabled": True, "events": {"turn_done": False}}},
            )
            assert r.status_code == 200, r.text
            assert r.json()["settings"]["notifications"]["enabled"] is True

            # …visible on the thin read (hot-applied, no restart)…
            assert c.get("/api/notifications").json() == {
                "enabled": True,
                "events": {"agent_input": True, "turn_done": False, "action_failed": True},
            }
            # …and persisted, with the file's comments intact (the shared writer's contract)
            assert "# fixture fleet" in cfg.read_text(encoding="utf-8")
            reloaded = load_settings(cfg)
            assert reloaded.notifications.enabled is True
            assert reloaded.notifications.events.turn_done is False
            assert reloaded.notifications.events.agent_input is True
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


# --------------------------------------------------------------------------- the live event frame


def _drive_stream(event: Event) -> dict:
    """Run `stream_events`' generator far enough to yield ONE published event frame.

    Driven against the router's own async generator rather than a live TestClient stream (the same
    reason `test_wake_on_connect_d2b` does): the endpoint is an infinite loop whose first natural
    frame is a 15s keepalive, so an HTTP-level assertion would either hang or pin a timing constant.
    The first `is_disconnected()` check publishes (the generator is inside `bus.subscribe()` by then)
    and returns False; the second ends the loop. `schedule` is stubbed out so the D2-B trigger doesn't
    spawn a task against this skeleton app.
    """
    import app.api.events as events_api
    from app.core.events import EventBus
    from app.services import wake_on_connect

    app = SimpleNamespace(state=SimpleNamespace(event_bus=EventBus()))

    class _FakeRequest:
        def __init__(self) -> None:
            self.app = app
            self._checks = 0

        async def is_disconnected(self) -> bool:
            self._checks += 1
            if self._checks == 1:
                app.state.event_bus.publish(event)
                return False
            return True

    async def drive() -> dict:
        response = await events_api.stream_events(_FakeRequest())  # type: ignore[arg-type]
        async for frame in response.body_iterator:
            if frame.get("event") == "event":
                return frame
        raise AssertionError("the stream never yielded an event frame")

    real_schedule = wake_on_connect.schedule
    try:
        wake_on_connect.schedule = lambda _app: None  # type: ignore[assignment]
        return asyncio.run(drive())
    finally:
        wake_on_connect.schedule = real_schedule  # type: ignore[assignment]


def test_stream_frame_omits_output_while_the_history_keeps_it() -> None:
    """The live frame is a "what happened" notification source — `hooks/useEvents` invalidates caches
    off it and projects action/target/status/summary into an F1 signal. `output` is the action's full
    (redacted, but up-to-`max_output_chars`) stdout, which no stream consumer reads: shipping it
    multiplies the bytes on a connection held open for the whole session. The canonical record is
    unchanged — `GET /api/events` still returns the field."""
    import app.api.events as events_api

    event = Event(
        actor=Actor.USER,
        action="run_shell",
        target="alpha",
        status=RunState.ERROR,
        summary="exit 1",
        output="x" * 4000,
    )

    frame = _drive_stream(event)
    assert frame["id"] == event.id
    data = json.loads(frame["data"])
    assert "output" not in data  # the whole point
    # …and everything the client DOES read is still there.
    assert (data["id"], data["action"], data["target"], data["status"], data["summary"]) == (
        event.id,
        "run_shell",
        "alpha",
        "error",
        "exit 1",
    )

    # The history endpoint's projection is untouched: same Event, full record.
    class _FakeEvents:
        async def recent(self, limit: int):
            return [event]

    req = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(events=_FakeEvents())))
    history = asyncio.run(events_api.list_events(req, limit=100))  # type: ignore[arg-type]
    assert history[0]["output"] == "x" * 4000


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
