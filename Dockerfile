# Glorp Garage in a box — a sandboxed runtime where agents can freely run tools
# (bash, file writes, package installs, git) inside the container without ever
# touching your host. Drive it remotely with @porkytheblack/glorp-client or curl.
FROM oven/bun:1.3

# Tools the agent may reach for inside its sandbox. Add your stack's toolchain
# here (build-essential, ripgrep, a JDK, go, etc.) so agents can build & test.
# Node 22 + npm ship alongside bun (corepack provides pnpm/yarn) — agent
# workspaces routinely need real node (Next.js, remotion, npm lifecycle
# scripts) even though glorp itself runs on bun.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl python3 gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
       | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
       > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends nodejs \
    && corepack enable \
    && corepack prepare pnpm@11.6.0 --activate \
    && corepack prepare yarn@4.16.0 --activate \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first for layer caching.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# App source + the compiled binary. Garage runs from dist/glorp — not from
# source — so process.execPath is glorp itself: orchestrator subagents
# self-spawn and template clones install a working `__git-cred`
# credential helper.
COPY . .
RUN bun run build

# /data  → Garage state (API keys + session snapshots, persisted)
# /workspaces → agent working directories (persisted, isolated from /app)
ENV GLORP_DATA_DIR=/data \
    GLORP_GARAGE_AUTH=required \
    GLORP_AUTO_KEY=1
RUN mkdir -p /data /workspaces
VOLUME ["/data", "/workspaces"]
EXPOSE 4271

ENTRYPOINT ["bash", "/app/docker/entrypoint.sh"]
CMD ["--host", "0.0.0.0", "--port", "4271", "--workspace-root", "/workspaces"]
