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
