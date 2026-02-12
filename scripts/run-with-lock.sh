#!/bin/bash
# Run a node script with a PID lock file.
# Skips execution if another instance (or any setting-engine script) is already running.
#
# Usage: ./scripts/run-with-lock.sh <script> [args...]
# Example: ./scripts/run-with-lock.sh scripts/harvest.js --profile melanie

WORKDIR="/Users/louis/opencode/setting-engine"
LOCKFILE="$WORKDIR/logs/.engine.lock"
LOGPREFIX="[$(date '+%Y-%m-%d %H:%M:%S')]"

cd "$WORKDIR" || exit 1

# Check if lock exists and process is still alive
if [ -f "$LOCKFILE" ]; then
    OLD_PID=$(cat "$LOCKFILE" 2>/dev/null)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        echo "$LOGPREFIX SKIPPED: $1 — another process (PID $OLD_PID) is still running."
        exit 0
    else
        echo "$LOGPREFIX Removing stale lock (PID $OLD_PID no longer running)."
        rm -f "$LOCKFILE"
    fi
fi

# Create lock
echo $$ > "$LOCKFILE"

# Cleanup on exit (normal or crash)
cleanup() {
    rm -f "$LOCKFILE"
}
trap cleanup EXIT INT TERM

echo "$LOGPREFIX START: node $*"
node "$@"
EXIT_CODE=$?
echo "$LOGPREFIX DONE: node $* (exit $EXIT_CODE)"

exit $EXIT_CODE
