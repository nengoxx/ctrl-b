# HTTPS for the mic — Tailscale Serve (Phase 6c-1)

The voice UI (mic capture + some audio APIs) needs a **secure context** — browsers only allow
`getUserMedia` over **HTTPS or `localhost`**. Connecting from your phone over plain
`http://corsair:5173` is *not* a secure context, so the mic is blocked there (you'll see the
"Microphone needs a secure (HTTPS) connection" toast).

**Tailscale Serve** fixes this with one command: it puts the app behind a real TLS certificate at your
device's tailnet name, **without exposing anything to the public internet** (Serve is tailnet-only —
that's Serve, *not* Funnel). It runs as a reverse proxy *in front of* the existing dev server, so
nothing about how you run the app changes.

> This is 6c-1 (manual setup + this doc). A settings-driven "Enable HTTPS" toggle with a QR code is the
> planned 6c-2 (see DECISIONS/ROADMAP) — cleanest once on emma where the permissions are simple.

---

## Both options coexist — you don't lose the HTTP path

Serve **adds** an HTTPS front door; it doesn't replace the plain one. After setup you have **both at the
same time**, pick per device/browser:

| URL | Context | Mic |
|---|---|---|
| `http://corsair:5173` | insecure | needs Firefox's `media.devices.insecure.enabled` flag (your current workaround — unchanged) |
| `https://corsair.<your-tailnet>.ts.net` | **secure** | works in any browser, no flags |

No port clash (tailscaled owns the tailnet's 443; Vite still owns 5173), no backend change, still
tailnet-only.

---

## One-time prerequisites

1. **Tailscale installed + logged in** on the host (corsair / later emma), and on your phone, both on the
   same tailnet.
2. **HTTPS certificates enabled for the tailnet** — in the [Tailscale admin console] → **DNS**, enable
   **MagicDNS** and **HTTPS Certificates**. Serve can't provision a cert without this (one-time, tailnet-wide).
3. **Permission to run `tailscale serve`:**
   - **Linux (emma):** either run with `sudo`, or set yourself as operator once — `sudo tailscale set
     --operator=$USER` — then `tailscale serve` needs no sudo.
   - **Windows (corsair):** run the command from an **elevated** terminal (Administrator).

[Tailscale admin console]: https://login.tailscale.com/admin/dns

---

## Setup (the actual commands)

The app's frontend (Vite, port **5173**) already proxies `/api` to the backend (5433), so you only need
to serve the **frontend** port — `/api`, SSE, and chat streaming all flow through it.

```sh
# Turn on HTTPS for the dev server, persistently (survives reboot / tailscale restart):
tailscale serve --bg 5173

# Show the exact public-on-your-tailnet URL it set up:
tailscale serve status
#   https://corsair.<your-tailnet>.ts.net  ->  http://127.0.0.1:5173
```

`--bg` runs it in the background and **auto-resumes on reboot** — so this is a set-once thing, not a
per-session launch. The first request may take a few seconds while Tailscale provisions the certificate.

Open the `https://…ts.net` URL from `tailscale serve status` on your phone.

**To turn it off** (append `off` to the same command), or to clear all Serve config:

```sh
tailscale serve --bg 5173 off      # remove just this one
tailscale serve reset              # clear everything Serve is doing
```

### Scan-to-open on the phone (handy)

Print a QR for the URL right in the terminal so you just point your phone camera at it:

```sh
# Linux: apt/brew install qrencode
qrencode -t ANSIUTF8 "$(tailscale serve status --json | python -c 'import sys,json;print(list(json.load(sys.stdin)["Web"].values())[0]) if False else None' 2>/dev/null || echo https://corsair.<your-tailnet>.ts.net)"
# simplest: just paste the URL from `tailscale serve status`:
qrencode -t ANSIUTF8 "https://corsair.<your-tailnet>.ts.net"
```

---

## No app change needed

`frontend/vite.config.ts` already sets `server.allowedHosts: true` (it was added anticipating exactly
this — Vite ≥5.4 otherwise rejects the `*.ts.net` Host as a DNS-rebinding guard). Nothing to edit.

**Dev-server caveat:** Vite's **HMR websocket** may not connect cleanly *through* the HTTPS proxy, so you
might see HMR console warnings on the phone — **the app itself works fine** (HMR is only live-reload while
editing). If you want a totally clean serve for a phone test, serve a production build instead of the dev
server:

```sh
npm run build && npm run preview -- --host 0.0.0.0 --port 5173
# then `tailscale serve --bg 5173` points at the preview server — no HMR, no warnings
```

---

## Phone verification checklist (the 6c acceptance test)

Open the `https://…ts.net` URL on your Android phone and confirm:

- [ ] **Mic permission** prompts, then **record → stop → transcript fills the composer** (or sends, if
      Conf → Voice · STT → Auto-send is on).
- [ ] **Mic states** at phone width: idle look · red pulse while recording · mic **hidden** when STT is
      off in Conf · greyed + "voice servers unreachable" if the STT chain is down.
- [ ] **TTS:** the per-bubble ▶ plays a reply; the **floating mini-player** (just below the header)
      scrubs by drag + tap, shows remaining time, and dismisses; **auto-TTS** reads a new reply when the
      app-bar speaker is on.
- [ ] No mixed-content / secure-context errors in the console.

If transcription feels laggy on the first try after idle, that's the **whisper model cold-loading** —
keep the Speaches model warm server-side (model TTL), independent of HTTPS. (See the STT-latency note in
HANDOFF.)

---

## When you move to emma (Linux)

Serve config is per-device and persistent, so you redo `tailscale serve --bg 5173` on emma after cutover
(with `tailscale set --operator=$USER` once). This is also where **6c-2** — the in-app "Enable HTTPS"
toggle + status + QR — lands cleanly, since a non-elevated backend can drive `tailscale serve` there.
