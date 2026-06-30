@echo off
REM One-time setup for the ctrl-b dashboard (v2) on Windows. Double-click me.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
if errorlevel 1 pause
