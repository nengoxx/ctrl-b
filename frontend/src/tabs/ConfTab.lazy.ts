import { lazy } from "react";

// Lazy entry for the Conf tab (Slice 6 / F6 in docs/UI_AUDIT.md).
//
// The importer is named once and exported twice — as `React.lazy()` for the render path, and as a
// plain function `preloadConfTab` for the prefetch helpers. ES modules are cached by URL at the
// browser level, so both consumers resolve to the same chunk; calling `preloadConfTab()` warms the
// cache, then React.lazy reuses the already-resolved module on first render → no Suspense flash in
// the typical case.
//
// Pattern is intentionally tiny so adding more lazy tabs later is one file per tab:
//   - tabs/MyTab.lazy.ts → `export const MyTabLazy = lazy(import_); export const preloadMyTab = import_;`
//   - App.tsx renders <MyTabLazy />; the idle/hover prefetch helpers call preloadMyTab.
// React.lazy expects a default export; ConfTab is a named export — remap once here so the rest
// of the codebase keeps its named-export convention (no `export default` churn for one tab).
const importConfTab = () => import("./ConfTab").then((m) => ({ default: m.ConfTab }));

export const ConfTabLazy = lazy(importConfTab);
export const preloadConfTab = importConfTab;
