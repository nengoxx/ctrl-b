# R11 — How real self-hosted web apps implement Web Push (end to end)

**Date:** 2026-07-31 · **Method:** shallow clones read directly (no docs, no blog posts). Every
"VERIFIED" claim below was read in the source file cited.

**Scope.** The *implementation* half only: subscription storage, VAPID key handling, the backend send
chokepoint, the service worker, and open-vs-closed-app dedupe. The standards/library half (RFC 8030 /
8291 / 8292 semantics, `pywebpush`, `vite-plugin-pwa` migration mechanics, Android/FCM delivery
quirks) was bought in a parallel pass and is deliberately **not** covered here.

**Reference class.** In-class peers first (open-webui · LibreChat · AnythingLLM), plus two sanctioned
out-of-class supplements because the question is genuinely generic web-app territory: **ntfy** (which
is also ctrl-b's designed channel 3) and **Mastodon** (the canonical Rails implementation).

**Repos + commits read (all `--depth 1`, 2026-07-31):**

| Project | Commit | Date | Implements Web Push? |
|---|---|---|---|
| AnythingLLM (Mintplex-Labs/anything-llm) | `1530f73` | 2026-07-30 | **YES** — minimal |
| ntfy (binwiederhier/ntfy) | `dc11655` | 2026-07-29 | **YES** — most complete |
| Mastodon (mastodon/mastodon) | `a1474e9` | 2026-07-30 | **YES** — most mature |
| open-webui | `01f4282` | 2026-07-27 | **NO** — outbound webhook targets instead |
| LibreChat (danny-avila/LibreChat) | `f7bc50a` | 2026-07-28 | **NO** — no closed-app story at all |

Negative results were established by repo-wide `grep -riI` for
`pushManager|VAPID|webpush|web-push|applicationServerKey`: **0 hits** in open-webui, **0 hits** in
LibreChat, 51 hits in AnythingLLM. (VERIFIED.)

---

## 1. AnythingLLM — the minimum viable implementation (closest single-user analogue)

Shipped alongside its scheduled-jobs feature (see R8). Total surface: **27 + 228 + 131 + 25 = 411
lines** across four files. Dependency: `web-push: ^3.6.7` (`server/package.json:100`).

### 1.2 VAPID keys — generated at boot, stored as a JSON file (VERIFIED)

`server/utils/PushNotifications/index.js` — `setupPushNotificationService()` is awaited inside the
listen callback in `server/utils/boot/index.js:40` (HTTPS) and `:73` (HTTP), i.e. **on every boot,
generate-if-missing**:

```js
if (!existingVapidKeys.publicKey || !existingVapidKeys.privateKey) {
  instance.#log("Generating new VAPID keys...");
  const vapidKeys = webpush.generateVAPIDKeys();
  ...
  fs.writeFileSync(path.resolve(instance.storagePath, `vapid-keys.json`), JSON.stringify(vapidKeys, null, 2));
}
```

Storage path is `$STORAGE_DIR/push-notifications/` (dev: `server/storage/push-notifications`). The
**public key is served by an endpoint, not baked into the build** — `GET /web-push/pubkey` returns
`{publicKey}` (`server/endpoints/webPush.js:21-24`). The `mailto:` subscriber is a hardcoded constant:
`static mailTo = "anythingllm@localhost"` — no config, no user email.

### 1.3 Subscription storage — one nullable TEXT column, or a JSON file (VERIFIED)

There is **no subscriptions table**. Multi-user mode stores the whole subscription JSON blob in a
single column on `users` (`server/prisma/schema.prisma:73`, added by migration
`20260130040204_init`):

```prisma
web_push_subscription_config String?
```

Single-user mode does not touch the DB at all — it writes
`$STORAGE_DIR/push-notifications/primary-subscription.json` and keys the in-memory map under the
literal string `"primary"`. Consequences, all verified by reading:

- **One device per user, hard.** `registerSubscription()` does `this.#subscriptions.set(userId, subscription)`
  and overwrites the column/file. A second device silently evicts the first.
- **No endpoint uniqueness** (there is no endpoint column to be unique on).
- **API surface is 2 endpoints**: `POST /web-push/subscribe`, `GET /web-push/pubkey`. **No delete, no
  update, no unsubscribe.**
- **No pruning whatsoever.** The send path's failure handling is a log line:
  `.catch((err) => { this.#log(`.sendNotification() - Failed: ${err.message}`); })`. A 410 Gone leaves
  the dead subscription in place forever.
- **Client re-syncs on mount, not on load**: `useWebPushNotifications(false)` is called from exactly
  one page (`frontend/src/pages/GeneralSettings/ScheduledJobs/index.jsx:19`), so the subscription is
  re-POSTed whenever the user visits the Scheduled Jobs page and never otherwise.

### 1.4 Send chokepoint — one call site, fire-and-forget (VERIFIED)

Exactly **one** producer in the whole codebase: `server/jobs/run-scheduled-job.js:129` calls
`sendWebPushNotification(job, runId, state.textResponse, log)` from
`server/jobs/helpers/scheduled-job-helper.js:80`. Payload shape:

```js
payload: {
  title: `${job.name} completed`,
  body: notificationBody,          // thinking-tags stripped, truncated to 100 chars + "..."
  data: { onClickUrl: `/settings/scheduled-jobs/${job.id}/runs/${runId}` },
}
```

**Not queued.** `sendNotification()` returns the `web-push` promise directly; the caller awaits it
inside the job runner and swallows errors. Note the defensive `await pushNotificationService.loadSubscriptions()`
immediately before each send — the job runs in a separate process from the API server, so its
in-memory map would otherwise be empty.

### 1.5 Open-app dedupe — none (VERIFIED)

Nothing anywhere checks visibility, client count, or session state. The server sends unconditionally;
the SW shows unconditionally. Duplication is simply not possible for them *by accident of scope*: the
only push-worthy event is "a scheduled job finished", and the in-app surface for that is a polled table
(`usePolling(fetchJobs, 5000)`), not a notification. **They dodged the problem rather than solving it.**

### 1.6 The service worker — 25 hand-rolled lines, no PWA machinery (VERIFIED)

`frontend/public/service-workers/push-notifications.js`, registered explicitly by the hook with a
manual cache-buster: `navigator.serviceWorker.register('/service-workers/push-notifications.js?v=1.0.0')`
where `SW_VERSION` is a hand-incremented constant, commented:

> `// If you update the service worker, increment this version or else the service worker will not be updated`

The whole worker:

```js
self.addEventListener('push', function (event) {
  const payload = parseEventData(event);
  if (!payload) return;
  self.registration.showNotification(payload.title || 'AnythingLLM', { ...payload, icon: '/favicon.png' });
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const { onClickUrl = null } = event.notification.data || {};
  if (!onClickUrl) return;
  event.waitUntil(clients.openWindow(onClickUrl));
});
```

`clients.openWindow` unconditionally — **no focus-or-open**, so a click opens a second tab when the app
is already open. **Coexistence question is moot**: AnythingLLM's frontend has no `vite-plugin-pwa`, no
workbox, no precache (`grep -i 'pwa\|workbox' frontend/package.json` → 0 hits); this is its only SW.

### 1.7 Preference UI — a single bell, no per-event or per-device toggles (VERIFIED)

A `<Bell/>` button on the Scheduled Jobs page that vanishes once permission is granted:

```jsx
if (!("serviceWorker" in navigator) || !("PushManager" in window) || permissionState === "granted") return null;
```

No event classes, no per-device list, no server-side gate.

---

## 2. ntfy — the most complete storage + lifecycle model

Web Push is **compile-time optional**: `//go:build !nowebpush` on `server/server_webpush.go`, with a
no-op `server/server_webpush_dummy.go` for the `nowebpush` tag. Library: `github.com/SherClockHolmes/webpush-go`.

### 2.2 VAPID keys — a CLI subcommand, pasted into the config file (VERIFIED)

`cmd/webpush.go` (69 lines) implements `ntfy webpush keys`, which prints (or writes with `-f`) a YAML
fragment for the operator to paste:

```
web-push-public-key: %s
web-push-private-key: %s
web-push-file: /var/cache/ntfy/webpush.db # or similar
web-push-email-address: <email address>
```

Keys live in the main config (`WebPushPrivateKey string \`hash:"-"\`` — excluded from the config hash,
`server/config.go:211`). **The whole feature is off unless `web-push-public-key` is set**; that one
check gates the routes, the sends and the sweeper. The public key reaches the client via the
server-rendered `/config.js` (`server/server_web.go:88-90`, `server/types.go:353-355`):

```go
EnableWebPush:    s.config.WebPushPublicKey != "",
WebPushPublicKey: s.config.WebPushPublicKey,
```

→ `config.web_push_public_key` / `config.enable_web_push` in the browser. **Not baked into the build**
— and the SW `importScripts("/config.js")` to get at it too (`web/public/sw.js`).

### 2.3 Subscription storage — a dedicated SQLite DB, 8 columns, UNIQUE on endpoint (VERIFIED)

`webpush/store_sqlite.go`. Subscriptions live in their own database file (`web-push-file`), separate
from the message cache and the auth DB:

```sql
CREATE TABLE IF NOT EXISTS subscription (
    id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    key_auth TEXT NOT NULL,
    key_p256dh TEXT NOT NULL,
    user_id TEXT NOT NULL,
    subscriber_ip TEXT NOT NULL,
    updated_at INT NOT NULL,
    warned_at INT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_endpoint ON subscription (endpoint);
CREATE INDEX IF NOT EXISTS idx_subscriber_ip ON subscription (subscriber_ip);
CREATE TABLE IF NOT EXISTS subscription_topic (
    subscription_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    PRIMARY KEY (subscription_id, topic),
    FOREIGN KEY (subscription_id) REFERENCES subscription (id) ON DELETE CASCADE
);
```

**The endpoint is the identity** — writes are an upsert on it:

```sql
INSERT INTO subscription (...) VALUES (...)
ON CONFLICT (endpoint)
DO UPDATE SET key_auth = excluded.key_auth, key_p256dh = excluded.key_p256dh, user_id = excluded.user_id,
              subscriber_ip = excluded.subscriber_ip, updated_at = excluded.updated_at, warned_at = excluded.warned_at
RETURNING id
```

API: `POST /v1/webpush` (upsert with the topic list) and `DELETE /v1/webpush` (by endpoint) —
`handleWebPushUpdate` / `handleWebPushDelete`. Two hard input guards worth stealing:

- **A host allowlist on the endpoint URL** — 6 anchored regexes (FCM, `jmt17.google.com`, Mozilla,
  `*.mozaws.net`, Apple, `*.notify.windows.com`), with the comment *"See GHSA-w9hq-5jg7-q4j7 for why
  wildcarding the entire host is insufficient."* Without it, a subscribe endpoint is an SSRF primitive:
  the server POSTs to any URL a client hands it.
- `webPushTopicSubscribeLimit = 50`.

**Pruning is two-pronged (VERIFIED):**

1. **On failure** — `sendWebPushNotification` deletes the subscription on *any transport error* and on
   *any non-2xx except 429* (not just 404/410):
   ```go
   if (resp.StatusCode < 200 || resp.StatusCode > 299) && resp.StatusCode != 429 {
       ... if err := s.webPush.RemoveSubscriptionsByEndpoint(sub.Endpoint); err != nil { return err }
   ```
2. **TTL sweep with an advance warning** — `pruneAndNotifyWebPushSubscriptions()` runs from the manager
   loop (`server/server_manager.go:18`): delete where `updated_at <= now-60d` (`DefaultWebPushExpiryDuration`),
   then push a *"your subscription is about to expire"* notification to those idle ≥55d
   (`DefaultWebPushExpiryWarningDuration`) with `warned_at = 0`, and stamp `warned_at`. The delete query
   carries the honest comment `// Full table scan!`.

**Client re-sync**: `useWebPushListener` (`web/src/components/hooks.js:191`) re-POSTs whenever the
topic list or the permission state changes, and `updateWebPushSubscriptions` **deletes** the server-side
row when the topic list empties. `pushsubscriptionchange` is registered but is a console log only:
*"There's no good way to test this, and Chrome doesn't seem to implement this, so leaving it for now."*

### 2.4 Send chokepoint — 3 scattered call sites, one goroutine each (VERIFIED)

Not a chokepoint. `server/server.go:930`, `:1040`, `:2007` each repeat:

```go
if s.config.WebPushPublicKey != "" {
    go s.publishToWebPushEndpoints(v, m)
}
```

sitting beside identically-shaped `go s.sendToFirebase(v, m)` / `go s.sendEmail(...)` / `go s.callPhone(...)`
lines. **No queue** — a goroutine per publish, serial loop over subscriptions inside. Payload is the
whole ntfy message JSON plus the topic URL.

### 2.5 Open-app dedupe — **transport partition** (the strongest idea in this dossier) (VERIFIED)

ntfy does not suppress, tag-coalesce, or visibility-check. It makes double delivery **structurally
impossible** by removing the *other* transport for any topic Web Push covers
(`web/src/components/hooks.js:27-34`):

```js
export const useConnectionListeners = (account, subscriptions, users, webPushTopics) => {
  const wsSubscriptions = useMemo(
    () => (subscriptions && webPushTopics ? subscriptions.filter((s) => !webPushTopics.includes(s.topic)) : []),
```

with the doc comment:

> *"When Web Push is enabled, we do not need to connect to our home server via WebSocket, since
> notifications will be delivered via Web Push. However, we still need to connect to other servers via
> WebSocket, or for internal topics, such as sync topics (st_...)."*

The SW then becomes the single writer for those topics: it shows the notification, writes it into the
Dexie DB, updates `navigator.setAppBadge`, and posts to a `BroadcastChannel("web-push-broadcast")` —
whose *only* purpose is that the open page can play the sound, because **a service worker cannot play
audio** (`sw.js` comment + `hooks.js:213` `onMessage = () => notifier.playSound()`).

### 2.6 The service worker — 453 lines, `injectManifest` (VERIFIED)

`web/vite.config.js` → `VitePWA({ strategies: "injectManifest", ... })`, source `web/public/sw.js`.
It imports app modules directly (`workbox-precaching`, `workbox-routing`, plus `../src/app/db`,
`Session`, `i18n`, `notificationUtils`) and ends with the standard
`precacheAndRoute(self.__WB_MANIFEST); clientsClaim(); cleanupOutdatedCaches();`. So push handling and
precache **coexist in one worker** — that is the whole point of `injectManifest`.

`notificationclick` is a genuine focus-or-open ladder (verbatim comment):

```
// - first try focus an open tab on the `/:topic` route
// - if not, use an open tab on the root route (`/`) and navigate to the topic
// - if not, use whichever tab we have open and navigate to the topic
// - finally, open a new tab focused on the topic
```

Two durable gotchas recorded in their code:

- **Safari will revoke the subscription if you don't show a notification promptly**:
  `// NOTE: As soon as possible, to avoid this Safari error: > Push event handling completed without
  showing any notification via ServiceWorkerRegistration.showNotification(). This may trigger removal
  of the push subscription.` — hence `showNotification` runs *before* the DB writes.
- **An unknown/unparseable push must still show something**: `handlePushUnknown` exists because
  *"We can't ignore the push, since permission can be revoked by the browser."*
- Tag scheme: `notificationTag(baseUrl, topic, sequenceId)` = `` `${baseUrl}/${topic}/${sequenceId}` `` —
  scoped so identical sequence IDs on different topics don't collide.

### 2.7 Preference UI — per-device, client-side, auto-on in an installed PWA (VERIFIED)

One `WebPushEnabled` select in `web/src/components/Preferences.jsx:342`, stored in the local (IndexedDB)
prefs — i.e. **per device, not per account**. It is hidden entirely when the app runs as an installed
PWA (`{!isLaunchedPWA && pushPossible && <WebPushEnabled />}`) because
`useStandaloneWebPushAutoSubscribe()` turns it on automatically there. Granularity is per *topic*
(the subscription carries a topic list); there is no per-event-class notion.

---

## 3. Mastodon — the mature reference (queued, per-type, tag-coalesced)

### 3.2 VAPID keys — a rake task → env → config (VERIFIED)

`lib/tasks/mastodon.rake:580` `mastodon:webpush:generate_vapid_key` prints
`VAPID_PRIVATE_KEY=` / `VAPID_PUBLIC_KEY=` for the env; `config/vapid.yml` reads them
(`ENV.fetch('VAPID_PRIVATE_KEY', nil)`), surfaced as `Rails.configuration.x.vapid`. The file carries
the operational warning worth copying verbatim:

> *"You should only generate this once per instance. If you later decide to change it, all push
> subscriptions will be invalidated, requiring users to access the website again to resubscribe."*

The public key reaches the client as a **meta tag rendered by the server**, not a build constant
(`app/views/shared/_web_app.html.haml:6`):

```haml
%meta{ name: 'applicationServerKey', content: Rails.configuration.x.vapid.public_key }
```

### 3.3 Subscription storage — 9 columns, uniqueness by *session*, not by endpoint (VERIFIED)

`db/schema.rb:1423`:

```ruby
create_table "web_push_subscriptions", force: :cascade do |t|
  t.bigint "access_token_id", null: false
  t.datetime "created_at", precision: nil, null: false
  t.json "data"
  t.string "endpoint", null: false
  t.string "key_auth", null: false
  t.string "key_p256dh", null: false
  t.boolean "standard", default: false, null: false
  t.datetime "updated_at", precision: nil, null: false
  t.bigint "user_id", null: false
  t.index ["access_token_id"], ... where: "(access_token_id IS NOT NULL)"
  t.index ["user_id"], ...
end
```

**No unique index on `endpoint`.** Identity is the browser session: `Api::Web::PushSubscriptionsController`
has `before_action :destroy_previous_subscriptions, only: :create, if: :prior_subscriptions?` and
`after_action :update_session_with_subscription` — one live subscription per `session_activation`,
replaced on each create. `data` is a JSON blob holding `{policy, alerts: {<type> => bool}}`.
`standard` distinguishes RFC-8291 `aes128gcm` from the legacy `aesgcm` encoding.

Lifecycle:
- **Prune on 4xx except 408/429** (`app/workers/web/push_notification_worker.rb`):
  ```ruby
  if (400..499).cover?(response.code) && ![408, 429].include?(response.code)
    @subscription.destroy!
  elsif !(200...300).cover?(response.code)
    raise Mastodon::UnexpectedResponseError, response
  ```
  (a 5xx *raises*, so Sidekiq retries it — a clean split between "gone" and "try later").
- **Prune on invalid-at-send**: `unless @subscription.valid? ... @subscription.destroy!` — a
  self-healing sweep for rows written before endpoint/key validation existed (issues #30542/#30540).
- **Every push carries an `Unsubscribe-URL` header** built from a signed single-purpose token
  (`generates_token_for :unsubscribe, expires_in: TTL`), with `skip_forgery_protection only: :destroy`
  so the push service itself can call it (RFC 8030 §6.1).
- **Client re-sync on every app load** (`registerer.js`): it compares the *current* subscription's
  `applicationServerKey` against the served meta tag **and** the endpoint against the endpoint the
  backend hydrated into the store; any mismatch ⇒ `unsubscribe → subscribe → POST`.

### 3.4 Send chokepoint — one service, one Sidekiq queue (VERIFIED)

`app/services/notify_service.rb:263` is the single funnel, and it fans out to both transports with
**no mutual suppression**:

```ruby
def push_notification!
  push_to_streaming_api! if subscribed_to_streaming_api?
  push_to_web_push_subscriptions!
end

def push_to_web_push_subscriptions!
  ::Web::PushNotificationWorker.push_bulk(web_push_subscriptions.select { |s| s.pushable?(@notification) }) { |s| [s.id, @notification.id] }
end
```

**Queued** — `sidekiq_options queue: 'push', retry: 5`, `TTL = 48.hours`, `URGENCY = 'normal'`. The
queue is unambiguously scale-driven: it buys retry-with-backoff across N subscribers × M followers and
an HTTP connection pool (`RequestPool.current`), neither of which a 1–3-device deployment needs.

**Payload is a placeholder, hydrated by the SW** — the encrypted body carries only
`{access_token, notification_id, preferred_locale, title, body, icon}`, and the worker re-fetches the
real thing: `fetchFromApi(`/api/v1/notifications/${notification_id}`, 'get', access_token)`, with the
minimal payload used as the `.catch()` fallback. Localization happens server-side per subscription
(`I18n.with_locale(@subscription.locale ...)`) *and* client-side in the SW (`virtual:mastodon-sw-locales`).

### 3.5 Open-app dedupe — **identical `tag`, plus a mobile-only default** (VERIFIED)

Both paths set the same tag, so the browser collapses them into one notification.

In-app, from the streaming API (`app/javascript/mastodon/actions/notifications.js:61`):

```js
const notify = new Notification(title, { body, icon: notification.account.avatar, tag: notification.id });
```

In the service worker (`web_push_notifications.js`):

```js
options.tag = notification.id;
```

Layered on top, a server-side *default* that encodes the same intent
(`Api::Web::PushSubscriptionsController`):

```ruby
def alerts_enabled
  # Mobile devices do not support regular notifications, so we enable push notifications by default
  active_session.detection.device.mobile? || active_session.detection.device.tablet?
end
```

i.e. a desktop subscription is created with **all alert types off** (the open tab's own
`new Notification` covers it); a phone/tablet gets them **on**. There is no `clients.matchAll`
visibility check anywhere in the push path.

Bonus: the SW **groups** rather than stacks once the tray is full — `MAX_NOTIFICATIONS = 5`, after
which existing notifications are closed and replaced by one `tag: 'tag'` group notification whose body
is the joined titles, incremented in place on each further push.

### 3.6 The service worker — hand-rolled, its own bundler entry, no workbox (VERIFIED)

`sw.ts` is **22 lines** of pure wiring (`install`→`cacheRoot`, `activate`→`clients.claim`, `fetch`,
`push`, `notificationclick`), delegating to `web_push_notifications.js` (208 lines) and a hand-written
`caching.ts` (147 lines). It is a rollup input in `vite.config.mts:212`
(`sw: path.resolve(jsRoot, 'mastodon/service_worker/sw.ts')`) with two bespoke plugins
(`MastodonServiceWorkerLocales`, `MastodonServiceWorkerChunkPaths`) — **no `vite-plugin-pwa`, no
workbox at all**. Click handling is focus-or-open with a preference order:

```js
const findBestClient = clients => {
  const focusedClient = clients.find(client => client.focused);
  const visibleClient = clients.find(client => client.visibilityState === 'visible');
  return focusedClient || visibleClient || clients[0];
};
```

`notificationclick` also implements **action buttons that call the API from the worker** (reblog /
favourite / expand), i.e. reply-from-the-notification without opening the app.

### 3.7 Preference UI — per-type alerts, enforced server-side (VERIFIED)

`data.alerts` is a map of every `Notification::TYPES` key to a bool, plus a `policy`
(`all|none|followed|follower`). **The server refuses to send** — it is not a client filter
(`app/models/web/push_subscription.rb`):

```ruby
def pushable?(notification)
  policy_allows_notification?(notification) && alert_enabled_for_notification_type?(notification)
end
```

filtered at `notify_service.rb:285` before the job is even enqueued. Because `data` hangs off the
subscription row and a subscription is per-session, the toggles are effectively **per device**.

---

## 4. open-webui — does NOT implement Web Push; it *unregisters* service workers

**Evidence (VERIFIED):** zero hits for `pushManager|VAPID|webpush|applicationServerKey` repo-wide; no
`sw.js`/`service-worker.*` file exists; the only `navigator.serviceWorker` reference in the whole
frontend is a **teardown**, called on version change and on navigation after an update
(`src/routes/+layout.svelte:84`, invoked at `:101` and `:210`):

```js
const unregisterServiceWorkers = async () => {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
```

**Its closed-app story is outbound webhooks**, and the design is more interesting to us than a push
implementation would have been:

- **A sink registry as the chokepoint** (`backend/open_webui/events.py:1144`):
  `EVENT_SINKS = [EventFunctionSink(), WebhookEventSink(), NotificationEventSink()]`, and one
  `publish_event(...)` that loops them. Each sink schedules fire-and-forget work
  (`asyncio.create_task(dispatch_notification_event(app, event))`) — **no queue**.
- A **notify-worthy subset** of the event catalog, exactly analogous to ctrl-b's four classes
  (`events.py:664`): `NOTIFICATION_EVENTS = (CHAT_FINISHED, CHAT_FAILED, CHANNEL_MESSAGE, CALENDAR_ALERT)`,
  with a served catalog (`GET /events` → `{event, label, description}`) driving the settings UI.
- **Per-target event lists + a delivery mode**, stored in user settings, not a table:
  `{id, type: 'webhook', enabled, events: [...], delivery: 'away'|'always', config: {url}}`.
- **Server-side away-suppression — the cleanest dedupe answer in the dossier**
  (`backend/open_webui/utils/notifications.py:394`):
  ```python
  if target.get('delivery', 'away') == 'away' and is_active:
      continue
  ```
  where `is_active` is a heartbeat window (`models/users.py:755`): *"Consider user active if
  last_active_at within the last 3 minutes"* (180 s), and `CHANNEL_MESSAGE` is exempted (always sent).
- SSRF-guarded URLs (`validate_url` blocks private/loopback/metadata) with a comment naming the reason:
  *"the URL is caller-controlled"*.

Its **foreground** channel is a socket.io stream raising `new Notification(...)`, with a **multi-tab**
dedupe by leader election over `BroadcastChannel('active-tab-channel')` — `isLastActiveTab` is set true
on visibility and broadcast, and every other tab sets itself false; only the winner raises the
notification (`+layout.svelte:541`, `:676`, `:783`, `:1078-1093`).

## 5. LibreChat — does NOT implement Web Push, and has no closed-app channel at all

**Evidence (VERIFIED):** zero hits for the push markers; the ~1500 `Notification` matches in
`client/src` are all `NotificationSeverity` (in-app toast severity enum) — there is no
`new Notification`, no `requestPermission`, no `showNotification` anywhere in the client, and no webhook
or outbound notifier in `api/server`.

It **does** ship a PWA, and the way it extends the generated worker is the finding worth keeping
(`client/vite.config.ts:88`):

```ts
VitePWA({
  injectRegister: 'auto',
  registerType: 'autoUpdate',
  workbox: {
    globIgnores: [..., 'sw-heal.js', ...],
    navigateFallback: null,
    importScripts: ['sw-heal.js'],
```

i.e. **custom worker code without leaving `generateSW`** — a 60-line `client/sw/heal.js` emitted as a
build asset by a tiny rollup plugin and pulled into the generated worker via `workbox.importScripts`.
It registers its own `activate` listener alongside workbox's, pings window clients and reloads the ones
that don't answer within 1500 ms. That is the third authoring mode, and the cheapest one: a `push` +
`notificationclick` handler is exactly the same shape of addition.

---

## 6. Cross-project synthesis

| | AnythingLLM | ntfy | Mastodon | open-webui | LibreChat |
|---|---|---|---|---|---|
| **Web Push?** | yes (411 LOC total) | yes (compile-optional) | yes | **no** (webhooks) | **no** (nothing) |
| **VAPID generated** | at boot, auto | CLI `ntfy webpush keys` | rake task | — | — |
| **VAPID stored** | `vapid-keys.json` in storage dir | config file (`hash:"-"`) | env → `config/vapid.yml` | — | — |
| **Public key to client** | `GET /web-push/pubkey` | server-rendered `/config.js` | `<meta name="applicationServerKey">` | — | — |
| **Subscription storage** | 1 TEXT column on `users` **or** a JSON file | own SQLite DB, 8 cols + topic join | 9-col table | — | — |
| **Uniqueness** | none (1/user, overwrite) | `UNIQUE(endpoint)` + upsert | per session (`destroy_previous`) | — | — |
| **Delete endpoint** | **none** | `DELETE /v1/webpush` | `DELETE` via signed unsubscribe token | — | — |
| **Prune on failure** | **none** (logs) | any non-2xx except 429, + any error | 4xx except 408/429 | — | — |
| **TTL sweep** | none | 60 d, with a 55 d warning push | none | — | — |
| **Chokepoint** | 1 call site | 3 scattered `go` calls | 1 service → Sidekiq | `EVENT_SINKS` registry | — |
| **Queue** | no | no (goroutine) | **yes** (Sidekiq, retry 5) | no (`create_task`) | — |
| **Open-app dedupe** | none (dodged) | **transport partition** (no WS for push topics) | same `tag` + mobile-only default | **server-side `delivery: away` + 180 s activity** | — |
| **SW authoring** | hand-rolled 25 lines, own registration | `injectManifest`, 453 lines | hand-rolled 22+208+147, own rollup entry, no workbox | **unregistered on purpose** | `generateSW` + `importScripts` (60 lines) |
| **`notificationclick`** | `openWindow` only | 4-step focus-or-navigate ladder | `focused ‖ visible ‖ [0]` + API actions | — | — |
| **Per-event prefs** | none | per *topic*, client-side | per type + policy, **server refuses** | per target `events[]`, server refuses | — |

**Four things ≥3 of the 3 implementers agree on:**
1. **The VAPID public key is served at runtime, never baked into the build** (endpoint / config.js / meta tag). All three. It makes key rotation a server-side change and lets the client detect a changed key.
2. **The subscription JSON is stored decomposed** (`endpoint`, `key_auth`, `key_p256dh` as columns) by everyone who has a table; only AnythingLLM keeps the raw blob, and it is also the only one that cannot prune.
3. **Failure-driven pruning is the primary lifecycle mechanism**; TTL sweeps are the optional second (only ntfy).
4. **Nobody does an SW-side `clients.matchAll` visibility check to suppress.** Three different strategies instead: remove the other transport (ntfy), share the `tag` (Mastodon), or suppress server-side on an activity window (open-webui). The `matchAll` approach that a naive design reaches for is used by **0/5**.

**What was wrong going in:** the assumption that a peer would show us an SW-side visibility suppressor
to copy. None exists in this reference class. Also: "AnythingLLM implements Web Push" is true but
nearly content-free as precedent — 411 lines with no delete, no pruning, and one device per user.

---

## 7. Implications for ctrl-b

Short, and separate from the evidence above.

1. **Reuse `NotifySignal` as the wire payload; don't invent a second shape.** `{cls, key, title, body, focus?}` already contains everything all three implementers send (`key` is exactly Mastodon's/ntfy's `tag`, and `focus` is `data.onClickUrl`). The backend's job becomes "emit a `NotifySignal` server-side", which is the same object the frontend bus carries — one vocabulary, two producers.
2. **The dedupe question is already answered by our own `key`.** Both channels tagging on the same durable id gives Mastodon's coalescing for free. Prefer that over server-side suppression: a hidden-page heuristic on the server (open-webui's 180 s window) would double-gate against `shouldNotify`'s `visibility !== "hidden"` check and is precisely the "second gate elsewhere" that `useForegroundNotifications`'s header warns about. Consider ntfy's transport partition only if tag-coalescing proves unreliable on Fennec/Android.
3. **The SW question is the real fork, and LibreChat shows a third option.** `workbox.importScripts: ['sw-push.js']` adds `push` + `notificationclick` to our existing `vite-plugin-pwa` `autoUpdate` worker **without** migrating to `injectManifest` (ntfy's route) or hand-rolling (Mastodon's). A ~40-line file gets us both the push handler and the `notificationclick` deep-link that F1's device round is currently missing — the ROADMAP already predicted "a real handler is part of the Web Push channel".
4. **Schema: follow ntfy, not AnythingLLM.** A real `push_subscriptions` table with `UNIQUE(endpoint)` and upsert-on-conflict, ~6 columns (`endpoint`, `key_auth`, `key_p256dh`, `label`/UA, `created_at`, `updated_at`). At 1–3 devices the cost over a config blob is one migration, and it is what makes multi-device and prune-on-410 possible at all. AnythingLLM's single column is exactly the "shape data to extend, not to migrate" failure mode.
5. **Prune on send failure; skip the TTL sweep.** Non-2xx-except-429 ⇒ delete (ntfy's rule is stricter and simpler than 404/410-only, and Mastodon's 5xx-raises split is worth keeping if we ever retry). ntfy's 60-day sweep exists because it serves strangers' browsers; a 3-device tailnet does not need a sweeper.
6. **Keys: generate once at first boot into `$CTRLB_HOME`, not into `config.yaml`.** AnythingLLM's boot-time generate-if-missing is the right ergonomics for a single-user appliance (no CLI step), but the private key must land beside the other secrets under the fd-0600 write-replace path (A11 precedent), never in the YAML the app rewrites. Serve the public key from the existing prefs endpoint alongside `notifications` — that is the shape all three implementers converged on.
7. **`notifications.web_push` as an optional field on `NotificationsCfg`, per the docstring's own plan.** The per-class `events` toggles should gate **both** channels — one policy, two transports. Mastodon and open-webui both enforce per-event on the server; we should too, since the backend is now the producer.
8. **No queue.** Two of three implementers send inline/fire-and-forget; Mastodon's Sidekiq queue is demonstrably scale-driven (connection pooling + fan-out across followers). `asyncio.create_task` at the emit point, matching open-webui's sink, is the honest single-user equivalent.
9. **Validate the endpoint host.** Our subscribe endpoint takes a client-supplied URL the server then POSTs to. Even on a tailnet, ntfy's 6-regex allowlist (and the CVE behind it) is ~10 lines and closes an SSRF primitive; open-webui reached the same conclusion independently for webhook URLs.

## 8. What I could not determine

- **Whether any of them measured Android/Fennec delivery reliability** — the open F1 device-round question. No project has tests or notes on it; ntfy's only mobile-specific code is `Urgency: webpush.UrgencyHigh` with the comment `// iOS requires this to ensure delivery`. (Whether Fennec honours `urgency` is standards-half territory.)
- **AnythingLLM's multi-device behaviour in practice.** The code says a second device overwrites the first; I did not find an issue thread confirming users hit it. UNVERIFIED as a lived complaint, VERIFIED as code.
- **Whether ntfy's transport partition causes a gap** when Web Push is enabled but the push service is slow/down — the WebSocket is not there to cover it. No fallback code path found; I could not find a comment acknowledging the trade-off.
- **Mastodon's `standard` column rollout mechanics** (legacy `aesgcm` → `aes128gcm` migration): the column and both send paths are verified, but not how old rows get flipped. Library-half territory anyway.
- **Real-world 410 rates / how often pruning actually fires** — nothing measurable from source.
- **open-webui's history**: whether Web Push was ever attempted and removed. The `unregisterServiceWorkers` helper suggests a past SW that caused staleness problems, but the shallow clone has no history to check. UNVERIFIED.
