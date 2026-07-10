import { describe, expect, it } from "vitest";

import { stableStringify } from "../../src/lib/stableStringify";

// The dep-free, key-order-insensitive structural stringify shared by reconcileAppearance (rider (b)) and
// switchTheme's ⑤ dedupe key. Locked here: object keys sort at every nesting level, arrays keep their
// order, primitives/null match JSON.

describe("stableStringify", () => {
  it("sorts object keys so key order does not affect the result", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("sorts keys at nested levels too (recursive)", () => {
    const x = { outer: { z: 1, a: 2 }, first: [{ n: 1, m: 2 }] };
    const y = { first: [{ m: 2, n: 1 }], outer: { a: 2, z: 1 } };
    expect(stableStringify(x)).toBe(stableStringify(y));
  });

  it("preserves array order (position is meaningful)", () => {
    expect(stableStringify([1, 2, 3])).toBe("[1,2,3]");
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });

  it("matches JSON for primitives and null", () => {
    expect(stableStringify(null)).toBe("null");
    expect(stableStringify(42)).toBe("42");
    expect(stableStringify("hi")).toBe('"hi"');
    expect(stableStringify(true)).toBe("true");
  });

  it("distinguishes different content", () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
    expect(stableStringify({ a: { b: 1 } })).not.toBe(stableStringify({ a: { c: 1 } }));
  });
});
