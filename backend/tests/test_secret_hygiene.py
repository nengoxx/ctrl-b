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

import hashlib
import json
import typing

from pydantic import BaseModel

from app.config import (
    _SECRET_LEAF_KEYS,
    _SECRET_MAP_KEYS,
    SECRET_HINTS,
    Settings,
    _mask,
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


# ── A11/D48 C1: path-aware secrets on the `providers` map ─────────────────────────────────────
def test_providers_api_key_masks_unmasks_like_before() -> None:
    """`providers.*.api_key` is a secret leaf (SECURITY_MODEL list): masked on read, blank/masked-keeps
    on write — exactly like the old `inference.local.api_key` did."""
    data = {"providers": {"llamacpp": {"base_url": "u", "api_key": "sk-REAL", "models": {"m": {}}}}}
    m = mask_secrets(data)
    assert m["providers"]["llamacpp"]["api_key"] != "sk-REAL"
    assert "sk-REAL" in secret_values(data)
    restored = unmask_secrets(m, data)  # masked echo → keep stored
    assert restored["providers"]["llamacpp"]["api_key"] == "sk-REAL"
    fresh = unmask_secrets({"providers": {"llamacpp": {"api_key": "sk-NEW"}}}, data)
    assert fresh["providers"]["llamacpp"]["api_key"] == "sk-NEW"  # a real new value is taken


def test_provider_named_like_a_sentinel_does_not_trigger_leaf_or_map_masking() -> None:
    """C1 path-awareness: a provider whose KEY collides with a secret sentinel (`api_key`/`env`/
    `headers`/`ssh_password`) is a structured object, NOT a secret leaf/map — it recurses so its OWN
    nested `api_key` string still masks, and its non-secret fields stay visible."""
    for name in ("api_key", "env", "headers", "ssh_password"):
        data = {"providers": {name: {"base_url": "u", "api_key": "sk-NESTED", "models": {"m": {}}}}}
        m = mask_secrets(data)
        prov = m["providers"][name]
        assert prov["base_url"] == "u"  # non-secret field stays visible (not flat-masked as a leaf/map)
        assert prov["api_key"] != "sk-NESTED"  # the nested REAL secret still masks
        assert "sk-NESTED" in secret_values(data)
        restored = unmask_secrets(m, data)
        assert restored["providers"][name]["api_key"] == "sk-NESTED"  # round-trips


def test_sentinel_collision_rejected_at_schema_level() -> None:
    """C1 defense-in-depth: a provider OR model name equal to a secret sentinel key 422s at validation."""
    from pydantic import ValidationError

    from app.config import ModelCfg, ProviderCfg

    for bad in ("api_key", "ssh_password", "password", "token", "env", "headers"):
        with __import__("pytest").raises(ValidationError):
            Settings(providers={bad: ProviderCfg(base_url="u", models={"m": ModelCfg()})})
    with __import__("pytest").raises(ValidationError):
        Settings(providers={"ok": ProviderCfg(base_url="u", models={"api_key": ModelCfg()})})


# ── L2: the permission gate can't silently drift ─────────────────────────────────────────────
def test_destructive_actions_keep_their_declared_gate() -> None:
    """Pin the risk/confirm of the dangerous actions so a lowered risk (or dropped confirm) fails."""
    reg = build_registry()
    expected: dict[str, tuple[Risk, bool]] = {
        "shutdown_host": (Risk.HIGH, True),
        "reboot_host": (Risk.HIGH, True),
        "run_shell": (Risk.HIGH, True),  # R1/D44: designer forced-confirm pin (un-approvable)
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


def test_a_mask_with_nothing_to_restore_is_dropped_not_written() -> None:
    """A11 pre-release MUST-FIX. `_is_unchanged_secret` ends `and bool(stored)`, so a display mask with
    NO stored counterpart failed the "unchanged" test and was taken as a genuinely new value — writing
    the literal `sk…yz` to disk AS THE CREDENTIAL. Not a leak: silent auth breakage that presents as a
    provider outage. Reachable by delete-then-recreate, by a rename submitted without
    `provider_renames`, and by any hand-built PUT.

    The fix drops the key instead, which is also what the field does (R6: AnythingLLM filters
    `!newENVs[key].includes("******")`) — a mask means "unchanged", and when there is nothing to keep
    unchanged the honest result is no value, not a bogus one.
    """
    incoming = {"providers": {"recreated": {"base_url": "http://x/v1", "api_key": "sk…yz"}}}
    out = unmask_secrets(incoming, {"providers": {}})  # nothing stored under that name
    assert "api_key" not in out["providers"]["recreated"]

    # A mask whose stored value ended in a NEWLINE (`"ab-token\n"` → `"ab…n\n"`) must still read as a
    # mask: the first implementation used `re.fullmatch(r".{2}….{2}")`, and `.` excludes newline — so
    # the literal mask was persisted as the credential, i.e. the MUST-FIX with a hole in it (Codex).
    assert _mask("ab-token\n") == "ab…n\n"
    nl = {"providers": {"recreated": {"api_key": _mask("ab-token\n")}}}
    assert "api_key" not in unmask_secrets(nl, {"providers": {}})["providers"]["recreated"]

    # A genuinely NEW key with nothing stored is still TAKEN — dropping it would be the opposite bug,
    # and this suite would otherwise pass an implementation that drops every unstored secret (Codex).
    brand_new = {"providers": {"fresh": {"api_key": "sk-BRAND-NEW-VALUE"}}}
    assert unmask_secrets(brand_new, {"providers": {}})["providers"]["fresh"]["api_key"] == (
        "sk-BRAND-NEW-VALUE"
    )

    # …while the two neighbouring behaviours are unchanged:
    assert unmask_secrets({"api_key": _mask("sk-REAL-KEY")}, {"api_key": "sk-REAL-KEY"}) == {
        "api_key": "sk-REAL-KEY"
    }
    assert unmask_secrets({"api_key": "sk-BRAND-NEW"}, {"api_key": "sk-REAL-KEY"}) == {
        "api_key": "sk-BRAND-NEW"
    }


def test_providers_rev_is_computed_over_masked_values_only() -> None:
    """A11 pre-release audit LOW. `providers_rev` is published *next to* the masked values (the
    `X-Providers-Rev` header, `GET /api/providers`, the PUT envelope), so hashing the RAW subtree made
    the pair an offline verification oracle: guess a key, recompute the digest, confirm — with the
    `ab…yz` mask cutting the search space. It now hashes the masked dump, which no longer identifies
    the secret.

    The cost is the change the client cannot see either — a rotation to a same-mask value leaves the
    fingerprint equal — and that is safe, because a stale draft echoing the mask restores whatever is
    CURRENTLY stored (`unmask_secrets`), so it cannot clobber the rotation it missed. A *visible*
    change (a different mask, an added/removed provider, any non-secret field) still moves the rev.
    """
    from app.config import ModelCfg, ProviderCfg, providers_rev

    def _s(key: str) -> Settings:
        return Settings(
            providers={"p": ProviderCfg(base_url="http://p/v1", api_key=key, models={"m": ModelCfg()})}
        )

    base = _s("sk-AAAAAAAAAAAA-zz")
    # The digest is EXACTLY sha256 over the canonical JSON of the MASKED subtree — recomputed here, so
    # reverting to the raw dump fails this line (a bare sha256 of the secret alone would not have: the
    # real digest hashes provider JSON, not the credential — Codex).
    expected = hashlib.sha256(
        json.dumps(
            {"p": mask_secrets(base.providers["p"].model_dump(mode="json"))},
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()[:16]
    assert providers_rev(base) == expected
    assert providers_rev(base) == providers_rev(_s("sk-BBBBBBBB-zz"))  # same mask ⇒ same rev
    assert providers_rev(base) != providers_rev(_s("xk-AAAAAAAAAAAA-zy"))  # a visible change moves it
    # … and a non-secret edit still moves it, which is what the 409 guard actually protects.
    other = Settings(
        providers={
            "p": ProviderCfg(
                base_url="http://p/v1", api_key="sk-AAAAAAAAAAAA-zz", models={"m": ModelCfg(dim=512)}
            )
        }
    )
    assert providers_rev(base) != providers_rev(other)


def test_the_same_rule_holds_inside_a_credential_map() -> None:
    """`env`/`headers` carry user-keyed credentials through the identical predicate, so they had the
    identical hazard: a masked `Authorization` for a server that has no stored one was persisted as the
    mask."""
    out = unmask_secrets(
        {"headers": {"Authorization": "Be…er", "Content-Type": "application/json"}},
        {"headers": {}},
    )
    assert "Authorization" not in out["headers"]
    assert out["headers"]["Content-Type"] == "application/json"  # non-secret entries are untouched

    # …and blank-keeps stays a SECRET affordance. The MUST-FIX rewrite dropped `_map_key_is_secret`
    # from the RESTORE branch (it kept it only in the drop filter), which made a non-secret map entry
    # — displayed raw, never masked — unclearable: submitting "" silently restored the stored value
    # (Fable, pre-release review). The leaf branch fires only on `_SECRET_LEAF_KEYS`, so the two
    # branches would have disagreed with each other.
    stored = {"headers": {"Authorization": "sk-REAL", "X-Note": "keepme"}}
    assert unmask_secrets({"headers": {"X-Note": ""}}, stored)["headers"]["X-Note"] == ""
    assert unmask_secrets({"headers": {"Authorization": ""}}, stored)["headers"] == {
        "Authorization": "sk-REAL"  # blank on a SECRET entry still keeps what is stored
    }


def test_no_422_body_ever_echoes_the_rejected_value() -> None:
    """A11 pre-release FE audit, HIGH — canary-confirmed before fixing.

    `exc.errors()` includes `input`: the value that failed validation. Every endpoint that validates a
    submitted document therefore echoed that document back on rejection, so a settings PUT carrying a
    real `api_key` returned it in `detail[0].input` and the UI rendered it into a toast. The class is
    closed at one chokepoint (`validation_detail`), so this test asserts the PROPERTY at the boundary
    rather than the call shape at six sites — and a seventh endpoint added tomorrow is covered by the
    companion drift guard in `test_arch_invariants_qh9.py`.
    """
    from pydantic import BaseModel, ValidationError

    from app.config import ComputerCfg, ProviderCfg, validation_detail

    class _Patch(BaseModel):  # a stand-in for any submitted document with a secret in it
        providers: dict[str, ProviderCfg]
        computers: dict[str, ComputerCfg] = {}

    for payload in (
        {"providers": {"p": {"base_url": "http://p/v1", "api_key": "sk-CANARY", "models": "not-a-map"}}},
        {"providers": {}, "computers": {"h": {"host": "x", "ssh_password": "pw-CANARY", "port": "nope"}}},
    ):
        try:
            _Patch.model_validate(payload)
        except ValidationError as exc:
            rendered = str(validation_detail(exc))
            assert "CANARY" not in rendered, f"a rejected value reached the 422 body: {rendered}"
            assert "input" not in {k for e in validation_detail(exc) for k in e}
            assert all(set(e) == {"loc", "msg", "type"} for e in validation_detail(exc))
        else:  # pragma: no cover - the payloads above are invalid by construction
            raise AssertionError("payload validated unexpectedly — the canary test proves nothing")


def test_fastapis_own_422_is_sanitised_too() -> None:
    """The bigger half of the same leak, and the one the drift guard could not see.

    Routing the six explicit `except ValidationError` sites through `validation_detail` left the door
    that opens FIRST: a body that fails validation never reaches a handler, and FastAPI's default
    renderer includes `input`. Two shapes leak — a secret field failing its own rule echoes the secret,
    and a body-shape failure echoes the ENTIRE body. Both verified against the real app before the
    `RequestValidationError` handler was added (Codex, review of the fix wave).
    """
    from fastapi import FastAPI, Request
    from fastapi.exceptions import RequestValidationError
    from fastapi.responses import JSONResponse
    from fastapi.testclient import TestClient
    from pydantic import BaseModel, Field

    from app.config import validation_detail

    class _Body(BaseModel):
        host: str
        ssh_password: str | None = Field(default=None, max_length=20)

    app = FastAPI()

    @app.exception_handler(RequestValidationError)
    async def _handler(_r: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": validation_detail(exc)})

    @app.put("/h")
    def _put(body: _Body) -> dict[str, str]:  # pragma: no cover - never reached with invalid input
        return {}

    c = TestClient(app)
    # (1) the secret field fails its OWN rule → its value is the `input`
    r = c.put("/h", json={"host": "x", "ssh_password": "pw-CANARY-pw-CANARY-pw-CANARY"})
    assert r.status_code == 422 and "CANARY" not in r.text
    # (2) the whole body is the wrong shape → the ENTIRE body is the `input`
    r2 = c.put("/h", json=["not", "a", "mapping", "pw-CANARY"])
    assert r2.status_code == 422 and "CANARY" not in r2.text
    assert all(set(e) == {"loc", "msg", "type"} for e in r2.json()["detail"])
