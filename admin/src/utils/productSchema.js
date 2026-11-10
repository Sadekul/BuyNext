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
})

export const EMPTY_PRODUCT = { title: '', brand: '', category: '', description: '', price: 0, discountPercentage: 0, stock: 0, status: 'active' }
