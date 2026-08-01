import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { createElement, type ComponentType } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KitComposer } from "../../src/theme-engine/kit/composer/Composer";
import { LineComposer } from "../../src/theme-engine/kit/composer/LineComposer";
import { SheetComposer } from "../../src/theme-engine/kit/composer/SheetComposer";

// The transcribing spinner (owner ask 2026-07-30): while a recorded clip awaits its transcript
// (`useDictation` status `sending`) every composer's mic button swaps its glyph for the shared 8-bar
// SpinnerIcon and gains `.sending` (the CSS hook that rolls it). Lives in its OWN file because the
// pin needs BOTH mocks the other harnesses deliberately avoid: sttReady=true (so the mic mounts at
// all) AND a dictation hook frozen at `sending` (unreachable without driving MediaRecorder).
//
// D51 V4 phase 2: the fourth row — the bespoke `components/Composer` ("vapor: the CSS-masked button…") —
// was DELETED with the component it pinned. Vapor renders the `sheet` variant now, already covered above.
vi.mock("../../src/hooks/useVoiceStatus", () => ({
  useVoiceStatus: () => ({ data: { stt: true, tts: false }, dataUpdatedAt: 1 }),
}));
vi.mock("../../src/hooks/useDictation", () => ({
  useDictation: () => ({ status: "sending", toggle: vi.fn() }),
}));

function renderWith(Comp: ComponentType) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client: qc }, createElement(Comp)));
}

afterEach(cleanup);

describe("mic button while transcribing (status `sending`)", () => {
  it.each([
    ["stacked", KitComposer],
    ["sheet", SheetComposer],
    ["line", LineComposer],
  ] as const)(
    "%s: `.sending` + disabled + the 8-bar spinner replaces the mic glyph",
    (_id, Comp) => {
      const { container } = renderWith(Comp);
      const btn = container.querySelector<HTMLButtonElement>(".kit-cbtn.mic");
      expect(btn).not.toBeNull();
      expect(btn!.classList.contains("sending")).toBe(true);
      expect(btn!.disabled).toBe(true);
      // SpinnerIcon = exactly 8 bar paths, no <rect>; both mic glyphs carry a rect or a single path.
      expect(btn!.querySelectorAll("svg path")).toHaveLength(8);
      expect(btn!.querySelector("svg rect")).toBeNull();
    },
  );
});
