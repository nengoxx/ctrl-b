import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, PickedFileUnsentError, putBytes } from "../../src/api/client";
import { installFakeXhr } from "./fakeXhr";

// The app's raw-body write helper — every non-JSON write goes through it (D65 the media upload, D68
// the attachment mint, D70 both imports). Three things are worth pinning. ① THE REQUEST SHAPE IS A
// SECURITY PROPERTY (R73 / SECURITY_MODEL §2.7/§2.9): a raw-body PUT is not CORS-safelisted, so a
// hostile page cannot emit it without a preflight this app answers with no ACAO — a regression to
// POST or to `FormData` silently removes that defence, so the method and the body type are asserted.
// ② THE PICKED FILE IS SENT ITSELF, over XHR (2026-10-01): Chrome on Android can hand the page a
// picked file whose recorded size is 0, and only XHR's `send(file)` re-reads it by path — a `fetch`
// body, a `new Blob([file])` wrap or a pre-read `arrayBuffer()` all sent 0 bytes on the owner's phone.
// ③ The error path: these routes' statuses are ones the owner reads verbatim, so they must arrive as
// an `ApiError` carrying the server's own detail rather than a bare status line.

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** What an import sends: the owner's picked file, straight in (a `File` IS a `Blob`). */
const card = () => new File([new Blob(["x"])], "lyra.png", { type: "image/png" });

describe("putBytes", () => {
  it("PUTs the RAW bytes — never POST, never FormData (the preflight defence)", async () => {
    const { calls: sent } = installFakeXhr({ status: 201, json: { name: "lyra" } });
    await expect(putBytes<{ name: string }>("/api/agents/import", card())).resolves.toEqual({
      name: "lyra",
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("/api/agents/import");
    expect(sent[0].method).toBe("PUT");
    expect(sent[0].body).toBeInstanceOf(Blob);
    expect(sent[0].body).not.toBeInstanceOf(FormData);
    // The blob's own type rides as advisory Content-Type; the server sniffs the magic bytes.
    expect(sent[0].headers).toMatchObject({
      "Content-Type": "image/png",
      Accept: "application/json",
    });
  });

  it("sends the picked File ITSELF — not a wrap, not a copy (Chrome sends it by path)", async () => {
    const { calls: sent } = installFakeXhr({ status: 201, json: {} });
    const file = card();
    await putBytes("/api/agents/import", file);
    expect(sent[0].body).toBe(file);
  });

  it("does not go through fetch (a fetch body sends a zero-size picked file as 0 bytes)", async () => {
    installFakeXhr({ status: 201, json: {} });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await putBytes("/api/agents/import", card());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to application/octet-stream for a typeless body", async () => {
    const { calls: sent } = installFakeXhr({ status: 200, json: { ok: true } });
    await putBytes("/api/lorebooks/import", new Blob(["{}"]));
    expect(sent[0].headers).toMatchObject({ "Content-Type": "application/octet-stream" });
  });

  it("carries a caller's precondition header (the media edit's X-Expected-Revision)", async () => {
    const { calls: sent } = installFakeXhr({ status: 200, json: {} });
    await putBytes("/api/media/x", new Blob(["x"]), { "X-Expected-Revision": "r1" });
    expect(sent[0].headers).toMatchObject({ "X-Expected-Revision": "r1" });
  });

  it("maps a refusal to ApiError carrying the STATUS and the server's own detail", async () => {
    installFakeXhr({
      status: 413,
      json: { detail: "the card is larger than roleplay.card_import.max_bytes (15000000 bytes)" },
    });
    await expect(putBytes("/api/agents/import", card())).rejects.toMatchObject({
      name: "ApiError",
      status: 413,
      message: "the card is larger than roleplay.card_import.max_bytes (15000000 bytes)",
    });
  });

  it("renders a 422 validation list through the SHARED detail renderer", async () => {
    installFakeXhr({
      status: 422,
      json: { detail: [{ loc: ["body"], msg: "invalid agent: bad slug", type: "value_error" }] },
    });
    const err = await putBytes("/api/agents/import", card()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("body: invalid agent: bad slug");
  });

  it("falls back to the status line when the error body is not JSON", async () => {
    installFakeXhr({ status: 502, statusText: "Bad Gateway", text: "<html>gateway</html>" });
    await expect(putBytes("/api/agents/import", card())).rejects.toMatchObject({
      status: 502,
      message: "502 Bad Gateway",
    });
  });

  it("rejects a network failure as fetch's own TypeError", async () => {
    installFakeXhr("network-error");
    const err = await putBytes("/api/agents/import", card()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    // A non-empty File is an ordinary network failure — never the picker hint.
    expect(err).not.toBeInstanceOf(PickedFileUnsentError);
    expect((err as TypeError).message).toBe("Failed to fetch");
  });

  it("a size-0 Blob that fails to send is the plain TypeError too — only a picked File is hinted", async () => {
    installFakeXhr("network-error");
    const err = await putBytes("/api/x", new Blob([])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(PickedFileUnsentError);
    expect((err as TypeError).message).toBe("Failed to fetch");
  });

  it("a picked File that reported size 0 and failed to send names the picker (ISS-47 ⓓ)", async () => {
    // Chromium's `ERR_UPLOAD_FILE_CHANGED` reaches page JS as a bare XHR error with status 0 — the
    // size-0 File is the only signal, so the rejection carries the hint and stays a TypeError (every
    // caller's catch still classifies it as a network failure; the import toasts show `e.message`).
    installFakeXhr("network-error");
    const empty = new File([], "lyra.png", { type: "image/png" });
    const err = await putBytes("/api/agents/import", empty).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PickedFileUnsentError);
    expect(err).toBeInstanceOf(TypeError);
    expect((err as Error).message).toContain("file picker reported this file as empty");
    expect((err as Error).message).toContain("check the connection");
  });

  it("keeps a null-body status from crashing the Response rebuild (a 304)", async () => {
    installFakeXhr({ status: 304, statusText: "Not Modified" });
    await expect(putBytes("/api/x", card())).rejects.toMatchObject({ status: 304 });
  });

  it("REJECTS a status the Response cannot carry — never leaves the upload pending", async () => {
    // A proxy answering outside 200–599 makes `new Response` throw inside `onload`; uncaught there,
    // the promise would never settle and the import button would sit on "importing…" forever.
    installFakeXhr({ status: 600, text: "?" });
    await expect(putBytes("/api/x", card())).rejects.toBeInstanceOf(RangeError);
  });
});
