import { type CSSProperties } from "react";

import { useUISlice } from "../../store/ui";
import { ownerArtUrl, useKitBackgroundArt } from "./ownerArt";

// The SHARED whole-app background layer (the Kit Art System) — the gacha-wallpaper mechanism generalized
// to the kit shell: one owner image from `media/kit/background/`, painted faded behind everything.
//
// It is MOUNTED BY THE THEME, not by the registry and not by CSS (Codex A3). DefaultRoot renders it by
// default and a theme with full-bleed scenery of its own passes `kitBackground={false}` — "the theme does
// not mount the layer" is the whole semantic, and it is the only one that works: cosmos deliberately makes
// `.kit` transparent above its starfield (cosmos.css), so a mounted layer really would show through, and a
// ThemeDef flag read from here would risk the registry→VaporRoot→DefaultRoot import cycle (resolve.ts).
//
// THREE ways it renders nothing, and all three are ordinary states rather than errors:
//   · the theme did not mount it (opt-out);
//   · the owner turned it off (`ui.kitBackgroundVisible`, the synced appearance field);
//   · the folder is empty / the index is unreachable — no node at all, so the shell is byte-identical to
//     the one that shipped before this slice. Dormancy by ABSENCE, like every other role here.
//
// The layer paints its own opaque `--bg` under the art (rather than being a transparent element at low
// opacity), which is what lets it sit at `z-index: -1` inside the shell: kit.css nulls `.kit`'s own page
// fill exactly when this node is present, so an empty folder changes nothing about the paint.

export function KitBackground() {
  // Local read of the SYNCED appearance field (useAppearance reconciles it into the store, like
  // motion/perf) — one slice, so a theme-settings change never re-renders this.
  const visible = useUISlice((s) => s.kitBackgroundVisible);
  // `?rev=`-stamped, like every other CSS-painted owner role: overwriting the file in place must repaint
  // the layer rather than leave the already-decoded image sitting there (see `ownerArtUrl`).
  const url = ownerArtUrl(useKitBackgroundArt());
  if (!visible || url === undefined) return null;
  return (
    <div
      className="kit-bg"
      aria-hidden
      // Percent-encoded by the server, so no quote or backslash can reach the CSS token.
      style={{ "--kit-bg-img": `url("${url}")` } as CSSProperties}
    />
  );
}
