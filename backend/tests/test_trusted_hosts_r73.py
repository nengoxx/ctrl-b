"""`server.trusted_hosts` — the `Host` allowlist, i.e. the anti-DNS-rebinding rail (R73 §4,
SECURITY_MODEL §2.9).

Why it exists at all: the owner-file write paths are defended by their VERB (a raw-body `PUT` cannot
be emitted cross-origin without a preflight this app never answers). Rebinding does not defeat that
rail, it removes its premise — the attacker's page re-resolves their own name to this address, so the
request is genuinely same-origin. The one thing they never control is the name in `Host`.

Four properties, and each one is a way the feature could be silently wrong rather than merely absent:

  1. **Empty ⇒ NOT MOUNTED.** An empty allowlist that IS mounted matches nothing and 400s every
     request, the Conf UI included — "off" must mean no middleware, not a middleware that says no.
  2. **Mounted ⇒ an unlisted name is 400 and a listed one passes**, with `*.suffix` honoured.
  3. **WebSockets are covered too**, which is the half a CORS-shaped mental model would miss.
  4. **A malformed pattern refuses at the CONFIG GATE.** Starlette `assert`s on a bad wildcard inside
     `__init__`, which at import time is an `AssertionError` with no config path in it; the value has
     to die in `load_settings` with a sentence instead.

Everything runs on a temp `$CTRLB_HOME`/`CTRLB_CONFIG` — never the operator's real config.yaml.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.testclient import WebSocketDenialResponse
from starlette.websockets import WebSocketDisconnect
from test_media_g5 import home, make_client

from app.config import ConfigValidationError, load_settings

__all__ = ["home"]  # the fixture is imported, not redefined — one temp-workspace recipe


def configure(home: Path, *hosts: str) -> None:
    """Write the temp workspace's whole config with this allowlist — BEFORE `make_client` builds the
    app (the mount happens at construction: `add_middleware` raises once an app has started).

    WHOLE, not appended: the seed already carries a `server:` block, and a second one is a duplicate
    top-level key that the migration's ruamel reader refuses at the import-time preflight (exit 78) —
    where PyYAML's last-wins would have hidden it until some other test imported `app.main` first."""
    listed = ", ".join(f"'{h}'" for h in hosts)
    (home / "config.yaml").write_text(
        f"server:\n  port: 5433\n  trusted_hosts: [{listed}]\n", encoding="utf-8"
    )


def mounted(client) -> bool:
    return any(m.cls is TrustedHostMiddleware for m in client.app.user_middleware)


def test_an_empty_list_mounts_nothing_and_admits_every_name(home: Path) -> None:
    """The shipped default. Not "mounted with an empty allowlist" — that is a middleware whose
    allowlist matches no name, i.e. a 400 on every route including the one the owner would use to fix
    it. The `if hosts:` guard in `_mount_trusted_hosts` is what makes off mean off."""
    with make_client() as c:
        assert not mounted(c)
        assert c.get("/api/health", headers={"host": "anything.example"}).status_code == 200


def test_an_unlisted_host_is_400_and_a_listed_one_passes(home: Path) -> None:
    """The rail itself. The port is not part of the comparison (Starlette splits it off), which is
    why the config gate refuses a `:` in a pattern rather than letting one silently never match."""
    configure(home, "testserver", "emma", "127.0.0.1")
    with make_client() as c:
        assert mounted(c)
        assert c.get("/api/health").status_code == 200  # TestClient's own Host is `testserver`
        assert c.get("/api/health", headers={"host": "emma:5433"}).status_code == 200
        assert c.get("/api/health", headers={"host": "127.0.0.1:5433"}).status_code == 200
        refused = c.get("/api/health", headers={"host": "rebound.evil.example"})
        assert refused.status_code == 400 and "Invalid host header" in refused.text
        # …and no redirect answer exists (`www_redirect=False`): an unlisted name gets ONE answer,
        # never a 307 echoing a client-supplied name back in `Location`.
        assert refused.status_code != 307


def test_a_leading_wildcard_matches_a_suffix(home: Path) -> None:
    """The one pattern shape Starlette supports, and the one the tailnet actually wants: the ts.net
    name is issued by Tailscale, so pinning the suffix survives a tailnet rename."""
    configure(home, "*.ts.net")
    with make_client() as c:
        assert c.get("/api/health", headers={"host": "emma.lobster-vector.ts.net"}).status_code == 200
        assert c.get("/api/health", headers={"host": "emma.ts.net.evil.example"}).status_code == 400


def test_the_websocket_scope_is_covered_too(home: Path) -> None:
    """The half a CORS-shaped intuition misses: there is no preflight on an upgrade, so the `Origin`
    check in `api/voice.py` was all the WS had. Starlette's middleware admits `http` AND `websocket`
    scopes, so an unlisted name is refused BEFORE routing.

    Both arms are asserted, because the refusing one alone would pass vacuously — this socket also
    fails to open on its own Origin rail. The two failures are different objects and that difference
    IS the property: a denial RESPONSE (400, no handshake, the middleware answered) versus a
    disconnect (the handshake reached the route, which then closed it on its own terms)."""
    configure(home, "testserver")
    with make_client() as c:
        with pytest.raises(WebSocketDenialResponse) as denied:
            with c.websocket_connect("/api/voice/live", headers={"host": "rebound.evil.example"}):
                pass  # pragma: no cover — the connect must not succeed
        assert denied.value.status_code == 400  # it IS the response — no handshake ever happened

        # The listed name gets PAST the middleware and is answered by the route instead. Asserted as
        # "NOT a denial": `WebSocketDenialResponse` subclasses `WebSocketDisconnect`, so catching the
        # base class alone would accept the very outcome this arm exists to exclude.
        with pytest.raises(WebSocketDisconnect) as closed:
            with c.websocket_connect("/api/voice/live"):
                pass  # pragma: no cover — the route closes it; reaching the route is the point
        assert not isinstance(closed.value, WebSocketDenialResponse)


@pytest.mark.parametrize(
    ("pattern", "why"),
    [
        ("*.evil.*.net", "a wildcard past the first position — Starlette asserts on it"),
        ("*emma", "a wildcard that is not the `*.` prefix form"),
        ("emma:5433", "a port, which the matcher strips off the Host before comparing"),
        ("*", "allow-everything, i.e. the rail silently off while the config reads as on"),
        ("   ", "an empty entry"),
    ],
)
def test_a_malformed_pattern_refuses_at_the_config_gate(home: Path, pattern: str, why: str) -> None:
    """Each of these would otherwise be discovered at IMPORT — as an `AssertionError` from inside
    Starlette (no config path, no remedy, and in the unit a crash-loop rather than exit 78) or, worse
    for `*`, not at all. `load_settings` is the gate the import-time preflight runs, so refusing here
    is refusing before the app object exists."""
    configure(home, pattern)
    with pytest.raises(ConfigValidationError) as exc:
        load_settings()
    assert "trusted_hosts" in str(exc.value), why
