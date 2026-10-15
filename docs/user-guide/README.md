# The ctrl-b user guide

ctrl-b is a private control panel for the computers in your home. It runs on one always-on machine
(the server) and you open it in a browser, usually on your phone, over your Tailscale network. From
it you can see which machines are up, wake them, shut them down or reboot them, check the services
they run, and talk to an AI agent that can do the same jobs for you, by text or by voice. Nothing is
exposed to the internet: the tailnet is the only way in.

This guide covers what you see and what you do. Each page follows the same order: what the feature
is, how to use it, the settings that change it, its edge cases and limits, and last, under "Under the
hood", pointers to the design docs. Troubleshooting and the configuration reference use their own
layouts: they are lookup tables.

## Pages

| Page | What it covers |
|---|---|
| [Getting started](getting-started.md) | Running the server, opening it on your phone, HTTPS for the mic, installing the app, the five sections, adding your first computer, what needs a restart |
| [Fleet](fleet.md) | Host cards, online status, wake / shut down / reboot and the confirm step, what each host field enables, services, the monitor and notifications, the `!` shell, open-terminal, Windows hosts |
| [Chat](chat.md) | The composer and every command, attachments, conversations per agent, streaming and read-aloud, the tools the agent can call, privilege levels, memory, providers, MCP and OpenAPI tool servers |
| [Voice and calls](voice-and-calls.md) | The mic button and its gestures, dictation, sending a clip, call mode and the call screen, auto-speak, what survives a locked phone, the voice limits |
| [Agents](agents.md) | Agents as folders, the gallery and its editors, the root agent and specialists, greetings, skills, subagents, macros, per-agent model and privilege, the persona library |
| [Characters and lorebooks](characters-and-lorebooks.md) | Character cards (import and export), what a character is in ctrl-b, lorebooks and how their entries activate |
| [Media](media.md) | Your own images: the galleries, libraries per destination, uploads and their limits, crop and focus point, ordering, which image is live |
| [Themes](themes.md) | The theme catalog, the Appearance switches, composer skins, what syncs across devices and what stays on one, installing and updating the app (PWA) |
| [Tools](tools.md) | The utility cards (IP lookup, DNS resolve, YouTube captions) and the agent tools catalog: which tools the agent may use, their descriptions, risk and confirm badges, always-allow rules |
| [Conf](conf.md) | The settings tab group by group, how saving works, what applies live and what needs a restart, the HTTPS card, backups |
| [Automations](automations.md) | Scheduled agent runs: creating and editing them, the schedule syntax, what an unattended run may do, where its results land |
| [Configuration reference](configuration-reference.md) | Every `config.yaml` key: type, default, what it does, when it applies |
| [Troubleshooting](troubleshooting.md) | Symptom → cause → fix, and every known limit with its issue number |

## Where the rest lives

This guide describes the app as it behaves today. The design documents, the decisions behind each
feature and the build history live one folder up, in [`docs/`](../); the map of those documents is
in [`CLAUDE.md`](../../CLAUDE.md). The ones you are most likely to want:

- [`README.md`](../../README.md) — the project front page, the quickstart and the architecture.
- [`SECURITY_MODEL.md`](../SECURITY_MODEL.md) — the trust boundary, the privilege gate and the confirm step.
- [`HTTPS_TAILSCALE.md`](../HTTPS_TAILSCALE.md) — setting up HTTPS (needed for the mic).
- [`deploy/linux/README.md`](../../deploy/linux/README.md) — installing, updating and rolling back the always-on server.
- [`ISSUES.md`](../ISSUES.md) — the open issues and recorded limits that the pages here link by number.
