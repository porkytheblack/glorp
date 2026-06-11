#!/usr/bin/env bash
# All-in-one Glorp image: three services in one container, supervised here —
#   • Garage     orchestration REST/WS API     :4271
#   • MCP        streamable-HTTP MCP server     :8787  (POST /mcp)
#   • Dashboard  Next.js web console            :3270
# Garage is the source of truth; the MCP server and dashboard are clients of it
# over loopback inside the container. On first boot we mint an admin API key
# (persisted to /data) and hand it to the MCP server so its tools can drive the
# Garage. If any service exits, we tear the rest down so Docker can restart us.
set -euo pipefail

DATA="${GLORP_DATA_DIR:-/data}"
GARAGE_PORT=4271                       # fixed: dashboard bundle + MCP wire to it
MCP_PORT="${MCP_PORT:-8787}"
DASH_PORT="${DASH_PORT:-3270}"
AUTH="${GLORP_GARAGE_AUTH:-required}"

log() { echo "[allinone] $*"; }

# --- 1. API key for the MCP server -------------------------------------------
# Prefer an explicit GLORP_API_KEY; else reuse a persisted one; else (unless auth
# is off) mint an admin key once and persist it so restarts stay wired up.
MCP_KEY="${GLORP_API_KEY:-}"
KEY_FILE="$DATA/mcp-key"
if [ -z "$MCP_KEY" ] && [ "$AUTH" != "off" ]; then
  mkdir -p "$DATA"
  if [ -f "$KEY_FILE" ]; then
    MCP_KEY="$(cat "$KEY_FILE")"
    log "reusing persisted admin API key ($KEY_FILE)"
  elif [ "${GLORP_AUTO_KEY:-1}" = "1" ]; then
    log "minting an admin API key (REST + MCP)…"
    # keys add prints ONLY the raw key to stdout; diagnostics go to stderr.
    MCP_KEY="$(bun run src/cli.ts garage keys add allinone --scopes admin --data-dir "$DATA" 2>/dev/null)"
    printf '%s' "$MCP_KEY" > "$KEY_FILE"
    chmod 600 "$KEY_FILE" || true
    echo "────────────────────────────────────────────────────────────────"
    echo "[allinone] Admin API key (REST + MCP) — stored once, keep it safe:"
    echo "  $MCP_KEY"
    echo "[allinone] Use as:  Authorization: Bearer $MCP_KEY"
    echo "────────────────────────────────────────────────────────────────"
  fi
fi

# --- process supervision -----------------------------------------------------
pids=()
term() {
  log "shutting down…"
  for pid in "${pids[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
}
trap term TERM INT

start() {  # start <name> <cmd...>
  local name="$1"; shift
  "$@" &
  pids+=("$!")
  log "started $name (pid $!)"
}

# --- 2. Garage ---------------------------------------------------------------
# Inherits the container env (model keys, GARAGE_ADMIN_* for dashboard login).
start garage bun run src/cli.ts garage \
  --host 0.0.0.0 --port "$GARAGE_PORT" --workspace-root /workspaces

log "waiting for Garage on :$GARAGE_PORT…"
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$GARAGE_PORT/api/v1/health" >/dev/null 2>&1; then
    log "Garage is up"; break
  fi
  if [ "$i" = "60" ]; then log "Garage did not become healthy in time"; term; exit 1; fi
  sleep 1
done

# --- 3. MCP server (streamable HTTP) -----------------------------------------
start mcp env \
  GLORP_ENDPOINT="http://127.0.0.1:$GARAGE_PORT" \
  GLORP_API_KEY="$MCP_KEY" \
  bun packages/glorp-mcp/src/index.ts --http --host 0.0.0.0 --port "$MCP_PORT"

# --- 4. Dashboard (Next.js) --------------------------------------------------
start dashboard bash -c "cd /app/dashboard && exec bunx next start -p $DASH_PORT"

log "all services up — Garage :$GARAGE_PORT · MCP :$MCP_PORT/mcp · dashboard :$DASH_PORT"

# Block until any one service exits, then stop the rest with its exit code so the
# container's restart policy can bring us back cleanly.
wait -n
code=$?
log "a service exited (code $code) — stopping the container"
term
exit "$code"
