import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useSections } from "../../src/hooks/useSections";
import { setUI } from "../../src/store/ui";

// hooks/useSections — the navigation controller (D29 §14.2). It exposes the active theme's section list
// + the active section + navigate + `hasComposer` (which replaced the old `tab==='fleet'||'agent'`
// hardcode and the core `.no-composer` write). Drives the real `ui` store so the wiring is end-to-end.

beforeEach(() => {
  setUI({ theme: "vapor", tab: "fleet" }); // module state persists between cases
});

describe("useSections", () => {
  it("exposes vapor's 4 sections + the active one + its composer flag", () => {
    const { result } = renderHook(() => useSections());
    expect(result.current.sections.map((s) => s.id)).toEqual(["fleet", "agent", "utils", "conf"]);
    expect(result.current.active).toBe("fleet");
    expect(result.current.hasComposer).toBe(true); // fleet has a composer
  });

  it("navigate() switches the active section and re-derives hasComposer", () => {
    const { result } = renderHook(() => useSections());
    act(() => result.current.navigate("conf"));
    expect(result.current.active).toBe("conf");
    expect(result.current.hasComposer).toBe(false); // conf has no composer

    act(() => result.current.navigate("agent"));
    expect(result.current.active).toBe("agent");
    expect(result.current.hasComposer).toBe(true);
  });
});
