#Requires -Version 5.1
# Enable auto-start: register a Scheduled Task that runs the dashboard (PROD) at logon, hidden, in the
# background, with crash-restart. The Windows equivalent of emma's systemd service. Re-runnable (idempotent).
# No admin needed (per-user, at logon). Double-click autostart-enable.cmd, or:
#   autostart-enable.cmd              # serve PROD :5433 at logon
#   autostart-enable.cmd -Tailscale   # also (re)apply `tailscale serve` HTTPS at logon (phone access + mic)
[CmdletBinding()]
param([switch]$Tailscale)
$ErrorActionPreference = "Stop"

# Registering a Scheduled Task needs admin on most setups → self-elevate (one UAC prompt), then continue.
$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) {
  Write-Host "Registering auto-start needs admin - relaunching elevated (approve the UAC prompt)..."
  $a = "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$PSCommandPath`""
  if ($Tailscale) { $a += " -Tailscale" }
  Start-Process powershell.exe -Verb RunAs -ArgumentList $a
  return
}

$START = Join-Path $PSScriptRoot "start.ps1"
$TASK  = "ctrl-b-dashboard"
if (-not (Test-Path $START)) { throw "start.ps1 not found next to this script." }

$argline = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$START`""
if ($Tailscale) { $argline += " -Tailscale" }

$action   = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argline
$trigger  = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
              -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$settings.ExecutionTimeLimit = "PT0S"   # no time limit (the server runs indefinitely)

# Default principal = the current user, interactive + limited (no admin, runs in your session so it can reach
# the network / tailscale). -Force replaces an existing task → idempotent.
Register-ScheduledTask -TaskName $TASK -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null

Write-Host "[OK] Auto-start ENABLED: task '$TASK' runs the dashboard (PROD :5433$(if($Tailscale){' + tailscale serve'})) at logon, hidden." -ForegroundColor Green
Write-Host "     Start it now (without waiting for next logon):  Start-ScheduledTask -TaskName $TASK"
Write-Host "     Turn it off:  autostart-disable.cmd        Inspect: Task Scheduler -> Task Scheduler Library -> $TASK"
Write-Host "     NOTE: re-run this after MOVING the repo (the task stores start.ps1's absolute path)."
