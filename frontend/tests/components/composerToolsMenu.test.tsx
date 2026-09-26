import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadAgents, loadSkills } from "../../src/lib/composer";
import {
  openThread,
  setStickyAgent,
  startNewThread,
  useChat,
  useStickyAgent,
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
// contract, the two lifetimes the rows write (the agent = the STICKY pin, the D75 ruling of
// 2026-09-24; the skills = a one-shot for the next message), and the shared overlay slot (opening the menu
// closes the plan sheet). The store mechanics live in tests/store/composerSkills|composerOverlay.test.ts.

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
  clearComposerSkills();
  setStickyAgent(null);
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
/** Read-only probes on the REAL stores the rows write: the sticky pin, the chat's last line (the
 *  `// agent → …` note the seam pushes), and the ticked skills. */
function probes() {
  const pin = renderHook(() => useStickyAgent());
  const chat = renderHook(() => useChat());
  const skills = renderHook(() => useComposerSkills());
  return {
    pin: () => pin.result.current,
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

// THE AGENT SECTION IS A STICKY SWITCH (D75 ruling, 2026-09-24): a row is `/agent <name>` by another hand
// — it writes the sticky pin through the one seam (`pinStickyAgent`), pushes the same note, and holds
// until switched again. Nothing about it is pending, so it never lights the trigger's dot.
describe("tools menu — the agent switch (sticky)", () => {
  it("picking a row PINS the sticky agent and pushes the `/agent` note — no dot, nothing pending", async () => {
    const p = probes();
    const { container } = renderComposer();
    await openMenu(container);
    fireEvent.click(radios(container)[1]); // "ops"
    expect(p.pin()).toBe("ops");
    expect(p.lastNote()).toBe("// agent → ops");
    expect(checkedRows(container)).toEqual(["ops"]);
    expect(trigger(container).querySelector(".tools-dot")).toBe(null);
    expect(container.querySelector(".tools-clear")).toBe(null); // the clear row is the skills' alone
  });

  it("the DEFAULT row CLEARS the pin in an unpinned thread, and reads checked", async () => {
    setStickyAgent("ops");
    const p = probes();
    const { container } = renderComposer();
    await openMenu(container);
    expect(checkedRows(container)).toEqual(["ops"]);
    fireEvent.click(radios(container)[0]); // the "default" row
    expect(p.pin()).toBe(null); // a CLEAR, exactly bare `/agent`
    expect(p.lastNote()).toBe("// agent → default (default)");
    expect(checkedRows(container)).toEqual(["default"]);
  });

  it("the default's NAME as the pin reads as the default row too (the thread-pinned representation)", async () => {
    setStickyAgent("default");
    const { container } = renderComposer();
    await openMenu(container);
    expect(checkedRows(container)).toEqual(["default"]);
  });

  it("the checked row follows the pin REACTIVELY — a `/agent` made elsewhere repaints the open panel", async () => {
    const { container } = renderComposer();
    await openMenu(container);
    expect(checkedRows(container)).toEqual(["default"]);
    act(() => setStickyAgent("research")); // `/agent research`, the gallery's Talk — any other hand
    expect(checkedRows(container)).toEqual(["research"]);
    act(() => setStickyAgent(null));
    expect(checkedRows(container)).toEqual(["default"]);
  });

  // Codex, verify round — `/agent typo` stays sticky ON PURPOSE (the backend falls back to the default and
  // routeSlash already warned), but "typo" matches no row: reflecting it verbatim left EVERY radio
  // unchecked, i.e. the panel claiming the next message goes nowhere. The default row is where it goes.
  it("a sticky agent that isn't configured reads as the DEFAULT row, not an empty group", async () => {
    setStickyAgent("typo");
    const p = probes();
    const { container } = renderComposer();
    await openMenu(container);
    expect(checkedRows(container)).toEqual(["default"]);
    expect(p.pin()).toBe("typo"); // the DISPLAY fold never touches the pin the send path reads
  });

  // The sticky slice's review round (2026-09-24): the rows, the default row's NAME and the checked row all
  // come from the ROSTER QUERY — the list the backdrop paints by — and never from the composer's
  // module-level `/agent` set. That Set is filled once at import and kept as-is on a failed load, so a
  // menu drawn from it after a failed first load (the PWA opening from its shell before Tailscale is up)
  // listed no agent and checked "default" while the backdrop, drawn from the retrying query, painted the
  // pinned character. Here the module set holds the harness's `ops`/`research`; the query is served a
  // DIFFERENT roster, and the menu shows the query's.
  it("draws its rows from the ROSTER QUERY, not the composer's module-level `/agent` set", async () => {
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
    setStickyAgent("lynette"); // unknown to the module set — the query knows her
    const { container } = renderComposer();
    await openMenu(container, 3); // the root + "ari" + "lynette" — the query's roster, not the set's
    expect(radios(container).map(rowName)).toEqual(["default", "ari", "lynette"]);
    expect(checkedRows(container)).toEqual(["lynette"]); // …so the fold checks HER row, not the default's
  });

  // D75 amendment code round (Opus MED): the ROOT is never in the roster's `agents`, so when a specialist
  // is the RESOLVED default the old rows drew that specialist twice (as the "default" row and in the list)
  // and the root not at all. Now: the root row first, each specialist once, the resolved default's row
  // tagged — and the root is pinnable BY NAME (the same expression the gallery's Talk takes), which the
  // fold keeps (`validStickyAgent`: the root's slug is always valid) so its row reads checked.
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
    expect(checkedRows(container)).toEqual(["lynette"]); // nothing pinned → the resolved default
    fireEvent.click(radios(container)[0]); // the ROOT row
    expect(p.pin()).toBe("default"); // pinned by name…
    expect(checkedRows(container)).toEqual(["default"]); // …and NOT folded back to lynette
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
    setStickyAgent("ops");
    const p = probes();
    const { container } = renderComposer();
    fireEvent.click(trigger(container));
    expect(container.querySelector(".tools-clear")).toBe(null);
    fireEvent.click(
      container.querySelectorAll<HTMLButtonElement>("#composer-tools [role=checkbox]")[1],
    );
    fireEvent.click(container.querySelector<HTMLButtonElement>(".tools-clear")!);
    expect(p.skills()).toEqual([]);
    expect(p.pin()).toBe("ops"); // the standing switch is not the clear row's business
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

// ── the OPEN THREAD's pin (wave 1c + its review's F2). The group has to name the agent the next message
// will ACTUALLY run as, and since 1c that ladder has a second rung: the sticky `/agent` pick, else the
// thread's own D11 pin. The pin arrives from `openThread`'s LATE list read — which can land while this
// panel is up, so the read is subscribed rather than snapshotted.
describe("tools menu — the open thread's pinned agent", () => {
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
      if (u.includes("/api/threads")) {
        await parked; // the pin read, held open
        return body([
          { id: "t1", title: null, agent, created_at: "", updated_at: "", archived: false },
        ]);
      }
      return base(url, init);
    });
    return release;
  }

  afterEach(() => startNewThread({ keepAgent: false })); // the pin is store state — every arm starts with none

  it("checks the THREAD's agent, and follows a pin that lands while the panel is OPEN", async () => {
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

  // The default row's second representation: inside a thread pinned to `ops`, a CLEAR would let `ops`
  // resurface (the server's ladder: the sticky pick, else the thread's), so the row pins the default BY
  // NAME — which outranks the thread's pin — and reads checked from that name.
  it("in a thread-PINNED conversation the default row pins the default BY NAME, and reads checked", async () => {
    const release = serveThread("ops");
    release();
    const p = probes();
    await act(async () => {
      await openThread("t1");
    });
    const { container } = renderComposer();
    fireEvent.click(trigger(container));
    await waitFor(() => expect(checkedRows(container)).toEqual(["ops"])); // the thread's pin answers
    fireEvent.click(radios(container)[0]); // the "default" row
    expect(p.pin()).toBe("default"); // a PIN at the default's name, not a clear
    expect(p.lastNote()).toBe("// agent → default (default)");
    expect(checkedRows(container)).toEqual(["default"]);
  });
});
