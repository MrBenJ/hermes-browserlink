#!/usr/bin/env bash
# Serve the BrowserLink viewer on a local port, reachable over LAN/Tailscale.
# Usage: bash scripts/serve-viewer.sh [PORT]   (default 8787)
set -euo pipefail
PORT="${1:-8787}"
DIR="$(cd "$(dirname "$0")/../dist" && pwd)"
if [ ! -f "$DIR/browserlink-viewer.html" ]; then
  echo "dist/browserlink-viewer.html missing — run: node scripts/build-viewer.js" >&2
  exit 1
fi
echo "Serving BrowserLink viewer on http://0.0.0.0:${PORT}/browserlink-viewer.html"
exec python3 -m http.server "$PORT" --directory "$DIR"
