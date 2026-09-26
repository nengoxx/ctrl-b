import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FALLBACK_TILE_PX,
  paintFallbackTile,
  readTilePaint,
  tileInitial,
} from "../../src/lib/fallbackTile";

// THE NO-AVATAR CARD PICTURE (D79 / §15.3): the gallery's letter tile as a PNG. jsdom has no 2D
// context, so the canvas is a recording fake — the claims are WHAT is painted (the accent pair, the
// initial, centred, at 512×512) and that the face is loaded before the glyph is drawn.

afterEach(() => {
  vi.restoreAllMocks();
  document.body.removeAttribute("style");
});

describe("tileInitial — the gallery card's own letter", () => {
  it("upper-cases the first character, and says '?' for a blank title", () => {
    expect(tileInitial("lynette")).toBe("L");
    expect(tileInitial("  seraphina")).toBe("S");
    expect(tileInitial("")).toBe("?");
  });

  it("takes a whole CODE POINT, never half a surrogate pair", () => {
    expect(tileInitial("🐉 Drake")).toBe("🐉");
  });
});

describe("readTilePaint — the live theme's accent pair", () => {
  it("reads --accent / --accent-ink / --font-body off the element", () => {
    document.body.style.setProperty("--accent", "#8a78ff");
    document.body.style.setProperty("--accent-ink", "#101010");
    document.body.style.setProperty("--font-body", '"Space Grotesk", sans-serif');
    expect(readTilePaint()).toEqual({
      background: "#8a78ff",
      ink: "#101010",
      font: '"Space Grotesk", sans-serif',
    });
  });

  it("falls back to --bg for the ink when a theme declares no --accent-ink", () => {
    document.body.style.setProperty("--accent", "#56cfee");
    document.body.style.setProperty("--bg", "#05060a");
    expect(readTilePaint().ink).toBe("#05060a");
  });
});

describe("paintFallbackTile", () => {
  it("paints the initial centred on the accent at 512×512 and encodes PNG, after the face loads", async () => {
    const calls: string[] = [];
    const ctx = {
      fillStyle: "",
      font: "",
      textAlign: "",
      textBaseline: "",
      fillRect: vi.fn(() => calls.push(`rect:${ctx.fillStyle}`)),
      fillText: vi.fn((t: string, x: number, y: number) =>
        calls.push(`text:${t}@${x},${y}:${ctx.fillStyle}:${ctx.font}`),
      ),
    };
    let asked = "";
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ctx,
      toBlob: (cb: (b: Blob | null) => void, type: string) => {
        asked = type;
        cb(new Blob([new Uint8Array(100)], { type }));
      },
    };
    const load = vi.fn(async () => {
      calls.push("fonts.load");
      return Promise.resolve([]);
    });
    const doc = {
      createElement: () => canvas,
      fonts: { load },
    } as unknown as Document;
    const blob = await paintFallbackTile(
      "L",
      { background: "#8a78ff", ink: "#000", font: "Hanken" },
      FALLBACK_TILE_PX,
      doc,
    );
    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(512);
    expect(asked).toBe("image/png");
    expect(blob.type).toBe("image/png");
    expect(load).toHaveBeenCalledWith("300 256px Hanken");
    expect(calls).toEqual(["fonts.load", "rect:#8a78ff", "text:L@256,256:#000:300 256px Hanken"]);
  });

  it("refuses rather than resolving an empty encode", async () => {
    const doc = {
      createElement: () => ({
        getContext: () => ({ fillRect() {}, fillText() {} }),
        toBlob: (cb: (b: Blob | null) => void) => cb(null),
      }),
    } as unknown as Document;
    await expect(
      paintFallbackTile("L", { background: "#000", ink: "#fff", font: "x" }, 8, doc),
    ).rejects.toThrow(/could not encode/);
  });
});
