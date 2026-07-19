"""Secret-hygiene + policy invariants (PRE_DEPLOY §1 step 3, K4 + L2).

Turns two convention-upheld invariants into enforced tests:

- **K4 — secrets never leak / never collide.** `mask_secrets` / `secret_values` / `unmask_secrets`
  identify secrets by TWO explicit rules (config.py): exact-name declared leaves (`api_key`,
  `ssh_password`) and secret-named entries inside the arbitrary `env`/`headers` credential maps.
  These tests lock BOTH directions: every real secret is masked/collected/redacted, AND non-secret
  fields (`threshold_tokens`, routine headers like `Content-Type`) are never touched. A **drift guard**
  introspects the whole `Settings` model and fails if a future secret-looking field goes unclassified.

- **L2 — the permission gate can't silently drift.** The declared risk/confirm of the destructive
  actions (and the resulting `permissions.decide` outcomes) are pinned, so lowering `shutdown_host`
  to LOW — or dropping its confirm — fails the suite.

Pure/dict-level — no live config, no DB (the identification functions take plain dicts).
"""

from __future__ import annotations

import typing

from pydantic import BaseModel

from app.config import (
    _SECRET_LEAF_KEYS,
    _SECRET_MAP_KEYS,
    SECRET_HINTS,
    Settings,
    mask_secrets,
    secret_values,
    unmask_secrets,
)
from app.core.permissions import Decision, decide
from app.core.redact import redact
from app.domain.enums import Privilege, Risk
from app.services.actions import build_registry

# A config tree exercising every secret shape + the collision cases, with unique sentinel values
# (canary pattern) so an assertion can prove a specific secret did/didn't reach a surface.
SAMPLE = {
    "agent": {"compaction": {"threshold_tokens": 6000, "enabled": True}},  # collision: "token" substring
    "inference": {
        "local": {"api_key": "sk-LEAK-LOCAL", "model": "m"},
        "fallbacks": [{"api_key": "sk-LEAK-FALLBACK", "base_url": "u"}],  # secret inside a list item
    },
    "computers": {"corsair": {"ssh_password": "PW-LEAK-CORSAIR", "ssh_port": 22}},
    "mcp_servers": [
        {
            "name": "x",
            "headers": {"Authorization": "Bearer HDR-LEAK", "Content-Type": "application/json"},
            "env": {"API_TOKEN": "ENV-LEAK", "LOG_LEVEL": "info"},
        }
    ],
}
_REAL_SECRETS = {"sk-LEAK-LOCAL", "sk-LEAK-FALLBACK", "PW-LEAK-CORSAIR", "Bearer HDR-LEAK", "ENV-LEAK"}
_NOT_SECRETS = {"info", "application/json", "m", "u"}  # + 6000 / 22 (ints)


# ── K4: masking is precise in BOTH directions ────────────────────────────────────────────────
def test_mask_secrets_masks_every_real_secret() -> None:
    m = mask_secrets(SAMPLE)
    assert m["inference"]["local"]["api_key"] != "sk-LEAK-LOCAL"
    assert m["inference"]["fallbacks"][0]["api_key"] != "sk-LEAK-FALLBACK"
    assert m["computers"]["corsair"]["ssh_password"] != "PW-LEAK-CORSAIR"
    assert m["mcp_servers"][0]["headers"]["Authorization"] != "Bearer HDR-LEAK"
    assert m["mcp_servers"][0]["env"]["API_TOKEN"] != "ENV-LEAK"


def test_mask_secrets_never_masks_non_secrets() -> None:
    """The whole point of the exact-name + scoped-map rules: no collateral masking."""
    m = mask_secrets(SAMPLE)
    assert m["agent"]["compaction"]["threshold_tokens"] == 6000  # the collision that started this
    assert m["agent"]["compaction"]["enabled"] is True
    assert m["computers"]["corsair"]["ssh_port"] == 22
    assert m["inference"]["local"]["model"] == "m"
    assert m["mcp_servers"][0]["headers"]["Content-Type"] == "application/json"  # routine header stays
    assert m["mcp_servers"][0]["env"]["LOG_LEVEL"] == "info"  # routine env var stays


def test_secret_values_collects_all_secrets_and_only_secrets() -> None:
    got = set(secret_values(SAMPLE))
    assert _REAL_SECRETS <= got, f"missed secret(s): {_REAL_SECRETS - got}"
    assert not (got & _NOT_SECRETS), f"collected non-secret(s): {got & _NOT_SECRETS}"


def test_redact_scrubs_every_config_secret_from_free_text() -> None:
    """The leak-prevention contract: any real secret appearing in captured text is masked out."""
    secrets = secret_values(SAMPLE)
    text = "cmd echoed sk-LEAK-LOCAL and PW-LEAK-CORSAIR and Bearer HDR-LEAK and ENV-LEAK oops"
    out = redact(text, secrets) or ""
    for s in _REAL_SECRETS:
        assert s not in out, f"{s!r} leaked through redact()"
    assert "cmd echoed" in out and "oops" in out  # non-secret text preserved


def test_unmask_roundtrip_leaf_and_map() -> None:
    """Masked/blank → keep stored; a genuinely new value → take it — for leaves AND map entries."""
    masked = mask_secrets(SAMPLE)
    restored = unmask_secrets(masked, SAMPLE)
    assert restored["inference"]["local"]["api_key"] == "sk-LEAK-LOCAL"
    assert restored["computers"]["corsair"]["ssh_password"] == "PW-LEAK-CORSAIR"
    assert restored["mcp_servers"][0]["headers"]["Authorization"] == "Bearer HDR-LEAK"
    assert restored["mcp_servers"][0]["headers"]["Content-Type"] == "application/json"
    # a new secret typed in the UI is taken as-is (not treated as "unchanged")
    edited = unmask_secrets({"local": {"api_key": "sk-NEW", "model": "m"}}, SAMPLE["inference"])
    assert edited["local"]["api_key"] == "sk-NEW"


# ── K4 drift guard: no secret-looking Settings field may go unclassified ──────────────────────
def _model_types(annotation: object) -> list[type]:
    """Every `BaseModel` subclass reachable from a field annotation (unwrapping Optional/list/dict/…)."""
    found: list[type] = []

    def rec(a: object) -> None:
        if isinstance(a, type) and issubclass(a, BaseModel):
            found.append(a)
        for arg in typing.get_args(a):
            rec(arg)

    rec(annotation)
    return found


def _all_field_names(model: type, seen: set[type] | None = None) -> set[str]:
    seen = seen if seen is not None else set()
    if model in seen:
        return set()
    seen.add(model)
    names: set[str] = set()
    for name, info in model.model_fields.items():
        names.add(name)
        for nested in _model_types(info.annotation):
            names |= _all_field_names(nested, seen)
    return names


def test_no_secret_looking_field_is_unclassified() -> None:
    """Broad heuristic (test-time only): flag every Settings field whose NAME looks secret and require
    it to be either a declared secret or an explicit known-non-secret. Adding e.g. `client_secret`
    fails here until it's classified — moving the guesswork to review-time, not runtime."""
    # Config fields whose name matches SECRET_HINTS but are genuinely NOT secrets (reviewed). The D42
    # additions are all plain tunables/pointers (token budgets + the output-cap field name), not creds.
    known_non_secret = {
        "threshold_tokens",
        "keep_recent_tokens",
        "clear_output_min_tokens",
        "max_tokens",
        "max_tokens_field",
        "reasoning_tokens",
    }
    names = _all_field_names(Settings)
    candidates = {n for n in names if any(h in n.lower() for h in SECRET_HINTS)}
    classified = set(_SECRET_LEAF_KEYS) | set(_SECRET_MAP_KEYS) | known_non_secret
    unclassified = candidates - classified
    assert not unclassified, (
        f"secret-looking config field(s) not classified: {sorted(unclassified)}. "
        f"If secret → add to _SECRET_LEAF_KEYS in config.py; if not → add to this test's "
        f"known_non_secret."
    )


# ── L2: the permission gate can't silently drift ─────────────────────────────────────────────
def test_destructive_actions_keep_their_declared_gate() -> None:
    """Pin the risk/confirm of the dangerous actions so a lowered risk (or dropped confirm) fails."""
    reg = build_registry()
    expected: dict[str, tuple[Risk, bool]] = {
        "shutdown_host": (Risk.HIGH, True),
        "reboot_host": (Risk.HIGH, True),
        "run_shell": (Risk.HIGH, False),
        "restart_service": (Risk.MED, False),
        "stop_service": (Risk.MED, False),
        "wake_host": (Risk.LOW, False),
        "ping_host": (Risk.LOW, False),
    }
    for name, (risk, confirm) in expected.items():
        spec = reg.get(name).spec
        assert (spec.risk, spec.confirm) == (risk, confirm), (
            f"{name} gate drifted: {spec.risk}/{spec.confirm}"
        )


def test_decide_outcomes_for_the_gate() -> None:
    """The privilege ladder resolves as declared: HIGH/confirm suspends at CONFIRM, allows at FULL;
    a mutating service action confirms at CONFIRM; run_shell is denied below FULL."""
    reg = build_registry()
    shutdown = reg.get("shutdown_host").spec
    assert decide(shutdown, Privilege.CONFIRM) is Decision.CONFIRM
    assert decide(shutdown, Privilege.FULL) is Decision.ALLOW
    assert decide(shutdown, Privilege.READONLY) is Decision.DENY  # HIGH-risk action, read-only caller

    stop = reg.get("stop_service").spec
    assert decide(stop, Privilege.CONFIRM) is Decision.CONFIRM
    assert decide(stop, Privilege.AUTO_LOW) is Decision.ALLOW

    shell = reg.get("run_shell").spec
    assert decide(shell, Privilege.CONFIRM) is Decision.DENY  # no raw shell below FULL
    assert decide(shell, Privilege.FULL) is Decision.ALLOW

    ping = reg.get("ping_host").spec
    assert decide(ping, Privilege.READONLY) is Decision.ALLOW  # LOW-risk always allowed
