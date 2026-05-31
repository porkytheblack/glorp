# Glorp Station in a box — a sandboxed runtime where agents can freely run tools
# (bash, file writes, package installs, git) inside the container without ever
# touching your host. Drive it remotely with @porkytheblack/glorp-client or curl.
FROM oven/bun:1.3

# Tools the agent may reach for inside its sandbox. Add your stack's toolchain
# here (build-essential, ripgrep, a JDK, go, etc.) so agents can build & test.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for layer caching.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# App source + embedded prompts (prebuild generates src/.../embedded.ts).
COPY . .
RUN bun run prebuild

# /data  → Station state (API keys + session snapshots, persisted)
# /workspaces → agent working directories (persisted, isolated from /app)
ENV GLORP_DATA_DIR=/data \
    GLORP_STATION_AUTH=required \
    GLORP_AUTO_KEY=1
RUN mkdir -p /data /workspaces
VOLUME ["/data", "/workspaces"]
EXPOSE 4271

ENTRYPOINT ["bash", "/app/docker/entrypoint.sh"]
CMD ["--host", "0.0.0.0", "--port", "4271", "--workspace-root", "/workspaces"]
