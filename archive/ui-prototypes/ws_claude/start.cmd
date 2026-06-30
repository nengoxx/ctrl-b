@echo off
REM Start the ws_claude dashboard dev server.
REM Installs dependencies on first run, then launches Vite on 0.0.0.0:5173
REM (reachable over LAN / Tailscale at http://<host>:5173).

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js not found in PATH. Install it from https://nodejs.org and retry.
    pause
    exit /b 1
)

if not exist node_modules (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo npm install failed.
        pause
        exit /b 1
    )
)

echo Starting ctrl-b dashboard (ws_claude)...
echo   Local:    http://127.0.0.1:5173
echo   Network:  http://0.0.0.0:5173  (LAN / Tailscale)
echo.
call npm run dev
