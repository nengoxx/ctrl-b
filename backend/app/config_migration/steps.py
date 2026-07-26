"""The A11 fold — the one and only config-shape migration step (`docs/UPDATE_PLAN.md` §11 / D48).

**This file is the deletable part.** It holds every piece of knowledge about the legacy config shape:
the `inference.local`/`cloud`/`fallbacks` slots, the `voice.stt`/`voice.tts` `primary`/`fallback` pairs,
the single-endpoint `embeddings` block, and `mode: local|cloud` inside a `ModelRef`. Nothing outside
this package reads any of it any more — `config.py` was stripped of the fold when this file was
created, so retiring the migration is deleting this file, emptying `STEPS` and bumping `VERSION`.

Lifted verbatim from `config.py::_migrate_legacy` (A11/D48), with four changes, each with a reason:

1. **The `"providers" not in raw` chat guard is gone.** It made the mere PRESENCE of a `providers:`
   key — including `providers: {}`, and a bare `providers:` line, which YAML parses to `None` —
   permanently block the chat fold, silently. A partially migrated config (providers present, legacy
   `inference.local` still there) now migrates, which is the whole point.
2. **It runs on a deep copy.** The original shallow-copied the top level and then let
   `walk_model_refs` mutate nested refs it shared with its input; a step must not touch `ctx.config`,
   or the runner's diff would compare a document against itself and see no change.
3. **Consumed keys are returned as key-segment paths**, and now include the `…mode` keys the ModelRef
   rewrite removes — the runner refuses any removal a step did not declare.
4. **The agent-file fold takes the slot map as an argument** instead of reading a module global that
   the config load had to stash for it, and its result is *persisted* by the runner rather than
   recomputed on every agent load.
"""

from __future__ import annotations

import copy
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from app.config import MODEL_REF_HOMES, model_ref_at
from app.config_migration import Context, MigrationRefused, Plan, Step

#: The `ModelRef` homes INSIDE an `agents/<name>/agent.yaml`. That file is an `agent.defaults`-shaped
#: document, so its homes are exactly `MODEL_REF_HOMES`' `agent.defaults.*` entries with the prefix
#: dropped — derived rather than restated, so the closed list stays one list (D48 C1).
AGENT_FILE_MODEL_REF_HOMES: tuple[tuple[str, ...], ...] = tuple(
    home[2:] for home in MODEL_REF_HOMES if home[:2] == ("agent", "defaults")
)


def _canonical_base_url_key(url: str) -> str:
    """Lowercased scheme+host, default ports elided, trailing slash stripped, path preserved — the
    migration endpoint-dedup key (matches `core.provider_registry.canonical_base_url`; a tiny pure
    duplicate here to avoid a config->core import cycle)."""
    parts = urlsplit(url if "://" in url else f"http://{url}")
    scheme = (parts.scheme or "http").lower()
    host = (parts.hostname or "").lower()
    port = parts.port
    default = {"http": 80, "https": 443}.get(scheme)
    netloc = host if (port is None or port == default) else f"{host}:{port}"
    return f"{scheme}://{netloc}{parts.path.rstrip('/')}"


def _provider_name_from_api_mode(api_mode: str, taken: set[str]) -> str:
    """Derive a provider name from an endpoint's api_mode, suffixing -2,-3... on collision (D48 step 1)."""
    base = api_mode if api_mode in ("llamacpp", "openrouter", "openai", "none") else "openai"
    if base not in taken:
        return base
    i = 2
    while f"{base}-{i}" in taken:
        i += 1
    return f"{base}-{i}"


def _provider_name_from_host_port(base_url: str, taken: set[str]) -> str:
    """Derive a provider name for a MIGRATED voice/embeddings endpoint from its base_url (D48 step 2): a
    host-port slug (lowercased host with dots kept, `-<port>` only when the port is explicit; scheme/path
    stripped), sanitized to the provider slug charset (`^[a-z0-9][a-z0-9_+.-]{0,31}$`), suffixed -2,-3…
    on collision. Chat endpoints use `_provider_name_from_api_mode`; voice/embeddings have no api_mode
    identity, so the host is the natural name (e.g. `http://emma:9000/v1` → `emma-9000`)."""
    parts = urlsplit(base_url if "://" in base_url else f"http://{base_url}")
    host = (parts.hostname or "").lower()
    slug = f"{host}-{parts.port}" if parts.port is not None else host
    slug = re.sub(r"[^a-z0-9_+.\-]", "-", slug)  # replace out-of-charset chars
    slug = re.sub(r"^[^a-z0-9]+", "", slug)[:32] or "provider"  # must start with [a-z0-9], cap 32
    if slug not in taken:
        return slug
    # Suffix `-N` on collision, but keep the WHOLE name ≤ 32 (the provider-slug cap the model validates):
    # truncate the BASE so `base + "-N"` fits, re-truncating as N grows to more digits (FX-D).
    i = 2
    while True:
        suffix = f"-{i}"
        candidate = f"{slug[: 32 - len(suffix)]}{suffix}"
        if candidate not in taken:
            return candidate
        i += 1


def _chat_is_legacy(inf: Any) -> bool:
    """The `inference` subtree is legacy-shaped iff it carries a slot/fallback list AND has no
    new-shape `provider` pointer — the subtree-level new-wins rule (D48 migration step 1 trigger).

    Note what is NOT here: the old trigger also required `"providers" not in raw`, which made the mere
    presence of that key block the fold forever. Merging into an existing `providers` map is what the
    fold does anyway, so the guard bought nothing and cost a silent no-op.
    """
    return (
        isinstance(inf, dict)
        and "provider" not in inf
        # `default_mode` is in this list because the postcondition IS `applies`: a key the fold strips
        # but never triggers on would be left on disk under a "verified" stamp, unreachable by the one
        # assertion that guarantees zero legacy keys.
        and any(k in inf for k in ("default_mode", "local", "cloud", "fallbacks"))
    )


def _voice_service_is_legacy(svc: Any) -> bool:
    """A `voice.stt`/`voice.tts` subtree is legacy-shaped iff it carries a `primary`/`fallback` slot
    AND has no new-shape `provider` pointer (D48 migration step 2 trigger). The `provider` guard is the
    subtree-level new-wins rule the chat + embeddings triggers already apply: a hand-authored doc holding
    BOTH shapes keeps the new pointer untouched (legacy ignored, not deleted — the recorded residual)."""
    return isinstance(svc, dict) and "provider" not in svc and ("primary" in svc or "fallback" in svc)


def _embeddings_is_legacy(emb: Any) -> bool:
    """The `embeddings` subtree is legacy-shaped iff it carries any single-endpoint field
    (`base_url`/`api_key`/`model`/`dim`) AND has no new-shape `provider` pointer (D48 step 2 trigger)."""
    return (
        isinstance(emb, dict)
        and "provider" not in emb
        and any(k in emb for k in ("base_url", "api_key", "model", "dim"))
    )


def _migrate_legacy(
    doc: Mapping[str, Any],
) -> tuple[dict[str, Any], dict[str, str], list[tuple[str, ...]]]:
    """The raw-YAML fold (A11/D48 §Migration): the legacy local/cloud/fallbacks `inference` shape, the
    `voice.stt`/`voice.tts` primary/fallback slots, and the single-endpoint `embeddings` block -> the
    top-level `providers` map + each section's flat `provider`+`fallbacks`. Returns
    (migrated_doc, slot_map, consumed_paths).

    Pure: `doc` is deep-copied on entry and never mutated, so a step can be called twice, or called and
    discarded, without touching the runner's `Context`.

    PER-SUBTREE idempotent + independent: each of the four folds (chat / stt / tts / embeddings) fires iff
    ITS OWN subtree is legacy-shaped, regardless of the others — so a Slice-1-migrated config (chat already
    on `providers:`) with legacy voice MERGES the voice endpoints into the EXISTING providers map (dedup by
    canonical base_url + api_key, against pre-existing AND freshly-created providers). Nothing legacy ->
    a copy of the input, {}, []; re-running on a migrated doc changes nothing (it is not the SAME object
    any more — purity costs identity, and only equality was ever meaningful).

    Two phases: (1) fold every legacy endpoint into `providers` (dedup + accrete models), recording each
    section's ordered `(provider, model)` ref list; (2) once the catalog is FINAL, materialize each
    section's `provider`/`model`/`fallbacks` — the model is omitted iff the (possibly merged) provider ends
    with exactly one model. Chat names derive from api_mode; voice/embeddings names are host-port slugs.
    Config-held ModelRef homes are then rewritten `mode:` -> `provider:` through the slot map, which is
    the LAST thing to happen because the map is only final once the chat fold has run."""
    raw: dict[str, Any] = copy.deepcopy(dict(doc))
    inf = raw.get("inference")
    chat_legacy = _chat_is_legacy(inf)
    raw_voice = raw.get("voice")
    if not isinstance(raw_voice, dict):
        raw_voice = {}
    stt_legacy = _voice_service_is_legacy(raw_voice.get("stt"))
    tts_legacy = _voice_service_is_legacy(raw_voice.get("tts"))
    raw_emb = raw.get("embeddings")
    if not isinstance(raw_emb, dict):
        raw_emb = {}
    emb_legacy = _embeddings_is_legacy(raw_emb)
    # A stray `mode:` is legacy data in its own right, even when every SECTION is already new-shape —
    # otherwise a config holding nothing but a stale ref would return early, never be rewritten, and
    # keep `applies` True forever (the runner would report a post-commit verification failure).
    if not (chat_legacy or stt_legacy or tts_legacy or emb_legacy or _refs_with_mode(raw)):
        return raw, {}, []

    # Seed the providers map + identity index from any EXISTING providers (a partially migrated doc), so
    # a voice/embeddings endpoint sharing a base_url+key with an existing provider REUSES it (never dups).
    # A `providers:` that is neither absent, null nor a mapping is refused rather than coerced: `.items()`
    # on a string is an AttributeError that escapes `MigrationRefused` (so the runner's own validation
    # never gets to speak), and coercing a falsey one to `{}` would overwrite the operator's data with an
    # empty map. `providers:` written bare (YAML `None`) is fine — that is a key waiting to be filled.
    existing = raw.get("providers")
    if existing is not None and not isinstance(existing, dict):
        raise MigrationRefused(
            "`providers:` must be a mapping of name -> provider",
            remedy="fix or remove the `providers:` key, then re-run",
        )
    providers: dict[str, dict[str, Any]] = copy.deepcopy(existing or {})
    by_identity: dict[tuple[str, str | None], str] = {}
    for pname, pcfg in providers.items():
        if isinstance(pcfg, dict) and pcfg.get("base_url"):
            # `or None` here too: an existing provider carrying `api_key: ""` must present the SAME
            # identity as a legacy endpoint with no key, or the two split into duplicate providers.
            key = (_canonical_base_url_key(pcfg["base_url"]), pcfg.get("api_key") or None)
            by_identity.setdefault(key, pname)

    slot_map: dict[str, str] = {}
    consumed: list[tuple[str, ...]] = []

    def _add_endpoint(
        ep: dict[str, Any],
        *,
        name_for: Any,
        model_entry: Any,
        default_model: str = "",
        require_model: bool = False,
    ) -> tuple[str, str] | None:
        base_url = ep.get("base_url") or ""
        if not base_url:
            return None
        model = ep.get("model") or default_model or ""
        if require_model and not model:  # embeddings: a blank model = never configured -> drop
            return None
        # `""` and absent are the same credential — none. Left distinct, they split one endpoint into
        # two byte-identical providers, the second suffixed `-2`.
        api_key = ep.get("api_key") or None
        identity = (_canonical_base_url_key(base_url), api_key)
        name = by_identity.get(identity)
        if name is None:
            name = name_for(ep, base_url, set(providers))
            prov: dict[str, Any] = {"base_url": base_url}
            if api_key:
                prov["api_key"] = api_key
            if ep.get("api_mode") and ep["api_mode"] != "openai":
                prov["api_mode"] = ep["api_mode"]
            for k in ("max_concurrent_requests", "retry_attempts", "max_tokens_field"):
                if ep.get(k) is not None:
                    prov[k] = ep[k]
            prov["models"] = {}
            providers[name] = prov
            by_identity[identity] = name
        if model:
            # Accrete per-field into an EXISTING model entry (FX-C): a Slice-1 chat fold (or an earlier
            # voice fold) may already hold this model KEY, so `setdefault(model, …)` would drop THIS
            # endpoint's migrated fields (e.g. the embeddings `dim` for a model the chat fold created).
            # Per-field `setdefault` merges each new field in without overwriting a field already present.
            entry = providers[name].setdefault("models", {}).setdefault(model, {})  # name == id
            for k, v in model_entry(ep).items():
                entry.setdefault(k, v)
        return name, model

    def _chat_name(ep: dict[str, Any], _url: str, taken: set[str]) -> str:
        return _provider_name_from_api_mode(str(ep.get("api_mode") or "openai"), taken)

    def _hostport_name(_ep: dict[str, Any], url: str, taken: set[str]) -> str:
        return _provider_name_from_host_port(url, taken)

    def _chat_model(ep: dict[str, Any]) -> dict[str, Any]:
        entry: dict[str, Any] = {}
        if ep.get("context_window") is not None:
            entry["context_window"] = ep["context_window"]
        if ep.get("extra_body"):
            entry["extra_body"] = ep["extra_body"]
        return entry

    migrated: dict[str, Any] = dict(raw)
    # (section-dict, ordered refs) pairs, materialized in phase 2 once the catalog is final.
    to_materialize: list[tuple[dict[str, Any], list[tuple[str, str]]]] = []

    # ── chat fold ──
    if chat_legacy:
        assert isinstance(inf, dict)

        def _ep(v: Any) -> dict[str, Any]:
            return v if isinstance(v, dict) else {}

        named_slots = {"local": _ep(inf.get("local")), "cloud": _ep(inf.get("cloud"))}
        fallbacks = [f for f in inf.get("fallbacks") or [] if isinstance(f, dict)]
        _dm = inf.get("default_mode")
        default_mode = str(_dm) if _dm in ("local", "cloud") else "local"
        for slot in ("local", "cloud"):
            res = _add_endpoint(named_slots[slot], name_for=_chat_name, model_entry=_chat_model)
            if res is not None:
                slot_map[slot] = res[0]
        other = "cloud" if default_mode == "local" else "local"
        chat_refs: list[tuple[str, str]] = []
        for ep in [named_slots[default_mode], named_slots[other], *fallbacks]:
            res = _add_endpoint(ep, name_for=_chat_name, model_entry=_chat_model)
            if res is not None:
                chat_refs.append(res)
        new_inf = {k: v for k, v in inf.items() if k not in ("default_mode", "local", "cloud", "fallbacks")}
        migrated["inference"] = new_inf
        to_materialize.append((new_inf, chat_refs))
        consumed += [("inference", k) for k in ("default_mode", "local", "cloud", "fallbacks") if k in inf]

    # ── voice folds (stt / tts, each independent) ──
    if stt_legacy or tts_legacy:
        new_voice = copy.deepcopy(raw_voice)
        migrated["voice"] = new_voice
        for svc_name, is_legacy, default_model in (
            ("stt", stt_legacy, "whisper-1"),
            ("tts", tts_legacy, "tts-1"),
        ):
            if not is_legacy:
                continue
            svc = raw_voice.get(svc_name)
            svc = svc if isinstance(svc, dict) else {}
            primary = svc.get("primary")
            primary = primary if isinstance(primary, dict) else {}
            fallback = svc.get("fallback")
            fallback = fallback if isinstance(fallback, dict) else {}

            def _voice_model(ep: dict[str, Any], *, _svc: str = svc_name) -> dict[str, Any]:
                # TTS: the endpoint's `voice` id lands on the model entry (voice ids are model-specific).
                # STT: no per-model field (language is service-level, stays on the section knobs).
                entry: dict[str, Any] = {}
                if _svc == "tts" and ep.get("voice"):
                    entry["voice"] = ep["voice"]
                return entry

            svc_refs: list[tuple[str, str]] = []
            for ep in (primary, fallback):
                res = _add_endpoint(
                    ep, name_for=_hostport_name, model_entry=_voice_model, default_model=default_model
                )
                if res is not None:
                    svc_refs.append(res)
            new_svc = {k: v for k, v in svc.items() if k not in ("primary", "fallback")}
            new_voice[svc_name] = new_svc
            to_materialize.append((new_svc, svc_refs))
            consumed += [("voice", svc_name, k) for k in ("primary", "fallback") if k in svc]

    # ── embeddings fold (the block itself is the single endpoint; its `dim` -> the model entry) ──
    if emb_legacy:
        emb_dim = raw_emb.get("dim")

        def _emb_model(_ep: dict[str, Any]) -> dict[str, Any]:
            return {"dim": emb_dim} if emb_dim is not None else {}

        res = _add_endpoint(raw_emb, name_for=_hostport_name, model_entry=_emb_model, require_model=True)
        emb_refs = [res] if res is not None else []
        new_emb = {k: v for k, v in raw_emb.items() if k not in ("base_url", "api_key", "model", "dim")}
        migrated["embeddings"] = new_emb
        to_materialize.append((new_emb, emb_refs))
        consumed += [("embeddings", k) for k in ("base_url", "api_key", "model", "dim") if k in raw_emb]

    if providers or "providers" in raw:  # never introduce an empty `providers:` key
        migrated["providers"] = providers

    # ── phase 2: materialize each section's provider/model/fallbacks against the FINAL catalog ──
    def _section_ref(pname: str, model: str) -> dict[str, Any]:
        ref: dict[str, Any] = {"provider": pname}
        if len(providers[pname].get("models") or {}) != 1 and model:
            ref["model"] = model  # a merged multi-model provider must name its model
        return ref

    for sect, refs in to_materialize:
        if not refs:
            continue
        pname, model = refs[0]
        sect["provider"] = pname
        if len(providers[pname].get("models") or {}) != 1 and model:
            sect["model"] = model
        sect["fallbacks"] = [_section_ref(p, m) for p, m in refs[1:]]

    # ── config-held ModelRef homes: `mode:` -> `provider:` through the slot map ──
    # Runs UNCONDITIONALLY, not only when the chat fold fired: a stale `mode:` beside an already-migrated
    # `inference` is still legacy data, and leaving it would keep the step applying forever. Walked by
    # PATH rather than via `walk_model_refs`, over the same closed list, so each rewrite can be declared —
    # the runner refuses a removal no step owned up to. Unmappable `local`/`cloud` values never reach
    # here: `a11_apply` refuses them against this same map first.
    for home in MODEL_REF_HOMES:
        ref = model_ref_at(migrated, home)
        if ref is None or "mode" not in ref:
            continue
        mode_val = ref.pop("mode")
        consumed.append((*home, "mode"))
        if "provider" in ref:
            continue  # both shapes on one ref: the NEW field wins, as everywhere else (D48 new-wins)
        if isinstance(mode_val, str):
            # A value that is not a legacy slot is a provider NAME the operator wrote — kept as-is (it
            # may dangle, and a dangling provider degrades to the default chain at resolve, which beats
            # inventing one). A non-string `mode:` leaves no provider at all -> inherit.
            ref["provider"] = slot_map.get(mode_val, mode_val)

    return migrated, slot_map, consumed


def _fold_agent_modes(doc: Mapping[str, Any], slot_map: Mapping[str, str]) -> dict[str, Any]:
    """`mode:` -> `provider:` inside one `agents/<name>/agent.yaml`, on a copy.

    The mapping only exists as a by-product of folding the legacy config, which is why this takes the
    slot map as an argument. Before this slice it read a module-level stash that the config load had to
    leave behind for it, and it ran on EVERY agent load, forever; now it runs once and the result is
    written to the file.
    """
    raw = copy.deepcopy(dict(doc))
    for home in AGENT_FILE_MODEL_REF_HOMES:
        ref = model_ref_at(raw, home)
        if ref is None or "mode" not in ref:
            continue
        mode_val = ref.pop("mode")
        if "provider" in ref:
            continue  # both shapes on one ref: the NEW field wins (D48 new-wins), same as the config side
        if isinstance(mode_val, str):
            ref["provider"] = slot_map.get(mode_val, mode_val)
    return raw


def _config_is_legacy(config: Mapping[str, Any]) -> bool:
    """True while any of the four subtrees still holds its legacy shape."""
    voice = config.get("voice")
    voice = voice if isinstance(voice, dict) else {}
    return (
        _chat_is_legacy(config.get("inference"))
        or _voice_service_is_legacy(voice.get("stt"))
        or _voice_service_is_legacy(voice.get("tts"))
        or _embeddings_is_legacy(config.get("embeddings"))
    )


def _refs_with_mode(config: Mapping[str, Any]) -> list[tuple[str, ...]]:
    """Config-held `ModelRef` homes still carrying a legacy `mode:`."""
    return [h for h in MODEL_REF_HOMES if "mode" in (model_ref_at(dict(config), h) or {})]


def _agents_with_mode(agents: Mapping[Path, Mapping[str, Any]]) -> list[Path]:
    return [
        p
        for p, doc in agents.items()
        if any("mode" in (model_ref_at(dict(doc), h) or {}) for h in AGENT_FILE_MODEL_REF_HOMES)
    ]


def a11_applies(ctx: Context) -> bool:
    """True while ANY legacy A11 shape survives — in `config.yaml` or in a side file.

    Side files count (§3.1): an agent still holding `mode:` must keep the config from being stamped
    "verified", or the migration would declare victory over a workspace it had not finished.
    """
    return bool(_config_is_legacy(ctx.config) or _refs_with_mode(ctx.config) or _agents_with_mode(ctx.agents))


def a11_apply(ctx: Context) -> Plan:
    """Fold the config, then rewrite every agent file that still names a legacy slot."""
    migrated, slot_map, consumed = _migrate_legacy(ctx.config)
    _refuse_unmappable(ctx, slot_map)
    agent_files = {p: _fold_agent_modes(ctx.agents[p], slot_map) for p in _agents_with_mode(ctx.agents)}
    return Plan(config=migrated, consumes=list(consumed), agent_files=agent_files)


#: The two legacy slot names. Only these need the map; anything else in a `mode:` is a provider name.
_LEGACY_SLOTS = ("local", "cloud")


def _refuse_unmappable(ctx: Context, slot_map: Mapping[str, str]) -> None:
    """Refuse the one state this step cannot honestly repair (§3.9), tested against the ACTUAL map.

    `mode: local|cloud` is only meaningful against the slot map the chat fold produces. The question is
    never "does a legacy `inference` block exist" — `inference: {fallbacks: []}` is legacy-shaped and
    still yields an EMPTY map — but "did the fold actually produce the slot this ref names". Asking the
    map itself also stops the mirror-image mistake: `mode: null`, `mode: 3` and `mode: openrouter` are
    all handled (dropped, dropped, kept as a provider name) and must not be refused merely because the
    chat block happens to be migrated already.

    Converting an unmappable slot anyway would write a provider named `local` — syntactically valid, so
    validation passes and the postcondition passes, and the operator finds out when a model quietly
    answers from the default chain instead of the endpoint they meant.
    """

    def _is_stranded(ref: dict[str, Any] | None) -> bool:
        # A ref carrying BOTH shapes is never stranded: the rewrite keeps its `provider` and drops the
        # `mode` (new-wins). Refusing it would tell the operator to "set `provider:` explicitly" on a
        # ref where it already is set.
        if ref is None or "provider" in ref:
            return False
        val = ref.get("mode")
        return isinstance(val, str) and val in _LEGACY_SLOTS and val not in slot_map

    stranded: list[str] = []
    for home in MODEL_REF_HOMES:
        ref = model_ref_at(ctx.config, home)
        if _is_stranded(ref):
            stranded.append(f"{'.'.join(home)} (mode: {(ref or {}).get('mode')})")
    for path, doc in sorted(ctx.agents.items()):
        for home in AGENT_FILE_MODEL_REF_HOMES:
            ref = model_ref_at(dict(doc), home)
            if _is_stranded(ref):
                mode = (ref or {}).get("mode")
                stranded.append(f"agents/{path.parent.name}/agent.yaml:{'.'.join(home)} (mode: {mode})")
    if not stranded:
        return
    raise MigrationRefused(
        "`mode:` names a legacy slot this config no longer defines, at "
        + ", ".join(stranded)
        + " — there is no `inference.local`/`cloud` block left to say what it pointed at, so the "
        "mapping cannot be reconstructed",
        remedy=(
            "set `provider: <name>` explicitly at each of those (see `providers:` for the names), or "
            "re-save the agent in the editor, then re-run"
        ),
    )


#: One-level env-override paths (`CTRLB_<SECTION>__<KEY>`) this fold leaves DEAD — legacy knowledge,
#: so it lives here and is deleted with the step. A variable naming one of these used to reach a real
#: field and now reaches nothing; `--check`/`--apply` refuse rather than let an operator update a box
#: while believing a credential is still being supplied.
#:
#: Two rules decide membership, and both matter:
#:  1. **Only what the one-level grammar can address.** The voice slots (`voice.stt.primary.api_key`)
#:     sit two levels down and were never reachable by an env var, so retiring them would be theatre.
#:  2. **Only what the NEW schema no longer declares.** `embeddings.model` and `inference.fallbacks`
#:     are consumed by this fold *and still exist* — same spelling, new meaning (a provider-relative
#:     model selector; a structured ref list). Listing them would refuse a valid
#:     `CTRLB_EMBEDDINGS__MODEL`. `test_no_retired_path_names_a_live_field` pins the rule against the
#:     live models so the next step cannot get this wrong.
A11_RETIRED_ENV_PATHS: tuple[tuple[str, str], ...] = (
    ("inference", "default_mode"),
    ("inference", "local"),
    ("inference", "cloud"),
    ("embeddings", "base_url"),
    ("embeddings", "api_key"),  # the only one that ever carried a credential
    ("embeddings", "dim"),
)

#: The one migration step. `applies` is checked on every run regardless of the file's stamp (§3.1).
A11 = Step(version=1, applies=a11_applies, apply=a11_apply, retires=A11_RETIRED_ENV_PATHS)
