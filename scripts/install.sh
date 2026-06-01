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
