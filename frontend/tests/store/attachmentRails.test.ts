import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StagedAttachment } from "../../src/store/attachments";

// Phase 27 S8 — ONE STAGED RAIL PER CONVERSATION (`store/attachments`; CONVERSATIONS_PLAN §6 R31/R34,
// §12.3 H4/M4/M5). The single-rail contracts (the ladder, the projection's five facts, nothing cast, the
// prefix budget) stay pinned in `attachments.test.ts`; what is pinned HERE is what the rails add:
//   · the shape `{rails: {<thread id | "">: rows}}` and the `{files}` fold;
//   · the SLOT-scoped reads (the composer's view and the reads that build a send) vs the ID-ADDRESSED
//     mutations that cross every rail (a hop mid-send / mid-upload, H4);
//   · ONE thumbnail budget across the whole blob, the current rail first (M5);
//   · a write patches only the entries it changed (M4).
// The slot is moved through `store/composer#setComposerSlot` — the one setter the chat store calls.

type Stores = {
  a: typeof import("../../src/store/attachments");
  c: typeof import("../../src/store/composer");
};
async function load(): Promise<Stores> {
  vi.resetModules();
  const a = await import("../../src/store/attachments");
  const c = await import("../../src/store/composer");
  return { a, c };
}

const KEY = "ctrlb.attachments";
const stored = (): { rails?: Record<string, { attachmentId: string; thumb?: string }[]> } =>
  JSON.parse(localStorage.getItem(KEY) ?? "{}") as {
    rails?: Record<string, { attachmentId: string; thumb?: string }[]>;
  };

const chip = (id: string, over: Partial<StagedAttachment> = {}): StagedAttachment => ({
  localId: `local-${id}`,
  name: `${id}.webp`,
  kind: "image",
  status: "staged",
  attachmentId: id,
  ...over,
});
const ids = (rows: readonly StagedAttachment[]) => rows.map((f) => `${f.attachmentId}:${f.status}`);

beforeEach(() => {
  localStorage.clear();
});

describe("the shape and the `{files}` fold (R31)", () => {
  it('the legacy `{files}` loads under `""`; the old key goes with the next write', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ files: [{ attachmentId: "old", name: "old.webp", kind: "image" }] }),
    );
    const { a, c } = await load();
    expect(ids(a.stagedFiles())).toEqual(["old:staged"]);
    c.setComposerSlot("A"); // `""` moves into the empty A (Q6) — a write
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      rails: { A: [{ attachmentId: "old", name: "old.webp", kind: "image" }] },
    });
  });

  it('a first write to ANOTHER rail carries the legacy one over under `""`', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ files: [{ attachmentId: "old", name: "old.webp", kind: "image" }] }),
    );
    const { a, c } = await load();
    c.setComposerSlot("A");
    c.setComposerSlot("B"); // (A took `""`'s chip; B is fresh)
    a.addStaged(chip("b1"));
    expect(Object.keys(stored().rails!)).toEqual(["A", "B"]);
    expect("files" in JSON.parse(localStorage.getItem(KEY)!)).toBe(false);
  });

  it("restores every rail, with local ids unique across rails", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        rails: {
          A: [{ attachmentId: "a1", name: "a1.webp", kind: "image" }],
          B: [
            { attachmentId: "b1", name: "b1.webp", kind: "image" },
            { attachmentId: 7, name: "junk", kind: "image" }, // nothing cast
          ],
          C: "not a list",
        },
      }),
    );
    const { a, c } = await load();
    c.setComposerSlot("A");
    const [ra] = a.stagedFiles();
    c.setComposerSlot("B");
    expect(ids(a.stagedFiles())).toEqual(["b1:staged"]);
    expect(a.stagedFiles()[0].localId).not.toBe(ra.localId);
    c.setComposerSlot("C");
    expect(a.stagedFiles()).toEqual([]);
  });

  it("an emptied rail deletes its key", async () => {
    const { a, c } = await load();
    c.setComposerSlot("A");
    a.addStaged(chip("a1"));
    a.removeStaged("local-a1");
    expect(stored().rails).toEqual({});
  });
});

describe("slot-scoped reads vs id-addressed mutations (§12.3 H4)", () => {
  async function twoRails() {
    const s = await load();
    s.c.setComposerSlot("L2");
    s.a.addStaged(chip("p1"));
    s.a.addStaged({ localId: "u1", name: "up.png", kind: "image", status: "uploading" });
    s.c.setComposerSlot("E1");
    s.a.addStaged(chip("e1"));
    return s;
  }

  it("the composer's view and the send-building reads are the CURRENT slot's", async () => {
    const { a, c } = await twoRails();
    expect(ids(a.stagedFiles())).toEqual(["e1:staged"]);
    expect(a.stagedIds()).toEqual(["e1"]);
    expect(a.hasStaged()).toBe(true);
    expect(a.isUploading()).toBe(false); // L2's upload never holds E1's send
    c.setComposerSlot("L2");
    expect(a.isUploading()).toBe(true);
    expect(a.stagedIds()).toEqual(["p1"]);
  });

  it("a reservation made in L2 is consumed / released by id from E1", async () => {
    const { a, c } = await twoRails();
    c.setComposerSlot("L2");
    const reserved = a.reserveStaged();
    expect(reserved).toEqual(["p1"]);
    expect(a.stagedPreviews(reserved)).toEqual([{ name: "p1.webp", kind: "image" }]);
    c.setComposerSlot("E1"); // the hop between Send and the answer
    expect(a.stagedPreviews(reserved)).toEqual([{ name: "p1.webp", kind: "image" }]); // across rails
    a.releaseStaged(reserved);
    expect(ids(a.stagedFiles())).toEqual(["e1:staged"]); // E1 untouched
    c.setComposerSlot("L2");
    expect(ids(a.stagedFiles())).toEqual(["p1:staged", "undefined:uploading"]);
    a.reserveStaged();
    c.setComposerSlot("E1");
    a.consumeStaged(["p1"]);
    c.setComposerSlot("L2");
    expect(ids(a.stagedFiles())).toEqual(["undefined:uploading"]);
  });

  it("an upload / a removal by local id finds its row in another rail", async () => {
    const { a, c } = await twoRails();
    a.updateStaged("u1", { status: "staged", attachmentId: "u-id" }); // view on E1
    a.removeStaged("local-p1");
    expect(ids(a.stagedFiles())).toEqual(["e1:staged"]);
    c.setComposerSlot("L2");
    expect(ids(a.stagedFiles())).toEqual(["u-id:staged"]);
    expect(stored().rails!.L2.map((r) => r.attachmentId)).toEqual(["u-id"]);
  });

  it("`clearStaged` clears the current rail only", async () => {
    const { a, c } = await twoRails();
    a.clearStaged();
    expect(a.stagedFiles()).toEqual([]);
    c.setComposerSlot("L2");
    expect(a.stagedFiles()).toHaveLength(2);
  });
});

describe("ONE thumbnail budget across the blob, the current rail first (§12.3 M5)", () => {
  const thumb = `data:image/jpeg;base64,${"A".repeat(200 * 1024)}`; // 5 of these ≈ the whole budget
  const thumbs = (rows: { thumb?: string }[] | undefined) => (rows ?? []).filter((r) => r.thumb);

  it("three full rails never pass the budget — the current rail keeps its pictures", async () => {
    const { a, c } = await load();
    for (const rail of ["A", "B", "C"]) {
      c.setComposerSlot(rail);
      for (let at = 0; at < 5; at++) a.addStaged(chip(`${rail}-${at}`, { thumb }));
    }
    // the view is on C: C was served first
    const r = stored().rails!;
    expect(thumbs(r.C)).toHaveLength(5);
    const total = Object.values(r)
      .flat()
      .reduce((n, row) => n + (row.thumb?.length ?? 0), 0);
    expect(total).toBeLessThanOrEqual(1024 * 1024);
    // every row is still restorable — the budget sheds pictures, never rows
    expect(Object.values(r).flat()).toHaveLength(15);
    expect(localStorage.getItem(KEY)!.length).toBeLessThan(1_300_000);
  });

  it("the budget follows the view: a write after a hop serves the new current rail first", async () => {
    const { a, c } = await load();
    for (const rail of ["A", "B"]) {
      c.setComposerSlot(rail);
      for (let at = 0; at < 5; at++) a.addStaged(chip(`${rail}-${at}`, { thumb }));
    }
    expect(thumbs(stored().rails!.A)).toHaveLength(0); // B (current) took the budget
    c.setComposerSlot("A");
    a.addStaged(chip("A-text", { kind: "text", name: "a.txt" })); // any write re-budgets
    expect(thumbs(stored().rails!.A)).toHaveLength(5);
    expect(thumbs(stored().rails!.B)).toHaveLength(0);
  });
});

describe("M4 — a write patches the entries it changed, never the whole map", () => {
  it("a rail another tab stored after this load survives this tab's write", async () => {
    const { a, c } = await load();
    c.setComposerSlot("A");
    localStorage.setItem(
      KEY,
      JSON.stringify({ rails: { Z: [{ attachmentId: "z", name: "z.webp", kind: "image" }] } }),
    );
    a.addStaged(chip("a1"));
    expect(Object.keys(stored().rails!).sort()).toEqual(["A", "Z"]);
  });

  it("…and so does another tab's NEWER copy of a rail this tab also holds, when this tab did not change it", async () => {
    const { a, c } = await load();
    c.setComposerSlot("B");
    a.addStaged(chip("b1"));
    c.setComposerSlot("A");
    // the other tab, also on B, staged a second chip there
    const blob = stored();
    blob.rails!.B = [...blob.rails!.B, { attachmentId: "b2" }];
    localStorage.setItem(KEY, JSON.stringify(blob));
    a.addStaged(chip("a1")); // this tab writes A only
    expect(stored().rails!.B.map((r) => r.attachmentId)).toEqual(["b1", "b2"]);
  });
});

// ── the S8 fix wave (Sol S8-01 / S8-02): the patch is computed over the FRESH stored blob ─────────────
// Each `load()` is another TAB of the same browser profile: its own module memory, the one shared
// `localStorage`. Both reproductions are Sol's, at the owner's two-devices-plus-desktop reality.
describe("two and three tabs — another tab's rows are never replaced, the budget covers the union", () => {
  const big = `data:image/jpeg;base64,${"A".repeat(200 * 1024)}`;
  const thumbChars = (): number =>
    Object.values(stored().rails ?? {})
      .flat()
      .reduce((n, row) => n + (row.thumb?.length ?? 0), 0);

  it("S8-01 — tab B's budget re-trim after tab A staged more keeps A's FRESH rows (only A's thumbs trimmed)", async () => {
    const tabA = await load();
    tabA.c.setComposerSlot("A");
    for (let at = 0; at < 5; at++) tabA.a.addStaged(chip(`a${at}`, { thumb: big }));
    const tabB = await load(); // loads A's five
    tabB.c.setComposerSlot("B");
    tabA.a.addStaged(chip("a5")); // tab A stages one more — tab B's memory never sees it
    tabB.a.addStaged(chip("b0", { thumb: big })); // B is tab B's current rail: it takes budget from A
    const railA = stored().rails!.A;
    expect(railA.map((r) => r.attachmentId)).toEqual(["a0", "a1", "a2", "a3", "a4", "a5"]);
    expect(stored().rails!.B[0].thumb).toBe(big); // B served first
    expect(railA.filter((r) => r.thumb).length).toBeLessThan(5); // A's tail shed its pictures only
    expect(thumbChars()).toBeLessThanOrEqual(1024 * 1024);
  });

  it("S8-02 — three tabs filling three rails never persist past the ONE budget", async () => {
    const thumb = `data:image/jpeg;base64,${"A".repeat(64 * 1024)}`;
    const tabs = [await load(), await load(), await load()];
    ["A", "B", "C"].forEach((rail, at) => tabs[at].c.setComposerSlot(rail));
    for (let n = 0; n < 16; n++)
      ["A", "B", "C"].forEach((rail, at) => tabs[at].a.addStaged(chip(`${rail}${n}`, { thumb })));
    expect(Object.values(stored().rails!).flat()).toHaveLength(48); // every row restorable
    expect(thumbChars()).toBeLessThanOrEqual(1024 * 1024);
  });
});
