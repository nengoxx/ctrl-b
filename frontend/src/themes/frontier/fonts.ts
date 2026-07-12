// frontier theme fonts (D29 §9.10) — JetBrains Mono (body) + Chakra Petch (display, the wordmark + section
// headers) self-hosted via Fontsource (version-pinned; NB the woff2 files are NOT SW-precached — only theme
// JS/CSS chunks are, per the §14.15.4 backlog note). Same pattern as cosmos:
// the @font-face CSS is dynamic-imported into frontier's lazy chunk (an inactive theme costs nothing), then
// we await `document.fonts.load(...)` for the faces used up-front so activation paints without a swap flash.
//
// Called by `ensureThemeLoaded` (switchTheme.ts) BEFORE the skin flips, alongside loadStyles.

export async function loadFonts(): Promise<void> {
  await Promise.all([
    import("@fontsource/chakra-petch/400.css"),
    import("@fontsource/chakra-petch/500.css"),
    import("@fontsource/chakra-petch/600.css"),
    import("@fontsource/chakra-petch/700.css"),
    import("@fontsource/jetbrains-mono/400.css"),
    import("@fontsource/jetbrains-mono/500.css"),
    import("@fontsource/jetbrains-mono/700.css"),
  ]);
  try {
    await Promise.all([
      document.fonts.load("400 1em 'JetBrains Mono'"),
      document.fonts.load("700 1em 'JetBrains Mono'"),
      document.fonts.load("600 1em 'Chakra Petch'"),
      document.fonts.load("700 1em 'Chakra Petch'"),
    ]);
  } catch {
    /* fall back to font-display behaviour */
  }
}
