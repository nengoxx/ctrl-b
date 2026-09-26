# R89 — Emma second audit: roleplay / character-card subsystem

**Date:** 2026-09-26  
**Auditor:** Emma (gpt-5.6-sol)  
**Tip:** `8ab141ee4ebc03a3a2d331c05b149c855b5e559f`  
**Scope:** committed HEAD of ctrl-b: roleplay data shape, Voice/Duties prompt assembly, macros, greeting/examples, V1/V2/V3 card import, `card.json`, lorebook import/activation, import reports, and the editable frontend surface; compared with R64–R67 and SillyTavern 1.18.0 at `8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8`. Read-only except this dossier.  
**Read after R87:** yes. RP-1–RP-8, blind-review O-1–O-9, RP-9–RP-15 / ISS-21–ISS-28, ISS-20, the D75 residuals, and every §10/§13 recorded residual were treated as known and were not re-filed.

**Severity (DEFINED):** HIGH = concrete normal-use failure with a real card/book and no extra assumption; MED = real failure conditional on a named plausible scenario; LOW = report quality, maintainability, or future debt without a current core-path failure.  
**Confidence:** 0–1. **VERIFIED** = reproduced by command or established directly from the pinned source on both sides; **REPORTED** = supported by a cited dossier but not independently reproduced here.

**Verification run:**

`PYTHONDONTWRITEBYTECODE=1 TMPDIR=/home/emma/.cache/tmp .venv/bin/python -m pytest -p no:cacheprovider tests/test_roleplay_s0.py tests/test_roleplay_s2.py tests/test_roleplay_s3.py -q`

Result: **168 passed**, one dependency deprecation warning, 16.52 s.

## Findings

### E-1 · MED · confidence 0.99 · VERIFIED — A valid card with no Voice fields is imported as ctrl-b, not as its named character

`backend/app/services/agent/card_import.py:738-747`, `backend/app/api/agent.py:1723-1727`, `backend/app/services/agent/session.py:142-145`:

> `soul = "\n\n".join(p for p in parts if p)`  
> `if not soul_p.is_file(): write_text_eol(soul_p, default_prompt + "\n")`  
> `"You are ctrl-b, a concise assistant embedded in a single-user homelab control panel. "`

A V2 card `{name:"Echo", description:"", personality:"", system_prompt:"", first_mes:"Hello."}` is valid under the accepted tolerant shape. The importer probe produced `blank_soul=''`; `_write_soul` therefore leaves no SOUL, and `_scaffold_agent` installs the baked ctrl-b identity. The greeting opens as Echo, but every subsequent prompt says the speaker is the homelab assistant. None of the owner's 168 cards has this shape, so the condition is uncommon but not hypothetical. **Leanest fix:** when an imported card's composed SOUL is empty, write a minimal character framing using the existing macro, e.g. `You are {{char}}.`, rather than invoking the ordinary new-agent scaffold fallback; pin a first-message-only V2 fixture. **VERIFIED** by importer probe plus the shared scaffold/assembly source.

### E-2 · MED (data-integrity class) · confidence 0.96 · VERIFIED — Slug minting and creation are not atomic; concurrent imports can overwrite or interleave

`backend/app/api/agent.py:1918-1920`, `backend/app/api/agent.py:1723-1724`, and the identical lorebook sequence at `backend/app/api/agent.py:2204-2207`:

> `taken = set(s.list_agent_names()) | {s.DEFAULT_AGENT_NAME}`  
> `card = import_card(body, cfg, taken=taken, default_tools=s.roleplay.default_tools)`  
> `folder.mkdir(parents=True, exist_ok=True)`

Each route runs its blocking import in the thread pool, but there is no lock or no-clobber reservation spanning “read names → mint → write.” Two tabs importing different cards both named Nyx can both mint `nyx`; the avatar ladder no-clobbers independently, while `SOUL.md`, `card.json`, `agent.yaml`, and an embedded book can be last-writer/interleaved. Both requests may return 201 for the same slug, contradicting R87's “never overwrites” conclusion. Standalone lorebook imports have the same check-then-write race. **Leanest fix:** serialize each import collection's mint-through-final-write critical section with one process lock (cards and books), or reserve the folder/file atomically and retry the suffix walk; pin two concurrent same-name imports. **VERIFIED** by source inspection of both complete call paths; no mutating race probe was run under the read-only brief.

### E-3 · MED · confidence 0.99 · VERIFIED — The new unsupported-macro warning ignores lorebook keys, where a literal macro prevents activation

`backend/app/services/agent/lorebook_import.py:143-145` versus the runtime consumers at `backend/app/services/agent/lorebooks.py:294-296,314-316`:

> `warnings += unrendered_note((e.content for e in entries), "the lorebook's entries")`  
> `hay.hit(macros.render(k), case_sensitive=entry.case_sensitive, whole_words=entry.whole_words)`  
> `hay.hit(macros.render(k), case_sensitive=entry.case_sensitive, whole_words=entry.whole_words)`

The R87 fix reports unsupported macros only from entry content, although both primary and secondary keys pass through the same limited renderer. A downloaded entry keyed by `{{lastMessage}}` (or secondarily gated by `{{persona}}`) imports with no warning; ctrl-b scans for the literal braces, so the entry silently fails to activate. A direct importer probe with primary `{{time}}` and secondary `{{random:a,b}}` returned `warnings=[]`. The owner's 2,567-entry standalone corpus has no such key, but the supported import contract is broader than that corpus. **Leanest fix:** feed every entry's `keys`, `secondary_keys`, and `content` into the one `unrendered_note` pass, and make its wording cover literal matching as well as model-visible content. **VERIFIED.**

### E-4 · MED (forward data-fidelity class) · confidence 0.97 · VERIFIED — `card.json` relocates unknown top-level fields into `data`, so it is not a verbatim export source

`backend/app/services/agent/card_import.py:641-647,697-704,715-720`:

> `fields_map, stripped = strip_executable({**card.extras, **card.fields})`  
> `card_json=_envelope(card, fields_map),`  
> `return {"spec": spec, "spec_version": card.version or CARD_SPECS[spec][1], "data": data}`

For `{"spec":"chara_card_v3","spec_version":"3.0","vendor_signature":"sig","data":{...}}`, the probe wrote `vendor_signature` under `card.json.data`. R66 §2.2 establishes that ST preserves unknown top-level fields separately; the plan now promises unknown fields “verbatim” and calls the sidecar the future export source. A vendor signature, provenance id, or future envelope field is therefore moved to a different namespace and cannot be faithfully exported later; fixing after cards accumulate cannot infer its original location. **Leanest fix:** for V2/V3, preserve stripped envelope extras at the envelope level and stripped card fields under `data`; keep only the already-ruled V1→V2 wrapping and flat-mirror drop. Add one top-level-unknown round-trip pin. **VERIFIED.**

### E-5 · LOW · confidence 0.99 · VERIFIED — The import report calls fields “stashed” even when they changed live state

`backend/app/services/agent/card_import.py:663-667,697-710`:

> `nickname = _text(fields_map.get("nickname")).strip() if card.spec == "v3" else ""`  
> `fields["title"] = nickname`  
> `stashed=sorted(k for k in fields_map if k not in MAPPED_FIELDS),`

A standard V3 `nickname` becomes the live `AgentDef.title` / `{{char}}`, yet the probe reported `mapped=['name','description']` and `stashed=['nickname', ...]`. `assets` can choose the avatar and `character_book` can create and attach a book while receiving the same “stashed” classification. Conversely, a present mapped field with a falsey raw value can be coerced into live text by `_text` but omitted from `fields_mapped`. This makes the report's advertised mapped-versus-stashed account unreliable even though the import itself succeeds. **Leanest fix:** track “acted on” source keys explicitly (including `nickname`, chosen `assets`, and successfully landed `character_book`) and derive the report from presence/actual action, not `MAPPED_FIELDS` truthiness; call the remaining class `preserved only` if that is what it means. **VERIFIED.**

## Consistency — code versus current documentation

### Disagreements

1. **Unsupported-macro report breadth — E-3.** D70 amendment (`docs/DECISIONS.md:5138-5142`) says:

   > “The card AND book importers add ONE report line naming the macros this build will render literally.”

   Code (`backend/app/services/agent/lorebook_import.py:145`) says:

   > `warnings += unrendered_note((e.content for e in entries), "the lorebook's entries")`

   The book's macro-bearing key surfaces are omitted.

2. **Verbatim whole-card provenance — E-4.** ROLEPLAY_PLAN §5.3 (`docs/ROLEPLAY_PLAN.md:376-382`) says:

   > “mapped fields, unknown fields, `extensions` and `character_book` alike, verbatim after the strip pass”

   Code (`backend/app/services/agent/card_import.py:647,703,720`) says:

   > `strip_executable({**card.extras, **card.fields})` … `card_json=_envelope(card, fields_map)` … `"data": data`

   Unknown envelope-level fields are moved under `data`. The same qualification applies to D70's “whole normalized card” claim (`docs/DECISIONS.md:5143-5150`) and SECURITY_MODEL §2.9's “as-imported restore point and export source” (`docs/SECURITY_MODEL.md:447-454`). Standard fields and the declared envelope version do match.

3. **Meaning of `stashed_keys` — E-5.** D70 (`docs/DECISIONS.md:5149-5150`) says:

   > “`report.stashed_keys` = the unmapped keys only `card.json` keeps.”

   Code maps `nickname` to title (`backend/app/services/agent/card_import.py:663-667`) and may act on `assets` / `character_book`, but still reports all three through the non-`MAPPED_FIELDS` branch (`:709`). They are not “only kept” by `card.json`.

4. **Hand-created conversational agents — already known ISS-23 / R87 RP-10, not a new E finding.** ROLEPLAY_PLAN §5.5 (`docs/ROLEPLAY_PLAN.md:411-416`) says:

   > “The importer (and the editor's create flow when the owner picks conversational duties) writes `tools: roleplay.default_tools` explicitly.”

   The create request remains (`frontend/src/components/AgentsEditor.tsx:680-687`):

   > `{ name: slug, agent: { title: newTitle.trim() } }`

   It therefore inherits `duties: agent`, `tools: "*"`; later switching Duties to Talk does not change tools. This remains accurately recorded as ISS-23, but the plan body still states the opposite.

### Claims that match the code

- **D70 / ROLEPLAY_PLAN §4.1:** `{{original}}` resolves to the rendered configured `inference.system_prompt` only for an agent with its own SOUL; otherwise empty; Duties always remains a separate section (`session.py:615-644`). The once rule matches ST's legacy implementation at `public/script.js:2807-2816`.
- **§4.3:** ASCII-case folding is local to the three card macros; Unicode look-alikes remain literal; single `{{// …}}` comments strip; unknowns remain literal (`macros.py:53-162`). The scoped-comment limitation is already ISS-28.
- **§5.3 `card.json`:** standard V1/V2/V3 fields, declared `spec_version`, mapped originals, `extensions`, and `character_book` survive post-strip in a strict JSON envelope; V1 upgrades to V2; file mode is 0600. E-4 is limited to unknown top-level envelope fields.
- **§5.4 / §7 / SECURITY_MODEL §2.9:** PNG `chara`/`ccv3` chunks in `tEXt`, `zTXt`, or `iTXt` are removed whole and bytes after IEND are dropped before the avatar lands; `regex_scripts` is denylisted with the Risu script keys; CHARX never opens module/code members.
- **§6.5:** ST card-book `extensions.position`, `selectiveLogic`, `case_sensitive`, and `match_whole_words` take precedence, except on ctrl-b-native `head`/`tail` entries; downgrade warnings and the own-book re-import discriminator match the amended plan.
- **§10:** S0–S6 behavior named there is present. S7 remains honestly only partly owner-run / delegated to regular use; the document does not falsely mark it closed.
- **Import transport/report:** both owner-file imports are bounded raw-body PUTs; the card report exposes post-history verbatim and exact stripped JSON pointers; warnings are rendered before mapped/stashed lines.

## Sections checked and found sound

- **Card field shape:** `name`; `description`; `personality`; `scenario`; `first_mes`; `mes_example`; `system_prompt`; `post_history_instructions`; `alternate_greetings`; `creator_notes`; `character_book`; `tags`; `creator`; `character_version`; `extensions`; and V3 `assets`, `nickname`, `group_only_greetings`, dates, `source`, and multilingual notes were traced from normalization to agent/SOUL/sidecar/book/avatar. Apart from E-1/E-4/E-5 and already-recorded inert alternate greetings, the mapping is internally coherent. Import never deliberately edits an existing agent; the ordinary sequential re-import suffixes the slug.
- **Containers:** PNG/APNG `ccv3` precedence over `chara`, JSON discrimination, V1 tolerance, CHARX root `card.json`, JPEG-glued CHARX, traversal refusal, declared and actual read caps, and icon selection are sound. Non-icon CHARX assets, WEBP-EXIF cards, `.byaf`, and the Pygmalion/gradio shape remain explicit non-goals rather than accidental drops.
- **Prompt order:** Voice/Duties → scenario → appends → roster → owner persona → memories/index → skills → head lore → examples → live history → tail lore → post-history → one-shot reflection matches the current design. Greeting is a real persisted assistant turn. Named examples terminate the leading-system merge and preserve their side in `<system-update name=…>` framing.
- **Macros:** `{{char}}`, `{{user}}`, and field-specific once-only `{{original}}` reach SOUL, primary greeting, examples, scenario, post-history, persona, and lore content/keys. The remaining feature macros and scoped comments are already ISS-28, not re-filed.
- **Lorebooks:** active-book union/dedup, disabled handling, literal key matching, secondary AND_ANY/NOT_ANY, case/whole-word flags, constant activation, one global budget, deterministic eviction, order, head/tail partition, resume-window anchoring, file-path confinement, and extra-field preservation are sound within the recorded v1 subset. R87 RP-9/RP-15 semantics remain ISS-22/ISS-27 and were not duplicated.
- **Voice/Duties and tools:** capability still comes from the tool/skill/privilege gates, not the duties selector. Live-call turns use the ordinary agent-chat assembly. The skills/roster/memory side-channel leakage and broad hand-created tool default remain the already-recorded ISS-26/ISS-23.
- **Editor:** all live AgentDef roleplay fields except `alt_greetings` are editable; lorebook fields in the v1 model are editable while unknown imported fields survive spread-based saves. Card-only metadata has no editor and stays provenance-only. That asymmetry matches the recorded design, except the report classification in E-5.
- **Tests:** the allowed focused suites passed 168/168. Their fixtures strongly cover the R87 wave, but do not cover E-1, E-2, E-3's key surfaces, E-4, or E-5.

## What I could not determine

- No service was started and no production config, credentials, or live agent corpus was read. I therefore did not measure model-side adherence to the two Duties modes or to instruction-shaped lorebooks.
- I did not execute the concurrent-write reproduction because the brief allowed only the named read-only test run. E-2 is established from the two thread-pool call paths and their absent reservation/lock, not from a mutating race test.
- The owner's 168-card corpus contains zero blank composed SOULs, and the 51 standalone books / 2,567 entries contain zero unsupported macros in primary or secondary keys. I could not determine their prevalence in public downloads outside that corpus.
- Alternate-greeting selection/swipes, reset-from-`card.json`, and export do not exist in v1; their runtime behavior cannot be audited. The stored seams were checked instead.
- Strict-template behavior was source-traced through normalization but not sent to a live inference endpoint in this pass.

## VERDICT for v1.7.8

**SHIP WITH FIXES — gate on E-1, E-2, E-3, and E-4.** The R87 wave is real: its four release gates and blind-review corrections match code, the focused suites pass 168/168, and the central architecture is sound. Before first production import, close the remaining identity fallback (an empty-definition character must not become ctrl-b), serialize mint-through-write so two imports cannot claim one slug, include lorebook keys in the unsupported-macro warning, and preserve unknown envelope-level fields where they arrived so `card.json` is genuinely export-grade. E-5 is report truth rather than runtime corruption and can ride the same small wave without gating by itself. Known ISS-21–28 remain explicitly deferred, not rediscovered blockers.
