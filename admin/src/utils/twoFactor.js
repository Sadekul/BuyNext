/*
 * Phase 9 §1: small helpers for two-step sign-in screens (kept out of the
 * component files so Fast Refresh keeps working).
 */

/** "JBSWY3DPEHPK3PXP" → "JBSW Y3DP EHPK 3PXP": easier to type into an app. */
export const groupKey = (secret) => (secret ?? '').replace(/\s+/g, '').replace(/(.{4})(?=.)/g, '$1 ')

/**
 * The server's QR code (an SVG it made itself; nothing is sent to another
 * service) as an image source: an <img> never runs anything inside the SVG.
 */
export const qrImageSource = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

/** A 6-digit code as typed ("123 456" is fine) → "123456", or null. */
export function sixDigits(value) {
  const digits = (value ?? '').replace(/\s+/g, '')
  return /^\d{6}$/.test(digits) ? digits : null
}

export const RECOVERY_FILE = 'buynest-admin-recovery-codes.txt'

/** The .txt file's text: a short header, then one code per line. */
export function recoveryCodesText(codes, { email, createdAt = new Date() } = {}) {
  return [
    'BuyNest admin: two-step sign-in recovery codes',
    ...(email ? [`Account: ${email}`] : []),
    `Created: ${createdAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    'Each code works once. Keep them somewhere safe, away from your password.',
    '',
    ...codes,
    '',
  ].join('\n')
}
