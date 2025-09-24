# Use an official Python runtime as a parent image
FROM python:3.13-slim

# Set the working directory in the container
WORKDIR /app

# Install required system packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    libgl1-mesa-dev \
    libglib2.0-0 \
    poppler-utils \
    zbar-tools \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY prerequirements.txt /app/

# First install torch (CPU-only)
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu \
    -r prerequirements.txt

# Copy the current directory contents into the container at /app
COPY requirements.txt /app/

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the current directory contents into the container at /app
COPY . /app

# Create /model
RUN mkdir -p /model

# Make port 8000 available to the world outside this container
EXPOSE 8000

# Define environment variable
ENV PORT 8000
