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

import {
  fillComposer,
  getCompletions,
  getKnownSkills,
  loadAgents,
  loadProviders,
  loadSkills,
  runComposer,
} from "../../src/lib/composer";
import { PRIVILEGE_LEVELS } from "../../src/lib/privilege";
import { addStaged, clearStaged, stagedIds } from "../../src/store/attachments";
import * as chat from "../../src/store/chat";
import { clearDraft, getDraft, setDraft, useDraft } from "../../src/store/composer";
import {
  clearComposerScope,
  getComposerScope,
  setScopeAgent,
  toggleScopeSkill,
} from "../../src/store/composerScope";
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

  it("`/priv` still routes as the `/privilege` alias (the built-in table's alias column)", () => {
    runComposer("/priv confirm");
    expect(chat.setSessionPrivilege).toHaveBeenCalledWith("confirm");
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

// D68 §7 — STAGED ATTACHMENTS are consumed in the natural-language branch and NOWHERE else. That one
// placement is what makes the mic pin hold by construction (`useDictation` calls `runComposer`
// directly, bypassing `useComposer().send`) and what keeps a file an argument to an agent MESSAGE
// rather than to a shell command.
describe("runComposer × staged attachments (D68 §7)", () => {
  const staged = (attachmentId: string) =>
    addStaged({
      localId: attachmentId,
      name: `${attachmentId}.png`,
      kind: "image",
      status: "staged",
      attachmentId,
    });

  beforeEach(() => clearStaged());
  afterEach(() => clearStaged());

  it("a plain NL send carries the staged ids", () => {
    staged("id-1");
    staged("id-2");
    runComposer("what is in these?");
    expect(chat.sendMessage).toHaveBeenCalledWith("what is in these?", {
      raw: "what is in these?",
      attachments: ["id-1", "id-2"],
    });
  });

  it("a send with NO staged files is byte-identical to its pre-D68 self", () => {
    runComposer("hello");
    expect(chat.sendMessage).toHaveBeenCalledWith("hello", { raw: "hello" }); // no `attachments` key
  });

  it("only what actually LANDED rides — an uploading or failed chip contributes nothing", () => {
    staged("id-1");
    addStaged({ localId: "b", name: "b.png", kind: "image", status: "uploading" });
    addStaged({ localId: "c", name: "c.png", kind: "image", status: "failed", error: "nope" });
    runComposer("look");
    expect(chat.sendMessage).toHaveBeenCalledWith("look", { raw: "look", attachments: ["id-1"] });
  });

  it("EMPTY text with a staged file is a real send (the attachment-only gesture)", () => {
    staged("id-1");
    runComposer("");
    expect(chat.sendMessage).toHaveBeenCalledWith("", { raw: "", attachments: ["id-1"] });
  });

  it("empty text with NOTHING staged is still a no-op", () => {
    runComposer("   ");
    expect(chat.sendMessage).not.toHaveBeenCalled();
    expect(setUI).not.toHaveBeenCalled();
  });

  it("RULED: `!shell` does not consume them — the files stay staged", () => {
    staged("id-1");
    runComposer("!ls");
    expect(chat.runShell).toHaveBeenCalledWith("ls");
    expect(chat.sendMessage).not.toHaveBeenCalled();
    expect(stagedIds()).toEqual(["id-1"]); // still there, rail unchanged
  });

  it("RULED: a `/verb` send does not consume them either", () => {
    staged("id-1");
    runComposer("/compact tidy up");
    expect(chat.compactThread).toHaveBeenCalled();
    expect(chat.sendMessage).not.toHaveBeenCalled();
    expect(stagedIds()).toEqual(["id-1"]);
  });
});

// A6 — the composer tools/skills MENU arms a ONE-SHOT scope for the NEXT message; `runComposer` is where it
// is applied or overridden. The pinned precedence rule: a plain NL send CARRIES the arming (and spends it);
// an EXPLICIT `/verb` send WINS over the menu — it spends the arming WITHOUT applying it.
describe("runComposer × the one-shot menu scope (A6)", () => {
  beforeEach(() => clearComposerScope());

  it("a plain NL send carries the armed agent + skills, then clears the arming", () => {
    setScopeAgent("ops");
    toggleScopeSkill("deploy");
    runComposer("wake the vault");
    expect(chat.sendMessage).toHaveBeenCalledWith("wake the vault", {
      raw: "wake the vault",
      agent: "ops",
      skills: ["deploy"],
    });
    expect(getComposerScope().agent).toBe(undefined); // spent by the message it rode
    expect(getComposerScope().skills).toEqual([]);
  });

  it("nothing armed → the call shape is exactly what it was before A6 (NO `agent` key)", () => {
    runComposer("wake the vault");
    expect(chat.sendMessage).toHaveBeenCalledWith("wake the vault", { raw: "wake the vault" });
    // the key's ABSENCE is the contract — `sendMessage` falls back to the sticky `/agent` on it
    expect("agent" in (vi.mocked(chat.sendMessage).mock.calls[0][1] ?? {})).toBe(false);
  });

  // Codex, round 2 — the tri-state's reason to exist: with a sticky `/agent ops` set, picking the menu's
  // "default" row must SAY so on the wire. `null` is a pick, not "nothing picked".
  it("an armed `null` (the menu's default row) is forwarded as an explicit `agent: null`", () => {
    setScopeAgent(null);
    runComposer("wake the vault");
    expect(chat.sendMessage).toHaveBeenCalledWith("wake the vault", {
      raw: "wake the vault",
      agent: null,
    });
    expect(getComposerScope().agent).toBe(undefined); // spent like any other arming
  });

  it("an explicit `/skill` send WINS: the arming is cleared, never merged", async () => {
    globalThis.fetch = vi.fn((url: RequestInfo | URL) =>
      String(url).includes("/api/skills")
        ? Promise.resolve({
            ok: true,
            json: () => Promise.resolve([{ name: "deploy" }]),
          } as Response)
        : Promise.resolve({ ok: false } as Response),
    );
    await loadSkills();
    setScopeAgent("ops");
    toggleScopeSkill("backups");
    runComposer("/deploy do it");
    // the hand-routed skill alone — no `agent`, no `backups`
    expect(chat.sendMessage).toHaveBeenCalledWith("do it", {
      skills: ["deploy"],
      raw: "/deploy do it",
    });
    expect(getComposerScope().agent).toBe(undefined);
    expect(getComposerScope().skills).toEqual([]);
  });

  it("an explicit `/<provider> <msg>` send wins the same way", async () => {
    globalThis.fetch = vi.fn((url: RequestInfo | URL) =>
      String(url).includes("/api/providers")
        ? Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ verbs: ["llamacpp"] }),
          } as Response)
        : Promise.resolve({ ok: false } as Response),
    );
    await loadProviders();
    setScopeAgent("ops");
    runComposer("/llamacpp ping");
    expect(chat.sendMessage).toHaveBeenCalledWith("ping", {
      mode: "llamacpp",
      raw: "/llamacpp ping",
    });
    expect(getComposerScope().agent).toBe(undefined);
  });

  // The RETENTION matrix (Codex, round 2 — named cases): one rule, "a line that SENDS a message spends the
  // arming; a line that doesn't, leaves it", checked across every routing branch at once.
  it("scope retention: only a line that SENDS spends the arming", async () => {
    globalThis.fetch = vi.fn((url: RequestInfo | URL) =>
      String(url).includes("/api/providers")
        ? Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ verbs: ["llamacpp"] }),
          } as Response)
        : Promise.resolve({ ok: false } as Response),
    );
    await loadProviders();
    // bare verbs + an unknown one: no message goes out, so the arming is still for the NEXT message
    for (const line of [
      "/llamacpp",
      "/agent",
      "/agent ops",
      "/clear",
      "/compact",
      "/nope",
      "/help",
    ]) {
      setScopeAgent("ops");
      toggleScopeSkill("deploy");
      runComposer(line);
      expect(getComposerScope(), line).toEqual({ agent: "ops", skills: ["deploy"] });
      clearComposerScope();
    }
    // `!shell` doesn't go through the agent at all — nothing to apply the arming to, so it survives
    setScopeAgent("ops");
    runComposer("!ls -la");
    expect(chat.runShell).toHaveBeenCalledWith("ls -la");
    expect(getComposerScope().agent).toBe("ops");
    // and none of those lines sent a MESSAGE — `/compact` runs the summarizer, `/agent` flips the sticky
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });
});

// D61 ① — `/consolidate [dry]`. The verb owns no wording of its own: it resolves the registry's EFFECTIVE
// prompt (`GET /api/prompts` `current`, the owner's edits included) and sends THAT as an ordinary message,
// so the command and a hand-typed prompt end at the same text. The `memory.auto_write` pre-check comes
// first, because the dry run is dry STRUCTURALLY (the switch refuses the writes) rather than by asking.
describe("`/consolidate [dry]` (D61 ①)", () => {
  const PROMPTS = {
    prompts: [
      { id: "core_memory_policy", current: "not this one" },
      { id: "consolidation", current: "  MERGE ONE FAMILY.  " },
      { id: "consolidation_dryrun", current: "DRY RUN — plan only." },
    ],
  };

  /** `/api/settings` (the auto_write guard) + `/api/prompts` (the text). `prompts: null` ⇒ a non-OK
   *  registry response; any other value is served as the body verbatim (malformed shapes included).
   *  `autoWrite` is a boolean in the healthy case, or a whole settings BODY to serve instead. */
  function mockApis(autoWrite: boolean | { body: unknown }, prompts: unknown = PROMPTS) {
    const settings =
      typeof autoWrite === "boolean" ? { memory: { auto_write: autoWrite } } : autoWrite.body;
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/api/settings"))
        return Promise.resolve({ ok: true, json: () => Promise.resolve(settings) } as Response);
      if (u.includes("/api/prompts"))
        return Promise.resolve(
          prompts === null
            ? ({ ok: false, status: 503, statusText: "Service Unavailable" } as Response)
            : ({ ok: true, json: () => Promise.resolve(prompts) } as Response),
        );
      return Promise.resolve({ ok: false } as Response);
    });
  }

  /** The verb's `run` is fire-and-forget over two awaited fetches — let them land. */
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const lastNote = () => vi.mocked(chat.pushSystemNote).mock.calls.at(-1)?.[0] ?? "";

  beforeEach(() => clearComposerScope());

  it("bare: sends the `consolidation` prompt as the message, with the raw line for a Stop-harvest", async () => {
    mockApis(true);
    runComposer("/consolidate");
    await flush();
    // trimmed, and the RAW `/consolidate` line rides along like every other sending verb (D41)
    expect(chat.sendMessage).toHaveBeenCalledWith("MERGE ONE FAMILY.", { raw: "/consolidate" });
  });

  it("`dry`: sends the `consolidation_dryrun` prompt instead", async () => {
    mockApis(false); // the dry form REQUIRES writes off — that is what makes it dry
    runComposer("/consolidate dry");
    await flush();
    expect(chat.sendMessage).toHaveBeenCalledWith("DRY RUN — plan only.", {
      raw: "/consolidate dry",
    });
  });

  it("an EXPLICIT send wins over the armed menu scope, like /skill and /<provider>", async () => {
    mockApis(true);
    setScopeAgent("ops");
    toggleScopeSkill("deploy");
    runComposer("/consolidate");
    // SYNCHRONOUS: spent before the two reads, not after them (a clear parked behind the awaits
    // would eat an arming the owner makes while they are in flight).
    expect(getComposerScope()).toEqual({ agent: undefined, skills: [] });
    await flush();
    expect(chat.sendMessage).toHaveBeenCalledWith("MERGE ONE FAMILY.", { raw: "/consolidate" });
  });

  it("an arming made DURING the reads is for the NEXT message, and survives this one", async () => {
    mockApis(true);
    runComposer("/consolidate");
    setScopeAgent("research"); // the owner opens the menu while the two GETs are in flight
    await flush();
    expect(chat.sendMessage).toHaveBeenCalledWith("MERGE ONE FAMILY.", { raw: "/consolidate" });
    expect(getComposerScope().agent).toBe("research"); // untouched by the send it did not arm
  });

  it("an unknown argument is a note, and nothing is sent (no fetch at all)", async () => {
    mockApis(true);
    runComposer("/consolidate now");
    await flush();
    expect(chat.sendMessage).not.toHaveBeenCalled();
    expect(lastNote()).toContain("unknown argument: now");
    expect(globalThis.fetch).not.toHaveBeenCalled(); // the arg check is free — it precedes both reads
  });

  it("the auto_write guard, both directions", async () => {
    // `dry` with writes ON would really write — refused, naming the switch that makes it dry.
    mockApis(true);
    setScopeAgent("ops");
    runComposer("/consolidate dry");
    await flush();
    expect(chat.sendMessage).not.toHaveBeenCalled();
    expect(lastNote()).toContain("auto-write OFF");
    // …and the refusal has still SPENT the arming: the attempt is what supersedes the menu.
    expect(getComposerScope().agent).toBe(undefined);

    // …and the live form with writes OFF is refused too: every step-2/3 write would be denied, so
    // the run is structurally broken rather than degraded — and the note is only actionable BEFORE
    // the send. Both directions: nothing sent, one actionable note naming the way forward.
    mockApis(false);
    runComposer("/consolidate");
    await flush();
    expect(chat.sendMessage).not.toHaveBeenCalled();
    expect(lastNote()).toContain("`/consolidate dry` for a plan-only pass");
  });

  it("a settings read that can't be judged refuses — unreachable OR a skewed 200", async () => {
    // `/api/settings` serves the full model-dumped config, so a healthy answer ALWAYS carries a real
    // boolean here. Anything else is version skew, and skew must not pick which form runs: only a
    // genuine boolean passes the guard.
    const unjudgeable: { body: unknown }[] = [
      { body: { memory: { auto_write: "false" } } }, // the string a sloppy serializer would send
      { body: { memory: {} } }, // the key is gone
      { body: {} }, // the whole memory block is gone
      { body: null }, // a 200 with no document at all
    ];
    for (const settings of unjudgeable) {
      vi.mocked(chat.pushSystemNote).mockClear();
      mockApis(settings);
      runComposer("/consolidate");
      await flush();
      expect(chat.sendMessage, JSON.stringify(settings)).not.toHaveBeenCalled();
      expect(lastNote(), JSON.stringify(settings)).toContain("memory settings");
    }
    // …and the same note covers an unreachable endpoint.
    vi.mocked(chat.pushSystemNote).mockClear();
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("offline")));
    runComposer("/consolidate");
    await flush();
    expect(chat.sendMessage).not.toHaveBeenCalled();
    expect(lastNote()).toContain("memory settings");
  });

  it("a missing row, a non-OK registry and a malformed body all note and send NOTHING", async () => {
    for (const body of [
      { prompts: [{ id: "something_else", current: "x" }] }, // the id isn't registered
      { prompts: [{ id: "consolidation", current: "   " }] }, // registered, but empty
      null, // a non-OK response
      { nope: true }, // a body that isn't the registry shape
      "not json at all",
    ]) {
      vi.mocked(chat.pushSystemNote).mockClear();
      mockApis(true, body);
      runComposer("/consolidate");
      await flush();
      expect(chat.sendMessage, JSON.stringify(body)).not.toHaveBeenCalled();
      expect(lastNote(), JSON.stringify(body)).toContain("consolidation prompt");
    }
  });

  it("rides the ONE built-in table: `/help` lists it and the completions offer it", () => {
    runComposer("/help");
    expect(lastNote()).toContain("/consolidate [dry]");
    expect(getCompletions("/conso").map((c) => c.value)).toEqual(["consolidate"]);
    expect(getCompletions("/conso")[0].kind).toBe("builtin");
    expect(getCompletions("/consolidate ")).toEqual([]); // `[dry]` is a help hint, not a completion
  });
});

// A2 — the composer autocomplete GRAMMAR. `getCompletions` is pure over the draft + the three loaded verb
// sets, and shares its precedence rules (and its built-in table) with `routeSlash`, so a suggestion can
// never be something the router wouldn't run.
describe("getCompletions (A2)", () => {
  const values = (draft: string) => getCompletions(draft).map((c) => c.value);
  const kinds = (draft: string) => getCompletions(draft).map((c) => c.kind);

  beforeEach(async () => {
    globalThis.fetch = vi.fn((url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/api/skills"))
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([{ name: "deploy" }, { name: "clear" }, { name: "cloud-sync" }]),
        } as Response);
      if (u.includes("/api/providers"))
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ verbs: ["llamacpp", "cloudy", "deploy", "help"] }),
        } as Response);
      if (u.includes("/api/agents"))
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({ agents: ["default", "ops", "research"], default: "default" }),
        } as Response);
      return Promise.resolve({ ok: false } as Response);
    });
    await Promise.all([loadSkills(), loadProviders(), loadAgents()]);
  });

  it("suggests nothing for a shell line, plain text, or an empty draft", () => {
    expect(getCompletions("!ls -la")).toEqual([]);
    expect(getCompletions("wake the vault")).toEqual([]);
    expect(getCompletions("")).toEqual([]);
    expect(getCompletions("   ")).toEqual([]);
  });

  it("first token: built-ins, then skills, then providers (the routing precedence, in that order)", () => {
    expect(values("/c")).toEqual(["compact", "consolidate", "clear", "cloud-sync", "cloudy"]);
    expect(kinds("/c")).toEqual(["builtin", "builtin", "builtin", "skill", "provider"]);
  });

  it("drops names a higher tier shadows — they could never route", () => {
    // the `clear` SKILL is shadowed by the built-in (above); `deploy` the PROVIDER by the `deploy` skill;
    // `help` the PROVIDER by the built-in.
    expect(kinds("/dep")).toEqual(["skill"]);
    expect(kinds("/hel")).toEqual(["builtin"]);
  });

  it("`/agent ` lists the configured agents; a partial second token filters them", () => {
    expect(values("/agent ")).toEqual(["default", "ops", "research"]);
    expect(kinds("/agent ")).toEqual(["agent", "agent", "agent"]);
    expect(values("/agent re")).toEqual(["research"]);
  });

  it("`/privilege ` (and its `/priv` alias) offers the SHARED privilege ladder", () => {
    const ladder = PRIVILEGE_LEVELS.map((l) => l.val);
    expect(values("/privilege ")).toEqual(ladder);
    expect(values("/priv ")).toEqual(ladder);
    expect(kinds("/priv ")).toEqual(ladder.map(() => "privilege"));
    expect(values("/priv a")).toEqual(["auto_low"]);
  });

  it("stops after a verb that takes free text, and after the second token", () => {
    expect(getCompletions("/compact ")).toEqual([]);
    expect(getCompletions("/deploy do it")).toEqual([]);
    expect(getCompletions("/agent ops ")).toEqual([]);
    expect(getCompletions("/agent ops x")).toEqual([]);
  });

  it("a fully typed candidate is STILL listed — 'nothing to accept' is the hook's Enter rule, not a filter", () => {
    // It has to be: `clear` shares its prefix with `clear-cache`, so dropping the exact row would hide the
    // one the user is on. useComposerSuggest falls Enter through to send when the ACTIVE row is exact.
    expect(values("/clea")).toEqual(["clear"]);
    expect(values("/clear")).toEqual(["clear"]);
    expect(values("/agent research")).toEqual(["research"]);
  });

  // Codex, v1.3.2 fix wave — `getCompletions` split the line on `/\s+/` while `routeSlash` split on an
  // ASCII space, so a TAB after the verb suggested agents and then routed as an unknown command. One
  // tokenizer now serves both.
  it("a TAB after the verb tokenizes exactly like a space (one shared tokenizer)", () => {
    expect(values("/agent\tre")).toEqual(["research"]);
    expect(values("/agent\t")).toEqual(["default", "ops", "research"]);
    expect(getCompletions("/agent\tops\tx")).toEqual([]); // a third token still ends the grammar
    runComposer("/agent\tops");
    expect(chat.setSessionAgent).toHaveBeenCalledWith("ops");
  });

  // Skill names are free-form server-side (SKILL.md frontmatter — no slug check), so the composer must
  // fold case itself and must never offer a name the `/verb` grammar can't express.
  it("a mixed-case skill routes, and completes to its CANONICAL name", async () => {
    globalThis.fetch = vi.fn((url: RequestInfo | URL) =>
      String(url).includes("/api/skills")
        ? Promise.resolve({
            ok: true,
            json: () => Promise.resolve([{ name: "OpsAssist" }, { name: "My Skill" }]),
          } as Response)
        : Promise.resolve({ ok: false } as Response),
    );
    await loadSkills();

    expect(values("/opsas")).toEqual(["OpsAssist"]);
    expect(getCompletions("/opsas")[0]?.insert).toBe("/OpsAssist");
    runComposer("/opsassist do it"); // …and the lowercased verb the user typed still routes
    expect(chat.sendMessage).toHaveBeenCalledWith("do it", {
      skills: ["OpsAssist"], // the CANONICAL name — the backend matches skills by exact name
      raw: "/opsassist do it",
    });

    // `My Skill` can't be reached by `/verb` at all (the tokenizer stops at the space), so it is never offered
    expect(values("/my")).toEqual([]);
  });

  // Codex, round 2 — the fold map used to keep ONE name per lowercase key, so a backend that has both
  // `Ops` and `ops` lost one of them entirely: absent from the menu, unroutable from the composer.
  it("case-COLLIDING skills both survive: each is offered, and routes by its exact case", async () => {
    globalThis.fetch = vi.fn((url: RequestInfo | URL) =>
      String(url).includes("/api/skills")
        ? Promise.resolve({
            ok: true,
            json: () => Promise.resolve([{ name: "Ops" }, { name: "ops" }]),
          } as Response)
        : Promise.resolve({ ok: false } as Response),
    );
    await loadSkills();

    expect(getKnownSkills()).toEqual(["Ops", "ops"]); // both listed for the tools/skills menu
    expect(values("/op")).toEqual(["Ops", "ops"]); // …and both typable from the popover

    runComposer("/Ops task");
    expect(chat.sendMessage).toHaveBeenLastCalledWith("task", {
      skills: ["Ops"],
      raw: "/Ops task",
    });
    runComposer("/ops task");
    expect(chat.sendMessage).toHaveBeenLastCalledWith("task", {
      skills: ["ops"],
      raw: "/ops task",
    });
  });

  it("an AMBIGUOUS fold with no exact match is unknown — never a guess at which skill was meant", async () => {
    globalThis.fetch = vi.fn((url: RequestInfo | URL) =>
      String(url).includes("/api/skills")
        ? Promise.resolve({
            ok: true,
            json: () => Promise.resolve([{ name: "Ops" }, { name: "OPS" }]),
          } as Response)
        : Promise.resolve({ ok: false } as Response),
    );
    await loadSkills();
    runComposer("/ops task"); // neither canonical is spelled this way
    expect(chat.sendMessage).not.toHaveBeenCalled();
    expect(chat.pushSystemNote).toHaveBeenCalledWith("// unknown command: /ops — try /help");
  });

  it("`insert` replaces the whole token — the first one keeps its sigil, later ones don't", () => {
    expect(getCompletions("/clea")[0]?.insert).toBe("/clear");
    expect(getCompletions("/agent re")[0]?.insert).toBe("research");
  });

  it("ONE built-in table drives both `/help` and the completions (no second list)", () => {
    runComposer("/help");
    const help = vi.mocked(chat.pushSystemNote).mock.calls.at(-1)?.[0] ?? "";
    const builtins = getCompletions("/").filter((c) => c.kind === "builtin");
    expect(builtins.length).toBeGreaterThan(0);
    for (const b of builtins) expect(help).toContain(`/${b.value} `);
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
