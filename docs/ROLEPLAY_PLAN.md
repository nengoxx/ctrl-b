# Roleplay characters + the lorebook subsystem — the plan of record

> **Status: ✏️ DESIGN DRAFT (2026-09-06)** — main-seat spec from the owner's 2026-09-05/06
> conversation rulings + the R64/R65/R66 evidence base. **Not yet council-reviewed, not yet a
> D-entry.** The path: owner reads → blind Emma design round → fix wave → owner ratifies → D70 →
> the slice ladder builds under the standing cadence.
>
> **Authority when ratified:** this doc owns characters (the AgentDef extension, card import,
> the Voice/Action prompt assembly, the roleplay Conf surface) **and the lorebook subsystem**
> (which is deliberately roleplay-independent). `MEDIA_MANAGER_PLAN.md` keeps the media write
> path; `PROMPTS_PLAN.md` keeps the registry; `CORE_MEMORY_PLAN.md` keeps Core Memory —
> §6.7 records why lorebooks and Core Memory stay siblings, not one system.

## 0. Evidence base + verified seams

| Dossier | What it bought |
|---|---|
| [R64](./research/R64-roleplay-character-prompting.md) | Card anatomy (V2/V3) · ST's assembly order · the five-field RP delta · formatting field-wisdom (W++ dead, third-person prose) · the measured Voice/Action result (arXiv 2509.00482: +0.052 vs +0.004 for naive persona) · wire shapes · ST's #4250 fragmentation defect we do NOT inherit |
| [R65](./research/R65-lorebook-systems.md) | Full WI semantics at ST 1.18.0 (40-field entry model, 4-state scan, 8 positions, refusal-not-eviction budget) · V3 `character_book` + 19 decorators · Risu/Agnai/Lite contrast · peer-class cousins (Claude Code/Cline `paths:` = same mechanism, different key) · the Core Memory contrast, precisely stated |
| [R66](./research/R66-card-import-and-editor-ux.md) | Containers (PNG `chara`/`ccv3` tEXt · CHARX zip incl. the normative `embeded://` typo · JPEG-glued zips · magic-byte sniffing) · importer normalization + unknown-field preservation · **cards can carry CODE** (Risu scripts) and the field's strip-don't-gate answer · the Risu `showUnrecommended \|\| populated` editor predicate · tools-on-import field posture |

Seams verified in this repo: `AgentDef` + `extra="allow"` (`domain/agent.py:181-226`) ·
`_system_prompt`/`_appends`/`_static_prefix`/`_assemble` (`session.py`) · the Phase 18 registry +
`_Placeholders` `{{name}}` engine (`services/agent/prompts.py`) · agents CRUD + SOUL.md endpoints
(`api/agent.py:1510+`) · `normalize_system_messages` (`adapters/inference.py:563-600`, R42) ·
the media write path + probe stack (`api/media.py`, `core/media.py`) · `edit_config_yaml` (now
YAML-1.1-safe after the 2026-09-05 quoting fix).

## 1. Owner rulings already taken (2026-09-05/06 conversation — locked, not relitigated here)

1. **Characters ARE agents** — one system; the character material extends the per-agent object.
2. **V2/V3 card import** is wanted (PNG + JSON at minimum).
3. **A roleplay Conf toggle** governs *presentation* (extra fields/forms, the import surface);
   the owner explicitly does NOT want a hard agent-vs-roleplay mode split — "have the fields
   already there, just mark them as optional with a small description/marking."
4. **User persona**: yes, optional.
5. **Tools on imported/new characters default MINIMAL** ("only web search maybe… the bare
   minimum so the agent can roleplay and perform tasks") and can be widened to everything.
6. **Lorebooks are their own first-class feature, useful beyond roleplay**, specified deeply in
   this pass — not an overlooked rider.
7. The character's image "could be the background image for the agent surface" — an idea to
   design cleanly, not a locked requirement (§8).
8. Everything roleplay is **optional** — a plain technical agent must be byte-for-byte unaffected.

## 2. Design principles (the calls that shape everything below)

- **P1 — Mode is presentation, never semantics.** `roleplay.enabled` shows/hides UI. The data
  model and the prompt assembly work identically whether the toggle is on or off; a character
  keeps working if the toggle flips. No behavior ever branches on the toggle server-side except
  the visibility metadata the UI reads.
- **P2 — The character path is additive; the plain-agent path is untouched.** An agent with no
  `character` block assembles exactly today's bytes (the prefix-cache + every existing test stays
  valid). This is the same "no attachments → byte-identical" discipline D68 shipped under.
- **P3 — Voice and Action are two surviving labelled sections, not a replacement** (R64 §5.4's
  measured result). Today SOUL.md *replaces* the technical default — that is exactly the shape
  the paper measured as the failure mode. For characters we keep both; `{{original}}` (the card
  spec's own mechanism) gives a card author placement control.
- **P4 — Import compatibility is a behavioural contract, not a schema copy** (R64 §1: the V2
  spec is normative about what reaches the prompt). We honor prompt-vs-metadata semantics and
  preserve unknown fields; we do NOT import executable content (§7).
- **P5 — Extend-don't-migrate** (owner directive 2026-06-24): character fields are ONE nested
  optional object on `AgentDef`; a lorebook entry is ONE object with optional fields; no
  parallel name-keyed sibling maps anywhere.
- **P6 — No hardcoding**: the minimal tool set, scan depth, budgets, and every framing sentence
  are config/registry entries.

## 3. Data model

### 3.1 `CharacterCfg` — the nested optional object on `AgentDef`

```python
class CharacterCfg(BaseModel):
    """The roleplay-character extension of one agent (D70). Field names follow Card V2/V3 where
    a direct counterpart exists, so import is a mapping, not a translation."""
    model_config = {"extra": "allow"}          # V3 extensions/unknown fields round-trip (P4)

    greeting: str = ""                          # first_mes; "" → no seeded message
    alt_greetings: list[str] = []               # alternate_greetings (stored v1; picker = seam)
    example_dialogue: str = ""                  # mes_example, <START>-delimited (ST format kept verbatim)
    scenario: str = ""                          # its own head block (field convention, R64 §2.2)
    post_history: str = ""                      # post_history_instructions → the tail slot (§4.4)
    user_name: str = ""                         # per-agent {{user}} override; "" → roleplay.persona.name
    card: dict[str, Any] = {}                   # the import stash: unmapped spec fields + extensions,
                                                # post-strip (§7) — export-ready, never prompt-facing
```

`AgentDef` gains `character: CharacterCfg | None = None` and `lorebooks: list[str] = []`
(book attachments by slug; §6.5). **An agent is "a character" iff `character` is not None.**
`agent.yaml` carries it like every other field; the default agent can be a character too
(the block lives under `agent.defaults` — nothing special-cases the root agent).

Card fields that do NOT land here, and where they go instead (import mapping, §5.3):
`name`→slug/`title` · `description`+`personality` (+card `system_prompt` if present)→**SOUL.md**
(they are the Voice; R64 §4.1: the field's own default card puts everything in `description`) ·
`creator_notes`/`tags`/`creator`/`character_version`→`card` stash (spec: MUST NOT reach the
prompt) · `character_book`→a lorebook file, auto-attached (§6.5) · avatar→media (§5.4/§8).

### 3.2 Config

```yaml
roleplay:
  enabled: false                # Conf toggle — UI visibility only (P1)
  default_tools: [web_search]   # the explicit allowlist written to new/imported characters (§5.5)
  persona:                      # the USER's persona (global; per-agent override = character.user_name)
    name: ""                    # {{user}}; "" → the literal "User"
    description: ""             # injected as its own head block when non-empty (§4.5)

lorebooks:                      # the subsystem's globals (§6) — roleplay-independent, hence not under roleplay:
  books: []                     # globally-attached book slugs (any agent, every turn)
  scan_depth: 2                 # messages of recent history scanned (ST's shipped default)
  budget_chars: 4000            # activated-entry budget; eviction per §6.4
```

All additive with defaults ⇒ **no config migration** (the D68 precedent).

## 4. Prompt assembly — the Voice/Action architecture

### 4.1 The plain-agent path is frozen (P2)

`character is None` ⇒ `_system_prompt()`/`_appends()`/`_static_prefix()` emit today's bytes.
Every change below is inside `if character:` branches or new, empty-by-default emission points.

### 4.2 The character head

For a character, the leading system message becomes **two labelled sections**:

```
## Character
<SOUL.md, macro-substituted (§4.6)>

## Agent duties
<the `agent_action_rules` registry prompt>
```

- **Voice** = SOUL.md exactly as today (authoring home unchanged; import writes it there).
- **Action** = a NEW registry prompt `agent_action_rules`: the tool-discipline half of today's
  `DEFAULT_SYSTEM_PROMPT` (tool routing, no-guessing, batch calls, confirm flow, task_plan) with
  the "You are ctrl-b" identity half removed — identity is the character's. Being a registry
  entry it is owner-editable/overridable per Phase 18, and `{{original}}` maps onto it: if the
  persona text contains `{{original}}`, the Action text substitutes THERE and the labelled
  section is not emitted separately (the V2 opt-back-in, honored with our registry text as
  "the original"). A card that neither includes `{{original}}` nor edits anything still gets
  Action appended — P3's both-survive default, which is deliberately *stricter* than V2's
  replace-by-default because our agents keep real duties (the R64 §5.4 evidence is the warrant;
  recorded as a spec deviation for the council).
- Section labels: two `## `-headed blocks inside ONE system message (keeps R42's one-leading-
  system shape trivially; the label strings are registry-owned framings, not hardcoded).
- `scenario`, when set, is its own head block right after the character head (before roster —
  it is as static as the prompt itself).

### 4.3 Example dialogue

Emitted between the static head and the live history (the universal field position, R64 §2.2):
parsed on `<START>` boundaries into pseudo-turns, sent as `{role:"system",
name:"example_user"|"example_assistant"}` messages (the 4/4-peer wire shape, R64 §7). Two facts
make this safe here: they sit AFTER the leading system run, so `normalize_system_messages`'
coalescer never touches them (the R64 §10 collision, avoided by position); and for strict
templates the same normalize seam already re-roles non-leading `system` → marked `user` text —
the per-dialect rendering rides the seam we own, no new adapter switch. They join
`_static_prefix()`'s cached head (turn-stable, byte-identical per iteration).

### 4.4 The post-history tail slot

A NEW emission point in `_assemble`, after the history, before the one-shot reflection nudge:
`character.post_history`, macro-substituted, as a `system` message. Recency is the entire point
(R64 §3); the cache cost is nil in practice — everything after the newest history message
re-prefills anyway. `normalize_system_messages` already converts a non-leading system to the
safe marked-user shape for strict templates (verified R42 behavior — this is why the slot costs
no adapter work). Empty string ⇒ nothing emitted (P2). Lorebook `tail` entries share this slot
(§6.4), post_history last (closest to the generation).

### 4.5 The user-persona block

When `roleplay.persona.description` is non-empty: one head block after the roster (framing
sentence = registry id `persona_intro`), for every agent — a persona is who the OWNER is, not a
character feature. `{{user}}` resolves as `character.user_name` → `roleplay.persona.name` →
`"User"`.

### 4.6 Macros

Reuse `_Placeholders` (R32; leave-literal-on-miss). The substitution pass runs over: SOUL.md
(character agents only — plain agents keep their bytes, P2), greeting, alt greetings, example
dialogue, scenario, post_history, and lorebook keys+content. The v1 vocabulary: `{{char}}`
(title or name), `{{user}}` (§4.5), `{{original}}` (§4.2, position-consumed). Unknown tokens
survive literally — a card using `{{random:...}}` degrades visibly, not silently.

### 4.7 The greeting

A real seeded assistant message (the 4/4 field shape — R64: "the greeting is what anchors
style"; an empty-state render anchors nothing because it never reaches the wire). On thread
creation for an agent whose `character.greeting` is non-empty, the thread is born with one
persisted assistant message (macro-substituted; excluded from "turn" semantics — it is plain
history). `alt_greetings` are stored on import; a greeting picker on the new-thread surface is
a recorded FE seam, not v1.

## 5. Card import

### 5.1 Surface

`POST /api/agents/import` (multipart file). One new endpoint that **composes the existing
writes** (R66 §9: agent PUT + soul PUT + media PUT) — no parallel write path. Response = the
created agent payload + an import report (what mapped, what was stashed, what was stripped).

### 5.2 Containers (v1)

Magic-byte sniffing, never extension trust (R66 §1: "JPEG cards" are zips glued behind JPEGs):
- **PNG/APNG** — `tEXt` `chara` (V1/V2) and `ccv3`; `ccv3` wins when both (spec-normative).
- **JSON** — `spec`/`spec_version` discriminator; no `spec` field ⇒ V1 heuristic.
- **CHARX** — zip: `card.json` + assets; path-normalized, the `embeded://` scheme (sic, all
  three spellings ST honors), depth/size caps (§7).
- WEBP-EXIF and `.byaf`: recorded non-goals (rare, one importer each in the field).

### 5.3 Normalization + mapping

V1→V2→V3 ladder (defaults per spec), then the §3.1 mapping. Unknown fields + `extensions`
land in `character.card` verbatim **after the strip pass** (§7) — the spec's preserve-unknowns
MUST, which `extra="allow"` gives us structurally (R66: ST fakes this with a hidden form input).
Name→slug: sanitize to the agent-name grammar, collision-suffix like the attachment store.
Export is NOT v1: the stash + Agnai's stale-stash comparison pattern (R66 §9) are the recorded
seam so v1 loses nothing it would need.

### 5.4 The avatar

Decoded, probed by the existing `core/media.py` stack (closed-allowlist types, magic-byte
verified), stored via the media write path under the `agents` namespace (§8). Import succeeds
without an avatar; an invalid image degrades to "imported without image" in the report, never a
refusal of the whole card.

### 5.5 Tools

The importer (and the "new character" editor flow) writes `tools: roleplay.default_tools`
**explicitly** — never the `"*"` default (R66 §4: the field gives no precedent; our default is
the widest value, so relying on it would invert the owner's ruling). `privilege` stays CONFIRM.
The owner widens any character in the editor as usual.

## 6. The lorebook subsystem (roleplay-independent)

### 6.1 Storage

File-per-book: `$CTRLB_HOME/lorebooks/<slug>.yaml` — the agents/skills pattern (owner-editable
files, listed by scan, CRUD via API mirroring the skills file API). Not SQLite: books are
authored config-like content, not event data; YAML keeps them hand-editable and diffable.
Writes go through `edit_config_yaml` (comment-preserving, 0600 not required — no secrets — but
the YAML-1.1 quoting guard matters: entry keys like `no` or `23:00` are exactly the ambiguous
class).

### 6.2 The book + entry model (v1 subset — deliberate, V3-aligned names)

```yaml
name: Hollow Sea            # display; slug = filename
description: ""
enabled: true
entries:
  - keys: [ghostship, "the captain"]   # substring match per §6.3; list, any hits
    content: |
      The ghostship Veile sails only under fog…
    enabled: true
    constant: false          # true → always active, no scan needed
    secondary_keys: []       # optional second gate…
    logic: and_any           # …and_any (a secondary must also hit) | not_any (none may hit)
    case_sensitive: false
    whole_words: true        # ST's SHIPPED default (R65 §1.2 correction), not the code default
    position: head           # head | tail (§6.4)
    order: 100               # render order among activated entries (lower first)
    priority: null           # eviction order (higher survives); null → order (V3's split, §6.4)
```

Entry models are one object with optional fields (P5); `extra="allow"` stashes imported fields
we don't implement (probability, timed effects, groups, recursion flags…) so a re-export loses
nothing and a future slice can adopt them without migration. **Explicit v1 non-goals** (each a
recorded seam, none silently dropped): recursion, min-activations, probability, inclusion
groups, timed effects, regex keys, vector/embedding activation, `automationId`-style triggers
(that one lands on the A3/tool seams if ever wanted — privilege-gated, unlike the field's).

### 6.3 The scan

At `_static_prefix` build time (once per turn, P2-compatible): haystack = the last
`lorebooks.scan_depth` messages' text + the incoming user message (attachment text excluded;
tool outputs excluded — chat text only, the field's default corpus). Active books = global
`lorebooks.books` ∪ the agent's `lorebooks`, name-deduped (the field's bind-twice-counts-once
rule). An entry activates iff enabled ∧ (constant ∨ a key matches per its flags) ∧ its
secondary gate passes. Matching = plain substring / whole-word toggle, casefold unless
`case_sensitive` — no regex in v1 (a regex key is an import-stashed field).

### 6.4 Rendering, budget, placement

Activated entries render each ONCE (spec MUST), sorted by `order`, joined into one framed block
(framing sentence = registry id `lorebook_intro`, phrased as *reference data, not instructions*
— the Core-Memory framing convention, R65 §9's security note). Budget: if the joined content
exceeds `budget_chars`, evict lowest `priority` (then lowest `order`) until it fits — the V3
eviction model, NOT ST's refusal (R65 §1.10: ST is the outlier). Placement:
- `head` entries → one block appended LAST in the static head (after the skills note — it is
  the most volatile block, R65 §9's cache analysis; a scan-miss turn emits nothing).
- `tail` entries → join the §4.4 tail slot, before `post_history`.

### 6.5 Attachment + import

Attach globally (`lorebooks.books`) or per-agent (`AgentDef.lorebooks`). Card import writes an
embedded `character_book` as `lorebooks/<agent-slug>-book.yaml` and appends it to the agent's
list. Book import (its own endpoint) accepts the V3 `{spec:'lorebook_v3'}` envelope, ST's raw
standalone export shape, and a bare entries list — the three shapes R65 §5 says actually
circulate.

### 6.6 UI

A Lorebooks manager (list/create/edit books + entries, enable toggles) + an attachment picker
in the agent editor. Visible regardless of `roleplay.enabled` (ruling 6: beyond roleplay);
only the *card-import auto-attach* surface is roleplay-marked.

### 6.7 Why not Core Memory (the ruling this plan makes explicit)

They are the two complementary lanes R65 §9 delineates and they stay separate: a lorebook is
**code-decided, pre-first-token, invisible-in-transcript, recomputed-per-turn** injection over
an owner-authored corpus; Core Memory is **model-decided, mid-turn, visible tool calls** over
an agent-written corpus with its own consolidation lifecycle. Merging them (a `keys[]` mode on
memory blocks) would put one subsystem under two deciders, two budgets, and two lifecycles —
the complexity is real and the win is one shared YAML loader. The shared ground they DO get:
the same framing convention (fallible data) and the same registry-owned intro sentences.
*(This is the one place the plan overrides an R64 musing — R64 §10 floated the keys-on-memory
idea before R65 bought the mechanics that decide against it.)*

## 7. Security posture (SECURITY_MODEL.md lens)

- **Cards are untrusted input that can carry code** (R66 §3: Risu regex scripts — one mode
  rewrites outbound requests — trigger scripts, CHARX modules; imported with no prompt in the
  field). ctrl-b executes none of it, but we do not warehouse it either: the import strips the
  known-executable extension classes (`regex_scripts`, `triggerscript`, Risu module payloads,
  `virtualscript` — the field's own retirement precedent: strip on import AND export) from the
  `card` stash and reports what was removed. Inert-but-unknown extension data stays (P4).
- **Zip handling**: `card.json` size cap, per-asset + total caps, normalized paths (reject
  traversal), bounded entry count — the media 413 conventions applied to a new container.
- **Images**: only via the existing probe stack + closed type allowlist; never served un-probed.
- **Prompt-injection surface**: card text and lorebook content enter prompts as data with
  registry framings; imported `post_history` sits closest to generation and is the highest-
  leverage injected text — the import report surfaces it verbatim for the owner's eyes.
  No card text is ever rendered as HTML (chat renders markdown through the existing pipeline).
- **No new execution paths, no privilege changes**: characters default to CONFIRM + minimal
  tools; lorebook activation can only add TEXT, never fire actions (v1 non-goal, §6.2).

## 8. The character image (owner idea 7 — designed thin, ratification-gated)

Import needs somewhere to PUT the avatar; consumption can grow later:
- **v1**: an `agents` media namespace whose role = the agent slug (the first *dynamic-role*
  namespace — `MEDIA_NAMESPACES` today is three static-role namespaces, so this is a REAL
  namespace-model extension that `MEDIA_PLAN`/`MEDIA_MANAGER_PLAN` authority must ratify; the
  alternative — files under `agents/<slug>/` — would bypass the media chokepoint and is
  rejected here). The agent list/editor shows the avatar; the library model gives
  re-crop/focal/swap for free once the namespace exists.
- **The background idea**: themes consume media roles already (the gacha/frontier precedent) —
  "character art behind the agent surface" becomes a theme-settings axis reading the `agents`
  role. Recorded as its own follow-on slice (S7), NOT load-bearing for v1: cards import fine
  with the avatar landing in the library only. V3 multi-asset routing (sprites/backgrounds/
  user icons — R66 §2.4) is a non-goal; extra assets are stashed/ignored with a report line.

## 9. Editor + Conf presentation

- **The Risu predicate, adopted** (R66 §5.3): a character field is visible iff
  `roleplay.enabled` **or the field is populated** — an imported card lights up exactly what it
  uses even with the toggle off; a hand-made agent stays a six-field form. The character
  section sits in the agent editor under one "Character" group.
- **Marked help**: each character field gets the small marking the owner asked for — one shared
  help affordance (icon + one-liner, the Risu one-prop pattern; ST's "(not sent to the AI)"
  scope subtitles for metadata). Help strings are FE constants beside the form (they are UI
  copy, not model-facing text — the registry deliberately does NOT own them; PROMPTS_AUDIT
  scope stays model-facing).
- **Conf**: the `roleplay` group (toggle · default-tools list · persona name/description) +
  the `lorebooks` globals. The import button lives on the agents surface, visible per the same
  predicate.
- Voice-dictation reality: all new forms testable at narrow widths (the standing mobile bar).

## 10. Slice ladder (each slice: pinned Opus build → main-seat audit → blind Emma round → fix wave → close)

- **S0 — the model + assembly core (BE):** `CharacterCfg` + config section + macro pass +
  Voice/Action head + `agent_action_rules` registry split + scenario/persona blocks + the
  post-history tail slot. The P2 pin: a characterless agent's assembled request is
  byte-identical (test = golden assembly before/after).
- **S1 — greeting + example dialogue (BE):** thread seeding, `<START>` parsing, pseudo-message
  emission, normalize-seam behavior on strict templates.
- **S2 — card import (BE):** containers + sniffing + normalization + mapping + strip pass +
  avatar via media + explicit minimal tools + the import report.
- **S3 — lorebooks (BE):** storage/CRUD + scan + block render/budget + bindings + book import.
- **S4 — the roleplay FE:** agent-editor Character section (predicate + marked help), Conf
  group, persona editor, import UI + report display.
- **S5 — the lorebook FE:** manager + attachment picker.
- **S6 — the owner device round** (the phase gate): import a real card from their collection,
  talk to it on the phone, tools-in-character, lorebook triggers live, read-along on a
  character reply.
- **S7 (post-ratification follow-on):** the `agents` media namespace + character-art-as-
  background theme axis (§8) — rides the media authority's ruling.

## 11. Open questions for the owner (the court — nothing below is assumed)

1. **Greeting scope:** seed on EVERY new thread with that agent? (Plan assumes yes; "" opts out.)
2. **`{{user}}` fallback** when no persona is set: the literal "User", or your real first name
   as a config seed?
3. **Import containers:** PNG + JSON + CHARX enough for your collection? (WEBP-EXIF is the only
   other real-world carrier.)
4. **The Action section on characters:** the plan keeps agent duties appended by default even
   for pure-RP cards (P3). If you ever want a "pure roleplay, no duties" character, the lever
   is editing the Action registry prompt or a per-agent opt-out field — want the opt-out field
   in v1?
5. **Lorebook v1 subset** (§6.2's non-goals) — anything there you know you want day one?
6. **S7 sequencing:** is the background-art consumption wanted soon (schedule the media
   namespace talk now) or parked until the core ships?
