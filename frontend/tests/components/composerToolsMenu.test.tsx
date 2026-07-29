import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadAgents, loadSkills } from "../../src/lib/composer";
import { setComposerOverlay } from "../../src/store/composerOverlay";
import { clearComposerScope, getComposerScope } from "../../src/store/composerScope";
import { clearDraft } from "../../src/store/composer";
import { setPlanSheetOpen, usePlanSheetOpen } from "../../src/store/planSheet";
import { mergeComposerSlots } from "../../src/theme-engine/kit/composer/mergeSlots";
import { KitComposer } from "../../src/theme-engine/kit/composer/Composer";
import { kitToolsMenuSlots } from "../../src/theme-engine/kit/composer/toolsMenu";

// A6 — the composer tools/skills MENU, driven through a REAL Kit composer with the addon composed in the
// way DefaultRoot composes it (mergeComposerSlots → the variant's slots). Covers the trigger↔panel aria
// contract, the one-shot arming the rows write, and the shared overlay slot (opening the menu closes the
// plan sheet). The store mechanics live in tests/store/composerScope|composerOverlay.test.ts.

const AGENTS = { agents: ["ops", "research"], default: "default" };
const SKILLS = [{ name: "deploy" }, { name: "backups" }];

beforeEach(async () => {
  clearDraft();
  clearComposerScope();
  setComposerOverlay(null);
  localStorage.clear();
  globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("/api/agents"))
      return Promise.resolve({ ok: true, json: () => Promise.resolve(AGENTS) } as Response);
    if (u.includes("/api/skills"))
      return Promise.resolve({ ok: true, json: () => Promise.resolve(SKILLS) } as Response);
    return Promise.resolve({ ok: false } as Response);
  });
  await Promise.all([loadAgents(), loadSkills()]);
});
afterEach(cleanup); // globals:false → register RTL cleanup explicitly

function renderComposer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // exactly DefaultRoot's composition: the menu leads the controls row, the plan (absent here) follows
  const slots = mergeComposerSlots(kitToolsMenuSlots, undefined);
  return render(
    <QueryClientProvider client={qc}>
      <KitComposer {...slots} />
    </QueryClientProvider>,
  );
}

const trigger = (c: HTMLElement) => c.querySelector<HTMLButtonElement>("button.kit-cbtn.tools")!;

describe("tools menu — trigger/panel wiring", () => {
  it("the trigger declares its popup and points at the panel only while it exists", () => {
    const { container } = renderComposer();
    const btn = trigger(container);
    // `dialog` — the popup is a labelled REGION with a radiogroup, not an arrow-key menu widget
    expect(btn.getAttribute("aria-haspopup")).toBe("dialog");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.getAttribute("aria-controls")).toBe(null);
    expect(container.querySelector("#composer-tools")).toBe(null);

    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.getAttribute("aria-controls")).toBe("composer-tools");
    const panel = container.querySelector("#composer-tools")!;
    expect(panel.getAttribute("role")).toBe("region");
    expect(panel.getAttribute("aria-label")).toContain("next message");

    fireEvent.click(btn); // the trigger is also the close gesture
    expect(container.querySelector("#composer-tools")).toBe(null);
  });

  it("the panel is a positioned SIBLING rendered before the composer bar (the overlay slot)", () => {
    const { container } = renderComposer();
    fireEvent.click(trigger(container));
    const kids = Array.from(container.childNodes);
    const panelIdx = kids.findIndex((n) => (n as Element).id === "composer-tools");
    const barIdx = kids.findIndex((n) => (n as Element).id === "composer");
    expect(panelIdx).toBeGreaterThanOrEqual(0);
    expect(barIdx).toBeGreaterThan(panelIdx);
  });

  it("lists the configured agents as radios (plus a default row) and the skills as checkboxes", () => {
    const { container } = renderComposer();
    fireEvent.click(trigger(container));
    const radios = container.querySelectorAll("#composer-tools [role=radio]");
    expect(Array.from(radios).map((r) => r.querySelector(".tools-name")?.textContent)).toEqual([
      "default",
      "ops",
      "research",
    ]);
    expect(radios[0].getAttribute("aria-checked")).toBe("true"); // default is the resting pick
    const boxes = container.querySelectorAll("#composer-tools [role=checkbox]");
    expect(Array.from(boxes).map((b) => b.querySelector(".tools-name")?.textContent)).toEqual([
      "deploy",
      "backups",
    ]);
    expect(container.querySelector("#composer-tools [role=radiogroup]")).not.toBe(null);
  });
});

describe("tools menu — arming", () => {
  it("picking an agent + ticking skills arms the one-shot, and the trigger shows the armed marker", () => {
    const { container } = renderComposer();
    fireEvent.click(trigger(container));
    const radios = container.querySelectorAll<HTMLButtonElement>("#composer-tools [role=radio]");
    fireEvent.click(radios[1]); // "ops"
    fireEvent.click(
      container.querySelectorAll<HTMLButtonElement>("#composer-tools [role=checkbox]")[0],
    );
    expect(getComposerScope()).toEqual({ agent: "ops", skills: ["deploy"] });

    const btn = trigger(container);
    expect(btn.querySelector(".tools-dot")).not.toBe(null); // the armed dot, readable with the panel shut
    expect(btn.getAttribute("aria-label")).toContain("agent ops");
    expect(btn.getAttribute("aria-label")).toContain("deploy");
    expect(
      container.querySelector("#composer-tools [role=radio][aria-checked=true] .tools-name")
        ?.textContent,
    ).toBe("ops");
  });

  it("the clear row appears only when armed and drops the arming", () => {
    const { container } = renderComposer();
    fireEvent.click(trigger(container));
    expect(container.querySelector(".tools-clear")).toBe(null);
    fireEvent.click(
      container.querySelectorAll<HTMLButtonElement>("#composer-tools [role=radio]")[1],
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>(".tools-clear")!);
    expect(getComposerScope()).toEqual({ agent: null, skills: [] });
    expect(trigger(container).querySelector(".tools-dot")).toBe(null);
  });
});

describe("tools menu — the shared composer-overlay slot", () => {
  it("opening the menu closes the plan sheet; the typing popover then closes the menu", () => {
    const { container } = renderComposer();
    const Probe = () => <span>{String(usePlanSheetOpen())}</span>;
    const probe = render(<Probe />);
    act(() => setPlanSheetOpen(true));
    expect(probe.container.textContent).toBe("true");

    fireEvent.click(trigger(container));
    expect(probe.container.textContent).toBe("false"); // the menu took the slot
    expect(container.querySelector("#composer-tools")).not.toBe(null);

    // typing a `/verb` arms the suggest popover, which claims the slot in turn
    fireEvent.change(container.querySelector<HTMLTextAreaElement>("#cmd-input")!, {
      target: { value: "/c" },
    });
    expect(container.querySelector("#composer-tools")).toBe(null);
    expect(container.querySelector("#composer-suggest")).not.toBe(null);
  });
});
