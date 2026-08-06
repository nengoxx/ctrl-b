import { useState } from "react";

import { artIdentity, type ServiceIdentity } from "../../lib/media";
import { ownerArtUrl, useServiceIcons } from "./ownerArt";

// The owner's per-service ICON (D53 M3 / MEDIA_PLAN §5) — ONE component for all five service-row
// surfaces (kit `Fleet`, vapor `DeviceRow`, cosmos/frontier/gacha host detail).
//
// The five surfaces PLACE and SIZE it; none of them copies the failure behaviour, which is the whole
// reason this is a component rather than an `<img>` in five files. Everything that can go wrong with an
// owner-supplied image is decided here, once:
//
//   · NO ICON is the ordinary case, not a defect: the kit namespace has no bundled fallback (§3), so a
//     service the owner has dropped nothing for renders exactly the row it renders today — this returns
//     null and the surface's markup is byte-identical to the pre-M3 one.
//   · A BROKEN icon latches. Unlike frontier's backgrounds (a `background-image` has no error event, so
//     M2 needed no latch), an `<img>` reports its failure — and without a latch a file that 404s or
//     decodes badly would be retried on every render, and a torn icon would sit in the row.
//   · …and the latch RELEASES on replacement. It is keyed on `(url, revision)`, the G5 reel-latch
//     pattern: the owner's usual repair is to overwrite `jellyfin.png` IN PLACE, which changes nothing
//     about the URL (and the URL must stay stable, or the SW's media cache would miss on every poll),
//     so a URL-only latch would leave the fixed file suppressed until a reload. A same-revision failure
//     stays latched, which is the other half: the file that is actually broken is never retried.
//
// DECORATIVE by ruling: the row already carries the service NAME as text, so an alt string would be the
// same word announced twice. `alt=""` is the removal; `aria-hidden` is the belt (the reel's precedent).

export function ServiceIcon({ service }: { service: ServiceIdentity }) {
  const iconFor = useServiceIcons();
  const icon = iconFor(service);
  const [failedKey, setFailedKey] = useState<string | null>(null);

  if (icon === undefined) return null;
  const key = artIdentity(icon.url, icon.revision);
  if (key === failedKey) return null;

  return (
    <img
      // KEYED ON THE IDENTITY, so a new revision REPLACES the element rather than re-using it (Codex M3
      // MED-2). The mount PATH is stable across a repair, so React would otherwise keep the same <img> —
      // and the old request is still in flight on it. Its late `error` would then fire the UPDATED handler
      // and latch the key of the file that just arrived, hiding a picture that is perfectly good until
      // the next revision or a remount. Replacing the node detaches that request with it. (The `?rev=`
      // below now moves the src too, which aborts that request as well — the key stays the GUARANTEE:
      // it is what the latch is keyed on, and it holds whatever the URL rule is.)
      key={key}
      className="kit-svcicon"
      // `?rev=`-stamped like the CSS-painted roles (`ownerArtUrl`). The `key` above already REPLACES the
      // element on a repair, but a fresh <img> pointed at an unchanged URL is still answered from the HTTP
      // cache — or from the SW's stale-while-revalidate copy — so the repaired bytes could take a reload to
      // appear. One URL rule for every owner-art consumer, and this is the one that also reads it back.
      src={ownerArtUrl(icon)}
      alt=""
      aria-hidden
      decoding="async"
      loading="lazy"
      onError={() => setFailedKey(key)}
    />
  );
}
