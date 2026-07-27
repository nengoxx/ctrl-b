#Requires -Version 5.1
# Start the ctrl-b dashboard (v2) on Windows. Run setup.cmd once first.
#   start.cmd               PROD: uvicorn serves the built dist on http://127.0.0.1:5433  (daily-driver)
#   start.cmd -Tailscale    PROD + `tailscale serve` HTTPS on the tailnet (phone access; mic needs HTTPS)
#   start.cmd -Dev          DEV: Vite hot-reload (:5173) in a new window + backend (:5433)
#   start.cmd -Build        force a fresh frontend build before starting
# Runs on :5433, so it coexists with the legacy Flask app on :5432 (no conflict).
[CmdletBinding()]
param([switch]$Dev, [switch]$Build, [switch]$Tailscale)
$ErrorActionPreference = "Stop"
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$VPY  = Join-Path $ROOT "backend\.venv\Scripts\python.exe"
$FE   = Join-Path $ROOT "frontend"
$DIST = Join-Path $FE "dist"

if (-not (Test-Path $VPY)) { throw "backend venv missing - run setup.cmd first." }

# Fail fast with a friendly message if :5433 is already serving (e.g. an instance is already running), rather
# than letting uvicorn fail to bind with a stack trace.
if (Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue) {
  Write-Warning "Port 5433 is already in use - a dashboard may already be running. Open http://127.0.0.1:5433 to use it,"
  Write-Warning "or stop that instance first (close its window / End Task its python.exe), then re-run. Exiting."
  exit 1
}

# PROD serves the built dist; build it if missing or -Build. (DEV uses Vite live, so no build needed there.)
if (-not $Dev -and ($Build -or -not (Test-Path $DIST))) {
  Write-Host "-- building frontend (npm run build)"
  Push-Location $FE; try { npm run build } finally { Pop-Location }
}

# Optional: expose over HTTPS on the tailnet (the mic needs a secure context; phones can reach it).
if ($Tailscale) {
  if (Get-Command tailscale -ErrorAction SilentlyContinue) {
    Write-Host "-- tailscale serve --bg --https=443 5433"
    tailscale serve --bg --https=443 5433
    tailscale serve status
  } else { Write-Warning "tailscale not found on PATH - skipping the HTTPS expose." }
}

# IMPORTANT (Windows gotcha): never use uvicorn --reload here. On Windows the reload worker uses an event loop
# that breaks asyncio.create_subprocess_exec, so fleet pings return empty => every host shows offline. Backend
# code changes therefore need a manual restart (Ctrl-C, re-run). The frontend still hot-reloads via Vite in -Dev.
Set-Location (Join-Path $ROOT "backend")
if ($Dev) {
  Write-Host "-- DEV: launching Vite (:5173) in a new window..."
  Start-Process -FilePath "cmd.exe" -ArgumentList "/k","npm run dev" -WorkingDirectory $FE
  Write-Host "-- DEV: backend on http://127.0.0.1:5433  (open http://127.0.0.1:5173 for the hot-reload UI; Ctrl-C to stop)"
} else {
  Write-Host "-- PROD: serving on http://127.0.0.1:5433  (alongside the Flask app on :5432; Ctrl-C to stop)" -ForegroundColor Green
}
& $VPY -m uvicorn app.main:app --host 127.0.0.1 --port 5433
# PROPAGATE the exit code (UPDATE_PLAN slice 6). Without this the script always returns 0, so
# `start.cmd`'s `if errorlevel 1 pause` never fires — and the app's import-time config refusal (exit 78,
# §14) would print its fix instruction into a console window that then vanishes.
# There is no restart-prevention analogue available: the autostart Scheduled Task
# (autostart-enable.ps1) DOES restart this, with -RestartCount 3, and Task Scheduler's policy cannot be
# told to stop on a particular exit code. In the CONSOLE path these two lines are the whole parity
# requirement; in the hidden autostart path the refusal is invisible, which README.md warns about.
exit $LASTEXITCODE
