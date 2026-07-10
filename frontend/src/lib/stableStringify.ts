// Key-order-insensitive structural stringify — a stable, dependency-free serialization used to compare
// structured values BY CONTENT. Two consumers share the exact "compare structured targets, order of
// object keys must not matter" need:
//   • reconcileAppearance (rider (b) / §14.15.1): `themeSettings` is `Record<string, Record<string,
//     primitive>>`, so two devices can author the SAME settings with the keys in a different order — a
//     plain `JSON.stringify` compare would read that as a difference and trigger a spurious re-apply
//     each load.
//   • switchTheme's ⑤ in-flight dedupe key (§14.15.1 ⑤): two calls carrying the same target must produce
//     the same key so the second joins the first (one load, one View Transition).
// Sorting object keys at every level makes equal content compare equal. Written generically for plain
// objects / arrays / primitives (arrays keep their order — position is meaningful there); recursion depth
// is trivial for these shapes. No new deps. `src/lib/` is the repo's dep-free helper home.
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",");
  return `{${body}}`;
}
