// The roleplay/lorebook CONFIG projections (D70 §9) — the `pickAgentSection` precedent: one place the
// settings doc's shape is turned into what the UI reads, so every consumer sees the same defaults.
//
// A hooks module rather than either editor's file because THREE surfaces read this and two of them are
// components that already import each other: the Conf cards, the agent form (whose roleplay fields are
// gated on `enabled`) and the gallery header (whose Import entry point is). S5's lorebook queries land
// here beside them.

/** The `roleplay` section as the UI reads it — defaults mirroring the backend's `RoleplayCfg`. */
export interface RoleplayCfg {
  enabled: boolean;
  default_tools: string[];
  persona: { name: string; description: string };
}

export function pickRoleplay(section: unknown): RoleplayCfg {
  const s = (section ?? {}) as Partial<RoleplayCfg> & { persona?: Partial<RoleplayCfg["persona"]> };
  return {
    enabled: s.enabled ?? false,
    default_tools: s.default_tools ?? ["web_search"],
    persona: { name: s.persona?.name ?? "", description: s.persona?.description ?? "" },
  };
}

/** The `lorebooks` section's NUMERIC globals. `books` (the global attach list) is deliberately absent:
 *  its editor is the S5 lorebook-manager slice's, and a partial PUT leaves the stored list alone. */
export interface LorebooksCfg {
  scan_depth: number;
  budget_chars: number;
  max_import_bytes: number;
}

export function pickLorebooks(section: unknown): LorebooksCfg {
  const s = (section ?? {}) as Partial<LorebooksCfg>;
  return {
    scan_depth: s.scan_depth ?? 2,
    budget_chars: s.budget_chars ?? 4000,
    max_import_bytes: s.max_import_bytes ?? 15_000_000,
  };
}
