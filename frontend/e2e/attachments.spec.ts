import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "./fixtures";

// COMPOSER ATTACHMENTS end to end (D68 S3 / ATTACHMENTS_PLAN §7/§8), in the REAL built app.
//
// The vitest suites pin every seam separately — the pipeline, the send path, the three variants'
// chrome, the bubble branch. What only a browser run can prove is the CHAIN, and specifically the two
// links no jsdom test can execute:
//
//   · the EXPORT WORKER really runs (a module Worker + OffscreenCanvas + `convertToBlob`), so a picked
//     PNG reaches the mint re-encoded and renamed after its own output bytes;
//   · the bubble's `<img>` really LOADS from the serving route, and still does after a full reload —
//     which is the whole point of the §0b-2 overrule (the picture is durable, not a preview).
//
// `/api` is mocked at the browser level like every other spec; the SERVER's half of the serving rules
// (sniffed type inline, nosniff, disposition, the 404 ladder) is pinned in `test_attachments_d68.py`.

const IMAGES = join(dirname(fileURLToPath(import.meta.url)), "..", "tests", "fixtures", "images");
const PNG = readFileSync(join(IMAGES, "photo-320x240.png"));

/** What the mint answers with — the row the chip adopts (`api/attachments.py#StagedAttachment`). */
const MINTED = {
  attachment_id: "0".repeat(32),
  name: "photo.webp",
  kind: "image",
  mime: "image/webp",
  bytes: 4096,
};

/** The persisted user message the durable floor serves after the send — the SERVER builds the
 *  `AttachmentPart` (E2), which is exactly why the client re-reads instead of inventing one. */
const message = (text: string) => ({
  id: "m1",
  thread_id: "t1",
  role: "user",
  parts: [
    ...(text ? [{ type: "text", text }] : []),
    {
      type: "attachment",
      kind: "image",
      name: "photo.webp",
      mime: "image/webp",
      path: "t1/photo.webp",
      bytes: 4096,
      width: 320,
      height: 240,
    },
  ],
  actor: "user",
  ts: "2026-09-01T10:00:00Z",
  tokens: null,
  compacted: false,
});

/** Install the attachment half of the API over the baseline mock (last-registered wins). Returns the
 *  chat POST bodies it saw, so a send can be asserted on the wire. */
async function mockAttachments(page: import("@playwright/test").Page, caption = "look at this") {
  const sends: Record<string, unknown>[] = [];
  let sent = false;
  const json = (route: import("@playwright/test").Route, body: unknown, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

  await page.route("**/api/attachments/staging/**", (route) =>
    route.request().method() === "PUT" ? json(route, MINTED, 201) : route.fallback(),
  );
  // The serving route: real bytes, so the bubble's <img> genuinely decodes.
  await page.route("**/api/attachments/t1/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
  );
  await page.route("**/api/agent/chat", async (route) => {
    sends.push(route.request().postDataJSON() as Record<string, unknown>);
    sent = true;
    // A BUFFERED turn (D17): the client re-reads the durable floor, which is where the parts are.
    return json(route, { threadId: "t1", messages: [] });
  });
  await page.route("**/api/threads", (route) =>
    json(route, sent ? [{ id: "t1", title: "photo", agent: null, archived: false }] : []),
  );
  await page.route("**/api/threads/t1/messages", (route) =>
    json(route, sent ? [message(caption)] : []),
  );
  return sends;
}

const filePicker = "#composer input[type=file]";
const chip = ".kit-attach-chip";

test("a staged photo sends, paints in the bubble, and survives a reload", async ({
  page,
  pageErrors,
}) => {
  const sends = await mockAttachments(page);
  await page.goto("/");
  await page.locator("#tabbtn-agent").click();

  // PICK — through the clip's own hidden input, the one every variant renders.
  await page.setInputFiles(filePicker, {
    name: "photo-320x240.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  // …and it lands: the chip leaves `uploading` only when the real export worker has produced bytes
  // and the mint has answered.
  await expect(page.locator(`${chip}[data-status="staged"]`)).toHaveCount(1);
  // The upload carried the EXPORT's own extension, not the picked file's (R54: name the bytes).
  const put = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((e) => e.name),
  );
  expect(put.some((u) => u.includes("/api/attachments/staging/photo-320x240.webp"))).toBe(true);

  await page.locator("#cmd-input").fill("look at this");
  await page.locator("#cmd-send").click();

  // The ids rode the send…
  await expect.poll(() => sends[0]?.attachments).toEqual([MINTED.attachment_id]);
  // …the rail cleared with it…
  await expect(page.locator(chip)).toHaveCount(0);
  // …and the bubble paints the picture from the serving route.
  const shot = page.locator(".chat-attach-shot img");
  await expect(shot).toHaveAttribute("src", "/api/attachments/t1/photo.webp");
  await expect
    .poll(() => shot.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  // DURABLE — a full reload re-reads the thread and the picture is still there (§0b-2: the bubble
  // shows the stored file, never a client-side preview).
  await page.reload();
  await expect(page.locator(".chat-attach-shot img")).toHaveAttribute(
    "src",
    "/api/attachments/t1/photo.webp",
  );
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("a photo with NO caption is a legal send", async ({ page, pageErrors }) => {
  const sends = await mockAttachments(page, "");
  await page.goto("/");
  await page.locator("#tabbtn-agent").click();
  await page.setInputFiles(filePicker, {
    name: "photo-320x240.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(page.locator(`${chip}[data-status="staged"]`)).toHaveCount(1);

  // Empty composer — before D68 this was an FE early-return and, past it, a 422 at the door.
  await expect(page.locator("#cmd-input")).toHaveValue("");
  await page.locator("#cmd-send").click();

  await expect.poll(() => sends[0]?.text).toBe("");
  expect(sends[0]?.attachments).toEqual([MINTED.attachment_id]);
  await expect(page.locator(".chat-attach-shot img")).toBeVisible();
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});

test("a file this app does not take is refused BY NAME, and nothing is uploaded", async ({
  page,
  pageErrors,
}) => {
  let uploads = 0;
  await page.route("**/api/attachments/staging/**", (route) => {
    uploads++;
    return route.fulfill({ status: 201, contentType: "application/json", body: "{}" });
  });
  await page.goto("/");
  await page.locator("#tabbtn-agent").click();

  await page.setInputFiles(filePicker, {
    name: "report.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from("PK\x03\x04not really"),
  });

  // The NAMED refusal (R62 §3.2), announced once, saying which rule refused it and what IS taken.
  const alert = page.getByRole("alert");
  await expect(alert).toContainText(".docx files are not accepted");
  await expect(alert).toContainText("images");
  await expect(page.locator(`${chip}[data-status="failed"]`)).toHaveCount(1);
  expect(uploads).toBe(0); // refused before a byte left the device
  expect(pageErrors, pageErrors.join("; ")).toHaveLength(0);
});
