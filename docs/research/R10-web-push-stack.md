# R10 — Web Push (RFC 8030/8291/8292): the standards-and-stack half

**Date:** 2026-07-31 · **Scope:** how to correctly implement Web Push in 2026 for a **single-user,
self-hosted FastAPI + Vite/React PWA** served over HTTPS on a tailnet. **Lane:** official specs,
library repos, browser-vendor docs, issue trackers. A **separate dossier** covers the peer-project
field pass (how open-webui/LibreChat/ntfy/Mastodon wire it) — nothing here is derived from those
apps' source.

**Assumed known, not re-derived:** the four-actor model (PWA / service worker / push service /
backend), FCM being unavoidable on Android, VAPID removing the need for a Firebase project,
payloads being E2E-encrypted, HTTPS being required.

**Drives:** ROADMAP §F1 channel 2 (Web Push). Not yet cited by a D-entry.

**Confidence key:** **[V]** verified — I read the primary source (spec text, installed source,
repo file, API response) · **[R]** reported — credible secondary source · **[U]** unverified.

---

## 1. Python sender library — the 2026 state

### 1.1 `pywebpush` — alive, but expensive

| Fact | Value | Conf |
|---|---|---|
| Latest release | **2.3.0**, uploaded **2026-02-09** | **[V]** PyPI JSON API, fetched 2026-07-31 |
| Repo activity | `web-push-libs/pywebpush`, **pushed 2026-07-28**, not archived, 374 stars, 17 open issues | **[V]** GitHub API |
| `requires_python` | `>=3.10` | **[V]** |
| Declared deps | `["aiohttp", "cryptography>=2.6.1", "http-ece>=1.1.0", "requests>=2.21.0", "py-vapid>=1.7.0"]` | **[V]** verbatim from `requires_dist` |
| Resolved tree on **Python 3.14.4** | **19 packages** total | **[V]** `pip install --dry-run --report` in a clean 3.14.4 venv, 2026-07-31 |
| **Incremental cost to `backend/.venv`** | **+10 packages** | **[V]** same method, dry-run against the real venv |

The +10, verbatim from the resolver report:
`aiohappyeyeballs==2.7.1, aiohttp==3.14.3, aiosignal==1.4.0, frozenlist==1.8.0, http_ece==1.2.1,
multidict==6.7.1, propcache==0.5.2, py-vapid==1.9.4, pywebpush==2.3.0, yarl==1.24.5`.

Six of those ten exist **only** because `pywebpush` does `import aiohttp` at module top level for its
`send_async()` path — the import is unconditional, so you pay the whole aiohttp cluster even if you
never call the async API. **[V]** (read `pywebpush/__init__.py@main`: `import aiohttp` is a top-level
import; `send_async()` added in 2.1.0, 2025-09-29 per CHANGELOG). We already have `httpx` in the
venv; adding aiohttp means **two async HTTP clients in one process**.

Py3.14 compatibility: **[V]** every dependency resolved to a `cp314` wheel except `http_ece==1.2.1`,
which is **sdist-only** (`http_ece-1.2.1.tar.gz`, uploaded **2024-08-08**, classifiers stop at Python
3.12, sole dep `cryptography>=2.5`). It is pure Python, so it builds, but it is an unmaintained-ish
link in the chain and it means the install is not wheel-only.

Maintainer's own words in the `py-vapid` README (same org): *"This library was designated as a
`Critical Project` by PyPi, it is currently maintained by [a single person](https://xkcd.com/2347/).
I still accept PRs and Issues, but make of that what you will."* **[V]**
(https://github.com/web-push-libs/vapid/blob/master/python/README.md)

Recent breaking change worth knowing: **2.2.0 dropped legacy GCM/FCM authorization-key support**
(the pre-VAPID `gcm_key` path) as obsolete per Google. **[R]** CHANGELOG.md.

Error surface: `webpush()` raises `WebPushException` on any status `> 202`, and the exception
carries the `requests.Response`:

```python
class WebPushException(Exception):
    """Web Push failure.  This may contain the requests.Response"""
    def __init__(self, message, response=None) -> None:
        self.message = message
        self.response = response
```
**[V]** `pywebpush/__init__.py@main` L26–35. So pruning 404/410 means catching the exception and
reading `e.response.status_code` — there is no non-raising return path for a rejected send.

### 1.2 `webpush` (webpush-py) — the lean alternative

| Fact | Value | Conf |
|---|---|---|
| Latest release | **1.0.6**, uploaded **2025-10-29** | **[V]** PyPI JSON |
| Repo | `delvinru/webpush-py`, MIT, **18 stars**, last push 2025-11-01, 2 open issues, not archived | **[V]** GitHub API |
| Declared deps | `cryptography>=46.0.1`, `email-validator>=2.2.0`, `pydantic>=2.11.7`, `pyjwt>=2.10.1` | **[V]** |
| **Incremental cost to `backend/.venv`** | **+3 packages**: `dnspython==2.8.0, email-validator==2.3.0, webpush==1.0.6` | **[V]** dry-run |
| Total source size | **348 LOC** across 4 files (`__init__.py` 190, `vapid.py` 113, `types.py` 27, `cli.py` 18) | **[V]** cloned + `wc -l` |

Its stated reason to exist, verbatim from the PyPI description: *"The current python libraries that
work with Web Push have been written for a very long time, so they do not support typing, try to
support outdated encryption algorithms and pull a lot of deprecated dependencies."* **[V]**

Two structural differences that matter more than the star count:

1. **It does not send.** `WebPush.get(...)` returns a `WebPushMessage(encrypted: bytes, headers:
   dict)`; you POST it with your own client. **[V]** read `webpush/__init__.py` L59–120. That means
   `httpx` (already ours) does the transport, timeouts, and status handling — no second HTTP stack,
   and the response code is in our hands instead of behind an exception.
2. **`aes128gcm` only**, hard-coded: `"content-encoding": "aes128gcm"` and
   `keyinfo = b"Content-Encoding: aes128gcm\x00"`. **[V]** L117, L167. No legacy path to
   mis-select.

Its VAPID header is the modern RFC 8292 single-header form — **[V]** `vapid.py` L72–82:
```python
token = jwt.encode(payload={"aud": f"{endpoint.scheme}://{endpoint.host}",
                            "exp": int(time.time()) + expiration,
                            "sub": f"mailto:{subscriber}"},
                   key=self.private_key, algorithm="ES256")
return f"vapid t={token}, k={public_key}"
```
and its `_encrypt` is a faithful RFC 8291 §3.4 single-record implementation (HKDF with
`b"WebPush: info\x00" + dh + local_public_key`, 16-byte salt, `rs=4096`, `\x02` padding delimiter,
65-byte uncompressed `keyid`). **[V]** L122–185.

Notable gaps **[V]**: it never checks the plaintext against the record size (a >3993-byte payload
produces a body the push service will 413), it hard-codes `rs = 4096` (fine for our sizes; see §6c
for the FCM-bridge caveat), and `email-validator` + `dnspython` are pulled in solely to type the
`sub` address as `EmailStr`.

### 1.3 Verdict

**Pin `webpush==1.0.6` and send with `httpx`.** The decisive numbers: **+3 packages vs +10**, no
second async HTTP client beside `httpx`, no sdist-only unmaintained link, `aes128gcm`-only, and the
send response stays in our code where the 404/410 prune lives. The cost is a 348-LOC 18-star
dependency — mitigated by the fact that the whole surface we use is ~65 lines of `cryptography`
calls we could vendor if it were abandoned, and by the fact that a wrong result is loud (the push
service rejects, or the browser fails to decrypt) rather than silent.

A **third option is real and worth naming**: implement the RFC 8291 encryption ourselves against
`cryptography` + `PyJWT`, both **already in `backend/.venv`** — **+0 packages**. The evidence for its
viability is §1.2's LOC count. Recommend it only if the owner objects to an 18-star dependency;
otherwise the library is the cheaper maintenance story.

### 1.4 VAPID keys — generation and storage

- **`py-vapid` is not needed** if we take `webpush`: its `VAPID.generate_keys()` returns
  `(private_pem, public_pem, application_server_key)` in one call from `cryptography` alone. **[V]**
  `vapid.py` L97–113.
- `py-vapid` 1.9.4 (2026-01-05) `bin/vapid --gen` writes **`private_key.pem` + `public_key.pem`** and
  `bin/vapid --applicationServerKey` prints the browser-side key. **[V]** README.
- **Storage format:** the private key is a **PKCS#8 PEM**; the browser-side value
  (`applicationServerKey`) is the **base64url, unpadded, uncompressed X9.62 point** (65 bytes
  starting `0x04` → 87 chars) derived from the public key. **[V]** RFC 8292 §3.2 + `vapid.py` L84–95.
  Storing the PEM and deriving the public/appServerKey on load is strictly better than storing three
  things that can drift.
- **Practice for ctrl-b:** generate in code on first enable, write the PEM with the existing
  **fd-0600 write-replace** helper (the A11 precedent), keep it **out of `config.yaml`** (config is
  rewritten by the migrator and shown in the Conf tab), and expose only the derived
  `applicationServerKey` over the API. Rotating the keypair **permanently breaks every existing
  subscription** — see §7.

---

## 2. Correct send semantics

### 2.1 VAPID claims

- **`aud`** — *"the Unicode serialization of the origin (Section 6.1 of [RFC6454]) of the push
  resource URL"* **[V]** RFC 8292 §2. **Derived per endpoint**, not configured: scheme + host (+
  non-default port). A cached token is reusable across all endpoints on the same origin — with 1–3
  devices on at most two push services, caching is not worth the code.
- **`exp`** — *"An 'exp' claim MUST NOT be more than 24 hours from the time of the request."*
  **[V]** RFC 8292 §2. And symmetrically, a service may reject when *"the current time is later than
  the time identified in the 'exp' (Expiry) claim **or more than 24 hours before the expiry time**"*
  **[V]** RFC 8292 §4.2 — i.e. an over-long `exp` is a rejection, not a nicety. Both libraries
  default to **12 h**; keep it.
- **`sub`** — *"SHOULD include a contact URI for the application server as either a 'mailto:' … or an
  'https:' URI."* **[V]** RFC 8292 §2. Formally optional, but py-vapid's README notes *"While some
  Push Services consider this an optional field, others may be stricter"* **[V]** — treat it as
  required and make it a config field (an address the owner actually reads; it is the channel a push
  service uses to complain).
- Signature **MUST** be `ES256` on P-256. **[V]** RFC 8292 §2.
- Wire form **[V]** RFC 8292 Figure 1: `Authorization: vapid t=<jwt>, k=<base64url pubkey>`.
  The older two-header form (`Authorization: WebPush <jwt>` + `Crypto-Key: p256ecdsa=…`) is **not in
  RFC 8292 at all** — it is draft-era. Anything telling you to send `Crypto-Key` is stale (see §8).

### 2.2 Headers

- **`TTL` is mandatory** — *"A push service MUST return a 400 (Bad Request) status code in response
  to requests that omit the TTL header field."* **[V]** RFC 8030 §5.2.
  *"A Push message with a zero TTL is immediately delivered if the user agent is available to receive
  the message. After delivery, the push service is permitted to immediately remove a push message
  with a zero TTL."* **[V]**
- **`Urgency`** **[V]** RFC 8030 §5.3, verbatim table:

  | Urgency | Device State | Example Application Scenario |
  |---|---|---|
  | very-low | On power and Wi-Fi | Advertisements |
  | low | On either power or Wi-Fi | Topic updates |
  | normal | On neither power nor Wi-Fi | Chat or Calendar Message |
  | high | Low battery | Incoming phone call or time-sensitive alert |

  *"A push message without the Urgency header field defaults to a value of 'normal'."* **[V]**
- **`Topic`** — *"used to correlate push messages sent to the same subscription"*; *"MUST be
  restricted to no more than 32 characters from the URL and a filename-safe Base 64 alphabet."*
  **[V]** RFC 8030 §5.4. Mozilla's autopush documents the effect plainly: *"Message topics allow
  newer message content to replace previously sent, unread messages. This prevents the UA from
  displaying multiple messages upon reconnect."* **[V]**
  https://mozilla-services.github.io/autopush-rs/http.html

  **Mapping onto our four `NotifyClass` values** (evidence above, judgement mine):

  | Class | TTL | Urgency | Topic |
  |---|---|---|---|
  | `agent_input` (agent blocked on the owner) | ~1800 s — it stays actionable while the turn is suspended, and is worthless after | **high** — this is the RFC's "time-sensitive alert" row, and it is the only class that justifies waking a dozing phone | the durable call/turn id, ≤32 chars — a re-send replaces rather than stacks |
  | `turn_done` | ~600 s | `normal` | per-thread, so two finished turns collapse to the latest |
  | `action_failed` | ~3600 s | `normal` | per-host or per-action |
  | `automation_done` | ~3600 s | `low` (unattended by definition) | per-automation |

  Note `Topic` and the Notification `tag` are different mechanisms at different layers (push-service
  coalescing vs tray coalescing) and both should be set, ideally to the same string.

### 2.3 Response contract and retry

| Code | Meaning | What we do |
|---|---|---|
| **201** | *"A 201 (Created) response indicates that the push message was accepted."* **[V]** RFC 8030 §5 | success (autopush: *"Autopush should only return a 201 response"* **[V]**) |
| **400** | missing/invalid `TTL`, bad `Topic` **[V]** | a bug in us — log loudly, never retry |
| **403 / 401** | invalid or absent VAPID **[V]** RFC 8292 §4.2 | our keys are wrong or were rotated — log loudly, never retry, surface in the Conf tab |
| **404** | *"A push service MUST return a 404 (Not Found) status code if an application server attempts to send a push message to an expired push message subscription."* **[V]** RFC 8030 §7.3 | **delete the row** |
| **410** | in RFC 8030 §5.1 this is the *receipt* failure; **in practice both push services use it for a dead subscription**: autopush documents `410 — Push subscription is no longer available` **[V]**, and web.dev says of 404/410 *"This is an indication that the subscription is expired and can't be used. In this case you should delete the `PushSubscription`."* **[R]** | **delete the row** |
| **413** | body too large; *"Push services MUST NOT return a 413 status code in responses to an entity body that is 4096 bytes or less in size."* **[V]** RFC 8030 §7.2 | a bug in us — truncate the body and re-send once, or just log |
| **429** | *"A push service MAY return a 429 … The push service SHOULD also include a Retry-After header"* **[V]** | honour `Retry-After` if present; otherwise drop |

**Lean retry policy for a one-user box:** retry **only** transport-level failures and 5xx, **once**,
after ~5–10 s, and only for `agent_input`. **No retry is correct** for 4xx (all of them are either a
dead subscription or our own bug — retrying converts a bug into a loop), and no retry is correct for
`turn_done`/`automation_done` (by the time a retry lands the information is stale; the app itself is
the recovery path). A durable queue is over-engineering at this scale (§7) — but the send **must not
run inline** in the SSE/agent path: one unreachable push service would otherwise stall a turn.

### 2.4 Payload limits and encoding

- *"A push service is not required to support more than 4096 octets of payload body … Absent header
  (86 octets), padding (minimum 1 octet), and expansion for AEAD_AES_128_GCM (16 octets), this
  equates to, at most, **3993 octets of plaintext**."* **[V]** RFC 8291 §4.
- *"An application server MUST encrypt a push message with a single record."* **[V]** RFC 8291 §4.
- *"An application server MUST NOT use other content encodings for push messages. … The
  Content-Encoding header field therefore has exactly one value, which is 'aes128gcm'."* **[V]**
  RFC 8291 §4. **`aesgcm` is dead** — but `pywebpush` still accepts it
  (`valid_encodings = ["aesgcm", "aes128gcm"]`, default `aes128gcm`) **[V]**, so the trap in 2026 is
  not the library default, it is **copy-pasting a pre-2018 tutorial that passes
  `content_encoding="aesgcm"` explicitly**. `webpush-py` has no such knob.
- **The number that actually binds us: 2744, not 4096.** Mozilla autopush, verbatim: *"Some bridged
  connections require data transcription and may limit the length of data that can be sent. For
  instance, using a GCM/FCM bridge will require that the data be converted to base64. This means that
  **data may be limited to only 2744 bytes instead of the normal 4096 bytes**."* **[V]**
  https://mozilla-services.github.io/autopush-rs/http.html — and Firefox **for Android** is exactly
  such a bridged connection (§6b). Applying the RFC's arithmetic: 2744 − 86 − 1 − 16 = **2641 octets
  of plaintext** for a Fennec/Firefox-Android subscription. Our payloads are a title, a body, a key
  and a route — tens of bytes — so this only bites if someone ever puts a tool result or a log line
  in the push body. Cap the body server-side.

---

## 3. `vite-plugin-pwa`: `generateSW` → `injectManifest`

Verified against the **installed** `vite-plugin-pwa@1.3.0` in `frontend/node_modules` (package.json
declares `^1.0.3`), 2026-07-31.

### 3.1 What `registerType: "autoUpdate"` actually does — and the half that does not migrate

The plugin sets, verbatim from `dist/index.js` L874–877 **[V]**:

```js
if ((injectRegister === "auto" || injectRegister == null) && registerType === "autoUpdate") {
  workbox.skipWaiting = true;
  workbox.clientsClaim = true;
}
```

Those two lines write into the **`workbox`** options object, which is consumed **only by
`generateSW`**. In `injectManifest` mode the plugin reads the separate `injectManifest` options
object and never injects lifecycle code — so **`self.skipWaiting()` and `clientsClaim()` become our
responsibility**. The plugin docs say the same thing prescriptively:

> "You must manually add these calls to your service worker:
> ```js
> import { clientsClaim } from 'workbox-core'
> self.skipWaiting()
> clientsClaim()
> ```"
> — https://vite-pwa-org.netlify.app/guide/inject-manifest.html **[V]**

and on the auto-update page: *"With this option, the plugin will force `workbox.clientsClaim` and
`workbox.skipWaiting` to `true`."* **[V]**
https://vite-pwa-org.netlify.app/guide/auto-update.html

The **client half survives the migration untouched**: `registerType` is compiled into the virtual
register module as a string constant, independent of `strategies` — `dist/index.js` L169 **[V]**:
`.replace("__SW_AUTO_UPDATE__", `${options.registerType === "autoUpdate"}`)`. So keeping
`registerType: "autoUpdate"` keeps the reload-on-activate behaviour; only the two SW-side calls move
into our file.

### 3.2 The minimal correct diff

```ts
// vite.config.ts
VitePWA({
  registerType: "autoUpdate",   // unchanged — still drives the client reload
  strategies: "injectManifest", // NEW
  srcDir: "src",                // NEW
  filename: "sw.ts",            // NEW
  devOptions: { enabled: false },
  manifest: { /* unchanged */ },
  injectManifest: {             // REPLACES `workbox:` — the old key is now inert
    navigateFallbackDenylist: [/^\/api\//],
  },
})
```

> "By default, the plugin will search for the custom service worker on `public` directory with
> `sw.js` as the file name … **srcDir**: relative to project root … **filename**: relative to srcDir,
> include extension" — inject-manifest.html **[V]**

⚠️ The existing `workbox: { navigateFallbackDenylist: … }` **silently stops applying** once
`strategies` flips — it must move under `injectManifest`, and the deny-list only has meaning if the
custom SW actually registers a navigation route. Losing it would let the precached
`index.html` shadow `/api/*`.

```ts
// src/sw.ts — the minimum that preserves today's behaviour
/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { precacheAndRoute } from "workbox-precaching";

declare let self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);   // the precache manifest the plugin injects
self.skipWaiting();                     // the `autoUpdate` half the plugin no longer writes
clientsClaim();
// + the push / notificationclick / pushsubscriptionchange handlers from §4
```

`workbox-core` and `workbox-precaching` become **direct devDependencies** (today they are transitive
under `workbox-build`).

### 3.3 TypeScript setup — the real pitfall

Plugin guidance: *"you will need to add `WebWorker` to the `lib` entry on your `tsconfig.json`"* and
use `declare let self: ServiceWorkerGlobalScope`. **[R]** (docs + Quasar's write-up of the same
recipe).

Our `tsconfig.app.json` has `"lib": ["ES2022", "DOM", "DOM.Iterable"]` and `"include": ["src"]`
**[V]**. Adding `"WebWorker"` there is the naive fix and it is **wrong**: `DOM` and `WebWorker`
declare conflicting globals (`self`, `Client`, `caches`, `fetch`, …) and merging them in one program
produces duplicate-identifier errors and, worse, makes DOM-only APIs look available inside the
worker. The correct shape is a **separate `tsconfig.worker.json`** with `"lib": ["ES2022",
"WebWorker"]` and `"include": ["src/sw.ts"]`, plus `"exclude": ["src/sw.ts"]` in `tsconfig.app.json`
— and both wired into whatever `check-all` runs. **[U]** (this is the standard resolution of a
verified constraint; I did not find it stated in the plugin's own docs).

### 3.4 Dev mode

> "The service worker on development will be only available if `disabled` plugin option is not `true`
> and the `enabled` development option is `true`." **[V]**

For `injectManifest` specifically:
- module workers are allowed in dev (`devOptions.type: 'module'`), but *"only supported on latest
  versions of Chromium based browsers: Chromium/Chrome/Edge"* **[V]** — **Firefox dev will not load a
  module SW**, which matters because our target client is Firefox-family;
- production always emits `type: 'classic'`; **[V]**
- *"You must not use HMR (Hot Management Replacement) in your custom service worker, since we cannot
  use yet dynamic imports in service workers"* **[V]**;
- `navigateFallback` must be set in `devOptions` if the SW registers routes; **[V]**
- a known issue exists that dev-mode `injectManifest` **does not apply Vite plugins** to the SW
  build while production does — vite-pwa/vite-plugin-pwa#425. **[R]**

Keeping `devOptions.enabled: false` (today's setting) and testing push against the **prod/dev
systemd instance over the Tailscale HTTPS origin** avoids all of it. Push needs a secure context and
a real endpoint anyway.

### 3.5 A live finding in our own code (bonus, verified)

`SwUpdatePrompt.tsx` registers `onNeedRefresh` and calls `updateServiceWorker(true)`. In
`autoUpdate` mode **neither can fire**. From the installed
`dist/client/build/register.js` **[V]**:

```js
const updateServiceWorker = async (_reloadPage = true) => {
  await registerPromise;
  if (!auto) { sendSkipWaitingMessage?.(); }   // no-op when registerType === 'autoUpdate'
};
…
if (auto) {
  wb.addEventListener("activated", (event) => { if (event.isUpdate || event.isExternal) window.location.reload(); });
  wb.addEventListener("installed", (event) => { if (!event.isUpdate) onOfflineReady?.(); });
} else {
  …  wb.addEventListener("waiting", showSkipWaitingPrompt);   // onNeedRefresh lives HERE only
}
```

`onNeedRefresh` is wired **only in the `else` (prompt) branch**. So the F26 "new version available"
toast is dead code today and the file's header comment ("waits for the next reload to take over")
describes the prompt strategy, not the configured one. Out of scope for F1, but it lands in the same
file cluster — worth a separate ticket rather than a drive-by fix.

---

## 4. The service-worker handlers

### 4.1 `push`

**The must-show rule.** The spec itself is permissive — `userVisibleOnly` *"indicates that the push
subscription will only be used for push messages whose effect is made visible to the user"*, and the
user agent *"MAY consider these options … [and] SHOULD enforce it on incoming push messages"* **[V]**
(W3C Push API). Chrome turns MAY/SHOULD into MUST at both ends:

- **at subscribe time** — *"This parameter is required in some browsers like Chrome and Edge. They
  will reject the Promise if `userVisibleOnly` is not set to `true`."* **[V]** MDN
  `PushManager.subscribe`;
- **at push time** — Chrome shows a system-generated *"This site has been updated in the
  background."* notification *"when a push message is received and the push event in the service
  worker does not show a notification after the promise passed to `event.waitUntil()` has
  finished"*. **[R]** (Pushpad's write-up of the Chromium string; widely corroborated, e.g.
  firebase/firebase-js-sdk#9069). The exact tolerance before Chrome intervenes is **[U]** — secondary
  sources say "around 10" and the Budget API that formalised it never shipped as a stable, queryable
  surface.
- Firefox does **not** substitute a notification; a push that shows nothing is simply silent. **[U]**
  (no primary statement found either way).

Practical consequences for the handler:

1. **Always `event.waitUntil(...)` the `showNotification()` promise.** The single most common cause
   of the Chrome fallback notification is calling `showNotification()` and not awaiting it — *"their
   code will often call `self.registration.showNotification()` but they aren't doing anything with
   the promise it returns"*. **[R]**
2. **Always show something**, including on the error path. web.dev: *"you **must** show a
   notification when you receive a push and this is true *most* of the time. The one scenario where
   you don't have to show a notification is when the user has your site open and focused."* **[V]**
   (Even that exception is best skipped for us: our foreground engine already suppresses on
   `visibilityState !== "hidden"`, so the SW showing one anyway when the page is visible would
   double up. Prefer letting the SW check `clients.matchAll({type:"window"})` for a *focused* client
   and, if found, `postMessage` to the page and still show nothing — accepting the small Chrome
   quota cost — **or** simply always show and let the `tag` collapse it. Pick one; do not have both
   layers guessing.)
3. **No/undecryptable payload:** *"If the push message payload could not be decrypted for any
   reason, then acknowledge the push message and abort these steps."* **[V]** W3C Push API — i.e.
   **no `push` event fires at all**, so there is nothing to handle. A payload-less push *does* fire
   the event with `event.data === null`; handle it by showing a generic "ctrl-b has an update"
   notification rather than throwing, since throwing costs you the Chrome fallback notification
   anyway.

### 4.2 `notificationclick`

Canonical pattern, verbatim from MDN `Clients.openWindow` **[V]**:

```js
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window" }).then((clientsArr) => {
      const windowToFocus = clientsArr.find((c) => c.url === e.notification.data.url);
      if (windowToFocus) { windowToFocus.focus(); }
      else {
        clients.openWindow(e.notification.data.url)
          .then((windowClient) => (windowClient ? windowClient.focus() : null));
      }
    }),
  );
});
```

Refinements the docs make explicit:
- add `includeUncontrolled: true` to `matchAll` — a client loaded before the current SW took control
  is otherwise invisible; **[U]** (standard, but I did not find it stated for this case)
- **deep-link via `notification.data`**, which is structured-cloned and survives the tray. Our
  `NotifySignal.focus === "agent"` maps straight onto `data: { url: "/", tab: "agent" }`; the URL
  match above should be a **prefix/origin** match, not `===`, or a client sitting on any other route
  will fail to match and you will open a duplicate window.
- Prefer **`focus()` + `postMessage`** over `openWindow` when a client exists: it preserves the SSE
  stream and the chat state, and it lets the page do the same `setUI({tab:"agent"})` the foreground
  path already does — one router, not two.
- `openWindow` throws `InvalidAccessError` *"if none of the windows in the app's origin have
  transient activation"* **[V]** MDN — a notification click supplies it, so this only bites if you
  call it from `push`.
- **Installed-PWA behaviour:** *"In Chrome for Android, the method may open the URL in an existing
  browsing context provided by a standalone web app previously added to the user's home screen. This
  also works on Chrome for Windows."* **[V]** MDN. It is a **may**, and there is no way to request
  it: w3c/ServiceWorker#720 — *"there is no hint about whether the window should be opened in the
  browser or as a standalone window"* — is still the state of the art. **[R]** Reports of push taps
  opening a browser tab instead of the installed app are common (firebase-js-sdk#2438,
  PWABuilder#4777) **[R]**, and Firefox has its own open bug for exactly this on Android PWAs
  (Bugzilla **1880000**, *"Unable to open PWA application by clicking PWA web page notification"*)
  **[R]**. **Design so a browser-tab landing is acceptable**, and always try `focus()` first.

### 4.3 `pushsubscriptionchange` — do not build on it

| Browser | Support | Conf |
|---|---|---|
| Chrome / Chrome Android | **138** (2025) | **[V]** MDN BCD `api/ServiceWorkerGlobalScope.json@main` |
| Firefox | 44, **partial** | **[V]** BCD |
| Firefox Android | 48, **partial** | **[V]** BCD |
| Safari (macOS) | 16 | **[V]** BCD |
| Safari iOS | **not supported** | **[V]** BCD |
| Edge | 17–79 (removed) | **[V]** BCD |

Two traps in one table:

1. **Chrome only shipped it in 138**, and even then narrowly: it *"fires the `pushsubscriptionchange`
   event … when an origin for which a push subscription existed in the past, but which was revoked
   because of a permission change … is re-granted notification permission. The event will be fired
   with an **empty** `oldSubscription` and `newSubscription`."* **[R]** (Chrome 138 release notes /
   blink-dev Intent to Ship). For a decade before that, Chrome fired nothing.
2. **Firefox's implementation has neither property** — BCD, verbatim: *"The event does not have the
   `oldSubscription` and `newSubscription` properties. See bug 1497429."* **[V]** Which means
   **MDN's own example for this event throws on Firefox**, because it does
   `self.registration.pushManager.subscribe(event.oldSubscription.options)` **[V]**.

**Conclusion:** treat `pushsubscriptionchange` as a **best-effort bonus**, guarded
(`event.oldSubscription?.options ?? { userVisibleOnly: true, applicationServerKey: <ours> }`). The
**load-bearing** mechanism must be **re-sync on app load** (§5).

---

## 5. Client-side subscription lifecycle

**Order: permission first, then subscribe.** `subscribe()` triggers the permission prompt if it has
not been granted, but both browsers now require a user gesture — *"From Firefox 72 onwards, can only
be called in response to a user gesture such as a `click` event"* and *"From Firefox Android 79
onwards …"* **[V]** BCD; MDN adds *"going forward browsers will explicitly disallow notifications not
triggered in response to a user gesture."* **[V]** Our Conf master switch already calls
`Notification.requestPermission()` on the enable tap **[V]** — the `subscribe()` call belongs in that
same handler, immediately after a `granted` result, so it inherits the same gesture.

**`applicationServerKey`.** MDN documents *"A Base64-encoded string or `ArrayBuffer`"* **[V]**, and
BCD notes for Chrome *"The `options` parameter with a `applicationServerKey` value is required."*
**[V]** The string form is newer and support is uneven enough that the **base64url → `Uint8Array`
conversion is still the portable choice** — py-vapid's README still says *"some User Agents may
require you to decode this string into a Uint8Array"* **[V]**. Do the conversion; it is six lines and
removes a whole class of platform bug.

**Rot and the standard defense.** Subscriptions die silently: the push service expires them, the OS
clears app data, the user revokes permission, a WebAPK is reinstalled. The browser knows; our server
does not, and (§4.3) the event that was supposed to tell us is unreliable. So on **every app load**
(and after the SW takes control):

1. `reg.pushManager.getSubscription()`;
2. `null` → if the master toggle is on and permission is `granted`, re-`subscribe()` and POST it;
3. non-null and its `endpoint` **differs** from the one we last POSTed (persist the last endpoint in
   `localStorage`) → POST the new one **and** ask the server to delete the old;
4. non-null and identical → optionally POST anyway; the server upsert is idempotent by endpoint, and
   it doubles as a liveness touch.

Also compare `applicationServerKey`: if the server's VAPID public key has changed, the existing
subscription is bound to the old key and will 403 forever — the client must `unsubscribe()` and
re-subscribe. Exposing the current `applicationServerKey` on the subscribe endpoint's GET makes this
a one-line check.

**Unsubscribe ordering.** On disable: `await subscription.unsubscribe()` **then** DELETE on the
server, and DELETE even if `unsubscribe()` rejected. Server-first risks a browser that stays
subscribed while the server has forgotten the row (harmless but untidy); browser-first with a failed
server call leaves a row that will be pruned by its next 404/410 anyway. Both orders are recoverable
— what is **not** recoverable is skipping the server DELETE entirely and relying on 410s, because the
endpoint stays alive for a while after `unsubscribe()`.

**Multi-device falls out for free**: one row per `endpoint`, upserted. Two phones and a laptop = three
rows, no user table, no device registry. The only thing worth adding is a human label
(`navigator.userAgent`-derived, or owner-typed) so the Conf tab can list "which devices are
subscribed" and offer per-row revoke.

---

## 6. Android delivery reality

### 6a. Chrome Android

- Transport is FCM; the endpoint in the subscription is an `fcm.googleapis.com` URL and plain VAPID
  suffices — Google's *own* FCM JS docs never document the raw Web Push endpoint or its error codes
  **[V]** (fetched `firebase.google.com/docs/cloud-messaging/js/client`), which is why every practical
  reference here is the RFC or a push vendor.
- **Install form matters.** A Chrome install that produces a **WebAPK** (a real, minted Android
  package, requiring a valid manifest + icons + `display: standalone` — all of which our
  `vite.config.ts` manifest already satisfies **[V]**) gets its own app entry, its own notification
  channel, and its own task. A legacy "shortcut" install does not. **[R]**
- **Doze.** Normal-priority FCM messages are deferred to maintenance windows when the device is
  dozing; high-priority messages *"allow FCM to wake a sleeping device when necessary"*. **[R]**
  (Firebase message-priority docs; corroborated by Firebase's 2025-04 "Ensure your FCM notifications
  reach your users on Android" post.)
- **`Urgency: high` is the lever** — the RFC's own "low battery / time-sensitive alert" row (§2.2).
  The precise mapping from the RFC 8030 `Urgency` header onto FCM's `priority` field is **[U]**: I
  found no primary Google/Chromium document stating it. Send `Urgency: high` for `agent_input`
  regardless — it is correct per RFC 8030 whether or not FCM honours it as `high` priority.
- Battery-optimisation exemption for Chrome (or the WebAPK) is a **device setting**, not something
  the server can influence; on aggressive OEM skins it is the difference between seconds and the
  next maintenance window. **[R]**

### 6b. Firefox Android / Fennec — the load-bearing part

**The architecture.** Firefox Android does **not** hold its own persistent socket for push on the
device; Mozilla's autopush **bridges** to the platform pusher. Autopush's own docs define a "Push
Service Bridge HTTP Interface" whose *"Allowed bridges are `gcm` (Google Cloud Messaging), `fcm`
(Firebase Cloud Messaging), and `apns`"* **[V]**, and the browser's push component README says the
implementation is *"a bridge between a mobile or desktop client and server app"* over AutoPush, with
*"a supported push service for providing the encrypted messages (for example, Firebase Cloud
Messaging via `lib-push-firebase`)"* **[V]**
(`mobile/android/android-components/components/feature/push/README.md`).

⇒ **Official Firefox for Android web push depends on Google Play Services / FCM**, exactly like
Chrome. The tailnet buys us nothing here; the phone must be able to reach FCM.

**And that is the trap for a de-Googled build.** "Fennec" in the F-Droid sense (relan's
`fennecbuild`, and its relatives IronFox / Mull) strips Firebase, so the FCM bridge cannot register
and web push has historically **not worked at all** on those builds. relan carries downstream
patches adding **UnifiedPush** as the transport instead — MR
[`relan/fennecbuild!78`](https://gitlab.com/relan/fennecbuild/-/merge_requests/78), opened
2025-04-08, *"Add UnifiedPush support - patchs D243458-D243461"*, which closes that project's issues
#80 (WebPush fails on Android 14) and #24 (WebPush with MicroG). Its instructions are explicit:
you must *"install a **distributor** first (this is the application that handles push subscriptions
for other apps)"*. **[V]** Mozilla itself declined the feature upstream: Bugzilla **1802846**
"UnifiedPush support" is **RESOLVED / WONTFIX** (last changed 2026-01-05). **[V]** (Bugzilla REST API)

So on a de-Googled Fennec the delivery chain is: our server → Mozilla autopush → **UnifiedPush
distributor app on the phone** (ntfy, Sunup, …) → Fennec → service worker. **No distributor
installed and enabled ⇒ no push, ever, silently.** And the transport has its own known hole:
[`relan/fennecbuild#163`](https://gitlab.com/relan/fennecbuild/-/issues/163) — *"UnifiedPush doesn't
work in the background"*, **open**, reporting *"notifications work if I don't swipe off the browser
only. If I swipe it, I don't have notifications any more"*, with the missed notifications appearing
only on reopening the app. **[V]**

**The candidate explanation for our shipped channel-1 failure.** Bugzilla **1807379**, *"Web
notifications are not displayed"*, Product: Firefox for Android, Component: Push — **status NEW,
never resolved**, created 2022-12-23, last touched 2024-03-29. **[V]** (Bugzilla REST API) Its
reporter's symptom is ours verbatim: *"Whenever I try to display push on Android — I get nothing"*
despite `registration.showNotification()` **returning a fulfilled promise**. **[V]** It is the
Bugzilla continuation of `mozilla-mobile/fenix#19152` (opened 2021-04-20, closed 2022-12-23 only by
being **moved** to Bugzilla, 20 comments). **[V]** (GitHub API)

The most actionable comment in that thread is from a Mozilla engineer (jonalmeida, 2021-06-08): the
notifications lacked **"heads up"** treatment — they land in the drawer without alerting — and he
directed the reporter to **Android's per-channel notification settings for Firefox's "Site
notifications" channel**. **[R]** (thread summary; I did not read the raw comment JSON.)

That yields a **concrete, cheap first diagnostic before writing any Web Push code**:
Android Settings → Apps → Fennec → Notifications → **"Site notifications"** channel → is it enabled,
and is its importance high enough to alert? A silently-delivered notification sitting in the drawer
looks identical to "nothing delivered" if you are watching for a heads-up banner.

**Does a real push-event-driven notification behave differently from our page-context call?** No
primary source says the two paths differ in *display*; both end at
`ServiceWorkerRegistration.showNotification` and the same Android channel. What genuinely differs is
**what is alive to call it**: our channel 1 needs the page (and its SSE stream) to still be running
when the event arrives, and a backgrounded Android tab is subject to freezing/throttling
independent of any Firefox notification bug. Channel 2 does not — FCM/UnifiedPush wakes the worker.
So Web Push is still the right fix, but **if bug 1807379 or the channel setting is the actual cause,
Web Push will fail identically**, because it terminates in the same `showNotification()` call.
**Verify the notification channel before building.**

### 6c. iOS / Safari — one paragraph

Safari supports the Push API from **16** (macOS Ventura) and **iOS 16.4**, but on iOS **only for a
web app the user has added to the Home Screen** — BCD, verbatim: *"Notifications are supported in web
apps saved to the home screen."* **[V]** Permission requires an explicit user gesture, and
`pushsubscriptionchange` is **not supported on iOS at all** **[V]**, so the §5 re-sync-on-load
defense is not optional there. Standard VAPID + `aes128gcm` works; Apple's push service is the
endpoint. Not our platform — noted only so the implementation does not accidentally assume two push
services.

---

## 7. Right-sizing for one user

**Skip, correctly:**

- **No broker / task queue / outbox.** 1–3 endpoints × a handful of events per hour. A
  `asyncio.create_task` (or the existing background-task pattern) with a per-send `httpx` timeout is
  the whole scheduler. A durable queue would add a failure mode (the queue) to protect against a
  failure (a missed notification) we already accept — the app is the recovery path.
- **No `users` table.** One row per **device endpoint**, no owner column.
- **No delivery receipts / analytics.** RFC 8030 receipts are optional and Mozilla does not implement
  them: *"Autopush cannot support the Push Message Receipt at this time"*. **[V]**
- **Minimal retry** — §2.3.
- **No per-device preferences.** The existing `NotificationsCfg.events` is a single global object;
  keep it that way (and if per-device ever arrives, it is an **optional field on the subscription
  row**, per the owner's extend-don't-migrate directive — not a parallel map).

**Lean-but-correct schema** (one SQLite table; `endpoint` is the natural key, which is what makes
re-subscribe idempotent and multi-device free):

| Column | Type | Why |
|---|---|---|
| `endpoint` | TEXT **PRIMARY KEY** | the push resource URL; unique per device+origin; upsert target |
| `p256dh` | TEXT NOT NULL | subscription public key (base64url) |
| `auth` | TEXT NOT NULL | auth secret (base64url) |
| `label` | TEXT NULL | human name for the Conf list ("pixel / fennec") |
| `created_at` | TEXT/INTEGER | provenance |
| `last_ok_at` | TEXT/INTEGER NULL | last 201 — lets the Conf tab show "last delivered" |
| `last_error` | TEXT NULL | last non-201 status + short reason, for the Conf tab |
| `expiration_time` | INTEGER NULL | `PushSubscription.expirationTime`; almost always null, cheap to keep |

**Minimal backend surface** (four routes, sitting under the existing notifications config seam):

- `GET  /api/notifications/push` → `{ vapid_public_key, subscriptions: [{endpoint_hash, label, last_ok_at, last_error}] }` — the Conf tab needs it, and the client needs the key to compare (§5).
- `POST /api/notifications/push/subscribe` → upsert by endpoint.
- `DELETE /api/notifications/push/subscribe` → by endpoint (body or hash).
- `POST /api/notifications/push/test` → send one push to all rows and return per-row status.
  **Not optional for us**: given §6b, a "send test push" button is the only way the owner can tell a
  server bug from a Fennec/UnifiedPush/channel problem, and it is ~10 lines.

**Where "lean" becomes "broken":**

1. **Not pruning 404/410 is a bug, not a simplification.** Dead endpoints accumulate forever, every
   send burns a request and a timeout against them, and once you have a stale row plus a fresh row
   for the same physical device you cannot tell which is live. The prune is one `DELETE` inside the
   existing error branch.
2. **Keying rows by anything but `endpoint`** (a device id, a row id, an insertion counter) turns
   every re-subscribe into a duplicate row and every notification into two buzzes.
3. **Regenerating VAPID keys casually.** The keypair is bound into every existing subscription
   (`applicationServerKey`); rotating it makes all of them permanently undeliverable with a 403 and
   **no client-visible error**. The key file must be created once, persisted with the same fd-0600
   write-replace discipline as other secrets, backed up with the config, and never regenerated
   implicitly (e.g. by an install script that "ensures" it exists in a fresh `$CTRLB_HOME`).
4. **Sending inline in the request/SSE path.** One unreachable push service stalls a turn.
5. **Skipping `event.waitUntil()` in the `push` handler** — §4.1; costs you Chrome's fallback
   notification and can drop the notification entirely.
6. **Letting channel 1 and channel 2 both fire.** Two engines, one event: use the **same string** for
   the Notification `tag` (already `NotifySignal.key`) in both paths so the OS collapses them, and
   gate the server-side sender on the same `notifications.enabled` + `events.<cls>` config the client
   reads. The prefs already live server-side in `NotificationsCfg` **[V]**, so this costs nothing.

---

## 8. Corrections to premises

- **ROADMAP F1 primer, "server→FCM is outbound":** true for Chrome, and true for **official**
  Firefox Android — but our ROADMAP treats Firefox as a non-FCM path. It is not: Mozilla autopush
  *bridges to FCM* for Firefox Android **[V]** (§6b). The FCM dependency is a property of **Android**,
  not of Chrome.
- **ROADMAP F1, "delivers even when the phone is off the tailnet — the main edge over self-hosted
  ntfy":** correct in principle, but on a **de-Googled Fennec** the transport is UnifiedPush, whose
  usual distributor is… **ntfy**. On that build Web Push does not beat ntfy on reachability; it
  *rides on* it, and inherits an open "doesn't work in the background" bug **[V]**. This materially
  weakens the case for channel 2 over channel 3 **if** the owner's Fennec is the F-Droid build. It
  does not weaken it at all if the owner runs Mozilla's official build.
- **ROADMAP F1 device-round note, "prime suspects: the Fennec SW-registration `showNotification`
  path, or Android page throttling":** the first suspect now has a name and a live Mozilla bug —
  **Bugzilla 1807379, status NEW** — plus a cheaper prior suspect nobody listed: the **Android "Site
  notifications" channel importance** (§6b). Also: switching to Web Push does **not** route around
  this, because both paths end in the same `showNotification()`.
- **`useForegroundNotifications.ts` comment, "a real handler is part of the Web Push channel, where a
  custom worker is required anyway":** confirmed correct **[V]** — §3.1 shows `injectManifest` is the
  only way to own `notificationclick`, and §3.2 shows the migration is ~8 lines of SW plus a config
  key move.
- **`SwUpdatePrompt.tsx`:** its `onNeedRefresh` path cannot fire under `registerType: "autoUpdate"`
  **[V]** (§3.5). Unrelated to F1; recorded so it is not "discovered" a third time.
- **The internet's top Web Push tutorial (web.dev's "Web Push Protocol" article) is stale**: it
  documents `Content-Encoding: aesgcm`, an `Encryption: salt=…` header, and
  `Authorization: WebPush <jwt>` **[V]**. All three are superseded — RFC 8291 §4 says `aes128gcm` is
  the *only* permitted encoding, and RFC 8292 defines the single `Authorization: vapid t=…, k=…`
  header. Its 404/410 advice is still right.

---

## 9. Implications for ctrl-b

*(short and separate — evidence ages slowly, our reading ages fast; 2026-07-31)*

1. **Diagnose before building.** Check the Android **"Site notifications"** channel on the owner's
   Fennec, and establish **which Fennec** it is (Mozilla official vs F-Droid/relan). That single fact
   decides whether channel 2 is a clean win (official build → FCM, works like Chrome) or a
   UnifiedPush-dependent path with an open background bug (F-Droid build). Cheap, and it may explain
   the channel-1 mystery outright.
2. **Library:** pin `webpush==1.0.6` (+3 packages) and POST with the existing `httpx`, rather than
   `pywebpush` (+10, incl. a second async HTTP stack and an sdist-only `http-ece`). Keep the
   roll-our-own option (+0 packages, ~65 lines) in the back pocket.
3. **Config seam:** `NotificationsCfg.web_push: WebPushCfg` as an optional field — exactly as the
   docstring already predicts **[V]** — holding `enabled`, `subject` (the VAPID `sub` contact), and
   the **path** to the key PEM. The PEM itself never enters `config.yaml`; it is written fd-0600
   write-replace like the other secrets. Subscriptions live in **SQLite**, not YAML.
4. **Frontend:** `strategies: "injectManifest"` + `src/sw.ts`, keeping `registerType: "autoUpdate"`
   and hand-writing `self.skipWaiting()` + `clientsClaim()`; move `navigateFallbackDenylist` from
   `workbox` to `injectManifest` or it silently stops applying; add a **separate
   `tsconfig.worker.json`** rather than merging `WebWorker` into the app's DOM lib.
5. **One policy chokepoint, still.** The server-side sender must read the same
   `notifications.enabled` + `events.<cls>` prefs, emit the same **`tag` = `NotifySignal.key`**, and
   carry `focus`/route in `notification.data` — so the SW's `notificationclick` calls the same
   `setUI({tab:"agent"})` the foreground path does. Two delivery transports, one policy, one router.
6. **Ship a "send test push" button with the first slice.** Given §6b it is the difference between
   debugging and guessing.

---

## 10. What I could not determine

- **The exact mapping from RFC 8030 `Urgency` to FCM message priority.** No primary Google/Chromium
  document found. (Sending `Urgency: high` is correct per RFC regardless.)
- **Chrome's precise tolerance** for pushes that show no notification before the *"This site has been
  updated in the background"* fallback appears. Secondary sources say "around 10"; the Budget API
  that would have made it queryable never shipped as a stable surface.
- **Firefox's behaviour when a push shows no notification** — no primary statement found either way
  (Chrome's fallback is well documented; Firefox's is not).
- **Whether Bugzilla 1807379 still reproduces on 2026 Firefox Android.** The bug is open (NEW) but
  its last activity is 2024-03-29; it may be stale, or under-reported. Only an on-device test
  settles it.
- **Which Fennec version shipped the UnifiedPush patch.** MR !78 was opened 2025-04-08 and
  UnifiedPush's own announcement said "next release"; an issue exists against 149.0. Exact
  first-shipping version not pinned.
- **Whether the owner's Fennec is Mozilla's official build or the F-Droid/relan build**, and whether
  a UnifiedPush distributor is installed. This is the single highest-value unknown in the dossier.
- **Whether Chrome's WebAPK vs shortcut install materially changes push *delivery*** (as opposed to
  where the notification is attributed and where taps land). Only secondary sources found.
- **`includeUncontrolled: true` necessity** in `clients.matchAll` for the notification-click case —
  standard practice, not stated in the primary docs I read.

---

### Source index

Specs: [RFC 8030](https://www.rfc-editor.org/rfc/rfc8030.txt) ·
[RFC 8291](https://www.rfc-editor.org/rfc/rfc8291.txt) ·
[RFC 8292](https://www.rfc-editor.org/rfc/rfc8292.txt) ·
[W3C Push API](https://www.w3.org/TR/push-api/)
Libraries: [pywebpush](https://github.com/web-push-libs/pywebpush) ·
[py-vapid](https://github.com/web-push-libs/vapid) ·
[webpush-py](https://github.com/delvinru/webpush-py) · PyPI JSON API for all three
Browser docs: MDN [`PushManager.subscribe`](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe) ·
[`Clients.openWindow`](https://developer.mozilla.org/en-US/docs/Web/API/Clients/openWindow) ·
[`notificationclick`](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/notificationclick_event) ·
[`pushsubscriptionchange`](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/pushsubscriptionchange_event) ·
[MDN browser-compat-data@main](https://github.com/mdn/browser-compat-data)
Push services: [autopush-rs HTTP docs](https://mozilla-services.github.io/autopush-rs/http.html) ·
[web.dev Web Push Protocol](https://web.dev/articles/push-notifications-web-push-protocol) (stale on encoding) ·
[web.dev notification patterns](https://web.dev/articles/push-notifications-common-notification-patterns)
Trackers: [Bugzilla 1807379](https://bugzilla.mozilla.org/show_bug.cgi?id=1807379) ·
[Bugzilla 1802846](https://bugzilla.mozilla.org/show_bug.cgi?id=1802846) ·
[Bugzilla 1880000](https://bugzilla.mozilla.org/show_bug.cgi?id=1880000) ·
[fenix#19152](https://github.com/mozilla-mobile/fenix/issues/19152) ·
[relan/fennecbuild!78](https://gitlab.com/relan/fennecbuild/-/merge_requests/78) ·
[relan/fennecbuild#163](https://gitlab.com/relan/fennecbuild/-/issues/163) ·
[w3c/ServiceWorker#720](https://github.com/w3c/ServiceWorker/issues/720)
Tooling: [vite-pwa injectManifest](https://vite-pwa-org.netlify.app/guide/inject-manifest.html) ·
[auto-update](https://vite-pwa-org.netlify.app/guide/auto-update.html) ·
[development](https://vite-pwa-org.netlify.app/guide/development.html) ·
installed `vite-plugin-pwa@1.3.0` source in `frontend/node_modules`
