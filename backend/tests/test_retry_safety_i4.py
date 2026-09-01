"""I4 — retry-safety classification (PRE_DEPLOY §1 step 4c, backend half).

`ToolSpec.read_only`/`idempotent` (MCP-aligned: `readOnlyHint`/`idempotentHint`) derive
`retry_safe = read_only or idempotent`, exposed in the action DTO. The frontend's failed-turn retry
auto-resends a retry-safe turn but copies a non-safe one to the composer for review — so it can't
silently repeat a `reboot`/`restart`/`run_shell`/`spawn_subagents`/`memory`. These tests pin the
per-tool classification so a newly added *mutating* action can't accidentally be marked retry-safe
(default is False → conservative), and lock the DTO field the frontend reads.
"""

from __future__ import annotations

from app.core.tool import spec_to_dict
from app.services.actions import build_registry

# The retry-safe set: read-only (query/probe/build-url/search) OR idempotent (re-running with the same
# args has no additional effect — wake an on host, start a started service, set the same plan).
RETRY_SAFE = {
    "ping_host",
    "check_service",
    "open_service_url",
    "web_search",
    "wake_host",
    "shutdown_host",
    "start_service",
    "stop_service",
    "tailscale_serve_enable",
    "tailscale_serve_disable",
    "task_plan",
    "session_search",
    "read_attachment",  # D68: opens a stored file, changes nothing
    "dns_trace",
    "ip_info",
    "yt_captions",
    "question",  # only prompts the owner; no external effect
    "list_automations",  # reads the automation roster
}
# The retry-UNSAFE set: mutating AND non-idempotent — re-running repeats the effect.
RETRY_UNSAFE = {
    "reboot_host",
    "restart_service",
    "run_shell",
    "spawn_subagents",
    "memory",
    # D57: mutating and NOT retry-safe as a whole — the read actions are, but `retry_safe` is a
    # per-TOOL flag and an auto-resend would re-drive whichever action the failed turn carried.
    "core_memory",
    "skill_manage",
    "create_automation",  # a re-run creates a SECOND automation (and eats another cap slot)
}


def test_retry_safe_classification() -> None:
    reg = build_registry()
    for name in RETRY_SAFE:
        assert reg.get(name).spec.retry_safe, f"{name} should be retry-safe (read_only or idempotent)"
    for name in RETRY_UNSAFE:
        assert not reg.get(name).spec.retry_safe, f"{name} must NOT be retry-safe (mutating + non-idempotent)"


def _is_integration_tool(name: str, category: str) -> bool:
    """Dynamically-discovered integration tools — MCP/OpenAPI (category "mcp") and open-terminal
    (`terminal_*`). They derive `retry_safe` from their own definition/annotations, not this static
    list, and the registry is a shared singleton that other tests may have populated with them."""
    return category == "mcp" or name.startswith("terminal_")


def test_every_builtin_is_deliberately_classified() -> None:
    """No STATIC BUILT-IN tool is left unclassified — every one is in exactly one bucket, so a future
    built-in that isn't triaged fails here rather than defaulting silently into the wrong retry
    behaviour. Integration tools are excluded (see `_is_integration_tool`)."""
    reg = build_registry()
    names = {t.spec.name for t in reg.all() if not _is_integration_tool(t.spec.name, t.spec.category)}
    classified = RETRY_SAFE | RETRY_UNSAFE
    assert names == classified, f"unclassified built-in tool(s): {sorted(names ^ classified)}"


def test_dto_exposes_retry_safe() -> None:
    reg = build_registry()
    assert spec_to_dict(reg.get("ping_host").spec)["retry_safe"] is True
    assert spec_to_dict(reg.get("reboot_host").spec)["retry_safe"] is False


if __name__ == "__main__":
    for k, v in sorted(globals().items()):
        if k.startswith("test_") and callable(v):
            v()
            print(f"ok  {k}")
