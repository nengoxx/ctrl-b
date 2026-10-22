"""ISS-98 — redaction once, at the egress funnel (`ActionService._record`), + the `redact.min_len` floor.

What's exercised:
  1. `redact` — nested secrets leave no remnant (either order) · the JSON-escaped form is masked inside
     `json.dumps` text · the straddle rule (a secret cut before `TRUNCATION_MARKER` is masked at ≥ 4
     chars, untouched at 3; no marker → no tail masking) · idempotent.
  2. `clip` at / below / above the limit; `redact_result` over summary/output/error and nested `data`.
  3. The funnel proof — a dummy tool returning a config secret in every field, and one raising with it,
     through the REAL `invoke`: the returned result AND the recorded Event carry no secret.
  4. ISS-98 proper — the open-terminal tools with a fake client echoing `open_terminal.api_key`:
     exec output, read_file output + `data["content"]`, grep JSON output + `data`, an
     `OpenTerminalError` → `error`, a secret across the 6000-char clip, and a REAL client's 401 body
     echoing the key across its 200-char detail cut (`openterminal.py`).
  5. Through the agent path — one agent turn calling `terminal_read_file` persists no secret.
  6. The floor — `Settings.secret_values()` / `short_secret_paths()` (incl. the `Bearer` split).

Each test runs against its own temp config/db (`CTRLB_CONFIG`/`CTRLB_DB`); the real config is never read.
"""

from __future__ import annotations

import contextlib
import json

import yaml
from _async import run_async
from _tools import _AnyArgs

from app.core.redact import _MASK, TRUNCATION_MARKER, clip, redact, redact_result
from app.domain.event import ORIGIN_USER_CHAT

SECRET = "tok-ABCDEF123456"  # 16 chars — above the default floor
_TERMINAL_TOOLS = (
    "terminal_exec",
    "terminal_read_file",
    "terminal_list",
    "terminal_grep",
    "terminal_glob",
    "terminal_write_file",
)


# ── 1. redact ─────────────────────────────────────────────────────────────────────────────────────
def test_nested_secrets_leave_no_remnant_in_either_order() -> None:
    text = "a=abc b=abcdef"
    for secrets in (["abc", "abcdef"], ["abcdef", "abc"]):
        out = redact(text, secrets)
        assert out == f"a={_MASK} b={_MASK}", (secrets, out)
        assert "def" not in out


def test_the_json_escaped_form_is_masked() -> None:
    secret = 'pa"ss\\word99'
    text = json.dumps({"echo": f"x {secret} y"})
    assert json.dumps(secret)[1:-1] in text and secret not in text  # only the escaped form is present
    out = redact(text, [secret])
    assert json.dumps(secret)[1:-1] not in out and _MASK in out


def test_the_straddle_rule() -> None:
    secret = "abcdefghij"
    for n in (4, 5, len(secret) - 1):
        out = redact("head " + secret[:n] + TRUNCATION_MARKER, [secret])
        assert out == "head " + _MASK + TRUNCATION_MARKER, (n, out)
    three = "head " + secret[:3] + TRUNCATION_MARKER
    assert redact(three, [secret]) == three  # a 3-char lead is not a disclosure
    no_marker = "head " + secret[:6]
    assert redact(no_marker, [secret]) == no_marker  # no cut → no tail masking
    once = redact("head " + secret[:6] + TRUNCATION_MARKER, [secret])
    assert redact(once, [secret]) == once  # idempotent


def test_blank_and_none_secrets_are_ignored() -> None:
    assert redact("plain text", [None, "", "zzz-not-there"]) == "plain text"
    assert redact(None, [SECRET]) is None and redact("", [SECRET]) == ""


# ── 2. clip + redact_result ───────────────────────────────────────────────────────────────────────
def test_clip_at_below_and_above_the_limit() -> None:
    assert clip("abcd", 5) == "abcd"
    assert clip("abcde", 5) == "abcde"
    assert clip("abcdef", 5) == "abcde" + TRUNCATION_MARKER


def test_redact_result_masks_every_text_field_and_nested_data() -> None:
    from app.domain.enums import RunState
    from app.domain.result import Artifact, ToolResult

    result = ToolResult(
        state=RunState.OK,
        summary=f"s {SECRET}",
        output=f"o {SECRET}",
        error=f"e {SECRET}",
        data={"a": [{"b": f"…{SECRET}…"}], "n": 5, "k": None, "state": RunState.OK, SECRET: "key stays"},
        artifacts=[Artifact(name=f"{SECRET}.json")],
    )
    redact_result(result, [SECRET])
    assert SECRET not in result.summary + (result.output or "") + (result.error or "")
    assert result.data["a"] == [{"b": f"…{_MASK}…"}]
    assert result.data["n"] == 5 and result.data["k"] is None
    assert result.data["state"] is RunState.OK  # a str-enum value with no secret in it passes as is
    assert result.data[SECRET] == "key stays"  # keys are structure, untouched
    assert result.artifacts[0].name == f"{SECRET}.json"  # a download name/path is never rewritten


# ── shared app harness ────────────────────────────────────────────────────────────────────────────
@contextlib.contextmanager
def _app(tmp_path, monkeypatch, config: dict | None = None):
    from fastapi.testclient import TestClient

    from app.main import create_app

    cfg = tmp_path / "config.yaml"
    cfg.write_text(yaml.safe_dump({"server": {"port": 5433}, **(config or {})}), encoding="utf-8")
    monkeypatch.setenv("CTRLB_CONFIG", str(cfg))
    monkeypatch.setenv("CTRLB_DB", str(tmp_path / "t.db"))
    with TestClient(create_app()) as c:
        yield c


def _blob(result) -> str:
    """Every field `redact_result` covers, as one string to search."""
    return " ".join([result.summary, result.output or "", result.error or "", json.dumps(result.data)])


# ── 3. the funnel proof ───────────────────────────────────────────────────────────────────────────
def test_invoke_redacts_every_outcome_and_its_audit_row(tmp_path, monkeypatch) -> None:
    from app.core.tool import FunctionTool, ToolSpec
    from app.domain.enums import Actor, Privilege, RunState
    from app.domain.result import ToolResult

    async def leaky(inp, ctx):  # noqa: ANN001
        key = ctx.deps.settings.open_terminal.api_key
        return ToolResult(
            state=RunState.ERROR,
            summary=f"s {key}",
            output=f"o {key}",
            error=f"e {key}",
            data={"nested": [{"v": key}], "n": 1},
        )

    async def raising(inp, ctx):  # noqa: ANN001
        raise RuntimeError(f"boom {ctx.deps.settings.open_terminal.api_key}")

    with _app(tmp_path, monkeypatch, {"open_terminal": {"api_key": SECRET}}) as c:
        registry = c.app.state.actions.registry
        for name, fn in (("leaky_iss98", leaky), ("raising_iss98", raising)):
            spec = ToolSpec(name=name, title=name, category="builtin", input_model=_AnyArgs)
            registry.register(FunctionTool(spec=spec, fn=fn))
        try:
            for name in ("leaky_iss98", "raising_iss98"):
                out = run_async(
                    c.app.state.actions.invoke(
                        name, {}, origin=ORIGIN_USER_CHAT, actor=Actor.AGENT, privilege=Privilege.FULL
                    )
                )
                assert out.result is not None and out.event is not None
                assert SECRET not in _blob(out.result), name
                assert _MASK in _blob(out.result), name  # it WAS there, and was masked
                (row,) = [e for e in run_async(c.app.state.events.recent(50)) if e.id == out.event.id]
                assert SECRET not in (row.summary or "") + (row.output or ""), name
        finally:
            registry.remove("leaky_iss98")
            registry.remove("raising_iss98")


# ── 4. ISS-98 proper: the open-terminal tools ─────────────────────────────────────────────────────
class _FakeTerminal:
    """A configured open-terminal client whose every answer echoes the secret back."""

    configured = True

    def __init__(self, secret: str, *, raise_with: str | None = None, pad: int = 0) -> None:
        self.secret, self.raise_with, self.pad = secret, raise_with, pad

    def _maybe_raise(self) -> None:
        from app.adapters.openterminal import OpenTerminalError

        if self.raise_with is not None:
            raise OpenTerminalError(self.raise_with)

    async def execute(self, command, *, cwd=None):  # noqa: ANN001
        self._maybe_raise()
        data = "x" * self.pad + f"echo {self.secret}"
        return {"id": "p1", "status": "done", "exit_code": 0, "output": [{"type": "stdout", "data": data}]}

    async def read_file(self, path, *, start_line=None, end_line=None):  # noqa: ANN001
        self._maybe_raise()
        return {"path": path, "content": f"API_KEY={self.secret}\n"}

    async def grep(self, query, **_kw):  # noqa: ANN001
        self._maybe_raise()
        return {"matches": [{"file": ".env", "line": 1, "text": f"API_KEY={self.secret}"}]}


@contextlib.contextmanager
def _terminal_app(tmp_path, monkeypatch, secret: str = SECRET):
    """An app with the open-terminal tools registered (they register once at startup, into the
    process-global registry) — removed again on exit unless an earlier app had already registered them."""
    from app.core.tool import UnknownTool
    from app.services.actions import build_registry

    registry = build_registry()
    before = set()
    for name in _TERMINAL_TOOLS:
        with contextlib.suppress(UnknownTool):
            registry.get(name)
            before.add(name)
    config = {"open_terminal": {"base_url": "http://terminal.invalid:9", "api_key": secret}}
    try:
        with _app(tmp_path, monkeypatch, config) as c:
            yield c
    finally:
        for name in set(_TERMINAL_TOOLS) - before:
            registry.remove(name)


def _run_tool(c, name: str, args: dict, client):
    from app.domain.enums import Actor, Privilege

    c.app.state.actions._deps.open_terminal = client
    out = run_async(
        c.app.state.actions.invoke(
            name, args, origin=ORIGIN_USER_CHAT, actor=Actor.AGENT, privilege=Privilege.FULL
        )
    )
    assert out.result is not None
    return out.result


def test_terminal_tools_never_return_the_api_key(tmp_path, monkeypatch) -> None:
    from app.domain.enums import RunState

    with _terminal_app(tmp_path, monkeypatch) as c:
        fake = _FakeTerminal(SECRET)
        ex = _run_tool(c, "terminal_exec", {"command": "env"}, fake)
        assert ex.state == RunState.OK and SECRET not in _blob(ex) and _MASK in (ex.output or "")

        rd = _run_tool(c, "terminal_read_file", {"path": ".env"}, fake)
        assert SECRET not in (rd.output or "") and SECRET not in rd.data["content"]
        assert _MASK in rd.data["content"]

        gr = _run_tool(c, "terminal_grep", {"query": "API_KEY"}, fake)
        assert SECRET not in (gr.output or "") and SECRET not in json.dumps(gr.data)

        err = _run_tool(
            c, "terminal_exec", {"command": "x"}, _FakeTerminal(SECRET, raise_with=f"bad {SECRET}")
        )
        assert err.state == RunState.ERROR and SECRET not in (err.error or "") and _MASK in (err.error or "")


def test_a_key_cut_by_the_output_clip_is_still_masked(tmp_path, monkeypatch) -> None:
    from app.services.actions.terminal import _MAX_OUTPUT_CHARS

    # `echo ` + the key starts 10 chars before the clip, so the cut keeps exactly the key's first 5.
    pad = _MAX_OUTPUT_CHARS - len("echo ") - 5
    with _terminal_app(tmp_path, monkeypatch) as c:
        res = _run_tool(c, "terminal_exec", {"command": "env"}, _FakeTerminal(SECRET, pad=pad))
        out = res.output or ""
        assert out.endswith(TRUNCATION_MARKER)
        assert SECRET[:5] not in out[-40:] and out.endswith(_MASK + TRUNCATION_MARKER)


def test_a_401_body_echoing_the_key_across_the_detail_cut_is_masked(tmp_path, monkeypatch) -> None:
    """`openterminal.py`'s non-JSON error body is cut at 200 chars; the key straddles that cut."""
    import httpx

    from app.adapters.openterminal import OpenTerminalClient
    from app.config import OpenTerminalCfg

    body = "y" * (200 - 6) + SECRET + " rejected"  # the 200-char cut keeps exactly the key's first 6
    transport = httpx.MockTransport(lambda req: httpx.Response(401, text=body))
    with _terminal_app(tmp_path, monkeypatch) as c:
        client = OpenTerminalClient(OpenTerminalCfg(base_url="http://terminal.invalid:9", api_key=SECRET))
        client._client = httpx.AsyncClient(base_url="http://terminal.invalid:9", transport=transport)
        res = _run_tool(c, "terminal_exec", {"command": "env"}, client)
        run_async(client._client.aclose())
    err = res.error or ""
    assert err.startswith("HTTP 401") and err.endswith(_MASK + TRUNCATION_MARKER)
    assert SECRET[:6] not in err


# ── 5. through the agent path ─────────────────────────────────────────────────────────────────────
def test_an_agent_turn_persists_no_secret(tmp_path, monkeypatch) -> None:
    from app.adapters.inference import ChatDelta, ToolCallRequest
    from app.domain.conversation import Thread
    from app.services.agent.session import AgentSession

    with _terminal_app(tmp_path, monkeypatch) as c:
        s = c.app.state
        s.actions._deps.open_terminal = _FakeTerminal(SECRET)
        agent = s.settings.resolve_agent(None).model_copy(update={"max_parallel_tools": 1})
        session = AgentSession(
            s.threads, s.messages, s.inference, s.settings, s.actions, agent, interactive=True
        )
        thread = run_async(s.threads.create(Thread()))
        scripts = [
            [
                ChatDelta(
                    tool_calls=[
                        ToolCallRequest(id="r1", name="terminal_read_file", arguments='{"path":".env"}')
                    ]
                )
            ],
            [ChatDelta(text="done")],
        ]
        calls = {"n": 0}

        async def fake_stream(messages, **kw):
            idx = min(calls["n"], len(scripts) - 1)
            calls["n"] += 1
            for delta in scripts[idx]:
                yield delta

        async def never(_thread, **_kw):
            return False

        session._inference.stream_chat = fake_stream
        session._compactor.should_compact = never

        async def turn():
            return [ev async for ev in session.run_turn(thread, "read .env")]

        run_async(turn())
        rows = run_async(s.messages.list(thread.id))
    (result,) = [rp.result for m in rows for rp in m.tool_results()]
    assert result.data.get("content") and SECRET not in _blob(result)
    assert _MASK in (result.output or "")


# ── 6. the floor ──────────────────────────────────────────────────────────────────────────────────
def _settings(**sections):
    from app.config import Settings

    return Settings.model_validate(sections)


def test_the_floor_drops_short_values_and_names_their_paths() -> None:
    s = _settings(
        computers={
            "nuc": {"ip": "10.0.0.9", "os_type": "linux", "ssh_password": "seven77"},  # 7 chars
            "box": {"ip": "10.0.0.8", "os_type": "linux", "ssh_password": "eight888"},  # 8 chars
        },
        providers={"blank": {"base_url": "http://x.invalid", "api_key": " " * 8}},
    )
    assert s.secret_values() == ["eight888"]
    assert sorted(s.secret_values(min_len=1)) == ["eight888", "seven77"]  # the blank one never counts
    paths = s.short_secret_paths()
    assert paths == ["computers.nuc.ssh_password"]
    assert "seven77" not in " ".join(paths)


def test_an_auth_scheme_value_also_yields_its_bare_credential() -> None:
    long = _settings(
        mcp_servers=[{"name": "m", "command": "x", "headers": {"Authorization": "Bearer abcdefgh"}}]
    )
    assert set(long.secret_values()) == {"Bearer abcdefgh", "abcdefgh"}
    short = _settings(mcp_servers=[{"name": "m", "command": "x", "headers": {"Authorization": "Bearer abc"}}])
    assert short.secret_values() == ["Bearer abc"]  # the whole value is ≥ 8; the bare `abc` is not
    assert short.short_secret_paths() == ["mcp_servers.0.headers.Authorization"]
    tiny = _settings(
        mcp_servers=[{"name": "m", "command": "x", "headers": {"Authorization": "Token a"}}]
    )  # 7 chars
    assert tiny.secret_values() == []


def test_the_floor_is_a_config_key() -> None:
    from app.config import Settings

    assert Settings().redact.min_len == 8
    s = _settings(redact={"min_len": 4}, open_terminal={"api_key": "four"})
    assert s.secret_values() == ["four"] and s.short_secret_paths() == []
