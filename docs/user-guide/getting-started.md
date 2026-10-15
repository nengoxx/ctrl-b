# Getting started

ctrl-b is one server process (a FastAPI backend that also serves the web app) plus the browser app
you open on your phone or computer. You run the server on a machine that stays on, put it behind
Tailscale Serve so it has an HTTPS address on your tailnet, and open that address on your phone.
This page takes you from a fresh clone to your first computer on the Fleet screen.

## How to use it

### 1. Get the code and the requirements

- **Python 3.14 or newer** (the backend uses 3.14-only syntax).
- **Node.js 20.19+ or 22.12+** (the build tool, Vite 7, refuses older 20.x and 22.x releases).
- **A full git clone with its tags.** The app's version number comes from `git describe`, so a
  `git clone --depth 1` (or a fork without tags) makes the backend install fail.
- **Tailscale** on the server and on your phone, logged in to the same tailnet.

### 2. Start the server

Pick one of these.

**One command (Linux or macOS, no systemd).** Create the backend venv once, then run the script:

```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -e ".[voice]" && cd ..
deploy/linux/run.sh prod    # builds the app, then serves it on http://127.0.0.1:5433
deploy/linux/run.sh dev     # backend :5433 with auto-reload + the Vite dev server on :5173
```

**One command (Windows).** Double-click `deploy\windows\setup.cmd` once (venv, dependencies, app
build), then `deploy\windows\start.cmd` (serves on `http://127.0.0.1:5433`). `start.cmd -Tailscale`
also turns on HTTPS through Tailscale Serve; `start.cmd -Dev` starts the hot-reload dev server.
To update, `git pull`, close the running dashboard, run `setup.cmd` again (it migrates the config
and rebuilds the app), then `start.cmd`; details in
[`deploy/windows/README.md`](../../deploy/windows/README.md).

**By hand.** Two terminals:

```bash
# terminal 1 — from backend/
python3 -m venv .venv && .venv/bin/pip install -e ".[dev,voice]"
.venv/bin/uvicorn app.main:app --port 5433 --ws-ping-interval 5 --ws-ping-timeout 5

# terminal 2 — from frontend/
npm install
npm run dev        # http://localhost:5173, forwards /api to :5433
```

Keep the two `--ws-ping-*` flags: every shipped launcher passes them. Without them the server takes
about 40 seconds to notice that a phone's call connection died, and until then it refuses the
phone's redial because the dead connection still holds the one call slot.

To have `:5433` serve the app itself instead of only the API, run `npm run build` in `frontend/`
and then restart uvicorn. The server looks for the built app once, at startup; with no build,
`http://127.0.0.1:5433/` answers `{"detail":"Not Found"}`.

**Always-on (Linux, systemd).** For a server that starts at boot and updates by release tag, follow
[`deploy/linux/README.md`](../../deploy/linux/README.md) (`install.sh prod`, then `update.sh <tag>`
for each release). Do not build that setup by hand.

**What the extras are.** `[voice]` installs the audio stack the mic needs. Without it the server
still starts, but speech-to-text reports itself unconfigured, so the app shows no mic button and no
call button. `[dev]` adds the test and lint tools you need only to change the code.

### 3. Add a config file (optional)

The server starts with built-in defaults and no config file. To add machines, model endpoints and
secrets, copy `config.example.yaml` to `config.yaml` (and `.env.example` to `.env` if you want
environment overrides). Both are kept out of git.

- `config.yaml` belongs in the data folder, `$CTRLB_HOME`. When `CTRLB_HOME` is not set, that is
  the repository root. The systemd install sets it to `~/.ctrl-b`.
- `.env` always sits in the repository root, never in `$CTRLB_HOME`.
- `ctrlb.db` (chat, events, automations) is created in `$CTRLB_HOME` on the first run.

Most settings are easier to change later in **Conf** inside the app; see [Conf](conf.md).

### 4. Give it HTTPS and open it on your phone

The browser lets a page use the microphone only on HTTPS (or `localhost`), and the app can be
installed only from HTTPS. Tailscale Serve gives the server a real certificate at its tailnet name,
reachable only inside your tailnet:

```bash
tailscale serve --bg --https=443 5433     # https://<server>.<tailnet>.ts.net → the app on :5433
```

Once the app is running you can also flip this from **Conf → Server → HTTPS access (Tailscale
Serve)**, the card at the bottom of the Server group. The one-time Tailscale setup (MagicDNS,
HTTPS certificates, the operator permission) is in [`HTTPS_TAILSCALE.md`](../HTTPS_TAILSCALE.md).

Then, on your phone, open `https://<server>.<tailnet>.ts.net`. The one-command scripts in their
production mode (`run.sh prod`, `start.cmd` without `-Dev`) listen on `127.0.0.1` only, so from another
device Tailscale Serve is the way in. Their dev mode is different: it starts Vite on `0.0.0.0:5173`,
which passes the whole API through over plain HTTP to anyone on your LAN while it runs
([security model](../SECURITY_MODEL.md) §2.1).

### 5. Install it as an app (optional)

On the HTTPS address, open the browser menu and choose **Install app** or **Add to Home screen**.
ctrl-b shows no install prompt of its own, and a plain `http://` address cannot be installed. After
a new release, the app shows a **// new version available** toast with **refresh** the next time
it loads. Details, and what works offline: [Themes](themes.md).

### 6. Find your way around

The app has five sections:

| Section | What it holds |
|---|---|
| **fleet** | Your machines: status, wake, shut down, reboot, their services. The chat composer sits at the bottom. |
| **chat** | The agent conversation: messages, commands, attachments, the mic. |
| **tools** | One-shot utilities (IP lookup, DNS resolve, YouTube captions) and the agent tool catalog, where you set which tools the agent may use. |
| **conf** | Every setting, in numbered groups. |
| **agents** | The gallery of agents and characters. |

How many sit on the bottom bar depends on **Conf → Appearance → Layout** (Auto, 4, 3 or 2). With 3,
Tools becomes a group inside Conf; with 2, Conf moves into the nav menu as well. The agents gallery
has its own setting, **Conf → Appearance → Agents**: *Conf* (a group inside Conf, the default),
*Button* (in the nav menu) or *Tab* (its own place on the bar). Both settings are kept per device.
Some themes rename the tabs: frontier shows *frontier · comms · tools · settings · cast*, and gacha
*fleet · agent · tools · settings · cast*. The app
reopens on the section you used last.

### 7. Add your first computer

Open **Conf → Computers → add machine**. Fill in at least the **Hostname** and the **IP or DNS
name**, then tap **add machine**. The card appears on the Fleet screen within one poll (5 seconds by
default), showing whether the machine answers a ping. Add a **MAC** to be able to wake it, and an
**SSH user** and **SSH password** to be able to shut it down or reboot it. Each field, and how to
prepare the machine, is on the [Fleet](fleet.md) page.

## Settings that affect it

| Setting | What it changes | Default | Applies |
|---|---|---|---|
| [`server.poll_seconds`](configuration-reference.md#server) | How often the fleet is pinged and the Fleet screen refreshes | 5 | live |
| [`server.debug`](configuration-reference.md#server) | Debug logging | false | restart |
| [`server.host` / `server.port`](configuration-reference.md#server) | Nothing that binds: the address comes from the uvicorn command line ([ISS-91](../ISSUES.md)) | 127.0.0.1 / 5433 | — |
| [`tailscale.target_port`](configuration-reference.md#tailscale) | Which local port the Conf HTTPS card points Serve at | 5433 | live |
| [`computers`](configuration-reference.md#computers) | Your machines (edit them in Conf → Computers) | none | live |

### What needs a restart

Almost every change you save in Conf applies at once. These do not:

- `server.debug` — Conf says "restart to apply".
- `server.trusted_hosts`, the open-terminal settings (the three risk levels, and `enabled` or
  `base_url` when the terminal was off or had no address at startup), `agent.skills_dir`, `agent.skill_min_overlap`, `agent.skill_max_active` and
  `agent.global_subagent_limit`. They save without any restart notice, and take effect only after
  one ([ISS-92](../ISSUES.md)).
- Anything in `.env`: it is read once, when the server starts.
- A first `npm run build` while the server is already running.

`server.host` and `server.port` do nothing even after a restart ([ISS-91](../ISSUES.md)). To move
the server to another port, change the uvicorn command line (or the systemd unit) and
`tailscale.target_port`. The full list, key by key, is in the
[configuration reference](configuration-reference.md).

## Edge cases & limits

- **Plain `http://` works as a web page only.** No mic, no streaming dictation, no call mode, no
  notifications, no install, no update toast.
- **An old config after an update.** When a release changes the config's shape, the server refuses
  to start (exit code 78) and prints the one command that fixes it, `python -m
  app.config_migration --apply` with the venv's Python. Run it with `--check` first to see what it
  would change; `--apply` saves a copy of your config to `$CTRLB_HOME/backups/` before rewriting
  it. The systemd install and `update.sh` run this for you.
- **A misspelt key does nothing.** Unknown keys in `config.yaml` are kept and ignored, with no
  warning. If a setting seems to have no effect, check its spelling against `config.example.yaml`.
- **Windows server: never run uvicorn with `--reload`.** The reload worker breaks the ping
  subprocesses, so every machine shows offline. The Windows scripts never pass it.
- **A tagless clone cannot install the backend** (see step 1).

## Under the hood

Design: [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) (deployment profiles, `$CTRLB_HOME`); the always-on install: [`deploy/linux/README.md`](../../deploy/linux/README.md).
