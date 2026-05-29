"""Phase 7d-a — per-tool description override tests.

Same dual-run convention as the other suites (`python tests/test_tool_descriptions_7d.py` from
`backend/`, or under pytest). Covers:
- `runtime.apply_tool_descriptions` overlays an override onto a live registry spec, captures the
  original once, and **restores** it when the override is cleared.
- `PUT /api/settings {tool_descriptions: …}` applies live (the running registry spec + GET
  /api/actions reflect it without a restart) and persists, and clearing it restores the built-in.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from types import SimpleNamespace

from app.core.tool import ToolRegistry, ToolSpec, FunctionTool
from app.domain.result import ToolResult
from app.config import Settings
from app.runtime import apply_tool_descriptions


def _fake_app(registry: ToolRegistry, settings: Settings) -> SimpleNamespace:
    return SimpleNamespace(
        state=SimpleNamespace(actions=SimpleNamespace(registry=registry), settings=settings)
    )


def _reg_with(name: str, desc: str) -> ToolRegistry:
    class _In(__import__("pydantic").BaseModel):  # tiny input model
        pass

    async def _run(inp, ctx):  # noqa: ANN001
        return ToolResult(state="ok", summary="ok")

    reg = ToolRegistry()
    reg.register(FunctionTool(spec=ToolSpec(name=name, title=name, description=desc, input_model=_In), fn=_run))
    return reg


def test_apply_override_and_restore() -> None:
    reg = _reg_with("ping_host", "Ping a host on the fleet.")
    s = Settings.model_validate({"tool_descriptions": {"ping_host": "  Probe reachability of a host.  "}})
    app = _fake_app(reg, s)

    apply_tool_descriptions(app)
    assert reg.get("ping_host").spec.description == "Probe reachability of a host."  # trimmed override
    assert app.state.tool_desc_orig["ping_host"] == "Ping a host on the fleet."     # original captured

    # clear the override (blank) → built-in description restored
    app.state.settings = Settings.model_validate({"tool_descriptions": {"ping_host": ""}})
    apply_tool_descriptions(app)
    assert reg.get("ping_host").spec.description == "Ping a host on the fleet."

    # no override at all → still the built-in
    app.state.settings = Settings.model_validate({})
    apply_tool_descriptions(app)
    assert reg.get("ping_host").spec.description == "Ping a host on the fleet."


def _client():
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())


def test_api_put_applies_and_restores() -> None:
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text("# cfg\nserver:\n  port: 5433\n", encoding="utf-8")
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        with _client() as c:
            actions = {a["name"]: a for a in c.get("/api/actions").json()}
            assert "ping_host" in actions
            builtin = actions["ping_host"]["description"]
            assert builtin  # there is a built-in description

            r = c.put("/api/settings", json={"tool_descriptions": {"ping_host": "Custom probe wording."}})
            assert r.status_code == 200, r.text

            # live: the running registry spec + GET /api/actions reflect the override (no restart)
            assert c.app.state.actions.registry.get("ping_host").spec.description == "Custom probe wording."
            assert {a["name"]: a for a in c.get("/api/actions").json()}["ping_host"]["description"] == "Custom probe wording."

            # persisted to disk under tool_descriptions, comment preserved
            disk = cfg.read_text(encoding="utf-8")
            assert "# cfg" in disk
            assert "Custom probe wording." in disk

            # clear it → built-in description comes back live
            r2 = c.put("/api/settings", json={"tool_descriptions": {"ping_host": ""}})
            assert r2.status_code == 200, r2.text
            assert c.app.state.actions.registry.get("ping_host").spec.description == builtin
    finally:
        os.environ.pop("CTRLB_CONFIG", None)
        os.environ.pop("CTRLB_DB", None)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
