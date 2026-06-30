@echo off
setlocal enabledelayedexpansion

set "KOBOLDCPP_DIR=D:\koboldcpp"
set "SD_WEBUI_DIR=%UserProfile%\Documents\github\sd.webui"
set "SD_WEBUI_BAT=%UserProfile%\Documents\github\sd.webui\run.bat"

:: Function to check if KoboldCPP is running
:checkKoboldCPP
tasklist /FI "IMAGENAME eq koboldcpp.exe" 2>NUL | find /I /N "koboldcpp.exe">NUL
if %ERRORLEVEL% equ 0 (set "KOBOLD_RUNNING=1") else (set "KOBOLD_RUNNING=0")
goto :eof

:: Function to find SD WebUI process
:findSDWebUI
for /f "tokens=2 delims=," %%a in ('wmic process where "commandline like '%%python%%launch.py%%'" get processid /format:csv 2^>NUL ^| findstr /r "[0-9]"') do (
    set "WEBUI_PID=%%a"
    set "WEBUI_RUNNING=1"
    goto :eof
)
set "WEBUI_RUNNING=0"
goto :eof

:: Function to start KoboldCPP
:startKoboldCPP
echo Starting KoboldCPP...
start "" /d "%KOBOLDCPP_DIR%" start_koboldcpp.bat
if %ERRORLEVEL% neq 0 (
    echo Failed to start KoboldCPP.
    set "START_FAILED=1"
) else (
    set "START_FAILED=0"
)
goto :eof

:: Function to start Stable Diffusion WebUI
:startSDWebUI
echo Starting Stable Diffusion WebUI...
start "stable-diffusion-webui" /d "%SD_WEBUI_DIR%" "%SD_WEBUI_BAT%"
if %ERRORLEVEL% neq 0 (
    echo Failed to start Stable Diffusion WebUI.
    set "START_FAILED=1"
) else (
    set "START_FAILED=0"
)
goto :eof

:: Main script logic
call :checkKoboldCPP
if %KOBOLD_RUNNING% equ 1 (
    echo KoboldCPP is running. Terminating it...
    taskkill /F /IM koboldcpp.exe
    if %ERRORLEVEL% neq 0 (
        echo Failed to terminate KoboldCPP. Please close it manually.
        pause
        goto :end
    )
    timeout /t 5 /nobreak >NUL
    call :startSDWebUI
    if %START_FAILED% equ 1 (
        pause
        goto :end
    )
) else (
    call :findSDWebUI
    if %WEBUI_RUNNING% equ 1 (
        echo Stable Diffusion WebUI is running. Terminating it...
        taskkill /F /PID !WEBUI_PID!
        if %ERRORLEVEL% neq 0 (
            echo Failed to terminate Stable Diffusion WebUI. Please close it manually.
            pause
            goto :end
        )
        timeout /t 5 /nobreak >NUL
        call :startKoboldCPP
        if %START_FAILED% equ 1 (
            pause
            goto :end
        )
    ) else (
        echo Neither KoboldCPP nor Stable Diffusion WebUI is running.
        call :startKoboldCPP
        if %START_FAILED% equ 1 (
            pause
            goto :end
        )
    )
)

echo Switch complete!
pause

:end
endlocal