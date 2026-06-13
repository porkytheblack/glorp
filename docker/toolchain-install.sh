#!/usr/bin/env bash
# Shared media / document / image / Python / Rust toolchain for the agent
# sandbox — used by BOTH docker/Dockerfile.full and docker/Dockerfile.allinone
# so the two images never drift. Node is installed per-image (the versions
# differ), so it's intentionally NOT here. The Dockerfile sets RUSTUP_HOME /
# CARGO_HOME / PATH before calling this; rustup installs into them.
#
# This is the "fully kitted out" layer: with it, every task type works —
# documents (docx/pdf via LibreOffice/pandoc/python-docx/weasyprint), decks
# (pptx via python-pptx/LibreOffice), spreadsheets (openpyxl/xlsxwriter),
# images (ImageMagick/libvips/Pillow), video/audio (ffmpeg/sox), and code.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

# System packages: build tools + CLI utils, Python runtime, video/audio,
# images, office/pandoc/pdf tooling, weasyprint native deps, and fonts
# (incl. CJK + emoji) so rendered docs/images aren't tofu.
apt-get update
apt-get install -y --no-install-recommends \
  build-essential pkg-config wget unzip zip xz-utils jq tree less openssh-client ripgrep fd-find \
  python3 python3-pip python3-venv pipx \
  ffmpeg sox libsox-fmt-all lame \
  imagemagick libvips-tools webp optipng jpegoptim \
  libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-core libreoffice-common \
  pandoc poppler-utils ghostscript qpdf \
  libpango-1.0-0 libpangocairo-1.0-0 libcairo2 libgdk-pixbuf-2.0-0 libffi-dev shared-mime-info \
  fonts-dejavu fonts-liberation fonts-noto fonts-noto-cjk fonts-noto-color-emoji
rm -rf /var/lib/apt/lists/*

# Rust (rustup, minimal → cargo + rustc) into the image's RUSTUP_HOME/CARGO_HOME.
curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs \
  | sh -s -- -y --profile minimal --default-toolchain stable
rustc --version && cargo --version

# Python libraries the common document/media skills import directly. Debian's
# "externally managed" env → --break-system-packages installs into the default
# python3 so agents and skills can `import` them without a venv.
pip3 install --break-system-packages --no-cache-dir \
  python-pptx python-docx openpyxl xlsxwriter \
  pypdf pdfplumber pdf2image reportlab weasyprint \
  Pillow markdown beautifulsoup4 lxml \
  pandas numpy requests

echo "[toolchain] $(python3 --version), $(cargo --version), ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}'), libreoffice $(libreoffice --version 2>/dev/null | head -1 | awk '{print $2}')"
