#!/usr/bin/env bash
# Push the project to a remote dev box, excluding artifacts and secrets.
#
# Usage:  REMOTE=user@host:/path/to/dir ./scripts/sync-to-linux.sh
#
# Example:
#   REMOTE=alice@10.0.0.5:~/zerion-ta-rebalancer/ ./scripts/sync-to-linux.sh
set -euo pipefail

if [ -z "${REMOTE:-}" ]; then
  echo "REMOTE is unset. Example:" >&2
  echo "  REMOTE=user@host:~/zerion-ta-rebalancer/ $0" >&2
  exit 1
fi

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SRC_DIR"

rsync -avh --delete \
  --exclude=node_modules \
  --exclude=web/node_modules \
  --exclude=web/dist \
  --exclude=.git \
  --exclude=data \
  --exclude=.env \
  ./ "$REMOTE"
