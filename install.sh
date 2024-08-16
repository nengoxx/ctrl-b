#!/bin/bash

VENV_FOLDER=".venv"
PYTHON_VERSION="python3.11"

# Check if the virtual environment already exists
if [ ! -d "$VENV_FOLDER" ]; then
    echo "Creating virtual environment..."
    $PYTHON_VERSION -m venv $VENV_FOLDER
else
    echo "Virtual environment already exists."
fi

# Activate the virtual environment
source $VENV_FOLDER/bin/activate

# Install the requirements
echo "Installing requirements..."
pip install -r requirements.txt

# Keep the terminal open
echo "Virtual environment is activated."
exec "$SHELL"
