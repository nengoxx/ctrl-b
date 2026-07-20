import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ActionSpec, ApprovalRule } from "../../src/types";

// ToolCatalog · the D44 W3 approvals ('always allow') editor. The catalog reconstructs its whole state
// from the `["actions"]` DTO (incl. the new `approvals` list); every edit folds into a per-tool draft
// and the ONE `useSaveToolOverrides` write. We stub those two hooks + `requestPrompt`, drive the REAL
// editor through its DOM, and assert the FULL replacement approvals list that reaches the mutation.

const h = vi.hoisted(() => ({ save: vi.fn() }));

function spec(over: Partial<ActionSpec> = {}): ActionSpec {
  return {
    name: "restart_service",
    title: "Restart service",
    description: "restart a systemd service",
    icon: null,
    category: "action",
    risk: "med",
    confirm: false,
    retry_safe: false,
    ui_exposed: false,
    agent_exposed: true,
    core: false,
    default_agent_mode: "enabled",
    approvals: [{ args: { service_id: "ghost" } }],
    input_schema: {},
    ...over,
  };
}

let specs: ActionSpec[] = [];

vi.mock("../../src/hooks/useActions", () => ({
  useActionSpecs: () => ({ data: specs }),
  agentModeOf: (s: ActionSpec) => (s.core ? "core" : s.agent_exposed ? "enabled" : "disabled"),
}));
vi.mock("../../src/hooks/useToolOverrides", () => ({
  useSaveToolOverrides: () => ({ mutate: h.save, isPending: false }),
}));
vi.mock("../../src/store/prompt", () => ({ requestPrompt: vi.fn() }));

import { ToolCatalog } from "../../src/components/ToolCatalog";

afterEach(() => {
  cleanup();
  h.save.mockReset();
  specs = [];
});

/** The saved approvals list for a tool from the first mutate call. */
function savedApprovals(tool: string): ApprovalRule[] | undefined {
  const overrides = h.save.mock.calls[0][0] as Record<string, { approvals?: ApprovalRule[] }>;
  return overrides[tool]?.approvals;
}

const saveBtn = () => screen.getByRole("button", { name: /Save|Saved/ });

describe("ToolCatalog · approvals editor (D44 W3)", () => {
  it("lists the tool's existing rules as field=pattern chips", () => {
    specs = [spec()];
    render(<ToolCatalog />);
    expect(screen.getByText("service_id=ghost")).toBeTruthy();
    expect(screen.getByText("always-allow rules")).toBeTruthy();
  });

  it("renders a rule with no args as 'any args'", () => {
    specs = [spec({ approvals: [{ args: null }] })];
    render(<ToolCatalog />);
    expect(screen.getByText("any args")).toBeTruthy();
  });

  it("revoke removes the rule from the saved payload (full replacement list)", () => {
    specs = [spec()];
    render(<ToolCatalog />);
    fireEvent.click(screen.getByLabelText("revoke rule"));
    // the chip is gone from the live view, and the tool is now 'changed' → Save enabled
    expect(screen.queryByText("service_id=ghost")).toBeNull();
    fireEvent.click(saveBtn());
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(savedApprovals("restart_service")).toEqual([]); // the whole list, minus the revoked rule
  });

  it("add appends a new rule (existing rules preserved) via the one mutation", () => {
    specs = [spec()];
    render(<ToolCatalog />);
    fireEvent.change(screen.getByLabelText("rule field"), { target: { value: "cmd" } });
    fireEvent.change(screen.getByLabelText("rule pattern"), { target: { value: "ls*" } });
    fireEvent.click(screen.getByText("add rule"));
    // the new chip renders alongside the original
    expect(screen.getByText("cmd=ls*")).toBeTruthy();
    expect(screen.getByText("service_id=ghost")).toBeTruthy();
    fireEvent.click(saveBtn());
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(savedApprovals("restart_service")).toEqual([
      { args: { service_id: "ghost" } },
      { args: { cmd: "ls*" } },
    ]);
  });

  it("an add form with no field yields a whole-action 'any args' grant", () => {
    specs = [spec({ approvals: [] })];
    render(<ToolCatalog />);
    fireEvent.click(screen.getByText("add rule")); // empty form → widen to any-args
    expect(screen.getByText("any args")).toBeTruthy();
    fireEvent.click(saveBtn());
    expect(savedApprovals("restart_service")).toEqual([{ args: null }]);
  });

  it("hides the editor for a designer forced-confirm tool (un-approvable, invariant 2)", () => {
    specs = [spec({ name: "shutdown_host", confirm: true, approvals: [] })];
    render(<ToolCatalog />);
    expect(screen.queryByText("always-allow rules")).toBeNull();
  });

  it("no approval edit → Save stays disabled (Saved)", () => {
    specs = [spec()];
    render(<ToolCatalog />);
    // untouched → the button reads "Saved" and is disabled
    const btn = within(screen.getByText(/Saved/).closest("button")!).getByText(/Saved/);
    expect(btn).toBeTruthy();
    expect((screen.getByText(/Saved/).closest("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
