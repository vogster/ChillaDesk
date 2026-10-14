#!/bin/sh
# Runs ChillaDesk as an unprivileged user. Started as root (the default), it first makes
# /data belong to PUID:PGID (1000:1000 unless set), so a folder Docker created on the host
# works, then drops to that user.
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p /data/files /data/pglite
  # Only when needed: a large data folder is not walked through on every start.
  if [ "$(stat -c '%u:%g' /data)" != "$PUID:$PGID" ] ||
    [ "$(stat -c '%u:%g' /data/pglite)" != "$PUID:$PGID" ]; then
    chown -R "$PUID:$PGID" /data
  fi
  exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
