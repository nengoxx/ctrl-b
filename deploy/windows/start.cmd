@echo off
REM Start the ctrl-b dashboard (v2) on Windows. Double-click = PROD on http://127.0.0.1:5433.
REM From a terminal you can pass flags:  start.cmd -Tailscale   |   start.cmd -Dev   |   start.cmd -Build
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
if errorlevel 1 pause
