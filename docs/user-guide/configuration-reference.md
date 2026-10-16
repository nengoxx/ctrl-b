# Configuration reference

ctrl-b keeps every setting in one YAML file, `config.yaml`. Conf edits that file for you, and you can also edit it by hand. This page lists every key the app reads: its type, its default, what it changes, and when a change takes effect. [`config.example.yaml`](../../config.example.yaml) holds the same keys as an annotated file you can copy from.

## How configuration works

### Where the files live

- **`config.yaml`** sits in your data folder, `$CTRLB_HOME`. When `CTRLB_HOME` is unset, the data folder is the code checkout itself. A server install sets `CTRLB_HOME=~/.ctrl-b`, so the file is `~/.ctrl-b/config.yaml`.
- **`CTRLB_CONFIG`** points at a different config file and wins over `$CTRLB_HOME/config.yaml`. **`CTRLB_DB`** does the same for the database (default `$CTRLB_HOME/ctrlb.db`). Use both to try changes on a scratch copy and never on your real file.
- **`.env`** always lives in the code checkout (`<checkout>/.env`), never in `$CTRLB_HOME`. Its variables fill the environment at startup. A variable that is already set in the real environment wins over `.env`. `CTRLB_ENV` moves the `.env` file, so it only works when you set it in the real environment.
- The data folder also holds `ctrlb.db`, `agents/`, `skills/`, `memories/`, `media/`, `attachments/`, `lorebooks/`, `calls/` (call trails, written while `voice.live.debug` is on) and `backups/` (config backups written by the migration tool).

`config.yaml` holds secrets: SSH passwords, API keys, and MCP/OpenAPI credential headers. Keep it out of git; the repo's `.gitignore` already excludes it. The app's own saves leave it at mode 0600; a copy you made with `cp` keeps its original mode until the first save.

### Environment overrides

A variable named `CTRLB_<SECTION>__<KEY>` (two underscores) overrides one key, and it wins over `config.yaml`. Example: `CTRLB_SERVER__POLL_SECONDS=10`.

- It reaches **one level only**: a scalar key directly inside a section (`server.poll_seconds`, `tailscale.target_port`). It cannot reach `voice.live.*`, a provider, a host, or their credentials. The one secret it can set is `open_terminal.api_key` (`CTRLB_OPEN_TERMINAL__API_KEY`).
- Names are case-insensitive. The value is a string that the schema converts.
- An unknown key inside a section (`CTRLB_SERVER__NOPE`) is logged as ineffective and ignored.
- An override aimed at a map or list section (`CTRLB_PROVIDERS__…`, `CTRLB_COMPUTERS__…`, `CTRLB_MCP_SERVERS__…`), at a list or nested field (`CTRLB_SERVER__TRUSTED_HOSTS`, `CTRLB_AGENT__COMPACTION`), or carrying a bad value (`CTRLB_SERVER__PORT=abc`) fails validation, and **the server refuses to start** (exit code 78; the message names the path).
- Conf shows an overridden value with no marker. If you edit it in Conf, the change applies live and is written to the file. The environment value comes back at the next restart, or at the next host, persona or integration save, because those saves reload the file.

### Typos do nothing

Most sections accept keys they don't know and keep them untouched (`server` drops them instead). A misspelt key or section, such as `inferance:` or a top-level `agents:` list, loads without complaint and does nothing. If a setting seems to have no effect, check its spelling against this page. A few places refuse unknown names: `media` (namespaces, roles and slots are checked), a tool's `approvals` rules, and model pointers such as `agent.compaction.summarizer`. An unknown environment override is logged, as described above.

### How saving works

- Conf saves only the values you changed. Your hand-written comments, quoting and line endings stay as they were. The file is replaced atomically (a temp file, then a rename).
- A save never overwrites a hand edit you made to other keys. A hand edit you have not restarted for goes live early when you save a host or a persona, because those saves reload the whole file; saving an integration also reloads it, but a hand edit to a connection section (providers, inference, voice, embeddings, SearXNG, open-terminal) then shows in Conf without taking effect until you restart.
- **Secrets:** Conf shows a secret masked (`ab…yz`, or `••••` when it has four characters or fewer). Saving a secret field empty, `null`, or with the mask unchanged **keeps the stored secret**. You cannot clear a secret from Conf. To clear one, edit `config.yaml` by hand, or delete the provider or host.
- A bad value is refused with an error and nothing is written. A hand edit that does not validate stops the server at startup (exit code 78) with a message naming the key.
- Some maps have their own editor and are refused by the generic settings save: `computers` (the host editor in Conf → Computers) and `roleplay.personas` (the persona editor).

### Upgrading: config migrations

When a release changes the shape of the config, the server refuses to start on the old file (exit code 78) and prints the command to run:

```
backend/.venv/bin/python -m app.config_migration --check   # read-only report
backend/.venv/bin/python -m app.config_migration --apply   # migrate in place
```

`--apply` first writes a timestamped copy (mode 0600) of your config to `$CTRLB_HOME/backups/`, then rewrites only the old keys, and stamps `config_version`. Those backups are never pruned. If an environment override you set targets a key a release has retired, `--check` and `--apply` refuse and name the variable: unset it, move its value into `config.yaml`, and run them again (at startup the server only logs an error about it, and the variable does nothing). On a server install, the install and update scripts run this step for you; see [`deploy/linux/README.md`](../../deploy/linux/README.md).

### When a change takes effect

The **applies** column describes a change saved through Conf (or the settings API). **A hand edit of `config.yaml` always needs a restart, whatever the row says**, because the file is read only at startup. (A hand edit can also go live early, as described under "How saving works".)

The column uses these words:

- **live**: the running server picks the change up as soon as you save. Settings the browser reads (call knobs, notification preferences, the fleet poll) reach the device that saved at once, and other devices on their next refresh, within about a minute.
- **next chat turn**: read when the next agent turn starts. A turn already running finishes on the old value.
- **next call**: read when a call or a streaming dictation starts. One already running keeps the values it started with.
- **restart**: read once at startup, so restart the service (`systemctl --user restart ctrl-b-dashboard` on a server install). Conf says "restart to apply" only for `server.host`, `server.port` and `server.debug`.
- **restart (not flagged)**: also takes effect at the next restart, but Conf shows no notice when you change it ([ISS-92](../ISSUES.md)).
- **next app load**: the browser reads it when the app opens.
- **this device only**: stored in the browser, not in `config.yaml`; it applies at once on that device, and your other devices keep their own value. (Only the guide's pages use it: those settings have no `config.yaml` key.)
- **inert**: the key is accepted and saved, but nothing reads it, so changing it does nothing today.

A **security gate** label marks a key that decides what can run on your machines.

## config_version

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `config_version` | int | absent | Marks the config shape. The migration tool writes it; don't edit it. A file marked with a version newer than this build understands refuses to start. | restart |

## server

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `host` | string | `127.0.0.1` | **Inert: [ISS-91](../ISSUES.md).** It binds nothing. The listening address comes from the uvicorn command line in the service unit or launcher (`--host 0.0.0.0 --port 5433` in the server unit). Nothing reads the key except Conf's restart notice. | inert |
| `port` | int | `5433` | **Inert: [ISS-91](../ISSUES.md).** Same as `host`: to move the port, change the unit's command line (and `tailscale.target_port`). The key only changes what `/api/health` reports. Conf's "restart to apply" notice for it is misleading, because a restart does not apply it either. | inert |
| `poll_seconds` | int | `5` | How often the fleet status is refreshed: the server's ping and service-probe cache lifetime, and the app's refresh interval. `monitor.poll_seconds` must be at least this value, or the save is refused. | live |
| `feature_cycle_seconds` | int | `6` | How long vapor's featured host (the hero) shows one online host before moving to the next. Other themes don't auto-cycle. | live |
| `debug` | bool | `false` | Raises the app log to DEBUG, which shows the per-tick presence trail (useful when a phone's LAN address drifts). It enables no debugger and no error pages. | restart |
| `trusted_hosts` | list of strings | `[]` | `Host` header allowlist, a defence against DNS rebinding. Empty means no check. Once it has entries, every other name gets `400 Invalid host header` on every route, Conf included, and the only way back is a hand edit. So list every name and address you browse by (the `ts.net` name, the bare hostname, `localhost`, `127.0.0.1`, the LAN and `100.x` addresses). Entries are exact names or one leading `*.` wildcard, with no port; a bare `*` is refused. No Conf form. **Security gate.** | restart (not flagged) |

## appearance

The theme picker state. It is shared across your devices: the last write wins, and the server stamps the time. You set it from the Appearance settings in Conf and rarely edit it by hand. A `null` means "not chosen yet", and the device keeps its own local value until the first save.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `theme` | string | `cosmos` | The active theme. | live |
| `mode` | string | `dark` | Light or dark. | live |
| `accent` | string | `violet` | The accent palette. | live |
| `motion` | string or null | `null` | Ambient animation: `full` or `reduced`. | live |
| `perf` | string or null | `null` | Frosted-bar blur: `full` or `lite`. | live |
| `theme_settings` | map or null | `null` | Per-theme options, `{theme: {option: value}}`. Each theme defines its own options. | live |
| `kit_background_visible` | bool or null | `null` | Whether a theme that supports it paints the shared background image. | live |
| `appbar_subtitle_visible` | bool or null | `null` | Whether the app bar shows the theme's subtitle line. The app's default is off. | live |
| `chat_avatars_visible` | bool or null | `null` | Whether a reply's header shows the agent's avatar instead of a dot. The app's default is on. | live |
| `agent_backdrop` | string or null | `null` | Where the agent's art appears: `operator`, `full` (the whole chat backdrop) or `off`. Unknown values fall back to `operator`. | live |
| `pwa_icon_background` | string or null | `null` | The home-screen icon's backdrop: `transparent`, `ink`, `night`, `orchid` or `paper`. Anything else is refused. When an installed icon picks up the change depends on the platform. | next app load |
| `updated_at` | timestamp | `null` | Set by the server on each appearance save. Don't edit it. | live |

## providers

A map of connections to OpenAI-compatible servers, keyed by a name you choose. Chat (`inference`), voice (`voice.stt`, `voice.tts`, `voice.live`) and `embeddings` all point at an entry by that name. The name is also the composer's `/<name>` command, which switches the chat backend for one message. A name must match `^[a-z0-9][a-z0-9_+.-]{0,31}$`. Neither a provider nor a model may be called `api_key`, `ssh_password`, `password`, `token`, `env` or `headers`.

Conf saves the whole providers map at once. If another device changed it since you opened Conf, the save is refused, so refresh and apply again. Renaming a provider in Conf updates every reference to it.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `<name>.base_url` | string | `""` | The server's API root, e.g. `http://192.168.1.137:5001/v1`. | live |
| `<name>.api_key` | string or null | `null` | API key. Omit it for a server without authentication. A secret: masked in Conf, and kept when saved blank. | live |
| `<name>.api_mode` | `openai` · `llamacpp` · `openrouter` · `none` | `openai` | The wire dialect this server speaks. It decides how an agent's reasoning setting is translated (llama.cpp gets a token budget, OpenAI and OpenRouter get an effort level) and which output-cap field is sent. It is never guessed from the URL. | live |
| `<name>.max_concurrent_requests` | int ≥ 1 or null | `null` | How many requests the app sends this server at once. `null` means no limit. Set `1` for a server that can only handle one request at a time. | live |
| `<name>.retry_attempts` | int ≥ 0 or null | `null` | Overrides `inference.retry_attempts` for this server. `0` disables retries. | live |
| `<name>.max_tokens_field` | `max_tokens` · `max_completion_tokens` or null | `null` | Which field name carries the output cap. `null` derives it from `api_mode`. | live |
| `<name>.models.<model>.id` | string or null | `null` | The model id sent to the server. `null` means the catalog key itself. The key is the display name. | live |
| `<name>.models.<model>.context_window` | int ≥ 1 or null | `null` | The model's context window in tokens; it drives when compaction starts. It wins over the window llama.cpp reports. Cloud models have no automatic window, so set this for them. | live |
| `<name>.models.<model>.extra_body` | map | `{}` | Extra request fields sent only with this model's calls, e.g. `{cache_prompt: true, return_progress: true}` for llama.cpp. | live |
| `<name>.models.<model>.max_tokens_field` | as above | `null` | Per-model override of the provider's `max_tokens_field`. | live |
| `<name>.models.<model>.input_modalities` | list of strings or null | `null` | What the model accepts, e.g. `[text, image]`. **Omitted means text only:** images you attach are replaced by an error note before they reach this model. Set it for a vision model. No Conf form. | next chat turn |
| `<name>.models.<model>.dim` | int ≥ 1 or null | `null` | Embeddings vector size. | live |
| `<name>.models.<model>.voice` | string or null | `null` | Text-to-speech voice id (model-specific). | live |
| `<name>.models.<model>.speed` | number > 0 or null | `null` | Text-to-speech speed sent with each request. | live |
| `<name>.models.<model>.language` | string or null | `null` | Speech-to-text language for this model. | live |
| `<name>.models.<model>.format` | string or null | `null` | Text-to-speech audio format for this model. | live |

## inference

Where chat goes. It points at `providers`.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `provider` | string or null | `null` | The primary provider. `null` means chat is not configured and every chat send is refused. | next chat turn |
| `model` | string or null | `null` | The primary's model. You can omit it when that provider has exactly one model. | next chat turn |
| `fallbacks` | list of `{provider, model?}` | `[]` | Ordered fallback chain, tried in turn when the one before fails. | next chat turn |
| `request_timeout_s` | number | `600` | How long to wait for a reply once connected. Thinking models are slow, so keep it generous. | next chat turn |
| `connect_timeout_s` | number > 0 | `5` | How long to try to reach a server before moving to the next one in the chain. | next chat turn |
| `connect_cooldown_s` | number ≥ 0 | `60` | After a server is found unreachable, it is tried last for this many seconds. It is never skipped, and its first successful answer clears the cooldown early. `0` turns this off. | next chat turn |
| `system_prompt` | string | `""` | Replaces the built-in persona prompt for any agent without a `SOUL.md` of its own. Blank means the built-in prompt. An agent's `SOUL.md` (for the root agent (`default`), the one in your data folder) wins over this. | next chat turn |
| `system_prompt_append` | string | `""` | Text added after whichever base prompt is active, for every agent. An agent's own append comes after it. | next chat turn |
| `failover` | bool | `true` | On: walk the chain until one server answers. Off: use only the primary. | next chat turn |
| `retry_attempts` | int ≥ 0 | `2` | How many times a busy or rate-limited server is retried before moving on (429, 503, a busy llama.cpp slot). `0` moves on at once. | next chat turn |

## agent

Settings for the agent runtime. Agents themselves are **folders**, not config entries: `$CTRLB_HOME/agents/<name>/agent.yaml` plus `SOUL.md`, managed in Conf. The root agent (`default`) is the data folder itself (its `SOUL.md`, with no `agent.yaml`). See [Agents](agents.md).

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `default_agent` | string | `""` | The agent new conversations start with. `""` means none is set, so a new conversation gets the root agent (`default`). `"default"` picks the root agent explicitly. `"<name>"` picks that `agents/` folder. An unknown name falls back to the root agent. | live |
| `default_title` | string | `""` | Display name for the root agent (`default`). | live |
| `defaults` | map | `{}` | Values every agent inherits (agent fields such as model, privilege, tools, routing). An agent's own `agent.yaml` overrides them field by field. A specialist never inherits `title`, the greeting or the greeting switch. See [Agents](agents.md). | next chat turn |
| `global_subagent_limit` | int | `6` | Maximum subagents running at once, across everything. | restart (not flagged) |
| `subagent_clamp_privilege` | bool | `true` | While `true`, a subagent never runs at a higher privilege than the agent that started it; `false` lets it keep its own. **Security gate.** | live |
| `skills_dir` | string | `skills` | Folder scanned for `<name>/SKILL.md`. A relative path resolves against `$CTRLB_HOME`, never against a `CTRLB_CONFIG` location. Until you restart, the skills list still reads the old folder while new skills are written to the new one. No Conf form. | restart (not flagged) |
| `skills_enabled` | bool | `true` | Master switch for skills. | next chat turn |
| `skills_auto_write` | bool | `true` | The agent may write skills itself. Off: it only proposes them. No Conf form. | live |
| `subagent_child_timeout_s` | number > 0 | `180` | Wall-clock limit for each subagent. | live |
| `skill_min_overlap` | int ≥ 1 | `1` | Minimum word overlap between your message and a skill for the skill to activate. No Conf form. | restart (not flagged) |
| `skill_max_active` | int ≥ 1 | `2` | Maximum skills active in one turn. No Conf form. | restart (not flagged) |
| `streaming` | `auto` · `on` · `off` | `auto` | How replies are delivered. `on` always streams, `off` always sends the whole reply at once (useful on a flaky link), and `auto` follows the app (which streams). A bare `on`/`off` in YAML is read correctly. | next chat turn |

### agent.compaction

When a conversation outgrows the model's context window, old tool outputs are cleared first, then the oldest complete turns are folded into a summary. The full history stays in the database. An agent can override this block for itself.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `enabled` | bool | `true` | Automatic compaction on or off. `/compact` still works. | next chat turn |
| `threshold_frac` | 0.5–0.95 | `0.85` | Compact when the context passes this fraction of the model's window. | next chat turn |
| `threshold_tokens` | int | `6000` | The trigger used only when no window is known (no `context_window`, no llama.cpp report). | next chat turn |
| `keep_last_messages` | int | `8` | Recent messages always kept as they are (rounded to a turn boundary). | next chat turn |
| `keep_recent_tokens` | int ≥ 0 | `4096` | Recent tokens always kept. `0` keeps only the message floor above. | next chat turn |
| `clear_output_min_tokens` | int ≥ 0 | `500` | Tool outputs smaller than this are never cleared. | next chat turn |
| `clear_keep_steps` | int ≥ 1 | `2` | The most recent steps of an earlier turn keep their full tool outputs. The current turn's outputs are never cleared. | next chat turn |
| `clear_trigger_pct` | > 0, ≤ 1 | `0.5` | Clearing tool outputs starts only above this fraction of the smallest window in the chain. | next chat turn |
| `clear_min_reclaim_tokens` | int ≥ 0 | `1024` | Skip a clearing that would save fewer tokens than this. | next chat turn |
| `clear_exclude_tools` | list of strings | `[task_plan, memory, core_memory]` | Tools whose outputs are never cleared. | next chat turn |
| `max_consecutive_failures` | int | `3` | After this many compactions in a row that fail to shrink the context, automatic compaction stops for that run. | next chat turn |
| `reserve_output` | bool | `true` | Subtract the agent's output cap (`model.max_tokens`) from the trigger line. | next chat turn |
| `summarizer.provider` | string or null | `null` | The provider that writes the summary. Blank uses the chat primary. | next chat turn |
| `summarizer.model` | string or null | `null` | Its model. Blank uses the provider's only model. | next chat turn |
| `summarizer.max_tokens` | int ≥ 1 or null | `null` | Output cap for the summary call. | next chat turn |
| `summarizer.reasoning_effort` | `off` · `minimal` · `low` · `medium` · `high` · `xhigh` · `max` or null | `null` | Reasoning level for the summary call. | next chat turn |
| `summarizer.reasoning_tokens` | int ≥ 1 or null | `null` | Explicit reasoning budget; ignored when `reasoning_effort` is `off`. | next chat turn |

### agent.turns

Limits for running turns. There is no Conf form for these.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `max_active_turns` | int ≥ 1 | `4` | Turns that may run at once across all conversations. Past it, a send gets a "busy" answer and an automation run is not started. | live |
| `steer_queue_max` | int ≥ 1 | `8` | Messages you can queue into a running turn. Past it, a send gets "busy". | live |
| `ring_size` | int ≥ 1 | `2048` | Events kept per turn so a briefly disconnected device can catch up. A smaller ring only makes reconnects slower; nothing is lost. | next chat turn |
| `subscriber_queue_size` | int ≥ 1 | `256` | Per-device event queue. A device that falls this far behind is disconnected and catches up on reconnect. | next chat turn |
| `terminal_cache_cap` | int ≥ 1 | `32` | Finished turns remembered for a late reconnect. | next chat turn |
| `linger_s` | number > 0 | `60` | How long a finished turn is remembered. | next chat turn |
| `ping_s` | int ≥ 1 | `15` | Keepalive interval on the chat stream, in whole seconds. | next chat turn |
| `send_timeout_s` | number > 0 | `30` | A device that stops reading for this long is dropped; the turn keeps running. | next chat turn |
| `shutdown_grace_s` | number > 0 | `5` | How long running turns get to stop when the server shuts down. | live |

## memory

The agent's built-in file memory: a `MEMORY.md` per agent and a shared `USER.md` profile, injected into every turn. All of it lives under `memory_dir`, which is a git repository the app commits to.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `enabled` | bool | `true` | Master switch for memory, including the long-term slot below. | live |
| `user_profile_enabled` | bool | `true` | Include, and allow writes to, the shared `USER.md`. | live |
| `auto_write` | bool | `true` | The agent may write memory itself. Off: it proposes, and you approve. | live |
| `consolidation_nudge` | bool | `false` | When a memory file is nearly full, the prompt asks the agent to merge and prune before adding. | next chat turn |
| `consolidation_nudge_pct` | 1–100 | `80` | The fill level that triggers the nudge. | next chat turn |
| `memory_dir` | string | `memories` | The memory folder. Relative paths resolve against `$CTRLB_HOME`. | live |
| `memory_char_limit` | int ≥ 1 | `2200` | Size cap of each agent's `MEMORY.md`, in characters. | live |
| `user_char_limit` | int ≥ 1 | `1375` | Size cap of `USER.md`, in characters. | live |
| `state_enabled` | bool | `false` | A per-agent `STATE.md` (mood, energy, lately) that the agent rewrites and that rides beside its persona. | live |
| `state_char_limit` | int ≥ 1 | `600` | Size cap of `STATE.md`. | live |
| `reflection_enabled` | bool | `false` | Every few turns, ask the agent to save anything worth remembering. | next chat turn |
| `reflection_interval` | int ≥ 1 | `10` | Your messages between reflection prompts. | next chat turn |

### memory.git_backup

Every memory write is committed to the git repository in `memory_dir`. A periodic sweep also commits edits you make to those files by hand. No Conf form.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `enabled` | bool | `true` | Commit memory changes. A git failure never blocks a memory write. | live |
| `author_name` | string | `ctrl-b memory` | Commit author name (set per commit, your global git config is untouched). | live |
| `author_email` | string | `memory@ctrl-b.local` | Commit author email. | live |
| `commit_timeout_s` | number > 0 | `10` | Time limit for each git command. | live |
| `reconcile_interval_s` | int ≥ 0 | `120` | How often the sweep commits hand edits. `0` turns the sweep off. | live |

### memory.longterm

An optional long-term memory, off by default. `core` is Core Memory: a shared folder of markdown topic files with a `MEMORY.md` index. The index rides in every turn and the agent reads topics when it needs them. It lives under `memory_dir`, so the git backup covers it.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `backend` | `core` or null | `null` | The only switch: `null` is off, `core` turns Core Memory on. | live |
| `core.root` | string | `core` | Its folder. Relative paths resolve under `memory_dir`. An absolute path works but is not versioned. | live |
| `core.index_char_limit` | int ≥ 1 | `10240` | Cap on the index included in each turn, in characters. | live |
| `core.topic_char_limit` | int ≥ 1 | `4096` | Cap on one topic read. | live |
| `core.recall_char_limit` | int ≥ 1 | `24576` | Total characters the agent may read from it in one turn. | live |
| `core.recall_min_charge_chars` | int ≥ 1 | `256` | The minimum one read or search counts against that total, so empty results still use budget. | live |
| `core.consolidation_nudge_pct` | 1–100 | `80` | Index fill level at which the chat suggests `/consolidate`. | live |

## searxng

A SearXNG instance for the agent's `web_search` tool. The instance must have the JSON format enabled in its own settings.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `base_url` | string | `""` | Instance root, without `/search`. Empty means `web_search` reports it isn't configured. | live |
| `enabled` | bool | `true` | Off: `web_search` reports it isn't configured. | live |
| `timeout_s` | number | `10` | Time limit for one search. | live |
| `language` | string or null | `null` | Default search language passed to SearXNG, e.g. `en`. | live |

## embeddings

An embeddings client, configured but **not used by any feature today** ([ISS-96](../ISSUES.md)). Conversation search and Core Memory search are plain text search.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `provider` | string or null | `null` | Primary provider. `null` means off. | inert |
| `model` | string or null | `null` | Its model; omit when the provider has one model. | inert |
| `fallbacks` | list of `{provider, model?}` | `[]` | Fallback chain. Every `dim` set along the chain must agree, or the save is refused. | inert |
| `enabled` | bool | `true` | Off: the client reports not configured. | inert |
| `timeout_s` | number > 0 | `60` | Time limit for one call. | inert |

## voice

Speech-to-text (`stt`), text-to-speech (`tts`) and call mode (`live`). Each service points at `providers` like chat does. A voice chain always moves to the next server on any failure; there is no failover switch. The microphone needs HTTPS, which Tailscale Serve provides; see [Voice and calls](voice-and-calls.md).

Saving a voice setting rebuilds the voice services at once. A call or dictation reads its settings when it starts, so a change made mid-call applies to the next one.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `enabled` | bool | `true` | Master switch. Off hides the mic, read-aloud and calls, whatever the services below say. | live |

### voice.stt

The clip path: you hold the mic, the recording is uploaded, and the transcript lands in the composer.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `provider` | string or null | `null` | Primary speech-to-text provider. `null` hides the mic. | live |
| `model` | string or null | `null` | Its model; omit when the provider has one model. | live |
| `fallbacks` | list of `{provider, model?}` | `[]` | Fallback chain. | live |
| `connect_timeout_s` | number > 0 | `3` | How long to try to reach a server before moving on. | live |
| `timeout_s` | number > 0 | `30` | Time limit for one transcription once connected. | live |
| `extra_body` | map | `{}` | Extra fields passed to the server as they are. Rarely needed. | live |
| `language` | string | `en` | Transcription language; `""` means detect. A model's own `language` wins. Also sent to the live ear for calls and streaming dictation. Whether it is honoured depends on the server: the parakeet server ignores it. Clip uploads use a change at once; the live ear reads it at the next call. | live |
| `vad_filter` | bool | `true` | Ask the server to skip silence. Only Whisper-type servers that support it use it; the current Parakeet and Speaches targets ignore it. | live |
| `hotwords` | string | `""` | Space-separated words to bias recognition toward (host names, jargon). Only Whisper-type servers use it. | live |
| `max_upload_bytes` | int > 0 | `26214400` (25 MB) | Largest clip accepted; a bigger one is refused with 413. | live |
| `auto_send` | bool | `false` | Send the transcript at once instead of leaving it in the composer for review. | live |
| `auto_stop` | bool | `false` | Stop recording by itself after a silence. Off means you stop it. | live |
| `auto_stop_silence_s` | 0.5–30 | `3.0` | The silence length that stops a recording. | live |
| `auto_stop_threshold` | 0.001–0.5 | `0.01` | The loudness below which audio counts as silence. Calibrate it on your phone. | live |
| `upload_timeout_s` | > 0, ≤ 600 | `30` | Minimum time one upload attempt may take. An attempt may take up to twice the clip's length when that is longer. | live |
| `upload_attempts` | 1–10 | `3` | Upload attempts before the clip is parked with Retry and Discard buttons. A clip is never silently dropped. | live |

### voice.tts

Read-aloud.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `provider` | string or null | `null` | Primary text-to-speech provider. `null` hides read-aloud. | live |
| `model` | string or null | `null` | Its model; omit when the provider has one model. | live |
| `fallbacks` | list of `{provider, model?}` | `[]` | Fallback chain. | live |
| `connect_timeout_s` | number > 0 | `3` | How long to try to reach a server before moving on. | live |
| `timeout_s` | number > 0 | `30` | Time limit for one synthesis once connected. | live |
| `extra_body` | map | `{}` | Extra fields passed to the server as they are. | live |
| `format` | string | `mp3` | Audio format for a whole-message clip (`mp3`, `opus`, `aac`, `flac`, `wav`, `pcm`). A model's own `format` wins. | live |
| `max_text_chars` | int > 0 | `4096` | Longest text one request may carry; longer is refused. `chunk_max_chars` must not exceed it. | live |
| `chunking` | `off` · `paragraph` · `sentence` | `sentence` | Split the reply into pieces that play one after another, so audio starts after the first piece. `off` synthesizes the whole message as one clip. | live |
| `chunk_format` | string | `opus` | Audio format for each piece. | live |
| `chunk_min_words` | int ≥ 1 | `4` | A piece under this many words, or under `chunk_min_chars`, keeps growing. | live |
| `chunk_min_chars` | int ≥ 1 | `50` | The same floor in characters; must not exceed `chunk_max_chars`. | live |
| `chunk_max_chars` | int > 0 | `400` | A piece is split at the last word break under this length. | live |
| `chunk_lookahead` | 1–4 | `1` | Pieces synthesized ahead of the one playing. | live |
| `chunk_read_along` | bool | `true` | Start speaking while the reply is still streaming, a sentence at a time. Has no effect when `chunking` is `off`. | live |
| `speak_actions` | bool | `false` | Read roleplay actions (`*he leans in*`) aloud. Off drops them; bold text is still read. | live |
| `trim_silence` | bool | `true` | Cut the silent padding some servers put at the start and end of each clip, so speech starts sooner. WAV audio only; the server does this, not the app. | live |
| `background_keepalive` | bool | `true` | While a reply (or a clip upload) is pending with the screen off or the app in the background, play an inaudible tone so the phone doesn't freeze the page, and the reply speaks in your pocket. Uses battery. Off: the reply plays when you come back. Calls use `voice.live.background_keepalive` instead. | live |
| `background_idle_s` | 0–3600 | `600` | That hold lets go after this many seconds with no progress. `0` means no limit. | live |

### voice.live

Call mode and streaming dictation. The listening side (the "ear") is a realtime speech endpoint: the app opens a WebSocket to `<base_url>/realtime` on the first entry of the chain (Speaches today), and there is no failover once a call is up. A blank `provider` uses the `voice.stt` chain, which only works when that server also speaks the realtime protocol. **If `voice.stt` points at a Parakeet server, a blank `voice.live.provider` breaks calls,** so set it to a Speaches provider.

Keys marked *client* are read by the app on your phone. Keys marked *server* are the server's own limits.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `enabled` | bool | `true` | Call mode on or off. `voice.enabled` outranks it. | next call |
| `provider` | string or null | `null` | The realtime provider. Blank uses `voice.stt`'s chain (see above). | next call |
| `model` | string or null | `null` | The realtime model. Blank inherits `voice.stt`'s. | next call |
| `fallbacks` | list of `{provider, model?}` | `[]` | Accepted for the shared shape, but a live session never moves to a fallback. | next call |
| `connect_timeout_s` | number > 0 | `3` | Time limit for opening the realtime connection. | next call |
| `timeout_s` | number > 0 | `30` | Time limit for the realtime session to be ready once connected. | next call |
| `extra_body` | map | `{}` | **Inert.** Accepted for the shared shape, but the live relay never sends it. | inert |
| `vad_threshold` | 0.5–0.8 | `0.6` | *Server.* How sure the speech detector must be that you are speaking. Sent to the speech server. | next call |
| `silence_ms` | 500–1200 | `700` | *Server.* The silence that ends one spoken phrase. | next call |
| `prefix_padding_ms` | 0–1000 | `300` | *Server.* Audio kept from just before each phrase, so its first sound isn't cut. | next call |
| `turn_hold_ms` | 0–10000 | `2500` | *Client.* The thinking pause: after you stop, wait this long before sending what you said. Speaking again inside the pause joins the same message. Every reply starts this much later. `0` sends at once. | next call |
| `min_speech_ms` | 0–5000 | `300` | *Client.* Speech shorter than this never counts as an interruption. | next call |
| `buffered_ceiling_ms` | 100–10000 | `1000` | *Client.* Audio the phone may have queued in the socket before it reconnects. | next call |
| `call_backlog_ms` | 200–20000 | `1000` | *Client.* Audio a call may queue after a network stall before the oldest is dropped. With `buffered_ceiling_ms` it must fit the 30-second uplink allowance, or the save is refused. | next call |
| `barge_in` | bool | `false` | *Client.* Interrupt the reply by speaking. Off: tap to interrupt. Needs an open mic, so it does nothing while the mic is held (`mic_hold`). | next call |
| `min_final_ms` | 0–5000 | `200` | *Client.* How much of a phrase must be loud enough before it becomes a message. Keeps a TV or the next room out of the conversation; a dropped phrase plays a short cue. `0` turns the gate off. | next call |
| `noise_verdict_ms` | 0–5000 | `1000` | *Client.* A reply that is ready while a sound is still going waits for it. After this long, a sound without `min_final_ms` of loud audio is judged noise and the reply plays over it. Real speech is never timed out. `0`: the reply always waits. | next call |
| `debug` | bool | `false` | *Client and server.* Shows the live gate numbers on the call screen, and turns on the call trail: a log of every call, dictation, clip and reply under `$CTRLB_HOME/calls/`, **with a recording of what the mic heard** (16 kHz, about 1.9 MB a minute, anyone audible included). Call and dictation trails include what was said; a clip upload's trail holds only counts and timings. For clip uploads it is read per upload. Files are written with mode 0600. | next call |
| `trail_keep` | 1–500 | `20` | *Server.* Trails kept per kind; the oldest go, with their recordings, when a new one starts. Applied only when the next trail starts, so with `debug` off the kept trails stay until you delete them. | next call |
| `ring` | bool | `true` | *Client.* Call screen: a face ring over the art (on) or the art alone (off). | next call |
| `captions` | bool | `true` | *Client.* Show the reply as fading captions on the call screen. | next call |
| `mic_hold` | `auto` · `on` · `off` | `auto` | *Client.* Is the mic off while the reply speaks (and through its tail)? `on`: always. `off`: never (the reply may then be transcribed). `auto`: held unless the mic's echo cancellation reports full coverage. | next call |
| `floor_dbfs` | −90–0 | `-45` | *Client.* The loudness floor before the room has been measured, and its cap meanwhile. | next call |
| `noise_margin_db` | 0–40 | `10` | *Client.* The floor sits at least this far above the measured room noise. | next call |
| `voice_margin_db` | 0–40 | `10` | *Client.* The floor sits at most this far below your learned voice level. | next call |
| `playback_margin_db` | 0–40 | `10` | *Client.* Added to the floor for interruptions while the reply plays. | next call |
| `min_dbfs` | −90–0 | `-60` | *Client.* Lowest the floor may go. Must be below `max_dbfs`. | next call |
| `max_dbfs` | −90–0 | `-20` | *Client.* Highest the floor may go. | next call |
| `hold_tail_min_ms` | 0–5000 | `300` | *Client.* After the reply ends, keep the mic held at least this long (speakers and headphones lag). | next call |
| `tail_quiet_ms` | 100–5000 | `700` | *Client.* Then release once the room has been quiet this long. `hold_tail_min_ms` + this must fit under `hold_tail_max_ms`. | next call |
| `tail_quiet_margin_db` | 0–40 | `10` | *Client.* "Quiet" means below the room noise plus this. | next call |
| `hold_tail_max_ms` | 500–15000 | `5000` | *Client.* Release no later than this after the reply ends. | next call |
| `tail_lag_margin_ms` | 0–2000 | `300` | *Client.* When the connect chirp measured your speaker's delay, release at that delay plus this, instead of waiting for quiet. | next call |
| `echo_similarity` | 0.5–1.0 | `0.75` | *Client.* A phrase heard right after a reply that matches the reply's words this closely is the reply itself, picked up by the mic, and is dropped visibly. | next call |
| `echo_window_ms` | 0–15000 | `4000` | *Client.* How long after the release phrases are still compared. `0`: only while the mic is held. | next call |
| `chirp` | bool | `true` | *Client.* A short sweep plays when a call connects; the mic's copy of it measures how late your speaker plays. Off: no sound, no measurement. | next call |
| `route` | `media` · `call` | `media` | *Client.* How the mic is opened, which decides how the reply plays. `media`: echo cancellation off, audio follows the phone's media routing (Bluetooth when connected). `call`: phone-call mode with echo cancellation and the hands-free device's own mic. Applies to every recording, dictation included. The in-call controls change it for one call only. | next call |
| `input_device` | string | `""` | *Client.* The microphone to use; `""` is the system default. On Android the mic list is also the audio route picker. A mic that has gone away falls back to the default. | next call |
| `background` | bool | `true` | *Client.* Keep the call when the screen goes off or you switch apps. Off: hiding the page ends the call. Closing the page always ends it. | next call |
| `background_keepalive` | bool | `true` | *Client.* While a call runs in the background, play an inaudible tone so the phone doesn't freeze the page and leave the call deaf. Uses battery. | next call |
| `background_idle_s` | 0–7200 | `600` | *Client.* A background call with no speech and no reply for this long ends itself. `0` turns this off. | next call |
| `dictation` | bool | `false` | *Client.* Streaming dictation: the mic sends each phrase to the composer as you speak, over the same ear as calls. Independent of `enabled`. Off: the mic uses the clip path (`voice.stt`). Takes effect on the next recording after a Conf save. | next call |
| `tail_wait_ms` | 500–10000 | `2000` | *Client.* After you release, how long to wait for the last phrase. Takes effect on the next recording after a Conf save. | next call |
| `dictation_idle_s` | 0–1800 | `300` | *Client.* A locked (hands-free) dictation stops after this much silence; the last phrase is kept. `0` turns this off. It cannot fire in roughly the first 6 seconds. Takes effect on the next recording after a Conf save. | next call |
| `dictation_idle_margin_db` | 0–40 | `10` | *Client.* "Silence" for that stop means below the room noise plus this. Takes effect on the next recording after a Conf save. | next call |
| `dictation_max_s` | 10–1800 | `1790` | *Client.* Longest single dictation, held or locked. Must stay below `max_session_s`. Takes effect on the next recording after a Conf save. | next call |
| `release_tail_ms` | 0–1500 | `400` | *Client.* After you stop, keep recording this long so the last word isn't clipped. Applies to clip recordings too. `0` turns this off. It is read when you stop, so a Conf save reaches even a recording already running. | live |
| `frame_ms` | 10–200 | `40` | *Server.* Length of each audio frame the phone sends. | next call |
| `max_session_s` | 10–7200 | `1800` | *Server.* Longest one live session may last. | next call |
| `max_frame_bytes` | int > 0 | `32768` | *Server.* Largest audio frame accepted. | next call |
| `max_sessions` | 1–8 | `1` | *Server.* Live sessions at once. A second one gets "busy". | next call |
| `relay_queue_ms` | 200–20000 | `2000` | *Server.* Audio queued toward the speech server; the oldest is dropped past it. | next call |
| `start_timeout_s` | > 0, ≤ 60 | `5` | *Server.* How long a new connection may wait before it starts. | next call |
| `uplink_idle_s` | 5–120 | `15` | *Server.* A session that sends no audio for this long is ended. Must be longer than `tail_wait_ms`. | next call |
| `allowed_origins` | list of strings | `[]` | *Server.* Extra exact origins (`scheme://host[:port]`) allowed to open the live WebSocket, besides the app's own. Browsers don't protect WebSockets with CORS, so this check is the only one. **Security gate.** | next call |
| `vad_model` | `silero-v6.2` · `silero-v5.1.2` | `silero-v6.2` | *Server.* The speech-detection model the server runs on each uploaded clip before transcription (read per upload). No Conf row: a save through the settings API applies on the next upload, a hand edit needs a restart (as for every key). Changing it means recalibrating `vad_threshold`. | live |

## open_terminal

An [open-terminal](https://github.com/open-webui/open-terminal) server gives the agent a shell and file tools on the machine it runs on: `terminal_exec`, read, write, list, grep and glob.

The tools and their risk levels are registered **once, at startup**. A Conf change to a risk level does not change what asks for confirmation until you restart ([ISS-92](../ISSUES.md)). Turning `enabled` off works at once (the tools then refuse), and turning it back on works at once too. If it was off at startup, or `base_url` was empty then, the tools do not exist until a restart.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `base_url` | string | `""` | Server root, no trailing slash. Empty at startup means no terminal tools until a restart; changing a URL that was already set applies at once. | live |
| `api_key` | string | `""` | Bearer token. A secret. | live |
| `enabled` | bool | `true` | Off at startup: no terminal tools until a restart. If it was on at startup, turning it off works at once (the tools refuse) and turning it back on works at once too. Conf shows no notice for the restart ([ISS-92](../ISSUES.md)). | live |
| `timeout_s` | number | `30` | Time limit for one request. | live |
| `default_wait_s` | number | `30` | How long `terminal_exec` waits for the command to finish before returning. | live |
| `exec_risk` | `low` · `med` · `high` | `high` | Risk level of `terminal_exec`. At high: denied at read privilege, asks at confirm and auto-low unless an always-allow rule matches, runs unasked at full. Low runs everywhere without asking. **Security gate.** | restart (not flagged) |
| `write_risk` | `low` · `med` · `high` | `high` | Risk level of file writes. The same ladder as `exec_risk`. **Security gate.** | restart (not flagged) |
| `read_risk` | `low` · `med` · `high` | `low` | Risk level of reads, lists and searches. Low runs without asking; raised, they ask like any other tool, and an "always allow" rule can cover them, even at read privilege (they are not fleet actions). **Security gate.** | restart (not flagged) |

## shell

A local shell on the machine that runs ctrl-b, with two independent doors: you typing `!<command>` in the composer, and the agent's `run_shell` tool. Both are **off by default**.

**At full privilege the agent can run `run_shell` without a confirmation whether `agent_exec_enabled` is on or off.** At read privilege `run_shell` is always refused. At confirm and auto-low, the toggle decides: off refuses `run_shell`, on asks you to confirm each call. The only switch that stops an agent at full privilege is `enabled: false` ([ISS-87](../ISSUES.md)).

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `enabled` | bool | `true` | Master switch. Off: every `run_shell` and `!` command is refused. **Security gate.** | live |
| `user_exec_enabled` | bool | `false` | Allow `!<command>` from the composer. **Security gate.** | live |
| `agent_exec_enabled` | bool | `false` | Allow the agent's `run_shell` below full privilege, with a confirmation each call (see above). **Security gate.** | live |
| `workdir` | string | `""` | Working folder for commands. Blank means `$CTRLB_HOME`. | live |
| `timeout_s` | number | `60` | A command is stopped after this many seconds, and reports an error with no output. Only the shell itself is killed; a process it started keeps running ([ISS-89](../ISSUES.md)). | live |
| `max_output_chars` | int | `6000` | Output longer than this is cut, keeping the beginning. | live |

## tailscale

The HTTPS switch: it runs `tailscale serve` on this machine, never `funnel`, so HTTPS stays inside your tailnet. The card is at the bottom of Conf → Server. Whether Serve is on is read from Tailscale itself; it is not stored here.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `enabled` | bool | `true` | Off hides the HTTPS card and refuses its on/off requests. Serve itself is left as it is. | live |
| `target_port` | int | `5433` | The local port Serve forwards to. `5433` is the server install's app. | live |
| `timeout_s` | number | `15` | Time limit for each `tailscale` command. | live |

## notifications

Browser notifications raised by the app itself from the live streams it already has open. They fire **only while the app's page is hidden**: another tab, another app, or the screen off with the app still running. They never fire while you are looking at the app, and they never reach a closed app. A finished reply does not notify during a live call. They also need the browser's permission and HTTPS.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `enabled` | bool | `false` | Master switch; while off nothing fires. | live |

### notifications.events

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `agent_input` | bool | `true` | The agent is waiting for you (a confirmation or a question). | live |
| `turn_done` | bool | `true` | An agent turn finished, hit its limit or failed. | live |
| `action_failed` | bool | `true` | A recorded action ended in error, denial or timeout. | live |
| `automation_done` | bool | `true` | An automation run finished, however it ended. | live |
| `host_up_down` | bool | `true` | The monitor confirmed a host went down or came back. | live |

## wake

Automatic Wake-on-LAN. Two triggers, both switched on per host (see [computers](#computers)):

- **On connect** (`wake_on_connect`): every time the app's live feed connects (opening the app, and each reconnect) that host is woken, at most once per `cooldown_s`.
- **On presence** (`wake_on_presence`): one of your devices arriving wakes it. Arrival is seen on two sources: the device turning Tailscale on, or the device rejoining the home Wi-Fi. A device must have been away continuously for its damping time first, so a radio blip can't wake anything. Presence needs `monitor.enabled`.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `cooldown_s` | int ≥ 0 | `300` | Seconds between on-connect wakes of one host. `0`: every connect may wake. | live |
| `presence_offline_after_s` | int ≥ 0 | `120` | How long a device must be off the tailnet before coming back counts as an arrival. | live |
| `presence_cooldown_s` | int ≥ 0 | `3600` | Seconds between presence wakes of one host, across all devices and both sources. A host's `wake_presence_cooldown_s` overrides it. | live |
| `tailscale_socket_path` | string | `/var/run/tailscale/tailscaled.sock` | Where the Tailscale daemon's local socket is. Change it on systems that put it elsewhere. | live |
| `lan_probe_count` | int ≥ 1 | `3` | Pings per Wi-Fi presence check. | live |
| `lan_probe_timeout_s` | int ≥ 1 | `1` | Seconds per ping. | live |
| `lan_health_ip` | IP address or null | `null` | An always-on address on the same LAN, normally your router, checked alongside your devices. While it doesn't answer, no Wi-Fi absence is counted, so an unplugged server can't wake the whole fleet when it reconnects. It may not be one of your devices. Unset means no check; setting it is recommended. | live |

### wake.presence_devices

A list of your devices. Names and addresses must be unique.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `name` | string | required | The device's name in the log. Renaming it starts its history over. | live |
| `tailnet_ip` | IP address or null | `null` | Its Tailscale address (`100.x.y.z`). A number, never a name. | live |
| `lan_ip` | IP address or null | `null` | Its home Wi-Fi address. Give it a DHCP reservation on your router: an address that changes looks like the device leaving. At least one of the two addresses is required. | live |
| `lan_offline_after_s` | int ≥ 0 | `900` | How long the device must be absent from the Wi-Fi before its return counts as an arrival. Per device, because phones sleep their Wi-Fi differently. | live |

### wake.quiet_hours

Optional. A local-time window during which a Wi-Fi arrival wakes nothing. A Tailscale arrival is never silenced. The time zone is the server's.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `start` | `"HH:MM"` string | required | Start of the window. Quote it: an unquoted `23:00` is a number to YAML and is refused. | live |
| `end` | `"HH:MM"` string | required | End of the window; it may wrap past midnight. Equal to `start` is refused. | live |

## monitor

The server's own fleet watcher. Every `poll_seconds` it reads the shared fleet status and records a `host_down` or `host_up` event once a host has failed or answered enough checks in a row. A check that could not be made counts for neither. It also drives presence wakes.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `enabled` | bool | `true` | Off: nothing is recorded and presence wakes stop. | live |
| `poll_seconds` | 1–3600 | `30` | Seconds between checks. Must be at least `server.poll_seconds`, or the save is refused. | live |
| `down_after_checks` | 1–100 | `3` | Failed checks in a row before a host counts as down. | live |
| `up_after_checks` | 1–100 | `2` | Answered checks in a row before it counts as back. | live |

## automations

The scheduler's settings. The automations themselves are stored in the database and managed in Conf; see [Automations](automations.md). **None of these keys has a Conf form**: change them by hand in `config.yaml` and restart.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `enabled` | bool | `true` | Master switch for schedules: while off, nothing runs on a schedule. **Run now** still works. | live |
| `poll_seconds` | 1–3600 | `10` | How often the scheduler checks for due runs. | live |
| `default_timeout_s` | 1–86400 | `300` | Time limit for a run that sets none of its own. | live |
| `max_count` | 1–500 | `20` | Most automations that may exist. | live |
| `misfire_grace_s` | 0–86400 | `300` | How late a run may still start. Later than this, it is recorded as missed and skipped. | live |
| `keep_runs` | 1–1000 | `50` | Runs kept per automation; older ones are deleted along with their conversations. | live |

## media

Your own art. The images are files in `$CTRLB_HOME/media/<namespace>/<role>/`, copied there over SSH or uploaded from the gallery in Conf. This block records what a folder can't: the order of each role's pictures and the pins. The gallery writes it; you rarely edit it by hand. See [Media](media.md).

### media.write

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `max_bytes` | int > 0 | `15728640` (15 MB) | Largest upload accepted, read on each upload; past it the upload is refused with 413. No Conf form, so in practice you change it by hand edit and restart. | live |

### media.namespaces

A map keyed by namespace (`gacha`, `frontier`, `kit`, `agents`). Unknown namespaces, roles and slots are refused.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `<ns>.roles.<role>.files` | list | `[]` | The role's pictures in priority order. Each entry has exactly one of `name` (a file in the role's folder) or `bundled` (an id of the art the role ships), and may add `key`, `hidden` and `focal`. Files not listed follow, then the role's unlisted shipped art. | live |
| `<ns>.roles.<role>.files[].key` | string or null | `null` | Binds the picture to a named item (e.g. a host), instead of matching by its filename stem. | live |
| `<ns>.roles.<role>.files[].hidden` | bool | `false` | Kept in the library but never used. | live |
| `<ns>.roles.<role>.files[].focal` | `{x, y, z?, rev?}` or null | `null` | The framing point: `x` and `y` from 0 to 1, and an optional zoom `z` (values are clamped to the allowed range; a zoom of 1 is stored as no zoom). `rev` ties the point to the file's current version: after the file is replaced, the framing reads as reset. The gallery writes all of this. | live |
| `<ns>.slots.<slot>` | `{name}` · `{bundled}` · null | absent (unpinned) | A pin: one picture from another role shown in a fixed place. The only slots are `gacha`'s `wallpaper` and `oracle`, both pinning from `characters`. `null` or an absent slot means unpinned; an empty `{}` is refused. | live |

## attachments

Files you attach to a chat message. The app stores them under `$CTRLB_HOME/attachments/`. There is no Conf form for these.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `max_files_per_message` | int > 0 | `10` | Most files on one message. | live |
| `max_file_mb` | int > 0 | `10` | Largest file, in MB; past it the upload is refused with 413. | live |
| `staging_orphan_hours` | int > 0 | `24` | How long an uploaded file you never sent can still be sent. Startup removes older ones. | live |
| `image_max_dimension` | int > 0 | `2048` | The app shrinks a photo so its longest side is at most this, before uploading. | live |
| `image_quality` | > 0, ≤ 1 | `0.85` | The quality the app re-encodes photos at. | live |
| `max_inline_chars` | int > 0 | `16000` | How much of a text file goes into the message; the agent's `read_attachment` reads the rest in pages of this size. | next chat turn |
| `image_tokens` | int ≥ 0 | `1000` | How many tokens one image is counted as when deciding to compact. | next chat turn |
| `max_images_per_request` | int ≥ 0 | `10` | Most images one request carries across the whole conversation; the oldest become placeholders past it. | next chat turn |
| `resend` | bool | `true` | Send images from earlier messages again. Off: only the current message's images go. | next chat turn |
| `max_pdf_pages` | int > 0 | `200` | Pages of a PDF whose text is extracted. | live |
| `max_extracted_chars` | int > 0 | `400000` | Characters of PDF text extracted. Both PDF limits stop the extraction loop, so the page that crosses the limit is kept whole. Lower them if sending a big document feels slow. | live |

## roleplay

Settings shared by all characters. A character's own settings live in its agent folder; see [Characters and lorebooks](characters-and-lorebooks.md).

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `enabled` | bool | `false` | Shows or hides the character fields in the app. Nothing else depends on it: a character keeps working with it off. | live |
| `default_tools` | list of strings | `[web_search]` | The tool list given to a newly created or imported character, and to an agent (not the default one) whose Duties you switch from Agent to Talk while it still has every tool. | live |
| `default_persona` | string | `""` | The persona every agent talks to unless its `agent.yaml` names another with `persona:`. `""` means none. A key that isn't in the library is ignored. | next chat turn |

### roleplay.personas

Who you are, for any agent: a map keyed by a slug that is created once from the name and never changes. Managed in the persona editor in Conf; the generic settings save refuses this map.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `<slug>.name` | string | `""` | What `{{user}}` becomes. Empty means `User`. | next chat turn |
| `<slug>.description` | string | `""` | Who you are; when not empty it is added to the prompt as its own block. | next chat turn |

### roleplay.card_import

Limits on character card imports (PNG, JSON or CHARX). A card over any limit is refused with 413.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `max_bytes` | int > 0 | `15000000` | Largest upload. | live |
| `max_card_json_bytes` | int > 0 | `2000000` | Largest card data after decoding. | live |
| `charx_max_entries` | int > 0 | `500` | Most files inside a CHARX archive. | live |
| `charx_max_entry_bytes` | int > 0 | `15000000` | Largest single file inside it. | live |
| `charx_max_total_bytes` | int > 0 | `50000000` | Largest total unpacked size, checked before anything is unpacked. | live |

## lorebooks

Books of entries that join the prompt when their keywords come up. The books are files in `$CTRLB_HOME/lorebooks/`; see [Characters and lorebooks](characters-and-lorebooks.md).

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `books` | list of strings | `[]` | Books attached to every agent on every turn, on top of each agent's own list. A book named twice counts once. | next chat turn |
| `scan_depth` | int ≥ 0 | `2` | Earlier messages searched for keywords along with the new one. `0`: only what you just said. | next chat turn |
| `budget_chars` | int > 0 | `4000` | Most entry text added in one turn; past it the lowest-priority entries are left out. | next chat turn |
| `max_import_bytes` | int > 0 | `15000000` | Largest book import; over it the import is refused with 413. | live |
| `include_names` | bool | `true` | Search each message as `speaker: text`, so a keyword naming a speaker matches that speaker's lines. No Conf form. | next chat turn |

## openapi_servers

A list of REST services described by an OpenAPI document. Each operation becomes an agent tool named `api__<server>__<operationId>`. Reads (`GET`, `HEAD`) run without asking; other methods use the server's `risk`. A server whose document won't load is skipped.

Saving a server through Conf applies at the next chat turn, or at once with the rediscover button. Both refuse while a turn is running. A generic settings save that carries this list does not trigger rediscovery, so restart or press rediscover.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `name` | string | required | The server's name, used in tool names. | next chat turn |
| `base_url` | string | `""` | Service root. | next chat turn |
| `spec_url` | string | `""` | The OpenAPI document's URL. Blank means `base_url` + `/openapi.json`. | next chat turn |
| `enabled` | bool | `true` | Off: its tools are not offered. | next chat turn |
| `risk` | `low` · `med` · `high` | `med` | Risk level of the non-read operations. **Security gate.** | next chat turn |
| `connect_timeout_s` | number | `15` | Time limit for connecting. | next chat turn |
| `call_timeout_s` | number | `60` | Time limit for one whole tool call. | next chat turn |
| `api_key` | string | `""` | Token sent with each request. A secret. | next chat turn |
| `auth_scheme` | string | `Bearer` | Prefix for the token; `""` sends the raw key. | next chat turn |
| `auth_header` | string | `Authorization` | Header that carries the token. | next chat turn |
| `headers` | map | `{}` | Extra headers. Values whose names look secret (token, key, auth, …) are masked in Conf. | next chat turn |
| `include` | list of strings | `[]` | Only these operation ids or paths become tools. Empty means all. | next chat turn |

## mcp_servers

A list of MCP servers the agent connects to. Their tools are named `mcp__<server>__<tool>`. A server that is down is skipped and never blocks startup. Applying a change works as for `openapi_servers`.

Risk is set **per tool**: a tool the server marks read-only is low risk and runs without asking, and a tool it marks destructive is high risk even on a server you set to `low`. Other tools use the server's `risk`.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `name` | string | required | The server's name, used in tool names. | next chat turn |
| `transport` | `streamable_http` · `stdio` | `streamable_http` | HTTP server (`url`) or a local program (`command`). | next chat turn |
| `enabled` | bool | `true` | Off: its tools are not offered. | next chat turn |
| `risk` | `low` · `med` · `high` | `med` | Risk level of its tools that carry no read-only or destructive mark. `med` and `high` ask you to confirm (`med` runs without asking at auto-low privilege, `high` asks below full). **Security gate.** | next chat turn |
| `connect_timeout_s` | number | `10` | Time limit for connecting and listing tools. | next chat turn |
| `call_timeout_s` | number or null | `null` | Time limit for one tool call. Blank uses `connect_timeout_s`. | next chat turn |
| `url` | string | `""` | HTTP endpoint. | next chat turn |
| `headers` | map | `{}` | Extra HTTP headers; secret-looking ones are masked. | next chat turn |
| `command` | string | `""` | Program to start, for `stdio`. | next chat turn |
| `args` | list of strings | `[]` | Its arguments. | next chat turn |
| `env` | map | `{}` | Its environment; secret-looking values are masked. | next chat turn |

## tool_overrides

Per-tool changes, keyed by tool name (`ping_host`, `mcp__web-tools__search_web`, …). Edited in Conf. A save that changes this map is refused while a turn is running; try again when it ends.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `<tool>.description` | string or null | `null` | Replaces the description the model sees. Blank restores the built-in one. | next chat turn |
| `<tool>.agent_mode` | `core` · `enabled` · `disabled` or null | `null` | `core`: always offered, even when a skill narrows the tools. `enabled`: offered normally. `disabled`: never offered. `null`: the tool's own default. | next chat turn |
| `<tool>.approvals` | list of `{args}` or null | `null` | Standing "always allow" rules. Each rule is `{args: {field: pattern}}` with string glob patterns; a field it leaves out matches anything. A rule with no `args` (or `args: null`) allows every call; `args: {}` matches only a call with no arguments (the catalog shows it as "no args"). A rule only turns a risk-based confirmation into an allow: it can never deny, and it never skips the confirmation that shutdown, reboot, `run_shell` and `create_automation` always ask for below full privilege (at read privilege shutdown, reboot and `run_shell` are refused outright, rule or not). Tapping "always" on a confirmation writes one. Unknown keys in a rule are refused. **Security gate.** | live |
| `<tool>.max_calls` | int ≥ 1 or null | `null` | This tool's per-turn call limit, replacing the agent's general limit. | next chat turn |

## prompts

Changes to the app's built-in prompts, keyed by prompt id. Edited in Conf. Saving an entry replaces it whole; blank fields count as unset, and an entry with nothing set is removed.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `<id>.override` | string or null | `null` | Replaces the built-in prompt. | next chat turn |
| `<id>.append` | string or null | `null` | Added after whichever version is active, separated by a blank line. | next chat turn |

## computers

Your fleet, keyed by host name. Edit it in Conf → Computers or by hand; the generic settings save refuses this map. A host's id is a slug of its name, so **renaming a host changes its id** and the ids of its services. Every field except `ip` is optional; leaving one out disables that ability without errors. The buttons still show, and pressing one the host can't do gives a clear refusal. See [Fleet](fleet.md).

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `<host>.ip` | string | required | The address that is pinged, probed and used for service links. A DNS or MagicDNS name works. | live |
| `<host>.mac` | string or null | `null` | MAC address for Wake-on-LAN. | live |
| `<host>.ssh_username` | string or null | `null` | SSH user for shutdown, reboot and service commands. | live |
| `<host>.ssh_password` | string or null | `null` | SSH password. SSH uses passwords only (no keys), the same password is fed to `sudo`, and a host key the server has not seen before is accepted without a check. A secret. | live |
| `<host>.ssh_port` | int | `22` | SSH port. | live |
| `<host>.os_type` | `linux` · `windows` · `macos` | `linux` | Decides the shutdown command and which `cmd` variant runs. Any other value is read as `linux`. | live |
| `<host>.role` | string or null | `null` | A label shown on the host card and in the agent's fleet list. The machine editor has no field for it: set it in `config.yaml`. | live |
| `<host>.vpn_host` | string or null | `null` | The host's Tailscale name (preferred) or address. Used for SSH when `ip` fails, and for service links when you browse over Tailscale. Never pinged or woken. | live |
| `<host>.ssh_prefer_vpn` | bool | `false` | Try `vpn_host` before `ip` for SSH. | live |
| `<host>.wake_on_connect` | bool | `false` | Wake this host whenever the app's live feed connects (opening the app and every reconnect, within `wake.cooldown_s`). Needs `mac`. | live |
| `<host>.wake_on_presence` | bool | `false` | Wake this host when one of your devices arrives. Needs `mac` and `monitor.enabled`. | live |
| `<host>.wake_presence_cooldown_s` | int ≥ 0 or null | `null` | This host's own `wake.presence_cooldown_s`. `0`: no cooldown. | live |
| `<host>.tags` | list of strings | `[]` | **Inert: [ISS-95](../ISSUES.md).** Stored, read by nothing. | inert |
| `<host>.appearance` | map | `{}` | Per-theme presentation, `{theme: {…}}`; each theme defines its own keys (frontier reads `{x, y}`). | live |

### computers.services

Services nested under a host, keyed by name; each gets the id `<host>.<service>`. Whether a service is up is worked out each poll and never stored.

| key | type | default | what it does | applies |
|---|---|---|---|---|
| `<service>.kind` | string or null | `null` | A label for the service type (`jellyfin`, `plex`, …). | live |
| `<service>.port` | int or null | `null` | TCP port probed each poll (skipped while the host is offline). Without a port, the service follows its host. | live |
| `<service>.path` | string | `""` | Path added to the service link (`http://<ip>:<port><path>`). The link works only while the service is up. | live |
| `<service>.cmd` | map | `{}` | `{start, stop, restart}` → `{os_type: command}`; only the host's own OS variant runs. The agent's `start_service`, `stop_service` and `restart_service` tools run these. There is no service button in the Fleet view. On Linux and macOS a `sudo` in the command is fed the SSH password. | live |
| `<service>.autostart` | bool | `false` | **Inert: [ISS-95](../ISSUES.md).** Stored, and Conf shows a switch for it, but nothing reads it. | inert |

## Under the hood

Design: [`docs/UPDATE_PLAN.md`](../UPDATE_PLAN.md) (config shape and migrations); the schema itself is `backend/app/config.py`.
