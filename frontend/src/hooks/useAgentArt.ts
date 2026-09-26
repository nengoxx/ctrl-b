import { useMutation } from "@tanstack/react-query";
import { useMemo } from "react";

import { getJSON, postBlob } from "../api/client";
import { downloadBlob, downloadJson, downloadName } from "../lib/download";
import { paintFallbackTile, readTilePaint, tileInitial } from "../lib/fallbackTile";
import type { FocalArt } from "../lib/focalPosition";
import { exportImage, type ExportBounds } from "../lib/imageExport";
import { orderedUsable, revUrl } from "../lib/media";
import { artFocal, entryId, rowId, shown } from "../lib/mediaLibrary";
import { pushToast } from "../store/toast";
import { MEDIA_NS } from "../theme-engine/mediaRegistry";
import { DEFAULT_AGENT, useAgentRoster, type AgentSummary } from "./useAgents";
import { useMediaIndex, type MediaFile, type MediaIndex } from "./useMedia";

// ONE join of the agent SUMMARY MAP with the `agents` media index (D70 §10-S4, Emma F12) — the single
// place "what does this agent look like, and in whose voice does it speak" is answered.
//
// The two halves are deliberately apart on the wire: `GET /agents` publishes the BINDING
// (`AgentDef.avatar`/`.background` name a library entry) and `GET /api/media/agents` publishes what
// that entry IS (its URL, its framing point, whether it is switched off or unreadable). Neither route
// resolves the other's half — the media index is the one authority on library rows, and the agent
// route would have to duplicate its collation to answer with a URL. This hook is where they meet, so
// the picker, the who-line and (S4 Build 2) the gallery all paint from one resolution instead of three.
//
// It reads the media index ROUTE directly rather than the FE `MEDIA_NS` registry: the `agents` row of
// that registry is Build 2's, and this join needs nothing the registry holds (no theme ladder, no
// slots, no bundled art — the app ships no character art at all).

/** The `agents` namespace and its two static role POOLS (ROLEPLAY_PLAN §8.1 / `core/media.py`'s
 *  `AGENTS_ROLES`) — spelled once here rather than at each consumer. */
export const AGENTS_NS = "agents";
export const AVATARS_ROLE = "avatars";
export const BACKGROUNDS_ROLE = "backgrounds";

/** One picture an agent is bound to, ready to paint: the mount URL (revision-stamped, so replacing the
 *  file in place moves the cache entry) and its framing point, if the owner set one. */
export interface BoundArt {
  url: string;
  focus?: FocalArt;
}

/** An agent as its surfaces render it. `title` is already the DISPLAY name (the agent's own, falling
 *  back to its slug), so a caller never re-implements that fallback. Every art field is absent when the
 *  agent binds nothing, binds something the library no longer holds, or binds an entry the owner
 *  switched off / the server cannot read — which is exactly the "no avatar" case every surface already
 *  has a rendering for. */
export interface AgentArt {
  name: string;
  title: string;
  avatar?: BoundArt;
  background?: BoundArt;
  /** The agent's own TTS voice binding; absent ⇒ the global `voice.tts` chain answers (ruling 21). */
  voice?: string;
}

/** The library row an agent's binding names, or undefined.
 *
 *  `entryId`/`rowId` rather than a name comparison: a binding is the same identity a `slots` pin and a
 *  `files` entry carry (the "W9" union), so it is read by the one parser that reads those — a bare
 *  `row.name === id` would match a file's stem and a bundled id with one string. Hidden and unusable
 *  rows are filtered by the two shipped predicates: the owner switched that entry OFF, or the bytes
 *  cannot paint, and both mean this agent has no picture right now. */
function bound(rows: readonly MediaFile[] | undefined, binding: string): BoundArt | undefined {
  if (!binding || !rows) return undefined;
  const want = entryId({ name: binding });
  if (want === null) return undefined;
  const row = orderedUsable(shown(rows)).find((r) => rowId(r) === want);
  if (row === undefined) return undefined;
  return { url: revUrl(row.url, row.revision), focus: artFocal(row) };
}

/** The pure join (unit-tested directly): one agent's summary + the media index → what to paint. */
export function resolveAgentArt(
  name: string,
  summary: AgentSummary | undefined,
  index: MediaIndex | undefined,
): AgentArt {
  return {
    name,
    title: summary?.title || name,
    avatar: bound(index?.roles?.[AVATARS_ROLE], summary?.avatar ?? ""),
    background: bound(index?.roles?.[BACKGROUNDS_ROLE], summary?.background ?? ""),
    voice: summary?.voice || undefined,
  };
}

/** The resolver every agent-art surface calls: `art(name)` — or `art(null)` for "whichever agent a
 *  bare turn runs as", i.e. the resolved default.
 *
 *  A function rather than a per-agent hook because the transcript resolves one agent PER BUBBLE: a
 *  hook there would be two query observers per message. The identity is stable while the roster and the
 *  index are (TanStack's structural sharing keeps both across a refetch that changed nothing), so it
 *  can be threaded straight through a memoized bubble without breaking its memo. */
export function useAgentArt(): (name: string | null) => AgentArt {
  const roster = useAgentRoster().data;
  const index = useMediaIndex(AGENTS_NS).data;
  return useMemo(() => {
    const fallback = roster?.default || DEFAULT_AGENT;
    return (name: string | null) => {
      const target = name ?? fallback;
      return resolveAgentArt(target, roster?.summaries?.[target], index);
    };
  }, [roster, index]);
}

// ── THE CARD EXPORT (D79 / ROLEPLAY_PLAN §15.3) ──────────────────────────────────────────────────────
//
// The two halves are split by what each end owns: the SERVER composes the card (the fields, the
// executable strip, the `chara`/`ccv3` chunk write — everything security-relevant), the CLIENT owns the
// PIXELS. The backend has no image codec by policy (D65), and a bound avatar is WebP/JPEG as often as
// PNG, so the app re-encodes the picture it already displays through its one canvas chokepoint
// (`lib/imageExport`) and POSTs it as the carrier. It lives HERE because the carrier IS this module's
// question — "what does this agent look like" — and the resolver above is what answers it.

/** The avatars role's own export bound (FULL_ART, 4 MP) — read off the registry rather than restated,
 *  so the card carrier and an avatar upload can never be capped differently. PNG takes no quality
 *  step-down, so its byte half is advisory only (`overBudget`). */
function avatarBounds(): ExportBounds {
  return MEDIA_NS[AGENTS_NS].roles[AVATARS_ROLE].bounds;
}

/** The picture a card is carried in, as PNG bytes (§15.3, "the carrier call, pinned").
 *
 *  With an avatar: the bound file off its same-origin mount URL (so the canvas is never tainted), drawn
 *  WHOLE — the focal point and zoom are display settings, not card pixels — through `exportImage` with
 *  the type FORCED to PNG (the export policy never picks PNG on its own, and the server answers a
 *  non-PNG carrier with a 415). The rect is unbounded and clamped to the DECODED size inside the
 *  export, so EXIF orientation is already applied when it is measured.
 *
 *  Without one (never bound, or bound to an entry the owner switched off / the server cannot read): the
 *  gallery's own letter tile, painted on the main thread (`lib/fallbackTile`) — ST needs an image, and a
 *  1×1 would be a broken card. */
export async function cardCarrier(art: Pick<AgentArt, "title" | "avatar">): Promise<Blob> {
  if (art.avatar === undefined) return paintFallbackTile(tileInitial(art.title), readTilePaint());
  const res = await fetch(art.avatar.url);
  if (!res.ok) throw new Error(`the avatar could not be read (${res.status} ${res.statusText})`);
  const file = await res.blob();
  const out = await exportImage({
    file,
    // The type is FORCED below, so the source's own format decides nothing here.
    sourceFormat: null,
    // The WHOLE picture, in the DECODED (already EXIF-oriented) space the export's rect lives in: an
    // unbounded rect that `clampRect` cuts to the decoded size — the attachments precedent
    // (`lib/attachments.ts`). A size read off the file HEADER would be the pre-rotation one, and a
    // rotated JPEG would come out cropped.
    rect: { x: 0, y: 0, width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER },
    bounds: avatarBounds(),
    override: { type: "image/png" },
  });
  return out.blob;
}

/** Which file an export produces. */
export type CardFormat = "png" | "json";

/** Export one agent as a SillyTavern-compatible card — the PNG (the carrier + the server's two `tEXt`
 *  chunks) or the bare V3 JSON. `name` may be the root (`default`): the root agent is a character too.
 *
 *  The server composes from DISK, so this exports the SAVED character — the editor disables the control
 *  while its form is dirty. The filename is the agent's display name (its title, else its slug); the
 *  server returns bytes only and the client names the blob, so no `Content-Disposition` exists. */
export function useExportCard(name: string) {
  const art = useAgentArt()(name);
  const mutation = useMutation({
    mutationFn: async (format: CardFormat) => {
      const path = `/api/agents/${encodeURIComponent(name)}/card`;
      if (format === "json") {
        downloadJson(downloadName(art.title, ".json"), await getJSON<unknown>(path));
        return;
      }
      const carrier = await cardCarrier(art);
      downloadBlob(downloadName(art.title, ".png"), await postBlob(`${path}.png`, carrier));
    },
    onError: (e: Error) => pushToast(e.message || "Export failed", "err"),
  });
  return { exportCard: mutation.mutate, pending: mutation.isPending };
}
