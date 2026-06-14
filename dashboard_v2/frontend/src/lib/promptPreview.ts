// Phase 7e-b. The 1-line summary shown in a Conf row whose full text is edited in the PromptModal,
// so the Conf list stays scannable. Empty → a contextual hint ("empty — using baked default");
// otherwise a char count + a short, single-line snippet of the start.

export function promptPreview(value: string, emptyHint: string): string {
  const v = value.trim();
  if (!v) return emptyHint;
  const snippet = v.replace(/\s+/g, " ").slice(0, 44);
  return `${value.length.toLocaleString()} chars · "${snippet}${v.length > 44 ? "…" : ""}"`;
}
