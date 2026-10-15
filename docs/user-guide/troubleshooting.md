# Troubleshooting

Find what you see in the left column, then the cause and the fix. The last section lists every
known limit, each with its issue number in [`ISSUES.md`](../ISSUES.md) where one exists. Where the
server's own log helps: on the systemd install it is `journalctl --user -u ctrl-b-dashboard -f`
(the dev instance: `-u ctrl-b-dashboard-dev`); on Windows it is the console window `start.cmd`
opens.

## Getting it running

| Symptom | Cause | Fix |
|---|---|---|
| `pip install -e` fails while working out the version | The clone has no tags (a `--depth 1` clone or a tagless fork); the version comes from `git describe` | Clone the full repository with its tags |
| `npm run build` or `npm run dev` fails on startup | Node.js too old for Vite 7 | Use Node 20.19+ or 22.12+ |
| `http://127.0.0.1:5433/` shows `{"detail":"Not Found"}` | The app was never built, or was built after the server started | `npm run build` in `frontend/`, then restart the server |
| The server refuses to start and exits with code 78, printing "config migration required" | The release changed the config's shape | Run the command it prints (`… -m app.config_migration --apply`); `--check` first shows what would change. A copy of the old config goes to `$CTRLB_HOME/backups/` |
| Exit 78 with "config preflight: …" | A config value, or a `CTRLB_*` environment override, is invalid (for example an override aimed at a list such as `CTRLB_PROVIDERS__…`, or a non-number port) | Fix the value the message names; remove the override |
| Exit 78 on Windows and the dashboard never appears | The hidden autostart task retries three times and gives up silently | Run `start.cmd` by hand to see the message |
| The phone cannot open the plain `http://` address | The one-command scripts in production mode (`run.sh prod`, `start.cmd` without `-Dev`) listen on `127.0.0.1` only | Use the HTTPS address through Tailscale Serve ([Getting started](getting-started.md#4-give-it-https-and-open-it-on-your-phone)) |
| A change in `.env` has no effect | `.env` is read once at startup, from the repository root (or the file `CTRLB_ENV` names); a variable already set in the real environment wins | Restart the server; check the real environment |

## Fleet

| Symptom | Cause | Fix |
|---|---|---|
| Every machine shows offline on a Windows server | The backend runs with `--reload`, which breaks the ping subprocesses on Windows | Start it without `--reload` (`start.cmd` never passes it) |
| A Windows machine shows offline while it is on | Windows drops ping by default | Allow inbound ICMP echo in its firewall |
| A machine looks offline but answers in other ways | The check could not be made at all (no route, no `ping` binary); the app draws that as offline | `GET /api/hosts` shows the reason in the machine's status |
| Wake says "sent" but the machine stays off | The packet only reaches the server's own network segment, and the machine must have Wake-on-LAN enabled | Put the server on the same LAN; enable WoL in the BIOS and network driver (Windows: turn off Fast Startup) |
| "no MAC configured for … — cannot wake" | The machine has no MAC | Add it in Conf → Computers |
| "no SSH credentials configured for … — cannot shut down" | SSH user or password missing; SSH is password-only, keys are never used | Set both in Conf → Computers |
| "sudo could not authenticate — the SSH password must also be the sudo password …" | Linux/macOS shutdown, reboot and `sudo` in service commands use the SSH password for sudo | Make them the same, or allow `NOPASSWD` for those commands |
| A service has no start/stop button | There are none in any theme; service control is an agent tool | Ask the agent ([Fleet](fleet.md#services)) |
| A service link opens the LAN address while you are away | minimal (the kit view) never rewrites links to the VPN host; the other themes do when ctrl-b is open over Tailscale | Set the machine's VPN host, and use another theme if you need it |
| "it was not cancelled and may still be completing on the host" | An SSH action hit its time limit | Wait for the next poll before retrying |
| Wake-on-connect or presence wake never fires | No MAC; the fleet monitor is off (presence); the machine looked online; a cooldown is running; quiet hours (Wi-Fi arrivals only) | Check those in Conf → Computers and Conf → Server |
| `// shell exec is disabled (Conf → Shell → user exec)` | The `!` escape hatch is off (the default) | Turn on Conf → Shell → User exec |

## Conf and settings

| Symptom | Cause | Fix |
|---|---|---|
| A setting you edited in `config.yaml` does nothing | A misspelt key or section is silently ignored | Compare it with `config.example.yaml`, or check `GET /api/settings` |
| An `agents:` list in `config.yaml` does nothing | Agents are folders, not a config list | Use the gallery ([Agents](agents.md)) |
| Changing **Port** or **Bind host** in Conf did nothing, even after a restart | The listening address comes from the uvicorn command line; the port field only changes what `/api/health` reports, and the bind host field changes nothing ([ISS-91](../ISSUES.md)) | Change the systemd unit or the start script, and `tailscale.target_port` |
| A saved setting has no effect, and no restart was asked for | One of the startup-only settings: open-terminal risks and endpoint, `trusted_hosts`, the skill and subagent limits, `skills_dir` ([ISS-92](../ISSUES.md)) | Restart the server |
| Save stays disabled under **can't save — resolve first:** | A reference to a removed provider or model, or invalid JSON in a field | Fix each listed item |
| **Providers changed elsewhere — reload the tab …** | Another device saved providers since you opened Conf | Reload, redo the edit |
| "agent is busy — try again in a moment" when saving the tool catalog | A turn is running in some conversation | Wait for it to finish |
| A value keeps coming back after a restart | It is set in the environment (`CTRLB_<SECTION>__<KEY>`), which wins over the file | Remove the override |
| A secret cannot be cleared | A blank or masked secret field keeps the stored value | Remove the provider or machine, or edit `config.yaml` |
| **Save or discard your unsaved changes before switching theme** | An editor somewhere has unsaved edits | Save or discard them |

## Chat and agents

| Symptom | Cause | Fix |
|---|---|---|
| "too many turns are running — wait for one to finish" | `agent.turns.max_active_turns` (4) turns are already running, chat and automations together | Wait, or stop one |
| The composer shows "the current model can't see images", or the model says it could not see an image | The model's entry has no `input_modalities: [text, image]` | Add it to the model in Conf → Providers ([Chat](chat.md)) |
| Tools from an MCP or OpenAPI server are missing | The server was down when tools were discovered; it does not come back on its own | Tap **Rediscover tools** (Conf, OpenAPI group), or send a message after fixing the server |
| A message you sent came back to the composer and sending it again made a duplicate | The server saved it, but its answer never reached the phone ([ISS-35](../ISSUES.md)) | Check the conversation before resending |
| Read-aloud stopped mid-clip and the player is stuck | Seen once, not reproduced ([ISS-57](../ISSUES.md)) | Reload the page |
| A new skills folder is not listed | `agent.skills_dir` is read at startup ([ISS-92](../ISSUES.md)) | Restart the server |

## Voice and calls

| Symptom | Cause | Fix |
|---|---|---|
| No mic button | Speech-to-text is not configured, or the backend was installed without the `[voice]` extra (no mic then means no call button either) | Configure Conf → Voice · STT; reinstall with `pip install -e ".[voice]"` |
| "Mic needs a secure connection — use HTTPS via Tailscale Serve …" | The page is plain HTTP | Open the HTTPS address |
| "Live dictation needs HTTPS — using standard transcription." | Streaming dictation needs a secure page | Open the HTTPS address |
| "Live dictation unavailable — using standard transcription." | The streaming connection could not be set up (refused, or never ready) | Nothing is lost: the clip is transcribed whole instead. Check Conf → Live call if it keeps happening |
| "Too short — hold to record" | The recording was under one second | Hold the mic longer |
| "Clip didn't send" with Retry / Discard | The upload failed after its retries (offline, or a server error) | Tap Retry once you are back online |
| "Still sending the last clip" | A clip is still uploading or waiting for Retry | Let it finish, or Retry / Discard it |
| "N clips from the last session were lost" | The page was reloaded or closed while a clip was uploading | Say it again; recovering such clips is not built yet |
| "Voice connection lost — the rest of that wasn't captured" | A streaming dictation lost its connection after at least one phrase had landed; the rest is lost today | Say the rest again |
| Dictation stopped when you locked the phone or switched apps | By design: hiding the page stops a dictation and transcribes what you said so far ([ISS-73](../ISSUES.md)) | Use a call for hands-free use with the screen off |
| Calls fail on an install whose speech-to-text points at parakeet | A blank `voice.live.provider` reuses the speech-to-text target, and the live ear needs the Speaches realtime endpoint | Set `voice.live.provider` to the Speaches provider ([Voice and calls](voice-and-calls.md)) |
| On the Honor 20, a locked screen kills the call within seconds | Open, the device's own background limits are the suspect ([ISS-19](../ISSUES.md)) | Keep the screen on for now |
| The TV or music is transcribed as you | On the call route the phone's automatic level control evens out you and the TV; music with vocals is heard as speech ([ISS-63](../ISSUES.md), [ISS-65](../ISSUES.md)) | Lower the background sound; pick **media** under Sound in the call deck |

### Call-screen notes

| What the call screen says | What happened | What to do |
|---|---|---|
| another call is active | The server runs one live session at a time, shared by calls and streaming dictation; another tab or device holds it | End the other one |
| the last connection hasn't let go yet — retrying | Redialling while the server still holds the previous connection | Wait; it retries by itself |
| the last connection never let go | The retries ran out before the old connection was released | Wait a few seconds, then Call again |
| call time limit reached | A call lasts at most 30 minutes | Call again |
| connection strained / lost the connection | The network between the phone and the server | Check the connection; Call again |
| the connection had a problem | The server ended the call on a protocol error | Call again |
| live call is not configured | No live ear is configured | Set up Conf → Live call |
| the microphone stopped | The browser ended the mic | Call again; check the mic permission |
| that microphone wasn't available — using the default | The mic you picked would not open | Pick another in the deck, or carry on |
| the echo canceller didn't let go — audio may still be processed | You picked the media route but the phone kept its echo canceller on | Carry on, or redial |
| switching to call mode — about five seconds | The phone is moving to the call route | Wait |
| the ear was asleep — nothing said while away was heard | The page was frozen in the background; the call reconnected | Repeat what you said while away |
| the microphone stalled — anything said just now wasn't heard | The mic produced no sound and was restarted | Repeat it |
| too quiet — didn't take that | A transcript arrived with no matching sound from your mic, so it was dropped | Speak closer or louder |
| (the reply's own words) | The mic heard the reply playing back, so it was dropped | Nothing; lower the volume if it repeats |
| voice failed — the reply is text only | Every text-to-speech endpoint failed | Read the captions; check Conf → Voice · TTS |
| couldn't send that — it's back in the composer | The server refused the turn | Send it from the composer |
| not sure that sent — check the chat before repeating it | The send's answer never arrived | Look at the conversation first |
| the call sat idle in the background | Nothing happened for a while with the app hidden | Call again |
| the call was taken over by another ctrl-b session | A duplicated tab started its own call or dictation | Close the extra tab |

## The app on your phone

| Symptom | Cause | Fix |
|---|---|---|
| The app bar shows **offline** or **reconnecting** | The live event stream to the server is down; it retries on its own (1 s, up to 30 s apart) | Check Tailscale and the server |
| No install option in the browser menu | Installing needs the HTTPS address | Open `https://<server>.<tailnet>.ts.net` |
| A new release does not show | The update toast appears only when the app loads; nothing checks in the background | Reopen the app, then tap **refresh** on **// new version available** |
| No notifications | Notifications are off (the default), blocked by the browser, the page is plain HTTP, the app is in front (they show only while it is hidden), or the app is closed | Conf → Notifications; allow the site; use HTTPS |
| "the browser discarded this page while it was away and reloaded it" | The phone freed the page's memory in the background | Nothing to do |
| **the theme crashed** | A theme failed to draw | Tap **Reload page**, or **Reset theme to default** (cosmos) |
| Android Back closes a sheet instead of leaving the app | By design: Back closes the top overlay first | — |

## Known limits

**Security and permissions**
- At **full** privilege the agent runs `run_shell` without asking, whether **Agent run_shell** is on
  or off; only `shell.enabled: false` stops it there ([ISS-87](../ISSUES.md)).
- `POST /api/actions/{name}` can run any registered action, including the ones the UI hides, behind
  the confirm step ([ISS-88](../ISSUES.md)).
- A `!` or `run_shell` timeout kills only the shell, not what it started ([ISS-89](../ISSUES.md)).
- Open-terminal output is not masked for secrets.

**Settings and operations**
- `update.sh` can report "config NOT migrated" after a run that did migrate; check the backups
  before a tag-only rollback ([ISS-90](../ISSUES.md)).
- `server.host` and `server.port` bind nothing ([ISS-91](../ISSUES.md)).
- Startup-only settings save with no restart notice ([ISS-92](../ISSUES.md)).
- The database backup cleanup also deletes your own `ctrlb-*.db.gz` copies ([ISS-93](../ISSUES.md)).
- Re-running `bootstrap.py` on an installed server skips `update.sh`'s checks ([ISS-94](../ISSUES.md)).
- A machine's `tags` and a service's `autostart` do nothing ([ISS-95](../ISSUES.md)).
- The embeddings endpoint is used by nothing ([ISS-96](../ISSUES.md)).
- Events are never deleted; only media, call recordings, lorebooks, agents and skills are left out
  of the automatic backups (see [Conf](conf.md#backups)).
- A secret cannot be cleared from Conf.

**Fleet**
- Wake-on-LAN reaches only the server's own network segment.
- There is no sleep or hibernate action, and no service buttons.
- Renaming a machine changes its id and its services' ids.
- Shutting down the server's own machine is not guarded.
- Notifications reach only an open (hidden) app; a closed app gets nothing.

**Automations**
- One run at a time, no queue, no retries; a run more than 5 minutes late is skipped.
- History shows 20 of the 50 kept runs.

**Chat**
- A send whose answer was lost comes back to the composer; resending duplicates it ([ISS-35](../ISSUES.md)).
- A call stop tapped in the first ~100 ms of a turn cancels nothing ([ISS-33](../ISSUES.md)).
- Regenerating a message written before v1.7.10 does not replay its `/skill` ([ISS-42](../ISSUES.md)).
- A reply waiting on a confirm with no text has no bubble, so no retry ([ISS-43](../ISSUES.md)).
- Lorebook entries have no probability or firing cadence yet ([ISS-45](../ISSUES.md), [ISS-46](../ISSUES.md)).
- Attachment edge cases on Android's file picker ([ISS-47](../ISSUES.md)).

**Voice**
- On the Honor 20 a locked screen kills a call ([ISS-19](../ISSUES.md)).
- Dictation stops when the page is hidden, by design ([ISS-73](../ISSUES.md)).
- A streaming dictation that loses its connection after a phrase loses the rest; a clip lost to a
  reload is not recovered.
- Words said just before hanging up, or refused after the call ended, can be lost ([ISS-62](../ISSUES.md)).
- On the call route a TV or music can be heard as you ([ISS-63](../ISSUES.md), [ISS-65](../ISSUES.md)); a
  Bluetooth headset and the phone mic share one learned voice level ([ISS-64](../ISSUES.md)).
- Starting a dictation while the previous one is still finishing can mix them ([ISS-60](../ISSUES.md)).
- Answering an agent's question by voice is not built ([ISS-59](../ISSUES.md)).
- The TTS crackle seen on calls has not come back since the TTS endpoint changed; it is on record if
  it does ([ISS-16](../ISSUES.md)).
- Read-aloud once stuck until a reload ([ISS-57](../ISSUES.md)).

**Look and feel (open refinements)**
- The conversations sheet's style ([ISS-72](../ISSUES.md)); the conversations button scrolls away in
  a long thread ([ISS-82](../ISSUES.md)); the agents tab's button layout ([ISS-85](../ISSUES.md));
  some Conf capitals and numerals look too tall ([ISS-86](../ISSUES.md)); the docked composer's
  layout requests ([ISS-44](../ISSUES.md)).

## Under the hood

Design: the issue ledger [`docs/ISSUES.md`](../ISSUES.md) · the security boundary [`docs/SECURITY_MODEL.md`](../SECURITY_MODEL.md).
