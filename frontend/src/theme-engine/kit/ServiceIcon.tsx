import { useState } from "react";

import { artIdentity, type ServiceIdentity } from "../../lib/media";
import { useServiceIcons } from "./serviceIcons";

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
      className="kit-svcicon"
      src={icon.url}
      alt=""
      aria-hidden
      decoding="async"
      loading="lazy"
      onError={() => setFailedKey(key)}
    />
  );
}
