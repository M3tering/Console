#!/usr/bin/env sh
set -e
cd /opt/app
node scripts/install-modules.cjs
exec "$@"
