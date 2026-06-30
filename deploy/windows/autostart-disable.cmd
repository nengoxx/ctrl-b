@echo off
REM Disable dashboard auto-start at logon. Double-click me.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0autostart-disable.ps1" %*
if errorlevel 1 pause
