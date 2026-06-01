#!/usr/bin/env bash
# Boot Glorp Station. On first start (no keys yet) auto-mint an admin API key and
# print it to the logs, so the container is usable out of the box. Set
# GLORP_AUTO_KEY=0 to disable, or GLORP_STATION_AUTH=off to run without auth.
set -euo pipefail

DATA="${GLORP_DATA_DIR:-/data}"

# `keys ...` subcommands manage keys directly — don't auto-mint for those.
if [ "${1:-}" != "keys" ] \
  && [ "${GLORP_STATION_AUTH:-required}" != "off" ] \
  && [ "${GLORP_AUTO_KEY:-1}" = "1" ] \
  && [ ! -f "$DATA/glorp-keys.json" ]; then
  echo "────────────────────────────────────────────────────────────────"
  echo "[glorp] First boot — minting an admin API key (GLORP_AUTO_KEY=0 to skip):"
  bun run src/cli.ts station keys add docker --scopes admin --data-dir "$DATA"
  echo "[glorp] Use it as:  Authorization: Bearer <the glsk_… key above>"
  echo "────────────────────────────────────────────────────────────────"
fi

exec bun run src/cli.ts station "$@"
