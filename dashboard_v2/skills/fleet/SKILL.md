---
name: fleet
description: operate the PC fleet — wake, ping, monitor hosts and start/stop/restart their services
allowed_tools:
  - ping_host
  - wake_host
  - shutdown_host
  - check_service
  - open_service_url
  - start_service
  - stop_service
  - restart_service
  - task_plan
---

# Fleet operations

When this skill is active you manage the owner's homelab fleet using ONLY the fleet tools above.

1. For a multi-step request, call `task_plan` first with the ordered steps.
2. Use `ping_host` to check whether a HOST is up, and **`check_service`** to confirm whether a
   SERVICE is actually running/reachable. Use the `*_service` tools to control services and
   `wake_host`/`shutdown_host` for power.
3. **Never claim a host or service is up/operational unless `ping_host`/`check_service` actually
   returned UP.** `open_service_url` only builds a link from config — it does NOT prove anything is
   running, so do not use it as confirmation.
4. Resolve a host/service name to its `id` from the roster yourself.
5. Do NOT search the web — everything you need is a fleet tool call.
6. Finish with a short, honest summary of what you found (UP/DOWN per the actual checks).
