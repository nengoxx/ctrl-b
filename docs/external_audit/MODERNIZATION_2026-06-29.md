# Backend modernization audit (production code) — 2026-06-29

Owner-requested pass: find **deprecated/dead/inefficient code, old libraries/functions, outdated methodologies** in
the **program itself** (not the test framework), and bring it to current 2026 standards for Python 3.14. Method:
a full pattern scan of `backend/app/` + a 5-stream web-research validation of every dependency against current docs/
changelogs (sources at the end). **All findings verified against a real criterion** (ruff + the 229-test suite on
Python 3.11 *and* emma's native 3.14.4).

## Verdict: the production code was already modern — this is polish, not a rescue

The scan found **none** of the usual legacy smells in `app/`:
- **Pydantic v2 throughout** — zero v1 APIs (`.dict()`, `class Config`, `@validator`, `parse_obj` all absent); uses `model_config`.
- **FastAPI `lifespan`** (not the deprecated `@app.on_event`).
- **Modern typing** — builtin `list`/`dict` + `X | None`; **zero** `typing.Optional/List/Dict`.
- **Timezone-aware datetime** — `datetime.now(timezone.utc)`; no deprecated `utcnow()`.
- **asyncio** — `TaskGroup` for structured concurrency, `gather` for independent fan-out, `create_task` (strongly
  referenced + cancelled on shutdown), `wait_for` for timeouts.
- **httpx `AsyncClient`** (one long-lived, cached, closed at shutdown — the documented best practice).
- **OpenAI `AsyncOpenAI` `.chat.completions`/`.embeddings`** — correct for the OpenAI-compatible llama.cpp/OpenRouter
  endpoints (the Responses API is OpenAI-proprietary and would 404 there).

## ✅ Fixed this pass (commit `cd85a14`)

| Fix | Detail |
|---|---|
| **4 dead imports removed** | `copy` (openapi_tools), `pydantic.Field` (skills), `pydantic.ValidationError` (action_service), `ReasoningPart` (compaction). pyflakes-verified. |
| **MCP API migration** | `streamablehttp_client` → `streamable_http_client` (SDK-deprecated). **Not a rename** — the new API takes a pre-built `httpx.AsyncClient` instead of `headers`/`timeout` kwargs; same 3-tuple yield. The `DeprecationWarning` we kept hitting is gone. |
| **Dependency bumps** | fastapi `0.136.3→0.138.1` (0.137+ raises the Starlette floor for official 3.14 support; verified no `router.routes` use, the 0.137 breaking change) · sse-starlette `3.4.4→3.4.5` · openai `2.38.0→2.44.0` · **mcp `1.27.1→1.28.1` (exact pin caps the imminent breaking v2** — v2 drops the 3rd stream-tuple element) · ruamel.yaml `0.18.10→0.18.17`. |
| **ruff added** | The 2026 standard lint+format. Noqa-safe config (`E`/`F`/`I`, `E501` ignored — the verbose comments are intentional; `RUF100` not selected so existing `# noqa` are untouched). Applied its safe import-sort fixes; **`ruff check` is clean**. |

## ✅ Confirmed already-correct (no action needed)

- **Background sweep task** is stored on `app.state` (strong ref → not GC'd mid-run) **and** cancelled on shutdown.
- **`gather` host pings are safe** — `_ping` catches its own exceptions and returns a status, so no exception
  propagates (no need for `return_exceptions=True`).
- **No asyncio policy APIs** (`*EventLoopPolicy`, `get/set_event_loop_policy`) — already 3.16-safe (they're removed then).
- `wait_for()` is **not** deprecated in 3.14 (reimplemented on `asyncio.timeout()` since 3.12); `gather` is correct
  for independent fan-out. pydantic 2.13.4 + pydantic-settings 2.14.2 are the **current** stable (+ the GHSA patch).
  httpx 0.28.1, aiosqlite 0.22.1, paramiko 5.0.0 are current.

## ◻️ Optional / deferred (with reasoning — none blocks deploy)

- **`model_config = ConfigDict(...)` over a plain dict** — TypedDict catches mistyped config keys. Cosmetic, many
  call sites; low value → defer.
- **`model_validate_json` + module-level cached `TypeAdapter` in hot paths** — a real perf win (validate during the
  Rust-side parse; avoid re-compiling validators), but needs profiling to target. Defer until measured.
- **Drop sse-starlette for FastAPI's built-in `fastapi.sse`** (added 0.135.0, now the recommended SSE path) — a real
  option now that we're on 0.138, but it's an endpoint migration with its own testing. sse-starlette works; defer +
  note. (If migrating: keep `await request.is_disconnected()` in the generator.)
- **`ruff format` pass** — would reflow the whole codebase (noisy); E501 is ignored, so not needed. Defer.
- **Test-only warning** (NOT production): `StarletteDeprecationWarning: using httpx with starlette.testclient →
  install httpx2`. Test framework only; owner explicitly out of scope. Leave.

## ⚠️ Deploy-relevant operational check
**paramiko 5.0 removed SHA1/MD5/DSA/GSSAPI.** Our fleet hosts must negotiate modern algorithms or 5.0 refuses them.
emma (Linux) + the Windows hosts (modern OpenSSH) should be fine — but **verify each host's SSH action works after
deploy** (a `ping`/status action exercises it). The recon already SSH'd to emma successfully on paramiko 5.0.

## Verified
`ruff check` clean · **229 passed / 0 failed** on Windows Python 3.11 AND on emma's **native 3.14.4** (fresh venv with
the bumped pins) · MCP deprecation warning gone · no `router.routes`/policy-API usage.

## Sources
fastapi/SSE: https://fastapi.tiangolo.com/release-notes/ · https://fastapi.tiangolo.com/tutorial/server-sent-events/ ·
https://starlette.dev/release-notes/ · https://pypi.org/project/sse-starlette/ ·
pydantic: https://docs.pydantic.dev/latest/concepts/performance/ · https://docs.pydantic.dev/latest/api/config/ ·
asyncio: https://docs.python.org/3.14/library/asyncio-task.html · https://docs.python.org/3.14/whatsnew/3.14.html ·
https://docs.python.org/3.14/library/asyncio-policy.html ·
httpx/openai: https://github.com/encode/httpx/blob/master/CHANGELOG.md · https://github.com/openai/openai-python/blob/main/CHANGELOG.md ·
https://github.com/ggml-org/llama.cpp/issues/19138 ·
mcp: https://github.com/modelcontextprotocol/python-sdk/releases · https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/v1.27.1/src/mcp/client/streamable_http.py ·
ruff: https://docs.astral.sh/ruff/ · paramiko: https://www.paramiko.org/changelog.html
