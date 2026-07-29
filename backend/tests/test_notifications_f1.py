"""F1 — the notifications config section + its thin always-on read.

The whole delivery mechanism is client-side (the PWA's Notifications API), so the backend's entire
contribution is: hold the preference, hand it to the client cheaply, and round-trip it through the
one settings write path. That is exactly what this pins.

Runs as `python tests/test_notifications_f1.py` from backend/ (plain asserts + a __main__ runner) or
under pytest. Config writes go to a temp `CTRLB_CONFIG` — never the operator's real config.yaml.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

from app.config import Settings, load_settings

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


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
