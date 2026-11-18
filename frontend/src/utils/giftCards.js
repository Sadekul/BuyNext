import { formatBasePrice } from './formatters'
import { storedNumber, storedText } from './storedValues'

/*
 * Gift cards (docs/backend/PHASE10_CONTRACT.md §5), with BuyNest's API.
 *
 * BUYING: a gift card product (`type: "gift_card"`) is sold by amount, to a
 * recipient. The shopper picks one of the store's amounts (or types their
 * own, within the store's limits) and names who receives it. Each choice is
 * its own cart line: two $50 cards for two people are two lines. The card
 * itself (its code) is created and emailed to the recipient only once the
 * order is paid.
 *
 * REDEEMING: one card per order, at checkout (`giftCardCode`). The server
 * decides how much of the total it pays.
 */

/** How many identical cards one line can hold (there is no stock to count). */
export const GIFT_CARD_MAX_QUANTITY = 10
export const GIFT_CARD_MESSAGE_MAX = 300
export const GIFT_CARD_NAME_MAX = 100

export const isGiftCardProduct = (product) => product?.type === 'gift_card'

/** True for a cart (or order) line that is a gift card. */
export const isGiftCardLine = (item) => Boolean(item?.giftCard) || item?.productType === 'gift_card'

/** A cart that holds only gift cards needs no delivery address or method. */
export const isGiftCardOnly = (items) => items.length > 0 && items.every(isGiftCardLine)

/** A short, stable id for a line's choices (djb2): the same card for the same person is one line. */
export function giftCardLineId({ amount, recipientName, recipientEmail, message }) {
  const text = [Number(amount).toFixed(2), recipientEmail.trim().toLowerCase(), recipientName.trim(), (message ?? '').trim()].join('|')
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0
  return hash.toString(36)
}

/**
 * The product as the cart adds it: priced at the chosen amount (gift cards
 * aren't discounted), never out of stock, with the recipient attached.
 */
export function withGiftCard(product, { amount, recipientName, recipientEmail, message }) {
  const details = {
    amount,
    recipientName: recipientName.trim(),
    recipientEmail: recipientEmail.trim(),
    message: message?.trim() ? message.trim() : null,
  }
  return {
    ...product,
    price: amount,
    discountPercentage: 0,
    stock: GIFT_CARD_MAX_QUANTITY,
    minimumOrderQuantity: 1,
    availabilityStatus: 'In Stock',
    hasVariants: false,
    productType: 'gift_card',
    giftCard: { id: giftCardLineId(details), ...details },
  }
}

/** The gift card details of a stored cart line, checked field by field (storage can be edited), or null. */
export function storedGiftCard(value) {
  if (!value || typeof value !== 'object') return null
  const amount = storedNumber(value.amount, 0.01, 100_000)
  const recipientName = storedText(value.recipientName)?.slice(0, GIFT_CARD_NAME_MAX)
  const recipientEmail = storedText(value.recipientEmail)?.slice(0, 254)
  if (amount === null || !recipientName || !recipientEmail) return null
  const message = storedText(value.message)?.slice(0, GIFT_CARD_MESSAGE_MAX) || null
  const details = { amount, recipientName, recipientEmail, message }
  return { id: giftCardLineId(details), ...details }
}

/** "For Sam Lee (sam@example.com)" */
export const recipientLabel = (giftCard) => (giftCard ? `For ${giftCard.recipientName}${giftCard.recipientEmail ? ` (${giftCard.recipientEmail})` : ''}` : '')

/** What the API needs for a gift card line (the browser never sends a price). */
export const giftCardPayload = (giftCard) => ({
  amount: giftCard.amount,
  recipientName: giftCard.recipientName,
  recipientEmail: giftCard.recipientEmail,
  message: giftCard.message,
})

/**
 * Checks a custom amount against the store's limits. → an error message, or null.
 */
export function customAmountError(value, custom) {
  const amount = Number(value)
  if (value === '' || !Number.isFinite(amount)) return 'Enter an amount.'
  if (Math.round(amount * 100) !== amount * 100) return 'Use whole cents, like 40 or 42.50.'
  if (amount < custom.min || amount > custom.max) return `Choose an amount from ${formatBasePrice(custom.min)} to ${formatBasePrice(custom.max)}.`
  return null
}

/** Gift card codes are typed from an email: spaces and lower case are fine. */
export const normalizeGiftCardCode = (value) => value.trim().toUpperCase().replace(/\s+/g, '')
