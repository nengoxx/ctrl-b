---
title: CTRL-B Corsair Shutdown Audit
created: 2026-06-29
tags:
  - audit
  - ctrl-b
  - dashboard-v2
  - shutdown
  - tailscale
---

# CTRL-B Corsair Shutdown Audit — 2026-06-29

## Summary

Root cause: `dashboard_v2/config.yaml` configures Corsair's `ip` as the LAN address `192.168.1.128`, but SSH from Emma to `192.168.1.128:22` times out. Corsair is reachable over Tailscale MagicDNS as `corsair`, where SSH port 22 is open and accepts the configured credentials.

Changing only the effective Corsair host address to `corsair` in a temporary config made the existing dashboard shutdown path work end-to-end.

## Evidence

### Current config shape, sanitized

Parsed from `/home/emma/github/ctrl-b/dashboard_v2/config.yaml` without printing secrets:

| Host | Config host/IP | OS | SSH creds present | SSH port |
|---|---:|---|---:|---:|
| corsair | `192.168.1.128` | `windows` | yes | 22 |
| vault | `192.168.1.137` | `windows` | yes | 22 |
| g5 | `192.168.1.154` | `windows` | yes | 22 |
| emma | `192.168.1.160` | `linux` | yes | 22 |

### SSH reachability probes

Harmless probes using the backend's real `paramiko` adapter and configured credentials:

| Host | Result |
|---|---|
| `192.168.1.128` / Corsair LAN | `timed out` |
| `192.168.1.137` / Vault LAN | `timed out` |
| `192.168.1.154` / G5 LAN | `timed out` |
| `192.168.1.160` / Emma LAN | OK, returned `CTRLB_PROBE` + `emma` |

Network probe:

- `ping 192.168.1.128` succeeded while `nc -vz 192.168.1.128 22` timed out.
- `corsair` resolved via MagicDNS to `100.76.212.35`; `nc -vz corsair 22` succeeded.
- Harmless SSH command via temp config `ip: corsair` succeeded as `corsair\\rovax`.

### Actual dashboard/API path with original config

FastAPI TestClient, same request shape as the frontend:

1. `POST /api/actions/shutdown_host` with `{ "args": { "host_id": "corsair" } }`
   - returned `200`, `needs_confirm: true`.
2. Re-POST with returned `confirm_token`
   - returned `200`, result state `error`.
   - summary: `failed to shut down corsair`.
   - error: `timed out`.
   - duration: about `10011ms`.

### Actual dashboard/API path with temporary MagicDNS config

Temporary config only changed Corsair's address to `corsair`; no repo files were edited.

1. First POST returned `needs_confirm: true`.
2. Confirmed POST returned:
   - result state `ok`.
   - summary `sent shutdown command to corsair`.
   - duration about `238ms`.
3. Follow-up ping checks showed Corsair dropped offline shortly after:
   - first two checks: Tailscale `corsair` already offline while LAN still answered briefly.
   - later checks: both `corsair` and `192.168.1.128` offline.

## Code path audited

Frontend:

- `frontend/src/hooks/useActions.ts`
  - Maps `shutdown` → `shutdown_host`.
  - Posts `{ args: { host_id: host.id } }`.
  - If server returns `needs_confirm`, reposts with `confirm_token`.
  - Rolls back optimistic offline state and shows error toast if result is not `ok`.

Backend:

- `backend/app/api/actions.py`
  - Expects request body `{ "args": {...}, "confirm_token": ... }`.
- `backend/app/services/action_service.py`
  - Correctly gates high-risk actions behind confirm token before executing.
- `backend/app/services/actions/shutdown.py`
  - Windows command: `shutdown /s /f /t 0`.
  - Linux command: `sudo -S -p '' shutdown now`.
- `backend/app/adapters/ssh.py`
  - Uses Paramiko to connect to `host.ip:host.ssh_port` with configured username/password.

No frontend request-shape bug or confirmation-flow bug was found.

## Recommended fix

Short-term, change Corsair's configured SSH target from LAN IP to Tailscale MagicDNS:

```yaml
computers:
  corsair:
    ip: corsair
```

Given Vault and G5 also timed out on LAN SSH while Emma worked, consider doing the same for all Windows hosts that should be controlled from Emma:

```yaml
computers:
  vault:
    ip: vault
  g5:
    ip: g5
```

## Why LAN connectivity was not enough

Being on the same LAN only proves basic network adjacency; it does not prove that every TCP service is reachable on every interface.

The observed distinction was:

| Path | What it proves | Result |
|---|---|---|
| `ping 192.168.1.128` | Corsair answered ICMP on LAN before shutdown | OK before shutdown |
| `192.168.1.128:22` | SSH was reachable on Corsair's LAN interface | timed out |
| `corsair:22` / MagicDNS | SSH was reachable on Corsair's Tailscale interface | OK before shutdown |

Most likely explanation: Windows Firewall/OpenSSH rules allow SSH on the Tailscale interface/path but block or do not expose SSH on the LAN profile. This can happen even when the machine is otherwise online on LAN. Windows firewall policy can vary by network profile (`Private`/`Public`/`Domain`), interface, local address, and remote scope.

This also explains why Vault being off was not the whole story: Vault being offline can explain Vault, but G5 also timed out on LAN SSH while Emma/Linux accepted LAN SSH. The pattern is therefore closer to “Windows hosts' LAN SSH path is blocked/unreachable” than “dashboard shutdown code is broken.”

Useful Windows checks for later:

```powershell
Get-NetConnectionProfile
Get-Service sshd
Get-NetFirewallRule -Name *ssh* | Format-Table DisplayName, Enabled, Direction, Action, Profile
```

If LAN SSH is intentionally desired, ensure the LAN network is `Private` and add/enable an inbound TCP 22 rule for OpenSSH. If LAN SSH is not needed, keeping LAN SSH blocked and using Tailscale/MagicDNS as the control plane is cleaner and safer.

## Design recommendation

The current `ip` field is overloaded: it is used both as the display/service base address and as the SSH target. For maintainability, add an optional dedicated control-plane field, e.g.:

```yaml
computers:
  corsair:
    ip: 192.168.1.128          # display / LAN service address
    ssh_host: corsair          # control plane / Tailscale MagicDNS
    ssh_port: 22
```

Then update the SSH adapter callers to use `host.ssh_host or host.ip`. This preserves LAN service URLs while using the reliable Tailscale control path for remote actions.

## Claude Code handoff

Suggested implementation slice:

1. Add `ssh_host: str | None = None` to `ComputerCfg` and `Host`.
2. Include `ssh_host` in host DTOs/forms if Conf tab should manage it.
3. Update shutdown/reboot/service-control SSH calls to connect to `host.ssh_host or host.ip`.
4. Add backend tests:
   - host with `ssh_host` uses that value for SSH.
   - host without `ssh_host` falls back to `ip`.
   - shutdown action still confirms before execution.
5. Optional UX: label fields as “LAN/service address” vs “SSH/control address” to avoid future confusion.

## Safety / repo state

- No tracked CTRL/B repo files were changed.
- Temporary files used under `/tmp` were removed.
- `uv run` created transient backend environment artifacts, but the checkout was cleaned back to `git status --short --branch` → `## main...origin/main`.
