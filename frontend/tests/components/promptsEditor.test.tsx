import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PromptInfo, PromptsDoc } from "../../src/types";

// Conf · Prompts (Phase 18 / D56) — the registry editor. State is reconstructed entirely from the
// `["prompts"]` DTO; every edit folds into a per-id draft and the ONE `useSavePromptOverrides` write.
// We stub the two hooks, drive the REAL editor AND the REAL PromptModal through their DOM (the pair
// modal is half the contract — both textareas, the placeholder chips, the coupling note), and assert
// the exact batched payload that reaches the mutation.

const h = vi.hoisted(() => ({ save: vi.fn() }));

function row(over: Partial<PromptInfo> = {}): PromptInfo {
  return {
    id: "memory_intro",
    label: "Memory Intro",
    description: "Frames the durable-memory block injected each turn.",
    default_text: "Context you carry across sessions.",
    override: null,
    append: null,
    current: "Context you carry across sessions.",
    is_customized: false,
    placeholders: [],
    ...over,
  };
}

let doc: PromptsDoc = { prompts: [], warnings: [] };

vi.mock("../../src/hooks/usePrompts", () => ({
  usePrompts: () => ({ data: doc }),
  useSavePromptOverrides: () => ({ mutate: h.save, isPending: false }),
}));

import { PromptModal } from "../../src/components/PromptModal";
import { PromptsEditor } from "../../src/components/PromptsEditor";

afterEach(() => {
  cleanup();
  h.save.mockReset();
  doc = { prompts: [], warnings: [] };
});

const renderEditor = () =>
  render(
    <>
      <PromptsEditor />
      <PromptModal />
    </>,
  );

/** Open a row's pair editor — the preview line is the opener, and the awaited request resolves a
 *  microtask later, so the click has to be flushed. */
async function openRow(label: string) {
  await act(async () => {
    fireEvent.click(
      screen.getByText(new RegExp(label)).closest(".prow")!.querySelector(".prow-preview")!,
    );
  });
}

const saveBtn = () => screen.getByRole("button", { name: /Save|Saved/ });
const savedPayload = () => h.save.mock.calls[0][0] as Record<string, unknown>;

describe("PromptsEditor · the prompt registry section", () => {
  it("renders the rows in DTO (= registry) order", () => {
    doc = {
      prompts: [row(), row({ id: "per_tool_cap", label: "Per Tool Cap" })],
      warnings: [],
    };
    renderEditor();
    const names = [...document.querySelectorAll(".prow-name")].map((n) => n.textContent);
    expect(names).toEqual(["Memory Intro", "Per Tool Cap"]);
  });

  it("badges a customized row and offers Restore only there", () => {
    doc = {
      prompts: [row({ override: "mine", is_customized: true }), row({ id: "b", label: "B" })],
      warnings: [],
    };
    renderEditor();
    expect(screen.getAllByText("customized")).toHaveLength(1);
    expect(screen.getAllByText("restore")).toHaveLength(1);
  });

  it("names unknown config ids at the top of the section", () => {
    doc = {
      prompts: [row()],
      warnings: ["config.yaml has prompts the registry doesn't know: typo"],
    };
    renderEditor();
    expect(screen.getByText(/the registry doesn't know: typo/)).toBeTruthy();
  });

  it("the pair editor shows both fields, the default, the placeholders and the coupling note", async () => {
    doc = {
      prompts: [
        row({
          id: "per_tool_cap",
          label: "Per Tool Cap",
          description: "Caps repeats. Coupling: same loop-guard budget as the nudge.",
          placeholders: ["tool", "count"],
          default_text: "{{tool}} ran {{count}} times.",
        }),
      ],
      warnings: [],
    };
    renderEditor();
    await openRow("Per Tool Cap");
    // scoped to the dialog — the row underneath carries the same description text
    const modal = within(screen.getByRole("dialog"));
    expect(modal.getByLabelText("Override")).toBeTruthy();
    expect(modal.getByLabelText("Append")).toBeTruthy();
    expect(modal.getByText("{{tool}}")).toBeTruthy();
    expect(modal.getByText("{{count}}")).toBeTruthy();
    // the description splits on the registry's literal "Coupling: " marker: head = description text,
    // tail = a warning line
    expect(modal.getByText("Caps repeats.")).toBeTruthy();
    expect(modal.getByText(/Coupling: same loop-guard budget/)).toBeTruthy();
    // the shipped default is readable beside the editor
    expect(modal.getByText("{{tool}} ran {{count}} times.")).toBeTruthy();
  });

  it("an edit saves the RAW pair for the changed id only", async () => {
    doc = {
      prompts: [row(), row({ id: "per_tool_cap", label: "Per Tool Cap" })],
      warnings: [],
    };
    renderEditor();
    await openRow("Memory Intro");
    fireEvent.change(screen.getByLabelText("Override"), { target: { value: "my framing" } });
    fireEvent.change(screen.getByLabelText("Append"), { target: { value: "  " } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Set" }));
    });
    fireEvent.click(saveBtn());
    expect(h.save).toHaveBeenCalledTimes(1);
    // raw textarea values, whole entry, untouched rows absent — the server normalizes the blank away
    expect(savedPayload()).toEqual({ memory_intro: { override: "my framing", append: "  " } });
  });

  it("[Load default] seeds the override from the shipped text", async () => {
    doc = { prompts: [row()], warnings: [] };
    renderEditor();
    await openRow("Memory Intro");
    fireEvent.click(screen.getByRole("button", { name: "Load default" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Set" }));
    });
    fireEvent.click(saveBtn());
    expect(savedPayload()).toEqual({
      memory_intro: { override: "Context you carry across sessions.", append: "" },
    });
  });

  it("Restore stages a both-blank pair and rides the same batched save", () => {
    doc = {
      prompts: [row({ override: "mine", append: "extra", is_customized: true })],
      warnings: [],
    };
    renderEditor();
    fireEvent.click(screen.getByText("restore"));
    expect(saveBtn().textContent).toBe("Save 1 change");
    fireEvent.click(saveBtn());
    // both fields blank → the server drops the entry, which IS the restore (§7 L-4/L-5)
    expect(savedPayload()).toEqual({ memory_intro: { override: "", append: "" } });
  });

  it("cancelling the editor stages nothing (Save stays disabled)", async () => {
    doc = { prompts: [row()], warnings: [] };
    renderEditor();
    await openRow("Memory Intro");
    fireEvent.change(screen.getByLabelText("Override"), { target: { value: "typed" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect((saveBtn() as HTMLButtonElement).disabled).toBe(true);
    expect(saveBtn().textContent).toBe("Saved");
  });

  it("re-typing the stored text is not a change (blank-vs-unset normalization)", async () => {
    doc = { prompts: [row({ override: "mine", is_customized: true })], warnings: [] };
    renderEditor();
    await openRow("Memory Intro");
    fireEvent.change(screen.getByLabelText("Append"), { target: { value: "   " } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Set" }));
    });
    expect((saveBtn() as HTMLButtonElement).disabled).toBe(true);
  });
});
