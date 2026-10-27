"""ISS-101 (+ D, F) — the OpenAPI provider's `include` ids, path-value encoding, per-op isolation.

Driven through the REAL `OpenApiToolProvider.discover` / `.call` with an `httpx.MockTransport`
client (no network):

  A/B — `include` selects an operation by the tool name the catalog shows (`api__<server>__<id>`),
  by the bare id `_build_op` names the tool from (the operationId, or the `<method>_<path>`
  fallback computed from the lower-cased method), or by the raw path; registered names unchanged
  (they key `tool_overrides` + approvals).
  D — a path parameter is ONE segment: an empty / `.` / `..` value or one holding `/` or `\\` is
  refused before any request (it would re-route the request to a path the allowlist excluded — an
  encoded `%2F` is decoded by the server before routing, R25: proven against a real ASGI app); any
  other value is percent-encoded (space, `?` cannot add a query).
  F — a malformed operation beside a good one is skipped + counted (`skipped`), never raised; a spec
  that is not an object, or whose `paths` is not one, fails only its own server (R26).
"""

from __future__ import annotations

import logging

import httpx
import pytest
from _async import run_async

from app.adapters.openapi_tools import OpenApiToolProvider
from app.config import OpenApiServerCfg
from app.core.tool import ToolRegistry
from app.domain.enums import RunState

_BASE = "http://x/api"

_SPEC = {
    "paths": {
        "/users/{id}": {
            "get": {"parameters": [{"name": "id", "in": "path", "required": True}]},
        },
        "/items": {"post": {"operationId": "make.item"}},
        "/": {"get": {}},
        "/things": {"GET": {}},  # a non-conformant upper-case method key (ISS-101 B)
    }
}

_ALL = {"api__srv__get_users__id_", "api__srv__make_item", "api__srv__get_root", "api__srv__get_things"}


def _provider(spec: dict, include: list[str] | None = None, sent: list[str] | None = None):
    """A provider whose `srv` client is an `httpx.MockTransport`: the spec at `/api/openapi.json`,
    every other request answered `{"ok": true}` with its raw (still-encoded) path appended to `sent`."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/openapi.json":
            return httpx.Response(200, json=spec)
        if sent is not None:
            sent.append(request.url.raw_path.decode())
        return httpx.Response(200, json={"ok": True})

    server = OpenApiServerCfg(name="srv", base_url=_BASE, include=include or [])
    provider = OpenApiToolProvider([server])
    provider._clients["srv"] = httpx.AsyncClient(base_url=_BASE, transport=httpx.MockTransport(handler))
    return provider, server


def _discover(spec: dict, include: list[str] | None = None) -> tuple[set[str], list[dict]]:
    provider, _ = _provider(spec, include)
    reg = ToolRegistry()
    summary = run_async(provider.discover(reg))
    run_async(provider.aclose())
    return {t.spec.name for t in reg.all()}, summary


@pytest.mark.parametrize(
    ("include", "expected"),
    [
        (["api__srv__get_users__id_"], {"api__srv__get_users__id_"}),  # the name the catalog shows
        (["get_users_{id}"], {"api__srv__get_users__id_"}),  # the fallback id
        (["/users/{id}"], {"api__srv__get_users__id_"}),  # the raw path
        (["make.item"], {"api__srv__make_item"}),  # the operationId, with a char `_qualified` sanitizes
        (["api__srv__make_item"], {"api__srv__make_item"}),  # … and its sanitized catalog name
        (["get_root"], {"api__srv__get_root"}),  # the root op's fallback id
        (["get_things"], {"api__srv__get_things"}),  # B: the id is built from the LOWER-cased method
        (["nope"], set()),  # a non-matching entry registers nothing
        ([], _ALL),  # an empty include registers every operation
    ],
)
def test_include_matches_every_spelling_of_the_one_id(include: list[str], expected: set[str]) -> None:
    names, summary = _discover(_SPEC, include)
    assert names == expected
    assert summary == [{"server": "srv", "tools": len(expected), "skipped": 0, "error": None}]


def test_registered_names_are_unchanged() -> None:
    """The tool names key `tool_overrides` + approvals: the fix must not rename any of them."""
    names, _ = _discover(_SPEC)
    assert names == _ALL


def _call(args: dict) -> tuple[RunState, list[str], str | None]:
    sent: list[str] = []
    provider, server = _provider(_SPEC, sent=sent)
    reg = ToolRegistry()
    run_async(provider.discover(reg))
    tool = reg.get("api__srv__get_users__id_")
    res = run_async(provider.call(server, tool._op, args))  # type: ignore[attr-defined]
    run_async(provider.aclose())
    return res.state, sent, res.summary


@pytest.mark.parametrize("value", ["..", ".", "", "a/b", "../admin/wipe", "a\\b", "/"])
def test_a_value_that_is_not_one_segment_is_refused_before_any_request(value: str) -> None:
    state, sent, summary = _call({"id": value})
    assert state is RunState.ERROR
    assert summary == "api__srv__get_users__id_ invalid path value"
    assert sent == []  # no request left the provider


@pytest.mark.parametrize(
    ("value", "wire"),
    [
        ("a b", "/api/users/a%20b"),
        ("x?all=1", "/api/users/x%3Fall%3D1"),  # cannot inject a query string
        ("a#b%c", "/api/users/a%23b%25c"),  # a fragment / an escape stays inside the segment
        (42, "/api/users/42"),
    ],
)
def test_path_values_are_percent_encoded(value: object, wire: str) -> None:
    state, sent, _ = _call({"id": value})
    assert state is RunState.OK
    assert sent == [wire]


@pytest.mark.parametrize(
    "bad_op",
    [
        {"parameters": None},
        {"parameters": [{"in": "path"}]},  # a parameter without `name`
    ],
    ids=["parameters-null", "param-without-name"],
)
def test_a_malformed_operation_is_skipped_beside_a_good_one(
    bad_op: dict, caplog: pytest.LogCaptureFixture
) -> None:
    spec = {"paths": {"/good": {"get": {"operationId": "good"}}, "/bad/{x}": {"post": bad_op}}}
    with caplog.at_level(logging.WARNING, logger="ctrlb.openapi"):
        names, summary = _discover(spec)  # must not raise
    assert names == {"api__srv__good"}
    assert summary == [{"server": "srv", "tools": 1, "skipped": 1, "error": None}]
    assert any("'srv'" in r.getMessage() and "POST /bad/{x}" in r.getMessage() for r in caplog.records)


def test_a_path_value_cannot_reach_an_excluded_route_on_a_real_server() -> None:
    """R25/R37: through a real Starlette router (`httpx.ASGITransport`), with only `getUser` included,
    path values that are empty, `.`, `..`, or contain `/` or `\\` are refused before any request, so
    a path value cannot add segments or traverse (Starlette decodes `%2F` before routing, so encoding
    alone would not do) — the EXCLUDED `/users/admin/wipe` handler's counter stays at zero for those.
    Which handler serves a legitimate single-segment value is the server's routing, not ctrl-b's."""
    from fastapi import FastAPI

    api = FastAPI()
    wiped: list[int] = []

    @api.get("/users/{id}", operation_id="getUser")
    def get_user(id: str) -> dict:
        return {"user": id}

    @api.get("/users/admin/wipe", operation_id="wipeAll")
    def wipe() -> dict:
        wiped.append(1)
        return {"wiped": True}

    base = "http://x"
    server = OpenApiServerCfg(name="srv", base_url=base, include=["getUser"])
    provider = OpenApiToolProvider([server])
    provider._clients["srv"] = httpx.AsyncClient(base_url=base, transport=httpx.ASGITransport(app=api))
    reg = ToolRegistry()
    run_async(provider.discover(reg))
    assert {t.spec.name for t in reg.all()} == {"api__srv__getUser"}
    op = reg.get("api__srv__getUser")._op  # type: ignore[attr-defined]
    for value in ("admin/wipe", "a\\b", "..", ""):
        res = run_async(provider.call(server, op, {"id": value}))
        assert res.state is RunState.ERROR, value
    ok = run_async(provider.call(server, op, {"id": "alice"}))
    # A literal `%2F` is itself encoded (`%252F`): the server decodes it ONCE, to the id it was.
    escaped = run_async(provider.call(server, op, {"id": "admin%2Fwipe"}))
    run_async(provider.aclose())
    assert ok.state is RunState.OK and ok.data == {"result": {"user": "alice"}}
    assert escaped.state is RunState.OK and escaped.data == {"result": {"user": "admin%2Fwipe"}}
    assert wiped == []  # the excluded handler never ran


def test_a_non_object_spec_fails_only_its_own_server() -> None:
    """R26: a spec that is a JSON list, or whose `paths` is not an object, must not raise out of
    `discover` — the list is that server's load error, the bad `paths` registers nothing; the good
    server beside them still registers its tools."""
    specs = {
        "good": {"paths": {"/do": {"get": {"operationId": "do_it"}}}},
        "listy": [{"paths": {}}],
        "badpaths": {"paths": 3, "components": {"schemas": 7}},
    }
    servers = [OpenApiServerCfg(name=n, base_url=f"http://{n}") for n in specs]
    provider = OpenApiToolProvider(servers)
    for n, spec in specs.items():
        transport = httpx.MockTransport(lambda _req, spec=spec: httpx.Response(200, json=spec))
        provider._clients[n] = httpx.AsyncClient(base_url=f"http://{n}", transport=transport)
    reg = ToolRegistry()
    summary = run_async(provider.discover(reg))  # must not raise
    run_async(provider.aclose())
    assert {t.spec.name for t in reg.all()} == {"api__good__do_it"}
    by = {e["server"]: e for e in summary}
    assert by["good"] == {"server": "good", "tools": 1, "skipped": 0, "error": None}
    assert by["listy"]["tools"] == 0 and "not a JSON object" in by["listy"]["error"]
    assert by["badpaths"] == {"server": "badpaths", "tools": 0, "skipped": 0, "error": None}


def _discover_servers(raw: dict[str, str]) -> tuple[set[str], dict[str, dict]]:
    """Discover several servers, each serving its spec as the given RAW JSON text (so a spec deeper
    than `json.dumps` could encode can still be served)."""
    servers = [OpenApiServerCfg(name=n, base_url=f"http://{n}") for n in raw]
    provider = OpenApiToolProvider(servers)
    for n, text in raw.items():
        transport = httpx.MockTransport(lambda _req, text=text: httpx.Response(200, text=text))
        provider._clients[n] = httpx.AsyncClient(base_url=f"http://{n}", transport=transport)
    reg = ToolRegistry()
    summary = run_async(provider.discover(reg))  # must not raise
    run_async(provider.aclose())
    return {t.spec.name for t in reg.all()}, {e["server"]: e for e in summary}


_GOOD = '{"paths": {"/do": {"get": {"operationId": "do_it"}}}}'


def test_a_falsy_non_object_spec_level_is_warned_not_swallowed(caplog: pytest.LogCaptureFixture) -> None:
    """R29: `components: []` / `paths: false` are not objects — warned about (not silently read as
    empty because they are falsy), and the good server beside them still registers."""
    raw = {"good": _GOOD, "emptylist": '{"components": [], "paths": false}'}
    with caplog.at_level(logging.WARNING, logger="ctrlb.openapi"):
        names, by = _discover_servers(raw)
    assert names == {"api__good__do_it"}
    assert by["emptylist"] == {"server": "emptylist", "tools": 0, "skipped": 0, "error": None}
    msgs = [r.getMessage() for r in caplog.records]
    assert any("'emptylist'" in m and "spec components is not an object" in m for m in msgs), msgs
    assert any("'emptylist'" in m and "spec paths is not an object" in m for m in msgs), msgs


def test_a_pathologically_deep_schema_fails_only_its_own_server() -> None:
    """R32: a ~1000-deep `components.schemas` makes the recursive `_rewrite_refs` raise
    `RecursionError` — that server's load error, never an abort of the whole discovery."""
    depth = 1000
    deep = '{"components": {"schemas": {"S": ' + '{"a": ' * depth + "1" + "}" * depth + "}}}"
    names, by = _discover_servers({"good": _GOOD, "deep": deep})
    assert names == {"api__good__do_it"}
    assert by["deep"]["tools"] == 0 and by["deep"]["error"]
