@echo off
REM Start the ctrl-b dashboard (v2) on Windows. Double-click = PROD on http://127.0.0.1:5433.
REM From a terminal you can pass flags:  start.cmd -Tailscale   |   start.cmd -Dev   |   start.cmd -Build
REM `set "ERRORLEVEL="` is not superstition: cmd resolves a REAL environment variable of that name in
REM preference to its own internal error level, so a caller with ERRORLEVEL=0 exported would make every
REM failure below read as success — no pause, and 0 returned. Clearing it inside setlocal restores the
REM built-in and keeps RC out of the caller's environment.
setlocal EnableExtensions
set "ERRORLEVEL="
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1" %*
REM Captured immediately: later commands are not required to preserve the error level. The pause holds a
REM double-clicked window open long enough to read a config refusal (exit 78); `endlocal & exit /b %RC%`
REM expands RC before the scope ends, so the real code still reaches the caller.
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" pause
endlocal & exit /b %RC%
