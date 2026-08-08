// ⚠ IMPORT ORDER IS THE TEST. `variants.ts` MUST stay the first import in this file.
//
// The composer surface sits in a real ESM cycle: variants → surface → settings → registry → themes/vapor →
// VaporRoot → DefaultRoot → ThemedComposer → variants. Which module the app happens to load FIRST decides
// where that cycle is entered, and therefore which bindings are still in their temporal dead zone when a
// module body runs. Entering at `variants.ts` is the hostile order: by the time `ThemedComposer.tsx`
// evaluates, `composerSurface` is declared but UNINITIALIZED, so any top-level READ of a property on it
// (`composerSurface.Themed`) throws `Cannot read properties of undefined`. That shipped for one commit
// (E0 commit 3) and is exactly the class of failure this file exists to catch: it is not reproducible from
// the app's usual entry point, only from a module graph that starts here.
//
// The rule the fix encodes: inside a cycle, a module body may DECLARE and it may IMPORT, but it must not
// READ THROUGH a binding from the cycle. `ThemedComposer` therefore reads `composerSurface.Themed` at
// RENDER time, which is long after every module in the graph has finished evaluating.
import { composerSurface } from "../../src/theme-engine/kit/composer/variants";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { setUI } from "../../src/store/ui";
import { KitComposer } from "../../src/theme-engine/kit/composer/Composer";
import { ThemedComposer } from "../../src/theme-engine/kit/composer/ThemedComposer";

afterEach(() => {
  cleanup();
  setUI({ themeSettings: {} });
});

describe("module-init safety with `variants.ts` as the entry module", () => {
  it("every export of the cycle initialized (no TDZ read at module scope)", () => {
    expect(composerSurface).toBeDefined();
    expect(composerSurface.variants.stacked).toBe(KitComposer);
    expect(ThemedComposer).toBeDefined();
  });

  it("ThemedComposer still RENDERS through the surface after that entry order", () => {
    setUI({ theme: "cosmos", themeSettings: {} });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      createElement(QueryClientProvider, { client: qc }, createElement(ThemedComposer, {})),
    );
    expect(container.querySelector("#composer")?.className).toBe("kit-composer stacked");
  });
});
