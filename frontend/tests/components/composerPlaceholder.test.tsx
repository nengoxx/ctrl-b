import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GACHA_COPY } from "../../src/themes/gacha/copy";
import { KitComposer } from "../../src/theme-engine/kit/composer/Composer";
import { LineComposer } from "../../src/theme-engine/kit/composer/LineComposer";
import { SheetComposer } from "../../src/theme-engine/kit/composer/SheetComposer";
import { mergeComposerSlots } from "../../src/theme-engine/kit/composer/mergeSlots";
import { kitToolsMenuSlots } from "../../src/theme-engine/kit/composer/toolsMenu";
import type { ComposerVariant } from "../../src/theme-engine/kit/composer/types";

// The `placeholder` field on `ComposerSlots` (D52 round 4, item I — a SHARED-kit extension beyond D52's
// closed list, owner-requested). The prototype writes its composer copy in Japanese, and the placeholder is
// APP copy hardcoded three times (once per variant), so a theme had no way to reach it.
//
// Three claims, one per reason this could regress:
//   1. omitted → each variant's OWN default string, byte-identical to the pre-seam render (this is what
//      keeps every non-gacha theme unchanged — the seam ships with the old value as its fallback);
//   2. filled  → the theme's string, in ALL THREE variants (the axis a theme can't control: the user picks
//      the composer layout, so one string has to cover stacked/sheet/line);
//   3. it SURVIVES `mergeComposerSlots` — the merge builds a fresh object and silently drops any field it
//      doesn't handle, which is exactly how the seam would end up dead in the real DefaultRoot path.
//
// The suggest popover's react-query consumers aren't needed: the variants render the textarea directly.

vi.mock("../../src/hooks/useComposer", () => ({
  useComposer: () => ({
    draft: "",
    setDraft: vi.fn(),
    send: vi.fn(),
    isStreaming: false,
    sttReady: false,
    mic: { status: "idle", toggle: vi.fn() },
  }),
}));

afterEach(cleanup);

const ph = (c: HTMLElement) => c.querySelector("#cmd-input")!.getAttribute("placeholder");

// [variant, its own default copy] — the defaults are asserted as LITERALS on purpose: the point of the
// fallback is that it is the exact string that shipped before the seam existed.
const VARIANTS: [name: string, Variant: ComposerVariant, fallback: string][] = [
  ["stacked (KitComposer)", KitComposer, "How can I help you today?"],
  ["sheet (SheetComposer)", SheetComposer, "Message"],
  ["line (LineComposer)", LineComposer, "Message"],
];

describe("composer placeholder slot", () => {
  it.each(VARIANTS)("%s · omitted → its own default", (_name, Variant, fallback) => {
    const { container } = render(<Variant />);
    expect(ph(container)).toBe(fallback);
  });

  it.each(VARIANTS)("%s · filled → the theme's copy", (_name, Variant) => {
    const { container } = render(<Variant placeholder={GACHA_COPY.composerPlaceholder} />);
    expect(ph(container)).toBe(GACHA_COPY.composerPlaceholder);
  });

  it("survives the slot MERGE the way DefaultRoot composes it (theme = the last source wins)", () => {
    const merged = mergeComposerSlots(kitToolsMenuSlots, undefined, {
      placeholder: GACHA_COPY.composerPlaceholder,
    });
    expect(merged.placeholder).toBe(GACHA_COPY.composerPlaceholder);
    // …and the kit's own addon still rides along (the merge composes, it doesn't choose).
    expect(merged.controlsStart).not.toBeUndefined();
    const { container } = render(<KitComposer {...merged} />);
    expect(ph(container)).toBe(GACHA_COPY.composerPlaceholder);
  });

  it("a merge with no contributor leaves it undefined → the variant's fallback stands", () => {
    const merged = mergeComposerSlots(kitToolsMenuSlots, undefined, undefined);
    expect(merged.placeholder).toBeUndefined();
    const { container } = render(<KitComposer {...merged} />);
    expect(ph(container)).toBe("How can I help you today?");
  });
});
