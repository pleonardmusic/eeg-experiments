#!/bin/bash
# Start the EEG monitor.
# Run from Terminal: bash start.sh
#
# The browser will try to connect directly to TGC on port 13854 first.
# If that fails, run:  node bridge.js
# then click Connect again — the browser will fall back to the bridge on port 8765.

DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== EEG Monitor ==="
echo ""
echo "1. Make sure ThinkGear Connector is open (it will be gray/idle — that's fine)."
echo "2. Click Connect in the browser — this triggers TGC to connect to the headset (turns blue)."
echo "3. Put the headset on your forehead and wait a few seconds."
echo ""

echo "[start] Serving app at http://localhost:8080"
open "http://localhost:8080"

node "$DIR/server.js"
