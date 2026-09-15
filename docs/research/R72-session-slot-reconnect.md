# R72 — Freeing an exclusive session slot after an ungraceful client disconnect

**Date:** 2026-09-15 · **Status:** evidence, no decision · **Feeds:** `LIVE_VOICE_PLAN.md` §5.2/F9 + §4.5
(the `busy`/1013 refusal and the client reconnect ladder). Confidence markers per claim:
**[V]** verified (source read / probed here), **[R]** reported (secondary source), **[U]** unverified.

**The question.** After a phone's Wi-Fi↔LTE handover kills the socket ungracefully, how do shipped
realtime systems free or reassign a session slot the dead connection still holds — and when the
reconnecting client collides with that slot, which wins: patient retry, server-side takeover,
resume tokens, or fast dead-peer detection? With what numbers?

---

## 1. Our stack, pinned

**1.1 What detects the dead client — uvicorn's WebSocket keepalive. [V]**
`backend/.venv` has `uvicorn 0.48.0` + `websockets 16.1`, **no `wsproto`**. `protocols/websockets/auto.py`
prefers `websockets` when importable; resolved at runtime in this venv to
`uvicorn.protocols.websockets.websockets_impl.WebSocketProtocol` (the legacy asyncio server). It passes
the config straight through (`websockets_impl.py:105-106`):

```python
ping_interval=self.config.ws_ping_interval,
ping_timeout=self.config.ws_ping_timeout,
```

Defaults — `config.py:191-192` and CLI `--ws-ping-interval` / `--ws-ping-timeout` (`main.py:158,165`):
both **20.0 s**. `websockets/legacy/protocol.py:1213` `keepalive_ping()`: sleep `ping_interval` → send ping →
`await pong_waiter` under `ping_timeout` → on `TimeoutError`, `fail_connection(CloseCode.INTERNAL_ERROR,
"keepalive ping timeout")`.

**1.2 Probed on emma, this exact venv [V]** (starlette app + a raw-socket client that completes the
handshake then never answers a ping; server torn down, scratch cleaned):

| uvicorn flags | ping frame seen | CLOSE 1011 + TCP close | ASGI `websocket.disconnect` |
|---|---|---|---|
| *(defaults 20/20)* | t+**20.0 s** | t+**40.0 s** | t+**40.0 s** |
| `--ws-ping-interval 5 --ws-ping-timeout 5` | t+**5.0 s** | t+**10.0 s** | t+**10.0 s** |

Server log: `- timed out waiting for keepalive pong` → `! failing connection with code 1011` →
`> CLOSE 1011 (internal error) keepalive ping timeout`. **Detection = `ping_interval + ping_timeout`
worst case, `ping_timeout` best case ⇒ today's window is [20, 40] s.** The slot then frees correctly on its
own: `_recv_client` turns the disconnect into `_ClientGone` (both the typed `websocket.disconnect` message
and starlette's post-disconnect `RuntimeError` are handled) → `api/voice.py` `finally: slots.release()`.
**The slot leak is purely a timing problem, not a bookkeeping one.**

**1.3 Our relay has NO liveness of its own. [V]** (`backend/app/services/voice_live.py`)
`start_timeout_s` (5.0 s) covers only the pre-`start` gap; `max_session_s` (1800 s) is the whole-call cap;
`_pump_client` blocks in `websocket.receive()` with **no idle deadline**; the downlink is typed JSON events
only (no audio — C3 is the mouth over HTTP), so a half-dead peer is not detected by a failing write either.
Nothing in the session loop notices a dead peer before the transport does.

**1.4 TCP alone would never help. [V]** emma: `tcp_retries2=15` (≈15 min to RST), `tcp_keepalive_time=7200`.
The `websockets` docs state the rationale directly: *"TCP keepalive is disabled by default on most operating
systems. When enabled, the default interval is two hours or more, which is far too much."* and browsers
lack native keepalive, leaving broken connections undetected *"until the TCP connection times out."* [V]
A mobile handover produces a classic half-open socket: the phone's stack drops the old interface's socket
(the client knows instantly), the server sees only silence — no FIN, no RST.

**1.5 Why every retry lands inside the window. [V]** `useLiveCall.ts:67`
`RECONNECT_BACKOFF_MS = [400, 900, 1800, 3000]` — **6.1 s of backoff across 4 attempts**, entirely inside
a 20–40 s detection window. Worse, the first attempt ends the call: `serverError`/`busy` →
`terminal(s, "error", CALL_COPY.busy)` (≈line 570), so attempts 2–4 never fire.

**1.6 Is (B) a config one-liner?** **Yes. [V]** uvicorn is launched as a bare CLI in every path, with no ws
flags: `deploy/linux/systemd/ctrl-b-dashboard.service:26`, `ctrl-b-dashboard-dev.service:24`,
`deploy/linux/run.sh:20,27` (+ `deploy/windows/start.cmd`). Two flags per `ExecStart`. Caveat: the setting is
**process-global**, not per-route — we have exactly one WS route, so the blast radius is nil, but there is no
per-app override short of `uvicorn.Config(...)` kwargs (same names).

---

## 2. The field

| System | Collision / reconnect policy | Dead-peer detection | Conf. |
|---|---|---|---|
| **MQTT 3.1.1 / 5.0** | **TAKEOVER, spec-mandated.** New connect with an in-use ClientID ⇒ old one killed | Keep Alive × **1.5**, then close "as if the network had failed" | [V] |
| **LiveKit** | **TAKEOVER**: second join with the same identity ⇒ `DUPLICATE_IDENTITY` disconnect for the old participant | *"your participant disappears after **15 seconds**"* | [V] |
| **Discord voice gateway** | **RESUME**: op 7 `{server_id, session_id, token, seq_ack}` → op 9 `Resumed`; failure ⇒ full connect flow | heartbeat interval **41 250 ms** from op 8 Hello; 4009 = session timeout, 4006 = session no longer valid, 4015 = *"Try resuming"*, 4014/4021/4022 = do not reconnect | [V] |
| **Gemini Live API** | **RESUME handles**: `sessionResumption` in setup; *"Resumption tokens are valid for 2 hr after the last sessions termination"*; `GoAway` warns with `timeLeft` | server-driven | [V] |
| **OpenAI / Azure GPT Realtime** | **NO resume.** Session == connection, `session.created`/`expires_at`, **60 min** max; the docs' own remedy is *"Save conversation context to restore state in a new session"* | n/a (server-side lifetime) | [V] |
| **Deepgram streaming STT** | no slot; **fast app-level idle close** — no audio or `KeepAlive` for **10 s** ⇒ `NET-0001` close; send KeepAlive every 3–5 s | 10 s | [R] |
| **socket.io** | **RESUME**: connection state recovery, `maxDisconnectionDuration` default `2 * 60 * 1000` (2 min); `socket.recovered` false ⇒ resync manually | n/a | [V] |
| **SIP / VoIP multi-device** | Ring-stage arbitration, not takeover: a forked INVITE rings every registered contact, the **first 200 OK wins** and the other branches are CANCELled. Moving an *established* call is an explicit act (REFER / pickup) | RFC 4028 session timers | [R] |
| **mosh / WireGuard-Tailscale** | **No collision at all** — session identity is decoupled from the 5-tuple: *"Every time the server receives an authentic packet from the client with a sequence number higher than any it has previously received, the IP source address of that packet becomes the server's new target"* ⇒ handover is invisible | heartbeats | [V] |

**RFC 6455's own word on our close code [V]:** *"1013 indicates that the server is overloaded and the client
should try connecting later. A client may choose to reconnect, and should use a randomized delay of 5 - 30
seconds."* (§7.4.1). Also *"1006 is a reserved value and MUST NOT be set as a status code in a Close frame"* —
which is what a handover produces client-side. Note the protocol **specifies patient retry for 1013**: option (A)
is the standard behaviour for the code we already send, and today's reducer violates it by treating it as terminal.

**Reading of the field.** Two clean families, split by what the session holds:
- **Identity-keyed exclusive slots ⇒ TAKEOVER dominates**, and MQTT makes it *normative* precisely because it
  was designed for flaky mobile links where a half-dead peer holding a ClientID is the expected case.
  LiveKit does the same, and additionally keeps its own detection short (15 s).
- **Sessions carrying recoverable state ⇒ RESUME dominates** (Discord, Gemini, socket.io). Nobody offers resume
  for a session whose state is a few hundred ms of audio.
- **Nobody ships "patient retry into a busy slot" as their primary mechanism** — but everyone who mandates
  takeover *also* runs short keepalives, i.e. **(B) is the shared substrate under every policy**, never the
  alternative to one. The takeover systems are multi-tenant with contending identities; that is what they are
  buying, and it is what we do not have.

---

## 3. What I could not determine

- **Tailscale Serve's own behaviour on a proxied WebSocket.** Serve terminates TLS and proxies :443 → :5433
  (`deploy/linux/serve-https.sh:16`). Ping/pong should pass opaquely through an upgrade-hijack byte copy, and the
  owner's working live-voice over Serve proves *frames* pass — but I could not verify that Serve does not hold
  the uvicorn leg open after the phone leg dies, nor that it adds no idle timer of its own. **This is the one
  thing that could invalidate the 10 s number in §4 and it needs the phone round.** [U]
- Real handover timing on the owner's Honor 20: whether Fennec/Chrome closes the WS client-side immediately
  (clean 1006 + fast redial) or hangs. [U]
- Whether Speaches' realtime endpoint has a concurrency cap a fast re-dial could hit (upstream frozen per R68; not probed). [U]
- LiveKit's server source for `DUPLICATE_IDENTITY` (docs only, not source-read); Discord's full close-code →
  resume/reconnect matrix (docs give prose per code, no column). [R]

---

## 4. Advisory recommendation — **(B) then (A)**, and not (C)/(D)

1. **(B) first, because it sets the deadline (A) must cover.** `--ws-ping-interval 5 --ws-ping-timeout 5` on the
   three `ExecStart`/`run.sh` launch sites ⇒ **verified worst-case slot free at 10.0 s, typical ~7.5 s**. That lands
   between Deepgram's 10 s and LiveKit's 15 s — the field's own range for "a live media peer is gone". Cost: one
   ping frame per 5 s per live socket (N=1, and only while a call is up). Config-only, zero code, fully reversible.
2. **(A) second, scoped by `attempts`.** Make `busy` non-terminal **only when it arrives during a reconnect**
   (`s.attempts > 0` — the reducer already tracks it). A first, user-initiated dial that gets `busy` must stay
   terminal: that one really is "another device is on the call". The retry ladder must then **span the detection
   worst case with margin** — with (B) at 5/5 that is ≥ 10 s (today's ladder spans 6.1 s: extend to ~14 s, e.g.
   `[400, 900, 1800, 3000, 4000, 4000]`, or re-arm the last rung until a deadline). **Without (B), (A) alone would
   need ≥ 40 s of patient retry** — a very long "connecting" overlay, and the asymmetry is the whole argument for
   doing (B) first. RFC 6455's "randomized 5–30 s" for 1013 straddles exactly that gap.
3. **(C) takeover — the field's answer, but not for our shape.** It is what MQTT mandates and LiveKit ships, and
   it is the right answer *if a second device ever contends*. Today it buys nothing (B)+(A) doesn't, overrides a
   council-ratified typed refusal, and adds a real failure mode: a duplicate tab or a stray reconnect silently
   killing a live call the owner is speaking into. Record it as the pre-decided answer *if* multi-device ever lands.
4. **(D) resume tokens — disproportionate.** Discord/Gemini/socket.io resume because their sessions carry
   conversation context. Ours carries a resampler and a sub-second audio buffer, and §4.5 already rules the
   in-flight utterance LOST on a drop (`waitingFinal` clears). Speaches offers no resume either (R68 §2).

**Residual risk to settle in the phone round:** §3's Serve question, and whether 5 s pings are visible at all in
battery/data terms on the phone leg (expected nil: 1 frame/5 s).
