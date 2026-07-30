import type { KeyboardEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { modalKeyDown } from "../../src/lib/focusTrap";

// The ONE modal keydown contract, extracted from PromptModal so the A3 automations sheet shares it
// (A3 slice 3 review, MED). Two behaviours, and the second is the one a snapshot-based trap gets wrong:
// the focusable set is re-queried on EVERY Tab, because both modals change their own children while
// open (PromptModal's Load/Restore appear only with a default; the sheet's preset fields swap with the
// picked preset).

// Each case builds its own panel into the document (focus is a document-level concept), so the DOM has
// to be cleared between them or `getElementById` resolves the PREVIOUS test's node.
afterEach(() => {
  document.body.innerHTML = "";
});

function panelWith(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.append(el);
  return el;
}

/** A minimal synthetic keydown — only the three fields the helper reads, plus a `preventDefault` spy. */
function key(k: string, shiftKey = false) {
  const preventDefault = vi.fn();
  const e = { key: k, shiftKey, preventDefault } as unknown as KeyboardEvent<HTMLElement>;
  return { e, preventDefault };
}

describe("modalKeyDown", () => {
  it("Escape closes and swallows the event", () => {
    const onClose = vi.fn();
    const { e, preventDefault } = key("Escape");
    modalKeyDown(e, panelWith("<button>a</button>"), onClose);
    expect(onClose).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalled();
  });

  it("Tab cycles forward and wraps; Shift+Tab goes back", () => {
    const panel = panelWith("<button id='a'>a</button><textarea id='b'></textarea>");
    const onClose = vi.fn();
    const [a, b] = ["a", "b"].map((id) => document.getElementById(id) as HTMLElement);

    a.focus();
    modalKeyDown(key("Tab").e, panel, onClose);
    expect(document.activeElement).toBe(b);
    modalKeyDown(key("Tab").e, panel, onClose);
    expect(document.activeElement).toBe(a); // wrapped — focus never leaves the panel
    modalKeyDown(key("Tab", true).e, panel, onClose);
    expect(document.activeElement).toBe(b);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("skips disabled controls and re-reads the set on every Tab", () => {
    const panel = panelWith("<button id='a'>a</button><button id='b' disabled>b</button>");
    const a = document.getElementById("a") as HTMLElement;
    a.focus();
    modalKeyDown(key("Tab").e, panel, vi.fn());
    expect(document.activeElement).toBe(a); // the disabled one is no stop, so `a` is the whole cycle

    // …now the panel grows a control while it is open (PromptModal's Load/Restore, the sheet's preset
    // fields). A set captured once would never reach it.
    const late = document.createElement("button");
    panel.append(late);
    modalKeyDown(key("Tab").e, panel, vi.fn());
    expect(document.activeElement).toBe(late);
  });

  it("does nothing for other keys, and is inert without a panel", () => {
    const onClose = vi.fn();
    const { e, preventDefault } = key("Enter");
    modalKeyDown(e, panelWith("<button>a</button>"), onClose);
    expect(onClose).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();

    // A modal mid-unmount has a null ref; the handler must not throw into the event system.
    expect(() => modalKeyDown(key("Tab").e, null, onClose)).not.toThrow();
  });
});
