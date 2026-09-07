import { afterEach, describe, expect, it } from "vitest";

import {
  currentAppearancePatch,
  reconcileAppearance,
  type AppearanceDoc,
  type AppearanceLocal,
} from "../../src/hooks/useAppearance";
import { getUI, setThemeSetting, setUI } from "../../src/store/ui";
import { settingRowVisible } from "../../src/theme-engine/settings";
import type { ThemeSettingField } from "../../src/theme-engine/types";

// Phase 11 / D28 §9.11 + M3 §14.3 — the cross-device reconcile decision (compare-then-set, server-wins,
// but only when the server has a recorded preference). The synced unit is
// {theme,mode,accent,motion,perf,themeSettings,kitBackgroundVisible,appbarSubtitleVisible,
// chatAvatarsVisible,agentBackdrop,pwaIconBackground}.
// Pure function
// → tested directly.

const local: AppearanceLocal = {
  theme: "vapor",
  mode: "dark",
  accent: "aqua",
  motion: "full",
  perf: "full",
  themeSettings: { vapor: { heroOn: true } },
  kitBackgroundVisible: true,
  appbarSubtitleVisible: false,
  chatAvatarsVisible: true,
  agentBackdrop: "operator",
  pwaIconBackground: null,
};
const server = (o: Partial<AppearanceDoc>): AppearanceDoc => ({
  theme: "vapor",
  mode: "dark",
  accent: "aqua",
  motion: "full",
  perf: "full",
  theme_settings: { vapor: { heroOn: true } },
  kit_background_visible: true,
  appbar_subtitle_visible: false,
  chat_avatars_visible: true,
  agent_backdrop: "operator",
  pwa_icon_background: null,
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
      kitBackgroundVisible: true,
      appbarSubtitleVisible: false,
      chatAvatarsVisible: true,
      agentBackdrop: "operator",
      pwaIconBackground: null,
    });
  });

  it("server wins on a differing motion / perf lever", () => {
    expect(reconcileAppearance(server({ motion: "reduced" }), local, always)?.motion).toBe(
      "reduced",
    );
    expect(reconcileAppearance(server({ perf: "lite" }), local, always)?.perf).toBe("lite");
  });

  // The Kit Art System's shared-background switch joins the synced unit on exactly the same terms as
  // motion/perf: it governs ONE shared image, so it is not a per-device choice — and it ships NULLABLE,
  // so an existing config (stamped `updated_at`, no such key) must not read as "the owner turned it off".
  it("server wins on a differing shared-background switch, and UNSEEDED keeps local", () => {
    expect(
      reconcileAppearance(server({ kit_background_visible: false }), local, always)
        ?.kitBackgroundVisible,
    ).toBe(false);
    // …and a pre-slice doc (null) coalesces to local rather than looking authored — no-op, no wipe.
    expect(reconcileAppearance(server({ kit_background_visible: null }), local, always)).toBeNull();
    expect(
      reconcileAppearance(server({ kit_background_visible: null, accent: "ember" }), local, always)
        ?.kitBackgroundVisible,
    ).toBe(true);
  });

  // The agent-backdrop MODE (D70 §8.3a) joins on the same terms as the switches — synced because the art
  // is per-agent and the mode is one viewing preference — with one difference worth pinning: its wire type
  // is a bare string, so the reconcile CARRIES an unknown value through (the `motion`/`perf` posture) and
  // the healing happens where it is read. A reconcile that silently coerced here would make a downgrade
  // followed by an upgrade lose the owner's pick.
  it("server wins on a differing agent-backdrop mode; UNSEEDED keeps local; unknown is CARRIED", () => {
    expect(
      reconcileAppearance(server({ agent_backdrop: "full" }), local, always)?.agentBackdrop,
    ).toBe("full");
    expect(reconcileAppearance(server({ agent_backdrop: null }), local, always)).toBeNull();
    expect(
      reconcileAppearance(server({ agent_backdrop: "sideways" }), local, always)?.agentBackdrop,
    ).toBe("sideways");
  });

  // The app bar's brand-subtitle switch joins on the same terms again (the third global lever): synced
  // because "how much text do I want in my bar" is one answer, and NULLABLE because an existing config
  // (stamped `updated_at`, no such key) must not read as "the owner turned the subtitle off".
  it("server wins on a differing bar-subtitle switch, and UNSEEDED keeps local", () => {
    expect(
      reconcileAppearance(server({ appbar_subtitle_visible: true }), local, always)
        ?.appbarSubtitleVisible,
    ).toBe(true);
    // A pre-slice doc (null) coalesces to local — no apply at all when nothing else differs…
    expect(
      reconcileAppearance(server({ appbar_subtitle_visible: null }), local, always),
    ).toBeNull();
    // …and it does not get dragged to a default by an UNRELATED change either.
    expect(
      reconcileAppearance(
        server({ appbar_subtitle_visible: null, accent: "ember" }),
        { ...local, appbarSubtitleVisible: true },
        always,
      )?.appbarSubtitleVisible,
    ).toBe(true);
  });

  // The installed-icon backdrop (D59 / W5) joins on the same terms as the three levers above — it names
  // the ONE app icon, so it is synced — but its unseeded value is `null` on BOTH sides (the store default
  // is null too), which is what makes "nobody has ever picked one" a no-op rather than a write of "Clear".
  it("server wins on a differing app-icon backdrop, and UNSEEDED keeps local", () => {
    expect(
      reconcileAppearance(server({ pwa_icon_background: "ink" }), local, always)?.pwaIconBackground,
    ).toBe("ink");
    // A pre-slice doc (null) coalesces to local — no apply at all when nothing else differs…
    expect(reconcileAppearance(server({ pwa_icon_background: null }), local, always)).toBeNull();
    // …and an unrelated change never drags an owner's existing local pick back to null.
    expect(
      reconcileAppearance(
        server({ pwa_icon_background: null, accent: "ember" }),
        { ...local, pwaIconBackground: "paper" },
        always,
      )?.pwaIconBackground,
    ).toBe("paper");
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
      kitBackgroundVisible: true,
      appbarSubtitleVisible: false,
      chatAvatarsVisible: true,
      agentBackdrop: "operator",
      pwaIconBackground: null,
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
        kitBackgroundVisible: true, // global lever, unchanged here — still carried whole
        appbarSubtitleVisible: false, // ditto — the subtitle switch rides the same whole-doc apply
        chatAvatarsVisible: true, // ditto — the transcript-avatar switch (D70 §8.5)
        agentBackdrop: "operator", // ditto — the agent-backdrop mode (D70 §8.3a)
        pwaIconBackground: null, // ditto — the installed-icon backdrop rides it too
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

// ── HIDDEN ≠ DROPPED (GACHA_PLAN §12.6, slice E0). `showWhen` hides a settings ROW; it must not touch the
//    stored value. The explicit contract is that a layout-scoped pick survives being hidden and comes back
//    when its controller does — which requires it to keep riding the appearance doc while it is off screen,
//    because that doc is the whole synced unit (a value dropped from the patch would be reconciled away on
//    the next cross-device read). Visibility lives entirely in ConfTab's render; nothing in the write path
//    knows about it, and this is the test that says so. ──
describe("a HIDDEN settings row still syncs (the showWhen contract)", () => {
  afterEach(() => {
    setUI({ themeSettings: {} });
  });

  it("a value for a currently-hidden key rides currentAppearancePatch() unchanged", () => {
    setUI({ theme: "gacha", themeSettings: {} });
    setThemeSetting("gacha", "starMode", "five");
    setThemeSetting("gacha", "posterName", "plate");
    // The row is HIDDEN: this fixture only renders while starMode is `three`, and it resolves to `five`.
    const gated: ThemeSettingField = {
      type: "seg",
      label: "Name position",
      options: [
        { val: "plate", label: "Plate" },
        { val: "blade", label: "Blade" },
      ],
      default: "blade",
      showWhen: { key: "starMode", is: "three" },
    };
    const raw = getUI().themeSettings.gacha?.starMode;
    expect(settingRowVisible("gacha", "posterName", gated, raw)).toBe(false);
    // …and the pick is still in the doc every appearance write sends, verbatim.
    expect(currentAppearancePatch().themeSettings.gacha).toMatchObject({
      starMode: "five",
      posterName: "plate",
    });
  });
});
