import { useThemeSetting } from "../../theme-engine/settings";
import logoUrl from "../../assets/vapor-logo.png";
import type { Loz } from "./index";

// vapor's brand LOZENGE, as the content of the Kit AppBar's `brandMark` slot (D51 V4 / plan §4.1). The Kit
// knows nothing about it — it just renders whatever node the theme passes at the brand's leading edge — so
// the "logo vs spinning ring" choice stays entirely here, on vapor's own `loz` seg setting (index.tsx).
//
// TWO changes from the pre-pivot `components/AppBar.tsx` lozenge:
//  1. The logo is a VITE-IMPORTED asset (`src/assets/vapor-logo.png`) — content-hashed, served immutable
//     from /assets/, and impossible to 404 the way the old bare `public/logo.png` + relative `url()` did in
//     prod (owner §5 Q3). (It is NOT in the SW precache manifest: workbox's glob here is js/css/html + the
//     manifest icons — same as before the move, when it was a public/ file.) CSS can't read a JS import, so
//     the resolved URL rides an inline custom property, the
//     `--tab-count` idiom (kit/NavBar.tsx); vapor.css consumes it in the inner disc's `background`.
//  2. The `loz` value is stamped on THIS node (`data-loz`), not on <body>. The old body attribute existed so
//     a global sheet could reach a component that didn't know its own setting; the component knows it now,
//     so the attribute lives where the styling applies (the D51 §3.1 `data-loz` retirement).
//
// `aria-hidden`: decorative. The brand's accessible name is the "ctrl·b" wordmark text beside it (the Kit's
// own `.dot` it replaces is aria-hidden for the same reason).
export function VaporMark() {
  const loz = useThemeSetting<Loz>("vapor", "loz");
  return (
    <span
      className="vapor-mark"
      data-loz={loz}
      aria-hidden
      style={{ ["--vapor-logo" as string]: `url(${logoUrl})` }}
    />
  );
}
