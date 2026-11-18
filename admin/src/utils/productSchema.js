import { z } from 'zod'

// The production Content-Security-Policy forbids eval; this stops Zod from probing it.
z.config({ jitless: true })

/*
 * Product form rules. The same rules are enforced again by the server
 * (validateProduct in frontend/server/adminApi.js): this copy only gives
 * instant feedback. If they ever disagree, the server's 422 errors are shown
 * on the fields.
 */
// At most 2 decimals. Compared with a tolerance: in floating point,
// 19.99 * 100 is 1998.9999999999998, not 1999.
const hasCents = (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6

const money = z
  .number({ error: 'Enter a price.' })
  .min(0, 'Enter a price from 0 to 1,000,000.')
  .max(1_000_000, 'Enter a price from 0 to 1,000,000.')
  .refine(hasCents, 'Use at most 2 decimals.')

export const productSchema = z.object({
  title: z.string().trim().min(2, 'Enter a name of 2 to 120 characters.').max(120, 'Enter a name of 2 to 120 characters.'),
  brand: z.string().trim().max(60, 'Keep the brand under 60 characters.'),
  category: z.string().min(1, 'Choose a category.'),
  description: z.string().max(2000, 'Keep the description under 2000 characters.'),
  price: money,
  discountPercentage: z.number({ error: 'Enter a discount from 0 to 90%.' }).min(0, 'Enter a discount from 0 to 90%.').max(90, 'Enter a discount from 0 to 90%.'),
  stock: z
    .number({ error: 'Enter the units in stock.' })
    .int('Enter a whole number of units.')
    .min(0, 'Enter a whole number of units from 0 to 100,000.')
    .max(100_000, 'Enter a whole number of units from 0 to 100,000.'),
  // Only active products are in the store (real data only; the demo ignores it).
  status: z.enum(['active', 'draft', 'archived'], { error: 'Choose active, draft, or archived.' }),
  // Phase 7: SEO (real data only). Empty = the store uses the name and description.
  metaTitle: z.string().trim().max(190, 'Keep the meta title under 190 characters.'),
  metaDescription: z.string().trim().max(500, 'Keep the meta description under 500 characters.'),
  // Phase 10 §5 (real data only): a gift card product, with its amount choices ("25, 50, 100") and an optional custom range.
  type: z.enum(['simple', 'gift_card'], { error: 'Choose a product type.' }),
  // Phase 10 §4: grams, for the shipping table rates; empty = the store's default weight.
  weight: z.string().trim().refine((text) => text === '' || (/^\d+$/.test(text) && Number(text) <= 1_000_000), 'Enter the weight in whole grams, or leave it empty.'),
  giftCardAmounts: z.string(),
  giftCardMinAmount: z.string(),
  giftCardMaxAmount: z.string(),
}).superRefine((values, context) => {
  if (values.type !== 'gift_card') return
  const amounts = parseAmounts(values.giftCardAmounts)
  const custom = [values.giftCardMinAmount, values.giftCardMaxAmount].map((text) => text.trim())
  if (amounts === null) context.addIssue({ code: 'custom', path: ['giftCardAmounts'], message: 'List amounts from 1 to 10,000 separated by commas, like 25, 50, 100.' })
  else if (amounts.length === 0 && !custom[0] && !custom[1]) context.addIssue({ code: 'custom', path: ['giftCardAmounts'], message: 'Give at least one amount, or a custom amount range.' })
  const [min, max] = custom.map((text) => (text === '' ? null : Number(text)))
  const badMoney = (value) => value !== null && (!Number.isFinite(value) || value < 1 || value > GIFT_CARD_LIMIT || !hasCents(value))
  if (badMoney(min)) context.addIssue({ code: 'custom', path: ['giftCardMinAmount'], message: 'Enter an amount from 1 to 10,000, with at most 2 decimals.' })
  if (badMoney(max)) context.addIssue({ code: 'custom', path: ['giftCardMaxAmount'], message: 'Enter an amount from 1 to 10,000, with at most 2 decimals.' })
  if ((min === null) !== (max === null)) context.addIssue({ code: 'custom', path: [min === null ? 'giftCardMinAmount' : 'giftCardMaxAmount'], message: 'Give both ends of the custom range, or neither.' })
  else if (min !== null && max !== null && !badMoney(min) && !badMoney(max) && max < min) context.addIssue({ code: 'custom', path: ['giftCardMaxAmount'], message: 'The largest amount must be at least the smallest.' })
})

const GIFT_CARD_LIMIT = 10_000
/** "25, 50,100" → [25, 50, 100] (sorted, no repeats); null when one isn't an amount from 1 to 10,000. */
export function parseAmounts(text) {
  const parts = text.split(/[\s,]+/).filter(Boolean)
  const amounts = parts.map(Number)
  if (amounts.some((amount) => !Number.isFinite(amount) || amount < 1 || amount > GIFT_CARD_LIMIT || !hasCents(amount))) return null
  return [...new Set(amounts)].sort((a, b) => a - b)
}

/** The form's gift card text fields ↔ what the admin service takes. */
export function giftCardFormFields(product) {
  const amounts = Array.isArray(product?.giftCardAmounts) ? product.giftCardAmounts : []
  const text = (value) => (value === null || value === undefined ? '' : String(value))
  return {
    type: product?.type === 'gift_card' ? 'gift_card' : 'simple',
    weight: text(product?.weight),
    giftCardAmounts: amounts.join(', '),
    giftCardMinAmount: text(product?.giftCardMinAmount),
    giftCardMaxAmount: text(product?.giftCardMaxAmount),
  }
}
export function toGiftCardValues(values) {
  const optional = (text) => (text.trim() === '' ? null : Number(text))
  const weight = { weight: optional(values.weight) }
  if (values.type !== 'gift_card') return { type: 'simple', ...weight }
  return {
    type: 'gift_card',
    ...weight,
    giftCardAmounts: parseAmounts(values.giftCardAmounts) ?? [],
    giftCardMinAmount: optional(values.giftCardMinAmount),
    giftCardMaxAmount: optional(values.giftCardMaxAmount),
  }
}

export const EMPTY_PRODUCT = {
  title: '',
  brand: '',
  category: '',
  description: '',
  price: 0,
  discountPercentage: 0,
  stock: 0,
  status: 'active',
  metaTitle: '',
  metaDescription: '',
  // Phase 10 §5.
  type: 'simple',
  weight: '',
  giftCardAmounts: '',
  giftCardMinAmount: '',
  giftCardMaxAmount: '',
}
/** Phase 10 §5: the form's gift card fields (text in the form, numbers when sent). */
export const GIFT_CARD_FIELDS = ['type', 'weight', 'giftCardAmounts', 'giftCardMinAmount', 'giftCardMaxAmount']
/** Fields only BuyNest's backend has (the demo data has no status, SEO, or gift card fields). */
export const LIVE_ONLY_FIELDS = ['status', 'metaTitle', 'metaDescription', ...GIFT_CARD_FIELDS]
