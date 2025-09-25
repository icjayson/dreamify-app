#!/bin/bash
# Startup script for the Morpheus API server

echo "Starting Morpheus CSV Analysis API..."
echo "Make sure to set your OpenAI API key in config/config.yaml"

# Install dependencies if needed
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

# Start the server
echo "Starting FastAPI server on port 8000..."
uvicorn server:app --host 0.0.0.0 --port 8000 --reload