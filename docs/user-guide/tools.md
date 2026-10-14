# Tools

The Tools section holds two things. At the top are **utility cards**: small one-shot tools you run
yourself (IP lookup, DNS resolve, YouTube captions), which the agent can also call. Below them is
the **agent tools** catalog: every tool the agent can use, where you decide which ones it may call,
edit the description it reads, and manage the "always allow" rules that let a tool run without
asking. What the agent does with its tools in a conversation is on the [Chat](chat.md) page.

## How to use it

### Finding it

With a 4-tab layout, Tools is its own tab (the ◆). With a 3- or 2-tab layout (the frontier and
gacha default), it becomes the **Tools** group inside Conf. **Conf → Appearance → Layout** decides
which.

### Running a utility

Each card shows the tool's name, its description, one input per field, and a **run** button (Enter
in a field also runs it). The result appears under the card: a one-line summary, the returned
values as rows, and for YouTube captions a **↓ download .json** button. A failure shows the
summary and the error in red. Running a card is recorded as an event, like any action.

| Card | What it does | Input | Limits |
|---|---|---|---|
| **IP lookup** | Location and owner of an IP address or hostname: city, region, country, ISP, organisation, AS number, reverse name, coordinates, timezone. | An IP or hostname; leave it blank to look up the server's own public IP. | Asks the free ip-api.com service over plain HTTP, from the server; 10-second limit. |
| **DNS resolve** | The IPv4 and IPv6 addresses a hostname resolves to, and the reverse (PTR) name of the first address. | A hostname or IP (required). | Uses the server's own resolver. Address records only: no MX, TXT or traceroute. 20-second limit. |
| **YouTube captions** | Fetches a video's captions with their timestamps; the card offers them as a JSON file named after the video's title. | A YouTube URL: `watch?v=…`, `youtu.be/…`, `/embed/…`, `/shorts/…` or `/v/…` (required). | English captions only; a video without them fails with "Couldn't fetch captions for that video." When the agent calls it, it reads at most the first 8000 characters of the text (the download always has the full transcript). 60-second limit. |

All three only read; none changes anything, and they run without a confirmation.

**Agent access on a card.** The small three-way control next to a card's title (**core · on ·
off**) decides whether the *agent* may call that utility (see below); you can always run the card
yourself. A tap saves at once. Tapping the description opens an editor for the text the agent
reads (**Set** saves it; an empty text restores the built-in one).

### The agent tools catalog

The **agent tools** group lists every tool the agent can be given, other than the utility cards
above, in four groups: *fleet & service actions*, *agent builtins*, *utilities* (the ones without a
card, such as web search) and *mcp & openapi tools*. Within a group the riskiest come first. Each
row shows:

- **the tool's name and its risk badge**: `low` runs without asking; `med` asks you to confirm at
  the default *confirm* privilege and runs without asking at *auto_low* or *full*; `high` asks at
  every level below *full*. The levels are explained on the [Chat](chat.md) page.
- **`confirm`**, on tools that always ask below *full* privilege, whatever rule you save
  (shut down, reboot, `run_shell`, creating an automation). These rows have no "always allow"
  editor.
- **`modified`**, when the row's access differs from the tool's default.
- **the access control, core · on · off** (the default carries a dot):
  - **core** — every agent can always use it, even an agent whose own tool list leaves it out, and
    even while a skill narrows the tools for a message.
  - **on** — available, but subject to each agent's tool list and to skills narrowing it.
  - **off** — never offered to any agent.
- **the description** the agent reads when it decides which tool to use. Tap it to edit; an empty
  text restores the built-in one.
- **always-allow rules** (on tools without the `confirm` badge): standing permissions to run the
  tool without asking. Tapping **always** on a confirm bubble in chat adds an exact rule for that
  call; here you can see them, revoke one with **×**, or add your own: a rule is a set of
  `field = pattern` pairs, where the pattern may use `*` and `?`. A rule matches a call when every
  field it lists matches; fields it does not list can be anything. A rule with no fields is shown
  as **any args** and allows every call of that tool.

`run_shell` is shown read-only, marked "governed by Conf → Shell": its access is set there (see
[Fleet](fleet.md#the--local-shell)).

Changes in the catalog collect until you tap **Save N changes** at the bottom (it then reads
**Saved**, and a toast says **Tool settings saved**). A change applies from the agent's next
message.

### Where this is stored

Everything you set here is one entry per tool under `tool_overrides` in `config.yaml`:
`description`, `agent_mode` (`core` · `enabled` · `disabled`, shown as core · on · off),
`approvals` (the always-allow rules) and `max_calls`. Choosing a tool's default access, or emptying
its description, removes that part of the entry, so the file holds only what you changed.
`max_calls` (how many times the agent may call that tool in one turn, instead of the agent's general
per-tool cap) has no control here; set it in the file.

## Settings that affect it

| Setting | What it changes | Default | Applies |
|---|---|---|---|
| [`tool_overrides.<tool>.agent_mode`](configuration-reference.md#tool_overrides) | Whether the agent may use the tool (core · on · off) | the tool's own default | next chat turn |
| [`tool_overrides.<tool>.description`](configuration-reference.md#tool_overrides) | The text the agent reads about the tool | the built-in text | next chat turn |
| [`tool_overrides.<tool>.approvals`](configuration-reference.md#tool_overrides) | The always-allow rules | none | live |
| [`tool_overrides.<tool>.max_calls`](configuration-reference.md#tool_overrides) | Per-turn call cap for this tool (file only) | the agent's per-tool cap | live |
| [`shell.agent_exec_enabled`](configuration-reference.md#shell) | Access to `run_shell` (not set in this catalog) | off | live |
| [`mcp_servers`, `openapi_servers`](configuration-reference.md#mcp_servers) | Which external tools appear in *mcp & openapi tools* | none | next chat turn |

## Edge cases & limits

- **Saving is refused while the agent is working.** If any conversation has a turn running, a
  save from the catalog or a card's access control fails with "agent is busy — try again in a
  moment". Try again when it finishes.
- **"off" applies to the agent only.** A utility card still runs when you tap **run**; turning a
  card's access off stops only the agent from calling it.
- **Always-allow rules do not cover `confirm` tools** and do nothing at *read* privilege for fleet
  actions above low risk, which that level refuses outright. At *full* privilege nothing asks, so
  rules make no difference there.
- **A tool that is hidden from the agent by design** (the HTTPS switches, for example) is not
  listed in the catalog at all.
- **External tools appear only after discovery.** An MCP or OpenAPI server that was down when its
  tools were discovered is missing from the catalog until the next rediscovery (Conf → **Rediscover
  tools**, or the next chat message after you saved a change to those servers).
- **The IP lookup leaves your network in plain text.** The query goes from the server to ip-api.com
  over HTTP.

## Under the hood

Design: [`docs/DESIGN.md`](../DESIGN.md) (the typed-action registry and the permission gate) · the always-allow rules in [`docs/SECURITY_MODEL.md`](../SECURITY_MODEL.md) §2.5.
