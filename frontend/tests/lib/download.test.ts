import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REVOKE_DELAY_MS, downloadBlob, downloadJson, downloadName } from "../../src/lib/download";

// THE ONE BLOB-ANCHOR DOWNLOAD (D79 / §15.3). Two properties are pinned: ① the anchor carries the
// filename and is clicked; ② the object URL is revoked on a DELAY, never in the same task as the click —
// an immediate revoke races a multi-MB PNG card's read on a slow phone (the old UtilCard copy did that).

let clicked: { href: string; download: string }[];
const created: Blob[] = [];
const revoked: string[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  clicked = [];
  created.length = 0;
  revoked.length = 0;
  // jsdom implements neither half of the object-URL API; stub both on the static.
  URL.createObjectURL = vi.fn((b: Blob) => {
    created.push(b);
    return `blob:test/${created.length}`;
  });
  URL.revokeObjectURL = vi.fn((u: string) => void revoked.push(u));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ href: this.href, download: this.download });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("downloadBlob", () => {
  it("clicks an anchor named for the file, pointing at the blob's object URL", () => {
    const blob = new Blob(["x"], { type: "image/png" });
    downloadBlob("Lynette.png", blob);
    expect(created).toEqual([blob]);
    expect(clicked).toEqual([{ href: "blob:test/1", download: "Lynette.png" }]);
  });

  it("revokes the URL only after the delay — never in the click's own task", () => {
    downloadBlob("card.png", new Blob(["x"]));
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(REVOKE_DELAY_MS - 1);
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(revoked).toEqual(["blob:test/1"]);
  });
});

describe("downloadJson", () => {
  it("serialises pretty JSON as application/json through the same anchor", async () => {
    downloadJson("hollow-sea.json", { name: "Hollow Sea", entries: {} });
    expect(clicked[0].download).toBe("hollow-sea.json");
    expect(created[0].type).toBe("application/json");
    expect(await created[0].text()).toBe(
      JSON.stringify({ name: "Hollow Sea", entries: {} }, null, 2),
    );
  });
});

describe("downloadName — the sanitiser takes the extension WITH the stem (Opus F14)", () => {
  it("keeps a dotted title whole (sanitizeStem cuts at the LAST dot)", () => {
    expect(downloadName("Dr. Watson", ".png")).toBe("Dr. Watson.png");
    expect(downloadName("Lynette", ".json")).toBe("Lynette.json");
  });

  it("drops what the media admission tier refuses", () => {
    expect(downloadName('Who: "Me"?', ".png")).toBe("Who Me.png");
    expect(downloadName("a/b\\c", ".json")).toBe("abc.json");
  });
});
