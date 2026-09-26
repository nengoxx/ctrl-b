// The root agent's slug — a LEAF module on purpose (the `lib/privilege` precedent): `hooks/useAgents`
// imports `lib/composer`, and `lib/composer` needs this slug too (the root is always a valid sticky pin),
// so defining it in either would close an import cycle. `hooks/useAgents` re-exports it, so every
// existing `import { DEFAULT_AGENT } from "../hooks/useAgents"` keeps working.

/** The `default` slug — the workspace-root / generalist agent (no agent.yaml). Never listed in the
 *  roster's `agents` (only specialist folders are), yet always a real agent the server can run. */
export const DEFAULT_AGENT = "default";
