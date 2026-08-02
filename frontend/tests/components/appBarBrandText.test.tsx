import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KitAppBar } from "../../src/theme-engine/kit/AppBar";
import { setUI } from "../../src/store/ui";

// The `brandText` kit seam (D52 / GACHA_PLAN §4.3 + the §4.9 ledger) — the third member of the appbar's
// slot family (`brandMark` · brandText · `brandMeta`). The kit brand row hardcoded the literal `ctrl·b`;
// gacha's ruled katakana wordmark needs it fillable. The two claims: an omitted slot renders that exact
// literal (every other theme byte-identical), and a filled slot replaces ONLY the wordmark — the mark and
// the meta line keep their own defaults.
//
// `useVoiceStatus` (a react-query consumer inside useAppChrome) is stubbed so the bar renders without a
// QueryClientProvider — this suite is about the slot, not the TTS toggle (ttsToast.test.tsx owns that).

vi.mock("../../src/hooks/useAppChrome", () => ({
  useAppChrome: () => ({ ttsAuto: true, ttsConfigured: false, toggleAutoTts: vi.fn() }),
}));

beforeEach(() => {
  setUI({ theme: "minimal", tab: "fleet", layout: "auto", appbarMode: "visible" });
});

afterEach(cleanup);

const brand = (c: HTMLElement) => c.querySelector(".kit-brand")!;

describe("KitAppBar brandText slot", () => {
  it("omitted → the kit's own `ctrl·b` wordmark (the pre-D52 render)", () => {
    const { container } = render(<KitAppBar appbarMode="visible" />);
    expect(brand(container).textContent).toBe("ctrl·bdashboard");
    expect(brand(container).querySelector(".dot")).not.toBeNull(); // the default mark still leads
  });

  it("filled → the theme's node replaces the wordmark, leaving mark + meta defaults intact", () => {
    const { container } = render(
      <KitAppBar
        appbarMode="visible"
        brandText={<b className="gc-wordmark">カプセルアーケード</b>}
      />,
    );
    expect(brand(container).querySelector(".gc-wordmark")?.textContent).toBe("カプセルアーケード");
    expect(brand(container).textContent).not.toContain("ctrl·b");
    expect(brand(container).querySelector(".dot")).not.toBeNull();
    expect(brand(container).querySelector(".meta")?.textContent).toBe("dashboard");
  });

  it("composes with the other two slots (mark · text · meta are independent)", () => {
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
