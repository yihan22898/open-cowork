# Open Cowork sandbox image.
#
# Built and pushed to Docker Hub as `opencowork/sandbox:latest` by
# `.github/workflows/publish-sandbox-image.yml`. The image ships:
#   - Node.js 20 (provided by the base image, no inline install needed)
#   - Python 3 + pip (for built-in Skills such as PDF/PPTX tools)
#   - Common system utilities (git, curl, jq, unzip, etc.)
#
# The default CMD is `sleep infinity` — the host keeps this container warm and
# uses `docker exec -i` to attach the JSON-RPC agent on demand.
#
# Note on base image choice: this file does NOT run `curl | bash` at build
# time. Node.js is inherited from the official `node:20-bookworm-slim` image
# (a Docker-Official-Image maintained by the Node.js Docker Working Group).
# Python + packages come straight from apt / pip with no remote script exec.

FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    WORKSPACE=/workspace

# Install runtime system utilities + Python.
# Everything here comes from the Debian apt repository — no curl|bash involved.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        gnupg \
        jq \
        unzip \
        vim-tiny \
        wget \
        # Python runtime for built-in Skills (PDF/PPTX processing etc.)
        python3 \
        python3-pip \
        python3-venv \
        # Process & IPC utilities
        procps \
        iputils-ping \
    && rm -rf /var/lib/apt/lists/*

# Pre-install common Python packages used by built-in Skills.
# `--break-system-packages` is needed on Debian 12 (PEP 668).
# Non-critical — the agent can pip install on demand if these fail.
RUN python3 -m pip install --no-cache-dir --break-system-packages \
        "markitdown[pptx]" \
        pypdf \
        pdfplumber \
        reportlab \
        defusedxml \
        python-pptx \
    || true

# Create the workspace mount point. We run as root inside the container (the
# default for `docker exec`) because the workspace is bind-mounted from the
# host and may contain files with arbitrary ownership. Hard isolation is
# enforced by the host-side flags: --cap-drop ALL + --security-opt
# no-new-privileges.
RUN mkdir -p /workspace && chmod 1777 /workspace

# Copy the JSON-RPC agent built by `npm run build:docker-agent`.
# .github/workflows/publish-sandbox-image.yml runs:
#   npm run build:docker-agent
#   docker build -t opencowork/sandbox:latest docker/sandbox
COPY index.js /agent/index.js
RUN chmod 0755 /agent/index.js && node -c /agent/index.js

# Keep the container alive so docker exec has something to attach to.
CMD ["sleep", "infinity"]

# Labels for Docker Hub discovery.
LABEL org.opencontainers.image.title="Open Cowork Sandbox" \
      org.opencontainers.image.description="Long-lived Linux container that hosts the Open Cowork JSON-RPC agent for isolated command execution." \
      org.opencontainers.image.source="https://github.com/OpenCoworkAI/open-cowork" \
      org.opencontainers.image.licenses="MIT"
