import { seedUI, test, expect } from "./fixtures";

// THE DUAL-MODE MIC GESTURE, IN A REAL BROWSER (Phase 24 / S0.5 — LIVE_VOICE_PLAN §6, D71).
//
// The unit suites pin the machine's arms and the wiring's calls; what only a real engine can answer is
// whether the posture actually HOLDS one gesture together: `setPointerCapture` keeping pointermove/up on
// the button after the cursor has left its box, the 150 ms activation landing against a real clock, the
// chrome painting outside the composer's `overflow: hidden`, and the trailing `click` that every pointer
// sequence dispatches not double-firing into a second recording.
//
// DETERMINISM: the browser's own mic is never opened. `getUserMedia` and `MediaRecorder` are replaced in
// an init script — no `--use-fake-device-for-media-stream` flag, no permission prompt, no audio — because
// the subject under test is the GESTURE, and the recorder's real behaviour is the unit suites' business.
// `/api/voice/stt` is mocked and COUNTED: "was there a POST" is what separates a send from a cancel.

/** Replace the capture stack with something inert and synchronous. */
const FAKE_MEDIA = () => {
  class FakeRecorder {
    static isTypeSupported() {
      return true;
    }
    mimeType: string;
    state = "inactive";
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_stream: unknown, opts?: { mimeType?: string }) {
      this.mimeType = opts?.mimeType ?? "audio/webm";
    }
    start() {
      this.state = "recording";
    }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) });
      this.onstop?.();
    }
  }
  Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FakeRecorder });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
  });
};

/** Boot the agent tab with STT on, the capture stack faked, and the STT POST counted. */
async function boot(page: import("@playwright/test").Page) {
  const posts = { n: 0 };
  // AFTER the fixture's blanket `**/api/**` route — last registered wins in Playwright.
  await page.route("**/api/voice/status", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ stt: true, tts: false, stt_auto_send: false }),
    }),
  );
  await page.route("**/api/voice/stt", (r) => {
    posts.n += 1;
    return r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ text: "spoken words" }),
    });
  });
  await page.addInitScript(FAKE_MEDIA);
  await seedUI(page, { theme: "cosmos", mode: "dark", accent: "violet", tab: "agent", v: 1 });
  await page.goto("/");
  const mic = page.locator("#composer .kit-cbtn.mic");
  await expect(mic).toBeVisible();
  return { posts, mic, field: page.locator("#cmd-input") };
}

/** The mic button's centre, in page coordinates. */
async function centre(mic: import("@playwright/test").Locator) {
  const box = (await mic.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Held past BOTH the 150 ms activation and the 1000 ms clip floor — against a real clock. */
const HOLD_MS = 1300;

test("hold → release dictates: the transcript lands in the composer draft", async ({
  page,
  pageErrors,
}) => {
  const { posts, mic, field } = await boot(page);
  const at = await centre(mic);

  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  // The record affordance appears at activation, OUTSIDE the composer's box — which is the whole reason
  // the chrome is a sibling rather than a child (the sheet/line bars clip children).
  await expect(page.locator(".mg-circle")).toBeVisible();
  await expect(mic).toHaveClass(/rec/);
  // Round 2: the composer's placeholder YIELDS while recording — the slide-to-cancel track paints
  // across the field, and the two texts were unreadable together (owner). Only a real engine can see
  // a ::placeholder, so this is the assertion's home.
  expect(await field.evaluate((el) => getComputedStyle(el, "::placeholder").color)).toBe(
    "rgba(0, 0, 0, 0)",
  );
  await page.waitForTimeout(HOLD_MS);
  await page.mouse.up();

  await expect(field).toHaveValue("spoken words");
  expect(posts.n).toBe(1);
  // The trailing `click` a pointer sequence dispatches must NOT have started a second recording.
  await expect(mic).not.toHaveClass(/rec/);
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("slide left cancels: no POST, no draft", async ({ page, pageErrors }) => {
  const { posts, mic, field } = await boot(page);
  const at = await centre(mic);

  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect(mic).toHaveClass(/rec/);
  await page.waitForTimeout(HOLD_MS); // long enough to upload, so only the cancel explains the silence
  await expect(page.locator(".mg-track")).toBeVisible();
  // Capture keeps the move on the button even though the cursor is now far outside it.
  await page.mouse.move(at.x - 300, at.y, { steps: 6 });
  await page.mouse.up();

  await expect(mic).not.toHaveClass(/rec/);
  await expect(field).toHaveValue("");
  expect(posts.n).toBe(0);
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("swipe up locks hands-free: the TOOLS TRIGGER becomes CANCEL and the button becomes tap-to-stop", async ({
  page,
  pageErrors,
}) => {
  const { posts, mic, field } = await boot(page);
  const at = await centre(mic);
  // S0.5 feel round OF-5: the locked recording's tap twin is the tools/skills trigger at the controls
  // row's LEADING edge, morphed — not a floating button. This is the one place the real cascade runs, so
  // it is where "the trigger is composed outside the composer variant and still finds the gesture" is
  // actually exercised end to end.
  const tools = page.locator("#composer .kit-cbtn.tools");
  const cancel = page.getByRole("button", { name: "cancel recording" });

  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect(mic).toHaveClass(/rec/);
  await expect(cancel).toHaveCount(0); // no tap twin while the hand is on the button
  await page.mouse.move(at.x, at.y - 80, { steps: 6 }); // past the 56 px latch
  await expect(cancel).toBeVisible();
  await expect(tools).toHaveClass(/cancelling/); // …and it is the SAME button, not a new one
  await expect(page.locator(".mg-cancel")).toHaveCount(0);
  await page.mouse.up(); // the LOCKING pointer's release stops nothing
  await page.waitForTimeout(HOLD_MS);
  await expect(mic).toHaveClass(/rec/);

  await mic.click(); // …a fresh tap does
  await expect(field).toHaveValue("spoken words");
  expect(posts.n).toBe(1);
  await expect(tools).not.toHaveClass(/cancelling/); // morphed back once the recording ended
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("the locked CANCEL discards through the morphed trigger — no POST, no draft", async ({
  page,
  pageErrors,
}) => {
  const { posts, mic, field } = await boot(page);
  const at = await centre(mic);
  const cancel = page.getByRole("button", { name: "cancel recording" });

  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await expect(mic).toHaveClass(/rec/);
  await page.mouse.move(at.x, at.y - 80, { steps: 6 }); // lock
  await page.mouse.up();
  await page.waitForTimeout(HOLD_MS); // long enough to upload, so only the cancel explains the silence
  await cancel.click();

  await expect(mic).not.toHaveClass(/rec/);
  await expect(field).toHaveValue("");
  expect(posts.n).toBe(0);
  // the menu it normally opens must NOT have been toggled on the way past (the panel stays MOUNTED for
  // its close animation and is `inert` when shut, so `.open` is what "open" means here)
  await expect(page.locator(".tools-sheet.open")).toHaveCount(0);
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});
