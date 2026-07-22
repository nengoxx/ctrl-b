"""A11/D48 wave B2 — the provider API layer.

Rename transaction (rekey + secret-restore-by-old-identity + the closed cascade list) · providers
REPLACEMENT semantics (delete on absent key) · the providers-base 409 concurrency guard · the
secret-sentinel + reserved-verb PUT rejections · the `warnings` + `providers_rev` PUT envelope ·
`GET /api/providers` (shape, rev stability, effective-section-after-promotion, verbs filtering,
skill-shadow warning) · `_coerce_mode` syntax-only slug coercion · and the migration write-back
firing through a hosts-CRUD write (not just the settings PUT). All on a tmp CTRLB_CONFIG.
"""

from __future__ import annotations

import contextlib
import os
import stat
import tempfile
from collections.abc import Iterator
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import load_settings
from app.main import create_app
from app.runtime import provider_rename_error

# ── two-provider new-shape base config: llamacpp (primary, sole model) + openrouter (fallback,
#    multi-model, secret-bearing); an agent.compaction.summarizer ref + agent.defaults.model ref. ──
_BASE = (
    "# homelab\n"
    "server:\n  port: 5433\n  poll_seconds: 5\n"
    "providers:\n"
    "  llamacpp:\n"
    "    base_url: http://192.168.1.137:5001/v1\n"
    "    api_mode: llamacpp\n"
    "    models:\n      minig+: {}\n"
    "  openrouter:\n"
    "    base_url: https://openrouter.ai/api/v1\n"
    "    api_key: sk-REAL\n"
    "    api_mode: openrouter\n"
    "    models:\n      qwen3.5:\n        id: qwen/qwen3.5-72b\n      other: {}\n"
    "inference:\n"
    "  provider: llamacpp\n"
    "  fallbacks:\n    - provider: openrouter\n      model: qwen3.5\n"
    "agent:\n"
    "  compaction:\n    summarizer:\n      provider: openrouter\n      model: qwen3.5\n"
    "  defaults:\n    model:\n      provider: llamacpp\n"
)


@contextlib.contextmanager
def _client(cfg_text: str) -> Iterator[tuple[TestClient, Path]]:
    tmp = Path(tempfile.mkdtemp())
    cfg = tmp / "config.yaml"
    cfg.write_text(cfg_text, encoding="utf-8")
    os.environ["CTRLB_HOME"] = str(tmp)
    os.environ["CTRLB_CONFIG"] = str(cfg)
    os.environ["CTRLB_DB"] = str(tmp / "t.db")
    try:
        with TestClient(create_app()) as c:
            yield c, cfg
    finally:
        for k in ("CTRLB_HOME", "CTRLB_CONFIG", "CTRLB_DB"):
            os.environ.pop(k, None)


class _FakeSkill:
    def __init__(self, name: str) -> None:
        self.name = name


class _FakeSkills:
    """Minimal `SkillProvider` stub for the provider-name-shadowed-by-skill collision (recomputed live)."""

    def __init__(self, *names: str) -> None:
        self._skills = [_FakeSkill(n) for n in names]

    def list(self) -> list[_FakeSkill]:
        return self._skills


def _rev(c: TestClient) -> str:
    return c.get("/api/providers").json()["rev"]


# ────────────────────────────── rename transaction (C1) ──────────────────────────────
def test_rename_rekeys_restores_masked_secret_and_cascades_all_homes() -> None:
    with _client(_BASE) as (c, cfg):
        masked = c.get("/api/settings").json()["providers"]["openrouter"]["api_key"]
        assert masked != "sk-REAL"  # sanity: it's masked on read
        r = c.put(
            "/api/settings",
            json={
                "provider_renames": {"openrouter": "openrouter2"},
                "providers_base": _rev(c),
                "providers": {  # the UI submits the complete map, keyed by the NEW name, secret masked
                    "llamacpp": {
                        "base_url": "http://192.168.1.137:5001/v1",
                        "api_mode": "llamacpp",
                        "models": {"minig+": {}},
                    },
                    "openrouter2": {
                        "base_url": "https://openrouter.ai/api/v1",
                        "api_key": masked,  # masked → restore by OLD identity (openrouter)
                        "api_mode": "openrouter",
                        "models": {"qwen3.5": {"id": "qwen/qwen3.5-72b"}, "other": {}},
                    },
                },
                # inference + agent are NOT sent — the backend cascade is authoritative
            },
        )
        assert r.status_code == 200, r.text
        s = load_settings(cfg)
        assert set(s.providers) == {"llamacpp", "openrouter2"}  # rekeyed; old key gone
        assert s.providers["openrouter2"].api_key == "sk-REAL"  # restored by old structural identity
        # (3) cascade rewrote every config-held ref still equal to the old name in the merged doc
        assert s.inference.fallbacks[0].provider == "openrouter2"
        assert s.agent.compaction.summarizer.provider == "openrouter2"  # the GLOBAL summarizer home
        assert s.agent.compaction.summarizer.model == "qwen3.5"  # the model clean name is NOT renamed
        # a third provider's ref (llamacpp) is untouched by the rename/cascade
        assert s.agent.defaults["model"]["provider"] == "llamacpp"
        assert "openrouter2" in cfg.read_text(encoding="utf-8") and "sk-REAL" in cfg.read_text(
            encoding="utf-8"
        )


def test_rename_real_incoming_secret_wins_and_third_provider_change_preserved() -> None:
    with _client(_BASE) as (c, cfg):
        r = c.put(
            "/api/settings",
            json={
                "provider_renames": {"openrouter": "openrouter2"},
                "providers_base": _rev(c),
                "providers": {
                    # (4) a THIRD provider's explicit incoming change (a scalar edit) is preserved
                    "llamacpp": {
                        "base_url": "http://192.168.1.137:5001/v1",
                        "api_mode": "llamacpp",
                        "max_concurrent_requests": 3,
                        "models": {"minig+": {}},
                    },
                    "openrouter2": {
                        "base_url": "https://openrouter.ai/api/v1",
                        "api_key": "sk-BRANDNEW",  # a real incoming secret WINS over restoration
                        "api_mode": "openrouter",
                        "models": {"qwen3.5": {"id": "qwen/qwen3.5-72b"}, "other": {}},
                    },
                },
            },
        )
        assert r.status_code == 200, r.text
        s = load_settings(cfg)
        assert s.providers["openrouter2"].api_key == "sk-BRANDNEW"  # new secret won
        assert s.providers["llamacpp"].max_concurrent_requests == 3  # third-provider edit kept


def test_rename_bijective_violations_rejected() -> None:
    stored = {"a", "b", "c"}
    assert provider_rename_error({}, stored, providers_in_patch=True) is None
    assert provider_rename_error({"a": "newa"}, stored, providers_in_patch=True) is None  # happy path
    # each violation returns a precise (non-None) error → 422 in the handler
    assert (
        provider_rename_error({"a": "newa"}, stored, providers_in_patch=False) is not None
    )  # needs providers
    assert provider_rename_error({"nope": "x"}, stored, providers_in_patch=True) is not None  # missing old
    assert provider_rename_error({"a": "b"}, stored, providers_in_patch=True) is not None  # colliding new
    assert (
        provider_rename_error({"a": "x", "b": "x"}, stored, providers_in_patch=True) is not None
    )  # dup dest
    assert provider_rename_error({"a": "b", "b": "a"}, stored, providers_in_patch=True) is not None  # swap


def test_rename_to_existing_provider_422s_via_api() -> None:
    with _client(_BASE) as (c, _cfg):
        r = c.put(
            "/api/settings",
            json={
                "provider_renames": {"openrouter": "llamacpp"},  # destination already exists
                "providers_base": _rev(c),
                "providers": {"llamacpp": {"base_url": "http://192.168.1.137:5001/v1"}},
            },
        )
        assert r.status_code == 422, r.text


# ────────────────────────── replacement semantics (C1) ──────────────────────────
def test_absent_provider_key_is_deleted_and_absent_providers_leaves_subtree() -> None:
    cfg_text = (
        "server:\n  port: 5433\n  poll_seconds: 5\n"
        "providers:\n"
        "  llamacpp:\n    base_url: http://l/v1\n    api_mode: llamacpp\n    models:\n      minig+: {}\n"
        "  extra:\n    base_url: http://extra/v1\n    models:\n      x: {}\n"
        "inference:\n  provider: llamacpp\n"
    )
    with _client(cfg_text) as (c, cfg):
        # replacement: submitting the map WITHOUT `extra` deletes it (sync_mapping)
        r = c.put(
            "/api/settings",
            json={
                "providers_base": _rev(c),
                "providers": {
                    "llamacpp": {
                        "base_url": "http://l/v1",
                        "api_mode": "llamacpp",
                        "models": {"minig+": {}},
                    }
                },
            },
        )
        assert r.status_code == 200, r.text
        assert set(load_settings(cfg).providers) == {"llamacpp"}
        assert "extra" not in cfg.read_text(encoding="utf-8")
        # a patch with NO `providers` key leaves the subtree entirely untouched (and no 409)
        r2 = c.put("/api/settings", json={"server": {"poll_seconds": 9}})
        assert r2.status_code == 200, r2.text
        assert set(load_settings(cfg).providers) == {"llamacpp"}


# ────────────────────────── providers-base 409 (C2) ──────────────────────────
def test_providers_base_stale_409_and_fresh_200_with_new_rev() -> None:
    with _client(_BASE) as (c, cfg):
        before = cfg.read_text(encoding="utf-8")
        # stale/absent base → 409, no YAML change, no backup file (nothing mutated)
        r = c.put(
            "/api/settings",
            json={
                "providers_base": "deadbeefdeadbeef",
                "providers": {"llamacpp": {"base_url": "http://x/v1"}},
            },
        )
        assert r.status_code == 409, r.text
        assert cfg.read_text(encoding="utf-8") == before  # untouched
        assert not list(cfg.parent.glob("config.yaml.bak-a11-*"))
        # a providers PUT with NO base is likewise 409
        r_nobase = c.put("/api/settings", json={"providers": {"llamacpp": {"base_url": "http://x/v1"}}})
        assert r_nobase.status_code == 409, r_nobase.text
        # fresh base → 200; a real change to the map yields a DIFFERENT rev
        rev = _rev(c)
        r_ok = c.put(
            "/api/settings",
            json={
                "providers_base": rev,
                "providers": {
                    "llamacpp": {
                        "base_url": "http://192.168.1.137:5001/v1",
                        "api_mode": "llamacpp",
                        "models": {"minig+": {}},
                    },
                    "openrouter": {
                        "base_url": "https://openrouter.ai/api/v1",
                        "api_key": c.get("/api/settings").json()["providers"]["openrouter"]["api_key"],
                        "api_mode": "openrouter",
                        "models": {
                            "qwen3.5": {"id": "qwen/qwen3.5-72b"},
                            "other": {},
                            "added": {},
                        },  # a real change
                    },
                },
            },
        )
        assert r_ok.status_code == 200, r_ok.text
        assert r_ok.json()["providers_rev"] != rev  # post-write fingerprint changed


# ────────────────────────── FX4 / FX7 review-fix wave ──────────────────────────
def test_delete_provider_referenced_only_by_summarizer_422() -> None:
    # FX4 (Codex#4): strict-resolve now validates config-held ModelRefs. Removing a provider that ONLY the
    # global compaction summarizer references (the inference fallback ref is dropped in the same PUT) must
    # 422 — not silently persist a dangling summarizer pointer.
    with _client(_BASE) as (c, cfg):
        before = cfg.read_text(encoding="utf-8")
        r = c.put(
            "/api/settings",
            json={
                "providers_base": _rev(c),
                "providers": {
                    "llamacpp": {
                        "base_url": "http://192.168.1.137:5001/v1",
                        "api_mode": "llamacpp",
                        "models": {"minig+": {}},
                    }
                },
                "inference": {"provider": "llamacpp", "fallbacks": []},
            },
        )
        assert r.status_code == 422, r.text
        assert "openrouter" in r.text
        assert cfg.read_text(encoding="utf-8") == before  # nothing persisted


_GATE_CONFLICT = (
    "server:\n  port: 5433\n  poll_seconds: 5\n"
    "providers:\n"
    "  a:\n    base_url: http://same/v1\n    api_mode: llamacpp\n    models:\n      m: {}\n"
    "  b:\n    base_url: http://same/v1\n    api_mode: llamacpp\n    max_concurrent_requests: 2\n    models:\n      n: {}\n"
    "inference:\n  provider: a\n"
)


def test_unrelated_put_lenient_while_providers_put_422s_on_gate_conflict() -> None:
    # FX7 (audit M2): a lenient-tolerated gate None-conflict (a=None, b=2 on one gate_identity) must not
    # brick UNRELATED saves. An appearance-only PUT resolves LENIENTLY (200); a providers PUT on the same
    # doc strict-422s (the three resolution-relevant subtrees stay strict-always).
    with _client(_GATE_CONFLICT) as (c, _cfg):
        r_app = c.put("/api/settings", json={"appearance": {"mode": "light"}})
        assert r_app.status_code == 200, r_app.text
        r_prov = c.put(
            "/api/settings",
            json={
                "providers_base": _rev(c),
                "providers": {
                    "a": {"base_url": "http://same/v1", "api_mode": "llamacpp", "models": {"m": {}}},
                    "b": {
                        "base_url": "http://same/v1",
                        "api_mode": "llamacpp",
                        "max_concurrent_requests": 2,
                        "models": {"n": {}},
                    },
                },
            },
        )
        assert r_prov.status_code == 422, r_prov.text
        assert "max_concurrent_requests" in r_prov.text or "gate" in r_prov.text


def test_verb_mode_does_not_carry_routed_model_across_providers() -> None:
    # FX2 (Codex#2): a per-message `/<provider>` verb naming a DIFFERENT provider than the routed
    # ModelRef must NOT carry the routed (provider-relative) model to it — the registry would send it as a
    # raw wire id to the wrong backend. mode == routed.provider keeps the model; a different provider drops
    # it (model=None → the registry resolves that provider's own default). Asserted at the wire boundary.
    from _async import run_async

    from app.adapters.inference import ChatDelta
    from app.domain.conversation import Thread
    from app.services.agent.session import AgentSession

    cfg = (
        "server:\n  port: 5433\n  poll_seconds: 5\n"
        "providers:\n"
        "  llamacpp:\n    base_url: http://l/v1\n    api_mode: llamacpp\n    models:\n      minig: {}\n"
        "  openrouter:\n    base_url: http://o/v1\n    api_mode: openrouter\n    models:\n      qwen:\n        id: qwen/q\n"
        "inference:\n  provider: llamacpp\n  failover: false\n"
        "  fallbacks:\n    - provider: openrouter\n      model: qwen\n"
        "agent:\n  defaults:\n    model:\n      provider: llamacpp\n      model: minig\n"
    )

    async def _drain(agen: object) -> None:
        async for _ in agen:  # type: ignore[union-attr]
            pass

    with _client(cfg) as (c, _cfg):
        s = c.app.state
        agent = s.settings.resolve_agent(None)
        recorded: list[tuple] = []

        async def _spy(messages, *, mode=None, model=None, report=None, **kw):  # noqa: ANN001, ANN202
            recorded.append((mode, model))
            yield ChatDelta(text="done")

        s.inference.stream_chat = _spy  # type: ignore[assignment]

        def _turn(mode: str) -> tuple:
            recorded.clear()
            session = AgentSession(
                s.threads, s.messages, s.inference, s.settings, s.actions, agent, interactive=True
            )
            thread = run_async(s.threads.create(Thread()))
            run_async(_drain(session.run_turn(thread, "hi", mode=mode)))
            return recorded[0]

        assert _turn("openrouter") == ("openrouter", None)  # different provider → model dropped
        assert _turn("llamacpp") == ("llamacpp", "minig")  # same provider → routed model rides


# ────────────────────────── sentinel + reserved-verb rejection (C1/C7) ──────────────────────────
def test_sentinel_named_provider_422s() -> None:
    with _client(_BASE) as (c, _cfg):
        for bad in ("api_key", "ssh_password", "env", "headers"):
            r = c.put(
                "/api/settings",
                json={
                    "providers_base": _rev(c),
                    "providers": {
                        "llamacpp": {"base_url": "http://l/v1", "api_mode": "llamacpp", "models": {"m": {}}},
                        bad: {"base_url": "http://e/v1", "models": {"m": {}}},
                    },
                },
            )
            assert r.status_code == 422, f"{bad}: {r.text}"


def test_reserved_verb_named_provider_422s() -> None:
    with _client(_BASE) as (c, _cfg):
        r = c.put(
            "/api/settings",
            json={
                "providers_base": _rev(c),
                "providers": {
                    "llamacpp": {"base_url": "http://l/v1", "api_mode": "llamacpp", "models": {"minig+": {}}},
                    "compact": {"base_url": "http://c/v1", "models": {"m": {}}},  # reserved built-in verb
                },
            },
        )
        assert r.status_code == 422, r.text
        assert "reserved" in r.text.lower()


# ────────────────────────── GET /api/providers (C7/R9) ──────────────────────────
def test_get_providers_shape_and_rev_stable() -> None:
    with _client(_BASE) as (c, _cfg):
        body = c.get("/api/providers").json()
        assert set(body) == {"providers", "rev", "sections", "reserved_verbs", "verbs", "warnings"}
        assert body["providers"]["openrouter"] == {"api_mode": "openrouter", "models": ["qwen3.5", "other"]}
        assert "api_key" not in body["providers"]["openrouter"]  # NAKED — no secrets
        assert body["reserved_verbs"] == ["agent", "privilege", "priv", "clear", "compact", "help"]
        assert body["sections"]["inference"] == {
            "provider": "llamacpp",
            "model": "minig+",
            "fallbacks": [{"provider": "openrouter", "model": "qwen3.5"}],  # clean names, not wire ids
        }
        assert body["rev"] == c.get("/api/providers").json()["rev"]  # stable across reads


def test_get_providers_effective_section_after_lenient_promotion() -> None:
    # blank primary + a configured fallback → boot lenient PROMOTES the fallback; the effective section
    # reports the promoted primary (runtime-only; the persisted doc is untouched).
    cfg_text = (
        "server:\n  port: 5433\n  poll_seconds: 5\n"
        "providers:\n"
        "  llamacpp:\n    base_url: http://l/v1\n    api_mode: llamacpp\n    models:\n      minig+: {}\n"
        "  openrouter:\n    base_url: https://openrouter.ai/api/v1\n    api_mode: openrouter\n"
        "    models:\n      qwen3.5:\n        id: q/w\n"
        "inference:\n  fallbacks:\n    - provider: openrouter\n      model: qwen3.5\n"
    )
    with _client(cfg_text) as (c, _cfg):
        body = c.get("/api/providers").json()
        assert body["sections"]["inference"]["provider"] == "openrouter"  # promoted
        assert body["sections"]["inference"]["model"] == "qwen3.5"
        assert body["sections"]["inference"]["fallbacks"] == []


def test_get_providers_verbs_excludes_multi_model_non_chain() -> None:
    cfg_text = (
        "server:\n  port: 5433\n  poll_seconds: 5\n"
        "providers:\n"
        "  llamacpp:\n    base_url: http://l/v1\n    api_mode: llamacpp\n    models:\n      minig+: {}\n"
        "  openrouter:\n    base_url: https://openrouter.ai/api/v1\n    api_mode: openrouter\n"
        "    models:\n      a:\n        id: x\n      b:\n        id: y\n"
        "  solo:\n    base_url: http://solo/v1\n    models:\n      only: {}\n"
        "inference:\n  provider: llamacpp\n"
    )
    with _client(cfg_text) as (c, _cfg):
        verbs = set(c.get("/api/providers").json()["verbs"])
        assert "llamacpp" in verbs  # in the chain
        assert "solo" in verbs  # sole-model non-chain → still routable
        assert "openrouter" not in verbs  # multi-model non-chain → NOT advertised


def test_skill_shadow_warns_and_excludes_verb_in_get_and_put() -> None:
    with _client(_BASE) as (c, _cfg):
        c.app.state.skills = _FakeSkills("openrouter")  # a skill shadows the provider name
        body = c.get("/api/providers").json()
        assert any("openrouter" in w and "shadowed by a skill" in w for w in body["warnings"])
        assert "openrouter" not in body["verbs"]  # skill wins the /openrouter verb
        # the same live warning rides the PUT response envelope
        r = c.put("/api/settings", json={"server": {"poll_seconds": 7}})
        assert r.status_code == 200, r.text
        assert any("openrouter" in w and "shadowed by a skill" in w for w in r.json()["warnings"])


# ────────────────────────── settings GET providers-rev header (FR2-1) ──────────────────────────
def test_settings_get_carries_providers_rev_header_matching_and_changing() -> None:
    # FR2-1: GET /api/settings binds the Conf draft's concurrency base by carrying the SAME providers
    # fingerprint served by GET /api/providers, and it advances whenever the providers map changes.
    with _client(_BASE) as (c, _cfg):
        r = c.get("/api/settings")
        assert r.status_code == 200, r.text
        assert r.headers["X-Providers-Rev"] == _rev(c)  # header matches GET /api/providers rev
        rev = _rev(c)
        put = c.put(
            "/api/settings",
            json={
                "providers_base": rev,
                "providers": {
                    "llamacpp": {
                        "base_url": "http://192.168.1.137:5001/v1",
                        "api_mode": "llamacpp",
                        "models": {"minig+": {}},
                    },
                    "openrouter": {
                        "base_url": "https://openrouter.ai/api/v1",
                        "api_key": c.get("/api/settings").json()["providers"]["openrouter"]["api_key"],
                        "api_mode": "openrouter",
                        "models": {"qwen3.5": {"id": "qwen/qwen3.5-72b"}, "other": {}, "added": {}},
                    },
                },
            },
        )
        assert put.status_code == 200, put.text
        after = c.get("/api/settings").headers["X-Providers-Rev"]
        assert after == put.json()["providers_rev"]  # header == the PUT's post-write fingerprint
        assert after != rev  # a providers change advanced it


# ────────────────────────── _coerce_mode syntax-only (C7/R14) ──────────────────────────
def test_coerce_mode_syntax_only_slug() -> None:
    from app.api.agent import ChatRequest, _coerce_mode

    assert _coerce_mode("openrouter") == "openrouter"  # arbitrary provider slug passes through
    assert _coerce_mode("minig+") == "minig+"  # slug allows + . - _
    assert _coerce_mode("Bad Name") is None  # space/uppercase → junk → None
    assert _coerce_mode("") is None
    assert _coerce_mode(123) is None  # non-string → None
    # end-to-end through the request model
    assert ChatRequest(text="hi", mode="dynamicprovider").mode == "dynamicprovider"
    assert ChatRequest(text="hi", mode="NOT OK").mode is None


# ────────────────────────── write-back through a hosts-CRUD write (D48 step 4) ──────────────────────────
_LEGACY = (
    "# homelab\n"
    "server:\n  port: 5433\n  poll_seconds: 5\n"
    "inference:\n"
    "  default_mode: local\n"
    "  local:\n    base_url: http://l/v1\n    model: minig+\n    api_mode: llamacpp\n"
    "  cloud:\n    base_url: http://o/v1\n    api_key: sk-REAL\n    model: qwen\n    api_mode: openrouter\n"
)


def test_hosts_crud_write_triggers_migration_writeback_exactly_once() -> None:
    with _client(_LEGACY) as (c, cfg):
        # a hosts-CRUD write BYPASSES apply_settings_patch but funnels through edit_config_yaml, so it
        # materializes the pending migration + writes the ONE 0600 backup + deletes the legacy keys.
        r = c.post("/api/hosts", json={"name": "box", "ip": "10.0.0.9"})
        assert r.status_code == 201, r.text
        disk = cfg.read_text(encoding="utf-8")
        assert "providers:" in disk and "provider: llamacpp" in disk  # new shape materialized
        assert "default_mode" not in disk and "\n  local:" not in disk  # legacy keys deleted
        assert "sk-REAL" in disk  # secret carried onto the provider
        assert "box" in disk  # the host CRUD edit landed too
        baks = list(cfg.parent.glob("config.yaml.bak-a11-*"))
        assert len(baks) == 1
        assert stat.S_IMODE(baks[0].stat().st_mode) == 0o600
        assert "default_mode: local" in baks[0].read_text(encoding="utf-8")  # backup is the OLD file
        assert load_settings(cfg).providers["openrouter"].api_key == "sk-REAL"
        # a SECOND CRUD write does NOT re-backup (consumed exactly once)
        r2 = c.post("/api/hosts", json={"name": "box2", "ip": "10.0.0.10"})
        assert r2.status_code == 201, r2.text
        assert len(list(cfg.parent.glob("config.yaml.bak-a11-*"))) == 1
