#!/bin/sh
set -eu

# Preserve the old API_URL fallback without shipping a provider advertisement.
if [ "${DEFAULT_API_URL+x}" != x ]; then
    DEFAULT_API_URL=${API_URL:-https://www.chream.me}
fi
API_PROXY_URL=${API_PROXY_URL:-${API_URL:-https://www.chream.me}}
export DEFAULT_API_URL API_PROXY_URL

node /app/deploy/inject-runtime-config.mjs
exec "$@"
