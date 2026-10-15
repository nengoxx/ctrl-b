# Conf

Conf is the settings section. Everything in it is stored in one file, `config.yaml` in
`$CTRLB_HOME`, except the things that have their own files or database rows (agents, skills,
lorebooks, memory, automations, your images). The tab is a column of numbered groups, one per area
of the app. You can do everything here without editing the file; when you do edit the file by
hand, Conf shows the change after the next restart (or the next save of a machine, a persona or an
integration, which reload the file).

## How to use it

### Finding a group

Every group starts collapsed; tap its header to open it. Each device remembers which groups you
left open. The groups, in order:

| # | Group | What it holds |
|---|---|---|
| 01 | **Providers** | The model endpoints (base URL, API key, models) every other group points at. |
| 02 | **Inference** | The chat backend: which provider and model answers, failover, request and connect timeouts, the connect cooldown, the system prompt and its append. See [Chat](chat.md). |
| 03 | **Prompts** | Your overrides of the built-in prompt texts. |
| 04 | **Server** | Poll cadence, feature cycle, debug, the bind host and port (which do nothing, see below), the fleet monitor, presence devices, wake cooldowns, quiet hours, and at the bottom the **HTTPS access (Tailscale Serve)** card. See [Fleet](fleet.md). |
| 05 | **SearXNG** | The search server behind the agent's `web_search` tool. |
| 06 | **Embeddings** | An embeddings endpoint. Nothing in the app uses it yet ([ISS-96](../ISSUES.md)). |
| 07 | **Open-terminal** | The agent's remote shell on another machine. See [Fleet](fleet.md#open-terminal-a-remote-shell-for-the-agent). |
| 08 | **Shell** | The `!` escape hatch and the agent's `run_shell`. See [Fleet](fleet.md#the--local-shell). |
| 09 | **Voice · STT** | Speech-to-text, including the clip upload settings and live (streaming) dictation. See [Voice and calls](voice-and-calls.md). |
| 10 | **Voice · TTS** | Text-to-speech, including **Auto read-aloud** (the same switch as the speaker in the app bar; per device). |
| 11 | **Live call** | Call mode. See [Voice and calls](voice-and-calls.md). |
| 12 | **Notifications** | Phone notifications and their five event types. |
| 13 | **MCP servers** | External tool servers (Model Context Protocol). See [Chat](chat.md). |
| 14 | **OpenAPI tool servers** | External tools described by an OpenAPI document. |
| 15 | **Agents** | **Default agent** (which agent new conversations start with), subagent limits, chat delivery and auto-compaction. See [Agents](agents.md). |
| 16 | **Roleplay** | **Roleplay fields**, the character tools and your persona library. See [Characters and lorebooks](characters-and-lorebooks.md). |
| 17 | **Lorebooks** | The books, their entries, import, and the scan and budget settings. |
| 18 | **Automations** | Scheduled agent runs. See [Automations](automations.md). |
| 19 | **Skills** | The skill files the agent can load. |
| 20 | **Memory** | The agent's memory files and core memory. |
| 21 | **Computers** | Your machines. See [Fleet](fleet.md#adding-or-editing-a-computer). |
| 22… | **Tools** | Only with a 3- or 2-tab layout: the Tools section, hosted here. |
| 22… | **Agents · gallery** | Only when **Appearance → Agents** is *Conf* (the default): the gallery, hosted here. |
| 22… | **Appearance** | Theme, mode, palette, the switches, layout, app bar. See [Themes](themes.md). |
| 22… | media groups | One per image library you can manage right now: the shared ones always, a theme's own only while that theme is active. See [Media](media.md). |

The groups after Computers are numbered on from 22, in the order above, so their numbers shift with
your layout and theme.

### Saving

There are three save behaviours:

1. **One shared Save bar** for groups 01–02 and 04–12 (Providers through Notifications, except
   Prompts). The bar sits at the foot of each of those groups, but it is one button: **Save
   changes** writes every group you changed, in one request, and then reads **Saved**. If something
   blocks the save, a **can't save — resolve first:** list above the button names it (for example a
   model reference that points at a provider you removed, or invalid JSON) and the button stays
   disabled. Edits you make while a save is still in flight are kept.
2. **Editors that save on their own**: Prompts, MCP, OpenAPI, Agents, Roleplay, Lorebooks,
   Automations, Skills, Memory, Computers. Each has its own buttons; in Agents the default-agent pick
   saves the moment you choose it.
3. **Appearance applies instantly**, with no Save at all.

After a save you see **Settings saved**, or **Saved · restart to apply: …** when you changed a
setting the running server cannot pick up. A refused save shows the server's reason. If another
device changed the providers since you opened Conf, the save is refused with **Providers changed
elsewhere — reload the tab to pick up the new state**; reload and redo the edit. Leaving the page
with unsaved edits asks you to confirm, and picking a theme is refused until you save or discard
them.

**Secrets** (API keys, SSH passwords) show masked. Leaving a secret field blank, or leaving the mask
in it, keeps the stored value. That also means a secret cannot be cleared from Conf: remove the
provider or machine, or edit `config.yaml` by hand.

**How a save merges.** A save sends only the sections you changed; the server merges them into the
file key by key and writes only the lines that changed, keeping your comments. Lists are replaced
whole, and so are `providers` and `prompts`. Your machines (`computers`) and the persona library
(`roleplay.personas`) are refused by the general save: they have their own editors, which save
through their own requests.

### What applies live, and what needs a restart

Almost every save applies to the running server at once. The exceptions:

| Setting | What happens |
|---|---|
| `server.debug` | Needs a restart; Conf says so. |
| `server.host`, `server.port` | Conf says "restart to apply", but a restart does not apply them either: the listening address comes from the uvicorn command line (the systemd unit, `run.sh`, `start.cmd`). `server.port` only changes what `/api/health` reports, and nothing reads `server.host` ([ISS-91](../ISSUES.md)). |
| `server.trusted_hosts` | Needs a restart, with no notice. It has no form in Conf (edit the file). |
| Open-terminal **Enabled** (turning it on when it was off at startup), **Endpoint** (when there was none at startup), **Exec / Write / Read risk** | Needs a restart, with no notice: the tools and their risk levels are fixed when the server starts. Turning it off works at once, and so does turning it back on if it was on at startup ([ISS-92](../ISSUES.md)). |
| `agent.skills_dir`, `agent.skill_min_overlap`, `agent.skill_max_active`, `agent.global_subagent_limit` | Need a restart, with no notice. After a `skills_dir` change, the skills list still shows the old folder while new skills are written to the new one ([ISS-92](../ISSUES.md)). |
| MCP and OpenAPI servers | Apply at the start of the next chat message (when no turn is running), or when you tap **Rediscover tools** at the foot of the OpenAPI group (refused while any conversation has a turn running). A server that was down at that moment stays missing until the next rediscovery. |

The per-key list is in the [configuration reference](configuration-reference.md).

### The HTTPS card

**Conf → Server → HTTPS access (Tailscale Serve)**, the last item of the Server group, shows whether
Tailscale Serve is fronting the app, a switch to turn it on or off, and the `https://…ts.net` URL
with a copy button. The switch acts immediately (it is not part of the Save bar) and each flip is
recorded as an event. It fronts the port in `tailscale.target_port` (5433). If the `tailscale`
command is missing or not allowed, the card says *unavailable* with the reason; the setup is in
[`HTTPS_TAILSCALE.md`](../HTTPS_TAILSCALE.md). Serve is a setting of the whole machine, so two
ctrl-b instances on one box share it.

### Backups

What is saved for you, on the systemd install:

- **The database**, before every production install or update: `install.sh prod` copies
  `ctrlb.db` with SQLite's online backup, checks it, and keeps it as
  `$CTRLB_HOME/backups/ctrlb-<date>-<time>.db.gz`. The newest 10 are kept (`CTRLB_BACKUP_KEEP`
  changes that number). The dev instance never takes one.
- **The config**, only when an update actually rewrites it: the config migration saves
  `$CTRLB_HOME/backups/config.yaml.<UTC timestamp>` first. These are never deleted.
- **Memory**: every write to the agent's memory files is committed to a git repository inside the
  memory folder, and edits you make by hand are committed by a periodic sweep.

Nothing else is backed up: your images (`media/`), call recordings (`calls/`), lorebooks, agent
folders and skills. To take a copy yourself at any time:

```bash
sqlite3 ~/.ctrl-b/ctrlb.db ".backup '$HOME/.ctrl-b/backups/manual-$(date +%Y%m%d-%H%M%S).db'"
cp -p ~/.ctrl-b/config.yaml ~/.ctrl-b/backups/config.yaml.$(date -u +%Y%m%dT%H%M%SZ).manual
tar -C ~/.ctrl-b -czf ~/ctrl-b-data-$(date +%F).tgz media calls lorebooks agents skills memories
```

Use `sqlite3 .backup`, not `cp`, for the database: recent writes live in a side file that a plain
copy can miss. Name a hand-made database copy so it does **not** start with `ctrlb-`: the automatic
cleanup deletes every `ctrlb-*.db.gz` past the newest 10, yours included ([ISS-93](../ISSUES.md)).
Restoring is in [`deploy/linux/README.md`](../../deploy/linux/README.md) §Rollback.

## Settings that affect it

| Setting | What it changes | Default | Applies |
|---|---|---|---|
| [`appearance`](configuration-reference.md#appearance) | Written by Conf → Appearance; synced across your devices | cosmos | live |
| [`tailscale.enabled`, `tailscale.target_port`](configuration-reference.md#tailscale) | Whether the HTTPS card is active, and the port it fronts | on / 5433 | live |
| [`server.debug`](configuration-reference.md#server) | Debug logging | false | restart |
| [`server.trusted_hosts`](configuration-reference.md#server) | Which `Host` headers the server accepts (empty = any) | empty | restart (not flagged) |

## Edge cases & limits

- **A value set in the environment** (`CTRLB_<SECTION>__<KEY>` in `.env` or the service
  environment) shows in Conf like any other value, with no marker. Editing it in Conf applies at
  once and writes the file, but the environment value comes back at the next restart.
- **A misspelt key in `config.yaml` is silently ignored**, and so is an `agents:` list: agents are
  folders, managed in the gallery ([Agents](agents.md)).
- **Some keys have no form** and are edited in the file only: the `automations:` runner settings,
  the `attachments:` limits, `media.write.max_bytes`, `server.trusted_hosts`, `agent.turns`,
  `agent.skills_dir`, `agent.skill_min_overlap`, `agent.skill_max_active`,
  `agent.skills_auto_write`, `memory.git_backup`, `lorebooks.include_names`, a model's
  `input_modalities` and `voice.live.vad_model`.
- **Saving the agent tool catalog** (Tools → agent tools) while any conversation has a turn running
  is refused with "agent is busy — try again in a moment".
- **Two devices saving at once**: the last save wins, except for providers, which are refused on the
  second device (see Saving).
- **Re-running `bootstrap.py` on an installed server is not an update**: it checks out the newest
  release tag and installs it without the safety checks `update.sh` makes
  ([ISS-94](../ISSUES.md)). Update with `update.sh`.
- **After a failed update, do not trust `update.sh`'s "config was NOT migrated" line on its own**:
  it can say so after a run that did migrate ([ISS-90](../ISSUES.md)). Compare the `config_version:`
  line of `config.yaml` with the newest `backups/config.yaml.*` before rolling back.

## Under the hood

Design: [`docs/UPDATE_PLAN.md`](../UPDATE_PLAN.md) (config migration, backups, the release path) · the settings API in [`docs/DESIGN.md`](../DESIGN.md) §9.
