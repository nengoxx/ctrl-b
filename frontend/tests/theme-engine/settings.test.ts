import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { setThemeSetting, setUI } from "../../src/store/ui";
import {
  resolveThemeSetting,
  themeRowValue,
  themeSettingsSpec,
  useThemeSetting,
} from "../../src/theme-engine/settings";

// D29 §14.3 — per-theme settings resolution: the stored override, else the theme's declared default
// (the VS Code `configuration` model). Reads vapor's real ThemeDef.settings from the registry.

beforeEach(() => {
  setUI({ themeSettings: {} }); // clear overrides (module state persists between tests)
});

describe("useThemeSetting", () => {
  it("falls back to the theme's declared default when there's no override", () => {
    const { result } = renderHook(() => useThemeSetting<boolean>("vapor", "heroOn"));
    expect(result.current).toBe(true); // vapor's declared default
    const { result: sky } = renderHook(() => useThemeSetting<string>("vapor", "skyline"));
    expect(sky.current).toBe("city");
  });

  it("returns the override when one is set", () => {
    setThemeSetting("vapor", "heroOn", false);
    const { result } = renderHook(() => useThemeSetting<boolean>("vapor", "heroOn"));
    expect(result.current).toBe(false);
  });

  it("returns undefined for an unknown key with no override", () => {
    const { result } = renderHook(() => useThemeSetting("vapor", "nope"));
    expect(result.current).toBeUndefined();
  });
});

// §14.15.1 ⑦ / COMPOSER_SURFACE_PLAN §2.0 — the pure read-validation resolver (audit B4). A seg value is
// kept only if it names a declared option (else default); a switch coerces to boolean; an undeclared key
// → undefined. Reads vapor's real ThemeDef.settings (loz/skyline = seg, heroOn/waveformOn = switch).
describe("resolveThemeSetting", () => {
  it("returns a seg value when it names a declared option", () => {
    expect(resolveThemeSetting("vapor", "skyline", "mountains")).toBe("mountains");
    expect(resolveThemeSetting("vapor", "loz", "ring")).toBe("ring");
  });

  it("falls back to the seg default when the value is not a declared option", () => {
    expect(resolveThemeSetting("vapor", "skyline", "atlantis")).toBe("city"); // stale/corrupt option
    expect(resolveThemeSetting("vapor", "loz", "")).toBe("logo");
    expect(resolveThemeSetting("vapor", "skyline", true)).toBe("city"); // wrong type → default
    expect(resolveThemeSetting("vapor", "skyline", undefined)).toBe("city"); // no override → default
  });

  it("coerces a switch to boolean, keeping only real booleans", () => {
    expect(resolveThemeSetting("vapor", "heroOn", true)).toBe(true);
    expect(resolveThemeSetting("vapor", "heroOn", false)).toBe(false);
    expect(resolveThemeSetting("vapor", "heroOn", undefined)).toBe(true); // → declared default
    expect(resolveThemeSetting("vapor", "heroOn", "yes")).toBe(true); // wrong type → default
    expect(resolveThemeSetting("vapor", "waveformOn", "")).toBe(true); // falsy-but-not-bool → default
  });

  it("returns undefined for an undeclared key", () => {
    expect(resolveThemeSetting("vapor", "nope", "whatever")).toBeUndefined();
    expect(resolveThemeSetting("vapor", "nope", undefined)).toBeUndefined();
  });

  it("returns undefined for a theme with no declared settings (unregistered/empty)", () => {
    expect(resolveThemeSetting("phosphor", "heroOn", true)).toBeUndefined(); // not in registry
  });
});

describe("themeSettingsSpec", () => {
  it("exposes the active theme's declared schema, in declaration order (vapor → 4 kit axes + 4 decorative)", () => {
    const spec = themeSettingsSpec("vapor");
    // ORDER is the contract: the Appearance picker renders the keys as declared, and D51 V4 put the four
    // SHARED kit axis/seg descriptors (R19 — the cosmos ordering: composer, skin, plan, outlines) ABOVE
    // vapor's own decoration rows.
    expect(Object.keys(spec ?? {})).toEqual([
      "composer",
      "composerSkin",
      "planPlacement",
      "outlines",
      "loz",
      "heroOn",
      "skyline",
      "waveformOn",
    ]);
    expect(spec?.heroOn).toMatchObject({ type: "switch", default: true });
    expect(spec?.composer).toMatchObject({ type: "seg", default: "sheet" });
    expect(spec?.planPlacement).toMatchObject({ type: "seg", default: "pinned" });
  });
});

// ── gacha's declared schema (D52 G0) — the shared kit axes first (the cosmos/vapor ordering convention),
//    then the theme's own three. Order IS the contract: ConfTab auto-renders the keys as declared. ──
describe("themeSettingsSpec — gacha", () => {
  it("declares the four kit axes then starMode / wallpaper / oracle, in that order", () => {
    expect(Object.keys(themeSettingsSpec("gacha") ?? {})).toEqual([
      "composer",
      "composerSkin",
      "planPlacement",
      "outlines",
      "starMode",
      "wallpaper",
      "oracle",
    ]);
  });

  it("ships the RULED defaults: 5★ (Q8.4) and R6's two flipped-ON switches", () => {
    const spec = themeSettingsSpec("gacha");
    // Q8.4 overrode the 3★ recommendation: emma already carries 5–6 configured services, so the flagship
    // rolls a full row on day one. The rate pill follows the mode (`★5 RATE` by default).
    expect(spec?.starMode).toMatchObject({ type: "seg", default: "five" });
    expect(spec?.starMode.type === "seg" && spec.starMode.options.map((o) => o.val)).toEqual([
      "five",
      "three",
    ]);
    // R6: the PROTOTYPE ships both OFF; the theme flips them ON — a deliberate, owner-ruled difference.
    expect(spec?.wallpaper).toMatchObject({ type: "switch", default: true });
    expect(spec?.oracle).toMatchObject({ type: "switch", default: true });
  });

  it("resolves a corrupt persisted value back to the declared default", () => {
    expect(resolveThemeSetting("gacha", "starMode", "seven")).toBe("five");
    expect(resolveThemeSetting("gacha", "wallpaper", "on")).toBe(true); // string ≠ switch → default
    expect(resolveThemeSetting("gacha", "starMode", "three")).toBe("three"); // a real value survives
  });
});

// ── `themeRowValue` — what the Conf Appearance picker DISPLAYS for one settings row (Codex G0 #7).
//    This was an inline expression in ConfTab guarded by a source-level regex, which proved only that a
//    call existed — and the `?? field.default` tail it also matched is unreachable for a declared key. It
//    is a pure function now, so the claim is tested as a VALUE: a corrupt or stale synced override must
//    display as the resolved default, never raw, or the row reports a state the app is not in. ──
describe("themeRowValue", () => {
  const spec = themeSettingsSpec("gacha")!;

  it("displays a valid override as-is", () => {
    expect(themeRowValue("gacha", "starMode", "three", spec.starMode)).toBe("three");
    expect(themeRowValue("gacha", "wallpaper", false, spec.wallpaper)).toBe(false);
  });

  it("displays the declared default when there is no override", () => {
    expect(themeRowValue("gacha", "starMode", undefined, spec.starMode)).toBe("five");
    expect(themeRowValue("gacha", "oracle", undefined, spec.oracle)).toBe(true);
  });

  it("displays the RESOLVED value for a corrupt override — never the raw one (the whole point)", () => {
    // A seg id this build no longer declares (a rolled-back newer option, a hand-edited sync blob): the
    // app coerces it to `five`, so the row must say `five` too.
    expect(themeRowValue("gacha", "starMode", "seven", spec.starMode)).toBe("five");
    // A string where a switch belongs — truthy in JS, so reading it raw would have shown the switch ON.
    expect(themeRowValue("gacha", "wallpaper", "off", spec.wallpaper)).toBe(true);
    expect(themeRowValue("gacha", "oracle", "no", spec.oracle)).toBe(true);
  });

  it("falls back to the field's own default for an UNDECLARED key (the unreachable-in-practice belt)", () => {
    // `resolveThemeSetting` returns undefined only here; the row still has to render something.
    expect(themeRowValue("gacha", "nope", "whatever", spec.starMode)).toBe("five");
  });
});
