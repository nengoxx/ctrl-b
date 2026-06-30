// cosmos theme fonts (D29 §9.10) — Space Grotesk (body) + Instrument Serif (display, italic accents),
// self-hosted via Fontsource (version-pinned, offline-capable for the PWA). Same pattern as minimal: the
// @font-face CSS is dynamic-imported into cosmos's lazy chunk (an inactive theme costs nothing), then we
// await `document.fonts.load(...)` for the faces used up-front so activation paints without a swap flash.
//
// Called by `ensureThemeLoaded` (switchTheme.ts) BEFORE the skin flips, alongside loadStyles.

export async function loadFonts(): Promise<void> {
  // C0 only renders body text (Space Grotesk via --font-body). Instrument Serif (the italic display accents)
  // lands with the bespoke chrome/Agent in C1 — added then, so activation doesn't block on an unused font.
  await Promise.all([
    import("@fontsource/space-grotesk/400.css"),
    import("@fontsource/space-grotesk/500.css"),
    import("@fontsource/space-grotesk/600.css"),
    import("@fontsource/space-grotesk/700.css"),
    // Audiowide — the retro-futuristic display face for the host-detail title (--font-display). Single weight.
    import("@fontsource/audiowide/400.css"),
  ]);
  try {
    await Promise.all([
      document.fonts.load("400 1em 'Space Grotesk'"),
      document.fonts.load("600 1em 'Space Grotesk'"),
      document.fonts.load("700 1em 'Space Grotesk'"),
      document.fonts.load("400 1em 'Audiowide'"),
    ]);
  } catch {
    /* fall back to font-display behaviour */
  }
}
