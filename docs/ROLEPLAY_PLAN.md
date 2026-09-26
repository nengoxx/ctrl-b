# Characters are agents — the conversational-agents + lorebook plan of record

> **Status: ✏️ DESIGN v2 — RATIFIED 2026-09-06 ([`D70`](./DECISIONS.md); owner, in
> conversation). COUNCIL-CLOSED same day (§13: blind Emma round BUILD WITH CHANGES → all 15
> findings folded → confirm → micro-confirm CONFIRMED). BUILD = S0–S7 per §10: S0–S6 (incl. the
> S6b backdrop round and its three waves) are ALL BUILT + council-closed, per-slice records in
> §13; S7 — the owner device round — ran in part on 2026-09-11 and its remainder now rides the
> owner's REGULAR USE by their ruling (§10-S7). S8 (D78) built 2026-09-26. SHIPPED in v1.7.8 (2026-09-26).**
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
   by the name — that's pretty much it"). *(D78, 2026-09-26: personas became a LIBRARY — the chain
   is `agent.persona` → `roleplay.default_persona` → `"User"`, one resolver, §14.1.)*
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
persona: str = ""                   # D78: the OWNER's persona this agent talks to — a slug in
                                    # roleplay.personas (NOT the agent's SOUL); "" → the default
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
# (no `card` field — REMOVED 2026-09-26 by R87/RP-8: an imported card's provenance is the
#  `agents/<slug>/card.json` sidecar, §5.3; a stale `card:` key in an older file loads as an
#  inert extra)
```

The UI never groups these into a "Character" pane (ruling 1) — they are ordinary agent fields
with the §9 marking. Card fields that do NOT land here: `name`→slug/`title` ·
`description`+`personality` (+card `system_prompt`)→**SOUL.md** (the Voice; R64 §4.1: the
field's own default card puts everything in `description`) · `creator_notes`/`tags`/`creator`/
`character_version`→`card.json` only (spec: MUST NOT reach the prompt) · `character_book`→a
lorebook file, auto-attached · avatar→the media library + the `avatar` binding. **Every** card
field — mapped ones included — is also kept whole in the `card.json` sidecar (§5.3).

### 3.2 Config

```yaml
roleplay:
  enabled: false                # Conf toggle — UI visibility only (P2)
  default_tools: [web_search]   # the explicit allowlist written to new/imported characters (§5.5)
  personas:                     # D78: the OWNER's persona LIBRARY, {slug: {name, description}}
    ari: {name: "Ari", description: "…"}   # name → {{user}}; description → its own head block
  default_persona: "ari"        # slug; "" → none. An agent's own `persona:` link wins over it

lorebooks:                      # the subsystem's globals (§6) — roleplay-independent
  books: []                     # globally-attached book slugs (any agent, every turn)
  scan_depth: 2                 # messages of recent history scanned (ST's shipped default)
  budget_chars: 4000            # activated-entry budget; eviction per §6.4
```

All additive with defaults ⇒ **no config migration** (the D68 precedent) — *except the D78
persona library, which replaced the one global `roleplay.persona` + `AgentDef.user_name` through
config migration step 5 (§14.1 A5).*

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
framings). **`{{original}}` semantics — field-specific, per the V2 contract (Emma F3; AMENDED
2026-09-26 by R87/RP-1):** the spec defines it as "the prompt the frontend would have used in
the absence of a character `system_prompt`" — in the field that is the OPERATOR's own framing
(ST's "Write {{char}}'s next reply…"), never an assistant identity. So in the persona/SOUL text
it substitutes **the owner's configured `inference.system_prompt`** (rendered, with its own
`{{original}}` blank), **else nothing**; the **Duties section is ALWAYS emitted as its own
section** (it already IS the operator text under P3) — substituted once at its FIRST
occurrence, later occurrences render empty (`safe_substitute` replaces all, so the once-rule
must be explicit). *Superseded:* the original design substituted the complete no-card head
(the baked "You are ctrl-b…" Voice + the Duties section) and let the token CONSUME the separate
Duties emission. R87 found that a card's `system_prompt` opens with `{{original}}` by
convention — 14 of the owner's 36 system-prompt cards, every one at offset 0 — so every such
character was filed under `## Duties` behind a homelab-assistant Voice. `consumes_original` and
`_no_card_head` were deleted with it (no dead seams). In `post_history` it substitutes ctrl-b's
default post-history
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
- **User persona** (§3.2) — one head block after the roster when the RESOLVED persona's
  `description` is non-empty (`resolve_persona`: the agent's own link → `default_persona`, D78),
  introduced by the registry label `persona_intro` — a noun label with no authority claim either
  way (the D70 framing amendment). For every agent: the persona is who the OWNER is.
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
  nothing here; the as-imported restore is what the `card.json` sidecar (§5.3) makes possible.

### 4.3 Macros

Reuse `_Placeholders` (R32; leave-literal-on-miss). v1 vocabulary: `{{char}}` (title or name) ·
`{{user}}` (the resolved persona's name → `"User"`, D78) · `{{original}}` (§4.1). The pass
runs over: SOUL.md, greeting(s), example dialogue, scenario, post_history, lorebook keys +
content, and the persona's `description` (the S0 hold-out, reversed 2026-09-06 on field
evidence — the owner's real ST persona opens with `{{user}}`, which ST renders there; in one's
own description it reads as the persona name). It runs for every agent (the universal assembly)
— safe because unknown/unmatched
tokens pass through literally, so existing SOUL.md text without macros is untouched.

**Amended 2026-09-26 (R87/RP-2 + RP-3), two pre-passes in `Macros.render` only:** (1) a
vocabulary name in ANY ASCII case (`{{Char}}`, `{{USER}}`) folds to its canonical spelling —
the field resolves names case-insensitively (ST lower-cases before the lookup; CCv3 SHOULD) and
10 of the owner's 168 cards write `{{Char}}`/`{{User}}`. The registry grammar stays `NOFLAG`
(ASCII-only identifiers), so the fold cannot bind a Unicode look-alike (`{{uſer}}` stays
literal). No `<USER>`/`<BOT>` aliases (0 in the corpus). (2) `{{// …}}` author comments render
as nothing, ST's own rule (non-greedy, multi-line, first `}}` closes); an unclosed `{{//` stays
visible. Everything else outside the vocabulary still renders literally — but the card AND book
importers now add ONE report line naming those macros (`{{random}}`, `{{time}}`, …), so a card
built on them says so at the door. The feature macros themselves (`random`/`pick`/`time`/`date`)
are NOT built (a feature, not a fix → ISSUES).

## 5. Card import

### 5.1 Surface

`PUT /api/agents/import` (raw body — *amended from multipart POST by the §13 import-rail
addendum, D72/R73: a multipart POST is a no-preflight cross-origin write*). One new endpoint that **composes the existing
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
description+personality only, and all three fields with `{{original}}`. **The WHOLE normalized
card lands in `agents/<slug>/card.json`** — the field's own envelope, `{"spec":
"chara_card_v2"|"chara_card_v3", "spec_version": <as declared, else the rung's>, <the envelope's
own unknown keys>, "data": …}` (a V1 card is written as V2, ST's own upgrade; the R87 review's
O-8), mapped fields, unknown fields, `extensions` and `character_book` alike, verbatim **after the
strip pass** (§7) — the spec's preserve-unknowns MUST, and the as-imported restore point + export
source. **Unknown ENVELOPE fields stay at the envelope level** (R89/E-4): a key that sat beside
`data` (a vendor signature, ST's V1-mirror metadata) is kept beside `data`, never folded into it,
so an export can return every field to the namespace it arrived in; a flat V1 card has no
envelope, so all of it sits under `data`. Strip pointers address the uploaded file exactly
(`/data/extensions/…` for a V2/V3 card field). Written
0600 through the house atomic writer, in the same hop as the SOUL and the book, after the agent
validates; nothing ever edits it. *(Amended 2026-09-26, R87/RP-8 + RP-13: it used to be a
`card` stash inside `agent.yaml` holding only the UNMAPPED remainder — so once the owner edited
a SOUL or a greeting the card's own values existed nowhere, SOUL's three fused fields could not
be separated back out, and every embedded book was stored twice and re-parsed on every agents
listing and turn.)* **The report says what was ACTED ON (R89/E-5):** `fields_mapped` lists a
field only when it landed something (a present-but-blank field is not mapped), plus V3's
`nickname` (→ the title), a CHARX `assets` icon that became the avatar and a `character_book`
that became an attached book; `stashed_keys` lists everything else the card carried, card- and
envelope-level alike — kept only in `card.json`. **A card that defines no persona at all**
(no `system_prompt`/`description`/`personality` — e.g. only a first message) gets the registry's
`card_blank_soul` (`You are {{char}}.`, token kept literal on disk, rendered at assembly) as its
SOUL.md, never the baked assistant identity the ordinary new-agent scaffold lays down (R89/E-1).
**Concurrent imports are serialized** (R89/E-2): one route-level lock per collection an import
mints into (agents · lorebooks; a card import holds both, agents first), held across the whole
read-names → mint → write hop — the `settings_write_lock` precedent — and held until the worker
THREAD ends even when the request is cancelled (`_import_locked`: the section runs as its own
shielded task, `CoreMemory._guarded`'s shape; the R89 confirm round's cancellation hole). **Size caps (Emma F8):** one upload byte cap on the request body and one
decoded-card JSON cap, enforced for EVERY container (the existing cap+1/413 posture); CHARX
additionally keeps its per-entry / asset-count / total-uncompressed limits. Name→slug: the agent-name
grammar, collision-suffixed. Imported agents default `duties: conversational` (ruling 2 — cards
are companions; the toggle flips any of them to full duty). **`AgentDef.description` (the
auto-router's "when to pick me" text) stays EMPTY on import** (coverage audit): the card's
description is persona prose, not routing copy — an imported character is reached by explicit
pick, never auto-routed to, until the owner writes a routing line themselves. Export is NOT
v1: `card.json` + Agnai's stale-stash comparison (R66 §9) are the recorded seam, so v1 loses
nothing. Note what imports FREE: `AgentDef.model` already exists per agent, so a character can
pin its own backend/model (e.g. an RP-tuned model) with zero new machinery — the editor simply
shows the existing picker beside the new fields.

### 5.4 The avatar

Decoded, probed by the existing `core/media.py` stack (closed type allowlist, magic-byte
verified), written into the `agents/avatars` library via the media write path, and bound via
`AgentDef.avatar` (§8). A PNG card's `chara`/`ccv3` text chunks (`tEXt`/`zTXt`/`iTXt`,
keyword casefolded) are removed WHOLE before it lands (R87/RP-4, 2026-09-26): they are the
entire unstripped card, and the avatar is an ordinary served file. Import succeeds without an avatar; an invalid image degrades to a
report line, never a whole-card refusal. V3 multi-asset routing (sprites/emotions/user icons —
R66 §2.4) is a non-goal: extras stashed/ignored with a report line.

### 5.5 Tools

The importer writes `tools: roleplay.default_tools` **explicitly** — never the `"*"` default
(R66 §4: no card format has a tools field; our default is the widest value, so relying on it
would invert ruling 8), and `skills: []` beside it (S9, ISS-26 (i) — under `"*"` the keyword
selector could inject a tool-agent skill body into a character's head). `privilege` stays CONFIRM.
**The editor writes it on the duties flip (S9, ISS-23, §15.6):** flipping a specialist's duties to
`conversational` while its `tools` is still the wildcard `"*"` sets the draft's `tools` to
`roleplay.default_tools` — visible and editable before save, never over an explicit list, never on
the default agent's form, and transition-only (a character already sitting at `"*"` is not
rewritten behind the owner's back).

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
most one framed tail block** (framing = the registry label `lorebook_intro`, a noun label that
claims no authority either way — the D70 framing amendment, R90: a book may hold facts or
instructions, and the gate in code is the boundary, not the text; framing chars
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
report line for every downgraded entry, never a silent coercion. **A card-embedded book ST
wrote carries its real values under `extensions`** (`convertWorldInfoToCharacterBook`: the top
level holds only the before/after squash of `position`), so `extensions.{position,
selectiveLogic, case_sensitive, match_whole_words}` are read FIRST — ST's own reader's
precedence (R87/RP-5, 2026-09-26; it used to land every at-depth entry `head` silently and
invert NOT gates). The card's embedded book is sourced from the normalized card (`card.json`'s
`data`), not from a stash.

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
  RECURSIVELY before anything is kept (Emma F7 — prose categories can't drive a sanitizer):**
  the keys `customScripts` (Risu's live field) · `triggerscript` · `virtualscript` ·
  `lowLevelAccess` · `regex_scripts` — ST's OWN scoped-regex field (`extensions.regex_scripts`,
  which rewrites the outgoing prompt; added by R87/RP-4 — the earlier text wrongly called it an
  older Risu name) — matched at ANY depth of the `extensions` tree (V3 permits nesting).
  **"Warehouse none" holds for the avatar too (R87/RP-4, 2026-09-26):** a PNG card IS its
  avatar and its `chara`/`ccv3` chunks are the whole unstripped card, so they are dropped
  before the image lands (§5.4) — the one kept copy of a card is the post-strip `card.json`. **CHARX's code carrier is handled structurally, not by key
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
  + comment-preserving) — once, for imports AND manual edits alike. *(R87/RP-8 moved the stash
  out to `card.json`, written 0600 by `atomic_write_text`; `agent.yaml` keeps the chokepoint.)*

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

- **What paints:** the ACTIVE agent's OWN art — its bound `background`, else its `avatar`
  (owner round 2026-09-08 — a card import binds only the avatar); when the agent has neither,
  the theme's own operator art (in gacha: the `oracle:` pin / `media/gacha/oracle/` library,
  today's ladder) — so a fresh install and every agent without art look exactly like today.
  `off` beats the ladder entirely.
- **`operator`** — the art takes the operator-image place with the CURRENT treatment: gacha's
  oracle surface as-is (name plate, scrim, scanline, the sticky ghost under `gacha.oracle`
  fade mode), focal position honored via the existing `useFocalPosition` path. The agent's
  own art simply wins the art resolution for that surface while that agent is active.
- **`full`** — the same art as the full chat backdrop, **no blur; dimming AND the scroll fade
  kept** (owner-confirmed round 4: "same fade out as the operator image… just the blur" is
  what changes). Mechanism, stated precisely (Emma's citation check corrected the earlier
  "layers already separate" claim — in today's oracle each FACE bundles art+scrim+plate and
  the whole face crossfades): `full` builds its OWN layer arrangement — one sharp full-bleed
  art layer + a separate readability scrim + the 1→0.28 opacity walk on the wrapper — REUSING
  the oracle's no-animated-`filter` approach (static rasterization, opacity-only per-frame
  work, §14.11) rather than its exact face structure, and simply mounting NO blurred layer.
  *(AMENDED at the wave-3 feel round, 2026-09-09: the owner ruled the walk OUT — the `full`
  layer keeps its rest look at every scroll offset; the driver + ramp/floor tokens were
  deleted whole. Record = §13-S6b's FEEL-ROUND block. The scrim and everything else stand.)*
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

### 8.3a S6 design addendum (2026-09-08, owner-confirmed in conversation): the kit operator strip · the active-agent rule · the setting's home

*Fills the presentations §8.3 left unstated; scouted against the code at `0ee3474`. §8.3 stands;
this narrows it.*

1. **The kit operator presentation.** cosmos/vapor/minimal have no operator-image place; under
   `operator` they get one — **an in-flow art strip at the top of the agent tab** (the gacha
   oracle's geometry class: a token-height block, art + readability scrim, focal honored via
   `useFocalPosition`, NO name plate/scanline) that **simply scrolls away with content** —
   gacha's own `data-oracle="scroll"` posture, so NO JS driver in operator mode. It mounts ONLY
   when the active agent has art (its `background`, else its `avatar`): agentless / fresh
   install = today's look exactly.
   (The rejected alternative — `operator` paints nothing on kit themes — would make the default
   state invisible on the default theme, contradicting ruling 13's default-ON.)
2. **The active agent = the sticky pin when valid in the roster, else the resolved
   default** (whose own art may paint — its `background`, else its `avatar`). ONE image per
   surface: per-bubble `m.agent` never drives the backdrop, and the composer's one-shot armed pick does NOT flip it — a
   single-message target is not a change of operator; only switching characters (Talk /
   `/agent`) is. Mechanically: `sessionAgent` (`store/chat.ts:457`) upgrades to a tiny
   subscribable (`useSyncExternalStore`) keeping the `getSessionAgent`/`setSessionAgent`
   signatures — every existing caller untouched — plus a new `useSessionAgent()`; the
   valid-in-roster derivation already inline in `ToolsMenuSheet.tsx:83-90` is EXTRACTED and
   shared, not duplicated. *(Superseded 2026-09-24 (DECISIONS D75 ruling): the menu's agent pick
   is now the STICKY session pin itself — no one-shot exists to include or exclude. Amended
   2026-09-26 (D75 amendment): the pin is no longer session-scoped — renamed `stickyAgent`
   (`setStickyAgent`/`useStickyAgent`), persisted per device, and kept or cleared at `/new` by the
   default-agent tandem rule.)*
3. **The setting**: `agentBackdrop: "operator" | "full" | "off"`, default `"operator"` — a
   **synced** appearance field (the `chatAvatarsVisible` class: `UIState` + the appearance doc
   + backend `AppearanceCfg.agent_backdrop`, additive, no migration), healed at read against a
   `const` allowlist (the `SECTION_PLACEMENTS` precedent), rendered as a hand-written
   `SettingRow` + 3-option `Seg` beside Chat avatars. Per-agent mode overrides stay the
   recorded seam, not v1.
4. **`full` is ONE shared arrangement** (a kit-level component) used by the kit themes AND
   gacha: a zero-height sticky pin (the frontier `.fr-rigstack-pin` precedent) hosting the
   sharp full-bleed art layer at z:0 (`.chat-log` lifted to z:1 under the state), a separate
   readability scrim, and the 1→0.28 opacity walk — driven by a minimal kit hook over the
   **lifted pure progress math** (`themes/gacha/oracle.ts`'s pure half moves to a shared
   kit module; gacha re-imports — one source of truth; the gacha DOM driver stays gacha's).
   *(The walk was AMENDED OUT at the wave-3 feel round, 2026-09-09 — owner ruling, no scroll
   reaction at all; the lifted math stays for gacha's oracle. §13-S6b's FEEL-ROUND block.)*
   Walk tunables (ramp/floor) are kit tokens, not magic numbers; §14.11 holds (opacity-only
   per-frame, no animated filter, no scroll-driven CSS animations; hand-authored
   perf-lite/motion-reduced gates). **In gacha `full`, `GachaOracle` does not mount** — the
   plate/scanline are absent while `full` is active (owner-accepted; `operator` keeps them).
5. **Gacha wiring lands at the body level** (`GachaAgent`; `GachaOracle` untouched):
   `operator` → `art = activeAgentArt ?? oracleArt(roster)` (that resolution is the agent's
   `background`, else its `avatar`); `full` → the shared arrangement paints the same
   resolution full-bleed; `off` → `art = null` (the shipped
   plate-only null state) and no kit layer. `gacha.oracle` sticky/fade keeps governing
   operator-mode scroll ONLY. In `full` with no agent art the theme fallback paints
   full-bleed (kit themes: nothing — they have no fallback art). Frontier: untouched
   (ruling 18).

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
- **Conf**: the `roleplay` group (toggle · default-tools list · the persona library, one card per persona + the default-persona control, D78 §14.4 A-3) + the
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

**S0–S6 are ✅ BUILT + council-closed; S8 ✅ BUILT (its review round rides the main seat)** (S4/S5/S6 also owner-closed; the S6b backdrop round's
three waves ride S6). The per-slice as-built records — deviations, review rounds, owner rounds —
are in §13, which is where the detail lives.

- **S0 ✅ — the assembly core (BE):** the AgentDef fields + config section + macro pass + the
  Voice/Duties split (`DEFAULT_SYSTEM_PROMPT` → persona default + `duties_agent`; the new
  `duties_conversational` text) + scenario/persona blocks + the post-history tail slot.
  Golden-fixture assembly tests re-pin the new universal shape; a no-new-fields agent's diff
  vs today = exactly the restructured head, nothing else.
- **S1 ✅ — greeting + example dialogue + voice (BE):** thread seeding, `<START>` parsing,
  pseudo-message emission, normalize-seam behavior on strict templates (the §4.2 named-system
  probe), the per-agent voice resolution (§8.5).
- **S2 ✅ — card import (BE):** containers + sniffing + normalization + mapping + strip pass +
  avatar into the library + explicit minimal tools + the import report. *(Pre-release R87 wave,
  2026-09-26: the `card` stash became the whole-card `card.json` sidecar + `AgentDef.card`
  removed (RP-8/RP-13); card chunks stripped from the avatar PNG + `regex_scripts` denylisted
  (RP-4); ST's `extensions.*` read first for card books (RP-5); a Character's Note report line
  (RP-6); `{{original}}` = the configured system prompt, Duties always emitted (RP-1); case-
  insensitive vocabulary + `{{// }}` comments + the unrendered-macros report line (RP-2/RP-3).
  Then the R89 wave: a persona-less card gets `card_blank_soul` (E-1); route-level import locks
  (E-2); book KEYS feed the macro line (E-3); envelope unknowns kept at the envelope level (E-4);
  the report maps what was acted on (E-5).)*
- **S3 ✅ — lorebooks (BE):** storage/CRUD + scan + render/budget + bindings + book import.
- **S4 ✅ — the agents surface (FE + the summary API):** **the BE half first (Emma F12): extend
  `GET /agents` with a compact per-agent summary map — title · avatar · background · voice —
  including the resolved default** (today it returns only names + default, and the gallery/
  picker/who-line/backdrop would otherwise need N full agent+SOUL fetches per mount; media
  URL/focal resolution stays with the media index) · the gallery section (the AgentsEditor
  relocation + visual cards, §8.4) · avatar/background set-from-editor via the reused
  `useImageJob` crop/focus machine (§8.2) · the new marked fields + visibility predicate ·
  the duties toggle · Conf group + persona editor · import UI + report · agent-picker
  avatars · the who-line avatar swap + its Appearance toggle (§8.5) · the §9a prompt-editor
  refinements.
- **S5 ✅ — the lorebook FE:** manager + attachment picker.
- **S6 ✅ — the three-state backdrop (FE/theme):** the appearance setting + gacha oracle
  integration + the kit backdrop layer + the `off`-state surface behavior (§8.3, narrowed by
  the owner-confirmed §8.3a) — in-phase per ruling 13, default `operator`.
- **S7 — the owner device round** (the phase gate): import a real card, talk to it on the
  phone, tools-in-character on both duties settings, all three backdrop states on the real
  phone (blur/dim legibility), a field-authored lorebook imported + triggering live (§6.7),
  the showcase + picker feel, read-along on a character reply.

  > **S7 PARTLY RUN, then RE-SHAPED BY THE OWNER (2026-09-11, in conversation).** Ticked on
  > their phone that session: phone-talk ✓ · all three backdrop states ✓ · the showcase/picker
  > feel ✓ · read-along on a character reply ✓ · a real V2 card imported through the UI ✓
  > (Seraphina — the import leg was delegated and PASSED; ⚠ it surfaced that `roleplay.enabled`
  > had never been set on dev, so the import button was hidden: defaults false, now ON there).
  > **Their ruling: no formal sitting for the rest — the remainder rides their REGULAR USE**: a
  > field-authored lorebook triggering live (§6.7) and tools-in-character on BOTH duties
  > settings. Their word on those two closes S7 and the phase; nothing is scheduled for it.

- **S8 ✅ BUILT 2026-09-26 — the persona library + the neutral framing (D78 + the D70 framing
  amendment; design of record §14 + its §14.4 amendments).** *BE:* `config.PersonaCfg` +
  `RoleplayCfg.personas`/`default_persona` (keys pinned by `is_persona_slug`, the one shape rule
  the agent PUT shares) · `AgentDef.persona` replaces `user_name` · ONE resolver
  `services/agent/persona.py::resolve_persona` (link → default → none; a dangling slug falls
  through and WARNs once per (agent, slug), the `lorebooks._MISSING_WARNED` pattern) feeding both
  `macros_for` (two rungs) and `_persona_block` · `api/personas.py` — POST (server mint via
  `card_import.mint_slug`, 409 on a taken slug) · PUT `/{slug}` (rename, slug fixed, unmanaged
  fields kept) · DELETE `/{slug}` (no cascade) — `api/hosts.py`'s write path; `default_persona`
  rides the ordinary settings PUT · config migration **step 5** (`VERSION` 4 → 5): the global →
  the default, `user_name` renamed in place in `agent.defaults` + every agent file (exact-name
  reuse, else the mint's suffix walk; a blank stays blank), `roleplay.persona` retired from the
  env grammar · Part B: `lorebook_intro`/`persona_intro` became noun labels (both stamps change).
  *Deviation:* the key rule admits `_` (`^[a-z0-9][a-z0-9_-]*$`) — the mint's own grammar does,
  and a narrower rule would refuse a slug the server just minted. *Tests:* `test_personas_s8.py`
  (router · shape · resolver + warn-once) · `test_config_migration_step5_personas.py` (the A-5
  matrix + the runner) · re-aimed `test_roleplay_s0/s1/s3`, `test_prompts_registry_p18` (+ the
  "no authority claim" invariant), step 4's runner arms read `cm.CONFIG_VERSION`. *FE:* the
  sibling lane (the RoleplayEditor personas block + the agent form's persona select, §14.1 A6 as
  amended by A-3/A-4). *The code round (§14.5):* blind Emma DO NOT SHIP [2 HIGH · 3 MED · 1 LOW] →
  the fix wave (the settings PUT refuses `roleplay.personas` with 422 · step 5 keeps an explicit
  blank default and consumes a blank-string global · new-wins before the mint) → Emma's confirm.

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

**Round 1 RAN (§13): BUILD WITH CHANGES, all 15 findings accepted + folded into the body** — then
the confirm + micro-confirm rounds closed it, the owner ratified, and D70 was recorded (§13).

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

### S4 — the agents surface: BUILT + council-CLOSED + owner-CLOSED 2026-09-08 (record spans sessions five–eight; the four addenda below carry the §8.4a fold, the code round, the OF wave, and OF-1b)

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

**S4 CLOSED (the owner's word, 2026-09-08 session, in conversation):** the phone glance
passed — "you fixed something and it looks good now, we can continue" — S4 is council-closed
AND owner-closed; S5 (the lorebook FE) opens.

### S5 — the lorebook FE: BUILT + council-CLOSED 2026-09-08 (eighth session, same session as the S4 close)

**The whole standing cadence ran in one session**: two seam scouts (the BE API surface as the
FE must consume it · the FE patterns to reuse) → main-seat design → pinned Opus build
**`eb2f21c`** → main-seat audit (full gate independently re-run 6/6; **all 10 declared
deviations ACCEPTED**) → blind Emma round → fix wave **`3be3386`** → rider **`b365d45`** →
her confirm → micro-wave **`0ce4dd4`** → micro-wave rider **`059fd29`** → her **FINAL
VERDICT: RESOLVED — SHIP** (blocker closed with line proof · changed-line sweep "no new
defects" · she re-ran the full FE suite 3,024/3,024 herself).

**As built (`eb2f21c`, FE-only, no backend change):**
- **The manager** (`components/LorebooksEditor.tsx`, inside the EXISTING `id="lorebooks"`
  ConfGroup — manager first, then `LorebookGlobals`): the SkillsEditor file-per-slug shape;
  book rows are the D25 BREAKOUT (the row carries the enable switch — immediate
  master-switch mutation over a FRESH `fetchLorebook` read, never the draft); the add row
  mints the slug with the backend's own `_slugify` rule and refuses an empty mint, a shelf
  collision, AND (post fix wave) a stale-shelf collision via a file probe (404 = the only
  "free"); import = the gallery affordance verbatim with a sibling three-list `.agrep`
  report renderer (mapped · stashed · warnings).
- **The §6.6 entry list** — the owner's first-class requirement: one collapsed row per
  entry (key summary · constant badge · a 160-char-capped one-line preview · a DRAFT-only
  enable switch), only the OPEN entry mounts its form (all eleven v1 fields; blank
  priority stays the wire's `null`); entry rows are `.lb-entry` (NOT nested `.mwrap`s —
  `.kit .mwrap.open .mconf` is a descendant selector).
- **THE LOAD-BEARING RULE, test-pinned**: nothing is rebuilt from form state — every edit
  spreads the object the server handed back, so the `extra="allow"` stash (`comment`,
  `uid`, `selectiveLogic`, …) survives the destructive no-ETag full-replace PUT.
  `tests/tabs/confLorebooks.test.tsx` pins entry-level AND book-level stash.
- **The picker** (`LorebookPicker`, ONE component, two consumers): the agent form (NOT
  `rpShow`-gated — ruling 9) and the global `lorebooks.books` on the LorebookGlobals save
  bar (joined-string reseed guard; the settings deep-merge replaces lists wholesale).
  Dangling attached slugs render ticked-and-marked-missing so a save never silently drops
  them. `TickGrid` moved to its own module (cycle-avoidance; +`labels`/`missing` props).
- Hooks beside `pickLorebooks` in `useRoleplay.ts` (the file's own recorded seam), the
  useSkills shape verbatim; `/api/lorebooks` in the e2e fixtures ROUTES + a conf.spec
  shelf→book→entry ladder, green both projects; a11y scans green.

**The Emma round (blind, R46 brief): DO NOT SHIP — 1 HIGH · 5 MED · 1 LOW, all seven ruled
FIX** (sound-checks confirmed the stash design + pinning tests non-vacuous, the draft
lifecycle, slug grammar parity, picker wiring, D25 a11y, spec fit §6.6/§9). The fix wave
`3be3386` (Opus, failing-before proofs): F1 the collapsed-row dirty registration — landed as
the MAIN-SEAT re-derivation (compare against the SEEDED SNAPSHOT; her "register ungated"
alone is vacuous when the closed row's query data is undefined — she later ruled the
re-derivation SOUND) · F2 flipEnabled always reads fresh (a simplification; her
closed-row-data-truthy mechanism was wrong but the open-row-stale case real) · F3 an
isPending guard · F4 the stale-shelf file probe (her create-only backend verb OVERRULED —
out of scope, over-machinery) · F5 the `accept` filter dropped (Android choosers gray out
mistyped files) · F6 `aria-pressed` on TickGrid (all four consumers) · F7 indexed warning
keys. **Rider `b365d45` (main-seat): the two same-class TWINS the fix builder flagged on the
S4 surface** — AgentRow's identical collapsed-dirty defect (failing-before proven) and the
card-import `accept` filter.

**Her confirm round: 5/7 RESOLVED + the F4 objection + F3 surviving + 2 sweep MEDs → the
micro-wave `0ce4dd4`** (main-seat, all four tests proven red pre-fix): F3 properly (a
`flipping` state held from entry to settle — the closure's isPending snapshot cannot be
re-checked across an await; BOTH doors read `writeBusy`) · sweep-1 (commitNew captures
name+slug BEFORE the probe; create AND cancel locked while probing) · sweep-2 (a CLEAN
draft adopts the echo wholesale, a DIRTY one takes only the flag) · **plus a trap her sweep
missed, main-seat-found: toggling a NEVER-OPENED row pinned the seed with no draft — the
first open then matched the pin, skipped the seed, and sat on "loading…" forever** (the
unfaithful test mock — its save not writing the mocked file — is exactly why the class
survived the wave; the mock now writes it). **Her F4 malformed-file objection OVERRULED as
a recorded residual** (the API's 404 deliberately collapses absent/unreadable — the S3
class; no FE probe can distinguish them) — **she ruled the scoping honest**.

**Her micro-confirm found ONE blocker → the rider `059fd29`**: `wasClean`/`hadDraft` were
click-time snapshots read after the await while the editor stays editable (a keystroke typed
during the toggle's GET was discarded as "clean"). Root fix at one chokepoint: `updateDraft`
writes a live ref + state in the same synchronous moment (every draft write rides it), and
the echo classifies off the LIVE ref — no impure updater (StrictMode diverges), no
render-mirrored ref (flush gap). Failing-before test: type during a held GET, the keystroke
survives the echo. **Final round: blocker CLOSED with line proof, sweep "none" — RESOLVED —
SHIP.**

**Gate at tip `059fd29`: 6/6 — BE 2,373 (untouched) · FE 3,024/177** (counts in QUALITY.md;
eslint 97 → 110, attributed there — the seeded-snapshot render reads are the design).

**Residuals, recorded, none owed now:**
- **The malformed-file class, extended**: an unreadable on-disk book is list-invisible,
  unrepairable, AND (via the probe's 404) silently overwritable by a same-slug create. One
  register entry: the backend learns to SURFACE unreadable books; the FE refusal follows.
- The probe→PUT ms TOCTOU on create (accepted — one owner, one tailnet).
- `TickGrid`'s PRE-EXISTING silent-drop of a selected-but-undiscovered name in the
  tools/skills grids (the lorebook picker handles it via `missing`; the twins do not) —
  Phase 19 register material.
- `.kit .mwrap.open .mconf` is a descendant selector — any future nested disclosure inside
  a `.mconf` hits it; a `>` combinator is a shared-CSS change for its own pass.
- The book-row switch is not optimistic (waits the PUT round-trip — the app's posture, but
  a whole-file write); entry rows are index-keyed (fine without reorder; any future drag
  revisits); a negative `order` cannot be typed (`numOrKeep` floor).

**S5 owes nothing forward. Next slice = S6 (the three-state backdrop, §10-S6), one slice
per session, the owner's word opens it. The owner's dev poke at the manager (Conf →
Lorebooks on :5173 — their real 40-entry `personality-traits` book is live on dev from S3)
is the natural feel round.**

#### S5 addendum — the owner's feel round (2026-09-08, same session): ONE finding, fixed `589ecf0`, micro-round-closed

**The round:** "it looks fine" — except the Global-lorebooks picker ("0 attached" + the
`personality-traits` chip) with "no padding at all", plus a standing ask: MEASURE the whole
surface for consistency rather than claim it. **Measured live at 390px (the OF-1b method):**
both card-hosted `.agent-allow` blocks sat at x:19 against the card border — the flagged
picker AND the S4-shipped roleplay "Character tools" grid (the same defect, previously
uncaught) — while every row label and every manager internal (mform · entry rows · footers)
sits on the card's content line at x:33. Cause: `.agent-allow` was born inside `.mform`,
whose grid supplies gutters; a `.conf-card` supplies none. **Fix `589ecf0`:** ONE
child-scoped rule (`.kit .conf-card > .agent-allow` takes the confrow's density-aware
inset); the four consumers produce five placements and the combinator reaches exactly the
two card-hosted ones. Re-measured x:33 both; the e2e Lorebooks ladder pins the shared left
edge (head x === label x ∧ > card edge), proven red without the CSS. The import row's 12px
is the shipped agal recipe verbatim — consistent with its agents-surface sibling, left
alone. Gate 6/6. **Emma micro-round: RESOLVED — SHIP** — scope verified (the `.mform`
instances cannot match), pin non-vacuous, consistency sweep "no additional findings".
**The owner's phone glance at the fixed picker is the remaining word; then S5 closes → S6.**

**S5 IS CLOSED — the owner's word landed 2026-09-08 ("yes lets continue"): the fixed picker
passed the phone glance, no further findings. S6 (the three-state backdrop, §10-S6) opens.**

### §13-S6 — the three-state backdrop: BUILT + COUNCIL-CLOSED (2026-09-08, one session — RESOLVED — SHIP)

**The road:** two seam scouts (the gacha oracle surface · the kit/settings machinery) →
main-seat design → the owner's clarify round in conversation (plain-language restatement,
confirmed) → **§8.3a written + committed `dd60681`** (the owner-confirmed narrowing: the kit
operator strip · the one-image active-agent rule · the synced setting) → pinned Opus build
**`06d3f0e`** → main-seat audit (diff line-by-line, all 8 declared deviations ACCEPTED, gate
independently re-run 6/6) → **blind Emma round: SHIP WITH FIXES — 0H · 3M · 0L, open sweep
"none"**, all seeded areas explicitly cleared (she re-ran 149 targeted FE tests + the BE
appearance tests herself) → all three ruled FIX → fix wave **`29c5be4`** (Opus,
failing-before proofs on every fix) → her confirm: **all 3 RESOLVED** (F2 re-probed in her
own Chromium) + ONE new LOW → main-seat rider **`90b7472`** → **micro-confirm: RESOLVED,
sweep "none" — FINAL VERDICT: PASS.**

**The build (headlines):** `agentBackdrop` operator/full/off — a SYNCED appearance field
(`AppearanceCfg.agent_backdrop` unseeded-until-written · the full `useAppearance` chain · ONE
allowlist + heal-at-read `resolveAgentBackdrop`, every consumer reads healed) · the sticky
session pin made REACTIVE inside ChatState (signatures kept, `useSessionAgent()` added; the
valid-in-roster fold extracted as `validSessionAgent`, shared with ToolsMenuSheet) ·
`useActiveBackdrop()` = the one active-agent-art answer · the kit `AgentBackdrop` layer
(presentational {mode, art}; operator = in-flow token-height strip, no driver; full =
zero-height sticky pin + sharp full-bleed layer + separate veil + the 1→floor walk over ONE
custom property, `:has()`-gated z-lift, reduced-motion parks at the floor with the driver
off) · the pure ramp math LIFTED to `theme-engine/kit/scrollProgress.ts` (gacha re-imports,
assertions unchanged) · `--kit-pane-h` published by DefaultRoot (the build's own find: an
`--app-h`-sized layer added 104px of phantom scrollable overflow — e2e-pinned at exactly 0) ·
gacha wired at the body only (operator: agent art WINS the oracle ladder; full: the shared
arrangement instead of the oracle, plate absent, owner-accepted; off: the shipped
art-resolved-null state).

**The fix wave (Emma's three, all red-proven):** ① `off` no longer runs the fade machinery —
`oracleFadeActive(sticky, mode)` is ONE derivation read by GachaAgent's driver/ghost gate AND
GachaRoot's `body[data-oracle]` stamp (her catch: the boolean alone left the CSS half sticky);
② the full pin's pinned-plan pull is COMPENSATED (`margin-bottom` = the same token) — a
zero-height pin's negative margin advanced every following sibling under the panel (gacha's
300px oracle precedent didn't transfer); ③ the gallery stops lying: a declared
`agentBackdrop: true` on gacha's oracle role + seat, judged by the WIRING (`useMediaLibrary`
— resolvers stay pure, their arity pin untouched), minting `ActiveArt.outranked:
"off"|"agent"` worded once in `OUTRANKED`; and the ladder itself is ONE kit statement
`backdropOutrank(mode, hasAgentArt)` read by the gallery's report AND GachaAgent's paint, so
the two cannot drift. **The rider:** the outranked word now survives the seat MODAL's early
return (her confirm-round LOW; hoisted first in `reading()`, red-proven).

**Gate at tip `90b7472`: 6/6 — BE 2,373 (the field rides existing suites) · FE 3,061/178 ·
e2e agent-backdrop 14/14 both projects** (counts in QUALITY.md). ⚠ Ops, recorded: a full-gate
run CONCURRENT with an Emma round that live-probes in Chromium fails ~8 BE media-write tests —
her probe rebuilds `frontend/dist` mid-run (the known tree-contention class; both re-runs
clean in isolation). Background gate runs were also reaped twice this session — run the gate
FOREGROUND.

**Residuals (recorded, none owed):** the full-veil readability on a LIGHT theme and the 240px
strip height are unverified by eye — S7 device-round material (both are tokens) · frontier
integration stays the post-phase follow-up (ruling 18) · per-agent mode overrides stay the
recorded seam · the `layout.spec.ts` first-parallel-run flake is the standing Phase 19 H-E2E
contention class.

**S6 owes nothing forward. The owner's phone round on the three states (dev :5173) is the
natural close; then S7 — the owner device round — IS the phase gate (§10-S7).**

### §13-S6b — THE OWNER'S BACKDROP ROUND (2026-09-08): four findings; waves 1, 2 and 3 ALL BUILT + COUNCIL-CLOSED, and **S6b CLOSED by the owner 2026-09-09** (the per-wave records follow, in order)

**The round (phone, in conversation), restated and owner-confirmed as four findings + a
two-wave plan:** ① the agent form's avatar/backdrop picker is confusing (a thumb, a `choose`
button that unfolds a tile strip, sibling `upload`/`clear`) · ② Lynette showed the theme's
default backdrop — root cause NOT a priority bug: a card import binds only the AVATAR, her
`background` is empty, and resolution read `background` only · ③ `full` mode started a
visible band below the pane's top with a 30px `--bg` haze across the art's top edge · ④ the
agent form's long-text fields should take the Conf → Prompts presentation (label line + faint
description + tappable preview box), which the owner prefers over the 104px-label +
"Edit fullscreen ↗" idiom. **Wave 1 = ②+③ (mechanical, this record); wave 2 = ①+④ (the two
presentation reshapes, its own cadence).** Owner design confirms taken in conversation:
backdrop order = bound `background`, else `avatar`, else the existing default; the picker
becomes image-as-button → the media-manager library in pick mode (upload a tile INSIDE the
grid, remove inside the picker, shown only when set — the researched dominant pattern:
ST/open-webui/LibreChat/Telegram/WhatsApp + Material/HIG all agree, sources in the session's
research pass).

**Wave 1's road:** three parallel seam scouts (resolution chain · picker components · prompts
presentation) + a bounded picker-UX research pass → main-seat design in plain prose → the
owner's word → pinned Opus build. **1a `864f447`:** `useActiveBackdrop` returns
`a.background ?? a.avatar` — folded at that ONE chokepoint (kit paint, gacha's ladder, the
gallery's `hasAgentArt` report all read it; `resolveAgentArt` untouched so
`AgentArt.background` stays the truthful binding); 5 unit arms over the real roster×index
chain, 2 red-proven. **The builder's STOP-CLAUSE catch (a process win worth keeping):** the
brief's gap mechanism was WRONG twice — the seeded scout misread sticky anchoring (engines
rest sticky against the scroller's CONTENT box; the shipped kit.css comment was right), and
the prescribed compensated margin-pair pull on the pin measured INERT (first in-flow
self-collapsing zero-height child — the pair collapses through the parent and nets zero) while
regressing the overflow invariant by exactly the lift. The builder stopped per brief, probed,
and delivered a measured alternative; the main seat overruled its own design and accepted.
**1b `d74eecb`:** ONE token `--kit-backdrop-lift` (= `--appbar-h + --kit-inset-top`) minted on
the pin; the ABSOLUTE ART LAYER is pulled by `-lift` with the height's two subtractions
dropped (no flow box moves, no margin touched; state-independent because the pin's seat is
`lift` below the scroller top at rest AND stuck, every bar mode) — measured from source: art
top Δ 0.0 in all four bar modes × plan/no-plan, at rest and stuck, overflow still 0; the seam
scrim `.kit-main::before` yields via `:has(.tab.active > .kit-backdrop-pin)` (pin-scoped so
`operator` keeps it; active-scoped because bodies are keep-mounted). The dead end is recorded
in the commit message + the layer comment so nobody re-walks it. e2e 14 → 20 (geometry
edge-to-edge + overflow restated · scrim yields-and-returns · the operator-guard), the two
claim arms red-proven.

**The council close:** blind Emma round (R46 brief, hermes lane, `--ignore-rules`) —
**SHIP WITH FIXES: 1 MED · 2 LOW, open sweep "none"**, every mechanism section explicitly
cleared (fallback vs every consumer · safe-area/desktop/pinned-plan/late-`--kit-pane-h`
geometries · scrim lifecycle · walk driver). All three ruled FIX → wave **`6657a9b`**:
① (MED) `OUTRANKED.agent` said "own background is used" — a LIE when the avatar stands in
(the exact honesty class §13-S6's ③ existed for); now "own art is used", all four occurrences,
none survive · ② (LOW) the scrim e2e's double-`boot()` stacked competing `addInitScript`s
(unguaranteed order — the known first-run-flake class); now ONE boot + LIVE two-way tab
transition, the better claim · ③ (LOW) §8.3/§8.3a's five resolution clauses said
background-only; amended to the shipped ladder, theme-fallback preserved. Her confirm:
**all 3 RESOLVED with line proof, diff sweep "none" — FINAL VERDICT: RESOLVED — SHIP.**

**Gate at tip `6657a9b`: 6/6 — BE 2,373 · FE 3,066/178 · e2e agent-backdrop 20/20 both
projects** (counts in QUALITY.md). FE-only wave; :5173 serves it live; dev units RUNNING
throughout (D69).

**WAVE 1C — the owner's re-glance found 1a INCOMPLETE; built + council-closed same day
(RESOLVED — SHIP):** in Lynette's PINNED thread the backdrop still painted the default — the FE
had NO notion of D11's `Thread.agent`, the server's second routing rung (`agent_name or
thread.agent`, `_build_session`), so booting into or opening a pinned thread replied as the
character while every "which agent is active" surface showed the default. **`27e588f`:**
`ChatState.threadAgent` (reactive, written wherever `threadId` moves — `initChat` passes the
record it already holds; `openThread` reads the list WITHOUT gating the open, the pin lands
late under guards; `/clear` nulls; the three wire-mint sites go through ONE `setWireThread`
that resets only on a CHANGED id) + `lib/composer#effectiveAgent(sticky, threadAgent, agents)`
— the server ladder mirrored verbatim, `""`-yields and typo'd-sticky-wins both deliberate and
test-pinned — read by `useActiveBackdrop` AND the A6 menu tri-state; 14 arms, red-proven at
pure/store/paint levels. **Main-seat audit rider `3c6977f`:** the late-pin guard's ticket
clause orphaned the pin on a same-thread re-open (entry claims a ticket before the same-id
early return, which starts no new fetch); threadId-only is sufficient — red-proven.
**Blind Emma round: DO NOT SHIP — 1 HIGH · 2 MED, all verified + ruled FIX → `8277ebf`:**
① (HIGH) automation threads are ARCHIVED + agent-pinned and terminal per-run threads are
deliberately continuable, but `GET /threads` hid archived rows from the pin read — the
endpoint gains `include_archived` (default false, the repo flag), the pin read flags it,
`initChat`'s boot read deliberately does NOT (never adopt an automation thread as the boot
view), and the FE mock that couldn't have caught it now obeys the endpoint contract ·
② (MED) the menu's snapshot read missed the LATE pin landing with the panel up — subscribed
(`useThreadAgent`), the unused non-reactive getter DELETED as a stale-value trap · ③ (MED)
`loadGen` bumped only by `openThread` — a parked cold `initChat` landed the old thread's
history + pin over a `/clear` or a wire-minted view; both bump now. ⚠ The Opus builder was
rate-limit KILLED between committing `8277ebf` and reporting — the main seat re-ran the full
gate itself and Emma's confirm was briefed that the commit's red-proof claims were UNVERIFIED
assertions. **That caught a real one: her confirm ruled F2's regression ARM a FALSE POSITIVE**
(passes on the parent too — an unrelated agent-art rerender re-reads the snapshot and masks
the missing subscription). **Rider `14d3bae`** (test-only): the arm settles the art queries
before releasing the parked pin; three-way transplant proof in a worktree (restructured arm
RED on `8277ebf^` · the old arm's false positive REPRODUCED there · green on HEAD). **Her
micro-confirm: RESOLVED — SHIP** (the avatar proves both art queries settled; the only other
async observer resolves before the awaited open; only `useThreadAgent` can rerender after
release). Gate 6/6 at tip `14d3bae`: **BE 2,374 · FE 3,085/178** (counts in QUALITY.md).

**WAVE 2 — BUILT + COUNCIL-CLOSED same day (RESOLVED — SHIP). The owner's word ("it works, we
can continue") also closed the S6 FEEL ROUND on the backdrop itself.**

**The build `b0d3cb6`:** ① each art row is now the PICTURE — an aspect-shaped `FocalImg` face
(avatar 1:1, backdrop 9:16), pencil corner, caption, a gallery-worded "Add an image" empty
face — opening **`media/LibraryPicker`**, the library in PICK mode. Ruled reuse shape: a thin
SIBLING of `GalleryModal`, not a mode of it (the modal's manage half — detail, drag, In-use
corners, delete, seat notices — has no meaning in a pick and would have become `pick ===
undefined &&` litter in the surface's largest component; the `.pm-` shell + focusTrap +
back-guard are composed per-consumer house-wide). Genuinely shared pieces ARE shared:
`LibraryGrid` as-is (the binding passed as its own `ActiveArt`; manage affordances absent BY
CALLBACK-ABSENCE), and the upload surface extracted to **`media/UploadRow`** (`AddImageRow` +
`UploadFailureRow`) so gallery and picker ride ONE Add row — the gallery byte-identical.
Upload-in-picker auto-picks via `onStored`; "Use no picture" appears only while bound. The
`.agart-pick` strip + the three pill buttons are DELETED with their CSS. Builder-probed
deviation ACCEPTED: the pickers mount as FORM SIBLINGS — `.mform`'s `all: unset` field recipe
un-hid the picker's file input when nested (probed in the built artifact); `picking` is a
field NAME in form state, never a captured row; `ART_FIELDS` = the one field↔role↔label home.
② **`PromptRowFace.tsx`** exports `FieldRow` + `PromptRowFace` (the Prompts editor's row face
extracted; PromptsEditor adopted it, suite green unmodified); the six `LongField` sites + the
two art rows render full-width through it, FIELD_HELP as the faint description; one-line
inputs/Segs/grids keep label-left (owner rule). Screenshot-measured at 393px: every new row
at the form's own left edge x=31, one-line inputs' values at x=147.

**The council close:** blind Emma round **SHIP WITH FIXES — 3 MED, sweep "none"** (extraction
fidelity, lifecycle, filtering, CSS coverage, dialog basics all explicitly sound) → all ruled
FIX → wave **`ad6b409`**: ① the late-upload race closed by ONE main-seat-demanded-invariants,
builder-derived guard — `onStored` early-returns unless ITS field's picker is still open (read
through the upload hook's live ref; a newer pick/clear closed it, a cross-field completion
sees its own closed; closing mid-upload = withdrawing the binding intent — the file registers,
one tap away) · ② `LibraryGrid.describeItem` — the picker's tiles say "selected"/"available"
instead of the gallery's binding-contradicting vocabulary · ③ the face's opener carries
`aria-label="Edit <field>"` + `aria-hidden` pencil — healing Conf → Prompts through the shared
component. Six arms red-proven by reverting each mechanism. **Her confirm: all 3 RESOLVED,
both scopings ACCEPTED** (the unmount-mid-PUT leg stays the recorded §13-S4 residual — closing
it means lifting the job above the agents surface; the withdraw-intent consequence ruled the
least surprising owner-intent reading), **sweep CLEAN — RESOLVED — SHIP.**

**Gate at tip `ad6b409`: 6/6 — BE 2,374 · FE 3,097/178** (counts in QUALITY.md). FE-only.

**Residuals (recorded, none owed):** the unmount-mid-PUT upload leg (§13-S4's residual,
restated) · the old "Edit fullscreen ↗" idiom survives in ConfTab's `PromptRow` (System
prompt rows) and RoleplayEditor/SkillsEditor/MemoryEditor's `.prompt-open` openers — candidates
for a later sweep onto `PromptRowFace`, owner-triggered · the `operator` strip can still show
the seam scrim over its art's first ~20px (deliberate — the strip scrolls away) · the
gallery's `onPaste` upload path is not `caps.upload`-gated (pre-existing, inherited verbatim
by the picker).

**THE WAVE-2 FEEL ROUND LANDED (owner, 2026-09-08, in conversation): "it looks good" + TWO
asks → WAVE 3, design RATIFIED same conversation ("sounds good").**

### WAVE 3 — bigger circles + the avatar's circular cutout (design RATIFIED 2026-09-08; ✅ BUILT 2026-09-09 — the design below, then the as-built + the feel-round wave)

**The owner's asks:** ① the message-bubble avatar circle is too small · ② an exact circular
cutout for the avatar (the bubbles' circle) alongside the whole-image framing the backdrop
uses — their design question ("same picker with a droppable circle, or a separate picker?")
answered and ratified below.

**The ratified design (all rulings owner-confirmed):**
1. **Circle sizes:** who-line face 18px → **28px**, tools-menu face 20px → **24px**, both as
   TOKENS (the literals die); the owner tunes by eye on the feel round.
2. **The cutout = the focus point + the PLANNED `z` zoom** (`core/media.py:389`'s
   "own `hidden`, `focal` and `key` today and `z` (zoom) tomorrow" — tomorrow is now).
   `MediaFocal` gains `z: float | None` (≥1 clamp; `extra="allow"` makes it additive), FE
   `StoredFocal`/`FocalArt` (centred) carry it, same `rev` staleness semantics.
   **Consumption is PER WINDOW SHAPE (the c.ai crop-per-context rule): only CIRCLE windows
   honor `z`** — the who-face and the tools-face; the gallery card, the picker face, the
   operator strip and the full-bleed backdrop honor the POINT only (the wave-1 avatar-as-
   backdrop fallback must not zoom). **RATIFIED TRADE: the circle and the backdrop share ONE
   center**; an independent circle-center is a future additive field, no migration.
3. **Where it is set — NOT a circle on the grid, NOT a second picker: the existing
   `FramingSheet`, upgraded for the avatars role** — react-easy-crop's round crop mask +
   pinch/drag ZOOM enabled (the sheet pinned `zoom=1` ONLY because `z` was unbuilt — its own
   comment at FramingSheet.tsx:34-38 says so; CropModal already ships the zoom config
   1..4/0.05), saving `{x, y, z}`; the preview strip gains a CIRCLE preview ("chat face")
   beside the square card (registry seam: `MediaPreviewDef` or the role gains a
   shape/circle declaration — builder's call, reported). Backgrounds keep today's sheet
   unchanged. **Two doors, one sheet:** the Conf gallery's "Focus" (as today) AND an
   "Adjust framing" door from the avatar picker/row when an image is bound (an
   owner-ratified amendment to the §8.2 framing-stays-in-Conf scoping — the SHEET is still
   the one framing UI).
4. **The who-face starts honoring framing** (it ignores it today — plain `<img>`, URL-only
   thread through ChatThread.tsx:698, the kit.css:3843-3852 comment's stated reason being
   the per-bubble ResizeObserver cost): a circle is ALWAYS aspect 1, so position (and zoom)
   are computable STATICALLY from the focal + the source dims — no observer, no
   `useFocalPosition`, §14.11-clean (a static transform, nothing animated). The builder
   derives the exact render (computed object-position/size or a scale with origin) — the
   invariant is ZERO per-bubble observers.

**The seam map for the build brief (scouted 2026-09-08, main-seat-held):** `lib/focalPosition.ts:43-57`
(`FocalArt`; `focalAxis` :89-106) · `lib/mediaLibrary.ts:94-98` (`StoredFocal`), :290-315
(`focalState`/`artFocal`), :566-580 (`setFocal`, clear-removes-field) · `core/media.py:321-341`
(`MediaFocal`) + :389 (the `z` seam) · `components/media/FramingSheet.tsx` (:34-38 the no-zoom
comment · :59-61 reticle consts · :244-250 stage math · :351-356 the pinned crop props ·
:381-404 the preview strip · save :225/:414) · `components/media/CropModal.tsx:48-50` (the
zoom consts; NOTE CropModal is DESTRUCTIVE re-encode — the sheet is metadata-only, keep them
apart) · `components/FocalImg.tsx:27-39` (objectPosition-only today) + `hooks/useFocalPosition.ts`
· who-face `components/chatAttribution.tsx:172` + `components/ChatThread.tsx:698` (URL-only) +
`kit.css:3843-3852` (18px + the observer-cost comment) · tools-face `ToolsMenuSheet.tsx:199-206`
+ `kit.css:1401-1411` (20px) · gallery card `AgentsTab.tsx:58-66` (~169px at 390) · registry
`mediaRegistry.ts:814-859` (avatars previews "one shape asked for three times") + :196-201
(`MediaPreviewDef {label, aspect}`) · dual consumption `useActiveBackdrop.ts:39-51` · NOTE
`LibraryGrid` tiles are plain `<img>` (framing not honored in grids — unchanged, fine).

**WAVE 3 AS-BUILT (2026-09-09, the full standing cadence in one session — council-CLOSED:
Emma's confirm RESOLVED — SHIP, sweep "none").** Build **`11ff928`** (pinned Opus brief off the
block above) + review fix **`6330d6c`**:

- **① sizes:** `--kit-who-face: 28px` / `--kit-tools-face: 24px` on `.kit` (kit.css:75-76,
  beside `--kit-plan-*`); both literals gone — the owner tunes each in one place.
- **② `z`:** `MediaFocal.z: float | None` + `FOCAL_ZOOM_MIN/MAX = 1.0/4.0` (media.py:324-325);
  the validator CLAMPS rather than 422s (the owner's own file — a hand-edited `z: 40` means "as
  far in as it goes"), folds ≤1 and NaN to `None` — **absent is the only spelling of "no zoom"**,
  so a home-position save writes the exact three keys it always did. Rides the point's object:
  set, cleared and rev-keyed with it.
- **③ per window shape, by construction:** `circleFraming` reads `FocalArt.zoom`,
  `focalPosition` never does — the scoping is a property of the two functions, not a rule call
  sites remember. Backdrop/card/strip/picker faces cannot zoom by accident (red-proven R15).
- **④ the observer-free circle math** (`lib/focalPosition.ts#circleFraming`): for a square box of
  side `b`, cover scales by `k = b/min(W,H)`, so the overflow `s = (W,H)/min(W,H)` — **`b`
  cancels**; a square window's overflow is a fact about the PICTURE. Paint =
  `background-size: s·z` + `background-position: P(f, s·z)` (percentage position ≡
  `object-position` in the spec). `min(s·z) = z ≥ 1` keeps the no-gap invariant by construction.
  DORMANT at z=1: no inline size, the stylesheet's `cover` paints (an explicit percentage size is
  NOT byte-identical to `cover` — Chromium measured ≤5/255 on 1560/14400 px). **`FocalFace`** is
  the consumer: one `<span>` background (a wrapper-free clip; `cssUrl` escapes hostile
  filenames), who-line + tools faces — the tools face LOST its per-row ResizeObserver. Unknown
  dims degrade to the house proportional rule. Live-measured at 390px: identical paint strings at
  28px and 24px.
- **⑤ the sheet, role-gated:** `MediaPreviewDef.shape?: "circle"` + `framesCircle()` — ONE
  declaration, two consequences (zoom offered · the exact "chat face" circle preview joins the
  strip), so they cannot disagree; avatars declares it, backgrounds/theme roles keep today's
  sheet (pinned). Round reticle, slider (keyboard-reachable; the library ships no keyboard zoom),
  `panLimit`/`seedPan`/`tapPan` carry the factor, `zoomPan` = the library's own
  zoom-about-a-point arithmetic at the container centre so slider and pinch land on one state,
  and the fence lives on the RENDERED `crop` prop (measured: `setNewZoom` reports pan FIRST —
  reducer-side clamping would truncate every zoom-in to the fence of the zoom it left).
- **⑥ two doors, one sheet:** `LibraryPicker` gains optional `onFrame` → **"Focus"** beside "Use
  no picture" (offered only on a framable bound row: `caps.frame` ∧ bound ∧ usable);
  `ArtPicker` holds the captured item MediaGallery-style and mounts the sheet as a SIBLING of
  picker and form (the `.mform` rule); saves through the same queued rev-guarded
  `studio.setFocal`. Deliberately NOT conditioned on the picker being open — a late upload
  closing the picker must not yank a framing gesture (the wave-2 F1 posture).

**Deviations (all main-seat ACCEPTED):** "Focus" over "Adjust framing" (the app's word) · **the
reticle STAYS a reticle** — the WYSIWYG round-crop version needs `restrictPosition`, whose fence
pins a 3:4 portrait's X at 0.5 forever, and that point is what the full-bleed backdrop reads:
under the ratified one-centre trade only the small reticle keeps every point addressable; the
exact circle is the preview · unknown-dims degrade = the shipped proportional rule · render-time
clamp (measured report order) · the library's UNLAYERED css paints the reticle radius/ring
(unlayered beats `@layer base` regardless of specificity — pre-existing on both cropper
surfaces, recorded not fixed; our `.round` rule stays as the guard) · the sheet not conditioned
on the picker.

**The council round:** blind Emma **SHIP WITH FIXES — 1 MED conf 0.99, every seeded area
explicitly sound, open sweep "none"**: `roundFocal` tested the UNROUNDED zoom then rounded — a
continuous pinch at 1.004 passed the floor test and collapsed to a stored `z: 1` (the config
write persists the raw patch, so the BE fold never sees it). Ruled FIX; **`6330d6c`** rounds
first and tests the value it WRITES, the 1.004 arm red-proven against the unfixed code. **Her
confirm: line-proofed resolved, fix-sweep "none" — RESOLVED — SHIP.**

**Tests:** BE 2,374 → 2,377 · FE 3,097 → 3,126/178; the build's 15 arms red-proven by scripted
reversion (incl. R8 — the who-face framed THROUGH `FocalImg` fails the zero-observer arm) + the
fix's arm. Gate 6/6 three times (builder · main-seat independent · post-fix). The e2e
agent-backdrop 20 arms untouched.

**Residuals (recorded, none owed):** the reticle ring is the library's 1px white on BOTH cropper
surfaces (pre-existing, the unlayered-CSS finding above — a future owner-triggered look item) ·
a hand-edited `z` on a NON-circle role's item round-trips through that role's sheet untouched
(nothing reads it; preserving owner data is the chosen posture).

**THE WAVE-3 FEEL ROUND (owner, 2026-09-09, in conversation): "looks good" + THREE rulings —
the FEEL-ROUND WAVE ran the whole cadence same session and is council-CLOSED (Emma's confirm
RESOLVED — SHIP, rider sweep "none").** The rulings: ① the bubble circle slightly bigger →
`--kit-who-face` 28 → **32px** (main-seat `1c1e518`) · ② the picker needs a way to REMOVE an
uploaded image — the owner's own design: "an x at the top right corner" (their word overrode
the main seat's fat-finger caution; the confirm dialog carries the risk) · ③ the `full`
backdrop must NOT fade on scroll — "just leave it like when the chat is unscrolled".

**Build `822856e`** (pinned Opus) **+ review rider `c002abe`:**

- **② the delete corner:** `LibraryGrid.onRemove?` → a TOP-END corner button (`.mgal-del` — the
  in-use disc's exact recipe: 24px drawn / ~34px `::after` target, `--danger` glyph on the
  neutral plate), affordance-by-presence, no corner on `bundled`; ONLY `LibraryPicker` passes
  it (the gallery's top-end stays the problem badge — a picker's rows are filtered usable +
  un-`named`, so both halves of `problem` are unreachable there: the corner is free BY
  CONSTRUCTION, stated in the grid doc). Wiring: `useAgentArtStudio.remove = lib.write.remove`
  (the ONE delete chokepoint) · confirm through the EXPORTED `ItemDetail#confirmDelete` with a
  third `activeBody` param — one delete confirm, two screens, only the what-being-active-means
  clause differs ("…this slot goes back to no picture") · deleting the BOUND tile also clears
  the slot; the picker STAYS OPEN (grid refreshes through the write queue's media refetch).
  **Main-seat icon ruling (builder-flagged):** the corner wears `DeleteIcon` (trash), not a
  literal × — beside tap-is-the-pick an × reads as *deselect*; one-line swap if the owner
  prefers the ×.
- **③ the un-fade:** the walk deleted WHOLE, no dormant machinery (the no-legacy-seams rule):
  `useBackdropWalk` + `P_VAR`/`RAMP_VAR`/`SCROLLER_ID`, `FullBackdrop`'s ref/`motion`
  read/`active` prop, `useAgentBackdropActive` (no other consumer, grep-proven), the
  ramp/floor tokens, the `opacity: calc()`, `will-change`, and BOTH `data-motion="reduced"` /
  `data-perf="lite"` gate rules. `kit/scrollProgress.ts` STAYS whole — gacha's oracle is its
  consumer (GachaAgent.tsx imports all three helpers; its 14-arm suite untouched). The static
  veil is the rest look and is unchanged. §8.3/§8.3a amended in place (the two walk passages
  carry the amendment note).
- **The review round (blind Emma): SHIP WITH FIXES — 3 MED · 2 LOW, sweep clean; she
  Chromium-measured the corner geometry (one crisp `.mgal-del` boundary, no tile-tap overlap)
  and confirm-dialog focus/Escape behavior.** Rulings + rider `c002abe`: **MED 1 FIX** (the
  clear compared the CLICK-TIME `want` across two suspensions — a late upload rebinding behind
  the confirm got blanked; fix = the `liveWant` latest-ref, effect-written, compared at
  resolution — the S5 closure-across-await lesson) · **MED 2 FIX** (`write.remove` now ANSWERS
  for the byte delete — `Promise<boolean>`, false on refusal/rejected DELETE; the clear
  requires `gone && item.id === liveWant.current`; the await widens MED 1's window, which is
  why the ref is load-bearing — said in the code) · **MED 3 OVERRULED as residual** (see
  below) · **LOW 1 FIX** (the e2e stillness arm's `toPass` exits on FIRST success — vacuous
  against an async driver; now an explicit double-rAF then ONE assertion each; the builder
  EXECUTED the red-proof against the restored old driver: the new form fails at 0.28, the old
  form's opacity half passed — the vacuity demonstrated, and the durable arm-shape lesson
  recorded) · **LOW 2 FIX** (stale driver clause in the header). **Her confirm: all five
  line-proofed, the MED-3 scoping ruled HONEST, rider sweep "none" — RESOLVED — SHIP** (she
  re-ran AgentArtRow 24/24, typecheck, and the agent-backdrop e2e 20/20 both projects at
  HEAD).

**Residuals (recorded, none owed):** **MED 3** — a confirmed delete followed by ABANDONING the
dirty agent form leaves the SAVED config naming the deleted file (the clear rides the draft;
the fix was overruled: auto-persisting one field would mint a second agent-write path around
the form's save chokepoint and break cancel-means-no-changes; the dangling state is the
shipped bounded degrade — `useActiveBackdrop` paints nothing, the editor shows the empty face
+ stale name — and joins the §13-S4 unmount-mid-PUT class in the file/binding-divergence
register) · the same class covers a delete resolving after the FORM unmounts (the resumed
clear lands on unmounted state, a no-op).

**Tests:** FE 3,127 (wave) → **3,129/178** (rider); BE 2,377 untouched. Gate 6/6 ×4 across the
wave (builder ×2 · main-seat ×2). eslint 100 → 101, the exported `confirmDelete`'s
`only-export-components` (QUALITY-attributed).

**S6b IS CLOSED (the owner, 2026-09-09, in conversation): "both fixes looked good, I just
checked them"** — the delete corner (the trash glyph stands, no × swap asked) and the still
full-mode backdrop both passed their glance; the 32px circle rode the same round unremarked.
**→ S7 — the owner DEVICE round — IS the phase gate (§10-S7).**


### Addendum — the IMPORT RAIL, hardened (the intermission fix wave, D72, 2026-09-15)

The wave's three-lane audit of everything built since v1.7.7 put a security lens on this phase and
found **one HIGH: both D70 import routes were `multipart/form-data` POSTs** —
`POST /api/agents/import` (a V2/V3 character card) and `POST /api/lorebooks/import` (a book). [R73](./research/R73-cross-origin-write-defense.md) was bought against the question and
settles it: multipart POST sits squarely inside the browser's **no-preflight set**, so any page the
owner happens to open while on the tailnet can `fetch(…, {mode: "no-cors", body: formData})` attacker
bytes into the agent/lorebook corpus — CORS shares *responses*, never sends, so **the write always
happens**. The same dossier's verb truth table (Fetch + HTML specs read, not recalled) is what makes
the fix a one-liner in shape: **no browser path emits a cross-origin PUT without a preflight** —
forms are `get`/`post`/`dialog` only, and a `no-cors` fetch THROWS on a non-safelisted method.

**THE RULING (folded; §7's import contract amended, the shape unchanged for the owner):**

- **Both imports become raw-body `PUT`** — D65's own verb rail for owner writes, now app-wide rather
  than media-only. **The verb IS the CORS control.** No filename path param (the format stays
  content-SNIFFED, which is what the multipart read was never needed for), and the existing per-format
  caps and behaviour are otherwise untouched.
- **The body rides the HOUSE STREAM PATTERN** (review H3): accumulate `request.stream()` into a
  bytearray and **413 the moment the length passes the cap** — the cap+1 posture `core/media.py` and
  `core/attachments.py` already share — never a bare `await request.body()`, which would land the
  whole payload before anyone asked how big it was.
- **Both decorators MOVE ABOVE their parametrized siblings** (review H1, reproduced live): with
  `PUT /agents/{name}` and `PUT /lorebooks/{slug}` registered first, the literal `…/import` path is
  SHADOWED by the parameter route and an import mis-routes into the editor handler — a 500 on owner
  input rather than a 415. Route order is load-bearing here, and the per-route tests assert that the
  IMPORT handler answered (201/415 — never a `{name}`-shaped 422/500).
- **FE:** `AgentsEditor` + `LorebooksEditor` swap to the existing `putBytes` (the error surface
  preserved); `api/client.ts`'s `postForm` is DELETED after a zero-other-callers grep — the wave's
  own no-legacy-seam rule.
- **A standing pin, not a patch:** an app-wide invariant iterates every live route and asserts that
  **no handler declares multipart/`UploadFile`**, with the single allowlist entry
  `{("POST", "/api/voice/stt")}` (a real file upload with no owner-corpus write behind it). It lives
  with the D65 pin family and reuses its route-iteration helper, so the next route that reaches for a
  form upload fails the gate instead of a future audit.

**The residual the verb rail does NOT close, and what now backs it up:** R73 also establishes that
**DNS rebinding defeats the verb rail entirely** — it does not beat the rail, it removes its premise:
the attacker's page re-resolves their own name to this address, so the request genuinely IS
same-origin. The one thing they never control is the name in `Host`, and until this wave our stack
validated none (the prod bind is `0.0.0.0`, SECURITY_MODEL §2.1's accepted trusted-LAN posture).
So the wave BUILT the belt-and-braces: `server.trusted_hosts` (additive, validated at the config
gate) mounts Starlette's `TrustedHostMiddleware` — which covers websocket scopes too, so it also
backs the WS `Origin` rail — and it was built **owner-gated-off**: it ships EMPTY, i.e. NOT mounted,
because an empty allowlist that is mounted 400s every route including the Conf UI, and because the
list must name every address the owner browses by before it can be switched on. Mounting it is their
opt-in, one config line. SECURITY_MODEL §2.9 records the mechanics, the empty-list trap and the
pre-deploy checklist row; with it empty, the rebinding residual stands and is recorded there.

**Authority:** SECURITY_MODEL's D70 section (the PUT rail, R73's vector table, the accepted
card-prompt-injection posture, the script-key strip, lorebook writes) + its §2.7 checklist, which the
wave updated to the app-wide pin and the STT allowlist. The D-entry is
[DECISIONS D72](./DECISIONS.md#d72).

## 14. The pre-release persona + framing wave — D78 + the D70 framing amendment (designed + council-closed 2026-09-26; **BUILT 2026-09-26 — the as-built record is §10's S8**)

> **Status:** designed by the main seat from R90 (+ R64 §6 · R65 §9 · R87 RP-7/RP-12), blind Emma
> design round SHIP WITH CHANGES [6 MED · 1 LOW — all folded, §14.4], rulings recorded as
> [`D78`](./DECISIONS.md) + the D70 amendment. ~~**Not one line of code is written.**~~ **BUILT 2026-09-26 (S8 — the §10 as-built block is the record; the blind Emma code round + its fix wave are in §14.5).** The build was
> one pinned-Opus lane from THIS section (Part A then Part B, or two lanes on disjoint files), then
> the main-seat audit → a blind Emma CODE round → fix wave → full gate → `npm run build` → dev
> migration (`CTRLB_HOME=~/.ctrl-b-dev … config_migration --apply`) → commit. It SHIPPED in v1.7.8
> (2026-09-26; the release carried config migrations 2→5). The as-built record goes into §10 as S8 when
> it lands, and the §3.2/§4.2/§6.4 body text + ruling 7 move with the code (the lane owns them).

Evidence: R90 (`docs/research/R90-injected-context-framing-and-persona-management.md`) on top of
R64 §6 · R65 §9 · R87 RP-7/RP-12. Owner's words (2026-09-26): *"lorebooks are part of the context
and may or may not have instructions … I don't want to bias one way or another, let the subsystem
work as is"* · *"the ability to have different personas and link one to a character specifically —
regardless of the agent, the persona doesn't necessarily have to be for roleplay"*.

### 14.1 Part A — THE PERSONA LIBRARY (new D-entry: personas are a library; the link lives on the agent)

#### A1. What exists (source-read)
- `config.py` `RoleplayPersonaCfg {name, description}` at `roleplay.persona` — ONE global persona.
- `domain/agent.py` `AgentDef.user_name: str` — a per-agent override of the NAME half only.
- `macros.py::macros_for` — `{{user}}` = `agent.user_name` → `roleplay.persona.name` → `"User"`.
- `session.py::_persona_block` — the description block after the roster, from the ONE global.
- `greeting.py::seed_greeting` — macros rendered at seed time (R90 §3.2: a persona resolved later
  would leave the old name in the opening line — with the link per-AGENT and resolved at seed, the
  greeting is right by construction).
- FE: `RoleplayEditor.tsx` (Conf › Roleplay: "Your name" + "About you" rows) · `AgentsEditor.tsx`
  `user_name` text field · `useAgents.ts` type.
- Config-map conventions: user-named entries are `{slug: object}` maps (`computers`, `providers`,
  `tool_overrides`); `PUT /api/settings` deep-merges sections and REPLACES the `providers` map whole
  when the patch carries it (`api/settings.py::put_settings`); hosts have their own CRUD router.
- Migrations: `config_migration/steps.py`, `VERSION` = 5 (steps 2→3, 3→4 and 4→5 all shipped in
  v1.7.8). Steps see `config.yaml` AND every `agents/*/agent.yaml` (`Context.agents`).
- Field convention (R90 §2): ST = library · one global default · the character link stored ON THE
  PERSONA as `connections[]` keyed by the character's avatar filename (orphaned by a rename, R90
  §3.1) · a chat lock; precedence chat > character > default > last-selected. Non-RP peers put the
  per-agent switch ON THE AGENT (LibreChat `memory_scope`, Claude Code `memory`/`omitClaudeMd`) —
  the side ctrl-b's `user_name` already sits on.

#### A2. The shape
```yaml
roleplay:
  personas:                      # {slug: PersonaCfg} — the library (the house map-of-objects shape)
    ari: {name: "Ari", description: "…"}
    dm:  {name: "The DM", description: "…"}
  default_persona: "ari"         # slug; "" → none (then {{user}} = "User", no persona block)
```
- `PersonaCfg` = today's `RoleplayPersonaCfg`, renamed; fields `name`, `description`; `extra=allow`
  (an `avatar` later is one additive field — the CCv3 `user_icon` seam stays recorded, not built).
- The KEY is minted ONCE from the name at creation (`config._slug` — the hosts rule — exposed as
  `persona_slug`; the FE mints with the same rule as `lib/agentSlug` does for agents, the server
  validates `^[a-z0-9][a-z0-9-]*$` on `RoleplayCfg`) — *as built (A-2 moved the mint server-side):
  the server mints with `mint_slug` and validates `^[a-z0-9][a-z0-9_-]*$`, the mint's own `SKILL_SLUG`
  grammar, because a schema narrower than the one mint would refuse a key the server itself just
  minted (the S8 code round's F5, overruled on that ground; ISS-29 holds the wider agent-list split)*
  — and NEVER changes on rename: the name is
  display, the slug is identity → no orphaned links (the R90 §3.1 lesson, by construction).
- `roleplay.persona` (singular) is GONE — no legacy seam. `AgentDef.user_name` is GONE.
- **`AgentDef.persona: str = ""`** — the link, ON THE AGENT (the non-RP convention, and where
  `user_name` already lived): a persona slug; `""` → the default. Usable by any agent, roleplay or
  not — the field is not gated by `roleplay.enabled` (the presentation switch only hides the
  character fields; the persona picker shows whenever the library is non-empty).
- No per-chat lock in v1 (nobody asked; a later `Thread.persona` is additive and would slot ABOVE the
  agent link in the one resolver below).

#### A3. ONE resolver, two consumers
`services/agent/persona.py::resolve_persona(agent, settings) -> tuple[str, PersonaCfg] | None`:
`agent.persona` if set AND present in the library → else `default_persona` if set AND present →
else `None`. A dangling slug falls through (the `default_set` rule of D75: configured AND resolves)
and logs once per (agent, slug) at WARNING through the existing agent-load warning path.
- `macros_for`: `user = persona.name.strip() or DEFAULT_USER` (the three rungs become two).
- `_persona_block`: `persona.description` (macro-rendered as today; empty ⇒ absent).
- Docstrings/plan text: the chain is now `agent.persona → roleplay.default_persona → "User"`.

#### A4. API
- `GET /api/settings` carries `roleplay.personas` + `default_persona` through the model (no change).
- `PUT /api/settings`: a patch carrying `roleplay.personas` REPLACES that map whole — extend the
  one existing rule (`providers`) rather than a second null-sentinel hook (the prompts pattern) or a
  CRUD router (the hosts pattern): personas are tiny, single-user, secret-free; the providers 409
  rev exists for secrets + rename transactions and is not copied. The Conf editor always sends the
  complete map + `default_persona` (the RoleplayEditor's whole-draft save, already its posture).
- `GET /api/agents` / the agent DTO: `persona` rides `AgentDef.model_dump` (no change); the agent
  editor's PUT validates the slug shape (an unknown slug is allowed — the library may be edited
  after — and resolves to the default until it exists; the picker only offers known ones).
- Validation on `RoleplayCfg` (`model_validator`): every key matches the slug rule. A DANGLING
  `default_persona` (or `AgentDef.persona`) is NOT a write error — it simply does not resolve (the
  D75 rule for `agent.default_agent`: "configured AND resolves — a dangling name presses nothing"),
  so a library edit can never brick a config or an agent file.

#### A5. Migration — step 5 (`config_version` 4 → 5)
Pure, over `config.yaml` + every `agents/*/agent.yaml`, the D48/D76 step shape:
1. `roleplay.persona` present: if `name` or `description` non-empty → `personas[slug(name or
   "me")] = {name, description}` and `default_persona = that slug` (the one global WAS the default
   for every agent — values preserved, semantics preserved); delete `roleplay.persona` in ANY
   shape (consumed).
2. every `agent.yaml` with `user_name`: non-empty X → the persona whose `name == X` if one exists
   (case-sensitive, the migrated global included), else mint `personas[slug(X)] = {name: X,
   description: ""}`; write `persona: <slug>`; delete `user_name` in ANY shape (empty included —
   `lynette` on dev carries `user_name: ''`).
3. `applies` = `roleplay.persona` present OR any agent has `user_name`.
`VERSION` → 5. Prod (v1.7.7 → v1.7.8): NO roleplay block, NO agents dir ⇒ step 5 is a no-op there;
the release now carries 2→5 (HANDOFF's release steps say 2→4 — update). Dev: the app refuses to
start on a stale schema (exit 78) → `CTRLB_HOME=~/.ctrl-b-dev backend/.venv/bin/python -m
app.config_migration --apply` from `backend/` after the build (dev's `roleplay.persona` is the
owner's real ST persona — it becomes the default persona, named from its name).

#### A6. FE
- `RoleplayEditor.tsx`: the two persona rows → a PERSONAS block: one card per persona (name input ·
  "About" fullscreen editor via `requestPrompt` · a remove button), an "Add persona" row (name →
  slug minted client-side; a duplicate slug is refused inline), and the default = a `Seg`/select
  row "Default persona: none · Ari · The DM" (the same control shape as Conf › Agent globals'
  "Default agent"). Same draft/save-bar posture as today (`useRegisterDirty("roleplay")`, one Save
  sending the whole `roleplay: {default_tools, personas, default_persona}`).
- `AgentsEditor.tsx`: the `user_name` input → a `persona` select: "default persona" + every library
  persona by name; `FIELD_HELP.persona` reworded. Shown whenever the library is non-empty (not only
  under `rpShow`) — the owner's "regardless of the agent".
- `useAgents.ts`: `user_name` → `persona: string`. `pickRoleplay` in `useRoleplay.ts`: the new shape
  with defaults.
- Tests: `agentRoleplayFields.test.tsx`, `useAgents.test.ts`, a RoleplayEditor test (add · remove ·
  default · the whole-map save body).

#### A7. Docs
DECISIONS: the new D-entry (the ruling + the R90 evidence + the migration). ROLEPLAY_PLAN: ruling 7
(the chain), §3.2 yaml, §4.2 persona bullet, the §7 ladder gains this as-built block when built,
the seam note "the persona has no image" stays. DESIGN.md `AgentDef` field list. UPDATE_PLAN's
step table (if it lists steps). ISSUES ISS-25 → resolved. HANDOFF: release step 2 says 2→5.

### 14.2 Part B — THE NEUTRAL FRAMING (ISS-21; a D70 amendment)

#### B1. The finding
R90 §1.10-1.11: across nine peers the "not instructions" sentence appears 3 times, every one on
text neither the owner wrote nor the model produced for the task (external channel messages, fork
history, a reviewer's transcript). ZERO peers put it on a lorebook, a persona, an author's note or
an owner-configured instruction file; the RP class splices them raw or behind a NOUN LABEL
(`[Supplementary Information]`, `[{{user}} Character Profile]`, `{{user}}'s personality:`); Risu
separates information from instruction by REGION, not by disclaimer. The one written trust line
(Codex Guardian) runs by AUTHOR: owner-placed text is trusted, and "explicit owner direction extends
authorization to untrusted content" — attaching a book to an agent IS that direction. ctrl-b's
framing also says "the owner wrote", which is false for imported books.

#### B2. The ruling
Both framings become NOUN LABELS with no authority claim either way — the field's shape, and the
owner's "don't bias". The privilege gate (D8) + the confirm tokens stay the boundary in CODE (the
LibreChat "bounded" idea is what ctrl-b already enforces mechanically), so the prompt text carries
no security load. Owner-overridable through Conf › Prompts as before.
- `lorebook_intro` default → `"Lorebook — the entries that match what is being talked about:"`
  (both placements keep the one label; the head/tail split is placement, not authority).
- `persona_intro` default → `"The owner's persona — who you are talking to:"`.
- Their `description` fields rewritten: what the label frames, that it deliberately claims no
  authority either way (R90; the owner's ruling), and that the boundary is the gate in code — the
  old "the wording is the security boundary this subsystem has" sentence goes (it is no longer
  true, and it was never the field's posture).
- Core Memory's two framings (`core_memory_policy`'s "fallible data rather than instructions" +
  `core_memory_recall`) are NOT touched in this wave: their text is model-written and possibly
  tool-copied (a different author class — the one the field DOES defang), D57 records the clause as
  load-bearing (SECURITY_MODEL §2.8), and the feature ships OFF. Recorded here as the owner's call
  for Phase 19, not a default.
- No per-book `framing` field (R87's candidate): a neutral label needs no switch.

#### B3. Touch points
`prompts.py` (the two `PromptDef`s) · `ROLEPLAY_PLAN` §3.2/§4.2 persona bullet + §6.4 ("phrased as
reference…" → the label) · `SECURITY_MODEL` §2.9 one sentence (lorebook/persona text is
owner-directed context with no authority claim in the prompt; the gate is the boundary) · the
`lorebook_intro` stamp changes (a new default sha — expected) · `PROMPTS_PLAN` §list unchanged ·
ISSUES ISS-21 → resolved · DECISIONS: a D70 amendment · a test pinning that neither default contains
"not as instructions"/"not instructions" (the invariant the ruling sets), and the existing framing
tests re-aimed to the new strings.

### 14.3 Least-future-debt check
A: (a) `user_name` → `persona: {name, description}` object per agent (R87's proposal): a second copy
of the persona text per agent, no sharing, no default — a library is what the owner asked for and
what the field ships; (b) ST's shape (link on the persona, two sibling maps): the parallel-maps
trap + the rename-orphan class; (c) THIS: one map of objects, a rename-stable key, the link on the
agent beside every other per-agent switch, one resolver. B: (a) per-book framing switch: a knob to
express "no bias" that the label expresses with zero knobs; (b) THIS.

### 14.4 Amendments (Emma's blind design round, 2026-09-26 — SHIP WITH CHANGES, 6 MED · 1 LOW; ruled by the main seat)

**A-1 (Emma F1, MED 0.99 — ACCEPTED).** `agent.defaults` is an `AgentDef`-shaped inheritance base
(`config.py:393-395`, `agent_from` deep-merges it under every `agent.yaml`), so `user_name` can live
THERE too (dev's config does: `agent.defaults.user_name: ''`). Step 5 renames the key IN PLACE
wherever it appears — `agent.defaults.user_name` → `agent.defaults.persona`, every
`agents/*/agent.yaml` `user_name` → `persona` — value → the persona slug (non-empty name) or `""`
(empty): an explicit blank in an agent file stays an explicit blank (it overrides an inherited
default, and must go on doing so). `applies` = `roleplay.persona` present OR `agent.defaults.user_name`
present OR any agent file has `user_name`.

**A-2 (Emma F2, MED 0.99 — ACCEPTED; the mint moves SERVER-SIDE).** Two names that collapse to one
slug must not overwrite each other. The codebase already owns the ONE slug mint for author-chosen
text — `card_import.py::mint_slug(name, taken, *, fallback, collection)` (casefold · collapse ·
trim · suffix-walk; parameterised for agents and lorebooks "because a second copy of the rules is
how the two would drift"). Personas are its third caller (`fallback="persona"`,
`collection="personas"`); it moves out of `card_import` to a neutral home (`core/slug.py` or beside
`config._slug`) if the import boundary makes that cleaner — ONE function either way. Step 5:
exact-name reuse first (case-sensitive), else `mint_slug` against every slug already taken. The FE
never mints (`lib/agentSlug.ts` has no rule and gets none).

**A-3 (Emma F3 + F4, MED 1.0 / 0.94 — ACCEPTED, the MECHANISM CHANGES).** The nested whole-map
replacement would need a new runtime hook (`runtime.py:485-518` extracts only top-level
`providers`/`prompts`; a missed hook resurrects a deleted persona from the deep-merge), and a
whole-map Conf draft inherits the reseed trap. Both dissolve under the house rule `deep_merge`'s own
docstring states — *"editing a list/map section goes through a dedicated endpoint that handles
add/remove explicitly, never this generic merge"* (`computers` → `api/hosts.py`). So: **a
`personas` router mirroring `hosts.py`'s WRITE endpoints** — `POST /api/personas` (201; body
`{name, description}`; the server mints the slug with `mint_slug`; 409 on a slug already taken),
`PUT /api/personas/{slug}` (name/description edit; the slug never changes), `DELETE
/api/personas/{slug}` (204; NO cascade — links dangle by design and resolve to the default). Reads
stay on the settings doc (`GET /api/settings` already carries the map; every write invalidates the
settings query). `default_persona` is a scalar in `roleplay` and rides the ordinary settings PUT
(the master-switch idiom: saved immediately, no draft). The Conf editor becomes per-ROW requests —
the Automations panel's posture ("every row edit is its own request", no group draft) with
`AgentRow`'s seeded-snapshot dirty rule per card (`AgentsEditor.tsx:559-577`). No nested-replace
hook, no FE mint, no whole-map draft.

**A-4 (Emma F5, MED 0.97 — ACCEPTED).** Dangling links are LEGAL (A4) so the selectors must show
them: the agent form's persona picker renders when the library is non-empty OR the draft link is
non-empty, and a link with no matching persona gets a synthetic `missing: <slug>` option beside the
ordinary "default persona" option so it can be seen and cleared; the Conf "Default persona" control
does the same for a dangling `default_persona`.

**A-5 (Emma F6, MED 0.99 — ACCEPTED).** The touch list gains `backend/tests/test_roleplay_s0.py`
(the singular-object + three-rung + PUT-shape pins), `test_roleplay_s1.py`, `test_roleplay_s3.py`,
`config.example.yaml:362-374` (teaches the removed `roleplay.persona`), and migration tests for:
`agent.defaults.user_name` · an explicit blank override · a slug collision · no `roleplay` block
with an agent `user_name` · both fields empty (consumed, nothing minted) · a fresh config (no-op).

**A-6 (Emma F7, LOW 1.0 — ACCEPTED).** BOTH `lorebook_intro` and `persona_intro` stamps change
(each hashes its effective default template); no migration.

Emma confirmed sound: the reader inventory (only `macros_for` + `_persona_block` at runtime, both
callers hold `Settings`; the importer never touches `user_name`), one resolver, VERSION → 5 (not
amending step 4: stamped schema-4 configs exist), the step's fit with `Plan.agent_files` +
`consumes`, the slug never displayed (name is), `test_prompts_registry_p18.py` = the old-string pin
to re-aim, `lorebook_intro` carries no `{{…}}` variables, Core Memory untouched. Open sweep: none.

### 14.5 The code round (blind Emma, 2026-09-26 — DO NOT SHIP [2 HIGH · 3 MED · 1 LOW]; ruled by the main seat; the fix wave built the same session)

**F1 HIGH — ACCEPTED.** The generic settings PUT could resurrect a persona deleted through the
router: a lagging client echoing its cached `roleplay.personas` map is deep-merged back in (a merge
can only ADD). `api/settings.py::put_settings` now refuses a patch carrying `roleplay.personas` with
422 ("edited through /api/personas"), placed with the other raw-patch checks before the lock. Scoped
to the persona map: `computers` is the same class behind the hosts router, but three backend tests
seed hosts through the settings PUT — widening the guard is **ISS-30**, not done blind. Test:
`test_the_settings_put_refuses_the_library_so_a_stale_map_cannot_resurrect_a_delete` (red-proven).
**F2 HIGH — ACCEPTED.** Step 5 tested `default_persona` by truthiness, so an explicit `""` (the
owner's "none") was overwritten by the migrated global's slug — now key PRESENCE decides
(`test_an_explicit_blank_default_is_kept_over_the_migrated_global`, red-proven).
**F3 MED — REJECTED (the engine's standing rule, not S8's).** A marker below `CONFIG_VERSION` with
no applying step is not refused at boot: UPDATE_PLAN §3 refuses iff a step applies or the marker is
newer than the build, `--apply` stamps even a no-op, and `install.sh` runs it on every release — so
the marker converges on the next install. Changing that is an engine change that would refuse every
no-op upgrade until the CLI runs; outside this wave.
**F4 MED — ACCEPTED.** `roleplay.persona: ""` was refused instead of consumed: a blank string is
normalized to `null` before the refusal (a non-blank scalar is still refused); the empty-shapes
parametrize pins `null · {} · "" · "  " · {name:"",…} · {name:"  "}` (red-proven).
**F5 MED — OVERRULED.** The key rule "should be" §14.1's `^[a-z0-9][a-z0-9-]*$` — but A-2 moved
the mint server-side onto `mint_slug`, whose grammar (`SKILL_SLUG`) admits `_`; a schema narrower
than the one mint would refuse a key the server itself just minted. The as-built rule stands and
§14.1 A2 is amended in place; the wider agent-folder/hosts-rule split is **ISS-29** (pre-existing).
**F6 LOW — ACCEPTED.** §14's status paragraph said "not one line of code is written" after the
build — rewritten; the handoff is the main seat's and is rewritten at session end.
**Also in the wave (main-seat audit, before the round):** step 5 decides new-wins BEFORE the mint —
a legacy `user_name` behind an existing `persona` key (in `agent.defaults` or an agent file) is
dropped, never minted as an unlinked entry; `test_new_wins_where_both_shapes_exist` gained the `kai`
agent. Emma's sound list: the resolver + both consumers, warn-once, the hosts-style persistence and
reload, the fixed-slug PUT, the no-cascade DELETE, the FE per-row requests + default-only settings
body + `missing:` options, the legacy-reader removal, the neutral defaults with owner overrides still
winning, Core Memory untouched. **Confirm round (self-contained, the same day): SHIP — F1/F2/F4/F6
CONFIRMED, the F3/F5 rulings SOUND, no new findings, wave sweep none.**

## 15. S9 — Export (cards + books) · the referenced-by line · the post-release polish wave (designed 2026-09-26; **blind Maya design round = BUILD WITH CHANGES, 9 findings — F1–F9 folded below (F8 answered by the duties-flip rule, F9 already the plan); confirm round 2026-09-26: ALL NINE RESOLVED + three implementation guards folded ((b) IHDR/IEND lengths + type bytes · (c) the provenance predicate's int guard · (d) ISS-23 transition-only) — then a BLIND OPUS 5.5 round (owner-requested, nuances only) = BUILD WITH CHANGES, 18 findings — 17 folded inline, F2 CLOSED the ISS-26 (iii) arm on evidence; the main seat closes the council on that record; **✅ BUILT 2026-09-26 in the clean session (two pinned-Opus lanes) + the TWO-REVIEWER code round CLOSED — blind Opus 5.5 SHIP WITH FIXES [1 MED · 7 LOW] ∥ blind Maya SHIP WITH FIXES [1 MED]; 8 rulings folded, 2 overruled/docs-only; both confirms CONFIRMED SHIP — §15.12 = the as-built record**)

> Owner rulings in conversation (2026-09-26): *"we totally forgot to create an export button to export
> the card in PNG format as silly tavern and other project do … same for the lore books, we need to be
> able to export them, not just import them"* · the embedded-book rule: *"if the standard is to embed
> it in the card, we can do that, but the character and the lore book are different things … the
> character could be exported with the lore book, or without (just unlink the lore book before
> exporting)"* · ISS-24: *"don't delete lore books automatically at all, maybe say inside the lore book
> which characters reference it"* · ISS-23: build the default-tools rule. Evidence = R65 §1.6/§5,
> R66 §1/§2.5, R87 RP-4/RP-8/RP-9/RP-10/RP-11/RP-14/RP-15 (all bought; nothing re-researched).
> **Method:** everything below REUSES the import's functions — the export is the importer read
> backwards, one module beside each importer, no second PNG walker, no second alias table.

### 15.1 Scope

1. **Card export** — `agents/<slug>` (the default agent included) → a SillyTavern-compatible PNG card,
   plus the card JSON. §15.2–§15.3.
2. **Lorebook export** — `lorebooks/<slug>` → SillyTavern's standalone world-info JSON. §15.4.
3. **Referenced-by** — every book row says which agents link it (the ISS-24 ruling). §15.5.
4. **The polish wave** — ISS-22 · ISS-23 · ISS-24 · ISS-26 · ISS-27 · ISS-29 here (§15.6); ISS-15 ·
   ISS-20 · ISS-30 ride the same wave as the TODO polish slice (§15.7).
5. **The dev repair** (one-off, not product) + **the Lynette migration runbook** (API-driven). §15.8–§15.9.

Out of scope, recorded: CHARX export · the `chara-ext-asset_` sidecar (Risu-only, R66 §1.3) · the
V3 `lorebook_v3` envelope as a download (ST's own export is the raw world-info object, R65 §5.2 —
the dominant convention wins at the boundary) · persona export (D78's `user_icon` seam is unbuilt).

### 15.2 The card composer — `services/agent/card_export.py`

`compose_card(*, slug, agent: AgentDef, soul: str, sidecar: dict | None, books: list[tuple[str, Lorebook]]) -> ComposedCard(v3: dict, v2: dict, stem: str)`.
Pure, writes nothing, raises nothing owner-shaped. **The CURRENT character wins** (ST exports the live
character, `characters.js:1657-1666`); `card.json` supplies what we never mapped. **Every row below is
an explicit SET or DELETE over the base, never a conditional overlay (Opus F1):** the importer writes
empty fields as ABSENT, so "absent on the live side" is not "keep the sidecar's" — live text and list
fields are always written (`""`/`[]` included), `character_book` is DELETED at 0 linked books
(Seraphina's sidecar still holds her original Eldoria book — unlink must mean unlink), `nickname` is
DELETED when the title equals the name, `extensions.world` is SET to the embedded book's name and
DELETED at 0 books, and a card with NO sidecar (the default agent, hand-made characters) fills the
spec's required keys with empty values (`creator_notes`, `tags`, `creator`, `character_version`,
`extensions`, `group_only_greetings`).

| Card field | Source | Rule |
|---|---|---|
| everything | `sidecar["data"]` when present | the base: the whole normalized post-strip card (creator, creator_notes, tags, character_version, extensions incl. `depth_prompt`, assets, group_only_greetings, creation_date, …) + the envelope's own unknown keys beside `data` (R89/E-4) |
| `name` / `nickname` | **identity (Maya F3):** `name` = the sidecar's `name` (the character as authored) else the live `title` else the slug; `nickname` (V3) = the live `title` whenever it differs from `name` — the importer's `nickname → title` read backwards (`card_import.py:669-677`), so a retitled character exports its new title and keeps its authored name. The V2 projection has no `nickname`, so a V2-only reader sees the authored name (recorded, ST reads `ccv3` first) |
| `description` · `personality` · `system_prompt` | SOUL.md | **the SOUL rule:** if a sidecar exists AND `compose_soul(sidecar fields)` equals the SOUL **under the SOUL writer's own normalisation** (`write_text_eol` folds CRLF → LF, and the comparison ALSO folds a lone `\r` because a text-mode read's universal newlines do — Opus F13; compared against the stripped read `_read_soul` performs) → the original three values; else `description = soul`, the other two `""` (the RP-8 loss, honest: an edited SOUL is one text). *Measured 2026-09-26 on dev: both imported cards carried CRLF, both SOULs are byte-equal to the composition after that fold and NOT before — a raw byte compare would have silently taken the lossy branch.* |
| `first_mes` · `alternate_greetings` · `mes_example` · `scenario` · `post_history_instructions` | `agent.greeting` · `alt_greetings` · `example_dialogue` · `scenario` · `post_history` | verbatim (the import's mapping, inverted) |
| `character_book` | the agent's EFFECTIVE `lorebooks` list as `load_agent` resolves it (`agent.yaml` merged over `agent.defaults`, `config.py:2396-2403` — what the character actually runs with; `used_by` reads the same; never `lorebooks.books`, the install's global set) | 0 → no key · 1 → that book in the spec dialect (§15.4) · N → ONE merged book named `"<name> lorebook"`, entries concatenated in list order (our runtime already scans the linked set as one pool, §6.4) — the owner unlinks to export without |
| `creation_date` · `modification_date` (V3) | sidecar else now · now | unix seconds |
| `assets` (V3) | — | always `[{type: "icon", uri: "ccdefault:", name: "main", ext: "png"}]` — the carrier IS the icon; a CHARX import's other assets were never read and a dangling `embeded://` URI makes Risu throw (R66 §2.4; Opus F4). Recorded non-goal, not a loss |
| `spec` / `spec_version` | — | `v3` = `chara_card_v3`/`3.0`; `v2` = the V3 object minus the V3-only keys (`nickname`, `creator_notes_multilingual`, `source`, `group_only_greetings`, `creation_date`, `modification_date`, `assets`), stamped `chara_card_v2`/`2.0` — the spec's backfill (ccv3 SPEC_V3 §"backfill", pinned SHA in R66 §0) |
| the inert `card:` extra some pre-sidecar `agent.yaml`s carry | — | **never read** (it is the unmapped remainder only; §15.8 removes it on dev) |

Then `strip_executable` on BOTH parts the way the import does it (`api/agent.py:655-657` — the
envelope and `data` stripped APART, `/data`-rooted pointers for the card; Maya F1): the sidecar was
stripped at import, but the live fields are owner-typed text and the contract is one function both
ways (`card_import.py:531`, "reused verbatim on export"). `stem` = the filename stem the FE names
the download with: `title or slug`, passed through the upload-name sanitizer the media path already
owns (`lib/uploadName.ts` on the FE side — the server returns bytes only, the FE names the blob;
`Content-Disposition` is therefore NOT needed and no RFC 6266 code is written).

### 15.3 Routes + the PNG carrier

- **`GET /api/agents/{name}/card`** → the V3 JSON (`application/json`). The testable seam: every
  composition test asserts here; it is also the JSON download's payload. `allow_default=True` — the
  root agent is a character too (`default_agent_def()` + the root SOUL).
- **`POST /api/agents/{name}/card.png`** — body = the CARRIER PNG (raw bytes: the import's own
  `_import_body` reader for the cap + empty-body posture, `roleplay.card_import.max_bytes`, R73), then
  **one bounded validator `validate_png_carrier(body)`** beside `_png_chunks` in `card_import.py`
  (Maya F4/F6 — the media path's admission posture, not a signature sniff): the PNG signature, `IHDR`
  as the first chunk, every declared length inside the body, every chunk's CRC equal to
  `zlib.crc32(type + data)`, chunk-type bytes in `[A-Za-z]{4}`, `IHDR` exactly 13 bytes, `IEND`
  zero-length, present and terminal (Maya confirm (b)) — 415 on a non-PNG, 422 on a malformed one.
  The import's own walk stays as it is (it never wrote a PNG back; this route does). Server:
  `strip_card_chunks(body)` (drops any `chara`/`ccv3`
  a re-exported avatar might still carry) → append two `tEXt` chunks before IEND — `chara` = base64
  of `v2`, `ccv3` = base64 of `v3` (what ST's writer does, R66 §2.5:427-443; ccv3 first is a reader
  rule, not a writer one) → `Response(media_type="image/png")` + `nosniff`. The chunk writer is
  ~15 lines beside `_png_chunks` in `card_import.py`: `len | type | data | crc32(type+data)` via
  `zlib.crc32`; keyword bytes Latin-1 (`chara`/`ccv3` are ASCII), text = ASCII base64 — PNG 1.2 §11.3.4.3.
  POST, not PUT: a pure derivation returning an artefact, nothing is stored — and because the house
  rule is "raw-body PUT, never POST" (SECURITY_MODEL §2.7/§2.9, `putBytes`' own doc comment), the
  route earns a §2.9 sentence ("side-effect-free derivation: send-able cross-origin as text/plain,
  writes nothing, response unreadable cross-origin"), a test pinning that it writes nothing, and
  `postBlob`/`putBytes` doc comments that say why one POST exists (Opus F15).
- **Why the client supplies the carrier (the design choice):** the backend has no image codec by
  policy (`core/media.py:32-37`; MEDIA_MANAGER_PLAN §1) and a bound avatar is WebP/JPEG as often as
  PNG (Lynette's is WebP). The FE already owns the one canvas re-encode chokepoint
  (`lib/imageExport.ts`, `image/png` is an `OutputType`) — the export draws the avatar it already
  displays through it. Alternative rejected: a server-only export that works only for PNG avatars
  (two behaviours for one button). The two halves are cleanly split: the SERVER owns the card (the
  composition, the strip, the chunk write — everything security-relevant); the CLIENT owns pixels.
- **The carrier call, pinned (Opus F6):** `imageExport` with `override: {type: "image/png"}` (its policy
  never picks PNG on its own — WebP/JPEG otherwise, and the server would 415), `rect` = the WHOLE file
  (the focal point and zoom are display settings, not card pixels), `bounds` = the avatars role's
  own `FULL_ART` (4 MP; PNG takes no quality step-down, so `overBudget` is advisory); the Blob →
  `createImageBitmap` path is same-origin, no tainting; `probe()`/`checkEncoded` already catch the
  silent-canvas case.
- **No avatar:** the FE paints the same fallback the gallery shows (the initial on the accent) onto a
  512×512 canvas ON THE MAIN THREAD (a worker's OffscreenCanvas has no document fonts) — one small
  `lib/` function; ST needs an image, and a 1×1 would be a broken card.
- **Export exports the SAVED character** (the server composes from disk): the control is disabled
  while the form is dirty, labelled "save first" (Opus F7).
- **FE:** `hooks/useAgents.ts` gains `useExportCard(name)` → (avatar blob via the art hook's URL →
  `imageExport` → `postBlob("/api/agents/{name}/card.png", png)` → `downloadBlob("<stem>.png")`) and
  `exportCardJson` (`getJSON` → `downloadJson("<stem>.json")`). `api/client.ts` gains `postBlob` beside
  `putBytes`; `downloadJson` moves from `UtilCard.tsx` to `lib/download.ts` with `downloadBlob`
  (UtilCard imports it — no second blob-anchor implementation); the object URL is revoked on a
  delay (the shipped precedent revokes right after `click()`, fine for a small JSON, not for a
  multi-MB PNG — FileSaver.js waits 40 s), and the stem is passed to the sanitizer WITH its
  extension (`sanitizeStem` cuts at the last dot: "Dr. Watson" → "Dr"; Opus F14). **Button:** the agent form's
  `.mfoot` (`AgentsEditor.tsx`, the ONE footer both the default and specialists render) gains an
  `export` control offering **PNG card** and **JSON card** (kit styling; the same footer holds
  remove/save). The blob-anchor download is the shipped Android-PWA precedent (UtilCard).

### 15.4 The lorebook serializer — `services/agent/lorebook_export.py`

The inverse of `lorebook_import.py`'s `_ALIASES` / `_POSITIONS` / `_LOGIC`, two dialects from one
per-entry function `entry_out(entry, index, *, dialect)`:

| Ours | ST standalone (`dialect="st"`) | Spec `character_book` (`dialect="spec"`) |
|---|---|---|
| `keys` / `secondary_keys` | `key` / `keysecondary` | `keys` / `secondary_keys` |
| `content`, `constant` | same | same |
| `enabled` | `disable = not enabled` | `enabled` |
| `logic` | `selectiveLogic` 0 (`and_any`) / 2 (`not_any`) · `selective = bool(secondary_keys)` unless stashed | `selective` + `extensions.selectiveLogic` |
| `order` | `order` | `insertion_order` |
| `priority` | (no ST home — stashed `priority` only if it came from V3) | `priority` |
| `case_sensitive` / `whole_words` | `caseSensitive` / `matchWholeWords` (explicit booleans, never `null`) | `case_sensitive` + `extensions.match_whole_words` (+ `extensions.case_sensitive`) |
| `position` | **the provenance integer only while it is still CONSISTENT (Maya F5):** emit the stashed `extensions.position` integer iff `_POSITIONS[int][0] == entry.position` (the owner never moved the entry, so the original is the truer answer — position 0 stays 0, not 1); otherwise derive from the canonical: `head → 1` (after char — the exact landing the importer names) · `tail → 4` with `depth` = the stashed `depth` else `0` (our tail = the §4.2 slot before `post_history`; at-depth-0 is ST's nearest). One predicate, used by both dialects; it accepts only a real `int` (not `bool`) that IS a `_POSITIONS` key — anything else derives (Maya confirm (c)) | `position = "after_char"` for both (the spec's two values straddle the definitions) + `extensions.position`/`extensions.depth` carrying the ST integer as above — the lossless path ST itself reads first (R65 §5.2) |
| stash (`uid`, `comment`, `depth`, `probability`, `useProbability`, `group`, `displayIndex`, …) | re-emitted verbatim; `uid`/`displayIndex` default to the index; `comment` defaults to `name`; **the stashed `extensions` dict is DROPPED** (ST standalone files carry none; it is the stale import mirror) | `extensions` = the stashed `extensions` **overlaid** with our truth (`position`, `depth`, `selectiveLogic`, `case_sensitive`, `match_whole_words`) so a reader that trusts `extensions` first (ST, and our own importer — `lorebook_import.py:197-203`) reads what the owner has now, never the stale mirror |

**Ids never collide (Opus F3):** a stashed `uid`/`id` is kept only when it is a real int not already
used in the output; otherwise the next free int (max+1) — dev `personality-traits` runs 1..40 and a
new editor entry would otherwise overwrite a dict key silently; a MERGED book is renumbered
sequentially, `displayIndex` included (ST keys the embedded entries by `id`).
**`selectiveLogic` gets the position treatment (Opus F11):** the importer records a collapsed ST
integer (1 NOT-ALL / 3 AND-ALL) at `extensions.selectiveLogic`, and the exporter emits the stashed
int iff `_LOGIC[int][0] == entry.logic`, else 0/2 from ours; `selective = bool(secondary_keys)`
(the "unless stashed" clause was dead — `take("selective")` always consumes it).
**Spec-dialect field policy (Opus F10):** every entry emits `use_regex: false` (CCv3 requires it);
ST-native stash fields (`uid`, `displayIndex`, `probability`, `useProbability`, `depth`,
`excludeRecursion`, `addMemo`, `weight`, `group`, …) go UNDER `extensions` with ST's snake_case
crosswalk names (R65 §5.2's `originalWIDataKeyMap` list; unknown keys pass through verbatim under
`extensions`) — the spec says app data lives only there, and it is the only place ST's reader
looks; the book's own stashed extras (`scan_depth`, `token_budget`, `recursive_scanning`, a stashed
`extensions`) are carried through at the book level.
Book level: ST dialect = `{"entries": {"<uid>": …}, "name": …, "description": …}` — ST's export is
the raw internal object (R65 §5.2) and ST's import passes a native book through whole, so the two
extra keys are inert there and lossless for us. Spec dialect = `{name, description, entries: [...],
extensions: {}}` (V2 `character_book`). We emit only what we hold + the stash — no invented ST
template defaults (ST backfills missing fields itself, `addMissingWorldInfoFields`, R65 §1.1).

**Importer amendment (lossless round trip):** when `_POSITIONS` collapses an ST integer position,
the importer ALSO records that integer at `extensions.position` on the stored entry when the source
carried none there (ST's own home for it). A re-import of our ST-dialect export then restores the
exact position through the existing extensions-first read. One line at the `_entry` mapping site +
a golden test; the report line for it is folded by ISS-22's aggregation.

Routes: **`GET /api/lorebooks/{slug}/export`** → the ST-dialect object. FE: `LorebookRow`'s footer
gains `export` → `downloadJson("<book name>.json")` (ST names an imported book after the file).

### 15.5 Referenced-by (the ISS-24 ruling)

`GET /api/lorebooks` rows gain `used_by: {"agents": [slug, …], "global": bool}` from one helper
`book_references(settings) -> dict[slug, Refs]` (agents: `list_agent_names()` + each `load_agent`'s
`lorebooks`, plus the root agent's `agent.defaults.lorebooks` under `"default"`; global =
`lorebooks.books`). N small YAML reads per list call — a homelab list, cached by TanStack like the
rest. `LorebookRow` shows `used by Lynette, Seraphina` / `global` / `unused` in its header line, and
the delete confirm names the users; `invalidateAgents` also invalidates `["lorebooks"]` so the line
never goes stale after a link/unlink (Opus F16); the FE treats `used_by` as optional (the e2e fixture
rows carry none). A slug an agent names but no book holds is returned by the helper but has no book row (no ghost
rows — the S9 code round's F2); it is visible where the owner fixes it, on the agent form's lorebook
picker, which shows it ticked and marked missing.
**No delete ever cascades to a book** (owner).

### 15.6 The roleplay-side fixes (each = a rule + a test; ISSUES.md entries close with the commit)

- **ISS-22** — the import report aggregates: no line for an exact landing (`_POSITIONS[...][1] is None`
  already), the downgrade classes become ONE count line per class per book (`"12 entries sat at depth
  and landed tail"`), and the silently-inert features (probability < 100, inclusion groups,
  recursion flags, per-entry `scanDepth`, regex-looking keys) each get one per-book count line.
- **ISS-23** — built **on the duties flip** (the issue's own first option; Maya F8 showed the create
  disclosure has no character control and one should not be invented): in the agent form, flipping
  duties to `conversational` while `tools` is still the wildcard `"*"` sets the draft's `tools` to
  `roleplay.default_tools` (read from settings, the same knob the import writes, `card_import.py:668`)
  — visible in the tools list, editable before save, never applied over an explicit list, and
  **never on the default agent's form** (`!isDefault` — its save lands in `agent.defaults`, which
  every specialist inherits; Opus F5). The create disclosure is unchanged. **Transition-only by design** (Maya confirm (d)): a character that
  already sits at `"*"` today is not rewritten behind the owner's back — the issue is hand-CREATED
  characters, and the rule fires on the act of making one. ROLEPLAY_PLAN §5.5's "does NOT write"
  sentence flips to this rule.
- **ISS-24** — `_delete_agent_folder` also removes the agent's memory directory, resolved through the
  SAME resolver the memory service uses (`memory.py:_agent_memory_dir` semantics — only the default
  `memories/agents/<slug>` is removed; a custom `memory_dir` is left and reported); the response
  reports `{removed: [...], kept: {books: [...], art: [...]}, broken: {automations: [...]}}` — an
  automation pinned to the slug fails at its next fire with `AutomationAgentMissing`
  (`services/automations/service.py:157-167`), so it is named, not discovered later (Opus F16); `delete_agent`'s docstring + the FE
  confirm text (`AgentsEditor.tsx:624`) say exactly that.
- **ISS-26** — (i) the import writes `skills: []`; (ii) `_roster` is emitted only when the effective
  allowlist carries a tool that TAKES an id — the predicate maintains itself (Opus F8: "fleet tool"
  is not a category here; `action` holds `run_shell` too): any tool in `for_agent(self._tool_allow,
  self._hidden_tools)` whose `input_model.model_fields` (or `raw_schema.properties` for MCP) has
  `host_id` or `service_id` (`services/actions/_common.py:90-99`'s target inputs); the
  `_longterm_available` pattern, `session.py:703`. **(iii) is CLOSED without code (Opus F2):** `memory`
  is a CORE tool (`memory_tool.py:116`, kept through every allowlist by `for_agent`, `core/tool.py:298`),
  so every character holds it and the nudges are truthful — RP-14's premise was wrong on this arm;
  the test for (ii) runs against the real registry, never a stubbed `_tool_allowed`. No template
  conditionals — the gate is in code (§2.3).
- **ISS-27** — `Haystack.hit` matches ST (`R65 §1.6`, verified): (a)+(d) whole-word = ST's
  `(?:^|\W)key(?:$|\W)` with **ASCII** word semantics (`re.ASCII` on the boundary class — JS `\W` is
  ASCII-only, which is exactly why CJK keys match in ST and not under Python's Unicode `\w`); a key
  containing whitespace falls back to substring; (b) the haystack rows become `"<name>: <text>"`
  behind `lorebooks.include_names: bool = True` (ST's `world_info_include_names` default). Pinned
  (Opus F12): both names come from `macros_for` (`macros.py:91-99` — the persona's name, fallback
  `"User"`; the agent's title), the prefix is applied by ONE helper after the `if t` filters in BOTH
  the turn-start and the resume branch (the turn-start branch must keep the role it drops today at
  `session.py:~884`), an empty attachment-only incoming stays `""`, and assistant rows take the
  CURRENT agent's name (a multi-agent thread's older rows are approximated — recorded); (c) `constant`
  entries skip the secondary gate — R65 §1.5's precedence list is terminal per step and `constant →
  activate` sits above the key checks (the main seat's ruling over Maya's reading, 2026-09-26).
- **ISS-29** — `list_agent_names` filters with `valid_skill_slug` (the grammar the folders are minted
  under and `_agent_folder` already validates with); `_slug` stays the hosts rule.

### 15.7 The TODO polish slice (non-roleplay, same wave)

- **ISS-15** — `_ping_cmd` returns `(cmd, deadline_s)`; Windows deadline = `n*timeout + (n-1) + 1`
  with `n = max(1, count)` (the command's own normalisation); Linux/macOS unchanged; `ping_addr`
  consumes the deadline instead of computing one. Unmeasured on Windows (recorded).
- **ISS-20** — `useAgentList` retires; its FIVE consumers (`AgentsTab` ×2, `AgentGlobals`,
  `MemoryEditor`, `AutomationsPanel`, `ConfTab`) take `useAgentRoster`; the `["agentlist"]`
  invalidations go. Behaviour deltas (Opus F17): the roster is always-on (already true — the who-line reads it on every
  tab), and `useScopedQuery`'s `refetchOnMount: "always"` is given up for the roster's 30 s stale
  window (mutations invalidate, so no edit is ever stale); ten test files mock `useAgentList` and
  `tests/hooks/useSaveSettings.test.ts:120` asserts the `["agentlist"]` invalidation — all updated.
- **ISS-30** — `api/settings.py`'s personas guard becomes `ROUTER_OWNED = (("roleplay","personas"),
  ("computers",))` → 422 naming the router; the three tests that seed hosts through the settings PUT
  seed through `POST /api/hosts`.

### 15.8 The dev repair (one-off script in the session scratchpad — NOT shipped, recorded here)

Lynette + Seraphina predate the sidecar; their extracted avatars (`media/agents/avatars/lynette.png`,
`seraphina.png`) still carry the original `chara` chunk (grep-verified 2026-09-26). Per agent:
① read the chunk with `_png_text_chunks` → `_decode_card_json` → `normalize` → `strip_executable` →
`_envelope` (the import's own functions, imported from `card_import`) → `atomic_write_text
(agents/<slug>/card.json)` 0600; ② drop the inert `card:` key from `agent.yaml` through
`edit_config_yaml`/`sync_mapping` (the house writer); ③ `strip_card_chunks` the two PNGs and write
them back **through `PUT /api/media/agents/files/avatars/<name>`** with `X-Expected-Revision`, so the
library index sees the new revision; ④ re-set `lynette.png`'s focal (`x .47 · y .3 · z 2.75`): `GET /api/settings` → edit that ONE item
→ PUT the WHOLE `media.namespaces.agents.roles.avatars.files` list (the settings deep-merge
replaces lists wholesale — a one-item PUT would wipe the other three entries' order and flags; Opus
F9), quoting the index row's `revision` (`GET /api/media/agents`) as the focal's `rev`. Dev units running
(:5434). Verified by: `GET /api/agents/lynette/card` returns the original split (the SOUL rule's
first branch) and `grep -c tEXtchara` = 0 on both PNGs.

### 15.9 The Lynette migration runbook (prod v1.7.8 already has every IMPORT door; only the export is new)

Prerequisite: §15.8 done, the export built on dev. Then, all through the app's own APIs (nothing
hand-edited under `~/.ctrl-b`, the 0600/atomic writers and the focal `rev` semantics intact — Maya
concurred): ① on dev, UNLINK `personality-traits` from Lynette → SAVE → export the PNG card (no embedded
book) → relink → SAVE (the export reads disk; Opus F7); ② prod `PUT /api/agents/import` ← that PNG — **read the slug the response returns**
(the importer suffixes a taken slug, `card_import.py:581-602`; prod holds no agents today, so it is
expected to be `lynette`, but every later step uses the RETURNED slug — Maya F2) — it mints the
folder + `card.json` + the avatar `lynette.png`; ③ the book travels in OUR shape, lossless: dev `GET /api/lorebooks/
personality-traits` → prod `PUT /api/lorebooks/personality-traits` (the create-or-overwrite route);
④ the three art files byte-for-byte (the owner's crops are baked into the bytes): dev
`GET /api/media/agents/files/<role>/<name>` → prod `PUT /api/media/agents/files/<role>/<name>`;
⑤ prod `PUT /api/settings` — GET first, then the WHOLE `media.namespaces.agents` role lists with the
focal entries (each `rev` = the prod index row's `revision`) + `agent.defaults.avatar:
Banner_Patreon_Agir.webp` (Opus F9); the import-landed `lynette.png` STAYS in prod's pool with the
same focal it has on dev — dev keeps it beside the bound WebP, prod mirrors dev (Opus F18 ruled
keep, not delete); ⑥ `PUT /api/agents/<slug>` is a FULL replace (`_scaffold_agent`'s `sync_mapping`, Maya F7), so:
prod `GET /api/agents/<slug>` → merge ONLY the intended dev fields over it (`avatar`, `background`,
`lorebooks`, `tools`, `persona`, `voice`, the limits) → PUT the merged def;
⑦ verify: `GET /api/agents` shows her, the gallery renders both arts, one prod turn answers as
Lynette with the book scanning. **`agent.default_agent` is NOT set** — one tap on the gallery pill
if the owner wants her as prod's default (their call, D75). The persona is already on prod (owner).

### 15.10 Tests (the minimum that pins each rule)

Backend: `test_roleplay_s9.py` — golden round trip (import fixture → compose → byte-equal to the
fixture's `data` for an unedited SOUL; the edited-SOUL branch; the V2 projection's key set; the
chunk writer's CRC validated by re-walking with `_png_chunks` + `zlib.crc32`; the carrier's
old-chunk strip; merged-book naming; `used_by`; the lorebook two-dialect round trip incl. the
`extensions.position` restore; ISS-22 aggregation counts; ISS-24 delete report; ISS-26 gates; ISS-27
the four matching cases (a CJK key, a multi-word key, a constant+secondary entry, the name prefix);
ISS-29 an `a_b` folder listed; ISS-30 `computers` → 422). Frontend: unit tests for `download.ts` and
the fallback tile; the e2e sweep keeps its labels (the footer gains a button — no rename).

### 15.11 Lanes + council

Two pinned-Opus lanes on DISJOINT files: **BE lane** = §15.2–§15.6 backend + §15.7's ISS-15/ISS-30 +
§15.10 backend tests; **FE lane** = §15.3/§15.4/§15.5 FE + ISS-20/ISS-23 FE + FE tests, against the
API contract written into both briefs (the three routes' shapes above). Then the blind Maya code
round → fix waves to the same lanes → confirm → §15.8 → §15.9 → v1.7.9 (no config migration:
`include_names` is an additive default).

### 15.12 As-built record (2026-09-26 — the build session; the design above stands, these are the deltas)

**Lanes.** BE (`card_export.py` · `lorebook_export.py` · the PNG validator/writer beside `_png_chunks` · the
three routes · `book_references` · ISS-15/22/24/26/27/29/30 · 56 tests in `test_roleplay_s9.py`) and FE
(`lib/download.ts` · `lib/fallbackTile.ts` · `postBlob` · `cardCarrier`/`useExportCard` · the footer
"Export as" row · the lorebook `used by` line + export · ISS-20/23/24 FE · 8 new unit files + `e2e/card-export.spec.ts`)
ran in parallel on disjoint files against the route contract in both briefs. Suite: BE 2,792 · FE 4,013 · Playwright 391/391.

**Builder deviations, accepted by the main seat (each with its reason):**
- `selective` is ALWAYS `true` in both dialects, not `bool(secondary_keys)` — the importer reads
  `selective: false` as an inert gate and STASHES `keysecondary`/`selectiveLogic` instead of consuming
  them, which broke this section's own golden round trip; ST writes `true` by default and an entry with
  no secondary keys gates nothing (`_SELECTIVE`).
- A per-dialect OUTPUT-name table `_NAMES` in `lorebook_export.py` (`_ALIASES`' tuple order is not per-dialect),
  pinned by a test that every emitted name is one the importer reads; `ST_EXTENSION_NAMES` lives in
  `lorebook_import.py`, shared by ISS-22's inert-feature reader and the exporter.
- The delete report carries `kept.memory` (a custom `memory_dir` left in place); `broken.automations` = names.
- `ROUTER_OWNED` rows are `(path, router_path)` so the 422 names the router; §15.7's three re-seeded
  tests were NOT needed (nothing broke).
- Only linked books that are readable AND enabled embed (what the runtime scans). ST-dialect depth at
  position 4: top-level stash → `extensions.depth` → 0. Spec-dialect id = top-level `id` from `uid`/`id`;
  `displayIndex` → `extensions.display_index`. ST book level = exactly `entries`/`name`/`description`.
  The importer records ONLY lossy collapses. An agent whose `agent.yaml` will not load still deletes.
- FE: `useExportCard`/`cardCarrier` live in `hooks/useAgentArt.ts` (the art resolver + namespace
  constants are there; the other placement is an import cycle); one mutation with a `format` argument
  instead of a separate `exportCardJson`; `downloadName(title, ext)` shared by cards and books; the
  lorebook `export` also reads "save first" while its row is dirty; the fallback tile is `--accent` +
  `--accent-ink` (an export artefact, not a clone of the gallery's grey CSS tile), `tileInitial` takes
  the first code point (the gallery card uses it too); `del<T>` returns the parsed body for every caller
  (empty/204/non-JSON success → `undefined`); the footer `export` swaps in place to a `role="group"`
  "Export as" row (cancel / PNG card / JSON card), focus on PNG, Escape closes — no popover.

**The code round (the owner's two-reviewer rule, 2026-09-26: a blind Opus 5.5 independent reviewer AND
Maya, in parallel on the same diff).** Opus: 1 MED + 7 LOW; Maya: 1 MED. Rulings:
- **Opus F1 (MED) — a real DESIGN gap, accepted:** §15.4's "the stashed `extensions` is DROPPED in the
  ST dialect (the stale import mirror)" held only for ST-origin books; for a CARD-origin book
  `extensions` is the ONLY home of `role`/`probability`/`useProbability`/`group`/`exclude_recursion`/
  `scan_depth`/`sticky`… As built: `_st_entry` LIFTS every stashed extension key back to ST's top-level
  name via the reverse of `ST_EXTENSION_NAMES` (unknown keys keep their name) unless the top level already
  holds it or it is `_OWNED` — what ST's own `convertCharacterBook` does. Golden test added.
- **Opus F2 — docs-only:** a dangling `used_by` slug has no book row; it is visible on the agent form's
  lorebook picker (ticked, "missing"), which is where the owner fixes it (§15.5 corrected).
- **Opus F3–F8 accepted:** `kept.memory` shown in the toast (persists) + the confirm says "its memory
  folder" · `SKILL_SLUG`/`valid_skill_slug` moved to `core/skills.py` (config must not import services;
  re-exported from `services/agent/skills.py`) · the carrier `rect` follows the attachments precedent
  (`MAX_SAFE_INTEGER` square, decoded-space clamp; the header read + bitmap fallback deleted — a rotated
  JPEG is no longer square-cropped) · `use_regex` in `_OWNED` and every owned key dropped from a source's
  stashed `extensions` before the overlay · the memory-dir resolver is the public `agent_memory_dir`
  (the cross-agent custom-`memory_dir`-inside-`agents/<slug>` edge recorded, unfixed) · the test helper
  calls the route's `_compose_agent_card`, plus a pin that a global-only book and a disabled linked book
  are NOT embedded.
- **Maya's MED overruled:** the importer's `mirror.get(key) is None` treats an explicit
  `extensions.position: null` as absent and records the collapsed integer. Ruling: a null is no
  provenance (ST's writer never emits it; ST's reader `extensions?.position ?? …` and our `take_ext`
  both read null as absent), so the integer is the truer answer. Comment extended. Both reviewers
  accepted the overrule in their confirms.
- **Confirms:** Opus (context intact) CONFIRMED SHIP, F1–F8 RESOLVED; Maya (fresh `-z`, self-contained)
  CONFIRMED SHIP, all resolved, no new problems.
