"""D47 Slice 1 — multi-homed host addressing: the `host_addresses` resolver, the shared SSH
connect-failover loop, and the typed `SshResult.kind` category.

Runs as `python tests/test_multihome_d47.py` from backend/ (plain asserts + a __main__ runner) or
under pytest. No real SSH: the failover tests fake the per-candidate run callable, and the
`SshResult.kind` tests monkeypatch paramiko's client so `run_command` takes each `except` arm.
"""

from __future__ import annotations

import asyncio
import socket

from app.adapters import ssh
from app.adapters.ssh import SshResult
from app.domain.enums import OSType
from app.domain.host import Host, host_addresses
from app.services.actions import build_registry
from app.services.actions._common import SSH_CONNECT_TIMEOUT_S, run_ssh_failover


def _host(*, ip: str = "192.168.1.10", vpn_host: str | None = None, prefer_vpn: bool = False) -> Host:
    return Host(id="h", name="h", ip=ip, vpn_host=vpn_host, ssh_prefer_vpn=prefer_vpn, os_type=OSType.LINUX)


# --------------------------------------------------------------------------- resolver


def test_resolver_order_and_flip() -> None:
    """Default is LAN>VPN `[ip, vpn_host]`; `prefer_vpn` flips to `[vpn_host, ip]` — the single
    source of truth for the preference."""
    h = _host(ip="10.0.0.1", vpn_host="corsair")
    assert host_addresses(h, False) == ["10.0.0.1", "corsair"]
    assert host_addresses(h, True) == ["corsair", "10.0.0.1"]


def test_resolver_no_vpn_is_just_ip() -> None:
    """A host with no `vpn_host` yields exactly `[ip]` — today's behavior, either direction."""
    h = _host(ip="10.0.0.1", vpn_host=None)
    assert host_addresses(h, False) == ["10.0.0.1"]
    assert host_addresses(h, True) == ["10.0.0.1"]


def test_resolver_blank_collapse_and_dedupe() -> None:
    """Blank/whitespace `vpn_host` collapses to `[ip]`; a `vpn_host` equal to `ip` de-duplicates
    (preserving first-seen order)."""
    assert host_addresses(_host(ip="10.0.0.1", vpn_host="   "), False) == ["10.0.0.1"]
    assert host_addresses(_host(ip="10.0.0.1", vpn_host=""), True) == ["10.0.0.1"]
    assert host_addresses(_host(ip="10.0.0.1", vpn_host="10.0.0.1"), True) == ["10.0.0.1"]


# --------------------------------------------------------------------------- failover loop


def _run_failover(host: Host, results: dict[str, SshResult]) -> tuple[SshResult, list[str]]:
    """Drive `run_ssh_failover` with a fake run callable that returns a pre-canned result per address
    and records the addresses actually attempted (order = failover order)."""
    tried: list[str] = []

    def run(address: str, timeout: float) -> SshResult:
        assert timeout == SSH_CONNECT_TIMEOUT_S  # the short per-candidate connect timeout is used
        tried.append(address)
        return results[address]

    res = asyncio.run(run_ssh_failover(host, run))
    return res, tried


def test_failover_advances_on_connect() -> None:
    """Candidate 1 fails with a `connect` error → candidate 2 is tried and its result surfaces."""
    h = _host(ip="10.0.0.1", vpn_host="corsair")  # LAN>VPN
    res, tried = _run_failover(
        h,
        {
            "10.0.0.1": SshResult(ok=False, error="timed out", kind="connect"),
            "corsair": SshResult(ok=True, stdout="done", kind="ok"),
        },
    )
    assert tried == ["10.0.0.1", "corsair"]  # both attempted, in order
    assert res.ok and res.stdout == "done"


def test_failover_stops_on_auth() -> None:
    """Candidate 1 fails with `auth` (connected + wrong password) → NO second attempt; auth surfaces."""
    h = _host(ip="10.0.0.1", vpn_host="corsair")
    res, tried = _run_failover(
        h,
        {
            "10.0.0.1": SshResult(ok=False, error="authentication failed", kind="auth"),
            "corsair": SshResult(ok=True, stdout="SHOULD NOT RUN", kind="ok"),
        },
    )
    assert tried == ["10.0.0.1"]  # stopped after the auth failure — never tried the VPN address
    assert not res.ok and res.kind == "auth"


def test_failover_all_connect_returns_last() -> None:
    """Every candidate fails `connect` → the LAST candidate's result surfaces (all were tried)."""
    h = _host(ip="10.0.0.1", vpn_host="corsair", prefer_vpn=True)  # VPN>LAN order
    res, tried = _run_failover(
        h,
        {
            "corsair": SshResult(ok=False, error="no route", kind="connect"),
            "10.0.0.1": SshResult(ok=False, error="refused-last", kind="connect"),
        },
    )
    assert tried == ["corsair", "10.0.0.1"]
    assert not res.ok and res.error == "refused-last"  # the last candidate's result


def test_failover_prefers_vpn_first_when_flagged() -> None:
    """`ssh_prefer_vpn=True` makes the VPN address the FIRST attempt (Corsair's firewalled-LAN case)."""
    h = _host(ip="10.0.0.1", vpn_host="corsair", prefer_vpn=True)
    res, tried = _run_failover(h, {"corsair": SshResult(ok=True, stdout="ok", kind="ok")})
    assert tried == ["corsair"] and res.ok  # VPN tried first and succeeded — LAN never attempted


# --------------------------------------------------------------------------- SshResult.kind


class _FakeStream:
    """A paramiko channel-file stand-in whose `read` returns data or raises (read-phase failures)."""

    def __init__(self, *, data: bytes = b"", exc: BaseException | None = None) -> None:
        self._data = data
        self._exc = exc

    def read(self) -> bytes:
        if self._exc is not None:
            raise self._exc
        return self._data


class _FakeClient:
    """Stand-in for paramiko.SSHClient. `connect_exc` raises during the connect PHASE; `read_exc`
    lets `connect` succeed but makes the stdout READ raise (a slow-but-connected command)."""

    def __init__(
        self, *, connect_exc: BaseException | None = None, read_exc: BaseException | None = None
    ) -> None:
        self._connect_exc = connect_exc
        self._read_exc = read_exc

    def set_missing_host_key_policy(self, _policy: object) -> None:
        pass

    def connect(self, *_a: object, **_k: object) -> None:
        if self._connect_exc is not None:
            raise self._connect_exc

    def exec_command(self, _command: str, timeout: float | None = None) -> tuple[object, object, object]:
        return _FakeStream(), _FakeStream(exc=self._read_exc), _FakeStream()

    def close(self) -> None:
        pass


def _connect_kind_for(monkeypatch, exc: BaseException) -> str:
    """`kind` when `exc` is raised during the CONNECT phase."""
    import paramiko

    monkeypatch.setattr(paramiko, "SSHClient", lambda: _FakeClient(connect_exc=exc))
    return ssh.run_command(host="h", port=22, username="u", password="p", command="x").kind


def test_sshresult_kind_per_exception(monkeypatch) -> None:
    """Each CONNECT-phase exception CLASS maps to its category — the failover loop dispatches on this,
    never on string-sniffing. AuthenticationException MUST be caught as `auth` even though it
    subclasses SSHException (it's listed first in the adapter). A `socket.timeout` DURING connect is
    still the retryable `connect` class (it subclasses OSError, pre-connect)."""
    import paramiko

    assert _connect_kind_for(monkeypatch, paramiko.AuthenticationException("bad")) == "auth"
    assert _connect_kind_for(monkeypatch, paramiko.SSHException("proto")) == "ssh"
    assert _connect_kind_for(monkeypatch, OSError("unreachable")) == "connect"  # the failover class
    assert _connect_kind_for(monkeypatch, socket.timeout("connect timed out")) == "connect"


def test_read_timeout_is_ssh_not_connect_and_no_failover(monkeypatch) -> None:
    """The core review defect: a `socket.timeout` during the READ phase of a slow-but-connected
    command (e.g. `docker restart`'s graceful stop) is classified `ssh` — NOT `connect` — so the
    failover loop never RE-EXECUTES the command on the next address (a double-restart footgun)."""
    import paramiko

    monkeypatch.setattr(paramiko, "SSHClient", lambda: _FakeClient(read_exc=socket.timeout("read timed out")))
    h = _host(ip="10.0.0.1", vpn_host="corsair")  # two candidates available
    tried: list[str] = []

    def run(address: str, connect_timeout: float) -> SshResult:
        assert connect_timeout == SSH_CONNECT_TIMEOUT_S  # forwarded as the connect-phase bound
        tried.append(address)
        return ssh.run_command(
            host=address, port=22, username="u", password="p", command="x", connect_timeout=connect_timeout
        )

    res = asyncio.run(run_ssh_failover(h, run))
    assert res.kind == "ssh" and not res.ok  # post-connect read failure → ssh, not the failover class
    assert tried == ["10.0.0.1"]  # NO second candidate — the command may already have run


def test_sshresult_kind_defaults_ok() -> None:
    """A freshly-constructed success result is `kind == "ok"` (the default at the success site)."""
    assert SshResult(ok=True).kind == "ok"


# --------------------------------------------------------------------------- regression pin


def test_shutdown_still_forced_confirm() -> None:
    """D44 regression pin: `shutdown_host` stays `confirm=True` (forced-confirm, approval-immune) —
    server-side failover must not alter the confirm gate (D47 interplay note)."""
    reg = build_registry()
    assert reg.get("shutdown_host").spec.confirm is True


if __name__ == "__main__":

    class _MonkeyPatch:
        """Tiny pytest-monkeypatch stand-in for the __main__ runner (setattr + auto-undo)."""

        def __init__(self) -> None:
            self._undo: list[tuple[object, str, object]] = []

        def setattr(self, target: object, name: str, value: object) -> None:
            self._undo.append((target, name, getattr(target, name)))
            setattr(target, name, value)

        def undo(self) -> None:
            for target, name, old in reversed(self._undo):
                setattr(target, name, old)
            self._undo.clear()

    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        params = fn.__code__.co_varnames[: fn.__code__.co_argcount]
        if "monkeypatch" in params:
            mp = _MonkeyPatch()
            try:
                fn(mp)
            finally:
                mp.undo()
        else:
            fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
