@echo off
setlocal enabledelayedexpansion

set "KOBOLDCPP_DIR=D:\koboldcpp"
set "SD_WEBUI_DIR=%UserProfile%\Documents\github\sd.webui"
set "SD_WEBUI_BAT=%UserProfile%\Documents\github\sd.webui\run.bat"

:: Check if KoboldCPP is running
tasklist /FI "IMAGENAME eq koboldcpp.exe" 2>NUL | find /I /N "koboldcpp.exe">NUL
if "%ERRORLEVEL%"=="0" (
    echo Terminating KoboldCPP...
    taskkill /F /IM koboldcpp.exe
    timeout /t 5 /nobreak
    echo Starting Stable Diffusion WebUI...
    start "stable-diffusion-webui" /d "%SD_WEBUI_DIR%" "%SD_WEBUI_BAT%"
) else (
    :: Check if Stable Diffusion WebUI is running
    tasklist /FI "WINDOWTITLE eq stable-diffusion-webui - C:\Users\rovax\Documents\github\sd.webui\run.bat" 2>NUL | find /I /N "stable-diffusion-webui">NUL
    if "%ERRORLEVEL%"=="0" (
        echo Terminating Stable Diffusion WebUI...
        taskkill /F /FI "WINDOWTITLE eq stable-diffusion-webui"
        timeout /t 5 /nobreak
        echo Starting KoboldCPP...
        start "" /d "%KOBOLDCPP_DIR%" start_koboldcpp.bat
    ) else (
        echo Neither KoboldCPP nor Stable Diffusion WebUI is running.
        echo Starting KoboldCPP...
        start "" /d "%KOBOLDCPP_DIR%" start_koboldcpp.bat
    )
)

echo Switch complete!
pause