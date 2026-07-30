import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  Automation,
  AutomationRun,
  AutomationsDoc,
  AutomationView,
  SchedulePreview,
} from "../../src/hooks/useAutomations";

// A3 slice 3 — Conf › Automations. What is worth pinning is what the spec argues about: the LIST row
// tells the truth at a glance (status chip + next-fire echo + a switch that toggles WITHOUT opening the
// editor), the editor opens in a SHEET, the schedule presets write the one stored 5-field cron (with the
// not-representable note when they cannot express it), and — post-14c review — the sheet can open a
// ConfirmDialog ON TOP of itself, guards a dirty close, and retries a failed mark-read.
//
// The mutation/query boundary is mocked (the machineEditor* precedent) and the REAL component DOM is
// driven, so what is under test is the panel's own wiring, not TanStack's.

const h = vi.hoisted(() => ({
  doc: null as unknown as AutomationsDoc,
  runs: [] as AutomationRun[],
  preview: null as unknown as SchedulePreview | undefined,
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  setEnabled: vi.fn(),
  runNow: vi.fn(),
  markRead: vi.fn(),
}));

vi.mock("../../src/hooks/useAutomations", async (importActual) => {
  const actual = await importActual<typeof import("../../src/hooks/useAutomations")>();
  return {
    ...actual,
    useAutomations: () => ({ data: h.doc }),
    useAutomationRuns: (id: string | null) => ({ data: id ? h.runs : undefined }),
    useSchedulePreview: () => ({ data: h.preview }),
    useCreateAutomation: () => ({ mutate: h.create, isPending: false }),
    useUpdateAutomation: () => ({ mutate: h.update, isPending: false }),
    useDeleteAutomation: () => ({ mutate: h.remove, isPending: false }),
    useSetAutomationEnabled: () => ({ mutate: h.setEnabled, isPending: false }),
    useRunAutomationNow: () => ({ mutate: h.runNow, isPending: false }),
    // `async` so a test-thrown error becomes a REJECTION, matching the real `mutateAsync` — the
    // component chains `.catch` on it (per-promise, not `mutate` options: see the R2 M2 note there).
    useMarkRunRead: () => ({
      mutateAsync: async (v: unknown): Promise<void> => {
        h.markRead(v); // a test-thrown error becomes a rejection here, matching the real mutateAsync
      },
      isPending: false,
    }),
  };
});
vi.mock("../../src/hooks/useAgents", () => ({
  useAgentList: () => ({ data: { agents: ["ops"], default: "default" } }),
}));

import { ConfirmDialog } from "../../src/components/ConfirmDialog";
import { AutomationsPanel } from "../../src/components/AutomationsPanel";

function mkAutomation(over: Partial<Automation> = {}): Automation {
  return {
    id: "a1",
    name: "nightly",
    schedule: "0 3 * * *",
    tz: "UTC",
    prompt: "check the fleet",
    enabled: true,
    agent: null,
    privilege: null,
    question_policy: "use_default",
    thread_mode: "fresh",
    thread_id: null,
    timeout_s: null,
    next_run_at: "2030-01-01T03:00:00+00:00",
    rev: 1,
    created_at: "2026-07-30T00:00:00+00:00",
    updated_at: "2026-07-30T00:00:00+00:00",
    ...over,
  };
}

function mkRun(over: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "r1",
    automation_id: "a1",
    trigger: "scheduled",
    scheduled_for: "2026-07-30T03:00:00+00:00",
    started_at: "2026-07-30T03:00:00+00:00",
    finished_at: "2026-07-30T03:00:04+00:00",
    status: "ok",
    error: null,
    thread_id: "t1",
    read_at: null,
    ...over,
  };
}

function mkView(over: Partial<AutomationView> = {}): AutomationView {
  return {
    automation: mkAutomation(),
    schedule_text: "At 03:00",
    next_fires: ["2030-01-01T03:00:00+00:00"],
    last_run: null,
    unread_runs: 0,
    running: false,
    ...over,
  };
}

function setDoc(views: AutomationView[], over: Partial<AutomationsDoc> = {}) {
  h.doc = {
    automations: views,
    enabled: true,
    busy: false,
    max_count: 20,
    server_tz: "Europe/Madrid",
    default_timeout_s: 300,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  for (const fn of [h.create, h.update, h.remove, h.setEnabled, h.runNow, h.markRead])
    fn.mockReset();
  h.runs = [];
  h.preview = undefined;
});

describe("the list", () => {
  it("shows the human schedule, the next fire and the last run's status chip", () => {
    setDoc([
      mkView({ last_run: mkRun({ status: "error", error: "boom" }), unread_runs: 2 }),
      mkView({
        automation: mkAutomation({ id: "a2", name: "weekly", enabled: false }),
        next_fires: [],
        schedule_text: "At 09:00 on Monday",
      }),
    ]);
    render(<AutomationsPanel />);

    expect(screen.getByText(/At 03:00 · next /)).toBeTruthy();
    expect(screen.getByText("error").className).toContain("stale"); // a failure is the danger badge
    expect(screen.getByText("2 new")).toBeTruthy(); // the unread badge
    // A disabled row says so and offers no upcoming time it will never honour.
    expect(screen.getByText("At 09:00 on Monday · off")).toBeTruthy();
  });

  it("a running automation reads `running`, not its previous verdict", () => {
    setDoc([mkView({ running: true, last_run: mkRun({ status: "ok" }) })]);
    render(<AutomationsPanel />);
    expect(screen.getByText("running")).toBeTruthy();
    expect(screen.queryByText("ok")).toBeNull();
  });

  it("the row switch toggles WITHOUT opening the editor sheet", () => {
    setDoc([mkView()]);
    render(<AutomationsPanel />);
    fireEvent.click(screen.getByRole("switch", { name: "nightly enabled" }));
    expect(h.setEnabled).toHaveBeenCalledWith({ id: "a1", enabled: false });
    expect(screen.queryByRole("dialog")).toBeNull(); // the click did not bubble into the row
  });

  it("the row opens the editor sheet, seeded from the stored automation", () => {
    setDoc([mkView()]);
    render(<AutomationsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "edit nightly" }));
    const sheet = screen.getByRole("dialog");
    expect(within(sheet).getByLabelText("Name")).toHaveProperty("value", "nightly");
    expect(within(sheet).getByLabelText("Prompt")).toHaveProperty("value", "check the fleet");
  });

  it("refuses to open the create sheet once the cap is reached, and says why", () => {
    setDoc([mkView()], { max_count: 1 });
    render(<AutomationsPanel />);
    expect(screen.getByText("limit reached (1) — delete one first")).toBeTruthy();
    fireEvent.click(screen.getByText("new automation"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the editor sheet", () => {
  function openEditor(view = mkView()) {
    setDoc([view]);
    render(<AutomationsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "edit nightly" }));
    return screen.getByRole("dialog");
  }

  it("seeds the schedule preset from the stored cron and rewrites it when a preset is picked", () => {
    const sheet = openEditor();
    // `0 3 * * *` is a Daily preset, so the time input is the one on show.
    expect(within(sheet).getByLabelText("At")).toHaveProperty("value", "03:00");

    fireEvent.click(within(sheet).getByRole("button", { name: "Weekly" }));
    fireEvent.change(within(sheet).getByLabelText("At"), { target: { value: "18:30" } });
    fireEvent.change(within(sheet).getByLabelText("On"), { target: { value: "5" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    const arg = h.update.mock.calls[0][0] as { id: string; draft: { schedule: string } };
    expect(arg.id).toBe("a1");
    expect(arg.draft.schedule).toBe("30 18 * * 5");
  });

  it("falls back to the raw-cron field with the not-representable warning", () => {
    const sheet = openEditor(
      mkView({ automation: mkAutomation({ schedule: "0 3 * * 1-5" }), schedule_text: "weekdays" }),
    );
    expect(within(sheet).getByLabelText("cron expression")).toHaveProperty("value", "0 3 * * 1-5");
    expect(within(sheet).getByText(/isn't one of the presets/)).toBeTruthy();
  });

  it("renders the server's preview inline — its echo when valid, its message when not", () => {
    h.preview = {
      valid: true,
      error: null,
      field: null,
      tz: "UTC",
      describe: "At 03:00",
      next_fires: ["2030-01-01T03:00:00+00:00"],
    };
    let sheet = openEditor();
    expect(within(sheet).getByText(/At 03:00 \(UTC\)/)).toBeTruthy();

    cleanup();
    h.preview = {
      valid: false,
      error: "invalid cron expression: bad minute",
      field: "schedule",
      tz: "UTC",
      describe: null,
      next_fires: [],
    };
    sheet = openEditor();
    expect(within(sheet).getByText("invalid cron expression: bad minute")).toBeTruthy();
  });

  it("states that confirmations are NOT covered by the question policy", () => {
    const sheet = openEditor();
    expect(within(sheet).getByText(/privilege \/ approvals ladder/)).toBeTruthy();
  });

  it("greys run-now while the runner is busy, and runs it otherwise", () => {
    setDoc([mkView()], { busy: true });
    render(<AutomationsPanel />);
    fireEvent.click(screen.getByRole("button", { name: "edit nightly" }));
    const busyBtn = screen.getByRole("button", { name: "runner busy" });
    expect(busyBtn).toHaveProperty("disabled", true);

    cleanup();
    const sheet = openEditor();
    fireEvent.click(within(sheet).getByRole("button", { name: "run now" }));
    expect(h.runNow).toHaveBeenCalledWith("a1");
  });

  it("blocks the save until name, schedule and prompt are all present", () => {
    const sheet = openEditor();
    fireEvent.change(within(sheet).getByLabelText("Prompt"), { target: { value: "  " } });
    expect(within(sheet).getByRole("button", { name: "save" })).toHaveProperty("disabled", true);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("opening the history marks its unread runs read — exactly once each", () => {
    h.runs = [mkRun(), mkRun({ id: "r2", read_at: "2026-07-30T04:00:00+00:00" })];
    const sheet = openEditor();
    fireEvent.click(within(sheet).getByText(/^History/));
    expect(h.markRead).toHaveBeenCalledTimes(1);
    expect(h.markRead.mock.calls[0][0]).toEqual({ runId: "r1", automationId: "a1" });
    expect(within(sheet).getAllByRole("button", { name: "Open thread ↗" })).toHaveLength(2);
    // A re-render (the invalidation a mark-read triggers, or a close/re-open) must not re-POST it.
    fireEvent.click(within(sheet).getByText(/^History/));
    fireEvent.click(within(sheet).getByText(/^History/));
    expect(h.markRead).toHaveBeenCalledTimes(1);
  });

  it("a FAILED mark-read is retried on the next change, not remembered as done", async () => {
    h.runs = [mkRun()];
    // The dedupe set is written BEFORE the call (so a mid-flight re-render can't double-POST); the
    // per-promise `.catch` has to take it back out, or a transient error leaves the row unread forever.
    h.markRead.mockImplementationOnce(() => {
      throw new Error("net");
    });
    const sheet = openEditor();
    fireEvent.click(within(sheet).getByText(/^History/));
    expect(h.markRead).toHaveBeenCalledTimes(1);
    await act(async () => {}); // flush the rejection's catch — the id leaves the dedupe set
    fireEvent.click(within(sheet).getByText(/^History/)); // close…
    fireEvent.click(within(sheet).getByText(/^History/)); // …and re-open: it tries again
    expect(h.markRead).toHaveBeenCalledTimes(2);
  });
});

describe("the sheet's overlay layering + close guard (post-14c review)", () => {
  function openEditor(view = mkView()) {
    setDoc([view]);
    render(
      <>
        <AutomationsPanel />
        <ConfirmDialog />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "edit nightly" }));
    return screen.getByRole("dialog");
  }

  it("the delete confirm mounts ON ITS OWN layer, above the sheet", async () => {
    // The bug this pins: both overlays used `.pm-backdrop` (z 60) vs `.modal-backdrop` (z 50), so the
    // confirm the sheet opened rendered BEHIND it — an unreachable dialog with the sheet still on top.
    const sheet = openEditor();
    expect(sheet.parentElement?.className).toContain("auto-pm");

    fireEvent.click(within(sheet).getByRole("button", { name: "delete" }));
    const confirm = await screen.findByText("Delete nightly?");
    const confirmBackdrop = confirm.closest(".modal-backdrop");
    expect(confirmBackdrop).not.toBeNull(); // a DIFFERENT backdrop class → a different z-index layer
    expect(confirmBackdrop?.className).not.toContain("pm-backdrop");
  });

  it("a CLEAN sheet closes immediately; a dirty one asks first", async () => {
    let sheet = openEditor();
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull(); // nothing to lose → no prompt

    cleanup();
    sheet = openEditor();
    fireEvent.change(within(sheet).getByLabelText("Prompt"), { target: { value: "edited" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(await screen.findByText("Discard changes?")).toBeTruthy();
    // …and the sheet is STILL open behind the prompt — the edits are not gone until "discard" is hit.
    expect(within(sheet).getByLabelText("Prompt")).toHaveProperty("value", "edited");
  });

  it("Escape from the sheet routes through the same guard", async () => {
    const sheet = openEditor();
    fireEvent.change(within(sheet).getByLabelText("Name"), { target: { value: "renamed" } });
    fireEvent.keyDown(sheet.parentElement as HTMLElement, { key: "Escape" });
    expect(await screen.findByText("Discard changes?")).toBeTruthy();
  });

  it("Tab is trapped inside the sheet (the shared modal keydown)", () => {
    const sheet = openEditor();
    const name = within(sheet).getByLabelText("Name");
    name.focus();
    fireEvent.keyDown(sheet.parentElement as HTMLElement, { key: "Tab" });
    expect(sheet.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(name);
  });

  it("clamps the hourly minute instead of emitting a cron field the server would refuse", () => {
    const sheet = openEditor();
    fireEvent.click(within(sheet).getByRole("button", { name: "Hourly" }));
    fireEvent.change(within(sheet).getByLabelText("At minute"), { target: { value: "99" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "save" }));
    const arg = h.update.mock.calls[0][0] as { draft: { schedule: string } };
    expect(arg.draft.schedule).toBe("59 * * * *");
  });
});
