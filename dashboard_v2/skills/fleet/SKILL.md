---
name: fleet
description: operate the PC fleet — wake, ping, monitor hosts and start/stop/restart their services
allowed_tools:
  - ping_host
  - wake_host
  - shutdown_host
  - open_service_url
  - start_service
  - stop_service
  - restart_service
  - task_plan
---

# Fleet operations

When this skill is active you manage the owner's homelab fleet using ONLY the fleet tools above.

1. For a multi-step request, call `task_plan` first with the ordered steps.
2. Use `ping_host` to check a host, `open_service_url` to confirm a service, the `*_service` tools
   to control services, and `wake_host`/`shutdown_host` for power.
3. Resolve a host/service name to its `id` from the roster yourself.
4. Do NOT search the web — everything you need is a fleet tool call.
5. Finish with a short summary of what you found or did.
