# R45 — Notification tap → focus the app and land on the agent tab

**Date:** 2026-08-19 · **Scope:** how to own `notificationclick` in **this** repo's PWA (vite-plugin-pwa
`generateSW` + `registerType:"prompt"`), so that tapping an F1 notification on Android focuses the live
page and routes it to the agent tab. **Lane:** the Service Worker + Notifications specs, workbox-build
and vite-plugin-pwa **installed source**, MDN/BCD, browser trackers, plus two in-class peers
(LibreChat, Mastodon) read at HEAD. Local experiments: workbox-build `generateSW` run standalone
against the repo's own `node_modules`; HTTP header probes against the **live prod instance**.

**Drives:** the F1 channel-1 close-out ("the tap does nothing on Android"). Not yet cited by a D-entry.

**Assumed known, not re-derived:** why the constructor path throws on Android (R10 §6, and the
`useForegroundNotifications` header comment); the Web Push stack (R10); the peer Web Push field pass
(R11).

**Confidence key:** **[V]** verified — I read the primary source (spec text, installed source, generated
output, live HTTP response) · **[R]** reported — credible secondary source · **[U]** unverified inference.

---

## 0. TL;DR + recommendation

**Recommendation: `workbox.importScripts` under the CURRENT `generateSW` build. Do not migrate to
`injectManifest` for this.**

The one-line reason: `importScripts` is workbox's *documented* mechanism for exactly this addition
("This is useful when you want to let Workbox create your top-level service worker file, but want to
include some additional code, such as a push event listener" **[V]**), it is **in-class peer practice**
(LibreChat ships a 60-line `sw-heal.js` this way at HEAD **[V]**), and it leaves the proven
`registerType:"prompt"` update path — the toast → `SKIP_WAITING` → `controllerchange` → reload chain
that shipped in v1.7.2 — **byte-identical**. `injectManifest` would make us hand-reproduce that chain
plus five workbox modules, for a handler that is ~35 lines.

The six findings that decide it:

1. **`generateSW`'s `importScripts` is a plain pass-through and lands the call in the same execution
   position as the SKIP_WAITING listener we already depend on.** Generated verbatim (local
   `generateSW` run, §1.2) **[V]**:
   ```js
   define(['./workbox-f0c192c2'], (function (workbox) { 'use strict';
     importScripts("/notify-sw.js");
     self.addEventListener('message', event => { … SKIP_WAITING … });
   ```
   Same factory, one line earlier. `importScripts()` is synchronous, so a top-level
   `self.addEventListener("notificationclick", …)` in the imported file is registered **before** the
   listener whose delivery the released update toast already proves works.
2. **The spec's listener-ordering rule is real but is satisfied here.** `Fire Functional Event` runs
   `Should Skip Event`, and the "set of event types to handle" is snapshotted **once**, right after
   `running the classic script` returns — which includes HTML's microtask checkpoint, i.e. after
   workbox's `define()` factory has run (§1.3) **[V]**. And the skip is a **MAY**, not a MUST.
   `ServiceWorker.postMessage()` is gated by the *same* algorithm **[V]** — so our working update
   toast is a live proof of the position.
3. **The real hazard is HTTP caching of the imported file, and we measured it.** Under the default
   `updateViaCache: "imports"` **[V]** the import fetch uses the ordinary HTTP cache, and our prod
   server sends **`last-modified` + `etag` and no `Cache-Control` at all** for every `dist/` file
   (probed on :5433 and over the Tailscale HTTPS origin, 2026-08-19) **[V]** — which is precisely the
   shape RFC 9111 §4.2.2 lets a cache heuristically freshen ("no more than some fraction of the
   interval since that time … A typical setting of this fraction might be 10%") **[V]**. Fix: put a
   build-time **content hash in the import URL** (~6 lines in `vite.config.ts`). §2.
4. **The design degrades correctly on Firefox Android, where the platform is broken.** Bugzilla
   **1880000 is still NEW** — a notification tap does not foreground the installed PWA and
   `client.focus()` does not bring it to front **[R]**. But `focus()` and `postMessage()` are
   independent: the postMessage still lands, the page still switches to the agent tab, so when the
   user does reach the app they arrive where they were sent. **Route via postMessage; treat `focus()`
   as best-effort.** §3.
5. **`clients.openWindow("/")` is not enough as a fallback** — `tab` is persisted in `ctrlb.ui`
   (`setUI` saves the whole state **[V]**), so a cold window restores the *last used* tab. The
   fallback needs a URL signal (`/?tab=agent`) and a ~8-line reader. §4.
6. **The premise that owning `notificationclick` requires a custom worker is FALSE** — it is stated
   in `useForegroundNotifications.ts` and implied by R10 §3/§9.4. Correcting it is most of this
   dossier's value: it removes the "wait for Web Push" blocker from a slice that is ~150 lines. §7.

Estimated diff, honestly: **~150–170 net new lines across 5 files + 1 new test file**, no new
dependencies, no change to the update path. The `injectManifest` alternative is **~300–400 lines, 5–6
new devDependencies, a second tsconfig project, and a rewrite of the shipped update mechanism** (§5).

---

## 1. `generateSW` + `importScripts` — exact semantics

### 1.1 The pass-through, in installed source

`vite-plugin-pwa@1.3.0` (`node_modules/vite-plugin-pwa/dist/index.js` L~857) **[V]**:

```js
const workbox = Object.assign({}, defaultWorkbox, options.workbox || {});
```

with

```js
const defaultWorkbox = {
  swDest, globDirectory: outDirRoot, offlineGoogleAnalytics: false,
  cleanupOutdatedCaches: true, dontCacheBustURLsMatching, mode,
  navigateFallback: "index.html",
};
```

So **every** `workbox-build` `GenerateSWOptions` key set in `vite.config.ts` reaches `generateSW`
verbatim; `importScripts` needs no plugin support and no plugin version floor. (It also means our
`vite.config.ts` is already relying on four plugin defaults it never states —
`cleanupOutdatedCaches: true`, `navigateFallback: "index.html"`,
`dontCacheBustURLsMatching: /^assets\//`, `offlineGoogleAnalytics: false`. Relevant to §5.)

`workbox-build@7.4.1` declares it **[V]** (`build/types.d.ts` L225-230, verbatim):

> A list of JavaScript files that should be passed to
> [`importScripts()`](https://developer.mozilla.org/en-US/docs/Web/API/WorkerGlobalScope/importScripts)
> inside the generated service worker file. This is useful when you want to let Workbox create your
> top-level service worker file, but want to include some additional code, such as a push event
> listener.

The Chrome for Developers workbox-build page carries the identical text **[V]**
(<https://developer.chrome.com/docs/workbox/modules/workbox-build>). *Adding a push/notification
listener is the option's own documented use case.*

The template (`workbox-build/build/templates/sw-template.js` L23-26) **[V]**:

```
<% if (importScripts) { %>
importScripts(
  <%= importScripts.map(JSON.stringify).join(',\n  ') %>
);
<% } %>
```

— i.e. the strings are emitted **verbatim**, first, before `skipWaiting`/the SKIP_WAITING listener,
before `precacheAndRoute`, before the routes. No URL rewriting, no existence check, no revisioning.

### 1.2 What actually gets emitted (local experiment)

Run against the repo's own `node_modules/workbox-build` with our real option shape (2026-08-19) **[V]**:

```js
define(['./workbox-f0c192c2'], (function (workbox) { 'use strict';

  importScripts("/notify-sw.js");
  self.addEventListener('message', event => {
    if (event.data && event.data.type === 'SKIP_WAITING') { self.skipWaiting(); }
  });

  workbox.precacheAndRoute([{ "url": "app.js", "revision": "6cd2373…" }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(
    workbox.createHandlerBoundToURL("index.html"), { denylist: [/^\/api\//] }));
}));
```

Two things follow:

- **The imported call is inside the AMD factory**, not at file top level. That is a consequence of
  `inlineWorkboxRuntime: false` (workbox's default; our real `dist/sw.js` shows the same `define([…])`
  shim **[V]**). The factory body runs in a **microtask** (`Promise.all(deps).then(factory)`), which
  is why §1.3 matters.
- If you want the call at literal top level, `inlineWorkboxRuntime: true` produces a single 3,390-line
  worker with `importScripts("/notify-sw.js")` at column 0 **[V]** (verified by re-running with that
  flag). **Not recommended** — it inlines the whole workbox runtime into every SW byte-diff for no
  benefit we need, and §1.3 shows the default position is fine.

### 1.3 Listener-registration ordering — the rule, and why the default position satisfies it

The rule exists. Service Workers spec, **Should Skip Event** **[V]**:

> Note: To avoid unnecessary delays, this specification permits skipping event dispatch when no event
> listeners for the event have been deterministically added in the service worker's global during the
> very first script execution.
>
> 1. If *serviceWorker*'s **set of event types to handle** does not contain *eventName*, then the user
>    agent **may** return true.

and **Run Service Worker**, immediately after evaluation **[V]**:

> Set *evaluationStatus* to the result of **running the classic script** *script*.
> …
> If *script*'s **has ever been evaluated flag** is unset, then:
>   - For each *eventType* of *settingsObject*'s global object's associated list of event listeners'
>     event types: Append *eventType* to … the **set of event types to handle**.
>   - Set *script*'s has ever been evaluated flag.

Three consequences:

1. The snapshot is taken **after "running the classic script" completes**. HTML's "run a classic
   script" ends with *clean up after running script*, which performs a **microtask checkpoint** when
   the JS stack empties — so workbox's `.then(factory)` body, and everything `importScripts()` pulls
   in synchronously inside it, is registered *before* the snapshot. **[V]** for the spec chain;
   **[U]** that every engine implements the checkpoint boundary identically.
2. The snapshot happens **once ever** ("has ever been evaluated flag"), on the first evaluation
   (install). Later worker starts do not re-derive it.
3. Skipping is a **MAY**. A UA that dispatches anyway is conformant.

**The empirical proof we already own:** `ServiceWorker.postMessage()` explicitly runs the *same*
algorithm — spec §3.1, verbatim **[V]**: *"If the result of running the Should Skip Event algorithm
with "message" and serviceWorker is true, then return."* Our SKIP_WAITING listener sits in that exact
microtask position and the update toast works in production on Chrome and Firefox (v1.7.2, released
and exercised 2026-08-18). `notificationclick` is dispatched through `Fire Functional Event`, which
runs the identical gate **[V]** (Notifications spec §4: *"run Fire Functional Event given name,
NotificationEvent, notification's service worker registration…"*). Same gate, same position, proven
transport.

**Peer corroboration:** LibreChat's `client/sw/heal.js` at HEAD registers `self.addEventListener('message', …)`
and `self.addEventListener('activate', …)` at the top level of a file loaded via
`workbox.importScripts: ['sw-heal.js']`, and its whole purpose is that those listeners fire **[V]**
(read at `main`, 2026-08-19).

### 1.4 Where the file must live, and whether it is precached

- **`public/` is the natural home.** Vite copies `publicDir` verbatim to `dist/` root, so
  `public/notify-sw.js` is served at `/notify-sw.js` and the literal `importScripts("/notify-sw.js")`
  resolves. **[V]** (Vite's documented publicDir behaviour + the repo's existing `public/icon-*.png`
  → `dist/icon-*.png`.)
- **It IS also swept into the precache manifest** by our `globPatterns: ["**/*.{js,css,html}", …]`,
  and — being outside `assets/` — with a **content revision** (`dontCacheBustURLsMatching` is
  `/^assets\//`; the real `dist/sw.js` shows `{url:"icon-192.png",revision:"a851b32…"}` for exactly
  this reason **[V]**). That is a **free and useful** coupling: any byte change to the helper changes
  the revision string inside `sw.js`, so `sw.js` itself changes bytes → a worker update is guaranteed
  without relying on §2's import byte-comparison branch at all. **Recommend NOT adding a `globIgnores`
  entry.** (LibreChat does `globIgnores: [… 'sw-heal.js' …]` **[V]**; their build emits the file via a
  rollup `emitFile` plugin instead of `public/`, and they run `registerType:"autoUpdate"`, so the
  coupling buys them less. The ~1 KB precache cost is real but the entry is never served —
  see below.)
- **The precached copy is never used for the import.** Spec, the importScripts fetch path **[V]**:
  *"Set request's **service-workers mode** to "none"."* A worker cannot intercept its own script
  loads, so the precache entry is dead weight, not a shadowing hazard.
- **The bytes are frozen into the worker at install.** Same algorithm **[V]**: *"If map[url] exists:
  Append url to serviceWorker's set of used scripts. Return map[url]."* — the network fetch happens on
  the **first** evaluation only; every later start of that same worker replays the stored response
  from the script resource map. So (a) no network dependency at runtime, and (b) **a stale import
  fetched at install is stale for that worker's entire life**. Which is §2.

---

## 2. Update semantics for the imported script + the header discipline we need

### 2.1 What the spec does

`updateViaCache` defaults to **`"imports"`** — IDL, verbatim **[V]**:

```
dictionary RegistrationOptions {
  USVString scope;
  WorkerType type = "classic";
  ServiceWorkerUpdateViaCache updateViaCache = "imports";
};
```

MDN's gloss **[V]**: *"'imports' — The HTTP cache will be queried for imports, but the main script will
always be updated from the network."* (vite-plugin-pwa/workbox-window never set it — the register
client calls `wb.register({ immediate })` with no `updateViaCache` **[V]**, so we are on the default.)

**Update algorithm**, the imported-scripts branch, verbatim **[V]**:

> Set *hasUpdatedResources* to true if any of the following are true: … newestWorker's **script
> resource map**[url]'s body is not **byte-for-byte identical** with response's body.
>
> If *hasUpdatedResources* is false and newestWorker's **classic scripts imported flag** is set, then:
> *Note: The following checks to see if an imported script has been updated, since the main script has
> not changed.*
> For each *importUrl* → *storedResponse* of newestWorker's script resource map: … Set *importRequest*'s
> cache mode to "no-cache" if any of the following are true: registration's **update via cache mode is
> "none"**; job's force bypass cache flag is set; **registration is stale**. … If *fetchedResponse*'s
> body is not byte-for-byte identical with *storedResponse*'s … body, set *hasUpdatedResources* to true.

So: **yes**, a byte change to an imported script alone triggers a worker update — that half of the
premise is correct and current in the spec **[V]**. But note the cache-mode condition: under
`updateViaCache:"imports"` the comparison fetch is a **normal HTTP-cache fetch** unless the
registration is *stale* (>24 h since the last update check). Same condition governs the actual
`importScripts()` fetch at install (§1.4).

Engine status: this branch has been in the spec and shipped since the 2018-era "byte-check imported
scripts" change; I did **not** re-verify it against current Chromium/Gecko source or a live probe —
**[U]** for "Chrome 14x and Firefox 15x both implement the import byte-comparison today". **This does
not matter for us**: our `sw.js` changes bytes on every deploy anyway (hashed precache manifest), so
the main-script comparison always fires first and `hasUpdatedResources` is already true. The import
byte-check is belt-and-braces we do not need. What we *do* need is that the **new** worker imports the
**new** bytes.

### 2.2 What our server actually sends — measured

Probed 2026-08-19 against the live prod instance **[V]**:

| URL | `cache-control` | other |
|---|---|---|
| `http://127.0.0.1:5433/sw.js` | **absent** | `last-modified`, `etag` |
| `http://127.0.0.1:5433/icon-192.png` | **absent** | `last-modified`, `etag` |
| `http://127.0.0.1:5433/index.html` | **absent** | `last-modified`, `etag` |
| `http://127.0.0.1:5433/manifest.webmanifest` | **`no-cache`** | strong `etag`, `x-content-type-options` |
| `https://emma.lobster-vector.ts.net/icon-192.png` | **absent** | identical — Tailscale Serve adds nothing |

Cause, in installed source **[V]**: `app.frontend("/", directory=_FRONTEND_DIST, fallback="index.html")`
builds a `fastapi.routing._FrontendStaticFiles(StaticFiles)` (`fastapi/routing.py` L1801-1820), and
Starlette's `FileResponse.set_stat_headers` only does
`self.headers.setdefault("last-modified", …)` / `setdefault("etag", …)` (`starlette/responses.py`
L333-338). **Starlette never sets `Cache-Control`.** The only path that does is our own hand-written
`/manifest.webmanifest` route (`backend/app/main.py` L620-624) — the D59/W5 precedent, added for
exactly this class of problem.

RFC 9111 §4.2.2, verbatim **[V]**:

> Since origin servers do not always provide explicit expiration times, a cache **MAY** assign a
> heuristic expiration time when an explicit time is not specified… If the response has a Last-Modified
> header field, caches are encouraged to use a heuristic expiration value that is **no more than some
> fraction of the interval since that time. A typical setting of this fraction might be 10%.**
>
> *Note:* … origin servers are encouraged to send explicit directives (e.g., `Cache-Control: no-cache`)
> if they wish to prevent caching.

**Therefore: a stale HTTP-cached import CAN pin an old handler.** Concretely: a helper file untouched
for 30 days accumulates ~3 days of heuristic freshness; the deploy that changes it can be served the
month-old copy for up to that window, and §1.4 says those bytes are then frozen into that worker.
`sw.js` itself is immune (main script always bypasses the HTTP cache under `"imports"`), which makes
this failure mode *specific to the imported file* and easy to miss: the app updates, the notification
handler does not.

### 2.3 The header discipline — three options, ranked

1. **Content-hash the import URL (RECOMMENDED).** In `vite.config.ts`, read `public/notify-sw.js` at
   config time, hash it, and pass `importScripts: ["/notify-sw.js?v=" + hash]`. New content ⇒ new URL
   ⇒ guaranteed cache miss ⇒ fresh bytes, regardless of server headers, proxies, or `updateViaCache`.
   ~6 lines, frontend-only, works on any deployment profile. Workbox does no URL validation, so a
   query string passes through untouched **[V]** (§1.1). The old `?v=` entry simply disappears from
   the new worker's map. *(RFC 9111 notes that the old "no heuristics on URIs with query components"
   rule is not widely implemented **[V]** — so the query is a cache-**key** change, not a
   caching-**policy** trick, which is exactly what we want.)*
2. **Serve the path with `Cache-Control: no-cache` from the backend** — a second hand-written route
   ahead of `app.frontend`, mirroring the manifest precedent. Correct, but it puts a frontend build
   artifact's cache policy in the backend, and it does nothing on the Vite dev server.
3. **Do nothing and rely on "registration is stale"** — the >24 h condition forces `no-cache` on the
   import fetch for a PWA that is opened at least a day apart. Real, but conditional on usage
   patterns; not a discipline.

**Not needed:** any change to how the rest of `dist/` is served. The hashed `assets/*` files are
immutable-by-name and `sw.js`/`manifest.webmanifest` are already correct.

---

## 3. `notificationclick` mechanics, and the Android reality

### 3.1 Support

BCD (`mdn/browser-compat-data@main`, fetched 2026-08-19) **[V]**:

| API | Chrome / Chrome Android | Firefox / Firefox Android |
|---|---|---|
| `notificationclick` event | 40 / mirror | 44 / mirror |
| `Clients.matchAll` | 42 / mirror | 54 (44 partial) / mirror |
| `Clients.openWindow` | 40 / mirror | 44 / mirror |
| `WindowClient.focus` | 42 / mirror | 44 / mirror |
| `WindowClient.navigate` | 49 / mirror | 50 / mirror |
| `Notification.data` | 44 / mirror | 34 / mirror |
| **`Notification.navigate`** | **false** | **false** |

Everything we need is available on both Android engines. `Notification.navigate` — see §6.3.

### 3.2 `data` plumbing

`showNotification(title, options)` structured-clones `options.data` onto the notification, and
`NotificationEvent.notification` exposes it in the worker — Notifications spec IDL **[V]**:

```webidl
[Exposed=ServiceWorker] interface NotificationEvent : ExtendableEvent {
  readonly attribute Notification notification;
  readonly attribute DOMString action;
};
```

MDN, verbatim **[V]**: *"The `notificationclick` event is fired **only** when the notification was
created via `ServiceWorkerRegistration.showNotification()`"* — notifications made with the
`Notification()` constructor get a `click` event on the object instead. Which is exactly our two-path
split: the desktop constructor path keeps its `n.onclick`, the Android SW path gets the worker handler.
Both must call the same router (§4.1).

`NotifySignal.focus` maps onto `data: { focus: "agent", key }`. Adding `data` to the shared
`NotificationOptions` object is harmless on the constructor path (it is a valid member there too).

### 3.3 `focus()` + `postMessage()` vs `openWindow()`

- **`clients.matchAll({type:"window", includeUncontrolled:true})`.** `includeUncontrolled` defaults to
  **false** — spec IDL, verbatim **[V]**: `dictionary ClientQueryOptions { boolean includeUncontrolled = false; ClientType type = "window"; };`
  Under `registerType:"prompt"` there is **no `clientsClaim()`** in our worker (§5.1), so the very
  first page load after an install is **uncontrolled** — and a page in that state is exactly a page
  that can be showing notifications. `includeUncontrolled: true` is **load-bearing here, not
  cosmetic** — this closes R10 §10's open "necessity" question for our configuration.
- **`WindowClient.focus()`** — MDN, verbatim **[V]**: *"The promise is rejected with
  `InvalidAccessError` if none of the windows in the app's origin have **transient activation**."* A
  notification click supplies it (MDN's own example calls `focus()` from a `notificationclick`
  handler **[V]**). This is the same constraint R10 recorded for `openWindow`; it only bites if you
  call either from `push`.
- **`clients.openWindow(url)`** — BCD note, verbatim **[V]**: *"Since Chrome 51, URLs may open inside
  an existing browsing context provided by a standalone web app."* **May.** There is still no way to
  request it (w3c/ServiceWorker#720, R10 §4.2 **[R]**), and reports of taps landing in a browser tab
  rather than the installed app are numerous and current (firebase-js-sdk#2438, PWABuilder#4777)
  **[R]**.
- **`WindowClient.navigate()`** — Mastodon's shape (`client.navigate(url).then(c => c.focus())`,
  `app/javascript/mastodon/service_worker/web_push_notifications.js` at `main` **[V]**). **Wrong for
  us:** navigating an existing client *reloads the SPA*, killing the SSE stream, the chat state and
  the in-flight turn — the precise state the user is being summoned back to. Mastodon needs it because
  its target is a URL; ours is a client-side tab switch. **Use `postMessage` instead** — R10 §4.2
  already recommended this and it holds.

### 3.4 Android reality, per engine

**Chrome Android (installed WebAPK and browser tab).** `focus()` on an existing window client is the
supported path and is what the platform's "may open inside an existing browsing context" language is
about; a `matchAll` hit means the app is already running, so no window needs opening. Landing in a
browser tab is possible when `openWindow` runs (no existing client) **[R]**. Design implication:
`openWindow` is the *rare* branch for us (F1 notifications require a live page), so its unreliability
is a small blast radius — but see §4.2.

**Firefox Android (Fennec).** **Bugzilla 1880000 — "Unable to open PWA application by clicking PWA web
page notification" — is still `NEW`** (opened 2024, last activity 4 months ago; duplicates 1796440,
1807430, 1944539) **[R]**. The load-bearing comment for our design: a developer on the Mbin project
reported that their service worker *navigates correctly* but **`client.focus()` does not bring the PWA
window to the front**, and a re-test on Nightly 136.0a1 still showed notification taps opening browser
tabs rather than the PWA **[R]**.

**This is why the routing must not ride on `focus()` succeeding.** `client.postMessage()` is a
separate mechanism with no activation requirement; a rejected `focus()` must not skip it. Ordering:
**postMessage first, then attempt focus, and swallow its rejection.** Then even on the broken engine
the app is on the agent tab the moment the user reaches it by any route.

---

## 4. The page side

### 4.1 Where the listener belongs in OUR code

**Recommendation: inside the existing `useForegroundNotifications` effect. No new file, no new module.**

The reasoning against the alternatives:

- **`lib/notifyBus.ts` — no.** The bus is the *producer→engine* channel and its header explicitly
  scopes it: "a dep-free, React-free emitter between the two live streams that KNOW something happened
  and the one engine that decides whether to raise a browser notification". A SW message is the
  *reverse* direction — an inbound activation, not a signal to be gated. Putting it there would make
  the bus bidirectional for one consumer.
- **A new hook beside `useForegroundNotifications` — no.** It would need the same mount site
  (`AppEngines`), the same `focus` vocabulary, and the same routing call. That is a second gate on the
  same concern, which is the failure mode the file's own header warns about ("a second gate elsewhere
  is exactly how 'I turned notifications off and it still buzzed' happens").
- **`SwUpdatePrompt.tsx` — no.** It owns the *update* half of the SW relationship (`controllerchange`,
  `updateServiceWorker`). Mixing notification routing in would couple two unrelated SW concerns in the
  component the release path depends on.

`useForegroundNotifications` already: owns the `focus` field's meaning, already calls
`setUI({ tab: "agent" })` on the constructor path, already holds the SW-registration plumbing
(`swRegistration()`), and is already mounted exactly once in `AppEngines` (App.tsx:156 **[V]**). The
addition is a `navigator.serviceWorker?.addEventListener("message", …)` in the same `useEffect`, with
the routing extracted into one function both paths call:

```ts
/** The ONE router for a notification activation — called by the constructor path's `onclick` AND by
 *  the service worker's postMessage. */
function applyNotificationFocus(focus: unknown): void {
  if (focus === "agent") setUI({ tab: "agent" });
}
```

**Gotcha to encode [V]:** with `addEventListener("message")` (as opposed to assigning `onmessage`),
messages sent by `Client.postMessage()` **stay queued until `DOMContentLoaded` or an explicit
`navigator.serviceWorker.startMessages()` call** — MDN, verbatim: *"all messages sent from a page's
controlling service worker to the page … are queued while the page is loading, and get dispatched once
the page's HTML document has been loaded and parsed … The messages start being sent automatically when
setting the handler directly using `onmessage`."* React mounts after `DOMContentLoaded`, so this
cannot bite today — but a one-line `startMessages()` beside the listener is free insurance and
documents the constraint. *(`SwUpdatePrompt` is unaffected: it listens for `controllerchange`, not
`message`.)*

### 4.2 The `openWindow` fallback URL — the app has no URL→tab routing

`store/ui.ts` persists the **whole** UI state including `tab` (`setUI` → `savePersisted(KEY, {...state, v})`
**[V]**; `DEFAULTS.tab = "fleet"`). So `openWindow("/")` on a cold start lands on **whatever tab the
owner last used** — fleet, most likely. The fallback silently fails its one job.

Three shapes, compared:

| | Cost | Correct on cold open | Notes |
|---|---|---|---|
| **postMessage only, `openWindow("/")` fallback** | 0 | ✗ | Fine 95% of the time (F1 needs a live page), wrong exactly when the page died |
| **`?tab=agent` + a boot reader** | ~8 lines + 1 test | ✓ | Consumes and strips the param at boot, then `setUI` |
| **`#agent`** | same | ✓ | Hash is client-only (never hits the server) but collides with any future anchor use, and Workbox's `ignoreURLParametersMatching` machinery is query-shaped, not hash-shaped |

**Recommend `?tab=agent`**, read once at boot next to the store's existing hydration, then
`history.replaceState` the param away so a reload/share does not re-force the tab. Query over hash
because the SPA has no hash router and never will need one for a 4-tab enum; and because
`navigateFallback` already answers any path with the shell, so `/?tab=agent` needs no server change.
*(One caution: workbox's precache lookup strips `utm_*`/`fbclid` by default via
`ignoreURLParametersMatching` **[V]**; an unknown `?tab=` param on a **navigation** request is handled
by the `NavigationRoute` → `createHandlerBoundToURL("index.html")`, which ignores the query entirely,
so the shell is still served from precache. No config change needed — worth a test pin.)*

This is genuinely net-new surface (the app has no URL state today), so it is the one place where the
slice could be split: **ship postMessage-only first, add `?tab=` if the cold-open case ever bites.**
I would ship both — it is 8 lines and the alternative is a fallback that is knowingly wrong.

### 4.3 Peers

- **LibreChat** — ships a PWA, no notifications at all; but its `importScripts` extension mode is the
  authoring precedent (§1.3) **[V]**.
- **open-webui** — no Web Push, no custom SW at the paths I checked (`static/sw.js`,
  `src/lib/workers/sw.js` both 404 at `main`) **[V]**; R11 already recorded it uses webhooks and a
  cross-tab leader election for foreground notifications, not a worker.
- **Mastodon** (out of class, best-known implementation) — `openUrl()` = `matchAll({type:'window'})` →
  `findBestClient` → `client.navigate(url).then(c => c.focus())`, else `clients.openWindow(url)`;
  `handleNotificationClick` wraps it all in `event.waitUntil()` and calls `notification.close()` first
  **[V]**. Note it does **not** pass `includeUncontrolled` — it can afford to, because it runs
  `clientsClaim`.

**Negative finding:** no in-class peer routes a notification tap to an in-app view via `postMessage`.
The pattern is standard on the wider web but the reference class simply does not implement notification
clicks. We are not diverging from peers; we are ahead of them on a surface they skipped.

---

## 5. The `injectManifest` alternative, priced against TODAY's repo

R10 §3.2 priced this against `registerType: "autoUpdate"`. **We now run `"prompt"`, which changes the
bill** — the two SW-side calls R10 said we'd have to hand-write (`self.skipWaiting()` + `clientsClaim()`)
are *not* what prompt mode needs; prompt mode needs a **message handshake** instead.

### 5.1 What the prompt-mode generated worker actually contains

From the template (`sw-template.js`) and confirmed against the live `dist/sw.js` **[V]**:

```js
// prompt mode = `skipWaiting` falsy ⇒ the ELSE branch of the template:
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') { self.skipWaiting(); }
});
// no clientsClaim() — `clientsClaim` is only forced on for registerType:"autoUpdate"
workbox.precacheAndRoute([ …41 entries… ], {});
workbox.cleanupOutdatedCaches();
workbox.registerRoute(new workbox.NavigationRoute(
  workbox.createHandlerBoundToURL("index.html"), { denylist: [/^\/api\//] }));
workbox.registerRoute(/\/assets\/[^/]+\.woff2$/, new workbox.CacheFirst({
  cacheName: "ctrlb-fonts",
  plugins: [new workbox.ExpirationPlugin({maxEntries:40, maxAgeSeconds:31536e3}),
            new workbox.CacheableResponsePlugin({statuses:[0,200]})]}), "GET");
workbox.registerRoute(({url, sameOrigin}) => sameOrigin && /^\/api\/media\/[^/]+\/files\//.test(url.pathname),
  new workbox.StaleWhileRevalidate({
  cacheName: "ctrlb-media",
  plugins: [new workbox.ExpirationPlugin({maxEntries:64, maxAgeSeconds:2592e3}),
            new workbox.CacheableResponsePlugin({statuses:[0,200]})]}), "GET");
```

The client half is unchanged by the strategy flip — `registerType` is compiled into the virtual
register module as a string constant independent of `strategies` (R10 §3.1 **[V]**, re-confirmed in
`dist/client/build/register.js` at 1.3.0: `var auto = autoUpdateMode === "true"`, and
`updateServiceWorker` → `wb.messageSkipWaiting()` only when `!auto` **[V]**). So `SwUpdatePrompt`
survives the flip **only if `sw.ts` reproduces the `SKIP_WAITING` message listener verbatim.** Omit it
and the toast's refresh button becomes a silent no-op — a released, owner-visible flow, broken in a way
no unit test in the repo would catch.

### 5.2 The real diff

| File | Change | ~lines |
|---|---|---|
| `frontend/src/sw.ts` | NEW — everything in §5.1 hand-written, plus `notificationclick` | 90–130 (this repo's comment density: closer to 130) |
| `frontend/vite.config.ts` | `strategies`/`srcDir`/`filename`; the whole `workbox:` block moves under `injectManifest:` — and **only `navigateFallbackDenylist`, `globPatterns`, `globIgnores` survive there**; `navigateFallback`, `runtimeCaching`, `cleanupOutdatedCaches` are `generateSW`-only options and become code | ~40 changed |
| `frontend/package.json` | `workbox-precaching`, `workbox-routing`, `workbox-strategies`, `workbox-expiration`, `workbox-cacheable-response` promoted to direct devDeps (+`workbox-core` if anything needs it) | 5–6 deps |
| `frontend/tsconfig.worker.json` | NEW — `"lib": ["ES2022","WebWorker"]`, `"include": ["src/sw.ts"]` (merging `WebWorker` into `tsconfig.app.json`'s `["ES2022","DOM","DOM.Iterable"]` produces duplicate-identifier errors — R10 §3.3 **[V]** for the lib conflict, **[U]** for the split being the plugin's own recommendation) | ~12 |
| `frontend/tsconfig.json` + `tsconfig.app.json` | add the project reference; `"exclude": ["src/sw.ts"]` from the app project | 2 |
| `frontend/package.json` `typecheck` | a 4th `tsc -p` invocation (today: `tsc -b --noEmit && tsc -p tests/… && tsc -p e2e/…`) | 1 |
| `frontend/eslint.config.js` | `src/sw.ts` must leave the `src/**/*.{ts,tsx}` type-aware block (it resolves against `tsconfig.app.json`, which now excludes it) and get its own block against the worker project | ~8 |
| `frontend/src/hooks/useForegroundNotifications.ts` + a page-side listener | same as the recommended path | ~30 |
| tests | precache/route parity is now *our* code and untested; a `sw.ts` unit test needs the whole workbox module graph mocked | 80+ |

**~300–400 lines, 5–6 deps, one new tsconfig project, three gate touch points, and a rewrite of the
mechanism that carries every future release.** For a 35-line handler.

`devOptions.enabled` stays `false`, so R10 §3.4's dev-mode minefield (module workers unsupported on
Firefox dev, no HMR in a custom SW, vite-pwa#425) is avoided either way — but it also means **the
custom worker is only ever exercised in a real build**, i.e. the first place a `sw.ts` regression shows
up is prod.

---

## 6. Risk comparison, third options, recommendation

### 6.1 Side by side

| | `importScripts` now | `injectManifest` now |
|---|---|---|
| Update path (`prompt` toast → SKIP_WAITING → reload) | **untouched, byte-identical** | must be hand-reproduced; silent breakage if missed |
| Precache/routes/navigation fallback | stay generated | become ours, forever |
| New dependencies | **0** | 5–6 |
| Type coverage of the new code | **none** (plain JS in `public/`) | full (new tsconfig project) |
| Gate touch points | 1 (an eslint globals block) | 4 (tsconfig ×3, eslint, typecheck script) |
| Lines | ~150–170 | ~300–400 |
| Cache-staleness hazard | **yes** — needs §2.3's hashed URL | no (the SW is the only script) |
| Blast radius of a mistake | the notification handler | the whole offline app + the release path |
| Reversibility | delete one option + one file | a second migration |

### 6.2 The migration-debt question

**If Web Push later forces `injectManifest`, is the `importScripts` handler simply folded into `sw.ts`?**
Yes — literally: the file's contents move into `sw.ts`, `self.addEventListener` calls unchanged, and the
`importScripts` option and the `public/` file are deleted. It is a **cut-and-paste plus two deletions**;
nothing about the handler's shape is `generateSW`-specific.

**But the premise is wrong anyway: Web Push does not force `injectManifest`.** `push` is the listener
workbox's own documentation names as the reason `importScripts` exists **[V]** (§1.1). R11 found
LibreChat using the same mode for a different listener **[V]**, and ntfy's worker `importScripts("/config.js")`
to reach a runtime-served VAPID key (R11 §2.2 **[V]**). So the honest debt of choosing `importScripts`
today is: **possibly zero**. `injectManifest` earns its cost when we want the SW written in TypeScript
against the workbox module API — a real preference, but not a requirement of any listener.

### 6.3 Third options found in the field

1. **`Notification.navigate` — the declarative, zero-JS answer, and it does not exist yet.** The
   current Notifications spec has a `navigate` member and an *"Activating a notification"* step that
   fires **before** `notificationclick`: *"If navigationURL is non-null: Select one of the following
   two options in an implementation-defined manner: Navigate an existing top-level traversable … or
   Create a fresh top-level traversable … **Return.**"* **[V]** — i.e. setting it would **preempt the
   handler entirely**. BCD: `Chrome false, Firefox false` **[V]**. **Do not set `navigate`**, and note
   the forward-compat trap: if a future engine ships it and someone adds the option, the
   `notificationclick` handler silently stops firing.
2. **`inlineWorkboxRuntime: true`** to hoist `importScripts` to literal top level (§1.2) — available,
   verified to work, and unnecessary given §1.3. Keep in the back pocket if a device round ever shows
   a missed first `notificationclick`.
3. **LibreChat's `emitFile` variant of the same mode** — keep the helper's source under `src/sw/` and
   emit it into `dist/` with a ~12-line inline Vite plugin, instead of `public/` **[V]**. Buys full
   prettier/eslint coverage (`public/` is in `.prettierignore` **[V]**) at the cost of build
   machinery. A reasonable owner call; I'd take `public/` first and lift it if the file grows.
4. **`vite-plugin-pwa`'s own "add listeners under generateSW" pattern** — searched for, **not found**.
   The plugin documents only `generateSW` vs `injectManifest`; the `importScripts` route is
   workbox-build's, reached through the plugin's pass-through. Recorded as a negative.

### 6.4 Ruling

**`importScripts` now.** The decisive asymmetry is not the line count — it is that `injectManifest`
puts a released, owner-visible, hard-to-test mechanism (the update toast) at risk to add a handler that
does not need it, while `importScripts` puts nothing at risk and is the option's documented purpose.
Revisit `injectManifest` only when there is an independent reason to own the worker (Web Push with
non-trivial payload logic; a TypeScript SW; navigation preload) — and by then the handler moves for free.

---

## 7. Corrections to premises

1. **"A real handler is part of the Web Push channel, where a custom worker is required anyway" —
   FALSE.** `frontend/src/hooks/useForegroundNotifications.ts` L141-142, and implicitly R10 §3/§9.4.
   `workbox.importScripts` under `generateSW` owns `notificationclick` (and `push`) with no custom
   worker, no strategy flip and no new dependency — it is the documented use case of the option **[V]**
   and shipped in-class practice **[V]**. The consequence is a scheduling one: **this slice does not
   depend on the Web Push channel and never did.**
2. **R10 §3.2's "minimal correct diff" is stale for today's repo.** It is written for
   `registerType:"autoUpdate"` and prescribes hand-writing `self.skipWaiting()` + `clientsClaim()`. We
   flipped to `"prompt"` on 2026-08-11; under prompt mode the generated worker contains **neither** —
   it contains a `SKIP_WAITING` **message listener**, which is what `SwUpdatePrompt`'s
   `updateServiceWorker(true)` → `wb.messageSkipWaiting()` drives. Any future `injectManifest`
   migration must reproduce **that**, and R10 §3.2 as written would break the update toast **[V]**.
   *(R10 §3.5 flagged the reverse-direction bug at the time — that the toast was dead code under
   autoUpdate — and that finding was acted on; §3.2 was simply never updated to match.)*
3. **R10 §10's open item "`includeUncontrolled: true` necessity — standard practice, not stated in the
   primary docs" — now SETTLED for our configuration.** The default is `false` (spec IDL **[V]**), and
   because prompt mode ships **no `clientsClaim()`** (template, verbatim **[V]**), the first page load
   after an install is uncontrolled. Without the flag, `matchAll` returns an empty list on exactly the
   load most likely to be showing notifications. **Load-bearing.**
4. **"The imported script is fetched every time the worker starts" — FALSE** (a plausible assumption
   nobody has written down here yet, but worth pinning). The script resource map is consulted first;
   the network fetch happens on the first evaluation only **[V]** (§1.4). The corollary is the one that
   matters: bytes fetched stale at install stay stale for that worker's whole life (§2.2).
5. **Nothing in `vite.config.ts`'s PWA comments is wrong** — checked. But it under-documents: the block
   silently inherits `cleanupOutdatedCaches: true`, `navigateFallback: "index.html"` and
   `dontCacheBustURLsMatching: /^assets\//` from the plugin **[V]**, which is invisible from the file
   and is precisely what an `injectManifest` migration would have to notice.

---

## 8. Implementation sketch — the recommended path

### 8.1 Files touched

| File | Change | ~lines |
|---|---|---|
| `frontend/public/notify-sw.js` | **NEW** — the whole worker-side handler (see §8.2) | ~45 with this repo's comment density |
| `frontend/vite.config.ts` | content-hash the helper + `workbox.importScripts` entry + the "why not injectManifest" comment | +20 |
| `frontend/src/hooks/useForegroundNotifications.ts` | `data` onto the options object; extract `applyNotificationFocus`; add the SW `message` listener + `startMessages()` in the existing effect | +28 / −4 |
| `frontend/src/store/ui.ts` *(or `main.tsx`)* | read+strip `?tab=` at boot | +10 |
| `frontend/eslint.config.js` | a `files: ["public/*.js"]` block with `globals.serviceworker` (the `globals` import already exists) | +5 |
| `frontend/tests/notifySw.test.ts` | **NEW** — §8.3 | ~75 |
| `docs/ROADMAP.md` §F1 / `docs/HANDOFF.md` | record channel 1's close-out; cite this dossier | ~10 |

**Net: ~150–170 new lines, 0 dependencies, 0 changes to the update path, 0 backend changes.**

### 8.2 The two halves

**`public/notify-sw.js`** — plain JS (no bundler, no TS), everything at top level:

```js
// Loaded into the generated Workbox worker via `workbox.importScripts` (vite.config.ts). It exists
// because Android raises notifications through registration.showNotification(), whose activation is
// delivered ONLY to this worker — the page's `onclick` never fires there.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(
    (async () => {
      // includeUncontrolled: prompt mode ships no clientsClaim(), so the first load after an install
      // is uncontrolled — and that page is exactly the one showing notifications.
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = all.find((c) => c.frameType !== "nested") || all[0];
      if (client) {
        // ROUTE FIRST, focus second, and never let focus's failure skip the routing: on Firefox
        // Android focus() does not foreground an installed PWA (Bugzilla 1880000, still NEW), and
        // the tab switch must survive that.
        client.postMessage({ type: "ctrlb:notification-click", focus: data.focus });
        try { await client.focus(); } catch { /* no transient activation / engine bug */ }
        return;
      }
      // No live client: the page died. The tab is PERSISTED, so "/" would restore the last-used tab.
      await self.clients.openWindow(data.focus === "agent" ? "/?tab=agent" : "/");
    })(),
  );
});
```

**`vite.config.ts`**:

```ts
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

// The imported worker script is fetched through the ORDINARY HTTP cache (updateViaCache defaults to
// "imports") and our server sends no Cache-Control on dist files — so a heuristically-cached copy can
// pin an old handler into a brand-new worker. A content hash in the URL makes that impossible.
const notifySwHash = createHash("sha256")
  .update(readFileSync("public/notify-sw.js"))
  .digest("hex")
  .slice(0, 8);

// inside workbox: {}
importScripts: [`/notify-sw.js?v=${notifySwHash}`],
```

*(Deliberately no `globIgnores` entry: leaving the file in the precache manifest means its revision
hash is embedded in `sw.js`, so a helper-only edit changes `sw.js`'s bytes and a worker update is
guaranteed without relying on the spec's import byte-comparison branch — §1.4.)*

**`useForegroundNotifications.ts`**:

```ts
const options: NotificationOptions = {
  body: signal.body, tag: signal.key, icon: ICON,
  data: { focus: signal.focus, key: signal.key },   // survives the tray; read by notify-sw.js
};
…
function applyNotificationFocus(focus: unknown): void {
  if (focus === "agent") setUI({ tab: "agent" });   // the ONE router, both paths
}
```
plus, in the existing mount effect:
```ts
const onSwMessage = (e: MessageEvent) => {
  const d = e.data as { type?: string; focus?: unknown } | null;
  if (d?.type === "ctrlb:notification-click") applyNotificationFocus(d.focus);
};
navigator.serviceWorker?.addEventListener("message", onSwMessage);
navigator.serviceWorker?.startMessages();  // addEventListener (unlike onmessage) leaves pre-DCL messages queued
// … and remove it in the cleanup beside `unsub`.
```

### 8.3 Test approach

**Unit (vitest) — this is where the coverage lives.** `notify-sw.js` is a plain script that registers a
listener on `self`, which makes it *directly* testable without any SW runtime:

```ts
// tests/notifySw.test.ts
const listeners = new Map<string, (e: unknown) => void>();
const clients = [{ frameType: "top-level", postMessage: vi.fn(), focus: vi.fn() }];
vi.stubGlobal("self", {
  addEventListener: (t, fn) => listeners.set(t, fn),
  clients: { matchAll: vi.fn().mockResolvedValue(clients), openWindow: vi.fn() },
});
await import("../public/notify-sw.js");
await fire(listeners.get("notificationclick"), { notification: { close: vi.fn(), data: { focus: "agent" } } });
```
Four cases, all cheap and all real regressions: (1) a live client → `postMessage` with
`focus:"agent"`; (2) **`focus()` rejects → `postMessage` still happened** (the Fennec case, the single
most valuable assertion here); (3) no clients → `openWindow("/?tab=agent")`; (4)
`matchAll` called with `includeUncontrolled: true` (pins §3.3's load-bearing flag against a future
"tidy-up").

Plus a page-side test: dispatch a synthetic `MessageEvent` on a stub `navigator.serviceWorker`
`EventTarget` and assert `getUI().tab === "agent"`; and a `?tab=agent` boot test (the existing
`store/ui` tests already exercise the persisted-load path, so this slots in beside them).

**A `vite.config.ts` pin:** assert `importScripts` is present and carries a `?v=` — cheap insurance
against a future edit dropping the cache-bust. *(There is precedent for config-shape pins in the
backend's `test_arch_invariants_qh9.py`; the frontend has no equivalent yet, so this is optional.)*

**E2E: not feasible, and say so rather than pretending.** Playwright cannot click an OS notification —
`microsoft/playwright#23954` ("Support web push notification handling/testing") is the standing feature
request **[R]**, and permissions/`showNotification` are as far as the API goes. The closest useful
approximation is an e2e that registers the SW, calls
`registration.showNotification()`, then invokes the handler through the SW's own scope — which tests
almost nothing the unit test doesn't. **Substitute: a two-line manual device check in the release
checklist** (Chrome Android installed PWA; Fennec) — the same posture the repo already takes for the
mic and the install-icon.

### 8.4 Sequencing

One slice; the `?tab=` reader is the only separable piece. Land it, run the dev units, and take the
device round in an owner afternoon — both the tap→focus and the tap→tab halves need a real phone, and
Fennec's half is expected to be partial by §3.4.

---

## 9. What I could not determine

- **Whether Chrome 14x / Gecko 15x actually implement the import byte-comparison branch of the Update
  algorithm today.** Spec text verified; no engine source read, no live probe run. Moot for us (§2.1),
  but it is the one claim in the "importScripts changes trigger updates" folklore I did not close.
- **Whether the microtask-checkpoint boundary in "run a classic script" is where every engine snapshots
  the set of event types to handle.** The spec chain is solid **[V]** and our own SKIP_WAITING listener
  is live proof for `message` on both engines — but I found no engine source or written statement
  confirming the boundary explicitly, and no test of `notificationclick` specifically from that
  position. If a device round ever shows a first-tap miss, `inlineWorkboxRuntime: true` (§6.3) is the
  one-line answer.
- **Whether Chrome Android's `client.focus()` foregrounds an installed WebAPK reliably.** MDN/BCD speak
  to `openWindow` ("may open inside an existing browsing context") but say nothing about `focus()` for
  a standalone app, and I found no Chromium source or documented statement. Reports exist both ways
  **[R]**. Only the owner's phone settles it.
- **Whether Bugzilla 1880000 still reproduces on the owner's Fennec build.** Last tracker activity is
  ~4 months old and the bug is `NEW`; the Mbin report is the most specific evidence **[R]**. Same
  unknown class as R10 §10's Fennec items.
- **Chromium's exact heuristic-freshness formula and caps** for a `Last-Modified`-only response. RFC
  9111's "typical 10%" is verified **[V]**; the browser's actual constants were not read from source,
  so the "~3 days after a month" figure in §2.2 is an RFC-guided estimate, not a measurement. **[U]**
- **Whether a `Client.postMessage` reaches an UNCONTROLLED client's `navigator.serviceWorker`
  listener.** The spec places no control requirement on `Client.postMessage` and `matchAll` is what
  produced the handle, so it should **[U]**. In our flow the page is normally controlled; the
  uncontrolled case is the first load after an install. Worth one line in the device round.
- **Whether any in-class peer has since added notification-click routing.** I checked LibreChat and
  open-webui at `main`; I did not re-sweep the full reference class, since R11's July pass already
  established that only 1/3 in-class peers implements any closed-app channel at all.

---

### Source index

**Specs:** [Service Workers (W3C ED)](https://w3c.github.io/ServiceWorker/) — Run Service Worker ·
Should Skip Event · Fire Functional Event · Update · the importScripts fetch path · `RegistrationOptions`
IDL · `ClientQueryOptions` IDL ·
[Notifications (WHATWG)](https://notifications.spec.whatwg.org/) — §2.7 Activating a notification ·
§4 Service worker API IDL ·
[RFC 9111 §4.2.2](https://www.rfc-editor.org/rfc/rfc9111.txt).

**MDN / BCD:** [`ServiceWorkerContainer.register`](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register)
(`updateViaCache`) ·
[`notificationclick` event](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/notificationclick_event) ·
[`WindowClient.focus`](https://developer.mozilla.org/en-US/docs/Web/API/WindowClient/focus) ·
[`ServiceWorkerContainer.startMessages`](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/startMessages) ·
`mdn/browser-compat-data@main` — `api/ServiceWorkerGlobalScope.json`, `api/Clients.json`,
`api/WindowClient.json`, `api/Notification.json` (fetched 2026-08-19).

**Vendor / trackers:** [workbox-build docs](https://developer.chrome.com/docs/workbox/modules/workbox-build) ·
[Bugzilla 1880000](https://bugzilla.mozilla.org/show_bug.cgi?id=1880000) ·
firebase-js-sdk#2438 · PWABuilder#4777 · w3c/ServiceWorker#720 · microsoft/playwright#23954.

**Installed source (this repo, 2026-08-19):** `workbox-build@7.4.1` —
`build/templates/sw-template.js`, `build/types.d.ts`, `build/lib/populate-sw-template.js` ·
`vite-plugin-pwa@1.3.0` — `dist/index.js` (defaults + pass-through), `dist/client/build/register.js` ·
`fastapi/routing.py` (`_FrontendStaticFiles`), `starlette/responses.py` (`FileResponse` headers).

**Peer source at HEAD (2026-08-19):** `danny-avila/LibreChat` — `client/sw/heal.js`,
`client/vite.config.ts` · `mastodon/mastodon` —
`app/javascript/mastodon/service_worker/web_push_notifications.js` · `open-webui/open-webui` (negative).

**Local experiments:** `workbox-build.generateSW()` run standalone against this repo's `node_modules`
with our option shape, `inlineWorkboxRuntime` both ways · `curl -I` against
`http://127.0.0.1:5433` and `https://emma.lobster-vector.ts.net` (prod, live).
