import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// D79 / ROLEPLAY_PLAN §15 — the agent form's S9 surface, driven through the REAL `AgentRow` over mocked
// hook boundaries (the agentRoleplayFields posture): the footer's card EXPORT (§15.3) — disabled with
// "save first" while dirty, opening in place onto the two formats.

const h = vi.hoisted(
  (): {
    saveAgent: ReturnType<typeof vi.fn>;
    saveSettings: ReturnType<typeof vi.fn>;
    exportCard: ReturnType<typeof vi.fn>;
    deleteAgent: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn<(req: unknown) => Promise<boolean>>>;
    agent: Record<string, unknown>;
    roleplay: Record<string, unknown>;
  } => ({
    saveAgent: vi.fn(),
    saveSettings: vi.fn(),
    exportCard: vi.fn(),
    deleteAgent: vi.fn(),
    confirm: vi.fn<(req: unknown) => Promise<boolean>>(),
    agent: {},
    roleplay: {},
  }),
);

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));
vi.mock("../../src/hooks/useSettings", () => ({
  useSaveSettings: () => ({ mutate: h.saveSettings, isPending: false }),
  useProviders: () => ({ data: { providers: {}, verbs: [], warnings: [] } }),
  useSettings: () => ({ data: { roleplay: h.roleplay } }),
}));
vi.mock("../../src/hooks/useAgentArt", async (importActual) => ({
  ...(await importActual<typeof import("../../src/hooks/useAgentArt")>()),
  useExportCard: () => ({ exportCard: h.exportCard, pending: false }),
}));
vi.mock("../../src/store/confirm", () => ({
  requestConfirm: (req: unknown) => h.confirm(req),
}));
vi.mock("../../src/hooks/useMediaLibrary", () => ({
  useMediaLibrary: () => ({ sections: [], write: { append: vi.fn() }, ready: false }),
}));
vi.mock("../../src/hooks/useRoleplay", async (importActual) => ({
  ...(await importActual<typeof import("../../src/hooks/useRoleplay")>()),
  useLorebooks: () => ({ data: [] }),
}));
vi.mock("../../src/hooks/useAgents", async (importActual) => {
  const actual = await importActual<typeof import("../../src/hooks/useAgents")>();
  return {
    ...actual,
    useAgent: (name: string | null) =>
      name
        ? {
            data: { name, is_default: name === "default", soul: "", agent: h.agent },
            isLoading: false,
          }
        : { data: undefined, isLoading: false },
    useSaveAgent: () => ({ mutate: h.saveAgent, isPending: false }),
    useDeleteAgent: () => ({ mutate: h.deleteAgent, isPending: false }),
    useSaveAgentSoul: () => ({ mutate: vi.fn() }),
  };
});

import { AgentRow } from "../../src/components/AgentsEditor";

function agentDef(over: Record<string, unknown> = {}) {
  return {
    name: "lyra",
    title: "Lyra",
    description: "",
    prompt: "",
    prompt_append: "",
    inherit_append: true,
    duties: "agent",
    greeting: "",
    alt_greetings: [] as string[],
    example_dialogue: "",
    scenario: "",
    post_history: "",
    persona: "",
    avatar: "",
    background: "",
    voice: "",
    lorebooks: [] as string[],
    model: { provider: null, model: null },
    tools: "*",
    skills: "*",
    privilege: "confirm",
    compaction: null,
    max_iterations: 20,
    max_repeat_calls: 3,
    max_calls_per_tool: 10,
    max_stall_iterations: 3,
    max_subagent_depth: 2,
    max_concurrent_subagents: 3,
    ...over,
  };
}

function renderRow(
  opts: { name?: string; over?: Record<string, unknown>; roleplay?: Record<string, unknown> } = {},
) {
  const name = opts.name ?? "lyra";
  h.agent = agentDef({ name, ...opts.over });
  h.roleplay = opts.roleplay ?? {};
  return render(
    <AgentRow
      name={name}
      isDefault={name === "default"}
      isSetDefault={false}
      open
      onToggle={() => undefined}
      toolNames={["web_search", "wake", "memory"]}
      toolModes={{}}
      skillNames={[]}
      defaultPrompt=""
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const button = (name: string) => screen.getByRole("button", { name });
const queryButton = (name: string) => screen.queryByRole("button", { name });

describe("AgentRow · the card export (§15.3)", () => {
  it("a SAVED agent offers `export`, which opens in place onto PNG card / JSON card", () => {
    renderRow();
    const exp = button("export");
    expect(exp).toHaveProperty("disabled", false);
    fireEvent.click(exp);
    const group = screen.getByRole("group", { name: "Export as" });
    expect([...group.querySelectorAll("button")].map((b) => b.textContent)).toEqual([
      "cancel",
      "PNG card",
      "JSON card",
    ]);
    // focus lands on the first format — the button that opened the chooser is gone
    expect(document.activeElement).toBe(button("PNG card"));
    // remove/save are hidden while choosing; cancel puts them back
    expect(queryButton("remove")).toBeNull();
    fireEvent.click(button("cancel"));
    expect(button("remove")).toBeTruthy();
    expect(queryButton("PNG card")).toBeNull();
  });

  it("each format calls the export once and closes the chooser", () => {
    renderRow();
    fireEvent.click(button("export"));
    fireEvent.click(button("PNG card"));
    expect(h.exportCard).toHaveBeenCalledWith("png");
    expect(queryButton("PNG card")).toBeNull();
    fireEvent.click(button("export"));
    fireEvent.click(button("JSON card"));
    expect(h.exportCard).toHaveBeenLastCalledWith("json");
    expect(h.exportCard).toHaveBeenCalledTimes(2);
  });

  it("Escape closes the chooser without exporting", () => {
    renderRow();
    fireEvent.click(button("export"));
    fireEvent.keyDown(button("PNG card"), { key: "Escape" });
    expect(queryButton("PNG card")).toBeNull();
    expect(h.exportCard).not.toHaveBeenCalled();
  });

  it("a DIRTY form says `save first` and cannot export — the server composes from disk", () => {
    renderRow();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Lyra II" } });
    const gated = button("save first");
    expect(gated).toHaveProperty("disabled", true);
    expect(queryButton("export")).toBeNull();
  });

  it("an edit made WITH the chooser open drops back to `save first`", () => {
    renderRow();
    fireEvent.click(button("export"));
    act(() => {
      fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Lyra II" } });
    });
    expect(queryButton("PNG card")).toBeNull();
    expect(button("save first")).toHaveProperty("disabled", true);
  });

  it("the ROOT agent exports too (it has no remove, but the same footer)", () => {
    renderRow({ name: "default" });
    expect(queryButton("remove")).toBeNull();
    fireEvent.click(button("export"));
    fireEvent.click(button("JSON card"));
    expect(h.exportCard).toHaveBeenCalledWith("json");
  });
});

describe("AgentRow · the delete confirm tells the truth (ISS-24, §15.6)", () => {
  it("memories go; books and art stay; broken automations are reported after", async () => {
    h.confirm.mockResolvedValue(true);
    renderRow();
    fireEvent.click(button("remove"));
    await waitFor(() => expect(h.deleteAgent).toHaveBeenCalled());
    const req = h.confirm.mock.calls[0][0] as { title: string; body: string };
    expect(req.title).toBe("Remove agent Lyra?");
    expect(req.body).toBe(
      "Deletes its folder (agent.yaml, SOUL.md) and its memory folder. The lorebooks and art it uses are kept. An automation pinned to it stops working — the report names any.",
    );
    expect(h.deleteAgent.mock.calls[0][0]).toBe("lyra");
  });
});

describe("AgentRow · ISS-23 — the duties flip seeds a character's tools (§15.6)", () => {
  const talk = () => fireEvent.click(button("Talk"));
  const savedTools = () => {
    fireEvent.click(button("save"));
    return (h.saveAgent.mock.calls[0][0] as { agent: { tools: unknown } }).agent.tools;
  };

  it("agent → conversational at tools `*` takes roleplay.default_tools — VISIBLE and editable before save", () => {
    renderRow({ roleplay: { default_tools: ["web_search", "memory"] } });
    expect(screen.getByText("all agent tools")).toBeTruthy();
    talk();
    // the grid opened on the seeded pair: the owner sees (and can change) the list before saving
    expect(screen.getByText("2 selected")).toBeTruthy();
    fireEvent.click(button("wake")); // editable — tick one more
    expect(savedTools()).toEqual(["web_search", "memory", "wake"]);
  });

  it("the knob's own default applies when the settings doc states none", () => {
    renderRow();
    talk();
    expect(savedTools()).toEqual(["web_search"]);
  });

  it("never over an EXPLICIT list", () => {
    renderRow({ over: { tools: ["wake"] }, roleplay: { default_tools: ["web_search"] } });
    talk();
    expect(savedTools()).toEqual(["wake"]);
  });

  it("never on the DEFAULT agent's form — its save is every specialist's inheritance", () => {
    renderRow({ name: "default", roleplay: { default_tools: ["web_search"] } });
    talk();
    fireEvent.click(button("save"));
    const patch = h.saveSettings.mock.calls[0][0] as { agent: { defaults: { tools: unknown } } };
    expect(patch.agent.defaults.tools).toBe("*");
  });

  it("TRANSITION-ONLY — a character already at `*` is not rewritten, and re-tapping Talk is no flip", () => {
    renderRow({ over: { duties: "conversational" }, roleplay: { default_tools: ["web_search"] } });
    talk();
    expect(screen.getByText("all agent tools")).toBeTruthy();
    // nothing changed at all: the draft is still clean (export live, save reads "saved")
    expect(button("export")).toHaveProperty("disabled", false);
    expect(button("saved")).toHaveProperty("disabled", true);
  });
});
