import { json, laravel, laravelRaw, readLimitedBody } from './http.js'

/*
 * Payment provider callbacks, at /api/payments/* (docs/backend/PHASE8_CONTRACT.md §1).
 *
 *   POST /api/payments/stripe/webhook → POST /api/v1/payments/stripe/webhook
 *   POST /api/payments/paypal/webhook → POST /api/v1/payments/paypal/webhook (phase 10)
 *   POST /api/payments/sslcommerz/return/{success|fail|cancel} → POST /api/v1/payments/sslcommerz/return,
 *        then 303 to the confirmation page (phase 12: the shopper's browser, see below)
 *   POST /api/payments/sslcommerz/ipn → POST /api/v1/payments/sslcommerz/ipn (phase 12)
 *
 * Stripe calls this server to server (no browser, no cookies) when a
 * Checkout Session is paid or expires. The Laravel API checks the
 * `Stripe-Signature` header, an HMAC of the exact bytes Stripe sent, so this
 * service forwards the body AS RAW BYTES: never parsed as JSON or
 * re-serialized (that would change spacing or key order and break the
 * signature). The API's status is passed through unchanged: Stripe retries
 * anything that isn't 2xx, and 400 means "bad signature".
 *
 * This keeps the Laravel API private: only the storefront's address needs to
 * be registered with Stripe.
 */

// Stripe's events are a few KB; Checkout Session events stay well under this.
export const MAX_WEBHOOK_BYTES = 512 * 1024
const MAX_SIGNATURE_LENGTH = 4096

async function stripeWebhook(request) {
  const signature = request.headers.get('stripe-signature')
  if (!signature || signature.length > MAX_SIGNATURE_LENGTH) return json({ message: 'Missing or invalid Stripe-Signature header.' }, 400)

  const body = await readLimitedBody(request, MAX_WEBHOOK_BYTES)
  if (body.tooLarge) return json({ message: 'The webhook payload is too large.' }, 413)

  const { status, data } = await laravelRaw('/api/v1/payments/stripe/webhook', {
    request,
    bytes: body.bytes,
    // Stripe sends application/json; the API reads the raw body either way.
    contentType: request.headers.get('content-type') || 'application/json',
    headers: { 'Stripe-Signature': signature },
  })
  // Only a message goes back (Stripe shows it in its dashboard); never anything else the API said.
  return json(typeof data?.message === 'string' ? { message: data.message.slice(0, 500) } : { received: status >= 200 && status < 300 }, status)
}

/*
 * Phase 10: PayPal's webhook. The API verifies it with PayPal's
 * verify-webhook-signature API, which needs these five headers and the event
 * exactly as PayPal sent it, so the body goes on as raw bytes here too.
 */
export const PAYPAL_HEADERS = ['PayPal-Transmission-Id', 'PayPal-Transmission-Time', 'PayPal-Transmission-Sig', 'PayPal-Cert-Url', 'PayPal-Auth-Algo']
const MAX_PAYPAL_HEADER_LENGTH = 2048

async function paypalWebhook(request) {
  const headers = {}
  for (const name of PAYPAL_HEADERS) {
    const value = request.headers.get(name)
    if (!value || value.length > MAX_PAYPAL_HEADER_LENGTH) return json({ message: `Missing or invalid ${name} header.` }, 400)
    headers[name] = value
  }

  const body = await readLimitedBody(request, MAX_WEBHOOK_BYTES)
  if (body.tooLarge) return json({ message: 'The webhook payload is too large.' }, 413)

  const { status, data } = await laravelRaw('/api/v1/payments/paypal/webhook', {
    request,
    bytes: body.bytes,
    contentType: request.headers.get('content-type') || 'application/json',
    headers,
    // The API asks PayPal to verify the signature before answering.
    timeout: 25_000,
  })
  return json(typeof data?.message === 'string' ? { message: data.message.slice(0, 500) } : { received: status >= 200 && status < 300 }, status)
}

/*
 * Phase 12 (docs/backend/PHASE12_CONTRACT.md §3): SSLCommerz.
 *
 * The return trip. SSLCommerz sends the SHOPPER'S BROWSER back with a form
 * POST from its own domain to success_url / fail_url / cancel_url. That is a
 * cross-site POST: SameSite cookies (this store's session) are not sent, and
 * the browser labels it Sec-Fetch-Site: cross-site. So this route never
 * looks at cookies: it reads the posted tran_id / val_id / status (and
 * value_a, the order number), hands them to the API with the shared key, and
 * answers 303 See Other to the confirmation page (a GET, same-site from then
 * on: the page reloads the order with the session or the guest's email kept
 * in the tab). The API never trusts the posted status: on success it
 * validates val_id with SSLCommerz before marking anything paid.
 */
export const MAX_SSLCOMMERZ_BYTES = 64 * 1024
const SSLCOMMERZ_RESULTS = { success: 'success', fail: 'failed', cancel: 'cancelled' }
const RETURN_PAYMENTS = new Set(Object.values(SSLCOMMERZ_RESULTS))
const ORDER_NUMBER = /^BN-\d{1,12}$/
// What may be forwarded: SSLCommerz's ids are short letters, digits, dashes, underscores (and dots in val_id).
const FIELD_PATTERNS = {
  tran_id: /^[A-Za-z0-9_-]{1,64}$/,
  val_id: /^[A-Za-z0-9_.-]{1,100}$/,
  status: /^[A-Za-z_]{1,30}$/,
  value_a: ORDER_NUMBER,
}

/** The posted form (urlencoded, or multipart just in case) as a plain object of the allowed fields. */
async function readSslCommerzForm(request, bytes) {
  const type = request.headers.get('content-type') ?? ''
  let entries
  try {
    if (/^multipart\/form-data/i.test(type)) entries = [...(await new Response(bytes, { headers: { 'Content-Type': type } }).formData()).entries()]
    else entries = [...new URLSearchParams(new TextDecoder().decode(bytes)).entries()]
  } catch {
    entries = []
  }
  const form = {}
  for (const [name, value] of entries) {
    if (typeof value === 'string' && FIELD_PATTERNS[name]?.test(value.trim()) && !(name in form)) form[name] = value.trim()
  }
  return form
}

/** "BN-100001-2" (an attempt: everything before the last dash) → "BN-100001". */
const orderFromTranId = (tranId) => tranId?.match(/^(BN-\d{1,12})(?:-\d{1,4})?$/)?.[1] ?? null

function seeOther(location) {
  return new Response(null, {
    status: 303,
    // Relative: always this store's own address, whatever host the request came through.
    headers: { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  })
}

async function sslcommerzReturn(request, result) {
  const body = await readLimitedBody(request, MAX_SSLCOMMERZ_BYTES)
  if (body.tooLarge) return json({ message: 'The payment answer is too large.' }, 413)
  const form = await readSslCommerzForm(request, body.bytes)
  let payment = SSLCOMMERZ_RESULTS[result]

  let answer = null
  if (form.tran_id || form.value_a) {
    answer = await laravel('/api/v1/payments/sslcommerz/return', {
      method: 'POST',
      request,
      body: { result, tran_id: form.tran_id ?? null, val_id: form.val_id ?? null, status: form.status ?? null, value_a: form.value_a ?? null },
    })
    const data = answer.data?.data ?? {}
    // The API's verdict wins (it validated val_id): `confirmation` is success (paid, on review, or still
    // pending), failed (not valid, mismatch, unknown order), or cancelled. A refused (422, malformed) success → failed.
    if (answer.status >= 200 && answer.status < 300 && RETURN_PAYMENTS.has(data.confirmation)) payment = data.confirmation
    else if (answer.status === 422 && result === 'success') payment = 'failed'
    // Anything else (the API unreachable): the confirmation page polls the order; the IPN may still mark it paid.
    if (answer.status >= 200 && answer.status < 300 && data.result === 'unknown_order') return seeOther('/')
  }

  const data = answer?.data?.data ?? {}
  // The API's order number, else the order SSLCommerz carried back (value_a, or tran_id before its attempt suffix).
  const number = [data.order_number, form.value_a, orderFromTranId(form.tran_id)].find((value) => typeof value === 'string' && ORDER_NUMBER.test(value))
  // Not one of this store's orders: home (there's nothing to show).
  return seeOther(number ? `/order-confirmation/${number}?payment=${payment}&provider=sslcommerz` : '/')
}

/*
 * The IPN: SSLCommerz's server-to-server notice (no browser). Passed on as
 * the raw form bytes, like the Stripe and PayPal webhooks; the API verifies
 * it by asking SSLCommerz's validation API about the posted val_id.
 */
async function sslcommerzIpn(request) {
  const body = await readLimitedBody(request, MAX_SSLCOMMERZ_BYTES)
  if (body.tooLarge) return json({ message: 'The notification is too large.' }, 413)
  const { status, data } = await laravelRaw('/api/v1/payments/sslcommerz/ipn', {
    request,
    bytes: body.bytes,
    contentType: request.headers.get('content-type') || 'application/x-www-form-urlencoded',
    // The API asks SSLCommerz's validation API before answering.
    timeout: 25_000,
  })
  return json(typeof data?.message === 'string' ? { message: data.message.slice(0, 500) } : { received: status >= 200 && status < 300 }, status)
}

const WEBHOOKS = {
  'stripe/webhook': stripeWebhook,
  'paypal/webhook': paypalWebhook,
  'sslcommerz/ipn': sslcommerzIpn,
  'sslcommerz/return/success': (request) => sslcommerzReturn(request, 'success'),
  'sslcommerz/return/fail': (request) => sslcommerzReturn(request, 'fail'),
  'sslcommerz/return/cancel': (request) => sslcommerzReturn(request, 'cancel'),
}

/** /api/payments/<segments> */
export async function handlePaymentsRequest(request, segments) {
  const webhook = WEBHOOKS[segments.join('/')]
  if (!webhook) return json({ message: 'Not found.' }, 404)
  if (request.method !== 'POST') {
    const response = json({ message: 'Method not allowed.' }, 405)
    response.headers.set('Allow', 'POST')
    return response
  }
  return webhook(request)
}
