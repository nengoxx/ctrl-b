// cosmos theme fonts (D29 §9.10) — Space Grotesk (body) + Instrument Serif (display, italic accents),
// self-hosted via Fontsource (version-pinned, offline-capable for the PWA). Same pattern as minimal: the
// @font-face CSS is dynamic-imported into cosmos's lazy chunk (an inactive theme costs nothing), then we
// await `document.fonts.load(...)` for the faces used up-front so activation paints without a swap flash.
//
// Called by `ensureThemeLoaded` (switchTheme.ts) BEFORE the skin flips, alongside loadStyles.

export async function loadFonts(): Promise<void> {
  await Promise.all([
    import("@fontsource/space-grotesk/400.css"),
    import("@fontsource/space-grotesk/500.css"),
    import("@fontsource/space-grotesk/600.css"),
    import("@fontsource/space-grotesk/700.css"),
    import("@fontsource/instrument-serif/400.css"),
    import("@fontsource/instrument-serif/400-italic.css"),
  ]);
  try {
    await Promise.all([
      document.fonts.load("400 1em 'Space Grotesk'"),
      document.fonts.load("600 1em 'Space Grotesk'"),
      document.fonts.load("700 1em 'Space Grotesk'"),
      document.fonts.load("italic 400 1em 'Instrument Serif'"),
    ]);
  } catch {
    /* fall back to font-display behaviour */
  }
}
