import { act, cleanup, render } from "@testing-library/react";
import { createElement, type ChangeEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/composer — `runComposer` is the input chokepoint: it routes the raw composer text by its leading
// sigil (`!`→shell · `/`→slash verbs · else→agent) and jumps to the Agent tab. We mock the chat + ui
// store actions and assert the dispatch; the privilege helper stays real (it validates the level).
// `fillComposer` is the tweak-then-run injector; its store/composer draft store stays REAL (that's the
// regression under test: SYS-13 — the write must reach the store `send()` reads, not just the DOM).

vi.mock("../../src/store/chat", () => ({
  sendMessage: vi.fn(),
  runShell: vi.fn(),
  compactThread: vi.fn(),
  startNewThread: vi.fn(),
  setSessionMode: vi.fn(),
  setSessionAgent: vi.fn(),
  setSessionPrivilege: vi.fn(),
  pushSystemNote: vi.fn(),
}));
vi.mock("../../src/store/ui", () => ({ setUI: vi.fn() }));

import { fillComposer, loadProviders, loadSkills, runComposer } from "../../src/lib/composer";
import * as chat from "../../src/store/chat";
import { clearDraft, getDraft, setDraft, useDraft } from "../../src/store/composer";
import { setUI } from "../../src/store/ui";

// loadSkills/loadAgents fire a best-effort fetch on import; make it a quiet no-op so nothing hits the
// network during routing tests (the routes under test don't depend on the loaded sets).
beforeEach(() => {
  globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false } as Response));
});

describe("runComposer routing", () => {
  it("`!cmd` runs the guarded shell", () => {
    runComposer("!ls -la");
    expect(chat.runShell).toHaveBeenCalledWith("ls -la");
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });

  it("plain text goes to the agent", () => {
    runComposer("wake the vault");
    // D41 — the RAW composer line rides along so a queued steer restores the exact text on Stop.
    expect(chat.sendMessage).toHaveBeenCalledWith("wake the vault", { raw: "wake the vault" });
  });

  it("every route jumps to the Agent tab", () => {
    runComposer("hello");
    expect(setUI).toHaveBeenCalledWith({ tab: "agent" });
  });

  it("empty input is a no-op (no tab switch, no dispatch)", () => {
    runComposer("   ");
    expect(setUI).not.toHaveBeenCalled();
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });

  // A11/D48 C7 — `/local` //`/cloud` are RETIRED; a verb per configured provider (from GET
  // /api/providers `verbs`) forces the inference backend. `loadProviders` populates the known set.
  const loadVerbs = async (verbs: string[]) => {
    globalThis.fetch = vi.fn((url: RequestInfo | URL) =>
      String(url).includes("/api/providers")
        ? Promise.resolve({ ok: true, json: () => Promise.resolve({ verbs }) } as Response)
        : Promise.resolve({ ok: false } as Response),
    );
    await loadProviders();
  };

  it("`/<provider> <msg>` forces that provider for one message", async () => {
    await loadVerbs(["llamacpp", "openrouter"]);
    runComposer("/llamacpp ping");
    // D41 — the RAW `/llamacpp ping` line rides along (with its prefix) for a Stop-harvest restore.
    expect(chat.sendMessage).toHaveBeenCalledWith("ping", {
      mode: "llamacpp",
      raw: "/llamacpp ping",
    });
  });

  it("bare `/<provider>` sets the sticky session mode", async () => {
    await loadVerbs(["llamacpp", "openrouter"]);
    runComposer("/openrouter");
    expect(chat.setSessionMode).toHaveBeenCalledWith("openrouter");
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });

  it("precedence: a skill shadows a provider of the same name (built-ins > skills > providers)", async () => {
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/api/skills"))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ name: "deploy" }]),
        } as Response);
      if (u.includes("/api/providers"))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ verbs: ["deploy"] }),
        } as Response);
      return Promise.resolve({ ok: false } as Response);
    });
    await loadSkills();
    await loadProviders();
    runComposer("/deploy do it");
    // The skill wins → an explicit-skill send, NOT a provider mode switch.
    expect(chat.sendMessage).toHaveBeenCalledWith("do it", {
      skills: ["deploy"],
      raw: "/deploy do it",
    });
    expect(chat.setSessionMode).not.toHaveBeenCalled();
  });

  it("`/clear` and `/compact` map to their thread actions", () => {
    runComposer("/clear");
    expect(chat.startNewThread).toHaveBeenCalled();
    // bare `/compact` → no steer (null instructions), D42.
    runComposer("/compact");
    expect(chat.compactThread).toHaveBeenCalledWith(null);
  });

  it("`/compact <text>` threads everything after the verb as the summarizer steer (D42)", () => {
    runComposer("/compact focus on the deploy steps");
    expect(chat.compactThread).toHaveBeenCalledWith("focus on the deploy steps");
  });

  it("`/privilege <level>` sets a valid level and rejects an invalid one", () => {
    runComposer("/privilege full");
    expect(chat.setSessionPrivilege).toHaveBeenCalledWith("full");

    runComposer("/privilege bogus");
    expect(chat.setSessionPrivilege).toHaveBeenCalledTimes(1); // not called again for the bad level
    expect(chat.pushSystemNote).toHaveBeenCalledWith(expect.stringContaining("unknown level"));
  });

  it("an unknown slash verb gets a note, not the agent", () => {
    runComposer("/definitelynotacommand");
    expect(chat.pushSystemNote).toHaveBeenCalledWith(expect.stringContaining("unknown command"));
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });

  // v1.3.1 (Codex review) — the loaders are fired from several places (module import, CRUD
  // invalidations, settings saves), so two can be in flight at once. The generation guard keeps the
  // NEWEST-STARTED response authoritative; without it the slower earlier response lands last and
  // reinstates the stale verb set. Same three-line guard in loadSkills/loadAgents.
  it("out-of-order loader responses: the newest-STARTED load owns the set", async () => {
    let landStale!: (r: Response) => void;
    const stale = new Promise<Response>((resolve) => (landStale = resolve));
    globalThis.fetch = vi.fn(() => stale);
    const first = loadProviders(); // starts, then hangs on the network
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ verbs: ["fresh"] }) } as Response),
    );
    await loadProviders(); // starts later, resolves first → installs ["fresh"]
    landStale({ ok: true, json: () => Promise.resolve({ verbs: ["stale"] }) } as Response);
    await first; // …and now the older response lands, and must NOT overwrite

    runComposer("/fresh");
    expect(chat.setSessionMode).toHaveBeenCalledWith("fresh");
    runComposer("/stale");
    expect(chat.setSessionMode).toHaveBeenCalledTimes(1); // the stale verb never became known
    expect(chat.pushSystemNote).toHaveBeenCalledWith(expect.stringContaining("unknown command"));
  });
});

// A minimal controlled textarea bound to the draft store EXACTLY like both real composers
// (value={useDraft()} + onChange→setDraft + id="cmd-input"). Rendering the real Composer would drag in
// react-query/dictation providers; the store binding is the only surface SYS-13 depends on.
const Harness = () =>
  createElement("textarea", {
    id: "cmd-input",
    value: useDraft(),
    onChange: (e: ChangeEvent<HTMLTextAreaElement>) => setDraft(e.target.value),
  });

describe("fillComposer (SYS-13 regression)", () => {
  beforeEach(() => {
    clearDraft();
    localStorage.clear();
  });
  afterEach(cleanup); // globals:false → register RTL cleanup explicitly

  it("writes through to the store draft that send() reads (not just the DOM)", () => {
    const { container } = render(createElement(Harness));
    act(() => fillComposer("wake --force the-vault"));

    // The store is the source of truth for send() — this is the assertion the old (routing-only) suite
    // lacked, so the swallowed-synthetic-event bug survived.
    expect(getDraft()).toBe("wake --force the-vault");
    // …and the controlled textarea reflects it after the store-driven re-render.
    const ta = container.querySelector<HTMLTextAreaElement>("#cmd-input")!;
    expect(ta.value).toBe("wake --force the-vault");
  });

  it("focuses the composer textarea when present", () => {
    const { container } = render(createElement(Harness));
    act(() => fillComposer("echo hi"));
    expect(document.activeElement).toBe(container.querySelector("#cmd-input"));
  });

  it("updates the store even when no textarea is mounted (no crash)", () => {
    // Composer is conditionally rendered (Conf/Utils tabs unmount it). Injecting while it's absent must
    // still populate the draft — the new, better behavior vs the old DOM-only write that silently no-op'd.
    expect(() => fillComposer("still lands")).not.toThrow();
    expect(getDraft()).toBe("still lands");
  });
});
