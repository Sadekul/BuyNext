#!/usr/bin/env bash
# One-time set-up of BuyNest on a new computer, after `git clone`. Then start it with ./dev.sh.
#
#   ./setup.sh
#
# What it does (safe to run again: every step skips what is already done):
#   1. Finds PHP 8.3+ and Node 22.12+. If the default ones are too old but a newer one is installed
#      (php8.5, Node through `n`), it links them in .tools/bin, which dev.sh and demo.sh use first.
#   2. Installs the PHP and JavaScript packages (backend, frontend, admin, e2e).
#   3. Database: a private MySQL in .tools/mysql on port 3307 (no sudo needed). To use a MySQL you
#      already run instead, create the database and user yourself and pass them in, for example:
#        DB_HOST=127.0.0.1 DB_PORT=3306 DB_DATABASE=buynest DB_USERNAME=buynest DB_PASSWORD=… ./setup.sh
#   4. Creates backend/.env and frontend/.env.local from the .env.example files, with new random keys
#      (never printed). Existing files are kept. Payments, couriers and SMS stay off until you add keys.
#   5. Creates the tables and the demo data (demo accounts, and the catalog downloaded once from DummyJSON).
#
# Needs: PHP 8.3+ (mbstring, xml, curl, pdo_mysql, sqlite3, bcmath, intl, zip, gd), Composer,
# MySQL 8 (the server program, mysqld), Node 22.12+, and Google Chrome for the browser test suites.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$ROOT/.tools"
BIN="$TOOLS/bin"
MYSQL_DIR="$TOOLS/mysql"
MYSQL_PORT="${BUYNEST_MYSQL_PORT:-3307}"
mkdir -p "$BIN"
export PATH="$BIN:$PATH"

step() { printf '\n== %s\n' "$*"; }
fail() { printf '\nSetup stopped: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- 1. PHP and Node
step "PHP 8.3 or newer"
php_ok() { "$1" -r 'exit(PHP_VERSION_ID >= 80300 ? 0 : 1);' 2>/dev/null; }
PHP=""
for candidate in php php8.5 php8.4 php8.3; do
  path="$(command -v "$candidate" 2>/dev/null || true)"
  if [ -n "$path" ] && php_ok "$path"; then PHP="$path"; break; fi
done
[ -n "$PHP" ] || fail "PHP 8.3 or newer isn't installed. On Ubuntu: sudo apt install php8.3-cli php8.3-{mbstring,xml,curl,mysql,sqlite3,bcmath,intl,zip,gd}"
if [ "$(command -v php)" != "$PHP" ]; then ln -sf "$PHP" "$BIN/php"; echo "Using $PHP (linked as .tools/bin/php; your default php is older)"; fi
missing=""
for ext in mbstring xml curl pdo_mysql sqlite3 bcmath intl zip gd; do
  php -m | grep -qix "$ext" || missing="$missing $ext"
done
[ -z "$missing" ] || fail "PHP is missing these extensions:$missing (install them, e.g. sudo apt install php$(php -r 'echo PHP_MAJOR_VERSION.".".PHP_MINOR_VERSION;')-<name>)"
echo "PHP $(php -r 'echo PHP_VERSION;') with every extension needed"

step "Node 22.12 or newer"
node_ok() { "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)' 2>/dev/null; }
if ! { command -v node >/dev/null && node_ok node; }; then
  if [ ! -x "$HOME/.n/bin/node" ] || ! node_ok "$HOME/.n/bin/node"; then
    command -v n >/dev/null || fail "Node 22.12+ is needed (yours: $(node -v 2>/dev/null || echo none)). Install it with nvm (https://github.com/nvm-sh/nvm) or n, then run ./setup.sh again."
    echo "Installing Node 22 in ~/.n with n (no sudo)…"
    N_PREFIX="$HOME/.n" n install 22 >/dev/null
  fi
  for b in node npm npx; do ln -sf "$HOME/.n/bin/$b" "$BIN/$b"; done
  hash -r # forget where bash last found node, so the linked one is used
fi
echo "Node $(node -v)"

command -v composer >/dev/null || fail "Composer isn't installed: https://getcomposer.org/download/"

# ---------------------------------------------------------------- 2. Packages
step "PHP packages (backend)"
(cd "$ROOT/backend" && php "$(command -v composer)" install --no-interaction --no-progress)
for app in frontend admin e2e; do
  step "JavaScript packages ($app)"
  (cd "$ROOT/$app" && npm ci --no-audit --no-fund)
done

# ---------------------------------------------------------------- 3. Database
random_hex() { php -r "echo bin2hex(random_bytes($1));"; }
BACKEND_ENV="$ROOT/backend/.env"
FRONTEND_ENV="$ROOT/frontend/.env.local"

if [ -f "$BACKEND_ENV" ]; then
  step "Database: keeping the settings in your existing backend/.env"
  [ -f "$MYSQL_DIR/my.cnf" ] && "$ROOT/dev.sh" start-mysql
elif [ -n "${DB_PASSWORD:-}" ]; then
  step "Database: your own MySQL (${DB_HOST:-127.0.0.1}:${DB_PORT:-3306})"
  DB_HOST="${DB_HOST:-127.0.0.1}"; DB_PORT="${DB_PORT:-3306}"; DB_DATABASE="${DB_DATABASE:-buynest}"; DB_USERNAME="${DB_USERNAME:-buynest}"
else
  step "Database: private MySQL in .tools/mysql on port $MYSQL_PORT"
  MYSQLD="$(command -v mysqld 2>/dev/null || ls /usr/sbin/mysqld 2>/dev/null || true)"
  [ -n "$MYSQLD" ] || fail "MySQL 8 isn't installed (on Ubuntu: sudo apt install mysql-server), or pass your own database with DB_* (see the top of this script)."
  "$MYSQLD" --version | grep -qi mariadb && fail "MariaDB was found; the private set-up needs MySQL 8. Pass your own database with DB_* instead (see the top of this script)."
  # MySQL's socket file path must fit in 107 characters.
  [ ${#MYSQL_DIR} -le 90 ] || fail "the folder path is too long for MySQL's socket file ($MYSQL_DIR). Clone BuyNest into a shorter path, such as ~/BuyNest."
  mkdir -p "$MYSQL_DIR/bin"
  # A copy, not a link: Ubuntu's AppArmor profile only lets /usr/sbin/mysqld read its usual folders.
  [ -x "$MYSQL_DIR/bin/mysqld" ] || cp "$MYSQLD" "$MYSQL_DIR/bin/mysqld"
  if [ ! -f "$MYSQL_DIR/my.cnf" ]; then
    cat > "$MYSQL_DIR/my.cnf" <<EOF
[mysqld]
datadir=$MYSQL_DIR/data
socket=$MYSQL_DIR/mysqld.sock
port=$MYSQL_PORT
bind-address=127.0.0.1
pid-file=$MYSQL_DIR/mysqld.pid
log-error=$MYSQL_DIR/error.log
mysqlx=OFF
secure-file-priv=$MYSQL_DIR
character-set-server=utf8mb4
collation-server=utf8mb4_unicode_ci
EOF
    # The copied program looks for its messages next to itself; point it at the system's.
    MSG_DIR="$(dirname "$(dirname "$MYSQLD")")/share/mysql"
    if [ -d "$MSG_DIR" ]; then echo "lc-messages-dir=$MSG_DIR" >> "$MYSQL_DIR/my.cnf"; fi
  fi
  if [ ! -d "$MYSQL_DIR/data/mysql" ]; then
    echo "Creating the MySQL data folder (root can only connect through the local socket file)…"
    "$MYSQL_DIR/bin/mysqld" --defaults-file="$MYSQL_DIR/my.cnf" --initialize-insecure || fail "MySQL could not be initialised; see $MYSQL_DIR/error.log"
  fi
  "$ROOT/dev.sh" start-mysql
  DB_HOST=127.0.0.1; DB_PORT="$MYSQL_PORT"; DB_DATABASE=buynest; DB_USERNAME=buynest; DB_PASSWORD="$(random_hex 16)"
  mysql --no-defaults -S "$MYSQL_DIR/mysqld.sock" -u root <<SQL
CREATE DATABASE IF NOT EXISTS buynest CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE IF NOT EXISTS buynest_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'buynest'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
CREATE USER IF NOT EXISTS 'buynest'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER 'buynest'@'127.0.0.1' IDENTIFIED BY '$DB_PASSWORD';
ALTER USER 'buynest'@'localhost' IDENTIFIED BY '$DB_PASSWORD';
GRANT ALL ON buynest.* TO 'buynest'@'127.0.0.1', 'buynest'@'localhost';
GRANT ALL ON buynest_test.* TO 'buynest'@'127.0.0.1', 'buynest'@'localhost';
SQL
  echo "Databases buynest (the store) and buynest_test (backend tests) are ready"
fi

# ---------------------------------------------------------------- 4. Settings files
set_var() { # set_var FILE NAME VALUE: replaces NAME=… without printing the value
  NAME="$2" VALUE="$3" php -r '$f=$argv[1]; $n=getenv("NAME"); $v=getenv("VALUE");
    $s=file_get_contents($f); $line=$n."=".$v;
    $s=preg_match("/^".preg_quote($n,"/")."=.*$/m",$s) ? preg_replace_callback("/^".preg_quote($n,"/")."=.*$/m", fn()=>$line, $s) : rtrim($s)."\n".$line."\n";
    file_put_contents($f,$s);' "$1"
}

step "Settings files"
if [ ! -f "$BACKEND_ENV" ]; then
  cp "$ROOT/backend/.env.example" "$BACKEND_ENV"; chmod 600 "$BACKEND_ENV"
  set_var "$BACKEND_ENV" DB_HOST "$DB_HOST"
  set_var "$BACKEND_ENV" DB_PORT "$DB_PORT"
  set_var "$BACKEND_ENV" DB_DATABASE "$DB_DATABASE"
  set_var "$BACKEND_ENV" DB_USERNAME "$DB_USERNAME"
  set_var "$BACKEND_ENV" DB_PASSWORD "$DB_PASSWORD"
  set_var "$BACKEND_ENV" BFF_SHARED_KEY "$(random_hex 32)"
  # Development only: one person (or the browser suites, all from one address and the same demo accounts)
  # makes far more requests a minute than a real visitor. The example file keeps the production limits;
  # backend tests pin those in phpunit.xml. See docs/SQA_REPORT.md (phase 5 S6, and "Fresh-clone setup").
  for limit in AUTH_PER_MINUTE=300 AUTH_PER_EMAIL_PER_MINUTE=100 ORDERS_PER_MINUTE=100 REVIEWS_PER_HOUR=100 API_PER_MINUTE=2000; do
    set_var "$BACKEND_ENV" "BUYNEST_${limit%%=*}" "${limit#*=}"
  done
  echo "Created backend/.env (local settings, new random keys, request limits relaxed for development)"
else
  echo "Kept backend/.env"
fi
unset DB_PASSWORD
if [ ! -f "$FRONTEND_ENV" ]; then
  # The store's sign-in service must send the same shared key the API expects.
  BFF_KEY="$(grep -m1 '^BFF_SHARED_KEY=' "$BACKEND_ENV" | cut -d= -f2-)"
  [ -n "$BFF_KEY" ] || { BFF_KEY="$(random_hex 32)"; set_var "$BACKEND_ENV" BFF_SHARED_KEY "$BFF_KEY"; }
  cp "$ROOT/frontend/.env.example" "$FRONTEND_ENV"; chmod 600 "$FRONTEND_ENV"
  set_var "$FRONTEND_ENV" VITE_API_PROVIDER laravel
  set_var "$FRONTEND_ENV" VITE_ACCOUNTS_BACKEND laravel
  set_var "$FRONTEND_ENV" BUYNEST_BFF_KEY "$BFF_KEY"
  unset BFF_KEY
  echo "Created frontend/.env.local (the store talks to your local API)"
else
  echo "Kept frontend/.env.local"
fi

# ---------------------------------------------------------------- 5. Tables and demo data
step "Tables and demo data"
cd "$ROOT/backend"
grep -q '^APP_KEY=.\+' "$BACKEND_ENV" || env -u AI_AGENT php artisan key:generate --no-interaction
env -u AI_AGENT php artisan migrate --seed --force --no-interaction
[ -e public/storage ] || env -u AI_AGENT php artisan storage:link --no-interaction

cat <<EOF

BuyNest is set up. Start it with:

  ./dev.sh

  Store        http://localhost:5173        customer@buynest.test / CustomerPass2026
  Admin        http://localhost:5173/admin/ admin@buynest.test / AdminPass2026
  Test inbox   http://127.0.0.1:8000/dev/mailbox

For artisan, npm and the browser suites in your own terminal, use the same PHP and Node first:
  export PATH="$BIN:\$PATH"
EOF
