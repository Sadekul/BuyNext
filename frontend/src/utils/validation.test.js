import { describe, expect, it } from 'vitest'
import { validateEmail, validateLogin, validateRegistration } from './validation'

const validRegistration = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  username: 'ada.lovelace',
  password: 'analytical1',
  confirmPassword: 'analytical1',
  acceptTerms: true,
}

describe('form validation', () => {
  it('validates email addresses', () => {
    expect(validateEmail('')).toBe('Enter your email address.')
    expect(validateEmail('ada@example')).toMatch(/valid email/)
    expect(validateEmail(' ada@example.com ')).toBeNull()
  })

  it('requires login fields', () => {
    expect(validateLogin({ username: ' ', password: '' })).toEqual({
      username: 'Enter your username.',
      password: 'Enter your password.',
    })
  })

  it('accepts a valid registration', () => {
    expect(validateRegistration(validRegistration)).toEqual({})
  })

  it.each([
    ['password', 'short1', 'Use at least 8 characters.'],
    ['password', 'onlyletters', 'Include at least one letter and one number.'],
    ['username', 'a!', 'Use 3–30 letters, numbers, dots, dashes, or underscores.'],
    ['confirmPassword', 'different1', 'Passwords do not match.'],
    ['confirmPassword', '', 'Confirm your password.'],
  ])('rejects %s = "%s"', (field, value, message) => {
    expect(validateRegistration({ ...validRegistration, [field]: value })[field]).toBe(message)
  })
})
