#!/bin/bash

VENV_FOLDER=".venv"
PYTHON_VERSION="python3.9"

# Check if the virtual environment already exists
if [ ! -d "$VENV_FOLDER" ]; then
    echo "Creating virtual environment..."
    $PYTHON_VERSION -m venv $VENV_FOLDER
    
    # Activate the virtual environment
    source $VENV_FOLDER/bin/activate

    # Install the requirements
    echo "Installing requirements..."
    pip install -r requirements.txt
else
    echo "Virtual environment already exists."

    source $VENV_FOLDER/bin/activate
fi



# Keep the terminal open
echo "Virtual environment is activated."
exec "$SHELL"
