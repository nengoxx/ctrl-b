@echo off

REM Set the path to the virtual environment folder
set VENV_FOLDER=.venv

REM Activate the virtual environment
call %VENV_FOLDER%\Scripts\activate.bat

REM Run the Python script
python wol_server/wol_server_win.py