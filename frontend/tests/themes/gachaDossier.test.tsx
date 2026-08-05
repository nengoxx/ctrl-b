/// <reference types="node" />
// ^ this file also reads gacha's stylesheet from disk for the light-surface guard (the gachaChrome
//   precedent); the tests tsconfig pins `types:["vitest"]`, so node's globals are pulled in explicitly.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { relativeTime } from "../../src/lib/relativeTime";
import { GACHA_COPY } from "../../src/themes/gacha/copy";
import { GachaHostDetail } from "../../src/themes/gacha/GachaHostDetail";
import { CLOSE_DOSSIER_LABEL, dossierSub, showArtLabel } from "../../src/themes/gacha/fleet";
import { artForHost, defaultRoster } from "../../src/themes/gacha/roster";
import { starsFor } from "../../src/themes/gacha/stars";
import type { Host, HostServiceCfg, Service } from "../../src/types";

// THE UNIT DOSSIER (D52 / GACHA_PLAN §4.8, G2) — the pure sheet content, rendered standalone (no store or
// query wiring: it is presentation only, the cosmos/frontier precedent). These pin the RULED metric
// semantics — which are deliberately NOT frontier's grid — plus the shared-resolver/star agreement with the
// capsule card, and the live service rows. The sheet's OPEN wiring lives in `gachaFleet.test.tsx`, beside
// the click seam it hangs off.

// D53 M3 — the service rows carry the owner's `kit` service ICON now, and `ServiceIcon` reads the media
// index. Mocked to the fresh-install state (no owner files, so no icon element) rather than wrapped in a
// QueryClientProvider — the frontierFleetSheet precedent; the icon itself has its own five-surface suite.
vi.mock("../../src/hooks/useMedia", () => ({ useMediaIndex: () => ({ data: undefined }) }));

afterEach(cleanup);

/** N CONFIGURED services (the star + Services-metric input — the host's own array, not the live list). */
const cfg = (n: number): HostServiceCfg[] =>
  Array.from({ length: n }, (_, i) => ({
    name: `s${i}`,
    kind: null,
    port: null,
    path: "/",
    autostart: false,
    cmd: {},
  }));

const host = (over: Partial<Host> = {}): Host => ({
  id: "pegasus",
  name: "pegasus",
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
  services: cfg(3),
  ...over,
});

const svc = (over: Partial<Service> = {}): Service => ({
  id: "svc-1",
  host_id: "pegasus",
  name: "grafana",
  kind: null,
  port: 3000,
  path: "",
  autostart: false,
  url: "http://10.0.0.7:3000",
  controls: [],
  status: { service_id: "svc-1", online: true, checked_at: "x", error: null },
  ...over,
});

const ROSTER = defaultRoster();

/** `index` is NOT a component prop — the dossier stopped taking one when the per-host accent bar was
 *  removed (owner 2026-08-04). It stays a HELPER option because these tests still use it to pick which
 *  roster entry the portrait should resolve to, exactly as GachaFleet does. */
function renderD(props: Partial<Parameters<typeof GachaHostDetail>[0]> & { index?: number } = {}) {
  const run = props.run ?? vi.fn().mockResolvedValue(undefined);
  const h = props.host ?? host();
  const index = props.index ?? 0;
  const { container } = render(
    <GachaHostDetail
      host={h}
      services={props.services ?? []}
      art={props.art !== undefined ? props.art : artForHost(ROSTER, index)}
      mode={props.mode ?? "five"}
      busy={props.busy ?? false}
      run={run}
      titleId="dossier-title"
      onClose={props.onClose}
      onShowArt={props.onShowArt}
    />,
  );
  return { container, run, h };
}

/** A metric card's value, found by the ENGLISH half of its bilingual label. */
function metric(c: HTMLElement, label: string): string | undefined {
  const cards = [...c.querySelectorAll<HTMLElement>(".gc-metric")];
  const card = cards.find((m) => m.querySelector("span")?.textContent?.startsWith(label + " "));
  return card?.querySelector("b")?.textContent ?? undefined;
}
const stars = (c: HTMLElement): HTMLElement[] => [...c.querySelectorAll<HTMLElement>(".art-rar i")];

describe("the dossier's ruled metric grid (§4.8 / Codex R4-10)", () => {
  it("online: real ping, the deferred Uptime dash, the CONFIGURED service count, Seen now", () => {
    // The live list is deliberately DIFFERENT from the configured one here: Services must read the
    // configured 3 (the star input), never the live 1/2 tally frontier's grid shows.
    const { container } = renderD({ services: [svc()] });
    expect(metric(container, "Ping")).toBe("18 ms");
    expect(metric(container, "Uptime")).toBe(GACHA_COPY.metricPending);
    expect(metric(container, "Services")).toBe("3");
    expect(metric(container, "Seen")).toBe("now");
  });

  it("carries the ruled JP labels, from copy.ts", () => {
    const { container } = renderD();
    const labels = [...container.querySelectorAll<HTMLElement>(".gc-metric span")].map(
      (s) => s.textContent,
    );
    expect(labels).toEqual([
      `Ping ${GACHA_COPY.metricPing}`,
      `Uptime ${GACHA_COPY.metricUptime}`,
      `Services ${GACHA_COPY.metricServices}`,
      `Seen ${GACHA_COPY.metricSeen}`,
    ]);
  });

  it("offline: Ping holds, Seen falls back to the relative last-seen", () => {
    const iso = new Date(Date.now() - 3 * 3600_000).toISOString();
    const h = host({ status: { ...host().status!, online: false, ping_ms: null, last_seen: iso } });
    const { container } = renderD({ host: h });
    expect(metric(container, "Ping")).toBe(GACHA_COPY.metricPending);
    expect(metric(container, "Seen")).toBe(relativeTime(iso)); // "3h ago"
  });

  it("an online host with no ping measurement holds rather than inventing a number", () => {
    const { container } = renderD({ host: host({ status: { ...host().status!, ping_ms: null } }) });
    expect(metric(container, "Ping")).toBe(GACHA_COPY.metricPending);
  });

  it("a machine with NO configured services renders a real 0, not a dash", () => {
    const { container } = renderD({ host: host({ services: [] }) });
    expect(metric(container, "Services")).toBe("0");
    cleanup();
    // …and the field being absent entirely (an older DTO) is the same fact.
    const bare = renderD({ host: host({ services: undefined }) });
    expect(metric(bare.container, "Services")).toBe("0");
  });

  it("a never-polled host reads the theme's own placeholder in every live slot", () => {
    // relativeTime's null case is the same RULED em dash the Uptime tile shows (§4.8's literal,
    // copy.ts `metricPending`), so a never-polled host reads one identical dash in every held slot.
    const { container } = renderD({ host: host({ status: null }) });
    expect(metric(container, "Ping")).toBe(GACHA_COPY.metricPending);
    expect(metric(container, "Seen")).toBe(GACHA_COPY.metricPending);
  });
});

describe("the dossier agrees with the capsule card", () => {
  it("draws exactly starsFor(configured, mode) stars, with the top rung highlighted", () => {
    const five = renderD({ mode: "five" });
    expect(stars(five.container)).toHaveLength(starsFor(3, "five")); // 3
    expect(stars(five.container).filter((s) => s.className === "hi")).toHaveLength(0);
    cleanup();

    const many = renderD({ host: host({ services: cfg(6) }) });
    expect(stars(many.container)).toHaveLength(5);
    // 5-star mode paints the top TWO rose-gold (§6.2)
    expect(stars(many.container).filter((s) => s.className === "hi")).toHaveLength(2);
    cleanup();

    const three = renderD({ mode: "three" });
    expect(stars(three.container)).toHaveLength(starsFor(3, "three")); // 3
    expect(stars(three.container).filter((s) => s.className === "hi")).toHaveLength(1);
  });

  it("shows the SAME roster entry the host's card and promo do, focal point included", () => {
    const { container } = renderD({ index: 1 });
    expect(container.querySelector<HTMLImageElement>(".avatar")!.src).toContain(
      artForHost(ROSTER, 1)!.url,
    );
    cleanup();
    // entry 3 declares its own focal point — it must reach the portrait, not just the card
    const focused = renderD({ index: 3 });
    const img = focused.container.querySelector<HTMLImageElement>(".avatar")!;
    expect(img.style.objectPosition).toBe(artForHost(ROSTER, 3)!.focus);
  });

  it("no usable art → the frame keeps its shape and its rarity badge", () => {
    const { container } = renderD({ art: null });
    expect(container.querySelector(".avatar.blank")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(stars(container).length).toBeGreaterThan(0);
  });

  it("titles the sheet with the machine's name and the prototype's kicker + role line", () => {
    const { container, h } = renderD();
    const heading = screen.getByRole("heading", { name: "pegasus" });
    expect(heading.id).toBe("dossier-title");
    expect(container.querySelector(".unit-no")?.textContent).toBe("UNIT DOSSIER");
    expect(container.querySelector(".gc-dossier-title p")?.textContent).toBe(dossierSub(h, true));
    expect(dossierSub(h, true)).toBe(`WORKSTATION ${GACHA_COPY.sep} ONLINE`);
  });
});

// ── THE HOST ACTION BAR (council H3) — designed for gacha, but on KIT SEMANTICS: the same action set the
//    precedent dossiers carry, over the same typed-action `run` (which owns the confirm dialog, the
//    optimistic flip and the toast). No new execution path is introduced here, and these pin that.
describe("the host action bar", () => {
  const acts = (c: HTMLElement): HTMLButtonElement[] => [
    ...c.querySelectorAll<HTMLButtonElement>(".gc-act"),
  ];
  const offline = (): Host => host({ status: { ...host().status!, online: false, ping_ms: null } });

  it("a sleeping machine offers Wake alone, and Wake runs the typed action", () => {
    const h = offline();
    const { container, run } = renderD({ host: h });
    expect(acts(container).map((b) => b.textContent)).toEqual(["Wake"]);
    fireEvent.click(screen.getByRole("button", { name: "Wake" }));
    expect(run).toHaveBeenCalledWith("wake", h);
  });

  it("an online machine offers Reboot + Shut down, each on its own typed action", () => {
    const { container, run, h } = renderD();
    expect(acts(container).map((b) => b.textContent)).toEqual(["Reboot", "Shut down"]);
    fireEvent.click(screen.getByRole("button", { name: "Reboot" }));
    expect(run).toHaveBeenCalledWith("reboot", h);
    fireEvent.click(screen.getByRole("button", { name: "Shut down" }));
    expect(run).toHaveBeenCalledWith("shutdown", h);
    expect(screen.queryByRole("button", { name: "Wake" })).toBeNull();
  });

  it("busy disables the WHOLE bar and says so, so a second action can't race the first", () => {
    const { container, run } = renderD({ busy: true });
    const bar = container.querySelector(".gc-acts")!;
    expect(bar.getAttribute("aria-busy")).toBe("true");
    for (const b of acts(container)) {
      expect(b.disabled).toBe(true);
      fireEvent.click(b);
    }
    expect(run).not.toHaveBeenCalled();
    cleanup();
    // …and it is genuinely conditional — an idle dossier announces nothing.
    const idle = renderD();
    expect(idle.container.querySelector(".gc-acts")!.hasAttribute("aria-busy")).toBe(false);
  });

  it("paints the bar from tokens: the brand ticket, the accent-outlined secondary", () => {
    const css = readFileSync(resolve(process.cwd(), "src/themes/gacha/gacha.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const tokens = readFileSync(resolve(process.cwd(), "src/themes/gacha/tokens.css"), "utf8");
    expect(css).toMatch(/\.gc-act\.primary\s*{[^}]*background: var\(--accent-fill\)/);
    expect(css).toMatch(/\.gc-act\.primary\s*{[^}]*color: var\(--accent-ink\)/);
    expect(css).toContain("box-shadow: var(--gc-act-shadow)");
    // SHUT DOWN was re-ruled from the danger rose to the mock's accent outline (owner 2026-08-04), so the
    // pair reads as one control set; the confirm dialog still gates the action. It must use the
    // LIGHT-SURFACE accent, never `--accent` itself — the night pink measures 2.62 on this white card
    // against a 4.5 floor, which is the regression this line exists to catch (Codex 2026-08-04).
    expect(css).toMatch(/\.gc-act\.danger\s*{[^}]*color: var\(--gc-dossier-accent\)/);
    expect(css).not.toMatch(/\.gc-act\.danger\s*{[^}]*color: var\(--accent\)[;\s]/);
    expect(tokens).toContain("--gc-dossier-accent: #b03578");
    expect(tokens).toContain("--gc-act-shadow: 3px 3px 0 var(--gc-dossier-ink)");
  });
});

describe("the live service rows", () => {
  it("drives each dot off the LIVE status and names the state for AT", () => {
    const services = [
      svc({ id: "up", name: "grafana", port: 3000 }),
      svc({
        id: "dn",
        name: "prometheus",
        port: 9090,
        status: { service_id: "dn", online: false, checked_at: "x", error: null },
      }),
    ];
    const { container } = renderD({ services });
    const rows = [...container.querySelectorAll<HTMLElement>(".gc-svc")];
    expect(rows).toHaveLength(2);
    expect(rows[0].className).toContain("on");
    expect(rows[1].className).not.toContain("on");
    expect(rows[0].getAttribute("aria-label")).toBe("grafana online");
    expect(rows[1].getAttribute("aria-label")).toBe("prometheus offline");
    expect(rows[0].querySelector("small")?.textContent).toBe(":3000");
  });

  it("a port-less service reads its liveness word instead of an address", () => {
    const { container } = renderD({ services: [svc({ port: null })] });
    expect(container.querySelector(".gc-svc small")?.textContent).toBe("healthy");
  });

  it("no live services → an honest empty row, never a bare panel", () => {
    const { container } = renderD({ services: [] });
    expect(container.querySelectorAll(".gc-svc")).toHaveLength(0);
    expect(container.querySelector(".gc-svc-empty")).not.toBeNull();
  });
});

// ── The light surface is painted from TOKENS (council M7) ────────────────────────────────────────────
// The stylelint fence already makes a literal color in gacha.css an error; this asserts the other half —
// that the theme's ONE light surface really is authored from the dossier tokens, so G6's palette variants
// re-tint it from tokens.css like everything else. Source-level for the same reason the chrome guard is:
// jsdom loads no CSS, and the computed-style claims belong to the e2e contrast/layout probes.
describe("the dossier's light surface reads from the dossier tokens", () => {
  const css = readFileSync(resolve(process.cwd(), "src/themes/gacha/gacha.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const tokens = readFileSync(resolve(process.cwd(), "src/themes/gacha/tokens.css"), "utf8");

  it("inverts the sheet itself: the two-stop light fill, the dark ink, the violet halo", () => {
    expect(css).toContain(
      "background: linear-gradient(var(--gc-dossier-from), var(--gc-dossier-to))",
    );
    expect(css).toContain("color: var(--gc-dossier-ink)");
    expect(css).toContain("box-shadow: var(--gc-dossier-shadow)");
  });

  it("keeps the prototype's tri-gradient top strip on the brand fill", () => {
    expect(css).toMatch(/\.bs-sheet::before\s*{[^}]*background-image: var\(--gc-brand-fill\)/);
    // …painted as a 4px band on a FULL-cover box: a 4px-tall element can't carry the sheet's 24px corner
    // radius (the radii degenerate and the strip pokes outside the curve — owner eyeball, G2).
    expect(css).toMatch(/\.bs-sheet::before\s*{[^}]*background-size: 100% 4px/);
  });

  it("declares the G2 token values the prototype pins", () => {
    for (const [token, value] of [
      ["--gc-dossier-shadow", "0 -20px 80px #5c6aff55"],
      ["--gc-dossier-art-shadow", "0 10px 22px #3f426a55"],
      ["--gc-dossier-badge", "#17172ce6"],
    ]) {
      expect(tokens).toContain(`${token}: ${value}`);
      expect(css).toContain(`var(${token})`);
    }
  });
});

// THE VISIBLE CLOSE CORNER (the prototype's `.close-detail`, owner-restored 2026-08-02). It is THEME
// markup, not a kit change — the primitive's own sr-only close stays exactly as it is, and both carry the
// same accessible name because they are the same action on the same sheet. Optional, so the content
// renders standalone (every case above) with no dangling control.
describe("the close corner", () => {
  it("is absent without a handler, and calls it when tapped", () => {
    expect(renderD().container.querySelector(".gc-dossier-close")).toBeNull();
    cleanup();
    const onClose = vi.fn();
    const { container } = renderD({ onClose });
    const close = container.querySelector<HTMLElement>(".gc-dossier-close")!;
    expect(close.getAttribute("aria-label")).toBe(CLOSE_DOSSIER_LABEL);
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is stacked ABOVE the handle's invisible drag strip (the cosmos chevron lesson)", () => {
    // The corner sits exactly where `.bs-handle::after` (z-index 1) hangs into the body, so the rule that
    // keeps it tappable is a z-index above it — asserted on the stylesheet, since jsdom paints nothing.
    const css = readFileSync(resolve(process.cwd(), "src/themes/gacha/gacha.css"), "utf8");
    const rule = css.slice(css.indexOf(".gc-dossier-close {"));
    expect(rule.slice(0, rule.indexOf("}"))).toMatch(/z-index:\s*2/);
  });
});

// THE PORTRAIT BUTTON (the art showcase's opener, owner request 2026-08-02). The SHOWCASE itself is wired
// in `gachaFleet.test.tsx`, beside the state and the View-Transition machinery that carry it; what belongs
// here is the control: a real button, named, wrapping the SAME `.avatar` node the morph is named on.
describe("the portrait button", () => {
  // Comments stripped, like every other source-level guard here: the prose around these rules discusses
  // the very numbers being asserted.
  const css = readFileSync(resolve(process.cwd(), "src/themes/gacha/gacha.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );

  it("names the machine's art and hands the tap to the host", () => {
    const onShowArt = vi.fn();
    const { container } = renderD({ onShowArt });
    const btn = screen.getByRole("button", { name: showArtLabel("pegasus") });
    expect(btn.className).toBe("gc-art-btn");
    // …and it WRAPS the portrait rather than replacing it: the avatar is what gacha.css names for the
    // morph and what GachaFleet suppresses for a capture, so it must still be the same element.
    expect(btn.querySelector("img.avatar")).toBe(container.querySelector(".avatar"));
    // the rarity badge still overlays the frame beside it, not inside the button
    expect(container.querySelector(".art-frame > .art-rar")).not.toBeNull();
    fireEvent.click(btn);
    expect(onShowArt).toHaveBeenCalledTimes(1);
  });

  // The showcase's LOOK is source-asserted for the same reason the light surface's is: jsdom loads no CSS,
  // and the two claims that would silently rot are the Z-RUNG (a number that has to stay between two other
  // numbers in a ladder nothing enforces) and the uncropped painting the whole surface exists for.
  it("stands on rung 46: above the sheet it was opened from, below the questions", () => {
    const rule = css.slice(css.indexOf(".gc-art-view {"));
    const mine = /z-index:\s*(\d+)/.exec(rule.slice(0, rule.indexOf("}")))![1];
    expect(Number(mine)).toBe(46);
    // BOTH bounds, read from the kit's own ladder rather than restated: `.bs-root` 40 < 46 <
    // `.modal-backdrop` 50. The upper one is the load-bearing half — a picture must never cover a
    // question — and it is the one a future rung-shuffle would silently break.
    const kit = readFileSync(resolve(process.cwd(), "src/theme-engine/kit/kit.css"), "utf8");
    const rungOf = (selector: string): number => {
      const at = kit.slice(kit.indexOf(selector));
      return Number(/z-index:\s*(\d+)/.exec(at.slice(0, at.indexOf("}")))![1]);
    };
    expect(rungOf(".kit .bs-root {")).toBe(40);
    expect(rungOf(".kit .modal-backdrop {")).toBe(50);
    expect(rungOf(".kit .bs-root {")).toBeLessThan(Number(mine));
    expect(Number(mine)).toBeLessThan(rungOf(".kit .modal-backdrop {"));
  });

  it("paints the UNCROPPED art on the shell's own backdrop, from tokens", () => {
    // the STANDALONE rule (line-anchored) — `.gc-art-view img` also appears inside the `showcase`
    // transition's naming rule above it
    const body = /\n\s*\.gc-art-view img \{([^}]*)\}/.exec(css)![1];
    expect(body).toContain("object-fit: contain");
    // a focal crop is exactly what this surface undoes — no `object-position` may reach it
    expect(body).not.toContain("object-position");
    expect(css).toMatch(
      /\.gc-art-view\s*{[^}]*background-image: var\(--gc-pinstripe\), var\(--gc-backdrop\)/,
    );
  });

  it("names BOTH halves of the showcase morph under its own transition type", () => {
    // The portrait is the group's FROM going out and its TO coming back; the full-screen image is the
    // other end. Both must actually DECLARE the name — a selector that merely mentions `showcase` proves
    // nothing, and a morph with only one named end animates a lone `::view-transition-old` (i.e. nothing
    // visible), which is the exact failure this pair exists to prevent.
    const declaring = (selector: string): boolean =>
      [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].some(
        (m) => m[1].includes(selector) && /view-transition-name:\s*capsule-shell/.test(m[2]),
      );
    expect(declaring('[data-transition="showcase"] .gc-dossier .avatar')).toBe(true);
    expect(declaring('[data-transition="showcase"] .gc-art-view img')).toBe(true);
    // …and the capsule morph's own end keeps its declaration through the shared selector list
    expect(declaring('[data-transition="detail"] .gc-dossier .avatar')).toBe(true);
    expect(css).toMatch(/\[data-transition="showcase"\]::view-transition-group\(capsule-shell\)/);
  });

  it("stays a plain picture with no handler, and never wraps a placeholder frame", () => {
    // Standalone (the precedent `onClose` set): no handler, no dangling control.
    const plain = renderD();
    expect(plain.container.querySelector(".gc-art-btn")).toBeNull();
    expect(plain.container.querySelector("img.avatar")).not.toBeNull();
    cleanup();
    // …and there is nothing to enlarge when the resolver gave a placeholder.
    const blank = renderD({ art: null, onShowArt: vi.fn() });
    expect(blank.container.querySelector(".gc-art-btn")).toBeNull();
    expect(blank.container.querySelector(".avatar.blank")).not.toBeNull();
  });
});
