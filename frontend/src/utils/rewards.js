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
export const formatPoints = (points) => `${Number(points).toLocaleString('en-US')} ${Math.abs(points) === 1 ? 'pt' : 'pts'}`

/** What a reward transaction was, in the shopper's words. */
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
