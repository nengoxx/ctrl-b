#Requires -Version 5.1
# One-time setup to run the ctrl-b dashboard (v2) on Windows: backend venv (Python 3.14 preferred) + deps,
# frontend deps + a production build. Re-runnable (idempotent). Run by double-clicking setup.cmd.
# Paths are resolved relative to this script, so this keeps working after the repo reorg (deploy/windows stays
# two levels under the app root, which has backend/ + frontend/).
[CmdletBinding()]
param()
$ErrorActionPreference = "Stop"
$ROOT = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path   # the app root (has backend/, frontend/, config.yaml)
$VENV = Join-Path $ROOT "backend\.venv"
$VPY  = Join-Path $VENV "Scripts\python.exe"

Write-Host "== ctrl-b dashboard (v2) - Windows setup ==" -ForegroundColor Cyan
Write-Host "app root: $ROOT"

function Test-Cmd($n) { return [bool](Get-Command $n -ErrorAction SilentlyContinue) }
if (-not (Test-Cmd npm))  { throw "npm not found - install Node 20+ from nodejs.org, then re-run." }

# Backend venv: reuse an existing one (>=3.14), else create with the best available Python (prefer 3.14).
function Resolve-Py {
  foreach ($c in @(@("py","-3.14"), @("py","-3"), @("python"), @("python3"))) {
    $exe = $c[0]; $a = @($c[1..($c.Count-1)])
    if (-not (Test-Cmd $exe)) { continue }
    try { $v = (& $exe @a -c "import sys;print('%d.%d'%sys.version_info[:2])" 2>$null) } catch { continue }
    if ($v -match '^\d+\.\d+$') {
      $parts = $v -split '\.'
      if (([int]$parts[0] -gt 3) -or ([int]$parts[0] -eq 3 -and [int]$parts[1] -ge 14)) {
        return @{ exe = $exe; args = $a; ver = $v }
      }
    }
  }
  return $null
}

if (Test-Path $VPY) {
  $have = (& $VPY -c "import sys;print('%d.%d'%sys.version_info[:2])")
  Write-Host "-- existing backend venv: Python $have"
} else {
  $py = Resolve-Py
  if (-not $py) { throw "No Python >=3.14 found - install Python 3.14 from python.org (with the 'py' launcher), then re-run." }
  Write-Host "-- creating backend venv with Python $($py.ver)"
  & $py.exe @($py.args) -m venv $VENV
}
# [dev] = the tools/check.py toolchain (ruff/pyright/pytest) — this box is the dev machine, and the
# git-hook gate (AGENTS.md §3) runs check.py on every commit/push, so the venv must carry it.
Write-Host "-- installing backend deps (pip install -e backend[dev])"
& $VPY -m pip install --upgrade pip --quiet
& $VPY -m pip install -e "$(Join-Path $ROOT 'backend')[dev]" --quiet

# Config preflight + migration (UPDATE_PLAN slice 6 — the Windows half of §4). Placed BEFORE the frontend
# build for the same reason as install.sh step 2.6: the build is the slowest thing here, and a config this
# build cannot take should cost seconds, not minutes. `$ErrorActionPreference = "Stop"` does NOT trip on a
# native non-zero exit in PowerShell 5.1, so every code is checked explicitly.
Push-Location (Join-Path $ROOT "backend")
try {
  Write-Host "-- config preflight (python -m app.config_migration --check)"
  & $VPY -m app.config_migration --check
  if ($LASTEXITCODE -ne 0) { throw "config preflight failed (exit $LASTEXITCODE) - nothing has been changed." }
  # The Windows analogue of install.sh's dev guard: there is no service manager here, so "is it running?"
  # is "is the port held?" — the same probe start.ps1 already uses. Migrating under a live instance would
  # let that process write its OLD in-memory settings back afterwards, resurrecting legacy keys.
  if (Get-NetTCPConnection -LocalPort 5433 -State Listen -ErrorAction SilentlyContinue) {
    throw "the dashboard is running on :5433 - close that window before migrating its config, then re-run."
  }
  & $VPY -m app.config_migration --apply
  if ($LASTEXITCODE -ne 0) { throw "config migration failed (exit $LASTEXITCODE)." }
} finally { Pop-Location }

# Frontend deps + production build (the start script serves this dist).
Push-Location (Join-Path $ROOT "frontend")
try {
  if (-not (Test-Path "node_modules")) { Write-Host "-- npm ci (frontend deps)"; npm ci } else { Write-Host "-- frontend node_modules present" }
  Write-Host "-- building frontend bundle (npm run build)"
  npm run build
} finally { Pop-Location }

$cfg = Join-Path $ROOT "config.yaml"
if (Test-Path $cfg) { Write-Host "-- config.yaml present" }
else { Write-Warning "config.yaml not found at $cfg - fleet/integrations/secrets live there; add it before starting." }

Write-Host ""
Write-Host "[OK] Setup complete. Start the dashboard with:" -ForegroundColor Green
Write-Host "       start.cmd                 # PROD on http://127.0.0.1:5433 (alongside your Flask app on :5432)"
Write-Host "       start.cmd -Tailscale      # also expose HTTPS on your tailnet (phone access + mic)"
Write-Host "       start.cmd -Dev            # dev: Vite hot-reload (:5173) + backend (:5433)"
