// The DERIVED-KEY sources a `named` media role can declare (`MediaRoleDef.keySource`) — one row per
// source, holding the two things the gallery cannot invent: WHICH live list the keys come from, and what
// to call that list in a sentence.
//
// It exists because the second dynamic source arrived (Codex A1). The M3 path was service-shaped end to
// end — a `useDerivedServiceKeys` hook, a `serviceKeyBindings` model and hardcoded "service"/"icon" copy
// inside `MediaGallery` — so `hosts` would have been a parallel branch, and the source after that a
// third. Now the gallery reads ONE shape: `{consumers, failed, def}` in, a generic
// `deriveKeyBindings` (lib/media.ts) over it, one renderer. A future `agents`/`containers` source is a
// row in `SOURCES` below plus a `keySource` value — no gallery change at all.
//
// It sits beside the registry that declares the union rather than inside `components/`, so the type and
// its implementations cannot drift apart, and beside `kit/ownerArt.ts`, which resolves the SAME keys on
// the render side through the same `lib/media` rules.

import { useHosts } from "../hooks/useFleet";
import { useServices } from "../hooks/useServices";
import { hostKeyFor, keyFor, type KeyedConsumer } from "../lib/media";
import type { MediaKeySource } from "./mediaRegistry";

/** The words one source contributes to the gallery. Everything ROLE-shaped (what a file of this role IS)
 *  comes from `MediaRoleDef.asset` instead, because two roles can share one source — the kit's icons and
 *  its service banners are both keyed by service identity. */
export interface MediaKeySourceDef {
  /** The plural noun for the things the keys come from ("services", "machines") — used where the sentence
   *  is about the LIST rather than about the art. */
  consumers: string;
  /** While the list is in flight. */
  loading: string;
  /** The list will never arrive: a terminal query, told apart from the one above (Codex M3 LOW-2) so the
   *  gallery never shows a spinner sentence for something that is not coming. */
  failed: string;
  /** The list arrived and is EMPTY — there is nothing to name a file after, which is not the same as
   *  "you have dropped nothing in yet". */
  none: string;
}

const SOURCES: Record<MediaKeySource, MediaKeySourceDef> = {
  services: {
    consumers: "services",
    loading: "reading the fleet’s services…",
    failed: "service list unavailable — bindings unknown",
    none: "No services are declared on any machine yet — nothing to name a file after.",
  },
  hosts: {
    // "machines" is the owner-facing word everywhere else in Conf (the Machines editor, `computers:`),
    // so the gallery says machines even though the role folder and the API say `hosts`.
    consumers: "machines",
    loading: "reading the fleet’s machines…",
    failed: "machine list unavailable — bindings unknown",
    none: "No machines are configured yet — nothing to name a file after.",
  },
};

/** What the gallery renders a derived-key role from. `consumers === undefined` is the THIRD state, not an
 *  empty list (Opus M5): annotating files against a list we do not have would flag every correctly-named
 *  one as unmatched. `failed` says which of its two causes it is. */
export interface DerivedKeySource {
  def: MediaKeySourceDef;
  consumers: KeyedConsumer[] | undefined;
  failed: boolean;
}

/** The gallery's own data dependency (Opus M5): the keyed panel fetches its key list ITSELF rather than
 *  being handed it, because the alternative is threading fleet data through a namespace-generic gallery
 *  for the benefit of two roles.
 *
 *  Every source's query is CALLED unconditionally and ENABLED selectively, so the gallery can call this
 *  once per role section (rules of hooks) and pay only for the role that declares a `keySource`.
 *  Neither drives a poll (`pollSeconds: false`): the gallery wants the identities, not the liveness, and
 *  the cadence of a shared query belongs to the consumer that needs it to move. Entering Conf still
 *  re-reads each list once (it is stale by then), which is the same fresh-on-entry promise the gallery
 *  makes about the files themselves.
 *
 *  A cached list with a failed REFETCH is not a failure the owner needs told about: the annotations are
 *  still answerable, just from a slightly older list. `failed` is only the state with nothing at all. */
export function useMediaKeySource(source: MediaKeySource | undefined): DerivedKeySource | null {
  const services = useServices(false, { enabled: source === "services" });
  const hosts = useHosts(false, "self-first", { enabled: source === "hosts" });
  if (source === undefined) return null;
  const query = source === "services" ? services : hosts;
  const consumers =
    source === "services"
      ? services.data?.map((s) => ({ key: keyFor(s), label: s.name }))
      : hosts.data?.map((h) => ({ key: hostKeyFor(h), label: h.name }));
  return {
    def: SOURCES[source],
    consumers,
    failed: query.isError && query.data === undefined,
  };
}
