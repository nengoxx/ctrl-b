import { type ReactNode } from "react";

import { ProviderModelPicker, type PickerCatalog, type PickerValue } from "./ProviderModelPicker";
import { SettingRow } from "./SettingRow";
import { useDragReorder } from "./useDragReorder";
import type { SectionRef } from "../hooks/useSettings";

// A11/D48 — the shared consumer-section reference editor: a primary provider→model picker labeled
// "Default" plus an ordered, reorderable list of fallback pickers (the `✕ · #N · picker · ⠿` row idiom).
// Extracted from the Inference group so Inference / Voice STT / Voice TTS / Embeddings all render the
// EXACT same skeleton over one implementation (no duplicated fallback-row/drag code). Only-existing
// CSS classes (`.fallback-section` / `.confrow.fallback-row` / `.fb-remove` / `.drag-handle` /
// `.fallback-add`). `children` is an optional slot between the Default row and the Fallbacks section —
// Inference passes its Failover switch there; the voice/embeddings sections omit it (chains always walk).

interface SectionValue {
  provider: string | null;
  model: string | null;
  fallbacks: SectionRef[];
}

export function SectionRefEditor(props: {
  primaryDesc: string; // the "Default" row subtitle (section-specific)
  value: SectionValue;
  onChangePrimary: (v: PickerValue) => void;
  onChangeFallbacks: (next: SectionRef[]) => void;
  catalog: PickerCatalog;
  providerNames: string[]; // draft provider order — seeds a newly-added fallback's provider
  // Distinguishes the pickers' ACCESSIBLE names across the four sections that share this editor (the
  // visible row label stays "Default"). Omitted for Inference so its Slice-1 accessible names
  // ("Default provider" / "Fallback N provider" / "remove/reorder fallback N") are preserved verbatim.
  sectionLabel?: string;
  children?: ReactNode; // optional slot between Default and Fallbacks (Inference failover switch)
}) {
  const { value, onChangeFallbacks, catalog, providerNames, sectionLabel } = props;
  const fallbacks = value.fallbacks;
  // Accessible-name builders — section-scoped when `sectionLabel` is set, else the exact Inference strings.
  const primaryLabel = sectionLabel ? `${sectionLabel} default` : "Default";
  const fbLabel = (i: number) =>
    sectionLabel ? `${sectionLabel} fallback ${i + 1}` : `Fallback ${i + 1}`;
  const fbRemoveLabel = (i: number) =>
    sectionLabel ? `remove ${sectionLabel} fallback ${i + 1}` : `remove fallback ${i + 1}`;
  const fbReorderLabel = (i: number) =>
    `reorder ${sectionLabel ? `${sectionLabel} ` : ""}fallback ${i + 1} — drag, or press the up/down arrow keys`;

  const move = (from: number, to: number) => {
    const arr = [...fallbacks];
    if (to < 0 || to >= arr.length) return;
    const [x] = arr.splice(from, 1);
    arr.splice(to, 0, x);
    onChangeFallbacks(arr);
  };
  const drag = useDragReorder(fallbacks.length, move);

  const setRef = (idx: number, v: PickerValue) =>
    onChangeFallbacks(
      fallbacks.map((f, i) => (i === idx ? { provider: v.provider ?? "", model: v.model } : f)),
    );
  const add = () => {
    const first = providerNames[0] ?? "";
    const models = first ? (catalog[first]?.models ?? []) : [];
    onChangeFallbacks([
      ...fallbacks,
      { provider: first, model: models.length >= 2 ? models[0] : null },
    ]);
  };
  const remove = (idx: number) => onChangeFallbacks(fallbacks.filter((_, i) => i !== idx));

  return (
    <>
      <SettingRow label="Default" desc={props.primaryDesc}>
        <ProviderModelPicker
          label={primaryLabel}
          value={{ provider: value.provider ?? null, model: value.model ?? null }}
          onChange={props.onChangePrimary}
          catalog={catalog}
          allowRawId
        />
      </SettingRow>
      {props.children}
      <div className="fallback-section">
        <span className="label">Fallbacks</span>
        <span className="desc">tried in order after the default</span>
      </div>
      {fallbacks.map((fb, i) => (
        <div className="confrow fallback-row" key={i} {...drag.rowProps(i)}>
          {/* remove ✕ on the left beside the index; the row stays on ONE line (owner layout). */}
          <button
            type="button"
            className="fb-remove"
            aria-label={fbRemoveLabel(i)}
            title="remove"
            onClick={() => remove(i)}
          >
            ✕
          </button>
          <div className="k">
            <div className="label">#{i + 1}</div>
          </div>
          <ProviderModelPicker
            label={fbLabel(i)}
            value={{ provider: fb.provider || null, model: fb.model }}
            onChange={(v) => setRef(i, v)}
            catalog={catalog}
            allowRawId
          />
          {/* drag handle on the right (owner layout) — pointer drag reorder (P11; touch-action:none on
              the ⠿ handle) AND ArrowUp/ArrowDown keyboard reorder (the accessible path), both via drag. */}
          <button
            type="button"
            className="drag-handle"
            aria-label={fbReorderLabel(i)}
            title="drag to reorder (or arrow keys)"
            {...drag.handleProps(i)}
          >
            ⠿
          </button>
        </div>
      ))}
      {/* debounced drag position announcements for AT (visually hidden) */}
      <div
        aria-live="polite"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          margin: -1,
          padding: 0,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {drag.announce}
      </div>
      <div className="fallback-add">
        <button type="button" className="svc-add" onClick={add}>
          + add fallback
        </button>
      </div>
    </>
  );
}
