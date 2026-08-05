// The `kit` media namespace's ADAPTER (D53 M3 / MEDIA_PLAN §3 + §5) — owner service icons, from the
// wire payload to the two things that consume it: the five service-row surfaces (through `ServiceIcon`)
// and the Conf gallery's keyed panel.
//
// SPLIT the way `themes/frontier/ownerArt.ts` and gacha's `roster.ts` are, and for the same reason: the
// resolution is PURE (a payload + the fleet's services in, bindings out), so every acceptance row — the
// collisions, the unmatched files, the unrepresentable keys — is an ordinary unit test, and the hooks
// are the two-line React wrappers.
//
// It lives under `kit/` rather than in a theme because the namespace belongs to no theme: every theme's
// service rows read it. That is also why its registry row is `alwaysOn`.

import { useCallback } from "react";

import { useMediaIndex, type MediaFile, type MediaIndex } from "../../hooks/useMedia";
import { useServices } from "../../hooks/useServices";
import { classifyNamed, isStemRepresentable, keyFor, resolveNamed } from "../../lib/media";
import type { NamedBinding, ServiceIdentity } from "../../lib/media";

/** The namespace and the one role it holds — named once so the hook, the gallery and the tests cannot
 *  drift from `core/media.py`'s `KIT_ROLES`. */
export const KIT_NS = "kit";
const ICON_ROLE = "services";

/** The role's files out of a payload, defensively. Wire data: a stub or partial response (an e2e mock, a
 *  proxy answering `{}`) must degrade to "no icons" rather than throw inside a service row — the
 *  `frontierArtFromIndex` / `rosterFromIndex` precedent. */
function iconFiles(index: MediaIndex | undefined): MediaFile[] {
  const files = index?.roles?.[ICON_ROLE];
  return Array.isArray(files) ? files : [];
}

/** The owner's icon for ONE service, or `undefined` when they have dropped none for it — which is the
 *  ordinary case and not a defect: absent art means the row renders exactly as it does today (§3 — the
 *  kit namespace has no bundled fallback by design).
 *
 *  Binding goes through `resolveNamed` over a one-key list rather than through a hand-rolled stem
 *  comparison, so the two contested rules (an unusable file never binds; on a stem collision the first
 *  in the server's index order wins) have ONE implementation shared with the frontier stack and with
 *  the gallery's annotations. */
export function serviceIconFrom(
  index: MediaIndex | undefined,
  service: ServiceIdentity,
): MediaFile | undefined {
  const key = keyFor(service);
  return resolveNamed(iconFiles(index), [key]).get(key);
}

/** The five service-row surfaces' read of the icon index, with its OWN query policy (Opus M3 — stated
 *  in code, and deliberately not the gallery's):
 *
 *   · a LONG staleTime and no focus refetch. Icons change only when the owner copies a file in from
 *     another machine, and these observers live on every rendered service row of every theme — the
 *     gallery's fresh-on-entry policy here would re-read the directory on every window focus, for a
 *     picture that is the same picture. The gallery keeps that policy where it belongs: on the one
 *     screen the owner opens right after dropping files in, which also invalidates this query's key.
 *   · SILENT degrade. There is no error branch anywhere below: an unreachable index is `undefined`
 *     data, which resolves to no icon, which is the icon-less row the surfaces already render.
 *
 *  Same `["media", ns]` key family as the gallery, so a gallery save invalidates BOTH (the save's
 *  invalidation is prefix-matched on `["media"]`). */
export function useServiceIcons(): (service: ServiceIdentity) => MediaFile | undefined {
  const { data } = useMediaIndex(KIT_NS, {
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  });
  return useCallback((service) => serviceIconFrom(data, service), [data]);
}

// ── the gallery's side: the keys are DATA, so the annotations are too ─────────────────────────────

/** One derived KEY row: what the owner would name a file, who uses it, and what currently answers. */
export interface ServiceKeyRow {
  /** The normalized key — what the file's stem has to match. */
  key: string;
  /** Every service collapsing to this key, in fleet order. More than one is a service/service collision:
   *  services are not in the media index, so there is no winner to pick — BOTH share the file (§5). */
  services: string[];
  /** The file that took it, if any. */
  file?: MediaFile;
  /** False when no file could ever be named this (a path separator in the key, or an empty one). */
  representable: boolean;
}

export interface ServiceKeyBindings {
  rows: ServiceKeyRow[];
  /** The files' side of the same answer — bound / shadowed / unmatched, from the SHARED classifier, so
   *  a derived-key role and a static-key one diagnose a drop identically (Codex M3 MED-1). */
  binding: NamedBinding<MediaFile>;
}

/** Everything the gallery says about the `services` role, derived from the LIVE fleet: the KEY rows
 *  (which the static-key roles get from the registry instead) plus the generic file classification. */
export function serviceKeyBindings(
  services: readonly ServiceIdentity[],
  files: readonly MediaFile[],
): ServiceKeyBindings {
  const byKey = new Map<string, ServiceKeyRow>();
  for (const service of services) {
    const key = keyFor(service);
    const row = byKey.get(key);
    if (row) row.services.push(service.name);
    else byKey.set(key, { key, services: [service.name], representable: isStemRepresentable(key) });
  }
  const binding = classifyNamed(files, [...byKey.keys()]);
  for (const [key, file] of binding.byKey) {
    // The row is present by construction (the keys came from it) — the classifier returns only keys it
    // was given. Both directions are recorded because the gallery asks the question both ways.
    const row = byKey.get(key);
    if (row) row.file = file;
  }
  return { rows: [...byKey.values()], binding };
}

/** The gallery's own data dependency (Opus M5): the keyed panel fetches the services ITSELF rather than
 *  being handed them, because the alternative is threading fleet data through a namespace-generic
 *  gallery for the benefit of one role.
 *
 *  `enabled` is a parameter rather than a call site condition so the gallery can call this once per role
 *  section unconditionally (rules of hooks) and pay for it only on the role that has a `keySource`.
 *
 *  THREE outcomes, not two (Codex M3 LOW-2). No list yet is either "still loading" or "the request
 *  failed", and collapsing them left a terminally failed query rendering "reading the fleet's
 *  services…" forever — a spinner for something that will never arrive. `failed` separates them so the
 *  gallery can say which. Neither may say "no service is called that": claiming that on the strength of
 *  a list we do not have is the one wrong sentence here (§5), so the FILES keep their `unknown` badge in
 *  both states.
 *
 *  It joins the app-wide `["services"]` query WITHOUT driving its poll (`pollSeconds: false`): the
 *  gallery wants the identities, not the liveness, and the cadence of a shared query belongs to the
 *  consumer that needs it to move. Entering Conf still re-reads it once (the list is stale by then),
 *  which is the same fresh-on-entry promise the gallery makes about the files themselves. */
export function useDerivedServiceKeys(enabled: boolean): {
  services: ServiceIdentity[] | undefined;
  failed: boolean;
} {
  const { data, isError } = useServices(false, { enabled });
  // A cached list with a failed REFETCH is not a failure the owner needs told about: the annotations
  // are still answerable, just from a slightly older list. `failed` is only the state with nothing.
  return { services: enabled ? data : undefined, failed: enabled && isError && data === undefined };
}
