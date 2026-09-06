import { lazy } from "react";

// Lazy entry for the Agents gallery (D70 §8.4) — the ConfTab.lazy pattern, one file per lazy tab.
//
// The importer is named once and exported twice: as `React.lazy()` for the render path, and as a
// plain function for a prefetch that wants to warm the chunk. ES modules are cached by URL, so both
// resolve to the same chunk. The section carries `lazy: true` in the tab registry, so DefaultRoot
// mounts it only after its first activation and wraps it in ErrorBoundary + Suspense.
const importAgentsTab = () => import("./AgentsTab").then((m) => ({ default: m.AgentsTab }));

export const AgentsTabLazy = lazy(importAgentsTab);
export const preloadAgentsTab = importAgentsTab;
