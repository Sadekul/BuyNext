import { ApiError, apiClient } from './apiClient'

/*
 * Phase 9 self-service for signed-in customers (REAL_SHOP only), through the
 * shop service on this site's own address (server/shopApi.js →
 * server/shop/account.js). The account always comes from the session cookie.
 * Wrap calls in useAuth().authorizedRequest so an expired session is renewed.
 */

const SHOP = { sameOrigin: true }

/**
 * POST /api/shop/me/email { email, password } → { email, expiresIn, resendIn, message }.
 * A 6-digit code goes to the NEW address; the account keeps its email until
 * the code is entered. 422 fieldErrors: password, email.
 */
export function requestEmailChange({ email, password }) {
  return apiClient.post('/api/shop/me/email', { email: email.trim(), password }, SHOP)
}

/** POST /api/shop/me/email/confirm { code } → the profile with its new email. 422 fieldErrors: code, email. */
export function confirmEmailChange({ code }) {
  return apiClient.post('/api/shop/me/email/confirm', { code: code.replace(/\s+/g, '') }, SHOP)
}

/** "buynest-my-data-2026-11-17.json" from a Content-Disposition header. */
export function fileNameFrom(disposition, fallback) {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? '')
  return match ? decodeURIComponent(match[1]).trim() : fallback
}

/** Hands a file to the browser's downloads (a temporary link with `download`). */
export function saveFile(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  // Some browsers start the download after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * GET /api/shop/me/export → downloads the JSON file the API made, exactly as
 * sent (not apiClient: the answer is a file, not data for the page).
 * Resolves to the file name. ApiError 429 after 3 exports in an hour.
 */
export async function downloadMyData() {
  let response
  try {
    response = await fetch(new URL('/api/shop/me/export', window.location.origin), { credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) })
  } catch (error) {
    if (error.name === 'TimeoutError') throw new ApiError('The server took too long to respond. Please try again.')
    throw new ApiError('Network error. Check your internet connection and try again.')
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    const fallback = response.status === 429 ? 'You can download your data 3 times an hour. Please try again later.' : "We couldn't prepare your data. Please try again."
    throw new ApiError(data?.message ?? fallback, { status: response.status, data })
  }
  const fileName = fileNameFrom(response.headers.get('content-disposition'), `buynest-my-data-${new Date().toISOString().slice(0, 10)}.json`)
  saveFile(await response.blob(), fileName)
  return fileName
}

/**
 * POST /api/shop/me/delete { password, confirm: "DELETE" } → { message }.
 * The service deletes the session cookies with the answer. 422 fieldErrors:
 * password, confirm, account (an open order).
 */
export function deleteAccount({ password, confirm }) {
  return apiClient.post('/api/shop/me/delete', { password, confirm }, SHOP)
}

/** GET /api/shop/me/stock-alerts → { alerts: [{ id, productId, title, thumbnail, variantId, variantLabel, createdAt }] } (waiting alerts only) */
export function getStockAlerts({ signal } = {}) {
  return apiClient.get('/api/shop/me/stock-alerts', { ...SHOP, signal })
}

/** DELETE /api/shop/me/stock-alerts/:id */
export function deleteStockAlert(id) {
  return apiClient.delete(`/api/shop/me/stock-alerts/${encodeURIComponent(id)}`, SHOP)
}

/**
 * POST /api/shop/products/:id/stock-alerts { email?, variantId? } → 202 { message }.
 * Signed-in customers are recognised by the session (no email); guests give
 * one. The answer is the same whether or not the email was already listed.
 */
export function createStockAlert(productId, { email, variantId } = {}) {
  return apiClient.post(
    `/api/shop/products/${encodeURIComponent(productId)}/stock-alerts`,
    { ...(email && { email: email.trim() }), ...(variantId && { variantId }) },
    SHOP,
  )
}

/**
 * POST /api/shop/stock-alerts/unsubscribe { token } → { removed, message }:
 * the "stop these alerts" link in a back-in-stock email (no sign-in needed).
 * 422 fieldErrors.token when the link isn't valid.
 */
export function unsubscribeStockAlerts(token) {
  return apiClient.post('/api/shop/stock-alerts/unsubscribe', { token }, SHOP)
}
