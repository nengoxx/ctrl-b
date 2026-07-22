import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JsonField } from "../../src/components/JsonField";
import {
  ProviderModelPicker,
  type PickerCatalog,
  type PickerValue,
} from "../../src/components/ProviderModelPicker";

// A11/D48 — the two net-new shared building blocks: the provider→model picker (sole-model auto-hide +
// raw-id escape) and the guarded extra_body JSON field (blocks on invalid, emits parsed objects).

const catalog: PickerCatalog = {
  llamacpp: { models: ["minig+"] }, // sole model → the model select is hidden
  openrouter: { models: ["qwen3.5", "qwen-embed"] }, // multi-model → the model select shows
};

afterEach(cleanup);

describe("ProviderModelPicker", () => {
  it("hides the model select for a sole-model provider, shows it for a multi-model one", () => {
    const { rerender } = render(
      <ProviderModelPicker
        label="Default"
        value={{ provider: "llamacpp", model: null }}
        onChange={vi.fn()}
        catalog={catalog}
      />,
    );
    expect(screen.getByLabelText("Default provider")).toBeTruthy();
    expect(screen.queryByLabelText("Default model")).toBeNull();

    rerender(
      <ProviderModelPicker
        label="Default"
        value={{ provider: "openrouter", model: "qwen3.5" }}
        onChange={vi.fn()}
        catalog={catalog}
      />,
    );
    expect(screen.getByLabelText<HTMLSelectElement>("Default model").value).toBe("qwen3.5");
  });

  it("the raw-id escape switches the model select to a free-text input", () => {
    // The picker is CONTROLLED — the "custom id…" pick enters raw mode by writing an empty (uncataloged)
    // model, so drive it through a stateful harness that reflects onChange back (as real consumers do).
    function Harness() {
      const [v, setV] = useState<PickerValue>({ provider: "openrouter", model: "qwen3.5" });
      return (
        <ProviderModelPicker
          label="Backend"
          value={v}
          onChange={setV}
          catalog={catalog}
          allowRawId
        />
      );
    }
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("Backend model"), { target: { value: "__custom__" } });
    // now a text input for the raw id is present
    expect(screen.getByLabelText("Backend model id")).toBeTruthy();
  });

  it("syncs raw-id mode when the CONTROLLED value changes across rerenders (FR2-4)", () => {
    const el = (model: string) => (
      <ProviderModelPicker
        label="Backend"
        value={{ provider: "openrouter", model }}
        onChange={vi.fn()}
        catalog={catalog}
        allowRawId
      />
    );
    const { rerender } = render(el("qwen3.5"));
    // cataloged model → the select is shown, not the raw input.
    expect(screen.getByLabelText<HTMLSelectElement>("Backend model").value).toBe("qwen3.5");
    expect(screen.queryByLabelText("Backend model id")).toBeNull();

    // catalog→raw: an external refresh swaps in an UNCATALOGED id → the raw input appears carrying it.
    rerender(el("vendor/uncataloged"));
    expect(screen.getByLabelText<HTMLInputElement>("Backend model id").value).toBe(
      "vendor/uncataloged",
    );
    expect(screen.queryByLabelText("Backend model")).toBeNull();

    // raw→catalog: the value returns to a cataloged model → the select comes back.
    rerender(el("qwen-embed"));
    expect(screen.queryByLabelText("Backend model id")).toBeNull();
    expect(screen.getByLabelText<HTMLSelectElement>("Backend model").value).toBe("qwen-embed");
  });

  it("offers an Inherit option when allowInherit is set", () => {
    render(
      <ProviderModelPicker
        label="Backend"
        value={{ provider: null, model: null }}
        onChange={vi.fn()}
        catalog={catalog}
        allowInherit
      />,
    );
    expect(screen.getByLabelText<HTMLSelectElement>("Backend provider").value).toBe("");
  });

  it("renders a (missing) option + warn row for a provider absent from the catalog (FX18)", () => {
    render(
      <ProviderModelPicker
        label="Backend"
        value={{ provider: "deleted-prov", model: null }}
        onChange={vi.fn()}
        catalog={catalog}
        allowInherit
        allowRawId
      />,
    );
    // the select keeps the dangling value (an explicit "(missing)" option), not snapping to a real one.
    expect(screen.getByLabelText<HTMLSelectElement>("Backend provider").value).toBe("deleted-prov");
    expect(screen.getByText(/is not configured/)).toBeTruthy();
  });
});

describe("JsonField", () => {
  it("emits a parsed object for valid JSON and reports valid", () => {
    const onChange = vi.fn();
    const onValidity = vi.fn();
    render(
      <JsonField
        id="x"
        value={null}
        onChange={onChange}
        onValidity={onValidity}
        ariaLabel="body"
      />,
    );
    fireEvent.change(screen.getByLabelText("body"), {
      target: { value: '{ "cache_prompt": true }' },
    });
    expect(onChange).toHaveBeenLastCalledWith({ cache_prompt: true });
    expect(onValidity).toHaveBeenLastCalledWith("x", true);
  });

  it("reports INVALID (blocks save) on malformed JSON and shows an error", () => {
    const onValidity = vi.fn();
    render(
      <JsonField id="x" value={null} onChange={vi.fn()} onValidity={onValidity} ariaLabel="body" />,
    );
    fireEvent.change(screen.getByLabelText("body"), { target: { value: "{ not json" } });
    expect(onValidity).toHaveBeenLastCalledWith("x", false);
    expect(screen.getByText(/invalid JSON/)).toBeTruthy();
  });

  it("blank clears to null and is valid", () => {
    const onChange = vi.fn();
    const onValidity = vi.fn();
    render(
      <JsonField
        id="x"
        value={{ a: 1 }}
        onChange={onChange}
        onValidity={onValidity}
        ariaLabel="body"
      />,
    );
    fireEvent.change(screen.getByLabelText("body"), { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(onValidity).toHaveBeenLastCalledWith("x", true);
  });

  // FX14 (Codex#11) — the reseed branch: a CLEAN field adopts an external change; a DIRTY field keeps the
  // user's text; a discard/rebase (external value returns to the prior seed) restores the field.
  const field = (value: Record<string, unknown> | null) => (
    <JsonField id="x" value={value} onChange={vi.fn()} onValidity={vi.fn()} ariaLabel="body" />
  );

  it("a CLEAN field adopts an external (refetch) change", () => {
    const { rerender } = render(field({ a: 1 }));
    const ta = screen.getByLabelText<HTMLTextAreaElement>("body");
    expect(JSON.parse(ta.value)).toEqual({ a: 1 });
    rerender(field({ b: 2 })); // background change while the field is clean
    expect(JSON.parse(ta.value)).toEqual({ b: 2 }); // adopted
  });

  it("a DIRTY field keeps the user's edit across a background refetch of the SAME value", () => {
    const { rerender } = render(field({ a: 1 }));
    const ta = screen.getByLabelText<HTMLTextAreaElement>("body");
    fireEvent.change(ta, { target: { value: '{ "a": 2 }' } }); // user edits (dirty)
    rerender(field({ a: 1 })); // parent still holds the old value (epoch-guarded upstream)
    expect(JSON.parse(ta.value)).toEqual({ a: 2 }); // the edit survives
  });

  it("a discard (external value returns to a NEW seed) restores the field", () => {
    const { rerender } = render(field({ a: 1 }));
    const ta = screen.getByLabelText<HTMLTextAreaElement>("body");
    fireEvent.change(ta, { target: { value: '{ "a": 9 }' } }); // user edits → parent draft would become {a:9}
    rerender(field({ a: 9 })); // parent adopts the edit (its own echo) — field keeps the text
    expect(JSON.parse(ta.value)).toEqual({ a: 9 });
    rerender(field({ a: 1 })); // DISCARD: parent restores the original → clean field adopts it
    expect(JSON.parse(ta.value)).toEqual({ a: 1 });
  });
});
