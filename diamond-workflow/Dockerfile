FROM python:3.11-slim

LABEL description="Diamond Protein Aligner - Pegasus WMS Workflow Container"

# Install system dependencies including Diamond dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Diamond (static binary)
ARG DIAMOND_VERSION=2.1.9
RUN wget -q https://github.com/bbuchfink/diamond/releases/download/v${DIAMOND_VERSION}/diamond-linux64.tar.gz \
    && tar xzf diamond-linux64.tar.gz \
    && mv diamond /usr/local/bin/ \
    && rm diamond-linux64.tar.gz \
    && diamond --version

# Copy wrapper scripts
COPY bin/ /opt/workflow/bin/

# Make scripts executable
RUN chmod +x /opt/workflow/bin/*.py

# Default entrypoint
ENTRYPOINT ["python3"]
