# R63 — LAN-arrival wake trigger: probing a phone on Wi-Fi, damping Doze, and quiet hours

**Date:** 2026-09-04 · **Question:** the owner wants a *second* wake-on-presence source — the phone's
arrival on the **home LAN** (reserved DHCP IP), alongside the shipped tailnet trigger (D50) — plus
**quiet hours**. The known hard problem is Android Doze / Wi-Fi power-save producing spurious
"left and came back" edges. **Reference class:** Home Assistant (the peer for presence detection) +
AOSP (the authority on what an idle Android answers) + the Linux kernel neighbour subsystem.
**Drove:** the reopening of ROADMAP D2 option C (nothing locked yet).

**Confidence marks used throughout:** **[V]** = I read the source / measured it on emma ·
**[R]** = secondary source (docs, community) · **[U]** = expected but not checked.

---

## 0. Summary — the six findings that decide the design

1. **The recorded rejection reason is factually wrong. [V]** ROADMAP D2 rejects option C because
   "Android suppresses ping (battery)". AOSP's packet filter does the *opposite*: it explicitly
   **passes** unicast ARP-for-us and unicast ICMP-echo-for-us to the CPU while the screen is off,
   and on APFv6 hardware the **Wi-Fi firmware answers them itself** without waking the CPU. Doze
   suspends *apps'* network access, not the device's IP stack. §1.
2. **ARP is the better probe than ICMP, but only marginally — and the real win is that it gives a
   clean tri-state. [V]** Nmap uses ARP for same-LAN targets *regardless of the ping type you ask
   for*; HA's `nmap_tracker` ships `-PR` (ARP ping) as its default. On Linux the ARP answer is
   readable straight out of the kernel neighbour table with **no new dependency, no root and no
   `arping`**: send one empty UDP datagram, then read `ip neigh` — `REACHABLE` / `INCOMPLETE` /
   `FAILED` maps 1:1 onto ctrl-b's existing `Liveness` = `up`/`unknown`/`down`. §1.3, §1.4.
3. **The residual Doze risk is not "no reply", it is "left the Wi-Fi link entirely".** HA's own docs
   warn about exactly this and nothing else: *"modern smart phones will usually turn off WiFi when
   they are idle"* **[R]**. A phone that drops the association is indistinguishable from a phone
   that left the house — which is why the damping constant, not the probe, is the load-bearing
   choice. §2.
4. **The field's damping constant converges on one number: `consider_home = 180 s`** (HA's global
   default, used by both the ping and nmap trackers), configurable up to **21 600 s (6 h)**. **[V]**
   Its shape is *exactly* ctrl-b's `arm()` machine: a device must be continuously unseen for
   `consider_home` before it counts as away, so a shorter gap can never produce an arrival. Our
   `presence_offline_after_s = 120` is *below* the field's floor and was tuned for a tailnet
   source; a LAN source needs a much larger value. §2.
5. **Two presence sources should be OR'd at the OBSERVATION level, not at the edge. [V]** HA's
   `person` entity is the field's canonical multi-source combiner and it is a positive-bias
   precedence ladder: unknown/unavailable trackers are *skipped*, any tracker reporting home wins,
   `not_home` is the fallback of last resort. Applied here: one arming machine per device fed by
   `online if ANY source says online`. This is what makes the tailnet source *cancel* the LAN
   source's Doze flaps for free. §4.2.
6. **Quiet hours must gate the ACTION while the edge is still CONSUMED. [V-by-code-reading]** If the
   suppression skips the fire *before* the arming machine disarms, the edge is held and detonates
   the instant the window ends — a 03:00 arrival wakes the fleet at 08:00:00 sharp. The field has no
   deferred-trigger primitive at all (HA drops a blocked trigger silently); users who want deferral
   build an explicit latch. §3, §4.4.

---

## 1. (A) Detection mechanism — what actually answers on a dozing Android

### 1.1 What Doze restricts — primary source **[V]**

`developer.android.com/training/monitoring-device-state/doze-standby`, verbatim list:

> The system applies the following restrictions to your apps while in Doze:
> * Suspends network access.
> * Ignores wake locks.
> * Defers standard `AlarmManager` alarms […] to the next maintenance window.
> * Doesn't perform Wi-Fi scans.
> * Doesn't let sync adapters run.
> * Doesn't let `JobScheduler` run.

"**your apps**" is the operative scope. Doze is an app-lifecycle mechanism. It says nothing about the
kernel IP stack, and the device stays associated to the AP.

### 1.2 What the Wi-Fi layer does with ARP and ICMP — AOSP source **[V]**

Read at `packages/modules/NetworkStack/src/android/net/apf/ApfFilter.java` (main, 4 668 lines,
fetched 2026-09-04). APF is the bytecode program Android installs **into the Wi-Fi firmware**;
AOSP's public doc says it "must be enabled when the screen is off and either the Wi-Fi link is idle
or traffic is less than 10 Mbps" **[R]**.

`generateArpFilter()`, its own summary comment verbatim:

```
// if ARP request:
//   if interface has IPv4 address
//     if target ip is not the interface ip
//       drop
//   pass
```

and the offload branch, when the firmware speaks APFv6:

```java
if (enableArpOffload()) {
    v6Gen.addAllocate(60)
         … build an ARP reply from mHardwareAddress / mIPv4Address …
         .addTransmitWithoutChecksum()
         .addCountAndDrop(DROPPED_ARP_REQUEST_REPLIED);
}
```

So an ARP request **for the phone's own IP** is either answered by the firmware without waking the
application processor (`DROPPED_ARP_REQUEST_REPLIED`) or passed to the CPU which answers it
(`PASSED_ARP_REQUEST`). ARP for *other* hosts is dropped (`DROPPED_ARP_OTHER_HOST`) — which is why a
broad LAN sweep is wasteful but a targeted probe is not.

**ICMP echo is offloaded too** — `generateUnicastIpv4PingOffload()` builds a full echo *reply* in
firmware and ends `.addCountAndDrop(DROPPED_IPV4_PING_REQUEST_REPLIED)`. It is gated on the packet
being unicast to the device's own MAC **and** its own IPv4 address, unfragmented, no IP options. The
AOSP public doc mentions ARP/NS offload but **not** ping offload — the source is ahead of the doc
**[V vs R]**.

The screen-off / doze coupling in APF is on the **multicast** filter only: *"Listen for doze-mode
transition changes to enable/disable the IPv6 multicast filter"* — unicast-to-us traffic is never in
the doze-gated path.

> **Verdict on the ROADMAP's reason ①:** "Android suppresses ping (battery)" is **refuted as
> stated**. Android goes out of its way to keep both ARP-for-us and ping-for-us answerable while
> idle, moving the answer into firmware precisely so the phone need not wake to give it.

### 1.3 ARP vs ICMP — what the field sends

| Peer | What it sends | Verified from |
|---|---|---|
| HA `ping` device_tracker | **ICMP echo**, via `icmplib.async_ping` (`ICMP_TIMEOUT = 1` s, count default **5**) or a `ping -n -q -c <count> -W1` subprocess fallback | `components/ping/{helpers,const,coordinator}.py` **[V]** |
| HA `nmap_tracker` | **ARP ping** — default options `-n -sn -PR -T4 --min-rate 10 --host-timeout 5s` | `components/nmap_tracker/const.py:DEFAULT_OPTIONS` **[V]** |
| HA `dhcp` NetworkWatcher | **ARP** (+ reverse-DNS) via `aiodiscover`, whole-subnet, every 60 min | `components/dhcp/__init__.py:SCAN_INTERVAL` **[V]** |
| HA `dhcp` DHCPWatcher | **passive** — sniffs `udp and (port 67 or 68)` | `aiodhcpwatcher` **[V]** |
| HAPT (oxan) | **802.11 association/disassociation events** off the hostapd control interface | README **[R]** |
| monitor.sh | Bluetooth LE `name` requests — out of class for a Wi-Fi phone, but see §2.3 | README **[V]** |

Nmap's own book is explicit that ARP is not merely one option among many **[R]**:

> "Hosts frequently block IP-based ping packets, but they generally cannot block ARP requests or
> responses and still communicate on the network. Even if different ping types (such as `-PE` or
> `-PS`) are specified, Nmap uses ARP instead for any of the targets which are on the same LAN."

HA's `ping` doc states the converse trade honestly **[V]**: *"Because ping uses the configured
address, it does not need the device MAC address. This can help with devices on another subnet,
where methods that depend on ARP, such as some network scans, do not work."* — irrelevant here; the
phone is on emma's own /24.

**Practical difference for an idle phone: small.** Both are answered per §1.2. ARP's advantages are
(a) it is one L2 round trip with no IP stack involvement at all, (b) on APFv6 it is answered by
firmware even in the narrow window where the ping-offload preconditions are not met, and (c) — the
real one — **Linux hands you its result as an explicit three-valued state**, below.

### 1.4 The unprivileged ARP probe, measured on emma **[V]**

`aiodiscover` (the library HA's `dhcp` integration uses) does not shell out to `arping` and does not
open a raw socket. `aiodiscover/network.py`:

```python
def async_populate_arp(ip_addresses):
    """Send an empty packet to a host to populate the arp cache."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, 0)
    sock.setblocking(False)
    for ip_addr in ip_addresses:
        with suppress(Exception):
            sock.sendto(b"", (ip_addr, 80))
    return sock
```

…then `await asyncio.sleep(ARP_CACHE_POPULATE_TIME)` (**10 s**) and read the neighbour table
(pyroute2 netlink, falling back to `arp -a -n`). A zero-byte UDP datagram to a same-LAN address
forces the kernel to resolve the MAC; nothing is delivered to the target's application layer.

Measured on emma (192.168.1.160/24, eno1, uid 1000, no capabilities):

| Case | Observed |
|---|---|
| Live host, cold entry | `INCOMPLETE` → `REACHABLE` in **< 50 ms** |
| Absent host (192.168.1.222) | `INCOMPLETE` held ~3 s → **`FAILED`** by t+5 s |
| Entry expiring out of `REACHABLE` while host is live | `REACHABLE` → `DELAY` at ~t+3 → unicast probe → `REACHABLE` again at **t+9 s** |
| `ping -c 1 -W 2` live / absent | **0.00 s** / **2.00 s** (blocks for the full timeout) |

The `FAILED` timing follows directly from the kernel knobs, also read on emma:
`mcast_solicit = 3` × `retrans_time_ms = 1000` → ~3 s to give up; `base_reachable_time_ms = 30000`
(the kernel randomises the actual `REACHABLE` lifetime over 0.5–1.5× → **15–45 s**);
`delay_first_probe_time = 5`; `gc_stale_time = 60`.

**Two traps this measurement exposes:**

- **`/proc/net/arp` is unusable for presence. [V]** It collapses the NUD state into one flag bit:
  emma's table shows `0x2` for `REACHABLE`, `STALE` *and* `DELAY` alike, and `0x0` for both `FAILED`
  and `INCOMPLETE` — and it still carries a MAC for an entry `ip neigh` calls `INCOMPLETE`. Only
  `ip neigh` (or netlink) exposes the state machine. `aiodiscover`'s `arp -a -n` fallback has this
  exact weakness; it is harmless for *discovery* and wrong for *presence*.
- **A `STALE` entry is not evidence of anything.** Sending to a `STALE` entry moves it to `DELAY`
  and the kernel waits `delay_first_probe_time` (5 s) before it actually probes — so "probe, sleep
  1 s, read" reports the *old* answer. Either wait ≥ 6–8 s (aiodiscover's 10 s is this, rounded up)
  or treat only `REACHABLE` as present and `FAILED`/absent as away, with everything else `unknown`.

**Tooling reality on emma [V]:** `arping`, `arp-scan` and `nmap` are **not installed**; `ip` and
`ping` are. `ping` carries `cap_net_raw=ep` and `net.ipv4.ping_group_range = 0 2147483647`, so
unprivileged ICMP datagram sockets are available in-process too (that is what `icmplib`'s
non-privileged mode uses) — but adding `icmplib` buys nothing our `fleet._ping_cmd` subprocess
doesn't already do.

### 1.5 The push mechanisms (and why they are out of reach here)

The only mechanisms *structurally immune* to Doze are the ones that observe the **join**, not a
probe reply:

- **802.11 association events** (HAPT via hostapd; every router integration in HA). Needs a
  controllable AP — out of scope per the brief. Noted as the pattern: it is the reason router-based
  trackers are the ones HA's `person` ladder ranks highest (§4.2).
- **Passive DHCP sniffing.** A phone joining the SSID always transacts DHCP, so a `DHCPREQUEST` from
  the phone's MAC *is* the arrival event, with no probing at all. HA does exactly this
  (`aiodhcpwatcher`, BPF `udp and (port 67 or 68)`). **Cost: `CAP_NET_RAW`** — the library's own
  error string is *"Cannot watch for dhcp packets without root or CAP_NET_RAW"* **[V]**. ctrl-b's
  prod backend runs as a **systemd *user* unit** (D32), and capability-granting directives are
  system-manager-only **[R]** — so this would require a root-installed setcap'd helper. Given
  CLAUDE.md's "never weaken the security boundary", this is a real escalation for a convenience
  feature, and it should be recorded as considered-and-declined rather than silently omitted.

---

## 2. (B) Damping — the number that kills the Doze re-fire

### 2.1 `consider_home` — what it is and where it lives **[V]**

`homeassistant/components/device_tracker/const.py`:

```python
CONF_CONSIDER_HOME: Final = "consider_home"
DEFAULT_CONSIDER_HOME: Final = timedelta(seconds=180)
```

It is **not** a smoothing filter — it is a one-sided hold on the *away* transition, implemented
twice, in two different shapes, both of which say the same thing:

- **`ping`** — `PingDeviceTracker.is_connected` stamps `_last_seen` on every successful ping and
  returns `self._last_seen is not None and (utcnow() - self._last_seen) < consider_home`. A device
  is home for 180 s after its last reply, whatever happened since.
- **`nmap_tracker`** — `_async_device_offline` records `first_offline` on the first miss and refuses
  to dispatch "not home" until `first_offline + consider_home < now`.

The consequence is the whole point: **because "arrived" is a `not_home → home` transition, and
`not_home` cannot be reached until the device has been continuously unseen for `consider_home`, a
gap shorter than `consider_home` cannot produce an arrival.** A 10-minute doze-gap with
`consider_home = 180 s` *would* still produce a spurious arrival; with `consider_home = 900 s` it
would not. The field ships 180 s and lets you raise it: `nmap_tracker`'s config flow bounds it at
`MAX_CONSIDER_HOME = MAX_SCAN_INTERVAL * 6 = 21 600 s` (**6 hours**) **[V]** — the field explicitly
anticipates people needing hours, not minutes, for phones.

**ctrl-b already has this machine.** `monitor.arm()` is `consider_home` in its nmap shape:
continuous healthy OFFLINE for `wake.presence_offline_after_s` arms; the next healthy ONLINE is the
edge; UNKNOWN disarms. The only thing that changes for a LAN source is the **constant** — 120 s was
chosen against a tailnet signal whose OFF state is a deliberate act, not a radio.

### 2.2 The other damping knobs the field ships **[V]**

- **`nmap_tracker.home_interval`** (minutes, default **0** = off): hosts seen within the interval are
  `--exclude`d from the next scan. Its purpose is stated in HA's own docs as sparing *the tracked
  device's* battery — *"The lower the number, the quicker it will detect devices connected and
  disconnected usually at the cost of the devices battery life."* It is a scan-cost knob, **not** a
  flap-suppression knob, and it is irrelevant to a single-target probe.
- **Probe repetition inside one observation:** HA's ping tracker sends **5** echoes per check by
  default (`DEFAULT_PING_COUNT = 5`, `ICMP_TIMEOUT = 1` s each, `PING_ATTEMPTS_COUNT = 3` in the
  binary-sensor path). ctrl-b's `fleet._ping_cmd` sends **one** (`-c 1 -W <int secs>`). Against a
  power-saving phone, one packet with a 2 s wait is measurably weaker evidence than five — this is
  the cheapest single robustness win available and it needs no new machinery, only a count
  parameter on the probe used for presence (leaving the fleet sweep's `-c 1` alone).
- **Asymmetric attempts by direction:** monitor.sh ships `PREF_ARRIVAL_SCAN_ATTEMPTS = 1` /
  `PREF_DEPART_SCAN_ATTEMPTS = 2` and `PREF_MINIMUM_TIME_BETWEEN_SCANS = 15` **[V]** — it damps
  *departure* harder because a false depart is its expensive error. **Our polarity is inverted**: a
  false *arrival* costs a spurious fleet wake, so the hard damping belongs on the arrival side. Same
  principle, opposite direction, and worth stating explicitly so nobody copies the constant.

### 2.3 What the field will *not* give you

There is no published, measured "how long does a real Android Wi-Fi gap last" number. HA's position
is a warning, not a measurement, and it is the same sentence in both docs **[V]**:

> nmap_tracker: *"Please keep in mind that modern smart phones will usually turn off WiFi when they
> are idle. Simple trackers like this may not be reliable on their own."*
> ping: *"Phones may turn off Wi-Fi when they are idle. A single ping tracker may not be reliable on
> its own."*

Both docs' remedy is the same and it is architectural, not numeric: **combine sources** (attach the
tracker to a `person` alongside the companion app or a router tracker) — §4.2. Community threads on
Android ping-tracker flapping are numerous but contain no measurement worth citing **[R]**; the one
concrete claim recurring in them ("raising `consider_home` doesn't fix it") is consistent with §1.2:
if the phone has actually left the *link*, no probe-side constant short of hours can tell that from
leaving the house.

### 2.4 Two Android-specific gotchas for a *reserved-IP* design

- **MAC randomisation does not break the reservation, in the default case. [R]** AOSP's
  `wifi-mac-randomization-behavior`: **persistent** (stable per-SSID) randomisation is the default;
  **non-persistent** applies only when a suggestion app asks for it or on *open* SSIDs with an
  overlay that is `false` by default. Non-persistent MACs re-randomise when *"the current randomized
  MAC for the network profile was generated more than 24 hours ago"* and only *"at the start of a
  new connection"*. On a WPA2 home SSID the phone's MAC — and therefore its DHCP reservation — is
  stable. **Residual:** "forget network", a factory reset, or a per-network toggle change mints a new
  MAC and silently strands the reservation. A reserved IP that stops answering forever is the
  failure mode this feature is worst at surfacing (the same hazard D50 called out for a stale
  `presence_device_ips` entry, which is why `_whois` logs a stale-config warning).
  ⇒ **Verdict on ROADMAP reason ②** ("phone IPs churn"): closed by the reservation, with a named
  residual worth a log line.
- **OEM power management.** The owner's device is an **Honor 20** (Huawei/EMUI lineage) — the
  aggressive-power-management family. Nothing in AOSP guarantees an OEM keeps the association up
  while idle; the §1.2 guarantees only hold *while associated*. This is the single largest unknown
  in the whole design and only a live capture answers it (§6).

---

## 3. (C) Quiet hours

### 3.1 The field's expression **[V]**

HA models this as a **condition on the automation**, never as a property of the trigger. Docs
verbatim:

```yaml
conditions:
  - condition: time
    after: "15:00:00"
    before: "02:00:00"
    weekday: [mon, wed, fri]
```

> *"Note that if only `before` key is used, the condition will be `true` from midnight until the
> specified time. If only `after` key is used, the condition will be `true` from the specified time
> until midnight. Time condition windows can span across the midnight threshold if **both** `after`
> and `before` keys are used. […] The after times are inclusive while before are exclusive."*

The implementation (`helpers/condition.py:time()`) is **eight lines**, and its docstring states the
whole trick:

```python
"""Handle the fact that time is continuous and we may be testing for
a period that crosses midnight. In that case it is easier to test
for the opposite. "(23:59 <= now < 00:01)" would be the same as
"not (00:01 <= now < 23:59)"."""
now_time = dt_util.now().time()          # LOCAL time, not UTC
if after < before:
    if not after <= now_time < before: return False
else:                                     # the window wraps midnight
    if before <= now_time < after: return False
```

Three things worth copying verbatim: it compares **wall-clock `time` objects in local time** (never
datetimes, never UTC), it handles the wrap by inverting the comparison rather than by splitting the
window into two, and the weekday check is a separate, independent clause layered on top.

### 3.2 What to reuse in ctrl-b **[V]**

ctrl-b has **no** quiet-hours concept anywhere today (`rg -i "quiet.hours|do not disturb"` over
`docs/` and `backend/app/` → nothing). What it *does* have is the local-time resolution seam:
`services/automations/schedule.py` exports **`server_tz_key()`** (cached; `TZ` → `/etc/localtime`
symlink → `UTC` floor) and **`resolve_tz()`** (validates an IANA key, `ScheduleError` with an
owner-facing message), both re-exported from `services/automations/__init__.py` and already consumed
by `api/automations.py`.

A quiet-hours check should reuse **exactly those two functions and nothing else from A3**. It
must **not** go through `cronsim`: a cron expression names *instants*, and a window is an
*interval* — `next_fire`/`_future_fires` answer a different question and would need a second
"…and is now inside the window?" computation on top anyway. The whole check is
`datetime.now(ZoneInfo(tz)).time()` plus HA's eight lines — a pure function, unit-testable exactly
like `step()` and `arm()` already are, with no clock injection beyond a `now` parameter.

**DST is a non-issue for a window, unlike for a schedule.** A6's `_future_fires` epoch-filter exists
because a *fire instant* can be duplicated or skipped by the fold; "is the local wall clock inside
[23:00, 08:00)?" is well-defined at every instant of a fold or a spring-forward — the window is just
one hour shorter or longer that night. Do not port the fold machinery.

### 3.3 "The arrival happened during the blocked window" — what peers do

**Nothing. [R, reasoned from the model]** In HA, a trigger that fires while its condition is false is
simply dropped; there is no built-in deferral, no queue, no "run it when the condition clears"
primitive. The idiomatic user answer is an explicit latch — an `input_boolean` set by the blocked
automation and consumed by a second automation triggered at the window's end. The field's position,
in other words, is that **deferral is a separate automation, authored deliberately** — never an
implicit property of the suppressed trigger.

That maps cleanly onto ctrl-b: "the fleet should be up when I wake" is an **A3 scheduled
automation** (shipped, D49) and not something the presence trigger should grow. And there is already
a second safety net for the morning-after case that HA doesn't have: **D2-B wake-on-connect** fires
when the owner opens the dashboard, which is exactly what someone who woke up and wants their
servers does.

---

## 4. (D) Fit sketch — where a second source plugs into `monitor.py`

*Sketch only. Nothing here is a ruling; each item names the alternative it was weighed against.*

### 4.1 The seam already exists, and it is `read_presence`'s return type

`adapters/tailnet.py` hands the loop `dict[str, DeviceReading]` where
`DeviceReading = (ip, state ∈ {online, offline, unknown}, reason)`. That contract is **already
source-agnostic** — it says nothing about tailscaled — and `monitor.arm()` consumes only the
`PresenceState`. So a LAN reader is a sibling adapter (`adapters/lan_presence.py`) obeying the same
three rules `tailnet.py`'s docstring pins: *offline and "couldn't tell" are never the same answer* ·
*it never raises* · *a health gate runs first and gates everything*.

The LAN reader's mapping, from the §1.4 measurements:

| Observation | `PresenceState` | Why |
|---|---|---|
| neighbour entry `REACHABLE` (or ICMP reply) | `online` | an ARP reply within the last ≤45 s |
| `FAILED`, or entry absent after a completed probe, or ICMP timeout | `offline` | the kernel asked 3× and got nothing |
| `INCOMPLETE` / `DELAY` / `STALE` / probe not yet resolved / interface down / no route to the subnet | `unknown` | a check that has not *completed* is not evidence of absence |

That last row is the health gate, and it is the LAN analogue of D50 H2: **if emma's own link is
down, or the probe never resolved inside the tick, every LAN device is `unknown` for that tick** —
never `offline`. Without it, unplugging emma's Ethernet arms every device and the next reconnect
wakes the whole fleet.

Note the reuse that falls out for free: `HostStatus.error → unknown` is *already* what
`monitor.observe()` does, so an ICMP-based LAN reader can be `observe(await ping_addr(ip))` with a
one-line `Liveness → PresenceState` rename. If the ARP route is taken instead, the OS-branch
allowlist stays untouched (`ip neigh` is Linux-only, but so is the tailscaled socket path — and
D50/ARCHITECTURE §6 already ruled that a path/mechanism carried in *config* is not an OS branch).
If the ICMP route is taken, `fleet._ping_cmd` is the existing allowlisted chokepoint and must be
*shared*, not copied — extracting `ping_addr(ip, count, timeout)` from `ping_host()` keeps the
allowlist at one entry and gives the presence probe its `count > 1` (§2.2) without touching the
fleet sweep's `-c 1`.

### 4.2 Composition: OR at the observation, one arming machine per DEVICE

The field's canonical multi-source combiner is HA's `person` entity, and it is a **positive-bias
precedence ladder** — `components/person/__init__.py:_update_state()`, verbatim comment:

> *"A scanner (e.g. a router or beacon) that reports being in a zone is the most reliable presence
> signal, so it takes precedence over everything else."*

```python
if state.state in IGNORE_STATES:   # (unknown, unavailable) → skipped entirely
    continue
…
latest = latest_connected or latest_legacy_home or latest_gps or latest_not_home
```

`not_home` is last in the chain: **a source is only believed to say "away" when nothing else says
"home", and an unavailable source contributes nothing.** Ported to our two sources:

```
combined(device) = online   if ANY source says online
                 = unknown  if NO source says online and no source says offline
                 = offline  only if at least one source says offline and none says online
```

feeding **one** `ArmState` per device. The alternative — one arming machine per `(device, source)`
pair, edges OR'd at the fan-out — is simpler to write and strictly worse: it lets the LAN source
manufacture its own Doze edges while the tailnet source is calmly reporting the phone online the
whole time. Combining at the observation level makes the steadier source *cancel* the flappier one,
which is the entire reason HA tells people to attach two trackers to a person.

Two consequences worth pinning if this shape is chosen:

- One device with two addresses = **one** arming machine ⇒ the existing D50 M3 multi-device
  coalescing ("phone and laptop arrived in one tick ⇒ one fan-out") covers "arrived on LAN and on
  tailnet in one tick" for free, with no new code.
- The per-device state key can no longer be the tailnet IP (`self._state.devices[ip]`). It becomes a
  device **name/id**, and D50 M2's "never reuse state across ips" rule generalises to "prune and
  re-baseline whenever a device's *address set* changes".

### 4.3 Cadence and config shape

**Same loop, same tick.** `monitor.poll_seconds = 30` is already exactly HA's ping-tracker cadence
(`PingUpdateCoordinator(update_interval=timedelta(seconds=30))` **[V]**) and comfortably faster than
`nmap_tracker`'s 120 s. A second loop would have to re-earn overlap protection, live-config
reconciliation, silent baselining and the shutdown handshake — all four already pinned in D50's
`loop()`. The LAN probe costs ≤ 2 s worst case (measured, §1.4) inside a 30 s budget. The one thing
to check is that the ARP-probe's settle wait (§1.4: 6–8 s if `STALE` states must be resolved) still
fits, which it does — but it argues for *probe-now, read-next-tick* over *probe-and-sleep* if the
sleep would ever approach the tick.

**Config shape — the hard rule bites here.** Today: `wake.presence_device_ips: list[str]`. Adding
`wake.presence_lan_ips: []` beside it is precisely the *"parallel sibling maps keyed by the same
name"* anti-pattern CLAUDE.md forbids, and it is the version that gets expensive: a third dimension
(per-device `offline_after_s`, per-device enable, a friendly name for the Event summary) means a
third top-level list and a third merge site. The unified shape is one list of device **objects**:

```yaml
wake:
  presence_devices:
    - name: phone            # what the Event summary and the log line say
      tailnet_ip: 100.x.y.z  # optional
      lan_ip: 192.168.1.xxx  # optional — at least one required
      offline_after_s: 900   # optional per-device override of the global
```

with the existing `presence_device_ips` folded into it at the load boundary and the old key deleted
on write-back (the "no legacy seams" standing rule; `config_migration` schema 7→8). The per-host
side needs **no** new field: `wake_on_presence` already means "wake me when the owner arrives", and
that sentence does not care which radio noticed. Making it source-selective would be a per-host
dimension the owner has not asked for.

**One global constant is likely wrong for two sources.** `presence_offline_after_s = 120` is right
for the tailnet (its OFF state is a deliberate act) and far below the field's floor for a LAN radio
(§2.1: 180 s default, 21 600 s ceiling). Either the constant moves onto the device object (per the
shape above) or it becomes per-source. Both are additive; the per-device field is the one that also
serves the next dimension.

### 4.4 Where the quiet-hours check goes — and the trap in it

**At the acting boundary, in `_wake_on_presence`, beside the existing master-switch recheck** — not
in `arm()`, not in `_tick_presence`. Reasons: it is a *policy on the action*, it must be read from
live config so a Conf edit applies with no restart (the same reason D50 M2 rechecks `cfg.enabled`
there), and keeping the arming machine free of clock-dependent policy keeps `arm()` the pure,
clock-free function the tests pin.

**The trap, and it is mechanical, not stylistic.** `arm()` returns `(next_state, edge)` and the
caller *consumes* the edge by storing `ArmState()` — disarmed. If the quiet-hours check is placed so
that a blocked window prevents the arming machine from advancing, the device stays **armed**, and
the very next tick after 08:00:00 — with the phone online and unchanged since 03:00 — fires. A
suppressed arrival silently converts into a scheduled fleet wake at the boundary of the window,
which is the opposite of what "quiet hours" means to the person who set it.

So the ruling the main seat needs to make explicitly is: **the edge is always consumed; only the
`ActionService.invoke` fan-out is skipped.** Concretely, the check belongs *after* the state write
and *inside* `_wake_on_presence`, in the same place and with the same "log why nothing happened"
treatment as the existing `if not self.cfg.enabled: return`. The Event log then has no row and the
journal has one line saying the arrival was seen and suppressed — which is the honest record, and it
is also the diagnostic the owner will want the first morning they wonder why nothing came up.

Corollary, and worth saying out loud in the D-entry: **"arrived at 03:00" produces no wake at all
that night, by design.** The morning path is D2-B (opening the dashboard wakes the flagged hosts) or
an A3 automation on a schedule — both shipped. Building deferral into the presence trigger would
reinvent A3's scheduler behind a name that does not say so.

**Scope of the window — a question, not a recommendation.** Quiet hours should almost certainly gate
the **presence** trigger (automatic, unbidden) and *not* D2-B (the owner explicitly opened the app at
03:00 — suppressing that is user-hostile). Both fires share `wake_on_connect.cooldowns`, so a window
placed on the shared map by accident would silently gate both. Global on `WakeCfg` as one nested
object (`quiet_hours: {start, end, tz?, weekdays?}` — one object to extend, per the hard rule, not
`quiet_start:` + `quiet_end:` flat keys) with an optional per-host override left unbuilt until asked,
matching the `presence_cooldown_s` / `wake_presence_cooldown_s` precedent exactly.

---

## 5. The numbers that decide the design

| Constant | Value | Source | Confidence |
|---|---|---|---|
| HA `DEFAULT_CONSIDER_HOME` | **180 s** | `device_tracker/const.py` | **[V]** |
| HA `consider_home` configurable ceiling (nmap) | **21 600 s** (`MAX_SCAN_INTERVAL * 6`) | `nmap_tracker/config_flow.py` | **[V]** |
| HA ping tracker poll interval | **30 s** (fixed in the coordinator) | `ping/coordinator.py` | **[V]** |
| HA ping: echoes per check / per-echo timeout | **5** / **1 s** (`DEFAULT_PING_COUNT`, `ICMP_TIMEOUT`) | `ping/const.py` | **[V]** |
| HA nmap scan interval | **120 s** default, range 10–3600 | `nmap_tracker/const.py`, config_flow | **[V]** |
| HA nmap probe | `-n -sn -PR -T4 --min-rate 10 --host-timeout 5s` (**`-PR` = ARP ping**) | `nmap_tracker/const.py` | **[V]** |
| HA nmap `home_interval` | **0 min** default (off); a *scan-cost* knob, not a damping one | const + HA docs | **[V]** |
| HA legacy device_tracker scan interval | **12 s** | `device_tracker/const.py` | **[V]** |
| HA dhcp ARP+PTR subnet sweep | **60 min** | `dhcp/__init__.py` | **[V]** |
| aiodiscover ARP settle wait | **10 s** (`ARP_CACHE_POPULATE_TIME`) | `aiodiscover/network.py` | **[V]** |
| monitor.sh arrival / departure attempts | **1** / **2**; min 15 s between scans | README | **[V]** |
| Linux `base_reachable_time_ms` (emma) | **30 000** ⇒ `REACHABLE` valid a randomised **15–45 s** | `/proc/sys/.../neigh/default` | **[V]** |
| Linux `mcast_solicit` × `retrans_time_ms` (emma) | 3 × 1 000 ⇒ **`INCOMPLETE` → `FAILED` in ~3 s** (measured: `FAILED` by t+5 s) | measured on emma | **[V]** |
| Linux `delay_first_probe_time` (emma) | **5 s** ⇒ re-confirming an expiring entry took **~9 s** end-to-end | measured on emma | **[V]** |
| Fresh ARP resolution, live LAN host (emma) | **< 50 ms** | measured on emma | **[V]** |
| `ping -c 1 -W 2` cost, absent host (emma) | **2.00 s** blocking | measured on emma | **[V]** |
| ctrl-b today: `monitor.poll_seconds` / `server.poll_seconds` | **30** / **5** | `config.py` | **[V]** |
| ctrl-b today: `presence_offline_after_s` / `presence_cooldown_s` / `wake.cooldown_s` | **120** / **3600** / **300** | `config.py` | **[V]** |
| ctrl-b today: fleet damping | **3 down / 2 up** | `MonitorCfg` | **[V]** |

**Reading of the table (ages fast, kept separate from the evidence):** a LAN source ticking on the
existing 30 s loop, with an arming threshold in the field's **180 s–21 600 s** band rather than our
tailnet-tuned 120 s, and 3–5 echoes per check rather than 1, is the shape every number above points
at. The exact threshold is an owner call that only a live capture (§6) can inform.

---

## 6. What I could not determine

- **How the owner's Honor 20 actually behaves at rest on their Wi-Fi.** Everything in §1 says an
  *associated* Android answers ARP and unicast ICMP while dozing; nothing tells us how often an
  Honor/EMUI device with vendor power management stays associated overnight, or how long the gaps
  are when it doesn't. **This is the single number the design needs and the only one no document can
  supply.** It is also cheap to buy: log a `PresenceState` line per tick for the phone's reserved IP
  for 2–3 nights with the wake DISARMED — precisely the D50 slice-15a pattern (observe + log, fire
  nothing), which exists for this reason. The histogram of gap lengths *is* the threshold.
- **Whether the Honor 20's chipset speaks APFv6** (firmware ARP/ping offload) **or only APFv4**
  (pass-to-CPU). Materially it changes wake latency and battery cost, not correctness — both paths
  answer. Not determinable without the device (`adb shell dumpsys wifi | grep -i apf` would say).
- **DTIM buffering latency for the first probe after an idle period.** Standard 802.11 power-save
  buffers unicast frames until the next DTIM beacon; the magnitude (typically a few hundred ms) is
  textbook but I found no primary measurement for an Android client, and I did not measure one
  **[U]**. It is the mechanism that would make a 1-packet / 1 s probe miss where a 5-packet probe
  succeeds, and it is the reason HA ships count=5 — but I am inferring HA's *reason*, not quoting it.
- **Whether Android always emits a DHCP transaction on re-association** (it should — the join path
  runs DHCP REQUEST for the cached lease), which is what would make the passive-sniff mechanism a
  perfect arrival signal. Not verified in AOSP's `IpClient`; moot for us anyway given the
  `CAP_NET_RAW` finding in §1.5 **[U]**.
- **Whether HA has *any* deferred-trigger primitive** I missed. I verified the time-condition
  semantics from source and the docs, and I know the `input_boolean` latch idiom is what blueprints
  use; I did **not** exhaustively search for a newer built-in **[R]**.
- **Measured false-negative rate of the ARP probe vs the ICMP probe against a real phone.** Both are
  answered per §1.2; which one survives a marginal-signal moment better is unmeasured here.
- **Deliberately not researched:** router/AP-side integrations (the brief scoped them out), and
  BLE-beacon presence (monitor.sh/ESPresense class) — a different sensor with a different install
  cost, out of scope for "the phone joins the Wi-Fi".

---

## 7. Corrections to premises we held

1. **ROADMAP D2's rejection of option C rests on a wrong mechanism.** "Android suppresses ping
   (battery)" — Android suppresses *apps'* network access under Doze and explicitly keeps
   ARP-for-us and unicast-ping-for-us answerable, moving the answer into Wi-Fi firmware so the CPU
   need not wake (§1.1–§1.2, AOSP source). The reason to be careful about a LAN trigger is that the
   phone may leave the *link*, which is a different failure with a different remedy (a damping
   constant, not a different probe).
2. **"Phone IPs churn"** — closed by the reserved DHCP IP *and* by AOSP's default persistent
   per-SSID MAC randomisation (§2.4). The residual is a re-mint after "forget network"/reset, which
   deserves a stale-config log line, not a design change.
3. **"LAN-only, strictly worse than A"** — the two sources answer *different questions*, which is
   the reason to have both: D50 deliberately dropped R12's home-endpoint predicate, so the tailnet
   trigger means *"the owner wants their servers"* and cannot mean *"the owner is home"*. The LAN
   source is the only one that can say the second sentence. "Strictly worse" was true of a LAN
   source used as a *replacement*; it is not true of one used as a second signal (§4.2).
4. **A LAN presence probe needs `arping`/`nmap`/root.** It does not: one UDP `sendto` plus `ip
   neigh` gets the ARP answer unprivileged, and emma has neither `arping` nor `nmap` installed
   (§1.4). The only mechanism that *does* need privilege is passive DHCP sniffing, which a systemd
   **user** unit cannot be granted (§1.5).
5. **`/proc/net/arp` would do.** It would not — it discards exactly the NUD distinction the
   presence answer depends on (§1.4).

---

## Sources

**Source read directly (github.com/home-assistant/core @ `dev`, fetched 2026-09-04):**
`homeassistant/components/ping/{device_tracker,helpers,const,coordinator,config_flow}.py` ·
`components/nmap_tracker/{__init__,const,config_flow}.py` · `components/device_tracker/const.py` ·
`components/dhcp/__init__.py` · `components/person/__init__.py` · `helpers/condition.py`

**Other source read directly:** `bluetooth-devices/aiodiscover` `aiodiscover/{discovery,network}.py`
+ README · `bluetooth-devices/aiodhcpwatcher` `src/aiodhcpwatcher/__init__.py` ·
AOSP `platform/packages/modules/NetworkStack` `src/android/net/apf/ApfFilter.java` (main) ·
`andrewjfreyer/monitor` README

**Docs:** [HA ping](https://www.home-assistant.io/integrations/ping/) ·
[HA nmap_tracker](https://www.home-assistant.io/integrations/nmap_tracker/) ·
[HA device_tracker](https://www.home-assistant.io/integrations/device_tracker/) ·
[HA script conditions](https://www.home-assistant.io/docs/scripts/conditions/) ·
[Nmap host discovery](https://nmap.org/book/host-discovery-techniques.html) ·
[Android Doze](https://developer.android.com/training/monitoring-device-state/doze-standby) ·
[AOSP Android Packet Filter](https://source.android.com/docs/core/connect/android-packet-filter) ·
[AOSP MAC randomization](https://source.android.com/docs/core/connect/wifi-mac-randomization-behavior) ·
[oxan/hapt](https://github.com/oxan/hapt)

**Measured on emma** (2026-09-04, 192.168.1.160/24 eno1, uid 1000): kernel neighbour sysctls ·
UDP-probe → `ip neigh` state transitions for a live, an absent and an expiring target ·
`ping -c 1 -W 2` wall time · `/proc/net/arp` vs `ip neigh` fidelity · installed-tooling inventory.

**In-repo cross-references:** `docs/ROADMAP.md` §D2 · `docs/DECISIONS.md` D50 (H1/H2/M1–M5) ·
`backend/app/services/monitor.py` · `backend/app/adapters/tailnet.py` ·
`backend/app/services/fleet.py` · `backend/app/config.py` (`WakeCfg`/`MonitorCfg`/`ComputerCfg`) ·
`backend/app/services/automations/schedule.py` (`server_tz_key`, `resolve_tz`) ·
[R12](./R12-tailscale-presence.md) · [R13](./R13-monitor-loop-patterns.md)
