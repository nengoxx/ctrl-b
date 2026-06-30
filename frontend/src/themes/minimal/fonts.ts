// minimal theme fonts (D29 §9.10) — self-hosted via Fontsource (version-pinned, offline-capable for the
// PWA). The @font-face CSS is dynamic-imported (so the woff2 files land in minimal's lazy chunk, hashed by
// Vite — an INACTIVE theme costs nothing), then we await `document.fonts.load(...)` for the faces actually
// used up-front so the theme paints without a swap flash (the FontFaceSet "load before paint" path).
//
// Called by `ensureThemeLoaded` (switchTheme.ts) BEFORE the skin flips, alongside loadStyles.

export async function loadFonts(): Promise<void> {
  // Register the @font-face rules (Hanken Grotesk body 400–700; Instrument Serif display 400 + italic).
  await Promise.all([
    import("@fontsource/hanken-grotesk/400.css"),
    import("@fontsource/hanken-grotesk/500.css"),
    import("@fontsource/hanken-grotesk/600.css"),
    import("@fontsource/hanken-grotesk/700.css"),
    import("@fontsource/instrument-serif/400.css"),
    import("@fontsource/instrument-serif/400-italic.css"),
  ]);
  // Force-load the faces the chrome uses immediately so the first paint isn't a fallback flash. Best-effort:
  // a FontFaceSet rejection (e.g. an offline cold start) must not block the theme from rendering.
  try {
    await Promise.all([
      document.fonts.load("400 1em 'Hanken Grotesk'"),
      document.fonts.load("600 1em 'Hanken Grotesk'"),
      document.fonts.load("700 1em 'Hanken Grotesk'"),
      document.fonts.load("italic 400 1em 'Instrument Serif'"),
    ]);
  } catch {
    /* fall back to font-display behaviour */
  }
}
