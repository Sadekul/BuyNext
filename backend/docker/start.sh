#!/usr/bin/env bash
# BuyNest API container start script (installed as /usr/local/bin/start).
#
# CONTAINER_ROLE (or the first argument) picks what this container does:
#   web        migrate, link storage, cache config/routes/views, then serve
#              HTTP on $PORT with nginx + PHP-FPM (the default)
#   worker     php artisan queue:work: sends queued emails and newsletter batches
#   scheduler  php artisan schedule:work: runs routes/console.php every minute
#
# All three use the same image and the same variables; only the role differs.
set -Eeuo pipefail

APP_DIR=/var/www/html
ROLE="${1:-${CONTAINER_ROLE:-web}}"
cd "$APP_DIR"

log() { echo "[buynest:$ROLE] $*"; }
fail() { echo "[buynest:$ROLE] ERROR: $*" >&2; exit 1; }

case "$ROLE" in
    web | worker | scheduler) ;;
    *) fail "unknown CONTAINER_ROLE '$ROLE' (use web, worker, or scheduler)" ;;
esac

# --- Step 1 (as root): fix permissions, then become www-data -----------------
# Railway mounts volumes owned by root, so www-data couldn't save photos.
# Only files with the wrong owner are changed, so this stays quick.
if [ "$(id -u)" = "0" ]; then
    mkdir -p storage/app/public storage/app/private storage/framework/cache/data \
        storage/framework/sessions storage/framework/views storage/logs bootstrap/cache
    find storage bootstrap/cache \! -user www-data -exec chown -h www-data:www-data {} +
    exec gosu www-data "$0" "$ROLE"
fi

# --- Step 2 (as www-data): checks and caches ---------------------------------
[ -n "${APP_KEY:-}" ] || fail "APP_KEY is not set. Generate one (see docs/DEPLOY_RAILWAY.md) and add it to this service's variables."
[ -n "${DB_HOST:-}" ] || log "warning: DB_HOST is not set; Laravel will try 127.0.0.1"

# Configuration, routes and views are compiled once per start (the variables
# are read now; changing a variable in Railway redeploys, which re-runs this).
php artisan config:cache
php artisan route:cache
php artisan view:cache

case "$ROLE" in
    worker)
        log "starting the queue worker"
        # Exits after an hour on purpose (fresh memory); Railway's restart
        # policy ALWAYS (docker/railway/worker.json) starts it again.
        exec php artisan queue:work --tries=3 --max-time=3600 --sleep=3
        ;;
    scheduler)
        log "starting the scheduler"
        exec php artisan schedule:work
        ;;
esac

# --- Web ----------------------------------------------------------------------
# MySQL may still be starting on the very first deploy, so retry for ~1 minute.
attempt=1
until php artisan migrate --force; do
    [ "$attempt" -lt 12 ] || fail "migrations failed 12 times; see the messages above"
    log "migrations failed (attempt $attempt), retrying in 5 s"
    attempt=$((attempt + 1))
    sleep 5
done

# public/storage → storage/app/public, so nginx can serve /storage/... photos.
php artisan storage:link --force

# nginx can't read environment variables: write its config with the port.
port="${PORT:-8080}"
listen="listen ${port};"
# Also listen on IPv6 when the container has it (Railway's private network).
if [ -e /proc/net/if_inet6 ]; then
    listen="${listen} listen [::]:${port};"
fi
mkdir -p /tmp/nginx
sed "s|__LISTEN__|${listen}|" /etc/nginx/buynest.conf.template > /tmp/nginx.conf
nginx -t -q -e stderr -c /tmp/nginx.conf

# A tiny supervisor: run PHP-FPM and nginx side by side. If either one stops,
# stop the other and exit, so Railway restarts the whole container.
php-fpm --nodaemonize &
fpm_pid=$!
nginx -e stderr -c /tmp/nginx.conf -g 'daemon off;' &
nginx_pid=$!
log "serving on port ${port} (nginx $nginx_pid, php-fpm $fpm_pid)"

stopping=0
stop_children() {
    # SIGQUIT = graceful: finish the requests in progress, then exit.
    kill -QUIT "$nginx_pid" "$fpm_pid" 2>/dev/null || true
}
trap 'stopping=1; log "stop requested"; stop_children' TERM INT QUIT

set +e
wait -n "$fpm_pid" "$nginx_pid"
status=$?
stop_children
wait
set -e

if [ "$stopping" = "1" ]; then
    log "stopped"
    exit 0
fi
log "a server process exited unexpectedly (status $status)"
[ "$status" -ne 0 ] || status=1
exit "$status"
