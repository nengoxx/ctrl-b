// THE ROSTER, one definition (Phase 27 / D84 §6, §12.3 H1) — routing's module copy of `GET /api/agents`,
// as a LEAF module both sides of the composer/chat import edge read (`lib/agentSlug`'s reason: `lib/composer`
// imports `store/chat`, and the store needs the roster too — for the HOME of a thread-less view, the
// responder's validity, the N2 sweep — so defining it in either would close an import cycle).
//
// THE ROSTER = every agent the server can run under its own name: the listed specialists ∪ the ROOT
// (`DEFAULT_AGENT`, never in `agents` — "the default/root agent isn't listed") ∪ the keys of `summaries`
// (the resolved default is always one, even a folder `list_agent_names` skips). N1, the N2 sweep, the
// ON4 prune, `/agent` (`/agent default` is valid) and the ISS-51 paint all judge against THIS, never
// against `agents` alone — every legacy thread the migration-8 repair pinned to `'default'` is a ROOT
// conversation and must not read as "off the roster".
//
// WRITTEN ONLY by `lib/composer#installAgents` (the one installer both readers of the route go through,
// generation-guarded there). Nothing here is reactive: a surface that has to RENDER the roster reads the
// always-on roster QUERY (`hooks/useAgents#useAgentRoster`); this copy is for imperative moments — a
// verb's validity, a note's display name, the store's home fallback, the sweep.

import { DEFAULT_AGENT } from "./agentSlug";

/** The part of a `GET /api/agents` read the roster keeps. `summaries` is optional for `AgentListing`'s
 *  reason (a pre-D70 cached response, an e2e mock) — without it the names are the list + the root, and
 *  every display name is the slug. */
export interface RosterWire {
  agents: string[];
  default: string;
  summaries?: Record<string, { title?: string } | undefined>;
}

let names = new Set<string>([DEFAULT_AGENT]);
let titles = new Map<string, string>();
let defaultName = DEFAULT_AGENT;
let landed = false;

/** Install one LANDED roster read. Called by `installAgents` only (after its generation guard). */
export function landRoster(data: RosterWire): void {
  const summaries = data.summaries ?? {};
  names = new Set([DEFAULT_AGENT, ...data.agents, ...Object.keys(summaries)]);
  titles = new Map();
  for (const [slug, s] of Object.entries(summaries)) {
    const title = typeof s?.title === "string" ? s.title.trim() : "";
    if (title) titles.set(slug, title);
  }
  defaultName = data.default || DEFAULT_AGENT;
  landed = true;
}

/** Has a roster ever LANDED? Until then nothing is judged against it (§12.3 M3): a name passes
 *  UNJUDGED, and the first landing's sweep (`store/chat#sweepRoster`) judges what was kept. */
export function rosterLanded(): boolean {
  return landed;
}

/** Is `name` on the roster — the root always is. Meaningful only once `rosterLanded()`; callers that
 *  must not judge before the landing use `offRoster`. */
export function onRoster(name: string): boolean {
  return name === DEFAULT_AGENT || names.has(name);
}

/** Is `name` judged OFF the roster — `false` before a roster has landed (unjudged, M3). */
export function offRoster(name: string): boolean {
  return landed && !onRoster(name);
}

/** The CONFIGURED default's slug (the roster's resolved `default` — the root when nothing is set, the
 *  root also before a roster lands). The home of a thread-less view and of every `/new` mint. */
export function rosterDefault(): string {
  return defaultName;
}

/** Every roster slug, the root first — `/agent <tab>`'s completions. */
export function rosterSlugs(): string[] {
  return [DEFAULT_AGENT, ...[...names].filter((n) => n !== DEFAULT_AGENT)];
}

/** An agent's DISPLAY NAME — its `title`, else its slug (D84 §2's notes: `Name`). */
export function displayName(slug: string): string {
  return titles.get(slug) ?? slug;
}
