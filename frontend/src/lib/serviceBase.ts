// Vantage-aware host addressing for the SPA's OUTBOUND web links (ROADMAP D3 slice 2, the frontend
// half of D47). A host is multi-homed — a LAN `ip` AND a VPN/overlay `vpn_host` — and the reachable
// one depends on HOW the SPA itself was reached: over a VPN origin (a `*.ts.net` host, or a
// `100.64.0.0/10` CGNAT IP — Tailscale's range) the overlay address works and the LAN `ip` may not;
// on the LAN the reverse. No static config value can be right, so we branch on `window.location`.
// GENERIC by design: `vpn_host` carries whatever overlay address the owner configured — no VPN
// product is named in this logic (the only `tailscale` coupling stays in the Serve integration).

interface Addressable {
  ip?: string | null;
  vpn_host?: string | null;
}

/** The vantage-aware base HOST token (a name or an IP) to slot into `http://<base>:<port><path>`.
 * VPN origin ⇒ prefer `vpn_host` (the MagicDNS name), then `ip`; LAN origin ⇒ prefer `ip`, then
 * `vpn_host`. Blank/absent candidates are dropped, so a host with only one address always resolves
 * to it. Returns `""` only in the degenerate case of no address at all. */
export function serviceBase(host: Addressable, location: { hostname: string }): string {
  const ip = (host.ip ?? "").trim();
  const vpn = (host.vpn_host ?? "").trim();
  const ordered = isVpnOrigin(location.hostname) ? [vpn, ip] : [ip, vpn];
  return ordered.find((a) => a) ?? "";
}

/** Swap the host of a backend-built service URL for the vantage-aware `base`, preserving port + path
 * + everything else byte-for-byte (identity when `base` already equals the URL's host, e.g. on LAN).
 * Falls back to the original URL when `base` is blank or the URL can't be parsed. */
export function rebaseServiceUrl(url: string, base: string): string {
  if (!base) return url;
  try {
    const u = new URL(url);
    if (u.hostname === base.toLowerCase()) return url; // true identity — never re-serialize
    u.hostname = base;
    return u.toString();
  } catch {
    return url;
  }
}

/** Is the SPA being viewed over a VPN/overlay origin? `*.ts.net` (Tailscale MagicDNS / Serve) or a
 * `100.64.0.0/10` CGNAT IP (the tailnet's node-IP range). */
export function isVpnOrigin(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  return h.endsWith(".ts.net") || isCgnat100(h);
}

// 100.64.0.0/10 = 100.64.0.0 – 100.127.255.255 (RFC 6598 CGNAT, the tailnet node-IP range). Proper
// per-octet check: exactly four 0–255 octets, first == 100, second in [64,127].
function isCgnat100(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const octets = m.slice(1, 5).map(Number);
  if (octets.some((n) => n > 255)) return false;
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}
