// The gacha Fleet's pure DERIVATIONS (D52 / GACHA_PLAN §6.1–§6.4) — the card geometry rule, the rate pill's
// and the counter's loading semantics, and the templated promo/plate copy. Pure and React-free for the same
// reason `roster.ts` and `stars.ts` are: the §7 acceptance-matrix rows they own (0 / 1 / many hosts, a fleet
// that has not resolved yet, a host with no role) are then ordinary unit tests rather than render assertions.

import type { Host } from "../../types";
import { GACHA_COPY, SCENE_TITLES, unitTags } from "./copy";

/** A capsule card's shape in the track. The prototype's three: `pair` is the default 3/4 portrait (two per
 *  row), `feat` and `wide` both span the full width at their own aspect ratios. */
export type CapsuleShape = "feat" | "pair" | "wide";

/** The card-geometry rule (Q8.10, ruled by the main seat; eyeball-tunable at the G1 gate).
 *
 *  host[0] is the FEATURED card, the rest fall into 3/4 pairs, and a trailing ODD host takes the wide slot
 *  rather than sitting alone in a half-width column with a hole beside it. At four hosts that reproduces the
 *  prototype exactly — feat, a pair, then wide (index.html:10-13) — which is what makes this a port rather
 *  than an invention; at every other count it is the same rule, so the track never has a ragged row.
 *
 *  A pure function of the COUNT alone: it must not depend on which hosts are online, or the layout would
 *  re-shuffle on a poll. */
export function cardShapes(hostCount: number): CapsuleShape[] {
  if (!Number.isFinite(hostCount) || hostCount <= 0) return [];
  const n = Math.floor(hostCount);
  const trailingOdd = (n - 1) % 2 === 1; // the hosts AFTER the featured one don't pair up evenly
  return Array.from({ length: n }, (_, i) =>
    i === 0 ? "feat" : i === n - 1 && trailingOdd ? "wide" : "pair",
  );
}

/** The `NEW` ribbon's host — a DEMO (G6 item iv, owner-ruled: no semantics, no data seam; the owner
 *  decides keep/drop/meaning at the device round). The prototype hangs a third `state` value on one
 *  fixture card and no live field feeds it, so exactly one machine in the track wears the ribbon and the
 *  choice is arbitrary.
 *
 *  The RULE it has to obey is the interesting part: the pick is made ONCE and STICKS until that host
 *  leaves the fleet — never re-rolled on a poll re-render, or the ribbon would hop from card to card
 *  every few seconds. So this is a pure REDUCER over (the current host ids, the current pick): it keeps a
 *  live pick, re-rolls only when there is none or the picked machine is gone, and an empty fleet resolves
 *  to `null` (no ribbon). `rand` is injected so the rule is testable without stubbing Math.random. */
export function pickRibbonHost(
  hostIds: readonly string[],
  current: string | null,
  rand: () => number = Math.random,
): string | null {
  if (hostIds.length === 0) return null;
  if (current !== null && hostIds.includes(current)) return current;
  // clamp: a `rand` that returns exactly 1 (or anything out of range) must not index past the end
  const i = Math.min(hostIds.length - 1, Math.max(0, Math.floor(rand() * hostIds.length)));
  return hostIds[i];
}

/** Has a poll produced an answer yet? The §6.3 rule the pills and the counter share: while the first poll is
 *  in flight, "0 online" is a LIE, not a state — so it renders held until something real arrives. Cached
 *  data from a previous success counts as resolved even while a background refetch is erroring (TanStack
 *  keeps the data; the surface must not collapse — Codex R4-4). A hard failure with no data ever is
 *  unresolved, which is also the hero-only case.
 *
 *  `hasData` is the QUERY's own fact (`useFleet.hasData` / `.svcHasData`), not an item count: a fleet that
 *  legitimately answered with zero machines and then hit a background refetch error has answered, and
 *  counting hosts would call that unresolved and blank a pill that was reading a true 0.0% a second earlier.
 *
 *  QUERY-SHAPED, not host-shaped (renamed from `hostsResolved` at G6.5, Codex's MED-2): it takes exactly a
 *  TanStack query's three lifecycle facts, and gacha now asks it about two independent pollers — the fleet
 *  for the rate pill and the counter, the SERVICES for the pity pill. One rule, so the two pills cannot
 *  disagree about what "not answered yet" looks like. */
export function queryResolved(isLoading: boolean, error: unknown, hasData: boolean): boolean {
  return hasData || (!isLoading && !error);
}

/** What the G1 chrome reads while the fleet is still loading — the rate pill and the counter (§6.3), both
 *  owner-eyeballed with this ASCII hyphen. The DOSSIER's held metrics are different: §4.8 rules a literal
 *  em dash there, which lives in `copy.ts` (`metricPending`) because gacha TS outside copy.ts is
 *  ASCII-fenced. (The original claim that an em dash would force a font regen was wrong — the latin faces
 *  carry U+2014 in their `U+2000-206F` range; the JP subsets gained it at the same regen that recorded
 *  this.) */
export const PENDING = "-";

/** The rate pill (§6.3): the star mode's ceiling + the live count of ONLINE hosts as a gacha drop rate.
 *  The prototype's own format, `★3 RATE 3.0%` (index.html:7), with the mode and the count made live. */
export function rateText(maxStars: number, onlineCount: number, resolved: boolean): string {
  return `${GACHA_COPY.star}${maxStars} RATE ${resolved ? onlineCount.toFixed(1) : PENDING}%`;
}

/** The pity pill — 天井 + the live count of ONLINE SERVICES fleet-wide (owner 2026-08-06: the prototype's
 *  frozen `天井 200` flavour "should make some sense" — its partner pill already counts online machines, so
 *  this one counts online services). Same held convention as the two above, but `resolved` must answer for
 *  BOTH pollers here (G6.5): the services query is independent of the fleet's, so a hosts-only readiness
 *  test published a confident `天井 0` for as long as the services request was still in flight. */
export function pityText(onlineServices: number, resolved: boolean): string {
  return `${GACHA_COPY.pityLabel} ${resolved ? onlineServices : PENDING}`;
}

/** The track counter — the prototype's zero-padded `04 / 04` (online / total), and a held pair until the
 *  fleet resolves. Zero-padding is the prototype's look and stops the head jittering between 9 and 10
 *  hosts; past 99 the natural width takes over. */
export function counterText(onlineCount: number, total: number, resolved: boolean): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return resolved ? `${pad(onlineCount)} / ${pad(total)}` : `${PENDING} / ${PENDING}`;
}

/** A capsule card's plate subtitle — the prototype's `ROLE · 18 ms`, and `ROLE · 待機中` when the machine is
 *  asleep (index.html:10-13; 待機中 = "standing by", the one frozen JP string on a card). Role falls back to
 *  the OS when a machine declares none, which is the same pair the Kit's own device row uses. A missing ping
 *  on an online host drops the segment rather than printing an em dash: the plate is a nameplate, not a
 *  metrics row. */
export function plateSub(host: Host): string {
  const online = !!host.status?.online;
  const ping = host.status?.ping_ms;
  const state = online ? (ping == null ? null : pingText(ping)) : GACHA_COPY.cardSleeping;
  return state === null ? roleLabel(host) : `${roleLabel(host)} ${GACHA_COPY.sep} ${state}`;
}

/** A ping, as the arcade prints it — the ONE formatter behind the capsule plate and the dossier's Ping
 *  tile, so a machine never reads two different latencies on two surfaces.
 *
 *  The prototype's fixture pings are tidy integers ("18 ms"); a real backend is not. The machine ctrl-b
 *  runs on answers its own ping in FRACTIONS of a millisecond, and `${0.025} ms` is both ugly and
 *  meaningless at plate size — so anything under a millisecond reads as the honest bound instead, and
 *  everything else rounds to whole milliseconds (the resolution a ping poll actually carries). */
export function pingText(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return PENDING;
  return ms < 1 ? "<1 ms" : `${Math.round(ms)} ms`;
}

/** The unit DOSSIER's subtitle (G2) — the prototype's `Workstation · ONLINE` line under the machine name
 *  (index.html:28, `${role} · ${status}`). Same role fallback as a capsule plate, and the state spelled in
 *  the same two words the card's chip uses, so the two surfaces describe a machine identically. */
export function dossierSub(host: Host, online: boolean): string {
  return `${roleLabel(host)} ${GACHA_COPY.sep} ${online ? "ONLINE" : "SLEEPING"}`;
}

/** A machine's role in the arcade's voice: its configured role, falling back to the OS when it declares
 *  none — the same pair the Kit's own device row uses. Upper-case because every gacha caption is.
 *
 *  EXPORTED since E1 (§12.6 ruling 8): the poster's slice caption and its data block print the same role in
 *  the same voice as a capsule plate and a dossier subtitle, and a second `(role ?? os_type).toUpperCase()`
 *  somewhere else is exactly the near-duplicate the one-source rule exists to stop. */
export function roleLabel(host: Host): string {
  return (host.role ?? host.os_type).toUpperCase();
}

// ── THE TAP POLICY (GACHA_PLAN §12.6 rulings 2 + 3, AMENDED by owner ruling on the third dev-unit walk) ──
// "By default I don't want the double tap — only when the PC needs to be woken up."
//
// So select-then-act survives for exactly the case it was worth paying for: an accidental WAKE. An ONLINE
// machine opens on ONE tap (and that tap selects it too, so the registry follows — the cosmos one-tap
// select-and-open precedent); a SLEEPING machine keeps the two-step, where the first tap is the guard
// against waking a machine by mistake and the second is the ceremony's cue.
//
// …EXCEPT ON THE COVER (§12.6 ruling 9 + the walked lab, ruled by the main seat at E2), which keeps the
// ORIGINAL select-then-act table: a cut-in is not a machine you act on, it is the NEXT COVER — tapping one
// always promotes it, online or not, because the promotion IS the composition changing. The third-walk
// narrowing was about a STACK of equal slices, where "open the one I tapped" is the obvious read; a cover
// has one hero and N supporting cut-ins, and there the obvious read is "put that one on the cover".
//
// The rule is ONE pure function so both grammars can be read as one table, and so the render tests assert an
// OUTCOME rather than the presence of a branch. Two grammars, ONE function, because they differ in exactly
// one row (an online machine that is not the selection) — two near-duplicate three-line tables would be the
// classic way to let that row drift. Two council clauses live in the CALLER, not here, and are worth naming:
// liveness must come from the CURRENT render (never captured at the first tap — a machine that woke between
// two taps must open, not wake again), and a `wake` result NO-OPS while that host is busy.

/** What a tap on a machine does under select-then-act. */
export type FleetTap = "select" | "open" | "wake";

/** WHICH tap table a fleet layout reads.
 *
 *  · `act-first` — capsule/poster (the owner's third-walk narrowing): an ONLINE machine acts on tap ONE.
 *  · `select-first` — cover (the walked lab): a machine that is not the current selection is SELECTED
 *    first, whatever its liveness; only the selection itself acts. */
export type TapGrammar = "act-first" | "select-first";

/** The grammar a registered fleet layout uses. Keyed on the layout id `fleetSurface` resolves, and it
 *  DEGRADES THE SAME WAY that resolver does — an unknown id there falls back to `capsule`, and an unknown
 *  id here falls back to capsule's grammar, so the two can never disagree about a stale synced value.
 *
 *  It lives beside the table rather than in `fleetSurface.ts` because it IS part of the table: the two
 *  grammars and the map from layout to grammar are one decision, unit-tested in one place. */
export function tapGrammarFor(layoutId: string): TapGrammar {
  return layoutId === "cover" ? "select-first" : "act-first";
}

/** THE PICKUP BANNER's FORM — the `banner` setting's three values (§12.6 ruling 6, slice E3).
 *
 *  · `on` — the shipped 232 px hero band.
 *  · `minimal` — the 88 px strip: a RE-AUTHORED form (re-scaled tag, display line, pills and dots, no
 *    caption), not the same band with its height clipped.
 *  · `off` — nothing rendered at all. */
export type BannerMode = "on" | "minimal" | "off";

/** The form an unreadable value falls back to — and it MUST equal the `banner` row's declared default
 *  (`themes/gacha/index.tsx`), which a test pins so the two cannot drift. It is restated here rather than
 *  read from the registry for the reason `stars.ts` restates `five`: this module is pure and is imported
 *  BY the theme descriptor, so reaching back into the registry would close an import cycle for a constant.
 *
 *  `minimal` since the owner's 2026-08-09 live ruling. Note what did NOT change with it: the fallback is
 *  still a form that RENDERS. An unreadable setting must never be the reason a surface disappears, so
 *  whichever value this tracks, it can never be `off`. */
const BANNER_FALLBACK: BannerMode = "minimal";

/** Narrow a raw setting value to a `BannerMode` — the `toStarMode` bridge, one axis over.
 *
 *  `useThemeSetting` has already validated the value against the declared options, so this is the TYPE
 *  bridge and the last line of defence for a non-hook caller, not a second validation layer. */
export function toBannerMode(raw: string | boolean | undefined): BannerMode {
  if (raw === "on" || raw === "minimal" || raw === "off") return raw;
  return BANNER_FALLBACK;
}

/** The RESOLVED selection — the machine an alt layout is actually showing as picked (§12.6 ruling 2).
 *
 *  "The stored pick if the fleet still has it, else the first machine." A named function rather than an
 *  inline `??` because the naive form is subtly wrong and shipped that way once (Codex E1 LOW-3):
 *  `pickedId ?? hosts[0]?.id` lets a non-null-but-VANISHED id win, so between the poll that removed the
 *  machine and the passive effect that clears the state there is one committed frame with no selected
 *  slice and no registry — and a tap in that window selects instead of acting.
 *
 *  It is resolved in RENDER and never written back, which is what makes host[0] the boot selection with no
 *  state write and what keeps this from needing an effect at all. `null` only for an empty fleet. */
export function resolvePick(pickedId: string | null, hosts: readonly Host[]): string | null {
  if (pickedId !== null && hosts.some((h) => h.id === pickedId)) return pickedId;
  return hosts[0]?.id ?? null;
}

/** Route one tap. `selectedId` is the RESOLVED selection the view is rendering (`picked ?? hosts[0]?.id`,
 *  §12.6 ruling 2 — resolved in the view, never written to state), `tappedId` the machine that was tapped,
 *  `online` its liveness AS CURRENTLY RENDERED, and `grammar` the tapped layout's table (`tapGrammarFor`).
 *
 *  THE WHOLE TABLE, both grammars, eight rows:
 *
 *    selected?  online?  act-first (capsule/poster)   select-first (cover)
 *    ─────────  ───────  ─────────────────────────    ────────────────────
 *       yes       yes    open                         open      (the hero opens its dossier)
 *       yes        no    wake                         wake      (the hero develops)
 *        no       yes    open  (+ selects on the way)  select   (the cut-in takes the cover)
 *        no        no    select                       select
 *
 *  Under `act-first` an ONLINE machine never returns a bare `select`: opening its dossier IS the act, and
 *  the caller selects it on the way through — so `selectedId` only matters while a machine is asleep. */
export function tapAction(
  selectedId: string | null,
  tappedId: string,
  online: boolean,
  grammar: TapGrammar,
): FleetTap {
  const selected = tappedId === selectedId;
  // the one row the two grammars disagree on — a cover's cut-in is promoted, never opened
  if (!selected && grammar === "select-first") return "select";
  if (online) return "open";
  return selected ? "wake" : "select";
}

/** The alt layouts' accessible name, and it says exactly as many steps as the control HAS (the lab's own
 *  two forms, `labelFor` and `labelPoster`, wording verbatim).
 *
 *  ONLINE machines are one-tap since the owner's third-walk amendment, so they take the ONE-step sentence —
 *  a label promising a select that no longer happens would be its own trap, the mirror of the one the
 *  two-step wording exists to avoid. SLEEPING machines keep both steps named, because that is where the
 *  two-step survives and nobody who cannot see the selected nudge should have to discover it.
 *
 *  A NEW function rather than an edit to `openLabel` (R25 §Q1d): that one is shared by the capsule cards AND
 *  the banner promos, and must keep saying what it says byte-for-byte. */
export function pickLabel(host: Host, stars: number, selected: boolean, waking = false): string {
  const online = !!host.status?.online;
  // WAKING is a third liveness (sol confirm MED-2, 2026-08-30): the chip says it, and an aria-label
  // REPLACES the chip's text — without this form a screen reader heard "sleeping. Tap to run the
  // wake sequence" on a machine whose wake is already running (and whose re-tap the busy union
  // refuses). Online outranks it, exactly as at the chip. Selection still works while waking, so
  // that step keeps its promise; only the wake instruction goes.
  const head = `${host.name}, ${roleLabel(host).toLowerCase()}, ${stars} stars, ${
    online ? "online" : waking ? "waking" : "sleeping"
  }. `;
  if (online) return `${head}Opens the unit dossier.`;
  if (waking)
    return selected
      ? `${head}Selected. Wake sequence in progress.`
      : `${head}Tap to select. Wake sequence in progress.`;
  return selected
    ? `${head}Selected. Tap to run the wake sequence.`
    : `${head}Tap to select; tap again to run the wake sequence.`;
}

/** THE COVER's accessible names (E2 — the lab's `labelCover`, wording verbatim). Two forms, because a
 *  cover has two kinds of control and they do two different things: the HERO opens or develops, a CUT-IN
 *  always puts itself on the cover. Same law as `pickLabel` — a control's name says exactly what it does,
 *  and it carries the liveness because an `aria-label` REPLACES the chip text inside the button.
 *
 *  A THIRD builder rather than a mode on `pickLabel`: cover's sentences are not that one's with a word
 *  changed (they name the cover, not a selection), and `openLabel` — the capsule card + banner promo's —
 *  still has to stay byte-identical (R25 §Q1d). */
export function labelCover(host: Host, stars: number, isHero: boolean, waking = false): string {
  const online = !!host.status?.online;
  const head = `${host.name}, ${roleLabel(host).toLowerCase()}, ${stars} stars, `;
  // The WAKING forms (sol confirm MED-2): no develop/promote promise — the busy union disables the
  // control for the grace window, and a name instructing a wake on a machine already waking was the
  // sighted/spoken contradiction the finding quotes. Online outranks waking, as at the chip.
  if (isHero)
    return (
      `${head}on the cover, ` +
      (online
        ? "online. Opens the unit dossier."
        : waking
          ? "waking. Wake sequence in progress."
          : "sleeping. Develops the cover and wakes it.")
    );
  // A waking cut-in KEEPS its promote promise (owner ruling 2026-08-30, second pass): selection is
  // never held — only the hero's action tap is — so the sentence stays true through the window.
  return `${head}${online ? "online" : waking ? "waking" : "sleeping"}. Supporting cut-in. Puts it on the cover.`;
}

/** The cover's ISSUE line — `ISSUE 01 · ONLINE`, the masthead's own read of which machine is on the cover
 *  and how it is doing. The lab's `ISSUE 0${hero+1} · ${status}` with the zero-pad made honest past nine
 *  (`counterText`'s idiom: pad to two, then let the natural width take over).
 *
 *  It is why cover ignores the shared `counter` prop: `NN / NN` is the TRACK's read, and a magazine states
 *  its issue number instead. A nonsense index resolves to issue 01 rather than throwing on a render path. */
export function issueLine(heroIndex: number, online: boolean): string {
  const n = Number.isFinite(heroIndex) ? Math.max(0, Math.trunc(heroIndex)) + 1 : 1;
  return `${GACHA_COPY.coverIssue} ${String(n).padStart(2, "0")} ${GACHA_COPY.sep} ${
    online ? "ONLINE" : "SLEEPING"
  }`;
}

/** What the live region says when a cut-in is PROMOTED (the lab's own sentence, at the ceremony's first
 *  beat). The cover NARRATES ITS OWN promote — two sentences, one per end of the page turn — which is why
 *  `GachaFleet` stays quiet under the `select-first` grammar: a generic "X selected." fired from the
 *  dispatch would be a third voice inside one gesture. */
export function coverPromoteAnnounce(name: string): string {
  return `${name} takes the cover.`;
}

/** …and what it says once the turn has landed. This one is POLL-TRUTHFUL by construction: it reads the
 *  machine's CURRENT status word, so it reports what the fleet says rather than the lab's "{name} is
 *  online." — which was the prototype's fiction about a wake that had not happened (§12.6 ruling 4). */
export function coverSettledAnnounce(host: Host, stars: number): string {
  const online = !!host.status?.online;
  return `${host.name} is on the cover. ${roleLabel(host)}, ${stars} stars, ${
    online ? "ONLINE" : "SLEEPING"
  }.`;
}

/** …and when a sleeping HERO is developed. It reports the REQUEST and stops there, `wakeAnnounce`'s exact
 *  posture: there is deliberately no settled counterpart, because only a hosts poll can know. */
export function coverDevelopAnnounce(name: string): string {
  return `Developing the cover. Waking ${name}.`;
}

/** How far the HERO slot shifts its art's framing LEFT — a FRACTION of the position range (0.20 = the
 *  twenty `object-position` percentage points this has always been).
 *
 *  A LOWER X shows more of the image's left, which slides the SUBJECT rightwards on screen — out from
 *  under the cut-in column that runs down the leading edge. Exported because §12.6 §12.3② hands the number
 *  to the E5 device round: the lab's four hand-authored heroes land between 14 and 20 points of shift
 *  (50% → 30/34/34/36), and 20 is the deepest of them, which is the right default for a column that only
 *  gets wider as the fleet grows.
 *
 *  It is a FRACTION rather than points since S4 (D65 / MEDIA_MANAGER_PLAN §5): the shift is applied by the
 *  hero WINDOW to the position that window itself resolved (`FocalImg`'s `shiftX` -> `lib/focalPosition.ts
 *  #shiftFocalX`), where a framing point has already been mapped through that box's own overflow. The old
 *  `coverHeroFocus` computed it from the ENTRY alone and published it as `--cv-hero-focus` for the image
 *  to inherit, which only a proportional value could ever be. `shiftFocalX` keeps every degrade that
 *  function had — an unparseable or non-finite value comes back untouched rather than voiding the whole
 *  declaration — and its arithmetic is byte-identical on the shipped hand-tuned strings. */
export const COVER_HERO_SHIFT = 0.2;

/** How many stops the per-unit hue ring carries (tokens.css `--gc-unit-1..5`). FIVE because that is how
 *  many per-unit colours the finalists lab defines — a floor, not a choice. */
export const UNIT_HUES = 5;

/** The per-machine HUE for the slice at fleet position `index` — a `--gc-unit-N` token reference (owner
 *  ruling, the E1 dev-unit walk: §12.6 ruling 8's rarity->hue binding is OVERRULED).
 *
 *  WHY IT IS NOT RARITY ANY MORE: the owner's fleet is two 2-star and two 3-star machines, so a rarity
 *  ladder painted it near-homogeneous — the colour was reporting a number he already reads off the stars.
 *  It carries per-unit IDENTITY instead, which is the lab's own grammar (`hueOf(u)` was per-unit). STARS
 *  keep rarity, so the two signals are now genuinely two.
 *
 *  BY FLEET POSITION, not by id hash: the roster resolver's positional idiom (`artForHost`), so a machine's
 *  colour sits beside its portrait under one rule and a poll cannot reshuffle either. The stops themselves
 *  are the PROTOTYPE's own five `--rar-*` literals in the lab's card order (owner ruling — see tokens.css),
 *  so the owner's four machines reproduce the walked screen exactly.
 *
 *  Wraps past the eighth stop rather than clamping (a ninth machine restarts the ring, which is what a ring
 *  is for), and survives a negative or non-finite index at stop 1 — it is on a render path. */
export function unitHueToken(index: number): string {
  const n = Number.isFinite(index) ? Math.trunc(index) : 0;
  return `var(--gc-unit-${(((n % UNIT_HUES) + UNIT_HUES) % UNIT_HUES) + 1})`;
}

/** What the fleet's live region says when a machine is SELECTED (the lab's own sentence). Selection is the
 *  only interaction in this app whose feedback is a grow plus a data block BELOW THE FOLD, so the announce
 *  is not a nicety — for anyone who cannot see either, it is the whole outcome. */
export function pickAnnounce(host: Host, stars: number): string {
  const online = !!host.status?.online;
  return `${host.name} selected. ${roleLabel(host)}, ${stars} stars, ${
    online ? "ONLINE" : "SLEEPING"
  }.`;
}

/** …and what it says when a wake is DISPATCHED. It reports the REQUEST and stops there (§12.6 ruling 4):
 *  there is deliberately no "X is online" counterpart, because only a hosts poll can know that, and the
 *  poll speaks through the machine's own chip. */
export function wakeAnnounce(name: string): string {
  return `Waking ${name}.`;
}

/** How far a slice steps out of the way while the stack PARTS for a wake ceremony (the lab's `.parting`
 *  block, generalized off its four hardcoded `nth-child` offsets). Signed rungs, not pixels: the CSS
 *  multiplies by its own step token, so the distance stays tunable at the device round.
 *
 *  The lab parts a FIXED four-slice stack; a real fleet is any length, so the part is expressed around the
 *  waking slice — everything above it lifts, everything below it drops — and clamped at two rungs so a
 *  twenty-machine stack doesn't fling its ends off screen. The waking slice itself never moves (it is the
 *  one being looked at, and it carries the selected grow). */
export function partingStep(index: number, wakingIndex: number): number {
  if (!Number.isFinite(index) || !Number.isFinite(wakingIndex)) return 0;
  return Math.max(-2, Math.min(2, Math.trunc(index) - Math.trunc(wakingIndex)));
}

/** The accessible name for the two surfaces that OPEN a machine — a capsule card and its promo slide. One
 *  function because they are one action (the shared `openHost` seam), and their names must not drift apart.
 *
 *  It carries the liveness because an `aria-label` REPLACES an element's content: the card's ONLINE /
 *  SLEEPING chip is real text inside the button, and labelling the button "open X dossier" alone would
 *  silently drop it from the accessible name. The frontier fleet's own `name — online/asleep` labels are the
 *  in-repo precedent for spelling the state out. */
export function openLabel(name: string, online: boolean, waking = false): string {
  // The waking word (sol confirm MED-2) — the action half stays byte-identical in every state
  // (R25 §Q1d): a capsule card opens the dossier whatever the liveness, so only the status changes.
  // The banner promo call site passes no third argument and keeps its historical two-state name.
  return `open ${name} dossier, ${online ? "online" : waking ? "waking" : "sleeping"}`;
}

/** The dossier's dismiss label. ONE string, two controls: the kit sheet's own sr-only close button and the
 *  theme's visible corner (the prototype's `.close-detail`, owner-restored 2026-08-02). They do the same
 *  thing to the same sheet, so they say the same thing — a second wording would read as a second action. */
export const CLOSE_DOSSIER_LABEL = "Close unit dossier";

/** The dossier PORTRAIT's own name, once it becomes a real button (the art showcase, owner request
 *  2026-08-02). An ACTION, phrased like one — the sibling of `openLabel` above, and deliberately not the
 *  same string as the surface it opens (`artViewLabel`): a control says what it does, a dialog says what
 *  it is. It carries the machine's name for the same reason the capsule's does — a screen reader hearing
 *  "show art full screen" alone could not tell WHICH unit's dossier it is in. */
export function showArtLabel(name: string): string {
  return `show ${name} art full screen`;
}

/** The full-screen art view's own accessible name (the `role="dialog"` label). */
export function artViewLabel(name: string): string {
  return `${name} art, full screen`;
}

/** The art view's dismiss label. Its own wording rather than `CLOSE_DOSSIER_LABEL`: this closes the ART,
 *  and the dossier it stands on stays open behind it — one name per thing dismissed. */
export const CLOSE_ART_LABEL = "Close art view";

/** A banner SCENE slide's display line: its name from the ruled `SCENE_TITLES` pool, picked by POSITION
 *  and never by filename. Cycling means a folder of any size is titled deterministically — the ninth drop
 *  wraps to the pool's head rather than falling back to a number — and the owner authors nothing per
 *  image. A nonsense position resolves to the first title rather than throwing on a render path. */
export function sceneTitle(position: number): string {
  const n = SCENE_TITLES.length;
  const i = Number.isFinite(position) ? ((Math.trunc(position) % n) + n) % n : 0;
  return SCENE_TITLES[i];
}

/** The poster slice's CORNER TAG — one kanji from the frozen pool, by fleet POSITION (owner ruling, the
 *  third dev-unit walk). Deliberately the `sceneTitle` idiom rather than anything host-derived: §12.6
 *  ruling 8 dropped the lab's per-HOST JP as mock-roster fiction, and this revives the LOOK without the
 *  claim — the tag is decoration, is `aria-hidden`, and says nothing about the machine it sits on.
 *
 *  Cycles, so any fleet size is tagged deterministically with no per-host authoring, and a nonsense index
 *  resolves to the first glyph rather than throwing on a render path (`sceneTitle`'s own contract). */
export function unitTag(index: number): string {
  const pool = unitTags();
  const i = Number.isFinite(index)
    ? ((Math.trunc(index) % pool.length) + pool.length) % pool.length
    : 0;
  return pool[i];
}

/** A promo slide's templated copy (§6.4 / the R8 amendment): the tag pill and the JP caption are per-STATE
 *  templates, and the display line is the host's own name. The exact strings are frozen in `copy.ts` — the
 *  owner's pick at the G1 eyeball is a value edit there, not a change here. */
export function promoCopy(online: boolean): { tag: string; caption: string } {
  return online
    ? { tag: GACHA_COPY.promoTagOnline, caption: GACHA_COPY.promoCaptionOnline }
    : { tag: GACHA_COPY.promoTagSleeping, caption: GACHA_COPY.promoCaptionSleeping };
}
