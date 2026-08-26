import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readImageHeader } from "../../src/lib/imageProbe";
import { CHARACTER_KEYS, SCENE_KEYS } from "../../src/themes/gacha/art";
import { BUNDLED_SIZES } from "../../src/themes/gacha/roster";

// THE DIMS HONESTY TEST (MEDIA_MANAGER_PLAN §12's "W10") — the roster records each bundled asset's
// pixel size so a framing point set on a DEFAULT can be mapped centred, and the server never sees
// those files: they belong to the client's own build. A recorded pair that drifts from the file is not
// a type error and not a runtime error — it is a picture quietly framed against the wrong geometry, on
// every surface, with nothing on screen to suggest why.
//
// So the numbers are read back off the REAL FILES, with the app's own pure header parser (`imageProbe`,
// the same one the upload guard runs) over `fs` bytes. A wrong or missing pair is a failing test.
//
// It has already earned its keep: `lyra` (535×740) and `rook` (640×740) are NOT the 640×854 the export
// recipe in `art.ts` records as its target — `withoutEnlargement: true` left both at their sources'
// own sizes, and the recipe's comment reads as if every character were 640×854.

const ART_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "src",
  "themes",
  "gacha",
  "art",
);

/** What the file on disk actually is, through the app's own parser. */
function measured(name: string): { width: number | null; height: number | null } {
  const bytes = Uint8Array.from(readFileSync(join(ART_DIR, `${name}.webp`)));
  const head = readImageHeader(bytes, bytes.byteLength);
  return { width: head.width, height: head.height };
}

describe("the bundled art's recorded dimensions ('W10')", () => {
  it.each(Object.keys(BUNDLED_SIZES))("%s is the size the roster says it is", (name) => {
    expect(measured(name)).toEqual(BUNDLED_SIZES[name]);
  });

  it("covers every asset a FRAMABLE role ships — a new default cannot arrive undimensioned", () => {
    // The roles the registry declares framable are `characters`, `banner` and `oracle`; their bundled
    // ids are exactly these lists. `reel` is deliberately absent — the figure is painted whole, never
    // cropped, so it has no centred mapping to feed and no dimensions to keep honest.
    expect(Object.keys(BUNDLED_SIZES).sort()).toEqual(
      [...CHARACTER_KEYS, ...SCENE_KEYS, "banner", "oracle"].sort(),
    );
  });
});
