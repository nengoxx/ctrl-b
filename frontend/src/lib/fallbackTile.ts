// THE NO-AVATAR CARD PICTURE (D79 / ROLEPLAY_PLAN §15.3) — the gallery's letter tile, painted into a
// PNG so a character with no bound avatar still exports as a real card.
//
// SillyTavern needs an IMAGE to carry a card, and a 1×1 would be a broken one; the honest picture of an
// agent with no art is the one the gallery already shows for it — its initial on a flat tile. So this
// paints exactly that, on the theme's own ACCENT pair (the accent as the fill, the accent's ink as the
// letter — one source for both halves of the colour pair, the crash-screen rule).
//
// ON THE MAIN THREAD, deliberately: the export pipeline's worker draws on an `OffscreenCanvas`, and a
// worker has no access to the document's loaded fonts, so the letter would silently fall back to a
// default face. A 512×512 fill and one glyph is far too little work to need the worker anyway.

import { ExportError } from "./imageExport";

/** The tile's side, in pixels — square, like the avatars role's own aspect, and large enough to read as
 *  a portrait in any card browser without being a heavy file. */
export const FALLBACK_TILE_PX = 512;

/** The glyph's size as a fraction of the tile: the gallery's `.agal-mono` letter, scaled to the canvas. */
const GLYPH_SCALE = 0.5;

/** What the tile is painted with. Read off the live theme by `readTilePaint`, or stated by a test. */
export interface TilePaint {
  background: string;
  ink: string;
  font: string;
}

/** The letter the tile shows — the gallery card's own rule (`AgentsTab`'s `AgentCard` renders this very
 *  function), so the exported picture and the card the owner tapped cannot disagree. By CODE POINT, not
 *  UTF-16 unit: a title opening with an emoji or a CJK supplementary character would otherwise draw
 *  half a surrogate pair. */
export function tileInitial(title: string): string {
  const first = Array.from(title.trim())[0];
  return (first ?? "?").toUpperCase();
}

/** The current theme's accent pair + body face, off the live document. `--accent-ink` falls back to
 *  `--bg` exactly as the themes that do not declare it do (frontier's token notes); the literal last
 *  resorts only matter where no theme is mounted at all (a test, a crash). */
export function readTilePaint(el: Element = document.body): TilePaint {
  const cs = getComputedStyle(el);
  const token = (name: string) => cs.getPropertyValue(name).trim();
  return {
    background: token("--accent") || "#6b6b6b",
    ink: token("--accent-ink") || token("--bg") || "#ffffff",
    font: token("--font-body") || "sans-serif",
  };
}

/** Paint the tile and encode it as PNG. Waits for the face to be READY first — a document font that has
 *  not been used yet on this page is not loaded, and `fillText` would not wait for it. */
export async function paintFallbackTile(
  initial: string,
  paint: TilePaint,
  size: number = FALLBACK_TILE_PX,
  doc: Document = document,
): Promise<Blob> {
  const font = `300 ${Math.round(size * GLYPH_SCALE)}px ${paint.font}`;
  // Best-effort: a face that cannot load still leaves the browser's fallback face, which is a letter.
  await doc.fonts?.load(font).catch(() => undefined);
  const canvas = doc.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx === null)
    throw new ExportError("this browser could not open a drawing surface for the card picture.");
  ctx.fillStyle = paint.background;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = paint.ink;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(initial, size / 2, size / 2);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob && blob.size > 0
          ? resolve(blob)
          : reject(new ExportError("the browser could not encode the card picture.")),
      "image/png",
    ),
  );
}
