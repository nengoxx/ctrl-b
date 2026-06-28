import { beforeEach, describe, expect, it } from "vitest";

import { getSheetSnap, setSheetSnap } from "../../src/store/sheetSnap";

// store/sheetSnap — the reusable <BottomSheet>'s remembered detent (ISSUES #1), KEYED by sheet identity so
// every theme's sheet shares one store. Per-device, localStorage-backed via the shared persist helpers; read
// fresh each open, written on each settle. Mirrors store/collapse's keyed-blob shape.

const KEY = "ctrlb.sheetSnap";

beforeEach(() => localStorage.clear());

describe("sheetSnap store", () => {
  it("defaults to peek when a key has nothing stored", () => {
    expect(getSheetSnap("cosmos-host-detail")).toBe("peek");
  });

  it("round-trips a settled detent and persists it under its key", () => {
    setSheetSnap("cosmos-host-detail", "full");
    expect(getSheetSnap("cosmos-host-detail")).toBe("full");
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ "cosmos-host-detail": "full" });

    setSheetSnap("cosmos-host-detail", "peek");
    expect(getSheetSnap("cosmos-host-detail")).toBe("peek");
  });

  it("keeps distinct sheet keys independent (the reusability contract)", () => {
    setSheetSnap("cosmos-host-detail", "full");
    expect(getSheetSnap("frontier-host-detail")).toBe("peek"); // a different theme's sheet is unaffected
    setSheetSnap("frontier-host-detail", "full");
    expect(getSheetSnap("cosmos-host-detail")).toBe("full"); // and writing one doesn't clobber the other
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({
      "cosmos-host-detail": "full",
      "frontier-host-detail": "full",
    });
  });

  it("coerces a corrupt or unparseable stored value back to peek", () => {
    localStorage.setItem(KEY, JSON.stringify({ "cosmos-host-detail": "garbage" }));
    expect(getSheetSnap("cosmos-host-detail")).toBe("peek");
    localStorage.setItem(KEY, "{not json"); // unparseable → persist helper swallows → default {}
    expect(getSheetSnap("cosmos-host-detail")).toBe("peek");
  });
});
