#!/usr/bin/env bash
# Shares BuyNest online as a private demo through a free Cloudflare quick tunnel (docs/DEMO.md).
#
#   1. Start the store as usual in another terminal:  ./dev.sh
#   2. Then run:                                      ./demo.sh
#
# It builds the store and the admin, serves the production build on http://localhost:4173 behind a
# demo password (asked here, never saved to a file), and opens a tunnel that prints a public
# https://….trycloudflare.com address. Ctrl+C stops the demo; the address stops working at once.
# Payments, couriers and SMS stay in whatever mode the API runs in (test mode unless you added keys).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT=4173
# PHP / Node linked by ./setup.sh when the computer's default ones are too old.
[ -d "$ROOT/.tools/bin" ] && export PATH="$ROOT/.tools/bin:$PATH"

if ! command -v cloudflared >/dev/null 2>&1; then
  cat >&2 <<'EOF'
cloudflared (Cloudflare's tunnel program) isn't installed. Install it once with:

  curl -L -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  sudo dpkg -i /tmp/cloudflared.deb

then run ./demo.sh again. No Cloudflare account is needed for a quick tunnel.
EOF
  exit 1
fi

if ! curl -s -o /dev/null -m 3 http://127.0.0.1:8000/api/v1/store; then
  echo "The BuyNest API isn't running on :8000. Start it first in another terminal: ./dev.sh" >&2
  exit 1
fi

if ss -ltn "( sport = :$PORT )" | grep -q ":$PORT"; then
  echo "Port $PORT is already in use (an earlier preview?). Stop it, then run ./demo.sh again." >&2
  exit 1
fi

if [ -z "${BUYNEST_DEMO_PASSWORD:-}" ]; then
  read -r -s -p "Choose a demo password (at least 10 characters, share it only with your testers): " BUYNEST_DEMO_PASSWORD
  echo
fi
if [ "${#BUYNEST_DEMO_PASSWORD}" -lt 10 ]; then
  echo "The demo password needs at least 10 characters." >&2
  exit 1
fi
export BUYNEST_DEMO_PASSWORD

echo "Building the store and the admin…"
(cd "$ROOT/frontend" && npm run build >/dev/null)

PIDS=()
stop() {
  for pid in "${PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  echo
  echo "Demo stopped. The public address no longer works."
}
trap stop EXIT INT TERM

(cd "$ROOT/frontend" && exec npx vite preview --port "$PORT" --strictPort >/dev/null 2>&1) &
PIDS+=($!)
for _ in $(seq 1 30); do
  curl -s -o /dev/null "http://localhost:$PORT/" && break
  sleep 1
done

echo "Opening the tunnel (the public address appears below in a moment)…"
LOG="$(mktemp)"
cloudflared tunnel --no-autoupdate --url "http://localhost:$PORT" >"$LOG" 2>&1 &
PIDS+=($!)
URL=""
for _ in $(seq 1 60); do
  URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  [ -n "$URL" ] && break
  sleep 1
done
if [ -z "$URL" ]; then
  echo "The tunnel didn't give an address. Its log:" >&2
  cat "$LOG" >&2
  exit 1
fi

cat <<EOF

  BuyNest demo is online:
    Store:  $URL
    Admin:  $URL/admin/
  Browsers ask for a user name and password first: any user name, and the demo password you chose.
  Then sign in to the store or the admin with your usual accounts.

  Press Ctrl+C to stop the demo.
EOF
wait
