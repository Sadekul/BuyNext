#!/usr/bin/env bash
# Starts everything BuyNest needs for local development, in one terminal:
#   1. MySQL      the private copy in .tools/mysql (port 3307), if this machine uses one (./setup.sh makes it)
#   2. Laravel    the API on http://127.0.0.1:8000 (test inbox: /dev/mailbox)
#   3. Storefront http://localhost:5173, which also starts the admin at /admin/
# Ctrl+C stops the API and the storefront. MySQL keeps running (stop it with
# ./dev.sh stop-mysql).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
MYSQL_DIR="$ROOT/.tools/mysql"
# PHP / Node linked by ./setup.sh when the computer's default ones are too old.
[ -d "$ROOT/.tools/bin" ] && export PATH="$ROOT/.tools/bin:$PATH"
MYSQL_PORT="$(sed -n 's/^port=//p' "$MYSQL_DIR/my.cnf" 2>/dev/null || true)"
MYSQL_PORT="${MYSQL_PORT:-3307}"

start_mysql() {
  [ -f "$MYSQL_DIR/my.cnf" ] || return 0 # no private MySQL: use the one configured in backend/.env
  if [ -S "$MYSQL_DIR/mysqld.sock" ] && mysqladmin --no-defaults -S "$MYSQL_DIR/mysqld.sock" ping >/dev/null 2>&1; then
    echo "MySQL: already running on port $MYSQL_PORT"
    return 0
  fi
  echo "MySQL: starting on port $MYSQL_PORT…"
  "$MYSQL_DIR/bin/mysqld" --defaults-file="$MYSQL_DIR/my.cnf" >/dev/null 2>&1 &
  for _ in $(seq 1 40); do
    [ -S "$MYSQL_DIR/mysqld.sock" ] && return 0
    sleep 0.25
  done
  echo "MySQL did not start; see $MYSQL_DIR/error.log" >&2
  exit 1
}

if [ "${1:-}" = "stop-mysql" ]; then
  mysqladmin --no-defaults -S "$MYSQL_DIR/mysqld.sock" -u root -p shutdown
  exit 0
fi

if [ "${1:-}" = "start-mysql" ]; then # used by ./setup.sh
  start_mysql
  exit 0
fi

start_mysql
(cd "$ROOT/backend" && php artisan migrate --force --no-interaction >/dev/null)

echo "API:   http://127.0.0.1:8000   (test inbox: http://127.0.0.1:8000/dev/mailbox)"
# 4 workers: the storefront makes several API calls per page (catalog, menu,
# photos), and PHP's built-in server handles one request at a time per worker.
# PHP_INI_SCAN_DIR (the leading ":" keeps the computer's own ini folder) adds
# backend/docker/php-dev: the production upload sizes (5 MB per photo), phase 22.
(cd "$ROOT/backend" && PHP_INI_SCAN_DIR=":$ROOT/backend/docker/php-dev" PHP_CLI_SERVER_WORKERS=4 php artisan serve --host=127.0.0.1 --port=8000 --no-reload >/dev/null 2>&1) &
API_PID=$!
trap 'kill $API_PID 2>/dev/null' EXIT

echo "Store: http://localhost:5173   Admin: http://localhost:5173/admin/"
cd "$ROOT/frontend" && npm run dev
