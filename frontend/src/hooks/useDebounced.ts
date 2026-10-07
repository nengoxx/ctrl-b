import { useEffect, useState } from "react";

/** Debounce a value by `ms` — the value `ms` after it last changed. Shared by the editors' live
 *  server previews (the automations schedule preview, the per-turn macro hint): each is a server
 *  round-trip per keystroke otherwise. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return settled;
}
