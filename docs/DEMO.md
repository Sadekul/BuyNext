# Online demo (free, private, temporary)

Share the store and the admin from this computer through a free **Cloudflare quick tunnel**: a public `https://….trycloudflare.com` address that works only while the demo runs. No hosting, no Cloudflare account, no cost. Use it to try the store on a phone, show it to people, and review the Bangla wording on the real pages. It is **not** a home for a live shop: it stops when this computer sleeps or the script stops, and the address changes every time.

## One-time set-up

Install Cloudflare's tunnel program (needs your password once):

```bash
curl -L -o /tmp/cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i /tmp/cloudflared.deb
```

## Start and stop

1. Start BuyNest as usual in one terminal: `./dev.sh`
2. In a second terminal: `./demo.sh`
   - It asks for a **demo password** (at least 10 characters; it is never saved to a file).
   - It builds the store and admin, serves the production build on port 4173, opens the tunnel and prints the public address.
3. Open the address. The browser first asks for a user name and password: **any user name + the demo password**. Then the store works as usual; the admin is at `/admin/` with your admin account.
4. **Ctrl+C** stops the demo; the address stops working at once.

## What protects it

- **Demo password on everything** (store, admin, sign-in service, photos): the demo accounts' passwords are written in this public repository, so without the gate anyone with the link could open the admin. Implemented in `frontend/server/demoGate.js` (HTTP Basic, constant-time comparison), active only when `BUYNEST_DEMO_PASSWORD` is set, so development and tests are unchanged.
- **Only the tunnel's addresses are accepted** (`*.trycloudflare.com`) while the gate is on; other host names get 403.
- **Search engines are asked not to index it** (`X-Robots-Tag: noindex, nofollow`).
- **Only the store's production server is shared.** The API (:8000), the test email inbox (`/dev/mailbox`) and the SMS inbox (`/dev/sms`) stay on this computer.
- Payments, couriers and SMS stay in the mode the API runs in: **test mode** unless you have put real keys in `backend/.env`. Don't add live keys while demoing.

## Limits to know

- Emails and SMS links point to the address in the API's `STOREFRONT_URL` (`http://localhost:5173` in development), so a link opened from a test email works on this computer, not on a tester's phone.
- Every visitor reaches the store through the tunnel, so the per-visitor rate limits (sign-in tries, link confirmations) count all testers together. Fine for a handful of people.
- Testers share the same demo data as your development store: what they order or change stays.
