# Agents

An agent is a personality plus a set of permissions: who it is (its persona text), which model it runs on, which tools and skills it may use, how much it may do without asking, and — for characters — its greeting, scenario and lorebooks. ctrl-b always has one agent, the **root agent** (named `default`), and you can add as many more as you like. Each agent keeps its own conversations and its own memory.

## How to use it

### The Agents gallery

Open the **Agents** section. Where it lives is your choice, per device, in Conf → Appearance → **Agents**: its own seat on the bar (**tab**), a group inside Conf (**conf**), or an entry in the navigation menu (**button**) — see [Themes](themes.md).

- Every agent is a card: its portrait (or a letter tile when it has none), its name and its one-line description. A dot on the card means one of its conversations needs you, has a reply running, or is unread.
- **Tap a card** to open its editor. **‹ all agents** — or your phone's Back gesture — returns to the grid.
- **Talk** opens that agent's latest conversation, or starts a new one with its greeting if it has none.
- The **default** pill on each card chooses which agent a conversation starts with when you start one without picking an agent. Tap a pressed pill to unset it; the root agent is then the default again. On a fresh install no pill is pressed.
- **Add agent** (at the top) asks for a **slug** — the folder name and the name you use in `/agent`, lowercase letters, digits, `-` and `_`, starting with a letter or digit, up to 64 characters — and an optional **display name**. With Conf → Roleplay → **Roleplay fields** on, the same disclosure also offers **Import character card** (see [Characters and lorebooks](characters-and-lorebooks.md)).

### The agent editor

Every field saves together with **save**. Fields you do not set are inherited (see [Where agents live](#where-agents-live)).

- **Display name** and **Description** — what the gallery, the chat's name line and `{{char}}` show. Without a display name the slug is used.
- **Duties** — **Agent** (tool-focused instructions) or **Talk** (conversational instructions). This changes the guidance text the agent gets; what it may *do* is set by Tools, Skills and Privilege. One exception: switching an agent other than the root from **Agent** to **Talk** while it has every tool ticks only the tools in Conf → Roleplay → **Character tools** (`web_search` by default). You see it in **Tools** and can change it before you save.
- **Backend** — the provider and model this agent runs on, plus **Max output tokens**, **Reasoning effort** and **Reasoning tokens**. Unset, it uses your primary from Conf → Inference. Either way the rest of your fallback chain still backs it up.
- **Privilege** — Read, Confirm (default), Auto-low or Full. What each level allows is in [Chat → Privilege levels](chat.md#privilege-levels).
- **Persona · SOUL.md** — who the agent is. This is the first thing in its instructions. An agent without one uses `inference.system_prompt` from Conf → Inference, else the built-in assistant prompt.
- **Prompt append** — extra instructions added after the persona. **Inherit global append** decides whether the global `inference.system_prompt_append` is added too (global first, then the agent's own).
- **Your persona** — which of your personas this agent talks to (see [Personas](#personas)).
- Character fields — **Greeting** and **Use greeting**, **Example dialogue**, **Scenario**, **Post-history** (instructions placed after the conversation, so the model reads them last). They show when Roleplay fields is on, or when the agent already uses them.
- **Voice** — a text-to-speech voice id for this agent; empty uses the global voice ([Voice and calls](voice-and-calls.md)).
- **Avatar** and **Background** — images from the agent art libraries ([Media](media.md)).
- **Lorebooks** — books this agent reads ([Characters and lorebooks](characters-and-lorebooks.md)).
- **Tools** — every agent tool (`*`, the default) or a list; names may use wildcards such as `mcp__web-tools__*`. The always-available tools (`task_plan`, `question`, `memory`, `session_search`, `read_attachment`) survive any list.
- **Skills** — every skill (`*`), a list, or none.
- **Limits** — **max iters** (tool steps per reply, 16), **repeat cap** (identical calls before they are suppressed, 2), **per-tool cap** (calls to one tool per reply, 6), **stall cap** (steps without progress, 2), **subagent depth** (2) and **fan-out cap** (subagents at once, 3).

The footer has **remove**, **export** (a character card — saved changes only; it says **save first** while you have unsaved edits) and **save**.

**Removing an agent** deletes its folder (`agent.yaml`, `SOUL.md`, an imported card's data, its own skills) and its memory folder — unless `agent.yaml` points its memory somewhere else (`memory_dir`), in which case that memory is kept. The lorebooks and images it uses stay in their libraries. An automation pinned to it stops working, and the report names it. If the agent has conversations you are asked a second time: **Delete** removes them too, with their attachments; cancel keeps them in the database, listed nowhere, and re-creating an agent with the same slug brings them back. The root agent cannot be removed.

### The root agent and specialists

- The **root agent** (`default`) has no folder of its own. Its persona is `SOUL.md` in your data folder, its settings are `agent.defaults`, and its display name is `agent.default_title`. Its memory sits at the top of the memory folder, and the skills it writes go into the shared `skills/` folder.
- Every other agent is a **specialist** with its own folder. It inherits `agent.defaults`, except its display name and its greeting (a specialist never borrows the root's greeting).

### Conversations belong to an agent

A conversation stays with the agent it was started with, its **home** agent. The conversations button always lists the home agent's conversations. Another agent can answer inside it with `/agent <name>` — it then speaks with its own persona, tools, skills, lorebooks and memory, on the home agent's model and privilege — and other agents' replies read to it as dialogue (`Name: text`) inside your turn. Details: [Chat → Who answers](chat.md#who-answers-agent).

### Greetings

An agent with a **Greeting** opens each new conversation with it, as a real first reply.

- It is written when you start a conversation yourself: **New conversation**, `/new`, **Talk**, an agent row in the tools menu, or your first message when no conversation is open. Automations and subagents never get one.
- Macros in it (`{{user}}`, `{{random:…}}`, `{{time}}`…) are filled in once, at that moment, and stay as written.
- **Use greeting** off: new conversations start empty. The text is kept (and still exported); conversations that already have the greeting keep it.
- A greeted conversation is not marked unread.
- Imported cards can carry alternate greetings. They are stored and exported, but there is no picker for them yet.

### Skills

A skill is a folder with a `SKILL.md`: optional frontmatter (`name`, `description`, `allowed_tools`) followed by instructions. With no frontmatter the folder name is the skill's name and the whole file is the instructions.

- **Shared skills** live in `skills/<name>/SKILL.md` in your data folder; manage them in Conf → **Skills** (create, edit, delete, and the **Skills enabled** master switch). Folder names follow the slug rule above.
- **An agent's own skills** live in `agents/<slug>/skills/<name>/SKILL.md`. An own skill replaces a shared one with the same name. The agent's **Skills** list decides which shared skills it gets; its own are always available.
- **When a skill applies:** automatically, when words in your message overlap the skill's name and description (at least one word, at most 2 skills per message); when you type `/<skill> <task>`; or when you tick it in the tools menu for your next message.
- While a skill is active, its `allowed_tools` narrows the agent's tools for that message. It can never add a tool the agent does not have, and the always-available tools stay.
- Agents can write skills themselves with `skill_manage`: a specialist writes into its own folder, the root agent into the shared one. With `agent.skills_auto_write` off, those writes come to you as proposals.
- Skill files are re-read every time, so a skill you drop into the folder works at once.

### Subagents

An agent can hand several independent sub-tasks to subagents with `spawn_subagents`; they run at the same time and their results come back to it.

- At the default **Confirm** privilege (and at **Read**) you are asked before each fan-out (it is a medium-risk tool); at **Auto-low** or **Full** it runs without asking. The bubble offers no **always**, but an always-allow rule you add for `spawn_subagents` in [Tools](tools.md#the-agent-tools-catalog) without any field lets every fan-out run unasked at any level.
- Each subagent runs unattended, in its own hidden conversation: anything that would ask you is refused, and the subagent is told.
- While `agent.subagent_clamp_privilege` is on (the default), a subagent never has more privilege than the agent that started it.
- Limits: nesting depth (2) and fan-out (3) per agent, 6 at once across the whole server, and 180 seconds per subagent.

### Macros

Placeholders in `{{…}}` are filled in when the prompt is built:

- `{{char}}` — the agent's display name (else its slug). `{{user}}` — the name of the persona it talks to (else `User`). `{{original}}` — your `inference.system_prompt`, for a persona that wraps it.
- `{{random:a,b,c}}`, `{{pick:a,b,c}}` (stays the same for the whole conversation), `{{roll:2d6}}`, `{{reverse:text}}`.
- `{{time}}`, `{{date}}`, `{{weekday}}`, `{{isotime}}`, `{{isodate}}` (the server's time zone), `{{time::UTC+2}}`, `{{idle_duration}}` (time since your previous message).
- Comments, removed before the model sees them: `{{// note}}`, `{{comment: note}}`, and a block from `{{//}}` to `{{///}}`.

They work in the persona, scenario, example dialogue, post-history, your persona's About, and lorebook keys and content; the greeting fills them once (above). Prompt append does not use them. Names are case-insensitive; one written wrong stays as literal text.

`{{random}}`, `{{roll}}` and the time macros (`{{idle_duration}}` included) change every message. In the persona, scenario, example dialogue, your persona's About or a lorebook entry placed at the top, that makes the model server re-read the whole conversation on every message (its prompt cache cannot help). The editors warn you under such a field while you type, and card and lorebook imports count them in their report.

### Personas

A persona is **you**, as an agent sees you: a **name** (what `{{user}}` becomes) and an **About** text the agent reads.

- Manage the library in Conf → **Roleplay**: add a persona, edit its About, and choose the **Default persona**.
- In an agent's editor, **Your persona** links one persona to that agent. An agent with no link uses the default persona; with neither, `{{user}}` is `User`.
- Personas work for every agent, whether Roleplay fields is on or not.
- Renaming a persona keeps every link. Deleting one leaves links pointing at nothing, and those agents fall back to the default persona.

### Where agents live

An agent **is** a folder: `$CTRLB_HOME/agents/<slug>/` (`~/.ctrl-b/agents/` on a standard Linux install), holding an optional `agent.yaml` (any editor field) and an optional `SOUL.md` (the persona). The folder counts as an agent once it holds either file. The gallery and the editor read and write these files; you can also edit them by hand.

- Fields an agent leaves out inherit `agent.defaults` in `config.yaml`, then the built-in defaults (Confirm privilege, every tool, every skill).
- Everything is read again on each message, so an edit — in the app or by hand — applies to the next reply, with no restart.
- There is no `agents:` list in `config.yaml`. An old `agents:` block is kept in the file but does nothing.

## Settings that affect it

| Setting | What it changes | Default | Applies |
|---|---|---|---|
| [`agent.default_agent`](configuration-reference.md#agent) | The agent new conversations start with (the gallery's **default** pill) — `""` none set, `default` the root, or a slug | `""` | live |
| [`agent.default_title`](configuration-reference.md#agent) | The root agent's display name | `""` | live |
| [`agent.defaults`](configuration-reference.md#agent) | Fields every agent inherits (model, privilege, tools, limits…) | none | next chat turn |
| [`inference.system_prompt`](configuration-reference.md#inference) | The persona of any agent without its own `SOUL.md` | built-in prompt | next chat turn |
| [`inference.system_prompt_append`](configuration-reference.md#inference) | Instructions added to every agent that inherits the global append | `""` | next chat turn |
| [`agent.skills_enabled`](configuration-reference.md#agent) | Skills on or off | `true` | next chat turn |
| [`agent.skills_auto_write`](configuration-reference.md#agent) | Off = an agent's skill edits become proposals | `true` | next chat turn |
| [`agent.skills_dir`](configuration-reference.md#agent) | The shared skills folder (relative to `$CTRLB_HOME`) | `skills` | **restart** ([ISS-92](../ISSUES.md)) |
| [`agent.skill_min_overlap` / `skill_max_active`](configuration-reference.md#agent) | How many words must overlap / how many skills apply per message | `1` / `2` | **restart** ([ISS-92](../ISSUES.md)) |
| [`agent.global_subagent_limit`](configuration-reference.md#agent) | Subagents at once across the server | `6` | **restart** ([ISS-92](../ISSUES.md)) |
| [`agent.subagent_clamp_privilege`](configuration-reference.md#agent) | While on, subagents never exceed their parent's privilege | `true` | live |
| [`agent.subagent_child_timeout_s`](configuration-reference.md#agent) | Time limit per subagent | `180` s | live |
| [`roleplay.enabled`](configuration-reference.md#roleplay) | Shows the character fields and the card import (display only) | `false` | live |
| [`roleplay.personas` / `default_persona`](configuration-reference.md#roleplay) | Your persona library and the default one | none | next chat turn |

## Edge cases & limits

- **Restart-only skill settings.** After changing `agent.skills_dir`, Conf → Skills keeps listing the old folder while new skills are written to the new one, until you restart ([ISS-92](../ISSUES.md)).
- **A skill name with a space** can still be picked automatically, but it cannot be typed as `/<skill>` and the `/` suggestions skip it.
- **Deleting an agent with a reply running.** When you also delete its conversations, the delete is refused while one of them has a reply running.
- **Unknown names.** A conversation whose agent is gone is answered by your default agent; `/agent <unknown>` changes nothing.
- **Character card import is hidden** until Conf → Roleplay → Roleplay fields is on.
- **Gallery buttons.** The add-agent and import buttons sit close together and look alike ([ISS-85](../ISSUES.md)).

## Under the hood

Design: [`docs/ROLEPLAY_PLAN.md`](../ROLEPLAY_PLAN.md) (agents, characters, personas) · [`docs/DESIGN.md`](../DESIGN.md) §5 (the agent loop, skills, subagents).
