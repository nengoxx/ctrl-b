import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadAgents, loadSkills } from "../../src/lib/composer";
import { setSessionAgent } from "../../src/store/chat";
import { getComposerOverlay, setComposerOverlay } from "../../src/store/composerOverlay";
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

// D70 §10-S4 — `GET /agents` now also carries the SUMMARY map. Only `ops` binds an avatar here, so the
// avatar assertions below read a mixed list (the shape the picker actually meets).
const AGENTS = {
  agents: ["ops", "research"],
  default: "default",
  summaries: {
    default: { title: "", description: "", avatar: "", background: "", voice: "" },
    ops: { title: "Ops Bot", description: "", avatar: "ops.png", background: "", voice: "" },
    research: { title: "", description: "", avatar: "", background: "", voice: "" },
  },
};
const AGENT_MEDIA = {
  ns: "agents",
  collation: "library-v1",
  slots: {},
  roles: {
    avatars: [
      {
        name: "ops",
        file: "ops.png",
        url: "/api/media/agents/files/avatars/ops.png",
        format: "png",
        size_bytes: 100,
        revision: "r1",
        width: 64,
        height: 64,
        unusable: false,
        unusable_reason: null,
      },
    ],
    backgrounds: [],
  },
};
const SKILLS = [{ name: "deploy" }, { name: "backups" }];

beforeEach(async () => {
  clearDraft();
  clearComposerScope();
  setSessionAgent(null);
  setComposerOverlay(null);
  localStorage.clear();
  globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
    const u = String(url);
    if (u.includes("/api/agents"))
      return Promise.resolve({ ok: true, json: () => Promise.resolve(AGENTS) } as Response);
    if (u.includes("/api/media/agents"))
      return Promise.resolve({ ok: true, json: () => Promise.resolve(AGENT_MEDIA) } as Response);
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
/** The panel STAYS MOUNTED (2026-07-30) so its close animates like the plan sheet's — "closed" is now
 *  `.open` off + `inert` on (out of tab order AND the a11y tree), not absence. */
const panel = (c: HTMLElement) => c.querySelector<HTMLElement>("#composer-tools")!;
const panelOpen = (c: HTMLElement) => {
  const el = panel(c);
  expect(el).not.toBe(null);
  expect(el.hasAttribute("inert")).toBe(!el.classList.contains("open")); // the two never disagree
  return el.classList.contains("open");
};
/** The agent rows' NATIVE radios (Codex round 2 — a `role=radio` button promises arrow keys it can't
 *  deliver; a same-`name` input group gets them from the browser). The row label is their parent. */
const radios = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLInputElement>("#composer-tools input[type=radio]"));
const rowName = (r: HTMLInputElement) =>
  r.closest("label")?.querySelector(".tools-name")?.textContent;

describe("tools menu — trigger/panel wiring", () => {
  it("the trigger declares its popup and points at the panel only while it exists", () => {
    const { container } = renderComposer();
    const btn = trigger(container);
    // `dialog` — the popup is a labelled REGION with a radiogroup, not an arrow-key menu widget
    expect(btn.getAttribute("aria-haspopup")).toBe("dialog");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.getAttribute("aria-controls")).toBe(null);
    expect(panelOpen(container)).toBe(false); // mounted, but inert + closed

    fireEvent.click(btn);
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(btn.getAttribute("aria-controls")).toBe("composer-tools");
    expect(panelOpen(container)).toBe(true);
    expect(panel(container).getAttribute("role")).toBe("region");
    expect(panel(container).getAttribute("aria-label")).toContain("next message");

    fireEvent.click(btn); // the trigger is also the close gesture
    expect(panelOpen(container)).toBe(false);
    // `aria-hidden` is deliberately NOT used alongside inert — aria-hidden over focusable rows is the
    // `aria-hidden-focus` violation this mechanism replaces.
    expect(panel(container).getAttribute("aria-hidden")).toBe(null);
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

  it("lists the configured agents as ONE native radio group (plus a default row), skills as checkboxes", () => {
    const { container } = renderComposer();
    fireEvent.click(trigger(container));
    const rows = radios(container);
    expect(rows.map(rowName)).toEqual(["default", "ops", "research"]);
    expect(rows[0].checked).toBe(true); // default is the resting pick
    // one shared `name` = one group = the browser's own arrow-key selection, no roving focus to hand-roll
    expect(new Set(rows.map((r) => r.name)).size).toBe(1);
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
    fireEvent.click(radios(container)[1]); // "ops"
    fireEvent.click(
      container.querySelectorAll<HTMLButtonElement>("#composer-tools [role=checkbox]")[0],
    );
    expect(getComposerScope()).toEqual({ agent: "ops", skills: ["deploy"] });

    const btn = trigger(container);
    expect(btn.querySelector(".tools-dot")).not.toBe(null); // the armed dot, readable with the panel shut
    expect(btn.getAttribute("aria-label")).toContain("agent ops");
    expect(btn.getAttribute("aria-label")).toContain("deploy");
    expect(
      radios(container)
        .filter((r) => r.checked)
        .map(rowName),
    ).toEqual(["ops"]);
  });

  it("the clear row appears only when armed and drops the arming", () => {
    const { container } = renderComposer();
    fireEvent.click(trigger(container));
    expect(container.querySelector(".tools-clear")).toBe(null);
    fireEvent.click(radios(container)[1]);
    fireEvent.click(container.querySelector<HTMLButtonElement>(".tools-clear")!);
    expect(getComposerScope().agent).toBe(undefined);
    expect(getComposerScope().skills).toEqual([]);
    expect(trigger(container).querySelector(".tools-dot")).toBe(null);
  });

  // Codex, round 2 — the checked row must describe where the next message ACTUALLY goes. With a sticky
  // `/agent ops` in force and nothing armed, "default" ticked was a lie: the send would have gone to `ops`.
  it("with a sticky `/agent ops` and nothing armed, the STICKY row reads as checked", () => {
    setSessionAgent("ops");
    const { container } = renderComposer();
    fireEvent.click(trigger(container));
    expect(
      radios(container)
        .filter((r) => r.checked)
        .map(rowName),
    ).toEqual(["ops"]);
    expect(trigger(container).querySelector(".tools-dot")).toBe(null); // reflected ≠ armed
  });

  // Codex, verify round — `/agent typo` stays sticky ON PURPOSE (the backend falls back to the default and
  // routeSlash already warned), but "typo" matches no row: reflecting it verbatim left EVERY radio
  // unchecked, i.e. the panel claiming the next message goes nowhere. The default row is where it goes.
  it("a sticky agent that isn't configured reads as the DEFAULT row, not an empty group", () => {
    setSessionAgent("typo");
    const { container } = renderComposer();
    fireEvent.click(trigger(container));
    expect(
      radios(container)
        .filter((r) => r.checked)
        .map(rowName),
    ).toEqual(["default"]);
    expect(trigger(container).querySelector(".tools-dot")).toBe(null); // reflected ≠ armed
    // …and the DISPLAY normalization never touches the sticky value the send path reads
    expect(getComposerScope().agent).toBe(undefined);
  });

  it("picking the DEFAULT row over a sticky pick arms an explicit `null` (not 'nothing armed')", () => {
    setSessionAgent("ops");
    const { container } = renderComposer();
    fireEvent.click(trigger(container));
    fireEvent.click(radios(container)[0]); // the "default" row
    expect(getComposerScope().agent).toBe(null); // a REAL pick — runComposer forwards `agent: null`
    expect(
      radios(container)
        .filter((r) => r.checked)
        .map(rowName),
    ).toEqual(["default"]);
    // …and the trigger says so, rather than lighting a dot it can't explain
    expect(trigger(container).querySelector(".tools-dot")).not.toBe(null);
    expect(trigger(container).getAttribute("aria-label")).toContain("agent default");
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
    expect(panelOpen(container)).toBe(true);

    // typing a `/verb` arms the suggest popover, which claims the slot in turn
    fireEvent.change(container.querySelector<HTMLTextAreaElement>("#cmd-input")!, {
      target: { value: "/c" },
    });
    expect(panelOpen(container)).toBe(false);
    expect(container.querySelector("#composer-suggest")!.classList.contains("open")).toBe(true);
  });

  // Codex, round 2 — the slot is module state and the surfaces are composer children: a tab/layout swap
  // that drops the composer would leave the slot naming a surface that no longer exists (an invisible
  // owner nothing else can displace), and the menu would spring back open on the next mount.
  it("unmounting the composer hands the MENU's slot back — it doesn't spring open on remount", () => {
    const first = renderComposer();
    fireEvent.click(trigger(first.container));
    expect(getComposerOverlay()).toBe("menu");

    first.unmount();
    expect(getComposerOverlay()).toBe(null);

    const again = renderComposer();
    expect(panelOpen(again.container)).toBe(false);
    expect(trigger(again.container).getAttribute("aria-expanded")).toBe("false");
  });

  it("…and the SUGGEST popover's, which would otherwise strand an owner nobody can see", () => {
    const { container, unmount } = renderComposer();
    fireEvent.change(container.querySelector<HTMLTextAreaElement>("#cmd-input")!, {
      target: { value: "/c" },
    });
    expect(getComposerOverlay()).toBe("suggest");
    unmount();
    expect(getComposerOverlay()).toBe(null);
  });
});

// ── D70 §8.4 — the picker's agent AVATARS. Additive: the tick keeps the selection gutter (that is what
// lines the names up) and the picture leads the name, so a row for an agent with no avatar is the row
// this panel has always drawn.
describe("tools menu — agent avatars (D70 §8.4)", () => {
  it("shows the avatar only on the row whose agent binds one, and keeps the rest unchanged", async () => {
    const { container } = renderComposer();
    fireEvent.click(trigger(container));
    // the two queries behind the resolver (roster + media index) settle asynchronously
    await waitFor(() => expect(container.querySelectorAll("img.tools-face").length).toBe(1));
    const rows = radios(container);
    expect(rows.map(rowName)).toEqual(["default", "ops", "research"]); // the list itself is untouched
    const withFace = rows.filter((r) => r.closest("label")?.querySelector("img.tools-face"));
    expect(withFace.map(rowName)).toEqual(["ops"]);
    const face = container.querySelector<HTMLImageElement>("img.tools-face")!;
    expect(face.getAttribute("src")).toBe("/api/media/agents/files/avatars/ops.png?rev=r1");
    // the tick is still there beside it — the avatar never displaces the selection gutter
    expect(withFace[0].closest("label")?.querySelector(".tools-tick")).not.toBe(null);
  });
});
