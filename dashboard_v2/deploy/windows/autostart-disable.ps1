#Requires -Version 5.1
# Disable auto-start: remove the Scheduled Task. Does NOT stop a currently-running instance. Double-click
# autostart-disable.cmd.
$ErrorActionPreference = "Stop"

# Removing the task needs admin too → self-elevate (one UAC prompt).
$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) {
  Write-Host "Removing auto-start needs admin - relaunching elevated (approve the UAC prompt)..."
  Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$PSCommandPath`""
  return
}

$TASK = "ctrl-b-dashboard"
if (Get-ScheduledTask -TaskName $TASK -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TASK -Confirm:$false
  Write-Host "[OK] Auto-start DISABLED (task '$TASK' removed)." -ForegroundColor Green
} else {
  Write-Host "Auto-start was not enabled (no task '$TASK')."
}
Write-Host "(A currently-running instance keeps running - close its process, or: Stop-ScheduledTask -TaskName $TASK before disabling.)"
