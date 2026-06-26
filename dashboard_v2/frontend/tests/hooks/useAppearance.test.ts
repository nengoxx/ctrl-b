import { describe, expect, it } from "vitest";

import { reconcileAppearance, type AppearanceDoc } from "../../src/hooks/useAppearance";

// Phase 11 / D28 §9.11 — the cross-device reconcile decision (compare-then-set, server-wins, but only
// when the server has a recorded preference). Pure function → tested directly.

const local = { theme: "vapor", mode: "dark", accent: "aqua" };
const server = (o: Partial<AppearanceDoc>): AppearanceDoc => ({
  theme: "vapor",
  mode: "dark",
  accent: "dark",
  updated_at: "2026-06-26T12:00:00Z",
  ...o,
});

describe("reconcileAppearance", () => {
  it("keeps local when the server has never been written (updated_at null) — no revert", () => {
    // server differs (accent dark vs local aqua) but has no opinion → keep local
    expect(reconcileAppearance(server({ accent: "dark", updated_at: null }), local)).toBeNull();
  });

  it("no-op when the server matches local (no re-apply → no flash)", () => {
    expect(reconcileAppearance(server({ accent: "aqua" }), local)).toBeNull();
  });

  it("server wins on a differing accent (recorded preference)", () => {
    expect(reconcileAppearance(server({ accent: "ember" }), local)).toEqual({
      theme: "vapor",
      mode: "dark",
      accent: "ember",
    });
  });

  it("server wins on a differing skin", () => {
    expect(reconcileAppearance(server({ theme: "minimal", mode: "light", accent: "indigo" }), local)).toEqual(
      { theme: "minimal", mode: "light", accent: "indigo" },
    );
  });
});
