FROM python:3.11-slim

LABEL description="Real Estate Price Prediction - ML Workflow Container"

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python ML libraries
RUN pip install --no-cache-dir \
    pandas==2.1.4 \
    numpy==1.26.2 \
    scikit-learn==1.3.2 \
    matplotlib==3.8.2 \
    seaborn==0.13.0

# Copy wrapper scripts into the container
COPY bin/ /opt/workflow/bin/

# Make scripts executable
RUN chmod +x /opt/workflow/bin/*.py

# Default entrypoint
ENTRYPOINT ["python3"]
