#!/usr/bin/env bash
# Expose the PROD dashboard over HTTPS on the tailnet via Tailscale Serve (the mic needs a secure context).
# `--bg` runs it persistently; the TLS cert is auto-provisioned for emma's MagicDNS name.
# Result:  https://emma.<your-tailnet>.ts.net  →  http://127.0.0.1:5433  (the ctrl-b-dashboard service).
# Docs: https://tailscale.com/kb/1313/serve-examples
set -euo pipefail

# One-time, if `tailscale serve` says it needs privileges: let the emma user drive serve without sudo:
#   sudo tailscale set --operator="$USER"
# (then re-run this script). Otherwise prefix the serve command with sudo.

echo "Configuring Tailscale Serve: HTTPS :443 → localhost:5433 ..."
tailscale serve --bg --https=443 5433

# OPTIONAL — also expose the DEV server over HTTPS (so the mic works in dev too), on :8443:
#   tailscale serve --bg --https=8443 5173

echo "✓ Done. Current serve config:"
tailscale serve status
echo "Dashboard URL:  https://$(tailscale status --json 2>/dev/null | grep -oE '\"DNSName\":\"emma[^\"]*' | head -1 | cut -d'\"' -f3 | sed 's/\.$//')"
