import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The `brandText` kit seam (D52 / GACHA_PLAN §4.3 + the §4.9 ledger) — the third member of the appbar's
// slot family (`brandMark` · brandText · `brandMeta`). The kit brand row hardcoded the literal `ctrl·b`;
// gacha's ruled katakana wordmark needs it fillable. The two claims: an omitted slot renders that exact
// literal (every other theme byte-identical), and a filled slot replaces ONLY the wordmark — the mark and
// the meta line keep their own defaults.
//
// G6.3 added the family's fourth rung, and it belongs to the same row: the OWNER's brand file
// (`media/kit/brand/`) outranks the theme's `brandMark`, which outranks the kit dot. Its arms are at the
// bottom of this file rather than in a suite of their own, because "what leads the brand row" is one
// ladder and reading it in one place is the point.
//
// The `brandMeta` member gained a SECOND condition in the same ruling's refinement (owner 2026-08-06): the
// synced `ui.appbarSubtitleVisible` switch, default OFF. So the subtitle needs BOTH — a theme that fills
// the slot AND an owner who asked for the line — and the middle suite below pins all four corners of that,
// including the one that must never happen: the switch conjuring text for a theme that authored none.
//
// `useVoiceStatus` (a react-query consumer inside useAppChrome) is stubbed so the bar renders without a
// QueryClientProvider — this suite is about the slots, not the TTS toggle (ttsToast.test.tsx owns that).
// `useMedia` is stubbed for the same reason (the bar now reads the kit index) and, below, so the brand
// folder's contents can be varied per arm.

vi.mock("../../src/hooks/useAppChrome", () => ({
  useAppChrome: () => ({ ttsAuto: true, ttsConfigured: false, toggleAutoTts: vi.fn() }),
}));

const media = vi.hoisted(() => ({ data: undefined as MediaIndex | undefined }));
vi.mock("../../src/hooks/useMedia", () => ({
  useMediaIndex: () => ({ data: media.data, error: null }),
}));

import { KitAppBar } from "../../src/theme-engine/kit/AppBar";
import { setUI } from "../../src/store/ui";
import type { MediaFile, MediaIndex } from "../../src/hooks/useMedia";

beforeEach(() => {
  media.data = undefined;
  // `appbarSubtitleVisible` is RESET here, not just defaulted: the ui store is module-global, so an arm
  // that switches the subtitle on would otherwise leak into every arm after it.
  setUI({
    theme: "minimal",
    tab: "fleet",
    layout: "auto",
    appbarMode: "visible",
    appbarSubtitleVisible: false,
  });
});

afterEach(cleanup);

const brand = (c: HTMLElement) => c.querySelector(".kit-brand")!;

describe("KitAppBar brandText slot", () => {
  it("omitted → the kit's own `ctrl·b` wordmark, and NO subtitle (G6.3: icon + title only)", () => {
    const { container } = render(<KitAppBar appbarMode="visible" />);
    expect(brand(container).textContent).toBe("ctrl·b");
    expect(brand(container).querySelector(".dot")).not.toBeNull(); // the default mark still leads
    // The owner ruling 2026-08-06: no decorative subtitle in ANY mode. The `.meta` span renders only
    // when a theme passes live data (frontier's rig count) — never by default.
    expect(brand(container).querySelector(".meta")).toBeNull();
  });

  it("filled → the theme's node replaces the wordmark, leaving the mark default intact", () => {
    const { container } = render(
      <KitAppBar
        appbarMode="visible"
        brandText={<b className="gc-wordmark">カプセルアーケード</b>}
      />,
    );
    expect(brand(container).querySelector(".gc-wordmark")?.textContent).toBe("カプセルアーケード");
    expect(brand(container).textContent).not.toContain("ctrl·b");
    expect(brand(container).querySelector(".dot")).not.toBeNull();
    expect(brand(container).querySelector(".meta")).toBeNull(); // no subtitle unless a theme passes one
  });

  it("composes with the other two slots (mark · text · meta are independent)", () => {
    setUI({ appbarSubtitleVisible: true }); // the meta slot only paints while the owner wants the line
    const { container } = render(
      <KitAppBar
        appbarMode="visible"
        brandMark={<span className="gc-mark" />}
        brandText="コントロール・ビー"
        brandMeta="ネットワーク景品所"
      />,
    );
    expect(brand(container).querySelector(".gc-mark")).not.toBeNull();
    expect(brand(container).querySelector(".dot")).toBeNull(); // the theme's mark replaced the kit dot
    expect(brand(container).textContent).toBe("コントロール・ビーネットワーク景品所");
  });
});

// ── The BAR SUBTITLE switch (the G6.3 refinement, owner 2026-08-06) ───────────────────────────────────

describe("KitAppBar brandMeta — gated by the synced `appbarSubtitleVisible` switch", () => {
  it("OFF (the default) → no subtitle, even when the theme fills the slot", () => {
    // The resting bar the ruling asked for: icon + title only. The theme keeps passing its line — the
    // owner's one switch is what decides, for every theme at once.
    const { container } = render(<KitAppBar appbarMode="visible" brandMeta="ネットワーク景品所" />);
    expect(brand(container).querySelector(".meta")).toBeNull();
    expect(brand(container).textContent).toBe("ctrl·b");
  });

  it("ON → the theme's own subtitle renders beside the title", () => {
    setUI({ appbarSubtitleVisible: true });
    const { container } = render(<KitAppBar appbarMode="visible" brandMeta="ネットワーク景品所" />);
    expect(brand(container).querySelector(".meta")?.textContent).toBe("ネットワーク景品所");
  });

  it("ON with NO fill → still nothing: the switch can never conjure default text", () => {
    // The half of the ruling that outlives the toggle: the kit's old "dashboard" literal is dead, so a
    // theme with no subtitle of its own shows the same bar in both states.
    setUI({ appbarSubtitleVisible: true });
    const { container } = render(<KitAppBar appbarMode="visible" />);
    expect(brand(container).querySelector(".meta")).toBeNull();
    expect(brand(container).textContent).toBe("ctrl·b");
  });

  it("a theme with nothing to say yet passes `null` — and the WRAPPER goes too, not just its text", () => {
    // frontier's rig count has no value until the fleet arrives, so it passes `null` (FrontierRoot resolves
    // the data and hands the kit a value, G6.5). `.meta` must then be ABSENT, not present-and-empty: an
    // empty inline span still carries the slot's margin and is a real node for AT to land on.
    setUI({ appbarSubtitleVisible: true });
    const { container } = render(<KitAppBar appbarMode="visible" brandMeta={null} />);
    expect(brand(container).querySelector(".meta")).toBeNull();
    expect(brand(container).textContent).toBe("ctrl·b");
  });

  it("…which is WHY the slot takes a value and not a component (the Codex G6.4 LOW-1 trap)", () => {
    // A `<Component />` is a React ELEMENT — never null, however it renders — so the kit's `!= null` test
    // cannot see through one, and a theme that filled the slot with a component whose body returns `null`
    // got an empty wrapper anyway. Pinned so nobody "tidies" a theme's Root back into that shape.
    setUI({ appbarSubtitleVisible: true });
    const Empty = () => null;
    const { container } = render(<KitAppBar appbarMode="visible" brandMeta={<Empty />} />);
    expect(brand(container).querySelector(".meta")).not.toBeNull();
    expect(brand(container).textContent).toBe("ctrl·b");
  });
});

// ── G6.3 · the owner's brand FILE, the ladder's new top rung ──────────────────────────────────────────

const brandFile = (name: string, over: Partial<MediaFile> = {}): MediaFile => ({
  name,
  file: `${name}.png`,
  url: `/api/media/kit/files/brand/${name}.png`,
  format: "png",
  size_bytes: 3_000,
  revision: `1:3000:${name}`,
  width: 64,
  height: 64,
  unusable: false,
  unusable_reason: null,
  ...over,
});

const brandIndex = (files: MediaFile[], slots: MediaIndex["slots"] = {}) =>
  ({ ns: "kit", collation: "library-v1", roles: { brand: files }, slots }) as MediaIndex;

const mark = (c: HTMLElement) => c.querySelector<HTMLElement>(".kit-brand-mark");

describe("KitAppBar brand MARK precedence (G6.3)", () => {
  it("no owner file → the theme's brandMark; no theme mark either → the kit dot", () => {
    // Dormancy by absence: the empty folder is the ordinary state, and in it the bar is byte-identical
    // to the one that shipped before the role existed.
    const bare = render(<KitAppBar appbarMode="visible" />);
    expect(mark(bare.container)).toBeNull();
    expect(brand(bare.container).querySelector(".dot")).not.toBeNull();
    cleanup();

    media.data = brandIndex([]);
    const themed = render(
      <KitAppBar appbarMode="visible" brandMark={<span className="gc-mark" />} />,
    );
    expect(mark(themed.container)).toBeNull();
    expect(brand(themed.container).querySelector(".gc-mark")).not.toBeNull();
  });

  it("an owner file OUTRANKS the theme's mark and the dot, and masks from its `?rev=` URL", () => {
    media.data = brandIndex([brandFile("logo")]);
    const { container } = render(
      <KitAppBar appbarMode="visible" brandMark={<span className="gc-mark" />} />,
    );
    const el = mark(container)!;
    expect(el).not.toBeNull();
    expect(brand(container).querySelector(".gc-mark")).toBeNull();
    expect(brand(container).querySelector(".dot")).toBeNull();
    // `?rev=` is what makes overwriting the file in place repaint: a mask has no element to re-key.
    expect(el.style.getPropertyValue("--kit-brand-mask")).toBe(
      'url("/api/media/kit/files/brand/logo.png?rev=1%3A3000%3Alogo")',
    );
    // Ornament, not name — the wordmark beside it carries the accessible text.
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(brand(container).textContent).toBe("ctrl·b");
  });

  it("takes the folder's FIRST file, and an UNUSABLE-only folder falls back to the old rungs", () => {
    // "W6" (owner ruling 2026-08-26): the `brand` pin is gone with every other pool pin, so the mark is
    // whichever image the owner put at the top of the Logo gallery.
    media.data = brandIndex([brandFile("b"), brandFile("a")], { brand: { name: "a.png" } });
    const first = render(<KitAppBar appbarMode="visible" />);
    expect(mark(first.container)!.style.getPropertyValue("--kit-brand-mask")).toContain(
      "/brand/b.png",
    );
    cleanup();

    media.data = brandIndex([brandFile("a", { unusable: true })]);
    const broken = render(
      <KitAppBar appbarMode="visible" brandMark={<span className="gc-mark" />} />,
    );
    expect(mark(broken.container)).toBeNull();
    expect(brand(broken.container).querySelector(".gc-mark")).not.toBeNull();
  });
});
