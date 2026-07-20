import { describe, expect, it } from "vitest";

import { isVpnOrigin, rebaseServiceUrl, serviceBase } from "../../src/lib/serviceBase";

// lib/serviceBase — vantage-aware host addressing for outbound links (ROADMAP D3 slice 2). The base
// depends on HOW the SPA was reached: over a VPN origin (*.ts.net / 100.64.0.0/10) prefer vpn_host,
// else the LAN ip; blank candidates drop so a single-homed host always resolves.

const host = { ip: "192.168.1.10", vpn_host: "corsair.tail.ts.net" };
const lan = { hostname: "192.168.1.5" };
const tsnet = { hostname: "emma.lobster-vector.ts.net" };
const cgnat = { hostname: "100.100.50.3" };

describe("serviceBase", () => {
  it("LAN origin → prefers the LAN ip", () => {
    expect(serviceBase(host, lan)).toBe("192.168.1.10");
    expect(serviceBase(host, { hostname: "localhost" })).toBe("192.168.1.10");
    expect(serviceBase(host, { hostname: "fleet.home.arpa" })).toBe("192.168.1.10");
  });

  it("*.ts.net origin → prefers the vpn_host (MagicDNS name)", () => {
    expect(serviceBase(host, tsnet)).toBe("corsair.tail.ts.net");
  });

  it("100.64.0.0/10 CGNAT ip origin → prefers the vpn_host", () => {
    expect(serviceBase(host, cgnat)).toBe("corsair.tail.ts.net");
  });

  it("host without vpn_host → always the ip, either vantage", () => {
    const lanOnly = { ip: "10.0.0.9", vpn_host: null };
    expect(serviceBase(lanOnly, lan)).toBe("10.0.0.9");
    expect(serviceBase(lanOnly, tsnet)).toBe("10.0.0.9"); // VPN origin but no vpn_host → fall back to ip
    expect(serviceBase({ ip: "10.0.0.9", vpn_host: "   " }, tsnet)).toBe("10.0.0.9"); // blank drops
  });

  it("host with blank ip → falls back to the vpn_host on a LAN vantage", () => {
    expect(serviceBase({ ip: "", vpn_host: "corsair" }, lan)).toBe("corsair");
    expect(serviceBase({ ip: null, vpn_host: "corsair" }, lan)).toBe("corsair");
  });

  it("no address at all → empty string (degenerate)", () => {
    expect(serviceBase({ ip: "", vpn_host: "" }, lan)).toBe("");
  });
});

describe("isVpnOrigin — CGNAT /10 boundaries", () => {
  it("inside 100.64.0.0 – 100.127.255.255 is VPN", () => {
    expect(isVpnOrigin("100.64.0.0")).toBe(true);
    expect(isVpnOrigin("100.127.255.255")).toBe(true);
    expect(isVpnOrigin("100.100.100.100")).toBe(true);
  });
  it("just outside the /10 is NOT VPN", () => {
    expect(isVpnOrigin("100.63.255.255")).toBe(false); // second octet 63 < 64
    expect(isVpnOrigin("100.128.0.1")).toBe(false); // second octet 128 > 127
    expect(isVpnOrigin("101.64.0.1")).toBe(false); // first octet ≠ 100
  });
  it("rejects malformed / out-of-range octets and non-ip strings", () => {
    expect(isVpnOrigin("100.999.0.1")).toBe(false);
    expect(isVpnOrigin("100.64.0")).toBe(false);
    expect(isVpnOrigin("emma.local")).toBe(false);
  });
  it("*.ts.net (any case) is VPN", () => {
    expect(isVpnOrigin("EMMA.LOBSTER-VECTOR.TS.NET")).toBe(true);
    expect(isVpnOrigin("x.ts.net")).toBe(true);
    expect(isVpnOrigin("notts.net.evil.com")).toBe(false);
  });
});

describe("rebaseServiceUrl", () => {
  it("swaps only the host, preserving port + path + query", () => {
    expect(rebaseServiceUrl("http://192.168.1.10:8080/app?q=1", "corsair.ts.net")).toBe(
      "http://corsair.ts.net:8080/app?q=1",
    );
  });
  it("is identity when base equals the url host (LAN vantage)", () => {
    expect(rebaseServiceUrl("http://192.168.1.10:8080/x", "192.168.1.10")).toBe(
      "http://192.168.1.10:8080/x",
    );
  });
  it("returns the original url when base is blank or the url is unparseable", () => {
    expect(rebaseServiceUrl("http://192.168.1.10:8080/", "")).toBe("http://192.168.1.10:8080/");
    expect(rebaseServiceUrl("not a url", "corsair")).toBe("not a url");
  });
});
