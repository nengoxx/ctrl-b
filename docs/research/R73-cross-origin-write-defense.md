# R73 — Cross-origin write defence for a no-CORS, no-auth LAN app

**Date: 2026-09-15 · Confidence: spec claims VERIFIED against primary sources (Fetch / HTML / Fetch
Metadata / Beacon, fetched 2026-09-15); peers VERIFIED from source except where marked.**
**Question:** with no CORS middleware and no CSRF tokens, what actually defends a state-changing
upload endpoint against a hostile page in the owner's browser — and what do peers ship?
**Drove:** the fix for `POST /api/agents/import` + `POST /api/lorebooks/import` (D70, multipart —
they violate SECURITY_MODEL §2.7's negative) and the §2.7/§2.8-class section written for it.
Extends, does not contradict, SECURITY_MODEL §1/§2.7/§2.8 and LIVE_VOICE_PLAN §5.2.

---

## 1. The truth table — what a page can send cross-origin WITHOUT a preflight (VERIFIED)

Fetch §2.2.1: *"A **CORS-safelisted method** is a method that is `GET`, `HEAD`, or `POST`."*
Fetch §2.2.2 (`content-type` arm): the parsed *"mimeType's essence"* must be
`application/x-www-form-urlencoded`, `multipart/form-data`, or `text/plain`, else not safelisted.
Fetch §4.4 (HTTP fetch) preflights when *"request's **use-CORS-preflight flag** is set"* **or**
*"request's **unsafe-request flag** is set and either request's method is not a CORS-safelisted
method or CORS-unsafe request-header names … is not empty"*; §2.2.5: *"The unsafe-request flag is
set by APIs such as `fetch()` and `XMLHttpRequest`"* — i.e. **every scripted request carries it**.

| Vector | Methods it can emit | Body/content-type it can choose | Preflight? |
|---|---|---|---|
| `fetch()` / XHR, mode `cors` | any | any | **PUT/PATCH/DELETE ⇒ ALWAYS preflighted** (unsafe-request flag + non-safelisted method), whatever the content type |
| `fetch()` mode `no-cors` | GET/HEAD/**POST only** — Request ctor: *"If request's mode is `no-cors`: If request's method is not a CORS-safelisted method, then **throw a TypeError**"* | only the 3 safelisted types | none — **sends and executes**, response opaque |
| `<form>` | HTML: `method` is an enumerated attribute with keywords **`get` · `post` · `dialog`** — **no PUT exists** | enctype is exactly the 3 states (urlencoded / multipart / text-plain) | none |
| `navigator.sendBeacon` | **POST only** (Beacon §3.2 `method: POST`); *"If contentType value is a CORS-safelisted request-header value … set corsMode to `no-cors`"* — a `FormData` beacon is multipart ⇒ no-cors | safelisted ⇒ no preflight | none |
| `<a ping>` | **POST**, header list « (`Content-Type`, `text/ping`) », **body is the fixed string `PING`** | attacker cannot choose the body | none (a non-safelisted type with no preflight — the request is not an unsafe-request) |
| `<img> <script> <link> <iframe>` nav, `EventSource` | GET | — | none |
| WebSocket handshake | GET upgrade; not subject to CORS at all, `Origin` always sent | — | none (no preflight exists for WS) |
| Service Worker / Cache API | go through Fetch ⇒ same rules | | |
| `X-HTTP-Method-Override: PUT` | it is a *custom* header ⇒ non-safelisted ⇒ preflighted; and a `_method` form field only works if the server honours it — **ours does not** (VERIFIED: no override handling anywhere in `backend/app`) | | |

**⇒ There is no browser-reachable way to emit a cross-origin `PUT` without a preflight.** The
no-preflight set is exactly: GET/HEAD anywhere, POST with one of three content types, plus the two
fixed-body curiosities (`<a ping>`, and the CSP/OCSP report types Fetch §3.3.7 lists as *"CORS
protocol exceptions"* — none of which a server route would parse).

## 2. What "no CORS response" actually blocks (VERIFIED)

Fetch §3.3: *"To allow sharing **responses** cross-origin … the CORS protocol exists … It needs to
be an opt-in mechanism to prevent leaking data from responses behind a firewall (intranets)."*
CORS is a **read** control. A safelisted POST **is delivered and the handler runs**; only the
response is withheld from the attacker's script. That is exactly why "no multipart, no POST" on a
write route is load-bearing and "it answers with the created object, so the attacker gains nothing"
is **not** a defence: a fire-and-forget multipart POST that writes `agents/<slug>/agent.yaml` +
`SOUL.md` (or `lorebooks/*.yaml`) has already achieved persistent, model-facing prompt injection
into the owner's own agent surface — the attacker never needs to read the 201.
The attacker does not even need a `<form>`: `fetch(url,{method:"POST",mode:"no-cors",body:fd})`
with a JS-built `FormData` is a no-preflight multipart POST with fully attacker-chosen bytes.

## 3. Verdict on the raw-body PUT rail (VERIFIED for the shipped media path)

Sound, and complete against the browser vector set in §1 — **provided three negatives hold**:
1. **No CORS middleware / no `Access-Control-Allow-Origin` ever** — pinned by
   `tests/test_media_write_d65.py::test_no_cors_middleware_is_mounted_anywhere` (middleware stack +
   source scan; re-run 2026-09-15, passes). The app's `user_middleware` is empty.
2. **No OPTIONS handler** — Starlette answers 405 with no ACAO (pinned in the same file).
3. **No method override, no multipart/POST twin of a write route.**
Residuals (none of them removed by any verb choice): §4 rebinding · a non-browser client on the
tailnet (accepted non-goal, §1) · same-origin XSS in our own UI (no untrusted HTML is served —
attachments go out `nosniff` + `Content-Disposition: attachment`, SVG is never admitted as image).

## 4. DNS rebinding — it defeats the rail, and our stack has no Host check (VERIFIED)

Rebinding makes the request **same-origin**: no preflight is required, `Origin`/`Sec-Fetch-Site`
both say same-origin. The verb rail buys nothing against it. Standard mitigation = **`Host`
validation**, because the attacker controls the *name*, not the allowlist.
- **Our stack validates nothing.** No `add_middleware` call exists in `backend/app`; uvicorn 0.48
  has no host-allowlist option at all (`--forwarded-allow-ips` governs proxy headers only).
- **Starlette ships the fix**: `TrustedHostMiddleware(allowed_hosts=[…])` — compares
  `headers["host"].split(":")[0]`, exact or `*.suffix`, 400 `Invalid host header` otherwise, and it
  runs for **`websocket` scopes as well as `http`** (source read, starlette 1.3.1). One mount would
  close the HTTP rebinding residual *and* the one `_origin_allowed` names for `WS /api/voice/live`.
- **Scope-limiting fact:** rebinding only reaches the **cleartext** bind. To rebind, the attacker's
  page must be served from the rebound name; over HTTPS the Serve cert (`*.ts.net`) cannot match
  `evil.example`, so the TLS front door is not rebindable. The exposed surface is exactly
  `http://<lan-or-tailnet>:5433` (prod's `0.0.0.0` waiver) and dev's Vite :5173/:5434.
- Tailscale Serve **preserves `Host` end to end** (already established empirically — LIVE_VOICE_PLAN
  §7-S3.5: the same-host WS rule passes with `allowed_origins` EMPTY), so an allowlist is workable:
  the ts.net name + `emma` + `localhost`/`127.0.0.1` + the LAN/100.x literals in use.
- Browser-side mitigation is **not** ours to rely on: Chrome's Local Network Access permission
  (Chrome 142, Oct 2025 — REPORTED) gates public→RFC1918/loopback/`.local` requests, but the WICG
  explainer's address spaces do not cover CGNAT `100.64/10` (Tailscale), and Firefox/Fennec — the
  owner's phone browser — does not implement it.

## 5. Origin / Sec-Fetch-Site as belt-and-braces (VERIFIED, with two traps)

OWASP CSRF Cheat Sheet (current): *"If your software targets only modern browsers, you may rely on
Fetch Metadata headers … By default, reject non-safe methods (POST / PUT / PATCH / DELETE) when
`Sec-Fetch-Site: cross-site`"*, with origin verification as a *"mandatory"* fallback. Both headers
are **unforgeable by script** — Fetch §2.2.2 makes `Origin`, `Host` and every `sec-*` name a
**forbidden request-header**. Two traps decide whether this is worth anything *here*:
- **Trap A — Fetch Metadata is not sent to our HTTP origin.** Fetch Metadata §3: *"If r's url is not
  a potentially trustworthy URL, **return**"* — so `Sec-Fetch-*` arrives on the Serve HTTPS URL and
  on `localhost`, and is **absent** on `http://emma:5433`. Absence there is indistinguishable from
  an old browser.
- **Trap B — `Origin` can legitimately arrive as `null`.** Fetch §3.2: a non-GET/HEAD request gets
  `Origin`, but when the mode is not `cors` (a form post, a no-cors fetch) the referrer policy
  applies — under today's default `strict-origin-when-cross-origin`, an **https attacker page
  posting to our http port sends `Origin: null`**. So any origin rule must **fail closed on absent
  or `null`**, which is what `_origin_allowed` already does for the WS.
- **The threat that remains with no cookies and no auth:** CSRF here is not session riding — there
  is no session. Ambient authority is **network position**: every request from the owner's browser
  is already privileged, so the only question is whether the request can be *emitted*. That is why
  the answer is shape (verb) + name (`Host`), not tokens.
- A fail-closed `Origin` rule on the HTTP write surface would also break the owner's own `curl`
  probes and scripts (no Origin at all). Recommend it only where the client is provably a browser
  (the WS, as shipped) — not app-wide.

## 6. Peers (one line each)

| Project | Mechanism | Confidence / pointer |
|---|---|---|
| **Ollama** | `allowedHostsMiddleware` + `allowedHost()`: Host must be loopback/private/`*.localhost|local|internal` or the machine name → else **403**; CORS origins from `OLLAMA_ORIGINS`. **Skips the Host check entirely when not bound to loopback** (`c.Next()` on a non-loopback listen addr). | VERIFIED — `server/routes.go` ~L1757-1815, 1853-1860 |
| **Syncthing** | Two rails: `localhostMiddleware` (403 `Host check error` unless `Host` is localhost, active when the GUI is bound to localhost and `InsecureSkipHostCheck` is off) **+** a CSRF token (`X-CSRF-Token-<id>` header vs a cookie) on every `/rest/` call, bypassed only by a valid `X-API-Key`. | VERIFIED — `lib/api/api.go` L391-393, 621-628; `lib/api/api_csrf.go` |
| **ComfyUI** | Default middleware = `origin_only_middleware`: **403 on `Sec-Fetch-Site: cross-site`**, then 403 when `Host` and `Origin` hostnames differ (only enforced when Host is loopback); `--enable-cors-header` swaps it for permissive CORS. Comment in source: *"prevent the case where a random website can queue comfy workflows by making a POST to 127.0.0.1"*. | VERIFIED — `server.py` L159-197, 237-240 |
| **llama.cpp server** | CORS headers only (`--cors-origins`, default echo/`*`) + optional `--api-key`; no Host check. Startup **warns** when origins are `*` with no API key: *"this can be a security risk (cross-origin attacks)"*. | VERIFIED — `tools/server/server.cpp` L322-327, `server-http.cpp` L278-296 |
| **Open WebUI** | `CORSMiddleware(allow_origins=CORS_ALLOW_ORIGIN, allow_credentials=True)` + JWT bearer auth — the `Authorization` header is non-safelisted, so every cross-origin call is preflighted anyway. Different class: it has auth. | VERIFIED — `backend/open_webui/main.py` L809-811 |
| **Jellyfin** | Token auth in a custom header (`Authorization`/`X-Emby-Token`) ⇒ preflight-forced, plus a configurable `ICorsPolicyProvider` and `ForwardedHeaders`; no Host allowlist of this kind. | PARTIAL — `Jellyfin.Server/Extensions/ApiServiceCollectionExtensions.cs` L114-119 |

**Pattern:** the two projects whose threat model is ours (single user, local bind, no auth —
Ollama, ComfyUI) both ship **Host-vs-name validation as the anti-rebinding rail**, and ComfyUI adds
`Sec-Fetch-Site`. Syncthing pairs a Host check with real CSRF tokens because it *has* a session.
Nobody relies on verb choice alone — but nobody else confines writes to a non-safelisted verb either.

## 7. What I could not determine

- Whether any shipping browser sends `Sec-Fetch-*` to plain-HTTP LAN origins in violation of the
  spec gate (not probed on a real device; spec says no, untested).
- Whether Tailscale Serve rewrites `Host` in any configuration other than the one in use here
  (our evidence is empirical for this deploy, not from Tailscale docs).
- Chrome LNA's exact treatment of `100.64/10` (the explainer omits CGNAT; no browser test run).
- Jellyfin's default CORS policy body (provider is indirect; not read through).

## 8. Recommendation (advisory — the main seat rules)

1. **Convert both imports to the D68 shape:** `PUT /api/agents/import` and
   `PUT /api/lorebooks/import`, raw body, `await request.body()`-equivalent streamed to the same
   `cap + 1` posture they already use. Neither handler reads `file.filename` (VERIFIED), so **no
   path filename is needed** — do not invent one. Frontend: swap the two `postForm` call sites
   (`useAgents.ts:271`, `useRoleplay.ts:208`) to the existing `putBytes` helper and delete
   `postForm` + its now-false security note in `api/client.ts:103-120`.
2. **Widen the pin so this cannot recur:** today's `declares_multipart` walk is scoped to
   `/api/media` (+ its attachments twin). Make it **app-wide** — every live route asserted against
   an explicit allowlist of multipart routes, currently `{POST /api/voice/stt}`. That check, not
   prose, is what would have caught D70.
3. **Belt-and-braces worth buying: `TrustedHostMiddleware` only** (the already-recorded D65-R1 lean
   fix). It closes the one residual the verb rail cannot, covers WS as well as HTTP, and costs one
   mount plus a config list. Do **not** add a global Origin/Sec-Fetch rule: Traps A and B make it
   unreliable on the cleartext surface and it would break the owner's own non-browser clients.
4. **The SECURITY_MODEL section must state, to be true:** (a) *the verb is the control because no
   browser API can emit a cross-origin `PUT` without a preflight — `fetch`/XHR always preflight a
   non-safelisted method, `no-cors` mode throws on one, and an HTML form can only emit GET or POST*;
   (b) *CORS withholds the response, never the send, so a multipart/POST write route executes for a
   hostile page even though it can read nothing — "it answers with the created object" is not a
   defence*; (c) *the rail assumes the server never answers a preflight and never validates a name:
   DNS rebinding makes the request same-origin and bypasses it entirely, which is why `Host`
   validation (Ollama/ComfyUI/Syncthing all ship one) is the belt-and-braces of record, scoped to
   the cleartext bind because TLS makes the Serve front door unrebindable.*
