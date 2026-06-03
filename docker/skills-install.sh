#!/usr/bin/env bash
# Install agent SKILL bundles into the image so sandbox agents can use them.
#
# The document/media toolchain (libreoffice, ffmpeg, imagemagick, pandoc, …) and
# the Python libraries skills rely on are installed in Dockerfile.full. This adds
# the bundles themselves. Default source: the public Anthropic agent skills
# (docx/pptx/pdf/xlsx + more). Override with ANTHROPIC_SKILLS_REPO. Best-effort:
# a network hiccup warns rather than failing the whole image build.
#
# Glorp's extensions-loader discovers skills at ~/.agents/skills/<name>/SKILL.md
# (home scope), so installing there makes them available to EVERY session/agent
# in the container regardless of namespace or workspace.
set -uo pipefail

SKILLS_DIR="${GLORP_SKILLS_DIR:-$HOME/.agents/skills}"
REPO="${ANTHROPIC_SKILLS_REPO:-https://github.com/anthropics/skills.git}"
mkdir -p "$SKILLS_DIR"

# 1) The repo's own skills travel with the app at /app/.agents/skills.
if [ -d /app/.agents/skills ]; then
  cp -R /app/.agents/skills/. "$SKILLS_DIR/" 2>/dev/null || true
fi

# 2) Anthropic public skills: copy every SKILL.md-bearing dir + install its deps.
if git clone --depth 1 "$REPO" /tmp/askills 2>/dev/null; then
  count=0
  while IFS= read -r f; do
    d="$(dirname "$f")"
    dest="$SKILLS_DIR/$(basename "$d")"
    # Copy the bundle's *contents* into dest so re-running refreshes in place
    # instead of nesting as <name>/<name>/ when dest already exists.
    mkdir -p "$dest" && cp -R "$d"/. "$dest"/ && count=$((count + 1))
  done < <(find /tmp/askills -maxdepth 4 -name SKILL.md)
  while IFS= read -r r; do
    pip3 install --break-system-packages --no-cache-dir -r "$r" >/dev/null 2>&1 || echo "[skills] WARN deps: $r"
  done < <(find /tmp/askills -maxdepth 4 -name requirements.txt)
  rm -rf /tmp/askills
  echo "[skills] installed $count Anthropic skill bundle(s) into $SKILLS_DIR"
else
  echo "[skills] WARN: clone of $REPO failed — bundles not installed (re-run later)"
fi

echo "[skills] skills present:"
ls -1 "$SKILLS_DIR" 2>/dev/null | sed 's/^/  - /'
