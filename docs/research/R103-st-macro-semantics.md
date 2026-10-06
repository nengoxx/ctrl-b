# R103 — The SillyTavern / CCv3 feature macros: authoritative semantics + where OUR expander runs (2026-10-06)

**Serves:** ISSUES ISS-28 (the `{{random}}`/`{{pick}}`/`{{roll}}`/time/`idle_duration`/scoped-comment macros that still render literally). **Status:** design RULED by the main seat 2026-10-06 (D2 below; the rulings + the one open owner question are recorded in the ISS-28 row); NOT built. Opus 5.5 audit+research lane (session 62), one agent, no subagents; ST read at `release` 1.19.0 (`public/scripts/macros/definitions/core-macros.js`, `time-macros.js`, `MacroEngine.js`, `MacroCstWalker.js`, `world-info.js`, `script.js`), droll.js, the CCv3 spec, RisuAI `cbs.ts`. Confidence marks: **V** verified at source · **R** reported · **U** unverified. The body below is the lane's report verbatim (its §1 seam map is file:line against `a22ba68`).

---

# Audit ISS-28: the feature macros render literally

Opus 5.5 audit lane, session 62. I read the code and the upstream sources and changed nothing in the repo. Tags: **V** = VERIFIED (I read the code or source), **R** = REPORTED (from docs only), **U** = UNVERIFIED.

## 1. Seam map

**Data flow.** There is one expander, `Macros.render` (macros.py:78-88). It strips `{{// …}}`, folds the case of vocabulary names, applies the `{{original}}` once-rule, then runs `prompts.render`, which is `string.Template.safe_substitute`. An unknown token is left as literal text. `Macros` is a frozen `(char, user)` pair. It is rebuilt on every `session._macros()` call (session.py:590-593), and it carries no thread, clock or RNG. [V]

Text is stored raw everywhere except the greeting:
- **Greeting.** Rendered once at seed time and stored as history.
- **Head blocks.** Voice/SOUL, scenario, persona description, example dialogue and the head lorebook entries are rendered when `_static_prefix` builds. That happens once per AgentSession, and an AgentSession is built per turn and again per resume.
- **`post_history`.** Rendered on every `_assemble` call, so on every loop iteration (session.py:1124).
- **Lorebook keys and content.** Rendered once per turn by the turn-start scan.

So per-turn macros in head text change the cached prefix every turn. [V]

| Site | Line(s) | When it renders | Tag |
|---|---|---|---|
| `macros.py` `VOCABULARY` / `_COMMENT` / `_MACRO_OPENER` | 56 / 60 / 67 | the grammar and the "supported" list that the report reads | V |
| `macros.py` `unrendered` predicate | 113 `renders = name == "//" or (name in VOCABULARY and not m["pad"] and m["close"])` | at import, the report | V |
| `prompts.py` `_PLACEHOLDER_PATTERN`, `TOKENS`, `render` | 86-91, 113, 116-122 | shared renderer (leave it untouched) | V |
| `session._system_prompt` | 642-647 (`original` is pre-rendered at 644) | head | V |
| `_scenario` / `_persona_block` | 656 / 670 | head | V |
| `example_messages` | examples.py:53, called at session.py:1012 | head, last | V |
| `_post_history` | 680, called at 1124 | **every iteration** (tail) | V |
| lorebook keys, secondary keys, content | lorebooks.py:372 / 348 / 379, via session.py:914-943 | turn start; head or tail block | V |
| `seed_greeting` | greeting.py:52 `macros_for(agent, settings).render(agent.greeting.strip())` | once, stored | V |
| `seed_greeting` callers | api/agent.py:1214 (POST /threads), :1290 (ISS-49 re-seat), :1402 (auto-create) | n/a | V |
| Turn entry points | `run_turn` 1392-1409, `regenerate` 1412-1437, `resume` 1588-1594 | every turn goes through these three, including automations (runner.py:472) and subagents (subagents.py:231) | V |
| Report lines | card_import.py:775-780, lorebook_import.py:222-224 | both call `unrendered_note`; **only the predicate in macros.py changes** | V |
| Clock zone | automations/schedule.py:53 `server_tz_key()` (emma = Europe/Madrid) | already reused across features by monitor.py:64,314; I probed that importing it does not pull in `session` | V |
| `_now()` helper pattern | turns.py:83, steering.py:40, runner.py:81 | monkeypatchable clock | V |
| Idle data | `Message.ts` (domain/conversation.py:256), index `idx_messages_thread(thread_id, ts)` (db.py:75), query precedent `count_user_messages` (conversation.py:389) | n/a | V |

Every other `.render(` caller in `app/` is listed above. Nothing else assembles a prompt: there is no preview endpoint, export uses raw fields, and the frontend never renders macros. [V, grep]

## 2. The authoritative semantics

ST was read at `release` 1.19.0, where the new engine is the default (`power-user.js:302` `experimental_macro_engine: true`).

- **`random`** ([core-macros.js](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/macros/definitions/core-macros.js) 340-361). Forms: `{{random::a::b}}`, `{{random:a,b}}`, `{{random a,b}}`. With a single argument, `::` wins over commas; `\,` escapes a comma; items are trimmed; an empty list gives `''`. Fresh entropy on every resolve. [V]
- **`pick`** (363-410). Seed = hash(chat-id hash, hash of the full raw input, the macro's global offset, optional `/reroll-pick` seed), so it is stable per chat and position. The legacy macros.js:516-541 is the same without the reroll seed. [V]
  - RisuAI seeds `pick` by (message index, char id + chat id) (`cbs.ts:2041`). [V]
- **`roll`** (303-337). Digits only means `1dN`. Grammar is droll's `^([1-9]\d*)?d([1-9]\d*)([+-]\d+)?$`/i ([droll.js:62](https://github.com/thebinarypenguin/droll/blob/master/droll.js)). An invalid formula gives `''`. Neither ST nor droll caps the dice count. [V]
- **Time macros** ([time-macros.js](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/macros/definitions/time-macros.js)). These use moment.js, browser-local, `en` locale. [V]
  - `time` = `LT` = **`h:mm A`**, for example "3:05 PM". The "HH:mm" in ST's own description is wrong.
  - `date` = `LL` = `MMMM D, YYYY`; `weekday` = `dddd`; `isotime` = `HH:mm`; `isodate` = `YYYY-MM-DD`.
  - `{{time::UTC±N}}`, with the legacy `{{time_UTC±N}}` rewritten to it (MacroEngine.js:277-281).
  - `datetimeformat` takes a moment format string; `timeDiff` takes two date strings.
  - Format values are from moment's `formats.js`.
- **`idle_duration`** (alias `idleDuration`). It skips the newest non-system message, takes the user message before it, and returns `duration.humanize()` with no suffix. With no such message it returns `"just now"`. [V]
  - Thresholds: ≤44 s "a few seconds", <45 s "N seconds", ≤1 m "a minute", <45 m "N minutes", hours <22, days <26, months <11, then years (moment `humanize.js`/`relative.js`). [V]
- **Comments.**
  - `{{// x}}` and its alias `comment` give `''`.
  - Scoped form: `{{//}}…{{///}}`. `{{///}}` lexes as `//` with argument `/` and is treated as the closer (MacroCstWalker.js:194-205). Opener/closer pairs nest by stack. An **orphan closer stays literal** (line 134). [V]
- **Evaluation order.** Nested macros inside arguments resolve first (MacroEngine.js:217). The legacy order also substitutes env values (`char`/`user`) before `random`/`pick` (macros.js:620-672), so `{{random:{{user}},x}}` works. [V]
- **Where ST expands.** [V]
  - The greeting is stored **raw** (`getFirstMessage`, script.js:7709). Message 0 is substituted on first display and written back (`messageFormatting` 1805-1811), and also at generation (4489-4491). In practice it is rolled once and then stored, which matches our seed-time rendering.
  - World-info keys and content are substituted on every generation (world-info.js:4915/4947/5058). So are the card fields.
  - A swipe is a new generation, so `random` re-rolls.
- **CCv3** ([SPEC_V3 §CBS](https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md)). The MUST set is `char`, `user`, `random:` (comma, `\,` escape), `pick:` ("SHOULD … same value for the same prompt"), `roll:N`/`roll:dN`, `{{// A}}`, `hidden_key:A` (→ `''`), `comment: A` (→ `''` in the prompt) and `reverse:A`. Names SHOULD be case-insensitive. V2 adds only `{{original}}`. [V]

**Owner corpus** (`~/github/SillyTavern/data/default-user/worlds`, shapes only). Every `{{random` uses the single-colon comma form. Several are spelled `{{Random:`. Two contain a nested `{{user}}` inside multi-word sentence items. There are no `\,` escapes. Of the 12 random-bearing standalone entries, 2 are `constant`, 7 import to the **head** (ST positions 0/1) and 5 to the tail. [V]

## 3. Candidate designs

**D1: fresh entropy and wall clock per `render` call (ST-literal).** About 60 LOC.
- Debt: `post_history` re-rolls on every iteration, and its `{{time}}` can drift a minute away from the head's within one turn.
- Keys and content roll independently.
- It is untestable without monkeypatching `random`.
- ISS-45's probability roll would need its own RNG story later.

**D2 (RECOMMENDED): a per-turn macro context on `Macros` with deterministic per-occurrence seeding.**
- `Macros` gains `thread`, `salt`, `now` and `idle`, all with defaults so the existing `Macros(char=, user=)` test constructions survive. [V: 8 constructions]
- The session mints `salt` and captures `now` once in `__init__`. The session is per turn, so this means once per turn, and one value covers every iteration and every site.
- **random/roll** seed = hash(salt, thread, raw field text, macro raw text, occurrence index). It re-rolls per turn, which is ST parity, and stays byte-stable within the turn.
- **pick** uses the same key without `salt`, so it is stable for the thread's life. That is ST/Risu parity and also cache-friendly.
- Seeding on the occurrence index rather than the offset means renaming a persona does not reshuffle picks.
- Python's `random.Random(str)` is sha512-seeded and stable across `PYTHONHASHSEED`. [V, probed]
- Reused: `server_tz_key`, the `_now()` pattern, the shared `_MACRO_OPENER` grammar, the importers unchanged, and the turn-start activation precedent.
- Built: one grammar table, the handlers, an English formatter, a moment-compatible humanizer and a dice parser. Nothing like these exists today. [V: no humanizer in `app/`]
- ISS-45 can later roll probability from the same `salt` (shared seam).

**D3: a stored per-thread seed for everything (pick semantics).** This is best for the cache. But it breaks `random`'s contract ("re-rolls each time", ST docs; "a random value", CCv3). The owner's variety books would freeze for the whole thread. It needs storage or a rule that changes by position. Rejected.

**Accepted cost of D2.**
- A per-turn macro in a **head** text (SOUL, scenario, persona, examples, head lorebook entries) changes the coalesced system message every turn. corsair's llama.cpp then re-prefills from that point, **including the whole history**.
- The head lorebook block already does this whenever the activation set changes (R65 §9). D2 adds a miss on every turn, for agents whose text uses these macros only. Everyone else stays byte-identical.
- A **resume** builds a fresh session, so it re-rolls. That is the same accepted class as ACA-15e's memory re-read. If ISS-45 later needs activation to stay stable across a resume, pin `salt` through the existing M2/C-12 suspend pin (`skills_by_call`, api/agent.py:286). That would be additive.
- **Regenerate (D81) re-rolls, stated explicitly.** It is a new session with a new salt, which is ST's swipe semantics. The greeting is stored, so it never re-rolls, except that the ISS-49 re-seat re-seeds it, which is correct.

## 4. Minimal diff sketch

**macros.py**
1. Comment pre-pass: strip the scoped `{{//}}…{{///}}` (stack-paired) **before** the single-form `_COMMENT`. Extend the comment set to `comment:` and `hidden_key:`.
2. Keep the existing case-fold, once-rule and vocabulary substitution. This preserves ST's env-first order, so a nested `{{user}}` inside items is already substituted.
3. Add a feature pass that resolves innermost first. The argument text must contain no braces, and the pass loops to a fixpoint. It uses one regex compiled with **`re.I | re.A`**.
   - Without `re.A`, `weekday` matches `weeKday` (Kelvin sign). [V, probed] The module docstring already warns about this class of bug.
   - Separators are `:`, `::` and whitespace.
4. Handlers: `random`, `pick`, `roll` (with a dice-count cap constant), `reverse`, `time[::UTC±N]` (with the `time_UTC±N` rewrite), `date`, `weekday`, `isotime`, `isodate`, `idle_duration`/`idleduration`.
   - Write English month and weekday names explicitly; do not rely on `strftime` locale.
5. A malformed argument (a bad `roll` formula, for example) stays **literal**, per the house typo-is-visible rule. ST returns `''`; record the divergence.
6. Turn `VOCABULARY` into one table, `SUPPORTED`, that both the renderer and `unrendered` read. Line 113's predicate then asks the same grammar. `macros_for(agent, settings, *, thread="", salt="", now=None, idle=None)`.

**session.py**
- In `__init__`, add `self._macro_salt = secrets.token_hex(8)` and `self._macro_now = _now()` in the server zone.
- `_macros()` passes these, plus `self._macro_thread` and `self._macro_idle`.
- At all three entry points, **before** `_activate_lorebooks` (the scan renders keys), set the thread and idle via one helper.
- Idle = now − the ts of the newest `role='user'` row older than the turn's anchor. At `run_turn` the anchor is not yet persisted, so the newest row qualifies. No row gives "just now".

**conversation.py**
- `MessageRepo.last_user_ts(thread_id, before=None)`: one indexed `LIMIT 1` query.

**greeting.py:52**
- Pass `thread=thread.id` and `now`. Idle is `None`, which renders "just now".

**Importers:** no change. Only the expected strings in the tests change.

## 5. Tests

**Existing suites to update** (their "unsupported" fixtures use `{{time}}`/`{{random}}`/`{{date}}`/`{{idle_duration}}`; switch them to `{{lastMessage}}`/`{{datetimeformat …}}`):
- test_roleplay_s0.py:529-542
- test_roleplay_s2.py:835-853
- test_roleplay_s3.py:798-834 and 1122-1134

**New table-driven arms in test_roleplay_s0.py (unit):**
- **random:**
  - forms: `:`, `::`, `:a::b`, `\,`, trimming, `{{Random:`, nested `{{user}}`, empty list
  - same salt gives the same choice; a different salt can differ
- **pick:**
  - stable across salts and renders
  - differs across threads and across occurrences
- **roll:** `6`, `d6`, `2d6+1`, invalid stays literal, the cap.
- **simple ones:** `reverse`, `comment:`, `hidden_key:`.
- **Scoped comment:**
  - multi-line
  - opener with no closer
  - orphan closer
  - nested pair
- **Fixed clock** (monkeypatch `_now`, for example 2026-10-06 15:05 Europe/Madrid):
  - "3:05 PM", "October 6, 2026", "Tuesday", "15:05", "2026-10-06"
  - `{{time::UTC+2}}` and `{{time_UTC-5}}`
- **Idle humanizer table** at the moment thresholds, plus `None` → "just now".
- **Unicode look-alike** stays literal.
- **`unrendered`** no longer lists the supported names but still lists `lastmessage`/`datetimeformat`.

**Other new arms:**
- test_roleplay_s1.py near 173: the greeting renders `{{time}}`/`{{random}}` once at seed and stores the result.
- test_roleplay_s3.py: entry content `{{random:a,b}}` resolves to one item, and a key rolls consistently across its two render sites.
- Head stability: two `_assemble` calls in one session with a `{{random}}`/`{{time}}` SOUL are byte-identical, and `post_history` matches across iterations. Extend the arm that sits beside test_steer_drain_a_d41.py:351.
- Session idle: seed messages with known `ts` and check the humanized string.

## 6. Open questions for the owner

1. **Prompt-cache cost.** Accept that `{{random}}`/`{{time}}`/`{{idle_duration}}` in head text (SOUL, scenario, 7 of your head-landing book entries) re-roll every turn and re-prefill the history on corsair? *Default: accept. It is ST parity, and only cards that use these macros pay.*
2. **Clock.** Use emma's clock and zone (Europe/Madrid, the same as automations and monitor) rather than the phone's? *Default: server.*
3. **Scope.** Also build CCv3's required `roll`/`reverse`/`comment:`/`hidden_key:` and ST's `isotime`/`isodate`/`time::UTC±N`? *Default: yes; all are tiny and spec-mandated.* Leave `datetimeformat`, `timeDiff`, `newline`, `trim`, `space`, `noop`, `lastMessage`, `input`, `outlet`, `persona`, variables and `if` as recorded non-goals that the import report keeps naming? *Default: yes; none appear in your corpus.*

## 7. Risk and size

**Blast radius.** Every agent's prompt runs through `Macros.render`. Text with no `{{feature}}` stays byte-identical as long as the feature regex cannot match ordinary text.

**Pitfalls the build lane must avoid:**
- Breaking `_first_only`/`TOKENS` positional walking.
- Calling the clock per render, which would make the head disagree with `post_history`.
- Leaving out `re.A`.
- Running the scoped strip after the single-form `_COMMENT`, which would eat the markers and leak the body (today's bug).

**LOC estimate:** macros.py +170, session.py +25, conversation.py +12, greeting.py +3, tests +250 with about 20 lines changed.

**Docs:**
- ROLEPLAY_PLAN §4.3 amendment: vocabulary, order, seed rules, cache note, non-goals.
- ISSUES ISS-28 → FIXED.
- macros.py module docstring.
- HANDOFF pointer.

**Bounded sweep (3 items):**
- **(a)** `re.I` without `re.A` would bind Unicode look-alikes [V].
- **(b)** `_macros()` is rebuilt per call, so a naive `datetime.now()` in `macros_for` makes the head and `post_history` disagree within one turn [V].
- **(c)** ST leaves an orphan `{{///}}` literal, but our `_COMMENT` strips it (minor divergence; record it) [V].

## 8. What I could not determine

- The real re-prefill latency on corsair for a long RP history [U].
- The macro shapes inside the 168 PNG cards (I did not decode them; R87 counts 3 cards / 3 greetings using time/date) [R].
- Whether the phone's timezone ever differs from emma's [U].
- How the R87 count of "18 standalone" entries relates to my 12. R87 probably counted entries from its own decoding [U].
