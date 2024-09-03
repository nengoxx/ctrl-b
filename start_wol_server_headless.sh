#!/bin/bash

VENV_FOLDER=".venv"

source $VENV_FOLDER/bin/activate

nohup python wol_server/wol_server.py >/dev/null 2>&1 &