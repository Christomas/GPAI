#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

install_server() {
  local dir="$1"
  if [ ! -d "$dir" ]; then
    return
  fi

  if [ -f "$dir/package.json" ]; then
    echo "[GPAI] Installing MCP server deps in $dir"
    (cd "$dir" && npm install && npm run build)
  fi
}

install_server "$ROOT_DIR/extensions/gpai-core/mcp-servers/memory-server"
install_server "$ROOT_DIR/extensions/gpai-core/mcp-servers/agents-server"

echo "[GPAI] MCP setup complete."
