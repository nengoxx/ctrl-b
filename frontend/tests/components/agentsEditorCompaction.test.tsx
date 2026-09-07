import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The agent settings surface — the D42 Slice-6 additions: the GLOBAL compaction block (Auto-compact
// Switch + the % ×100/÷100 round-trip + clamp + the two token knobs, saved via the globals bar) and
// the per-agent ModelRef call-config block (Max output tokens / Reasoning-effort Seg unset-state /
// Reasoning tokens, round-tripped through the save payload). We mock the hook boundaries (like
// composerSteer/chatThread do) and drive the REAL components through their DOM.
//
// D70 §8.4 split the old single `AgentsEditor` in two — the globals kept their Conf home
// (`AgentGlobals`) and the per-agent row moved to the agents gallery (`AgentRow`, opened by the card
// the owner taps). Every assertion below is the one it always was; what changed is which component
// each half renders, and that the row is rendered OPEN (the gallery opens it, rather than the list's
// disclosure header being clicked).

const h = vi.hoisted(() => ({
  saveSettings: vi.fn(),
  // v1.3.1 Codex verify round — each useSaveSettings() CALL is a distinct mutation instance; a second
  // mutate() on a SHARED instance detaches the first call's observer (its per-call onSuccess never
  // runs). The mock tags every instance so tests can pin that the globals save and the immediate-save
  // controls ride DIFFERENT instances (the structural fix; the detach semantics themselves are
  // TanStack's, verified upstream).
  instSeq: { n: 0 },
  taggedCalls: [] as { inst: number; patch: unknown }[],
  saveAgent: vi.fn(),
  // v1.3.1 — when true, `useAgent` hands back a FRESH object with identical values on every render
  // (what a refetch without TanStack's structural sharing looks like), so the row's detail-seed
  // value-guard is exercised rather than the cache's reference stability.
  cloneDetail: false,
}));

// The default agent's resolved def + persona (returned for the open row, regardless of name/arg).
const agentDetail = {
  name: "default",
  is_default: true,
  soul: "",
  agent: {
    name: "default",
    title: "",
    description: "",
    prompt: "",
    prompt_append: "",
    inherit_append: true,
    model: { provider: null, model: null }, // no call-config → the unset defaults render
    tools: "*" as const,
    skills: "*" as const,
    privilege: "confirm" as const,
    compaction: null,
    max_iterations: 20,
    max_repeat_calls: 3,
    max_calls_per_tool: 10,
    max_stall_iterations: 3,
    max_subagent_depth: 2,
    max_concurrent_subagents: 3,
  },
};

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));
vi.mock("../../src/hooks/useSettings", () => ({
  useSaveSettings: () => {
    const inst = h.instSeq.n++;
    return {
      mutate: (...args: [unknown, unknown?]) => {
        h.taggedCalls.push({ inst, patch: args[0] });
        (h.saveSettings as (...a: unknown[]) => void)(...args);
      },
      isPending: false,
    };
  },
  // The form's backend picker (A11/D48 C7-b) reads the registry catalog from GET /api/providers.
  useProviders: () => ({ data: { providers: {}, verbs: [], warnings: [] } }),
  // …and the roleplay MODE off the settings doc (D70 §9's visibility predicate). Off here: these
  // cases are about the call-config fields, which are not roleplay fields.
  useSettings: () => ({ data: { roleplay: { enabled: false } } }),
}));
// The art rows' library + job machine (D70 §8.2). Empty: no `agents` index in this harness, which is
// the fresh-install state, and no roleplay field renders under the predicate above anyway.
vi.mock("../../src/hooks/useMediaLibrary", () => ({
  useMediaLibrary: () => ({ sections: [], write: { append: vi.fn() }, ready: false }),
}));
vi.mock("../../src/hooks/useDefaultPrompt", () => ({
  useDefaultPrompt: () => ({ data: "" }),
}));
// D70 §6.5 — the form's lorebook picker. Its shelf query is one of the two `useQuery` callers this
// suite blanket-mocks away, so it needs its own boundary.
vi.mock("../../src/hooks/useRoleplay", async (importActual) => ({
  ...(await importActual<typeof import("../../src/hooks/useRoleplay")>()),
  useLorebooks: () => ({ data: [] }),
}));
vi.mock("../../src/hooks/useAgents", async (importActual) => {
  const actual = await importActual<typeof import("../../src/hooks/useAgents")>();
  return {
    ...actual,
    useAgentList: () => ({ data: { agents: [], default: "default" } }),
    useAgent: () => ({
      data: h.cloneDetail ? structuredClone(agentDetail) : agentDetail,
      isLoading: false,
    }),
    useSaveAgent: () => ({ mutate: h.saveAgent, isPending: false }),
    useDeleteAgent: () => ({ mutate: vi.fn(), isPending: false }),
    useSaveAgentSoul: () => ({ mutate: vi.fn() }),
  };
});

import { AgentGlobals } from "../../src/components/AgentGlobals";
import { AgentRow } from "../../src/components/AgentsEditor";
import type { AgentSectionCfg } from "../../src/hooks/useAgents";

const baseCfg: AgentSectionCfg = {
  default_agent: "",
  default_title: "",
  global_subagent_limit: 6,
  subagent_clamp_privilege: true,
  auto_rotate: false,
  auto_rotate_min_overlap: 2,
  streaming: "auto",
  compaction: {
    enabled: true,
    threshold_frac: 0.85,
    keep_recent_tokens: 4096,
    clear_output_min_tokens: 500,
    clear_trigger_pct: 0.5,
    clear_min_reclaim_tokens: 1024,
    clear_exclude_tools: ["task_plan", "memory", "core_memory"],
  },
};

function renderGlobals(cfg: AgentSectionCfg = baseCfg) {
  return render(<AgentGlobals cfg={cfg} />);
}

/** The default agent's row as the GALLERY mounts it: already open on the card that was tapped. */
const defaultRow = (
  <AgentRow
    name="default"
    isDefault
    isResolvedDefault
    open
    onToggle={() => undefined}
    toolNames={[]}
    toolModes={{}}
    skillNames={[]}
    defaultPrompt=""
  />
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.cloneDetail = false;
  h.taggedCalls.length = 0;
  h.instSeq.n = 0;
});

// The agent-globals PUT payload shape (the two branches this suite asserts on).
type SavedAgent = {
  agent: {
    compaction: {
      enabled: boolean;
      threshold_frac: number;
      keep_recent_tokens: number;
      clear_output_min_tokens: number;
      clear_trigger_pct: number;
      clear_min_reclaim_tokens: number;
      clear_exclude_tools: string[];
    };
    defaults: {
      model: {
        max_tokens: number | null;
        reasoning_effort: string | null;
        reasoning_tokens: number | null;
      };
    };
  };
};
const lastAgentPayload = () => h.saveSettings.mock.calls[0][0] as SavedAgent;
const value = (label: string) => screen.getByLabelText<HTMLInputElement>(label).value;

describe("AgentGlobals · global compaction block (D42)", () => {
  it("renders the threshold as a whole percent (frac ×100)", () => {
    renderGlobals();
    expect(value("Compact at % of context")).toBe("85");
    expect(value("Keep recent (tokens)")).toBe("4096");
    expect(value("Tool output trim floor (tokens)")).toBe("500");
  });

  it("round-trips the % (÷100) + token knobs + the Auto-compact Switch into the save payload", () => {
    renderGlobals();
    fireEvent.change(screen.getByLabelText("Compact at % of context"), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText("Keep recent (tokens)"), { target: { value: "2000" } });
    fireEvent.change(screen.getByLabelText("Tool output trim floor (tokens)"), {
      target: { value: "300" },
    });
    fireEvent.click(screen.getByLabelText("Auto-compact")); // toggle off
    fireEvent.click(screen.getByRole("button", { name: "Save agent settings" }));

    expect(h.saveSettings).toHaveBeenCalledTimes(1);
    expect(lastAgentPayload().agent.compaction).toEqual({
      enabled: false,
      threshold_frac: 0.7,
      keep_recent_tokens: 2000,
      clear_output_min_tokens: 300,
      clear_trigger_pct: 0.5,
      clear_min_reclaim_tokens: 1024,
      clear_exclude_tools: ["task_plan", "memory", "core_memory"],
    });
  });

  // D60 — the Tier-1 clearing gate rides the same globals draft/savebar.
  it("round-trips the clearing gate: % ÷100, the reclaim floor, and the never-clear list", () => {
    renderGlobals();
    expect(value("Clear tool outputs above % of context")).toBe("50");
    expect(value("Minimum tokens reclaimed by a trim")).toBe("1024");
    expect(value("Tools never cleared")).toBe("task_plan, memory, core_memory");

    fireEvent.change(screen.getByLabelText("Clear tool outputs above % of context"), {
      target: { value: "80" },
    });
    fireEvent.change(screen.getByLabelText("Minimum tokens reclaimed by a trim"), {
      target: { value: "2048" },
    });
    fireEvent.change(screen.getByLabelText("Tools never cleared"), {
      target: { value: "task_plan, core_memory" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save agent settings" }));

    const c = lastAgentPayload().agent.compaction;
    expect(c.clear_trigger_pct).toBe(0.8);
    expect(c.clear_min_reclaim_tokens).toBe(2048);
    expect(c.clear_exclude_tools).toEqual(["task_plan", "core_memory"]);
  });

  it("keeps a separator the owner just typed in the never-clear list", () => {
    renderGlobals();
    fireEvent.change(screen.getByLabelText("Tools never cleared"), {
      target: { value: "memory, " },
    });
    expect(value("Tools never cleared")).toBe("memory, "); // raw text while typing, list on save
    fireEvent.click(screen.getByRole("button", { name: "Save agent settings" }));
    expect(lastAgentPayload().agent.compaction.clear_exclude_tools).toEqual(["memory"]);
  });

  it("clamps the % to the schema bounds (50–95) at save", () => {
    renderGlobals();
    fireEvent.change(screen.getByLabelText("Compact at % of context"), { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "Save agent settings" }));
    expect(lastAgentPayload().agent.compaction.threshold_frac).toBe(0.95);

    cleanup();
    h.saveSettings.mockClear();
    renderGlobals();
    fireEvent.change(screen.getByLabelText("Compact at % of context"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save agent settings" }));
    expect(lastAgentPayload().agent.compaction.threshold_frac).toBe(0.5);
  });

  // P3 (D42 post-build audit): the token knobs are `ge=0` (0 is a valid degenerate setting), but a
  // garbage keystroke must never WRITE 0 — `numOrKeep` leaves the last valid value untouched.
  it("garbage input on a token knob keeps the last valid value (never writes 0)", () => {
    renderGlobals();
    const keep = screen.getByLabelText("Keep recent (tokens)");
    fireEvent.change(keep, { target: { value: "2000" } }); // valid write
    fireEvent.change(keep, { target: { value: "20x" } }); // junk → keep 2000, not 0/2000-collapse
    expect(value("Keep recent (tokens)")).toBe("2000");

    const trim = screen.getByLabelText("Tool output trim floor (tokens)");
    fireEvent.change(trim, { target: { value: "" } }); // cleared → keep the original, not 0
    expect(value("Tool output trim floor (tokens)")).toBe("500");

    fireEvent.click(screen.getByRole("button", { name: "Save agent settings" }));
    const c = lastAgentPayload().agent.compaction;
    expect(c.keep_recent_tokens).toBe(2000); // last valid, not zeroed
    expect(c.clear_output_min_tokens).toBe(500); // untouched, not zeroed
  });
});

describe("AgentGlobals · draft reseed value-guard (Codex FIX B)", () => {
  const propsFor = (cfg: AgentSectionCfg) => <AgentGlobals cfg={cfg} />;

  it("a value-identical parent re-render does NOT clobber an unsaved edit", () => {
    const { rerender } = render(propsFor(baseCfg));
    fireEvent.change(screen.getByLabelText("Compact at % of context"), { target: { value: "70" } });
    expect(value("Compact at % of context")).toBe("70");
    // ConfTab rebuilds `agentCfg` fresh every render → a NEW object with identical values.
    rerender(propsFor({ ...baseCfg, compaction: { ...baseCfg.compaction } }));
    expect(value("Compact at % of context")).toBe("70"); // edit survives the re-render
  });

  it("a fresh-array parent re-render does NOT clobber the never-clear text being typed", () => {
    const { rerender } = render(propsFor(baseCfg));
    fireEvent.change(screen.getByLabelText("Tools never cleared"), {
      target: { value: "memory, " },
    });
    // The list arrives as a NEW array with identical values on every ConfTab render — the reseed is
    // keyed on the joined string, so the separator just typed survives.
    rerender(
      propsFor({
        ...baseCfg,
        compaction: {
          ...baseCfg.compaction,
          clear_exclude_tools: ["task_plan", "memory", "core_memory"],
        },
      }),
    );
    expect(value("Tools never cleared")).toBe("memory, ");
  });

  it("a genuinely changed server value DOES reseed a CLEAN draft", () => {
    const { rerender } = render(propsFor(baseCfg));
    rerender(propsFor({ ...baseCfg, compaction: { ...baseCfg.compaction, threshold_frac: 0.6 } }));
    expect(value("Compact at % of context")).toBe("60"); // clean → reseeded to the new server value
  });

  // v1.3.1 (Codex review, HIGH) — the draft epoch, same semantics as ConfTab's: while the draft is
  // DIRTY the incoming doc is not adopted at all (and the epoch does not advance), so a background
  // refetch — or the echo of the user's own in-flight save — cannot clobber unsaved edits.
  it("a background server move does NOT clobber a DIRTY draft", () => {
    const { rerender } = render(propsFor(baseCfg));
    fireEvent.change(screen.getByLabelText("Compact at % of context"), { target: { value: "70" } });
    rerender(propsFor({ ...baseCfg, compaction: { ...baseCfg.compaction, threshold_frac: 0.6 } }));
    expect(value("Compact at % of context")).toBe("70"); // the unsaved edit survives
  });

  it("keeps globals edits made while the save was in flight, and stays dirty", () => {
    const { rerender } = render(propsFor(baseCfg));
    fireEvent.change(screen.getByLabelText("Compact at % of context"), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", { name: "Save agent settings" }));
    expect(h.saveSettings).toHaveBeenCalledTimes(1);
    // …the owner keeps editing ANOTHER globals field before the response lands…
    fireEvent.change(screen.getByLabelText("Keep recent (tokens)"), { target: { value: "2000" } });
    // …then the PUT echo for what WAS submitted arrives (mutation onSuccess → cache → prop).
    const echoCfg = { ...baseCfg, compaction: { ...baseCfg.compaction, threshold_frac: 0.7 } };
    const opts = h.saveSettings.mock.calls[0][1] as {
      onSuccess: (r: unknown) => void;
      onSettled?: () => void;
    };
    act(() => {
      opts.onSuccess({
        settings: { agent: echoCfg },
        providers_rev: "revB",
        warnings: [],
        restart_required: [],
      });
      opts.onSettled?.(); // reality: TanStack settles after success — releases the re-entry ref
    });
    rerender(propsFor(echoCfg)); // the echo lands as the prop one render later
    expect(value("Compact at % of context")).toBe("70"); // the saved value round-tripped
    expect(value("Keep recent (tokens)")).toBe("2000"); // …and the in-flight edit survived
    // The bar is honest about it: still dirty, and a second save carries the in-flight edit.
    const bar = screen.getByRole("button", { name: /Save agent settings|Saved/ });
    expect(bar.textContent).toBe("Save agent settings");
    fireEvent.click(bar);
    const second = h.saveSettings.mock.calls[1][0] as SavedAgent;
    expect(second.agent.compaction.keep_recent_tokens).toBe(2000);
    expect(second.agent.compaction.threshold_frac).toBe(0.7);
  });

  // v1.3.1 draft-loss slice — this card mixes the savebar draft with IMMEDIATE-SAVE controls
  // (auto-route + its min-overlap; default_title lives in the default row). Their echo is a real
  // change to `props.cfg`, so the value-guard above still fired and wiped unsaved draft edits — the
  // user-visible "edit A, save B, A vanishes". Only the draft-managed projection may reseed.
  it("the globals save rides its OWN mutation instance and blocks re-entry while pending", () => {
    // v1.3.1 Codex verify round: a second mutate() on a SHARED instance detaches the first call's
    // observer, so an immediate-save toggle during a pending globals save killed the epoch reconcile.
    // The structural fix: separate instances (this pin), plus a call-time re-entry ref for
    // globals-on-globals (TanStack's detach semantics themselves were verified upstream).
    render(propsFor(baseCfg));
    fireEvent.change(screen.getByLabelText("Compact at % of context"), { target: { value: "70" } });
    fireEvent.click(screen.getByLabelText("Auto-route to specialists")); // immediate-save control
    fireEvent.click(screen.getByRole("button", { name: "Save agent settings" }));
    const isGlobals = (p: unknown) =>
      (p as { agent?: { compaction?: unknown } }).agent?.compaction !== undefined;
    const isAutoRoute = (p: unknown) =>
      (p as { agent?: { auto_rotate?: unknown } }).agent?.auto_rotate !== undefined;
    const autoRoute = h.taggedCalls.find((c) => isAutoRoute(c.patch));
    const globals = h.taggedCalls.find((c) => isGlobals(c.patch));
    expect(autoRoute).toBeTruthy();
    expect(globals).toBeTruthy();
    expect(autoRoute!.inst).not.toBe(globals!.inst); // different useSaveSettings() instances
    // A second click while the first save is unsettled is a no-op (the call-time ref guard).
    fireEvent.click(screen.getByRole("button", { name: "Save agent settings" }));
    expect(h.taggedCalls.filter((c) => isGlobals(c.patch))).toHaveLength(1);
  });

  it("an immediate-save echo (auto-route) does NOT clobber unsaved draft edits", () => {
    const { rerender } = render(propsFor(baseCfg));
    fireEvent.change(screen.getByLabelText("Compact at % of context"), { target: { value: "70" } });
    fireEvent.click(screen.getByLabelText("Auto-route to specialists")); // saves immediately
    expect(h.saveSettings).toHaveBeenCalledWith({ agent: { auto_rotate: true } });
    h.saveSettings.mockClear(); // so `lastAgentPayload` reads the GLOBALS save below
    // …the PUT echo lands: a changed cfg, but the change is confined to the immediate-save keys.
    rerender(propsFor({ ...baseCfg, auto_rotate: true, compaction: { ...baseCfg.compaction } }));
    expect(value("Compact at % of context")).toBe("70"); // the unsaved edit survives
    // …and it is still submittable (the dirty projection is unchanged by the echo).
    fireEvent.click(screen.getByRole("button", { name: "Save agent settings" }));
    expect(lastAgentPayload().agent.compaction.threshold_frac).toBe(0.7);
  });

  it("an identical-value detail refresh does not reset a dirty agent draft", () => {
    h.cloneDetail = true; // every render yields a new (value-identical) detail object
    const { rerender } = render(defaultRow);
    fireEvent.change(screen.getByLabelText("Max output tokens"), { target: { value: "2048" } });
    rerender(defaultRow);
    expect(value("Max output tokens")).toBe("2048");
  });
});

describe("AgentRow · per-agent ModelRef call config (D42 A10)", () => {
  function openDefaultRow() {
    render(defaultRow);
  }

  it("renders the call-config fields in their unset state", () => {
    openDefaultRow();
    expect(value("Max output tokens")).toBe("");
    expect(value("Reasoning tokens")).toBe("");
    // A <select> since 2026-07-21 (the 8-rung ladder wrapped a capsule Seg into a blob at phone
    // width); the "" option ("inherit") is the unset state, same null mapping as the old Seg.
    expect(value("Reasoning effort")).toBe("");
  });

  it("round-trips the three fields through the agents PUT payload (string→number, effort→literal)", () => {
    openDefaultRow();
    fireEvent.change(screen.getByLabelText("Max output tokens"), { target: { value: "2048" } });
    fireEvent.change(screen.getByLabelText("Reasoning tokens"), { target: { value: "800" } });
    fireEvent.change(screen.getByLabelText("Reasoning effort"), { target: { value: "high" } });
    fireEvent.click(screen.getByRole("button", { name: "save" })); // the default row footer

    // The default agent saves through PUT /api/settings → { agent: { defaults: { model } } }.
    const model = lastAgentPayload().agent.defaults.model;
    expect(model).toMatchObject({
      max_tokens: 2048,
      reasoning_tokens: 800,
      reasoning_effort: "high",
    });
  });

  it("blank numeric → null; the select 'inherit' pick → null (not empty string)", () => {
    openDefaultRow();
    // set then clear → the coercion must yield null, not 0 or ""
    fireEvent.change(screen.getByLabelText("Max output tokens"), { target: { value: "2048" } });
    fireEvent.change(screen.getByLabelText("Max output tokens"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Reasoning effort"), { target: { value: "high" } });
    fireEvent.change(screen.getByLabelText("Reasoning effort"), { target: { value: "" } }); // back to unset
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    const model = lastAgentPayload().agent.defaults.model;
    expect(model.max_tokens).toBeNull();
    expect(model.reasoning_effort).toBeNull();
  });

  // P1 (D42 post-build audit): the budget fields are `ge=1` — a "0" or non-numeric entry is never a
  // meaningful budget, so `numOrNull` stores null (inherit), NEVER 0 (the old `Number(v) || 0` footgun).
  it("garbage or '0' input on the budget fields round-trips as null (never 0)", () => {
    openDefaultRow();
    const maxT = screen.getByLabelText("Max output tokens");
    fireEvent.change(maxT, { target: { value: "2048" } }); // valid first (makes the row dirty)
    fireEvent.change(maxT, { target: { value: "0" } }); // 0 is not a budget → null
    const reasT = screen.getByLabelText("Reasoning tokens");
    fireEvent.change(reasT, { target: { value: "700" } });
    fireEvent.change(reasT, { target: { value: "abc" } }); // junk → null
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    const model = lastAgentPayload().agent.defaults.model;
    expect(model.max_tokens).toBeNull();
    expect(model.reasoning_tokens).toBeNull();
  });
});
