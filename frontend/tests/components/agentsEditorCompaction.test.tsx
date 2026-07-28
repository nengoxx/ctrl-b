import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// AgentsEditor — the D42 Slice-6 additions: the GLOBAL compaction block (Auto-compact Switch +
// the % ×100/÷100 round-trip + clamp + the two token knobs, saved via the globals bar) and the
// per-agent ModelRef call-config block (Max output tokens / Reasoning-effort Seg unset-state /
// Reasoning tokens, round-tripped through the save payload). We mock the hook boundaries (like
// composerSteer/chatThread do) and drive the REAL component through its DOM.

const h = vi.hoisted(() => ({
  saveSettings: vi.fn(),
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
  useSaveSettings: () => ({ mutate: h.saveSettings, isPending: false }),
  // AgentsEditor's backend picker (A11/D48 C7-b) reads the registry catalog from GET /api/providers.
  useProviders: () => ({ data: { providers: {}, verbs: [], warnings: [] } }),
}));
vi.mock("../../src/hooks/useDefaultPrompt", () => ({
  useDefaultPrompt: () => ({ data: "" }),
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

import { AgentsEditor } from "../../src/components/AgentsEditor";
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
  },
};

function renderEditor(cfg: AgentSectionCfg = baseCfg) {
  return render(<AgentsEditor cfg={cfg} toolNames={[]} toolModes={{}} skillNames={[]} />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.cloneDetail = false;
});

// The agent-globals PUT payload shape (the two branches this suite asserts on).
type SavedAgent = {
  agent: {
    compaction: {
      enabled: boolean;
      threshold_frac: number;
      keep_recent_tokens: number;
      clear_output_min_tokens: number;
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

describe("AgentsEditor · global compaction block (D42)", () => {
  it("renders the threshold as a whole percent (frac ×100)", () => {
    renderEditor();
    expect(value("Compact at % of context")).toBe("85");
    expect(value("Keep recent (tokens)")).toBe("4096");
    expect(value("Tool output trim floor (tokens)")).toBe("500");
  });

  it("round-trips the % (÷100) + token knobs + the Auto-compact Switch into the save payload", () => {
    renderEditor();
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
    });
  });

  it("clamps the % to the schema bounds (50–95) at save", () => {
    renderEditor();
    fireEvent.change(screen.getByLabelText("Compact at % of context"), { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "Save agent settings" }));
    expect(lastAgentPayload().agent.compaction.threshold_frac).toBe(0.95);

    cleanup();
    h.saveSettings.mockClear();
    renderEditor();
    fireEvent.change(screen.getByLabelText("Compact at % of context"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Save agent settings" }));
    expect(lastAgentPayload().agent.compaction.threshold_frac).toBe(0.5);
  });

  // P3 (D42 post-build audit): the token knobs are `ge=0` (0 is a valid degenerate setting), but a
  // garbage keystroke must never WRITE 0 — `numOrKeep` leaves the last valid value untouched.
  it("garbage input on a token knob keeps the last valid value (never writes 0)", () => {
    renderEditor();
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

describe("AgentsEditor · draft reseed value-guard (Codex FIX B)", () => {
  const propsFor = (cfg: AgentSectionCfg) => (
    <AgentsEditor cfg={cfg} toolNames={[]} toolModes={{}} skillNames={[]} />
  );

  it("a value-identical parent re-render does NOT clobber an unsaved edit", () => {
    const { rerender } = render(propsFor(baseCfg));
    fireEvent.change(screen.getByLabelText("Compact at % of context"), { target: { value: "70" } });
    expect(value("Compact at % of context")).toBe("70");
    // ConfTab rebuilds `agentCfg` fresh every render → a NEW object with identical values.
    rerender(propsFor({ ...baseCfg, compaction: { ...baseCfg.compaction } }));
    expect(value("Compact at % of context")).toBe("70"); // edit survives the re-render
  });

  it("a genuinely changed server value DOES reseed the draft", () => {
    const { rerender } = render(propsFor(baseCfg));
    fireEvent.change(screen.getByLabelText("Compact at % of context"), { target: { value: "70" } });
    rerender(propsFor({ ...baseCfg, compaction: { ...baseCfg.compaction, threshold_frac: 0.6 } }));
    expect(value("Compact at % of context")).toBe("60"); // reseeded to the new server value
  });

  // v1.3.1 draft-loss slice — this card mixes the savebar draft with IMMEDIATE-SAVE controls
  // (auto-route + its min-overlap; default_title lives in the default row). Their echo is a real
  // change to `props.cfg`, so the value-guard above still fired and wiped unsaved draft edits — the
  // user-visible "edit A, save B, A vanishes". Only the draft-managed projection may reseed.
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
    const { rerender } = render(propsFor(baseCfg));
    fireEvent.click(screen.getByText(/workspace root/)); // open the default agent's row
    fireEvent.change(screen.getByLabelText("Max output tokens"), { target: { value: "2048" } });
    rerender(propsFor(baseCfg));
    expect(value("Max output tokens")).toBe("2048");
  });
});

describe("AgentsEditor · per-agent ModelRef call config (D42 A10)", () => {
  function openDefaultRow() {
    renderEditor();
    fireEvent.click(screen.getByText(/workspace root/)); // the default row's disclosure header
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
