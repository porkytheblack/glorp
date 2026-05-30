#!/usr/bin/env bash
set -euo pipefail

# Glorp system installer
# Copies dist/glorp to a directory on $PATH.
# Supports PREFIX override and auto-falls back to ~/.local/bin.

SRC="${SRC:-./dist/glorp}"
PREFIX="${PREFIX:-/usr/local}"
DEST_DIR=""
BINARY_NAME="glorp"

# --- sanity checks ---
if [[ ! -f "$SRC" ]]; then
  echo "❌ Binary not found: $SRC"
  echo "   Run: bun run build"
  exit 1
fi

# --- pick destination ---
if [[ -n "${INSTALL_DIR:-}" ]]; then
  DEST_DIR="$INSTALL_DIR"
elif mkdir -p "$PREFIX/bin" 2>/dev/null && [[ -w "$PREFIX/bin" ]]; then
  DEST_DIR="$PREFIX/bin"
else
  DEST_DIR="${HOME}/.local/bin"
  mkdir -p "$DEST_DIR"
fi

DEST="$DEST_DIR/$BINARY_NAME"

# --- install / reinstall ---
echo "📦 Installing glorp → $DEST"
cp -f "$SRC" "$DEST"
chmod +x "$DEST"

# --- dashboard assets ---
# The compiled binary can't read the dashboard from its in-binary virtual FS,
# so drop the built SPA into the data dir, where Station looks for it first.
DASH_SRC="$(dirname "$SRC")/dashboard"
if [[ -d "$DASH_SRC" ]]; then
  DASH_DEST="${GLORP_DATA_DIR:-$HOME/.glorp}/dashboard"
  mkdir -p "$(dirname "$DASH_DEST")"
  rm -rf "$DASH_DEST"
  cp -R "$DASH_SRC" "$DASH_DEST"
  echo "🖥  dashboard → $DASH_DEST"
else
  echo "ℹ️  no dashboard build found at $DASH_SRC (run 'bun run build:dashboard' to include it)"
fi

# --- verify ---
if command -v "$BINARY_NAME" &>/dev/null; then
  INSTALLED_VERSION="$($BINARY_NAME --version 2>/dev/null || echo "unknown")"
  echo "✅ glorp installed ($INSTALLED_VERSION)"
else
  echo "⚠️  glorp installed to $DEST but it is not on your \$PATH"
  case ":${PATH}:" in
    *":$DEST_DIR:"*) ;;
    *)
      echo "   Add this to your shell profile:"
      echo "   export PATH=\"$DEST_DIR:\$PATH\""
      ;;
  esac
fi
