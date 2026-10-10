import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ChatHeaderActions } from "../../src/components/ChatHeaderActions";

// D84 §7 (Phase 27 S9a) — the one chat-header action cluster every chat body (AgentTab, FrontierAgent,
// GachaAgent) renders. The factor is a no-visual-change step: the DOM contract the three bodies relied on
// is a `.right` span wrapping the privilege chip, and that is exactly what the cluster must render.

afterEach(cleanup);

describe("ChatHeaderActions", () => {
  it("renders the `.right` span wrapping the privilege chip", () => {
    const { container } = render(<ChatHeaderActions />);
    const right = container.firstElementChild;
    expect(right).not.toBeNull();
    expect(right!.tagName).toBe("SPAN");
    expect(right!.className).toBe("right");
    expect(right!.children).toHaveLength(1);
    expect(right!.querySelector(":scope > .priv-chip-wrap > .priv-chip")).not.toBeNull();
  });
});
