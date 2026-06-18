#!/usr/bin/env bash
# Stop the game studio orchestration UI server
# Usage: stop-ui.sh [--project-dir <path>]

PROJECT_DIR="$(pwd)"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-dir) PROJECT_DIR="$2"; shift 2 ;;
    *) echo "Unknown argument: $1"; exit 1 ;;
  esac
done

PID_FILE="${PROJECT_DIR}/.superpowers/studio/server.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo '{"ok": true, "message": "No server running"}'
  exit 0
fi

PID=$(cat "$PID_FILE")
if kill "$PID" 2>/dev/null; then
  rm -f "$PID_FILE"
  echo "{\"ok\": true, \"message\": \"Server $PID stopped\"}"
else
  rm -f "$PID_FILE"
  echo '{"ok": true, "message": "Server was already stopped"}'
fi
