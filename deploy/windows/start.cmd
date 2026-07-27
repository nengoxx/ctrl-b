@echo off
REM Start the ctrl-b dashboard (v2) on Windows. Double-click = PROD on http://127.0.0.1:5433.
REM From a terminal you can pass flags:  start.cmd -Tailscale   |   start.cmd -Dev   |   start.cmd -Build
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
REM Capture FIRST: `pause` succeeds and would otherwise overwrite ERRORLEVEL with 0, so a caller (or a
REM future updater) could never see why the dashboard refused to start. The pause keeps a double-clicked
REM window open long enough to read a config refusal (exit 78); the code still propagates.
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
exit /b %RC%
