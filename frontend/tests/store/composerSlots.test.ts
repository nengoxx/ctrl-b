import { beforeEach, describe, expect, it, vi } from "vitest";

// Phase 27 S8 — `store/composer` keeps ONE DRAFT PER CONVERSATION (CONVERSATIONS_PLAN §6 "Drafts and
// staged files — one per conversation", R31/R34/R35; §12.3 M4; §12.4 Q6) and is the facade over both
// per-conversation stores (`moveSlots`, `pruneSlots`) and the live dictation's stop seam (§12.2 ④, L7).
// Each case gets a FRESH module graph — the store reads storage once, at module init, so a fresh import
// IS a page load.

type Composer = typeof import("../../src/store/composer");
type Attachments = typeof import("../../src/store/attachments");

async function load(): Promise<{ c: Composer; a: Attachments }> {
  vi.resetModules();
  const c = await import("../../src/store/composer");
  const a = await import("../../src/store/attachments");
  return { c, a };
}

const KEY = "ctrlb.composer";
const blob = (): Record<string, unknown> =>
  JSON.parse(localStorage.getItem(KEY) ?? "null") as Record<string, unknown>;

const chip = (id: string) => ({
  localId: `local-${id}`,
  name: `${id}.webp`,
  kind: "image" as const,
  status: "staged" as const,
  attachmentId: id,
});

beforeEach(() => {
  localStorage.clear();
});

describe("the load-boundary fold (R31)", () => {
  it('the legacy `{draft}` loads under `""`; the old key is deleted by the next write, never written back', async () => {
    localStorage.setItem(KEY, JSON.stringify({ draft: "from before the upgrade" }));
    const { c } = await load();
    expect(c.getDraft()).toBe("from before the upgrade"); // thread-less view = `""`
    c.setComposerSlot("A"); // A is empty → `""` moves in (Q6) — itself a write
    expect(c.getDraft()).toBe("from before the upgrade");
    expect(blob()).toEqual({ drafts: { A: "from before the upgrade" } });
  });

  it("a write to ANOTHER slot carries the legacy draft over instead of deleting it with the key", async () => {
    localStorage.setItem(KEY, JSON.stringify({ draft: "legacy" }));
    const { c } = await load();
    c.appendDraft("elsewhere", " ", "B"); // the first write touches only B's entry…
    expect(blob()).toEqual({ drafts: { "": "legacy", B: "elsewhere" } }); // …and folds `""` in
  });

  it('a stored `drafts[""]` wins over a stale legacy value; junk entries are dropped', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ draft: "stale", drafts: { "": "current", A: 7, B: "", C: "kept" } }),
    );
    const { c } = await load();
    expect(c.getDraft()).toBe("current");
    c.setComposerSlot("C");
    expect(c.getDraft()).toBe("kept");
    c.setComposerSlot("A");
    expect(c.getDraft()).toBe("");
  });
});

describe("the slot — every public function acts on the current conversation", () => {
  it("setDraft / getDraft / clearDraft per slot; an empty draft deletes its key", async () => {
    const { c } = await load();
    c.setComposerSlot("A");
    c.setDraft("in A");
    c.setComposerSlot("B");
    expect(c.getDraft()).toBe("");
    c.setDraft("in B");
    c.setComposerSlot("A");
    expect(c.getDraft()).toBe("in A");
    c.clearDraft();
    expect(blob()).toEqual({ drafts: { B: "in B" } });
  });

  it("`appendDraft(text, sep, slot)` writes the NAMED conversation's draft; omitted → the current one", async () => {
    const { c } = await load();
    c.setComposerSlot("A");
    c.setDraft("typed");
    c.setComposerSlot("B");
    c.appendDraft("dictated", " ", "A"); // a dictation that started in A (R35)
    expect(c.getDraft()).toBe(""); // B untouched
    c.appendDraft("here");
    expect(c.getDraft()).toBe("here");
    c.setComposerSlot("A");
    expect(c.getDraft()).toBe("typed dictated");
  });

  it("M4 — a write patches ONE entry: a sibling another tab stored after this load survives", async () => {
    const { c } = await load();
    c.setComposerSlot("A");
    // "another tab" writes Z's draft into storage — this tab's memory never saw it
    localStorage.setItem(KEY, JSON.stringify({ drafts: { Z: "the other tab's" } }));
    c.setDraft("this tab's");
    expect(blob()).toEqual({ drafts: { Z: "the other tab's", A: "this tab's" } });
  });
});

describe('the thread-less `""` move at the slot setter (§12.4 Q6)', () => {
  it('moves `""`\'s draft + rail into a conversation whose slots are empty', async () => {
    const { c, a } = await load();
    c.setDraft("loose");
    a.addStaged(chip("p1"));
    c.setComposerSlot("A");
    expect(c.getDraft()).toBe("loose");
    expect(a.stagedIds()).toEqual(["p1"]);
    c.setComposerSlot("");
    expect(c.getDraft()).toBe("");
    expect(a.stagedFiles()).toEqual([]);
  });

  it("does NOT merge into a conversation holding a draft — or only a chip", async () => {
    const { c, a } = await load();
    c.setComposerSlot("A");
    c.setDraft("A's own");
    c.setComposerSlot("B");
    a.addStaged(chip("b1")); // B holds a chip and no draft — still content
    c.setComposerSlot("");
    c.setDraft("loose");
    c.setComposerSlot("A");
    expect(c.getDraft()).toBe("A's own");
    c.setComposerSlot("");
    c.setComposerSlot("B");
    expect(c.getDraft()).toBe("");
    c.setComposerSlot("");
    expect(c.getDraft()).toBe("loose");
  });

  it('only FROM `""` — a conversation-to-conversation hop moves nothing', async () => {
    const { c } = await load();
    c.setComposerSlot("A");
    c.setDraft("A's");
    c.setComposerSlot("B");
    expect(c.getDraft()).toBe("");
  });
});

describe("`moveSlots` — the E6 carry (draft + rail together)", () => {
  it("appends after the target's own draft with a blank line, moves the chips, deletes the source keys", async () => {
    const { c, a } = await load();
    c.setComposerSlot("dead");
    c.setDraft("half a thought");
    a.addStaged(chip("p1"));
    a.addStaged({ localId: "u1", name: "up.png", kind: "image", status: "uploading" });
    c.setComposerSlot("next");
    c.setDraft("its own");
    a.addStaged(chip("n1"));
    c.moveSlots("dead", "next");
    expect(c.getDraft()).toBe("its own\n\nhalf a thought");
    expect(a.stagedFiles().map((f) => f.localId)).toEqual(["local-n1", "local-p1", "u1"]);
    // an `uploading` row moved too — its upload's `updateStaged` still finds it (H4)
    a.updateStaged("u1", { status: "staged", attachmentId: "u-id" });
    expect(a.stagedIds()).toEqual(["n1", "p1", "u-id"]);
    expect(blob()).toEqual({ drafts: { next: "its own\n\nhalf a thought" } });
    expect(
      Object.keys(
        (JSON.parse(localStorage.getItem("ctrlb.attachments")!) as { rails: object }).rails,
      ),
    ).toEqual(["next"]);
  });

  it("into an empty target the draft arrives as it was", async () => {
    const { c } = await load();
    c.setComposerSlot("dead");
    c.setDraft("words");
    c.setComposerSlot("next");
    c.moveSlots("dead", "next");
    expect(c.getDraft()).toBe("words");
  });
});

describe("`pruneSlots` — the boot prune's store half (§12.2 ⑦)", () => {
  it("drops refused keys from memory AND storage — a key only storage holds included", async () => {
    localStorage.setItem(KEY, JSON.stringify({ drafts: { "": "loose", keep: "k", dead: "d" } }));
    localStorage.setItem(
      "ctrlb.attachments",
      JSON.stringify({ rails: { dead: [{ attachmentId: "x", name: "x.webp", kind: "image" }] } }),
    );
    const { c, a } = await load();
    // another tab stored `ghost` after this load
    localStorage.setItem(
      KEY,
      JSON.stringify({ drafts: { "": "loose", keep: "k", dead: "d", ghost: "g" } }),
    );
    c.pruneSlots((k) => k === "" || k === "keep");
    expect(blob()).toEqual({ drafts: { "": "loose", keep: "k" } });
    expect(
      (JSON.parse(localStorage.getItem("ctrlb.attachments")!) as { rails: object }).rails,
    ).toEqual({});
    c.setComposerSlot("keep"); // (via a conversation: `""` → an empty one would move `""` in, Q6)
    c.setComposerSlot("dead");
    expect(c.getDraft()).toBe("");
    expect(a.stagedFiles()).toEqual([]);
  });

  it("writes nothing when nothing is refused", async () => {
    const { c } = await load();
    c.pruneSlots(() => true);
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe("the live dictation's stop seam (§12.2 ④, §12.3 L7)", () => {
  it("resolves at once when no streaming dictation is live", async () => {
    const { c } = await load();
    await expect(c.stopLiveDictation()).resolves.toBeUndefined();
  });

  it("stops the registered one with `navigated` ONCE — every caller shares the stop in flight", async () => {
    const { c } = await load();
    const reasons: string[] = [];
    let land!: () => void;
    const unregister = c.registerLiveDictation(async (reason) => {
      reasons.push(reason);
      await new Promise<void>((r) => {
        land = r;
      });
      unregister();
    });
    const first = c.stopLiveDictation(); // the swap
    const second = c.stopLiveDictation(); // the E6 carry, awaiting the same stop (L7)
    expect(second).toBe(first);
    expect(reasons).toEqual(["navigated"]);
    land();
    await first;
    await expect(c.stopLiveDictation()).resolves.toBeUndefined(); // unregistered — nothing live
    expect(reasons).toEqual(["navigated"]);
  });

  it("an unregister removes only its own registration", async () => {
    const { c } = await load();
    const stale = c.registerLiveDictation(async () => {});
    const calls: string[] = [];
    c.registerLiveDictation(async (r) => {
      calls.push(r);
    });
    stale(); // the older leg's late teardown
    await c.stopLiveDictation();
    expect(calls).toEqual(["navigated"]);
  });
});

// ── the S8 fix wave ──────────────────────────────────────────────────────────────────────────────────
describe("the stop is deduped PER REGISTRATION (Sol S8-04)", () => {
  it("a NEWER leg registered while the old stop is still pending is stopped by the next swap", async () => {
    const { c } = await load();
    const stopped: string[] = [];
    let landA!: () => void;
    c.registerLiveDictation(async () => {
      stopped.push("A");
      await new Promise<void>((r) => {
        landA = r; // A's clip upload is still pending
      });
    });
    const carryWaitsOnA = c.stopLiveDictation(); // the first swap (and the carry awaiting it)
    c.registerLiveDictation(async () => {
      stopped.push("B"); // a new leg, started while A's upload is in flight
    });
    await c.stopLiveDictation(); // the second swap
    expect(stopped).toEqual(["A", "B"]);
    let settled = false;
    void carryWaitsOnA.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false); // the carry still waits on A, not on B
    landA();
    await carryWaitsOnA;
    expect(settled).toBe(true);
  });
});

describe("the forward map — a writer holding a MOVED slot writes where it went (Sol S8-03, Opus F1/F4)", () => {
  it('across the `""` move: a leg that started thread-less keeps joining the moved draft', async () => {
    const { c } = await load();
    c.appendDraft("first phrase", " ", ""); // the leg's first phrase, in `""`
    c.setComposerSlot("X"); // a door / a lazy mint moves `""` into the empty X
    c.appendDraft("later phrase", " ", ""); // the leg still names `""`
    expect(c.getDraft()).toBe("first phrase later phrase");
    expect(c.followSlot("")).toBe("X");
    expect(blob()).toEqual({ drafts: { X: "first phrase later phrase" } }); // nothing re-created
  });

  it('…even when `""` was EMPTY at the mint (the Send just took the draft) — it still forwards', async () => {
    const { c } = await load();
    c.setComposerSlot("X", true); // the lazy mint, `""` cleared by the Send a moment ago
    c.appendDraft("said after the send", " ", "");
    expect(c.getDraft()).toBe("said after the send");
  });

  it("across an E6 carry: a pending transcript for the dead conversation lands in what opened", async () => {
    const { c } = await load();
    c.setComposerSlot("D");
    c.setDraft("typed in D");
    c.carryOnLeave("D"); // D was deleted elsewhere — the fallback starts
    c.setComposerSlot("A"); // …and opens A
    await c.slotsCarried();
    c.appendDraft("late clip words", " ", "D"); // the clip pressed in D answers now
    expect(c.getDraft()).toBe("typed in D late clip words");
    expect(blob()).toEqual({ drafts: { A: "typed in D late clip words" } });
  });

  it('an entry ends when the view enters its key again — a fresh thread-less view\'s `""` is live', async () => {
    const { c } = await load();
    c.setComposerSlot("X");
    c.setComposerSlot("");
    expect(c.followSlot("")).toBe("");
    c.appendDraft("new loose words");
    expect(c.getDraft()).toBe("new loose words");
  });
});

describe("S8 micro-wave 2", () => {
  it("Sol's confirm — a carry DEFERRED behind a stopper follows its target's own move (`\"\"` → X)", async () => {
    const { c, a } = await load();
    c.setComposerSlot("D");
    c.setDraft("D's words");
    a.addStaged(chip("d1"));
    let land!: () => void;
    const unregister = c.registerLiveDictation(async () => {
      await new Promise<void>((r) => {
        land = r;
      });
      unregister();
    });
    c.carryOnLeave("D");
    void c.stopLiveDictation(); // the swap's stop — still pending
    c.setComposerSlot(""); // the fallback lands thread-less: the carry D → `""` is armed, deferred
    c.setComposerSlot("X"); // …and `""` moves on into X before the stopper settles
    land();
    await c.slotsCarried();
    expect(c.getDraft()).toBe("D's words");
    expect(a.stagedIds()).toEqual(["d1"]);
    expect(blob()).toEqual({ drafts: { X: "D's words" } });
    expect(
      Object.keys(
        (JSON.parse(localStorage.getItem("ctrlb.attachments")!) as { rails: object }).rails,
      ),
    ).toEqual(["X"]);
  });

  it('Qwen F1 — another tab\'s stored draft for B blocks the `""` move into B', async () => {
    const { c } = await load();
    c.setDraft("loose");
    // the other tab drafted in B after this one loaded
    const stored = blob();
    localStorage.setItem(
      KEY,
      JSON.stringify({ drafts: { ...(stored.drafts as object), B: "theirs" } }),
    );
    c.setComposerSlot("B");
    expect(blob()).toEqual({ drafts: { "": "loose", B: "theirs" } }); // nothing written over B
    c.setComposerSlot("");
    expect(c.getDraft()).toBe("loose");
  });
});
