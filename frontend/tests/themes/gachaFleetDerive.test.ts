import { describe, expect, it } from "vitest";

import { GACHA_COPY, SCENE_TITLES } from "../../src/themes/gacha/copy";
import { gacha } from "../../src/themes/gacha";
import {
  COVER_HERO_SHIFT,
  PENDING,
  cardShapes,
  counterText,
  coverDevelopAnnounce,
  coverHeroFocus,
  coverPromoteAnnounce,
  coverSettledAnnounce,
  dossierSub,
  issueLine,
  labelCover,
  openLabel,
  partingStep,
  pickLabel,
  pickRibbonHost,
  pingText,
  resolvePick,
  UNIT_HUES,
  unitHueToken,
  plateSub,
  promoCopy,
  pityText,
  queryResolved,
  rateText,
  roleLabel,
  sceneTitle,
  tapAction,
  tapGrammarFor,
  toBannerMode,
} from "../../src/themes/gacha/fleet";
import type { Host } from "../../src/types";

// The gacha Fleet's pure derivations (D52 / GACHA_PLAN §6.1–§6.4). These carry the acceptance-matrix rows
// that are about VALUES rather than markup: the card-geometry rule at every fleet size, the loading
// semantics the rate pill and the counter share (§6.3's "must not read 0.0% while unresolved — that is a
// lie, not a state"), and the plate's role/ping line for a host that declares neither.

const host = (over: Partial<Host> = {}): Host => ({
  id: "pegasus",
  name: "Pegasus",
  ip: "10.0.0.7",
  mac: null,
  ssh_username: null,
  ssh_port: 22,
  os_type: "linux",
  role: "workstation",
  tags: [],
  status: {
    host_id: "pegasus",
    online: true,
    ping_ms: 18,
    last_seen: null,
    checked_at: "2026-01-01T00:00:00Z",
    error: null,
  },
  ...over,
});

describe("cardShapes — the card-geometry rule (Q8.10)", () => {
  it("reproduces the PROTOTYPE at four hosts: feat, a pair, then wide", () => {
    // index.html:10-13 — the four cards the owner signed off on.
    expect(cardShapes(4)).toEqual(["feat", "pair", "pair", "wide"]);
  });

  it.each([
    [0, []],
    [1, ["feat"]],
    [2, ["feat", "wide"]],
    [3, ["feat", "pair", "pair"]],
    [5, ["feat", "pair", "pair", "pair", "pair"]],
    [7, ["feat", "pair", "pair", "pair", "pair", "pair", "pair"]],
  ])("%i hosts", (n, expected) => {
    expect(cardShapes(n)).toEqual(expected);
  });

  it("never leaves a lone half-width card with a hole beside it", () => {
    for (let n = 1; n <= 12; n++) {
      const shapes = cardShapes(n);
      expect(shapes).toHaveLength(n);
      // the pairs must come in twos, whatever the count
      expect(shapes.filter((s) => s === "pair").length % 2).toBe(0);
      expect(shapes.filter((s) => s === "feat")).toHaveLength(1);
    }
  });

  it("survives a nonsense count rather than throwing on a render path", () => {
    expect(cardShapes(-3)).toEqual([]);
    expect(cardShapes(Number.NaN)).toEqual([]);
    expect(cardShapes(2.7)).toEqual(["feat", "wide"]);
  });
});

describe("queryResolved — has a poll actually answered?", () => {
  // The third argument is the QUERY's `hasData`, not a host count: the difference is the whole point of the
  // last case below, which a count-based proxy gets wrong.
  it("the first poll in flight is UNRESOLVED", () => {
    expect(queryResolved(true, null, false)).toBe(false);
  });

  it("a successful poll with ZERO hosts is resolved (an honest zero)", () => {
    expect(queryResolved(false, null, false)).toBe(true);
  });

  it("a hard failure with no data ever is unresolved — that is also the hero-only case", () => {
    expect(queryResolved(false, new Error("backend unreachable"), false)).toBe(false);
  });

  it("a background refetch error KEEPS the last successful set resolved (Codex R4-4)", () => {
    expect(queryResolved(false, new Error("boom"), true)).toBe(true);
  });

  it("an EMPTY-but-successful fleet stays resolved once a refetch starts failing", () => {
    // The case a host COUNT cannot express: the query answered (with nothing), then a poll errored. A
    // count-based proxy reads 0 hosts + an error as "never answered" and blanks a pill that was correctly
    // showing 0.0% a second earlier.
    expect(queryResolved(false, new Error("boom"), true)).toBe(true);
    expect(queryResolved(false, null, true)).toBe(true);
  });
});

describe("rateText — the §6.3 pill", () => {
  it("is the prototype's format with the mode and the online count made live", () => {
    expect(rateText(3, 3, true)).toBe(`${GACHA_COPY.star}3 RATE 3.0%`);
    expect(rateText(5, 4, true)).toBe(`${GACHA_COPY.star}5 RATE 4.0%`);
  });

  it("reads a HELD value while unresolved — never a false 0.0%", () => {
    const held = rateText(5, 0, false);
    expect(held).not.toContain("0.0");
    expect(held).toContain("RATE");
  });

  it("…and reads a real 0.0% once the fleet has genuinely answered with nothing online", () => {
    expect(rateText(5, 0, true)).toBe(`${GACHA_COPY.star}5 RATE 0.0%`);
  });
});

describe("pityText — the 天井 pill made live (owner 2026-08-06)", () => {
  it("is the pity label + the fleet-wide online-service count", () => {
    expect(pityText(7, true)).toBe(`${GACHA_COPY.pityLabel} 7`);
    expect(pityText(0, true)).toBe(`${GACHA_COPY.pityLabel} 0`);
  });

  it("reads a HELD value while unresolved — the rate pill's own convention", () => {
    expect(pityText(0, false)).toBe(`${GACHA_COPY.pityLabel} ${PENDING}`);
  });
});

describe("counterText — the track head's NN / NN", () => {
  it("is zero-padded, like the prototype's 04 / 04", () => {
    expect(counterText(4, 4, true)).toBe("04 / 04");
    expect(counterText(0, 2, true)).toBe("00 / 02");
  });

  it("lets the natural width take over past 99", () => {
    expect(counterText(7, 120, true)).toBe("07 / 120");
  });

  it("holds both halves while unresolved", () => {
    expect(counterText(0, 0, false)).not.toContain("0");
  });
});

describe("plateSub — a capsule's ROLE · state line", () => {
  it("is the role and the ping while online (the prototype's `WORKSTATION · 18 ms`)", () => {
    expect(plateSub(host())).toBe(`WORKSTATION ${GACHA_COPY.sep} 18 ms`);
  });

  it("swaps the ping for the frozen standing-by copy while asleep", () => {
    const asleep = host({ status: { ...host().status!, online: false, ping_ms: null } });
    expect(plateSub(asleep)).toBe(`WORKSTATION ${GACHA_COPY.sep} ${GACHA_COPY.cardSleeping}`);
  });

  it("falls back to the OS when a machine declares no role (the Kit device row's own pair)", () => {
    expect(plateSub(host({ role: null }))).toBe(`LINUX ${GACHA_COPY.sep} 18 ms`);
  });

  it("drops the segment entirely rather than printing a dash for a missing ping", () => {
    const noPing = host({ status: { ...host().status!, ping_ms: null } });
    expect(plateSub(noPing)).toBe("WORKSTATION");
  });

  it("survives a host with no status at all", () => {
    expect(plateSub(host({ status: null }))).toBe(
      `WORKSTATION ${GACHA_COPY.sep} ${GACHA_COPY.cardSleeping}`,
    );
  });

  it("prints a sub-millisecond ping as a bound — the plate and the dossier share the formatter", () => {
    // The machine ctrl-b runs on pings ITSELF in fractions of a ms; `0.025 ms` on a nameplate is noise
    // (caught on the live dev fleet at the G2 screenshot round).
    const local = host({ status: { ...host().status!, ping_ms: 0.025 } });
    expect(plateSub(local)).toBe(`WORKSTATION ${GACHA_COPY.sep} <1 ms`);
  });
});

describe("pingText — the ONE ping format, shared by the plate and the dossier tile", () => {
  it("rounds to whole milliseconds — the resolution a poll actually carries", () => {
    expect(pingText(18)).toBe("18 ms");
    expect(pingText(17.6)).toBe("18 ms");
    expect(pingText(1.2)).toBe("1 ms");
  });

  it("reads anything under a millisecond as the honest bound, never as 0", () => {
    expect(pingText(0.025)).toBe("<1 ms");
    expect(pingText(0)).toBe("<1 ms");
  });

  it("holds rather than throwing on a nonsense value (it is a render path)", () => {
    expect(pingText(Number.NaN)).toBe(PENDING);
    expect(pingText(-1)).toBe(PENDING);
  });
});

describe("dossierSub — the dossier's ROLE · STATE line", () => {
  it("spells the state in the same two words the card's chip uses", () => {
    expect(dossierSub(host(), true)).toBe(`WORKSTATION ${GACHA_COPY.sep} ONLINE`);
    expect(dossierSub(host(), false)).toBe(`WORKSTATION ${GACHA_COPY.sep} SLEEPING`);
  });

  it("falls back to the OS when a machine declares no role — the plate's own pair", () => {
    expect(dossierSub(host({ role: null }), true)).toBe(`LINUX ${GACHA_COPY.sep} ONLINE`);
  });
});

describe("sceneTitle — the banner scenes' named pool (owner-ruled)", () => {
  it("names each drop from the pool, in order", () => {
    expect(SCENE_TITLES.map((_, i) => sceneTitle(i))).toEqual([...SCENE_TITLES]);
  });

  it("CYCLES past the pool's end rather than falling back to a number", () => {
    // A ninth dropped banner image wraps to the head — the whole point of a pool over `EVENT 09`.
    expect(sceneTitle(SCENE_TITLES.length)).toBe(SCENE_TITLES[0]);
    expect(sceneTitle(SCENE_TITLES.length + 3)).toBe(SCENE_TITLES[3]);
  });

  it("resolves a nonsense position to the first title rather than throwing on a render path", () => {
    expect(sceneTitle(-1)).toBe(SCENE_TITLES[SCENE_TITLES.length - 1]);
    expect(sceneTitle(Number.NaN)).toBe(SCENE_TITLES[0]);
  });

  it("is two words, so the hero's two-line break has something to break on", () => {
    for (const t of SCENE_TITLES) expect(t.split(" ")).toHaveLength(2);
  });
});

describe("promoCopy — the per-state slide templates (§6.4 / the R8 amendment)", () => {
  it("uses the frozen ONLINE pair", () => {
    expect(promoCopy(true)).toEqual({
      tag: GACHA_COPY.promoTagOnline,
      caption: GACHA_COPY.promoCaptionOnline,
    });
  });

  it("uses the frozen SLEEPING pair", () => {
    expect(promoCopy(false)).toEqual({
      tag: GACHA_COPY.promoTagSleeping,
      caption: GACHA_COPY.promoCaptionSleeping,
    });
  });
});

// ── The `NEW` ribbon's pick (D52 G6 item iv). The RULE is the whole point: one machine, chosen once, and
//    it STICKS until that machine leaves the fleet. A poll re-render that re-rolled it would make the
//    ribbon hop around the track every few seconds, which is the failure the owner ruling names. ──
describe("pickRibbonHost — the NEW-ribbon demo pick (G6)", () => {
  const first = () => 0; // always index 0
  const last = () => 0.999;

  it("empty fleet → no ribbon", () => {
    expect(pickRibbonHost([], null, first)).toBeNull();
    expect(pickRibbonHost([], "gone", first)).toBeNull();
  });

  it("rolls a pick when there is none", () => {
    expect(pickRibbonHost(["a", "b", "c"], null, first)).toBe("a");
    expect(pickRibbonHost(["a", "b", "c"], null, last)).toBe("c");
  });

  it("KEEPS a live pick — a poll must never re-roll it", () => {
    // `rand` would say "a", but "c" is still in the fleet, so nothing moves.
    expect(pickRibbonHost(["a", "b", "c"], "c", first)).toBe("c");
    // …and it survives the fleet changing around it (a host added, another removed).
    expect(pickRibbonHost(["c", "d", "e"], "c", first)).toBe("c");
  });

  it("re-rolls only when the picked machine has LEFT the fleet", () => {
    expect(pickRibbonHost(["a", "b"], "gone", last)).toBe("b");
  });

  it("clamps a degenerate rand() so it can never index past the end", () => {
    expect(pickRibbonHost(["a", "b"], null, () => 1)).toBe("b");
    expect(pickRibbonHost(["a", "b"], null, () => -1)).toBe("a");
  });

  it("defaults to Math.random and always returns a member of the fleet", () => {
    const ids = ["a", "b", "c", "d"];
    for (let i = 0; i < 50; i++) expect(ids).toContain(pickRibbonHost(ids, null));
  });
});

// ── SELECT-THEN-ACT (GACHA_PLAN §12.6 rulings 2 + 3) — the alt layouts' interaction policy, as VALUES ──
// The R25 §Q7 ④ + ⑤ pins. The router is read as a table here so the render tests can assert outcomes
// instead of branches, and the two-step label is checked against `openLabel` staying byte-identical.

describe("tapAction — the tap router", () => {
  // AMENDED by the owner's third-walk ruling: "by default I don't want the double tap — only when the PC
  // needs to be woken up." So the two-step survives for exactly the case it was worth paying for.
  // [selection, tapped, online, expected]
  const CASES: [string | null, string, boolean, string][] = [
    // ONLINE — one tap, always, whatever the selection is. Opening IS the act; the caller selects on the
    // way through, so a bare `select` can never come back for a live machine.
    [null, "a", true, "open"],
    ["b", "a", true, "open"],
    ["a", "a", true, "open"],
    // SLEEPING — the two-step stands: the first tap is the guard against waking a machine by mistake.
    [null, "a", false, "select"],
    ["b", "a", false, "select"],
    ["a", "a", false, "wake"],
  ];

  it.each(CASES)("selected=%s tapped=%s online=%s -> %s", (selected, tapped, online, want) => {
    expect(tapAction(selected, tapped, online, "act-first")).toBe(want);
  });

  it("ignores the selection entirely while a machine is UP", () => {
    // The sharp form of the amendment: for an online machine the first argument cannot change the answer.
    for (const sel of [null, "a", "b", "somebody-else"])
      expect(tapAction(sel, "a", true, "act-first")).toBe("open");
  });

  it("routes on the CURRENT liveness, not on a remembered one", () => {
    // The council clause the caller has to honour: a machine that woke between the two taps OPENS rather
    // than being woken again. The function has no memory at all, which is what makes that the caller's
    // only job.
    expect(tapAction("a", "a", false, "act-first")).toBe("wake");
    expect(tapAction("a", "a", true, "act-first")).toBe("open");
  });
});

describe("tapAction — the COVER's grammar (E2, the walked lab's original table)", () => {
  // §12.6 ruling 9 + the E2 main-seat ruling: the cover keeps the ORIGINAL select-then-act table, which
  // the third walk narrowed only for the STACK layouts. A cut-in is not a machine you act on — it is the
  // next cover — so tapping one always promotes it, online or not. EVERY ROW, because the two grammars
  // differ in exactly one of them and that is precisely the row a refactor would lose.
  // [selection (= the hero), tapped, online, expected]
  const CASES: [string | null, string, boolean, string][] = [
    // A CUT-IN — always promoted (= selected), whatever its liveness. This is the divergent pair.
    [null, "a", true, "select"],
    ["b", "a", true, "select"],
    [null, "a", false, "select"],
    ["b", "a", false, "select"],
    // THE HERO — the only control that acts: it opens when up, and develops when asleep.
    ["a", "a", true, "open"],
    ["a", "a", false, "wake"],
  ];

  it.each(CASES)("hero=%s tapped=%s online=%s -> %s", (selected, tapped, online, want) => {
    expect(tapAction(selected, tapped, online, "select-first")).toBe(want);
  });

  it("differs from the stack grammar in EXACTLY one row (an online non-selection)", () => {
    // Stated as a claim rather than left implicit: if a future edit widens the divergence, this is what
    // notices. Walked over the whole input space the two tables share.
    const rows: [string | null, string, boolean][] = [
      [null, "a", true],
      [null, "a", false],
      ["b", "a", true],
      ["b", "a", false],
      ["a", "a", true],
      ["a", "a", false],
    ];
    const differ = rows.filter(
      ([sel, id, on]) =>
        tapAction(sel, id, on, "act-first") !== tapAction(sel, id, on, "select-first"),
    );
    expect(differ.every(([sel, id, on]) => on && id !== sel)).toBe(true);
    expect(differ).toHaveLength(2); // the two ways of being "not the selection": null, and another id
  });
});

describe("tapGrammarFor — which table a layout reads", () => {
  it("gives the cover its own grammar and every stack layout the narrowed one", () => {
    expect(tapGrammarFor("cover")).toBe("select-first");
    expect(tapGrammarFor("capsule")).toBe("act-first");
    expect(tapGrammarFor("poster")).toBe("act-first");
  });

  it("degrades an unknown id the same way the SURFACE does — to capsule's grammar", () => {
    // The one property that matters: `fleetSurface.useVariantId()` falls back to `capsule` for a stale or
    // corrupt synced value, so a second resolution path that guessed differently would route one way and
    // render another. Both fall back to capsule; the id below is exactly what a future build could sync.
    for (const id of ["", "not-a-layout", "COVER", "club"])
      expect(tapGrammarFor(id)).toBe("act-first");
  });
});

describe("toBannerMode — the pickup banner's three forms (§12.6 ruling 6)", () => {
  it("passes the three declared values through", () => {
    expect(toBannerMode("on")).toBe("on");
    expect(toBannerMode("minimal")).toBe("minimal");
    expect(toBannerMode("off")).toBe("off");
  });

  it("degrades ANYTHING else to the DECLARED DEFAULT — and the two cannot drift", () => {
    // The bridge restates the default rather than reading the registry (this module is pure and is
    // imported BY the theme descriptor — reaching back would close an import cycle for a constant), so
    // the drift is what needs pinning. Asserted against the descriptor itself, not against a literal:
    // when the owner moves the row's default again, THIS is the test that says the bridge must follow.
    const declared = gacha.settings!.banner.default;
    const raws: (string | boolean | undefined)[] = [
      "",
      "ON",
      "minimum",
      "hidden",
      "true",
      undefined,
      true,
      false,
    ];
    for (const raw of raws) expect(toBannerMode(raw)).toBe(declared);
  });

  it("…and that fallback can never be `off` — an unreadable setting must not delete a surface", () => {
    // The invariant the flip did NOT move (the default went `on` -> `minimal` on 2026-08-09). Whatever
    // the row defaults to, the bridge's fallback has to be a form that RENDERS: a stale or corrupt synced
    // value must never be the reason the fleet loses its whole top half.
    expect(toBannerMode("garbage")).not.toBe("off");
  });
});

describe("pickLabel — a name that says as many steps as the control HAS", () => {
  const online = host({ id: "a", name: "pegasus", status: { ...host().status!, online: true } });
  const asleep = host({
    id: "b",
    name: "atlas",
    role: null,
    os_type: "windows",
    status: { ...host().status!, online: false, ping_ms: null },
  });

  it("gives an ONLINE machine the ONE-step sentence, selected or not", () => {
    // Since the amendment a live machine opens on one tap, so a label promising a select that no longer
    // happens would be its own trap — the mirror of the one the two-step wording exists to avoid. This is
    // the lab's own single-step form (`labelFor`, app.js:94-96).
    const want = "pegasus, workstation, 5 stars, online. Opens the unit dossier.";
    expect(pickLabel(online, 5, false)).toBe(want);
    expect(pickLabel(online, 5, true)).toBe(want);
  });

  it("keeps BOTH steps named while a machine is asleep, and swaps once it is selected", () => {
    expect(pickLabel(asleep, 1, false)).toBe(
      "atlas, windows, 1 stars, sleeping. Tap to select; tap again to run the wake sequence.",
    );
    expect(pickLabel(asleep, 1, true)).toBe(
      "atlas, windows, 1 stars, sleeping. Selected. Tap to run the wake sequence.",
    );
  });

  it("leaves `openLabel` BYTE-IDENTICAL — the cards and the banner promos are its own", () => {
    // R25 §Q1d: `openLabel` is shared by two other surfaces, so the poster's wording had to be a NEW
    // function. This is the assertion that it still is.
    expect(openLabel("pegasus", true)).toBe("open pegasus dossier, online");
    expect(openLabel("atlas", false)).toBe("open atlas dossier, sleeping");
  });

  it("speaks the same role `roleLabel` prints, only lower-cased", () => {
    expect(roleLabel(asleep)).toBe("WINDOWS");
    expect(pickLabel(asleep, 1, false)).toContain(", windows, ");
  });
});

describe("partingStep — how the stack parts for a wake ceremony", () => {
  it("lifts everything above the waking slice and drops everything below it", () => {
    expect([0, 1, 2, 3].map((i) => partingStep(i, 2))).toEqual([-2, -1, 0, 1]);
  });

  it("never moves the waking slice itself (it carries the selected grow)", () => {
    for (let n = 0; n < 6; n++) expect(partingStep(n, n)).toBe(0);
  });

  it("clamps at two rungs, so a long fleet does not fling its ends off screen", () => {
    expect(partingStep(0, 19)).toBe(-2);
    expect(partingStep(19, 0)).toBe(2);
  });

  it("survives impossible input at rest rather than throwing (it is on a render path)", () => {
    expect(partingStep(Number.NaN, 0)).toBe(0);
    expect(partingStep(0, Number.NaN)).toBe(0);
    expect(partingStep(1.9, 0)).toBe(1); // truncated, like every other index rule here
  });
});

describe("resolvePick — the selection the view actually shows", () => {
  const fleet = [host({ id: "a" }), host({ id: "b" }), host({ id: "c" })];

  it("keeps a stored pick the fleet still has", () => {
    expect(resolvePick("b", fleet)).toBe("b");
  });

  it("falls back to hosts[0] when nothing is stored (the boot selection, with no state write)", () => {
    expect(resolvePick(null, fleet)).toBe("a");
  });

  it("RE-DERIVES a vanished pick in the same call — no effect, no transient frame", () => {
    // The Codex LOW-3 regression, as a value. `pickedId ?? hosts[0]?.id` returns the GONE id here, which
    // is one committed render with no selected slice and no registry — and a tap in that window selects
    // instead of acting. The rule has to be "still present?", not "non-null?".
    // (`pickedId ?? hosts[0]?.id` would have answered "gone" here — that is the whole finding.)
    expect(resolvePick("gone", fleet)).toBe("a");
  });

  it("is null only for an empty fleet, stored pick or not", () => {
    expect(resolvePick(null, [])).toBeNull();
    expect(resolvePick("a", [])).toBeNull();
  });

  it("follows a re-order rather than an index", () => {
    expect(resolvePick("c", [host({ id: "c" }), host({ id: "a" })])).toBe("c");
  });
});

// ── unitHueToken — the PER-UNIT hue ring (owner ruling: §12.6 ruling 8's rarity->hue binding is overruled) ──
// The colour a poster slice wears is this machine's IDENTITY, not its rarity — the owner's fleet is two
// 2-star and two 3-star machines, so a rarity ladder painted it near-homogeneous. Stars keep rarity.
// The STOPS are the finalists lab's own five `--rar-*` literals in its card order (tokens.css).
describe("unitHueToken — the per-unit hue ring", () => {
  it("walks the five stops in fleet order", () => {
    expect([0, 1, 2, 3, 4].map(unitHueToken)).toEqual([
      "var(--gc-unit-1)",
      "var(--gc-unit-2)",
      "var(--gc-unit-3)",
      "var(--gc-unit-4)",
      "var(--gc-unit-5)",
    ]);
  });

  it("is FIVE stops — the lab defines five per-unit colours, so the ring is that long", () => {
    expect(UNIT_HUES).toBe(5);
  });

  it("WRAPS past the last stop rather than clamping — a ring, not a ladder", () => {
    expect(unitHueToken(UNIT_HUES)).toBe(unitHueToken(0));
    expect(unitHueToken(UNIT_HUES + 3)).toBe(unitHueToken(3));
    expect(unitHueToken(UNIT_HUES * 7 + 2)).toBe(unitHueToken(2));
  });

  it("survives a negative or non-finite index at stop 1 (it is on a render path)", () => {
    // JS `%` keeps the sign, so a bare modulo would emit `--gc-unit-0` and `--gc-unit--2` — tokens that
    // do not exist, which resolve to nothing and unpaint the whole slice silently.
    expect(unitHueToken(-1)).toBe(`var(--gc-unit-${UNIT_HUES})`);
    expect(unitHueToken(-UNIT_HUES - 1)).toBe(`var(--gc-unit-${UNIT_HUES})`);
    expect(unitHueToken(Number.NaN)).toBe("var(--gc-unit-1)");
    expect(unitHueToken(2.9)).toBe("var(--gc-unit-3)"); // truncated, like every other index rule here
  });

  it("only ever names a stop the ring actually has", () => {
    for (let i = -20; i < 40; i++) {
      const n = Number(unitHueToken(i).match(/--gc-unit-(\d+)/)![1]);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(UNIT_HUES);
    }
  });
});

// ── THE COVER's own derivations (E2 / §12.6 ruling 9) ───────────────────────────────────────────────
// Everything the magazine layout computes rather than renders: the two accessible-name forms, the issue
// line, the three ceremony sentences, and the DERIVED hero crop that replaces the lab's per-id map.

describe("labelCover — the cover's two accessible names (the lab's wording, verbatim)", () => {
  const online = host({ id: "a", name: "pegasus", status: { ...host().status!, online: true } });
  const asleep = host({
    id: "b",
    name: "atlas",
    role: null,
    os_type: "windows",
    status: { ...host().status!, online: false, ping_ms: null },
  });

  it("tells the HERO what its own tap does — open, or develop", () => {
    expect(labelCover(online, 5, true)).toBe(
      "pegasus, workstation, 5 stars, on the cover, online. Opens the unit dossier.",
    );
    expect(labelCover(asleep, 1, true)).toBe(
      "atlas, windows, 1 stars, on the cover, sleeping. Develops the cover and wakes it.",
    );
  });

  it("tells a CUT-IN the one thing it does, whatever its liveness", () => {
    // The cover's grammar in a sentence: a cut-in never opens and never wakes, so its name promises
    // exactly one outcome for both liveness states — which is what makes it honest.
    expect(labelCover(online, 5, false)).toBe(
      "pegasus, workstation, 5 stars, online. Supporting cut-in. Puts it on the cover.",
    );
    expect(labelCover(asleep, 1, false)).toBe(
      "atlas, windows, 1 stars, sleeping. Supporting cut-in. Puts it on the cover.",
    );
  });

  it("carries the LIVENESS in every form — an aria-label replaces the chip inside the button", () => {
    for (const isHero of [true, false]) {
      expect(labelCover(online, 3, isHero)).toContain("online");
      expect(labelCover(asleep, 3, isHero)).toContain("sleeping");
    }
  });

  it("leaves `openLabel` and `pickLabel` untouched — three surfaces, three sentences", () => {
    expect(openLabel("pegasus", true)).toBe("open pegasus dossier, online");
    expect(pickLabel(online, 5, false)).toBe(
      "pegasus, workstation, 5 stars, online. Opens the unit dossier.",
    );
  });
});

describe("issueLine — the masthead's own read (why cover ignores the counter)", () => {
  it("numbers the issue from the hero's fleet POSITION, zero-padded", () => {
    expect(issueLine(0, true)).toBe(`ISSUE 01 ${GACHA_COPY.sep} ONLINE`);
    expect(issueLine(3, false)).toBe(`ISSUE 04 ${GACHA_COPY.sep} SLEEPING`);
  });

  it("keeps padding honest past nine (the counter's own idiom, not the lab's `0${n}`)", () => {
    // The lab writes `ISSUE 0${hero + 1}`, which prints `ISSUE 010` on an eleven-machine fleet.
    expect(issueLine(9, true)).toBe(`ISSUE 10 ${GACHA_COPY.sep} ONLINE`);
    expect(issueLine(99, true)).toBe(`ISSUE 100 ${GACHA_COPY.sep} ONLINE`);
  });

  it("survives a nonsense index at issue 01 rather than throwing (it is on a render path)", () => {
    expect(issueLine(Number.NaN, true)).toBe(`ISSUE 01 ${GACHA_COPY.sep} ONLINE`);
    expect(issueLine(-4, true)).toBe(`ISSUE 01 ${GACHA_COPY.sep} ONLINE`);
  });
});

describe("the cover's three ceremony sentences (lab wording, poll-truthful endings)", () => {
  const online = host({ id: "a", name: "pegasus", status: { ...host().status!, online: true } });
  const asleep = host({
    id: "b",
    name: "atlas",
    status: { ...host().status!, online: false, ping_ms: null },
  });

  it("opens and closes the PROMOTE", () => {
    expect(coverPromoteAnnounce("atlas")).toBe("atlas takes the cover.");
    expect(coverSettledAnnounce(online, 5)).toBe(
      "pegasus is on the cover. WORKSTATION, 5 stars, ONLINE.",
    );
  });

  it("reports the machine's CURRENT word when it settles — never the lab's `is online`", () => {
    // §12.6 ruling 4. The lab ends its promote with "{name} is online.", which is a claim about liveness
    // the app has no basis for. This sentence reads the host it was handed, so a cover that lands on a
    // sleeping machine says so.
    expect(coverSettledAnnounce(asleep, 2)).toBe(
      "atlas is on the cover. WORKSTATION, 2 stars, SLEEPING.",
    );
    expect(coverSettledAnnounce(asleep, 2)).not.toContain("is online");
  });

  it("announces the DEVELOP as a request, with no settled counterpart", () => {
    expect(coverDevelopAnnounce("atlas")).toBe("Developing the cover. Waking atlas.");
  });
});

describe("coverHeroFocus — the DERIVED hero crop (ruling 9: not a per-id map)", () => {
  it("shifts the X left by the constant and leaves the Y alone", () => {
    expect(COVER_HERO_SHIFT).toBe(20);
    expect(coverHeroFocus("50% 26%")).toBe("30% 26%");
    // the bundled entries carry real focal points now, and the shift STACKS on top of them
    expect(coverHeroFocus("50% 12%")).toBe("30% 12%");
    expect(coverHeroFocus("50% 8%")).toBe("30% 8%");
  });

  it("passes NO focus through as no override — the CSS default chain stands", () => {
    // The owner's own art deliberately declares none, which is the case this branch exists for: a
    // computed `30% …` would be a claim about a crop nobody authored.
    expect(coverHeroFocus(undefined)).toBeUndefined();
  });

  it("clamps at zero rather than going negative", () => {
    expect(coverHeroFocus("10% 40%")).toBe("0% 40%");
    expect(coverHeroFocus("0% 40%")).toBe("0% 40%");
  });

  it("degrades junk to the INPUT rather than throwing (it is on a render path)", () => {
    for (const junk of ["center top", "", "50%", "left 20%", "not a focus at all"])
      expect(coverHeroFocus(junk)).toBe(junk);
  });

  it("keeps a fractional X fractional", () => {
    expect(coverHeroFocus("50.5% 30%")).toBe("30.5% 30%");
  });

  it("refuses a percentage that PARSES but is not finite (Codex E2 LOW-8)", () => {
    // A 400-digit percentage matches the shape and converts through `Number()` to Infinity, and
    // `Infinity% 20%` is not a crop — it is an invalid declaration the browser drops, taking the entry's
    // own focus down with it. Degrade to the input, like every other junk case.
    const huge = `${"9".repeat(400)}% 20%`;
    expect(Number("9".repeat(400)), "the fixture must really overflow").toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(coverHeroFocus(huge)).toBe(huge);
    expect(coverHeroFocus(`-${"9".repeat(400)}% 20%`)).toBe(`-${"9".repeat(400)}% 20%`);
  });
});
