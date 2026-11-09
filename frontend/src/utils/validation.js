/*
 * Client-side validation for the auth forms. It gives instant, friendly
 * feedback — but it is NOT security: anyone can bypass browser code, so the
 * server must validate every field again. (Phase 10 switches the bigger
 * checkout form to React Hook Form + Zod.)
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/i

export function validateEmail(email) {
  if (!email.trim()) return 'Enter your email address.'
  if (!EMAIL_PATTERN.test(email.trim())) return 'Enter a valid email address, like name@example.com.'
  return null
}

/** Returns { field: message } for invalid fields; an empty object means valid. */
export function validateLogin({ username, password }) {
  const errors = {}
  if (!username.trim()) errors.username = 'Enter your username.'
  if (!password) errors.password = 'Enter your password.'
  return errors
}

export function validateRegistration({ firstName, lastName, email, username, password, confirmPassword, acceptTerms }) {
  const errors = {}
  if (!firstName.trim()) errors.firstName = 'Enter your first name.'
  if (!lastName.trim()) errors.lastName = 'Enter your last name.'
  const emailError = validateEmail(email)
  if (emailError) errors.email = emailError
  if (!USERNAME_PATTERN.test(username.trim())) {
    errors.username = 'Use 3–30 letters, numbers, dots, dashes, or underscores.'
  }
  if (password.length < 8) errors.password = 'Use at least 8 characters.'
  else if (!/[a-z]/i.test(password) || !/\d/.test(password)) errors.password = 'Include at least one letter and one number.'
  if (!confirmPassword) errors.confirmPassword = 'Confirm your password.'
  else if (confirmPassword !== password) errors.confirmPassword = 'Passwords do not match.'
  if (!acceptTerms) errors.acceptTerms = 'Please accept the terms to continue.'
  return errors
}
