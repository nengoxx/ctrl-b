# R12 — Tailnet presence detection from a Python backend (the Tailscale half)

**Date:** 2026-07-31 · **Scope:** the mechanics of Tailscale itself — CLI, LocalAPI, presence
semantics, Android client behavior. Generic monitor-loop / flap-damping patterns are a **separate
pass** and deliberately absent here.
**Drives:** ROADMAP **D2-A** (wake-on-connection, the `tailscale status` poll half) — joins
`backend/app/services/wake_on_connect.py` (D2-B, shipped) on the same `wake_host` action path.

**Probe environment (all VERIFIED claims below were run here):** emma, Ubuntu, `tailscale` /
`tailscaled` **1.98.9** (`1.98.9-t4fb758c39-g200941d74`, cap 138), tailscaled active since
2026-07-28, socket `/run/tailscale/tailscaled.sock`, `Prefs.OperatorUser = "emma"`, tailnet
`nengoxx.github` with 6 peers (3 online). Source read from a `--depth 1` clone of
`tailscale/tailscale` at `47e52e5f` (2026-07-30, main) **plus the `v1.98.9` tag** — where main and
the shipped release differ, both are quoted, because they differ in a way that matters (§1c).

**Confidence markers:** **VERIFIED** = read in primary source or probed live on this box ·
**REPORTED** = secondary source (issue thread, docs page) · **UNVERIFIED** = expected, not checked.

---

## 0. The short answer

1. **Poll, don't stream.** For one watched device on a homelab box the poll is not merely adequate,
   it is *cheaper and simpler* than the event stream, and the stream cannot deliver the signal you
   actually want (§3.4). Measured: a targeted LocalAPI read is **0.14–0.16 ms and ~1 KB**.
2. **Use the LocalAPI over the unix socket, not the CLI subprocess** — same data, ~30× cheaper, no
   `create_subprocess_exec`. `Status` is one of the few LocalAPI calls Tailscale explicitly marks
   *stable*. Read access needs **no root and no operator** on Linux.
3. **The specced trigger is probably wrong.** "Peer goes offline→online" does **not** mean "the owner
   got home". A phone with Tailscale always-on is online 24/7 over cellular, so arriving home
   produces **no transition at all**; and a phone that drops off in a pocket produces transitions all
   day that have nothing to do with the door. The signal that actually encodes "got home" is the
   peer's **advertised endpoint list containing a home-LAN address** — verified present and
   discriminating on this very tailnet (§3.2). It is *not* in `tailscale status --json`.

---

## 1. The integration surface, ranked

### 1a. `tailscale status --json` (subprocess)

**Schema.** Top-level keys (VERIFIED, live): `Version · TUN · BackendState · HaveNodeKey · AuthURL ·
TailscaleIPs · Self · Health · MagicDNSSuffix · CurrentTailnet · CertDomains · Peer · User ·
ClientVersion`. `Peer` is a **map keyed by the peer's node public key** —
`"nodekey:1653256d4376…"`. Per-peer fields:

```
ID PublicKey HostName DNSName OS UserID TailscaleIPs AllowedIPs Addrs CurAddr Relay PeerRelay
RxBytes TxBytes Created LastWrite LastSeen LastHandshake Online ExitNode ExitNodeOption Active
PeerAPIURL TaildropTarget NoFileSharingReason Capabilities CapMap InNetworkMap InMagicSock InEngine
KeyExpiry
```

**The CLI output IS the LocalAPI body.** VERIFIED by byte-for-byte comparison after JSON
normalization: `tailscale status --json` (11089 B) and `GET /localapi/v0/status` (10068 B) parse to
**identical objects** — the size delta is indentation only. The CLI adds nothing. Handler:

```go
func (h *Handler) serveStatus(w http.ResponseWriter, r *http.Request) {
	if !h.PermitRead { http.Error(w, "status access denied", http.StatusForbidden); return }
	…
	if def.Bool(r.FormValue("peers"), true) { st = h.b.Status() } else { st = h.b.StatusWithoutPeers() }
```

**Cost.** VERIFIED, this box, 10 runs: `tailscale status --json` **median 5.0 ms, max 6.0 ms** wall
clock (dominated by fork/exec of a ~30 MB Go binary). The same data over the socket: **0.23 ms**.

**Permissions — no, it does not need operator.** VERIFIED in source
(`ipn/ipnserver/server.go`):

```go
	if a.ci.IsUnixSock() {
		return true, !a.ci.IsReadonlyConn(operatorUID, logger.Discard)
	}
	return false, false
```

`read` is unconditionally `true` for **any** local process that can open the socket; only `write`
consults root / daemon-uid / operator / local-admin. And the socket is world-accessible on Linux by
design (`safesocket/unixsocket.go`):

```go
func socketPermissionsForOS() os.FileMode {
	if PlatformUsesPeerCreds() { return 0666 }
	return 0600 // Otherwise, root only.
}
```

VERIFIED live: `srw-rw-rw- 1 root root … /run/tailscale/tailscaled.sock`, and both the CLI and raw
socket reads succeed as uid 1000. *(Caveat on the empirical half: emma **is** the configured
operator, so the live run alone doesn't isolate the rule — the source above does.)*

**Schema stability.** Fields are added over releases (`PeerRelay`, `TaildropTarget`,
`NoFileSharingReason` are recent); removals are rare and `ipnstate.Status` is the client-facing type
the GUIs render from. The `Status` LocalAPI call carries the strongest marker Tailscale hands out:
`// API maturity: this is considered a stable API.` (VERIFIED, `client/local/local.go`). Treat
**additive** change as expected and parse leniently.

### 1b. The tailscaled LocalAPI over the unix socket — **the recommendation**

**Endpoints that matter** (VERIFIED, registered in `ipn/localapi/localapi.go`, all present in
v1.98.9): `status`, `whois`, `peer-by-id`, `prefs`, `watch-ipn-bus`.

**Measured on this box** (20 runs each, Python `http.client` over `AF_UNIX`, connection per call —
i.e. *including* connect cost):

| Call | Payload | Median | Max |
|---|---|---|---|
| `GET /localapi/v0/whois?addr=100.64.151.87` | 1243 B | **0.16 ms** | 0.56 ms |
| `GET /localapi/v0/peer-by-id?id=59786803645328516` | 993 B | **0.14 ms** | 0.21 ms |
| `GET /localapi/v0/status` (6 peers) | 10068 B | 0.23 ms | 0.34 ms |
| `GET /localapi/v0/status?peers=false` | 2940 B | 0.18 ms | 3.11 ms |
| `tailscale status --json` (subprocess) | — | 5.0 ms | 6.0 ms |

**`whois` is the right call for D2-A.** VERIFIED live — it takes the **tailnet IP** (`?addr=100.x.y.z`,
with or without `:port`) and returns the raw `tailcfg.Node`:

```json
{"Node": {"ID": 59786803645328516, "StableID": "nzi1D32CNTRL", "Name": "h20.lobster-vector.ts.net.",
  "Online": false, "LastSeen": "2026-07-30T15:55:54.1Z",
  "Endpoints": ["77.209.29.252:13679", "77.209.29.252:13708", "10.23.121.204:38492"], "HomeDERP": 19},
 "UserProfile": {"LoginName": "nengoxx@github", …}}
```

That single 1.2 KB read carries **everything** D2-A needs — `Online`, `LastSeen`, **and `Endpoints`**
(which `status` does *not* expose, §3.2) — keyed on a value that is stable and natural to put in
`config.yaml`. `peer-by-id` returns the same Node but wants the **numeric** `NodeID`, which is not
stable across re-registration; `whois` avoids that indirection entirely.

**Auth / protocol requirements** (VERIFIED, `Handler.ServeHTTP`):

```go
	if r.Referer() != "" || r.Header.Get("Origin") != "" || !h.validHost(r.Host) {
		metricInvalidRequests.Add(1)
		http.Error(w, "invalid localapi request", http.StatusForbidden)
```

`validHost` accepts only `""` or `apitype.LocalAPIHost = "local-tailscaled.sock"`. VERIFIED live: a
request with `Host: example.com` returns **403**; with `Host: local-tailscaled.sock`, 200. Sending a
`Referer` or `Origin` header is also an instant 403 — httpx sends neither by default, but a
misconfigured default-headers dict would break the reader.

Every response carries a free version guard (VERIFIED live):
`Tailscale-Version: 1.98.9-t4fb758c39-g200941d74` and `Tailscale-Cap: 138`.

**Python client: none worth using.** `tailscale_localapi` on PyPI (0.5.0, last upload 2024-11-21) is
sync-only and hard-pins `urllib3==1.26.16` + `requests==2.29.0` — an unresolvable conflict against a
modern httpx stack and an abandonment risk. `python-tailscale` (what Home Assistant uses) is the
**cloud** API, not the LocalAPI. The convention in the field is a hand-rolled HTTP-over-UDS call;
in ctrl-b that is a 5-line `httpx.AsyncClient(transport=httpx.AsyncHTTPTransport(uds=…))` on the
already-pinned `httpx==0.28.1`. (UDS support in httpx: **UNVERIFIED here** — documented feature, not
probed on this box.)

**Stability.** Package doc at main (VERIFIED):

> The APIs in this package vary in maturity: some methods are considered stable APIs and are
> documented as such, while others are not necessarily stable and are subject to change between
> releases. Methods without an explicit "API maturity" note in their documentation should be
> assumed to be unstable.

`Status` and `StatusWithoutPeers` carry the stable marker. `whois` and `peer-by-id` do **not** — they
are unmarked, i.e. formally unstable, though `whois` is load-bearing for `tailscale whois`, Tailscale
SSH and every reverse-proxy identity integration, so the practical churn risk is low. Note also that
this package doc **did not exist in v1.98.9** — the maturity taxonomy itself was added after the
shipped release.

### 1c. The streaming watch — `/localapi/v0/watch-ipn-bus`

**It does push peer online/offline.** VERIFIED in `ipn/ipnlocal/local.go` (identical in v1.98.9 and
at main):

```go
func mutationsAreWorthyOfTellingIPNBus(muts []netmap.NodeMutation) bool {
	for _, m := range muts {
		switch m.(type) {
		case netmap.NodeMutationLastSeen,
			netmap.NodeMutationOnline:
			// The GUI clients might render peers differently depending on whether
			// they're online.
			return true
```

**…and only that.** The other mutation types — `NodeMutationEndpoints`, `NodeMutationDERPHome`,
`NodeMutationUpsert`, `NodeMutationRemove` — are **not** worthy of the bus. So the endpoint change
that actually encodes "the phone joined the home LAN" (§3.2) **is never pushed**. This is the single
fact that settles poll-vs-stream for D2-A.

**Mechanics** (VERIFIED live and in source):
- Query param `mask=<decimal>` (`NotifyWatchOpt.MarshalText` is `strconv.AppendUint`, base 10).
- Response is `Content-Type: application/json`, a **newline-delimited stream of `ipn.Notify`
  objects**, flushed per message. No framing, no cursor, no resume.
- **No heartbeat, and the mask does not fence off unrelated traffic.** The handler is a bare
  `enc.Encode(roNotify); f.Flush()` loop — nothing is emitted on a timer. VERIFIED live: a watcher
  armed with `mask=4096` (`NotifyPeerChanges` **only**) on a live 6-peer tailnet emitted **nothing
  for the first 7 minutes**, then delivered one notify that was an **`Engine` status update** —
  wireguard byte counters and a `LastHandshake` — with `NetMap: null` and no `PeerChanges` at all:

  ```json
  {"Version":"1.98.9-…","NetMap":null,"Engine":{"RBytes":43551744,"WBytes":132478592,"NumLive":1,
   "LiveDERPs":1,"LivePeers":{"nodekey:cf1b20eb…":{"TxBytes":132478592,"RxBytes":43551744,
   "LastHandshake":"2026-07-31T10:43:48.867301608+02:00"}}},"BrowseToURL":null,"DriveShares":null}
  ```

  So `Engine` notifies arrive **regardless of the mask** (`NotifyWatchEngineUpdates = 1<<0` was not
  requested), and a consumer must filter every message rather than treat arrival as an event. In the
  full watch window **zero `Online`/`LastSeen` patches** were seen. Liveness comes only from socket
  EOF — acceptable over a local unix socket (daemon exit closes it immediately), useless as an
  application-level health signal.
- `mask=4106` (`NotifyInitialState|NotifyInitialNetMap|NotifyPeerChanges`) delivers an immediate
  first notify of **24398 bytes** carrying the full netmap including per-peer `Endpoints` — this is
  the one-shot way to read the netmap without a debug endpoint (VERIFIED live).
- With `NotifyPeerChanges` set, the daemon strips the full netmap from subsequent notifies and sends
  the `PeerChanges` patch list instead; **without** it, every online/offline flip ships the whole
  ~24 KB netmap (VERIFIED, v1.98.9 `local.go`):

```go
			if sess.mask&ipn.NotifyPeerChanges != 0 {
				nOut.NetMap = nil   // Skip the full Netmap
			} else {
				nOut.PeerChanges = nil   // Skip the PeerChanges
			}
```

**Stability: actively being reshaped right now.** `WatchIPNBus` is explicitly marked
`// API maturity: this method is not considered a stable API and is subject to change between
releases.` And the reshaping is not hypothetical — between v1.98.9 and main (2026-07-30):

| | v1.98.9 (shipped, on this box) | main @ `47e52e5f` |
|---|---|---|
| highest opt bit | `NotifyPeerChanges = 1<<12` | `NotifyPeerPatches = 1<<15` |
| new bits | — | `NotifyNoNetMap`, `NotifyInitialStatus`, `NotifyPeerPatches` |
| peer patch field | `Notify.PeerChanges` | **renamed** `Notify.PeerChangedPatch` |
| adds | — | `Notify.PeersChanged`, `Notify.PeersRemoved`, `Notify.InitialStatus`, `Notify.UserProfiles`, `Notify.PeerState` |
| `Notify.NetMap` | plain field | **Deprecated**, "only populated on Windows" |

VERIFIED by reading both trees. Also VERIFIED live: a mask of `49152` (bits 14|15) against 1.98.9 is
silently accepted and yields nothing, because those bits don't exist yet — **unknown mask bits fail
open, not loud**. A consumer that upgrades tailscaled across this boundary and keys on
`PeerChanges` gets silence, not an error.

**Reconnect story:** you write it yourself. There is no resume token; on reconnect you must re-read
current state (a `whois`/`status` call) because events during the gap are lost. `InUseOtherUser` is
a Windows-only concern.

### Verdict

**Poll `whois` on a timer.** At 0.16 ms and 1.2 KB per read, a 10-second poll costs ~1.4 ms of CPU
per day; there is no efficiency argument for the stream. The stream costs a persistent connection, a
hand-rolled reconnect loop, a re-sync-on-reconnect that ends up calling the poll endpoint anyway, an
explicitly-unstable API mid-rewrite, **and it still can't see the endpoint change**. What the field
actually does (§5) is uniformly poll.

---

## 2. Presence semantics

### What the fields mean (VERIFIED — `ipn/ipnstate/ipnstate.go`, verbatim)

```go
	Created        time.Time // time registered with tailcontrol
	LastWrite      time.Time // time last packet sent
	LastSeen       time.Time // last seen to tailcontrol; only present if offline
	LastHandshake  time.Time // with local wireguard
	Online         bool      // whether node is connected to the control plane

	// Active is whether the node was recently active. The
	// definition is somewhat undefined but has historically and
	// currently means that there was some packet sent to this
	// peer in the past two minutes. That definition is subject to
	// change.
	Active bool
```

and the underlying wire type (`tailcfg/tailcfg.go`, verbatim):

```go
	// LastSeen is when the node was last online. It is not
	// updated when Online is true. It is nil if the current
	// node doesn't have permission to know, or the node
	// has never been online.
	LastSeen *time.Time `json:",omitempty"`

	// Online is whether the node is currently connected to the
	// coordination server.  A value of nil means unknown, or the
	// current node doesn't have permission to know.
	Online *bool `json:",omitempty"`
```

Three consequences, all VERIFIED live on this tailnet:

- **`Online` is a control-plane fact, not a reachability fact.** Peers `vault` and `G5` report
  `Online: true` with `RxBytes: 0`, `Active: false`, `CurAddr: ""` — this node has never exchanged a
  packet with them. So **yes, `Online` is reliable for peers we are not talking to** (answering the
  Q2 sub-question directly): it is relayed from the coordination server via netmap patches, entirely
  independent of any data path between us and the peer.
- **`LastSeen` is populated only while offline.** Online peers carry the Go zero time
  `0001-01-01T00:00:00Z` in `status` JSON / `null` in the raw Node. Do not use it as a freshness
  clock for online peers — it is not one.
- **`Active` is not presence.** It means "we sent this peer a packet in the last ~2 min" — a property
  of *our* traffic. Only `corsair` (an SSH-managed host) shows `Active: true`.

### Freshness — the numbers that matter for debounce

- **Client↔control liveness: keepalive ≈ 60 s, watchdog 120 s.** VERIFIED, `control/controlclient/direct.go`:

```go
// If we go more than watchdogTimeout without hearing from the server,
// end the long poll. We should be receiving a keep alive ping
// every minute.
const watchdogTimeout = 120 * time.Second
```

  This is *our* side of the map poll. The coordination server runs the mirror image against each
  node, so an **ungraceful** departure (phone loses signal, laptop lid slams) becomes
  `Online: false` on the order of **one to two minutes**, not seconds.
- **Graceful departure is immediate.** `tailscale down`, the Android toggle, app exit → the node
  closes its map poll → control marks it offline and patches peers within seconds. (REPORTED /
  reasoned from the protocol; not measured — I could not toggle a device.)
- **Joining is fast.** A node coming up opens its map poll immediately; control pushes
  `MapResponse.OnlineChange` / `PeersChangedPatch{Online:true}` over every peer's existing long poll.
  Latency ≈ control processing + one RTT — **seconds**. (REPORTED; the client-side receive path is
  VERIFIED in `control/controlclient/map.go:844` `for nodeID, online := range resp.OnlineChange`.)
- **The asymmetry is the design input:** offline detection lags ~0–120 s and is *lossy* under mobile
  conditions; online detection is prompt. Any debounce window shorter than ~2 minutes cannot
  distinguish "left" from "blipped".

**Live observation, weak but worth recording:** an IPN-bus watcher armed on this tailnet saw **zero**
`Online`/`LastSeen` patches across 6 peers in its watch window (§1c) — the only traffic was an
unrelated `Engine` status update. Presence churn on the wired/desktop peers is genuinely rare; the
churn question is entirely about the phone (§3).

---

## 3. Android client presence reality — **the load-bearing section**

### 3.1 What the app is, mechanically

VERIFIED from a `--depth 1` clone of `tailscale/tailscale-android` (2026-07-31):

- `IPNService` is declared `android:foregroundServiceType="systemExempted"` with
  `BIND_VPN_SERVICE`, and the manifest requests `FOREGROUND_SERVICE` +
  `FOREGROUND_SERVICE_SYSTEM_EXEMPTED`. So it is a persistent foreground service — Android will not
  reap it as a background app.
- **It does not defend itself against Doze.** A case-insensitive grep of the entire repo for
  `doze`, `WakeLock`, `PowerManager`, `isDeviceIdleMode`, `isIgnoringBatteryOptimizations`,
  `ignoreBatteryOptimizations` returns **zero hits** across `.kt`, `.java`, `.xml` and `.md`. The app
  never requests the battery-optimization allowlist and holds no wake locks.
- **Android has no push-wake path.** `tailcfg.Hostinfo` (VERIFIED, verbatim):
  `PushDeviceToken string \`json:",omitzero"\` // macOS/iOS APNs device token for notifications (and Android in the future)`.
  iOS nodes can be woken by control on demand; **Android cannot**. Its presence depends entirely on
  the foreground service surviving and keeping network.

**Doze's documented effect** (REPORTED, developer.android.com/training/monitoring-device-state/doze-standby,
verbatim): "The system applies the following restrictions to your apps while in Doze: **Suspends
network access.** Ignores wake locks…" and "Periodically, the system exits Doze for a brief time to
let apps complete their deferred activities. During this *maintenance window*, the system runs all
pending syncs, jobs, and alarms, and lets apps access the network." with "Over time, the system
schedules maintenance windows less frequently." A partial exemption (the battery-optimization
allowlist) "can use the network and hold partial wake locks during Doze" — which the Tailscale app
never asks for, so the user must grant it manually. VPN apps are **not** listed as exempt.

Doze plus a ~60 s control keepalive is arithmetic: as maintenance windows spread out, the keepalive
window is missed, control drops the node, the peer sees `Online: false` — and it flips back at the
next maintenance window or on screen-on. That is a flap generator by construction.

### 3.2 What this tailnet actually shows — the decisive datum

Live netmap, 2026-07-31 08:3x CEST (VERIFIED):

| peer | OS | `Online` | `LastSeen` | advertised `Endpoints` |
|---|---|---|---|---|
| `corsair` | windows | true | — | …, `192.168.1.128:41641` |
| `vault` | windows | true | — | …, `192.168.1.137:41641` |
| `g5` | windows | true | — | …, `192.168.1.154:41641` |
| `yui` | macOS | false | 2026-07-13T01:42:44Z | …, `192.168.1.150:41641` |
| **`p30`** | **android** | **false** | **2026-07-23T09:53:38Z** | `10.129.184.231:54079`, `85.87.5.199:15277`, **`192.168.1.168:54079`** |
| **`h20`** | **android** | **false** | **2026-07-30T15:55:54Z** | `77.209.29.252:13679`, `77.209.29.252:13708`, `10.23.121.204:38492` |

Two findings fall straight out.

**(i) The owner's phones are not continuously on this tailnet.** `h20` has been offline for ~17 h,
`p30` for 8 days. Whether that is Doze, an OEM task killer, or the owner simply toggling Tailscale
off, the observable is the same: **`Online` on these nodes is not a proxy for "the phone exists"**.
Design D2-A against the measured behavior of *this* phone, not against a model.

**(ii) The endpoint list discriminates home-LAN from away, and `Online` does not.** `p30`'s
advertised endpoints include `192.168.1.168` — the home LAN. `h20`'s are `77.209.29.252` (a
different ISP's public address) + `10.23.121.204` (carrier CGNAT) — unambiguously away. That is the
"got home" signal, sitting right there in the netmap, one 1.2 KB `whois` away.

Its limits, stated honestly: endpoints are **advertised by the peer while it is doing endpoint
discovery**, so (a) a stale list survives after the node goes offline — `h20`'s endpoints above are
yesterday's — and (b) the predicate must be `Online == true AND any(endpoint in home_prefix)`, never
the endpoint alone. Endpoint changes *are* pushed by control as
`PeersChangedPatch`/`NodeMutationEndpoints` (VERIFIED, `types/netmap/nodemut.go`), so a poll observes
them promptly; the IPN bus does not forward them (§1c).

Two signals that look useful and are not: `Relay` (DERP home region) reads `mad` for **every** peer
including the cellular phone — geographic, not per-LAN, useless here (VERIFIED). `CurAddr` is
populated only where an active direct session exists (`corsair` only) — it requires traffic, so it
cannot passively observe an idle phone (VERIFIED).

### 3.3 What the field reports about Android churn

- **Tailscale will not stop the VPN on screen-off**, by policy — issue #1330 (`android: turn off VPN
  when screen off?`), closed 2021-06-26, DentonGentry: *"At this point I really don't expect to do
  this. Once the VPN is turned on, especially if using an exit node, I do not believe we can turn it
  off without the user explicitly doing so."* (REPORTED, fetched via `gh api`.) So churn is not
  deliberate — it is environmental.
- **Users report exactly the overnight-drop pattern.** Issue #14070 *"Recent versions of Tailscale on
  Android will stop running after some time"* (2024-11-12): *"When it is enabled on a phone
  overnight, or other device, I mostly will find it disconnected in the morning."* A crash was fixed
  in 1.76.6, yet a later commenter (2025-01-02, 1.78.3, Android 14): *"Tailscale set as permanent VPN
  in networking, **battery optimizations disabled**. We have two phones, both are affected."* Closed
  2025-02-03 as stale. (REPORTED.)
- **Keeping the phone reachable is the acknowledged battery cost.** FR #18281 (2025-12-24, open):
  *"Tailscale constantly attempts to maintain connectivity for NAT traversal, ensuring the device
  remains reachable by other devices… maintaining an always-established stateful connection on mobile
  devices is not something most users need."* Issue #3363 *"Mobile battery usage still bad in some
  situations"* has been **open since 2021-11-21** with 76 comments and a dedicated `battery` label.
  (REPORTED.)
- **Settings that measurably help** (REPORTED, from the threads, no maintainer confirmation of
  magnitude): system **Always-on VPN** (+ "Block connections without VPN"), exempting Tailscale from
  battery optimization, and disabling OEM app-killers (Samsung/Xiaomi/Huawei/Honor). Note `h20` is an
  Honor device — that OEM family is a recurring name in Android background-execution complaints.
- **Tailscale ships no online/offline notification of its own.** FR #14737 (2025-01-22) is still
  open with a year of "+1" comments; FR #5967 (2022-10-17) likewise; FR #15000 asks for
  machine-online/offline webhooks. There is no first-class event to subscribe to — **everyone who
  wants this polls.** (REPORTED.)

### 3.4 The consequence for D2-A as specced

The trigger "owner device transitions offline→online ⇒ fire WOL" has **two failure modes that are
mutually exclusive**, and the phone is in one of them at all times:

- **Phone keeps Tailscale on continuously** → it is online on cellular before it reaches the
  driveway. Walking in the door produces **no transition**. The feature silently never fires.
- **Phone's Tailscale flaps (Doze / OEM killer / signal loss)** → transitions all day, none of them
  correlated with the door. Every one fires WOL. The cooldown in
  `wake_on_connect.py` bounds the *log* noise, not the wrongness.

The evidence on this box points at a third state — Tailscale largely *off* on the phone — in which
the trigger degenerates into "wake the PCs when I open the Tailscale app", which is D2-B with extra
steps.

The endpoint predicate from §3.2 does not have this problem: `Online AND endpoint∈192.168.1.0/24`
is false on cellular, false when off, false when flapping away from home, and true exactly when the
phone is on the home LAN. Its transition false→true *is* "got home".

---

## 4. Failure modes for the reader

**The central rule: `Online: false` and "I could not determine" must be different states.** The
status JSON collapses them — `Online: p.Online().Get()` flattens a nil `*bool` to `false`
(VERIFIED, `ipn/ipnlocal/local.go`). The raw Node from `whois`/`peer-by-id` does not: `Online *bool`
carries `json:",omitempty"`, so **absent key = unknown, `false` = control says offline**. Another
reason to prefer `whois` over `status`.

| Condition | What the reader sees | Treat as |
|---|---|---|
| **tailscaled not running / socket missing** | CLI: exit **1**, **empty stdout**, message on stderr — VERIFIED: `failed to connect to local tailscaled (which appears to be running as tailscaled, pid 1035). Got error: … dial unix …: connect: no such file or directory`. LocalAPI: `ConnectionRefused`/`FileNotFoundError` on connect. | **unknown** |
| **tailscaled restarting, netmap not yet received** | `Peer` map **empty** — VERIFIED, `populatePeerStatusLocked` opens with `if nm == nil { return }`. The watched peer is simply *absent*. | **unknown** — never "offline" |
| **our node fell out of the map poll** | `Self.Online == false` — VERIFIED, `ss.Online = b.health.GetInPollNetMap()`. Every peer's `Online` is now a stale cache. | **unknown**, all peers |
| **logged out / not started** | `BackendState` ∈ `NoState · InUseOtherUser · NeedsLogin · NeedsMachineAuth · Stopped · Starting` (VERIFIED enum, `ipn/backend.go`); peers empty. | **unknown** |
| **peer removed from the tailnet** | absent from `Peer`; `whois` → **404** | **unknown** (and log — config is stale) |
| **ACL hides the peer** | raw Node omits `Online`; status shows `false` | **unknown**. N/A on a single-user tailnet |
| **permissions** | `403 "status access denied"` / `403 "whois access denied"` | **unknown** — config error, not presence |
| **bad Host / stray `Origin`/`Referer` header** | `403 "invalid localapi request"` | **unknown** — client bug |

Only `BackendState == "Running"` **and** `Self.Online == true` **and** the peer present makes the
peer's `Online` a fact. Everything else is unknown, and an unknown must **not** count as an edge.

**Other guards worth writing down:**

- **Never key config on the `Peer` map key or on `PublicKey`** — it is `nodekey:<hex>`, which rotates
  on key expiry/re-auth. Never key on the numeric `NodeID` either (changes on re-registration). Use
  the **tailnet IP** (what `whois` takes), the **`StableID`** (`nzi1D32CNTRL`), or the MagicDNS name.
- **Socket path is not universal.** VERIFIED, `paths.DefaultTailscaledSocket()`: Linux
  `/var/run/tailscale/tailscaled.sock`; Synology `/var/packages/Tailscale/{etc,var}/tailscaled.sock`;
  QNAP `/tmp/tailscale/tailscaled.sock`; Gokrazy `/perm/tailscaled/tailscaled.sock`; macOS
  `/var/run/tailscaled.socket`; Windows a named pipe. On emma the systemd unit passes
  `--socket=/run/tailscale/tailscaled.sock` (same inode as `/var/run/...` via the usual symlink).
  Make the path a config value with the Linux default, don't hardcode.
- **Version-guard for free** using the `Tailscale-Version` / `Tailscale-Cap` response headers rather
  than parsing `Version` out of the body.
- **Unknown IPN-bus mask bits fail silently** (VERIFIED §1c) — one more reason not to build on the bus.
- **`tailscale status --json` prints nothing on stdout when it fails**, so "JSON parse error" is a
  legitimate detector for the subprocess path — but the exit code is the honest one.
- Failure mode **not** probed: an actual `systemctl restart tailscaled` mid-poll (would mutate tailnet
  state; out of scope for this pass). The behavior above is derived from source, not observed.

---

## 5. Field usage (supplement, one paragraph each)

- **Home Assistant `tailscale` integration** — polls the **cloud** API, not the LocalAPI:
  `SCAN_INTERVAL = timedelta(minutes=1)` (VERIFIED, `homeassistant/components/tailscale/const.py`)
  driving a `DataUpdateCoordinator` over `python-tailscale` → `GET /api/v2/tailnet/{tailnet}/devices`
  with an API key. Notably it exposes **no online/offline entity at all** — its sensors are
  `expires`, `ip`, **`last_seen`**, and binary sensors for `update_available` /
  `key_expiry_disabled` / `client_supports_*`. Even the flagship integration models presence as
  "last seen", not a boolean.
- **`cfunkhouser/tailscalesd`** (Prometheus HTTP service discovery) — the closest peer to our
  problem, and it offers **exactly the choice this dossier makes**: `-localapi` ("use the Tailscale
  local API exported by the local node's tailscaled") vs `-token`/OAuth for the public API, with the
  two mutually exclusive since v0.5.0, plus a `--localapi_socket` override. It **polls**
  `/localapi/v0/status` on an interval. (REPORTED, README.)
- **`josh/tailscale_exporter`, `adinhodovic/tailscale-exporter`, `drio/tsmetrics`** — all cloud-API
  pollers with an API key / OAuth, exporting `tailscale_devices_last_seen`,
  `tailscale_devices_expiry_time`, `tailscale_devices_update_available`. Again: **`last_seen` as a
  gauge, no online boolean.** (REPORTED, READMEs.)
- **tsnet ecosystem (golink et al.)** — embeds tailscaled in-process and reaches presence through
  `tsnet.Server.LocalClient().Status()`, i.e. the same `ipnstate.Status` type over an in-process
  LocalAPI. Not applicable to a Python backend, but it confirms `Status()` is the ecosystem's
  presence primitive. (UNVERIFIED — inferred from the `client/local` API surface, not read in golink.)

**The convention, stated plainly: everyone polls, on a 30 s–5 min interval, and the ones that run
beside a tailscaled read `/localapi/v0/status` over the unix socket.** No project found in this pass
consumes `watch-ipn-bus` for presence.

---

## 6. Implications for ctrl-b

1. **Take the endpoint question to the owner before building D2-A.** The specced trigger
   (`Online` false→true) is very likely wrong for a phone (§3.4). Recommended replacement predicate:
   `Online == true AND any(ep.ip in wake.home_prefixes)`, with `home_prefixes` a config list
   (`["192.168.1.0/24"]`) — the same shape as the existing `wake:` section.
2. **Measure before you build.** One `whois` every 30 s, logged to a file for a week, answers "does
   the phone flap, and does the endpoint predicate fire exactly once a day?" for the cost of an
   afternoon. Building the debounce first is guessing at a distribution we can just observe.
3. **Reuse the `_memory_sweep` / `AutomationRunner` lifespan-loop shape** (`automations/runner.py`
   §1) — interval re-read live, blanket exception guard, cancelled and awaited at shutdown. D2-A is
   one more of those, not a new subsystem.
4. **Read via httpx-over-UDS, not a subprocess.** ctrl-b already pins `httpx==0.28.1`; a
   `AsyncHTTPTransport(uds=…)` client is 5 lines and 30× cheaper than `create_subprocess_exec`, and
   it keeps `fleet._ping_cmd`'s OS-branch allowlist untouched (no new server-OS branch — the socket
   path becomes config, which is the pattern the allowlist exists to protect).
5. **Model three states, not two** (`ONLINE / OFFLINE / UNKNOWN`) and make UNKNOWN sticky: an edge
   fires only on a confirmed OFFLINE→ONLINE, never on UNKNOWN→ONLINE. Otherwise every tailscaled
   restart and every backend restart wakes the fleet — the exact class of bug D2-B already ruled on
   once ("first connect after a backend restart wakes all flagged hosts", owner-ruled intended
   *there* because a human action triggered it; here nothing did).
6. **Debounce floor ~2 minutes**, from `watchdogTimeout = 120s` (§2). Anything shorter cannot tell a
   departure from a keepalive blip.
7. **Config keys on the tailnet IP or `StableID`**, never the nodekey or numeric NodeID (§4).
8. **Reuse `wake_on_connect.py` wholesale** — the `ActionService.invoke(… origin=system,
   actor=SYSTEM, interactive=False)` chokepoint, the per-host monotonic cooldown, the
   `cached_online_ids()` skip, the detached-task guard. D2-A supplies a different *edge*; everything
   downstream of the edge already exists and is audited.
9. **Do not build on `watch-ipn-bus`** — unstable by its own doc, mid-rewrite between 1.98.9 and
   main, fails open on unknown mask bits, has no heartbeat, needs a hand-rolled resync, and cannot
   see the endpoint change we actually want.

---

## 7. What I could not determine

- **The coordination server's own offline timeout.** Control is closed-source; 120 s is the
  *client's* watchdog and the ~60 s keepalive is a comment, not a contract. The true "how long until
  control marks a silent node offline" is inferred, not established.
- **Measured online→offline and offline→online latency.** Both require toggling a device's Tailscale
  state, which is a tailnet mutation and out of scope for this pass. An owner-run measurement (turn
  the phone's Tailscale off, poll `whois` every 2 s, record the flip) would settle §2 in ten minutes.
- **Whether `h20`'s 17-hour absence is Doze, an Honor task-killer, or the owner toggling Tailscale
  off.** This is the single fact that decides whether D2-A is buildable as specced, and it is an
  owner question, not a research one.
- **Whether the Android app's foreground service actually survives Doze in practice on the owner's
  device**, with and without the battery-optimization exemption. The source says it asks for no
  exemption; the field says results vary by OEM; only the owner's phone answers it.
- **httpx UDS transport behavior against this socket** (connection reuse, timeout semantics,
  the `Host` header httpx sends by default for a `uds=` transport). Documented feature, not probed —
  worth a 10-line spike before committing to the design, since a wrong default `Host` is a 403.
- **`peer-by-id` / `whois` long-term stability.** Neither carries an "API maturity" note; both are
  widely used internally. Judged low-risk, not verified as guaranteed.
- **golink / tsnet presence usage** — inferred from the `client/local` surface, not read.
- Nothing in this pass covers **poll-loop structure, thresholds, hysteresis or alerting** — that is
  the parallel monitoring-patterns pass, by design.
