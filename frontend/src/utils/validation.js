/*
 * Client-side validation for the auth forms. It gives instant, friendly
 * feedback — but it is NOT security: anyone can bypass browser code, so the
 * server must validate every field again. (Phase 10 switches the bigger
 * checkout form to React Hook Form + Zod.)
 *
 * Phase 13: the messages are in the shopper's language (validation namespace).
 */
import { translate } from '../i18n'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/i
// International (E.164) form after tidying: "+" then 7 to 15 digits.
const PHONE_PATTERN = /^\+[1-9]\d{6,14}$/
const CODE_PATTERN = /^\d{6}$/

/** "+1 (555) 010-0100" → "+15550100100"; "00880…" → "+880…" (the server tidies the same way). */
export function normalizePhone(phone) {
  const compact = phone.trim().replace(/[\s().-]/g, '')
  return compact.startsWith('00') ? `+${compact.slice(2)}` : compact
}

export function validatePhone(phone) {
  if (!phone.trim()) return translate('validation:phone.required')
  if (!PHONE_PATTERN.test(normalizePhone(phone))) return translate('validation:phone.countryCode')
  return null
}

export function validateCode(code) {
  if (!code.trim()) return translate('validation:code.required')
  if (!CODE_PATTERN.test(code.trim())) return translate('validation:code.digits')
  return null
}

/** Password rules shared by sign-up and password reset (the server checks them again). */
export function validateNewPassword(password, confirmPassword) {
  const errors = {}
  if (password.length < 8) errors.password = translate('validation:password.length')
  else if (!/[a-z]/i.test(password) || !/\d/.test(password)) errors.password = translate('validation:password.mix')
  if (!confirmPassword) errors.confirmPassword = translate('validation:password.confirm')
  else if (confirmPassword !== password) errors.confirmPassword = translate('validation:password.mismatch')
  return errors
}

export function validateEmail(email) {
  if (!email.trim()) return translate('validation:email.required')
  if (!EMAIL_PATTERN.test(email.trim())) return translate('validation:email.invalid')
  return null
}

/**
 * Returns { field: message } for invalid fields; an empty object means valid.
 * Signs in with an email (BuyNest accounts) or a username (DummyJSON demo users).
 */
export function validateLogin({ username, email, password }) {
  const errors = {}
  if (email !== undefined) {
    const emailError = validateEmail(email)
    if (emailError) errors.email = emailError
  } else if (!username.trim()) {
    errors.username = translate('validation:login.username')
  }
  if (!password) errors.password = translate('validation:login.password')
  return errors
}

/** Sign-up form: a phone number (BuyNest accounts) or a username (DummyJSON demo). */
export function validateRegistration({ firstName, lastName, email, username, phone, password, confirmPassword, acceptTerms }) {
  const errors = {}
  if (!firstName.trim()) errors.firstName = translate('validation:register.firstName')
  if (!lastName.trim()) errors.lastName = translate('validation:register.lastName')
  const emailError = validateEmail(email)
  if (emailError) errors.email = emailError
  if (phone !== undefined) {
    const phoneError = validatePhone(phone)
    if (phoneError) errors.phone = phoneError
  } else if (!USERNAME_PATTERN.test(username.trim())) {
    errors.username = translate('validation:register.username')
  }
  Object.assign(errors, validateNewPassword(password, confirmPassword))
  if (!acceptTerms) errors.acceptTerms = translate('validation:register.terms')
  return errors
}
