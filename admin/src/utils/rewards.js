import { formatCount } from './format'
import { giftCardSplit } from './orders'

/*
 * Phase 11 §4: reward points in the admin. Words for each kind of balance
 * change, signed point counts, the checks of "Adjust balance" and Settings →
 * Reward points, and how a refund divides between points, the gift card, and
 * the payment method (points first, then the gift card, then the rest). The
 * server checks everything again; its 422 messages appear on the fields.
 */

export const REWARD_TYPES = {
  earn: 'Earned on an order',
  spend: 'Spent on an order',
  cancel_return: 'Returned: order cancelled',
  refund_return: 'Returned: order refunded',
  refund_reverse: 'Taken back: order refunded',
  signup: 'Sign-up bonus',
  review: 'Review bonus',
  adjust: 'Adjusted by staff',
}
export const rewardTypeLabel = (type) => REWARD_TYPES[type] ?? type ?? 'Change'

/** 1200 → "1,200 points"; 1 → "1 point". */
export const formatPoints = (points) => `${formatCount(points)} ${Math.abs(points) === 1 ? 'point' : 'points'}`
/** +500 / −200 (a real minus sign, read as "minus"). */
export const signedPoints = (points) => (points < 0 ? `−${formatCount(-points)}` : `+${formatCount(points)}`)

export const MAX_ADJUSTMENT = 1_000_000

/** "Adjust balance": a whole number other than 0 that keeps the balance at 0 or more, and a reason. */
export function pointsAdjustmentErrors({ points, note }, balance) {
  const errors = {}
  const text = points.trim()
  const value = Number(text)
  if (!/^[-+]?\d+$/.test(text) || value === 0 || Math.abs(value) > MAX_ADJUSTMENT) {
    errors.points = ['Enter a whole number of points other than 0 (negative takes points away).']
  } else if (balance + value < 0) {
    errors.points = [`The balance is ${formatPoints(balance)}: you can take away at most that.`]
  }
  const reason = note.trim()
  if (!reason) errors.note = ['Say why the balance changes (kept in the history).']
  else if (reason.length < 3) errors.note = ['Give a reason of at least 3 characters.']
  else if (reason.length > 255) errors.note = ['Keep the reason under 255 characters.']
  return errors
}

const hasPlaces = (value, places) => Math.abs(value * 10 ** places - Math.round(value * 10 ** places)) < 1e-6

/** Settings → Reward points form (text inputs) → { values } or { errors }, like the server's rules. */
export function rewardSettingsValues(form) {
  const errors = {}
  const number = (key) => (form[key].trim() === '' ? Number.NaN : Number(form[key]))
  const whole = (key, min, max, message) => {
    const value = number(key)
    if (!Number.isInteger(value) || value < min || value > max) errors[key] = [message]
    return value
  }
  const earnRate = number('earnRate')
  if (!Number.isFinite(earnRate) || earnRate < 0 || earnRate > 1000 || !hasPlaces(earnRate, 2)) errors.earnRate = ['Enter the points per $1.00 from 0 to 1,000, with at most 2 decimals.']
  const pointValue = number('pointValue')
  if (!Number.isFinite(pointValue) || pointValue <= 0 || pointValue > 100 || !hasPlaces(pointValue, 4)) errors.pointValue = ['Enter the value of one point, above 0 and up to 100, with at most 4 decimals.']
  const values = {
    enabled: form.enabled,
    earnRate,
    pointValue,
    minRedeem: whole('minRedeem', 0, 1_000_000, 'Enter a whole number of points from 0 to 1,000,000.'),
    maxPercent: whole('maxPercent', 1, 100, 'Enter a whole percentage from 1 to 100.'),
    signupBonus: whole('signupBonus', 0, 1_000_000, 'Enter a whole number of points from 0 to 1,000,000.'),
    reviewBonus: whole('reviewBonus', 0, 1_000_000, 'Enter a whole number of points from 0 to 1,000,000.'),
  }
  return Object.keys(errors).length > 0 ? { errors } : { values }
}

/**
 * How a refund of `totalCents` divides, as the server will make it: points
 * first (up to what they paid and wasn't returned yet), then the gift card,
 * then the payment method. null when the order used neither points nor a
 * gift card. `points` is an estimate of the points given back.
 */
export function refundSplit(order, totalCents, limits) {
  const spent = order.rewardPoints?.spent ?? 0
  const amount = order.rewardPoints?.amount ?? 0
  const pointsLeftCents = spent > 0 ? Math.round((limits?.rewardPointsRefundable ?? amount) * 100) : 0
  const total = Math.max(totalCents, 0)
  const toPointsCents = Math.min(total, pointsLeftCents)
  const card = giftCardSplit(order, total - toPointsCents, limits)
  if (spent <= 0 && !card) return null
  // Points per cent as the order spent them (the server rounds the same way: spent × money ÷ amount).
  const amountCents = Math.round(amount * 100)
  const points = amountCents > 0 ? Math.min(spent, Math.round((toPointsCents * spent) / amountCents)) : 0
  return {
    usedPoints: spent > 0,
    toPointsCents,
    points,
    usedGiftCard: card !== null,
    last4: card?.last4 ?? null,
    toCardCents: card?.toCardCents ?? 0,
    otherCents: card ? card.otherCents : total - toPointsCents,
  }
}
