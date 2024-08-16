#!/bin/bash

VENV_FOLDER=.venv
PYTHON_VERSION=3.11

if [! -d "$VENV_FOLDER" ]; then
    python -m venv $VENV_FOLDER --python=$PYTHON_VERSION
fi

source $VENV_FOLDER/bin/activate

pip install -r requirements.txt

# Keep terminal open
bash