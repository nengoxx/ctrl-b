#!/bin/bash
cd /home/pi/github/ctrl-b/

VENV_FOLDER=".venv"

source $VENV_FOLDER/bin/activate

nohup python wol_server/wol_server.py >/dev/null 2>&1 &
