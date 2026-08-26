"""The config-shape migration steps (`docs/UPDATE_PLAN.md` §3) — today: the A11 fold (step 1) and
D65's media fold (step 2).

**This file is the deletable part.** It holds every piece of knowledge about the legacy config shapes:
the `inference.local`/`cloud`/`fallbacks` slots, the `voice.stt`/`voice.tts` `primary`/`fallback` pairs,
the single-endpoint `embeddings` block, `mode: local|cloud` inside a `ModelRef` — and the pre-D65
`media.<ns>` blocks with their `order: [names]` lists. Nothing outside this package reads any of it any
more — `config.py` was stripped of the A11 fold when this file was created and never learned the old
media shape at all, so retiring a migration is deleting its half of this file, dropping it from `STEPS`
and bumping `VERSION`.

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
from app.core.media import MEDIA_NAMESPACES

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
        # Only emit `fallbacks:` when there is at least one — a single-endpoint section would otherwise
        # get a cosmetic `fallbacks: []` written into config.yaml. Absence is the model default (an empty
        # list), so this is shape-equivalent AND keeps re-running the fold on a folded config diff-free.
        section_fallbacks = [_section_ref(p, m) for p, m in refs[1:]]
        if section_fallbacks:
            sect["fallbacks"] = section_fallbacks

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
#:     `CTRLB_EMBEDDINGS__MODEL`.
#:
#: Both rules are pinned mechanically, and it takes both tests:
#: `test_no_retired_path_names_a_live_field` is SOUNDNESS (nothing listed here is still declared) and
#: passes for an empty list, so `test_the_retired_list_is_exactly_what_the_fold_kills_and_the_schema_forgot`
#: supplies COMPLETENESS by deriving this set from the fold's own `consumes`.
A11_RETIRED_ENV_PATHS: tuple[tuple[str, str], ...] = (
    ("inference", "default_mode"),
    ("inference", "local"),
    ("inference", "cloud"),
    ("embeddings", "base_url"),
    ("embeddings", "api_key"),  # the only one that ever carried a credential
    ("embeddings", "dim"),
)

#: Step 1. `applies` is checked on every run regardless of the file's stamp (§3.1).
A11 = Step(version=1, applies=a11_applies, apply=a11_apply, retires=A11_RETIRED_ENV_PATHS)


# ── step 2: D65's media fold (`config_version` 1 → 2) ────────────────────────────────────────────
#
# Two shape changes in one step, because they are one ruling (MEDIA_MANAGER_PLAN §2.2):
#
#   1. `media.<ns>` → `media.namespaces.<ns>`. The `media` block needed a sibling that is NOT a
#      namespace (`media.write.max_bytes`), and `write:` beside `gacha:`/`kit:` would parse as a
#      namespace called "write". That is the fold's whole reason.
#   2. `…roles.<role>.order: [n1, n2]` → `…roles.<role>.files: [{name: n1}, {name: n2}]`. The same
#      list, grown from bare names into per-item objects so an entry can carry its own `hidden`,
#      `focal` and `key` (the extend-don't-migrate directive).
#   3. `…slots.<key>: lyra` → `…slots.<key>: {bundled: lyra}`. The same pin, grown from a bare STEM
#      into the identity UNION a `files` entry already carries (the 2026-08-26 owner ruling, "W9").
#      See `_typed_pin` below for what the fold can and cannot say.
#
# **Config-pure and BUNDLED-FREE.** A step never touches the filesystem (its own contract), and the
# `files` half writes no `{bundled: …}` entries even though bundled art is now listable: paint parity
# is achieved by the COLLATION instead (`list_role`'s fallback tier), which is exactly what makes the
# migration implementable without reading the owner's media tree (§2.3/§2.4, Emma #2 re-derived).
# A migrated config therefore looks like the config the owner had, and the index looks like the index
# they had — with the bundled ids appended as the unlisted tier they already behaved as.
#
# The PIN half is where purity actually bites, and the contract won (MEDIA_MANAGER_PLAN §12, "W9"):
# `Context` carries the parsed documents and nothing else — no `$CTRLB_HOME`, no path to resolve —
# so a legacy stem cannot be turned into the FILENAME the typed `{name: …}` arm needs. It writes
# `{bundled: …}` here and only here, and that is not a violation of the bundled-free rule above but
# its exact complement: a bundled id is REGISTRY knowledge (`MediaSlot.source` → `MediaRole.bundled`),
# which is code, so resolving one reads nothing on disk. A stem that is not a bundled id is DROPPED —
# see `_typed_pin`.


def _media_namespace_keys(media: Mapping[str, Any]) -> list[str]:
    """The namespace blocks still sitting at `media.<ns>` (pre-fold). Only KNOWN namespaces move: a
    typo'd `media.gachaa` is not a namespace this build can name, so the step leaves it exactly where
    the owner wrote it rather than inventing a home for it (inert cruft is visible; a guess is not)."""
    return [k for k in media if k in MEDIA_NAMESPACES]


def _roles_with_order(namespaces: Mapping[str, Any]) -> list[tuple[str, str]]:
    """`(ns, role)` for every role block still carrying an `order:` list, under the FOLDED shape."""
    out: list[tuple[str, str]] = []
    for ns, block in namespaces.items():
        if not isinstance(block, dict):
            continue
        roles = block.get("roles")
        if not isinstance(roles, dict):
            continue
        out += [(ns, role) for role, cfg in roles.items() if isinstance(cfg, dict) and "order" in cfg]
    return out


def _legacy_pins(namespaces: Mapping[str, Any]) -> list[tuple[str, str]]:
    """`(ns, slot)` for every pin still holding a bare pre-"W9" value — a stem instead of the identity
    union — under a slot key THIS BUILD KNOWS, in the folded shape.

    A pin under an unknown key is deliberately not in this list: it is a knob that does not exist (a
    retired pool pin, a typo), and the config model refuses it out loud by name. Folding it would
    convert that refusal into a silent deletion, which is the one outcome the "W6" removals were ruled
    against.
    """
    out: list[tuple[str, str]] = []
    for ns, block in namespaces.items():
        row = MEDIA_NAMESPACES.get(ns)
        if row is None or not isinstance(block, dict):
            continue
        slots = block.get("slots")
        if not isinstance(slots, dict):
            continue
        out += [
            (ns, k) for k, v in slots.items() if k in row.slots and v is not None and not isinstance(v, dict)
        ]
    return out


def _typed_pin(ns: str, slot: str, value: Any) -> dict[str, str] | None:
    """One legacy pin as the identity union, or `None` for "this pin cannot be typed truthfully".

    The value WAS a stem, and a stem answered to two identity spaces at once — the whole reason the
    shape changed. Only one of those two is reachable from here:

    * a stem that IS a bundled id of the seat's SOURCE role becomes `{bundled: <id>}`. The registry is
      code, so this reads nothing on disk and the fold stays pure.
    * anything else was naming a FILE, and the typed `name` arm holds a FILENAME (`lyra.webp`), not a
      stem. Recovering the filename means listing the role folder, which a step may not do. So the pin
      is DROPPED, and the seat falls back to its own ladder exactly as a dangling pin already did.

    Dropping beats guessing and beats keeping. A `{name: "lyra"}` invented from a stem would be a pin
    that can never resolve, persisted forever under a "verified" stamp — an owner-visible lie in the
    file they may open. An unpinned seat is a true statement the owner can fix in one tap, and the
    dropped key is REPORTED: the step declares it consumed, so `--check`/`--apply` name it in the
    legacy-key list.
    """
    row = MEDIA_NAMESPACES[ns]
    source = row.slots[slot].source
    ships = row.roles[source].bundled if source in row.roles else ()
    return {"bundled": value} if isinstance(value, str) and value in ships else None


def _media_view(config: Mapping[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """`(media, namespaces)` as plain dicts — the two nodes both halves of this step read. Either can
    be absent or the wrong shape in a hand-authored file; both come back `{}` then, and `applies`
    answers False, which is the right verdict for a document this step cannot honestly fold."""
    media = config.get("media")
    if not isinstance(media, dict):
        return {}, {}
    nss = media.get("namespaces")
    return media, nss if isinstance(nss, dict) else {}


def media_v2_applies(ctx: Context) -> bool:
    """True while a namespace block sits at `media.<ns>`, any role still carries `order:`, or any known
    slot still holds a bare pre-"W9" pin value."""
    media, namespaces = _media_view(ctx.config)
    if not media:
        return False
    # A namespace still sitting at the old level settles it on its own — and once that is out of the
    # way the only blocks left to inspect are the folded ones, so the two remaining questions read
    # `namespaces` directly rather than a merged view of both shapes.
    if _media_namespace_keys(media):
        return True
    return bool(_roles_with_order(namespaces)) or bool(_legacy_pins(namespaces))


def media_v2_apply(ctx: Context) -> Plan:
    """Fold the namespaces down a level and turn every `order:` list into a `files:` list.

    New-wins on a collision (the house rule every A11 fold above follows): a document holding BOTH
    `media.gacha` and `media.namespaces.gacha` keeps the folded one and still declares the old key
    consumed, so the write-back deletes it — a half-migrated file converges instead of accreting.
    """
    raw: dict[str, Any] = copy.deepcopy(dict(ctx.config))
    media = raw.get("media")
    if not isinstance(media, dict):  # pragma: no cover — `applies` already refused this
        return Plan(config=raw)
    consumed: list[tuple[str, ...]] = []

    # The A11 `providers:` precedent: a key that is neither absent, null nor a mapping is REFUSED
    # rather than coerced — folding into it would overwrite whatever the operator actually wrote,
    # and the diff writer would record that as an ordinary change nobody authorised.
    existing = media.get("namespaces")
    if existing is not None and not isinstance(existing, dict):
        raise MigrationRefused(
            "`media.namespaces:` must be a mapping of namespace -> its media block",
            remedy="fix or remove the `media.namespaces:` key, then re-run",
        )
    namespaces: dict[str, Any] = existing if isinstance(existing, dict) else {}
    for ns in _media_namespace_keys(media):
        namespaces.setdefault(ns, media[ns])
        del media[ns]
        consumed.append(("media", ns))
    if namespaces or "namespaces" in media:
        media["namespaces"] = namespaces

    for ns, role in _roles_with_order(namespaces):
        cfg = namespaces[ns]["roles"][role]
        where = f"media.namespaces.{ns}.roles.{role}.order"
        # REFUSE, don't coerce (the A11 `providers:` precedent). `order: null`, a scalar or a mapping
        # carries the owner's intent in a shape this step cannot read — and popping it anyway would
        # turn their library into an empty list under a "verified" stamp, which is data destroyed
        # silently. A `files` already beside it is the one exception: new-wins, so the unreadable
        # legacy key is genuinely dead and dropping it is the migration doing its job.
        order = cfg["order"]
        if "files" not in cfg and not isinstance(order, list):
            raise MigrationRefused(
                f"`{where}` must be a list of filenames — this build cannot fold "
                f"{type(order).__name__} into the new `files:` list",
                remedy=(
                    f"make `{where}` a list (or delete the key, and re-order in the gallery), then re-run"
                ),
            )
        del cfg["order"]
        consumed.append(("media", "namespaces", ns, "roles", role, "order"))
        if "files" not in cfg:
            cfg["files"] = [{"name": n} for n in order]

    # The PIN half ("W9"). No REFUSAL arm here, unlike `order:` above, and the asymmetry is the data's:
    # an `order:` that is not a list is a LIBRARY — the owner's whole arrangement, which this build must
    # not throw away on a guess — while a pin is one binding of one picture that every ladder already
    # degrades from. Whatever a pin holds, the honest outcomes are "type it" or "unpin it".
    for ns, slot in _legacy_pins(namespaces):
        slots = namespaces[ns]["slots"]
        typed = _typed_pin(ns, slot, slots[slot])
        if typed is None:
            del slots[slot]
            consumed.append(("media", "namespaces", ns, "slots", slot))
        else:
            slots[slot] = typed

    return Plan(config=raw, consumes=list(consumed))


#: Step 2 — D65's media fold. Retires no env override: `media` was never a one-level scalar path, so
#: `CTRLB_MEDIA__…` never reached anything (the A11 list's rule ① — only what the grammar can address).
MEDIA_V2 = Step(version=2, applies=media_v2_applies, apply=media_v2_apply)
