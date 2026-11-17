import { json, laravelRaw, readLimitedBody } from './http.js'

/*
 * Payment provider callbacks, at /api/payments/* (docs/backend/PHASE8_CONTRACT.md §1).
 *
 *   POST /api/payments/stripe/webhook → POST /api/v1/payments/stripe/webhook
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

/** /api/payments/<segments> */
export async function handlePaymentsRequest(request, segments) {
  if (segments.join('/') !== 'stripe/webhook') return json({ message: 'Not found.' }, 404)
  if (request.method !== 'POST') {
    const response = json({ message: 'Method not allowed.' }, 405)
    response.headers.set('Allow', 'POST')
    return response
  }
  return stripeWebhook(request)
}
