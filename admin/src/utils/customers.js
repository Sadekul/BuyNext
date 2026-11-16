/** A BuyNest customer's state, as icon + words (StatusBadge). */
export function accountStatus(customer) {
  if (!customer.isActive) return { tone: 'danger', label: 'Blocked' }
  if (!customer.emailVerified) return { tone: 'warning', label: 'Email not confirmed' }
  return { tone: 'success', label: 'Active' }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const isEmail = (value) => EMAIL.test(value.trim())
