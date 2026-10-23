# Automations

An automation is a prompt the agent runs on its own, on a schedule: "every morning at 7, check
which machines are down and summarise the night", "every hour, look at the service on vega". Each
run is a normal agent turn with nobody watching, so it uses the same tools and the same permission
gate as chat, with one difference: nothing can stop and ask you to confirm. Automations live in
**Conf → Automations**.

## How to use it

### Create one

Open **Conf → Automations** and tap **new automation**. The editor asks for:

| Field | What it means |
|---|---|
| **Name** | 1–80 characters, shown in the list and in the run thread's title. |
| **Prompt** | What the agent is told to do on each run. Required. |
| **Schedule** | *Hourly* (at a minute), *Daily* (at a time), *Weekly* (on a day, at a time), or *Cron* for any 5-field expression (up to 200 characters). Below it you see the schedule in words and its next three run times, computed by the server. |
| **Timezone** | An IANA name such as `Europe/Madrid`. Left blank, it takes the server's zone at the moment you save (`$TZ`, else `/etc/localtime`, else UTC) and stores it. |
| **Agent** | Which agent runs it; *default* (shown with its name) is the agent new conversations start with (`agent.default_agent`; blank = the root agent), looked up again at each run. A named agent must still exist when the run starts, or the run fails. |
| **Privilege** | *Agent's* (the agent's own level) or Read, Confirm, Auto-low, Full. This decides what the run may do; see below. |
| **Questions** | What happens when the agent asks you a question: *Best guess* answers with the question's default (else its first choice, else "use your judgement"); *Skip* refuses the question. |
| **Results** | *New thread*: every run gets its own conversation, which you can keep chatting in afterwards. *Continuing*: every run appends to one conversation that builds up context across runs; you can read it but not chat into it. |
| **Timeout** | Seconds before the run is stopped (1 to 86400). Blank uses the server default, `automations.default_timeout_s` (300). |
| **Enabled** | Off keeps the automation but schedules nothing. |

Save, and the row shows the schedule and its next run (`· next <when>`, `· no upcoming run`, or
`· off`), a status chip for the last run, and an **N new** badge for runs you have not opened. The
switch on the row turns it on or off without opening the editor.

You can also ask the agent in chat to create one. It uses the `create_automation` tool, which asks
you to confirm below Full privilege (at Full it runs without asking); the agent cannot set the privilege (it takes the agent's own), and only you can
change that in the editor. The agent can also list your automations (`list_automations`, which
only reads and never asks).

### The schedule syntax

A cron expression has five fields: `minute hour day-of-month month day-of-week`.

| Expression | Runs |
|---|---|
| `0 7 * * *` | every day at 07:00 |
| `30 * * * *` | every hour at :30 |
| `0 9 * * 1` | every Monday at 09:00 (day-of-week 0 = Sunday) |
| `*/15 8-18 * * 1-5` | every 15 minutes from 08:00 to 18:45, Monday to Friday |

A sixth (seconds) field is refused, and so is an expression that never runs. An expression the
presets cannot show (a range, a list, a step, a month) keeps the editor on *Cron*, with a note
saying so.

Run times are computed in the automation's own timezone, so `0 7 * * *` stays at 07:00 local time
across a daylight-saving change. A local time that occurs twice when the clocks go back runs once.
A local time that never occurs because the clocks go forward also runs once, at the moment the
clocks jump: a `30 2 * * *` automation runs at 03:00 that night, and every run time inside the
skipped hour collapses into that one run.

### Run it now, edit it, delete it

- **run now** starts a run immediately. It shows **runner busy** while another automation is
  running, and it works even when the automations master switch is off.
- **Editing** takes effect from the next run; a run in progress keeps the version it started with.
  Changing only the prompt (not the schedule or timezone) keeps the next run time as it was.
  Changing **Results** is refused while a reply is still coming in the automation's Continuing
  conversation. Switching from *Continuing* to *New thread* keeps that conversation (and you can
  then chat in it); switching back makes the automation continue it again.
- **Delete** asks you to confirm and names what goes with it: the automation, its run history and
  its run conversations. It is refused while a run is in progress, or while you are chatting in one
  of its run conversations and a reply is still coming.

### What an unattended run may do

A run cannot ask you to confirm anything. Whenever a tool would ask, the call is **refused on the
spot** and the run carries on without it (the refusal is recorded in the events). So the
automation's privilege is its permission:

| Privilege | What the run can do |
|---|---|
| Read, Confirm | Only tools that run without asking: low-risk ones (ping, wake, web search, reading), plus any medium- or high-risk tool a saved always-allow rule covers (from the chat bubble, or added in [Tools](tools.md#the-agent-tools-catalog); never shut down, reboot, `run_shell` or `create_automation`, which no rule covers; at Read, only tools that are not fleet or host actions: MCP and OpenAPI tools, starting a subagent (its rule must be added in Tools; a fieldless rule works, and the bubble offers no always), and open-terminal reads if you raised their risk; fleet and host actions above low risk stay blocked, including open-terminal exec and write at their default high risk). Everything else that would ask is refused. |
| Auto-low | Also medium-risk tools (for example starting a subagent, restarting a service). High-risk tools are refused unless a saved always-allow rule covers them (from the chat bubble, or added in [Tools](tools.md#the-agent-tools-catalog)). Shut down, reboot and `run_shell` are always refused. |
| Full | Everything, including shut down, reboot and — when Agent run_shell is on — `run_shell`. |

The **Questions** setting covers questions only, never confirmations. An automation cannot create
another automation, whatever its privilege.

### Where the results land

- Each run's conversation is **archived**: it does not appear in the agent's conversation list.
  Open the automation in Conf and expand **History**: each run shows its status, and **Open thread
  ↗** takes you to its conversation in chat. Opening the History marks the runs as read.
- A New-thread run is titled `[automation] <name> · YYYY-MM-DD HH:MM` (in the automation's zone);
  a Continuing automation writes to `[automation] <name>`, which is recreated if you delete it.
- Every finished run is one event, tagged with the automation and the run, so you can tell what an
  automation did from what you did.
- With notifications on, a finished run raises an **Automation finished** notification (only while
  the app is hidden, like every notification). A run's replies belong to no device, so they are
  never read aloud automatically.

### Run statuses

| Status | Meaning |
|---|---|
| ok | The run finished. |
| error | The run failed (including "the run was not started", see below). |
| timed out | The timeout passed and the run was stopped; tools it had already called did run. |
| interrupted | The server stopped during the run. |
| missed | The run time passed while the server was down, asleep or busy, by more than `misfire_grace_s` (5 minutes by default); it was skipped. |

## Settings that affect it

The runner's own settings have no form in Conf; set them in `config.yaml` under `automations:`.

| Setting | What it changes | Default | Applies |
|---|---|---|---|
| [`automations.enabled`](configuration-reference.md#automations) | The master switch for scheduled runs (**run now** still works when it is off) | on | live |
| [`automations.misfire_grace_s`](configuration-reference.md#automations) | How late a run may still start before it counts as missed | 300 | live |
| [`automations.default_timeout_s`](configuration-reference.md#automations) | The timeout of a run that sets none | 300 | live |
| [`automations.max_count`](configuration-reference.md#automations) | How many automations may exist | 20 | live |
| [`automations.keep_runs`](configuration-reference.md#automations) | Runs kept per automation, with their conversations | 50 | live |
| [`automations.poll_seconds`](configuration-reference.md#automations) | How often the server checks for due runs | 10 | live |
| [`agent.turns.max_active_turns`](configuration-reference.md#agentturns) | How many turns may run at once, chat and automations together | 4 | live |
| [`notifications.events.automation_done`](configuration-reference.md#notifications) | The Automation finished notification | on | live |

## Edge cases & limits

- **One run at a time, across all automations.** There is no queue. A run that comes due while
  another is running waits; if it is then more than `misfire_grace_s` late, it is recorded as missed
  and skipped. A long run can make other automations miss theirs.
- **Downtime produces one missed run, not many.** However many run times pass while the server is
  down (or the master switch is off), each automation records at most one *missed* run and then
  continues from its next future time. Nothing ever runs late to catch up.
- **No retries.** A failed run stays failed; the next scheduled run happens normally.
- **A full turn cap fails the run.** If `agent.turns.max_active_turns` turns are already running
  when a run starts, it is recorded as *error* "the run was not started", and that run time is used
  up.
- **At most 20 automations** (`automations.max_count`), counting disabled ones. The **new
  automation** row shows how many you have (`3/20`), and at the limit it reads *limit reached —
  delete one first*.
- **History shows the newest 20 runs**, although 50 are kept.
- **A missed run writes no event and sends no notification.**
- **The server's timezone is read once.** Changing the machine's timezone takes effect for new
  automations after a server restart.
- **Full privilege is real.** An automation saved at *Full* runs shut down, reboot and — when Agent
  run_shell is on — `run_shell` without asking anyone.

## Under the hood

Design: [`docs/AUTOMATIONS_PLAN.md`](../AUTOMATIONS_PLAN.md).
