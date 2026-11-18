import { json, laravelRaw, readLimitedBody } from './http.js'

/*
 * Payment provider callbacks, at /api/payments/* (docs/backend/PHASE8_CONTRACT.md §1).
 *
 *   POST /api/payments/stripe/webhook → POST /api/v1/payments/stripe/webhook
 *   POST /api/payments/paypal/webhook → POST /api/v1/payments/paypal/webhook (phase 10)
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

const WEBHOOKS = { 'stripe/webhook': stripeWebhook, 'paypal/webhook': paypalWebhook }

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
