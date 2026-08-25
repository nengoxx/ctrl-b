import { describe, expect, it } from "vitest";

import {
  FALLBACK_STEM,
  mintName,
  sanitizeStem,
  truncateToBytes,
  type NameLimits,
} from "../../src/lib/uploadName";

// AUTO-UNIQUE UPLOAD NAMES (D65 / MEDIA_MANAGER_PLAN §2.5) — collisions designed away rather than
// negotiated (owner ruling ⑦).
//
// The two rules pull in opposite directions, and every arm here is one of them meeting the other:
//  · the SERVER must admit the name (`core/media.py#admission_reason` REJECTS, never sanitises: NFC
//    required, no `<>:"|?*` or control characters, no leading dot, no trailing dot or space, no
//    Windows device name, ≤255 UTF-8 bytes) — so the client must never mint one it would refuse;
//  · the name must stay unique through the `-2`, `-3`, … walk, which is why the byte budget reserves
//    room for the LARGEST suffix before truncating (Emma #7). Truncating to exactly 255 and then
//    appending `-12` produces a 422 on the retry, after the upload was already paid for.

const LIMITS: NameLimits = { maxNameBytes: 255, attempts: 99 };

describe("sanitizeStem", () => {
  it("keeps an ordinary name and drops the picked extension", () => {
    // The stored extension comes from the EXPORT's own bytes, never from what was picked.
    expect(sanitizeStem("Lyra portrait.HEIC")).toBe("Lyra portrait");
  });

  it("drops every character the admission tier refuses", () => {
    expect(sanitizeStem('a<b>c:d"e|f?g*h/i\\j')).toBe("abcdefghij");
    expect(sanitizeStem("tab\there")).toBe("tabhere");
  });

  it("removes a leading dot and a trailing dot or space", () => {
    // A leading dot is a hidden file; Windows silently strips the trailing pair, so the file the
    // owner thinks they saved is not the one on disk.
    expect(sanitizeStem(".hidden")).toBe("hidden");
    expect(sanitizeStem("trailing. ")).toBe("trailing");
  });

  it("normalises to NFC, because the binding key does", () => {
    // A macOS-decomposed `é` and a Linux-composed one look identical in every listing and are
    // different byte strings — the server refuses the decomposed form outright.
    const decomposed = "café";
    expect(decomposed.normalize("NFC")).not.toBe(decomposed);
    expect(sanitizeStem(decomposed)).toBe("café");
  });

  it("escapes a Windows device name, which is refused WITH any extension", () => {
    expect(sanitizeStem("CON.png")).toBe("CON-file");
    expect(sanitizeStem("lpt9")).toBe("lpt9-file");
  });

  it("falls back when nothing survives — an Android content URI can hand over anything", () => {
    expect(sanitizeStem("???")).toBe(FALLBACK_STEM);
    expect(sanitizeStem("")).toBe(FALLBACK_STEM);
  });
});

describe("truncateToBytes", () => {
  it("counts BYTES, not characters, and cuts on a code-point boundary", () => {
    // A 100-character name of 3-byte code points is 300 bytes — the filesystem counts the latter.
    const cjk = "図".repeat(10); // 30 bytes
    expect(truncateToBytes(cjk, 30)).toBe(cjk);
    expect(truncateToBytes(cjk, 29)).toBe("図".repeat(9));
    // Never a half code point: a lone surrogate encodes as U+FFFD, which is the ONE character the
    // admission tier refuses as proof that a decode already lost the real name.
    expect(truncateToBytes("🎲🎲", 5)).toBe("🎲");
    expect([...truncateToBytes("🎲🎲", 5)]).toHaveLength(1);
  });

  it("strips a trailing dot or space the CUT itself exposed", () => {
    expect(truncateToBytes("name. x", 6)).toBe("name");
  });
});

describe("mintName", () => {
  it("takes the plain name when the folder is free", () => {
    expect(mintName("lyra.jpg", ".webp", [], LIMITS)).toBe("lyra.webp");
  });

  it("walks -2, -3, … past what is already there", () => {
    expect(mintName("lyra", ".webp", ["lyra.webp"], LIMITS)).toBe("lyra-2.webp");
    expect(mintName("lyra", ".webp", ["lyra.webp", "lyra-2.webp"], LIMITS)).toBe("lyra-3.webp");
  });

  it("compares through the BINDING rule, not byte equality", () => {
    // `Lyra.webp` beside `lyra.webp` is one binding on a named role and an invisible duplicate in a
    // pool: the filesystem would take it, the library could not show it.
    expect(mintName("Lyra", ".webp", ["lyra.webp"], LIMITS)).toBe("Lyra-2.webp");
  });

  it("falls back to a timestamp when the walk is exhausted", () => {
    const taken = ["x.webp", ...Array.from({ length: 98 }, (_, i) => `x-${i + 2}.webp`)];
    expect(mintName("x", ".webp", taken, LIMITS, 1_700_000_000_000)).toBe(
      `x-${(1_700_000_000_000).toString(36)}.webp`,
    );
  });

  it("CHECKS the timestamp fallback too, and advances it until free (Emma #6)", () => {
    // "Unique by construction" is a claim about a CLOCK, and a clock is the wrong thing to bet a
    // filename on: a rollback, a frozen one, a deterministic import, or two retries inside the same
    // millisecond all produce a candidate the folder already holds. Returning it unchecked spent all
    // five of the server's 409 retries re-proposing the same name.
    const stamp = (at: number) => `x-${at.toString(36)}.webp`;
    const walked = ["x.webp", ...Array.from({ length: 98 }, (_, i) => `x-${i + 2}.webp`)];
    const now = 1_700_000_000_000;
    expect(mintName("x", ".webp", [...walked, stamp(now)], LIMITS, now)).toBe(stamp(now + 1));
    expect(mintName("x", ".webp", [...walked, stamp(now), stamp(now + 1)], LIMITS, now)).toBe(
      stamp(now + 2),
    );
  });

  it("reserves the extension AND the largest suffix inside the byte budget", () => {
    // The arm Emma #7 asked for by name. A 400-character name is 400 bytes; the mint must fit the
    // base, its extension AND whatever the walk may append — checked on the SUFFIXED form, which is
    // where the naive version breaks.
    const encoder = new TextEncoder();
    const long = "n".repeat(400);
    const first = mintName(long, ".webp", [], LIMITS);
    expect(encoder.encode(first).length).toBeLessThanOrEqual(255);
    const suffixed = mintName(long, ".webp", [first], LIMITS);
    expect(suffixed).not.toBe(first);
    expect(encoder.encode(suffixed).length).toBeLessThanOrEqual(255);
    // …and the timestamp fallback fits too — it is the longest thing that can be appended.
    const exhausted = mintName(
      long,
      ".webp",
      [first, ...Array.from({ length: 98 }, (_, i) => mintNth(long, i + 2, first))],
      LIMITS,
      1_700_000_000_000,
    );
    expect(encoder.encode(exhausted).length).toBeLessThanOrEqual(255);
  });

  it("keeps multi-byte names whole under the budget", () => {
    const long = "図".repeat(200); // 600 bytes
    const minted = mintName(long, ".png", [], LIMITS);
    expect(new TextEncoder().encode(minted).length).toBeLessThanOrEqual(255);
    // A cut on a byte boundary would leave U+FFFD in the name — which the server refuses outright.
    expect(minted).not.toContain("�");
  });
});

/** The `-n` form of a minted base, for the exhaustion arm: the base is whatever the truncation made
 *  of the long stem, which the test reads back off the first mint rather than recomputing. */
function mintNth(_stem: string, n: number, first: string): string {
  const base = first.slice(0, first.lastIndexOf("."));
  return `${base}-${n}.webp`;
}
