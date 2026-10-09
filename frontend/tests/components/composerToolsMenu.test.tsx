import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadAgents, loadSkills } from "../../src/lib/composer";
import {
  openThread,
  resetToThreadless,
  setResponder,
  useChat,
  useResponder,
  useThreadAgent,
} from "../../src/store/chat";
import { getComposerOverlay, setComposerOverlay } from "../../src/store/composerOverlay";
import { clearComposerSkills, useComposerSkills } from "../../src/store/composerSkills";
import { clearDraft } from "../../src/store/composer";
import { setPlanSheetOpen, usePlanSheetOpen } from "../../src/store/planSheet";
import { mergeComposerSlots } from "../../src/theme-engine/kit/composer/mergeSlots";
import { KitComposer } from "../../src/theme-engine/kit/composer/Composer";
import { kitToolsMenuSlots } from "../../src/theme-engine/kit/composer/toolsMenu";

// A6 — the composer tools/skills MENU, driven through a REAL Kit composer with the addon composed in the
// way DefaultRoot composes it (mergeComposerSlots → the variant's slots). Covers the trigger↔panel aria
// contract, the two sections (the agents = the ROSTER DOOR, D84 R16/R38/O4 — a row opens that agent's
// conversation and the CHECKED row is the open conversation's home; the skills = a one-shot for the next
// message), and the shared overlay slot (opening the menu closes the plan sheet). The store mechanics live in tests/store/composerSkills|composerOverlay.test.ts.

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
/** Every agent a roster door READ (`GET /api/threads?agent=<name>`), in order — what a pick opened. */
const doors: string[] = [];

beforeEach(async () => {
  clearDraft();
  clearComposerSkills();
  resetToThreadless(); // an empty, thread-less chat — no home but the default's, no responder
  setComposerOverlay(null);
  localStorage.clear();
  doors.length = 0;
  globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
    const u = String(url);
    // THE ROSTER DOOR's read (`openAgentConversation`): every agent has ONE conversation, `t-<name>`.
    if (u.startsWith("/api/threads?agent=")) {
      const name = decodeURIComponent(u.slice("/api/threads?agent=".length).split("&")[0]);
      doors.push(name);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve([{ id: `t-${name}`, agent: name }]),
      } as Response);
    }
    if (u.startsWith("/api/threads/") && u.endsWith("/messages"))
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response);
    if (u.includes("/api/agent/turns/"))
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ active: false }),
      } as Response);
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
const checkedRows = (c: HTMLElement) =>
  radios(c)
    .filter((r) => r.checked)
    .map(rowName);
/** Open the panel and wait for the agent rows: they come from the ROSTER QUERY (`useAgentRoster`, the
 *  list the backdrop paints by — the sticky slice's review round), which lands after the first paint; the
 *  default row alone is drawn until it does. `n` = the rows expected, default row included. */
async function openMenu(c: HTMLElement, n = 3): Promise<void> {
  fireEvent.click(trigger(c));
  await waitFor(() => expect(radios(c).length).toBe(n));
}
/** Read-only probes on the REAL stores: the open conversation's HOME and the RESPONDER (what a door and
 *  `/agent` write), the chat's last line, and the ticked skills. */
function probes() {
  const home = renderHook(() => useThreadAgent());
  const responder = renderHook(() => useResponder());
  const chat = renderHook(() => useChat());
  const skills = renderHook(() => useComposerSkills());
  return {
    home: () => home.result.current,
    responder: () => responder.result.current,
    threadId: () => chat.result.current.threadId,
    lastNote: () => {
      const part = chat.result.current.messages.at(-1)?.parts[0];
      return part?.type === "text" ? part.text : undefined;
    },
    skills: () => skills.result.current,
  };
}

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
    expect(panel(container).getAttribute("aria-label")).toBe(
      "active agent, and skills for the next message",
    );

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

  it("lists the configured agents as ONE native radio group (plus a default row), skills as checkboxes", async () => {
    const { container } = renderComposer();
    await openMenu(container);
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

// THE AGENT SECTION IS THE ROSTER DOOR (D84 §2 R16, R38, O4): every activation of a row — the checked one
// included — opens that agent's LATEST conversation (or mints it one); the CHECKED row is the open
// conversation's HOME, never the responder `/agent` set. Nothing is pending, so it never lights the dot.
describe("tools menu — the agent rows (the roster door)", () => {
  it("picking a row OPENS that agent's latest conversation; the checked row follows the HOME", async () => {
    const p = probes();
    const { container } = renderComposer();
    await openMenu(container);
    fireEvent.click(radios(container)[1]); // "ops"
    expect(doors).toEqual(["ops"]);
    await waitFor(() => expect(p.threadId()).toBe("t-ops"));
    expect(p.home()).toBe("ops");
    await openMenu(container);
    expect(checkedRows(container)).toEqual(["ops"]);
    expect(p.lastNote()).toBe(undefined); // navigation prints no note — the view visibly changes
    expect(trigger(container).querySelector(".tools-dot")).toBe(null);
    expect(container.querySelector(".tools-clear")).toBe(null); // the clear row is the skills' alone
  });

  it("the CHECKED row is the HOME, never the responder (R38)", async () => {
    const p = probes();
    await act(async () => {
      await openThread("t-ops", "ops");
    });
    act(() => setResponder("research")); // `/agent research` — Research answers in Ops's conversation
    expect(p.responder()).toBe("research");
    const { container } = renderComposer();
    await openMenu(container);
    expect(checkedRows(container)).toEqual(["ops"]);
  });

  it("the already-checked row is a door too: on the home's own latest it clears the responder IN PLACE (B5)", async () => {
    const p = probes();
    await act(async () => {
      await openThread("t-ops", "ops");
    });
    act(() => setResponder("research"));
    const { container } = renderComposer();
    await openMenu(container);
    fireEvent.click(radios(container)[1]); // "ops" — already checked
    await waitFor(() => expect(p.responder()).toBe(null)); // back to the rule
    expect(p.threadId()).toBe("t-ops"); // nothing reloaded
    expect(doors).toEqual(["ops"]);
  });

  it("each row's radio says what activation does — `open <Name>'s conversation` (the display name)", async () => {
    const { container } = renderComposer();
    await openMenu(container);
    expect(radios(container).map((r) => r.getAttribute("aria-description"))).toEqual([
      "open default's conversation",
      "open Ops Bot's conversation",
      "open research's conversation",
    ]);
  });

  it("the checked row follows the HOME REACTIVELY — a door used elsewhere repaints the open panel", async () => {
    const { container } = renderComposer();
    await openMenu(container);
    expect(checkedRows(container)).toEqual(["default"]); // thread-less: the home-to-be is the default
    await act(async () => {
      await openThread("t-research", "research"); // a sheet row, the gallery's Talk — any other door
    });
    expect(checkedRows(container)).toEqual(["research"]);
  });

  // ISS-51's paint (§12.1 ①): a home the landed roster no longer holds reads as the configured default —
  // never an empty group (the panel claiming the conversation belongs to nobody).
  it("a home that isn't on the roster reads as the DEFAULT row, not an empty group", async () => {
    await act(async () => {
      await openThread("t-typo", "typo");
    });
    // ISOLATE the paint fold (F5): the landing's M7 sweep would move this view to the default's own
    // conversation — fail its roster read, so the view STAYS on `typo`'s and only the fold can check.
    const base = globalThis.fetch;
    globalThis.fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) =>
      String(url).startsWith("/api/threads?agent=")
        ? Promise.reject(new Error("down"))
        : base(url, init),
    );
    const p = probes();
    const { container } = renderComposer();
    await openMenu(container);
    await waitFor(() => expect(checkedRows(container)).toEqual(["default"]));
    expect(p.threadId()).toBe("t-typo"); // the view never moved — the fold alone checked the row
    expect(p.home()).toBe("typo");
  });

  // The sticky slice's review round (2026-09-24): the rows, the default row's NAME and the checked row all
  // come from the ROSTER QUERY — the list the backdrop paints by — and never from routing's module copy.
  // Here the module copy holds the harness's `ops`/`research`; the query is served a DIFFERENT roster, and
  // the menu shows the query's.
  it("draws its rows from the ROSTER QUERY, not routing's module copy", async () => {
    const base = globalThis.fetch;
    globalThis.fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("/api/agents") && !String(url).includes("/api/media/"))
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ agents: ["ari", "lynette"], default: "ari", summaries: {} }),
        } as Response);
      return base(url, init);
    });
    await act(async () => {
      await openThread("t-lynette", "lynette");
    });
    const { container } = renderComposer();
    await openMenu(container, 3); // the root + "ari" + "lynette" — the query's roster
    expect(radios(container).map(rowName)).toEqual(["default", "ari", "lynette"]);
    expect(checkedRows(container)).toEqual(["lynette"]); // …so the fold checks HER row
  });

  // D75 amendment code round (Opus MED): the ROOT is never in the roster's `agents`, so it has its own row,
  // each specialist appears once, and the resolved default's row is tagged.
  it("a specialist as the resolved default: the root has its own row, the specialist is tagged, no duplicate", async () => {
    const base = globalThis.fetch;
    globalThis.fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (String(url).includes("/api/agents") && !String(url).includes("/api/media/"))
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ agents: ["lynette", "ops"], default: "lynette", summaries: {} }),
        } as Response);
      return base(url, init);
    });
    const p = probes();
    const { container } = renderComposer();
    await openMenu(container, 3);
    expect(radios(container).map(rowName)).toEqual(["default", "lynette", "ops"]);
    const tagOf = (r: HTMLInputElement) =>
      r.closest("label")?.querySelector(".tools-tag")?.textContent ?? null;
    // the root row reads "root" when it is not the default — never a second "default" (confirm round)
    expect(radios(container).map(tagOf)).toEqual(["root", "default", null]);
    expect(checkedRows(container)).toEqual(["lynette"]); // thread-less → the configured default's row
    fireEvent.click(radios(container)[0]); // the ROOT row — the root's own conversation
    await waitFor(() => expect(p.home()).toBe("default"));
    await openMenu(container, 3);
    expect(checkedRows(container)).toEqual(["default"]); // …and NOT folded back to lynette
  });
});

// THE CLOSE RULES (owner, 2026-10-01): picking an AGENT closes the panel (you picked who to talk to);
// ticking a SKILL keeps it open (several ride one message); a pointer going down OUTSIDE closes it (light
// dismiss) — the trigger excepted, whose own click is the toggle.
describe("tools menu — closing", () => {
  it("an agent pick CLOSES the panel and hands focus back to the trigger", async () => {
    const { container } = renderComposer();
    await openMenu(container);
    radios(container)[1].focus(); // where a keyboard pick or the label's activation leaves it
    fireEvent.click(radios(container)[1]); // "ops"
    expect(doors).toEqual(["ops"]); // the door still opens…
    expect(panelOpen(container)).toBe(false); // …and the panel closes
    expect(document.activeElement).toBe(trigger(container)); // not stranded in the inert panel
  });

  it("tapping the ALREADY-checked row closes it too — 'this one, let's talk'", async () => {
    const { container } = renderComposer();
    await openMenu(container);
    fireEvent.click(radios(container)[0]); // "default", already checked: no change, still a pick
    expect(doors).toEqual(["default"]); // the checked row is a door like any other (O4)
    expect(panelOpen(container)).toBe(false);
  });

  it("ticking a skill keeps it open", async () => {
    const { container } = renderComposer();
    await openMenu(container);
    fireEvent.click(container.querySelector<HTMLElement>("#composer-tools [role=checkbox]")!);
    expect(panelOpen(container)).toBe(true);
  });

  it("arrow-key browsing does not close it; the key's release re-arms the pick", async () => {
    const { container } = renderComposer();
    await openMenu(container);
    const group = container.querySelector<HTMLElement>("#composer-tools [role=radiogroup]")!;
    // the browser's arrow navigation: keydown → a simulated click on the newly checked radio → keyup
    fireEvent.keyDown(group, { key: "ArrowDown" });
    fireEvent.click(radios(container)[1]);
    fireEvent.keyUp(group, { key: "ArrowDown" });
    expect(doors).toEqual([]); // browsing opens nothing…
    expect(panelOpen(container)).toBe(true); // …and does not close
    // an arrow that moved nothing (no click) can't leave the guard up: the next Space pick closes
    fireEvent.keyDown(group, { key: "ArrowUp" });
    fireEvent.keyUp(group, { key: "ArrowUp" });
    fireEvent.click(radios(container)[1]); // Space on the checked row
    expect(panelOpen(container)).toBe(false);
  });

  it("an arrow whose keyup lands ELSEWHERE can't swallow the next pick's close", async () => {
    const { container } = renderComposer();
    await openMenu(container);
    const group = container.querySelector<HTMLElement>("#composer-tools [role=radiogroup]")!;
    // the guard is spent by the click it guards — the keyup went to a confirm dialog, never to the group
    fireEvent.keyDown(group, { key: "ArrowDown" });
    fireEvent.click(radios(container)[1]);
    expect(panelOpen(container)).toBe(true);
    fireEvent.click(radios(container)[1]); // the next tap is a pick
    expect(panelOpen(container)).toBe(false);
    // …and an arrow that moved nothing, its keyup lost: a pointer going down on the group re-arms the pick
    await openMenu(container);
    fireEvent.keyDown(group, { key: "ArrowUp" });
    fireEvent.pointerDown(radios(container)[0].closest("label")!);
    fireEvent.click(radios(container)[0]);
    expect(panelOpen(container)).toBe(false);
    // …and one left up when an outside tap closed the panel mid-keypress: opening it again re-arms a
    // KEYBOARD pick too (a Space activation has no pointerdown to clear it)
    await openMenu(container);
    fireEvent.keyDown(group, { key: "ArrowUp" });
    fireEvent.pointerDown(container.querySelector("#composer textarea")!);
    expect(panelOpen(container)).toBe(false);
    await openMenu(container);
    fireEvent.click(radios(container)[0]); // Space
    expect(panelOpen(container)).toBe(false);
  });

  it("a pointerdown OUTSIDE closes it; inside the panel it doesn't", async () => {
    const { container } = renderComposer();
    await openMenu(container);
    fireEvent.pointerDown(panel(container).querySelector(".tools-lbl")!);
    expect(panelOpen(container)).toBe(true);
    fireEvent.pointerDown(container.querySelector("#composer textarea")!);
    expect(panelOpen(container)).toBe(false);
  });

  it("the TRIGGER still toggles — its pointerdown is not an outside tap that its click would undo", async () => {
    const { container } = renderComposer();
    await openMenu(container);
    fireEvent.pointerDown(trigger(container));
    fireEvent.click(trigger(container));
    expect(panelOpen(container)).toBe(false); // closed by the toggle, not re-opened
    fireEvent.pointerDown(trigger(container));
    fireEvent.click(trigger(container));
    expect(panelOpen(container)).toBe(true);
  });
});

// THE SKILLS SECTION STAYS A ONE-SHOT: ticked for the next message, spent on dispatch — and it is the only
// thing the trigger's dot, its label and the clear row speak for.
describe("tools menu — the skills one-shot", () => {
  it("ticking a skill lights the dot and names it in the trigger's label", () => {
    const p = probes();
    const { container } = renderComposer();
    fireEvent.click(trigger(container));
    const btn = trigger(container);
    expect(btn.getAttribute("aria-label")).toBe("choose the agent, or skills for the next message");
    fireEvent.click(
      container.querySelectorAll<HTMLButtonElement>("#composer-tools [role=checkbox]")[0],
    );
    expect(p.skills()).toEqual(["deploy"]);
    expect(btn.querySelector(".tools-dot")).not.toBe(null); // readable with the panel shut
    expect(btn.getAttribute("aria-label")).toBe("next message: skills deploy — tap to change");
  });

  it("the clear row appears only with a skill ticked, and drops the skills — never the agent", () => {
    act(() => setResponder("ops"));
    const p = probes();
    const { container } = renderComposer();
    fireEvent.click(trigger(container));
    expect(container.querySelector(".tools-clear")).toBe(null);
    fireEvent.click(
      container.querySelectorAll<HTMLButtonElement>("#composer-tools [role=checkbox]")[1],
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>(".tools-clear")!);
    expect(p.skills()).toEqual([]);
    expect(p.responder()).toBe("ops"); // who answers is not the clear row's business
    expect(trigger(container).querySelector(".tools-dot")).toBe(null);
    expect(container.querySelector(".tools-clear")).toBe(null);
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
    await waitFor(() => expect(container.querySelectorAll(".tools-face").length).toBe(1));
    const rows = radios(container);
    expect(rows.map(rowName)).toEqual(["default", "ops", "research"]); // the list itself is untouched
    const withFace = rows.filter((r) => r.closest("label")?.querySelector(".tools-face"));
    expect(withFace.map(rowName)).toEqual(["ops"]);
    // WAVE 3 — the same CIRCLE window the who-line paints, so the same painted box: one element
    // carrying the disc and the picture, framed with no measurement (`components/FocalFace.tsx`).
    const face = container.querySelector<HTMLElement>(".tools-face")!;
    expect(face.tagName).toBe("SPAN");
    expect(face.style.backgroundImage).toBe(
      'url("/api/media/agents/files/avatars/ops.png?rev=r1")',
    );
    // the tick is still there beside it — the avatar never displaces the selection gutter
    expect(withFace[0].closest("label")?.querySelector(".tools-tick")).not.toBe(null);
  });
});

// ── the OPEN conversation's HOME (wave 1c + its review's F2; D84 R38). The group checks the conversation
// the owner is in, and a door that knew nothing learns the home from `openThread`'s LATE list read —
// which can land while this panel is up, so the read is subscribed rather than snapshotted.
describe("tools menu — the open conversation's home", () => {
  /** The composer harness's stub plus the two routes an open touches; the LIST is deferrable, which is
   *  the whole point (the pin deliberately does not gate the history swap). */
  function serveThread(agent: string) {
    let release!: () => void;
    const parked = new Promise<void>((r) => (release = r));
    const base = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const body = (v: unknown) => ({ ok: true, status: 200, json: async () => v }) as Response;
      if (u.endsWith("/messages")) return body([]);
      if (u.includes("/api/agent/turns/")) return body({ active: false });
      if (u.includes("/api/threads?include_archived")) {
        await parked; // the pin read, held open
        return body([
          { id: "t1", title: null, agent, created_at: "", updated_at: "", archived: false },
        ]);
      }
      return base(url, init);
    });
    return release;
  }

  afterEach(() => resetToThreadless()); // the pin is store state — every arm starts with none

  it("checks the conversation's HOME, and follows one that lands while the panel is OPEN", async () => {
    const release = serveThread("ops");
    const { container } = renderComposer();
    fireEvent.click(trigger(container));
    // SETTLE THE SHEET'S OWN ASYNC WORK FIRST, and this step is load-bearing (the review's confirm round
    // caught the arm without it as a FALSE POSITIVE — it passed on the snapshot code too). The sheet
    // mounts the agent-art resolver, whose roster + media queries land AFTER the first paint: that
    // rerender re-runs the body, a SNAPSHOT read of the thread pin picks the new value up on the way
    // past, and the arm goes green without any subscription existing. Waiting for the avatar — the one
    // DOM effect of both queries having resolved — spends that rerender before the pin is released, so
    // the subscription is the only path left that can move the checked row.
    await waitFor(() => expect(container.querySelectorAll(".tools-face").length).toBe(1));
    await act(async () => {
      await openThread("t1"); // history swaps in; the pin read is still parked
    });
    // The window the F2 finding is about: the panel is up, the thread is pinned, the pin has not landed.
    expect(radios(container).find((r) => r.checked)).toBe(radios(container)[0]); // "default"
    await act(async () => {
      release();
      await Promise.resolve();
    });
    // …and when it lands, the group follows WITHOUT being reopened — nothing else rerenders it now.
    await waitFor(() => expect(rowName(radios(container).find((r) => r.checked)!)).toBe("ops"));
  });

  it("the default row in a conversation homed elsewhere is a DOOR to the default's own conversation", async () => {
    const release = serveThread("ops");
    release();
    const p = probes();
    await act(async () => {
      await openThread("t1"); // ops's conversation, the home learnt late
    });
    const { container } = renderComposer();
    fireEvent.click(trigger(container));
    await waitFor(() => expect(checkedRows(container)).toEqual(["ops"]));
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      const body = (v: unknown) => ({ ok: true, status: 200, json: async () => v }) as Response;
      if (u.startsWith("/api/threads?agent=")) return Promise.resolve(body([]));
      if (u === "/api/threads")
        return Promise.resolve(
          body({ id: "t-new", title: null, agent: "default", created_at: "", updated_at: "" }),
        );
      if (u.endsWith("/messages")) return Promise.resolve(body([]));
      return Promise.resolve(body({ active: false }));
    });
    fireEvent.click(radios(container)[0]); // the "default" row: no conversation yet → minted
    await waitFor(() => expect(p.threadId()).toBe("t-new"));
    expect(p.home()).toBe("default");
  });
});
