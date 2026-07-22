// A11 / D48 C7-b — the ONE shared provider→model picker. Every surface that selects an inference
// backend + model renders this against the same registry catalog: the Conf Inference section
// (primary + fallback rows) and the AgentsEditor per-agent backend. A provider `<select>` plus a
// model `<select>` scoped to that provider's catalog; the model select auto-hides when the catalog
// has exactly one model (the terse-config / sole-model rule). Native `<select>`s (the AgentsEditor
// reasoning-effort precedent) — the option counts are open-ended, so a Seg would wrap on a phone.
//
//  - `allowInherit`  → a leading empty "Inherit" provider option (agent defaults; blank = inherit the
//                      inference default). Off for the Inference primary (a provider is required).
//  - `allowRawId`    → a "custom id…" affordance that swaps the model select for a free-text input,
//                      keeping uncataloged-model passthrough (C7-b raw-id escape).

const CUSTOM = "__custom__"; // sentinel option value → switch the model field to raw-id text entry

export type PickerValue = { provider: string | null; model: string | null };
export type PickerCatalog = Record<string, { models: string[] }>;

export function ProviderModelPicker(props: {
  value: PickerValue;
  onChange: (v: PickerValue) => void;
  catalog: PickerCatalog;
  allowInherit?: boolean;
  allowRawId?: boolean;
  label?: string;
}) {
  const { value, onChange, catalog, allowInherit, allowRawId, label } = props;
  const providerNames = Object.keys(catalog);
  // FX18 (Codex#8): a `value.provider` set but ABSENT from the catalog is a DANGLING pointer (e.g. an
  // agent still references a removed provider). Surface it as an explicit "(missing)" option + a warn row
  // rather than silently snapping the select to the first provider (which would rewrite the ref on save).
  const providerMissing = value.provider != null && !providerNames.includes(value.provider);
  const models = value.provider ? (catalog[value.provider]?.models ?? []) : [];
  const modelInCatalog = value.model != null && models.includes(value.model);

  // Raw-id mode is DERIVED from the controlled value (FR2-4) — no local state, so it stays in sync across
  // rerenders in BOTH directions: an external refresh that swaps in an UNCATALOGED model flips to the raw
  // input showing that id (catalog→raw); a value that (re)enters the catalog returns to the select
  // (raw→catalog). Active whenever raw ids are allowed and the current model isn't in the provider's
  // catalog (an uncataloged passthrough id the user typed OR was loaded with). The "custom id…" pick enters
  // raw mode by writing an empty (uncataloged) model; the "list" button exits by writing a catalog one.
  const rawMode = !!allowRawId && value.model != null && !modelInCatalog && !!value.provider;

  const pickProvider = (p: string) => {
    const provider = p === "" ? null : p;
    // Reset the model to a valid default for the new provider: sole-model → null (hidden select),
    // multi-model → the first catalog entry, empty catalog → null.
    const next = provider ? (catalog[provider]?.models ?? []) : [];
    const model = next.length >= 2 ? next[0] : null;
    onChange({ provider, model });
  };

  const pickModel = (m: string) => {
    if (m === CUSTOM) {
      // Enter raw-id mode by writing an empty (thus uncataloged) model — `rawMode` derives from that.
      onChange({ ...value, model: modelInCatalog ? "" : (value.model ?? "") });
      return;
    }
    onChange({ ...value, model: m });
  };

  // The model select auto-HIDES for a sole-model provider (the terse-config rule): shown when the
  // catalog has ≥2 models, or we're editing a raw id, or the catalog is empty AND raw ids are allowed
  // (so an uncataloged provider can still take a typed id).
  const showModel =
    value.provider != null &&
    (models.length >= 2 || rawMode || (!!allowRawId && models.length === 0));

  return (
    <div className="pmpicker">
      <select
        aria-label={label ? `${label} provider` : "Provider"}
        className={"pm-provider" + (providerMissing ? " invalid" : "")}
        value={value.provider ?? ""}
        onChange={(e) => pickProvider(e.target.value)}
      >
        {allowInherit && <option value="">inherit</option>}
        {!allowInherit && value.provider == null && <option value="">— select —</option>}
        {providerMissing && (
          <option value={value.provider as string}>{value.provider} (missing)</option>
        )}
        {providerNames.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
      {providerMissing && (
        <div className="pm-warn">⚠ provider “{value.provider}” is not configured</div>
      )}

      {showModel &&
        (rawMode ? (
          <div className="pm-raw">
            <input
              aria-label={label ? `${label} model id` : "Model id"}
              className="pm-model"
              value={value.model ?? ""}
              placeholder="raw model id"
              onChange={(e) => onChange({ ...value, model: e.target.value })}
            />
            <button
              type="button"
              className="pm-listbtn"
              title="pick from the catalog"
              onClick={() =>
                // Exit raw mode by writing a catalog model (or null for a sole/empty catalog) — `rawMode`
                // derives from the value, so no local flag to reset.
                onChange({ ...value, model: models.length >= 2 ? models[0] : null })
              }
            >
              list
            </button>
          </div>
        ) : (
          <select
            aria-label={label ? `${label} model` : "Model"}
            className="pm-model"
            value={modelInCatalog ? (value.model as string) : ""}
            onChange={(e) => pickModel(e.target.value)}
          >
            {!modelInCatalog && <option value="">— select —</option>}
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            {allowRawId && <option value={CUSTOM}>custom id…</option>}
          </select>
        ))}
    </div>
  );
}
