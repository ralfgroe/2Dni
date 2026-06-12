#!/bin/bash
#
# 2Dni desktop launcher.
#
# Ensures the Vite dev server is running, then opens the app in the default
# browser. If a server is already running it is reused so repeated launches
# don't spawn duplicate servers. Because it points at the live dev server,
# any code changes you make hot-reload in the open tab automatically.

set -euo pipefail

# Project root is the parent of this script's directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# GUI apps don't load your shell config, so node/npm (installed via mise)
# aren't on PATH. Add the resolved node bin directory explicitly.
NODE_BIN_DIR="/Users/rgroene/.local/share/mise/installs/node/24/bin"
if [ -d "$NODE_BIN_DIR" ]; then
  export PATH="$NODE_BIN_DIR:$PATH"
fi

LOG_FILE="$PROJECT_DIR/.launch-2dni.log"

cd "$PROJECT_DIR"

# Find a running Vite dev server for this project by scanning common ports.
find_running_port() {
  for port in 5173 5174 5175 5176 5177; do
    if curl -s -o /dev/null --max-time 1 "http://localhost:$port/"; then
      echo "$port"
      return 0
    fi
  done
  return 1
}

URL=""
if PORT="$(find_running_port)"; then
  URL="http://localhost:$PORT/"
  echo "$(date) Reusing existing dev server on port $PORT" >>"$LOG_FILE"
else
  echo "$(date) Starting dev server..." >>"$LOG_FILE"
  # Start Vite detached so it keeps running after this launcher exits.
  nohup npm run dev >>"$LOG_FILE" 2>&1 &

  # Wait for the server to come up and discover its port.
  for _ in $(seq 1 30); do
    sleep 0.5
    if PORT="$(find_running_port)"; then
      URL="http://localhost:$PORT/"
      break
    fi
  done
fi

if [ -z "$URL" ]; then
  echo "$(date) ERROR: dev server did not start. See log above." >>"$LOG_FILE"
  osascript -e 'display alert "2Dni" message "The dev server did not start. Check .launch-2dni.log in the project folder."'
  exit 1
fi

echo "$(date) Opening $URL" >>"$LOG_FILE"
open "$URL"
