#!/usr/bin/env bash
set -euo pipefail

if ! command -v colab-mcp-go >/dev/null 2>&1; then
  echo "colab-mcp-go was not found on PATH." >&2
  echo "Install: go install github.com/shinshin86/colab-mcp-go/cmd/colab-mcp-go@v0.0.0-20260824110853-5c9e997958bf" >&2
  exit 127
fi

project_root="$(cd "$(dirname "$0")/.." && pwd)"
state_dir="${STILL2RIG_COLAB_STATE_DIR:-$project_root/.still2rig-psd/secrets}"
mkdir -p "$state_dir"
chmod 700 "$project_root/.still2rig-psd" "$state_dir" 2>/dev/null || true

# Port 0 asks the OS for an available port. Colab MCP Go records the selected
# port next to the token so the CLI can build the user-facing Colab URL.
port="${STILL2RIG_COLAB_PORT:-0}"
connect_timeout="${STILL2RIG_COLAB_CONNECT_TIMEOUT:-3600s}"

exec colab-mcp-go \
  --host localhost \
  --port "$port" \
  --token-file "$state_dir/colab-token" \
  --connect-timeout "$connect_timeout" \
  --no-browser
