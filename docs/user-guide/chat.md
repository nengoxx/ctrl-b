# Chat

The chat section is where you talk to your agents. You type (or dictate) a message, the agent answers in a streamed reply, and along the way it can call tools: ping or wake a computer, search the web, read a file you attached, remember something for later. Every agent keeps its own list of conversations, the reply keeps running on the server if you lock your phone, and anything medium- or high-risk (stopping a service, shutdown, reboot, shell) asks you first unless you have given the agent more privilege.

## How to use it

### Send a message

- Tap the text field, type, and tap the send arrow. **Enter** sends and **Shift+Enter** adds a new line. An Enter pressed while your keyboard is still composing a word (an input-method candidate) does not send.
- While a reply streams, the send arrow turns into a **stop** square. Tap it to stop the reply.
- If you send another message while the agent is still working, it does not start a second reply: it is **queued** into the running one and fed to the agent at its next step. A queued message shows muted with a **queued** chip; tap the chip to take it back. Tapping stop puts every queued line back in the text field.
- Scrolled up in a long conversation? The **↓ Jump to latest** pill takes you back to the bottom on the first tap, even while the list is still coasting.
- A reply you did not see yet counts as *unread*; opening the conversation on any device marks it seen everywhere.

### Commands

The first character of what you type decides where it goes.

| You type | What happens |
|---|---|
| `!<command>` | Runs a shell command on the computer that runs ctrl-b (not on a fleet host). Off unless you turn on the user shell in Conf → Shell; see [Fleet](fleet.md). The command and its output land in the conversation, so the agent can read them on its next turn. |
| `/new` | Starts a fresh conversation with this conversation's agent (its greeting shows at once). On a conversation you have not written in yet it only says `// this conversation is already new`. |
| `/agent <name>` | Chooses **who answers** in this conversation, on this device. `/agent` alone tells you who answers now. `/agent <this conversation's agent>` switches back. See [Who answers](#who-answers-agent). |
| `/privilege <level>` or `/priv <level>` | Sets the privilege for this conversation's agent, on this device: `read` (or `readonly`), `confirm`, `auto_low`, `full`. `/privilege`, `/privilege default` or `/privilege clear` goes back to the agent's own level. The chip in the chat header does the same with a tap. See [Privilege levels](#privilege-levels). |
| `/<provider> <message>` | Sends **this one message** to that inference provider (one verb per provider you configured — a provider named `openrouter` gives you `/openrouter`). |
| `/<provider>` (alone) | Makes that provider the **sticky** choice for this conversation's agent on this device. There is no clear verb: type the provider your normal chain starts with to go back. |
| `/compact [note]` | Summarises the older part of the conversation now to free context. The optional note steers the summary. |
| `/consolidate` | Sends your long-term memory consolidation prompt as a message (it is the prompt you can edit in Conf → Prompts). Needs memory auto-write **on**. |
| `/consolidate dry` | The same, as a plan that changes nothing. Needs memory auto-write **off** — the dry run is safe because writes are refused, not because the model was asked nicely. |
| `/<skill> <task>` | Runs the task with that skill active. `/<skill>` with no task only reminds you it needs one. |
| `/help` | Lists every command, including your providers by name. |
| anything else | A message to the agent. |

If a name could mean two things, built-in commands win over skills, and skills win over providers. Typing `/` shows suggestions; `/agent ` and `/privilege ` suggest names and levels. While the suggestions are open, the arrow keys move through them, **Tab** or **Enter** completes the highlighted one (Enter sends instead when what you typed already is that suggestion), and **Esc** closes them. An unknown command gets `// unknown command: /x — try /help` and is not sent to the agent.

`/agent`, `/privilege` and a sticky `/<provider>` are remembered in this browser (they survive a reload). Your other devices keep their own.

### The tools menu

The sliders button at the start of the composer opens the tools menu:

- **Agents** — one row per agent. Tapping a row opens that agent's latest conversation, or starts a greeted one if it has none. The checked row is the agent whose conversation you are in.
- **Skills** — tick skills to apply to your **next** message only. A dot on the button reminds you that skills are ticked. A `/command` that sends a message (a `/<skill>` or `/<provider>` line, `/consolidate`) replaces the ticks instead of adding to them.

### Attachments

Tap the paper clip, then choose:

- **Photos** — your phone's photo grid (multi-select). Photos are shrunk on your device before upload (longest edge 2048 px by default).
- **Files** — text, PDF, and any image the photo grid does not show.

On a desktop you can also paste or drag files onto the composer.

Accepted: images (PNG, JPEG, GIF, WebP), PDFs, and UTF-8 text files (`.txt`, `.md`, `.csv`, `.json`). The server checks the actual bytes: a photo saved as `.txt` is still treated as an image, and anything else is refused. Up to 10 files per message, 10 MB each (both configurable).

Files wait on the rail above the text field until you send. You can send them with no text. While a file is still uploading, the send button is disabled (Enter does nothing either); your text stays in the field until the upload has finished. Each conversation keeps its own rail.

What the agent receives:

- **Text and PDF** — the first page of text (16,000 characters by default) goes into your message. The agent reads the rest with its `read_attachment` tool, one page at a time. PDF text is extracted up to 200 pages or 400,000 characters.
- **Images** — sent to the model as pictures, and sent again with later turns so you can ask follow-up questions (up to 10 images per request; older ones become a short placeholder). The agent cannot re-open an image with a tool.
- **Images need a model that can see.** A model only gets images if its catalog entry says so: `input_modalities: [text, image]` under that model in Conf → Providers. Without it, the message still goes through, but each image is replaced by a short note telling the model it could not see it. The rail marks an image chip with a small warning ("the current model can't see images") when the first model of your normal chain is text-only. The check runs for each model the reply tries, so if a vision model fails over to a text-only one, only the fallback loses the images.

Attachments ride ordinary messages only. A `!` or `/` line leaves the rail as it was.

### Conversations

Every conversation belongs to the agent it was started with — its **home** agent — and never changes hands.

- The **conversations button** in the chat header opens the home agent's list: **New conversation** on top, then each conversation with its label, a preview, the time, and a dot when something is happening. The open one is marked.
- Dots: **needs you** (a confirm or a question is waiting), **a reply is running**, **unread**. The header button shows the strongest dot among the agent's *other* conversations.
- A row's **⋯** menu has **Rename** (up to 120 characters) and **Delete**. Deleting is refused while that conversation's reply is still running.
- **Show older** loads the next page (50 at a time).
- To reach a different agent's conversations, use the tools menu's agent rows or **Talk** on its card in the [Agents](agents.md) gallery.
- Your unsent **draft** is kept per conversation, in this browser.
- A conversation an automation keeps for itself is read-only here: you read it from the automation's run history instead ([Automations](automations.md)).

### Who answers (`/agent`)

`/agent <name>` lets another agent answer in the conversation you are in. It answers with **its own** persona, tools, skills, lorebooks and memory, but on **the home agent's model and privilege** (a `/privilege` override you set still wins). When an agent reads the history, other agents' replies appear to it as dialogue inside your turn (`Name: text`), not as its own words.

The choice belongs to this conversation on this device: opening another conversation clears it. A reply that is already streaming finishes as whoever started it; the change applies from the next reply. During a live call you cannot switch who answers or which conversation is open (`// hang up to switch …`).

### Replies: copy, retry, edit, delete

- Tap a reply's name line to show its details: the model, token counts and speed, and the actions **retry**, **edit** and **delete**.
- **Retry** writes a new version of the last reply. When there are several, **‹ n/count ›** flips between them; **›** on the last version writes another. A failed reply has its own **retry** under the error, which works the same way.
- A new version does not undo what the old one did. If the reply you retry ran a tool that is not marked safe to repeat — a reboot, a service restart, a shell command, a memory or skill write, subagents, a new automation, any remote-terminal tool, an outside tool its server does not mark read-only or repeatable — you are asked first (**Retry this reply?**), because the new version may run it again. Read-only tools (including OpenAPI `GET`/`HEAD` operations) and the ones where a second run changes nothing (wake, start or stop a service, shutdown, the plan) retry without asking.
- **Edit** changes a reply's text in place; the pencil on your own message edits it, and its editor also holds **Delete message**.
- Code blocks have **copy** and **edit** (edit drops the code into the text field).
- The name line shows which endpoint answered only when a fallback saved the reply, in a warning colour.

### Confirms and questions

When a tool needs your go-ahead, its bubble opens with **allow**, **always**, **edit** and **deny**.

- **allow** runs it once. **deny** declines it; the agent is told.
- **always** runs it and saves a standing grant for that exact call (same arguments). Revoke grants in the [Tools](tools.md#the-agent-tools-catalog) section, under the tool. **always** is not offered for shutdown, reboot, `run_shell` and `create_automation` (they always ask below Full) or for calls with list-shaped arguments.
- **edit** drops the command into the text field so you can change it.
- When the agent asks you something (the `question` tool), answer in the bubble.
- With memory auto-write off, a memory or skill change arrives as a proposal with **approve** / dismiss.

### Plan panel

For multi-step work the agent keeps a task plan (`task_plan`). It shows as a panel you can open from the composer and edit.

### Read aloud

With text-to-speech set up, each finished reply has a **read aloud** button. Auto-speak (the speaker toggle in the app bar) reads replies as they arrive — but only on the device that sent the message; your other devices stay quiet and show the button. See [Voice and calls](voice-and-calls.md).

### Tools the agent can call

What happens when the agent calls a tool depends on the tool's risk and the privilege the turn runs at. **runs** = no prompt · **asks** = a confirm bubble · **blocked** = refused.

| Tool | What it does | Read | Confirm | Auto-low | Full |
|---|---|---|---|---|---|
| `ping_host`, `wake_host`, `start_service`, `check_service`, `open_service_url` | Reach, wake and check fleet machines and services | runs | runs | runs | runs |
| `stop_service`, `restart_service` | Stop or restart a service on a host | blocked | asks | runs | runs |
| `shutdown_host`, `reboot_host` | Shut down or reboot a host | blocked | asks | asks | runs |
| `run_shell` | Shell command on the ctrl-b server | blocked | see below | see below | see below |
| `terminal_exec`, `terminal_write_file` | Command / file write on the open-terminal host (only when open-terminal is configured) | blocked | asks | asks | runs |
| `terminal_read_file`, `terminal_list`, `terminal_grep`, `terminal_glob` | Read-only file access on the open-terminal host | runs | runs | runs | runs |
| `web_search` | Web search (needs Conf → SearXNG) | runs | runs | runs | runs |
| `dns_trace`, `ip_info`, `yt_captions` | DNS lookup, IP lookup, YouTube captions | runs | runs | runs | runs |
| `task_plan`, `question`, `memory`, `session_search`, `read_attachment` | Plan, ask you, remember, search past conversations, read an attachment — always available, whatever the agent's tool list says | runs | runs | runs | runs |
| `skill_manage` | Create or edit a skill (writes, or proposes when skill auto-write is off) | runs | runs | runs | runs |
| `core_memory` | Long-term memory (only when Core Memory is on) | runs | runs | runs | runs |
| `list_automations` | List scheduled automations | runs | runs | runs | runs |
| `create_automation` | Schedule an automation | asks | asks | asks | runs |
| `spawn_subagents` | Hand independent sub-tasks to subagents running in parallel | asks | asks | runs | runs |
| `mcp__<server>__<tool>` | A tool from an MCP server | per tool — see [Tool servers](#tool-servers-mcp-and-openapi) | | | |
| `api__<server>__<operation>` | An operation from an OpenAPI server | per tool — see [Tool servers](#tool-servers-mcp-and-openapi) | | | |

**Always-allow rules.** A medium- or high-risk tool also runs without asking when an always-allow rule you saved for it covers the call — at any level, except for what Read blocks. A rule with no fields covers every call of that tool. Rules never apply to shutdown, reboot, `run_shell` and `create_automation`. See [Tools](tools.md#the-agent-tools-catalog).

`run_shell`: when `shell.enabled` is off, every run is refused before anything asks you. While the agent shell toggle (Conf › Shell › **Agent run_shell**, `shell.agent_exec_enabled`) is off, it is refused at every level, Full included. When the toggle is on, it asks at Confirm and Auto-low and runs without asking at Full. At Read it is always refused. The refusal names the switch that is off. Treat Full with that toggle on as "this agent may run shell commands on the server".

Agents running unattended (automations, subagents) never get a bubble: anything that would ask is refused on the spot and the agent is told.

### Privilege levels

Every agent has a privilege level (its form in the [Agents](agents.md) gallery; **Confirm** by default). The chat header chip and `/privilege` override it for that agent on this device; the chip shows **Default** when no override is set.

- **Read** — fleet and host actions above low risk are blocked: stopping or restarting a service, shutdown, reboot, `run_shell`, the open-terminal's command and write tools. Everything else behaves as under Confirm: MCP and OpenAPI tools, `spawn_subagents` and `create_automation` are not blocked — they ask (or run, when low risk) exactly as they would under Confirm.
- **Confirm** — low-risk tools run; medium- and high-risk tools ask.
- **Auto-low** — medium-risk tools run without asking (stop/restart a service, `spawn_subagents`, MCP/OpenAPI tools at the default risk); high-risk tools ask.
- **Full** — everything runs without asking, including `run_shell` when Agent run_shell is on.

The override is not capped: any level, `full` included, can be set from the chip.

### Memory

Agents remember things in small markdown files, read into every turn:

- each agent's own `MEMORY.md` (2,200 characters by default),
- one shared `USER.md` about you, read by every agent (1,375 characters),
- optionally each agent's `STATE.md` — mood and energy, off by default (600 characters).

The agent changes them with its `memory` tool (add, replace, remove). A write past the cap is refused. With **Auto-write** off, each change arrives as a proposal you approve in the chat (state changes still apply on their own). `session_search` lets an agent search your past conversations — across all agents, secrets of 8+ characters redacted (`redact.min_len`).

You can read and edit every memory file in Conf → Memory (one row per file; blanking a file clears it). The same panel has the optional **Consolidation nudge** (warn the agent when a file nears its cap), **Emotional state** (`STATE.md`) and **Periodic reflection** (every 10 of your messages, nudge the agent to save what matters).

**Core Memory** (long-term memory) is **off** by default. Turn it on in Conf → Memory → Core Memory → **Core Memory enabled**. It is one shared notebook — an index plus topic files under `memories/core/` — that agents read on demand with the `core_memory` tool. When the index fills up, the chat shows `// memory index at N% — run /consolidate when convenient`.

**Backups.** The memory folder (`$CTRLB_HOME/memories`, `~/.ctrl-b/memories` on a standard Linux install) is a git repository. Every write the agent makes is committed, and edits you make by hand are committed every 2 minutes. To see or restore an older version, use git there, for example `git -C ~/.ctrl-b/memories log`.

### Context limits and compaction

When a conversation's working context passes 85% of the model's context window, the oldest complete turns are summarised into one message and a `// …` note says so. The full history stays in the database; only what the model is sent shrinks. The last 8 messages and the last 4,096 tokens are always kept. Earlier, from 50% of the window, large old tool outputs are cleared first (the plan and memory tools' outputs are never cleared). The window comes from `context_window` on the model in Conf → Providers, else from the llama.cpp server itself; with neither, compaction starts at 6,000 tokens. Tune it in Conf → Agents → **Auto-compact**, or run `/compact` yourself.

### Providers and fallbacks

Conf → Providers holds your connections. Each has a model catalog: the catalog name is what you see and pick, and an optional `id` is the model name actually sent to the server. Conf → Inference picks the **primary** and an ordered list of **fallbacks**.

- If the primary cannot be reached within 5 seconds, the reply moves on to the next fallback (`// failover → …`). An unreachable server is then tried last for the next 60 seconds, so a dead primary stops slowing every reply.
- A temporary error is retried on the same endpoint twice before failing over (`// retrying … in Ns (attempt 1/2 …)`).
- One model request may take up to 600 seconds (`inference.request_timeout_s`). Keep it generous: thinking models load and stream slowly.
- An agent can use its own model (the **Backend** picker in its form). A `/<provider>` verb moves that provider to the front of the chain; the rest of the chain still backs it up.

### Web search and the remote terminal

- **Web search** (`web_search`) uses your SearXNG instance, set in Conf → **SearXNG** (`base_url`, without `/search`). The instance **must enable the JSON format** in its own `settings.yml` (`search: {formats: [html, json]}`): a stock SearXNG serves only HTML, and `web_search` then reports a failure instead of results. With no `base_url` (or `enabled: false`) the tool says web search is not configured.
- **Open-terminal** (Conf → **Open-terminal**) connects an open-webui/open-terminal server — a remote shell and file API on another machine, with a Bearer token. Its risk is per operation: reads (`read_risk`) default to low and run without asking; `exec_risk` and `write_risk` default to **high** — arbitrary remote shell, so keep them gated. A change to its address or token applies at once, but its tools are set up only when ctrl-b starts: configure it for the first time, or change a risk setting, and you need a restart before it takes effect ([ISS-92](../ISSUES.md)).

### Tool servers (MCP and OpenAPI)

Conf → **MCP servers** and Conf → **OpenAPI tool servers** connect outside tools.

- **MCP** — a server over HTTP (`url` + optional `headers`) or a local program (`stdio`: `command`, `args`, `env`). Its tools appear as `mcp__<server>__<tool>`.
- **OpenAPI** — any service with an OpenAPI document (`spec_url`, or `base_url` + `/openapi.json`). Each operation becomes `api__<server>__<operationId>` (an operation without an id gets one built from its method and path). `include` limits it to the operation ids or paths you list. Auth: `api_key` with `auth_scheme` (default `Bearer`) in `auth_header` (default `Authorization`), plus any `headers`.
- **Risk is per tool.** A server's `risk` (default `med`) is only its default. An MCP tool the server marks read-only runs without asking (low); one it marks destructive is high risk and asks below Full, unless an "always allow" rule you saved covers the call. Most servers mark nothing, so their tools take the server's `risk`. For OpenAPI, `GET` and `HEAD` operations are always low; the others take the server's `risk`. Set `risk: low` only on a server you trust.
- **When changes apply.** Saving a server change takes effect at the start of your next chat message (once no reply is running anywhere), or right away with **Rediscover tools** (refused while any reply is running). A server that is down when tools are discovered is skipped, and its tools stay missing until the next rediscovery — it does not come back on its own.
- Tool names are cut to 64 characters, so two long names can collide.

An example `config.yaml` block, one server of each transport:

```yaml
mcp_servers:
  - name: web-tools
    transport: streamable_http   # a remote server: url (+ optional headers for auth)
    url: http://192.168.1.160:3003/mcp
    risk: med                    # the default for tools the server does not annotate
  - name: filesystem
    transport: stdio             # a local program: command + args (+ optional env)
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/data"]
    risk: high
```

Each server also takes `enabled`, `connect_timeout_s` (10 s, for discovery and each call's handshake) and `call_timeout_s` (the whole call; unset = `connect_timeout_s`). OpenAPI servers take `connect_timeout_s` (15 s) and `call_timeout_s` (60 s).

## Settings that affect it

| Setting | What it changes | Default | Applies |
|---|---|---|---|
| [`agent.streaming`](configuration-reference.md#agent) | `auto` streams; `on` always streams; `off` returns each reply whole (for a flaky link) | `auto` | next chat turn |
| [`agent.default_agent`](configuration-reference.md#agent) | Which agent a conversation starts with when you start one without choosing | `""` (the root agent) | live |
| [`agent.compaction.*`](configuration-reference.md#agentcompaction) | When and how old turns are summarised (Conf → Agents → Auto-compact) | on, at 85% | next chat turn |
| [`agent.turns.max_active_turns`](configuration-reference.md#agentturns) | How many replies may run at once across all conversations (automations count too) | `4` | live |
| [`agent.turns.steer_queue_max`](configuration-reference.md#agentturns) | How many messages can queue into one running reply | `8` | live |
| [`inference.provider` / `model` / `fallbacks`](configuration-reference.md#inference) | The primary model and the fallback chain | none (chat refuses until set) | next chat turn |
| [`inference.connect_timeout_s`](configuration-reference.md#inference) | How long to try reaching an endpoint before failing over | `5` s | next chat turn |
| [`inference.connect_cooldown_s`](configuration-reference.md#inference) | How long an unreachable server is tried last (`0` = off) | `60` s | next chat turn |
| [`inference.retry_attempts`](configuration-reference.md#inference) | Same-endpoint retries on a temporary error | `2` | next chat turn |
| [`inference.request_timeout_s`](configuration-reference.md#inference) | How long one reply may stream | `600` s | next chat turn |
| [`inference.failover`](configuration-reference.md#inference) | Off = only the primary is ever tried | `true` | next chat turn |
| [`providers.<p>.models.<m>.input_modalities`](configuration-reference.md#providers) | `[text, image]` lets that model see attached images | unset (text-only) | next chat turn |
| [`providers.<p>.models.<m>.context_window`](configuration-reference.md#providers) | The window compaction measures against | unset (asks llama.cpp) | next chat turn |
| [`attachments.max_files_per_message`](configuration-reference.md#attachments) | Files per message | `10` | live |
| [`attachments.max_file_mb`](configuration-reference.md#attachments) | Size of one file | `10` MB | live |
| [`attachments.image_max_dimension` / `image_quality`](configuration-reference.md#attachments) | How photos are shrunk on your device before upload; used from the next file you pick | `2048` px / `0.85` | live |
| [`attachments.max_inline_chars`](configuration-reference.md#attachments) | Text put into your message (and one `read_attachment` page) | `16000` | next chat turn |
| [`attachments.resend`](configuration-reference.md#attachments) | Send earlier images again on later turns | `true` | next chat turn |
| [`attachments.staging_orphan_hours`](configuration-reference.md#attachments) | How long an unsent upload is kept | `24` h | live |
| [`memory.enabled`](configuration-reference.md#memory) | Memory on or off (also gates Core Memory) | `true` | live |
| [`memory.auto_write`](configuration-reference.md#memory) | Off = memory changes become proposals you approve | `true` | live |
| [`memory.user_profile_enabled`](configuration-reference.md#memory) | Read and write the shared `USER.md` | `true` | live |
| [`memory.memory_char_limit` / `user_char_limit`](configuration-reference.md#memory) | Size caps of `MEMORY.md` / `USER.md` | `2200` / `1375` | live |
| [`memory.state_enabled`](configuration-reference.md#memory) | Per-agent `STATE.md` | `false` | live |
| [`memory.reflection_enabled`](configuration-reference.md#memory) | Periodic "save what matters" nudge | `false` | next chat turn |
| [`memory.consolidation_nudge`](configuration-reference.md#memory) | Warn the agent near a cap | `false` | next chat turn |
| [`memory.longterm.backend`](configuration-reference.md#memorylongterm) | `core` turns Core Memory on | `null` (off) | live |
| [`memory.git_backup.*`](configuration-reference.md#memorygit_backup) | The memory folder's git history; `reconcile_interval_s` = how often hand edits are committed (`0` = never) | on, `120` s | live |
| [`shell.enabled` / `user_exec_enabled` / `agent_exec_enabled`](configuration-reference.md#shell) | The `!` shell and `run_shell` — see the `run_shell` note above | `true` / `false` / `false` | live |
| [`tool_overrides`](configuration-reference.md#tool_overrides) | Per-tool description, agent access, "always" grants, call cap (the Tools section); the grants apply live | none | next chat turn |
| [`mcp_servers` / `openapi_servers`](configuration-reference.md#mcp_servers) | Outside tool servers; **Rediscover tools** applies them at once | none | next chat turn |
| [`prompts`](configuration-reference.md#prompts) | Your overrides of built-in prompts (Conf → Prompts) | none | next chat turn |
| [`searxng`](configuration-reference.md#searxng) | The SearXNG instance behind `web_search` (needs its JSON format on) | none | live |
| [`open_terminal`](configuration-reference.md#open_terminal) | The remote terminal server and its per-operation risks; changing an address that was already set, the token, and turning it off apply live ([ISS-92](../ISSUES.md)) | none; exec/write `high`, read `low` | restart (not flagged) |
| [`embeddings`](configuration-reference.md#embeddings) | Points at a provider + model (its `dim` lives on the model) — nothing uses it yet ([ISS-96](../ISSUES.md)) | none | inert |

## Edge cases & limits

- **Locked phone, closed app, lost signal.** The reply keeps running on the server. When you come back the chat catches up; a conversation still running shows its dot. A message that never reached the server is taken out of the log and put back in the text field (`// that message didn't reach the server — it's back in the composer`).
- **Two devices.** Conversations, unread state and replies are shared. Drafts, the `/agent` choice, privilege overrides and sticky providers are per device. Only the device that sent a message auto-speaks its reply. A message sent from a second device while a reply runs is queued into it.
- **Busy limits.** A reply already running in a conversation and the queue full: `// a turn is already running on this thread — wait for it to finish`. More than 4 replies running at once: `// too many turns are running — wait for one to finish`.
- **Step limit.** After 16 tool steps without a final answer the reply stops with `// reached the step limit — send a message to continue`. The agent's other loop guards (repeated identical calls, calls per tool, stalls) are in its form under **Limits**.
- **An agent that no longer exists.** A deleted agent's conversations (if you kept them) are listed nowhere; re-creating an agent with the same name brings them back. A conversation still open on screen is answered by the agent new conversations start with (`agent.default_agent`; blank = the root agent).
- **Unknown agent.** `/agent nobody` changes nothing and shows `No agent named "nobody"`. While the conversation's own agent is still loading, `/privilege` and a bare `/<provider>` refuse with `// this conversation's agent isn't known yet — try again in a moment`.
- **Vision hint.** The rail's "can't see images" warning only knows your normal chain; with a `/<provider>` override in force it may be wrong.
- **Android file picker.** A file picked from Downloads can be reported as 0 bytes; images then refuse in the page. Pick photos from the **Photos** door, or a file through a file manager ([ISS-47](../ISSUES.md)).
- **Restart-only settings.** `agent.skills_dir`, `agent.skill_min_overlap`, `agent.skill_max_active` and `agent.global_subagent_limit` are read once at startup, and Conf does not say so yet ([ISS-92](../ISSUES.md)).
- **Embeddings.** Configuring them changes nothing today: past-conversation search is full-text and Core Memory search is literal ([ISS-96](../ISSUES.md)).
- **Look and feel.** The conversations button scrolls away in a long conversation ([ISS-82](../ISSUES.md)); the conversations sheet's look is due a refresh ([ISS-72](../ISSUES.md)).

## Under the hood

Design: [`docs/DESIGN.md`](../DESIGN.md) (agent loop, tools, memory) · conversations [`docs/CONVERSATIONS_PLAN.md`](../CONVERSATIONS_PLAN.md) · attachments [`docs/ATTACHMENTS_PLAN.md`](../ATTACHMENTS_PLAN.md).
