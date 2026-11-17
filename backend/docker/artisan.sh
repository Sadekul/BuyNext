#!/usr/bin/env bash
# `artisan ...` from a Railway shell: runs php artisan as www-data (the user
# the app runs as), so files it creates (logs, caches) stay writable by the app.
# Example: artisan buynest:create-admin owner@example.com --name="Shop Owner"
set -euo pipefail
cd /var/www/html
if [ "$(id -u)" = "0" ]; then
    exec gosu www-data php artisan "$@"
fi
exec php artisan "$@"
