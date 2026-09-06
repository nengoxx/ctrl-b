# Characters are agents — the conversational-agents + lorebook plan of record

> **Status: ✏️ DESIGN DRAFT v2 (2026-09-06)** — v1 rewritten same-day on the owner's second
> design round ("don't separate characters from agents — expand the agent feature; the agents
> surface becomes visual; a toggle swaps the hardcoded agent instructions for a conversational
> prompt"). **Not yet council-reviewed, not yet a D-entry.** The path: owner reads → blind Emma
> design round → fix wave → owner ratifies → D70 → the slice ladder builds under the standing
> cadence.
>
> **Authority when ratified:** this doc owns the agent-feature expansion (the new AgentDef
> fields, the Voice/Duties prompt assembly, card import, agent art + the visual agents surface)
> **and the lorebook subsystem** (deliberately roleplay-independent). `MEDIA_MANAGER_PLAN.md`
> keeps the media write path and libraries; `PROMPTS_PLAN.md` keeps the registry;
> `CORE_MEMORY_PLAN.md` keeps Core Memory — §6.8 records why lorebooks stay a sibling.

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
**the media role/binding split** (`core/media.py`: static role POOLS in `MEDIA_NAMESPACES`,
entity-owned bindings — gacha's roster "deals" `characters` portraits to hosts; the `wallpaper`
slot pins one to the backdrop) · the media write path + probe stack · `edit_config_yaml` (now
YAML-1.1-safe after the 2026-09-05 quoting fix).

## 1. Owner rulings (2026-09-05/06 conversation — locked, not relitigated here)

1. **Characters ARE agents — one feature, expanded. No separate character section/type/mode
   in the data model or the UI.** "Regular agents just with an image, some first message, the
   extra things from the character cards." (Second round, superseding v1's `character:` block
   and its "is-a-character" predicate.)
2. **The use case is CONVERSATIONAL agents** — talking, not story-writing RP with action prose.
   The extra machinery stays lean; voice + images + greeting matter, novel-mode does not.
3. **V2/V3 card import** is wanted (PNG + JSON at minimum).
4. **The agents surface becomes VISUAL** — avatars used for selecting agents ("a character
   showcase… like the images gallery"), and agents get an avatar AND a background image.
5. **A toggle swaps the hardcoded agent-loop instructions for a conversational prompt**, each
   half an editable prompt field in settings (the owner's words → §4.2's duties selector).
6. **A roleplay Conf toggle** governs *presentation only* (reveals the optional fields/forms
   and the import surface); fields marked with a small icon + description, populated fields
   always visible.
7. **User persona**: yes, optional. **`{{user}}` = the persona's name when one is set, the
   generic "User" otherwise** (third round: "if there is a persona, you should address the user
   by the name — that's pretty much it").
8. **Tools on imported/new characters default MINIMAL** (configurable; "only web search maybe"),
   widenable to everything.
9. **Lorebooks are their own first-class feature, useful beyond roleplay**, specified deeply
   here — not a rider. Third round: the owner isn't thinking about lorebook CONTENT yet but
   wants the SYSTEM designed — "even if it's not for lorebooks but for instruction chains, a
   system like that could be useful" (the constant-entry logic-engine pattern R65 §7 documents
   in the field) — **and wants a test book**: author or download an interesting one (§6.7).
10. Everything is **optional** — an agent that sets none of the new fields keeps working
    unchanged, and both kinds coexist "with the least friction possible."
11. **Greeting seeds every new thread** (third round: yes) — and the owner floated a possible
    future command that resets "not just the conversation but the whole character… a new
    roleplay kind of thing", flagged by them as needing careful design → recorded as the §4.4
    seam, NOT v1 (its destructive half needs its own court).
12. **Containers locked: PNG + JSON + CHARX** — "I don't want to overload or overcomplicate
    the system."
13. **The background-behind-the-chat ships IN THIS PHASE, default ON**, as a THREE-STATE
    control (third round, verbatim intent): ① *operator* — the agent's background art takes
    the operator-image place "the one we use right now in the gacha theme… with the focus in
    mind", current treatment; ② *full background* — same art as the full backdrop "without as
    much blur or no blur at all — just the blur, I'm not talking about the dimming"; ③ *off* —
    "neither the operator image and the background." Integration with the existing operator
    switch designed in §8.3.
14. **Crop + focal-point functionality is REUSED for agent art uploads** (§8.2).
15. The spec should be exhaustive — "every nuance, every potential issue, every design
    decision" — and the main seat asks clarifications rather than assumes.
16. **Duties differ in VOICE only, NEVER capability** (round 5: "I don't want to handicap
    them… I just don't want the prose that is instruction-focused, which will bias the model
    to respond too formally on a casual conversation"). A conversational character with the
    tools granted can shut down machines, research, code — everything. Tools/skills/privilege
    remain the ONLY capability levers; §4.1a is the invariant + both texts verbatim.
    Imported cards START on conversational (confirmed).
17. **The agents list moves OUT of Conf into its own settings section — the character/agent
    gallery** (round 5, revising the restyle-in-place idea): one dedicated section for ALL
    agents "regardless if they're regular agents or roleplay characters" (§8.4).
18. **Frontier backdrop: v1 ships with frontier simply unchanged** (the setting has no effect
    on its bespoke agent surface); the integration lands as a separate follow-up cleanup —
    round 5: "focus on the feature… one by one."

## 2. Design principles

- **P1 — One agent system, flat.** The new capabilities are optional fields on `AgentDef`
  beside `prompt`/`prompt_append` — no nested "character" object, no type flag, no predicate.
  What kind of agent something is emerges from which fields it uses (ruling 1).
- **P2 — Mode is presentation, never semantics.** `roleplay.enabled` shows/hides UI clutter.
  Nothing server-side branches on it.
- **P3 — Voice and Duties are two surviving labelled sections** (R64 §5.4's measured result),
  for EVERY agent — the assembly restructure of §4 is universal, not character-gated. Today's
  SOUL.md-replaces-everything ladder is exactly the measured failure shape.
- **P4 — Import compatibility is a behavioural contract** (prompt-vs-metadata semantics honored,
  unknown fields preserved, executable content stripped).
- **P5 — Extend-don't-migrate**: additive optional fields with defaults everywhere; art binds
  by reference to media libraries (the gacha deal pattern), never by parallel maps.
- **P6 — No hardcoding**: duties texts, framings, the minimal tool set, scan depth, budgets —
  all config/registry entries.

## 3. Data model

### 3.1 The `AgentDef` expansion (flat, all optional, all defaulted)

```python
# joins the existing flat fields beside prompt/prompt_append — the AgentDef house style
duties: Literal["agent", "conversational"] = "agent"   # §4.2 — which duties prompt rides along
greeting: str = ""                  # first_mes; "" → no seeded message
alt_greetings: list[str] = []       # alternate_greetings (stored v1; picker = recorded seam)
example_dialogue: str = ""          # mes_example, <START>-delimited (ST format kept verbatim)
scenario: str = ""                  # its own head block (field convention, R64 §2.2)
post_history: str = ""              # post_history_instructions → the tail slot (§4.4)
user_name: str = ""                 # per-agent {{user}} override; "" → roleplay.persona.name
avatar: str = ""                    # media id in the agents/avatars library (§8); "" → none
background: str = ""                # media id in agents/backgrounds; "" → theme default
lorebooks: list[str] = []           # attached book slugs (§6.5)
card: dict[str, Any] = {}           # import stash: unmapped spec fields + extensions, post-strip
                                    # (§7) — export-ready provenance, never prompt-facing
```

The UI never groups these into a "Character" pane (ruling 1) — they are ordinary agent fields
with the §9 marking. Card fields that do NOT land here: `name`→slug/`title` ·
`description`+`personality` (+card `system_prompt`)→**SOUL.md** (the Voice; R64 §4.1: the
field's own default card puts everything in `description`) · `creator_notes`/`tags`/`creator`/
`character_version`→`card` stash (spec: MUST NOT reach the prompt) · `character_book`→a
lorebook file, auto-attached · avatar→the media library + the `avatar` binding.

### 3.2 Config

```yaml
roleplay:
  enabled: false                # Conf toggle — UI visibility only (P2)
  default_tools: [web_search]   # the explicit allowlist written to new/imported characters (§5.5)
  persona:                      # the USER's persona (global; per-agent override = user_name)
    name: ""                    # {{user}}; "" → the literal "User"
    description: ""             # injected as its own head block when non-empty (§4.5)

lorebooks:                      # the subsystem's globals (§6) — roleplay-independent
  books: []                     # globally-attached book slugs (any agent, every turn)
  scan_depth: 2                 # messages of recent history scanned (ST's shipped default)
  budget_chars: 4000            # activated-entry budget; eviction per §6.4
```

All additive with defaults ⇒ **no config migration** (the D68 precedent).

## 4. Prompt assembly — Voice + Duties, universal

### 4.1 The one deliberate restructure (recorded honestly)

`DEFAULT_SYSTEM_PROMPT` today is identity + tool discipline fused in one constant, and SOUL.md
*replaces* all of it. This plan splits it and applies the two-section head to **every agent**:

- **Voice** — the existing Class-A chain unchanged in mechanism: `AgentDef.prompt` (SOUL.md) →
  `inference.system_prompt` → the baked default, where the baked default SHRINKS to the
  identity/persona half ("You are ctrl-b, a concise assistant embedded in…"). The
  `default-prompt` endpoint and the scaffold serve the new persona default.
- **Duties** — a NEW registry pair, selected per agent by `duties` (ruling 5's toggle):
  - `duties_agent`: the tool-discipline half of today's default (routing, no-guessing, batch
    calls, confirm flow, task_plan) — substance preserved, identity removed.
  - `duties_conversational`: new text for the talking use case — natural voice, answer as
    yourself, tools available when genuinely useful, no task-plan pushing, no progress
    narration. Written fresh in S0, tuned by the owner via the Phase 18 editor like any
    registry prompt (`prompts:` override + Conf).

### 4.1a The two duties texts — v1 drafts, verbatim (registry defaults; owner-tunable per Phase 18)

**The invariant first (ruling 16): duties NEVER gate capability.** Both texts assume whatever
toolset the agent was granted; `tools`/`skills`/`privilege` are the only capability levers, and
the import-time minimal allowlist (§5.5) is an independent, freely-widened choice. The two
texts differ in voice and interaction shape alone — and BOTH keep the one rule R64 §5.4
measured as load-bearing: act (call the tool) before speaking.

`duties_agent` — today's tool-discipline half, substance preserved, identity removed:

> Call the provided tools to inspect and act. Prefer a tool over guessing. Risky actions
> (shutdown, stop/restart a service) will ask the owner to confirm before running — propose
> them when appropriate. Resolve a host or service the owner names to its stable `id` yourself
> using the fleet roster provided below — never ask the owner for an id. For a multi-step
> request, call `task_plan` first to lay out the steps, then update it (re-send the whole
> list) as you complete each — keep one step `active`. Skip the plan for a single quick
> action. Carry the task through to completion in this turn: keep calling tools until every
> step is done. Do NOT stop to narrate progress or ask whether to continue when the next step
> is already clear — the system pauses the turn for you whenever a risky action needs
> confirmation, so you never have to ask permission yourself. When the same action applies to
> several targets (e.g. pinging every host), issue all of those tool calls together in one
> step rather than one at a time. Tool routing: for fleet/host/service requests use the fleet
> tools and `task_plan` — do NOT use web search or crawling for fleet operations. Use
> `web_search`/crawl tools ONLY when the owner asks for information from the internet. Never
> repeat the same tool call with the same arguments; if a result didn't help, change approach
> or answer. Answer directly and briefly; after the final tool runs, summarize the outcome in
> one or two lines.

`duties_conversational` — full authority, casual voice; what is REMOVED is only the
formal-executor shaping (task_plan pushing, brevity mandates, report-style summaries):

> This is a conversation first: speak in your own voice and match its tone and rhythm. Never
> fall into report formatting — no headings, no bullet lists, no closing summaries unless
> asked. You still have your tools and your full authority to use them: when the conversation
> calls for a real action (waking or shutting down a machine, checking on something, searching
> the web), call the tool FIRST, then weave what happened into your reply naturally. Do not
> describe or promise an action you can simply take, and do not ask permission yourself —
> risky actions automatically pause for the owner's confirmation. Resolve a host or service
> the owner names to its stable `id` yourself from the fleet roster when one is provided.
> Never repeat the same tool call with the same arguments; if a result didn't help, change
> approach or say so in your own words.

What each drops from the other, named: conversational drops `task_plan` orchestration, the
carry-through/batching drill, the routing lecture (a one-line id rule stays), and every
brevity/summary mandate; agent drops nothing (it IS the current behavior). Shared mechanical
rails in both: act-before-speaking, the confirm system (never self-ask), id resolution, no
identical-call repeats.

Head shape: ONE leading system message, two `## `-labelled sections (labels are registry-owned
framings). `{{original}}` in a persona substitutes the selected duties text at that position
instead of the appended section (the V2 opt-back-in, honored with our registry text as "the
original"). **Semantic change, named for the council:** existing SOUL.md specialists today get
NO technical instructions; after this they get their selected duties section too — the
R64 §5.4-backed improvement, and `duties` + registry overrides are the levers if any agent
should not. The assembly golden tests re-pin to the new shape (P3 beats byte-nostalgia; the
no-legacy-seams rule applies — no compat flag for the old fused prompt).

### 4.2 Per-field emission (each empty ⇒ absent — ruling 10's zero-cost coexistence)

- **`scenario`** — its own head block after the Voice/Duties message (it is as static as the
  prompt; before the roster).
- **User persona** (§3.2) — one head block after the roster when `description` non-empty,
  framing = registry id `persona_intro`. For every agent: the persona is who the OWNER is.
- **`example_dialogue`** — parsed on `<START>` boundaries, emitted between the static head and
  live history as `{role:"system", name:"example_user"|"example_assistant"}` pseudo-messages
  (the 4/4-peer wire shape, R64 §7). Position keeps them clear of the leading-run coalescer;
  strict-template rendering rides the existing `normalize_system_messages` seam (non-leading
  system → marked `user`), no new adapter switch. Turn-stable, cached with the head.
  **S1 verification item (coverage audit):** probe that the cloud dialects we actually use
  accept `name` on system messages, and that the qwen/llama.cpp path renders the normalized
  form sanely — R41/R42 cover strict-template systems generally, but named example
  pseudo-messages specifically have not been probed on OUR providers.
- **`post_history`** — a new tail emission in `_assemble` after the history, before the
  one-shot reflection nudge; macro-substituted. Recency is the point (R64 §3); cache cost ~nil
  (everything after the newest message re-prefills anyway). Lorebook `tail` entries share the
  slot, `post_history` last (closest to generation).
- **`greeting`** — a REAL seeded assistant message persisted at creation of EVERY new thread
  with that agent (ruling 11; the 4/4 field shape — an empty-state render never reaches the
  wire and anchors nothing). Macro-substituted at seed time. `alt_greetings` stored; a
  new-thread greeting picker is a recorded FE seam. **Compaction note (coverage audit):** the
  greeting is ordinary history — a long thread's compactor may fold it into the summary like
  any old turn. By design (the head's persona carries identity, not the greeting); S1 records
  it in a test comment so nobody later "fixes" it into a pin.
  **The "reset the whole character" command — SEMANTICS RULED round 4, feature NOT v1:** a
  red button on the character's own detail that resets the agent to its default/as-imported
  values, **wipes THAT agent's memory files** (its memory dir; the specific agent's, nothing
  global), and opens a fresh thread (greeting re-seeds). Destructive ⇒ when built it rides the
  destructive-op conventions (typed confirm, the R53/D64 guard class). The owner explicitly
  ruled OUT folding memories deeper into the roleplay system ("too complicated"). v1 ships
  nothing here; the as-imported restore is what the `card` stash (§3.1) already makes possible.

### 4.3 Macros

Reuse `_Placeholders` (R32; leave-literal-on-miss). v1 vocabulary: `{{char}}` (title or name) ·
`{{user}}` (`user_name` → `roleplay.persona.name` → `"User"`) · `{{original}}` (§4.1). The pass
runs over: SOUL.md, greeting(s), example dialogue, scenario, post_history, lorebook keys +
content. It runs for every agent (the universal assembly) — safe because unknown/unmatched
tokens pass through literally, so existing SOUL.md text without macros is untouched.

## 5. Card import

### 5.1 Surface

`POST /api/agents/import` (multipart file). One new endpoint that **composes the existing
writes** (R66 §9: agent PUT + soul PUT + media PUT) — no parallel write path. Response = the
created agent payload + an import report (what mapped, what was stashed, what was stripped —
imported `post_history` shown verbatim, §7).

### 5.2 Containers (v1)

Magic-byte sniffing, never extension trust (R66 §1: "JPEG cards" are zips glued behind JPEGs):
**PNG/APNG** `tEXt` `chara`/`ccv3` (`ccv3` wins when both — spec-normative) · **JSON** with the
`spec`/`spec_version` discriminator (no `spec` ⇒ V1 heuristic) · **CHARX** zip (`card.json` +
assets; path-normalized, `embeded://` as the spec spells it, depth/size caps per §7).
WEBP-EXIF and `.byaf`: recorded non-goals (one importer each in the field).

### 5.3 Normalization + mapping

V1→V2→V3 ladder (spec defaults), then the §3.1 mapping. Unknown fields + `extensions` land in
`card` verbatim **after the strip pass** (§7) — the spec's preserve-unknowns MUST, structural
here via `extra="allow"` (R66: ST fakes it with a hidden form input). Name→slug: the agent-name
grammar, collision-suffixed. Imported agents default `duties: conversational` (ruling 2 — cards
are companions; the toggle flips any of them to full duty). **`AgentDef.description` (the
auto-router's "when to pick me" text) stays EMPTY on import** (coverage audit): the card's
description is persona prose, not routing copy — an imported character is reached by explicit
pick, never auto-routed to, until the owner writes a routing line themselves. Export is NOT
v1: the stash + Agnai's stale-stash comparison (R66 §9) are the recorded seam, so v1 loses
nothing. Note what imports FREE: `AgentDef.model` already exists per agent, so a character can
pin its own backend/model (e.g. an RP-tuned model) with zero new machinery — the editor simply
shows the existing picker beside the new fields.

### 5.4 The avatar

Decoded, probed by the existing `core/media.py` stack (closed type allowlist, magic-byte
verified), written into the `agents/avatars` library via the media write path, and bound via
`AgentDef.avatar` (§8). Import succeeds without an avatar; an invalid image degrades to a
report line, never a whole-card refusal. V3 multi-asset routing (sprites/emotions/user icons —
R66 §2.4) is a non-goal: extras stashed/ignored with a report line.

### 5.5 Tools

The importer (and the editor's create flow when the owner picks conversational duties) writes
`tools: roleplay.default_tools` **explicitly** — never the `"*"` default (R66 §4: no card
format has a tools field; our default is the widest value, so relying on it would invert
ruling 8). `privilege` stays CONFIRM.

## 6. The lorebook subsystem (roleplay-independent)

### 6.1 Storage

File-per-book: `$CTRLB_HOME/lorebooks/<slug>.yaml` — the agents/skills pattern (owner-editable,
diffable, listed by scan, CRUD via API mirroring the skills file API). Not SQLite: books are
authored config-like content. Writes ride `edit_config_yaml` (comment-preserving; the YAML-1.1
quoting guard matters — entry keys like `no` or `23:00` are exactly the ambiguous class).

### 6.2 The book + entry model (v1 subset — deliberate, V3-aligned names)

```yaml
name: Hollow Sea            # display; slug = filename
description: ""
enabled: true
entries:
  - keys: [ghostship, "the captain"]   # any hit activates (per flags below)
    content: |
      The ghostship Veile sails only under fog…
    enabled: true
    constant: false          # true → always active, no scan needed
    secondary_keys: []       # optional second gate…
    logic: and_any           # …and_any (one secondary must also hit) | not_any (none may hit)
    case_sensitive: false
    whole_words: true        # ST's SHIPPED default (R65 §1.2 correction), not its code default
    position: head           # head | tail (§6.4)
    order: 100               # render order among activated entries (lower first)
    priority: null           # eviction order (higher survives); null → order (V3's split)
```

One object per entry with optional fields (P5); `extra="allow"` stashes imported fields we
don't implement so re-export loses nothing and later adoption costs no migration. **Explicit
v1 non-goals** (recorded seams, never silently dropped): recursion, min-activations,
probability, inclusion groups, timed effects, regex keys, vector activation, `automationId`-
style triggers (that one would land on the A3/tool seams, privilege-gated — unlike the field's).

### 6.3 The scan

At `_static_prefix` build time (once per turn): haystack = the last `lorebooks.scan_depth`
messages' text + the incoming user message (chat text only — no tool outputs, no attachment
bodies; the field's default corpus). Active books = `lorebooks.books` ∪ the agent's
`lorebooks`, slug-deduped (the field's bind-twice-counts-once rule). An entry activates iff
enabled ∧ (constant ∨ a key matches per its flags) ∧ its secondary gate passes. Matching =
substring / whole-word toggle, casefold unless `case_sensitive`. No regex in v1.

### 6.4 Rendering, budget, placement

Activated entries render ONCE each (spec MUST), sorted by `order`, joined into one framed block
(framing = registry id `lorebook_intro`, phrased as *reference data, not instructions* — the
Core-Memory convention, R65 §9's security note). Over `budget_chars`: evict lowest `priority`
(then lowest `order`) until it fits — the V3 eviction model, not ST's refusal (R65 §1.10: ST is
the outlier). Placement: `head` → one block appended LAST in the static head (most volatile
block, R65 §9's cache analysis; scan-miss ⇒ nothing); `tail` → the §4.2 tail slot before
`post_history`.

### 6.5 Attachment + import

Attach globally or per-agent. Card import writes an embedded `character_book` as
`lorebooks/<agent-slug>-book.yaml` and appends it to the agent's list. Book import (its own
endpoint) accepts the V3 `{spec:'lorebook_v3'}` envelope, ST's raw standalone export, and a
bare entries list — the three circulating shapes (R65 §5).

### 6.6 UI

A Lorebooks manager (books + entries CRUD, enable toggles) + an attachment picker in the agent
editor. Visible regardless of `roleplay.enabled` (ruling 9); only the card-import auto-attach
surface carries the roleplay marking.

### 6.7 The test book (ruling 9)

S3 ships with a small AUTHORED book exercising every v1 mechanism (constant entry ·
plain keys · secondary `and_any` · `not_any` · a `tail` entry · an eviction-forcing pair) as a
test fixture, and the S7 device round imports a real public ST-format book of the owner's
choosing (or a curated interesting one) to prove the import path on field-authored data. The
"instruction chains" use the owner named — constant entries as standing behavioral blocks, the
R65 §7 logic-engine pattern — needs no extra mechanism: `constant: true` + `position` already
express it; the test book demonstrates one.

### 6.8 Why not Core Memory (explicit, held from v1)

The two complementary lanes R65 §9 delineates stay separate: lorebooks are **code-decided,
pre-first-token, invisible-in-transcript, recomputed per turn** over an owner-authored corpus;
Core Memory is **model-decided, mid-turn, visible tool calls** over an agent-written corpus
with its own consolidation lifecycle. Merging (a `keys[]` mode on memory blocks) would put one
subsystem under two deciders, two budgets, two lifecycles for the win of one shared YAML
loader. Shared ground they DO get: the fallible-data framing convention + registry-owned intros.

## 7. Security posture (SECURITY_MODEL.md lens)

- **Cards are untrusted input that can carry code** (R66 §3: Risu regex scripts — one mode
  rewrites outbound requests — trigger scripts, CHARX modules; imported promptless in the
  field). We execute none and warehouse none: import strips the known-executable extension
  classes (`regex_scripts`, `triggerscript`, Risu module payloads, `virtualscript` — the
  field's own strip-on-import-AND-export precedent) from the stash and reports the removals.
  Inert unknown extension data stays (P4).
- **Zip handling**: `card.json` size cap, per-asset + total caps, normalized paths (reject
  traversal), bounded entry count — the media 413 conventions applied to a new container.
- **Images**: only via the existing probe stack + closed type allowlist; never served un-probed.
- **Prompt-injection surface**: card and lorebook text enter prompts as data under registry
  framings; imported `post_history` sits closest to generation and is the highest-leverage
  injected text — the import report shows it verbatim. No card text is ever rendered as HTML.
- **No new execution paths, no privilege changes**: minimal tools + CONFIRM on import; lorebook
  activation adds TEXT only (v1 non-goal pins it).

## 8. Agent art: libraries, upload reuse, and the three-state backdrop

### 8.1 Libraries + bindings (the gacha pattern, copied exactly — no media-model change)

A new `agents` namespace in `MEDIA_NAMESPACES` with two static role POOLS: `avatars` and
`backgrounds`. Each is an ordinary D65 library (upload, crop, focal point, reorder, retire —
inherited from the media manager). The per-agent BINDING is agent data:
`AgentDef.avatar`/`.background` name a library entry — precisely how gacha's roster deals
`characters` portraits to hosts and how the `wallpaper` slot pins one to the backdrop. Avatar
and background are **independent images** (owner: "which might be different"). The namespace
row is additive; `MEDIA_PLAN`/`MEDIA_MANAGER_PLAN` authority ratifies it as an ordinary new
namespace.

### 8.2 Upload/crop/focus are REUSED, not rebuilt (ruling 14)

Setting an avatar or background from the agent editor drives the same standalone `useImageJob`
machine the media manager ships (W10: admit→guard→crop→export with delivery injected — built
precisely so a new surface could inject its own delivery tail), landing the file in the role's
library via the existing media write path, then writing the `AgentDef` binding. Focal-point
editing and re-crop work on these entries as on any library entry because they ARE ordinary
library entries. Zero new upload/crop/focus code; per-role aspect defaults (avatar ~square,
background tall) are config-shaped like the existing per-role crop settings, not hardcoded.

### 8.3 The three-state backdrop (ruling 13 — in-phase, default ON)

**One appearance setting, three states: `operator` (default) · `full` · `off`.**

- **What paints:** the ACTIVE agent's `background` entry; when the agent has none, the theme's
  own operator art (in gacha: the `oracle:` pin / `media/gacha/oracle/` library, today's
  ladder) — so a fresh install and every agent without art look exactly like today. `off`
  beats the ladder entirely.
- **`operator`** — the art takes the operator-image place with the CURRENT treatment: gacha's
  oracle surface as-is (name plate, scrim, scanline, the sticky ghost under `gacha.oracle`
  fade mode), focal position honored via the existing `useFocalPosition` path. The agent's
  background simply wins the art resolution for that surface while that agent is active.
- **`full`** — the same art as the full chat backdrop, **no blur; dimming AND the scroll fade
  kept** (owner-confirmed round 4: "same fade out as the operator image… just the blur" is
  what changes). The distinction maps onto layers ALREADY separate in the oracle mechanism —
  the soft face's static blur is one layer, the scrim + the 1→0.28 opacity walk another — so
  `full` renders the sharp art full-bleed behind the thread with the readability scrim and the
  ghost-on-scroll opacity walk retained and the blur crossfade absent. §14.11 discipline
  holds: static art, opacity-only animation, no animated `filter`.
- **`off`** — no operator image, no background. **This state IS the missing hide switch**: the
  only controls today are gacha's "Sticky operator art" toggle (scroll BEHAVIOR, not
  visibility) and the media in-use switches (which retire ART, not the surface) — verified, no
  overlapping on/off exists, so the three-state subsumes rather than duplicates
  (`GachaAgent.tsx` keeps plate/scrim/scanline when art resolves null today; `off` hides the
  art surface itself — the delta is designed in S6, including what happens to the name plate).
- **Orthogonality kept:** `gacha.oracle` (sticky vs scroll) stays a gacha refinement of HOW
  `operator` mode scrolls; the three-state picks WHAT/WHERE. The media in-use switches keep
  governing the theme-fallback tier only.
- **Where it lives:** a theme-engine-level appearance setting (the theme-settings surface,
  beside the existing oracle toggle on gacha), global — the ART is per-agent, the MODE is the
  owner's viewing preference. Per-agent mode overrides = recorded seam, not v1.
- **Theme scope (CODE-VERIFIED round 4 — the bespoke assumption was wrong, in our favor):**
  cosmos and vapor have bespoke FLEET views only; both wrap `DefaultRoot` and their agent
  chat IS the shared kit `AgentTab` (`CosmosRoot.tsx:24`, `VaporRoot.tsx:57` — cosmos passes
  `kitBackground={false}` for its root starfield, which is why the backdrop layer mounts
  INSIDE the shared agent tab, not on the root `KitBackground`). So ONE kit-level layer
  covers cosmos, vapor, and minimal at once; **gacha** integrates via its oracle surface
  (§8.3 above); **frontier** is the one remaining bespoke agent surface (`FrontierAgent.tsx`)
  — **v1 leaves it exactly as it is** (the setting has no effect there; ruling 18), and the
  integration lands as a separate follow-up cleanup after the phase. `""`/absent art ⇒
  today's look on every theme regardless of state.

### 8.4 The agent gallery — its own settings section (rulings 4 + 17)

The agents editor MOVES out of ConfTab (where it is one collapsible section today,
`ConfTab.tsx:2699`) into a **dedicated settings section: the agent/character gallery** — one
home for ALL agents regardless of kind (ruling 17), riding the existing `useSections`
navigation like any section. Each agent renders as a visual card carrying its avatar
(background previewed in the detail); opening a card is the full agent editor (fields +
SOUL.md + art + duties toggle + lorebook picker). Import lands here (§5.1) under the §9
visibility predicate. Still ONE surface — the gallery IS the editor's list; no duplicate
list remains in Conf (the `agent.defaults` GLOBALS keep their Conf home — they are settings,
not agents; the council refines the exact cut). The chat agent picker gets small avatars.
Styling per `VAPOR_PATTERNS.md`; theme dressing rides the existing surface rules (D31).

## 9. Editor + Conf presentation

- **No Character pane** (ruling 1). The new fields sit in the agent form among the existing
  prompt fields, each visible iff `roleplay.enabled` **or the field is populated** (the Risu
  predicate, R66 §5.3) — an imported card lights up exactly what it uses even with the toggle
  off; a plain agent keeps today's compact form.
- **Marked help**: every new field gets the small icon + one-liner (the Risu one-prop pattern;
  ST's "(not sent to the AI)" scope subtitles for metadata like the stash). Help strings are FE
  constants beside the form — UI copy, not model-facing text; the registry deliberately does
  not own them.
- **The duties toggle** (ruling 5): a two-option selector on the agent form (agent /
  conversational), always visible — it is an agent fact, not a roleplay extra. The two texts
  are edited in the Phase 18 prompt editor like any registry prompt.
- **Conf**: the `roleplay` group (toggle · default-tools list · persona name/description) + the
  `lorebooks` globals. Import lives on the agents surface under the visibility predicate.
- All new forms testable at narrow widths (the standing mobile bar).

## 10. Slice ladder (each: pinned Opus build → main-seat audit → blind Emma round → fix wave → close)

- **S0 — the assembly core (BE):** the AgentDef fields + config section + macro pass + the
  Voice/Duties split (`DEFAULT_SYSTEM_PROMPT` → persona default + `duties_agent`; the new
  `duties_conversational` text) + scenario/persona blocks + the post-history tail slot.
  Golden-fixture assembly tests re-pin the new universal shape; a no-new-fields agent's diff
  vs today = exactly the restructured head, nothing else.
- **S1 — greeting + example dialogue (BE):** thread seeding, `<START>` parsing, pseudo-message
  emission, normalize-seam behavior on strict templates.
- **S2 — card import (BE):** containers + sniffing + normalization + mapping + strip pass +
  avatar into the library + explicit minimal tools + the import report.
- **S3 — lorebooks (BE):** storage/CRUD + scan + render/budget + bindings + book import.
- **S4 — the agents FE:** the gallery section (the AgentsEditor relocation + visual cards,
  §8.4) · avatar/background set-from-editor via the reused `useImageJob` crop/focus machine
  (§8.2) · the new marked fields + visibility predicate · the duties toggle · Conf group +
  persona editor · import UI + report · agent-picker avatars.
- **S5 — the lorebook FE:** manager + attachment picker.
- **S6 — the three-state backdrop (FE/theme):** the appearance setting + gacha oracle
  integration + the kit backdrop layer + the `off`-state surface behavior (§8.3) — in-phase
  per ruling 13, default `operator`.
- **S7 — the owner device round** (the phase gate): import a real card, talk to it on the
  phone, tools-in-character on both duties settings, all three backdrop states on the real
  phone (blur/dim legibility), a field-authored lorebook imported + triggering live (§6.7),
  the showcase + picker feel, read-along on a character reply.

## 11. Open questions for the owner (the court)

*(Resolved rounds 3–4: greeting=yes (11) · `{{user}}` chain (7) · containers (12) · lorebook
subset + test book (9/§6.7) · backdrop in-phase default ON (13) · full mode = no blur, dim +
scroll fade kept (§8.3) · reset semantics ruled, feature deferred (§4.2) · theme scope
code-verified: kit layer covers cosmos/vapor/minimal, gacha integrates, frontier follows
(§8.3).)*

*(Round 5 closed the court: duties-on-import confirmed + the voice-not-capability invariant
(16) · the gallery becomes its OWN settings section (17) · frontier v1-unchanged, follow-up
cleanup (18).)*

1. **The two duties texts (§4.1a)** — the owner reads both drafts and tunes words at will
   (they are registry defaults; every later edit is a Conf edit, no code). Standing until the
   owner has read them; not blocking the Emma round.

## 12. Evidence coverage map (the owner's round-6 audit: every section → its backing, gaps named)

| Plan section | Evidence | Status |
|---|---|---|
| §3 data model / card→field mapping | R64 §1 [V] (anatomy, prompt-vs-metadata) + `AgentDef` seam read | **Covered** |
| §4.1 Voice/Duties split | R64 §5.4 [R — one primary paper, CPDC 2025] + §4.6 field survey [V] | **Covered, honestly [R]** — the split's warrant is one measured study + field convention; the Emma round should stress it |
| §4.1a duties texts | Derived from the shipped `DEFAULT_SYSTEM_PROMPT` + R64 §5.4's act-before-speaking rule | **Covered** (owner read both, round 5→6) |
| §4.2 scenario/persona blocks | R64 §2.2 [V] (assembly order) + §6 [V] (user persona) + R66 §5.5 [V] (persona editors) | **Covered** |
| §4.2 example dialogue wire | R64 §7 [V] + the R64 §10 coalescer-collision analysis | **Covered, with the named S1 probe**: `name`-on-system acceptance on OUR providers (R41/R42 are general, not this exact shape) |
| §4.2 post-history tail | R64 §2.2/§3 [V] + R42 [V] (normalize re-role) | **Covered** |
| §4.2 greeting seeding | R64 §4.3 [V+R] + the compaction note above | **Covered** |
| §4.3 macros | R32 [V] + `prompts.py` seam read | **Covered** |
| §5 import containers/normalization/tolerance | R66 §1–§2 [V] (source-read importers) | **Covered** |
| §5.4 avatar entry | R66 §2.4 [V] + `core/media.py` seam read | **Covered** |
| §5.5 tools default | R66 §4 [V/R] (field posture: no precedent constrains us) | **Covered** |
| §6 lorebook semantics/budget/positions | R65 [V] (full ST semantics + V3 + 3 contrasts) | **Covered**; R65's own named gaps stand (no runtime scan-cost measurement — our 2-msg window + char budget keeps the v1 cost trivially bounded; NAI contextConfig unbought — NAI import is a non-goal) |
| §6.7 test book | Owner ruling + R65 §7 sizing data [R] | **Covered** |
| §6.8 lorebooks ≠ Core Memory | R65 §9's precise contrast + CORE_MEMORY_PLAN | **Covered** |
| §7 security/strip | R66 §3 [V] (script classes, the virtualscript precedent) + SECURITY_MODEL | **Covered** |
| §8.1/8.2 libraries + upload reuse | Code-verified in-house (gacha pattern, W10 `useImageJob`) | **Covered** |
| §8.3 three-state backdrop | Owner-specified UX + the oracle mechanism code read + round-4 theme-scope verification | **Covered by rulings** — deliberately NOT field-researched: the owner specified the behavior; ST's background system is adjacent prior art, not an authority over an owner ruling |
| §8.4 the gallery | R66 §5 covers EDITOR forms only | **GAP → R67 commissioned** (2026-09-06): list/gallery surfaces in ST/Risu/Agnai + peers, organization at scale, selection model, mobile reflow — plus the two adjacent unruled conventions below |
| §9 editor presentation | R66 §5 [V] (Risu predicate, marked help, token counters) | **Covered** |
| §10 ladder / cadence | House method (D-entry precedents) | n/a |

**Nuances the audit surfaced (now recorded in place):** the S1 named-system probe (§4.2) ·
the greeting-vs-compaction note (§4.2) · router description empty on import + model-per-
character free (§5.3) · **two conventions pending R67, then the owner's ruling: the agent
avatar ON chat bubbles (every RP frontend shows it; ours shows none) and a per-agent TTS
VOICE override (the field binds voice per character; we have one global voice)** — both land
as court items when R67 reports.

**Double-checking the data itself:** the three dossiers quote file:line at pinned SHAs and
were main-seat-audited at landing (implications sections verified against our real seams).
The blind Emma design round's brief will additionally instruct her to spot-check the plan's
load-bearing citations against the dossiers — an adversarial second read of the evidence, not
just the design.
