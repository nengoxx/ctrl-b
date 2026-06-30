@echo off
REM Launch the ws_claude_2 fleet-console prototype (React + Vite dev server).
REM Installs dependencies on first run, then serves on 0.0.0.0:5173 so the phone
REM can reach it over Tailscale. Standalone — does not touch the live Flask app.

setlocal
cd /d "%~dp0ws_claude_2"

if not exist "node_modules" (
  echo [ws_claude_2] Installing dependencies ^(first run^)...
  call npm install
  if errorlevel 1 (
    echo [ws_claude_2] npm install failed.
    pause
    exit /b 1
  )
)

echo [ws_claude_2] Starting dev server on http://localhost:5173
echo [ws_claude_2] On your phone, browse to http://^<this-host^>:5173 over Tailscale.
call npm run dev

endlocal
