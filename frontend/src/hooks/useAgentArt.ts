import { useMemo } from "react";

import type { FocalArt } from "../lib/focalPosition";
import { orderedUsable, revUrl } from "../lib/media";
import { artFocal, entryId, rowId, shown } from "../lib/mediaLibrary";
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
const AVATARS_ROLE = "avatars";
const BACKGROUNDS_ROLE = "backgrounds";

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
