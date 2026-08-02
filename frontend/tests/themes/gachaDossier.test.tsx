/// <reference types="node" />
// ^ this file also reads gacha's stylesheet from disk for the light-surface guard (the gachaChrome
//   precedent); the tests tsconfig pins `types:["vitest"]`, so node's globals are pulled in explicitly.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { relativeTime } from "../../src/lib/relativeTime";
import { GACHA_COPY } from "../../src/themes/gacha/copy";
import { GachaHostDetail } from "../../src/themes/gacha/GachaHostDetail";
import { PENDING, dossierSub } from "../../src/themes/gacha/fleet";
import { artForHost, defaultRoster } from "../../src/themes/gacha/roster";
import { starsFor } from "../../src/themes/gacha/stars";
import type { Host, HostServiceCfg, Service } from "../../src/types";

// THE UNIT DOSSIER (D52 / GACHA_PLAN §4.8, G2) — the pure sheet content, rendered standalone (no store or
// query wiring: it is presentation only, the cosmos/frontier precedent). These pin the RULED metric
// semantics — which are deliberately NOT frontier's grid — plus the shared-resolver/star agreement with the
// capsule card, and the live service rows. The sheet's OPEN wiring lives in `gachaFleet.test.tsx`, beside
// the click seam it hangs off.

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

function renderD(props: Partial<Parameters<typeof GachaHostDetail>[0]> = {}) {
  const h = props.host ?? host();
  const index = props.index ?? 0;
  const { container } = render(
    <GachaHostDetail
      host={h}
      services={props.services ?? []}
      art={props.art !== undefined ? props.art : artForHost(ROSTER, index)}
      mode={props.mode ?? "five"}
      index={index}
      titleId="dossier-title"
    />,
  );
  return { container, h };
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
    expect(metric(container, "Uptime")).toBe(PENDING);
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
    expect(metric(container, "Ping")).toBe(PENDING);
    expect(metric(container, "Seen")).toBe(relativeTime(iso)); // "3h ago"
  });

  it("an online host with no ping measurement holds rather than inventing a number", () => {
    const { container } = renderD({ host: host({ status: { ...host().status!, ping_ms: null } }) });
    expect(metric(container, "Ping")).toBe(PENDING);
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
    // relativeTime's null case is an EM dash — a glyph the frozen subset does not carry, so the theme's
    // ASCII placeholder stands in (and matches the Uptime tile beside it).
    const { container } = renderD({ host: host({ status: null }) });
    expect(metric(container, "Ping")).toBe(PENDING);
    expect(metric(container, "Seen")).toBe(PENDING);
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

  it("deals the host's accent pair by DISPLAY INDEX, cycling the tri-accent", () => {
    for (const [index, pair] of [
      [0, "0"],
      [1, "1"],
      [2, "2"],
      [3, "0"],
      [7, "1"],
    ] as const) {
      const { container } = renderD({ index });
      expect(container.querySelector(".gc-dossier")?.getAttribute("data-pair")).toBe(pair);
      cleanup();
    }
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
    expect(css).toMatch(/\.bs-sheet::before\s*{[^}]*background: var\(--gc-brand-fill\)/);
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

  it("builds the per-host accent pairs from the brand trio, not from per-host values", () => {
    expect(css).toContain('.gc-dossier[data-pair="0"]');
    expect(css).toContain("--gc-host: var(--gc-brand-1)");
    expect(css).toContain("--gc-host-2: var(--gc-brand-3)");
    expect(css).toContain("linear-gradient(var(--gc-host), var(--gc-host-2))");
  });
});
