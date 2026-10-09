# CONVERSATIONS_PLAN — conversations per agent + past conversations (ROADMAP A15)

**Status: ✏️ DESIGN RULED 2026-10-06 (main seat Fable 5.1 + owner, session 60) — plan v2.5; owner Q&A closed
2026-10-06 (R0–R46 + the main seat's F1–F7, N1–N4, ON1–ON7 and the privilege-cap RETRACTION, M1; council CLOSED; owner rulings F2 + ON4 RULED 2026-10-06 (A · a): F2 §2, ON4 §6); council rounds 1–2 + the confirms folded; NOTHING
BUILT.** Decision of record = [`D84`](./DECISIONS.md) (the locked summary); build = TODO **Phase 27** (§10 is the
ladder — build against this plan, NOT the TODO list); ROADMAP [§A15](./ROADMAP.md); evidence =
[`R100`](./research/R100-per-agent-conversations.md) (the peer field pass — SillyTavern, open-webui, LibreChat,
Agnai, Character.AI, the agent CLIs, Telegram/Discord/Android list UX). On conflict, DECISIONS wins; inside §1 a
later ruling overrides an earlier one.

Path shorthand: `be/` = `backend/app/`, `fe/` = `frontend/src/`. Every code citation is **function name + line**,
re-grepped 2026-10-06 at `1bd2d3f` (+ the uncommitted ASR-seat edits, which touch none of the cited lines except
`fe/hooks/useLiveCall.ts`, cited by name only). Other seats commit to this tree: if a line has drifted, the
function name is authoritative — re-grep it.

---

## §0 Stamps

> **For a build session:** this plan is the whole design — no session scratch files are needed; D84 is the
> locked summary, R100 the evidence. §1 = every ruling with its why · §2 = the model, the two principles and the
> behaviour spec (numbered scenarios B1–B19, each ending in the exact UI outcome) · §3–§9 = the data / API /
> live-status / client / UI / model-context / config contracts · §10 = the slice ladder with verify lines · §11 =
> release + rollback · §12 = what is still open (do not build an open behaviour until ruled) · §13 = the council
> record · Appendix §A = every file:line each slice touches.

| | |
|---|---|
| Design | ✏️ RULED 2026-10-06 — owner Q&A closed (R0–R46, §1) + F1–F7 (§13), owner + main seat, session 60 — plan v2.5; owner rulings **F2** + **ON4** RULED 2026-10-06 (A · a): **F2** = reading A (§2: with no override set, a responder runs on the HOME agent's AgentDef model + privilege) · **ON4** = (a) (§6: the per-home-agent overrides persist per device and survive a reload); nothing pending |
| Council | **CLOSED 2026-10-06 — Opus CONFIRMED WITH NOTES ∥ Emma CONFIRMED WITH NOTES (both on v2.2; notes folded v2.3–v2.4); the owner's F2 + ON4 rulings folded → v2.5; NO open rulings** (history: round 1 both NOT CONFIRMED, all folded → v2; round 2 confirms → v2.2; micro-confirms → v2.3/v2.4 — §13) |
| Build | NOTHING BUILT — slice ladder §10 (S0–S13), seam map Appendix §A. **Pre-build audit 2026-10-09 (session 68): NO collision, drift only — §12.1 carries the re-pins + eleven rulings; build on a `phase27` worktree branch (§12.1)** |
| DB schema | 7 → **8** (additive column + index + idempotent NULL repairs; §3, §11) |
| Config | **no new key**, no config-shape bump; the `auto_rotate` retirement drops two keys from the schema (§9, R24) |
| Retires | the D75 sticky pick + tandem rule · ISS-49 (the pick trigger AND the `/opening` route, R27) · ISS-50 · ISS-51 + ISS-52 at the boundary · the global composer draft + staged rail · the global `/privilege`·`/local`·`/cloud` session values · `auto_rotate` (§14) |

## §1 The owner's rulings (R0–R46, session 60, 2026-10-06) — each with its why

Later rulings override earlier ones; superseded clauses are struck through in place. "Owner" = ruled by the owner
in conversation; "main seat" = ruled by Fable on the evidence (code hygiene only, per R23). The council's
mechanical findings ruled by the main seat (O-/E-rulings) are folded into §2–§10 and listed in §13.

- **R0** (owner lean, made concrete by R2/R16) — TWO DOORS, no config knob: picking an agent in the tools menu /
  gallery = switch to that agent's conversation; `/agent <name>` = switch who answers inside the current one.
  *Why:* both behaviours without *"having to add another knob to the configuration"*.
- **R1** (owner) — NO one-reply `@agent` switch; the in-conversation `/agent <name>` is STICKY until switched again
  (*"I can just change back"*). *Why:* a single-message override beside a persistent switch is unintuitive.
- **R2** (main seat) — MODEL = two doors + MANY conversations per agent; a pick opens the latest-ACTIVITY one.
  *Why:* many-per-agent keeps history browsable (Character.AI resumes the latest of many, R100 §5); latest-activity is
  ONE rule with no extra state. SillyTavern instead opens the chat BOUND to the character card (R100 §1, §10.1) — a
  per-account field on its server; ctrl-b has no accounts and one owner on two devices, so a bound-chat field would
  be extra state for no gain. A behaviour toggle was rejected (no peer has one, R100 §8; it would keep every
  D75/ISS-49 residual reachable); pure per-agent (no in-thread switch) was rejected by the owner (A7's hand-off kept).
- **R3** ~~`/agent` moves `threads.agent` (re-pin)~~ → **REVERSED by R17.**
- **R4** (main seat) — `stickyAgent` RETIRES with `agentPin`, the tandem rule, ISS-49-as-pick-trigger and
  `effectiveAgent`'s sticky rung; `ctrlb.chat` is re-shaped (→ R45: `{thread, responder}`). *Why:* once picking
  navigates, a per-device pick that outranks the conversation's own agent only produces the D75 residuals.
- **R5** ~~bare `/agent` names the conversation's agent~~ → amended by **R18**.
- **R6** (main seat) — sheet rows = label + preview + time + one status dot; `GET /api/threads` gains summaries +
  `?agent=&limit=&before=`; new `PATCH`/`DELETE /threads/{id}`; a server-side cross-device seen write. ~~global
  list~~ → R19. *Why:* the owner said *"we don't have any way to go back"*; the row fields are the messenger
  convention (R100 §7) and open-webui's server-side read marker is the multi-device precedent (R100 §2).
- **R7** (main seat) — SEEN = a plain `threads.seen_at` COLUMN; `updated_at` also moves on a user send. *Why:* the
  marker is QUERIED (unread) and a later `pinned` would be SORTED on — a column, not a JSON bag; a send must lift its
  conversation even if the reply fails.
- **R8** (main seat) — LIVE STATUS = a NON-persisted `thread` frame on the EventBus; the notification signal gains
  `thread` and the TAP opens that conversation. *Why:* nothing tells the client about a conversation it is not
  viewing today; turn start/stop is not an audit fact.
- **R9** (main seat) — HOP WHILE STREAMING is allowed. *Why:* without it the model does not exist — the server
  already runs turns detached (D39); only the client refuses to leave.
- **R10** (main seat) — seam ② PINS; legacy NULL homes are BACKFILLED; `auto_rotate` (7e-g) RETIRES. *Why:* a
  conversation must belong to exactly one agent's list; with every thread pinned the auto-router has nothing to route.
- **R11** (main seat) — the ISS-50 fix ships IN this phase (§8). *Why:* under R17 another agent answering inside a
  conversation is routine.
- **R12** ~~mid-call `/agent` allowed~~ → **R20.**
- **R13** (owner-confirmed in R15) — GROUP CHATS out of scope; root + tool agents are plain rows; `session_search`
  stays global. *Why:* groups are another thread kind (SillyTavern keeps them separate, R100 §1); *"agents are agents
  regardless of their duty or role"*.
- **R14** (main seat; confirmed by R19) — the list is a `BottomSheet` from a "conversations" button in the chat header;
  tokens band, no new Surface. *Why:* a switcher one tap from the chat at 390 px (open-webui's mobile list is a
  drawer, R100 §2); only Fleet + Composer are Surfaces (THEME_ENGINE §14.14).
- **R15** (owner) — MANY per agent, the LATEST opens; group chats OUT; root/tool agents = plain rows. *Why:* *"right
  now we don't have any way to go back"* — the list is the load-bearing piece.
- **R16** (owner) — the tools-menu agent rows, the gallery Talk and the sheet rows all NAVIGATE; the ONLY
  in-conversation switch is `/agent <name>`. *Why:* one meaning per control — tapping a person opens their chat.
- **R17** (owner) — the conversation keeps its HOME agent (`threads.agent`, never moved); `/agent <name>` sets a
  RESPONDER OVERRIDE; leaving the conversation restores the home agent. Carried as today's `ChatRequest.agent`; no
  server state, no 409 mid-reply. *Why (owner):* *"it starts with Lynette, we switch to Emma, it stays Lynette's
  original conversation but switched to Emma until we change characters; going back to Lynette switches both to
  Lynette's conversation and makes Lynette the one talking again"* — moving the home agent would collide with Emma's
  own conversation.
- **R18** (main seat) — bare `/agent` names the responder and, if overridden, the home agent. *Why:* the switch is
  invisible state; the owner must be able to ask.
- **R19** (owner) — the sheet lists ONLY one agent's conversations; NO global list; the ROSTER carries per-agent
  status dots. *Why (owner):* *"every app of this style has that massive list… one list per character would be the
  best"* — the character → that character's chats shape of SillyTavern and Character.AI (R100 §1, §5).
- **R20** (owner) — in a live call BOTH switches are refused. *Why (owner):* *"confusing; there is no way to switch
  agents in the call UI anyway."*
- **R21** (main seat) — the D75 pick is replaced by R17's responder. *Why:* one override, scoped to one conversation.
- **R22** (owner) — ~~(a) reload = re-entry, the home agent talks~~ → **REVERSED by R45.** (b) `/new` while switched =
  a new conversation for the **HOME** agent. *Why (owner):* *"the session I'm seeing, the original agent's, should be
  the one modified by /new, not the other agent's — even if it is the one talking right now."* → the §2 INVARIANT.
- **R23** (owner directive) — the design must be CLEAR and FULLY SPECIFIED; behavioural ambiguities and reviewer
  findings are ruled WITH the owner. *Why (owner):* *"it can be a little bit confusing"*.
- **R24** (main seat) — the `auto_rotate` keys leave the schema with NO config-shape bump. *Why:* neither live config
  carries them; rollback stays by tag.
- **R25** (main seat) — roster status = `status {running, awaiting, unread}` per agent on `GET /api/agents`. *Why:*
  one source of truth; the roster query already exists and refetches on focus.
- **R26** (main seat) — the bus union ships; no poll fallback. *Why:* the roster dots must move with the sheet CLOSED.
- **R27** (main seat) — `PUT /threads/{id}/opening` is DELETED with its tests in the slice that retires its last
  caller; the `alt_greetings` picker re-adds a route. *Why:* no-legacy-seams — a dead route is debt.
- **R28** (main seat) — ISS-52's slug check folds into the routes slice. *Why:* one boundary fix.
- **R29** (owner) — a conversation deleted while open elsewhere: the next request 404s → a toast "this conversation
  was deleted" + the home agent's latest. No `deleted` frame. *Why (owner):* so the user is not confused.
- **R30** (owner) — seen is visibility-gated. *Why:* unread means "not yet seen by a person".
- **R31** (owner) — ONE COMPOSER DRAFT PER CONVERSATION, persisted like today's draft. *Why (owner):* *"the most sensible
  approach with several conversations at once"*; no new persistence class.
- **R32** (owner) — NO refinement owed in v1. *Why (owner):* *"I want the functionality complete first, then
  refine/redesign once I've tested it."*
- **R33** (owner directive) — this plan is SELF-CONTAINED; HANDOFF gets only a pointer. *Why:* the ASR seat is active in
  HANDOFF the same days; the build must not depend on session scratch.
- **R34** (owner) — the staged-attachment rail follows its conversation (the same keyed map + fold as the draft).
  *Why:* a photo staged in Lynette's conversation must not ride a send in Emma's.
- **R35** (owner) — a dictation finalising after a swap lands in the conversation it STARTED in. *Why:* the words were
  spoken to that conversation.
- **R36** (owner) — the header conversations button opens the HOME agent's sheet, *"always"*, whoever answers. *Why:*
  the principle below.
- **R37** (owner) — notifications name the HOME agent (*"the original agent"*), not the responder — *"keep it simple"*.
- **R38** (owner) — the tools menu's checked row = the HOME agent; the caption and backdrop = the responder. *Why:* the
  checked row says which conversation you are in; the caption says who answers.
- **THE PRINCIPLE (owner, with R34–R38):** *"always focus on the original agent of that session, regardless of the
  responder — the responder is an EXCEPTION to the rule."* → §2.
- **R39** (owner) — NO in-app toast for a background reply (*"toasts are intrusive"*): while the page is visible a
  background reply shows ONLY the dots; the OS notification stays for the hidden page. (R29's deleted toast stands — a
  one-off error notice, not a reply signal.)
- **R40** (owner, REVISED; amended by F2 + ON4, owner 2026-10-06) — privilege and local/cloud mode are CONVERSATION
  settings INHERITED FROM THE HOME AGENT, untouched by the responder: per-HOME-AGENT session overrides (~~in memory~~ →
  persisted per device, **ON4**; keyed by the home agent's slug) over the AgentDef's own `privilege`/`model`; shared by
  every conversation of that agent ~~this session~~ on this device; the turn runs at the HOME agent's effective values
  even when a responder answers; ~~reload clears~~ → a reload keeps them (**ON4**). *Why (owner):* *"which agent is
  answering shouldn't change any of that"* — the responder is an exception that must not change how the session
  behaves. Write-back to the AgentDef → **R46**. What applies to a responder when NO override is set → **F2**: the HOME
  agent's AgentDef `model` + `privilege` (reading A, §2).
- **R41** (owner) — deleting an agent OFFERS to delete its conversations (a confirm with the count); declined → the rows
  stay in the DB, unlisted (*"the list itself disappears"*); `session_search` still finds them; re-creating the slug
  re-adopts them. NO orphan listing in the root's sheet. *Why:* per-agent lists only; nothing is deleted unasked.
- **R42** (owner) — a conversation deleted elsewhere DURING a call: the call continues to its end; on hang-up R29 runs.
  *Why:* a call is never torn down by another device.
- **R43** (owner) — v1 accepts the second device's notification buzz; "cancel when seen elsewhere" is recorded. *Why:*
  R32 — functionality first.
- **R44** ~~O3 pending~~ → **answered by R45.**
- **R45** (owner) — the responder is PERSISTED per device WITH the open conversation (`ctrlb.chat` = `{thread,
  responder}`) and cleared ONLY when this device LEAVES the conversation (a swap to another conversation, `/new`, the
  delete fallback). A reload, a lock/unlock, a notification tap or a sheet-row tap for the SAME conversation keep it.
  Another device entering the conversation starts at the home agent. *Why (owner):* lock/unlock may force a reload and a
  notification tap re-enters the same conversation — *"one mechanism, not two … exactly the kind of nuance that could
  make us have different directions in the code."*
- **R46** (owner) — NO write-back of `/privilege` or the local/cloud mode to the AgentDef in v1. *Why:* ~~a persisted
  `/privilege` elevation is a durable escalation the security model deliberately avoids (today's override dies with the
  session)~~ → after ON4 an override persists on its own device, but a write-back would make it the agent's default on
  EVERY device and in every conversation — a wider durable escalation; and the agent's own defaults are already editable
  in Conf → Agents. Write-back (mode first) is recorded.
- **F2** (owner, 2026-10-06) — **reading A:** with NO session override set, a responder's turn runs on the HOME agent's
  AgentDef `model` + `privilege` (`_build_session` copies the responder with them). *Why (owner):* *"they run on the home
  agent's model and privilege, from the original session agent, because that's what I want"* — the home agent IS the
  conversation; a responder is a guest voice inside it and inherits the room's model and privilege, so a hop never
  changes what the conversation costs or may do. Reading B (the reviewers' recommendation) was heard and overruled (§2).
- **ON4** (owner, 2026-10-06) — **option (a): persist BOTH** per-home-agent overrides (`/privilege` and `/local`·`/cloud`)
  per device in `ctrlb.chat`; they survive a reload. *Why (owner):* *"both of them should be survivable for a reload"* —
  one lifetime for the conversation's exceptions, like the responder's (R45). (b) and (c) were offered; the main seat
  recommended (c) (§12). An elevation now survives reloads on that device, uncapped (§6, SECURITY_MODEL §2.2).

## §2 The model, the principles, the behaviour spec

**Two levels:** the ROSTER (agents: the tools-menu agent rows, the gallery cards) → one agent's CONVERSATIONS (the
per-agent sheet) — the character → chats shape of SillyTavern and Character.AI (R100 §1, §5); the row anatomy and the
server-side read marker come from Telegram/open-webui (R100 §2, §7). The root, a tool agent and a character are all
just agents (R13/R15).

**Two identities per open conversation:**
- **Home agent** = `threads.agent`, written once at mint (seam ① `POST /api/threads {agent}`, seam ② the lazy mint on
  a first send, the `!cmd` mint, or the migration-8 repair) and **never moved** (R17). It decides which sheet lists the
  conversation, the checked roster row, the header button's sheet, notification names, and the `/privilege` + local/cloud
  session OVERRIDES every turn runs with (R40; with none set, the home agent's own AgentDef `model`/`privilege` — F2 below).
- **Responder** = a per-device override set by `/agent <name>`, persisted with the open conversation in `ctrlb.chat`
  (R45). It decides WHO ANSWERS (persona, prompt, memory) and the caption/backdrop/who-line of its replies.

> **F2 — RULED by the owner 2026-10-06: reading A.** With NO session override set, a responder's turn uses the HOME
> agent's AgentDef `model` and `privilege` — `_build_session` copies the responder with the home agent's `model` and
> `privilege` (so Emma, configured for cloud, answers on Lynette's local model; an Emma defined `readonly` answers at
> Lynette's `auto_low`). *Why (owner):* *"they run on the home agent's model and privilege, from the original session
> agent, because that's what I want"* — the home agent IS the conversation; a responder is a guest voice inside it and
> inherits the room's model and privilege, so a hop never changes what the conversation costs or may do. **Rejected —
> reading B** (the reviewers' recommendation — the main seat, Emma and Opus: with none set each answering agent keeps its
> OWN AgentDef values, today's behaviour, so a cloud character stays cloud and a `readonly` agent stays `readonly`); the
> owner heard it and overruled it: the CONVERSATION's stance (its home agent's) governs every turn in it, whoever
> answers. There is NO privilege cap: `ChatRequest.privilege` is "most-specific-wins, no clamp"
> (`be/api/agent.py:165-170`); the only clamp is `agent.subagent_clamp_privilege` (subagent ≤ parent,
> `be/config.py:425-428`). An explicit session override (R40 — keyed by the home agent, shared by its conversations,
> sent on every turn, persisted per device by ON4, §6) still wins over the home AgentDef values.
> **Build impact:** S2's `_build_session` copy (§4 "R40").
  `effectiveAgent = responder ?? threadAgent ?? defaultAgent`.

> **THE PRINCIPLE (owner):** *the home agent is the rule; the responder is the exception.* Everything about a
> conversation — its list, its name, its checked row, its sheet, its notifications, its privilege and mode — follows
> the HOME agent; the responder changes only who answers.
>
> **THE INVARIANT (R22, owner):** *No action inside a conversation ever modifies another agent's conversations.*
> `/agent`, `/new`, a send, a rename or a delete act on the OPEN conversation (or mint one for its HOME agent) only;
> another agent's own conversation is reached **only through the roster**. The responder never becomes anyone's home.
>
> **THE RESPONDER RULE (R45):** *enter from elsewhere → the home agent; stay → the exception stays.* Leaving the
> conversation on this device (another conversation, `/new`, the delete fallback) clears it; anything that lands on the
> SAME conversation (reload, lock/unlock, a notification tap, its own sheet row) keeps it; another device starts at home.

**The doors (R16):**

| Door | Where | Does |
|---|---|---|
| **Roster** (navigate) | tools-menu agent rows (on every activation, `onPick`) · gallery Talk | open that agent's LATEST conversation (newest `updated_at`), or mint a greeted one through seam ① when it has none. Another conversation → leaving: the responder clears. **The open conversation's own HOME agent when it IS that agent's latest** → nothing reloads; the responder clears ("back to the rule" — B5). |
| **Specific** (navigate) | a sheet row · a notification tap | open THAT conversation via `openThread(id)`. Another conversation → leaving: the responder clears. The SAME conversation → nothing reloads; the responder STAYS (R45). |
| **Responder** | `/agent <name>` in the composer | set `responder` for this conversation on this device; the next send carries it. A reply already streaming finishes as whoever started it (no 409). `/agent <home>` clears it. |

`/new` opens a fresh conversation for the HOME agent (R22b) — leaving, so the responder clears.

**System notes** (the existing `pushSystemNote`; `Name` = the agent's display name = its `title`, else its slug):

| Trigger | Note |
|---|---|
| `/agent emma` in Lynette's conversation | `// Emma answers in Lynette's conversation — /agent lynette switches back` |
| `/agent lynette` there (the home agent) | `// Lynette answers again` |
| `/agent emma` while Emma already answers | `// Emma already answers here` |
| bare `/agent`, overridden | `// talking to Emma in Lynette's conversation` |
| bare `/agent`, not overridden | `// talking to Lynette` |
| `/agent emma` with no conversation open | `// Emma will answer — the conversation starts as Lynette's` (Lynette = the roster default) |
| `/agent xyz` (not on the roster) | `// agent "xyz" is not configured` — nothing changes |
| `/agent …` during a live call | `// hang up to switch who answers` — nothing changes |
| any navigate door / `/new` during a live call | `// hang up to switch conversations` — nothing changes |
| `/new` (or the sheet's "New conversation") on a conversation with no owner turn | `// this conversation is already new` |
| `/privilege full` in Lynette's conversation | `// privilege → full (Lynette, this session)` |
| `/local` (bare `/<provider>`) in Lynette's conversation | `// inference → local (Lynette, this session)` |

Navigation itself prints no note — the view visibly changes.

### The behaviour spec (canonical scenarios)

Setup: agents Lynette (the configured default) and Emma; Lynette's conversation L2 is her newest, L1 older; Emma's
newest is E1. The owner is on the phone in L2, nothing streaming, no call, chat tab on screen.

- **B1 — switch who answers.** In L2 the owner types `/agent emma`.
  → The §2 note. The tools-menu caption and the backdrop show Emma; the menu's CHECKED row stays Lynette (R38). The next
  send is answered by Emma (her who-line reads Emma; Lynette's earlier bubbles still read Lynette). L2 stays in
  Lynette's sheet with her name; its preview reads `Emma: …`. The header button opens LYNETTE's sheet (R36). The
  privilege chip shows Lynette's session value and Lynette's overrides apply to the turn (R40; without one, Lynette's AgentDef `model` + `privilege` — F2). Emma's model reads
  Lynette's earlier lines as `Lynette: …` dialogue, not as her own turns (§8).
- **B2 — `/new` while switched.** From B1 the owner types `/new`.
  → A fresh LYNETTE conversation L3 opens with Lynette's greeting; the responder is gone (leaving). Emma's conversations
  are untouched. Lynette's sheet lists L3, L2, L1. (Had L2 no owner turn yet: the "already new" note, nothing minted,
  the responder stays — the owner did not leave.)
- **B3 — pick Emma in the roster.** From B1 the owner taps Emma (tools menu or her card's Talk).
  → E1 opens (Emma's own latest), Emma talks. L2's override is gone (this device left L2). No Emma conversation → a fresh
  greeted one opens.
- **B4 — back to Lynette.** From B3 the owner taps Lynette.
  → L2 opens (her latest) and LYNETTE talks — the device entered L2 from elsewhere.
- **B5 — pick the home agent again.** In B1's state (L2 open, Emma answering) the owner taps Lynette's row.
  → L2 IS Lynette's latest: nothing reloads; the responder clears; the caption and backdrop return to Lynette; Lynette
  answers next. If instead the owner had opened the OLDER L1 from the sheet, tapping Lynette opens L2 (navigation).
  Tapping EMMA's row in B1's state is B3.
- **B6 — leave mid-reply, then the reply lands.** In L2 the owner sends; while Lynette's reply streams they tap Emma.
  → E1 opens immediately. Lynette's roster row shows the running dot. When the reply finishes:
  - page VISIBLE (the owner is in E1): the roster dot turns unread — nothing else (no toast, R39; the header button's
    dot only tracks the CURRENT home agent's other conversations, so it stays clear in E1);
  - page HIDDEN: an OS notification "Lynette finished — your reply is ready in the chat" (per the owner's F1
    notification preferences); tapping it switches to the chat tab and opens **L2 specifically**, Lynette talking
    (the device left L2 earlier), and marks it seen.
  Re-entering L2 while the reply still runs re-attaches to the live stream.
- **B7 — the sheet, and another agent's older chat.** In E1 the owner taps the conversations button.
  → Emma's sheet: Emma's conversations only, newest first, E1 marked open, "New conversation" on top. To reach Lynette's
  OLDER L1: tap Lynette in the roster (→ L2), open the header button (Lynette's sheet), tap L1 → L1 opens, Lynette talking.
  There is no all-agents list (R19).
- **B8 — rename and delete.** In Lynette's sheet the owner taps a row's `⋯`.
  → The row discloses Rename · Delete. Rename prompts for a title (empty = back to the derived label). Delete asks a
  danger confirm; on OK the row disappears; deleting the OPEN conversation opens Lynette's next latest (or a fresh
  greeted one) and carries its unsent draft + staged files into it (E6). A conversation whose turn is still running
  cannot be deleted — the server's busy answer is the note.
- **B9 — reload, and the other device.** In B1's state the owner reloads the PWA (or Android kills it in the background).
  → L2 reopens and EMMA still answers, at Lynette's persisted overrides (R45 — the device never left; ON4). The desktop opens L2 from Lynette's sheet → LYNETTE
  talks there (its own `ctrlb.chat`). Reading L2 on either device clears its unread dot on both (the `seen` frame).
- **B10 — in a live call.** During a call in L2 the owner types `/agent emma`, taps Emma in the roster, or types `/new`.
  → Each is refused with its note; the call continues in L2 with whoever answered when it started. A notification tap
  during the call only switches to the chat tab.
- **B11 — deleted while open elsewhere.** The phone has L1 open with "draft text" typed; on the desktop the owner deletes L1.
  → Nothing changes on the phone until its next request on L1 (a send, the seen write on regaining visibility, a history
  read). That request answers 404 → the toast **"this conversation was deleted"** → Lynette's latest (L2) opens, Lynette
  talking; L1's draft and staged files move into L2's composer (appended after any L2 draft, separated by a blank line);
  a send that hit the 404 lands there too, unsent.
- **B12 — deleted while open elsewhere, during a call.** As B11, but the phone is in a call in L1.
  → The call continues; utterances sent in it fail (the server answers 404; no toast, no swap). On hang-up the next
  request 404s → B11's toast + fallback (R42).
- **B13 — drafts and staged files per conversation.** The owner types "hello" in L2 and stages a photo, taps Emma (E1),
  types "hi", taps Lynette.
  → L2's composer shows "hello" + the photo chip; E1 keeps "hi". Both survive a reload. Sending clears only that
  conversation's draft and rail. A draft typed with no conversation open moves into the conversation the first send
  creates.
- **B14 — dictation across a swap.** The owner dictates in L2 and taps Emma before the transcript lands.
  → The transcript appends to L2's draft (where it started, R35); E1's composer is untouched.
- **B15 — lock, unlock, tap.** In B1's state the owner sends, locks the phone; the reply finishes; they tap the
  notification (or just unlock).
  → L2 is open, EMMA still answers, at Lynette's persisted overrides (R45, ON4); L2 is marked seen once the chat tab is visible. While the phone was locked,
  L2 stayed unread on the desktop too (R30).
- **B16 — privilege and mode per home agent.** In L2 the owner types `/privilege full` and `/local`; then taps Emma (E1).
  → E1 runs at Emma's own AgentDef privilege and model; the chip shows "Default". Back in L2 (or any other Lynette
  conversation, L1 or L3) → full + local again. In L2 with Emma answering (`/agent emma`) → the turn still runs at full
  + local (Lynette's overrides). With NO override set, Emma's turn in L2 uses Lynette's AgentDef values (F2, reading A). A reload
  keeps both overrides on this device (ON4, §6 "Overrides persist per device"); the desktop holds its own (none until set
  there).
- **B17 — no conversation open.** Fresh install (or a failed `/new` mint): the owner types `/agent emma`, then "hi".
  → The thread-less note; the send mints a conversation whose HOME is Lynette (the roster default) with Lynette's
  greeting, and Emma answers it (the responder stays — the device never left). It lists in Lynette's sheet.
- **B18 — delete an agent.** In Conf → Agents the owner deletes Emma (3 conversations).
  → After the agent-delete confirm, a second confirm: "Also delete Emma's 3 conversations?" OK → one request: if any of
  them has a reply running, NOTHING is deleted and the note reads `// 1 of Emma's conversations has a reply running —
  nothing was deleted`; otherwise the 3 conversations are deleted (one database transaction), THEN Emma's folder. The
  toast reports both steps; if the folder step failed it says so ("Emma's conversations were deleted, but her folder
  could not be removed: <error> — delete again to finish") and deleting again finishes it. Cancel → the agent is deleted,
  the conversations stay in the database, listed nowhere (no sheet, no roster); `session_search` still finds them;
  re-creating an agent named `emma` brings them back.
  - **If E1 (Emma's) was OPEN on this device** with "draft text" and a staged photo, and the owner chose OK: once the
    delete succeeds this device opens LYNETTE's (the configured default's) latest conversation (or a fresh greeted one),
    with no responder, and E1's draft + photo move into its composer (appended after its own draft with a blank line —
    E6). No "conversation was deleted" toast — the owner just did it. Another device that had E1 open finds out on its
    next request (the B11 path). *(Cancel with E1 open: see §12's main-seat reading.)*
  - **If Emma was the RESPONDER** in the open L2 (either choice): the responder clears at once — the note `// emma is gone
    — Lynette answers`, the caption and backdrop return to Lynette, the stored pair is rewritten. Another device clears
    its own Emma responder the same way when its roster query refreshes (N2).
- **B19 — the second device buzzes.** The owner chats with Lynette on the desktop while the phone is locked.
  → The phone gets an OS notification for each finished reply (R43, accepted in v1).

**Concurrency.** Turns are server-owned detached tasks (D39) with a per-thread marker (D38) and the shared
`agent.turns.max_active_turns` cap (`TurnsCfg.max_active_turns` `be/config.py:392`, checked in `_reserve_or_busy`
`be/api/agent.py:501`). Several agents on ONE local llama.cpp box run concurrently only in name: they queue on the
per-server gate (DESIGN §10).

**What does not change.** A steer carries `body.agent` into `SteerEntry` (`chat` `be/api/agent.py:1348`) and drain-B
re-routes from it (`start_steer_turn` `:787`/`:802`). Regenerate speaks as the reply's own speaker (D81 ruling ④);
resume continues as the last assistant row's agent (`resume` `:2795`). All three build through `_build_session`, so
R40's rule (§4, F2 reading A) applies to them too. Nothing re-pins a thread, so drain-B's closure over the
original `Thread` (`_spawn_drain_task` `:593` → `_maybe_spawn_drain_b` `:641`) can never hold a stale pin.

## §3 Data — migration 8 (DB schema 7 → 8) + the NULL repairs

```sql
-- migration 8 (once)
ALTER TABLE threads ADD COLUMN seen_at TEXT;
CREATE INDEX idx_threads_agent_updated ON threads(agent, updated_at);

-- the NULL repairs (idempotent — run after the version loop on EVERY connect, see below)
UPDATE threads SET seen_at = MAX(updated_at,
  COALESCE((SELECT MAX(m.ts) FROM messages m WHERE m.thread_id = threads.id), updated_at))
WHERE seen_at IS NULL;
UPDATE threads SET agent = COALESCE(
  (SELECT m.agent FROM messages m
    WHERE m.thread_id = threads.id AND m.role = 'assistant' AND m.agent IS NOT NULL
    ORDER BY m.ts DESC, m.rowid DESC LIMIT 1),
  'default')                                            -- Settings.DEFAULT_AGENT_NAME (be/config.py:2544)
WHERE agent IS NULL AND archived = 0;
```

- Migration 8 is appended to `MIGRATIONS` (`be/db.py:52`); the runner applies it + its stamp atomically
  (`Database._apply_migration`). `threads` today = `id, title, agent, created_at, updated_at, archived`
  (`be/db.py:56-63`), no index beyond the PK.
- **The NULL repairs are re-entrant (O13).** An older build after a rollback inserts threads without `seen_at`
  (`ThreadRepo.create`'s INSERT, `be/services/conversation.py:69`) and lazily mints unpinned ones; rolling forward
  finds version 8 stamped and would never revisit them. So the two `WHERE … IS NULL` statements run on every
  `Database.connect` (`be/db.py:316`) right after the version loop in `_migrate`, as a new `_REPAIRS` list beside
  `MIGRATIONS` (the framework has no such hook today — this adds it; each statement is a no-op once clean).
- **The `seen_at` backfill is exact (O8).** `MAX(updated_at, newest message ts)` — `seed_greeting`
  (`be/services/agent/greeting.py:55`) adds a row without touching `updated_at`, so `seen_at = updated_at` would wake
  every greeting-only thread unread.
- **Unread (O9)** ⇔ the newest row with `role = 'assistant' AND actor = 'agent'` has `ts > seen_at`. A `!cmd` exec pair
  (`run_user_exec` `be/services/agent/exec.py:46`: an assistant row with `actor = user` + a tool row) never counts.
  `ThreadRepo.create` writes `seen_at = created_at`; `mintAndOpen` marks a minted conversation seen as it opens.
- **`updated_at` moves on a user send too** (R7). Today only an assistant persist (`session.py:1270` → `ThreadRepo.touch`
  `be/services/conversation.py:84`) moves it. `chat` calls `threads.touch(thread.id, <owner row ts>)` right after
  persisting the owner row; `exec_shell` touches with the exec pair's `ts` after `run_user_exec` returns. Exec publishes
  no `thread` frame (it never passes through `_spawn_drain_task`).
- **Seam ② pins the HOME (O14).** `chat` mints `Thread(title=body.text[:60] or None)` (`be/api/agent.py:1324`) and never
  pins. It now mints `Thread(title=…, agent=settings.resolve_agent(None).name)` — the configured default, else the root —
  NEVER `body.agent` (which is a responder, B17). Seam ② then seeds the HOME agent's greeting
  (`seed_greeting(…, resolve_agent(thread.agent))`, replacing today's `resolve_agent(agent_name)` at `:1401`), and the
  turn runs as `body.agent or thread.agent` as today. A pinned thread is never auto-routed, so from S2 on the router
  cannot pick a greeter/answerer that differs from the pin (O25; the router itself goes in S5). `exec_shell` mints
  (`:1436`) with the same default pin.
- **Legacy homes** (R10, R41). `messages.agent` is stamped on every assistant row since migration 2 (`Message.agent`
  `be/domain/conversation.py:259`), so "last speaker, else the root" is exact. Measured 2026-10-06: dev 44 non-archived
  NULL-agent threads, prod 3. Only NULL homes are repaired: a thread pinned to a slug whose folder is gone (dev holds one,
  `probe-s1`) stays as it is — unlisted (R41).
- **Kinds.** `archived` stays the only discriminator (automation runs `runner.py:429`, subagent threads
  `subagents.py:207`); every list read defaults to `archived = 0`. No `kind` column (R13).
- **No responder column, anywhere** (R17/R45 — the responder is per device, client-side).

## §4 API

**`GET /api/threads`** (`list_threads` `be/api/agent.py:1190`). The response stays a JSON ARRAY of `Thread` dumps.
Without `agent=` it is today's plain list (the readers `initChat` `fe/store/chat.ts:951` and `fetchThreadAgent` `:832`
keep working, and pay no summary cost — O24). With `agent=<slug>` (exact HOME match) every row gains:

| Field | Definition |
|---|---|
| `label` | `title` if set; else the first line of the FIRST user row's text, whitespace-collapsed, cut at 60 characters; else `null` (the client renders "New conversation"). Needed because every seam-① thread is untitled forever today (prod 4/4, dev 6/6 character threads `title NULL`). |
| `preview` | `{role, agent, text, ts} \| null` — the NEWEST user/assistant row with non-empty text (tool-only rows skipped); `text` = its `messages_fts` text by `rowid`, whitespace-collapsed, cut at 120 characters; `agent` = that row's `messages.agent` (null for user rows). |
| `running` | a live task-bearing handle in `state.turns` (the `turn_status` predicate, `be/api/agent.py:928`). |
| `awaiting` | a parked confirm/question (`MessageRepo.with_call_states`, `be/services/conversation.py:323`) whose call came AFTER the thread's last owner row — the rule `notifyRestoredAwaiting` already uses (`fe/store/chat.ts:403`); no TTL (ON3, supersedes O20). An abandoned call is by definition followed by an owner row, so it drops out; a live one stays until answered. |
| `unread` | the §3 predicate. |

Params with `agent=`: `limit=<n>`; `before=<updated_at ISO>,<id>` (keyset for `ORDER BY updated_at DESC, id DESC`, built
by the client from its last row). The roster door's "latest" = `?agent=x&limit=1`; the sheet pages with `limit=50`. One
repo pair: `ThreadRepo.list(include_archived, agent, limit, before)` (`be/services/conversation.py:102`) +
`ThreadRepo.summaries(rows, turns)` — the ONLY definition of the five fields (R25 reuses it).

**`PATCH /api/threads/{id}`** — body `{title?: string | null, seen_at?: datetime}` (pydantic, `extra="forbid"`), the
per-item update object. `title`: trimmed, `max_length=120`; `""`/`null` clears it. `seen_at`: the `ts` of the newest row
the client's view holds; stored as `max(stored, min(given, now))` (monotonic; a reply landing between render and write
stays unread). A `seen_at` that moved publishes a `thread` frame `{state: "seen"}` (§5, O10). Answers the updated row
with the five fields. **Unguarded** (neither field is model context nor races a turn) — through `ThreadRepo.set_title(`
/ `ThreadRepo.set_seen(`, never `db.execute(` in the route; the `_MUTATION_MARKERS` comment records why. 404 for an
unknown or archived id.

**`DELETE /api/threads/{id}`** — `_reserve_turn(request, id, "edit")` (409 busy while a turn runs) →
`_revalidate_thread(state, id)` (404 gone · 403 an automation's rolling conversation, `be/api/agent.py:473`) → a 404 for
`archived = 1` (checked after the reserve too — `_revalidate_thread` does not check `archived`; E10) →
`ThreadRepo.delete` (`be/services/conversation.py:113`: cascades messages/FTS/alternates, removes the attachment dir) →
release in `finally`. Answers `{deleted: true}`.

**404 instead of a silent mint (R29).** Today `chat` (`:1315-1324`) and `exec_shell` (`:1432-1436`) treat an UNKNOWN
`thread_id` like an absent one and lazily mint a NEW thread. Both now answer `404 unknown thread '<id>'` when `thread_id`
is supplied but unknown; the lazy mint stays for an ABSENT `thread_id`.

**R40 — the home agent's overrides (F2 = reading A, owner 2026-10-06).** The client always sends the HOME agent's session
overrides (§6, persisted per device — ON4) — `privilege` and `mode` — never the responder's; `resolve_session_agent`
(`be/api/agent.py:309`) applies an explicit `privilege` as today. `_build_session` (`:321`, ladder `:350`) resolves the
answering agent as today (`name = agent_name or thread.agent`); when a thread exists and the resolved agent differs from
`thread.agent`, it is copied with the HOME agent's `model` (`AgentDef.model`, `be/domain/agent.py:250`) and, absent an
override, its `privilege` (`AgentDef.privilege`, `:258`). (Reading B — no copy, the responder keeping its own values —
was rejected by the owner, §2.) `mode` (a `/<provider>` name, `ChatRequest.mode` `:162`) is sent from the home agent's slot. One place, so
chat, resume, regenerate and drain-B steers all obey it.

**Guard invariants.** `backend/tests/test_turn_guard_invariant.py`: `_EXPECTED` (`:93`) gains `delete_thread` and `delete_agent`
(F6) (each must call `_revalidate_thread(` after its reserve — both tests assert the SAME set); `_MUTATION_MARKERS` (`:40`)
gains `threads.delete(` and `threads.delete_many(` (`chat`'s D68 cleanup at `be/api/agent.py:1394` already reserves). In S7 `reseat_opening` leaves
`_EXPECTED` and `threads.set_agent(` leaves the markers (R27). `backend/tests/test_arch_invariants_qh9.py`
`test_api_422s_go_through_the_safe_validation_renderer` holds for the PATCH body.

**Unchanged.** `POST /api/threads` (`create_thread` `:1205`, seam ①) — D70 §4.2 as is. `ChatRequest.agent` (`:164`) is the
RESPONDER rung; `null` = the home agent. **There is NO re-pin route** (R17).

**Deleted — `PUT /api/threads/{id}/opening`** (`reseat_opening` `:1236`, R27). S7 deletes, with its last caller: the
handler + `ReopenRequest`, `ThreadRepo.set_agent` (`be/services/conversation.py:89`, only caller `be/api/agent.py:1289`),
`backend/tests/test_iss49_reopen.py`, and the two turn-guard pin entries.

**ISS-51 + ISS-52 at the boundary.** `Settings.resolve_agent` (`be/config.py:2675`) falls an unknown name back to the
ROOT; after this phase `/agent` accepts roster names only, and a conversation whose home folder vanished is shown as the
root by the client too (one fallback — ISS-51). ISS-52 (R28): `_load_agent_folder` (`:2635`) returns `None` for any name
failing `valid_skill_slug` (`be/core/skills.py:32`) unless it is `DEFAULT_AGENT_NAME` — `list_agent_names` (`:2656`)'s
grammar — so `..` or `/etc` resolves like any unknown name.

**Roster status (R25).** `GET /api/agents` (`list_agents` `:1674` → `_list_agents_payload` `:1622`) answers `{agents,
default, default_set, summaries: {<name>: {…}}}`. Each `summaries[<name>]` (the root under `default`) gains `status:
{running, awaiting, unread}` = OR over that agent's non-archived conversations, computed by `ThreadRepo.summaries` — one
per-item object, not a sibling map. `list_agents` composes it after the settings read.

**Agent delete (R41, F6, N4) — server-side, one request, NOT atomic across stores.** `DELETE /api/agents/{name}` (`delete_agent` `be/api/agent.py:2236`)
gains `?conversations=true`. Without it: today's behaviour (the folder + default memory dir go, nothing else cascades;
the agent's conversations stay, unlisted; an absent folder → today's 404). With it:
0. **Resolve first:** the folder is looked up BEFORE anything is reserved; an absent folder is not an error (step 4).
1. **Guard pass** over every non-archived thread with `agent = name`: `_reserve_turn(request, id, "edit")` each; any
   busy (a running turn) or `_revalidate_thread` refusal (403, an automation's rolling conversation) → release every
   marker taken, answer **409** `{"detail": "<k> of <name>'s conversations are busy — nothing was deleted", "busy": k}`.
2. **One DB transaction:** `ThreadRepo.delete_many(ids)` (new, beside `delete` `be/services/conversation.py:113`) deletes
   the rows (messages/FTS/alternates cascade) in ONE `Database.transaction()` and COMMITS.
3. **Then the filesystem, best-effort:** each deleted conversation's attachment dir (`remove_thread_attachments`,
   `be/core/attachments.py:919`) and today's `_delete_agent_folder` (`be/api/agent.py:1846`: the folder, then the slug's
   DEFAULT memory dir `memories/agents/<slug>`). The database and the filesystem cannot share a transaction, so a failure
   here is NOT rolled back: each failure is logged AND surfaced — the answer is `{deleted: n, folder: "ok" | "absent" |
   "<error>", memory: "ok" | "absent" | "<error>", attachments: "ok" | "<error>", …today's report}`. Markers are released
   in `finally`.
4. **Recovery (M1) — truthful:** *a retry completes the AGENT side; orphaned attachment dirs are reclaimed by the boot
   sweep.* With `?conversations=true` the route is idempotent for what it can still name: a re-run finds no conversations
   (step 2 is a no-op), removes the agent folder if it remains, and — when the folder is already ABSENT (`folder:
   "absent"`) — explicitly removes the slug's default memory dir `memories/agents/<slug>` if it still exists (today's
   helper returns early on an absent folder, `:1858-1859`, so this is a new explicit step). A re-run CANNOT rediscover a
   deleted conversation's attachment dir (its row is gone): those are reclaimed by the EXISTING boot sweep's rowless-dir
   arm (`sweep_thread_dirs`, `be/core/attachments.py:1017`, run from the lifespan via `attachments_sweep`,
   `be/main.py:381`). No reversible-rename machinery.
The client (`AgentsEditor` confirm `fe/components/AgentsEditor.tsx:658` → `useDeleteAgent` `fe/hooks/useAgents.ts:333`)
counts first with `GET /api/threads?agent=<name>` (the array length — non-archived only), and when non-zero asks the
second confirm with the count; OK → the flag; Cancel → no flag. The toast reports `deleted` and any step error (with
"delete again to finish"). **When the deleted agent is the OPEN conversation's home and the flag was sent (N3):** the
delete's own success handler — NOT the remote-delete 404 path, whose `openAgentConversation(threadAgent)` target is the
deleted slug — runs `openAgentConversation(defaultAgent)` (the configured default's latest, else a fresh greeted one; no
toast), which clears the responder, and carries the open conversation's draft + staged rail into it by E6's rule.
**Turn guard:** `delete_agent` joins `_EXPECTED`
(`:93`; it reserves and revalidates in that order) and `ThreadRepo.delete_many(` / `threads.delete_many(` joins
`_MUTATION_MARKERS` (`:40`).

## §5 Live status — the `thread` frame (R8, R26, R39)

- **Producer.** `_spawn_drain_task` (`be/api/agent.py:593`) publishes `{thread_id, state: "running", turn_id, agent,
  chained: false}` after `create_task`. Its `_cleanup` publishes the terminal frame LAST — after `release` (`:623`) and
  after `_maybe_spawn_drain_b` (`:635`), which now returns whether it spawned a turn — with `state =
  handle.terminal_status` (`completed` · `suspended` · `capped` · `error` · `cancelled`) and `chained = <drain-B spawned>`
  (O29). `ThreadRepo.set_seen` (via PATCH) publishes `{thread_id, state: "seen", agent}` (O10). `agent` = `thread.agent`
  (the HOME agent). `archived` threads publish nothing (automation runs keep their Event + `read_at` path); exec publishes
  nothing (§3). Never persisted.
- **Bus.** `EventBus` (`be/core/events.py:20`) widens to `Event | ThreadFrame` (a small pydantic model in that module);
  `stream_events` (`be/api/events.py:37`) renders a `ThreadFrame` as `{"event": "thread", "data": <json>}` with **no `id`**,
  beside today's `event: "event"` frame (`:63`). DESIGN §12 gains the frame.
- **Consumer** (`useEventStream`, `fe/hooks/useEvents.ts`): every `thread` frame invalidates `['threads']` (all agent keys)
  and `['agents']`. A terminal frame whose `thread_id` is not the open view's, and is not `chained`:
  `completed`/`capped`/`error` → `notifyTurnTerminal(thread_id, turn_id, state)` (`fe/store/chat.ts:354`, exported — the
  ONE definition; its key `turn-done:<notifyScope(thread)>:<turn>` (`:369`) equals the open view's, so no duplicate);
  `suspended` → an `agent_input` signal keyed `agent-input:<thread>:<turn>`; `cancelled`/`seen` → nothing. On reconnect
  (`reconcileChat` `:2613`) both queries refetch.
- **Visible vs hidden (R39).** No in-app toast for a background reply. `shouldNotify`
  (`fe/hooks/useForegroundNotifications.ts:94`) already drops every signal while the page is visible — kept: visible ⇒ the
  dots only; hidden ⇒ the OS notification. (A live call still suppresses `turn_done`, `:91`.)
- **Names (R37).** Every agent-class signal's title names the conversation's HOME agent: "Lynette finished" · "Lynette
  stopped" · "Lynette hit the step limit" · "Lynette needs approval" · "Lynette has a question" (today: "The agent …" /
  "Approval needed", `chat.ts:306-381`); bodies unchanged; a vanished home → its slug.
- **The tap — four seams (O2).** (1) `NotifySignal` (`fe/lib/notifyBus.ts:23`) gains `thread?: string`, set by every
  agent-class signal; (2) `show()` puts it in `options.data` (`useForegroundNotifications.ts:204`, today `{focus, key}`);
  (3) `public/notify-sw.js` posts it back (`:34`, today `focus` only) and, with no live client, opens
  `/?tab=agent&thread=<id>` (`:46`); (4) the page listener (`:145`) and the constructor `onclick` pass it to
  `applyNotificationFocus(focus, thread)` (`:170`), which switches to the chat tab and then, unless `callLive()`, calls
  `openThread(thread)` (the Specific door). Cold start: `consumeThreadParam` beside `consumeTabParam` (`fe/store/ui.ts:291`)
  accepts only `/^[0-9a-f]{32}$/` (a `Thread.id` is a uuid4 hex), strips it from the URL, and `initChat` opens it in
  preference to the stored thread when it lists.
- **The header button dot** = any conversation of the CURRENT home agent, other than the open one, with
  `running || awaiting || unread` (from `['threads', home]`). Other agents' activity shows on the roster dots only.
- **Second device** (R43): every device not viewing the conversation notifies when hidden — accepted; "cancel when seen
  elsewhere" (the `seen` frame is the seam) is recorded, not built.

## §6 Client

**`ChatState`** (`interface ChatState` `fe/store/chat.ts:35`): `stickyAgent` → **`responder: string | null`**, beside
`threadAgent` (the home agent). `sessionPrivilege` (`:42`) → **`overrides: Record<string, {privilege?: Privilege; mode?:
ChatMode}>`** keyed by HOME agent slug, persisted per device in `ctrlb.chat` (ON4 — "Overrides persist per device"
below; this supersedes the pre-ruling "never persisted" contract for privilege, SECURITY_MODEL §2.2 records it); the
module-level `sessionMode` (`:483-491`) folds into it.

**`ctrlb.chat` = `{thread: string | null, responder: string | null, overrides: {<home slug>: {privilege?, mode?}}}`**
(`KEY` `:71`, today `{agent}`; R45 + ON4). One load-boundary fold: a blob without a string `thread` loads as `{thread:
null, responder: null}` (the `overrides` map is type-guarded entry by entry, below); the old `agent` key is never written
again. Written by every view change — `swapView` (`:783`) AND `setWireThread` (`:558`, the lazy-mint path, O23) — by
`setResponder`, and by every override writer. **Boot — ONE rule (`initChat` `:943`, N1):** load the stored `{thread, responder}` pair
first; the TARGET = a validated `?thread=` (§5) if present, else the stored `thread`. If the target lists in
`GET /api/threads`: open it, and keep the stored `responder` ONLY when target === stored `thread` AND the responder is on
the roster (a notification tap on the conversation this device was in = the device never left); a different target =
the device LEFT → no responder. Else `threads[0]` with no responder, else a thread-less view (a stored responder survives
there only if the stored `thread` was null). The pair is rewritten after boot.

**A responder that leaves the roster (N2).** Whenever the roster changes — a local agent delete, or the `['agents']` query
refreshing after a delete on another device — a `responder` whose slug is no longer listed is CLEARED at once: the
persisted pair is rewritten, the caption/backdrop return to the home agent, and the note `// <slug> is gone — <Home>
answers` prints. Never a silent root fallback while the UI still shows the old name.

**The responder lifetime (R45).** `swapView` clears `responder` ONLY when the new view's thread ≠ the old one (leaving).
`openThread`'s same-id branch (`:887-891`, no `swapView`) keeps it — so a notification tap or a sheet-row tap on the open
conversation keeps it. `openAgentConversation(home)` on the open conversation's own home agent when it is the latest
clears it in place (B5). `/new` clears it (it swaps). The delete fallback clears it.

**Hop while streaming** (R9). `swapView` does `++streamGeneration` (`:248`); the refusals drop — `openThread`'s pre- and
post-fetch `getChatStatus() === "streaming"` checks (`:883`, `:905`) and `startNewThread`'s (`:1222`). **The adopt guard
(O6):** `streamTurn` (`:1842`) captures `enteredOn` (the view's thread id) and the swap generation BEFORE its `fetch`
(`:1860`); at the adopt point (`claimStream` `:249`, called at `:2036`), in the reducer's `case "thread"` (`:1653` →
`setWireThread`) and in the buffered branch (`:1973`) it refuses to adopt when the view moved — the turn simply continues
server-side as a background conversation. The POST is never aborted (the server may already hold the message).
**`dropAllRaw` (O22):** `swapView` stops pruning every thread's raw steer lines (`:788`); steers belong to their thread —
only the view's optimistic queue is dropped; a thread's raw lines go with its own harvest/turn end.

**Shared mint + navigation.** `startNewThread` (`:1218`) splits into `mintAndOpen(agent: string)` and the `/new` wrapper.
**The fence (O7):** `mintAndOpen` keeps only the supersession check (`openSeq`, `:114` — a newer navigation wins); the
old post-await silent returns on "streaming" or a changed user-turn count (`:1276-1278`) are removed. `openAgentConversation
(name)` = `GET /api/threads?agent=name&limit=1` → the open view's id → B5 in place; another id → `openThread(id)`; none →
`mintAndOpen(name)`. `/new` (`fe/lib/composer.ts:418`) = `mintAndOpen(threadAgent ?? defaultAgent)` (R22b) with the ISS-31
no-op rule (no owner turn → the "already new" note, nothing else). `mintAndOpen` always names an agent.

**Doors** (R16, R38, O4). Tools-menu `AgentRow` (`ToolsMenuSheet.tsx:226`) fires `openAgentConversation` from `onPick`
(`onClick` `:249` — every activation, the already-checked row included), never the radio's `onChange` (`:250`, change
only). The checked row = the open conversation's HOME agent (it reads as "the conversation you are in"); the caption =
the responder when set. Gallery `talk` (`fe/tabs/AgentsTab.tsx:226`) → `openAgentConversation`. Sheet rows (§7) and the
notification tap (§5) → `openThread(id)`. `/agent <name>` (the `agent` verb, `composer.ts:368`) → `setResponder(name)`:
roster names only; `name === threadAgent` → clear; then the §2 note. **`sendMessage`** (`chat.ts:2799`) sends `agent =
responder` (`:2831`), `privilege = overrides[home].privilege`, `mode = opts.mode ?? overrides[home].mode` (`:2825`) where
`home = threadAgent ?? defaultAgent`.

**Overrides (R40).** `/privilege <lvl>` (`composer.ts:377-394`), the `PrivilegeChip` (`fe/components/PrivilegeChip.tsx`)
and bare `/<provider>` (`composer.ts:686`) write `overrides[home]`; `home` with no conversation = `defaultAgent`. The chip
shows `overrides[home].privilege` (else "Default" = the home AgentDef's own). Resume/answer payloads re-send the same
home privilege (today's carry rule). A one-shot `/<provider> msg` stays per message. `/privilege` is uncapped
("most-specific-wins, no clamp", `be/api/agent.py:165-170`; the only clamp is `agent.subagent_clamp_privilege`, subagents).

**Overrides persist per device (ON4, owner, 2026-10-06).** *"Both of them should be survivable for a reload."* The
`overrides` map rides in `ctrlb.chat` beside the responder, type-guarded on load (a non-object, or an unknown
privilege/mode value, drops that entry — never the blob). Overrides stay keyed by the HOME agent and survive navigation
and reloads; they are cleared ONLY by `/privilege` bare / `default`, the chip's "Default", bare `/<provider>` back to the
default chain, and the HOME agent leaving the roster (its slot pruned in the N2 sweep, so a re-created slug never
inherits an old elevation). Clearing a deleted RESPONDER never touches the home agent's slot. This supersedes the
pre-ruling "never persisted" contract for privilege: an elevation survives reloads on that device, uncapped (no clamp
exists, above) — D84 and SECURITY_MODEL §2.2 record it, and §11 states the rollback behaviour. The chip shows the live
(persisted) value. B9/B15: "Emma still answers, at Lynette's persisted overrides."

**`effectiveAgent`** (`composer.ts:189`) = `responder ?? threadAgent ?? defaultAgent`, a home not on the roster shown as
the root (ISS-51). Readers: `useActiveAgent` (`fe/hooks/useActiveAgent.ts:31`), `useActiveBackdrop`,
`store/composerSkills.ts`. Who-line rows read each row's own `agent`.

**Seen write** (R30, O11). `PATCH {seen_at: <ts of the newest row in view>}` after a conversation's history lands, when a
turn settles in the open view, and on regaining visibility or switching back to the chat tab — each ONLY while
`document.visibilityState === "visible"` AND the chat tab is on screen (`ui.tab === "agent"`, `fe/store/ui.ts`). On success
it invalidates `['threads']` and `['agents']` locally (O10).

**Deleted elsewhere** (R29, R42, E6). A thread-scoped request on the OPEN conversation answering 404 — `sendMessage`, the
seen PATCH, `fetchMessages` (`:811`) — while NOT in a call → `pushToast("this conversation was deleted")`
(`fe/store/toast.ts:41`) → `openAgentConversation(threadAgent)` → the dead conversation's draft, staged files and any
unsent send text move into the slots of the conversation that opened (appended after its own draft with a blank line;
staged files appended to its rail). During a call the 404 is latched (no toast, no swap); `endCall`
(`fe/store/liveCall.ts:58`) runs the R29 path once. (`turn_status` answers `{active:false}` for an unknown thread — not a
404 source, O21.)

**Drafts and staged files — one per conversation** (R31, R34, R35). Today: ONE global draft — `fe/store/composer.ts`
`{draft}`, persisted per device in `localStorage` key `ctrlb.composer` via the D23 `store/persist` chokepoint — and ONE
global staged rail — `fe/store/attachments.ts` `{files}`, key `ctrlb.attachments` (`:77`), same chokepoint. The new
shapes, same persistence:
- `ctrlb.composer` → `{drafts: Record<string, string>}`; `ctrlb.attachments` → `{rails: Record<string, PersistedFile[]>}`;
  both keyed by thread id, key `""` = the thread-less view. One load-boundary fold each: the legacy single value loads
  under `""`; the old shapes are never written back.
- A non-persisted `slot` per store, set by `swapView` and `setWireThread` via `setComposerSlot(threadId ?? "")` (chat →
  composer/attachments, the direction the imports already run, `chat.ts:26`). The stores' public functions keep their
  signatures and act on the current slot — `useComposer`, `lib/composer.ts`, `useLiveCall`, `useAttachments` unchanged.
- `appendDraft(text, sep, slot?)`: `harvestToDraft(threadId, …)` (`chat.ts:2658`) passes its own thread; `useDictation`
  captures the slot when a dictation STARTS and passes it to its `appendDraft` calls (`fe/hooks/useDictation.ts:746`,
  `:1188`) (R35).
- An empty draft / rail deletes its key; a deleted conversation's slots move per "Deleted elsewhere" or are dropped
  (B8 deletes its own open conversation → moved; a non-open row deleted from the sheet → dropped); when the view becomes a
  conversation whose slots are empty and `""` holds content (a lazy mint, `mintAndOpen`), it moves in.

**Live call** (R20). `openThread`, `mintAndOpen`, `openAgentConversation` and `setResponder` return early with their §2
note while `callLive()` (`fe/store/liveCall.ts:78`). Without it a swap would `clearAudioCache()`
(`fe/lib/audioController.ts:1600`, the mouth) and the next utterance (`sendCallTranscript` `composer.ts:618`) would land
elsewhere.

**Retires** (§14): `setStickyAgent` (`chat.ts:510`), `writeSticky` (`:516`), `readStickyAgent` (`:79`), `useStickyAgent`;
`setSessionPrivilege` (`:572`) and `setSessionMode` (`:484`) as global setters (→ the `overrides` writers);
`pinStickyAgent` + its edited-greeting confirm (`composer.ts:336`), `agentPin` (`:215`), `validStickyAgent` (`:158`);
`startNewThread`'s `keepAgent`/`defaultAgent` options and its mid-mint re-seat tail (`chat.ts:1296-1306`); the ISS-49
client half — `wouldReseat` (`:3467`), `conversationStarted`, `openingEdited`, `reseatOpening` (`:3501`), the parked re-run
in `syncMessageRoute` (`:3174`); `resetToThreadless`'s sticky parameter (`:802`). Their tests go with them.

**Query vs store.** DESIGN §13 is amended: the thread LIST is ordinary server state (`useQuery(['threads', agent])`, new
`fe/hooks/useThreads.ts`); MESSAGES stay in `store/chat.ts` with the SSE reducer.

## §7 UI

- **The trigger.** The three chat bodies render the same `.sec` header with `PrivilegeChip` in `.right` — `AgentTab`
  (`fe/tabs/AgentTab.tsx:66`), `FrontierAgent` (`fe/themes/frontier/FrontierAgent.tsx:109`), `GachaAgent`
  (`fe/themes/gacha/GachaAgent.tsx:389`). FIRST factor that cluster into `fe/components/ChatHeaderActions.tsx` as a
  no-visual-change step, THEN add the button once: a hand-inlined lucide `messages-square` icon,
  `aria-label="Conversations"`, with the §5 dot. It always opens the HOME agent's sheet (R36; thread-less → `defaultAgent`).
- **The sheet** (`fe/components/ConversationsSheet.tsx`) — `BottomSheet` (`fe/components/BottomSheet.tsx:112`, peek →
  full). Header: the home agent's `FocalFace` + display name. First row: "New conversation" (= `/new` for this agent;
  on a conversation with no owner turn → the "already new" note and the sheet closes, O28). Then rows newest first, the
  open one marked; "Show older" while a page came back full. Every root renders under `DefaultRoot`'s `.kit`
  (`fe/theme-engine/kit/DefaultRoot.tsx:359`; vapor via `fe/themes/vapor/VaporRoot.tsx:57`).
- **Row anatomy** (R100 §7): label (one line, ellipsis) · preview (one line; `Name: ` when the speaker is not the home
  agent, `You: ` for the owner) · trailing `relativeTime` (`fe/lib/relativeTime.ts:6`) · one dot, priority needs-you
  (`--warn`) > running (`--ok`, pulsing only when UIState `motion` allows, `fe/store/ui.ts:62`) > unread (`--accent`) · a
  trailing `⋯` button. Tap = `openThread(id)`; the sheet closes.
- **Rename / delete.** `⋯` discloses an inline actions row (the D81 `.who-acts` precedent, `fe/components/chatAttribution.tsx`):
  Rename → `requestPrompt` (`fe/store/prompt.ts:60`); Delete → `requestConfirm` (`fe/store/confirm.ts:25`, danger).
- **Roster dots** (R19, R25) on the tools-menu agent rows and the gallery cards, from `summaries[name].status` on the
  `['agents']` query (`useAgentRoster` `fe/hooks/useAgents.ts:202`); same states and priority.
- **Tools-menu semantics (O4, R38).** The agent section stays a radio group for its look, but each row navigates on
  activation; its accessible description says "open <Name>'s conversation"; the checked row = the open conversation's home.
- **Theme engine.** The TOKENS band under `.kit` (`fe/theme-engine/kit/kit.css`), no new Surface (THEME_ENGINE §14.14);
  VAPOR_PATTERNS §11–§13 govern the net-new sheet/row/dot (390 px first, transform/opacity motion only).
- **The call UI** offers neither switch (R20).

## §8 ISS-50 — foreign turns read as dialogue (R11, O19)

`AgentSession._assemble` (`be/services/agent/session.py:1016`) emits every assistant row as a plain assistant turn (the
per-row loop from `:1057`) whoever wrote it, so after `/agent emma` Emma reads Lynette's lines in her own voice slot.

**The peer shape** — SillyTavern groups (`` `${name}: ${content}` ``, R100 §1), Agnai (`${prefix}: ${msg}`, §4),
open-webui Channels (`Name: content`, §2): the speaker's name goes INTO the content. An assistant row whose `agent` is set
AND differs from the answering `self._agent.name` is FOREIGN:
- **The fold (ON2):** walk the history once and collapse each maximal RUN of consecutive owner `user` rows and foreign
  text-only rows into ONE `user` message, in order: a foreign row contributes `Name: <text>`, an owner row its own text
  UNPREFIXED, members separated by a blank line. A run is bounded by the responder's own assistant rows, by a foreign
  tool-call row (below) and its `tool` results, or by the head. When a member carries attachments the merged content is a
  part array — the text parts and the owner's image parts in member order. This also collapses today's owner/owner runs (a
  send whose turn failed before any assistant row), so user/assistant alternation holds for every history whose only
  system row is at the head. A system row MID-history would break a run; today the only persisted system row is the
  compaction summary, which sorts to the head — a future mid-history system row must be routed through the same fold (or
  ride the head). No `<system-update>` wrapper, no escaping.
- **A foreign row WITH tool calls** stays an assistant `tool_calls` row (its `tool` results must follow an assistant call
  — API validity); recorded, not renamed.
- **`agent IS NULL`** (legacy) → the conversation's own.
- **Display name** = the agent's `title`, else its slug, looked up once per `_assemble` from the roster
  (`list_agent_names` + each folder's `title`); a name no longer on the roster renders as its slug.

*Why this shape:* user/assistant alternation holds for every history (some local chat templates — Gemma's — reject
user/user runs);
another character's words read as dialogue, not as a privileged directive (the `<system-update>` frame
`normalize_system_messages` uses for real system nudges); deterministic per (history, responder), so prefix-cache stable
per responder, re-keying from the first foreign row on a switch (inherent). The big agent apps carry the bug (open-webui
replays plain `assistant`; LibreChat stamps the CURRENT label on every turn — R100 §2, §3, §10.5). No migration.

## §9 Config keys

**No new key.** The bounds (label 60, preview 120, title `max_length` 120, the sheet page 50) are wire/UI shape
constants; `awaiting` has no age (ON3). `agent.default_agent` keeps two meanings — what a thread-less view /
fresh install opens as (and the home of a thread-less mint, B17), and the `/new` fallback with no open conversation.

**Removed with `auto_rotate` (R10, R24):** `agent.auto_rotate` (default `false`) and `agent.auto_rotate_min_overlap`
(default 2) (`AgentCfg` `be/config.py:437-440`), with `KeywordAgentSelector` (lifespan `be/main.py:322-324`,
`be/services/agent/selector.py`), `_auto_route_agent` (`be/api/agent.py:402`), the Conf row (`fe/components/AgentGlobals.tsx`)
and `fe/hooks/useAgents.ts`'s field. No config-shape bump. **Recorded residual:** `AgentCfg` is `extra="allow"`, so a stray
`auto_rotate*` key in some other config round-trips inert. `AgentDef.description` stays.

## §10 Slice ladder

Cadence per slice: a pinned Opus 5.5 build lane from a brief → frozen diff → the two-reviewer round (blind Opus 5.5 ∥
Emma) → fix wave → confirm → commit; behavioural findings go to the owner (R23). Backend first; the FE slices depend on
S2/S3. **Lanes run in parallel only where file ownership is disjoint** (∥); `be/api/agent.py` and `fe/store/chat.ts` are
each owned by ONE slice at a time, in ladder order. File:line per slice → Appendix §A. **Build no §12 behaviour until
ruled.**

- **S0 — docs.** D84 confirm-closed (§13); DESIGN §12 (the `thread` frame) + §13 (the list is Query); SECURITY_MODEL (the
  delete route; the per-home-agent privilege override persisted per device — its ON4 paragraph in §2.2 landed with the
  ruling fold, 2026-10-06); ISSUES ISS-49's "the route survives" line
  corrected (O31); *(R100 §1's per-account note landed with the plan, F7.)* *Verify:* a doc-truth pass over the
  A15/A7/D75/ISS-49 cross-links.
- **S1 — data + repo.** Migration 8; `_REPAIRS` on every connect; `Thread.seen_at`; `ThreadRepo.create` seeds `seen_at`;
  `list` (agent, limit, before), `summaries`, `set_title`, `set_seen`. *Verify:* `test_threads_a15_s1.py` — repairs (last
  speaker · root fallback · archived untouched · a dangling slug untouched · `seen_at` = MAX(updated_at, newest message) —
  a greeting-only thread is NOT unread) · rollback-then-forward (NULL rows inserted after the stamp are repaired on the next
  connect) · keyset paging under equal `updated_at` · label/preview (tool-only rows skipped) · unread ignores an exec pair ·
  `awaiting` counts a parked call after the last owner row (however old) and ignores one followed by an owner row · monotonic
  `set_seen`.
- **S2 — routes.** `GET /api/threads` (summaries only with `agent=`); `PATCH` (+ the `seen` publish hook, no-op until S3);
  `DELETE`; 404-not-mint; seam ② + `!cmd` pin the default + the home greeting; `touch` on the owner send / exec pair;
  `summaries[name].status`; R40 in `_build_session` (F2 reading A: a responder copied with the home agent's `model` + `privilege`); the ISS-52 slug check; `DELETE /api/agents/{name}?conversations=true` + `ThreadRepo.delete_many` (F6). *Verify:* `test_threads_a15_routes.py` —
  filter/cursor/flags · rename round-trip + clear · seen monotonic + clamped to now · delete 409 mid-turn · 403 rolling
  automation · 404 archived non-rolling (E10) · cascades attachments · chat/exec 404 on an unknown id, mint on an absent one
  · seam ② pins the default even with `body.agent` set, seeds the HOME greeting, and the turn answers as `body.agent` ·
  per-agent status · R40: an explicit override wins on a responder turn, and with no override a responder's turn runs on the HOME agent's AgentDef `model` + `privilege` (F2 reading A) · `..`/`/etc`
  resolve as unknown · agent delete with the flag: the conversations go in one DB transaction, then the folder; one running
  turn → 409 with `busy`, nothing deleted, every marker released; a forced folder-removal failure → 200 with `folder:
  "<error>"`, conversations gone, and a re-run removes the folder (`folder: "ok"`), a third run answers `folder: "absent"`;
  an absent folder with the default memory dir still present → the re-run removes it (`memory: "ok"`); a forced
  attachment-dir failure → `attachments: "<error>"`, and the next boot's `sweep_thread_dirs` reclaims the rowless dir;
  without the flag the rows stay unlisted and an absent folder still 404s; turn-guard pins widened
  (`delete_thread`, `delete_agent`; `threads.delete(`, `threads.delete_many(`); qh9 green.
- **S3 — the `thread` frame** (after S2). *Verify:* `running` then the terminal on a detached chat turn; a drain-B chain gives
  `chained: true` then the steer turn's own frames; `seen` on a moved `seen_at`, none on a no-op; none for archived or exec;
  no `id` on the wire; `Event` frames unchanged; a slow subscriber drops, never blocks.
- **S4 ∥ — ISS-50** (parallel with S1–S3; `session.py` only). *Verify:* a two-speaker history with ADJACENT owner and foreign
  rows (B1's `[user] [Lynette] [user]`, a foreign row before the responder's reply, one at the tail) assembles with strict
  alternation — each run is ONE user message (`Lynette: …` lines + the owner's unprefixed text); an owner/owner run from a
  failed turn merges too; an attachment in a run keeps its image part in order; a foreign tool-call row keeps its pairing;
  `agent IS NULL` = own; a vanished agent → its slug; a single-agent history with no adjacent owner rows assembles
  byte-identical to today.
- **S5 — `auto_rotate` retires** (after S3). *Verify:* full gate; `test_agent_selector_7eg.py` deleted;
  `test_tunables_aca8.py` / `test_arch_invariants_sys16.py` / `test_roleplay_s1.py` updated; a config with the old keys loads.
- **S6 — hop while streaming** (`chat.ts` swap kernel only). `streamGeneration` bump; the refusals drop; the adopt guard
  (O6); `dropAllRaw` narrowed (O22). *Verify (store tests — the UI doors arrive in S7, O26):* a swap between Send and the
  response headers never adopts the left turn's stream, wire thread or buffered floor into the new view, and the POST is not
  aborted; after a swap a live reducer's frames never touch the new view; re-entry re-attaches; a background thread's raw
  steer lines survive a swap.
- **S7 — the responder model, the doors, the overrides, the `/opening` deletion.** `responder` + R45 lifetime; `{thread,
  responder}` persistence + fold; `mintAndOpen` + the new fence (O7)/`openAgentConversation`; `/new` = home; `/agent` + notes
  (incl. B17's); the roster door on `onPick` (O4); `overrides` per home agent (R40), persisted per device in `ctrlb.chat` (ON4 (a): type-guarded, pruned with the home agent) + the chip; the §6 retire list; the
  `/opening` route deleted with `set_agent` + `test_iss49_reopen.py` + its pins (R27); the call refusals; the seen write (R30,
  O11, O10); the 404 → toast → home's latest, latched in a call (R29, R42); the agent-delete second confirm with the count → the F6 flag (R41); the open-home transition after an agent delete (N3, and the no-flag reading in §12); the roster-drop responder clear (N2); the one boot rule (N1). *Verify:*
  store tests for B1–B5, B9, B10, B11, B12, B15 (incl. its dead-page arm, N1), B16, B17, B18 (both sub-cases: the open home deleted with the flag → the default's latest with draft + rail carried, no toast; a deleted responder cleared with its note — local delete AND a remote delete seen through a roster refresh); the invariant (no door writes another agent's conversation);
  the `ctrlb.chat` fold + the overrides' per-entry type guard and reload survival (ON4); `mintAndOpen` while another view streams still swaps (O7); the seen write skipped off the chat tab;
  the BE suite green without the route; e2e — B1 → B2 → B3 → B4 → B5 through the tools menu (the checked row included), and
  B6's "open B mid-stream, back to A, the reply is whole" (moved from S6).
- **S8 — drafts + staged rail per conversation** (`fe/store/composer.ts`, `fe/store/attachments.ts`, `fe/hooks/useDictation.ts`,
  the `setComposerSlot` call sites in `chat.ts` — after S7). *Verify:* B13, B14; both folds (`{draft}` → `{drafts: {"": …}}`,
  `{files}` → `{rails: {"": …}}`); a harvest lands in its own thread's slot; `""` moves into a minted conversation; the
  delete-move (E6) appends with a blank line.
- **S9 — the sheet.** `ChatHeaderActions` factor FIRST (its own commit, no visual change), then the sheet, rows,
  rename/delete. *Verify:* row anatomy, preview prefixes, dot priority, "Show older", the "already new" close (O28); e2e at
  390 px on cosmos + vapor + gacha + frontier — B7, B8 (incl. delete-open → next latest with the draft carried), the header
  opening the HOME sheet while switched (R36).
- **S10 — live status client, the notification tap, roster dots** (after S9). *Verify:* B6 both branches (visible → dots
  only; hidden → one notification named for the home agent, tap → L2 specifically); no duplicate when the finishing
  conversation is open; a `chained` completion does not notify; a seen on device A clears device B's dot; the tap through
  (a) the constructor path, (b) the service-worker message path, (c) the dead-page `openWindow` path with `?thread=` — twice: `?thread=` equal to the stored thread keeps the stored
  responder, a different one opens with none (N1); a tap
  during a call only switches tab; roster dots move with the sheet closed.
- **S11 — the owner's device round** (phone + desktop, dev): B1–B19 by hand; ISS-50 heard in a reply.
- **S12 — close-out.** As-built records (§13 tail); ISSUES ISS-49 / ISS-50 / ISS-51 / ISS-52 → FIXED; ROADMAP A15 → BUILT;
  D75's amendment block gets its SUPERSEDED pointer; HANDOFF pointer.
- **S13 — release** (§11).

## §11 Release / rollback

- **DB schema 7 → 8, additive** — an older build ignores `seen_at` + the index and applies only migrations above its own
  version (`Database._migrate`). Rollback by tag is safe; rolling FORWARD again repairs whatever the older build inserted
  (the §3 `_REPAIRS`, O13).
- **`ctrlb.chat`** — the new build folds `{agent}` → `{thread, responder, overrides}`; an older build reads it as "no
  sticky pick" (its `readStickyAgent` type guard, `chat.ts:79`) and ignores `overrides` — its `/privilege` and mode are
  session-only, so a persisted elevation does NOT carry into the older build (every turn runs at the AgentDef defaults
  until set again). Rolling forward again restores the persisted overrides unless the older build rewrote the blob (any
  pick does, dropping them) — ON4.
- **`ctrlb.composer` / `ctrlb.attachments`** — the new build folds the single value into `""`; an older build reading the
  keyed shape finds no `draft`/`files` and starts empty — rollback loses unsent drafts and staged chips, nothing else.
- **Config** — no new key, no config-shape bump (R24); rollback = plain `update.sh <previous tag>`.
- **Wire** — an older FE against the new BE: a stale `thread_id` now 404s instead of minting (shown as a send error).
  Ship BE and FE together (one tag), per the runbook §Release.
- One release after S11; the version is the owner's call at release time (Phase 26 holds v1.7.11/v1.7.12).

## §12 Still open

**Ruled by the owner 2026-10-06 (the two items open at v2.4).**
1. **F2 → reading A** (§2): with no session override set, a responder's turn runs on the HOME agent's AgentDef
   `model` + `privilege`. The main seat, Emma and Opus had all recommended **B** (Opus: under A, an Emma defined
   `readonly` silently runs at Lynette's `auto_low`); the owner heard it and overruled it — the home agent is the
   conversation, a responder inherits the room's model and privilege. S2 builds A.
2. **ON4 → (a), persist both** (§6 "Overrides persist per device"): the per-home-agent `/privilege` and `/local`·`/cloud`
   overrides persist per device in `ctrlb.chat` and survive a reload, so a reload can no longer silently move a reply
   local → cloud. (b) both session-only + a visible mode and (c) persist the mode only were offered; the main seat
   recommended (c) (privilege's code-stated stance: "carried across the confirm resume too … it's a security stance,
   unlike `mode`", `be/api/agent.py:168-169`); the owner chose (a). An elevation now survives reloads on that device,
   uncapped — there is NO privilege cap (`ChatRequest.privilege` "most-specific-wins, no clamp", `:165-170`; the only clamp
   is `agent.subagent_clamp_privilege`, `be/config.py:425-428`); D84 and SECURITY_MODEL §2.2 record it. S7 builds (a).
R0–R46 + F2 + ON4 are all ruled; nothing was open until the session-68 pre-build audit below.

### §12.1 The session-68 pre-build audit (2026-10-09, main seat Fable 5.1; the lane's report = `~/.cache/tmp/ctrlb-session68/audit-phase27-collisions.md`) — READ BEFORE WRITING ANY S-BRIEF

The plan's citations were re-grepped against `main @ 80b196b` (56 commits past the `1bd2d3f` pin). **Verdict: NO code
collision — drift only.** `fe/store/chat.ts` has ZERO commits since the pin (every S6/S7/S10 line exact); schema still 7,
config shape still 5, `AgentCfg` unchanged, the five S5 tests exist, Phase 27 touches neither `voice_live.py` nor
`call_trail.py`. **Line drift to re-pin per brief:** `be/api/agent.py` uniformly **+4** below line 32 (`chat` → 1306,
`delete_agent` → 2241); `be/config.py` `resolve_agent` → 2716, `_load_agent_folder` → 2667; `session.py` `_assemble` →
1065 (body unchanged); `fe/lib/composer.ts` +5…+17; gallery/agents files a few lines. The function name is authoritative.

**Semantic drift + rulings (main seat unless marked OWNER; each S-brief folds its own):**
1. **ISS-51 is BUILT (`9a2b649`, owner-ruled 2026-10-07) in a shape the plan did not know:** an unknown or vanished name
   falls to the **CONFIGURED DEFAULT, then the root** — not "the root". §4's "falls back to the ROOT", §6 `effectiveAgent`
   ("shown as the root") and R41's legacy-homes reading now read **"the configured default, else the root"**; the client's
   vanished-home paint = the default (one fallback, server and client agree). The §3 NULL repair's literal `'default'`
   stays the ROOT's slug (R10 — the last speaker, else the root); the wording must not blur the two. (S2, S7)
2. **ISS-52 is DONE (`21e6b83`, built as S2 wrote it).** Dropped from S2's build list; its verify line stays as a
   regression check; S12 adds only the "closed at the boundary" pointer.
3. **`/agent <unknown>` = a TOAST, not a note** (`64eaeee`, owner-ruled 2026-10-07: `No agent named "x"`, judged only once
   the roster has landed — `agentsLanded`; before that a pick goes through unjudged). §2's B-row (the `// agent "xyz" is
   not configured` note) is SUPERSEDED; S7's `setResponder` keeps the toast and the `agentsLanded` rule.
4. **Dictation AUTO-SEND across a hop (an R35 gap).** `useDictation.maybeAutoSend` (≈723–729) reads `getDraft()` and runs
   the CURRENT view's composer. **Ruling:** an auto-send whose dictation STARTED in another conversation sends nothing
   and leaves the text in its origin slot (it shows there as the draft on return). The alternative — a thread-targeted
   background send — needs a `runComposer` the store does not have; not built. (S8)
5. **`fe/hooks/useDictation.ts` is SHARED with the ASR track.** S7a moved the streaming append into a module-level
   `appendPhrase(s: StreamSession, …)` — the plan's `:746`/`:1188` cites are gone. **Ordering:** ASR S8/S8b own the file
   FIRST; Phase 27 S8 lands AFTER ASR S8b and rebases onto it. The start slot belongs on `StreamSession` (fed to
   `appendPhrase`) and in the clip-door closure; ASR S8b's IndexedDB recovery record MUST persist the thread id the
   dictation started in, so the recover offer lands in its origin conversation (ASR_PLAN gets the same line).
6. **The R42 latch at hang-up:** `endCall`'s deferred R29 path runs AFTER the ISS-61 exit harvest
   (`useLiveCall.ts` ≈2913 `appendDraft`, on every exit incl. unmount) — never synchronously inside `endCall` — so the
   E6 carry moves the harvested utterances and no write lands in a deleted conversation's slot. A 404 during a call
   maps to the EXISTING `SendOutcome "refused"` (no new variant: a new one would force an edit in S7b's file). (S7)
7. **The ISS-66 scroll latch** (`ChatThread.tsx` ≈1079–1086) re-births only on tab entry. S6/S7 reset it and jump to
   the newest message when the view's thread changes. `ChatThread.tsx` joins the seam map.
8. **S5's retire list grows:** `bt/test_steer_drain_b_d41.py:508–527` (re-target the MED-3 raise point off
   `_auto_route_agent`), `ft/components/agentsEditorCompaction.test.tsx:126–127, 402–420`, `frontend/e2e/fixtures.ts:201–202`,
   the docstring mentions (`steering.py:210`, `greeting.py:11`, `core/agents.py:10`, `chat.ts:1180`, DESIGN:1519); S7's
   `/opening` deletion also sweeps `config.py:2675` (new since the pin), `greeting.py:12`, `conversation.py:91`.
9. **J3 vs S4:** both own `AgentSession._assemble`. If J3 opens while Phase 27 is live, **S4 lands first** (its
   byte-identical single-agent invariant is J3's baseline).
10. **Greeting-less specialists (ISS-37, `badc9d9`):** seam ② / `mintAndOpen` can mint an EMPTY conversation (no opening
    row). Every B-scenario's "a fresh greeted one" reads "greeted when the agent has a greeting"; `label` → "New
    conversation", `preview` → `null`; the `seen_at` backfill and the "already new" no-op rule hold.
11. **OWNER — the release train.** v1.7.12 no longer waits for J3/J4 (re-ruled 2026-10-09), so anything merged to
    `main` rides it: migration 8, S2's 404-not-mint (whose client half is S7), S5's Conf-row removal. **The main seat's
    recommendation: Phase 27 builds on a `phase27` branch in a worktree and merges to `main` ONCE, as a whole, after
    S10 (§11's "BE + FE ship together" stands); v1.7.12 goes independently.** The alternative — inert backend slices
    (S1/S3/S4; migration 8 is additive) riding v1.7.12 — only on the owner's word.

**The working arrangement (the ASR captures continue on dev in parallel):** `git worktree add ~/.cache/tmp/ctrlb-wt27 -b
phase27`; pytest from the worktree's `backend/` with the main venv (imports the worktree's `app` — verify once; pyright
needs `--pythonpath <main venv python>`); manual runs against a COPY of the dev home (`sqlite3 .backup`, never `cp` of a
WAL DB; dev holds 44 NULL-agent threads + the dangling `probe-s1` — a realistic migration-8 rehearsal) on a spare port
(:5435, no `--reload`). WHY: dev runs uvicorn `--reload` on the MAIN tree (every backend save there drops a running
call, and S1's first save would migrate the capture DB before review) and serves the main tree's `frontend/dist` to the
phone (:8443), so a build in the main tree puts half-built UI on the capture phone. **S11 (the phone round)** = merge at a
capture-free moment (one dev restart, migration 8 once, DB backed up first) — or a second Serve port for the worktree
instance, which is an ops change for the owner to OK. Rebase `phase27` on `main` before every frozen-diff review.
Two seats on one tree: commit by path, `git status` before any HANDOFF/ISSUES write (the session-62 rule).

**Confirmed by the main seat (round 2 — F8 in the session-60 rulings; both v2.2 micro-confirms passed over it):** deleting the agent whose conversation is OPEN on this device WITHOUT the flag
(the owner chose to keep the conversations) — the plan moves this device to the configured default's latest the same way
(N3's transition, draft + rail carried), since R41 makes the kept conversations "listed nowhere" and the header button
would otherwise open the deleted agent's sheet. The kept conversations stay in the database.

**Confirmed by the main seat (F1):** B5 — tapping the open conversation's OWN home agent in the ROSTER clears the responder
("back to the rule", R17 + O4): the roster is the door "from elsewhere" even when it lands where you are; every other
same-conversation landing keeps it (R45).

**Ruled 2026-10-06 (kept for the trail):** Q1 → R24 · Q2 → R25 · Q3 → R26 · Q4 → R29 · Q5 → R30 · Q6 → R27 · Q7 → R28 ·
Q8 → R32 · the AgentDef write-back → R46 · the v2 fold's flagged readings → F1–F7 · Emma's confirm → N1–N4 · Opus's confirm → ON1–ON7 · Q-I → R34 · Q-J → R35 · Q-K → R36 · Q-L → R37 · Q-M → R38 · O1 → R39 · O3 → R45 · O5 → R40 · O12 → R41 ·
O15 → R42 · O17 → R43 · F2 → reading A (owner) · ON4 → (a) (owner).

**Recorded, not built (R32, R46):** write-back of the local/cloud mode (first) and privilege to the AgentDef · a list TAB via the satellite
lever (R14) · search grouped by conversation (`MessageRepo.search`, `be/services/conversation.py:399`) ·
`pinned`/`muted`/manual mark-unread (R100 §7) as additive columns / PATCH keys · `session_search` scoped per agent (R13) ·
cancel a notification when the conversation is seen on another device (R43; the `seen` frame is the seam) · a visible
responder chip (open-webui's ✕ chip, R100 §2).

**Recorded residuals:** after a DECLINED cascade (the agent deleted, its conversations kept) another device's open sheet /
list cache still shows the deleted agent's conversations until its roster or list query refreshes (focus, a frame) · a `suspended` frame's `agent_input` (keyed by turn) and the open view's reconstructed one (keyed by
call id) can both fire if the owner opens that conversation within the notification's life — at most one duplicate ·
utterances in a call on a conversation deleted
elsewhere fail until hang-up (R42) · the stray-`auto_rotate`-key residual (§9) · an older FE against the new BE (§11).

## §13 Council record

**Round 1 (2026-10-06, on plan v1).** Two blind reviewers in parallel, both assessed against R100's peer practice.
- **Opus 5.5 — NOT CONFIRMED.** 31 findings; after ground-or-withdraw: 28 grounded, 2 downgraded (#5 HIGH→MED, #20
  MED→LOW), 1 withdrawn (#30) — 4 HIGH · 15 MED · 11 LOW. HIGHs: #1 B6's notification cannot fire while the app is visible
  (→ R39: dots only, no toast — the proposed toast OVERRULED by the owner); #2 the Android tap had one of its four seams
  (→ O2); #3 a tap on the open conversation was ambiguous about the responder (→ R45); #4 the tools-menu row acted on the
  radio's `onChange` (→ O4). #5 session privilege/mode leaking across agents (→ R40). #18 (name the speaker in
  notifications) OVERRULED by the owner (R37: the home agent). #16 (process death drops the responder) dissolved by R45.
  #12 → R41 · #15 → R42 · #17 → R43 · #19 → O19 (the peer `Name:` fold, §8). Mechanical: O2, O4, O6–O11, O13, O14, O19–O29,
  O31 accepted; O27 recorded.
- **Emma (Sol) — NOT CONFIRMED.** 11 findings — 3 HIGH: E1 the sheet while switched (→ R36), E7 cross-device seen had no
  propagation (→ O10), E8 the Android tap (→ O2). E2 → R34 · E3 → R35 · E4 → R45 · E5 → R41 · E9 → R37 · E6 (a remote
  delete lost the draft) accepted · E10 (archived 404 test) accepted · E11 (the Telegram attribution) accepted (§2, R19).
- **All folded 2026-10-06 → plan v2.** Then the main seat ruled the readings the fold flagged (→ v2.1): **F1** B5 clears the
  responder (confirmed) · **F2** the no-override model/privilege of a responder → OWNER; ruled A by the owner 2026-10-06 (the reviewers recommended B) (§2) · **F3** the `_REPAIRS`
  list on every connect (accepted) · **F4** a thread-less send mints with home = the default + the home greeting (accepted)
  · **F5** utterances fail until hang-up on a conversation deleted elsewhere (recorded) · **F6** agent delete with its
  conversations is ONE server-side route (§4; round 2 dropped the "atomic" claim, N4) · **F7** ROADMAP A15's "Done" line + R100 §1's per-account caveat.
  R46 closed the AgentDef write-back (none in v1).
- **Round 2 — Emma (Sol) confirm, on v2.1: NOT CONFIRMED** — all 11 round-1 findings CLOSED; 4 NEW: **N1** (HIGH) the
  dead-page tap's boot path did not say how the stored responder survives → ONE boot rule (§6) · **N2** (MED) a responder
  whose agent is deleted stayed live → cleared at once with a note (§6, B18) · **N3** (MED) deleting the OPEN home agent
  with its conversations had no fallback → the delete's success handler opens the default's latest and carries draft +
  rail (§4, B18) · **N4** (HIGH) the "atomic" agent+conversations delete could not be atomic across the DB and the
  filesystem → the truthful sequence, per-step results, idempotent retry (§4). N2/N3 are behavioural least-surprise
  defaults reported to the owner. Emma's F2 view = reading B (the owner ruled A, 2026-10-06).
- **Round 2 — Opus confirm, on v2.1: CONFIRMED WITH NOTES** — round-1 #1–#31 resolved or owner-overruled except #20; new
  N1–N7 → ON1–ON7: ON1 = Emma's N1 · **ON2** the §8 fold produced user/user runs in the ordinary case → each run of owner +
  foreign rows is ONE user message (§8, S4) · **ON3** `awaiting` = a parked call after the last owner row, no TTL
  (supersedes O20) · **ON4** overrides vs reload → OWNER (§12); ruled (a) by the owner 2026-10-06 (the main seat recommended (c)) · ON5 = Emma's N3 (+ resolve the folder before the guard
  pass) · ON6 = Emma's N4 · **ON7** two drifted `useDictation` citations re-grepped. Opus's F2 view = reading B (the owner ruled A, 2026-10-06).
- **All round-2 notes folded 2026-10-06 → plan v2.2.**
- **Opus micro-confirm on v2.2: CONFIRMED WITH NOTES** — it caught that NO privilege cap exists (the plan's "capped by
  config" in F2 and ON4(a) was wrong; `be/api/agent.py:165-170` "no clamp"; only `agent.subagent_clamp_privilege`) → the
  main seat's RETRACTION; ON4 restated with three options, recommendation now (c); notes folded → v2.3: the §8 mid-history
  system-row caveat, the other-device stale list after a declined cascade (residual), the per-option ON4 folds (§6; the
  owner later chose (a) — only its fold survives).
- **Emma micro-confirm on v2.2: CONFIRMED WITH NOTES** — N1–N3 RESOLVED, N4 RESOLVED WITH NOTE; one new MED **M1**: a request
  retry cannot rediscover a deleted conversation's attachment dir (its row is gone), nor finish the default memory dir
  once the folder is absent → §4 step 4 made truthful (the retry completes the agent side, removing the default memory dir
  explicitly; the boot sweep's rowless-dir arm reclaims attachment dirs); her ON4 clauses folded into the §6 blocks
  (type-guarded blob, home-keyed, pruned on home delete, a responder clear never touches the home slot, (a) changes D84 +
  SECURITY_MODEL + rollback together; (b)/(c) caption = the EFFECTIVE provider for the next turn) → v2.4 (only
  (a)'s block survives the owner's ON4 ruling).
- **COUNCIL CLOSED 2026-10-06** — Opus CONFIRMED WITH NOTES ∥ Emma CONFIRMED WITH NOTES (both on v2.2; notes folded in
  v2.3–v2.4). The owner's F2 and ON4 rulings were the only open items (§12) — **both RULED 2026-10-06** (below). The confirm rounds closed on v2.2 (Opus by message; Emma by a fresh self-contained run with her
  review attached).
- **Owner rulings 2026-10-06 (session 61) → plan v2.5:** **F2 = reading A** (the reviewers — main seat, Emma, Opus —
  recommended B; the owner overruled: the home agent's model + privilege govern every turn in its conversation) ·
  **ON4 = (a)** (the main seat recommended (c); the owner chose to persist both). Folded into §1, §2's F2 box, §4, §6
  ("Overrides persist per device" — blocks (b)/(c) deleted), §10, §11, §12; D84, SECURITY_MODEL §2.2, TODO Phase 27 in
  the same change.

Session-60 working files (provenance only; nothing here depends on them): `~/.cache/tmp/ctrlb-session60/`
(`RULINGS.md`, `audit-A15.md`, `review-A15-opus.md`, `review-A15-emma.md`, the frozen plan/D84 copies per round).

## §14 What this phase retires — and what it does not do

**Retires:** the D75 per-device sticky pick (`stickyAgent`, the `ctrlb.chat` `{agent}` blob, `pinStickyAgent`, `agentPin`,
the sticky rung of `effectiveAgent`) and the D75 **tandem rule**; **ISS-49** — the pick trigger AND the `PUT
/threads/{id}/opening` route itself, deleted with its tests and `ThreadRepo.set_agent` in S7 (R27; the `alt_greetings` picker
re-adds a route when built); **ISS-50** (§8); **ISS-51** + **ISS-52** at the boundary (§4); the single global composer draft
and staged rail (→ per conversation, R31/R34); the global `/privilege` and `/local`·`/cloud` session values (→ per home agent,
persisted per device, R40 + ON4); **`auto_rotate`** / 7e-g (§9); the hop-while-streaming refusals; the silent mint on an unknown `thread_id`; the
unpinned-thread class (seam ② + the repairs). The D75 sticky residuals ①–⑥ go with the machinery.

**Does NOT do:** group chats (R13); a global all-agents list or an orphan listing (R19, R41); a behaviour toggle (R2); a
one-reply `@agent` switch (R1); one-conversation-per-agent (R2/R15); a re-pin of any thread (R17); an in-app toast for
background replies (R39); write-back of overrides to the AgentDef (R46); conversation switching or `/agent` inside a live
call (R20); per-agent `session_search` scoping (R13).

---

## Appendix §A — the seam map, by slice

Function name first (authoritative), then the line at `1bd2d3f`. `be/` = `backend/app/`, `fe/` = `frontend/src/`,
`bt/` = `backend/tests/`, `ft/` = `frontend/tests/`, `pub/` = `frontend/public/`.

**S1 — data + repo**
| Seam | Where | Change |
|---|---|---|
| `MIGRATIONS` | `be/db.py:52` | append `(8, …)` |
| `threads` DDL | `be/db.py:56-63` | reference shape |
| `automation_runs.read_at` | `be/db.py:225` | the precedent |
| `Database.connect` / `_migrate` | `be/db.py:316` (`_migrate` after `_current_version`) | run `_REPAIRS` after the version loop |
| `Thread` | `be/domain/conversation.py:316` | `seen_at` |
| `Message.agent` | `be/domain/conversation.py:259` | read by repairs + summaries |
| `ThreadRepo` | `be/services/conversation.py:60` (`create` `:69`, `touch` `:84`, `list` `:102`, `delete` `:113`) | `seen_at` on create; `list` filter/cursor; new `summaries`, `set_title`, `set_seen` |
| `MessageRepo.with_call_states` | `be/services/conversation.py:323` | `awaiting` |
| `run_user_exec` | `be/services/agent/exec.py:46` (pair `:63-75`) | the actor the unread predicate excludes |
| `seed_greeting` | `be/services/agent/greeting.py:38` (add `:55`) | why the backfill uses MAX(ts) |

**S2 — routes**
| Seam | Where | Change |
|---|---|---|
| `ChatRequest.mode` / `.agent` / `.privilege` | `be/api/agent.py:162` / `:164` / `:170` | doc (responder rung; home values) |
| `resolve_session_agent` | `be/api/agent.py:309` | home privilege when no override |
| `_build_session` | `be/api/agent.py:321` (ladder `:350`) | R40 / F2 (reading A): copy a responder with the home agent's `model` + `privilege` when no override is set |
| `AgentDef.model` / `.privilege` | `be/domain/agent.py:250` / `:258` | read for the F2 copy (reading A, ruled) |
| `_reject_automation_thread` / `_revalidate_thread` | `be/api/agent.py:451` / `:473` | reused by DELETE |
| `_reserve_or_busy` / `_reserve_turn` | `be/api/agent.py:501` / `:516` | reused by DELETE |
| `turn_status` | `be/api/agent.py:904` (predicate `:928`) | `running` |
| `list_threads` / `create_thread` | `be/api/agent.py:1190` / `:1205` | summaries with `agent=` / unchanged |
| `chat` | `be/api/agent.py:1302` (lookup `:1315`, mint `:1324`, greeter `:1401`) | 404-not-mint; pin the default; home greeting; `touch` |
| `exec_shell` | `be/api/agent.py:1421` (lookup `:1432`, mint `:1436`) | 404-not-mint; pin the default; `touch` with the pair ts |
| new `patch_thread` / `delete_thread` | `be/api/agent.py` beside `list_threads` | §4 |
| `list_agents` / `_list_agents_payload` | `be/api/agent.py:1674` / `:1622` | `summaries[name].status` |
| `delete_agent` | `be/api/agent.py:2236` | `?conversations=true`: guard pass → one transaction → the folder (F6) |
| `ThreadRepo.delete` | `be/services/conversation.py:113` | precedent for new `delete_many(ids)` |
| `_delete_agent_folder` | `be/api/agent.py:1846` (absent → `None` `:1858-1859`) | + the absent-folder default-memory removal (M1) |
| `remove_thread_attachments` / `sweep_thread_dirs` | `be/core/attachments.py:919` / `:1017` (lifespan `attachments_sweep` `be/main.py:381`) | per-conversation dir removal / the boot reclaim of rowless dirs (M1) |
| `_load_agent_folder` / `list_agent_names` / `resolve_agent` | `be/config.py:2635` / `:2656` / `:2675` | ISS-52 |
| `valid_skill_slug` | `be/core/skills.py:32` | reused |
| `_MUTATION_MARKERS` / `_EXPECTED` | `bt/test_turn_guard_invariant.py:40` / `:93` | `threads.delete(`, `threads.delete_many(` / `delete_thread`, `delete_agent` |
| 422 renderer guard | `bt/test_arch_invariants_qh9.py:144` | stays green |

**S3 — the `thread` frame**
| Seam | Where | Change |
|---|---|---|
| `_spawn_drain_task` + `_cleanup` | `be/api/agent.py:593` (`release` `:623`, drain-B `:635`, callback `:637`) | running / terminal (last) frames |
| `_maybe_spawn_drain_b` | `be/api/agent.py:641` | return whether it spawned (`chained`) |
| spawn callers | `be/api/agent.py:811`, `:845`; `be/services/automations/runner.py:473` | archived → no frame |
| `TurnHandle` | `be/services/agent/turns.py:265` (`terminal_status` `:298`) | frame fields |
| `EventBus` | `be/core/events.py:20` | `Event \| ThreadFrame` |
| `stream_events` | `be/api/events.py:37` (frame `:63`) | `event: "thread"`, no `id` |
| `ThreadRepo.set_seen` → bus | `be/main.py:193` (`app.state.event_bus`) | the `seen` frame |

**S4 — ISS-50**
| Seam | Where | Change |
|---|---|---|
| `AgentSession._assemble` | `be/services/agent/session.py:1016` (assistant rows from `:1057`) | the `Name:` fold |
| `list_agent_names` | `be/config.py:2656` | display names |

**S5 — `auto_rotate` retires**
| Seam | Where | Change |
|---|---|---|
| `AgentCfg.auto_rotate` / `auto_rotate_min_overlap` | `be/config.py:437` / `:440` | delete |
| `KeywordAgentSelector` wiring | `be/main.py:322-324` | delete |
| selector | `be/services/agent/selector.py`; `be/core/agents.py` (doc) | delete / doc |
| `_auto_route_agent` + callers | `be/api/agent.py:402`; `chat` `:1337`; `start_steer_turn` `:802` | delete; callers use `body.agent` / `head.agent` |
| `AgentDef.description` comment | `be/domain/agent.py:193` | reword |
| Conf row / hook field | `fe/components/AgentGlobals.tsx`; `fe/hooks/useAgents.ts` | delete |
| tests | `bt/test_agent_selector_7eg.py` (delete), `bt/test_tunables_aca8.py`, `bt/test_arch_invariants_sys16.py`, `bt/test_roleplay_s1.py` | follow |

**S6 — hop while streaming**
| Seam | Where | Change |
|---|---|---|
| `openSeq` / `streamGeneration` | `fe/store/chat.ts:114` / `:248` | supersession / bumped by `swapView` |
| `claimStream` | `fe/store/chat.ts:249` (called `:2036`) | adopt guard |
| `setWireThread` | `fe/store/chat.ts:558` | adopt guard |
| `swapView` | `fe/store/chat.ts:783` (`dropAllRaw` `:788`) | bump; narrow the raw prune |
| `openThread` | `fe/store/chat.ts:876` (refusals `:883`, `:905`; same-id `:887-891`) | drop refusals |
| reducer `case "thread"` | `fe/store/chat.ts:1653` | adopt guard |
| `streamTurn` | `fe/store/chat.ts:1842` (fetch `:1860`, buffered `:1973`) | capture entry + generation |
| `startNewThread` | `fe/store/chat.ts:1218` (refusal `:1222`) | drop |

**S7 — responder, doors, overrides, the `/opening` deletion**
| Seam | Where | Change |
|---|---|---|
| `ChatState` | `fe/store/chat.ts:35` (`sessionPrivilege` `:42`) | `responder`, `overrides` |
| `KEY` / `readStickyAgent` | `fe/store/chat.ts:71` / `:79` | `{thread, responder, overrides}` + fold + the overrides' type guard (ON4) |
| `sessionMode` / `setSessionMode` | `fe/store/chat.ts:483` / `:484` | → `overrides[home].mode` |
| `setStickyAgent` / `writeSticky` / `setSessionPrivilege` | `fe/store/chat.ts:510` / `:516` / `:572` | delete / → overrides |
| `resetToThreadless` / `fetchThreadAgent` / `initChat` | `fe/store/chat.ts:802` / `:832` / `:943` | sticky param out / cache read / boot order |
| `startNewThread` | `fe/store/chat.ts:1218` (fence `:1276-1278`, re-seat tail `:1296-1306`) | → `mintAndOpen` + `/new` |
| `userTurnCount` | `fe/store/chat.ts:1153` | the ISS-31 no-op only |
| `sendMessage` | `fe/store/chat.ts:2799` (mode `:2825`, agent `:2831`) | responder + home overrides |
| notification titles | `fe/store/chat.ts:306-381` | home agent names (R37) |
| `syncMessageRoute` / ISS-49 client | `fe/store/chat.ts:3174`; `wouldReseat` `:3467` … `reseatOpening` `:3501` | delete re-seat parts |
| `validStickyAgent` / `effectiveAgent` / `agentPin` | `fe/lib/composer.ts:158` / `:189` / `:215` | delete / rewrite / delete |
| `defaultAgent` / `installAgents` | `fe/lib/composer.ts:140` / `:242` | unchanged |
| `pinStickyAgent` | `fe/lib/composer.ts:336` | delete |
| verbs `agent` / `privilege` / `new` / `/<provider>` | `fe/lib/composer.ts:368` / `:377-394` / `:418` / `:686` | responder / overrides / `mintAndOpen` / overrides |
| `sendCallTranscript` | `fe/lib/composer.ts:618` | unchanged |
| `PrivilegeChip` | `fe/components/PrivilegeChip.tsx` | reads/writes `overrides[home]` |
| active-agent readers | `fe/hooks/useActiveAgent.ts:31`; `useActiveBackdrop`; `fe/store/composerSkills.ts` | `effectiveAgent` |
| roster doors | `AgentRow` `fe/theme-engine/kit/composer/toolsMenu/ToolsMenuSheet.tsx:226` (`onClick` `:249`, `onChange` `:250`); `talk` `fe/tabs/AgentsTab.tsx:226` | `onPick` → `openAgentConversation` |
| `callLive` / `endCall` | `fe/store/liveCall.ts:78` / `:58` | the R20 guard / the R42 latch |
| `clearAudioCache` | `fe/lib/audioController.ts:1600` | why the guard exists |
| `pushToast` | `fe/store/toast.ts:41` | R29 |
| agent delete | `fe/components/AgentsEditor.tsx:658`; `useDeleteAgent` `fe/hooks/useAgents.ts:333` | count → second confirm → `?conversations=true` (R41, F6) |
| `/opening` route | `reseat_opening` `be/api/agent.py:1236` (`set_agent` `:1289`); `ThreadRepo.set_agent` `be/services/conversation.py:89` | delete |
| its tests + pins | `bt/test_iss49_reopen.py`; `bt/test_turn_guard_invariant.py` | delete / unpin |
| FE tests that follow | `ft/store/chatOpenThread.test.ts`, `ft/lib/composer.test.ts` (+ the sticky/tandem suites) | rewrite |

**S8 — drafts + staged rail**
| Seam | Where | Change |
|---|---|---|
| draft store | `fe/store/composer.ts` (`KEY` `ctrlb.composer`, `setDraft`, `appendDraft`, `useDraft`) | `{drafts}` + slot + fold |
| staged rail | `fe/store/attachments.ts` (`KEY` `:77`) | `{rails}` + slot + fold |
| composer import / `harvestToDraft` | `fe/store/chat.ts:26` / `:2658` | `setComposerSlot`; own-thread slot |
| dictation | `fe/hooks/useDictation.ts` (`appendDraft` `:746`, `:1188`) | capture the start slot |

**S9 — the sheet**
| Seam | Where | Change |
|---|---|---|
| chat headers | `fe/tabs/AgentTab.tsx:66`; `fe/themes/frontier/FrontierAgent.tsx:109`; `fe/themes/gacha/GachaAgent.tsx:389` | → `ChatHeaderActions` |
| `PrivilegeChip` | `fe/components/PrivilegeChip.tsx` | moves into the cluster |
| `BottomSheet` / `FocalFace` | `fe/components/BottomSheet.tsx:112` / `fe/components/FocalFace.tsx` | reused |
| `.who-acts` | `fe/components/chatAttribution.tsx` (`:285`); `fe/theme-engine/kit/kit.css:4809` | row-actions precedent |
| `requestPrompt` / `requestConfirm` / `relativeTime` | `fe/store/prompt.ts:60` / `fe/store/confirm.ts:25` / `fe/lib/relativeTime.ts:6` | reused |
| tokens / `.kit` roots | `fe/theme-engine/kit/tokens.css` (`--ok`, `--warn`, `--accent`); `DefaultRoot.tsx:359`; `fe/themes/vapor/VaporRoot.tsx:57` | dots; styling everywhere |
| new files | `fe/components/ChatHeaderActions.tsx`, `fe/components/ConversationsSheet.tsx`, `fe/hooks/useThreads.ts` | create |

**S10 — live status client, the tap, roster dots**
| Seam | Where | Change |
|---|---|---|
| `useEventStream` | `fe/hooks/useEvents.ts` | the `thread` consumer |
| `notifyScope` / `notifyTurnTerminal` / `notifyRestoredAwaiting` | `fe/store/chat.ts:297` / `:354` (key `:369`) / `:403` | export + reuse; `thread` on signals |
| `reconcileChat` | `fe/store/chat.ts:2613` | refetch both queries |
| `NotifySignal` | `fe/lib/notifyBus.ts:23` | `thread?` |
| `shouldNotify` / `show()` / SW listener / `applyNotificationFocus` | `fe/hooks/useForegroundNotifications.ts:94` / `:204` / `:145` / `:170` | unchanged gate / `data.thread` / pass `thread` / open it |
| service worker | `pub/notify-sw.js:34` (postMessage), `:46` (`openWindow`) | carry `thread`; `?thread=` |
| `consumeTabParam` | `fe/store/ui.ts:291` | add `consumeThreadParam` beside it |
| `useAgentRoster` | `fe/hooks/useAgents.ts:202` | `status` for the dots |
| dot render | `ToolsMenuSheet.tsx` `AgentRow`; `fe/tabs/AgentsTab.tsx` cards | roster dots |
