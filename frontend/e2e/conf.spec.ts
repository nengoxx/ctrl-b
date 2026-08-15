import { test, expect } from "./fixtures";

// A11/D48 Slice 2 — B4 field-by-field parity (D48 C11). The registry migration must not cost the Conf
// UI a single control: every Inference / Voice STT / Voice TTS / Embeddings knob that existed before
// still renders, is editable, and (for the ref sections) is driven by the shared provider→model picker.
// The `/api/settings` PUT echoes `{}` under the mock, so "round-trips" here means the control exists and
// edits its live draft value (and dirties the Save bar); server persistence is covered by the vitest save-
// payload assertions. Fixtures seed the new-shape voice/embeddings (see e2e/fixtures.ts).

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.locator("#tabbtn-conf").click();
});

test("Conf · Inference — timeout + prompt controls + primary/fallback pickers", async ({
  page,
}) => {
  const inf = page.locator("#inference");
  // primary picker: llamacpp is sole-model → the model select auto-hides; the openrouter fallback shows one.
  await expect(inf.getByLabel("Default provider")).toHaveValue("llamacpp");
  await expect(inf.getByLabel("Default model")).toHaveCount(0);
  await expect(inf.getByLabel("Fallback 1 provider")).toHaveValue("openrouter");
  await expect(inf.getByLabel("Fallback 1 model")).toHaveValue("qwen3.5");
  await expect(inf.getByRole("switch", { name: "Inference failover" })).toBeVisible();
  // service knobs stay
  const timeout = inf.getByLabel("Request timeout");
  await expect(timeout).toHaveValue("120");
  await timeout.fill("150");
  await expect(timeout).toHaveValue("150");
  await expect(inf.getByText("System prompt", { exact: true })).toBeVisible();
  await expect(inf.getByText("System prompt append", { exact: true })).toBeVisible();
  // dirtying the draft enables this group's Save bar
  await expect(inf.getByRole("button", { name: "Save changes" })).toBeEnabled();
});

// Phase 18 / D56 — the prompt registry section. The 390px project viewport IS the narrow-viewport gate
// for the pair editor: both fields, the shipped default and the placeholder chips have to fit the
// phone. The group ships collapsed (it's a long list), so the spec opens it first.
test("Conf · Prompts — the registry list + the two-field editor", async ({ page }) => {
  const group = page.locator("#prompts");
  await expect(group.getByText("1 customized")).toBeVisible(); // the header summary, group still shut
  await group.locator(".conftitle").click();

  await expect(group.getByText("Memory Intro")).toBeVisible();
  await expect(group.getByText("Per Tool Cap")).toBeVisible();
  await expect(group.getByText("customized", { exact: true })).toBeVisible();
  await expect(group.getByRole("button", { name: "restore" })).toBeVisible();

  // the preview opens the shared modal in PAIR mode
  await group.locator(".prow").nth(1).locator(".prow-preview").click();
  const modal = page.getByRole("dialog", { name: "Per Tool Cap" });
  await expect(modal.getByLabel("Override")).toBeVisible();
  await expect(modal.getByLabel("Append")).toBeVisible();
  await expect(modal.getByText("{{tool}}", { exact: true })).toBeVisible();
  await expect(modal.getByText(/Coupling: the loop guard counts it/)).toBeVisible();
  // the shipped default is one disclosure away (stacked at 390px)
  await modal.getByText("Default text").click();
  await expect(modal.getByText(/vary the call or move on/).first()).toBeVisible();

  await modal.getByLabel("Override").fill("say it my way");
  await modal.getByRole("button", { name: "Set" }).click();
  await expect(group.getByRole("button", { name: "Save 1 change" })).toBeEnabled();
});

test("Conf · Voice STT — every knob + primary/fallback pickers (no failover switch)", async ({
  page,
}) => {
  const stt = page.locator("#voice-stt");
  await expect(stt.getByRole("switch", { name: "Voice enabled" })).toBeVisible();
  await expect(stt.getByLabel("Language")).toHaveValue("en");
  await expect(stt.getByRole("switch", { name: "STT VAD filter" })).toBeVisible();
  await expect(stt.getByLabel("Hotwords")).toBeVisible();
  await expect(stt.getByRole("switch", { name: "STT auto-send" })).toBeVisible();
  // the primary picker points at the registry (openrouter/whisper)
  await expect(stt.getByLabel("Voice STT default provider")).toHaveValue("openrouter");
  await expect(stt.getByLabel("Voice STT default model")).toHaveValue("whisper");
  await expect(stt.getByLabel("Connect timeout")).toHaveValue("3");
  await expect(stt.getByLabel("Read timeout")).toHaveValue("30");
  // STT chains always walk — there is deliberately no Failover switch
  await expect(stt.getByText("Failover")).toHaveCount(0);
  // adding a fallback surfaces the fallback picker (the ordered chain editor)
  await stt.getByRole("button", { name: "+ add fallback" }).click();
  await expect(stt.getByLabel("Voice STT fallback 1 provider")).toBeVisible();
});

test("Conf · Voice TTS — auto-read + format + timeouts + pickers", async ({ page }) => {
  // ttsConfigured gates the device-local Auto read-aloud row; flip the runtime status so it renders.
  await page.route("**/api/voice/status", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ stt: true, tts: true }),
    }),
  );
  await page.reload();
  await page.locator("#tabbtn-conf").click();
  const tts = page.locator("#voice-tts");
  await expect(tts.getByRole("switch", { name: "Auto read-aloud" })).toBeVisible();
  // the Format segmented control stays (C8 service fallback: model format > service format)
  const format = tts.getByRole("group", { name: "Format" });
  await expect(format).toBeVisible();
  await format.getByRole("button", { name: "opus" }).click();
  await expect(format.getByRole("button", { name: "opus" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // the primary picker points at the registry (openrouter/kokoro)
  await expect(tts.getByLabel("Voice TTS default provider")).toHaveValue("openrouter");
  await expect(tts.getByLabel("Voice TTS default model")).toHaveValue("kokoro");
  await expect(tts.getByLabel("Connect timeout")).toHaveValue("3");
  await expect(tts.getByLabel("Read timeout")).toHaveValue("30");
});

test("Conf · Embeddings — picker + enabled + timeout + per-model dim", async ({ page }) => {
  const emb = page.locator("#embeddings");
  await expect(emb.getByLabel("Embeddings default provider")).toHaveValue("openrouter");
  await expect(emb.getByLabel("Embeddings default model")).toHaveValue("qwen-embed");
  await expect(emb.getByLabel("Read timeout")).toHaveValue("60");
  await expect(emb.getByRole("switch", { name: "Embeddings enabled" })).toBeVisible();

  // the vector dim moved to the per-model row (D48 C8). Open the openrouter card; the qwen-embed row
  // (2nd model) carries dim 2560 in its auto-opened Advanced fold.
  await page.locator("#providers").getByText("openrouter", { exact: true }).click();
  const dim = page.locator("#providers .model-row").nth(1).getByLabel("Model embedding dim");
  await expect(dim).toHaveValue("2560");
  await dim.fill("1536");
  await expect(dim).toHaveValue("1536");
});
