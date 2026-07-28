import { afterEach, describe, expect, it, vi } from "vitest";

// The theme switch is the one action that destroys unsaved editor state: it remounts the keyed theme
// root, and every editor's draft is component state. The callers check `isAnyDirty()` BEFORE calling —
// but `switchTheme` awaits a bundle load first, and with a cold bundle that window is long enough to
// start typing in, so edits begun inside it were destroyed anyway (the TOCTOU Codex found in the fix
// wave). The guard therefore also lives at the moment of application, which makes the invariant
// structural: a theme switch never eats an unsaved draft, whoever asked for it.

const h = vi.hoisted(() => ({ dirty: false, toast: vi.fn(), setUI: vi.fn() }));

vi.mock("../../src/store/dirty", () => ({ isAnyDirty: () => h.dirty }));
vi.mock("../../src/store/toast", () => ({ pushToast: h.toast }));
vi.mock("../../src/store/ui", async (importActual) => {
  const actual = await importActual<typeof import("../../src/store/ui")>();
  return { ...actual, setUI: h.setUI };
});

import { switchTheme } from "../../src/theme-engine/switchTheme";

afterEach(() => {
  h.dirty = false;
  h.toast.mockClear();
  h.setUI.mockClear();
});

const target = { mode: "dark" as const, accent: "blue" };

describe("switchTheme · unsaved-work guard", () => {
  it("applies the switch — and reports 'applied' — when nothing is dirty", async () => {
    const outcome = await switchTheme("minimal", target);
    expect(h.setUI).toHaveBeenCalled();
    // The outcome is what lets a caller (pickTheme) persist ONLY on a real apply (Fix 3). Before the
    // fix `switchTheme` returned void, so this assertion would read `undefined` and fail.
    expect(outcome).toBe("applied");
  });

  it("refuses to apply — reports 'refused-dirty' and says so — when ANY editor is dirty", async () => {
    h.dirty = true;
    const outcome = await switchTheme("cosmos", target);
    expect(h.setUI).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.stringMatching(/unsaved changes/i), "err");
    // The refusal must be REPORTED, not swallowed — the caller uses it to skip the persist that would
    // otherwise cross-device-apply a theme the local UI refused. Pre-fix: `undefined` → this fails.
    expect(outcome).toBe("refused-dirty");
  });

  it("catches work that became dirty DURING the bundle load (the TOCTOU) and reports 'refused-dirty'", async () => {
    // clean at call time — the caller's own check would have passed …
    const done = switchTheme("frontier", target);
    h.dirty = true; // … and the owner starts typing while the bundle loads
    const outcome = await done;
    expect(h.setUI).not.toHaveBeenCalled();
    expect(outcome).toBe("refused-dirty");
  });
});
