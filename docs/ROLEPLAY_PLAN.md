# Characters are agents — the conversational-agents + lorebook plan of record

> **Status: ✏️ DESIGN v2 — RATIFIED 2026-09-06 ([`D70`](./DECISIONS.md); owner, in
> conversation). COUNCIL-CLOSED same day (§13: blind Emma round BUILD WITH CHANGES → all 15
> findings folded → confirm → micro-confirm CONFIRMED). Build = S0–S7 per §10, in progress.**
> Eight owner design rounds are folded (§1 rulings 1–21); evidence = R64–R67 (§0/§12).
>
> **Authority:** this doc owns the agent-feature expansion (the new AgentDef
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
| [R67](./research/R67-character-gallery-ux.md) | Gallery/list surfaces (nobody defaults to a grid; grids trade info for density; 0/3 virtualize) · selection (3/3: primary tap = TALK, edit = second gesture; ST's 2500ms long-press = the cautionary tale) · the priced organization ladder · mobile reflow · **transcript avatars 3/3 both sides, toggleable at three different scopes** · **per-character TTS voice 3/3** (on-the-object Risu/Agnai vs ST's rename-fragile name-keyed map that THROWS on unmapped) · in-house: gacha's 3/4 card grid + `FocalImg`/`art.focus` beat the field's crop hacks |

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
19. **Prompt-editor refinements ride this phase** (round 7): ① the default text shows IN the
    edit field — grayed, fully editable, "not like a hint… editable and not completely
    replaced when you click" — ② customized prompts get a small visual highlight on the field
    box ("you should be able to see the ones that have changed") — ③ the growing catalog gets
    ORGANIZED: ordered, grouped into sections with small separators. Design in §9a.
20. **Bubble avatar = the who-line DOT swap** (round 8): an agent WITH an avatar shows it as
    a small circle exactly where the who-line dot sits today ("so we don't lose text space");
    no avatar — an agent, or a character whose avatar was removed — keeps "the simple dot…
    simple and clean"; ONE toggle enables/disables avatars, falling back to the dot. §8.5.
21. **Per-agent TTS voice IS v1** (round 8): optional, falls back to the default voice when
    unset. §3.1's `voice` field.

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
voice: str = ""                     # TTS voice id for this agent (ruling 21); "" → the global
                                    # voice.tts chain. A NON-empty id is used as-is: no registry
                                    # can validate voice ids, so a bad one reports through the
                                    # existing TTS error path exactly like a bad global voice
                                    # (Emma F6 — the earlier unknown→default promise required
                                    # an allowlist nothing can provide; absent→default is the
                                    # whole fallback contract)
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
formal-executor shaping (task_plan pushing, brevity mandates, report-style summaries). The
Emma round's F2 correction is folded: the MECHANICAL rails (tool-over-guessing, carry-through,
batching, fleet-vs-web routing) are behavior, not voice — dropping them would have violated
ruling 16's own invariant, so they stay, re-voiced in casual prose:

> This is a conversation first: speak in your own voice and match its tone and rhythm. Never
> fall into report formatting — no headings, no bullet lists, no closing summaries unless
> asked. You still have your tools and your full authority to use them: when the conversation
> calls for a real action (waking or shutting down a machine, checking on something, searching
> the web), call the tool FIRST — prefer checking over guessing — then weave what happened
> into your reply naturally. Finish what you start: if an action needs several tool calls,
> keep going until it's done rather than stopping to narrate, and fire independent calls
> together instead of one at a time. Do not describe or promise an action you can simply
> take, and do not ask permission yourself — risky actions automatically pause for the
> owner's confirmation. Use the fleet tools for anything about the machines and web search
> only when the conversation actually needs the internet. Resolve a host or service the owner
> names to its stable `id` yourself from the fleet roster when one is provided. Never repeat
> the same tool call with the same arguments; if a result didn't help, change approach or say
> so in your own words.

What each drops from the other, named: conversational drops `task_plan` orchestration and
every brevity/report/summary mandate — NOTHING mechanical; agent drops nothing (it IS the
current behavior). Shared rails in both: tool-over-guessing, act-before-speaking,
carry-through, batching, fleet-vs-web routing, the confirm system (never self-ask), id
resolution, no identical-call repeats. (R64 §5.4's +0.052 belongs to the paper's FULL rule
package, not act-first alone — the Emma round's citation check; the rails are part of that
package, which is exactly why they survive here.)

Head shape: ONE leading system message, two `## `-labelled sections (labels are registry-owned
framings). **`{{original}}` semantics — field-specific, per the V2 contract (Emma F3):** the
spec defines it as "the prompt that would have been used WITHOUT the card". So in the
persona/SOUL text it substitutes **the complete no-card head**: the Voice the CHAIN would have
resolved without this persona — `inference.system_prompt` when configured, else the baked
default persona (confirm-round F3 correction: a configured fallback override IS the no-card
Voice; the baked text is only the last rung) — plus the selected duties text; and it CONSUMES
the separate Duties-section emission — substituted once at
its FIRST occurrence, later occurrences render empty (`safe_substitute` replaces all, so the
once-rule must be explicit). In `post_history` it substitutes ctrl-b's default post-history
text — which is empty — so it renders as nothing there; it never injects Duties at the tail.
**`inference.system_prompt`'s meaning SHIFTS (Emma F13, recorded):** today it replaces the
whole fused prompt; under this design it is the fallback VOICE only, with Duties appended
after — an existing override that already contains tool discipline will see that discipline
duplicated by `duties_agent` until the owner trims it. One release-notes/UI-help line says so;
a golden assembly case covers override + both append axes. No compatibility branch. **Semantic change, named for the council:** existing SOUL.md specialists today get
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
  (ST's verified wire shape, R64 §7 — Lite flattens instead; the earlier "4/4-peer" claim was
  an overreach, Emma's citation check). **The coalescer rule (Emma F1 — her code check killed
  the plan's original claim):** messages appended right after the head are still part of the
  LEADING system run, which `normalize_system_messages` merges name-droppingly. The fix is a
  one-line boundary rule in the normalizer: **a `name`-carrying system message TERMINATES the
  leading coalescing run** — the head coalesces up to the first named message, and the named
  examples fall through to the existing later-system branch, whose behavior is UNCONDITIONAL
  (confirm-round correction — there is no per-dialect switch and none is added): every later
  system message re-roles to marked `user` text, position preserved, with the example's
  name/side carried in the rendered frame. Uniform across every provider — the 5–6/7 peer
  convention for non-leading instruction content (R42). One focused normalize test: head +
  two named examples + user history. Turn-stable, cached with the head.
  **S1 verification item (coverage audit):** probe that the cloud dialects we actually use
  accept `name` on system messages, and that the qwen/llama.cpp path renders the normalized
  form sanely — R41/R42 cover strict-template systems generally, but named example
  pseudo-messages specifically have not been probed on OUR providers.
- **`post_history`** — a new tail emission in `_assemble` after the history, before the
  one-shot reflection nudge; macro-substituted. Recency is the point (R64 §3); cache cost ~nil
  (everything after the newest message re-prefills anyway). Lorebook `tail` entries share the
  slot, `post_history` last (closest to generation).
- **`greeting`** — a REAL seeded assistant message persisted at creation of EVERY new
  interactive thread with that agent (ruling 11; an empty-state render never reaches the wire
  and anchors nothing). **The creation seams, enumerated (Emma F5 — today no creation path
  carries the agent):** ① explicit new-thread creation (`POST /threads`) accepts and persists
  an optional selected agent, seeding when one is given; ② an auto-created chat thread seeds
  only AFTER `_auto_route_agent` resolves — never before routing; ③ **automation and subagent
  threads NEVER seed** (a headless run wants no greeting in its transcript — ruled here);
  one shared seeding helper serves ①+②, persisting `actor=AGENT` + the resolved agent name
  so attribution and the who-line read correctly. Macro-substituted at seed time.
  `alt_greetings` stored; a new-thread greeting picker is a recorded FE seam.
  **Compaction note (coverage audit):** the
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
content, and `roleplay.persona.description` (the S0 hold-out, reversed 2026-09-06 on field
evidence — the owner's real ST persona opens with `{{user}}`, which ST renders there; in one's
own description it reads as the persona name). It runs for every agent (the universal assembly)
— safe because unknown/unmatched
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

V1→V2→V3 ladder (spec defaults), then the §3.1 mapping. **The card→SOUL composition recipe is
normative (Emma F4 — two builders must not produce two different SOULs):** SOUL.md =
`system_prompt` (when non-empty) + blank line + `description` + blank line + `personality` —
bare concatenation in that order, empty fields skipped, NO labels or headers added (the field's
cards carry finished prose; framing the author didn't write is editorializing). `{{original}}`
inside any of them behaves per §4.1's field-specific rule. Two golden imports pin it:
description+personality only, and all three fields with `{{original}}`. Unknown fields +
`extensions` land in `card` verbatim **after the strip pass** (§7) — the spec's
preserve-unknowns MUST, structural here via `extra="allow"` (R66: ST fakes it with a hidden
form input). **Size caps (Emma F8):** one upload byte cap on the multipart body and one
decoded-card JSON cap, enforced for EVERY container (the existing cap+1/413 posture); CHARX
additionally keeps its per-entry / asset-count / total-uncompressed limits. Name→slug: the agent-name
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

At `_static_prefix` build time (once per turn): haystack = the incoming user message ONCE +
the last `lorebooks.scan_depth` messages **excluding the just-persisted incoming message**
(Emma F11: `run_turn` persists the user message before assembly, so a naive
`history[-scan_depth:]` + incoming would scan the current message twice and one fewer prior
message). Chat text only — no tool outputs, no attachment bodies (the field's default
corpus); computed before the first head build, cached with `_static_head`. Active books = `lorebooks.books` ∪ the agent's
`lorebooks`, slug-deduped (the field's bind-twice-counts-once rule). An entry activates iff
enabled ∧ (constant ∨ a key matches per its flags) ∧ its secondary gate passes. Matching =
substring / whole-word toggle, casefold unless `case_sensitive`. No regex in v1.

### 6.4 Rendering, budget, placement

The pipeline order is fixed (Emma F10 — "one block" and "two positions" contradicted each
other): ① activate; ② apply ONE global budget/eviction pass over ALL activated entries —
over `budget_chars`, evict lowest `priority` (then lowest `order`) until it fits (the V3
eviction model, not ST's refusal — R65 §1.10: ST is the outlier); ③ PARTITION the survivors
by `position`, preserving `order` within each; ④ emit **at most one framed head block AND at
most one framed tail block** (framing = registry id `lorebook_intro`, phrased as *reference
data, not instructions* — the Core-Memory convention, R65 §9's security note; framing chars
do NOT count against `budget_chars` — the budget bounds entry content, the framing is a
constant). Placement: `head` → appended LAST in the static head (most volatile block, R65
§9's cache analysis; scan-miss ⇒ nothing); `tail` → the §4.2 tail slot before `post_history`.
Each entry renders ONCE (spec MUST).

### 6.5 Attachment + import

Attach globally or per-agent. Card import writes an embedded `character_book` as
`lorebooks/<agent-slug>-book.yaml` and appends it to the agent's list. Book import (its own
endpoint) accepts the V3 `{spec:'lorebook_v3'}` envelope, ST's raw standalone export, and a
bare entries list — the three circulating shapes (R65 §5). **Position downgrade must be an
explicit import rule (2026-09-06 scout finding):** the owner's real ST books use positions
0–4 (before/after char defs, the two AN slots, at-depth), and v1 stores only `head | tail`
(§6.4) — the S3 brief pins the mapping (which numbers land `head`, which `tail`) with a
report line for every downgraded entry, never a silent coercion.

### 6.6 UI

**S5 first-class requirement (owner, 2026-09-06 — after eyeballing their real books):** a book
is a WALL of text (the field install holds 209-entry books), so the editor's default view is a
collapsed per-entry list (key summary + a content preview line), content expanded on demand —
never one giant form. R65/R66 carry the field's editor UX evidence; the S5 brief designs from
them.

A Lorebooks manager (books + entries CRUD, enable toggles) + an attachment picker in the agent
editor. Visible regardless of `roleplay.enabled` (ruling 9); only the card-import auto-attach
surface carries the roleplay marking.

### 6.7 The test book (ruling 9)

S3 ships with a small AUTHORED book exercising every v1 mechanism (constant entry ·
plain keys · secondary `and_any` · `not_any` · a `tail` entry · an eviction-forcing pair) as a
test fixture, and the S7 device round imports a real public ST-format book of the owner's
choosing (or a curated interesting one) to prove the import path on field-authored data.
**The owner's book is CHOSEN (2026-09-06, from a five-candidate scout of their ST install):
`Simple Personality Traits.json`** (40 entries · ~11K chars · 36 entries with secondary keys
under AND-ANY logic — "character instructions" shaped, reusable across every agent). It is the
S3 import-test target as well as the S7 device-round book; the runner-ups scouted (Cyberpunk
2077 · Fallout Western-USA (constant entry) · The Continent (63 tiny entries — eviction
pressure) · Dating addon (all-constant scenario addon)) are recorded here as extra probe
material, no ruling attached. The
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

- **Cards are untrusted input that can carry code** (R66 §3: Risu scripts — one mode rewrites
  outbound requests — trigger scripts, CHARX modules; imported promptless in the field). We
  execute none and warehouse none. **The strip is a concrete normalized-key DENYLIST applied
  RECURSIVELY before stashing (Emma F7 — prose categories can't drive a sanitizer, and the
  live Risu key is `customScripts`, not the older `regex_scripts` name):** at minimum
  the keys `customScripts` · `triggerscript` · `virtualscript` · `lowLevelAccess`, matched at
  ANY depth of the `extensions` tree (V3 permits nesting; the canonical home is
  `extensions.risuai.*`). **CHARX's code carrier is handled structurally, not by key
  (confirm-round F7 correction): our CHARX reader ingests `card.json` and asset entries
  ONLY — the Risu MODULE zip member (the thing whose scripts Risu's own importer folds into
  `triggerscript`/`customScripts`, R66 §3.1) is never read or stashed at all.** One function,
  walking every V1/V2/V3/raw-extension shape, reporting the EXACT removed paths in the import
  report, and reused verbatim on any future export (the field's strip-on-import-AND-export
  precedent). Inert
  unknown extension data stays (P4).
- **Zip handling**: `card.json` size cap, per-asset + total caps, normalized paths (reject
  traversal), bounded entry count — the media 413 conventions applied to a new container.
- **Images**: only via the existing probe stack + closed type allowlist; never served un-probed.
- **Prompt-injection surface**: card and lorebook text enter prompts as data under registry
  framings; imported `post_history` sits closest to generation and is the highest-leverage
  injected text — the import report shows it verbatim. No card text is ever rendered as HTML.
- **No new execution paths, no privilege changes**: minimal tools + CONFIRM on import; lorebook
  activation adds TEXT only (v1 non-goal pins it).
- **`agent.yaml` writes move onto the safe chokepoint (Emma F9):** `_scaffold_agent` today
  writes via `yaml.safe_dump` + `write_text_eol` — umask-dependent permissions, no YAML-1.1
  quoting, destructive of comments. A card's stash can carry credentials (R67 verified
  character objects holding provider API keys), so the agent write path routes through the
  already path-agnostic `edit_config_yaml(..., path=agent.yaml)` (atomic 0600 + `_yaml11_safe`
  + comment-preserving) — once, for imports AND manual edits alike.

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
  what changes). Mechanism, stated precisely (Emma's citation check corrected the earlier
  "layers already separate" claim — in today's oracle each FACE bundles art+scrim+plate and
  the whole face crossfades): `full` builds its OWN layer arrangement — one sharp full-bleed
  art layer + a separate readability scrim + the 1→0.28 opacity walk on the wrapper — REUSING
  the oracle's no-animated-`filter` approach (static rasterization, opacity-only per-frame
  work, §14.11) rather than its exact face structure, and simply mounting NO blurred layer.
- **`off`** — **suppresses BOTH the agent's art and the theme's fallback art, regardless of
  any binding** (Emma F14 killed the contradiction with the absent-art line below — that line
  now applies to operator/full only). The surface behavior is RULED here, not punted: gacha's
  oracle block STAYS with its name plate and scanline but paints no picture — exactly today's
  art-resolved-null presentation, so `off` reuses an existing, tested state rather than
  inventing chrome removal; the kit layer simply mounts nothing. This state IS the missing
  hide switch: the only controls today are gacha's "Sticky operator art" toggle (scroll
  BEHAVIOR) and the media in-use switches (which retire ART) — verified, no overlap.
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
  today's look on every theme **under `operator`/`full`** (`off` suppresses the fallback too —
  the F14 correction above).

### 8.4 The agent gallery — its own settings section (rulings 4 + 17; design evidence = R67)

> **⚠ PLACEMENT RE-RULED 2026-09-07 — see §8.4a.** Everything inside the gallery (grid, cards,
> Talk, import, editor swap) stands as written; where the section LIVES is superseded: the S4
> as-built "own docked section in every layout" inverted the owner's intent.

The agents editor MOVES out of ConfTab (one collapsible section today, `ConfTab.tsx:2699`)
into a **dedicated settings section: the agent/character gallery** — one home for ALL agents
regardless of kind (ruling 17), a `useSections` registry entry like any section (R67 ①: no
new nav concept). No duplicate list remains in Conf; the `agent.defaults` GLOBALS keep their
Conf home (settings, not agents; council refines the cut).

- **Layout: a card grid IS our default — a stated, priced divergence.** The field defaults to
  LIST everywhere and treats grids as info-shedding density modes (R67 §1) — but that serves
  catalogs of hundreds; ctrl-b is single-user with a handful of agents, and the owner asked
  for a showcase. So: a 2-column grid of 3/4 cards at phone width (gacha's `.gc-track` is the
  structural precedent, rebuilt kit-level with tokens per VAPOR_PATTERNS §5–§7/§11–§13 —
  never copied from the theme), each card = `FocalImg` + `art.focus` (D65's real framing —
  the field hand-tunes `object-position` hacks for lack of it) + a name/sub plate. No
  list/grid toggle at v1 (nothing to organize at N<20); the R67 §4 organization ladder
  (search · count line · favorites-group · tags · folders · soft-delete · bulk) is the
  priced seam list, adopted only when the count ever hurts. 0/3 peers virtualize — nor do we.
- **Selection: gallery tap = the agent's card/editor; a prominent TALK affordance jumps to
  chat with that agent pinned.** This INVERTS the field's 3/3 primary-tap-talks convention —
  deliberately (R67 ⑤ demands it be stated): our "talk to" verb already lives in the chat
  agent picker (which gets avatars), and the gallery is a settings surface — two homes, two
  verbs, no duplication. The Talk button keeps the owner's "selecting them" wish one tap
  away. NO long-press semantics anywhere (ST's 2500ms bulk-select escalation is the
  cautionary tale); every affordance is visible (the Agnai posture).
- **Entry points**: New + Import live on the section header (import under the §9 predicate).
  Empty state: a fresh install shows the default agent's card.
- **Avatar smalls**: circle at list/picker sizes (the field's 50px circle convention); the
  card shows the portrait through its focal point.
Styling per `VAPOR_PATTERNS.md`; theme dressing rides the existing surface rules (D31).

### 8.4a Satellite placement — where the gallery lives (owner re-rulings 2026-09-07; supersedes §8.4's placement clause and the S4 as-built docked section)

**The re-ruling.** S4 built the gallery as an always-present docked appbar action (off-bar,
unhosted in every layout). The owner's word: the DEFAULT home is inside settings, "like the
tools tab" — hidden by default, promotable on ask. The correction generalizes rather than
patches: the gallery becomes the first **SATELLITE SECTION**, a class the next such surface
(lorebooks is the named candidate) joins by recipe, not by new machinery.

**Core vs satellite (the model).** The core four (fleet/agent/utils/conf) stay governed by
D35's curated count presets — picker untouched, layout fence intact, the "4/3/2" labels stay
true. A satellite never appears in a preset; it carries a per-section PLACEMENT composed over
the resolved preset at one seam. The placement vocabulary is the partition's own three buckets
(no new nav concept — R67 ① still holds):

- **conf** (DEFAULT — the owner's "hidden by default"): hosted in Conf, the D35 Axis-B
  mechanism whose entry says "generalized only if a second hosting pair ever exists" — this is
  that pair. ConfTab renders an "Agents · gallery" collapsed group; the body is
  `AgentsContent`, extracted exactly as `UtilsContent` was (AgentsTab keeps its standalone
  shell for the other placements). No chrome anywhere else.
- **button**: the S4 as-built state verbatim — off-bar/unhosted; the D35 docking rule +
  collapse ladder decide presentation (appbar visible → the docked trailing action; off /
  minimal → the floating launcher/popover). Zero new code: this state is the absence of
  placement effects.
- **tab**: joins the bottom bar, spliced AFTER the chat section (owner-ruled; it is promoted
  because it is a destination — the settings cluster keeps the rightmost seats).

**Never in two places (owner constraint).** Placement is a PREFERENCE resolved each render
against the actual chrome, single-sourced: one resolved value per satellite decides bucket
membership, and the partition's buckets are disjoint by construction. Degradation takes the
layout lever's own coercion stance: under `appbarMode: minimal` the effective bar is `[]`, so a
`tab` placement falls to the menu popover with everything else — the existing partition does
it, no special case; the hosted group renders iff the RESOLVED placement is `conf`, so a
promoted gallery can never also appear in settings. Unknown persisted values heal to the
default (the lever's parse-don't-validate stance).

**The lever + control.** `ui.sectionPlacement: Partial<Record<TabId, "conf"|"button"|"tab">>`
— device-local like `ui.layout` (bar real estate is a per-screen preference), ONE map keyed by
section id with a closed vocabulary (the shape-to-extend rule: lorebooks later = one key, zero
new stores). Conf → Appearance grows one Seg row per satellite directly under Layout
("Agents": conf / button / tab), so the layout cluster reads as one control without corrupting
the count labels. A "5-tab" preset was considered and REJECTED: the count labels lie in mixed
states, presets multiply per satellite, every theme owes the fence a whole new designed bar,
and Material 3 caps a nav bar at 5 destinations — the count model stops scaling exactly here.

**Mechanics (reuse-first).** Presets, `partitionSections`, DefaultRoot's data-driven body
mount, and the hosted-coercion effect keep their structure. The composition step (apply
placements to the resolved preset before partitioning) is a PURE function in `layout.ts`
beside `partitionSections` — directly testable, no policy in the hook — with `useSections`
its one caller (Emma round, folded). The `navigate` chokepoint's hosted scroll-target
generalizes to the map its comment reserved (`{utils: HOSTED_UTILS_GROUP_ID, agents: …}`);
the coercion effect keys on the placement so a live conf-flip while standing on the gallery
lands in Conf + scroll-to-group (relocation resets local state — the D35 ratified trade).
Deep links/boot with a conf-placed active section coerce at the same chokepoint (existing
behavior). Three Emma-round folds (all verified against HEAD):
- **Scroll-cache invalidation (MED, 0.97):** DefaultRoot's `tabScrollRef` clear keys on
  `[sectionLayout]` only — a placement flip reshapes both documents under the same preset id.
  The clear effect gains the resolved placement/composition key beside `sectionLayout` — a
  STABLE SEMANTIC value (e.g. a joined placement string), never a freshly allocated object
  (her confirm-round rider) — plus one placement-flip case in the scroll test.
- **Conf tail numbering (MED, 0.98):** the `hostsUtils ? 22 : 21` / media `+i` ternary
  arithmetic cannot take a second hosted group. The tail derives numbering from ONE explicit
  ordered list of the hosted/terminal groups actually present (Appearance and the media base
  computed from its length); the consecutive/unique numbering test stays.
- **Standalone panel labeling (MED, 0.93 — a LATENT S4 DEFECT fixed by this fold):**
  `AgentsTab` labels its tabpanel `aria-labelledby="tabbtn-agents"`, an id that exists only
  for an ON-BAR button — under S4's always-off-bar placement it has never existed. The
  standalone panel (and its lazy/error fallback) takes a stable `aria-label` from `def.lbl`;
  `aria-labelledby` only when the tab button exists.

**Bar geometry at 5 (probed 2026-09-07, priced).** The one tab-bar renderer (KitNavBar) is
N-column data-driven (`--tab-count`/`--tab-i`); nothing structural breaks at 5, and mixed
counts (a promotion over 3-tab) need no code. The real degrade is label min-content width at
360px — one `kit.css` mitigation (`min-width: 0` + `nowrap` + a `--tab-count`-driven label
step), mirrored in gacha's bar block, verified with a real 360px screenshot before close.
Non-issues: tap targets, indicator math, gacha's reel (five slats, unrelated to tab count).

**The gacha sub-label (owner-ruled: mint one).** `tabAgents: "キャラ"` (kyara) — the
established gacha-register word for "characters" (the field's roster screens are キャラ一覧 /
キャラ詳細), three glyphs matching ツール's rhythm, honest under Q8.6b's real-words bar
(katakana where it is the natural writing). Lands in the frozen copy module through the
documented regen: edit `copy.ts` → `gen-theme-fonts.mjs` → commit outputs;
`gachaFonts.test.ts` guards drift. The `tabs.ts` no-sub-label carve-out comment retires.

**Consequences recorded.**
- The §13-S4 owner-feel riders (gacha appbar +~7px · bar-less 34px inset) lose their premise —
  the docked action is no longer always-present. Both geometries revert to conditional and
  must stay correct when placement = button.
- The S4-shaped test/e2e pins update to the new default (menu empty by default; the
  docked-button e2e path moves behind a placement flip).
- ONE parameterized integration guard for the owner's exclusivity constraint (Emma LOW,
  folded): mount DefaultRoot + Conf across `conf|button|tab`, a malformed persisted
  placement, minimal+`tab`, deep boot on agents, and one live agents→conf flip — asserting
  exactly one gallery marker and the expected nav affordance in each state.
- `tabs.ts`'s "deliberately NOT on any preset bar" note is superseded by this section (its
  reasoning stands — satellites still never join a PRESET).
- At fold, D35 gains an addendum recording satellite sections v1 (this section is the spec;
  DECISIONS points here).

**The lorebooks recipe (future, NOT built now — honest form per the Emma round).** S5 lands
the lorebook UI as planned (Conf groups). If it ever outgrows settings, satellite #2 is a set
of ADDITIVE closed-world edits — **no new navigation primitive**, but more than "one row":
the `Tab` union + `TABS` runtime allowlist in `store/ui.ts` · a TabDef row in every per-theme
tab set (+ glyph/labels, gacha sub-label with its font regen) · a `DEFAULT_BODIES` entry ·
the host ConfGroup in the ordered tail list · the navigate scroll-target map entry · its
Appearance placement row · the satellite-id set the composition step reads. No speculative
registry is built for this now (a second satellite applies the rule of three when it
arrives). Adoption is a later owner call.

*Council: blind Emma design round 2026-09-07 (sol high, `--ignore-rules`, R46 brief) —
SHIP WITH CHANGES: 0 HIGH · 3 MED · 2 LOW, open sweep = the scroll-cache MED only; all five
accepted + folded above (the MED-1/MED-3 citations main-seat-verified against HEAD
`22032ad`); sound-checks cleared layering, exclusivity, the lever, the splice, geometry, and
the キャラ regen path. Confirm round (same session resumed): all five RESOLVED, sweep
"none" — **RESOLVED — SHIP**; her one rider (the composition key must be a stable semantic
value) is folded into the MED-1 line above.*

### 8.5 The transcript avatar — the who-line dot swap (ruling 20)

Anchor verified: the message header's "dot" is `.who::before` — a 6px accent circle
(`kit.css:3601-3613`, role-colored). The design is a SWAP in that exact position: when the
avatars toggle is ON and the message's agent has an avatar, the who-line leads with the
avatar as a small circle (sized to the who-line, ~18px — the exact value rides
VAPOR_PATTERNS tokens at build); otherwise — toggle OFF, an agent with no avatar, a
character whose avatar was removed — the 6px dot renders exactly as today. Nothing else in
the who-line moves: the label/endpoint-chip/time text keeps its space, the read-aloud toggle
stays where it is (we do NOT adopt the field's avatar-as-TTS-transport slot — ours is
placed), and the user side is untouched in v1 (the persona has no image; recorded seam).
The toggle is ONE global Appearance setting in the `ui` store beside its siblings (the Agnai
scope; a per-agent hide flag would be the similar-things trap). Bubble geometry is otherwise
untouched — this is a who-line ornament, not a gutter column, which is exactly why it costs
no text width (the owner's stated constraint).

**Per-agent voice resolution (ruling 21, F6-corrected):** the TTS request path resolves
`AgentDef.voice` (non-empty → passed as the request's voice) → else the global `voice.tts`
chain — the agent identity of the message/thread picks the voice for read-aloud, read-along,
and auto-TTS alike. ABSENT ⇒ the global default. A non-empty-but-invalid id reports through
the existing TTS error path exactly as a bad global voice does today — no registry can
validate voice ids, so a silent-unknown-fallback contract is unimplementable (and R67's
Risu/Agnai precedent is absent-binding⇒no-speech, not unknown⇒default — the citation check).

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

### 9a. Prompt-editor refinements (ruling 19 — Phase 18 surface work riding this phase)

Verified current state: `PromptsEditor.tsx` lists every registry prompt flat in registry
order; rows carry a "customized" badge + an effective-text preview; the edit modal's override
field opens EMPTY, with the shipped default beside it as reference. The three changes:

1. **Default pre-filled, grayed, editable — WITHOUT the freeze trap.** The field's known
   failure mode (R27: replacement "freezes you at the copied version") is exactly what naive
   pre-fill causes: saving the default's text AS an override pins the prompt to today's
   wording forever, silently opting out of every future default improvement. The design that
   gives the owner's UX without the trap: the field renders the default text as its CONTENT
   in a muted style; an edit turns it live (normal style); on save, **text that equals the
   shipped default stores NOTHING**. Equality is EXACT string equality after only the
   existing whitespace-only→empty normalization (Emma F15: a `.trim()` comparison would
   silently discard a deliberate leading/trailing-whitespace delta, which the shipped `norm`
   posture deliberately preserves); the comparison target is the `default_text` loaded into
   that modal; and an equal BASE clears only `override` — a set `append` survives untouched.
   So the owner always sees and tweaks real words, and an untouched prompt keeps riding
   upstream defaults. Restore stays "delete the customization" (the shipped rule, unchanged).
2. **Customized highlight**: beside the existing badge, the field box itself carries a quiet
   persistent accent (a `tcat-mod`-family left border/tint per VAPOR_PATTERNS tokens — not a
   transition). With the duties pair in the catalog this is what makes "which prompts did I
   change for this mode" legible at a glance (the owner's stated need).
3. **Organization**: `PromptDef` gains an optional `group` label (the registry stays the ONE
   ordering authority — no FE-side grouping map, per the sibling-map ban); the editor renders
   the groups as titled sections with separators. Grouping follows the catalog's natural
   roles (context framing · turn steering · memory · consolidation · summarizer · duties ·
   lorebook/persona intros as they land). Registry declaration order remains the order within
   a group, so the backend file stays the single place order is expressed.

Rides S4 (it is Conf/editor FE); recorded as a PROMPTS_PLAN amendment when built so the
Phase 18 doc stays truthful.

## 10. Slice ladder (each: pinned Opus build → main-seat audit → blind Emma round → fix wave → close)

- **S0 — the assembly core (BE):** the AgentDef fields + config section + macro pass + the
  Voice/Duties split (`DEFAULT_SYSTEM_PROMPT` → persona default + `duties_agent`; the new
  `duties_conversational` text) + scenario/persona blocks + the post-history tail slot.
  Golden-fixture assembly tests re-pin the new universal shape; a no-new-fields agent's diff
  vs today = exactly the restructured head, nothing else.
- **S1 — greeting + example dialogue + voice (BE):** thread seeding, `<START>` parsing,
  pseudo-message emission, normalize-seam behavior on strict templates (the §4.2 named-system
  probe), the per-agent voice resolution (§8.5).
- **S2 — card import (BE):** containers + sniffing + normalization + mapping + strip pass +
  avatar into the library + explicit minimal tools + the import report.
- **S3 — lorebooks (BE):** storage/CRUD + scan + render/budget + bindings + book import.
- **S4 — the agents surface (FE + the summary API):** **the BE half first (Emma F12): extend
  `GET /agents` with a compact per-agent summary map — title · avatar · background · voice —
  including the resolved default** (today it returns only names + default, and the gallery/
  picker/who-line/backdrop would otherwise need N full agent+SOUL fetches per mount; media
  URL/focal resolution stays with the media index) · the gallery section (the AgentsEditor
  relocation + visual cards, §8.4) · avatar/background set-from-editor via the reused
  `useImageJob` crop/focus machine (§8.2) · the new marked fields + visibility predicate ·
  the duties toggle · Conf group + persona editor · import UI + report · agent-picker
  avatars · the who-line avatar swap + its Appearance toggle (§8.5) · the §9a prompt-editor
  refinements.
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

**THE COURT IS CLOSED (round 8).** Every question is ruled: duties texts (round 6) · bubble
avatar = the who-line dot swap, toggleable, dot fallback (ruling 20 → §8.5) · per-agent TTS
voice IS v1 — absent ⇒ the global default; an invalid non-empty id reports through the
existing TTS error path (ruling 21 as F6-narrowed → §3.1/§8.5). The one standing owner-overridable:
the gallery tap inversion (§8.4 — tap=edit, Talk=button; presented round 8, not vetoed;
the S7 device round re-tests the feel either way).

**Round 1 RAN (§13): BUILD WITH CHANGES, all 15 findings accepted + folded into the body.**
**Next:** the Emma CONFIRM round on the folded fixes (`--resume latest`, context intact) →
owner ratification → **D70** → the S0 build brief.

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
| §8.4 the gallery | **R67 [V]** (landed 2026-09-06: layouts, selection, the organization ladder, mobile, in-house precedents) | **Covered** — the two deliberate divergences (grid default at our scale; tap = edit) are stated in-section with their rationale |
| §8.5 bubble avatar + per-agent voice | R67 §6–§8 [V] + rulings 20–21 + the `.who::before` anchor verified | **Covered** |
| §9 editor presentation | R66 §5 [V] (Risu predicate, marked help, token counters) | **Covered** |
| §10 ladder / cadence | House method (D-entry precedents) | n/a |

**Nuances the audit surfaced (now recorded in place):** the S1 named-system probe (§4.2) ·
the greeting-vs-compaction note (§4.2) · router description empty on import + model-per-
character free (§5.3) · **bubble avatars + per-agent voice: RULED round 8 (20/21) — designed
at §8.5, the court is closed.**

**Double-checking the data itself:** the four dossiers quote file:line at pinned SHAs and
were main-seat-audited at landing (implications sections verified against our real seams).
The blind Emma design round's brief will additionally instruct her to spot-check the plan's
load-bearing citations against the dossiers — an adversarial second read of the evidence, not
just the design.

## 13. Council record

### Round 1 — blind Emma design round (2026-09-06; hermes emma lane, sol high, `--ignore-rules`, the full R46 brief incl. the citation spot-check)

**VERDICT: BUILD WITH CHANGES — 14 MED · 1 LOW · HIGH none · open sweep "none".** Main-seat
rulings: **ALL FIFTEEN ACCEPTED** (her fixes were already lean; F6 took her narrower option A
— the contract change, not the allowlist). Every fix is FOLDED INTO THE BODY above, each
marked with its finding number (F1 §4.2 coalescer boundary · F2 §4.1a rails restored ·
F3/F13 §4.1 {{original}}+override semantics · F4 §5.3 composition recipe · F5 §4.2 greeting
seams · F6 §3.1/§8.5 voice contract · F7 §7 strip denylist · F8 §5.3 size caps · F9 §7
agent.yaml chokepoint · F10 §6.4 two-block pipeline · F11 §6.3 scan window · F12 §10-S4
summary API · F14 §8.3 off-state · F15 §9a equality). Her citation check also corrected four
plan-text overreaches in place (the "4/4-peer" wire claim → ST-verified; the R67 voice-
fallback precedent; the R64 §5.4 attribution; the §8.3 "layers already separate" claim).

The review, verbatim:

```
DESIGN REVIEW

Scope: I treated §1 rulings 1–21 as locked product decisions. This review concerns implementation semantics, integration with today’s code, and whether the slices specify enough to build those decisions correctly.

HIGH: none.

PRIORITIZED FINDINGS

1. MED — Example dialogue will be swallowed by the leading-system coalescer

“emitted between the static head and live history as `{role:"system", name:...}`”
“Position keeps them clear of the leading-run coalescer”

That position does the opposite. `_static_prefix()` ends with system messages, so immediately following named example-system messages remain part of the leading run; `normalize_system_messages()` merges every consecutive leading system message and drops metadata when there is more than one contributor. The later-system re-role branch never sees them. Scenario: any agent with `example_dialogue` loses `name=example_user/example_assistant` and all turns become undifferentiated text inside the system head. LEAN fix: make a named system message terminate the leading coalescing run, then let the existing later-system branch re-role it while preserving `name`; add one focused normalize test covering static head + two named examples + user history. Confidence: 1.00.

2. MED — The conversational duties text removes operational behavior, not merely formal voice

“duties differ in VOICE only, NEVER capability”
“conversational drops … the carry-through/batching drill, the routing lecture”

Those statements conflict. The current prompt’s carry-through, batching, tool-over-guessing, and fleet-vs-web routing rules materially shape whether granted tools are used correctly; removing them can make a conversational agent stop after one operation, serialize a batch, or use web search for a fleet request. R64 §5.4 does not establish “action-first” as the sole load-bearing rule: its measured RRP combined five rules plus hard function-call enforcement, including exact schemas and ambiguity handling. LEAN fix: remove task-plan pushing, report formatting, and brevity mandates, but retain the mechanical rails in casual prose: prefer tools to guessing, finish an initiated action, batch independent calls, use exact schemas, and keep fleet routing. Confidence: 0.97.

3. MED — `{{original}}` does not implement the cited V2 contract and is wrong for post-history instructions

“`{{original}}` in a persona substitutes the selected duties text”
“The pass runs over … post_history”

R64 quotes V2 directly: for `system_prompt`, `{{original}}` means the system prompt that would have been used without the card; the analogous placeholder in `post_history_instructions` means the default jailbreak/post-history string. Substituting Duties alone is not the no-card system prompt, and substituting Duties into `post_history` duplicates them at the tail because only persona use suppresses the normal Duties section. Scenario: a normal V2 card using `{{original}}` either loses the fallback Voice or receives Duties twice in different positions. LEAN fix: define field-specific values: system-prompt `original` = the complete no-card Voice+Duties head and consumes the separately emitted Duties once; post-history `original` = ctrl-b’s default post-history text, currently empty. Specify repeated-token behavior explicitly because `_Placeholders.safe_substitute()` replaces every occurrence. Confidence: 0.99.

4. MED — Card-to-SOUL composition has no exact algorithm

“`description`+`personality` (+card `system_prompt`)→SOUL.md”

These are distinct card fields with distinct semantics, but the plan gives no ordering, separators, labels, replacement rule, or behavior when `system_prompt` is empty/non-empty/contains `{{original}}`. Scenario: two builders can validly produce incompatible SOUL files for the same ordinary V2 card—system prompt first versus description first, labelled versus bare, replacement versus concatenation—and therefore different prompts. LEAN fix: add one short normative composition recipe with exact order and separators, plus two golden imports: description+personality and all three fields with `{{original}}`. Confidence: 0.96.

5. MED — Greeting seeding has no single creation seam and cannot happen at today’s `/threads` creation point

“a REAL seeded assistant message persisted at creation of EVERY new thread with that agent”

Today `POST /threads` creates `Thread()` without an agent; auto-created chat threads are also created before `_auto_route_agent`, and normal interactive threads do not persist the selected agent (`thread.agent` remains unset). Automations and subagents create agent-bearing threads through direct `threads.create()` calls. Scenario: implementing only the API create route misses explicit/auto-routed agents, while putting seeding in `ThreadRepo.create()` cannot resolve the agent and risks injecting conversational greetings into automation/subagent histories. LEAN fix: specify each path: accept/persist an optional selected agent on explicit new-thread creation; seed auto-created chat only after routing; decide explicitly whether automation/subagent threads seed, and invoke one shared message-seeding helper only on the chosen paths. Persist `actor=AGENT` and `agent=<resolved name>`. Confidence: 0.98.

6. MED — Silent fallback for an unknown per-agent voice is not available at the cited seam

“unknown ids resolve to the default too — a silent no-op, NEVER an error”
“at … `provider_registry`’s voice resolution”

The provider registry resolves TTS targets, not each target’s supported voice IDs. `VoiceClient.synthesize()` forwards `voice or target.voice or "alloy"` to every target; an unknown non-empty agent voice can therefore make every hop fail and return a 502. R67 also does not support the stated precedent: Risu/Agnai treat an absent character binding as no speech, while ST throws for an unmapped character. Scenario: a stale voice ID after changing TTS providers breaks read-aloud, read-along, and auto-TTS instead of falling back. LEAN fix: either narrow the contract to empty⇒global and let invalid IDs report the existing error, or add a real configured voice allowlist and fall back only when the binding is absent from that list; do not infer “unknown” from a general provider failure. Confidence: 1.00.

7. MED — The executable-content strip list names the wrong live Risu field and is not concrete enough to enforce recursively

“strips … `regex_scripts`, `triggerscript`, Risu module payloads, `virtualscript`”

R66’s verified Risu field is `extensions.risuai.customScripts`, not `regex_scripts`; CHARX module scripts are folded into `customScripts` and `triggerscript`, and Risu also has `lowLevelAccess` plus code-capable module/assets structures. A prose category such as “Risu module payloads” is insufficient for a recursive sanitizer over V1/V2/V3/raw-extension shapes. Scenario: a malicious card stores `data.extensions.risuai.customScripts` untouched in `card`, contradicting “warehouse none,” and a future export can re-emit it. LEAN fix: define one explicit normalized path/key denylist—at minimum `customScripts`, `triggerscript`, `virtualscript`, low-level scripting flags, and CHARX code/module members—apply it recursively before stashing, report exact removed paths, and reuse the same function on any future export. Confidence: 0.95.

8. MED — Size controls cover CHARX but not plain JSON or PNG card metadata

“CHARX … depth/size caps per §7”
“`card: dict[str, Any] = {}`”

The plan specifies bounded zip members but no raw multipart limit or decoded-card JSON limit shared by PNG and JSON. There is no generic request-body cap in the inspected app; existing upload surfaces enforce their own counters. Scenario: a broken or hostile 200 MB JSON card, or a PNG carrying a huge base64 `chara` chunk, is parsed into memory and then serialized into an equally huge `agent.yaml`/API payload. LEAN fix: add one card-upload byte cap and one decoded-card JSON cap for every container, using the existing cap+1/413 posture; CHARX retains its additional entry, asset, and total-uncompressed limits. That bounds the stash without inventing a separate field quota. Confidence: 0.98.

9. MED — Preserving arbitrary card extensions in `agent.yaml` inherits a real secret-permission problem

“Unknown fields + `extensions` land in `card` verbatim”
“one new endpoint … composes the existing writes”

The existing `_scaffold_agent()` calls `yaml.safe_dump()` followed by `write_text_eol()`, whose temporary file receives ordinary umask-derived permissions; unlike `edit_config_yaml()`, it does not enforce 0600. R67 confirms character objects can contain provider API keys, and unknown extension blobs can carry similar credentials. Scenario: importing such a card under an ordinary 022 umask creates a 0644 `agent.yaml`. LEAN fix: route the existing agent write itself through the already path-agnostic `edit_config_yaml(..., path=agent.yaml)` with whole-map synchronization, gaining atomic 0600 writes, YAML-1.1 quoting, and comment preservation once for imports and manual edits. `safe_dump` itself round-trips multiline/Unicode safely; permissions and destructive rewriting are the defects. Confidence: 0.93.

10. MED — Lorebook rendering says both “one block” and two positions

“sorted by `order`, joined into one framed block”
“`head` → one block … `tail` → the §4.2 tail slot”

One block cannot preserve mixed `head` and `tail` entries, and the required test book deliberately contains a tail entry alongside other mechanisms. Scenario: simultaneous head and tail activation either puts everything at one position, duplicates the block, or applies the budget independently—all different semantics. LEAN fix: activate and apply one global budget/eviction pass, then partition surviving entries by position, preserve `order` within each partition, and emit at most one framed head block plus one framed tail block. State whether framing characters count against `budget_chars`. Confidence: 0.99.

11. MED — The lorebook scan window is off by one against today’s persistence order unless explicitly corrected

“last `lorebooks.scan_depth` messages’ text + the incoming user message”

`run_turn()` persists the incoming user message before `_drive()` calls `_assemble()`, and `_assemble()` reads that message into `history` before `_static_prefix()`. A literal implementation taking `history[-scan_depth:]` and then adding the incoming text scans the current message twice and one fewer prior message. Scenario: with depth 2, a key present only in the second prior message fails to activate. LEAN fix: define the corpus as the last N messages excluding the just-persisted incoming message, plus that incoming message once; compute it before the first `_static_prefix` build and cache the rendered result in `_static_head`. Confidence: 0.94.

12. MED — The visual gallery, picker avatars, backdrop, and message voice need an agent-summary API that no slice owns

“`GET /agents` … returns specialist agent names + the resolved default”
“S4 — the agents FE”

Today `GET /agents` returns only `agents: string[]` and `default`; individual GETs return the full resolved AgentDef plus SOUL. The new grid, agent picker, historical who-line avatars, active backdrop, and TTS mapping all need at least title/avatar/background/voice for every agent. Scenario: S4 either performs N full agent+SOUL requests whenever the gallery/chat mounts or cannot render the specified surfaces; S4 is labelled FE although the clean backend seam is absent. LEAN fix: add a compact summary collection to `GET /agents`—including the default agent—and assign that backend change before or within S4; keep media URL/focal resolution in the existing media index. The same summary map serves gallery, picker, backdrop, avatar, and voice. Confidence: 0.97.

13. MED — The semantic change to `inference.system_prompt` is not recorded for existing overrides

“Voice — … `AgentDef.prompt` → `inference.system_prompt` → the baked default”
“existing SOUL.md specialists … get their selected duties section too”

The plan records the SOUL change but not the equivalent global-override change. Today `inference.system_prompt` is a complete replacement for the fused identity+tool prompt; under this design it becomes Voice only and receives Duties afterward. Scenario: an existing global override already containing tool discipline gets duplicated or contradicted by `duties_agent`, affecting every agent without SOUL. LEAN fix: state explicitly that `inference.system_prompt` is redefined as the fallback Voice, call out duplication for existing full-prompt overrides in release notes/UI help, and add a golden case with a configured override plus global/per-agent appends. No compatibility branch is needed. Confidence: 0.96.

14. MED — The `off` backdrop state is internally contradictory and punts a visible decision to the build slice

“`off` hides the art surface itself … including what happens to the name plate”
“`""`/absent art ⇒ today’s look on every theme regardless of state”

The latter would restore today’s gacha operator fallback even in `off`, contradicting “off beats the ladder entirely.” The plan also leaves plate/scrim/scanline behavior undecided while calling this the plan of record. Scenario: choosing off with an agent lacking art can either still show the oracle, show empty chrome, or remove the whole operator block. LEAN fix: say: off suppresses both agent and fallback art regardless of binding; then explicitly choose whether gacha’s entire oracle surface or only its image layers disappear. Delete “regardless of state” or restrict it to operator/full. Confidence: 0.99.

15. LOW — Prompt-default equality needs exact normalization and append semantics

“text that equals the shipped default stores NOTHING (normalized comparison — the existing `norm` posture)”

The existing `norm` only maps all-whitespace text to empty; it intentionally preserves leading/trailing whitespace on non-empty prompts. “Normalized comparison” could be implemented as `.trim()`, silently discarding an intentional whitespace-only delta. “Stores nothing” is also ambiguous when an append remains. Scenario: an owner adds meaningful leading/trailing spacing, or restores the base while retaining an append. LEAN fix: define equality as exact string equality after only blank/whitespace-only→empty normalization; equal base clears only `override`, preserving `append`. Compare against the `default_text` loaded into that modal. Confidence: 0.89.


CONFIRMED SOUND

- The flat optional-field direction matches `AgentDef`’s existing style and owner ruling; Pydantic handles the list/dict defaults per instance.
- Voice+Duties can remain byte-stable within a turn: resolving both during the first `_static_prefix()` build and caching `_static_head` fits the current invariant. Global and per-agent appends can continue after the composed Voice/Duties message in their current order.
- A lorebook scan performed once before that first build is cache-compatible; placing its head block last among static blocks follows the real cache comments. Tail entries and `post_history` belong in `_assemble()` before the one-shot reflection nudge.
- The V3 priority/order split and global-budget-before-placement model are appropriate once the one-block contradiction is fixed.
- Lorebooks remaining separate from Core Memory is accurately reasoned and matches both implementations’ decision point, visibility, persistence, and budget differences.
- The media namespace/role extension, reuse of `useImageJob`, and `.who::before` avatar swap fit existing seams.
- The broad S0→S7 dependency order works apart from the missing agent-summary backend ownership and mixed BE work currently hidden inside “S4 FE.”


CITATION SPOT-CHECK

1. `AgentDef` / `domain/agent.py:181-226`: SUPPORTS the flat extension and `extra="allow"` house-style claim.
2. R64 §1.1 `{{original}}`: DOES NOT SUPPORT substituting Duties alone; it specifies the complete no-character system-prompt fallback, with separate post-history semantics.
3. R64 §5.4 Voice/Action result: PARTIAL. It supports explicit Voice/Action separation, but +0.052 belongs to the full RRP package, not action-first alone.
4. R64 §7 example wire: SUPPORTS ST’s named-system shape; DOES NOT SUPPORT “4/4-peer wire shape.” The cited section verifies ST’s wire and Lite’s flattened contrast.
5. `normalize_system_messages`, `inference.py:563-616`: CONTRADICTS the plan’s position claim; initial named examples coalesce and lose names, while genuinely later systems are re-roled and preserve `name`.
6. R66 §1 containers: SUPPORTS PNG chunks, discriminator-based JSON, CHARX, the normative `embeded://` typo, JPEG-appended ZIPs, and magic-byte sniffing.
7. R66 §9 existing-write composition: SUPPORTS composing agents CRUD and SOUL writes rather than creating parallel persistence.
8. R66 §3 executable content: PARTIAL/CONTRADICTORY. It supports strip-over-execute, but the verified Risu key is `customScripts`, not `regex_scripts`, and identifies additional module/low-level structures.
9. R65 §1.10/§2/§3: SUPPORTS separate eviction priority and render order, and V3-style eviction rather than ST refusal.
10. R65 §9 plus `session.py:734-759`: SUPPORTS placing a per-turn lorebook block last in the static head and caching it byte-identically within that turn.
11. R67 §8: CONTRADICTS the claimed Risu/Agnai global fallback precedent; both object-based systems treat an absent binding as no speech, while ST throws when unmapped.
12. `kit.css:3601-3613`: SUPPORTS the exact 6px `.who::before` role-colored dot anchor.
13. `GachaAgent.tsx` plus `gacha.css:4074-4103,4219-4255`: PARTIAL. The no-animated-filter implementation is reusable, but each face contains art+scrim+name and the whole face crossfades; scrim and opacity are not separate in the way §8.3 states.

OPEN SWEEP, LAST

None beyond the findings above.


SUMMARY

The architecture is mostly well fitted: one agent model, existing media machinery, static-head caching, tail injection, and a separate lorebook lane are all sound. The defects are concentrated at concrete seams rather than the overall direction: named examples collide with the coalescer; `{{original}}`, card-to-SOUL composition, greetings, and voice fallback do not yet have executable semantics; import limits/stripping/file permissions need tightening; mixed-position lorebooks contradict the “one block” rule; and the visual surfaces need one shared agent-summary API. These are bounded design corrections, not reasons to abandon the design.

VERDICT: BUILD WITH CHANGES

Fix the findings above in the plan before S0. The highest-value corrections are the normalize-system boundary, operationally complete conversational Duties, field-correct `{{original}}`, explicit greeting path coverage, truthful TTS fallback, concrete import caps/strip paths, two-block lore rendering, and the agent-summary endpoint. After those, the slice ladder is buildable without a redesign.
```

### Round 2 — the confirm round (2026-09-06, resumed session): 13/15 RESOLVED · F3+F7 residual · 2 fold-introduced problems → NOT CONFIRMED; all four fixed same-turn

Her verbatim confirm result:

```
F1 — RESOLVED: “a `name`-carrying system message TERMINATES the leading coalescing run” (§4.2, lines 277–280), with the requested focused two-dialect test.

F2 — RESOLVED: conversational duties retain tool-over-guessing, carry-through, batching, fleet/web routing, confirmation handling, ID resolution, and repeat-call avoidance (§4.1a, lines 224–245).

F3 — NOT RESOLVED: §4.1 defines `{{original}}` as “the default Voice text + the selected duties text” (lines 249–254), but the no-card Voice can be `inference.system_prompt`; a configured fallback override would incorrectly be replaced by the baked default.

F4 — RESOLVED: “SOUL.md = `system_prompt` … + blank line + `description` + blank line + `personality`,” with empty fields skipped, no labels, and two golden imports (§5.3, lines 339–345).

F5 — RESOLVED: all creation paths are explicitly ruled—selected-agent `POST /threads`, post-auto-route seeding, and no automation/subagent seeding—through one shared helper (§4.2, lines 290–298).

F6 — RESOLVED: “ABSENT ⇒ the global default. A non-empty-but-invalid id reports through the existing TTS error path” (§8.5, lines 613–619), implementing option A.

F7 — NOT RESOLVED: the recursive denylist now names Risu keys, but “CHARX module/code members” remains a prose category rather than exact normalized keys/paths (§7, lines 474–480), so that portion is still not directly implementable.

F8 — RESOLVED: “one upload byte cap … and one decoded-card JSON cap, enforced for EVERY container,” plus CHARX-specific limits (§5.3, lines 348–350).

F9 — RESOLVED: the common agent write path is routed through `edit_config_yaml(..., path=agent.yaml)` for imports and manual edits, providing atomic 0600 writes and safe YAML handling (§7, lines 490–495).

F10 — RESOLVED: §6.4 now specifies one global budget pass, partition after eviction, at most one head and one tail block, and excludes framing from `budget_chars` (lines 424–436).

F11 — RESOLVED: the scan explicitly excludes the just-persisted incoming message from history and adds it once, before the cached head build (§6.3, lines 412–422).

F12 — RESOLVED: S4 now owns the backend extension of `GET /agents` with title, avatar, background, and voice summaries, including the resolved default (§10-S4, lines 684–693).

F13 — RESOLVED: `inference.system_prompt` is explicitly redefined as fallback Voice; duplication is disclosed, release-note/UI help is required, and a golden assembly case is assigned (§4.1, lines 255–263).

F14 — RESOLVED: `off` suppresses both agent and fallback art while retaining gacha’s name plate and scanline with no picture; absent-art fallback is restricted to `operator`/`full` (§8.3, lines 540–564).

F15 — RESOLVED: equality is exact after whitespace-only→empty normalization; comparison uses modal `default_text`, clears only `override`, and preserves `append` (§9a, lines 644–656).

NEW problems introduced by the folds:

1. §4.2 says named examples use the “existing later-system branch” which “re-roles per dialect” (lines 277–280), but that branch currently runs for every provider and unconditionally re-roles later system messages to `user`; the fold must either specify a new dialect-aware change or say they are always re-roled.

2. §11 still says per-agent voice has “silent fallback” (line 717), contradicting F6’s accepted option-A contract that an invalid non-empty voice reports the existing TTS error.

NOT CONFIRMED
```

Main-seat fixes on the four: **F3** — `{{original}}`'s Voice half is the CHAIN's no-card
resolution (`inference.system_prompt` when configured, else the baked default), not the baked
text unconditionally (§4.1). **F7** — the CHARX code carrier is handled STRUCTURALLY: the
reader ingests `card.json` + assets only and never reads the Risu module zip member; the key
denylist (`customScripts`/`triggerscript`/`virtualscript`/`lowLevelAccess`) matches at any
depth of `extensions` (§7). **New-1** — the later-system branch is UNCONDITIONAL: named
examples always re-role to marked `user` with the side carried in the frame; no per-dialect
switch exists or is added (§4.2). **New-2** — §11's stale "silent fallback" wording aligned
to the F6 contract.

### Round 3 — micro-confirm (2026-09-06, resumed session): **F3 · F7 · New-1 · New-2 all RESOLVED — CONFIRMED.**

**The council is CLOSED on this design.** Trail: blind round (BUILD WITH CHANGES, 15 findings,
all accepted) → fix wave folded → confirm (13/15 + 4 residuals) → residual fixes → micro-confirm
CONFIRMED. Awaiting the owner's ratification → D70 (which also lands: the DECISIONS entry, the
CLAUDE.md doc-map row, the TODO phase wiring) → the S0 build brief.

### S0 — the assembly core: BUILT + council-CLOSED 2026-09-06 (same session as ratification)

**Build `786698c`** (Opus 5, pinned brief): the twelve §3.1 fields · `RoleplayCfg` ·
five registry entries (both §4.1a texts VERBATIM, byte-verified by the reviewer; the two
section framings; `persona_intro`) · `macros.py` (~85 lines, reuses the registry renderer
via a new public `prompts.render`) · the session.py head restructure + the three §4.2
emissions · 28 new tests + the 18 invalidated pins re-pinned through one shared `head()`
helper, none weakened. Gate 6/6; BE 2,192→2,225.

**Main-seat audit: all 8 declared deviations ACCEPTED.** The ruling that mattered:
`{{original}}`'s substituted value carries the no-card Voice TEXT + the whole Duties
section (heading included) but NOT a second `## Voice` heading — the §4.1a two-heading
head shape dominates a byte-literal "complete no-card head" (three headings otherwise).
Also recorded: scenario emits unframed (plan names a framing only for the persona) and
sits before the appends; `roleplay.persona.description` is not macro-substituted in v1
*(reversed 2026-09-06, owner's word on field evidence — see §4.3 and the §13-S2 tail)*.

**Blind Emma round (hermes emma lane, sol high, `--ignore-rules`): SHIP WITH FIXES —
exactly 1 MED (conf 0.98), seven areas explicitly CONFIRMED SOUND, open sweep "none"**
(she ran the six focused suites herself, 157 green). The MED, reviewer-traced and
main-seat-reproduced: the placeholder pattern's `invalid` branch ate the leading `{{` of
a 4+-brace run (`{{{{char}}`) and the scan then matched a "valid" token INSIDE what the
owner wrote as one literal blob — half-substituting it, and via `{{original}}` able to
inject a whole no-card head. Ruling exposed a second half she had not asked about:
`_first_only` counted tokens by literal substring, so a `{{original}}` inside a run
stole the once-rule's "first" slot and blanked a REAL token later in the text.

**Fix wave `fc3901d`** (main-seat, leanest form of her own suggestion): lookarounds on
the shared pattern (`(?<!\{)` / named-branch `(?!\})`) — malformed runs survive verbatim,
visibly, the same typo-is-visible rule as a miss; the compiled pattern exported as
`prompts.TOKENS` and `_first_only` re-driven off it (ONE token definition everywhere;
`consumes_original` was already pattern-driven). Triple-brace behavior unchanged and now
pinned. Nine new edge assertions; BE 2,226, pyright/ruff clean.

**Confirm round (resumed session): RESOLVED, MED conf 0.99, new findings NONE** — she
quoted the four satisfying lines, verified the lookahead's named-branch placement leaves
no asymmetric half-consumption (exhaustive 0–7 leading/trailing-brace checks incl.
`consumes_original` × once-rule), and swept registry defaults for reliance on the old
matching: none. **S0 is CLOSED; S1 (greeting + example dialogue + voice resolution) is
next per §10.**

### S1 — greeting + example dialogue + voice: BUILT + council-CLOSED 2026-09-06 (same session)

**Build `cdf2ccb`** (Opus 5, pinned brief): `greeting.py` (one shared seeder — real
assistant turn, `actor=AGENT` + resolved name, macros at seed time) wired to exactly the
two interactive seams (`POST /threads` gains the optional selected agent + thread PIN;
the chat endpoint seeds only AFTER `_auto_route_agent`, before the user's first message
persists; automations/subagents reach it from nowhere — pinned) · `examples.py`
(`<START>` parsing to ST's named-pseudo-message wire shape; no-marker field = one block;
a speakerless block survives as the character's turn where ST silently drops it) · the
one-line normalizer boundary rule (a `name`-carrying system message terminates the
leading coalescing run) · `POST /voice/tts` gains `agent` and `_voice_id` (explicit
voice > agent voice > global chain; NAME not message-id — read-along speaks an
unpersisted reply, recorded as the S4 obligation: the FE must send `message.agent`).
Gate 6/6; BE 2,226→2,248. **Main-seat audit: all 10 declared deviations ACCEPTED.**

**The live probe (the §4.2 S1 verification item) RAN on dev against the real primary**
(qwen3.6/corsair, the strict-template path): pinned thread seeded its greeting rendered
(`{{user}}`→"User"); the reply came back in character, honest under `tools: []` ("I
don't have direct access to check the fleet, so I'm just trusting the vibes!"), no
example-frame echoes; qwen's reasoning landed in its `reasoning` part. Probe agent
deleted (the thread remains — no thread-delete route exists).

**Blind Emma round: SHIP WITH FIXES — 3 MED, sweep "none"** (she cleared the greeting
seams — no double-seed, pinned threads defeat the auto-router, seam ③ structurally
unreachable — the cache lifetime, the boundary rule's blast radius, and the pin
narrowing). **MED-1** (conf 1.0): strict templates render role+content only (R41's
pinned qwen template ignores JSON `name`) — both example sides reached the primary as
identical generic frames, erasing the side distinction. **MED-2** (0.99,
reviewer-REPRODUCED): user-first prefix matching misfiled `Ann:archivist:` lines under
`example_user`. **MED-3** (0.99): `_voice_id`'s `.strip() or None` silently defaulted a
whitespace voice — the F6-forbidden promise.

**Fix wave `b26657d`** (main-seat, leanest forms): the downgraded frame states its name
(`<system-update name="example_user">`, attribute-escaped; hostile-name pin) · longest
resolved prefix wins (identical names stay user-first, pinned as the documented limit) ·
`voice or None`, as-is (whitespace pin). Two of her fix-halves TRIMMED as
over-engineered: the rendered-jinja-template test (the frame IS what the template
renders) and the pre-expansion label-hint fallback (inverts ST's macro-then-parse order
for a pathology with no real-card shape). Rider: httpx → WARNING beside the new
`basicConfig` (journal noise). BE **2,251**.

**Confirm round: all three RESOLVED, BOTH TRIMS ACCEPTED** (her own checks: no
exact-format consumer of the old opener repo-wide; identical names carry no recoverable
side information; named-frame normalization idempotent; empty-name prefixes are `":"`,
never match-everything), **new findings NONE. S1 is CLOSED; S2 (card import) is next
per §10.**

### S2 — card import: BUILT + council-CLOSED 2026-09-06 (third session)

**Build `f6aa640`** (Opus 5, pinned brief): `card_import.py` (~604 lines, pure over
bytes — magic-byte sniffing, PNG `tEXt` walked with `struct`, ccv3-wins, CHARX opening
`card.json` + the chosen icon and NOTHING else, the V1→V2→V3 ladder, the recursive
casefolded strip pass, the slug mint, `land_avatar` through the `UploadPart` ladder) ·
`POST /agents/import` composing the existing writes · the additive `agents` media
namespace row (`avatars`/`backgrounds`, no bundled ids, no slots) · `CardImportCfg`
under `roleplay.card_import` (all five caps config, additive defaults) · **the §7/F9
chokepoint move**: `_scaffold_agent` writes agent.yaml via `edit_config_yaml` +
`sync_mapping` (atomic 0600 · `_yaml11_safe` · comment-preserving · full-replace) for
imports AND the editor's PUT. 46 tests; BE 2,251→2,298; gate 6/6. **Main-seat audit:
all 12 declared deviations ACCEPTED** — headlines: CHARX reads only what v1 consumes
(extras = a counted report line, §5.4's own non-goal); zip caps checked against
DECLARED sizes over every member pre-decompression; the flat V1 mirror ST writes beside
`data` is dropped, not stashed; `probe_image` re-pointed at one shared `_SIGNATURES`
table rather than growing a copy; `character_book` rides the `card` stash until S3's
book import (main-seat S2 ruling — the stash is the permanent provenance home either
way, no dead seam).

**Blind Emma round (hermes emma lane, sol high, `--ignore-rules`): SHIP WITH FIXES —
8 MED · 1 LOW, open sweep "none"** (285 focused tests run by her; sound-checks
explicitly cleared the PNG chunk walk, CHARX/zip64/data-descriptor bounds, strip
coverage — nothing stash-bound escapes it — the avatar ladder + namespace consumers,
and the route's thread-hop containment). Four findings reviewer-REPRODUCED. She ruled
the two main-seat knowns as handed: m1 (avatar/SOUL orphans on a late failure) = LOW
no-fix (no transactionality specified, no data loss); m2 = no finding.

**Main-seat rulings:** 7 fixed lean + **MED-1 (multipart spools before the cap bites)
ACCEPTED as real but DEFERRED to Phase 19** — `voice.stt` ships the byte-identical
cap+1-after-spool posture from a prior review, so this is the app's standing ingress
class (stt + import together), not an S2 regression; tailnet-only, single user.

**Fix wave `6d0711d`** (Opus 5, pinned brief; zero deviations): exact `CARD_SPECS`
discriminator + `_require_name` on every rung + `spec_version` mismatch = warning ·
`_JSON_REFUSALS = (UnicodeDecodeError, ValueError, RecursionError)` at both arms + a
route-level `RecursionError` → 422 (1,100-deep arrays and 5,000-digit ints refuse
instead of 500) · **JPEG-glued CHARX** routes via `is_zipfile` (the field's "JPEG
card"; PNG-glued recorded out of scope) · V3 `nickname` claims `title` (= `{{char}}`),
slug still from `name` · **`_yaml11_safe` quotes KEYS** via `_yaml11_key` at both
key-writing sites (her probe: `{"no":{"on":…}}` reloaded as `{False:{True:…}}`) ·
**`dealias_mapping`** (identity walk, deep-copy on second sighting) wired ONLY into the
agent.yaml mutate — config.yaml anchors and the hosts/integrations/providers callers
untouched · `_V1_BODY` += `scenario`/`mes_example` · strip paths = RFC 6901 JSON
Pointers. +17 tests; BE **2,315**; the builder proof-ran the two chokepoint fixes
disabled to show them load-bearing.

**Confirm round (resumed session): all 8 RESOLVED with line proof · the MED-1 deferral
ACCEPTED (she verified the stt parity herself) · the `deep_set` third key-writing site
ACCEPTED as LOW · diff-introduced problems "none" · 137 focused+adjacent tests green.**

**The live probe RAN on a REAL card (owner-picked: the SillyTavern install's
`Lynette.png`, 727KB, 512×768, a genuine dual-chunk ccv3+chara V3 card): 201 on the
first shot** — the V3 chunk won with the precedence warning in the report ·
name/description/personality/first_mes/alternate_greetings(4) mapped, SOUL 2.7KB ·
14 keys stashed (`spec`/`talkativeness: '0.4'`/`extensions`/… — ambiguous values
QUOTED in agent.yaml, file at 0600, `tools: [web_search]` explicit, `duties:
conversational`, `title: Lynette`) · stripped "none" (a clean card) · the avatar
landed as `agents/avatars/lynette.png` and bound · a pinned `POST /threads
{"agent":"lynette"}` seeded her greeting as a real assistant turn, `actor=agent`,
`{{user}}`→"User" rendered at seed time — the S1 seam working on an imported
character end-to-end.

**Session tail (owner-driven):** the owner's own ST persona ("Ari", the short entry)
was imported into `roleplay.persona` via the Conf settings API — and it surfaced the
S0 hold-out with field evidence: the description opens with `{{user}}`, which ST
renders in personas. **Owner ruling: fold it — `roleplay.persona.description` joins
the macro pass** (`3b63b24`, `_scenario`'s exact idiom + a pinned test; §4.3 and the
§13-S0 note amended; BE 2,316). A fresh Lynette thread now seeds "Ari is sitting
across from me…" and the persona head block renders its own `{{user}}` as "Ari".

**Residuals recorded, none owed now:** the multipart-spool ingress class (stt +
import) → Phase 19 · `deep_set`'s unquoted-key site (schema/slug keys only, LOW) ·
`UploadPart.open`'s bare `FileNotFoundError` on a vanished role dir (the media PUT
shares it) → Phase 19 · the m1 orphan class (LOW, ruled) · `_scaffold_agent(...,
soul=...)` is the cleaner shape whenever S4 touches that path (the write order is
load-bearing, comment-protected today) · an agent literally named `import` is
half-shadowed by the new route. **S2 is CLOSED; S3 (lorebooks, §10-S3) is next per
§10.**

### S3 — lorebooks: BUILT + council-CLOSED 2026-09-06 (fourth session)

**Build `cc1f069`** (Opus 5, pinned brief): the whole §6 subsystem — `lorebooks.py`
(~331: `Lorebook`/`LorebookEntry` with `extra="allow"`, file-per-book storage under
`$CTRLB_HOME/lorebooks/`, the casefold-once `Haystack`, activation + the ONE global
budget/eviction pass + partition, the framed `block`) · `lorebook_import.py` (~312:
the three circulating shapes sniffed off the value, the ruled alias table with
`matchWholeWords` ABSENT ⇒ TRUE, the position-downgrade table with a report line per
collapse — ST 1/`after_char` = the exact landing, no report — and the logic table
0→and_any · 2→not_any · the two ALL variants approximated WITH report) · the CRUD +
`POST /lorebooks/import` routes (cap+1/413 on the new `lorebooks.max_import_bytes`,
`valid_skill_slug`, the `_scaffold_agent` YAML chokepoint idiom — `dealias_mapping`'s
scope note extended to lorebook files as the same full-replace class) · the
`_activate_lorebooks` pre-pass (PRE-persist, Emma F11's no-exclusion-dance form;
head block last among the plain system blocks BEFORE the named examples — the
coalescing-run constraint; tail block just ahead of `post_history`) · the card hook
(`_character_book`: the embedded book rides the SAME importer, lands as
`<agent-slug>-book.yaml`, attaches pre-validation, reports only after the write
succeeds; the stash stays permanent provenance) · `lorebook_intro` appended to the
registry (reference-data framing, the Core-Memory convention) · `LorebooksCfg`
additive, no migration. 40 tests; BE 2,316→2,357; gate 6/6. **Main-seat audit: all
10 declared deviations ACCEPTED** — headlines: `content` defaults `""` (the
empty-render drop rule covers it); `mint_slug` grew `fallback`/`collection` kwargs
rather than a second mint; `selective: false` keeps the secondary keys UNCONSUMED
(activation identical to the source, provenance intact); reports land only after
writes succeed; the resume path re-scans (the ACA-15e class).

**Blind Emma round (hermes emma lane, sol high, `--ignore-rules`): SHIP WITH FIXES —
3 MED (all reviewer-REPRODUCED, conf 0.99–1.00) · K1/K2 both ruled FIX · open sweep
"none"**; sound-checks explicitly cleared matching (no injection/backtracking path),
budget/eviction, placement across every assembly path, the write path, and the card
hook. MED-1 resume window drift · MED-2 book load blocking the event loop · MED-3
unhashable `position` → whole-card 500. Main-seat rulings: all five FIX; MED-1's
prescription trimmed to the ANCHOR rule (last user-role chat message plays the
incoming slot; a drained steer is legitimate turn input, not excluded).

**Fix wave `9ac5289`** (Opus 5, pinned brief; 5-of-6 new pins proven failing on the
pre-fix tree) **+ two main-seat riders:** `769b1da` — the resume anchor engages on
an EXPLICIT `resume=True` flag, never on "the text is empty" (an attachment-only
send reaches `run_turn` with no text and is a TURN START; the wave's sniff would
have re-framed the previous turn's message as incoming) · `39237be` — the confirm
round's reproduced residual: the anchor now admits attachment-only user rows (a
user row with NO TextPart is still the turn boundary), the window is the
`scan_depth` TEXT-BEARING rows before it in the turn start's own `[incoming,
*prior]` order — the rebuilt haystack is BYTE-IDENTICAL across a suspend, which
also closed the sweep's concatenation-order LOW. BE **2,365**; gate 6/6 throughout.

**Confirm round (resumed session): 4/5 RESOLVED with line proof + the anchor trim
ACCEPTED + the rider's flag ruled correct on every entry point — MED-1's
attachment-only face NOT RESOLVED (her direct repro) → the `39237be` rider →
micro-confirm: RESOLVED, all three bad shapes re-probed by her through the REAL
seams (attachment-only turn · attachment-only steer via the Drain-A claim path ·
greeting-seeded thread with an attachment-only first turn — all PASS, byte-equal),
diff sweep "none" — SHIP.**

**The §6.7 live probe RAN on the owner's real book (the ST install's
`Simple Personality Traits.json`, 40 entries · 36 secondary-key gates): 201 on the
first shot, ZERO warnings** — every entry position 1 → `head` silently (the exact
landing), every `selectiveLogic: 0` → `and_any` cleanly, `matchWholeWords` absent →
true, priorities carried, 16 field-classes stashed verbatim (`depth`, `probability`,
`extensions`, …). Landed as `personality-traits` (0600, YAML-1.1-quoted, 38KB) and
**ATTACHED to Lynette on dev via the editor PUT** — the S7 device round finds it
live; a trait word in chat triggers it. **The ACTIVATION chain was then proven live
too (owner ask at session close): a canary probe book (key `zanzibar` → "the
passphrase is CRELLOFAX") was attached beside it, one real chat turn on the trigger
word made the model answer CRELLOFAX — a fact that exists ONLY in the lorebook — and
the probe was cleaned up (book deleted, attachment restored). Scan → activation →
framed head block → wire → live model, end-to-end on dev.**

**Residuals recorded, none owed:** genuinely user-less histories degrade the resume
window to empty-incoming over the plain tail (best-effort, documented) · float
positions (`1.0`) now take the unknown-position warning where pre-fix they hash-hit
the table silently — honest, recorded here · the multipart-spool ingress class
covers `/lorebooks/import` too (Phase 19, the standing K3 posture). **S3 is CLOSED;
S4 (the agents surface, §10-S4) is next per §10.**

### S4 — the agents surface: BUILT + main-seat AUDITED 2026-09-07 (fifth session) — ⚠ the blind Emma round is OWED (the next session's first move)

**Two pinned Opus builds, five commits, gate green throughout** (the slice split BE-half-first
per §10-S4/F12, then the FE in two coherent halves):

**Build 1 — `e6cd1d9` (BE) + `52eb52f` (FE chat half).** `GET /agents` gains `summaries`
(title · description · avatar · background · voice; EVERY agent incl. the root default; one
`to_thread` hop; a specialist that fails to load degrades to a name-only row + WARN rather
than 500ing or vanishing — `resolve_agent`'s posture applied to a list; the resolved default
is `setdefault`-ed in) · `PromptDef.group` + the closed `PROMPT_GROUPS` vocabulary, emitted
by `GET /prompts` (30 entries labelled; declaration order stays the ONE ordering authority) ·
`hooks/useAgentArt` = the ONE summary-map × media-index join (W9 identity via
`entryId`/`rowId`, the shipped `shown`/`orderedUsable` predicates; a function resolver, not a
per-bubble hook) · picker avatars (ADDITIVE beside the tick — the swap semantics are §8.5's)
· the who-line avatar swap in the dot's exact position (class-suppressed `::before`, plain
`object-fit: cover` at ~18px — `FocalImg` would cost a ResizeObserver per bubble on an
unvirtualized log) governed by the synced `chatAvatarsVisible` Appearance switch (default ON;
OFF ⇒ no resolver handed down, zero cost) · `agent` on every TTS request, carried on the
SESSION so chunked reads keep one voice; null omits the field (the server's absent⇒default
chain IS the contract); the live streaming bubble carries its agent from the stream seed
(`store/chat.ts` `emptyAssistant(id, agent)`), so the S1 unpersisted-reply obligation is
truly closed. **All 4 declared deviations ACCEPTED** (the synced toggle's additive BE
appearance field — no migration; the `voice & duties` group name; the additive picker circle;
the closed vocabulary). The frontier who-line being live is CONFIRMED intentional (ruling
18's carve-out is the §8.3 backdrop; frontier renders the shared ChatThread). The always-on
`["media","agents"]` observer is accepted (F12's shared read; the gallery wants it) — Phase
19 register if it ever measures.

**Build 2 — `a191839` (the gallery section) + `5e4e0e0` (fields + Conf groups) + `b84e39e`
(import UI + §9a).** The agents gallery as its OWN section (`agents` TabDef, lazy body;
OFF-BAR under all three presets — the ruled Axis-A fall-through renders it as a direct docked
appbar button, keeping the layout pickers' literal "N on the bar" labels true) · 2-col card
grid at 390px, `FocalImg` + focus, initial-tile placeholder, default-first · tap = in-place
detail swap to the SAME `AgentRow` form (no second form, no overlay machinery) · TALK pins
via the extracted `pinSessionAgent` (the `/agent` verb's own seam) + navigate · Conf keeps
ONLY the `agent.*` globals (`AgentGlobals`), no duplicate list · the §9 marked fields on the
form under the per-field predicate (`roleplay.enabled` OR populated; duties always;
`alt_greetings`/`lorebooks` round-trip only; `card` = a read-only stash line), persistent
one-line help per field · the `agents` MEDIA_NS row (alwaysOn; both roles FULL_ART, framable,
avatars aspect 1 with one square preview, backgrounds 9/16; NO active resolver and NO slots —
bindings on the AGENT decide, the gallery says nothing about "in use") · avatar/background
binding rows driving the untouched `useImageJob` machine through `useMediaUpload`'s new
`onStored` hop (fires only on `written`) · Conf `roleplay` group (enabled · default_tools ·
persona) + `lorebooks` numeric globals (`books` editing deferred to S5 with the picker) · the
import UI on the gallery header under `roleplay.enabled` (`postForm` = the app's one
multipart POST; the shared `refuse()` dedup — three pre-existing copies folded), the report
INLINE with warnings leading, errors via the mutation toast with the server's detail · §9a:
the modal pre-fills the shipped default muted-until-edited, the freeze trap closed at the
SAVE end (`foldEqualDefault`: exact equality after ONLY the shipped whitespace-only→empty
norm — F15 honored; equal base clears only `override`, `append` survives; the two-fact
design also folds a hand-retyped default) · the customized accent (tcat-mod border) · grouped
sections derived from the API's row order, unplaced rows trailing title-less.
**All 9 declared deviations ACCEPTED** — headline rulings: the off-bar placement; the inline
report; the `LongField`/`refuse()`/`useAgentToolGrid`/`pinSessionAgent`/`useRoleplay`
extractions (each killed a duplication or an import cycle); the Conf renumbering 15–23; the
e2e premise changes recorded honestly (gacha's appbar ~43→~50px — the docked nav action now
exists in every layout; bar-less chrome takes the 34px launcher inset).

**Gate at tip: 6/6 green — BE 2,372 (+7) · FE 2,954/173 (+32/+4) · local e2e 319 passed
(both projects, incl. the new gallery spec)**; counts in QUALITY.md; the main seat re-ran the
full gate independently at the tip. Dev backend restarted onto `b84e39e`; both dev units
RUNNING (:5434 + :5173) for the owner's poke.

**OWNER-FEEL items riding the owner round (not defects):** the gacha appbar height (+~7px)
and the bar-less-chrome scroll inset (10→34px) from the always-present docked nav action —
exits recorded (slimmer docked variant, or on-bar + preset renames) · the import report does
not persist across a tab switch (re-import re-renders it) · toast-verbatim import errors.
**Recorded residuals:** eslint backlog 72→97 (F13-attributed in QUALITY.md) · the
crop→upload→bind round trip is pinned only at the `onStored` hop (the machine itself keeps
its own suite); a real-card import through the UI = S7's device round.

**⚠ THE SLICE IS NOT CLOSED: the blind Emma round (R46 brief, `--ignore-rules`, the five
commits `e6cd1d9`..`b84e39e` against plan §8/§9/§9a/§10-S4) + fix wave + confirm are the next
session's FIRST move** (the S1 precedent — build+audit one session, review the next; ruled
here for context discipline, the owner's standing handoff directive). The ⚠ S4 TTS obligation
is MET pending her verification; S5 still owes the collapsed-entry lorebook editor (§6.6) and
the `lorebooks.books` global editor.

#### S4 addendum — the §8.4a SATELLITE PLACEMENT fold (2026-09-07, sixth session; the owner's opening correction)

**The owner's word opened the session:** "its own section" meant INSIDE settings, not a
separate always-present surface — hidden by default like the tools tab, selectable to show;
then (round 2) a deep design pass generalizing to future sections (lorebooks named); then
(round 3) the three rulings: three placements with never-in-two-places degradation · bar slot
after chat · a minted Japanese sub-label. **The full design road ran in-session:** the code/
docs probe (one data-driven bar renderer; the docked button = TOP appbar vs the bar = BOTTOM;
Material 3's 3–5-destination cap) → **§8.4a written as the spec** → **blind Emma DESIGN round
(sol high, `--ignore-rules`, R46 brief): SHIP WITH CHANGES — 0 HIGH · 3 MED · 2 LOW, sweep =
the scroll-cache MED only; all five accepted + folded** (MED-1 scroll-cache keys · MED-2 Conf
tail numbering · MED-3 the dangling `tabbtn-agents` label — a LATENT S4 DEFECT — · LOW-4 the
exclusivity integration guard · LOW-5 the honest lorebooks recipe), MED-1/MED-3 citations
main-seat-verified against HEAD → **confirm round (resumed): all five RESOLVED, sweep "none"
— RESOLVED — SHIP** (rider folded: the composition key is a stable semantic string). Design
committed `b0dd5f5`; D35 carries the satellite-sections addendum.

**The pinned Opus build landed as `d944022` + `fef61c1`** (mechanism/control/copy/geometry +
tests · the e2e rider reverts + placement arms). As specced: `composeLayout` pure in
`layout.ts` (+ `SATELLITES`, `SECTION_PLACEMENTS`, `resolvePlacement`, derived
`HOSTED_GROUP_IDS`) · `ui.sectionPlacement` device-local, healed at read · both DefaultRoot
effects keyed on the semantic `placementKey` · the aria fix on the standalone panel + both
lazy fallbacks · `AgentsContent` extracted (UtilsContent precedent), the hosted
"Agents · gallery" group, the ordered-`hostedTail` numbering, the extended scroll guard, the
Appearance "Agents" Seg rendering the RESOLVED value · `tabAgents: "キャラ"` (ONE new glyph
ャ; six JP subsets +~1.2 KB, Latin files byte-identical; fonts regen committed) · the
`--tab-crowded` 5-up label step (4-up resolves to the old literals — today's bar
byte-identical) · the two S4 rider geometries back to conditional (they were e2e pins, not
CSS — gacha ≤46px, `off` inset 10 by default; a new arm pins the button-placement half).
**All 6 declared deviations ACCEPTED** (headlines: `SectionPlacement` types in `types.ts` —
the store must not import the registry-reading layout module; healing at
`resolvePlacement`, the `resolveLayout` precedent, NOT a second validation site in the
store; splice appends when the anchor is off this preset's bar — a promotion never silently
vanishes). **Gate 6/6 — FE 2,980/174 · e2e 159 (mobile project) · 360px screenshots clean in
kit/frontier/gacha (キャラ renders in the frozen face; worst slack 7.7px, gacha "SETTINGS").**

**Recorded residual (Phase 19 register):** the MED-3 class is WIDER than agents —
`UtilsTab`/`ConfTab`/`AgentTab` and the bespoke fleet bodies all hardcode
`aria-labelledby="tabbtn-<id>"` and all can be off-bar (conf in 2-tab, everything under
`minimal`); the a11y specs can't see it because they reach panels by clicking tab buttons.
§8.4a fixed only its own scope.

**The §13-S4 owner-feel riders are CLOSED by this fold** (their premise — an always-present
docked action — is gone; the geometries are conditional again and pinned in both states).
**The blind Emma CODE round now covers the widened span `e6cd1d9`..`fef61c1` (7 commits)
against §8/§9/§9a/§10-S4 + §8.4a.**

#### S4 code round + fix wave (2026-09-07, same session) — the cadence is COMPLETE; the owner's word is the remaining gate

**Blind Emma CODE round (fresh session, sol high, `--ignore-rules`, R46 brief, the widened
7-commit span): SHIP WITH FIXES — 0 HIGH · 3 MED · 0 LOW, open sweep "none"; two findings
reviewer-REPRODUCED** (a live 360px boot with `sectionPlacement: null` · a malformed
configured-default probe against the real route) **and she ran 363 FE + focused BE tests
herself. All eleven seeded areas otherwise explicitly SOUND** — the summary map's degrade,
`useAgentArt` as the sole art resolver, **the S1 TTS obligation verified on every request
shape**, the gallery's two verbs, §9a's freeze-trap close, the satellite mechanics ("no
other reachable two-place state found"), the Conf tail, CSS/aria, the キャラ chain, the
S0–S3 seams, and — her explicit check — **no test weakened for green**.

**The findings, all main-seat-verified and ruled FIX (lean forms):** MED-1 (0.99) —
`ConfTab.tsx:907` deref'd the RAW persisted placement map that `composeLayout` deliberately
guards; a persisted `null` bricked the default Conf view · MED-2 (0.99) — the
`_list_agents_payload` tail's `resolve_agent(None)` re-loaded a malformed CONFIGURED default
unguarded, 500ing the route the loop had just degraded gracefully for · MED-3 (0.94) — the
settings-save success block never invalidated `["agents"]`/`["agentlist"]`, so root-default
and `default_agent` saves left the always-on roster stale.

**Fix wave `d4dd1ef`** (Opus 5, pinned brief; every fix with a FAILING-BEFORE proof):
`sectionPlacement?.agents` at the reader (the map-guard is the reader's job —
`resolvePlacement` stays the one value-healing seam; the only other raw deref repo-wide is
the guarded `composeLayout` hand-off, and the spread at ~3018 self-heals) · the route tail
try/except'd with the loop's own posture (`default` = the configured name when its degraded
row exists, else the root default; BOTH arms pinned, incl. the unlisted-folder branch) ·
`invalidateAgents` exported and CALLED from the settings-save block, subsuming the SYS-9.2
`loadAgents()` line. **One deviation, ACCEPTED:** reuse means `["actions"]` also invalidates
on a settings save — the `useToolOverrides` precedent does exactly that on the same
endpoint. Gate 6/6 — **BE 2,373 · FE 2,982/174** (QUALITY.md updated).

**Emma confirm (resumed): all three RESOLVED with line proof · diff sweep "none" —
RESOLVED — SHIP** (she re-ran focused suites: BE 6 + FE 16 green).

**S4 status: the full standing cadence is COMPLETE** (2 pinned builds + fold build + fix
wave · 2 main-seat audits + fold audit · §8.4a design round + confirm · the blind CODE
round + fix wave + confirm). Dev backend restarted onto `d4dd1ef` (summary map live:
default + lynette); both units RUNNING (D69 observation continues).

#### THE OWNER ROUND LANDED (2026-09-07, same session, in conversation) — "it looks good" + two fix findings + one deferral; S4 closes AFTER their fix wave

- **OF-1 (FIX):** a DROPDOWN list renders with essentially NO padding — its options "almost
  crop to the edges of the screen." The owner did not pin which control; it surfaced on the
  new agents surface round, so start there (the agent form's selects / the gallery context)
  and pin the exact control + whether the class is app-wide before fixing.
- **OF-2 (FIX + APP-WIDE SWEEP, owner-directed):** a GRADIENT button — the owner believes
  the selected agent's SAVE button — shows weird SOLID-colored "rims" at its left and right
  edges. The owner: "we had an issue like that before" — so this is a recurring CLASS, not
  an instance. The fix wave must (a) find the precedent (memory / ISSUES / git history for
  the earlier gradient-edge fix and its mechanism), (b) fix the button, and (c) SWEEP the
  app for every gradient button whose left/right edges can land on solid color, closing the
  class the way the precedent ruled.
- **OF-3 (DEFERRED, owner-ruled):** the layering/composition of the text + text fields +
  dropdowns could be "revised and refined a little" — explicitly a FUTURE PASS of its own;
  do not fold it into the fix wave.
- **⚠ OPS: the Emma lane is UNAVAILABLE (owner's word, 2026-09-07)** — the OF fix wave runs
  build + main-seat audit; her review rounds resume when the owner says she is back.
- **The ruled sequence:** the owner stopped the session here for a clean handoff. **The next
  session opens on the OF-1/OF-2 fix wave** (pin → precedent → fix → sweep → gate) → the
  owner's confirm on dev → THEIR WORD closes S4 → **S5** (lorebook FE: manager + attachment
  picker + the §6.6 collapsed-entry editor + the `lorebooks.books` editor) — the owner asked
  that S5 not start before they are back home.

#### THE OF FIX WAVE (2026-09-07, seventh session — Emma back per the owner's word, so the wave ran the FULL cadence; council-CLOSED, awaits the owner's dev confirm)

**The pin (OF-1).** No agents-only divergence exists: every dropdown on the agents surface is a
native `<select>` under the ONE shared recipe (`kit.css` `.kit .mconf .mform input, … select` —
`all: unset` + padding on the SELECT), and **no `option` rule existed repo-wide**, so every
popup's rows rendered with essentially no insets. Worst case = the provider/model picker
(`ProviderModelPicker.tsx`), whose 20–30-char mono ids make the popup near-viewport-wide at
360px with text flush to the edges. The class is app-wide (machines · agents · Conf ·
automations · the provider/model pair). **Ruled fix: ONE app-wide `.kit option { padding: 8px
10px; }`** beside the recipe — the metric is the app's own popover option-row recipe
(`.kit .kit-suggest li`). Recorded honestly in the rule's comment: it lands on DESKTOP popups
only; an OS-rendered mobile picker ignores option padding and carries native insets, so the
phone's native dialog was never the broken rendering. If the owner's round still shows a bare
list, the fold-up is the `.priv-menu` popover-listbox pattern riding the deferred OF-3 pass.

**The precedent (OF-2) — found, and it is the owner's own words.** Commit `57e106a` (the gacha
dossier act, 2026-08-02): *"pink one side, violet the other."* Mechanism, third occurrence of
one class: `background-origin` defaults to padding-box but `background-clip` to border-box (+
repeat), so a gradient is laid out to the padding box then TILED across the border strip — the
left strip renders the ramp's LAST stop, the right its FIRST; `border-color: transparent` makes
them read as two solid rims. The ruled fix is the precedent's: `background-clip: padding-box`
(also the D54 kit-banner fix, e2e-gated). The reported button is `kit.css` `.mconf .mfoot
button.save` (the agents/machine detail SAVE — a long-standing rule the S4 surface finally put
in front of the owner; the S4 commits added no gradient controls).

**The sweep + build (pinned Opus, `9f6b597`).** Clip added to SEVEN sites (each with the
mechanism named in a one-line comment): kit `.mfoot button.save` · kit `.conf-save` · kit
`.tick-grid .tick.on` · kit `.switch.on .knob` (gacha immune — its knob sets `border: 0`) ·
cosmos `.hd-act.primary` (own literal gradient) · vapor `.plan-pin-head` · vapor `.summary`
(non-interactive, swept as class closure, marked as such). Untouched as ruled: the two
precedent sites, and frontier's `.mconf .mfoot button` flatten (it masks the class under
frontier — but its own comment says it targets "the fill-less ones", and `.save` IS filled, so
the flat primary is collateral → **recorded as ISS-12**, an owner look ruling, deliberately NOT
folded in). **Guard:** `tests/themes/gradientRim.test.ts` — a source pin in the gachaChrome
style over the swept sites PLUS both precedents, so the thrice-bitten class stays closed from
both ends. One build deviation, ACCEPTED (the gradient predicate widened to `gradient|-fill` —
the precedents fill via `--gc-dossier-act-fill`/`background-image`). Main-seat audit: diff read
line-by-line; declaration order verified per block (a `background:` shorthand RESETS the clip);
theme-layer override probe clean (gacha's knob shorthand re-set is border-0-immune; frontier
replaces the fill entirely); **the full gate independently re-run: 6/6**.

**The blind Emma round (back per the owner's word): SHIP WITH FIXES — 1 MED · 1 LOW, open
sweep "none"; she ran the new spec herself (9/9)** and explicitly cleared: OF-1 reaches every
native dropdown the app renders (no `multiple`/`size`/`optgroup`/`datalist` cases); all seven
clip sites effective in the live cascade; the guard's nine cases non-vacuous; no objectionable
metric change. **MED (conf 0.98): gacha's ONLINE ribbon** `.gc-card .state.on` missed by the
sweep — the 92deg `--gc-online-fill` over the base `.state`'s 1px border, transparent: the
exact pair, the rounded left cap tiles the far stop. Main-seat verified in-code; the other
`--gc-online-fill` consumer (`.po-chip`) checked borderless → immune. **LOW (0.99): the guard
pinned the clip's presence but not its position** — a shorthand APPENDED after it would reset
the clip with the test still green. **Both ruled FIX → main-seat rider `90a7664`** (the
`b5974f5` class): the ribbon clipped + added to SWEPT (10 cases); the guard now also asserts
the last `background:` shorthand precedes the clip per block (no-shorthand blocks pass via
lastIndexOf = −1). **Her confirm (resumed): both RESOLVED with line proof · `.po-chip`
immunity ruled sound (one description correction: asleep = inset shadow, busy removes it) ·
the ordering assertion's lexical modes named and accepted as non-operative under prettier ·
open sweep of the rider "none" — RESOLVED — SHIP.**

**State:** gate 6/6 at `90a7664` — **BE 2,373 · FE 2,992/175** (counts in QUALITY.md). FE-only
wave; :5173 serves it live. **OF-1 + OF-2 are BUILT + council-closed; OF-3 stays deferred;
ISS-12 (frontier's flat save) awaits an owner ruling. The owner's dev confirm on these two,
then THEIR WORD closes S4 → S5.**

#### OF-1b — the owner's confirm round RE-PINNED OF-1 (same day): the real defect was the standalone cards' FULL-BLEED, not the option list; fixed `02cc5c4`, council-closed

**The round:** OF-2 confirmed good everywhere; but "the add-agent dropdown still has no padding
when [the section] is its own tab — it goes up to the sides; it looks good inside the
configuration." All owner reports are FROM THE PHONE (their standing default, restated this
round). **The main seat could NOT reproduce the option-list theory blind** — Playwright over
both placements showed the page CSS identical (option padding present everywhere) and a headed
360px popup rendering fine — and the owner's wording re-pinned the control: the **ADD-AGENT
disclosure card**. Measured: `.agal-actions` spanned **x:0 w:360** in the tab placement (the
detail card and `.agrep` likewise) while the grid sat at 16px — because only the Conf-hosted
`.confgroup` ever supplies an inline margin (18px), which is exactly why the same card "looks
good inside the configuration". The S4 build missed the standalone page inset; the `.util`
pair (kit.css ~5632-5646, "the host owns the inline inset") is the in-file precedent it
should have followed.

**The fix (`02cc5c4`, main-seat):** the precedent verbatim — `margin-inline: 16px` on
`.agal-actions`/`.agal-detail`/`.agrep` (16 = the gallery grid's own inset, one shared left
edge) + the `.confgroup` host-zeroing pair. Measured both ways: standalone cards+grid both at
x:16 w:328; hosted UNCHANGED (cards 18, grid 34). The placement=button e2e arm now pins the
standalone inset (x > 0 AND x === grid.x). The `9f6b597` `.kit option` rule STAYS — a real
desktop-popup papercut, just not the owner's symptom; this block corrects that attribution.
The "owned listbox" fold-up idea is WITHDRAWN — with the true cause fixed, native pickers
stay.

**Emma micro-round (resumed): findings NONE — RESOLVED — SHIP** (chokepoint confirmed
complete: exactly three standalone `.conf-card` variants exist and all are covered; cascade
safe — the sibling `margin-top: 10px` intact, no theme overrides; the e2e non-vacuous — a
missing element nulls and fails; she ran the focused Playwright arm herself, 2/2 both
projects). Gate: FE check-all exit 0; **FE e2e arm green** (BE untouched). **The owner's
phone glance at the agents tab (cards now inset) is the remaining confirm; their word closes
S4 → S5.**
