import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The agents GALLERY (D70 §8.4) — the section the per-agent editor moved out of Conf into. Drives the
// REAL component over mocked hook boundaries (the composerSteer/chatThread posture) plus the REAL `ui`
// and `chat` stores, because what "Talk" does is a fact about those two and not about this component.

const list = {
  agents: [] as string[],
  default: "default",
  summaries: {} as Record<
    string,
    { title: string; description: string; avatar: string; background: string; voice: string }
  >,
};

vi.mock("../../src/hooks/useAgents", async (importActual) => {
  const actual = await importActual<typeof import("../../src/hooks/useAgents")>();
  return {
    ...actual,
    useAgentList: () => ({ data: list }),
    useAgentRoster: () => ({ data: list }), // what `useAgentArt` joins against

    useAgent: () => ({
      data: {
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
        },
      },
      isLoading: false,
    }),
    useSaveAgent: () => ({ mutate: vi.fn(), isPending: false }),
    useDeleteAgent: () => ({ mutate: vi.fn(), isPending: false }),
    useSaveAgentSoul: () => ({ mutate: vi.fn() }),
  };
});
vi.mock("../../src/hooks/useMedia", () => ({
  // No agent art anywhere: a fresh install ships none, which is the state the placeholder tile is for.
  useMediaIndex: () => ({ data: { ns: "agents", roles: {}, slots: {} } }),
}));
vi.mock("../../src/hooks/useActions", () => ({
  useAgentToolGrid: () => ({ toolNames: [], toolModes: {} }),
}));
vi.mock("../../src/hooks/useSkills", () => ({ useSkills: () => ({ data: [] }) }));
vi.mock("../../src/hooks/useDefaultPrompt", () => ({ useDefaultPrompt: () => ({ data: "" }) }));
vi.mock("../../src/hooks/useSettings", () => ({
  useProviders: () => ({ data: { providers: {}, verbs: [], warnings: [] } }),
  useSaveSettings: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { AgentsTab } from "../../src/tabs/AgentsTab";
import { getSessionAgent, setSessionAgent } from "../../src/store/chat";
import { getUI, setUI } from "../../src/store/ui";

const cards = () => screen.getAllByRole("button", { name: /Talk to/ });
/** The open row calls `useQueryClient` for its own invalidations — a real (unused) client is enough. */
const render = (ui: ReactElement) =>
  rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

beforeEach(() => {
  list.agents = [];
  list.default = "default";
  list.summaries = {};
  setSessionAgent(null);
  setUI({ theme: "minimal", tab: "agents", layout: "auto", appbarMode: "visible" });
});
afterEach(cleanup);

describe("AgentsTab · the card grid", () => {
  it("a fresh install shows the default agent's card — never an empty grid", () => {
    render(<AgentsTab active />);
    expect(cards()).toHaveLength(1);
    expect(document.querySelector(".agal-name")?.textContent).toBe("default");
    expect(screen.getByText("default agent · workspace root")).toBeTruthy();
  });

  it("lists the default FIRST, then the list route's order, and badges the resolved default", () => {
    list.agents = ["scout", "coder"];
    list.default = "scout";
    list.summaries = {
      scout: { title: "Scout", description: "finds things", avatar: "", background: "", voice: "" },
    };
    render(<AgentsTab active />);
    expect(cards().map((b) => b.getAttribute("aria-label"))).toEqual([
      "Talk to default",
      "Talk to Scout",
      "Talk to coder",
    ]);
    // The summary's title and description are what the plate shows (the ONE summary+media join).
    expect(screen.getByText("finds things")).toBeTruthy();
    // …and the DEFAULT badge follows the resolved default, not the root slug.
    const badge = document.querySelector(".agal-badge");
    expect(badge?.closest(".agal-cell")?.textContent).toContain("Scout");
  });

  it("no avatar → the quiet initial tile (the app ships no character art)", () => {
    list.agents = ["scout"];
    list.summaries = {
      scout: { title: "Scout", description: "", avatar: "", background: "", voice: "" },
    };
    render(<AgentsTab active />);
    expect(document.querySelectorAll(".agal-img")).toHaveLength(0);
    expect([...document.querySelectorAll(".agal-mono")].map((n) => n.textContent)).toEqual([
      "D",
      "S",
    ]);
  });
});

describe("AgentsTab · the two verbs", () => {
  it("TALK pins the session agent and lands on the chat section", () => {
    list.agents = ["scout"];
    render(<AgentsTab active />);
    fireEvent.click(screen.getByRole("button", { name: "Talk to scout" }));
    expect(getSessionAgent()).toBe("scout"); // the `/agent <name>` seam, not a second pinning path
    expect(getUI().tab).toBe("agent");
  });

  it("TALK on the RESOLVED DEFAULT clears the pin (bare `/agent`), rather than pinning its name", () => {
    list.agents = ["scout"];
    list.default = "scout";
    setSessionAgent("coder");
    render(<AgentsTab active />);
    fireEvent.click(screen.getByRole("button", { name: "Talk to scout" }));
    expect(getSessionAgent()).toBeNull();
  });

  it("a card TAP opens that agent's editor — the very row the list has always opened", () => {
    render(<AgentsTab active />);
    expect(screen.queryByLabelText("Max output tokens")).toBeNull();
    fireEvent.click(screen.getByText("default agent · workspace root"));
    expect(screen.getByLabelText("Max output tokens")).toBeTruthy(); // AgentFieldsForm is up
    fireEvent.click(screen.getByRole("button", { name: "‹ all agents" }));
    expect(screen.queryByLabelText("Max output tokens")).toBeNull(); // back to the grid
  });
});
