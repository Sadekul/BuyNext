import { translate } from '../i18n'
import { formatNumber } from '../i18n/intl'
/*
 * Phase 11 §4: reward points, as the storefront shows them. The server
 * decides every number that counts (earning on invoice, spending limits);
 * these are display helpers only.
 */

/** "Earn about N points": whole points for an amount at the store's earn rate (points per 1.00). */
export function earnEstimate(amount, rewards) {
  if (!rewards?.enabled || !(rewards.earnRate > 0) || !(amount > 0)) return 0
  return Math.floor(Math.round(amount * 100 * rewards.earnRate) / 100)
}

/** 1500 → "1,500 pts". */
// Phase 13: "1,500 pts" / "১,৫০০ পয়েন্ট" (the number in the active language's digits).
export const formatPoints = (points) => translate('cart:points', { count: Math.abs(Number(points)), points: formatNumber(Number(points)) })

/** What a reward transaction was, in the shopper's words (English; rewardTypeLabel() gives the active language). */
export const REWARD_TYPE_LABELS = {
  earn: 'Earned on an order',
  spend: 'Used on an order',
  cancel_return: 'Returned: order cancelled',
  refund_return: 'Returned: order refunded',
  refund_reverse: 'Taken back: order refunded',
  signup: 'Welcome bonus',
  review: 'Review bonus',
  adjust: 'Adjusted by our team',
}

/** A reward transaction's type in the shopper's language; unknown types are shown as given. */
export const rewardTypeLabel = (type) => (REWARD_TYPE_LABELS[type] ? translate(`cart:rewardTypes.${type}`) : type)
