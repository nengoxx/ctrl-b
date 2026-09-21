import { seedUI, test, expect } from "./fixtures";

// THE CALL LOOP, IN A REAL BROWSER (Phase 24 / S2a — LIVE_VOICE_PLAN §7-S2a, D71).
//
// The unit suites pin the machine's rules and the socket's framing; what only a real engine can answer
// is whether the whole chain HOLDS: a genuine `AudioContext` loading the worklet from its Blob URL, the
// worklet framing live samples, a real `WebSocket` carrying `start`-then-binary to the relay, the
// relay's downlink driving the machine, and the transcript coming back out of the chat door as an
// ordinary POST. Every one of those is a place the app could work in jsdom and fail in Chromium.
//
// DETERMINISM: no real microphone and no relay. `getUserMedia` is replaced by a stream built from an
// `AudioContext` oscillator — a REAL `MediaStream` with a REAL live audio track, which is what makes the
// worklet genuinely run — and the relay is `page.routeWebSocket`, scripted frame by frame.

/** A fake mic that is nevertheless real audio: a 440 Hz tone on a genuine MediaStreamTrack. */
const FAKE_MIC = () => {
  const media = navigator.mediaDevices as unknown as { getUserMedia: unknown };
  media.getUserMedia = () => {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const dest = ctx.createMediaStreamDestination();
    osc.frequency.value = 440;
    osc.connect(dest);
    osc.start();
    return Promise.resolve(dest.stream);
  };
};

const LIVE_CALL = {
  frame_ms: 40,
  buffered_ceiling_ms: 1000,
  min_speech_ms: 300,
  barge_threshold: 0.02,
  call_backlog_ms: 1000,
  barge_in: true,
  ring: true,
  echo_workaround: "auto",
  // D73 S5 — the route pair, backend defaults (added with the S5-review fix wave; the fixture is
  // supposed to be what `/voice/status` sends, S5 itself forgot its own two).
  route: "speaker",
  input_device: "",
  // D73 S6 — the background three, as the backend ships them. Nothing here hides the page, so they
  // change no case; the fixture carries them because it is supposed to be what `/voice/status` sends.
  background: true,
  background_keepalive: true,
  background_idle_s: 600,
  max_session_s: 1800,
};

interface Relay {
  /** Everything the client sent, in order: the JSON controls as strings, audio as byte counts. */
  uplink: (string | number)[];
  /** Push a downlink frame to the connected client. */
  say: (frame: unknown) => Promise<void>;
  /** How many `start` controls the client has sent — one per SESSION, so a redial makes it two. */
  starts: () => number;
  closed: () => boolean;
  /** Drop the LEG from the relay's side, the way a flaky tailnet link does: an unannounced close with
   *  no `error`/`ended` frame in front of it (S3 — the only close the machine may reconnect through). */
  drop: (code?: number) => Promise<void>;
  /** Every `start` control the client has sent, parsed — the reconnect's contract is a FRESH session. */
  startFrames: () => { type: string; sample_rate: number }[];
}

/** Boot the agent tab with the `live` bit up, a fake mic, a scripted relay and a counted chat door. */
async function boot(
  page: import("@playwright/test").Page,
  opts: { holdChat?: boolean; ring?: boolean } = {},
) {
  const uplink: (string | number)[] = [];
  const sends: Record<string, unknown>[] = [];
  let socket: import("@playwright/test").WebSocketRoute | null = null;
  let closed = false;

  // AFTER the fixture's blanket `**/api/**` route — last registered wins in Playwright.
  await page.route("**/api/voice/status", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        stt: true,
        tts: true,
        live: true,
        stt_auto_send: false,
        tts_chunking: { mode: "off", read_along: false, format: "opus" },
        live_call: { ...LIVE_CALL, ring: opts.ring ?? LIVE_CALL.ring },
      }),
    }),
  );
  await page.route("**/api/agent/chat", async (r) => {
    sends.push(r.request().postDataJSON() as Record<string, unknown>);
    // `holdChat` leaves the POST in flight, which is what keeps the machine in `thinking` long enough
    // to assert it: a buffered turn that answers immediately is back to `listening` before the
    // assertion can run, and a phase that flickers past is not a phase a test can see.
    if (opts.holdChat) await new Promise(() => {});
    // A BUFFERED turn (D17): no SSE to script, and the call's mouth is not what this spec is about.
    return r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ threadId: "t1", state: "completed" }),
    });
  });
  // The durable floor a buffered turn re-reads. The fixture's blanket route answers `{}` for an
  // unmocked path, and the store's message list must be a LIST.
  await page.route("**/api/threads/t1/messages", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  // THE RELAY. Handled entirely in the test — `routeWebSocket` never dials a server, so the uplink is
  // observable and the downlink is ours to script.
  await page.routeWebSocket("**/api/voice/live", (ws) => {
    socket = ws;
    ws.onMessage((msg) => {
      uplink.push(typeof msg === "string" ? msg : msg.byteLength);
    });
    ws.onClose(() => {
      closed = true;
    });
  });
  await page.addInitScript(FAKE_MIC);
  await seedUI(page, { theme: "cosmos", mode: "dark", accent: "violet", tab: "agent", v: 1 });
  await page.goto("/");

  const startFrames = () =>
    uplink
      .filter((u) => typeof u === "string")
      .map((u) => JSON.parse(String(u)) as { type: string; sample_rate: number })
      .filter((c) => c.type === "start");
  const relay: Relay = {
    uplink,
    starts: () => startFrames().length,
    startFrames,
    say: async (frame) => {
      await expect.poll(() => socket !== null).toBe(true);
      socket!.send(JSON.stringify(frame));
    },
    closed: () => closed,
    drop: async (code = 1006) => {
      await expect.poll(() => socket !== null).toBe(true);
      const leg = socket!;
      socket = null; // …so `say` waits for the NEXT leg rather than talking into the dead one
      await leg.close({ code, reason: "link" });
    },
  };
  return { relay, sends, mic: page.locator("#composer .kit-cbtn.mic") };
}

/** Enter call mode and commit through the standing chip — the tap twin of the swipe (§6). */
async function startCall(page: import("@playwright/test").Page) {
  const mic = page.locator("#composer .kit-cbtn.mic");
  await expect(mic).toBeVisible();
  const box = (await mic.boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // Tap SWITCHES mode, so a second call in the same session is already there (there is no mode memory
  // across loads, but the gesture keeps its own within one — S0.5's rule).
  if ((await mic.getAttribute("aria-label")) !== "start a voice call") {
    await page.mouse.click(at.x, at.y); // tap → call mode
    await expect(mic).toHaveAttribute("aria-label", "start a voice call");
  }
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(300); // past the 150 ms activation → the "slide up to call" pill
  await page.mouse.up(); // released without the swipe → the standing chip
  await page.locator(".mg-chip").click();
  await expect(page.locator(".kit-call")).toBeVisible();
}

const overlay = ".kit-call";

test("a call connects, hears a final, sends it as a plain message, and hangs up", async ({
  page,
  pageErrors,
}) => {
  const { relay, sends } = await boot(page, { holdChat: true });
  await startCall(page);

  // ① CONNECTING → the handshake. The FIRST uplink frame must be the text `start` carrying the real
  //    measured rate — a leading binary frame is a protocol close on the relay.
  await expect(page.locator(`${overlay} .kit-call-phase`)).toContainText("Connecting");
  await expect.poll(() => relay.uplink.length).toBeGreaterThan(0);
  const start = JSON.parse(String(relay.uplink[0])) as { type: string; sample_rate: number };
  expect(start.type).toBe("start");
  expect(start.sample_rate).toBeGreaterThanOrEqual(8000);
  expect(start.sample_rate).toBeLessThanOrEqual(96000);

  // ② READY → listening, and REAL audio starts flowing: the worklet loaded from its Blob URL, framed
  //    the oscillator's samples and the socket shipped them as binary.
  await relay.say({ type: "state", state: "ready" });
  await expect(page.locator(`${overlay} .kit-call-phase`)).toContainText("Listening");
  await expect
    .poll(() => relay.uplink.filter((u) => typeof u === "number").length)
    .toBeGreaterThan(2);
  // …at the configured frame size: 40 ms of pcm16 mono at the declared rate.
  const bytes = relay.uplink.find((u) => typeof u === "number") as number;
  expect(bytes).toBe(Math.round((start.sample_rate * LIVE_CALL.frame_ms) / 1000) * 2);

  // ③ THE EAR SPEAKS. The transcript line shows what it heard YOU say…
  await relay.say({ type: "speech_started" });
  await relay.say({ type: "speech_stopped" });
  await relay.say({ type: "transcript", text: "wake the vault", final: true });
  await expect(page.locator(`${overlay} .kit-call-heard`)).toHaveText("wake the vault");

  // ④ …and it goes out of the ordinary chat door as a PLAIN message (no sigil classification).
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0].text).toBe("wake the vault");
  await expect(page.locator(`${overlay} .kit-call-phase`)).toContainText("Thinking");

  // ⑤ HANG UP: the overlay goes instantly (no terminal screen) and the socket closes with it.
  await page.locator(".kit-call-hangup").click();
  await expect(page.locator(overlay)).toHaveCount(0);
  await expect.poll(() => relay.closed()).toBe(true);

  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("a transcript never routes as a shell command, and never touches the typed draft", async ({
  page,
  pageErrors,
}) => {
  const { relay, sends } = await boot(page);
  // Something already typed: the call must leave it exactly where it is (§4.5).
  await page.locator("#cmd-input").fill("a half-typed thought");
  await startCall(page);
  await relay.say({ type: "state", state: "ready" });

  // A misheard "bang" — the one transcript that must NOT become a shell run.
  await relay.say({ type: "transcript", text: "!rm -rf /", final: true });
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0].text).toBe("!rm -rf /"); // the agent chat door, verbatim — not `/api/exec`
  await expect(page.locator("#cmd-input")).toHaveValue("a half-typed thought");

  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("the relay's `busy` ends the call with the other call named", async ({ page, pageErrors }) => {
  const { relay } = await boot(page);
  await startCall(page);
  await relay.say({ type: "error", code: "busy", message: "a live call is already running" });

  await expect(page.locator(`${overlay} .kit-call-phase`)).toContainText("Call ended");
  await expect(page.locator(`${overlay} .kit-call-note`)).toHaveText("another call is active");
  // A terminal KEEPS the overlay up to say why; the button becomes the way out.
  await page.locator(".kit-call-hangup").click();
  await expect(page.locator(overlay)).toHaveCount(0);

  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

// ── S2b: the overlay's presentation + furniture (§6) ──────────────────────────────────────────────

test("MUTE closes the ear: the face flips and a final heard while muted never submits", async ({
  page,
  pageErrors,
}) => {
  const { relay, sends } = await boot(page);
  await startCall(page);
  await relay.say({ type: "state", state: "ready" });

  await page.getByRole("button", { name: "Mute" }).click();
  await expect(page.getByRole("button", { name: "Unmute" })).toBeVisible();
  await expect(page.locator(overlay)).toHaveClass(/muted/);
  await expect(page.locator(`${overlay} .kit-call-phase`)).toContainText("Muted");

  // The uplink KEEPS FLOWING while muted (delta round F3's one mechanism: Speaches must observe the
  // silence to endpoint), so a final can genuinely arrive here — and it is dropped flat.
  const before = relay.uplink.filter((u) => typeof u === "number").length;
  await relay.say({ type: "transcript", text: "the doorbell, not you", final: true });
  await expect
    .poll(() => relay.uplink.filter((u) => typeof u === "number").length)
    .toBeGreaterThan(before);
  await expect(page.locator(`${overlay} .kit-call-heard`)).toHaveText("");
  expect(sends).toHaveLength(0);

  // Unmute → a fresh utterance goes out the ordinary door.
  await page.getByRole("button", { name: "Unmute" }).click();
  await expect(page.getByRole("button", { name: "Mute" })).toBeVisible();
  await relay.say({ type: "transcript", text: "where were we", final: true });
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0].text).toBe("where were we");

  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("the RING mode knob decides which indicator the screen wears", async ({
  page,
  pageErrors,
}) => {
  const { relay } = await boot(page);
  await startCall(page);
  await relay.say({ type: "state", state: "ready" });
  // Ring mode: the stroke is drawn over the art and the phase line carries no dot — one indicator.
  await expect(page.locator(`${overlay} .kit-call-ring-stroke`)).toHaveCount(1);
  await expect(page.locator(`${overlay} .kit-call-dot`)).toHaveCount(0);
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("…and with `ring: false` the state rides the transcript line instead", async ({
  page,
  pageErrors,
}) => {
  const { relay } = await boot(page, { ring: false });
  await startCall(page);
  await relay.say({ type: "state", state: "ready" });
  await expect(page.locator(`${overlay} .kit-call-ring`)).toHaveCount(0);
  await expect(page.locator(`${overlay} .kit-call-heard .kit-call-dot`)).toHaveCount(1);
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("a terminal face redials through the SAME door, and the new machine starts fresh", async ({
  page,
  pageErrors,
}) => {
  const { relay } = await boot(page);
  await startCall(page);
  await relay.say({ type: "state", state: "ready" });
  await page.getByRole("button", { name: "Mute" }).click(); // …so "fresh" is provable
  await expect(page.locator(overlay)).toHaveClass(/muted/);

  await relay.say({ type: "error", code: "upstream", message: "the ear fell over" });
  await expect(page.locator(`${overlay} .kit-call-note`)).toHaveText("the ear fell over");
  await expect(page.getByRole("button", { name: "Call again" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();
  expect(relay.starts()).toBe(1);

  await page.getByRole("button", { name: "Call again" }).click();
  // MOUNTING IS STARTING: the key bump tore the old machine down and built a new one, which opened a
  // second SESSION and carries none of the first one's state — not its note, and not its mute.
  await expect(page.locator(`${overlay} .kit-call-phase`)).toContainText("Connecting");
  await expect(page.locator(overlay)).not.toHaveClass(/muted/);
  await expect(page.locator(`${overlay} .kit-call-note`)).toHaveCount(0);
  await expect.poll(() => relay.starts()).toBe(2);

  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

// ── S3: the flaky link (§4.5's reconnect contract, F6) ────────────────────────────────────────────

test("a leg dropped MID-UTTERANCE reconnects as a fresh session, and loses only that utterance", async ({
  page,
  pageErrors,
}) => {
  const { relay, sends } = await boot(page);
  await startCall(page);
  await relay.say({ type: "state", state: "ready" });
  await expect(page.locator(`${overlay} .kit-call-phase`)).toContainText("Listening");

  // The owner is mid-sentence when the link goes: the ear heard them START and the transcript for that
  // audio is never coming — §4.5 states that loss honestly rather than waiting for it.
  await relay.say({ type: "speech_started" });
  await relay.drop(1011);
  await expect(page.locator(`${overlay} .kit-call-phase`)).toContainText("Connecting");

  // RECONNECT = A NEW SESSION (§3.3 — there is no resume protocol): a second `start`, carrying the same
  // measured rate, because the capture underneath was never released.
  await expect.poll(() => relay.starts()).toBe(2);
  const [first, second] = relay.startFrames();
  expect(second.sample_rate).toBe(first.sample_rate);

  await relay.say({ type: "state", state: "ready" });
  await expect(page.locator(`${overlay} .kit-call-phase`)).toContainText("Listening");
  expect(sends).toHaveLength(0); // the lost utterance was never submitted, and nothing was stranded

  // …and the fresh leg is a working one: the next thing said goes out the ordinary door.
  await relay.say({ type: "transcript", text: "still there", final: true });
  await expect.poll(() => sends.length).toBe(1);
  expect(sends[0].text).toBe("still there");

  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("a backpressure-style unannounced close takes the same reconnect path", async ({
  page,
  pageErrors,
}) => {
  const { relay, sends } = await boot(page);
  await startCall(page);
  await relay.say({ type: "state", state: "ready" });

  // The client's own bail (`CLOSE_BACKPRESSURE`, 4000) and a relay that simply vanishes are the SAME
  // event from here: a close with nothing said in front of it. Only a typed `error`/`ended` is terminal.
  await relay.drop(4000);
  await expect(page.locator(`${overlay} .kit-call-phase`)).toContainText("Connecting");
  await expect.poll(() => relay.starts()).toBe(2);
  await relay.say({ type: "state", state: "ready" });
  await expect(page.locator(`${overlay} .kit-call-phase`)).toContainText("Listening");

  await relay.say({ type: "transcript", text: "back again", final: true });
  await expect.poll(() => sends.length).toBe(1);

  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("the BACK gesture hangs up instead of navigating the app out from under the call", async ({
  page,
  pageErrors,
}) => {
  const { relay } = await boot(page);
  const url = page.url();
  await startCall(page);
  await relay.say({ type: "state", state: "ready" });

  // ONE back closes the call and leaves the app exactly where it was — the single most common way a
  // PWA loses its user is the overlay that does not trap Back.
  await page.evaluate(() => history.back());
  await expect(page.locator(overlay)).toHaveCount(0);
  await expect(page.locator("#composer")).toBeVisible();
  expect(page.url()).toBe(url);
  await expect.poll(() => relay.closed()).toBe(true);

  // …and a REDIAL leaves exactly one entry too. This is the case that can leak: the old overlay
  // unmounts with its entry UNSPENT (the guard reclaims it) while the new one pushes its own, and a
  // miscount there costs the owner a second Back press for one call.
  await startCall(page);
  // The relay handle follows the NEWEST connection, so wait for this call's own `start` before
  // scripting it — otherwise the frame goes down the socket the first call already closed.
  await expect.poll(() => relay.starts()).toBe(2);
  await relay.say({ type: "error", code: "upstream", message: "the ear fell over" });
  await page.getByRole("button", { name: "Call again" }).click();
  await expect(page.locator(`${overlay} .kit-call-phase`)).toContainText("Connecting");
  await page.evaluate(() => history.back());
  await expect(page.locator(overlay)).toHaveCount(0);
  expect(page.url()).toBe(url);

  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});
