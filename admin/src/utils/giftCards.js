import { LuBan, LuCircleCheck, LuClock } from 'react-icons/lu'
import { formatMoney } from './format'

/*
 * Phase 10 §5: gift card statuses for StatusBadge (icon + words; the tone
 * only adds colour), names, and the checks of the admin's gift card forms.
 * The server checks everything again; its 422 messages appear on the fields.
 */

export const GIFT_CARD_STATUSES = {
  active: { label: 'Active', tone: 'success', icon: LuCircleCheck },
  disabled: { label: 'Disabled', tone: 'neutral', icon: LuBan },
  expired: { label: 'Expired', tone: 'warning', icon: LuClock },
}
export const giftCardStatus = (status) => GIFT_CARD_STATUSES[status] ?? { label: status ?? 'Unknown', tone: 'neutral', icon: LuClock }
export const GIFT_CARD_FILTERS = Object.fromEntries(Object.entries(GIFT_CARD_STATUSES).map(([status, { label }]) => [status, label]))

/** "Gift card ending 7KQ2". */
export const cardName = (card) => (card?.last4 ? `Gift card ending ${card.last4}` : 'Gift card')

/** +$10.00 / −$5.00 (a real minus sign, read as "minus"). */
export const signedMoney = (amount) => (amount < 0 ? `−${formatMoney(-amount)}` : `+${formatMoney(amount)}`)

const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const MAX_GIFT_CARD = 10_000

/** The create form's problems by field ({} when it can be sent). */
export function giftCardErrors(values, { sendEmail }) {
  const errors = {}
  const amount = Number(values.amount)
  if (values.amount.trim() === '' || !Number.isFinite(amount) || amount < 1 || amount > MAX_GIFT_CARD || !hasCents(amount)) {
    errors.amount = [`Enter an amount from 1.00 to ${MAX_GIFT_CARD.toLocaleString('en-US')}.00, with at most 2 decimals.`]
  }
  const email = values.recipientEmail.trim()
  if (email && !EMAIL.test(email)) errors.recipientEmail = ['Enter a valid email address.']
  else if (sendEmail && !email) errors.recipientEmail = ['Enter the email to send the card to, or untick "Email the card".']
  if (values.recipientName.trim().length > 100) errors.recipientName = ['Keep the name under 100 characters.']
  if (values.message.trim().length > 500) errors.message = ['Keep the message under 500 characters.']
  if (values.expiresAt) {
    const day = new Date(`${values.expiresAt}T23:59:59`)
    if (Number.isNaN(day.getTime()) || day < new Date()) errors.expiresAt = ['Choose a date from today on, or leave it empty.']
  }
  return errors
}

/** The adjustment's problems by field: a non-zero amount that keeps the balance at 0 or more, and a reason. */
export function adjustmentErrors({ amount, note }, balance) {
  const errors = {}
  const value = Number(amount)
  if (amount.trim() === '' || !Number.isFinite(value) || value === 0 || !hasCents(value) || Math.abs(value) > MAX_GIFT_CARD) {
    errors.amount = ['Enter an amount other than 0, with at most 2 decimals (negative takes money away).']
  } else if (Math.round((balance + value) * 100) < 0) {
    errors.amount = [`The card has ${formatMoney(balance)}: you can take away at most that.`]
  }
  if (!note.trim()) errors.note = ['Say why the balance changes (kept in the history).']
  else if (note.trim().length < 3) errors.note = ['Give a reason of at least 3 characters.']
  else if (note.trim().length > 500) errors.note = ['Keep the reason under 500 characters.']
  return errors
}
