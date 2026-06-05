#!/bin/sh
set -e

# Fly.io attaches the persistent volume at runtime, mounting it owned by root
# and overriding any ownership set in the image layers (so a build-time
# `chown node:node /data` has no effect). Running the app as root would avoid
# the resulting SQLITE_READONLY error but is a security smell flagged by Codacy.
#
# Instead: this entrypoint starts as root only long enough to take ownership of
# the mounted volume, then drops to the unprivileged `node` user via gosu before
# exec'ing the server. gosu hands off the PID so signals (SIGTERM on deploy)
# reach node directly.
DATA_DIR="$(dirname "${DB_PATH:-/data/cricket.db}")"
mkdir -p "$DATA_DIR"
chown -R node:node "$DATA_DIR"

exec gosu node "$@"
