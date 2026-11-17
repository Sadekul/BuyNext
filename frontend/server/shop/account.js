import { laravel, laravelDownload } from '../http.js'
import { customerProfile } from '../accounts/laravel.js'
import { failed } from './laravel.js'

/*
 * Phase 9 customer self-service with BuyNest's Laravel API
 * (docs/backend/PHASE9_CONTRACT.md, sections 4, 6, and 7):
 *   /api/v1/me/email[/confirm]          change the account's email (a code goes to the NEW address)
 *   /api/v1/me/export                   download my data (a JSON file)
 *   /api/v1/me/delete                   delete my account (password + typed "DELETE")
 *   /api/v1/me/stock-alerts[/{id}]      my "email me when it's back" alerts
 *   /api/v1/products/{id}/stock-alerts  ask for one (signed in, or a guest's email)
 *   /api/v1/stock-alerts/unsubscribe    the "stop these alerts" link in the email (no sign-in: the token is the proof)
 *
 * Same rules as shop/laravel.js: only listed fields go either way, the API's
 * snake_case becomes the storefront's camelCase, and every function resolves
 * to { ok: true, status, data } or { ok: false, status, body }.
 */

const str = (value) => (typeof value === 'string' ? value : undefined)
const trimmed = (value, max) => str(value)?.trim().slice(0, max)
const toId = (value) => {
  const id = Number.isInteger(value) ? value : Number.parseInt(value, 10)
  return Number.isInteger(id) && id > 0 ? id : undefined
}
const answer = (result, okStatuses, map) => (okStatuses.includes(result.status) ? { ok: true, status: result.status, data: map(result.data) } : failed(result))

/** "We emailed a code" → { email, expiresIn, resendIn, message } (seconds). */
const codeSent = (data = {}) => ({
  email: str(data.data?.email) ?? null,
  expiresIn: Number.isInteger(data.data?.expires_in) ? data.data.expires_in : null,
  resendIn: Number.isInteger(data.data?.resend_in) ? data.data.resend_in : null,
  message: str(data.message) ?? 'We emailed a code to your new address.',
})

// Only addresses the page may show: the store's own /media/… photos, or https.
const imageUrl = (value) => (typeof value === 'string' && /^(https:\/\/\S+|\/media\/\S+)$/.test(value) ? value : null)

/** A stock alert, as the customer sees it in Account → Stock alerts. */
export const fromStockAlert = (raw = {}) => {
  const product = raw.product && typeof raw.product === 'object' ? raw.product : {}
  return {
    id: raw.id,
    productId: product.id ?? raw.product_id ?? null,
    title: str(product.name) ?? str(raw.product_name) ?? '',
    thumbnail: imageUrl(product.thumbnail_url ?? raw.thumbnail_url),
    variantId: Number.isInteger(raw.variant_id) ? raw.variant_id : null,
    variantLabel: str(raw.variant_label) ?? str(raw.variant?.label) ?? null,
    createdAt: str(raw.created_at) ?? null,
  }
}

/** "buynest-my-data-2026-11-17.json" from the API's Content-Disposition, or a safe default. */
export function exportFileName(disposition) {
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? '')
  const name = match ? decodeURIComponent(match[1]).trim() : ''
  return /^[\w.-]{1,100}\.json$/.test(name) ? name : `buynest-my-data-${new Date().toISOString().slice(0, 10)}.json`
}

export const laravelAccount = {
  /** { email, password } → a 6-digit code is emailed to the new address; the account keeps the old one until confirmed. */
  async requestEmailChange(token, body, request) {
    const result = await laravel('/api/v1/me/email', {
      method: 'POST',
      token,
      request,
      body: { email: trimmed(body.email, 254), password: str(body.password) },
    })
    return answer(result, [200, 201, 202], codeSent)
  },

  /** { code } → the profile with its new email (other sessions are signed out by the API). */
  async confirmEmailChange(token, body, request) {
    const code = str(body.code)?.replace(/\s+/g, '').slice(0, 12)
    const result = await laravel('/api/v1/me/email/confirm', { method: 'POST', token, request, body: { code } })
    return answer(result, [200], (data) => customerProfile(data.data?.customer ?? data.data))
  },

  /** The data export file, as the API sent it: { bytes, contentType, fileName }. */
  async exportData(token, request) {
    const result = await laravelDownload('/api/v1/me/export', { token, request })
    if (!result.bytes) return failed(result)
    return { ok: true, status: 200, data: { bytes: result.bytes, contentType: result.contentType, fileName: exportFileName(result.disposition) } }
  },

  /** { password, confirm: "DELETE" } → the account is deleted and every session signed out. */
  async deleteAccount(token, body, request) {
    const result = await laravel('/api/v1/me/delete', {
      method: 'POST',
      token,
      request,
      body: { password: str(body.password), confirm: str(body.confirm) },
    })
    return answer(result, [200, 202, 204], (data) => ({ message: str(data?.message) ?? 'Your account was deleted.' }))
  },

  /**
   * "Email me when it's back": signed in → the account's email (any email
   * sent is ignored); a guest gives one. Always the same 202 answer.
   */
  async createStockAlert(token, productId, body, request) {
    const variantId = toId(body.variantId)
    const email = token ? undefined : trimmed(body.email, 254)
    const result = await laravel(`/api/v1/products/${productId}/stock-alerts`, {
      method: 'POST',
      token,
      request,
      body: { ...(email !== undefined && { email }), ...(variantId && { variant_id: variantId }) },
    })
    // 202 { data: { message } }: the same words whether or not the email was already listed.
    return answer(result, [200, 201, 202], (data) => ({ message: str(data?.data?.message) ?? str(data?.message) ?? null }))
  },

  /** { token } from the email's link → { removed, message }: every waiting alert of that address is removed. */
  async unsubscribeStockAlerts(body, request) {
    const value = str(body.token)?.trim()
    if (!value || !/^\d{1,20}\.[A-Za-z0-9_-]{20,128}$/.test(value)) {
      const message = "This link isn't valid. Open the link from the email again."
      return { ok: false, status: 422, body: { message, errors: { token: [message] } } }
    }
    const result = await laravel('/api/v1/stock-alerts/unsubscribe', { method: 'POST', request, body: { token: value } })
    return answer(result, [200], (data) => {
      const removed = Number.isInteger(data?.data?.removed) ? data.data.removed : 0
      return { removed, message: removed > 0 ? "You won't get any more back-in-stock emails for these products." : 'There were no alerts left to stop.' }
    })
  },

  async listStockAlerts(token, request) {
    const result = await laravel('/api/v1/me/stock-alerts', { token, request })
    return answer(result, [200], (data) => ({ alerts: (Array.isArray(data.data) ? data.data : []).map(fromStockAlert) }))
  },

  async deleteStockAlert(token, id, request) {
    const result = await laravel(`/api/v1/me/stock-alerts/${id}`, { method: 'DELETE', token, request })
    return answer(result, [200, 204], () => ({ ok: true }))
  },
}
