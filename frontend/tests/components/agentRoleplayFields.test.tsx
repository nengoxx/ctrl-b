import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// D70 §9 — the CHARACTER half of the agent form: the per-field visibility predicate, and the fields
// that have no editor but must survive a save untouched. Drives the REAL `AgentRow` over mocked hook
// boundaries (the agentsEditorCompaction posture).

const h = vi.hoisted(
  (): {
    saveAgent: ReturnType<typeof vi.fn>;
    roleplayEnabled: boolean;
    agent: Record<string, unknown>;
    books: { slug: string; name: string; enabled: boolean; entries: number }[];
  } => ({
    saveAgent: vi.fn(),
    roleplayEnabled: false,
    agent: {},
    books: [],
  }),
);

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));
vi.mock("../../src/hooks/useSettings", () => ({
  useSaveSettings: () => ({ mutate: vi.fn(), isPending: false }),
  useProviders: () => ({ data: { providers: {}, verbs: [], warnings: [] } }),
  useSettings: () => ({ data: { roleplay: { enabled: h.roleplayEnabled } } }),
}));
vi.mock("../../src/hooks/useMediaLibrary", () => ({
  useMediaLibrary: () => ({ sections: [], write: { append: vi.fn() }, ready: false }),
}));
// D70 §6.5 — the form's lorebook picker reads the shelf. `pickRoleplay` stays REAL (the visibility
// predicate is a fact about the settings doc, not about this mock).
vi.mock("../../src/hooks/useRoleplay", async (importActual) => ({
  ...(await importActual<typeof import("../../src/hooks/useRoleplay")>()),
  useLorebooks: () => ({ data: h.books }),
}));
vi.mock("../../src/hooks/useAgents", async (importActual) => {
  const actual = await importActual<typeof import("../../src/hooks/useAgents")>();
  return {
    ...actual,
    // Arg-sensitive, as the real hook is: a CLOSED row calls `useAgent(null)` and gets no data —
    // the exact baseline-vanishes case the collapsed-dirty pin below exists to exercise.
    useAgent: (name: string | null) =>
      name
        ? {
            data: { name: "lyra", is_default: false, soul: "", agent: h.agent },
            isLoading: false,
          }
        : { data: undefined, isLoading: false },
    useSaveAgent: () => ({ mutate: h.saveAgent, isPending: false }),
    useDeleteAgent: () => ({ mutate: vi.fn(), isPending: false }),
    useSaveAgentSoul: () => ({ mutate: vi.fn() }),
  };
});

import { AgentRow, roleplayFieldVisible } from "../../src/components/AgentsEditor";
import { isAnyDirty } from "../../src/store/dirty";

/** A specialist as the file API hands it back — every D70 field present, all empty by default. */
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
    user_name: "",
    avatar: "",
    background: "",
    voice: "",
    lorebooks: [] as string[],
    card: {},
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
  over: Record<string, unknown> = {},
  enabled = false,
  books: typeof h.books = [],
) {
  h.agent = agentDef(over);
  h.roleplayEnabled = enabled;
  h.books = books;
  return render(
    <AgentRow
      name="lyra"
      isDefault={false}
      isResolvedDefault={false}
      open
      onToggle={() => undefined}
      toolNames={[]}
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

describe("roleplayFieldVisible (the Risu predicate, §9)", () => {
  it("the mode ON shows every field, whatever it holds", () => {
    expect(roleplayFieldVisible(true, "")).toBe(true);
    expect(roleplayFieldVisible(true, {})).toBe(true);
  });

  it("the mode OFF shows only what is POPULATED — per value SHAPE", () => {
    expect(roleplayFieldVisible(false, "")).toBe(false);
    expect(roleplayFieldVisible(false, "   ")).toBe(false); // whitespace is not content
    expect(roleplayFieldVisible(false, "hi")).toBe(true);
    expect(roleplayFieldVisible(false, [])).toBe(false);
    expect(roleplayFieldVisible(false, ["book"])).toBe(true);
    expect(roleplayFieldVisible(false, {})).toBe(false);
    expect(roleplayFieldVisible(false, { name: "x" })).toBe(true);
    expect(roleplayFieldVisible(false, undefined)).toBe(false);
  });
});

describe("AgentRow · the roleplay fields on the form", () => {
  it("mode OFF + everything empty → no roleplay field renders (today's compact form)", () => {
    renderRow();
    expect(screen.queryByText("Greeting")).toBeNull();
    expect(screen.queryByText("Scenario")).toBeNull();
    expect(screen.queryByLabelText("Voice")).toBeNull();
    expect(screen.queryByText("Avatar")).toBeNull();
  });

  it("mode OFF + a POPULATED field → that field alone lights up (an imported card)", () => {
    renderRow({ greeting: "Hello there.", voice: "af_sky" });
    expect(screen.getByText("Greeting")).toBeTruthy();
    expect(screen.getByLabelText<HTMLInputElement>("Voice").value).toBe("af_sky");
    expect(screen.queryByText("Scenario")).toBeNull(); // still empty → still hidden
  });

  it("mode ON → every field renders, empty or not", () => {
    renderRow({}, true);
    for (const label of [
      "Greeting",
      "Example dialogue",
      "Scenario",
      "Post-history",
      "Avatar",
      "Backdrop",
    ])
      expect(screen.getByText(label), label).toBeTruthy();
    expect(screen.getByLabelText("Your name")).toBeTruthy();
    expect(screen.getByLabelText("Voice")).toBeTruthy();
  });

  it("the PROMPT-shaped fields take the full-width row face; the one-liners keep label-left", () => {
    // §13-S6b wave 2, the owner's ruling: the 104px label column is right for one-line inputs, Segs and
    // switches, and wrong for the prompt-shaped fields and the two art rows — those take Conf →
    // Prompts' presentation (`components/PromptRowFace`). The GRID SPAN is CSS; what is structural, and
    // what this pins, is which face each field wears.
    renderRow({}, true);
    const form = document.querySelector(".mform");
    const rowOf = (label: string) =>
      [...(form?.querySelectorAll(".prow") ?? [])].find(
        (r) => r.querySelector(".prow-name")?.textContent === label,
      );
    for (const label of [
      "Persona · SOUL.md",
      "Prompt append",
      "Greeting",
      "Example dialogue",
      "Scenario",
      "Post-history",
      "Avatar",
      "Backdrop",
    ])
      expect(rowOf(label), label).toBeTruthy();
    // The marked help is the row's DESCRIPTION now, not a `.mfhelp` line trailing the control…
    expect(rowOf("Greeting")?.querySelector(".prow-desc")?.textContent).toContain(
      "opens a fresh thread",
    );
    // …the preview IS the opener, and the art row's body is the picture-as-button.
    expect(rowOf("Greeting")?.querySelector(".prow-preview")).toBeTruthy();
    expect(rowOf("Avatar")?.querySelector(".agart-face")).toBeTruthy();
    // The old idiom is gone from this form entirely — nothing here opens "fullscreen" any more.
    expect(form?.querySelector(".kv-prompt")).toBeNull();
    // …and every one-line field is untouched: a bare <label> in the grid's own left column, its input
    // beside it.
    for (const label of ["Display name", "Your name", "Voice"]) {
      const l = [...(form?.querySelectorAll(":scope > label") ?? [])].find(
        (n) => n.textContent === label,
      );
      expect(l, label).toBeTruthy();
      expect(l?.nextElementSibling?.tagName, label).toBe("INPUT");
    }
  });

  it("DUTIES is always visible — an agent fact, not a roleplay extra", () => {
    renderRow();
    expect(screen.getByText("Duties")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Talk" })).toBeTruthy();
  });

  it("the import STASH gets a read-only line, never an editor", () => {
    renderRow({ card: { spec: "chara_card_v2", data: { name: "Lyra" } } });
    expect(screen.getByText(/2 imported fields stashed/)).toBeTruthy();
  });

  it("alt_greetings has NO editor and survives a save untouched", () => {
    renderRow({ alt_greetings: ["hi", "hey"], lorebooks: ["lyra-book"], greeting: "Hello." }, true);
    // No editor — it round-trips through `pickFields`, nothing more.
    expect(screen.queryByText("Alt greetings")).toBeNull();

    fireEvent.change(screen.getByLabelText("Voice"), { target: { value: "af_sky" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));

    const sent = h.saveAgent.mock.calls[0][0] as { agent: Record<string, unknown> };
    expect(sent.agent.voice).toBe("af_sky"); // the edit
    expect(sent.agent.alt_greetings).toEqual(["hi", "hey"]); // …and the untouched neighbours
    expect(sent.agent.greeting).toBe("Hello.");
  });

  it("the LOREBOOK picker is visible with roleplay OFF — books are roleplay-INDEPENDENT (ruling 9)", () => {
    renderRow({}, false, [{ slug: "hollow-sea", name: "Hollow Sea", enabled: true, entries: 3 }]);
    expect(screen.getByText("Lorebooks")).toBeTruthy();
    // …drawn by the book's NAME while the value stays its slug
    expect(screen.getByRole("button", { name: "Hollow Sea" })).toBeTruthy();
    expect(screen.getByText("0 attached")).toBeTruthy();
  });

  it("ticking a book writes its SLUG into the draft — and the chip SAYS it is ticked", () => {
    renderRow({}, false, [{ slug: "hollow-sea", name: "Hollow Sea", enabled: true, entries: 3 }]);
    const chip = screen.getByRole("button", { name: "Hollow Sea" });
    // A tick chip is a two-state toggle: `on` is a class a screen reader cannot see, `aria-pressed`
    // is the fact. All four TickGrid surfaces (tools · skills · roleplay tools · books) get it.
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    const sent = h.saveAgent.mock.calls[0][0] as { agent: Record<string, unknown> };
    expect(sent.agent.lorebooks).toEqual(["hollow-sea"]);
  });

  it("an attached book the shelf no longer lists still renders, and an unrelated save keeps it", () => {
    renderRow({ lorebooks: ["deleted-book"] }, false, []);
    const chip = screen.getByRole("button", { name: "deleted-book" });
    // marked missing rather than hidden — hiding it would delete the attachment on the next save
    expect(chip.className).toContain("gone");
    expect(chip.className).toContain("on");
    expect(chip.getAttribute("title")).toBe("not found — untick to remove it");

    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Lyra II" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    const sent = h.saveAgent.mock.calls[0][0] as { agent: Record<string, unknown> };
    expect(sent.agent.lorebooks).toEqual(["deleted-book"]);
  });

  it("the DUTIES pick round-trips through the save payload", () => {
    renderRow();
    fireEvent.click(screen.getByRole("button", { name: "Talk" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    const sent = h.saveAgent.mock.calls[0][0] as { agent: Record<string, unknown> };
    expect(sent.agent.duties).toBe("conversational");
  });
});

describe("AgentRow · dirty survives a collapse (the S5 F1 twin — fix rider)", () => {
  const row = (open: boolean) => (
    <AgentRow
      name="lyra"
      isDefault={false}
      isResolvedDefault={false}
      open={open}
      onToggle={() => undefined}
      toolNames={[]}
      toolModes={{}}
      skillNames={[]}
      defaultPrompt=""
    />
  );

  it("an edited then COLLAPSED row still registers dirty — the row never unmounted", () => {
    h.agent = agentDef();
    h.roleplayEnabled = false;
    h.books = [];
    expect(isAnyDirty()).toBe(false);
    const view = render(row(true));
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Lyra II" } });
    expect(isAnyDirty()).toBe(true);

    // Collapse: the real hook now hands back NO data (`useAgent(null)`), so a dirty compare
    // against `detail` would go vacuously clean — the seeded snapshot must carry it instead.
    view.rerender(row(false));
    expect(screen.queryByLabelText("Display name")).toBeNull(); // the form really is closed…
    expect(isAnyDirty()).toBe(true); // …and the draft it still holds is still unsaved
  });
});
