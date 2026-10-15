# Fleet

The Fleet section shows every computer you added in **Conf → Computers**: whether it is online,
the services it runs, and the power controls your theme offers (wake, shut down, reboot, ping). The
server does all the work: it pings the machines, sends the wake packet and runs the shutdown
command over SSH, so your phone only needs to reach ctrl-b. The same actions are tools the agent
can call from chat, through the same permission gate.

## How to use it

### Reading a card

- **The dot** is the machine's online state: it answered (or did not answer) one ping from the
  server in the latest sweep. The sweep runs every `server.poll_seconds` (5 s by default) and is
  shared by every open device.
- **The subtitle** is the machine's `role`, if you set one. There is no field for it in the editor:
  write `role:` under the machine in `config.yaml` (the editor keeps it when you save).
- **Services** are listed under the machine with their own dot: up when a TCP connection to the
  machine's address and the service's port succeeds. While a service is up, its row is a link to
  `http://<address>:<port><path>`; while it is down, the row is not clickable. A service with no port
  is not probed: it shows the machine's own state and has no link. A machine that is offline shows all
  its services offline without probing them.
- **Order.** The machine whose name matches the server's own hostname comes first (cosmos keeps
  the order of your config instead). In vapor, the featured machine in the hero cycles through the
  online machines every `server.feature_cycle_seconds` (6 s), pausing while you hold a pick or are on
  another section; the other themes have no auto-cycle.

### The power controls (per theme)

Every control runs the same action through the same gate; the theme only decides which buttons it
shows.

| Theme | Controls |
|---|---|
| minimal | Wake on an offline card, Shut down on an online one (no Reboot, no Ping) |
| cosmos | In the machine's detail view: Reboot and Shut down when online, Wake when offline, Ping always |
| vapor | On the row itself: Reboot and Shut down when online, Wake when offline; Ping in the expanded row (the `› ssh` button beside it does nothing) |
| frontier, gacha | In the machine's detail view: Reboot and Shut down when online, Wake when offline |

There is no sleep or hibernate action. The buttons show whether or not the machine has the fields
they need; pressing one it cannot do answers with a refusal toast (for example "no MAC configured
for vega — cannot wake").

- **Wake** sends a Wake-on-LAN magic packet from the server. The toast "sent wake-up packet to …"
  means the packet left, not that the machine woke. The card then shows the machine as waking and
  keeps the control disabled until a poll sees it online, or for up to 3 minutes.
- **Shut down** and **Reboot** first ask you to confirm ("Shut down vega?"). After you confirm, the
  server runs the command over SSH. The card shows the machine shutting down for up to 90 seconds
  (reboot: up to 5 minutes) or until the polls agree.
- **Ping** sends one echo and reports the result as a toast.

Every action, its result and who ran it (you, the agent, an automation, the system) is recorded as
an event.

### Adding or editing a computer

Open **Conf → Computers**. Tap **add machine** for a new one, or a machine's row to edit it, then
**add machine** or **save**; **remove** deletes it. Changes apply at once, no restart. **Discover
from Tailscale** reads your tailnet and fills in the **VPN host** of every machine that has none,
matching by tailnet DNS name (or by a hostname only one device on the tailnet uses); a machine that
already has a different value is listed as "differs" and left alone.

What each field enables:

| Field | What it does |
|---|---|
| **Hostname** (required) | The machine's name. Its id is derived from it (lowercase, other characters become `-`), so two names like `Vega` and `vega` are refused as the same machine. |
| **IP or DNS name** (required) | The one address the server pings, probes for services and builds service links from. A MagicDNS name works (`corsair`); the status then follows whatever that name resolves to, for example the machine's Tailscale address. |
| **VPN host** | A second address (a MagicDNS name, or an overlay IP) used for SSH when the first address does not connect, and for service links when you open ctrl-b over Tailscale (every theme except minimal). Never pinged, probed or woken. |
| **SSH via VPN first** | Tries the VPN host before the IP for SSH — for a machine whose LAN SSH is firewalled. |
| **MAC** | Enables Wake. Without it, Wake answers "no MAC configured". |
| **Wake when I connect** | Opening ctrl-b on any device wakes this machine if it looks offline (at most once per `wake.cooldown_s`, 5 minutes). It fires each time the app's live feed connects, so a reconnect counts too. Needs a MAC. |
| **Wake when my phone connects** | Wakes this machine when one of your watched devices arrives (its Tailscale connects, or it reappears on the home Wi-Fi). Needs a MAC, the fleet monitor on, and your devices listed in **Conf → Server**. **Presence cooldown** overrides the global cooldown for this machine (blank = the global one, `0` = none). |
| **SSH user**, **SSH port**, **SSH pass** | Enable Shut down, Reboot and service commands. SSH is password-only: keys and an ssh-agent are never tried, so a user without a password counts as no credentials. On Linux and macOS the same password is used for `sudo`. A blank password field keeps the stored one. |
| **OS** | `linux`, `windows` or `macos`. Picks the shutdown, reboot and service command variant. It does not change how the machine is pinged (that follows the server's OS). |
| **Services** | Name, kind, port, path, and optional start / stop / restart commands per OS. **Autostart** is stored but does nothing today ([ISS-95](../ISSUES.md)). |

### Services

A service row shows status and a link only. There are no start, stop or restart buttons in any
theme: the commands you enter are what the agent's `start_service`, `stop_service` and
`restart_service` tools run (start runs without asking; stop and restart ask you to confirm at the
default privilege). On Linux and macOS a bare `sudo` in a command is rewritten to read the SSH
password. On Windows the command runs as written in the machine's SSH shell (cmd.exe), for example
`net stop X & net start X`. A command missing for the machine's OS answers "no start command
configured …".

### The fleet monitor and notifications

The server watches the fleet on its own, every `monitor.poll_seconds` (30 s). When a machine has
missed 3 checks in a row it records a *host down* event; after 2 good checks it records *host up*.
A check that could not be made at all (no route, no `ping`) counts as neither. The first state after
a server restart is taken silently, so a restart never replays the fleet. The monitor is also what
drives **Wake when my phone connects**; with it off, no presence wake fires. Its settings sit in
**Conf → Server** beside the presence devices and quiet hours.

To be told about these on your phone, turn on **Conf → Notifications** and allow notifications when
the browser asks. Notifications need HTTPS, and they appear **only while the app is hidden**
(another app in front, the screen off with the app still running), never while you are looking at
it and never once the app is closed. Five event types can be switched on or off: agent needs you,
turn finished, action failed, automation finished, host up / down. During a call, *turn finished*
is not raised (you are hearing the reply).

### Events

Every action, monitor transition and automation run is stored as an event in `ctrlb.db`. The app
uses the live event stream to update itself, and the app bar shows **offline** or **reconnecting**
while that stream is down. There is no in-app list of past events: read them with
`GET /api/events?limit=N` (newest first, up to 500, including each action's output).

### The `!` local shell

With **Conf → Shell → User exec** on, a composer line that starts with `!` runs the rest as a
command **on the server itself** (not on a fleet machine), as the server's user, through `bash -lc`
(`powershell -NoProfile -NonInteractive -Command` on a Windows server), in `shell.workdir` (blank =
`$CTRLB_HOME`). The command and its output land in the conversation as a command bubble, and the
agent reads them on its next turn. With no conversation open, a new one is created with the agent new conversations start with (`agent.default_agent`; blank = the root agent),
titled `! <command>`. If the agent is in the middle of a turn in that conversation, the command is
queued and runs at the turn's next step; if something else holds the conversation you see
`// a turn is already running on this thread — wait for it to finish`. With User exec off you see
`// shell exec is disabled (Conf → Shell → user exec)`.

**Agent run_shell** is a separate switch for the agent's own `run_shell` tool. It works differently
from what its label suggests ([ISS-87](../ISSUES.md)):

- For an agent at **read** privilege: the tool is always refused, whatever the switch says.
- For an agent at **confirm** or **auto-low** privilege: off = the tool is refused; on = you are asked
  to confirm every call.
- For an agent at **full** privilege (set in its `agent.yaml`, or by you with `/privilege full`):
  `run_shell` runs **without asking, whether the switch is on or off**.
- The only off-switch that also covers full privilege is **Conf → Shell → Enabled** (`shell.enabled:
  false`), which makes every `run_shell` answer "local shell is disabled". It stops your `!`
  commands too.

Both User exec and Agent run_shell are off by default.

### Open-terminal (a remote shell for the agent)

Open-terminal connects the agent to an [open-terminal](https://github.com/open-webui/open-terminal)
server running on another machine, which gives it six tools there: run a command, read, write,
list, grep and glob files. Set the **Endpoint** and **API key** in **Conf → Open-terminal**. By
default running a command and writing a file ask you to confirm (risk *high*) and reading runs
without asking (*low*). Output is cut at 6000 characters, and a command still running when the
wait window (`open_terminal.default_wait_s`, 30 s) ends comes back as "still running (id=…)" and
carries on there. These tools are registered once, when the server starts: turning them off in Conf
works at once (they answer as unconfigured), and a new endpoint or key applies at once while they
exist; but changing a risk level, or turning open-terminal on when it was off or had no endpoint at
startup, needs a server restart ([ISS-92](../ISSUES.md)).

## Settings that affect it

| Setting | What it changes | Default | Applies |
|---|---|---|---|
| [`server.poll_seconds`](configuration-reference.md#server) | Ping sweep interval, and how often the Fleet screen refreshes | 5 | live |
| [`server.feature_cycle_seconds`](configuration-reference.md#server) | How long vapor's featured machine stays on one machine | 6 | live |
| [`computers.<name>.*`](configuration-reference.md#computers) | The fields in the table above | — | live |
| [`wake.cooldown_s`](configuration-reference.md#wake) | Minimum seconds between two connect-wakes of one machine | 300 | live |
| [`wake.presence_devices`, `wake.presence_cooldown_s`, `wake.quiet_hours`](configuration-reference.md#wake) | The watched devices, the presence-wake cooldown (3600 s), and a window (the server's local time) in which a Wi-Fi arrival wakes nothing | none / 3600 / off | live |
| [`monitor.enabled`, `monitor.poll_seconds`, `monitor.down_after_checks`, `monitor.up_after_checks`](configuration-reference.md#monitor) | The fleet monitor; its interval must be at least `server.poll_seconds` | on / 30 / 3 / 2 | live |
| [`notifications.enabled`, `notifications.events.*`](configuration-reference.md#notifications) | Phone notifications and their five types | off / all on | live |
| [`shell.enabled`, `shell.user_exec_enabled`, `shell.agent_exec_enabled`](configuration-reference.md#shell) | The `!` path and the agent's `run_shell` (see above) | on / off / off | live |
| [`shell.workdir`, `shell.timeout_s`, `shell.max_output_chars`](configuration-reference.md#shell) | Where commands run, when they are killed, how much output is kept | `$CTRLB_HOME` / 60 / 6000 | live |
| [`open_terminal.*`](configuration-reference.md#open_terminal) | The remote-shell endpoint and its three risk levels; changing an address that was already set, the token, and turning it off apply live ([ISS-92](../ISSUES.md)) | exec high · write high · read low | restart (not flagged) |
| [`tailscale.enabled`](configuration-reference.md#tailscale) | The HTTPS card and **Discover from Tailscale** | on | live |

## Edge cases & limits

- **Wake reaches only the server's own network segment.** The packet is a broadcast to
  `255.255.255.255:9` from the server; it does not cross subnets or a VPN, and a failure is silent.
  The machine also needs Wake-on-LAN enabled in its BIOS and network driver (on Windows, turn off
  Fast Startup).
- **A Windows machine shows offline while it is on.** Windows drops ping by default; allow inbound
  ICMP echo in its firewall.
- **Preparing a Linux or macOS machine.** Password login over SSH for the SSH user, and either that
  user's sudo password equal to the SSH password, or `NOPASSWD` for the commands. A button only
  toasts "failed to shut down vega" (or "failed to reboot …"); the reason, for example "sudo could not
  authenticate — the SSH password must also be the sudo password …", reaches the agent when it runs
  the same action, and is not stored in the event.
- **Preparing a Windows machine.** The OpenSSH Server feature with password authentication for an
  administrator account. Shutdown and reboot run `shutdown /s /f /t 0` and `shutdown /r /f /t 0`.
- **Shutting down the server's own machine takes ctrl-b down with it.** Nothing warns you.
- **Renaming a machine changes its id** and the id of each of its services. Past events keep the old
  id. Two service names that differ only in case or punctuation end up sharing one id; avoid that.
- **An unknown OS value is read as `linux`**, and so is a misspelt OS key under a service command.
- **A machine whose check failed** (for example no route to it) looks the same as an offline one;
  the reason is only in `GET /api/hosts`.
- **`tags` on a machine and `autostart` on a service do nothing** ([ISS-95](../ISSUES.md)).
- **Timeouts.** An SSH action that times out says "it was not cancelled and may still be completing
  on the host". A `!` command past `shell.timeout_s` is reported as killed with no output, but only
  the shell itself is killed: a command it started in the background keeps running, and the reply
  can arrive late ([ISS-89](../ISSUES.md)).
- **Output redaction.** `!` and `run_shell` output has your config's secrets masked; SSH output has
  the machine's password masked; open-terminal output is not masked ([ISS-98](../ISSUES.md)).
- **"Not in the UI" does not mean "not callable".** The generic action API, `POST
  /api/actions/{name}`, can run any registered action, including the Tailscale Serve switches and
  `run_shell`, behind the confirm step ([ISS-88](../ISSUES.md)). With Agent run_shell on, that route
  runs a shell even while User exec is off.
- **`!` in an automation's conversation** (one a repeating automation keeps writing to) is refused,
  and the app shows the same `// shell exec is disabled` note even when User exec is on.
- **Events are never deleted.** The events table grows for as long as the server runs.
- **Notifications do not reach a closed app.** There is no push service yet.

## Under the hood

Design: [`docs/SECURITY_MODEL.md`](../SECURITY_MODEL.md) (the gate, confirm tokens, the shell switches) · [`docs/DESIGN.md`](../DESIGN.md) §2 (hosts and services).
