@echo off

set VENV_FOLDER=.venv
set PYTHON_VERSION=3.11

if not exist %VENV_FOLDER% (
    py -%PYTHON_VERSION% -m venv %VENV_FOLDER%
)

call %VENV_FOLDER%\Scripts\activate

pip install -r requirements.txt

:: Keep terminal open
cmd /k