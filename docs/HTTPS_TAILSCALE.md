# HTTPS for the mic — Tailscale Serve (the live runbook)

The voice UI needs a **secure context**: browsers gate `getUserMedia` (mic capture) on **HTTPS or
`localhost`**, and **`AudioWorklet` is secure-context-only with no flag that unlocks it**. Plain
`http://emma:5433` or `http://emma:5173` from the phone is not a secure context.

**Tailscale Serve** fixes this with one command: a real TLS certificate at the device's tailnet name,
**without exposing anything to the public internet** (Serve is tailnet-only — that's Serve, *not*
Funnel). It is a reverse proxy *in front of* the app, so nothing about how the app runs changes.

## What is live on emma

```
https://emma.lobster-vector.ts.net  →  proxy  http://127.0.0.1:5433     (PROD: uvicorn serving the built dist)
```

That is the **prod** backend, not the Vite dev server. Prod is also reachable on plain
`http://emma:5433` (LAN + tailnet, owner waiver 2026-07-10 — SECURITY_MODEL §2.1), so Serve is not
prod's only ingress; it is its only **secure-context** one.

---

## What breaks on plain HTTP (and what a browser flag does NOT fix)

| Feature | plain `http://…` | notes |
|---|---|---|
| Mic capture (`getUserMedia`) | blocked | Firefox's `media.devices.insecure.enabled` flag unblocks **this and only this** |
| **Live/phrase-streaming dictation** | **degrades** | `AudioWorklet` is secure-context-only. The app detects it and falls back to standard whole-clip transcription with the toast *"Live dictation needs HTTPS — using standard transcription."* (`hooks/useDictation.ts` — the worklet gate) |
| **Live voice / call mode** | **unavailable** | same worklet dependency for the uplink |
| Notifications | hidden | the browser hides them on a plain-http origin (Conf says so inline) |

So the Firefox flag is a mic workaround, **not an HTTPS substitute** — the streaming voice paths need
a real secure context. Use the `https://…ts.net` URL on any device you want voice on.

---

## Turning it on

### The normal path — in the app (Conf → Access)

**Phase 6c-2 / D20 shipped**: Conf carries an **HTTPS access (Tailscale Serve)** card — a live status
read straight from tailscaled, an Enable/Disable switch, and the `https://…ts.net` URL with a copy
button. The switch runs the typed `tailscale_serve_enable` / `_disable` actions at USER/FULL, so every
flip is audited as an Event. The port it fronts is `tailscale.target_port` (**default 5433**, the prod
SPA). *(The QR half of D20 was never built — the card copies the URL instead.)*

If the CLI is missing or denied, the card degrades to a message instead of a dead toggle — that is when
you fall back to the CLI below.

### The CLI path — the canonical invocation

`deploy/linux/serve-https.sh` **is** the canonical command; prefer running it over retyping the flags:

```sh
bash deploy/linux/serve-https.sh          # checks tailscale is installed + connected, then serves, then prints the URL
```

What it runs, if you need it by hand:

```sh
tailscale serve --bg --https=443 5433     # HTTPS :443 → the PROD backend
tailscale serve status                    # shows the exact https://emma.<tailnet>.ts.net URL
```

`--bg` persists across reboots and tailscale restarts — set once, not per session. The first request
may take a few seconds while Tailscale provisions the certificate.

### Optional — HTTPS for the DEV stack too

The dev Vite server (`:5173`) is plain HTTP by design, so the mic does not work there. To give dev its
own secure context, put it on a **different** port so prod's :443 is untouched:

```sh
tailscale serve --bg --https=8443 5173    # https://emma.<tailnet>.ts.net:8443 → Vite dev
```

> ⚠ **Never `tailscale serve --bg 5173` on emma.** With no `--https` flag Serve targets **:443**, so
> that command silently re-points prod's HTTPS front door at the dev server — the phone then gets a dev
> UI on the prod URL and prod loses its mic ingress until someone notices. This is a real burn: prod had
> to be restored to :5433 after exactly that detour.

### Turning it off

```sh
tailscale serve --https=443 off           # remove the prod front door
tailscale serve --https=8443 off          # …or the optional dev one
tailscale serve reset                     # clear everything Serve is doing
```

---

## One-time prerequisites

1. **Tailscale installed + logged in** on the host and on the phone, same tailnet.
2. **HTTPS certificates enabled for the tailnet** — [admin console] → **DNS** → enable **MagicDNS** and
   **HTTPS Certificates**. Serve cannot provision a cert without this (one-time, tailnet-wide).
3. **Permission to run `tailscale serve`:**
   - **Linux (emma):** `sudo tailscale set --operator=$USER` once — then `tailscale serve` needs no
     sudo (and neither does the in-app toggle, which runs as the backend's user). Otherwise prefix with
     `sudo`.
   - **Windows (corsair):** a **regular, non-elevated terminal works** — verified 2026-06-22 with an
     admin user account; "Run as administrator" is not needed. (Denied as a non-admin user → an
     elevated terminal is the fallback.)

[admin console]: https://login.tailscale.com/admin/dns

---

## Notes + caveats

- **No app change is needed.** `frontend/vite.config.ts` sets `server.allowedHosts: true`
  (`vite.config.ts:181`), so Vite accepts the `*.ts.net` Host through the proxy rather than rejecting it
  as a DNS-rebinding guard.
- **The live-voice WebSocket passes through Serve unconfigured.** The relay's `Origin` check is
  same-host by default and Serve preserves the Host header, so `voice.live.allowed_origins` stays
  **empty** on this setup; it is an escape hatch for a *second* Serve name, not a requirement
  (`backend/app/config.py` `allowed_origins`).
- **Vite HMR through the proxy** may not connect cleanly, so the optional dev :8443 door can log HMR
  warnings on the phone — the app itself works (HMR is live-reload only). For a totally clean phone
  test, serve a production build: `npm run build && npm run preview -- --host 0.0.0.0 --port 5173`.
- **Laggy first transcription after idle** is the whisper model cold-loading, not HTTPS — keep the
  Speaches model warm server-side (model TTL).
- **Scan-to-open:** `qrencode -t ANSIUTF8 "$(tailscale serve status | grep -o 'https://[^ ]*' | head -1)"`
  prints a QR in the terminal (`apt install qrencode`). The Conf → Access card's copy button is usually
  easier.

---

## Phone verification checklist (the 6c acceptance test)

Open the `https://…ts.net` URL on the phone and confirm:

- [ ] **Mic permission** prompts, then **record → stop → transcript fills the composer** (or sends, if
      Conf → Voice · STT → Auto-send is on).
- [ ] **Mic states** at phone width: idle look · red pulse while recording · mic **hidden** when STT is
      off in Conf · greyed + "voice servers unreachable" if the STT chain is down.
- [ ] **TTS:** the per-bubble ▶ plays a reply; the **floating mini-player** (just below the header)
      scrubs by drag + tap, shows remaining time, and dismisses; **auto-TTS** reads a new reply when the
      app-bar speaker is on.
- [ ] **No** *"Live dictation needs HTTPS"* toast — that toast over an `https://` URL means the origin
      is not actually secure (check you are on the Serve URL, not the plain-http one).
- [ ] No mixed-content / secure-context errors in the console.
