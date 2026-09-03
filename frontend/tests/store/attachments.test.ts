import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// THE STAGED SET'S PERSISTENCE (D68, the S6 fix wave — owner finding F3) — `store/attachments` as the
// draft's neighbour: what the owner attached survives the page.
//
// The ruling this file pins (it OVERRULES S3's "deliberately NOT persisted" header, so it is a ruling
// and not a preference): Android Chrome discards a backgrounded tab, and going to the camera app is the
// ordinary way to attach a photo — so losing the rail was the common case, while a staged file lives on
// the server for `staging_orphan_hours` (24h). A restored id that HAS expired refuses at send with the
// server's own 409 sentence, which is why no validation round-trip is needed here.
//
// The three properties, each of which is a defect if it rots:
//   · WHAT is persisted — `staged` rows only, and `sending` rows are DROPPED (MED-1: restoring one whose
//     POST got its 202 would double-send the file);
//   · WHAT COMES BACK — nothing is cast (LOW-7): a corrupt blob, a corrupt row, or a stored top-level
//     array yields MISSING chips, never wrong ones;
//   · WHAT IT COSTS — the thumbnails are budgeted (MED-6), because `savePersisted` swallows a quota
//     error by design and an oversized blob would silently take the whole rail down with it.

import {
  addStaged,
  clearStaged,
  consumeStaged,
  releaseStaged,
  removeStaged,
  reserveStaged,
  stagedFiles,
  updateStaged,
  type StagedAttachment,
} from "../../src/store/attachments";

const KEY = "ctrlb.attachments";

const staged = (id: string, over: Partial<StagedAttachment> = {}): StagedAttachment => ({
  localId: `local-${id}`,
  name: `${id}.webp`,
  kind: "image",
  status: "staged",
  attachmentId: id,
  bytes: 4096,
  ...over,
});

/** The blob as it actually sits in storage. */
function stored(): { files?: unknown } | null {
  const raw = localStorage.getItem(KEY);
  return raw === null ? null : (JSON.parse(raw) as { files?: unknown });
}

function rows(): Record<string, unknown>[] {
  return (stored()?.files ?? []) as Record<string, unknown>[];
}

/** A RELOAD, as far as this store is concerned: a fresh module instance, whose init reads whatever is in
 *  localStorage right now. The only way to exercise the load path at all — the store reads it once, at
 *  module scope, deliberately (before any mutation can race it). */
async function reload(): Promise<typeof import("../../src/store/attachments")> {
  vi.resetModules();
  return await import("../../src/store/attachments");
}

beforeEach(() => {
  clearStaged();
  localStorage.clear();
});
afterEach(() => {
  clearStaged();
  localStorage.clear();
});

describe("the projection — what is worth keeping", () => {
  it("persists `staged` rows only, with the five facts a chip is rebuilt from", () => {
    addStaged(staged("id-1", { previewUrl: "blob:live", thumb: "data:image/jpeg;base64,AAAA" }));
    addStaged({ localId: "l2", name: "up.png", kind: "image", status: "uploading" });
    addStaged({ localId: "l3", name: "bad.png", kind: "image", status: "failed", error: "nope" });
    expect(rows()).toEqual([
      {
        attachmentId: "id-1",
        name: "id-1.webp",
        kind: "image",
        bytes: 4096,
        thumb: "data:image/jpeg;base64,AAAA",
      },
    ]);
    // Not persisted, and each for its own reason: the object URL dies with the page, the local id is
    // this page's handle, and the status/error are facts about a life that has ended.
    const [row] = rows();
    expect("previewUrl" in row).toBe(false);
    expect("localId" in row).toBe(false);
    expect("status" in row).toBe(false);
    expect("error" in row).toBe(false);
  });

  it("EVERY mutating export writes through — the store has no un-persisted exit", () => {
    addStaged(staged("id-1"));
    expect(rows()).toHaveLength(1);
    updateStaged("local-id-1", { name: "renamed.webp" });
    expect(rows()[0].name).toBe("renamed.webp");
    addStaged(staged("id-2"));
    removeStaged("local-id-2");
    expect(rows().map((r) => r.attachmentId)).toEqual(["id-1"]);
    consumeStaged(["id-1"]);
    expect(rows()).toEqual([]);
  });

  it("a RESERVED row leaves the projection (MED-1), and comes back when it is released", () => {
    addStaged(staged("id-1"));
    addStaged(staged("id-2"));
    const reserved = reserveStaged();
    expect(reserved).toEqual(["id-1", "id-2"]);
    // Nothing spoken-for is restorable: a reservation is a promise made to a request this page no
    // longer remembers, and restoring one whose POST was accepted would send the file twice.
    expect(rows()).toEqual([]);
    releaseStaged(["id-1"]);
    expect(rows().map((r) => r.attachmentId)).toEqual(["id-1"]);
  });

  it("clearing the rail clears the blob with it", () => {
    addStaged(staged("id-1"));
    clearStaged();
    expect(rows()).toEqual([]);
  });
});

describe("the load — nothing is cast (LOW-7)", () => {
  it("restores the rail a reload lost, as `staged` rows with their thumbnails", async () => {
    addStaged(staged("id-1", { previewUrl: "blob:live", thumb: "data:image/jpeg;base64,AAAA" }));
    addStaged(staged("id-2", { name: "notes.txt", kind: "text", bytes: 12 }));
    const store = await reload();
    expect(store.stagedFiles()).toEqual([
      {
        localId: "att-restored-0",
        name: "id-1.webp",
        kind: "image",
        status: "staged",
        attachmentId: "id-1",
        bytes: 4096,
        thumb: "data:image/jpeg;base64,AAAA",
      },
      {
        localId: "att-restored-1",
        name: "notes.txt",
        kind: "text",
        status: "staged",
        attachmentId: "id-2",
        bytes: 12,
      },
    ]);
    // No object URL survives a page: the thumbnail is the restored chip's whole face.
    expect(store.stagedFiles().some((f) => f.previewUrl !== undefined)).toBe(false);
    // …and they are immediately sendable, which is the entire point of keeping them.
    expect(store.stagedIds()).toEqual(["id-1", "id-2"]);
    expect(store.hasStaged()).toBe(true);
  });

  it("a corrupt blob restores nothing at all", async () => {
    localStorage.setItem(KEY, "{not json");
    expect((await reload()).stagedFiles()).toEqual([]);
  });

  it("a stored top-level ARRAY restores nothing — which is why the blob wraps the list", async () => {
    // `loadPersisted`'s defaults-over-merge refuses an array outright (it would spread to junk numeric
    // keys); the wrapper object is what makes the persisted shape legible to it at all.
    localStorage.setItem(KEY, JSON.stringify([{ attachmentId: "id-1", name: "a", kind: "image" }]));
    expect((await reload()).stagedFiles()).toEqual([]);
  });

  it("a `files` that is not a list restores nothing", async () => {
    localStorage.setItem(KEY, JSON.stringify({ files: "id-1" }));
    expect((await reload()).stagedFiles()).toEqual([]);
  });

  it("drops the rows it cannot trust, and keeps the ones beside them", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        files: [
          null,
          "id-1",
          { name: "no-id.webp", kind: "image" }, // no claim credential — unsendable
          { attachmentId: "", name: "empty.webp", kind: "image" },
          { attachmentId: "id-2", name: 7, kind: "image" },
          { attachmentId: "id-3", name: "odd.bin", kind: "binary" }, // not an AttachKind
          { attachmentId: "id-4", name: "good.webp", kind: "image" },
        ],
      }),
    );
    const store = await reload();
    expect(store.stagedFiles().map((f) => f.attachmentId)).toEqual(["id-4"]);
    expect(store.stagedIds()).toEqual(["id-4"]);
  });

  it("a field of the wrong TYPE is dropped, never repaired — the row still comes back", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        files: [{ attachmentId: "id-1", name: "a.webp", kind: "image", bytes: "big", thumb: 7 }],
      }),
    );
    const [row] = (await reload()).stagedFiles();
    expect(row).toEqual({
      localId: "att-restored-0",
      name: "a.webp",
      kind: "image",
      status: "staged",
      attachmentId: "id-1",
    });
  });

  it("a restored row's local id can never collide with a picked one", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ files: [{ attachmentId: "id-1", name: "a.webp", kind: "image" }] }),
    );
    const store = await reload();
    // `lib/attachments` mints `att-<time>-<seq>`; these are minted here and are never in that sequence.
    expect(store.stagedFiles()[0].localId).toMatch(/^att-restored-/);
  });
});

// MED-6 — the thumbnails are the only unbounded thing in the blob, and `savePersisted` swallows a quota
// error BY DESIGN (a failed write must never break the in-memory state). `max_files_per_message` is a
// config knob with NO ceiling (confirm round, MED-6 round 2), so no file count is "the maximum" — the
// projection enforces its OWN total thumbnail budget, and these tests pin that mechanism rather than
// any count arithmetic.
describe("the persisted blob's budget (MED-6)", () => {
  it("ten staged files with 25KB thumbnails serialise well under 1MB", () => {
    const thumb = `data:image/jpeg;base64,${"A".repeat(25 * 1024)}`;
    for (let at = 0; at < 10; at++) addStaged(staged(`id-${at}`, { thumb }));
    expect(stagedFiles()).toHaveLength(10); // the `max_files_per_message` DEFAULT — not a ceiling
    const size = (localStorage.getItem(KEY) ?? "").length;
    expect(size).toBeGreaterThan(250_000); // the thumbnails really are in there…
    expect(size).toBeLessThan(1_000_000); // …and ten of them are a fraction of the ~5MB origin quota
  });

  it("a rail past the thumb budget keeps EVERY row and sheds pictures from the tail, never the head", () => {
    // 80 chips, each thumbnail at lib/attachments' 64KB per-thumb ceiling — the configuration the
    // confirm round named: unbounded by count, this would pass the ~5MB origin quota and the whole
    // write would be silently dropped. The projection's own budget is what closes it.
    const thumb = `data:image/jpeg;base64,${"A".repeat(64 * 1024)}`;
    for (let at = 0; at < 80; at++) addStaged(staged(`id-${at}`, { thumb }));
    const blob = JSON.parse(localStorage.getItem(KEY) ?? "{}") as {
      files: { attachmentId: string; thumb?: string }[];
    };
    // Every row persists — the budget sheds PICTURES, never restorable rows.
    expect(blob.files).toHaveLength(80);
    // The kept thumbnails are a PREFIX of the rail (the chips the owner looks for first), and at
    // least one fit — the budget admits thumbs until it is spent, in order.
    const lastKept = blob.files.findLastIndex((f) => f.thumb !== undefined);
    expect(lastKept).toBeGreaterThanOrEqual(0);
    expect(blob.files.slice(0, lastKept + 1).every((f) => f.thumb !== undefined)).toBe(true);
    // The whole serialised blob stays far below the quota hazard, whatever the count.
    expect((localStorage.getItem(KEY) ?? "").length).toBeLessThan(1_300_000);
  });

  it("the first overflowing thumb CLOSES the window — a later, smaller one is not admitted either", () => {
    // The micro-confirm's counter-example to a per-thumb first-fit: spend most of the budget, then a
    // chip whose thumbnail overflows, then a chip with a tiny one. First-fit would picture the tiny
    // one while its predecessor goes without — a rail the owner reads as broken. The prefix rule says
    // both go without.
    const big = `data:image/jpeg;base64,${"A".repeat(200 * 1024)}`;
    const tiny = `data:image/jpeg;base64,${"A".repeat(1024)}`;
    for (let at = 0; at < 5; at++) addStaged(staged(`id-big-${at}`, { thumb: big })); // ~1000KB spent
    addStaged(staged("id-overflow", { thumb: big })); // would pass 1M — closes the window
    addStaged(staged("id-tiny", { thumb: tiny })); // fits by size, refused by the prefix rule
    const persisted = rows();
    expect(persisted).toHaveLength(7); // every row is still restorable
    expect(persisted[5].thumb).toBeUndefined();
    expect(persisted[6].thumb).toBeUndefined();
    expect(persisted.slice(0, 5).every((f) => f.thumb !== undefined)).toBe(true);
  });
});
