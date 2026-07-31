# R13 — Monitor-loop craft: check scheduling, up/down state, transitions, alert policy

**Date of pass: 2026-07-31.** Bounded question, set by the main seat:

> For **D2-A** — the backend's first *periodic monitor* loop (watch ~7 things: 3–6 managed LAN hosts
> for up/down transitions → Event log + notifications, plus one owner device for an offline→online
> edge → `wake_host`) — **how do established monitoring tools structure the check loop, decide the
> up/down state transition, and gate the alert?** What is the *simplest correct* form, and which of
> the field's mechanisms are scale artifacts we should not copy?

**Out of scope, deliberately (already bought / bought elsewhere):**
- *Loop vs library, poll-and-claim, cron arithmetic, misfire, orphan sweep* → **[R7](./R7-scheduled-agent-runs.md) §2.7**. Not relitigated here.
- *Tailscale presence semantics, LocalAPI vs CLI, Android client churn* → a **separate parallel pass**. This dossier contains **zero** Tailscale research.

**Reference class note.** The in-class peers (opencode / Claude Code / open-webui / LibreChat / …)
do not monitor hosts, so per `README.md` §Reference class this is a *genuinely generic* question and
a monitoring-domain pass is sanctioned. Three projects, read from source, depth over breadth.

**Confidence key** — every claim carries one:
- **[V]** verified: I read the cited source file at the cited commit in this pass.
- **[R]** reported: primary-but-secondary source (official language/library docs, upstream comment).
- **[U]** unverified: expected by construction, explicitly not checked.

---

## Verdict up front

**The load-bearing part of a monitor loop is about 12 lines and two integers per target.** All three
projects converge on the same tiny core, and everything else in their codebases is scale, breadth of
check types, or multi-tenancy — none of which we have.

The convergent core, in full:

1. **Sleep-then-work, self-rescheduling** — never a fixed ticker with a separate worker. All three
   schedule the *next* check only after the current one returns, which makes overlap structurally
   impossible with no guard, no lock, no in-flight flag. [V×3]
2. **Two counters per target** (`consecutive_failures`, `consecutive_successes`), each reset by the
   other outcome. That *is* the flap-damping state machine. Gatus implements it in four lines. [V]
3. **Asymmetric thresholds** — Gatus ships `failure-threshold: 3` / `success-threshold: 2`. [V]
4. **Edge-triggered emission behind a sticky "already reported" flag** — never level-triggered.
   Gatus: `Alert.Triggered bool`. Kuma: `heartbeat.important`. HA: `if self.last_update_success:`
   guarding the error log, one line. [V×3]
5. **A third state that is not UP and not DOWN** — for "never checked" and for "the check itself
   failed". Gatus reaches it via counters-below-threshold; Kuma names it `PENDING`; HA names it
   `unavailable` and keeps it strictly distinct from `off`. [V×3]

The single biggest *anti*-lesson: **Uptime Kuma — the popular homelab default — ships `maxretries: 0`,
i.e. no flap damping at all**, one failed check ⇒ DOWN ⇒ notification. [V] That default is the origin
of the "Uptime Kuma spams me" folklore, and it is precisely the default we must not copy.

---

## §0 — What was read

| Project | Commit (2026-07-31) | Files read | Core-loop LOC |
|---|---|---|---|
| **Gatus** (Go) | `b7100620c3e7dccc50d008747eddb53a73d9d9d8` | `watchdog/{watchdog,endpoint,alerting}.go`, `config/endpoint/endpoint.go`, `alerting/alert/alert.go`, `config/config.go`, `client/config.go`, `main.go` | **19** (`monitorEndpoint`) + **38** (`executeEndpoint`) + **118** (all alerting) |
| **Uptime Kuma** (Node) | `7bbc6f328745f932adcdaa8def89805e45c23d19` | `server/model/monitor.js`, `server/server.js`, `db/knex_init_db.js`, `src/pages/EditMonitor.vue` | **~700** (`Monitor.start()`, of which the `beat` closure is 660) + **14** (`safeBeat`) |
| **Home Assistant** (Python/asyncio) | `1e9f6d5ecf8a9dbab97babe01d00f119d611700f` | `helpers/update_coordinator.py` (711 L), `helpers/debounce.py`, `helpers/event.py`, `components/ping/*`, `components/device_tracker/const.py`, `components/template/binary_sensor.py` | **27** (`_schedule_refresh`) + **172** (`_async_refresh`, of which ~120 is a typed-exception ladder) |

Kuma's 700-line "loop" is not 700 lines of *loop* — it inlines the check implementation for ~20
monitor types (HTTP, DNS, MQTT, Docker, SNMP, …) in one `beat` closure. The scheduling and state
logic inside it is ~60 lines. That inlining is itself a finding: it is the shape you get when the
loop and the checkers are not separated, and it is what makes the file unmaintainable.

---

## §1 — Gatus (TwiN/gatus, Go) — the cleanest design, and it earns the reputation

### 1.1 Loop structure [V — `watchdog/watchdog.go`, `watchdog/endpoint.go`]

**One goroutine per endpoint**, each owning its own `time.Ticker` at that endpoint's own interval.
`Monitor()` is 33 lines and does nothing but fan out:

```go
// watchdog/watchdog.go:26-44
// Monitor loops over each endpoint and starts a goroutine to monitor each endpoint separately
func Monitor(cfg *config.Config) {
	ctx, cancelFunc = context.WithCancel(context.Background())
	if cfg.Concurrency == 0 {
		monitoringSemaphore = semaphore.NewWeighted(UnlimitedConcurrencyWeight)  // = 10000
	} else {
		monitoringSemaphore = semaphore.NewWeighted(int64(cfg.Concurrency))
	}
	extraLabels := cfg.GetUniqueExtraMetricLabels()
	for _, endpoint := range cfg.Endpoints {
		if endpoint.IsEnabled() {
			// To prevent multiple requests from running at the same time, we'll wait for a little before each iteration
			time.Sleep(222 * time.Millisecond)
			go monitorEndpoint(endpoint, cfg, extraLabels, ctx)
		}
	}
	...
}
```

The per-target loop is **19 lines**, and it is the whole thing:

```go
// watchdog/endpoint.go:14-33
func monitorEndpoint(ep *endpoint.Endpoint, cfg *config.Config, extraLabels []string, ctx context.Context) {
	// Run it immediately on start
	executeEndpoint(ep, cfg, extraLabels)
	// Loop for the next executions
	ticker := time.NewTicker(ep.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			logr.Warnf("[watchdog.monitorEndpoint] Canceling current execution of ...")
			return
		case <-ticker.C:
			executeEndpoint(ep, cfg, extraLabels)
		}
	}
}
```

- **Drift:** a Go `Ticker` fires on absolute multiples of the interval, so there is no cumulative
  drift, and *"the ticker will adjust the time interval or drop ticks to make up for slow
  receivers"* [R — pkg.go.dev `time.NewTicker`]. The channel has capacity 1, so a check that overruns
  its interval causes **at most one queued tick**, which runs immediately afterwards and then
  re-syncs. That is the overlap guard: it is a property of the single-goroutine-per-target shape, not
  a mechanism anybody wrote. [V shape / R runtime semantics]
- **Jitter: none.** The only `math/rand` in `config/endpoint/` is for random-string placeholders
  (`endpoint.go:433`). [V] The anti-herd measure is a **fixed 222 ms stagger at startup only**.
- **Per-target intervals**, no global interval.
- **What it deliberately does NOT do:** no retry inside a check, no backoff on failure (a failing
  endpoint is polled at exactly the same interval as a healthy one), no config re-read in the loop —
  a config change **stops and restarts every goroutine** from `main.go` [V], and the change detector
  is its own 26-line `for { sleep(30s); if modified { stop; reload; start; return } }` loop
  (`main.go:226-252`).

### 1.2 Check execution [V — `watchdog/endpoint.go:35-72`, `client/config.go:23`]

```go
func executeEndpoint(ep *endpoint.Endpoint, cfg *config.Config, extraLabels []string) {
	// Acquire semaphore to limit concurrent endpoint monitoring
	if err := monitoringSemaphore.Acquire(ctx, 1); err != nil { ... return }
	defer monitoringSemaphore.Release(1)
	...
	result := ep.EvaluateHealth()
	...
	UpdateEndpointStatus(ep, result)
	...
	if !cfg.Maintenance.IsUnderMaintenance() && !inEndpointMaintenanceWindow {
		HandleAlerting(ep, result, cfg.Alerting)
	}
}
```

- Global concurrency cap, **default 3** (`config/config.go:44-45`, `DefaultConcurrency = 3`), applied
  as a weighted semaphore. The rationale is recorded verbatim and is *not* about load:
  > `// monitoringSemaphore is used to limit the number of endpoints/suites that can be evaluated concurrently.`
  > `// Without this, conditions using response time may become inaccurate.` [V]

  i.e. the cap exists so that **latency measurements aren't polluted by self-inflicted contention**.
- Per-check timeout is `client.timeout`, **default 10 s** (`client/config.go:23`,
  `defaultTimeout = 10 * time.Second`), independent of the interval — no coupling, no clamp. [V]
- Alerting is *skipped entirely* under a maintenance window; the check still runs and still records.

### 1.3 State model + flap damping [V — `alerting/alert/alert.go:76-88`, `watchdog/alerting.go`]

Per-target state is **two ints on the in-memory `Endpoint` struct**, explicitly excluded from YAML:

```go
// config/endpoint/endpoint.go:133-140
	// NumberOfFailuresInARow is the number of unsuccessful evaluations in a row
	NumberOfFailuresInARow int `yaml:"-"`
	// NumberOfSuccessesInARow is the number of successful evaluations in a row
	NumberOfSuccessesInARow int `yaml:"-"`
	// LastReminderSent is the time at which the last reminder was sent for this endpoint.
	LastReminderSent time.Time `yaml:"-"`
```

Shipped thresholds — **asymmetric, and this is the whole hysteresis design**:

```go
// alerting/alert/alert.go:76-85
func (alert *Alert) ValidateAndSetDefaults() error {
	if alert.FailureThreshold <= 0 {
		alert.FailureThreshold = 3
	}
	if alert.SuccessThreshold <= 0 {
		alert.SuccessThreshold = 2
	}
	if alert.MinimumReminderInterval != 0 && alert.MinimumReminderInterval < 5*time.Minute {
		return ErrAlertWithInvalidMinimumReminderInterval
	}
```

**Thresholds are per-*alert*, not per-endpoint** — one endpoint may carry a Slack alert at
threshold 3 and a PagerDuty alert at threshold 10. The counters are shared; only the comparison
differs. That is the field's answer to "escalation" and it costs zero extra state.

The counter machine is four lines, split across the two handlers:

```go
// watchdog/alerting.go:28-29   (on failure)
	ep.NumberOfSuccessesInARow = 0
	ep.NumberOfFailuresInARow++
// watchdog/alerting.go:84 and :117   (on success — note the reset happens AFTER the alert loop)
	ep.NumberOfSuccessesInARow++
	...
	ep.NumberOfFailuresInARow = 0
```

**"Unknown / never checked" is not a state** — it falls out of the counters. A fresh process starts
at 0 failures; the first failure gives 1 < 3, so nothing fires. Silence-until-confident *is* the
unknown state. [V, by construction]

**What survives a restart:** the counters do not (in-memory, `yaml:"-"`). The *triggered* flag does,
via a store table, and it is restored with a deliberate trick — `NumberOfFailuresInARow` is
re-seeded **to the threshold** so the alert stays latched and cannot re-fire:

```go
// main.go:148-158
		for _, alert := range ep.Alerts {
			exists, resolveKey, numberOfSuccessesInARow, err := store.Get().GetTriggeredEndpointAlert(ep, alert)
			...
			if exists {
				alert.Triggered, alert.ResolveKey = true, resolveKey
				ep.NumberOfSuccessesInARow, ep.NumberOfFailuresInARow = numberOfSuccessesInARow, alert.FailureThreshold
				numberOfPersistedTriggeredAlertsLoaded++
			}
		}
```

Persisted triggered alerts are keyed by `Alert.Checksum()` — a SHA-256 over
`type_enabled_sendOnResolved_successThreshold_failureThreshold_description`
(`alerting/alert/alert.go:119-129`) — and
`DeleteAllTriggeredAlertsNotInChecksumsByEndpoint` drops any whose config changed. **Editing an
alert's threshold therefore clears its latched state**, deliberately. [V]

### 1.4 Transition detection + alert policy [V — `watchdog/alerting.go:27-81`]

Strictly **edge-triggered**, gated by a sticky bool. The load-bearing gate, verbatim:

```go
	for _, endpointAlert := range ep.Alerts {
		// If the alert hasn't been triggered, move to the next one
		if !endpointAlert.IsEnabled() || endpointAlert.FailureThreshold > ep.NumberOfFailuresInARow {
			continue
		}
		// Determine if an initial alert should be sent
		sendInitialAlert := !endpointAlert.Triggered
		// Determine if a reminder should be sent
		sendReminder := endpointAlert.Triggered && endpointAlert.MinimumReminderInterval > 0 && time.Since(lastReminderSent) >= endpointAlert.MinimumReminderInterval
		// If neither initial alert nor reminder needs to be sent, skip to the next alert
		if !sendInitialAlert && !sendReminder {
			continue
		}
```

- **Reminders are opt-in** (`minimum-reminder-interval`, default 0 = off) and validation **refuses
  anything under 5 minutes**. [V]
- **Recovery notifications are opt-out-by-default**: `IsSendingOnResolved()` returns `false` when
  unset (`alert.go:110-115`). The homelab default is *tell me it broke, don't tell me it healed*. [V]
- **`Triggered` is only set on a successful send** (a failing provider retries next tick — "this
  doubles as a lazy retry", per the field comment on the struct), but on **resolve it is cleared
  unconditionally**, even if the send fails: `// Even if the alert provider returns an error, we
  still set the alert's Triggered variable to false.` Asymmetric on purpose — a permanently-failing
  resolve notification must not latch the alert forever. [V, `alerting.go:96-98`]
- **A real aliasing bug-fix worth stealing**, recorded in the source:
  > `// Store the current LastReminderSent time so all alert providers use the same reference time for reminder checks`
  > `// This is important in case there are multiple alerts: if the first one sends a reminder, it would update the value`
  > `// of ep.LastReminderSent (since ep is a pointer), so the second one would never send a reminder`

  Class: **read the shared timestamp once, before the loop over channels.** [V]

### 1.5 Config surface [V]

| Knob | Scope | Default |
|---|---|---|
| `interval` | per endpoint | **1 m** (`endpoint.go:215-217`) |
| `client.timeout` | per endpoint | **10 s** |
| `alerts[].failure-threshold` | per alert | **3** |
| `alerts[].success-threshold` | per alert | **2** |
| `alerts[].send-on-resolved` | per alert | **false** |
| `alerts[].minimum-reminder-interval` | per alert | **0 = off**; if set, **≥ 5 m enforced** |
| `concurrency` | global | **3** (0 = unlimited → weight 10000) |
| `enabled` | per endpoint / per alert | true |

**Deliberately hardcoded:** the 222 ms startup stagger; `UnlimitedConcurrencyWeight = 10000`; the
30 s config-file mtime poll; min heartbeat interval 10 s; min connectivity-checker interval 5 s; a
5-minute floor on the interval for endpoints using the domain-expiration placeholder (rate-limiting
a free third-party service — `endpoint.go:237`).

---

## §2 — Uptime Kuma (louislam/uptime-kuma, Node) — the popular default, and its defaults are wrong

### 2.1 Loop structure [V — `server/model/monitor.js:414-1114`]

**One self-rescheduling `setTimeout` chain per monitor** — no ticker, no interval, no shared loop.
The tail of the `beat` closure is the whole scheduler:

```js
// server/model/monitor.js:1074-1084
            if (!this.isStop) {
                log.debug("monitor", `[${this.name}] SetTimeout for next check.`);
                let intervalRemainingMs = Math.max(1, beatInterval * 1000 - dayjs().diff(dayjs.utc(bean.time)));
                log.debug("monitor", `[${this.name}] Next heartbeat in: ${intervalRemainingMs}ms`);
                this.heartbeatInterval = setTimeout(safeBeat, intervalRemainingMs);
            } else {
                log.info("monitor", `[${this.name}] isStop = true, no next check.`);
            }
```

- **Drift compensation, explicitly:** the elapsed time of the check itself is subtracted from the
  next delay, anchored to `bean.time` (when this beat *started*). So the period is the interval, not
  interval + check-duration.
- **Overrun:** `Math.max(1, …)` ⇒ a check slower than its interval reschedules in 1 ms, i.e. checks
  run back-to-back. No queue, no overlap, no skip — it just falls behind gracefully. [V]
- **No concurrency cap of any kind.** N monitors ⇒ N independent timer chains, all free to fire
  simultaneously. The only mitigation is a random startup stagger:

```js
// server/server.js:1958-1966
    for (let monitor of list) {
        try { await monitor.start(io); } catch (e) { log.error("monitor", e); }
        // Give some delays, so all monitors won't make request at the same moment when just start the server.
        await sleep(getRandomInt(300, 1000));
    }
```

- **Error containment** is a wrapper, and it *always* reschedules — a thrown check cannot kill the
  chain (`monitor.js:1091-1104`):

```js
        const safeBeat = async () => {
            try { await beat(); } catch (e) {
                console.trace(e);
                UptimeKumaServer.errorLog(e, false);
                log.error("monitor", "Please report to https://github.com/louislam/uptime-kuma/issues");
                if (!this.isStop) {
                    log.info("monitor", "Try to restart the monitor");
                    this.heartbeatInterval = setTimeout(safeBeat, this.interval * 1000);
                }
            }
        };
```

- **Shutdown** is `clearTimeout` + an `isStop` flag checked *both* before rescheduling and inside
  `safeBeat`'s recovery path — belt and braces, because the timer may already have fired
  (`monitor.js:1211-1216`).

### 2.2 State model + flap damping [V — `monitor.js:444-457, 914-958`]

**Three states: `UP=1`, `DOWN=0`, `PENDING=2`** (plus `MAINTENANCE=3`). `PENDING` is exactly the
"failing but not yet confirmed down" state:

```js
                    if (this.maxretries > 0 && retries < this.maxretries) {
                        retries++;
                        bean.status = PENDING;
                    } else {
                        // Continue counting retries during DOWN
                        retries++;
                    }
```

and on any success, `retries = 0` (`monitor.js:913`).

- **`maxretries` default is `0`** (`db/knex_init_db.js:79`; UI `monitorDefaults` at
  `src/pages/EditMonitor.vue:3277`). With 0 there is **no PENDING state at all** — one failed check
  is DOWN and notifies. [V] **This is the single most consequential default in the dossier and it is
  the wrong one.**
- **Hysteresis: none.** Recovery is instant (`retries = 0` on the first success, DOWN→UP is
  immediately important). Only the down direction is dampened, and only if you opt in.
- **A separate retry interval** applies while PENDING: `if (this.retryInterval > 0) beatInterval =
  this.retryInterval` (`monitor.js:1035-1038`) — i.e. *poll faster while unsure*. UI default 60 s,
  DB default 0. [V]
- **State lives in SQLite**, on the `heartbeat` row: `status`, `retries`, `downCount`, `important`.
  It **survives a restart** — the first beat re-reads the last heartbeat and restores the retry
  counter:

```js
// monitor.js:444-451
            if (!previousBeat || this.type === "push") {
                previousBeat = await R.findOne("heartbeat", " monitor_id = ? ORDER BY time DESC", [this.id]);
                if (previousBeat) {
                    retries = previousBeat.retries;
                }
            }
            const isFirstBeat = !previousBeat;
```

- **"Never checked"** is `isFirstBeat` — true only when the monitor has *no heartbeat row at all*,
  not merely no in-memory state. This is the correct distinction and it is why the state is in the DB.

### 2.3 Transition detection + alert policy [V — `monitor.js:960-1003, 1385-1453`]

A **pure static function over (isFirstBeat, prevStatus, curStatus)**, with its truth table written
out as comments. This is the single best artifact in this dossier for our purposes:

```js
// monitor.js:1385-1411
    static isImportantBeat(isFirstBeat, previousBeatStatus, currentBeatStatus) {
        // * ? -> ANY STATUS = important [isFirstBeat]
        // UP -> PENDING = not important
        // * UP -> DOWN = important
        // UP -> UP = not important
        // PENDING -> PENDING = not important
        // * PENDING -> DOWN = important
        // PENDING -> UP = not important
        // DOWN -> PENDING = this case not exists
        // DOWN -> DOWN = not important
        // * DOWN -> UP = important
        ...
        return (
            isFirstBeat ||
            ... ||
            (previousBeatStatus === UP && currentBeatStatus === DOWN) ||
            (previousBeatStatus === DOWN && currentBeatStatus === UP) ||
            (previousBeatStatus === PENDING && currentBeatStatus === DOWN)
        );
    }
```

Note `PENDING -> UP = not important`: **a flap that never reached DOWN produces no event at all.**
That is the payoff of the third state.

There are **two** predicates: `isImportantBeat` (records `important=1` on the row, used for the UI
timeline and for "when did it go down") and `isImportantForNotification` (identical except
maintenance transitions are excluded). Separating *"is this a state change worth recording"* from
*"is this worth waking the human"* costs one function and is the right seam. [V]

The reminder policy, and the **first-beat rule**:

```js
// monitor.js:965-1002
            if (isImportant) {
                bean.important = true;
                if (Monitor.isImportantForNotification(isFirstBeat, previousBeat?.status, bean.status)) {
                    await Monitor.sendNotification(isFirstBeat, this, bean);
                }
                bean.downCount = 0;   // Reset down count
                ...
            } else {
                bean.important = false;
                if (bean.status === DOWN && this.resendInterval > 0) {
                    ++bean.downCount;
                    if (bean.downCount >= this.resendInterval) {
                        // Send notification again, because we are still DOWN
                        await Monitor.sendNotification(isFirstBeat, this, bean);
                        bean.downCount = 0;   // Reset down count
                    }
                }
            }
```

```js
// monitor.js:1452-1453
    static async sendNotification(isFirstBeat, monitor, bean) {
        if (!isFirstBeat || bean.status === DOWN) {
```

⇒ **on a brand-new monitor, Kuma notifies only if the very first check is DOWN**; a first-check-UP is
recorded as important but silent. [V] Applied to our case, the analogous rule would be: *after a
backend restart, a host discovered already-down produces a notification.* That is a policy choice,
not a technical necessity — flag it for the owner (§6).

`resendInterval` is counted in **beats, not seconds** (default 0 = off) — a subtle unit that makes
the reminder period `resendInterval × interval`. [V]

Also verbatim, worth stealing for the recovery message:

```js
                    // Filter by important = 1 to get the state transition heartbeat (e.g. UP→DOWN),
                    // not the most recent DOWN heartbeat which would be the last check before recovery.
                    const lastDownHeartbeat = await R.getRow(
                        "SELECT time FROM heartbeat WHERE monitor_id = ? AND status = ? AND important = 1 ORDER BY time DESC LIMIT 1", ...
```

⇒ **the `important` flag is what makes "it was down for 14 minutes" computable.** [V]

### 2.4 Config surface + a verified latent unit bug [V]

| Knob | DB default (`knex_init_db.js`) | UI default (`EditMonitor.vue:3263-3277`) |
|---|---|---|
| `interval` | 20 s | **60 s** |
| `maxretries` | **0** | **0** |
| `retry_interval` | 0 | **60 s** |
| `resend_interval` | **0** (off) | **0** |
| `timeout` | 0 | clamped to **80 % of interval** |

The timeout fallback is a genuine inconsistency. The frontend clamps in **seconds**:

```js
// src/pages/EditMonitor.vue:4445-4452
        clampTimeout(timeout) {
            // limit to 80% of interval, narrowly avoiding epsilon bug
            const maxTimeout = ~~(this.monitor.interval * 8) / 10;
```

The server-side runtime patch writes **milliseconds** into the same field:

```js
// server/model/monitor.js:463-467
            // Runtime patch timeout if it is 0
            // See https://github.com/louislam/uptime-kuma/pull/3961#issuecomment-1804149144
            if (!this.timeout || this.timeout <= 0) {
                this.timeout = this.interval * 1000 * 0.8;
            }
```

…and the field is consumed as seconds (`timeout: this.timeout * 1000`, `monitor.js:561`; the message
`timeout by AbortSignal (${this.timeout}s)`). For a legacy row with `timeout = 0` and a 60 s
interval this yields an effective 48 000 s timeout. **Class: a "sensible fallback" computed in a
different unit from the field it fills.** [V — I read both files; I did not run it, so the
*consequence* is [U], the unit mismatch is [V].]

**Deliberately hardcoded:** the 300–1000 ms random startup stagger; `demoMode` clamping intervals to
≥20 s; the PENDING/UP/DOWN enum; the 80 % timeout ratio.

---

## §3 — Home Assistant `DataUpdateCoordinator` (Python/asyncio) — the shared-poll abstraction

### 3.1 What it actually is [V — `homeassistant/helpers/update_coordinator.py`]

Not a monitor. It is a **fan-in deduplicator**: N entities that would each poll the same device
instead register as listeners on one coordinator, which polls once and pushes. The monitoring
semantics live *above* it, in the entity.

**Scheduling — `loop.call_at`, not `sleep`, and self-rescheduling:**

```python
# update_coordinator.py:252-279
    @callback
    def _schedule_refresh(self) -> None:
        """Schedule a refresh."""
        if self._update_interval_seconds is None:
            return
        if self.config_entry and self.config_entry.pref_disable_polling:
            return
        # We do not cancel the debouncer here. If the refresh interval is shorter
        # than the debouncer cooldown, this would cause the debounce to never be called
        self._async_unsub_refresh()
        # We use loop.call_at because DataUpdateCoordinator does
        # not need an exact update interval which also avoids
        # calling dt_util.utcnow() on every update.
        hass = self.hass
        loop = hass.loop
        update_interval = self._update_interval_seconds
        if self._retry_after is not None:
            update_interval = self._retry_after
            self._retry_after = None
        next_refresh = int(loop.time()) + self._microsecond + update_interval
        self._unsub_refresh = loop.call_at(next_refresh, self.__wrap_handle_refresh_interval).cancel
```

Two deliberate tricks in `int(loop.time()) + self._microsecond + update_interval`:
- `int(...)` **truncates to a whole second**, so every coordinator in the process lands on
  second boundaries → the event loop wakes fewer times (battery/CPU).
- `self._microsecond` is a **per-coordinator random offset in 50 000–500 000 µs**, drawn once at
  construction (`update_coordinator.py:120-124`, bounds at `helpers/event.py:87-88`):
  > `# Pick a random microsecond in range 0.05..0.50 to stagger the refreshes`
  > `# and avoid a thundering herd.`

  i.e. **coalesce to the second, jitter within it.** [V]

**Overlap protection** is threefold and each is one line: `_async_refresh` opens with
`self._async_unsub_refresh()` (cancel the pending timer), the scheduled path holds
`async with self._debounced_refresh.async_lock()` (`:301-302`), and rescheduling happens in the
`finally` after the fetch returns. Manual and scheduled refreshes therefore serialize. [V]

**Shutdown:** cooperative and flag-based, not cancellation-based — `async_shutdown()` sets
`_shutdown_requested`, unsubscribes the timer and shuts the debouncer down (`:210-215`); every
refresh re-checks `if self._shutdown_requested or (scheduled and self.hass.is_stopping): return`
(`:424-425`), and the `finally` re-schedules only `if not auth_failed and self._listeners and not
self.hass.is_stopping` (`:571-572`). [V]

**Backoff: there is none by default.** The `finally` re-schedules at the *same* interval whether the
fetch succeeded or failed. The only backoff channel is opt-in, per-failure, and set by the
integration:

```python
# update_coordinator.py:41-52
class UpdateFailed(HomeAssistantError):
    """Raised when an update has failed."""
    def __init__(self, *args: Any, retry_after: float | None = None, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.retry_after = retry_after
```
```python
# :492-502
        except UpdateFailed as err:
            self.last_exception = err
            if err.retry_after is not None and not raise_on_entry_error:
                self._retry_after = err.retry_after
```

`_retry_after` is consumed **once** and cleared (`:272-274`). It is a `Retry-After`-header carrier,
not an exponential backoff. [V]

### 3.2 Edge-triggered logging and edge-triggered notification — one line each [V]

Every one of the ~10 `except` branches in `_async_refresh` is wrapped in the same guard:

```python
        except (aiohttp.ClientError, requests.exceptions.RequestException) as err:
            self.last_exception = err
            if self.last_update_success:            # ← only log on the DOWN edge
                if log_failures:
                    self.logger.error("Error requesting %s data: %s", self.name, err)
                    self.logger.debug("Full error:", exc_info=True)
                self.last_update_success = False
        ...
        else:
            if not self.last_update_success:        # ← only log on the UP edge
                self.last_update_success = True
                self.logger.info("Fetching %s data recovered", self.name)
```

and the listener fan-out is edge-gated too:

```python
# :576-584
        if not self.last_update_success and not previous_update_success:
            return

        if (
            self.always_update
            or self.last_update_success != previous_update_success
            or previous_data != self.data
        ):
            self.async_update_listeners()
```

**`always_update=True` is the default** — i.e. HA is level-triggered toward the UI by default and
edge-triggered toward the *logs* always. `always_update=False` is the opt-in "only notify listeners
when the data actually changed", and the class docstring warns it *"requires that the data implements
`__eq__`"*. [V] The split is the right one: **cheap in-process fan-out can be level-triggered; the
expensive/noisy sink must be edge-triggered.**

### 3.3 No flap damping in the coordinator — it lives in the entity [V]

`CoordinatorEntity.available` is instant, no threshold:

```python
# update_coordinator.py:696-699
    @property
    @override
    def available(self) -> bool:
        """Return if entity is available."""
        return self.coordinator.last_update_success
```

Damping is provided *above*, in two named idioms:

**(a) `consider_home` — a time-based grace window, HA's presence idiom** [V —
`components/ping/device_tracker.py:73-81`, `components/device_tracker/const.py:84`]:

```python
    @property
    def is_connected(self) -> bool:
        """Return true if ping returns is_alive or considered home."""
        if self.coordinator.data.is_alive:
            self._last_seen = dt_util.utcnow()
        return (
            self._last_seen is not None
            and (dt_util.utcnow() - self._last_seen) < self._consider_home_interval
        )
```
with `DEFAULT_CONSIDER_HOME: Final = timedelta(seconds=180)`. Note the shape: **online is instant,
offline requires 180 s of silence.** Maximal asymmetry, expressed in *time* rather than in *check
counts* — which makes it independent of the poll interval. For a ping coordinator at 30 s that is
"6 consecutive misses", but the config stays meaningful if the interval changes.

**(b) `delay_on` / `delay_off` — a cancellable timer per direction** [V —
`components/template/binary_sensor.py:190-223`]:

```python
        if state == self._attr_is_on:
            return
        # state without delay
        if (state is None or (state and not self._delay_on) or (not state and not self._delay_off)):
            self._attr_is_on = state
            return
        @callback
        def _set_state(_):
            self._attr_is_on = state
            self.async_write_ha_state()
        delay = (self._delay_on if state else self._delay_off).total_seconds()
        # state with delay. Cancelled if template result changes.
        self._delay_cancel = async_call_later(self.hass, delay, _set_state)
```

Same semantics as N-consecutive, expressed as "hold the candidate state for T; any contrary
observation cancels the timer". Equivalent in power; more state (a timer handle) and harder to test
than two ints. **Consecutive-count is the cheaper encoding of the same idea.**

### 3.4 The tri-state, applied [V — `components/ping/*`]

| Situation | HA representation |
|---|---|
| never checked / setup not finished | the entity **does not exist yet** — `async_config_entry_first_refresh()` raises `ConfigEntryNotReady` and HA retries setup (`ping/__init__.py:68`, `update_coordinator.py:317-360`) |
| **the check itself failed** (exception) | `available = False` ⇒ state `unavailable` |
| check succeeded, host does not answer | `is_on = False` ⇒ state `off` (device class `CONNECTIVITY`) |
| check succeeded, host answers | `is_on = True` ⇒ `on` |

`PingBinarySensor` declares `_attr_device_class = BinarySensorDeviceClass.CONNECTIVITY` and
`_attr_available = False` (`ping/binary_sensor.py:29-30`) — the latter is **shadowed** by
`CoordinatorEntity.available`'s property and is vestigial. [V] The effective distinction is the
important one: **"I could not check" ≠ "I checked and it's down."**

### 3.5 Config surface [V]

| Knob | Scope | Default |
|---|---|---|
| `update_interval` | per coordinator | none in the base class; **`ping` uses 30 s** (`ping/coordinator.py:48`) |
| debouncer `cooldown` / `immediate` | per coordinator | **10 s / True** (`REQUEST_REFRESH_DEFAULT_*`, `:35-36`) |
| `always_update` | per coordinator | **True** |
| `consider_home` | per device_tracker | **180 s** |
| `count` (packets per ping) | per ping entry | **5** (`DEFAULT_PING_COUNT`) |

**Deliberately hardcoded:** the 50–500 ms jitter window; the second-boundary truncation;
`PING_TIMEOUT = 3` (whole `ping` binary), `ICMP_TIMEOUT = 1` (per-reply, icmplib),
`PING_ATTEMPTS_COUNT = 3`. The two ping timeouts carry an explicit comment that they are *not* the
same timeout [V — `ping/const.py`] — the same distinction our `fleet.py` already draws between
`-W secs` and the outer `wait_for(timeout_s + 1.0)`.

---

## §4 — Synthesis

| # | | **Gatus** | **Uptime Kuma** | **HA Coordinator** |
|---|---|---|---|---|
| 1 | loop shape | goroutine + `Ticker` **per target** | `setTimeout` chain **per target** | `loop.call_at` **per coordinator** |
| 1 | drift | absolute ticks, drops on overrun | subtracts elapsed, floor 1 ms | truncates to whole second |
| 1 | jitter | **none** (222 ms startup stagger) | **none** (300–1000 ms random startup stagger) | **50–500 µs per coordinator, permanent** |
| 1 | interval scope | per target | per target (+ separate retry interval) | per coordinator |
| 1 | core LOC | **19** | ~60 of 700 | **27** (+172 of error handling) |
| 2 | check timeout | 10 s, independent of interval | 80 % of interval (clamped in UI) | integration's own |
| 2 | concurrency cap | **semaphore, default 3** — *for latency accuracy* | **none** | n/a (one target per coordinator) |
| 2 | overrun | ticker drops ticks; ≤1 queued | reschedules in 1 ms, runs back-to-back | pending timer cancelled first; debouncer lock |
| 3 | states | UP / DOWN (+ below-threshold silence) | **UP / DOWN / PENDING** (+MAINTENANCE) | **on / off / unavailable** |
| 3 | damping down | **3 consecutive failures** | `maxretries`, **default 0 = none** | none in base; `consider_home` **180 s** above it |
| 3 | damping up (hysteresis) | **2 consecutive successes** | **instant** | **instant** |
| 3 | state location | in-memory ints; triggered flag in DB | **all in SQLite `heartbeat` rows** | **all in memory** |
| 3 | survives restart | the *latched* flag only, re-seeded to threshold | yes, incl. retry counter | **no** |
| 3 | "never checked" | implicit (counters at 0) | `isFirstBeat` = no heartbeat row | entity doesn't exist / `unavailable` |
| 4 | trigger model | **edge**, sticky `Triggered` bool | **edge**, static truth table | **edge** for logs, level for listeners (`always_update`) |
| 4 | reminders | opt-in, **≥ 5 min enforced** | opt-in, counted in **beats** | none |
| 4 | recovery alert | **off by default** (`send-on-resolved`) | always, on the DOWN→UP edge | log-only ("recovered") |
| 4 | record-vs-notify split | one path | **two predicates** (`isImportantBeat` / `…ForNotification`) | log vs listeners |
| 5 | reload | full stop/start of all goroutines, 30 s mtime poll | per-monitor restart on edit | config-entry reload |
| 6 | backoff on failure | **none** | none (but polls *faster* while PENDING) | **none**; opt-in `UpdateFailed(retry_after=)`, one-shot |

**Three convergences worth naming.**

1. **Nobody uses a fixed-rate ticker with a separate worker.** All three schedule the next check
   after the current one settles. Overlap protection is therefore free, and it is the reason none of
   them has an "is a check already running" flag.
2. **Nobody runs a state machine.** The state is `(previous_reported_state, consecutive_count)` and
   the transition function is a pure comparison. Kuma's is literally a `static` function of three
   scalars; Gatus's is two `if`s. Anything more is over-engineering.
3. **Everybody separates "record" from "notify."** Gatus: `UpdateEndpointStatus` always, `HandleAlerting`
   conditionally (and never during a maintenance window). Kuma: `important` vs
   `isImportantForNotification`. HA: `logger.error` on the edge vs `async_update_listeners` on data
   change. **The recording layer is level-triggered and the notifying layer is edge-triggered.**

---

## §5 — Load-bearing vs scale artifact, for ~7 targets in one asyncio process

**Load-bearing — absence is a bug.** Each with the reason, not just the label.

| Mechanism | Why it is not optional here |
|---|---|
| **N-consecutive-failure damping before any Event/notification** | `fleet.ping_host` sends **one** ICMP echo (`-c 1`) with a 2 s wait. Single-packet loss on wifi/LAN is routine, and a host mid-reboot answers intermittently. Without damping, every such blip writes an Event and fires a notification. This is exactly the Kuma-default failure mode (§2.2). **≥2, and 3 is the field's number.** |
| **Hysteresis (different up and down thresholds)** | The two directions have different costs. For the fleet, a false DOWN is noise and a false UP is harmless → damp down hard, recover fast (Gatus 3/2, HA `consider_home` 180 s vs instant). For the D2-A wake trigger the *up* edge is the one that acts, so it needs its own number — do not reuse the fleet's. |
| **Edge-triggered emission behind a sticky reported-state** | The Event log and notifications are append-only sinks. Level-triggered writes turn "corsair is off overnight" into 480 rows. One bool per target. |
| **Tri-state: UNKNOWN ≠ DOWN** | Two distinct needs: (a) the **first sweep after boot must baseline silently**, or every restart replays the whole fleet's state into the log; (b) `HostStatus.error` already distinguishes *"ping binary missing / timeout"* from *"host replied nothing"* — that is HA's `unavailable` vs `off` and the loop must not collapse it. |
| **Overlap protection** | Free, but only if we keep the sleep-then-work shape. `runner.loop()` already has it. It becomes a real bug the moment anyone converts it to a ticker or a per-host task. |
| **Blanket exception guard + config re-read per tick** | Already the house convention (`runner.loop()`); all three projects have the equivalent (`safeBeat`, `_async_refresh`'s ladder, the deferred ticker stop). |
| **Cooldown on the acting edge (WOL)** | Already built (`wake.cooldown_s = 300`). Gatus independently arrives at a **5-minute floor** for repeat sends — our 300 s is exactly right, which is a useful corroboration. |
| **Sharing one sweep between the loop and the UI** | `FleetService.status_all()`'s TTL cache + `asyncio.Lock` already is HA's coordinator, and its docstring already states the rationale. **The monitor loop must call `status_all()`, not `ping_host` directly**, or we double the ICMP traffic and the loop's view diverges from the UI's. |

**Scale artifacts — skip, with the reason each exists upstream.**

| Mechanism | Why upstream has it | Why we don't |
|---|---|---|
| **A task/goroutine per target** | Gatus and Kuma support hundreds–thousands of targets with *per-target intervals*; a shared loop would have to schedule them. | 7 targets, one interval. One loop over a `gather` gives an **atomic snapshot** (all targets observed at the same instant), which per-target tasks cannot. Strictly simpler *and* strictly better here. |
| **Per-target intervals** | Users mix a 30 s API check with a 24 h cert check. | One `interval_s`. Adding per-host later is an additive optional field on the existing unified host object (the D2-B `wake_on_connect` precedent). |
| **Startup stagger / jitter** | Anti-thundering-herd against N remote services and against N coordinators sharing one event loop. | The fan-out is already `Semaphore(16)`-bounded over ≤6 local ICMP probes; there is no herd to avoid. Revisit only if a target ever becomes an HTTP API we poll per host. |
| **A concurrency cap in the monitor** | Gatus caps at 3 to keep latency measurements honest. | `FleetService` already owns the cap. Do not add a second one — the loop should not know about concurrency at all. |
| **Persistent per-target counters** | Gatus/Kuma must not re-alert for an incident that was open before the restart. | Our restart policy *wants* a silent re-baseline (see UNKNOWN above), so in-memory is not merely acceptable — it is the desired semantics. State goes in a dict on the service instance (the `wake_cooldowns`-on-`app.state` precedent — **not** a module global; two `TestClient` apps in one process must not share it). |
| **Reminder / resend intervals** | Multi-user, on-call, "did anyone see this". | One user, one dashboard that already shows level state continuously. A repeating "still down" is pure noise. Cheap to add later as one optional field if the owner asks. |
| **Alert escalation chains / per-alert thresholds** | Gatus's per-alert thresholds exist so Slack and PagerDuty can differ. | One sink. |
| **Maintenance windows** | Suppress alerts during planned work. | Our real equivalent is narrower and better: *the app itself just issued the shutdown*. Note it as a seam (the action chokepoint could stamp a short per-host suppression), do not build a calendar. |
| **HA's Debouncer, listener registry, `always_update`, contexts** | N entities × M integrations fan in on one poll, and the UI can request an out-of-band refresh. | One consumer. `status_all`'s TTL already provides the dedupe and the request-refresh path. |
| **HA's ~120-line typed-exception ladder** | Classifies failures across 1000+ integrations for reauth/backoff/ConfigEntryNotReady. | `ping_host` documents *"Never raises: failures become a status with `error`"*. One `except Exception` in the loop is the entire correct handler. |
| **Backoff on failure** | Nobody actually has it (see §4 row 6). | Confirms: **do not invent one.** A down host is polled at the normal interval. |

---

## §6 — Implications for ctrl-b (short; separable from the evidence)

1. **Reuse `runner.loop()`'s shape verbatim; add nothing.** Sleep-first, re-read config each tick,
   blanket guard, cancel-and-await at shutdown. The field's per-target-task designs exist for scale
   we do not have, and adopting one would cost us the atomic snapshot.

2. **The monitor calls `FleetService.status_all()`, never `ping_host`.** Set the monitor interval
   ≥ `server.poll_seconds` so the cache dedupes an in-flight UI poll instead of racing it. Accept
   that transition timestamps are then ±`poll_seconds` — for a homelab that is free accuracy given
   up.

3. **Two ints and a reported-state per target, in one dict on the service instance.** Shape:
   `{host_id: MonitorState(consecutive_ok, consecutive_fail, reported)}` where `reported ∈
   {unknown, up, down}`. That is Gatus's design with the third state made explicit instead of
   implicit — worth the explicitness because our sink is an Event log that must be silent while
   `unknown`.

4. **Ship asymmetric thresholds, both configurable, neither hardcoded** (house rule: tunables →
   Settings). Starting numbers with field backing: **down after 3 consecutive misses, up after 1–2**.
   At a 30–60 s interval that is 1.5–3 minutes to declare a box down, which matches HA's 180 s
   `consider_home` closely enough to be a real corroboration rather than a guess.

5. **Consider `-c 2` on the ping before adding damping**, and measure. HA sends 5 packets per check
   (`DEFAULT_PING_COUNT`) and treats the aggregate as one observation; we send 1. Raising the packet
   count kills single-packet loss with **zero new state**, and is orthogonal to (not a substitute
   for) consecutive-check damping, which is what covers a rebooting host. This is a change to
   `fleet._ping_cmd` and touches the OS-branch allowlist — cheap, but it is a `check.py`-pinned file.

6. **Config shape — one object, per the owner directive.** A `monitor:` block beside the existing
   `wake:` block (ROADMAP D2 already says A joins `wake:`), with the thresholds/interval as fields,
   and any per-host opt-out as an **optional field on the existing unified host object** (exactly
   how `wake_on_connect` landed in D2-B). Do **not** add a sibling `monitor_hosts: {}` map.

7. **Owner decision required — the boot baseline.** Two defensible policies, both shipped in the
   field: Gatus baselines silently (counters start at 0); Kuma notifies if the *first* observation is
   DOWN. This is the exact mirror of the already-ruled D2-B behaviour (*"first connect after a
   backend restart wakes all flagged hosts — owner-ruled: intended"*), so it is a policy question,
   not an engineering one. Recommendation: **silent baseline for the fleet up/down Events**
   (a restart is not an incident), **and the existing intended-wake behaviour unchanged for D2-A**.

8. **Split "record" from "notify" at the seam, day one.** Kuma's two-predicate design
   (`isImportantBeat` / `isImportantForNotification`) is one extra pure function and it is what lets
   the Event log keep a transition the owner should not be pinged about. Our `EventBus`/notification
   split already mirrors this; make the predicate pure and unit-testable (the `_terminal()`
   precedent in `runner.py`).

9. **Preserve `HostStatus.error` through the transition logic.** A check that failed because `ping`
   is missing is HA's `unavailable`, not `off`, and it must not count toward the down streak — that
   would report every host down when the server's own ping breaks.

10. **The one-line habits to copy directly:** log/emit only on the edge (`if last_update_success:`);
    read a shared "last sent" timestamp *once before* iterating channels (Gatus's `lastReminderSent`
    aliasing fix); clear the latched flag unconditionally on recovery even if the send failed; and
    compute a fallback in the **same unit as the field it fills** (Kuma's §2.4 timeout).

---

## §7 — What I could not determine

- **Whether Kuma's `timeout` unit mismatch (§2.4) actually manifests at runtime.** I read both the
  writer and every reader, and they disagree on units [V], but I did not run Kuma or trace which rows
  can still have `timeout = 0` after its migrations. Treated as a *class* of bug worth avoiding, not
  as a claimed upstream defect.
- **Whether Gatus's `Concurrency = 3` default was measured or chosen.** The comment gives the
  rationale (latency accuracy) but no benchmark; git history was not searched (`--depth 1` clone).
- **Real-world flap rates for LAN ICMP**, which is what would let us pick 2 vs 3 for the down
  threshold on evidence rather than by matching Gatus. This is measurable locally in an hour
  (log every raw sweep result for a day, count 1-sample dropouts) and is the honest next step if the
  number matters.
- **Whether HA's `consider_home` (time-based) or Gatus's consecutive-count damping is more robust
  when the poll interval changes.** Time-based is interval-independent by construction, which is an
  argument for it; I found no upstream discussion weighing the two, and did not look for one.
- **How any of the three behave under a large clock step** (NTP correction, laptop suspend). Kuma's
  `dayjs().diff(...)` and HA's `loop.time()` differ fundamentally here (wall vs monotonic) — HA is
  monotonic and therefore correct, Kuma is wall-clock and would be [U] affected. Not probed;
  irrelevant for an always-on server, relevant if the loop ever runs on a suspending host.
- **Any fourth project.** The brief allowed one more if it decisively answered something these three
  did not; nothing was left unanswered on questions 1–5, so the pass stopped at three, per the
  depth-over-breadth instruction.

---

*Clones (`--depth 1`, under `$TMPDIR=/home/emma/.cache/tmp`) were deleted at the end of the pass.*
