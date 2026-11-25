/*
 * Phase 17 §2 (docs/backend/PHASE17_CONTRACT.md): the top promo strip, the
 * slim line above the store's header. Its form values, the checks that
 * mirror the BFF's (frontend/server/adminSystemApi.js checkTopBar), and what
 * is sent with the home page. Whether a coupon is active only the API knows:
 * its answer comes back on "topBar.couponCode".
 */

export const TOP_BAR_MESSAGE_MAX = 120
export const COUPON_CODE_MAX = 40
// Coupon codes are stored upper case: 3–40 letters, digits, dashes, underscores.
const COUPON_CODE = /^[A-Z0-9_-]{3,40}$/

/** The saved strip → the form's values (every field a string). An API without the strip → hidden and empty. */
export const topBarForm = (bar) => ({
  enabled: bar?.enabled === true,
  message: bar?.message ?? '',
  messageBn: bar?.messageBn ?? '',
  couponCode: bar?.couponCode ?? '',
})

/** The checks before saving, by path ("topBar.message"), so the messages show next to the fields. */
export function topBarErrors(bar) {
  const found = {}
  const message = bar.message.trim()
  if (message.length > TOP_BAR_MESSAGE_MAX) found['topBar.message'] = [`Use up to ${TOP_BAR_MESSAGE_MAX} characters.`]
  else if (bar.enabled && !message) found['topBar.message'] = ['Write the promo message, or turn the promo strip off.']
  if (bar.messageBn.trim().length > TOP_BAR_MESSAGE_MAX) found['topBar.messageBn'] = [`Use up to ${TOP_BAR_MESSAGE_MAX} characters.`]
  const code = bar.couponCode.trim().toUpperCase()
  if (code && !COUPON_CODE.test(code)) found['topBar.couponCode'] = ["This coupon doesn't exist or isn't active."]
  return found
}

/** The form's values → what PUT /api/admin/home takes (always sent, like the slides; '' = none). */
export const toTopBar = (bar) => ({
  enabled: bar.enabled,
  message: bar.message.trim(),
  messageBn: bar.messageBn.trim(),
  couponCode: bar.couponCode.trim().toUpperCase(),
})
