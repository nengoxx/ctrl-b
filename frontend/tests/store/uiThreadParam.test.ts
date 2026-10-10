import { afterEach, describe, expect, it, vi } from "vitest";

import { consumeThreadParam, isThreadId } from "../../src/store/ui";

// Phase 27 S10 (D84 §5 O2, §6 N1) — the DEAD-PAGE arm of a notification tap: `public/notify-sw.js` opens
// `/?tab=agent&thread=<id>`, and `store/ui`'s module-scope boot validates the id, strips it from the URL
// and parks it for the chat's boot (`takeBootThread`, read ONCE). The chat half — which conversation that
// opens, with which responder — is pinned in `chatBootThread.test.ts`.

const T = "a2".repeat(16); // a conversation id: a uuid4's hex

describe("consumeThreadParam · the pure parse", () => {
  it("returns a conversation id", () => {
    expect(consumeThreadParam(`?thread=${T}`)).toBe(T);
    expect(consumeThreadParam(`?tab=agent&thread=${T}&x=1`)).toBe(T);
  });

  it("returns null when absent, or for anything that is not a conversation id — the URL is untrusted", () => {
    expect(consumeThreadParam("")).toBeNull();
    expect(consumeThreadParam("?tab=agent")).toBeNull();
    expect(consumeThreadParam("?thread=")).toBeNull();
    expect(consumeThreadParam(`?thread=${T.toUpperCase()}`)).toBeNull();
    expect(consumeThreadParam(`?thread=${T.slice(1)}`)).toBeNull();
    expect(consumeThreadParam(`?thread=${T}0`)).toBeNull();
    expect(consumeThreadParam(`?thread=..%2F${T}`)).toBeNull();
  });

  it("isThreadId — the one shape check (strings of 32 lowercase hex only)", () => {
    expect(isThreadId(T)).toBe(true);
    expect(isThreadId({ id: T })).toBe(false);
    expect(isThreadId(null)).toBe(false);
    expect(isThreadId(42)).toBe(false);
  });
});

describe("the module-scope boot — strip, park, take once", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  /** Re-import the store under `url`: the boot runs at module scope, exactly as a cold page open. */
  async function bootAt(url: string) {
    window.history.replaceState(null, "", url);
    vi.resetModules();
    return import("../../src/store/ui");
  }

  it("a valid `?thread=` is parked for ONE read and stripped (with `tab`), the rest of the URL kept", async () => {
    const ui = await bootAt(`/?tab=agent&thread=${T}&keep=1#h`);
    expect(window.location.search).toBe("?keep=1");
    expect(window.location.hash).toBe("#h");
    expect(ui.getUI().tab).toBe("agent");
    expect(ui.takeBootThread()).toBe(T);
    expect(ui.takeBootThread()).toBeNull(); // spent
  });

  it("an INVALID `?thread=` is stripped too — and parks nothing", async () => {
    const ui = await bootAt("/?tab=agent&thread=..%2Fetc");
    expect(window.location.search).toBe("");
    expect(ui.takeBootThread()).toBeNull();
  });

  it("no param → nothing parked, the URL untouched", async () => {
    const ui = await bootAt("/?keep=1");
    expect(window.location.search).toBe("?keep=1");
    expect(ui.takeBootThread()).toBeNull();
  });
});
