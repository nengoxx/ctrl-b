#!/usr/bin/env bash
# Expose the PROD dashboard over HTTPS on the tailnet via Tailscale Serve (the mic needs a secure context).
# `--bg` runs it persistently; the TLS cert is auto-provisioned for emma's MagicDNS name.
# Result:  https://emma.<your-tailnet>.ts.net  →  http://127.0.0.1:5433  (the ctrl-b-dashboard service).
# Docs: https://tailscale.com/kb/1313/serve-examples
set -euo pipefail

# One-time, if `tailscale serve` says it needs privileges: let the emma user drive serve without sudo:
#   sudo tailscale set --operator="$USER"
# (then re-run this script). Otherwise prefix the serve command with sudo.

command -v tailscale >/dev/null || { echo "✗ tailscale not installed on this host — install it, then re-run."; exit 1; }
tailscale status >/dev/null 2>&1 || { echo "✗ tailscale is not connected — run 'sudo tailscale up' first, then re-run."; exit 1; }

echo "Configuring Tailscale Serve: HTTPS :443 → localhost:5433 ..."
if ! tailscale serve --bg --https=443 5433; then
  echo "✗ 'tailscale serve' failed. If it needs privileges, run once:  sudo tailscale set --operator=\"\$USER\"  then re-run."
  exit 1
fi

# OPTIONAL — also expose the DEV server over HTTPS (so the mic works in dev too), on :8443:
#   tailscale serve --bg --https=8443 5173

echo "✓ Done. The HTTPS dashboard URL (emma's MagicDNS name) is shown in the serve config below:"
tailscale serve status
echo "(persists across reboots automatically — 'tailscale serve --https=443 off' to remove.)"
