import { describe, expect, it } from "vitest";

import {
  reconcileAppearance,
  type AppearanceDoc,
  type AppearanceLocal,
} from "../../src/hooks/useAppearance";

// Phase 11 / D28 §9.11 + M3 §14.3 — the cross-device reconcile decision (compare-then-set, server-wins,
// but only when the server has a recorded preference). The synced unit is
// {theme,mode,accent,motion,perf,themeSettings}. Pure function → tested directly.

const local: AppearanceLocal = {
  theme: "vapor",
  mode: "dark",
  accent: "aqua",
  motion: "full",
  perf: "full",
  themeSettings: { vapor: { heroOn: true } },
};
const server = (o: Partial<AppearanceDoc>): AppearanceDoc => ({
  theme: "vapor",
  mode: "dark",
  accent: "aqua",
  motion: "full",
  perf: "full",
  theme_settings: { vapor: { heroOn: true } },
  updated_at: "2026-06-26T12:00:00Z",
  ...o,
});

// The injected registry predicate (item ⑥). Default = "everything is registered" so the existing
// server-wins cases behave as before; the unknown-skin cases below stub it to exclude a specific id.
const always = () => true;

describe("reconcileAppearance", () => {
  it("keeps local when the server has never been written (updated_at null) — no revert", () => {
    expect(
      reconcileAppearance(server({ accent: "dark", updated_at: null }), local, always),
    ).toBeNull();
  });

  it("no-op when the server matches local across all synced fields (no re-apply → no flash)", () => {
    expect(reconcileAppearance(server({}), local, always)).toBeNull();
  });

  it("server wins on a differing accent (recorded preference)", () => {
    expect(reconcileAppearance(server({ accent: "ember" }), local, always)).toEqual({
      theme: "vapor",
      mode: "dark",
      accent: "ember",
      motion: "full",
      perf: "full",
      themeSettings: { vapor: { heroOn: true } },
    });
  });

  it("server wins on a differing motion / perf lever", () => {
    expect(reconcileAppearance(server({ motion: "reduced" }), local, always)?.motion).toBe(
      "reduced",
    );
    expect(reconcileAppearance(server({ perf: "lite" }), local, always)?.perf).toBe("lite");
  });

  it("server wins on a differing per-theme setting", () => {
    const out = reconcileAppearance(
      server({ theme_settings: { vapor: { heroOn: false } } }),
      local,
      always,
    );
    expect(out?.themeSettings).toEqual({ vapor: { heroOn: false } });
  });

  // The dead per-theme `hideAppbar` (now global appbarMode) lingers in a SYNCED doc. It's stripped so a
  // stale synced copy can't re-dirty local each load (local is already migration-stripped).
  it("a stale synced hideAppbar alone causes no spurious apply (stripped → matches clean local)", () => {
    const out = reconcileAppearance(
      server({ theme_settings: { vapor: { heroOn: true, hideAppbar: true } } }),
      local,
      always,
    );
    expect(out).toBeNull();
  });

  it("strips the stale hideAppbar from an applied themeSettings", () => {
    const out = reconcileAppearance(
      server({ theme_settings: { vapor: { heroOn: false, hideAppbar: true } } }),
      local,
      always,
    );
    expect(out?.themeSettings).toEqual({ vapor: { heroOn: false } }); // heroOn change applies, hideAppbar dropped
  });

  // The upgrade guard (the M3 blocker): a pre-M3 server has a stamped updated_at (theme/mode/accent were
  // synced since Phase 11) but null motion/perf/theme_settings. Those must NOT look authored — they
  // coalesce to local, so the owner's reduced-motion / lite / migrated per-theme prefs survive.
  it("keeps local for unseeded (null) M3 fields even when the server is stamped — no wipe", () => {
    const localReduced: AppearanceLocal = { ...local, motion: "reduced", perf: "lite" };
    const out = reconcileAppearance(
      server({ accent: "aqua", motion: null, perf: null, theme_settings: null }),
      localReduced,
      always,
    );
    expect(out).toBeNull(); // accent already matches + null M3 fields coalesce to local → no-op (no wipe)
  });

  it("a real change on one field never drags unseeded M3 fields to defaults", () => {
    const localReduced: AppearanceLocal = { ...local, motion: "reduced" }; // local.perf stays "full"
    const out = reconcileAppearance(
      server({ accent: "ember", motion: null, perf: null, theme_settings: null }),
      localReduced,
      always,
    );
    expect(out).toMatchObject({
      accent: "ember", // the real change applies
      motion: "reduced", // …but unseeded fields keep local, not server defaults
      perf: "full",
      themeSettings: { vapor: { heroOn: true } },
    });
  });

  it("server wins on a differing skin (carries motion/perf/themeSettings)", () => {
    const out = reconcileAppearance(
      server({ theme: "minimal", mode: "light", accent: "indigo" }),
      local,
      always,
    );
    expect(out).toEqual({
      theme: "minimal",
      mode: "light",
      accent: "indigo",
      motion: "full",
      perf: "full",
      themeSettings: { vapor: { heroOn: true } },
    });
  });

  // Item ⑥ (§14.15.1 + §14.15.1-A ⑥+): an UNREGISTERED server skin = "no renderable opinion" on the skin
  // → HOLD the whole skin-triple {theme,mode,accent} at local, but STILL apply global/namespaced fields.
  describe("unknown (unregistered) server skin — item ⑥", () => {
    // Predicate that rejects a specific id (the "phantom" skin a newer build served / this build removed).
    const notPhantom = (id: string) => id !== "phantom";

    it("holds the skin-triple at local while applying motion/perf/themeSettings from the server", () => {
      const out = reconcileAppearance(
        server({
          theme: "phantom",
          mode: "light",
          accent: "indigo",
          motion: "reduced",
          perf: "lite",
          theme_settings: { vapor: { heroOn: false } },
        }),
        local,
        notPhantom,
      );
      expect(out).toEqual({
        theme: "vapor", // held at local — the phantom skin is not applied
        mode: "dark", // held at local (the triple is atomic per skin)
        accent: "aqua", // held at local
        motion: "reduced", // global lever still applied
        perf: "lite", // global lever still applied
        themeSettings: { vapor: { heroOn: false } }, // namespaced settings still applied
      });
    });

    it("returns null when only the skin is unknown and the motion-trio matches (no spurious apply)", () => {
      // The whole point of computing the effective triple BEFORE the equality gate: a held triple plus a
      // matching motion/perf/themeSettings must be a no-op, not a re-apply loop each reconcile.
      const out = reconcileAppearance(
        server({ theme: "phantom", mode: "light", accent: "indigo" }),
        local,
        notPhantom,
      );
      expect(out).toBeNull();
    });
  });

  // Rider (b) (§14.15.1): the themeSettings compare is key-order-insensitive, so two devices that authored
  // the same settings with keys in a different order don't trigger a spurious re-apply.
  describe("rider (b) — key-order-insensitive themeSettings compare", () => {
    it("returns null when server & local settings differ only in key order", () => {
      const localReordered: AppearanceLocal = {
        ...local,
        themeSettings: { vapor: { skyline: "city", heroOn: true } },
      };
      const out = reconcileAppearance(
        server({ theme_settings: { vapor: { heroOn: true, skyline: "city" } } }),
        localReordered,
        always,
      );
      expect(out).toBeNull();
    });

    it("still applies when a value genuinely differs (not just key order)", () => {
      const localReordered: AppearanceLocal = {
        ...local,
        themeSettings: { vapor: { skyline: "city", heroOn: true } },
      };
      const out = reconcileAppearance(
        server({ theme_settings: { vapor: { heroOn: false, skyline: "city" } } }),
        localReordered,
        always,
      );
      expect(out?.themeSettings).toEqual({ vapor: { heroOn: false, skyline: "city" } });
    });
  });
});
