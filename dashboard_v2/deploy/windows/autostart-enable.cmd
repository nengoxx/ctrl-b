@echo off
REM Enable dashboard auto-start at logon. Double-click me.  (Pass -Tailscale from a terminal to also serve HTTPS.)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0autostart-enable.ps1" %*
if errorlevel 1 (echo. & echo If this failed with access denied, right-click this file -^> Run as administrator. & pause)
